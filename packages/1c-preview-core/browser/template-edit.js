/* Interactive editing of a 1C spreadsheet template (Ext/Template.xml): the
 * layer between the mouse and TemplateMarkup. It owns the cell selection, the
 * keyboard and the toolbar, and hands every change to the host as the text
 * edits DocEdits works out. */
(function (root) {
'use strict';

/* ---------- selection ---------- */

/* A selection is a plain object so the host can keep it, compare it and hand
 * it back; nothing here knows about the DOM. `mode` decides what the anchor
 * and focus mean: 'cells' is a rectangle between them, 'rows' and 'columns'
 * take whole rows or columns between them, 'all' is the sheet. Rows and
 * columns are 0-based here, as the renderer numbers them in data-row and
 * data-col; TemplateMarkup takes them 1-based, so rectOf's caller adds one. */

function cells(row, col) {
    return { mode: 'cells', anchor: { row: row, col: col }, focus: { row: row, col: col } };
}
function rows(row) {
    return { mode: 'rows', anchor: { row: row, col: 0 }, focus: { row: row, col: 0 } };
}
function columns(col) {
    return { mode: 'columns', anchor: { row: 0, col: col }, focus: { row: 0, col: col } };
}
function sheet() {
    return { mode: 'all', anchor: { row: 0, col: 0 }, focus: { row: 0, col: 0 } };
}

/* Shift-click and dragging move the focus and leave the anchor alone. */
function extendTo(selection, row, col) {
    if (!selection) return cells(row, col);
    return {
        mode: selection.mode,
        anchor: { row: selection.anchor.row, col: selection.anchor.col },
        focus: { row: row, col: col }
    };
}

function span(a, b, limit) {
    var lo = Math.max(0, Math.min(a, b));
    var hi = Math.min(limit - 1, Math.max(a, b));
    return hi < lo ? null : [lo, hi];
}

/* The selection as a rectangle clamped to the sheet, or null when it falls
 * outside it. `size` is { height, width } of the rendered model. */
function rectOf(selection, size) {
    if (!selection || !size || !(size.height > 0) || !(size.width > 0)) return null;
    if (selection.mode === 'all') {
        return { r0: 0, c0: 0, r1: size.height - 1, c1: size.width - 1 };
    }
    var vertical = span(selection.anchor.row, selection.focus.row, size.height);
    var horizontal = span(selection.anchor.col, selection.focus.col, size.width);
    if (selection.mode === 'rows') {
        if (!vertical) return null;
        return { r0: vertical[0], c0: 0, r1: vertical[1], c1: size.width - 1 };
    }
    if (selection.mode === 'columns') {
        if (!horizontal) return null;
        return { r0: 0, c0: horizontal[0], r1: size.height - 1, c1: horizontal[1] };
    }
    if (!vertical || !horizontal) return null;
    return { r0: vertical[0], c0: horizontal[0], r1: vertical[1], c1: horizontal[1] };
}

/* Arguments for the TemplateMarkup calls that take a range, in the 1-based
 * numbering those functions expect. Single cells leave the `to` fields out, so
 * an edit of one cell reads the same as it did before ranges existed. */
function rangeArgs(selection, size) {
    var rect = rectOf(selection, size);
    if (!rect) return null;
    var args = { row: rect.r0 + 1, column: rect.c0 + 1 };
    if (rect.r1 !== rect.r0) args.toRow = rect.r1 + 1;
    if (rect.c1 !== rect.c0) args.toColumn = rect.c1 + 1;
    return args;
}

function isSingleCell(selection, size) {
    var rect = rectOf(selection, size);
    return !!rect && rect.r0 === rect.r1 && rect.c0 === rect.c1;
}

/* A template cell keeps its kind while its text is edited, and a template
 * is a template only while it still holds a [Name] slot. */
var HAS_SLOT = /\[[^\[\]]+\]/;
var TAB = String.fromCharCode(9);
var EOL = String.fromCharCode(10);

/* Cell properties «Копировать» carries over and «Очистить формат» takes
 * away. Sizes are not among them: a width belongs to the column and a
 * height to the row, not to the cell being copied. */
var COPIED_FORMAT = ['horizontalAlignment', 'verticalAlignment', 'textPlacement', 'indent',
    'textColor', 'backColor', 'patternColor', 'borderColor', 'format', 'editFormat', 'mask',
    'protection', 'autoIndent'];
var CLEARED_BORDERS = ['border', 'leftBorder', 'topBorder', 'rightBorder', 'bottomBorder', 'borderColor'];
var CLEARED_FORMAT = COPIED_FORMAT.concat(CLEARED_BORDERS, ['font']);

/* Writing a cell parses the whole document, so a command made of one
 * operation per cell has a ceiling. */
var CELL_OP_LIMIT = 200;

/* The copy buffer is shared by every session of the page on purpose: the
 * sheet is rebuilt after each edit and its session with it, and a copy has
 * to survive that — as it does in 1C. */
var clipboard = null;

var ARROWS = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
var CLIPBOARD_KEYS = { c: 'copy', x: 'cut', v: 'paste', m: 'merge' };

/* The byte order mark is the host's business, not the document text's. A host
 * that reads a file strips the mark and remembers the encoding, then writes it
 * back on save; TemplateMarkup, which also writes files of its own, always
 * puts one in front. Left alone, every edit would push a second mark into the
 * text and the saved file would open as «ï»¿<?xml», which is not XML at all.
 * So the result keeps exactly the mark the document handed over. */
function sameByteOrderMark(before, after) {
    var had = before.charCodeAt(0) === 0xFEFF;
    var has = after.charCodeAt(0) === 0xFEFF;
    if (had === has) return after;
    return had ? String.fromCharCode(0xFEFF) + after : after.slice(1);
}

/* Which part of the sheet an operation can have changed, in the renderer's
 * 0-based rows and columns. Only these two operations stay inside the cells
 * they name: everything else moves rows, columns, merges, areas or sizes, and
 * the sheet has to be drawn again. The rectangle comes from the arguments
 * rather than the engine's report, because each operation reports something of
 * its own shape and a multi-operation command would keep only the last. */
var CELL_OPS = { setFormat: 1, setParameter: 1 };

function dirtyOf(op, args) {
    if (!CELL_OPS[op] || !args) return { structural: true };
    var r0 = Number(args.row) - 1;
    var c0 = Number(args.column) - 1;
    if (!(r0 >= 0) || !(c0 >= 0)) return { structural: true };
    var r1 = args.toRow != null ? Number(args.toRow) - 1 : r0;
    var c1 = args.toColumn != null ? Number(args.toColumn) - 1 : c0;
    if (!(r1 >= r0) || !(c1 >= c0)) return { structural: true };
    /* A width weight is a column property: the sheet re-shares its width. */
    if (args.widthWeightFactor != null) return { structural: true };
    return { r0: r0, c0: c0, r1: r1, c1: c1 };
}

/* The area covered by every operation of one command. A structural operation
 * anywhere makes the whole command structural. */
function unionDirty(a, b) {
    if (!a) return b;
    if (!b) return a;
    if (a.structural || b.structural) return { structural: true };
    return {
        r0: Math.min(a.r0, b.r0), c0: Math.min(a.c0, b.c0),
        r1: Math.max(a.r1, b.r1), c1: Math.max(a.c1, b.c1)
    };
}

/* ---------- editing session ---------- */

/* Wires a rendered preview to the markup engine. The host owns the document
 * text and decides how an edit reaches its editor; this layer owns the
 * selection, the keyboard and the cell editor, and every change it makes goes
 * through TemplateMarkup rather than through the XML directly.
 *
 * options:
 *   model     the parsed template the container currently shows
 *   xml()     the document text as it stands now
 *   apply(edits, next, result, dirty)  the change as text ranges, the whole
 *             new document, whatever the engine reported, and which cells it
 *             can have touched — a rectangle, or { structural: true } when the
 *             sheet has to be drawn again
 *   onError(message)    an engine refusal, already worded for the user
 *   onSelect(selection, rect)
 *   onProperties()  «Свойства» — the host shows its property panel
 *   readOnly  keep the selection but refuse every change */
function attach(container, options) {
    options = options || {};
    var markup = root.TemplateMarkup;
    var preview = root.TemplatePreview;
    if (!container || !container.addEventListener) return null;

    var session = { selection: null, editing: null, dragging: false, sizing: null };

    function sizeOf() {
        var model = options.model;
        if (!model) return null;
        return {
            height: model.height || 0,
            width: preview && preview.sheetWidth ? preview.sheetWidth(model) : 0
        };
    }

    /* ---- painting ---- */

    function findCell(row, col) {
        var cells = container.querySelectorAll('td');
        for (var i = 0; i < cells.length; i++) {
            if (+cells[i].getAttribute('data-row') === row && +cells[i].getAttribute('data-col') === col) {
                return cells[i];
            }
        }
        return null;
    }

    function clear(selector, cls) {
        var marked = container.querySelectorAll(selector);
        for (var i = 0; i < marked.length; i++) marked[i].classList.remove(cls);
    }

    function paint() {
        clear('.tp-range', 'tp-range');
        clear('.tp-head-range', 'tp-head-range');
        var rect = rectOf(session.selection, sizeOf());
        if (!rect) return;
        var i;
        /* Plain tag selectors with the filtering done here: attribute-presence
         * and descendant selectors are more than the hosts' lightest DOM
         * implementations promise. */
        var cells = container.querySelectorAll('td');
        for (i = 0; i < cells.length; i++) {
            var td = cells[i];
            if (td.getAttribute('data-row') == null) continue;
            var r = +td.getAttribute('data-row');
            var c = +td.getAttribute('data-col');
            /* A merged cell counts as selected when the rectangle reaches any
             * part of it, so the highlight matches what the eye sees. */
            var spanRows = td.rowSpan > 1 ? td.rowSpan : 1;
            var spanCols = td.colSpan > 1 ? td.colSpan : 1;
            if (r <= rect.r1 && r + spanRows - 1 >= rect.r0
                && c <= rect.c1 && c + spanCols - 1 >= rect.c0) td.classList.add('tp-range');
        }
        var nums = container.querySelectorAll('.tp-row-num');
        for (i = 0; i < nums.length; i++) {
            var rn = +nums[i].getAttribute('data-row');
            if (rn >= rect.r0 && rn <= rect.r1) nums[i].classList.add('tp-head-range');
        }
        var heads = container.querySelectorAll('th');
        for (i = 0; i < heads.length; i++) {
            if (heads[i].getAttribute('data-col') == null) continue;
            var cn = +heads[i].getAttribute('data-col');
            if (cn >= rect.c0 && cn <= rect.c1) heads[i].classList.add('tp-head-range');
        }
    }

    function select(next) {
        session.selection = next;
        /* Widths belong to the selected row's column set. Rebuild the ruler
         * before painting the header selection, otherwise the rebuild would
         * immediately erase `tp-head-range`. Column-only selections keep the
         * row/set that was active before the header was clicked. */
        var preview = root.TemplatePreview;
        if (preview && preview.activateColumnRow && next
            && next.mode !== 'columns' && next.mode !== 'all') {
            preview.activateColumnRow(container, next.focus.row);
        }
        paint();
        if (options.onSelect) options.onSelect(next, rectOf(next, sizeOf()));
    }

    /* ---- the engine ---- */

    function fail(message) {
        if (options.onError) options.onError(message);
    }

    /* Runs one TemplateMarkup operation over the current document and hands
     * the result to the host. True when the document changed. */
    function run(op, args) {
        return runAll([{ op: op, args: args }]);
    }

    /* Several operations over one document as a single change, so a command
     * built out of them — a frame around the selection is four edges — is one
     * undo step and one redraw. Each call runs against the text the previous
     * one produced; the host sees only the difference between first and last.
     * A refusal anywhere leaves the document untouched. */
    function runAll(ops) {
        if (options.readOnly || !ops || !ops.length) return false;
        var before = options.xml ? options.xml() : '';
        var text = before;
        var result = null;
        var dirty = null;
        for (var i = 0; i < ops.length; i++) {
            var op = ops[i].op;
            dirty = unionDirty(dirty, dirtyOf(op, ops[i].args));
            if (!markup || typeof markup[op] !== 'function') {
                fail('Операция «' + op + '» недоступна.');
                return false;
            }
            var out;
            try {
                out = markup[op](text, ops[i].args);
            } catch (err) {
                fail((err && err.message) || String(err));
                return false;
            }
            if (!out) continue;
            text = out.xml;
            result = out.result;
        }
        var next = sameByteOrderMark(before, text);
        if (next === before) return false;
        if (options.apply) options.apply(root.DocEdits.textEdits(before, next), next, result, dirty);
        return true;
    }

    /* Range arguments for the current selection, or null with a complaint. */
    function range() {
        var args = rangeArgs(session.selection, sizeOf());
        if (!args) fail('Сначала выделите ячейки.');
        return args;
    }

    /* The width or the height the selection would get, shown at once on the
     * rendered grid without touching the document. Dragging a slider or
     * spinning the wheel has to move the sheet while the user is still
     * choosing, and every intermediate value must not become an undo step of
     * its own — nor tear down the control being dragged, which is what a
     * redraw of the sheet does. The real render follows on commit.
     *
     * `kind` is 'width' (in 1C width units) or 'height' (in points), and
     * `over` a rectangle to size instead of the current selection. */
    function previewSize(kind, value, over) {
        var rect = over || rectOf(session.selection, sizeOf());
        var preview = root.TemplatePreview;
        if (!rect || !preview || !(value > 0)) return;
        var i;
        if (kind === 'width') {
            var wpx = Math.max(1, preview.widthToPx(value));
            var want = (over && over.columnsId != null) ? over.columnsId : null;
            var tables = container.querySelectorAll('table');
            for (i = 0; i < tables.length; i++) {
                var id = tables[i].getAttribute ? tables[i].getAttribute('data-columns-id') : null;
                if (want != null && id != null && id !== want) continue;
                sizeCols(tables[i], rect, wpx);
            }
            /* The cells too: a host that does not lay the grid out from its
             * <col> elements still has to show the width being chosen. */
            var heads = container.querySelectorAll('th');
            for (i = 0; i < heads.length; i++) sizeColumn(heads[i], rect, wpx);
            var wide = container.querySelectorAll('td');
            for (i = 0; i < wide.length; i++) sizeColumn(wide[i], rect, wpx);
            return;
        }
        /* The format keeps quarter-points, which is what the grid measures in. */
        var hpx = Math.max(1, preview.heightToPx(value * 4));
        var rows = container.querySelectorAll('tr');
        for (i = 0; i < rows.length; i++) {
            var n = rows[i].getAttribute('data-row');
            if (n == null || +n < rect.r0 || +n > rect.r1) continue;
            rows[i].style.height = hpx + 'px';
            var inner = rows[i].querySelectorAll('div');
            for (var k = 0; k < inner.length; k++) {
                if (!inner[k].classList || !inner[k].classList.contains('tp-cell')) continue;
                inner[k].style.height = hpx + 'px';
                inner[k].style.maxHeight = hpx + 'px';
            }
        }
    }

    /* One cell or header set to the width being tried, unless it spans more
     * than its own column — a merged cell has no width of its own. */
    /* A grid is laid out with `table-layout: fixed`, so its column widths come
     * from the <col> elements: a width put on the cells alone changes nothing,
     * which is why a column drag used to do nothing until it was let go. The
     * table's own width is the sum of its columns and has to follow. */
    function sizeCols(table, rect, px) {
        var cols = table.querySelectorAll ? table.querySelectorAll('col') : [];
        if (!cols.length) return;
        var total = 0;
        for (var i = 0; i < cols.length; i++) {
            if (i >= rect.c0 && i <= rect.c1) {
                var s = px + 'px';
                cols[i].style.width = s;
                cols[i].style.minWidth = s;
                cols[i].style.maxWidth = s;
                if (cols[i].setAttribute) cols[i].setAttribute('width', String(Math.round(px)));
            }
            total += parseFloat(cols[i].style.width) || 0;
        }
        if (total > 0) table.style.width = total + 'px';
    }

    /* The column set a node is drawn from: the tables carry it, and only the
     * tables of that set move while a width is being dragged. */
    function columnsIdOf(node) {
        var table = tableOf(node);
        var id = table && table.getAttribute ? table.getAttribute('data-columns-id') : null;
        return id == null ? null : id;
    }

    function sizeColumn(node, rect, px) {
        var n = node.getAttribute('data-col');
        if (n == null || +n < rect.c0 || +n > rect.c1) return;
        if (node.colSpan > 1) return;
        var value = px + 'px';
        node.style.width = value;
        node.style.minWidth = value;
        node.style.maxWidth = value;
    }

    /* A named area picked in the rail or in the outline becomes the current
     * selection, the way it does in the Designer: the whole rows or columns it
     * covers. Without this the sheet showed two selections at once — the area
     * and the cell clicked before it. Returns the selection, or null when the
     * model has no such area. */
    function selectArea(name) {
        var size = sizeOf();
        var items = options.model && options.model.namedItems ? options.model.namedItems : [];
        if (!size || !name) return null;
        for (var i = 0; i < items.length; i++) {
            var it = items[i];
            if (it.kind !== 'cells' || it.name !== name) continue;
            var c0 = it.beginColumn == null || it.beginColumn < 0 ? 0 : it.beginColumn;
            var c1 = it.endColumn == null || it.endColumn < 0 ? size.width - 1 : it.endColumn;
            if (it.type === 'Columns') {
                select(extendTo(columns(c0), 0, c1));
            } else if (it.beginColumn >= 0 && it.endColumn >= 0) {
                /* A rectangle area names its columns as well as its rows. */
                select(extendTo(cells(it.beginRow, c0), it.endRow, c1));
            } else {
                select(extendTo(rows(it.beginRow), it.endRow, 0));
            }
            return session.selection;
        }
        return null;
    }

    /* ---- resizing by the ruler ---- */

    /* How close to the edge of a header the pointer has to be for the drag to
     * mean «resize» rather than «select». */
    var EDGE = 4;

    /* One 1C width unit and one point, in pixels — the scale the grid draws
     * with, so a drag of N pixels turns back into the size the document
     * keeps. */
    function unitPx(kind) {
        var preview = root.TemplatePreview;
        if (!preview) return 0;
        return kind === 'width' ? preview.widthToPx(1) : preview.heightToPx(4);
    }

    /* The column or row whose edge is under the pointer, or null. A column is
     * taken by the right edge of its header and a row by the bottom edge of
     * its number, as in the Designer. */
    function edgeAt(ev) {
        var node = ev.target;
        while (node && node !== container) {
            if (node.classList && node.getBoundingClientRect) {
                var box = node.getBoundingClientRect();
                if (node.tagName === 'TH' && node.getAttribute('data-col') != null) {
                    if (Math.abs(ev.clientX - box.right) <= EDGE) {
                        return { kind: 'width', index: +node.getAttribute('data-col'), size: box.width };
                    }
                    return null;
                }
                if (node.classList.contains('tp-row-num')) {
                    if (Math.abs(ev.clientY - box.bottom) <= EDGE) {
                        return { kind: 'height', index: +node.getAttribute('data-row'), size: box.height };
                    }
                    return null;
                }
            }
            node = node.parentNode;
        }
        return null;
    }

    /* The columns or rows a drag of this edge changes: the whole selection
     * when the edge belongs to it, and that one line otherwise. */
    function edgeRange(edge) {
        var rect = rectOf(session.selection, sizeOf());
        if (edge.kind === 'width') {
            if (rect && edge.index >= rect.c0 && edge.index <= rect.c1) {
                return { r0: 0, r1: 0, c0: rect.c0, c1: rect.c1 };
            }
            return { r0: 0, r1: 0, c0: edge.index, c1: edge.index };
        }
        if (rect && edge.index >= rect.r0 && edge.index <= rect.r1) {
            return { r0: rect.r0, r1: rect.r1, c0: 0, c1: 0 };
        }
        return { r0: edge.index, r1: edge.index, c0: 0, c1: 0 };
    }

    /* What the selected row or column measures on screen right now, in the
     * units the size fields take: points for a height, 1C units for a width.
     * A row with no height of its own is as tall as its content, and a field
     * showing that emptiness has to start stepping from the height the user
     * sees — otherwise the first press of the arrow takes a row of eleven
     * points down to one. */
    function currentSize(kind) {
        var rect = rectOf(session.selection, sizeOf());
        var per = unitPx(kind);
        if (!rect || !(per > 0)) return 0;
        var row = container.querySelector('tr[data-row="' + rect.r0 + '"]');
        if (kind !== 'width') {
            if (!row || !row.getBoundingClientRect) return 0;
            var h = row.getBoundingClientRect().height;
            return h > 0 ? Math.max(1, Math.round(h / per)) : 0;
        }
        /* The width is read from the selection's own grid: a sheet has several
         * column sets, the ruler at the top may be showing another one, and a
         * merged cell is wider than the column under it. */
        var table = tableOf(row);
        var cols = table && table.querySelectorAll ? table.querySelectorAll('col') : null;
        var col = cols && cols[rect.c0];
        var px = col ? (parseFloat(col.style.width) || 0) : 0;
        if (!px) {
            var head = container.querySelector('th[data-col="' + rect.c0 + '"]');
            px = head && head.getBoundingClientRect ? head.getBoundingClientRect().width : 0;
        }
        return px > 0 ? Math.max(1, Math.round(px / per)) : 0;
    }

    function tableOf(node) {
        while (node && node !== container) {
            if (node.tagName === 'TABLE') return node;
            node = node.parentNode;
        }
        return null;
    }

    /* The column set the given row is drawn from, for a width that has to be
     * written to the set the user is looking at rather than to the default. */
    function columnsIdAt(rowIndex) {
        var table = tableOf(container.querySelector('tr[data-row="' + rowIndex + '"]'));
        var id = table && table.getAttribute ? table.getAttribute('data-columns-id') : null;
        return id || undefined;
    }

    function startResize(ev, edge) {
        var per = unitPx(edge.kind);
        if (!(per > 0)) return false;
        var range = edgeRange(edge);
        /* The ruler shows whichever column set sits at the top of the view, so
         * the drag — and the width it writes — belong to that set, not to the
         * sheet's default one. */
        if (edge.kind === 'width') range.columnsId = columnsIdOf(ev.target);
        session.sizing = {
            kind: edge.kind,
            range: range,
            per: per,
            from: edge.kind === 'width' ? ev.clientX : ev.clientY,
            px: edge.size,
            value: Math.max(1, Math.round(edge.size / per))
        };
        /* The pointer leaves the header as soon as the drag starts, and the
         * cursor of whatever it passes over is not this session's to set one by
         * one: the sheet wears the drag cursor until the button is let go. */
        if (container.classList) {
            container.classList.add(edge.kind === 'width' ? 'tp-sizing-col' : 'tp-sizing-row');
        }
        if (ev.preventDefault) ev.preventDefault();
        return true;
    }

    function dragResize(ev) {
        var sizing = session.sizing;
        var moved = (sizing.kind === 'width' ? ev.clientX : ev.clientY) - sizing.from;
        sizing.value = Math.max(1, Math.round((sizing.px + moved) / sizing.per));
        previewSize(sizing.kind, sizing.value, sizing.range);
    }

    function endResize() {
        var sizing = session.sizing;
        session.sizing = null;
        if (container.classList) {
            container.classList.remove('tp-sizing-col');
            container.classList.remove('tp-sizing-row');
        }
        if (!sizing || !(sizing.value > 0)) return;
        var range = sizing.range;
        if (sizing.kind === 'width') {
            run('setSize', { column: range.c0 + 1, toColumn: range.c1 + 1, width: sizing.value,
                columnsId: range.columnsId || undefined });
        } else {
            run('setSize', { row: range.r0 + 1, toRow: range.r1 + 1, height: sizing.value });
        }
    }

    /* ---- mouse ---- */

    function cellAddress(node) {
        while (node && node !== container) {
            if (node.tagName === 'TD' && node.getAttribute && node.getAttribute('data-row') != null) {
                return { row: +node.getAttribute('data-row'), col: +node.getAttribute('data-col'), td: node };
            }
            node = node.parentNode;
        }
        return null;
    }

    function headAddress(node) {
        while (node && node !== container) {
            if (node.classList) {
                if (node.classList.contains('tp-row-num')) return { kind: 'row', index: +node.getAttribute('data-row') };
                if (node.tagName === 'TH' && node.getAttribute('data-col') != null) {
                    return { kind: 'column', index: +node.getAttribute('data-col') };
                }
                if (node.classList.contains('tp-corner')) return { kind: 'all', index: 0 };
            }
            node = node.parentNode;
        }
        return null;
    }

    /* The name of the area whose label is under the pointer: the rails beside
     * the row numbers and above the column heads draw one label per area. */
    function areaAt(node) {
        while (node && node !== container) {
            if (node.classList && (node.classList.contains('tp-area-label')
                || node.classList.contains('tp-col-area-label'))) {
                return node.getAttribute('data-id') || '';
            }
            node = node.parentNode;
        }
        return null;
    }

    function onMouseDown(ev) {
        /* Only the left button drags a range: a right or middle click must not
         * arm the drag, or the next plain mouse move would repaint the
         * selection under the pointer. */
        if (ev.button != null && ev.button !== 0) return;
        /* A press inside the open editor belongs to the editor: it moves the
         * caret or starts a text selection. Committing here would close the
         * cell on the very click meant to put the caret in it. */
        if (session.editing && session.editing.input
            && (session.editing.input === ev.target
                || (session.editing.input.contains && session.editing.input.contains(ev.target)))) {
            return;
        }
        commitEdit();
        /* Right on the edge of a header the drag resizes instead of selecting,
         * and the selection is left where it is. */
        var edge = options.readOnly ? null : edgeAt(ev);
        if (edge && startResize(ev, edge)) return;
        var head = headAddress(ev.target);
        if (head) {
            if (head.kind === 'all') select(sheet());
            else if (ev.shiftKey && session.selection
                && session.selection.mode === (head.kind === 'row' ? 'rows' : 'columns')) {
                select(extendTo(session.selection, head.kind === 'row' ? head.index : 0,
                    head.kind === 'column' ? head.index : 0));
            } else select(head.kind === 'row' ? rows(head.index) : columns(head.index));
            session.dragging = head.kind !== 'all';
            return;
        }
        var hit = cellAddress(ev.target);
        if (!hit) return;
        select(ev.shiftKey && session.selection && session.selection.mode === 'cells'
            ? extendTo(session.selection, hit.row, hit.col)
            : cells(hit.row, hit.col));
        session.dragging = true;
    }

    function onMouseMove(ev) {
        if (session.sizing) {
            if (ev.buttons != null && !(ev.buttons & 1)) { endResize(); return; }
            dragResize(ev);
            return;
        }
        /* The pointer says what a press would do here. */
        if (!session.dragging && ev.target && ev.target.style && !options.readOnly) {
            var over = edgeAt(ev);
            ev.target.style.cursor = over ? (over.kind === 'width' ? 'col-resize' : 'row-resize') : '';
        }
        if (!session.dragging || !session.selection) return;
        /* The button may have been released outside the grid — over a
         * scrollbar, a panel or the window — so no mouseup reached us. Without
         * this the selection keeps following the bare pointer and jumps from
         * cell to cell. */
        if (ev.buttons != null && !(ev.buttons & 1)) { session.dragging = false; return; }
        var mode = session.selection.mode;
        if (mode === 'rows' || mode === 'columns') {
            var head = headAddress(ev.target);
            var wanted = mode === 'rows' ? 'row' : 'column';
            if (head && head.kind === wanted) {
                select(extendTo(session.selection, mode === 'rows' ? head.index : 0,
                    mode === 'columns' ? head.index : 0));
            }
            return;
        }
        var hit = cellAddress(ev.target);
        if (hit) select(extendTo(session.selection, hit.row, hit.col));
    }

    function onMouseUp() {
        session.dragging = false;
        if (session.sizing) endResize();
    }

    /* A resize drag may wander off the sheet; nothing else out there concerns
     * this session, so only that case is followed on the document. */
    function onDocMouseMove(ev) {
        if (session.sizing) onMouseMove(ev);
    }

    /* A release outside the grid ends the drag too. */
    var doc = container.ownerDocument || (typeof document !== 'undefined' ? document : null);

    /* ---- the header menu ---- */

    /* Rows and columns are added, removed and hidden from the menu of their
     * own header, where the Designer keeps these commands and where the hand
     * already is when the user has just picked a row by its number. Every
     * command works on the whole selection. */
    /* ---- the clipboard and the commands of the cell menu ---- */

    /* What «Копировать» keeps: the cells of the range with what they hold and
     * how they look. The buffer outlives the session on purpose — the sheet is
     * rebuilt after every edit and the session with it — so a copy survives the
     * next change, as it does in 1C. */

    function infoAt(row, col) {
        return preview && preview.cellInfo ? preview.cellInfo(options.model, row, col) : null;
    }

    function borderSpec(line) {
        return line ? { style: line.style || 'Solid', width: line.width || 1 } : null;
    }

    function fontSpec(font) {
        if (!font) return null;
        return {
            face: font.faceName, size: font.height,
            bold: !!font.bold, italic: !!font.italic,
            underline: !!font.underline, strikeout: !!font.strikeout
        };
    }

    function copiedCell(row, col) {
        var info = infoAt(row, col);
        if (!info) return null;
        var fmt = info.format || {};
        var out = {
            fillType: info.fillType || 'Text',
            text: (info.cell && info.cell.text) || '',
            parameter: info.parameter || '',
            detail: info.detail || '',
            shown: info.text || '',
            font: fontSpec(info.font),
            format: {}
        };
        for (var i = 0; i < COPIED_FORMAT.length; i++) {
            var key = COPIED_FORMAT[i];
            out.format[key] = fmt[key] == null || fmt[key] === '' ? null : fmt[key];
        }
        out.format.leftBorder = borderSpec(info.borders && info.borders.left);
        out.format.topBorder = borderSpec(info.borders && info.borders.top);
        out.format.rightBorder = borderSpec(info.borders && info.borders.right);
        out.format.bottomBorder = borderSpec(info.borders && info.borders.bottom);
        return out;
    }

    /* The text a copy leaves in the system clipboard: the cells as they are
     * shown, tab between columns and newline between rows — what a spreadsheet
     * outside the viewer understands. */
    function writeSystemClipboard(text) {
        var nav = root.navigator;
        if (!nav || !nav.clipboard || !nav.clipboard.writeText) return;
        try {
            var done = nav.clipboard.writeText(text);
            if (done && done['catch']) done['catch'](function () {});
        } catch (err) { /* a host without clipboard rights keeps the buffer only */ }
    }

    function copySelection(rect) {
        if (!rect) return false;
        var grid = [];
        var lines = [];
        for (var r = rect.r0; r <= rect.r1; r++) {
            var line = [];
            var texts = [];
            for (var c = rect.c0; c <= rect.c1; c++) {
                var cell = copiedCell(r, c);
                line.push(cell);
                texts.push(cell ? String(cell.shown || '') : '');
            }
            grid.push(line);
            lines.push(texts.join(TAB));
        }
        clipboard = { rows: grid.length, cols: rect.c1 - rect.c0 + 1, cells: grid, text: lines.join(EOL) };
        writeSystemClipboard(clipboard.text);
        return true;
    }

    /* Every pasted or cleared cell is an operation of its own — the engine
     * writes content one cell at a time — and each one parses the whole
     * document. A few hundred cells are already slow enough to be felt, so the
     * commands stop instead of freezing the viewer. */
    function tooManyCells(count, what) {
        if (count <= CELL_OP_LIMIT) return false;
        fail(what + ': выделено ' + count + ' ячеек, за раз можно не больше ' + CELL_OP_LIMIT + '.');
        return true;
    }

    function pasteOps(at, buffer) {
        var ops = [];
        for (var r = 0; r < buffer.cells.length; r++) {
            for (var c = 0; c < buffer.cells[r].length; c++) {
                var cell = buffer.cells[r][c];
                if (!cell) continue;
                var row = at.r0 + r + 1;
                var col = at.c0 + c + 1;
                var content = { row: row, column: col, detail: cell.detail };
                if (cell.fillType === 'Parameter') content.name = cell.parameter;
                else if (cell.fillType === 'Template') content.template = cell.text;
                else content.text = cell.text;
                ops.push({ op: 'setParameter', args: content });
                var look = { row: row, column: col, font: cell.font };
                for (var key in cell.format) {
                    if (Object.prototype.hasOwnProperty.call(cell.format, key)) look[key] = cell.format[key];
                }
                ops.push({ op: 'setFormat', args: look });
            }
        }
        return ops;
    }

    function pasteSelection(rect) {
        if (!rect) return false;
        if (!clipboard) { fail('Буфер пуст: сначала скопируйте ячейки.'); return false; }
        if (tooManyCells(clipboard.rows * clipboard.cols, 'Вставка')) return false;
        return runAll(pasteOps(rect, clipboard));
    }

    function cutSelection(rect) {
        if (!copySelection(rect)) return false;
        return clearContent(rect);
    }

    /* Only the cells that hold something are cleared: an empty cell has
     * nothing to write, and writing it anyway would put a format index into
     * every cell of the range. */
    function clearContentOps(rect) {
        var ops = [];
        for (var r = rect.r0; r <= rect.r1; r++) {
            for (var c = rect.c0; c <= rect.c1; c++) {
                var info = infoAt(r, c);
                var cell = info && info.cell;
                if (!cell) continue;
                if (!cell.text && !cell.parameter && !cell.detailParameter) continue;
                ops.push({ op: 'setParameter', args: { row: r + 1, column: c + 1, text: '', detail: '' } });
            }
        }
        return ops;
    }

    function clearContent(rect) {
        if (!rect) return false;
        var ops = clearContentOps(rect);
        if (!ops.length) return false;
        if (tooManyCells(ops.length, 'Очистка содержимого')) return false;
        return runAll(ops);
    }

    /* A range goes back to the sheet's own look in one operation: setFormat
     * takes the whole rectangle, and a property set to null is inherited
     * again. */
    function clearFormatArgs(rect, keys) {
        var args = { row: rect.r0 + 1, column: rect.c0 + 1 };
        if (rect.r1 !== rect.r0) args.toRow = rect.r1 + 1;
        if (rect.c1 !== rect.c0) args.toColumn = rect.c1 + 1;
        for (var i = 0; i < keys.length; i++) args[keys[i]] = null;
        return args;
    }

    function clearFormat(rect) {
        if (!rect) return false;
        return run('setFormat', clearFormatArgs(rect, CLEARED_FORMAT));
    }

    function clearBorders(rect) {
        if (!rect) return false;
        return run('setFormat', clearFormatArgs(rect, CLEARED_BORDERS));
    }

    function clearAll(rect) {
        if (!rect) return false;
        var ops = clearContentOps(rect);
        if (tooManyCells(ops.length, 'Очистка')) return false;
        ops.push({ op: 'setFormat', args: clearFormatArgs(rect, CLEARED_FORMAT) });
        return runAll(ops);
    }

    /* ---- merges ---- */

    /* Every merge the selection touches, not only the one under its corner. */
    function mergesIn(rect) {
        var model = options.model;
        var merges = (model && model.merges) || [];
        var found = [];
        if (!rect) return found;
        for (var i = 0; i < merges.length; i++) {
            var m = merges[i];
            if (m.columnsID) continue;
            if (rect.r0 <= m.r + (m.h || 0) && m.r <= rect.r1
                && rect.c0 <= m.c + (m.w || 0) && m.c <= rect.c1) found.push(m);
        }
        return found;
    }

    /* Half of a merged cell cannot be merged into something else, so the range
     * grows until it holds every merge it touches whole. */
    function spreadOverMerges(rect) {
        var box = { r0: rect.r0, r1: rect.r1, c0: rect.c0, c1: rect.c1 };
        for (var pass = 0; pass < 32; pass++) {
            var found = mergesIn(box);
            var grew = false;
            for (var i = 0; i < found.length; i++) {
                var m = found[i];
                if (m.r < box.r0) { box.r0 = m.r; grew = true; }
                if (m.c < box.c0) { box.c0 = m.c; grew = true; }
                if (m.r + (m.h || 0) > box.r1) { box.r1 = m.r + (m.h || 0); grew = true; }
                if (m.c + (m.w || 0) > box.c1) { box.c1 = m.c + (m.w || 0); grew = true; }
            }
            if (!grew) break;
        }
        return box;
    }

    function unmergeOp(m) {
        return { op: 'mergeCells', args: { row: m.r + 1, column: m.c + 1, unmerge: true } };
    }

    function mergeSelection(rect) {
        if (!rect) return false;
        var box = spreadOverMerges(rect);
        if (box.r1 === box.r0 && box.c1 === box.c0) {
            fail('Объединение из одной ячейки: выделите несколько.');
            return false;
        }
        var ops = mergesIn(box).map(unmergeOp);
        ops.push({ op: 'mergeCells', args: {
            row: box.r0 + 1, column: box.c0 + 1,
            rows: box.r1 - box.r0 + 1, columns: box.c1 - box.c0 + 1
        } });
        return runAll(ops);
    }

    function unmergeSelection(rect) {
        if (!rect) return false;
        var inside = mergesIn(rect);
        if (!inside.length) { fail('В выделении нет объединённых ячеек.'); return false; }
        return runAll(inside.map(unmergeOp));
    }

    /* ---- the rest of the cell menu ---- */

    /* «Удалить» takes away whole rows or columns, the way it does in 1C: a
     * range of cells has nothing to be deleted into. */
    function deleteSelection(rect) {
        if (!rect) return false;
        var mode = session.selection && session.selection.mode;
        if (mode === 'rows' || mode === 'all') {
            if (!insideDocument(rect)) { fail('Эти строки ещё не в макете: сначала вставьте их.'); return false; }
            return run('deleteRows', { at: rect.r0 + 1, count: rect.r1 - rect.r0 + 1 });
        }
        if (mode === 'columns') {
            return run('deleteColumns', { at: rect.c0 + 1, count: rect.c1 - rect.c0 + 1 });
        }
        fail('Выделите строки или колонки целиком — по их номерам или заголовкам.');
        return false;
    }

    function showProperties() {
        if (options.onProperties) options.onProperties();
    }

    /* The menu of a cell, in the Designer's own order and wording. What the
     * engine cannot do yet is shown greyed out rather than left out, so the
     * menu stays the one the user knows and says why an item is dead. */
    function cellMenu() {
        var rect = rectOf(session.selection, sizeOf());
        var mode = (session.selection && session.selection.mode) || 'cells';
        var merged = rect ? mergesIn(rect).length : 0;
        var wholeLines = mode === 'rows' || mode === 'columns' || mode === 'all';
        return [
            { label: 'Вырезать', hint: 'Ctrl+X', run: cutSelection },
            { label: 'Копировать', hint: 'Ctrl+C', run: copySelection },
            { label: 'Вставить', hint: 'Ctrl+V', run: pasteSelection, disabled: !clipboard,
                title: clipboard ? '' : 'Буфер пуст: сначала скопируйте ячейки.' },
            { sep: true },
            { label: 'Выделить все', hint: 'Ctrl+A', run: function () { select(sheet()); } },
            { sep: true },
            { label: 'Объединить', hint: 'Ctrl+M', run: mergeSelection },
            { label: 'Раздвинуть', run: unmergeSelection, disabled: !merged,
                title: merged ? '' : 'В выделении нет объединённых ячеек.' },
            { label: 'Разбить ячейку', disabled: true,
                title: 'Разбиение ячейки пока не поддерживается.' },
            { label: 'Форматированная строка', hint: 'Ctrl+Alt+F', disabled: true,
                title: 'Форматированная строка пока не поддерживается.' },
            { label: 'Удалить', run: deleteSelection, disabled: !wholeLines,
                title: wholeLines ? '' : 'Выделите строки или колонки целиком — по их номерам или заголовкам.' },
            { label: 'Очистить', items: [
                { label: 'Формат', run: clearFormat },
                { label: 'Рамки', run: clearBorders },
                { label: 'Содержимое', hint: 'Del', run: clearContent },
                { label: 'Все', run: clearAll }
            ] },
            { sep: true },
            { label: 'Вставить примечание', disabled: true,
                title: 'Примечания к ячейкам пока не поддерживаются.' },
            { label: 'Свойства', hint: 'Alt+Enter', run: showProperties }
        ];
    }

    var ROW_MENU = [
        ['Вставить строки', function (r) { insertRowsAt(r); }],
        ['Удалить строки', function (r) {
            if (!insideDocument(r)) { fail('Эти строки ещё не в макете: сначала вставьте их.'); return; }
            run('deleteRows', { at: r.r0 + 1, count: r.r1 - r.r0 + 1 });
        }],
        ['Скрыть строки', function (r) {
            if (!insideDocument(r)) { fail('Эти строки ещё не в макете: сначала вставьте их.'); return; }
            run('setSize', { row: r.r0 + 1, toRow: r.r1 + 1, hidden: true });
        }],
        ['Показать строки', function (r) {
            if (!insideDocument(r)) { fail('Эти строки ещё не в макете: сначала вставьте их.'); return; }
            run('setSize', { row: r.r0 + 1, toRow: r.r1 + 1, hidden: false });
        }],
        ['Назначить имя области', function () { nameArea(); }]
    ];
    var COLUMN_MENU = [
        ['Вставить колонки', function (r) { insertColumnsAt(r); }],
        ['Удалить колонки', function (r) {
            if (!insideColumns(r)) { fail('Эти колонки ещё не в макете: сначала вставьте их.'); return; }
            run('deleteColumns', { at: r.c0 + 1, count: r.c1 - r.c0 + 1 });
        }],
        ['Скрыть колонки', function (r) {
            if (!insideColumns(r)) { fail('Эти колонки ещё не в макете: сначала вставьте их.'); return; }
            run('setSize', { column: r.c0 + 1, toColumn: r.c1 + 1, hidden: true,
                columnsId: columnsIdAt(r.r0) });
        }],
        ['Показать колонки', function (r) {
            if (!insideColumns(r)) { fail('Эти колонки ещё не в макете: сначала вставьте их.'); return; }
            run('setSize', { column: r.c0 + 1, toColumn: r.c1 + 1, hidden: false,
                columnsId: columnsIdAt(r.r0) });
        }],
        ['Назначить имя области', function () { nameArea(); }]
    ];
    /* The menu of an area's own label, where the area is pointed at by name.
     * Removing an area takes away the name, never the rows, the columns or the
     * cells under it. */
    var AREA_MENU = [
        ['Удалить область', function (name) { run('setArea', { name: name, remove: true }); }]
    ];

    /* How many rows the document itself has: the sheet may show a few more
     * below it, so that something can be added under the last row the way 1C
     * and Excel let one. Those rows are not in the file until they are
     * written into. */
    function documentRows() {
        var model = options.model;
        var size = sizeOf();
        if (!size) return 0;
        return size.height - ((model && model.trailingRows) || 0);
    }

    /* True when every row of the range is already part of the document. */
    function insideDocument(rect) {
        return !!rect && rect.r1 < documentRows();
    }

    /* «Вставить строки» over the rows past the end appends instead: the rows
     * between the document and the selection are made real too, so the user
     * gets rows exactly where the selection is. */
    function insertRowsAt(rect) {
        var real = documentRows();
        var count = rect.r1 - rect.r0 + 1;
        if (rect.r0 < real) {
            run('insertRows', { at: rect.r0 + 1, count: count });
            return;
        }
        run('insertRows', { at: real + 1, count: (rect.r0 - real) + count });
    }

    /* Колонки справа от макета — такие же запасные, как строки снизу. Считать
     * их приходится по набору колонок той строки, о которой речь: у макета
     * наборов несколько, и у каждого своя последняя колонка. */
    function documentColumns(rowIndex) {
        var model = options.model;
        var size = sizeOf();
        if (!size) return 0;
        var sets = model && model.columnSetById;
        var set = sets && (sets[columnsIdAt(rowIndex) || ''] || sets['']);
        var width = set && set.size > 0 ? set.size : size.width;
        return width - ((model && model.trailingColumns) || 0);
    }

    function insideColumns(rect) {
        return !!rect && rect.c1 < documentColumns(rect.r0);
    }

    function insertColumnsAt(rect) {
        var id = columnsIdAt(rect.r0);
        var real = documentColumns(rect.r0);
        var count = rect.c1 - rect.c0 + 1;
        if (rect.c0 < real) {
            run('insertColumns', { at: rect.c0 + 1, count: count, columnsId: id });
            return;
        }
        run('insertColumns', { at: real + 1, count: (rect.c0 - real) + count, columnsId: id });
    }

    var headMenu = null;
    var headSub = null;

    function closeSubMenu() {
        if (!headSub) return;
        if (headSub.parentNode) headSub.parentNode.removeChild(headSub);
        headSub = null;
    }

    function closeHeadMenu() {
        closeSubMenu();
        if (!headMenu) return;
        if (headMenu.parentNode) headMenu.parentNode.removeChild(headMenu);
        headMenu = null;
        if (doc && doc.removeEventListener) {
            doc.removeEventListener('mousedown', onMenuOutside, true);
            doc.removeEventListener('keydown', onMenuKey, true);
        }
    }

    function onMenuOutside(ev) {
        var node = ev.target;
        while (node) {
            if (node === headMenu || node === headSub) return;
            node = node.parentNode;
        }
        closeHeadMenu();
    }

    function onMenuKey(ev) {
        if (ev.key === 'Escape') {
            if (ev.preventDefault) ev.preventDefault();
            closeHeadMenu();
        }
    }

    function openHeadMenu(kind, x, y) {
        return openMenu(kind === 'row' ? ROW_MENU : COLUMN_MENU, x, y, null);
    }

    /* `arg`, when given, is what the commands of this menu work on; without it
     * they work on the selected range, as the header commands do. */
    function openMenu(items, x, y, arg) {
        closeHeadMenu();
        if (!doc || !doc.createElement) return null;
        var menu = doc.createElement('div');
        menu.className = 'tp-head-menu';
        for (var i = 0; i < items.length; i++) {
            var node = menuItem(items[i], arg);
            if (node) menu.appendChild(node);
        }
        (doc.body || container).appendChild(menu);
        headMenu = menu;
        placeHeadMenu(menu, x, y);
        if (doc.addEventListener) {
            doc.addEventListener('mousedown', onMenuOutside, true);
            doc.addEventListener('keydown', onMenuKey, true);
        }
        return menu;
    }

    /* An entry is either the pair the header menus are written with
     * (['Название', fn]) or an object holding what 1C's own menu shows: a
     * shortcut on the right, a greyed-out command with the reason in its
     * tooltip, a separator, or a submenu. */
    function menuEntry(item) {
        if (!item) return null;
        if (Object.prototype.toString.call(item) === '[object Array]') {
            return { label: item[0], run: item[1] };
        }
        return item;
    }

    function menuItem(item, arg) {
        var entry = menuEntry(item);
        if (!entry) return null;
        if (entry.sep) {
            var line = doc.createElement('div');
            line.className = 'tp-head-menu-sep';
            return line;
        }
        var button = doc.createElement('button');
        button.type = 'button';
        button.className = 'tp-head-menu-item';
        var caption = doc.createElement('span');
        caption.className = 'tp-head-menu-text';
        caption.textContent = entry.label;
        button.appendChild(caption);
        if (entry.items || entry.hint) {
            var mark = doc.createElement('span');
            mark.className = 'tp-head-menu-hint';
            mark.textContent = entry.items ? '\u25B8' : entry.hint;
            button.appendChild(mark);
        }
        if (entry.title) button.title = entry.title;
        if (entry.disabled) button.disabled = true;
        button.addEventListener('mouseenter', function () {
            if (entry.items) openSubMenu(button, entry.items, arg);
            else closeSubMenu();
        });
        button.addEventListener('click', function () {
            if (button.disabled) return;
            if (entry.items) { openSubMenu(button, entry.items, arg); return; }
            closeHeadMenu();
            if (arg != null) { entry.run(arg); return; }
            var rect = rectOf(session.selection, sizeOf());
            if (rect) entry.run(rect);
        });
        return button;
    }

    /* A submenu opens beside its own entry and is closed with the menu it
     * belongs to, or as soon as the pointer moves onto another entry. */
    function openSubMenu(button, items, arg) {
        if (headSub && headSub.owner === button) return headSub;
        closeSubMenu();
        var menu = doc.createElement('div');
        menu.className = 'tp-head-menu tp-head-submenu';
        menu.owner = button;
        for (var i = 0; i < items.length; i++) {
            var node = menuItem(items[i], arg);
            if (node) menu.appendChild(node);
        }
        (doc.body || container).appendChild(menu);
        headSub = menu;
        var box = button.getBoundingClientRect ? button.getBoundingClientRect() : null;
        placeHeadMenu(menu, box ? box.right - 2 : 0, box ? box.top - 2 : 0);
        return menu;
    }

    /* At the pointer, and inside the window: a menu opened near the bottom or
     * the right edge is moved back rather than cut off. */
    function placeHeadMenu(menu, x, y) {
        menu.style.position = 'fixed';
        menu.style.left = x + 'px';
        menu.style.top = y + 'px';
        if (!menu.getBoundingClientRect || !doc.documentElement) return;
        var box = menu.getBoundingClientRect();
        var vw = doc.documentElement.clientWidth || 0;
        var vh = doc.documentElement.clientHeight || 0;
        if (vw && box.right > vw - 4) menu.style.left = Math.max(4, vw - box.width - 4) + 'px';
        if (vh && box.bottom > vh - 4) menu.style.top = Math.max(4, vh - box.height - 4) + 'px';
    }

    function onContextMenu(ev) {
        closeHeadMenu();
        if (options.readOnly) return;
        /* A right click on the name of an area is about that area, whatever is
         * selected on the sheet — that is where the user points at it. */
        var area = areaAt(ev.target);
        if (area) {
            if (ev.preventDefault) ev.preventDefault();
            if (ev.stopPropagation) ev.stopPropagation();
            openMenu(AREA_MENU, ev.clientX || 0, ev.clientY || 0, area);
            return;
        }
        var hit = cellAddress(ev.target);
        if (hit) {
            if (ev.preventDefault) ev.preventDefault();
            if (ev.stopPropagation) ev.stopPropagation();
            /* A right click outside the selection moves it first, the way 1C
             * and Excel do: the menu always acts on what is highlighted. */
            var over = rectOf(session.selection, sizeOf());
            var covered = !!over && hit.row >= over.r0 && hit.row <= over.r1
                && hit.col >= over.c0 && hit.col <= over.c1;
            if (!covered) select(cells(hit.row, hit.col));
            openMenu(cellMenu(), ev.clientX || 0, ev.clientY || 0, null);
            return;
        }
        var head = headAddress(ev.target);
        if (!head || head.kind === 'all') return;
        if (ev.preventDefault) ev.preventDefault();
        /* The sheet answers for this click, so the host's own page menu stays
         * out of the way. */
        if (ev.stopPropagation) ev.stopPropagation();
        var rect = rectOf(session.selection, sizeOf());
        var mode = session.selection && session.selection.mode;
        var inside = !!rect && (head.kind === 'row'
            ? mode === 'rows' && head.index >= rect.r0 && head.index <= rect.r1
            : mode === 'columns' && head.index >= rect.c0 && head.index <= rect.c1);
        if (!inside) select(head.kind === 'row' ? rows(head.index) : columns(head.index));
        openHeadMenu(head.kind, ev.clientX || 0, ev.clientY || 0);
    }

    function onDoubleClick(ev) {
        /* Inside the open editor a double click selects a word; it must not
         * restart the edit. */
        if (session.editing && session.editing.input
            && (session.editing.input === ev.target
                || (session.editing.input.contains && session.editing.input.contains(ev.target)))) {
            return;
        }
        var hit = cellAddress(ev.target);
        if (hit) startEdit(hit.row, hit.col, hit.td);
    }

    /* ---- named areas ---- */

    /* A name for what is selected: rows selected by their numbers become a
     * Rows area, columns a Columns area and a range of cells a Rectangle —
     * the three kinds 1C has. The name is asked for in a small box over the
     * sheet, because the host has no dialogs of its own. */
    function nameArea(x, y) {
        if (options.readOnly) return;
        var size = sizeOf();
        var rect = rectOf(session.selection, size);
        if (!rect) { fail('Сначала выделите строки, колонки или ячейки.'); return; }
        var mode = (session.selection && session.selection.mode) || 'cells';
        /* The whole sheet is named by its rows: that is what «все строки»
         * means to the engine, and a Rectangle over every column is not what
         * the user picked. */
        var rowsOnly = mode === 'rows' || mode === 'all';
        var columnsOnly = mode === 'columns';
        var what = rowsOnly ? 'строк' : columnsOnly ? 'колонок' : 'ячеек';
        askName('Имя области ' + what, function (name) {
            var args = { name: name };
            if (!columnsOnly) { args.beginRow = rect.r0 + 1; args.endRow = rect.r1 + 1; }
            if (!rowsOnly) { args.beginColumn = rect.c0 + 1; args.endColumn = rect.c1 + 1; }
            run('setArea', args);
        }, x, y);
    }

    var namePop = null;

    function closeNamePop() {
        if (!namePop) return;
        if (namePop.parentNode) namePop.parentNode.removeChild(namePop);
        namePop = null;
        if (doc && doc.removeEventListener) doc.removeEventListener('mousedown', onNameOutside, true);
    }

    function onNameOutside(ev) {
        var node = ev.target;
        while (node) {
            if (node === namePop) return;
            node = node.parentNode;
        }
        closeNamePop();
    }

    /* One text field over the sheet: Enter or ОК answers, Escape and a click
     * outside drop it. An empty name answers nothing, so the caller never has
     * to check for one. */
    function askName(title, onDone, x, y) {
        closeNamePop();
        if (!doc || !doc.createElement) return;
        var pop = doc.createElement('div');
        pop.className = 'tp-name-pop';
        var caption = doc.createElement('div');
        caption.className = 'tp-name-title';
        caption.textContent = title;
        pop.appendChild(caption);
        var input = doc.createElement('input');
        input.type = 'text';
        input.className = 'tp-name-input';
        pop.appendChild(input);
        var row = doc.createElement('div');
        row.className = 'tp-name-actions';
        var ok = doc.createElement('button');
        ok.type = 'button';
        ok.className = 'tp-tool';
        ok.textContent = 'ОК';
        var cancel = doc.createElement('button');
        cancel.type = 'button';
        cancel.className = 'tp-tool';
        cancel.textContent = 'Отмена';
        row.appendChild(ok);
        row.appendChild(cancel);
        pop.appendChild(row);

        function answer() {
            var name = String(input.value || '').trim();
            closeNamePop();
            focusGrid();
            if (name) onDone(name);
        }

        ok.addEventListener('click', answer);
        cancel.addEventListener('click', function () { closeNamePop(); focusGrid(); });
        input.addEventListener('keydown', function (ev) {
            ev.stopPropagation();
            if (ev.key === 'Enter') { ev.preventDefault(); answer(); }
            else if (ev.key === 'Escape') { ev.preventDefault(); closeNamePop(); focusGrid(); }
        });

        (doc.body || container).appendChild(pop);
        namePop = pop;
        placeHeadMenu(pop, x != null ? x : 60, y != null ? y : 60);
        if (doc.addEventListener) doc.addEventListener('mousedown', onNameOutside, true);
        if (input.focus) input.focus();
    }

    /* ---- typing in a cell ---- */

    function startEdit(row, col, td) {
        if (options.readOnly) return;
        commitEdit();
        td = td || findCell(row, col);
        if (!td) return;
        var info = preview && preview.cellInfo ? preview.cellInfo(options.model, row, col) : null;
        var doc = container.ownerDocument || (typeof document !== 'undefined' ? document : null);
        if (!doc) return;
        /* A textarea, not a single-line input: a cell holds wrapped text, and
         * on one line a long text is unreadable and barely editable. */
        var input = doc.createElement('textarea');
        input.className = 'tp-cell-input';
        input.rows = 1;
        input.wrap = 'soft';
        /* A parameter cell is edited by its name and a template by its text
         * with the slots still in it — what the cell really holds, not the
         * angle brackets the grid draws around a parameter. */
        input.value = info ? (info.fillType === 'Parameter' ? info.parameter : ((info.cell && info.cell.text) || '')) : '';
        td.appendChild(input);
        session.editing = { row: row, col: col, input: input, fill: info ? info.fillType : 'Text' };
        input.addEventListener('keydown', function (ev) {
            ev.stopPropagation();
            /* Enter finishes the cell, as in the configurator; Alt+Enter and
             * Shift+Enter break the line inside it. */
            if (ev.key === 'Enter' && !ev.altKey && !ev.shiftKey) {
                ev.preventDefault(); commitEdit(); focusGrid();
            } else if (ev.key === 'Escape') { ev.preventDefault(); cancelEdit(); focusGrid(); }
        });
        input.addEventListener('input', function () { fitEditor(input, td); });
        input.addEventListener('blur', function () { commitEdit(); });
        if (input.focus) input.focus();
        if (input.select) input.select();
        fitEditor(input, td);
    }

    /* The editor grows down over the sheet until the whole text is visible;
     * it never shrinks below the cell it covers. */
    function fitEditor(input, td) {
        if (!input.style || input.scrollHeight == null) return;
        var min = td && td.clientHeight ? td.clientHeight : 0;
        input.style.height = 'auto';
        input.style.height = Math.max(min, input.scrollHeight) + 'px';
    }

    function cancelEdit() {
        if (!session.editing) return;
        var input = session.editing.input;
        session.editing = null;
        if (input && input.parentNode) input.parentNode.removeChild(input);
    }

    function commitEdit() {
        if (!session.editing) return;
        var edit = session.editing;
        var value = edit.input.value;
        session.editing = null;
        if (edit.input.parentNode) edit.input.parentNode.removeChild(edit.input);
        var args = { row: edit.row + 1, column: edit.col + 1 };
        /* Typing does not change the kind of the cell: a parameter stays a
         * parameter — emptied, it goes back to «<>» — and a template stays a
         * template even when what is typed holds no [Имя]. The kind is set by
         * «Тип заполнения», as in the Designer. */
        if (edit.fill === 'Parameter') args.name = value.trim();
        else if (edit.fill === 'Template') args.template = value;
        else args.text = value;
        run('setParameter', args);
    }

    function focusGrid() { if (container.focus) container.focus(); }

    /* ---- keyboard ---- */

    function onKeyDown(ev) {
        if (session.editing) return;
        var size = sizeOf();
        if (!size) return;
        if (ev.ctrlKey || ev.metaKey) {
            var key = String(ev.key || '').toLowerCase();
            if (key === 'a') { ev.preventDefault(); select(sheet()); return; }
            var command = CLIPBOARD_KEYS[key];
            if (command) {
                ev.preventDefault();
                var over = rectOf(session.selection, sizeOf());
                if (!over) { fail('Сначала выделите ячейки.'); return; }
                if (command === 'copy') copySelection(over);
                else if (command === 'cut') cutSelection(over);
                else if (command === 'paste') pasteSelection(over);
                else if (command === 'merge') mergeSelection(over);
                return;
            }
        }
        if (ev.key === 'Enter' && ev.altKey) { ev.preventDefault(); showProperties(); return; }
        var sel = session.selection;
        if (!sel) return;
        var step = ARROWS[ev.key];
        if (step) {
            ev.preventDefault();
            var from = ev.shiftKey ? sel.focus : sel.anchor;
            var row = Math.max(0, Math.min(size.height - 1, from.row + step[0]));
            var col = Math.max(0, Math.min(size.width - 1, from.col + step[1]));
            select(ev.shiftKey ? extendTo(sel, row, col) : cells(row, col));
            return;
        }
        if (ev.key === 'F2' || ev.key === 'Enter') {
            ev.preventDefault();
            startEdit(sel.anchor.row, sel.anchor.col);
            return;
        }
        if (ev.key === 'Delete') {
            ev.preventDefault();
            /* Same as «Очистить → Содержимое»: every cell of the range. */
            clearContent(rectOf(session.selection, size));
        }
    }

    /* The sheet behaves differently once it is being edited, and the stylesheet
     * needs to know: see `.tp-editing` in viewer.css. */
    if (container.classList) container.classList.add('tp-editing');

    container.addEventListener('mousedown', onMouseDown);
    container.addEventListener('mousemove', onMouseMove);
    if (doc && doc.addEventListener) doc.addEventListener('mousemove', onDocMouseMove);
    container.addEventListener('mouseup', onMouseUp);
    if (doc && doc.addEventListener) doc.addEventListener('mouseup', onMouseUp);
    container.addEventListener('dblclick', onDoubleClick);
    container.addEventListener('contextmenu', onContextMenu);
    container.addEventListener('keydown', onKeyDown);
    if (container.setAttribute) container.setAttribute('tabindex', '0');

    return {
        selection: function () { return session.selection; },
        rect: function () { return rectOf(session.selection, sizeOf()); },
        select: select,
        selectArea: selectArea,
        runAll: runAll,
        previewSize: previewSize,
        currentSize: currentSize,
        columnsIdAt: columnsIdAt,
        run: run,
        range: range,
        repaint: paint,
        /* For a host that raises the menu itself, and for the tests. */
        headMenu: openHeadMenu,
        cellMenu: cellMenu,
        openMenu: function (items, x, y) { return openMenu(items, x, y, null); },
        closeMenu: closeHeadMenu,
        copy: copySelection,
        cut: cutSelection,
        paste: pasteSelection,
        clipboard: function () { return clipboard; },
        clearContent: clearContent,
        clearFormat: clearFormat,
        clearBorders: clearBorders,
        clearAll: clearAll,
        merge: mergeSelection,
        unmerge: unmergeSelection,
        startEdit: startEdit,
        commitEdit: commitEdit,
        nameArea: nameArea,
        setModel: function (model) { options.model = model; paint(); },
        destroy: function () {
            cancelEdit();
            closeHeadMenu();
            closeNamePop();
            if (container.classList) {
                container.classList.remove('tp-editing');
                container.classList.remove('tp-sizing-col');
                container.classList.remove('tp-sizing-row');
            }
            container.removeEventListener('mousedown', onMouseDown);
            container.removeEventListener('mousemove', onMouseMove);
            if (doc && doc.removeEventListener) doc.removeEventListener('mousemove', onDocMouseMove);
            container.removeEventListener('mouseup', onMouseUp);
            if (doc && doc.removeEventListener) doc.removeEventListener('mouseup', onMouseUp);
            container.removeEventListener('dblclick', onDoubleClick);
            container.removeEventListener('contextmenu', onContextMenu);
            container.removeEventListener('keydown', onKeyDown);
        }
    };
}

/* ---------- toolbar ---------- */

/* Faces the Designer offers first. The current cell's face is added to the
 * list when it is not one of these, so an unusual font is never silently
 * swapped for Arial by merely opening the list. */
var FACES = ['Arial', 'Times New Roman', 'Tahoma', 'Courier New', 'Calibri', 'Segoe UI', 'Verdana'];
var SIZES = [6, 7, 8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36, 48];

/* The basic palette: a grey ramp, then each hue from dark to light — the
 * quick picks. The gradient field next to it covers everything else. */
var PALETTE = [
    '#000000', '#1A1A1A', '#333333', '#4D4D4D', '#666666', '#808080', '#999999', '#B3B3B3',
    '#CCCCCC', '#D9D9D9', '#E6E6E6', '#F2F2F2', '#FFFFFF', '#FFFFCC', '#FFF2CC', '#F2DCDB',
    '#660000', '#990000', '#CC0000', '#FF0000', '#FF3333', '#FF6666', '#FF9999', '#FFCCCC',
    '#663300', '#994C00', '#CC6600', '#FF6600', '#FF9900', '#FFB84D', '#FFCC00', '#FFE699',
    '#003300', '#006600', '#008000', '#00B050', '#00FF00', '#92D050', '#B8E186', '#CCFFCC',
    '#003333', '#006666', '#008080', '#00B0F0', '#00FFFF', '#66FFFF', '#99E6FF', '#CCFFFF',
    '#000066', '#000080', '#0000CC', '#0000FF', '#3366FF', '#6699FF', '#99BBFF', '#CCE5FF',
    '#330033', '#4C0099', '#7030A0', '#9900FF', '#CC00CC', '#FF00FF', '#FF66CC', '#FF99CC'
];

/* The web colours and the resolver live with the renderer: what the picker
 * offers must be exactly what the sheet paints. */
function webColours() {
    var preview = root.TemplatePreview;
    return (preview && preview.webColours) || [];
}

/* A stored colour — «#RRGGBB» or a platform name like «web:DodgerBlue» — as
 * the CSS colour it paints with, or '' when nothing is set. */
function resolveColour(value) {
    var preview = root.TemplatePreview;
    if (preview && preview.resolveColor) return preview.resolveColor(value) || '';
    return hexOf(value);
}

/* How a stored colour reads in the panel and on the button's tooltip. */
function colourLabel(value) {
    var raw = String(value == null ? '' : value).trim();
    if (!raw) return 'Авто';
    return raw;
}

/* ---- colour maths for the picker: hex, RGB and HSV ---- */

function hexToRgb(value) {
    var v = hexOf(value) || '#000000';
    return {
        r: parseInt(v.slice(1, 3), 16),
        g: parseInt(v.slice(3, 5), 16),
        b: parseInt(v.slice(5, 7), 16)
    };
}

function byteHex(n) {
    var v = Math.max(0, Math.min(255, Math.round(isFinite(n) ? n : 0)));
    return (v < 16 ? '0' : '') + v.toString(16).toUpperCase();
}

function rgbToHex(rgb) {
    return '#' + byteHex(rgb.r) + byteHex(rgb.g) + byteHex(rgb.b);
}

/* Hue in degrees, saturation and value in 0..1. A grey has no hue of its own,
 * so the slider keeps the one it had rather than jumping to red. */
function rgbToHsv(rgb) {
    var r = rgb.r / 255, g = rgb.g / 255, b = rgb.b / 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b);
    var d = max - min;
    var h = 0;
    if (d) {
        if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
        else if (max === g) h = ((b - r) / d + 2) * 60;
        else h = ((r - g) / d + 4) * 60;
    }
    return { h: h, s: max ? d / max : 0, v: max };
}

function hsvToRgb(hsv) {
    var h = ((hsv.h % 360) + 360) % 360 / 60;
    var s = Math.max(0, Math.min(1, hsv.s));
    var v = Math.max(0, Math.min(1, hsv.v));
    var i = Math.floor(h);
    var f = h - i;
    var p = v * (1 - s), q = v * (1 - s * f), t = v * (1 - s * (1 - f));
    var rgb = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i % 6];
    return { r: rgb[0] * 255, g: rgb[1] * 255, b: rgb[2] * 255 };
}

var H_ALIGN = [['Auto', 'Автоматически'], ['Left', 'По левому краю'], ['Center', 'По центру'],
    ['Right', 'По правому краю'], ['Justify', 'По ширине']];
var V_ALIGN = [['Top', 'По верху'], ['Center', 'По центру'], ['Bottom', 'По низу']];

/* The alignment commands the toolbar shows as pictures: value, tooltip and the
 * sign to fall back on where SVG cannot be built. «Автоматически» is not a
 * button of its own — it is what pressing the pressed one goes back to. */
var H_ALIGN_ICONS = [['Left', 'По левому краю', '\u2261'], ['Center', 'По центру', '\u2261'],
    ['Right', 'По правому краю', '\u2261'], ['Justify', 'По ширине', '\u2261']];
var V_ALIGN_ICONS = [['Top', 'По верху', '\u2594'], ['Center', 'По центру', '\u2500'],
    ['Bottom', 'По низу', '\u2581']];
var SVG_NS = 'http://www.w3.org/2000/svg';

var PLACEMENT = [['Auto', 'Автоматически'], ['Wrap', 'Переносить'], ['Cut', 'Обрезать'], ['Block', 'Блоком']];
var FILL = [['Text', 'Текст'], ['Template', 'Шаблон'], ['Parameter', 'Параметр']];

/* Why a fill-type change did nothing, worded for the user: every selected cell
 * is already of that type, which is the only case left. */
function nothingToFill(kind) {
    if (kind === 'Parameter') return 'Все выделенные ячейки уже параметры.';
    if (kind === 'Template') return 'Все выделенные ячейки уже шаблоны.';
    return 'Все выделенные ячейки уже обычный текст.';
}

/* A parameter name made out of what the cell shows, as the Designer does when
 * a text cell is turned into a parameter. An empty answer means the cell has
 * nothing that can be a name. */
function nameFromText(text) {
    var name = String(text == null ? '' : text).replace(/[^\wА-Яа-яЁё]/g, '');
    return /^[A-Za-zА-Яа-яЁё_][0-9A-Za-zА-Яа-яЁё_]*$/.test(name) ? name : '';
}

/* Turning a whole range into parameters, templates or plain text. The fill
 * type is one property, but the value under it belongs to each cell: a row of
 * a table has «Номенклатура», «Количество», «Сумма» side by side, and making
 * them parameters has to give each its own name. Hence one setParameter per
 * cell, built from what that cell itself holds.
 *
 * A cell already of the wanted type is left alone. An empty one is not: in the
 * Designer a cell is made a parameter or a template before anything is written
 * into it — an unnamed parameter shows as «<>» — and having to type something
 * first only to replace it is not how the type is set. */
function fillOps(model, rect, kind) {
    var preview = root.TemplatePreview;
    var ops = [];
    if (!model || !rect || !preview || !preview.cellInfo) return ops;
    for (var r = rect.r0; r <= rect.r1; r++) {
        for (var c = rect.c0; c <= rect.c1; c++) {
            var info = preview.cellInfo(model, r, c);
            if (!info || info.fillType === kind) continue;
            var text = (info.cell && info.cell.text) || '';
            var shown = info.fillType === 'Parameter' ? info.parameter : text;
            var args = { row: r + 1, column: c + 1 };
            if (kind === 'Parameter') {
                /* The cell's own text becomes the name where it can be one;
                 * where it cannot — an empty cell, «Итого:» — the cell still
                 * becomes a parameter, with the name left to be typed in. */
                args.name = info.parameter || nameFromText(shown);
            } else if (kind === 'Template') {
                args.template = !shown ? '' : HAS_SLOT.test(shown) ? shown : '[' + shown + ']';
            } else {
                args.text = shown;
            }
            ops.push({ op: 'setParameter', args: args });
        }
    }
    return ops;
}


/* A 1C colour is either #RRGGBB or a named platform style; the picker only
 * speaks hex, so a named colour shows no swatch but is left alone until the
 * user actually picks one. */
function hexOf(value) {
    var v = String(value == null ? '' : value).trim();
    return /^#[0-9a-fA-F]{6}$/.test(v) ? v : '';
}

/* A colour is picked in a palette of our own rather than through a bare
 * `input type=color`. The native picker is a separate window: it fires its
 * `change` only when it closes, and the user closes it by clicking
 * somewhere else — by then the click has already moved the selection, and
 * the colour landed on whatever cell was clicked last. This one is part of
 * the page, keeps the range it was opened over, and paints it only when ОК
 * is pressed.
 *
 * It offers what the Designer's own dialog does for an absolute colour: a
 * saturation/value field with a hue slider, the RGB numbers, the hex, the
 * basic palette and the web colours, with «было» next to «стало». */
function colourControl(doc, session, title, initial, onPick, after, glyph) {
    var wrap = doc.createElement('span');
    wrap.className = 'tp-tool-colour';
    wrap.title = title;

    var button = doc.createElement('button');
    button.type = 'button';
    button.className = 'tp-tool tp-colour-button';
    /* Text and background are told apart by their sign, not only by the bar
     * of colour under it — the way the Designer marks them. */
    var sign = doc.createElement('span');
    sign.className = 'tp-colour-glyph';
    sign.textContent = glyph || 'A';
    button.appendChild(sign);
    var swatch = doc.createElement('span');
    swatch.className = 'tp-colour-swatch';
    swatch.style.background = resolveColour(initial) || 'transparent';
    button.appendChild(swatch);
    wrap.appendChild(button);

    var pop = doc.createElement('div');
    pop.className = 'tp-colour-pop';
    pop.style.display = 'none';
    wrap.appendChild(pop);

    /* `value` is what the document holds and `chosen` what ОК would write:
     * either an absolute colour or a platform name. `hex` is the same colour
     * as RGB, which is what the gradient and the numbers work in. */
    var state = { value: initial, chosen: initial, hex: hexOf(resolveColour(initial)) || '#FFFFFF',
        hsv: rgbToHsv(hexToRgb(resolveColour(initial) || '#FFFFFF')),
        selection: null, open: false, tab: 'palette' };

    function make(tag, cls, parent) {
        var node = doc.createElement(tag);
        if (cls) node.className = cls;
        if (parent) parent.appendChild(node);
        return node;
    }

    /* ---- tabs ---- */

    var tabBar = make('div', 'tp-colour-tabs', pop);
    var pages = {};
    var tabs = {};

    function showTab(name) {
        state.tab = name;
        for (var key in pages) if (Object.prototype.hasOwnProperty.call(pages, key)) {
            pages[key].style.display = key === name ? '' : 'none';
            if (key === name) tabs[key].classList.add('tp-colour-tab-on');
            else tabs[key].classList.remove('tp-colour-tab-on');
        }
    }

    function tab(name, label) {
        var b = make('button', 'tp-colour-tab', tabBar);
        b.type = 'button';
        b.textContent = label;
        b.addEventListener('click', function () { showTab(name); });
        tabs[name] = b;
        var page = make('div', 'tp-colour-page', pop);
        pages[name] = page;
        return page;
    }

    var palettePage = tab('palette', 'Палитра');
    var webPage = tab('web', 'Веб-цвета');

    /* ---- the saturation/value field and the hue slider ---- */

    var fieldRow = make('div', 'tp-colour-fieldrow', palettePage);
    var field = make('div', 'tp-colour-field', fieldRow);
    var fieldDot = make('span', 'tp-colour-dot', field);
    var hue = make('div', 'tp-colour-hue', fieldRow);
    var hueDot = make('span', 'tp-colour-huedot', hue);

    var numbers = make('div', 'tp-colour-numbers', fieldRow);

    function numberField(label) {
        var row = make('label', 'tp-colour-num', numbers);
        make('span', '', row).textContent = label;
        var input = make('input', '', row);
        input.type = 'number';
        input.min = '0';
        input.max = '255';
        input.step = '1';
        input.addEventListener('change', fromNumbers);
        return input;
    }

    var rIn = numberField('R');
    var gIn = numberField('G');
    var bIn = numberField('B');
    var hexRow = make('label', 'tp-colour-num tp-colour-hexrow', numbers);
    make('span', '', hexRow).textContent = '#';
    var hex = make('input', 'tp-colour-hex', hexRow);
    hex.type = 'text';
    hex.addEventListener('change', function () { choose(hex.value); });

    function fromNumbers() {
        choose(rgbToHex({ r: Number(rIn.value), g: Number(gIn.value), b: Number(bIn.value) }));
    }

    /* Dragging inside the field or the slider: the pointer is followed on
     * the document, so a drag that leaves the popup still tracks and a
     * release outside still ends it. */
    function drag(node, onPoint) {
        function move(ev) {
            if (ev.buttons != null && !(ev.buttons & 1)) { stop(); return; }
            onPoint(ev);
        }
        function stop() {
            if (!doc.removeEventListener) return;
            doc.removeEventListener('mousemove', move, true);
            doc.removeEventListener('mouseup', stop, true);
        }
        node.addEventListener('mousedown', function (ev) {
            if (ev.button != null && ev.button !== 0) return;
            if (ev.preventDefault) ev.preventDefault();
            onPoint(ev);
            if (!doc.addEventListener) return;
            doc.addEventListener('mousemove', move, true);
            doc.addEventListener('mouseup', stop, true);
        });
    }

    function ratio(node, ev, axis) {
        if (!node.getBoundingClientRect) return 0;
        var box = node.getBoundingClientRect();
        var size = axis === 'x' ? box.width : box.height;
        if (!size) return 0;
        var at = axis === 'x' ? ev.clientX - box.left : ev.clientY - box.top;
        return Math.max(0, Math.min(1, at / size));
    }

    drag(field, function (ev) {
        setHsv({ h: state.hsv.h, s: ratio(field, ev, 'x'), v: 1 - ratio(field, ev, 'y') });
    });
    drag(hue, function (ev) {
        setHsv({ h: ratio(hue, ev, 'y') * 360, s: state.hsv.s, v: state.hsv.v });
    });

    /* ---- the basic palette ---- */

    var grid = make('div', 'tp-colour-grid', palettePage);
    var swatches = [];
    function paletteCell(value, into, label) {
        var cell = make('button', 'tp-colour-cell', into);
        cell.type = 'button';
        cell.setAttribute('data-colour', value);
        cell.style.background = value;
        cell.title = label || value;
        cell.addEventListener('click', function () { choose(value); });
        swatches.push(cell);
        return cell;
    }
    for (var pi = 0; pi < PALETTE.length; pi++) paletteCell(PALETTE[pi], grid);

    /* ---- the web colours ---- */

    var filter = make('input', 'tp-colour-filter', webPage);
    filter.type = 'text';
    filter.placeholder = 'Поиск по имени';
    var webList = make('div', 'tp-colour-weblist', webPage);
    var webRows = [];
    var web = webColours();
    for (var wi = 0; wi < web.length; wi++) {
        var row = make('button', 'tp-colour-webrow', webList);
        row.type = 'button';
        /* Picked here the colour is stored by name, as the platform does:
         * «web:DodgerBlue» rather than the value it happens to have. */
        row.setAttribute('data-colour', 'web:' + web[wi][0]);
        var chip = make('span', 'tp-colour-webchip', row);
        chip.style.background = web[wi][1];
        var name = make('span', 'tp-colour-webname', row);
        name.textContent = web[wi][0];
        row.title = 'web:' + web[wi][0] + ' · ' + web[wi][1];
        row.addEventListener('click', (function (stored, value) {
            return function () { chooseNamed(stored, value); };
        })('web:' + web[wi][0], web[wi][1]));
        webRows.push({ node: row, name: web[wi][0].toLowerCase() });
        swatches.push(row);
    }
    filter.addEventListener('input', function () {
        var q = String(filter.value || '').trim().toLowerCase();
        for (var i = 0; i < webRows.length; i++) {
            webRows[i].node.style.display = !q || webRows[i].name.indexOf(q) >= 0 ? '' : 'none';
        }
    });

    /* ---- before and after, then the buttons ---- */

    var compare = make('div', 'tp-colour-compare', pop);
    var wasBox = make('span', 'tp-colour-was', compare);
    var nowBox = make('span', 'tp-colour-now', compare);
    make('span', 'tp-colour-comparelabel', compare).textContent = 'было / стало';
    var stored = make('span', 'tp-colour-stored', compare);

    var actions = make('div', 'tp-colour-actions', pop);
    /* Clearing is a choice of its own: the cell goes back to the colour it
     * inherits. The panel offers it on the row; here it belongs beside ОК. */
    var auto = make('button', 'tp-tool tp-colour-auto', actions);
    auto.type = 'button';
    auto.textContent = 'Авто';
    auto.title = 'Убрать цвет, оставить унаследованный';
    var ok = make('button', 'tp-tool tp-colour-ok', actions);
    ok.type = 'button';
    ok.textContent = 'ОК';
    var cancel = make('button', 'tp-tool tp-colour-cancel', actions);
    cancel.type = 'button';
    cancel.textContent = 'Отмена';

    /* ---- state ---- */

    function mark() {
        var rgb = hexToRgb(state.hex);
        rIn.value = String(rgb.r);
        gIn.value = String(rgb.g);
        bIn.value = String(rgb.b);
        hex.value = state.hex.slice(1);
        nowBox.style.background = state.hex;
        /* Only a name is worth showing here: an absolute colour is already in
         * the hex field, and «Авто» is the button next to ОК. */
        stored.textContent = hexOf(state.chosen) ? '' : String(state.chosen || '');
        field.style.background = 'linear-gradient(to top, #000, rgba(0,0,0,0)), '
            + 'linear-gradient(to right, #fff, rgba(255,255,255,0)), '
            + rgbToHex(hsvToRgb({ h: state.hsv.h, s: 1, v: 1 }));
        fieldDot.style.left = (state.hsv.s * 100) + '%';
        fieldDot.style.top = ((1 - state.hsv.v) * 100) + '%';
        hueDot.style.top = (state.hsv.h / 360 * 100) + '%';
        for (var i = 0; i < swatches.length; i++) {
            if (swatches[i].getAttribute('data-colour') === state.chosen) {
                swatches[i].classList.add('tp-colour-on');
            } else swatches[i].classList.remove('tp-colour-on');
        }
    }

    /* Picking only arms the colour; nothing reaches the document until ОК. */
    function choose(value) {
        var v = hexOf(String(value).charAt(0) === '#' ? value : '#' + value);
        if (!v) { mark(); return; }
        state.hex = v.toUpperCase();
        state.chosen = state.hex;
        state.hsv = rgbToHsv(hexToRgb(state.hex));
        mark();
    }

    /* A colour picked by name keeps the name; the gradient still follows its
     * value so the user sees what it looks like. */
    function chooseNamed(name, value) {
        var v = hexOf(value);
        state.chosen = String(name);
        state.hex = v ? v.toUpperCase() : state.hex;
        state.hsv = rgbToHsv(hexToRgb(state.hex));
        mark();
    }

    function setHsv(hsv) {
        state.hsv = hsv;
        state.hex = rgbToHex(hsvToRgb(hsv));
        state.chosen = state.hex;
        mark();
    }

    function onOutside(ev) {
        var node = ev.target;
        while (node) {
            if (node === wrap) return;
            node = node.parentNode;
        }
        close();
    }

    /* The property panel scrolls, and a box that hangs out of a scrolling
     * strip is cut off by it. The palette is therefore placed against the
     * window rather than against the panel: under the button when it fits,
     * above it or pulled to the edge when it does not. */
    function place() {
        if (!button.getBoundingClientRect || !pop.getBoundingClientRect) return;
        var box = button.getBoundingClientRect();
        var size = pop.getBoundingClientRect();
        var w = size.width || 300;
        var h = size.height || 260;
        var view = doc.documentElement || {};
        var vw = view.clientWidth || w;
        var vh = view.clientHeight || h;
        var left = Math.max(4, Math.min(box.left, vw - w - 4));
        var top = box.bottom + 2;
        if (top + h > vh - 4) top = Math.max(4, box.top - h - 2);
        pop.style.position = 'fixed';
        pop.style.left = left + 'px';
        pop.style.top = top + 'px';
        pop.style.right = 'auto';
        pop.style.bottom = 'auto';
    }

    function open() {
        /* The range the palette speaks for is frozen here: a stray click
         * in the sheet while the palette is open must not move it. */
        state.selection = session.selection();
        state.open = true;
        pop.style.display = '';
        place();
        wasBox.style.background = resolveColour(state.value) || 'transparent';
        showTab(state.tab);
        var here = hexOf(resolveColour(state.value));
        state.chosen = state.value;
        state.hex = here || state.hex;
        state.hsv = rgbToHsv(hexToRgb(state.hex));
        mark();
        /* Measured once it has content, so a tall palette near the bottom of
         * the window still lands above the button. */
        place();
        if (doc.addEventListener) {
            doc.addEventListener('mousedown', onOutside, true);
            /* Scrolling the panel or the sheet moves the button out from under
             * a box that is fixed to the window: it follows. */
            doc.addEventListener('scroll', place, true);
        }
        if (doc.defaultView && doc.defaultView.addEventListener) {
            doc.defaultView.addEventListener('resize', place);
        }
    }

    function close() {
        state.open = false;
        pop.style.display = 'none';
        if (doc.removeEventListener) {
            doc.removeEventListener('mousedown', onOutside, true);
            doc.removeEventListener('scroll', place, true);
        }
        if (doc.defaultView && doc.defaultView.removeEventListener) {
            doc.defaultView.removeEventListener('resize', place);
        }
    }

    function confirm() {
        var value = state.chosen;
        var selection = state.selection;
        close();
        /* The selection may have moved while the palette was open; the
         * colour belongs to the range it was opened over. */
        if (selection) session.select(selection);
        onPick(value);
        if (after) after();
    }

    button.addEventListener('click', function () {
        if (state.open) close(); else open();
    });
    ok.addEventListener('click', confirm);
    /* «Авто»: the cell goes back to the colour it inherits, over the same
     * frozen range ОК would have painted. */
    function clear() {
        var selection = state.selection;
        close();
        if (selection) session.select(selection);
        onPick(null);
        if (after) after();
    }

    auto.addEventListener('click', clear);
    cancel.addEventListener('click', function () { close(); });
    pop.addEventListener('keydown', function (ev) {
        if (ev.key === 'Escape') { ev.preventDefault(); close(); }
        else if (ev.key === 'Enter') { ev.preventDefault(); confirm(); }
    });

    return {
        element: wrap,
        button: button,
        pop: pop,
        ok: ok,
        cancel: cancel,
        auto: auto,
        open: open,
        close: close,
        choose: choose,
        chooseNamed: chooseNamed,
        confirm: confirm,
        clear: clear,
        showTab: showTab,
        isOpen: function () { return state.open; },
        chosen: function () { return state.chosen; },
        /* What the document holds: an absolute colour, a platform name, or
         * nothing at all. A name whose value this viewer does not know shows
         * as an empty swatch and is left alone until the user picks. */
        setValue: function (value) {
            state.value = value == null ? '' : String(value);
            var css = resolveColour(state.value);
            swatch.style.background = css || 'transparent';
            button.title = title + ': ' + colourLabel(state.value);
            if (!state.open) {
                var v = hexOf(css);
                if (v) {
                    state.hex = v.toUpperCase();
                    state.hsv = rgbToHsv(hexToRgb(state.hex));
                }
            }
        },
        value: function () { return state.value; }
    };
}
/* Builds the toolbar for a session. The host mounts the returned element
 * wherever it wants it and calls sync() whenever the selection or the document
 * changes, so the controls show what the current cell actually has. */
function toolbar(doc, session, options) {
    options = options || {};
    if (!doc || !session) return null;
    var bar = doc.createElement('div');
    bar.className = 'tp-toolbar';
    var controls = {};

    function group() {
        var g = doc.createElement('span');
        g.className = 'tp-tool-group';
        bar.appendChild(g);
        return g;
    }

    function button(into, label, title, onClick, toggle, extra) {
        var b = doc.createElement('button');
        b.type = 'button';
        b.className = 'tp-tool' + (toggle ? ' tp-tool-toggle' : '') + (extra ? ' ' + extra : '');
        b.textContent = label;
        b.title = title;
        b.addEventListener('click', function () { onClick(); sync(); });
        into.appendChild(b);
        return b;
    }

    function picker(into, values, title, onPick) {
        var sel = doc.createElement('select');
        sel.className = 'tp-tool-select';
        sel.title = title;
        for (var i = 0; i < values.length; i++) {
            var opt = doc.createElement('option');
            opt.value = String(values[i][0]);
            opt.textContent = String(values[i][1]);
            sel.appendChild(opt);
        }
        sel.addEventListener('change', function () { onPick(sel.value); sync(); });
        into.appendChild(sel);
        return sel;
    }

    function number(into, label, title, onChange) {
        var wrap = doc.createElement('label');
        wrap.className = 'tp-tool-number';
        wrap.title = title;
        var caption = doc.createElement('span');
        caption.textContent = label;
        wrap.appendChild(caption);
        var input = doc.createElement('input');
        input.type = 'number';
        input.min = '0';
        input.step = '1';
        input.addEventListener('change', function () { onChange(input.value); sync(); });
        wrap.appendChild(input);
        into.appendChild(wrap);
        return input;
    }

    /* A size with a slider behind it. The number field, the wheel over it and
     * the slider all move the sheet at once through session.previewSize, and
     * the document is written only when the value settles — one undo step per
     * size the user actually chose, and the control survives the redraw that
     * follows, because the redraw happens after it. */
    function sizeField(into, label, title, kind, min, max, commit) {
        var wrap = doc.createElement('span');
        wrap.className = 'tp-tool-size';
        wrap.title = title;
        var caption = doc.createElement('span');
        caption.className = 'tp-size-label';
        caption.textContent = label;
        wrap.appendChild(caption);

        var input = doc.createElement('input');
        input.type = 'number';
        input.className = 'tp-size-input';
        input.min = String(min);
        input.step = '1';
        wrap.appendChild(input);

        var button = doc.createElement('button');
        button.type = 'button';
        button.className = 'tp-tool tp-size-more';
        button.textContent = '▾';
        wrap.appendChild(button);

        var pop = doc.createElement('div');
        pop.className = 'tp-size-pop';
        pop.style.display = 'none';
        var slider = doc.createElement('input');
        slider.type = 'range';
        slider.className = 'tp-size-slider';
        slider.min = String(min);
        slider.max = String(max);
        slider.step = '1';
        pop.appendChild(slider);
        var readout = doc.createElement('span');
        readout.className = 'tp-size-readout';
        pop.appendChild(readout);
        wrap.appendChild(pop);

        var settle = null;

        function value() {
            var n = Number(input.value);
            return isFinite(n) && n > 0 ? n : 0;
        }

        /* An empty field means "the sheet decides": the default width, or a
         * height that follows the content. Stepping from empty would start at
         * the minimum and collapse the row or column, so the field is filled
         * with what the sheet currently shows the moment it is touched. The
         * seed is not written anywhere — only a step or an edit commits. */
        function start() {
            return (session.currentSize ? session.currentSize(kind) : 0) || min;
        }

        function seed() {
            if (input.value !== '' && value() > 0) return;
            var n = start();
            input.value = String(n);
            slider.value = String(n);
            readout.textContent = String(n);
        }

        /* Show it now, write it when the hand stops. */
        function tried(n) {
            input.value = String(n);
            slider.value = String(n);
            readout.textContent = String(n);
            session.previewSize(kind, n);
            if (settle && typeof clearTimeout === 'function') clearTimeout(settle);
            /* While the slider is open the release commits, so an idle commit
             * would redraw the sheet — and close the slider — under the hand
             * that is still using it. The field and the wheel have no release
             * of their own, so there the value is written once it settles. */
            if (pop.style.display === 'none' && typeof setTimeout === 'function') settle = setTimeout(done, 500);
        }

        function done() {
            settle = null;
            var n = value();
            if (n > 0) commit(n);
        }

        input.addEventListener('input', function () {
            var n = value();
            if (n > 0) tried(n);
        });
        input.addEventListener('change', function () {
            if (settle && typeof clearTimeout === 'function') { clearTimeout(settle); settle = null; }
            done();
        });
        /* The wheel over the field steps the size and the sheet follows. */
        input.addEventListener('focus', seed);
        input.addEventListener('mousedown', seed);
        input.addEventListener('wheel', function (ev) {
            if (ev.preventDefault) ev.preventDefault();
            var n = value() || start();
            var step = ev.deltaY < 0 ? 1 : -1;
            tried(Math.max(min, Math.min(max, n + step)));
        });
        slider.addEventListener('input', function () { tried(Number(slider.value)); });
        slider.addEventListener('change', function () {
            if (settle && typeof clearTimeout === 'function') { clearTimeout(settle); settle = null; }
            done();
        });

        function onOutside(ev) {
            var node = ev.target;
            while (node) {
                if (node === wrap) return;
                node = node.parentNode;
            }
            close();
        }

        function close() {
            pop.style.display = 'none';
            if (doc.removeEventListener) doc.removeEventListener('mousedown', onOutside, true);
        }

        function show() {
            pop.style.display = '';
            var n = value() || start();
            slider.value = String(n);
            readout.textContent = String(n);
            if (doc.addEventListener) doc.addEventListener('mousedown', onOutside, true);
        }

        button.addEventListener('click', function () {
            if (pop.style.display === 'none') show(); else close();
        });

        into.appendChild(wrap);
        return {
            element: wrap,
            input: input,
            slider: slider,
            open: show,
            close: close,
            /* The toolbar's sync writes here, and so do the tests. */
            set value(v) { input.value = v; slider.value = v || String(min); },
            get value() { return input.value; },
            get disabled() { return input.disabled; },
            set disabled(v) { input.disabled = v; button.disabled = v; slider.disabled = v; },
            trySize: tried,
            commit: done
        };
    }

    /* An engine refusal or a command that needs more than the user selected,
     * worded for the user and handed to the host's status bar. */
    function complain(message) {
        if (options.onError) options.onError(message);
    }

    /* The pictures of the alignment commands: three or four lines of text
     * against the edge the command aligns to, inside the frame of a cell. A
     * host too thin for SVG (the tests) gets the arrow sign instead. */
    function alignIcon(kind, vertical) {
        if (!doc.createElementNS) return null;
        var svg = doc.createElementNS(SVG_NS, 'svg');
        svg.setAttribute('class', 'tp-menu-icon');
        svg.setAttribute('viewBox', '0 0 16 16');
        svg.setAttribute('width', '16');
        svg.setAttribute('height', '16');

        function bar(x, y, w) {
            var el = doc.createElementNS(SVG_NS, 'rect');
            el.setAttribute('x', String(x));
            el.setAttribute('y', String(y));
            el.setAttribute('width', String(w));
            el.setAttribute('height', '1.6');
            el.setAttribute('rx', '0.6');
            el.setAttribute('fill', '#1a1a1a');
            svg.appendChild(el);
        }

        var full = 12, short = 7;
        var widths = [full, short, full, short];
        var tops = [2.4, 5.4, 8.4, 11.4];
        var i;
        /* «Center» is the name of a value on both axes, so which picture to
         * draw is told by the axis, never by the value alone. */
        if (!vertical) {
            for (i = 0; i < widths.length; i++) {
                var w = kind === 'Justify' ? full : widths[i];
                var x = kind === 'Right' ? 2 + (full - w)
                    : kind === 'Center' ? 2 + (full - w) / 2 : 2;
                bar(x, tops[i], w);
            }
            return svg;
        }
        /* Vertical: one line at the top, the middle or the bottom of the cell,
         * with the cell drawn faintly around it. Three stacked lines read as
         * «text», not as the edge the command aligns to — a single bar says
         * exactly where the content lands. */
        var frame = doc.createElementNS(SVG_NS, 'rect');
        frame.setAttribute('x', '1.5');
        frame.setAttribute('y', '1.5');
        frame.setAttribute('width', '13');
        frame.setAttribute('height', '13');
        frame.setAttribute('fill', 'none');
        frame.setAttribute('stroke', '#c0c0c0');
        frame.setAttribute('stroke-width', '1');
        svg.appendChild(frame);
        bar(4, kind === 'Top' ? 3.4 : kind === 'Center' ? 7.2 : 11, 8);
        return svg;
    }

    /* One row of alignment buttons. `read` says which value the selected cell
     * has, `fallback` is the value that means «not set», and pressing the
     * button already on goes back to it. */
    function alignButtons(into, items, fallback, apply, read, vertical) {
        var made = [];
        for (var i = 0; i < items.length; i++) {
            (function (item) {
                var b = doc.createElement('button');
                b.type = 'button';
                b.className = 'tp-tool tp-tool-icon';
                b.title = item[1];
                var icon = alignIcon(item[0], vertical);
                if (icon) b.appendChild(icon); else b.textContent = item[2];
                b.setAttribute('data-align', item[0]);
                b.addEventListener('click', function () {
                    var on = b.classList && b.classList.contains('tp-tool-on');
                    apply(on ? fallback : item[0]);
                    sync();
                });
                into.appendChild(b);
                made.push({ value: item[0], button: b });
            })(items[i]);
        }
        return {
            buttons: made,
            /* The tests and the host read the value off the row. */
            get value() {
                for (var i = 0; i < made.length; i++) {
                    if (made[i].button.classList && made[i].button.classList.contains('tp-tool-on'))
                        return made[i].value;
                }
                return fallback;
            },
            sync: function (info) {
                var now = info ? read(info) : fallback;
                for (var i = 0; i < made.length; i++) toggle(made[i].button, made[i].value === now);
            }
        };
    }

    /* A small picture of what a border command does: four cells drawn faintly,
     * with the lines the command would put in drawn solid — the same sign the
     * Designer shows next to each entry. `spec` names the parts to draw:
     * left, top, right, bottom, inner, and `thick` for the heavy ones. */
    function borderIcon(spec) {
        if (!doc.createElementNS) return null;
        var svg = doc.createElementNS(SVG_NS, 'svg');
        svg.setAttribute('class', 'tp-menu-icon');
        svg.setAttribute('viewBox', '0 0 16 16');
        svg.setAttribute('width', '16');
        svg.setAttribute('height', '16');

        function line(x1, y1, x2, y2, on) {
            var el = doc.createElementNS(SVG_NS, 'line');
            el.setAttribute('x1', String(x1));
            el.setAttribute('y1', String(y1));
            el.setAttribute('x2', String(x2));
            el.setAttribute('y2', String(y2));
            el.setAttribute('stroke', on ? '#1a1a1a' : '#c0c0c0');
            el.setAttribute('stroke-width', on && spec.thick ? '2.4' : '1');
            if (!on) el.setAttribute('stroke-dasharray', '1 1.5');
            svg.appendChild(el);
        }

        /* The faint sheet first, so a solid line always lies on top of it. */
        line(2, 2, 14, 2, false);
        line(2, 14, 14, 14, false);
        line(2, 2, 2, 14, false);
        line(14, 2, 14, 14, false);
        line(8, 2, 8, 14, false);
        line(2, 8, 14, 8, false);

        if (spec.top) line(2, 2, 14, 2, true);
        if (spec.bottom) line(2, 14, 14, 14, true);
        if (spec.left) line(2, 2, 2, 14, true);
        if (spec.right) line(14, 2, 14, 14, true);
        if (spec.inner) {
            line(8, 2, 8, 14, true);
            line(2, 8, 14, 8, true);
        }
        return svg;
    }

    /* A button that drops a list of commands under it, the way the Designer's
     * border button does. The list closes on a pick, on Escape and on a click
     * anywhere else. */
    function menu(into, label, title, items) {
        var wrap = doc.createElement('span');
        wrap.className = 'tp-tool-menu';
        wrap.title = title;

        var button = doc.createElement('button');
        button.type = 'button';
        button.className = 'tp-tool tp-menu-button';
        /* `label` is either a word or a factory for the sign to draw. */
        var drawn = typeof label === 'function';
        var sign = drawn ? label() : null;
        if (sign) button.appendChild(sign);
        else {
            /* A word, or the space its picture would have taken on a host
             * that cannot draw one. */
            var text = doc.createElement('span');
            text.className = drawn ? 'tp-menu-icon' : 'tp-menu-sign';
            text.textContent = drawn ? '' : String(label);
            button.appendChild(text);
        }
        var caret = doc.createElement('span');
        caret.className = 'tp-menu-caret';
        caret.textContent = '▾';
        button.appendChild(caret);
        wrap.appendChild(button);

        var pop = doc.createElement('div');
        pop.className = 'tp-menu-pop';
        pop.style.display = 'none';
        wrap.appendChild(pop);

        var open = false;

        function onOutside(ev) {
            var node = ev.target;
            while (node) {
                if (node === wrap) return;
                node = node.parentNode;
            }
            close();
        }

        function close() {
            open = false;
            pop.style.display = 'none';
            if (doc.removeEventListener) doc.removeEventListener('mousedown', onOutside, true);
        }

        function show() {
            open = true;
            pop.style.display = '';
            if (doc.addEventListener) doc.addEventListener('mousedown', onOutside, true);
        }

        var entries = [];
        for (var i = 0; i < items.length; i++) {
            var item = doc.createElement('button');
            item.type = 'button';
            item.className = 'tp-menu-item';
            var icon = items[i][2] ? items[i][2]() : null;
            if (icon) item.appendChild(icon);
            else {
                /* Keeps the labels lined up when the host cannot draw one. */
                var gap = doc.createElement('span');
                gap.className = 'tp-menu-icon';
                item.appendChild(gap);
            }
            var caption = doc.createElement('span');
            caption.className = 'tp-menu-text';
            caption.textContent = items[i][0];
            item.appendChild(caption);
            item.addEventListener('click', (function (run) {
                return function () { close(); run(); sync(); };
            })(items[i][1]));
            pop.appendChild(item);
            entries.push(item);
        }

        button.addEventListener('click', function () {
            if (open) close(); else show();
        });
        pop.addEventListener('keydown', function (ev) {
            if (ev.key === 'Escape') { ev.preventDefault(); close(); }
        });

        into.appendChild(wrap);
        return {
            element: wrap,
            button: button,
            pop: pop,
            items: entries,
            open: show,
            close: close,
            isOpen: function () { return open; },
            /* For a host with no way to dispatch a click — and for the tests. */
            pick: function (label) {
                for (var i = 0; i < items.length; i++) {
                    if (items[i][0] === label) { close(); items[i][1](); sync(); return true; }
                }
                return false;
            },
            labels: function () {
                return items.map(function (item) { return item[0]; });
            }
        };
    }

    function colour(into, title, initial, onPick, glyph) {
        var control = colourControl(doc, session, title, initial, onPick, sync, glyph);
        into.appendChild(control.element);
        return control;
    }

    /* Every control funnels into one setFormat over the whole selection. */
    function format(changes) {
        var args = session.range();
        if (!args) return;
        for (var key in changes) if (Object.prototype.hasOwnProperty.call(changes, key)) args[key] = changes[key];
        session.run('setFormat', args);
    }

    function font(changes) {
        var info = current();
        var base = info ? info.font : null;
        var next = {
            face: changes.face != null ? changes.face : (base ? base.faceName : 'Arial'),
            size: changes.size != null ? changes.size : (base ? base.height : 8)
        };
        var flags = ['bold', 'italic', 'underline', 'strikeout'];
        for (var i = 0; i < flags.length; i++) {
            var flag = flags[i];
            next[flag] = changes[flag] != null ? changes[flag] : !!(base && base[flag]);
        }
        format({ font: next });
    }

    /* The cell the toolbar speaks for: the top left corner of the selection. */
    function current() {
        var rect = session.rect();
        var preview = root.TemplatePreview;
        if (!rect || !preview || !preview.cellInfo || !options.model) return null;
        return preview.cellInfo(options.model(), rect.r0, rect.c0);
    }

    var fontGroup = group();
    controls.face = picker(fontGroup, FACES.map(function (f) { return [f, f]; }), 'Шрифт',
        function (value) { font({ face: value }); });
    controls.size = picker(fontGroup, SIZES.map(function (n) { return [n, n]; }), 'Размер шрифта',
        function (value) { font({ size: Number(value) }); });
    controls.bold = button(fontGroup, 'Ж', 'Полужирный',
        function () { font({ bold: !isOn('bold') }); }, true, 'tp-tool-bold');
    controls.italic = button(fontGroup, 'К', 'Курсив',
        function () { font({ italic: !isOn('italic') }); }, true, 'tp-tool-italic');
    controls.underline = button(fontGroup, 'Ч', 'Подчёркнутый',
        function () { font({ underline: !isOn('underline') }); }, true, 'tp-tool-underline');
    if (root.FontEditor && root.FontEditor.control) {
        controls.fontDialog = root.FontEditor.control(doc, {
            title: 'Выбор шрифта',
            onApply: function (value) {
                format({ font: {
                    face: value.face, size: value.height, scale: value.scale,
                    bold: value.bold, italic: value.italic,
                    underline: value.underline, strikeout: value.strikeout
                } });
                sync();
            },
            onError: function (message) { if (options.onError) options.onError(message); }
        });
        controls.fontDialog.element.classList.add('font-edit-toolbar');
        fontGroup.appendChild(controls.fontDialog.element);
    }

    var colourGroup = group();
    controls.textColor = colour(colourGroup, 'Цвет текста', '#000000',
        function (value) { format({ textColor: value }); }, 'A');
    controls.backColor = colour(colourGroup, 'Цвет фона', '#FFFFFF',
        function (value) { format({ backColor: value }); }, '■');

    /* Alignment is shown, not listed: four pictures of text against the edges
     * of a cell and three of a line against the top, the middle and the bottom
     * — the signs every editor uses for it. The two axes sit in groups of
     * their own, so a horizontal command is never mistaken for a vertical one.
     * Pressing the one already on returns the cell to «Автоматически», the way
     * an unpressed toggle reads. */
    var hAlignGroup = group();
    controls.hAlign = alignButtons(hAlignGroup, H_ALIGN_ICONS, 'Auto',
        function (value) { format({ horizontalAlignment: value }); },
        function (info) { return info.format.horizontalAlignment || 'Auto'; });
    var vAlignGroup = group();
    controls.vAlign = alignButtons(vAlignGroup, V_ALIGN_ICONS, 'Top',
        function (value) { format({ verticalAlignment: value }); },
        function (info) { return info.format.verticalAlignment || 'Top'; }, true);
    var alignGroup = group();
    controls.placement = picker(alignGroup, PLACEMENT, 'Размещение текста',
        function (value) { format({ textPlacement: value }); });

    /* The border commands the Designer offers, in its own order and wording.
     * A single side means the matching edge of the selection, not that side of
     * every cell in it — which is what «граница везде» is for. */
    function line(width) { return { style: 'Solid', width: width }; }

    /* One setFormat over a sub-rectangle of the selection, in the 1-based
     * numbering the engine takes. */
    function edge(rect, r0, r1, c0, c1, side, value) {
        var args = { row: r0 + 1, column: c0 + 1 };
        if (r1 !== r0) args.toRow = r1 + 1;
        if (c1 !== c0) args.toColumn = c1 + 1;
        args[side] = value;
        return { op: 'setFormat', args: args };
    }

    function outline(rect, width) {
        var v = line(width);
        return [
            edge(rect, rect.r0, rect.r1, rect.c0, rect.c0, 'leftBorder', v),
            edge(rect, rect.r0, rect.r1, rect.c1, rect.c1, 'rightBorder', v),
            edge(rect, rect.r0, rect.r0, rect.c0, rect.c1, 'topBorder', v),
            edge(rect, rect.r1, rect.r1, rect.c0, rect.c1, 'bottomBorder', v)
        ];
    }

    /* The lines between the cells of the selection: the right side of every
     * column but the last and the bottom of every row but the last. */
    function inside(rect) {
        var v = line(1);
        var ops = [];
        if (rect.c1 > rect.c0) ops.push(edge(rect, rect.r0, rect.r1, rect.c0, rect.c1 - 1, 'rightBorder', v));
        if (rect.r1 > rect.r0) ops.push(edge(rect, rect.r0, rect.r1 - 1, rect.c0, rect.c1, 'bottomBorder', v));
        return ops;
    }

    var ALL_SIDES = { left: true, top: true, right: true, bottom: true };

    var BORDERS = [
        ['Граница слева', function (r) { return [edge(r, r.r0, r.r1, r.c0, r.c0, 'leftBorder', line(1))]; },
            { left: true }],
        ['Граница сверху', function (r) { return [edge(r, r.r0, r.r0, r.c0, r.c1, 'topBorder', line(1))]; },
            { top: true }],
        ['Граница справа', function (r) { return [edge(r, r.r0, r.r1, r.c1, r.c1, 'rightBorder', line(1))]; },
            { right: true }],
        ['Граница снизу', function (r) { return [edge(r, r.r1, r.r1, r.c0, r.c1, 'bottomBorder', line(1))]; },
            { bottom: true }],
        ['Граница везде', function (r) { return [edge(r, r.r0, r.r1, r.c0, r.c1, 'border', line(1))]; },
            { left: true, top: true, right: true, bottom: true, inner: true }],
        ['Граница вокруг', function (r) { return outline(r, 1); }, ALL_SIDES],
        ['Граница внутри', inside, { inner: true }],
        ['Толстая граница вокруг', function (r) { return outline(r, 2); },
            { left: true, top: true, right: true, bottom: true, thick: true }],
        ['Толстая граница сверху', function (r) { return [edge(r, r.r0, r.r0, r.c0, r.c1, 'topBorder', line(2))]; },
            { top: true, thick: true }],
        ['Толстая граница снизу', function (r) { return [edge(r, r.r1, r.r1, r.c0, r.c1, 'bottomBorder', line(2))]; },
            { bottom: true, thick: true }],
        ['Нет границы', function (r) { return [edge(r, r.r0, r.r1, r.c0, r.c1, 'border', null)]; }, {}]
    ];

    var borderGroup = group();
    /* The button wears the same sign as «Граница везде», the command the
     * whole list is named after. */
    controls.borders = menu(borderGroup, function () {
        return borderIcon({ left: true, top: true, right: true, bottom: true, inner: true });
    }, 'Границы', BORDERS.map(function (item) {
        return [item[0], function () {
            var rect = session.rect();
            if (!rect) { complain('Сначала выделите ячейки.'); return; }
            var ops = item[1](rect);
            if (!ops.length) { complain('Границы внутри есть только у нескольких ячеек.'); return; }
            session.runAll(ops);
        }, function () { return borderIcon(item[2]); }];
    }));

    var cellGroup = group();
    controls.fill = picker(cellGroup, FILL, 'Тип заполнения выделенных ячеек', function (value) {
        var rect = session.rect();
        if (!rect) { complain('Сначала выделите ячейки.'); return; }
        var ops = fillOps(options.model ? options.model() : null, rect, value);
        if (!ops.length) { complain(nothingToFill(value)); sync(); return; }
        session.runAll(ops);
    });

    /* Width belongs to the column and height to the row, so each field applies
     * to every column or row the selection covers, not to one cell. */
    var sizeGroup = group();
    controls.width = sizeField(sizeGroup, 'Ш', 'Ширина выделенных колонок, в единицах 1С',
        'width', 1, 120, function (value) {
            var rect = session.rect();
            if (!rect) return;
            session.run('setSize', { column: rect.c0 + 1, toColumn: rect.c1 + 1, width: value,
                columnsId: session.columnsIdAt ? session.columnsIdAt(rect.r0) : undefined });
        });
    controls.height = sizeField(sizeGroup, 'В', 'Высота выделенных строк в пунктах; 0 — автоматически',
        'height', 1, 200, function (value) {
            var rect = session.rect();
            if (!rect) return;
            session.run('setSize', { row: rect.r0 + 1, toRow: rect.r1 + 1, height: value });
        });

    /* Every merge the selection touches, not only the one under its corner: a
     * user who picks three merged rows and presses «Разъединить» means all
     * three, and a merge half inside the range is still in the way of one over
     * it. */
    function mergesIn(rect) {
        var model = options.model ? options.model() : null;
        var merges = (model && model.merges) || [];
        var found = [];
        if (!rect) return found;
        for (var i = 0; i < merges.length; i++) {
            var m = merges[i];
            if (m.columnsID) continue;
            if (rect.r0 <= m.r + (m.h || 0) && m.r <= rect.r1
                && rect.c0 <= m.c + (m.w || 0) && m.c <= rect.c1) found.push(m);
        }
        return found;
    }

    /* The range grown until it holds every merge it touches whole: half of a
     * merged cell cannot be merged into something else, so the command takes
     * the whole of it — as the Designer does when the selection is extended
     * over a merge. Growing may reach further merges, hence the loop. */
    function spreadOverMerges(rect) {
        var box = { r0: rect.r0, r1: rect.r1, c0: rect.c0, c1: rect.c1 };
        for (var pass = 0; pass < 32; pass++) {
            var found = mergesIn(box);
            var grew = false;
            for (var i = 0; i < found.length; i++) {
                var m = found[i];
                if (m.r < box.r0) { box.r0 = m.r; grew = true; }
                if (m.c < box.c0) { box.c0 = m.c; grew = true; }
                if (m.r + (m.h || 0) > box.r1) { box.r1 = m.r + (m.h || 0); grew = true; }
                if (m.c + (m.w || 0) > box.c1) { box.c1 = m.c + (m.w || 0); grew = true; }
            }
            if (!grew) break;
        }
        return box;
    }

    function unmergeOp(m) {
        return { op: 'mergeCells', args: { row: m.r + 1, column: m.c + 1, unmerge: true } };
    }

    var structureGroup = group();
    /* Rows and columns — inserting, deleting, hiding — are commands of the
     * header menu (a right click on a row number or a column head), where the
     * Designer keeps them. The toolbar keeps what belongs to the cells. */
    /* One button both ways, as in the Designer: over a merged cell it takes
     * the merge apart, and over a range it makes one. */
    /* Naming what is selected: the same command the header menus carry, where
     * a user working with the mouse in the sheet can reach it. */
    controls.nameArea = button(structureGroup, 'Имя области',
        'Назначить имя области выделенным строкам, колонкам или ячейкам', function () {
            if (session.nameArea) session.nameArea();
        });
    controls.merge = button(structureGroup, 'Объединить', 'Объединить выделенные ячейки', function () {
        var rect = session.rect();
        if (!rect) return;
        var inside = mergesIn(rect);
        if (inside.length) {
            /* One undo step for the whole selection, however many merges it
             * covers. */
            session.runAll(inside.map(unmergeOp));
            return;
        }
        var box = spreadOverMerges(rect);
        var ops = mergesIn(box).map(unmergeOp);
        if (box.r1 === box.r0 && box.c1 === box.c0) {
            complain('Объединение из одной ячейки: выделите несколько.');
            return;
        }
        ops.push({ op: 'mergeCells', args: {
            row: box.r0 + 1, column: box.c0 + 1,
            rows: box.r1 - box.r0 + 1, columns: box.c1 - box.c0 + 1
        } });
        session.runAll(ops);
    });

    function isOn(flag) {
        var info = current();
        return !!(info && info.font && info.font[flag]);
    }

    function pick(select, value, fallback) {
        var wanted = String(value == null || value === '' ? fallback : value);
        var options = select.options || select.children || [];
        for (var i = 0; i < options.length; i++) {
            if (options[i].value === wanted) {
                select.selectedIndex = i;
                select.value = wanted;
                return;
            }
        }
        /* A value the list does not know — the face of an unusual font, say —
         * is added rather than silently replaced by the first entry. */
        var extra = doc.createElement('option');
        extra.value = wanted;
        extra.textContent = wanted;
        select.appendChild(extra);
        options = select.options || select.children || [];
        select.selectedIndex = options.length - 1;
        select.value = wanted;
    }

    function toggle(button, on) {
        if (!button || !button.classList) return;
        if (on) button.classList.add('tp-tool-on');
        else button.classList.remove('tp-tool-on');
    }

    /* Shows what the selection holds. Called after every edit and whenever the
     * selection moves. */
    function sync() {
        var info = current();
        var enabled = !!info && !options.readOnly;
        /* One tag per query: a comma-separated selector is more than the
         * hosts' lightest DOM promises. */
        var tags = ['button', 'select', 'input'];
        for (var t = 0; t < tags.length; t++) {
            var nodes = bar.querySelectorAll(tags[t]);
            for (var i = 0; i < nodes.length; i++) nodes[i].disabled = !enabled;
        }
        if (!info) return;
        pick(controls.face, info.font && info.font.faceName, 'Arial');
        pick(controls.size, info.font && info.font.height, 8);
        toggle(controls.bold, info.font && info.font.bold);
        toggle(controls.italic, info.font && info.font.italic);
        toggle(controls.underline, info.font && info.font.underline);
        if (controls.fontDialog) controls.fontDialog.setValue(info.font);
        controls.hAlign.sync(info);
        controls.vAlign.sync(info);
        pick(controls.placement, info.format.textPlacement, 'Auto');
        pick(controls.fill, info.fillType, 'Text');
        var merged = mergesIn(session.rect()).length;
        controls.merge.textContent = merged ? 'Разъединить' : 'Объединить';
        controls.merge.title = merged
            ? (merged > 1 ? 'Снять все объединения в выделении'
                : 'Снять объединение с этой ячейки')
            : 'Объединить выделенные ячейки';
        var preview = root.TemplatePreview;
        var rect = session.rect();
        if (preview && preview.cellSize && rect) {
            var size = preview.cellSize(options.model(), rect.r0, rect.c0);
            /* An empty field means the sheet's default width or an automatic
             * height — the same thing the Designer shows as blank. */
            controls.width.value = size.width == null ? '' : String(size.width);
            controls.height.value = size.height == null ? '' : String(size.height);
        }
        controls.textColor.setValue(info.format.textColor);
        controls.backColor.setValue(info.format.backColor);
    }

    sync();
    return { element: bar, sync: sync, controls: controls };
}

/* ---------- the cell property panel ---------- */

/* The cell line types of the platform, in the Designer's own order and
 * wording. The value is the type the document keeps; an empty one is no line
 * at all. The thickness is a separate property and is left as it is. */
var BORDER_LINES = [
    ['', 'Нет линии'],
    ['Solid', 'Сплошная'],
    ['Dotted', 'Точечная'],
    ['Double', 'Двойная'],
    ['ThinDashed', 'Редкий пунктир'],
    ['ThickDashed', 'Частый пунктир'],
    ['LargeDashed', 'Большой пунктир']
];

/* How each type is drawn in the list. The sheet itself cannot tell the three
 * dashed types apart — CSS has one «dashed» — but the list must, because
 * «Редкий пунктир» against «Частый пунктир» means nothing until they are
 * seen. */
var LINE_DASH = {
    Dotted: '1 2',
    ThinDashed: '3 3',
    ThickDashed: '3 1.5',
    LargeDashed: '6 3'
};

/* The three types the sheet cannot tell apart: CSS has one dashed border and
 * no say over the length of the dash. The document keeps them apart, so this
 * is about the drawing only. */
var LINE_LOOKS_SAME = { ThinDashed: 1, ThickDashed: 1, LargeDashed: 1 };
var DASH_HINT = 'В этом просмотре редкий, частый и большой пунктир рисуются одинаково; '
    + 'в макет тип записывается верно.';
/* The same thing said in full, for the note the property panel shows over the
 * border rows. */
var DASH_NOTE = 'Редкий, частый и большой пунктир на листе рисуются одинаково: '
    + 'в CSS пунктир один. В макет тип записывается верно, и 1С рисует его как надо.';

/* The picture of a line type, the way the Designer shows it next to the name:
 * the line itself, drawn across the sample. «Нет линии» draws nothing. A host
 * without SVG (the tests) gets nothing and keeps the name alone. */
function lineSample(doc, style, width) {
    if (!doc || !doc.createElementNS) return null;
    var svg = doc.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'tp-line-sample');
    svg.setAttribute('viewBox', '0 0 48 12');
    svg.setAttribute('width', '48');
    svg.setAttribute('height', '12');
    var kind = String(style || '');

    function stroke(y, width) {
        var el = doc.createElementNS(SVG_NS, 'line');
        el.setAttribute('x1', '1');
        el.setAttribute('y1', String(y));
        el.setAttribute('x2', '47');
        el.setAttribute('y2', String(y));
        /* currentColor, so the sample is visible in the light list and in the
         * dark property pane alike. */
        el.setAttribute('stroke', 'currentColor');
        el.setAttribute('stroke-width', String(width));
        if (LINE_DASH[kind]) el.setAttribute('stroke-dasharray', LINE_DASH[kind]);
        svg.appendChild(el);
    }

    /* Thicker than three points the sample would not fit the row, and past
     * that a border is «very thick» either way. */
    var w = Math.max(1, Math.min(3, Math.round(Number(width) || 1)));
    var gap = Math.max(2, w + 1);
    if (kind === 'Double') { stroke(6 - gap, w); stroke(6 + gap, w); }
    else if (kind) stroke(6, w);
    return svg;
}

/* Everything the panel can change goes through one of two engine calls:
 * setFormat for how the cell looks and setParameter for what it holds. A
 * property the engine cannot write is shown with its value and disabled,
 * because what the cell has should be visible even when this editor cannot
 * change it.
 *
 * options: model(), readOnly, onError(message) for a refusal and
 * onNote(message) for something worth knowing about a change that went
 * through — the host shows the two differently. */
function properties(doc, session, options) {
    options = options || {};
    if (!doc || !doc.createElement || !session) return null;

    /* Said once per open document: a note repeated at every pick is noise. */
    var dashNoteShown = false;

    var host = doc.createElement('div');
    host.className = 'fp-props tp-props';

    var head = doc.createElement('div');
    head.className = 'fp-props-head';
    host.appendChild(head);
    var title = doc.createElement('div');
    title.className = 'fp-props-title';
    head.appendChild(title);

    var list = doc.createElement('div');
    list.className = 'fp-props-list';
    host.appendChild(list);

    function fail(message) {
        if (options.onError) options.onError(message);
    }

    /* Something worth knowing that is not a refusal: the change went through.
     * A host without a place for notes simply gets none. */
    function note(message) {
        if (options.onNote) options.onNote(message);
    }

    function model() {
        return options.model ? options.model() : null;
    }

    /* The cell the panel speaks for: the corner of the selection, as in the
     * Designer, where the panel shows one cell and a change reaches them all. */
    function current() {
        var rect = session.rect();
        var preview = root.TemplatePreview;
        var m = model();
        if (!rect || !m || !preview || !preview.cellInfo) return null;
        var info = preview.cellInfo(m, rect.r0, rect.c0);
        if (!info) return null;
        info.rect = rect;
        info.size = preview.cellSize ? preview.cellSize(m, rect.r0, rect.c0) : null;
        return info;
    }

    /* One property over the whole selection. */
    function format(changes) {
        var rect = session.rect();
        if (!rect) { fail('Сначала выделите ячейки.'); return; }
        var args = { row: rect.r0 + 1, column: rect.c0 + 1 };
        if (rect.r1 !== rect.r0) args.toRow = rect.r1 + 1;
        if (rect.c1 !== rect.c0) args.toColumn = rect.c1 + 1;
        for (var key in changes) if (Object.prototype.hasOwnProperty.call(changes, key)) args[key] = changes[key];
        session.run('setFormat', args);
        render();
    }

    /* What the cell holds belongs to one cell, not to the range. */
    function content(changes) {
        var rect = session.rect();
        if (!rect) { fail('Сначала выделите ячейку.'); return; }
        var args = { row: rect.r0 + 1, column: rect.c0 + 1 };
        for (var key in changes) if (Object.prototype.hasOwnProperty.call(changes, key)) args[key] = changes[key];
        session.run('setParameter', args);
        render();
    }

    function size(changes) {
        var rect = session.rect();
        if (!rect) return;
        var args = {};
        for (var key in changes) if (Object.prototype.hasOwnProperty.call(changes, key)) args[key] = changes[key];
        /* Width belongs to the column and height to the row, so each field
         * reaches every column or row the selection covers. An empty field is
         * the sheet's default width or an automatic height, which the engine
         * takes as zero. */
        if ('width' in args) {
            args.column = rect.c0 + 1;
            args.toColumn = rect.c1 + 1;
            if (args.width == null) args.width = 0;
            /* The width belongs to the column set the selection is drawn from,
             * not to the sheet's default one. */
            if (session.columnsIdAt) args.columnsId = session.columnsIdAt(rect.r0);
        } else {
            args.row = rect.r0 + 1;
            args.toRow = rect.r1 + 1;
            if (args.height == null) args.height = 0;
        }
        session.run('setSize', args);
        render();
    }

    /* ---- the rows ---- */

    function group(label) {
        var g = doc.createElement('div');
        g.className = 'tp-props-group';
        g.textContent = label;
        list.appendChild(g);
    }

    /* A note that belongs to the rows under it. The line types are the case
     * it exists for: the sheet draws the three dashed ones alike, and a user
     * picking one has to be told before the pick, not after it — a tooltip on
     * the field is found only by someone already suspicious. */
    function panelNote(text) {
        var el = doc.createElement('div');
        el.className = 'tp-props-note';
        el.textContent = text;
        list.appendChild(el);
        return el;
    }

    function row(label, control, hint) {
        var line = doc.createElement('div');
        line.className = 'fp-prop';
        line.setAttribute('data-prop', label);
        var caption = doc.createElement('div');
        caption.className = 'fp-prop-name';
        caption.textContent = label;
        if (hint) caption.title = hint;
        line.appendChild(caption);
        var box = doc.createElement('div');
        box.className = 'fp-prop-value';
        box.appendChild(control);
        line.appendChild(box);
        list.appendChild(line);
        if (options.readOnly && control.disabled === false) control.disabled = true;
        return control;
    }

    function frozen(text) {
        var el = doc.createElement('div');
        el.className = 'fp-prop-frozen';
        el.textContent = text == null ? '' : String(text);
        return el;
    }

    function text(value, onSet, disabled) {
        var el = doc.createElement('input');
        el.className = 'fp-prop-input';
        el.type = 'text';
        el.value = value == null ? '' : String(value);
        el.disabled = !!disabled || !!options.readOnly;
        el.addEventListener('change', function () { onSet(String(el.value)); });
        return el;
    }

    /* `seed` is for a field whose emptiness means "the sheet decides": the
     * width or the height the sheet shows is put in as soon as the field is
     * touched, so the arrows step from what the user sees instead of from the
     * minimum. Nothing is written until the value actually changes. */
    function number(value, onSet, disabled, seed) {
        var el = doc.createElement('input');
        el.className = 'fp-prop-input';
        el.type = 'number';
        el.value = value == null || value === '' ? '' : String(value);
        el.disabled = !!disabled || !!options.readOnly;
        if (seed) {
            var fill = function () {
                if (String(el.value || '').trim() !== '') return;
                var n = seed();
                if (n > 0) el.value = String(n);
            };
            el.addEventListener('focus', fill);
            el.addEventListener('mousedown', fill);
        }
        el.addEventListener('change', function () {
            var raw = String(el.value == null ? '' : el.value).trim();
            if (raw === '') { onSet(null); return; }
            var n = Number(raw);
            if (!isFinite(n)) { fail('Нужно число.'); render(); return; }
            onSet(n);
        });
        return el;
    }

    function choice(values, value, onSet, disabled) {
        var el = doc.createElement('select');
        el.className = 'fp-prop-input';
        for (var i = 0; i < values.length; i++) {
            var option = doc.createElement('option');
            option.value = String(values[i][0]);
            option.textContent = String(values[i][1]);
            el.appendChild(option);
        }
        el.value = value == null ? '' : String(value);
        el.disabled = !!disabled || !!options.readOnly;
        el.addEventListener('change', function () { onSet(el.value); });
        return el;
    }

    /* The border rows are not a plain list of names: a line type is a picture
     * in the Designer, and «Редкий пунктир» against «Большой пунктир» is only
     * a guess until both are drawn. A native <select> cannot hold one, so the
     * row is a field of its own that drops a list of samples under itself. */
    function lineChoice(value, onSet, disabled, width) {
        var current = value == null ? '' : String(value);
        var wrap = doc.createElement('span');
        wrap.className = 'fp-prop-input tp-line-pick';
        var button = doc.createElement('button');
        button.type = 'button';
        button.className = 'tp-line-pick-value';
        button.disabled = !!disabled || !!options.readOnly;
        /* The field shows the line as the cell really has it, thickness and
         * all; the list under it draws every type at one point, so the types
         * are compared and not the thicknesses. */
        if (LINE_LOOKS_SAME[current]) button.title = DASH_HINT;
        showLine(button, current, width);
        wrap.appendChild(button);

        var list = null;

        function closeList() {
            if (!list) return;
            if (list.parentNode) list.parentNode.removeChild(list);
            list = null;
            if (doc.removeEventListener) {
                doc.removeEventListener('mousedown', outside, true);
                doc.removeEventListener('keydown', onKey, true);
            }
        }

        function outside(ev) {
            var node = ev.target;
            while (node) {
                if (node === list || node === wrap) return;
                node = node.parentNode;
            }
            closeList();
        }

        function onKey(ev) {
            if (ev.key !== 'Escape') return;
            if (ev.preventDefault) ev.preventDefault();
            closeList();
            if (button.focus) button.focus();
        }

        function pick(value) {
            closeList();
            if (value === current) return;
            /* The sheet cannot draw the three dashed types apart — they all
             * become one CSS «dashed» — so the user is told once, quietly,
             * rather than left to think the pick did nothing. The file keeps
             * the type it was given, and 1C draws it properly. */
            onSet(value);
            /* After the edit, not before: the host clears the status line on
             * every change it applies, and a note written first would be wiped
             * by the very change it is about. */
            if (LINE_LOOKS_SAME[value] && !dashNoteShown) {
                dashNoteShown = true;
                note('На листе редкий, частый и большой пунктир выглядят одинаково; '
                    + 'в макет тип записывается верно и в 1С рисуется как надо.');
            }
        }

        function openList() {
            closeList();
            list = doc.createElement('div');
            list.className = 'tp-line-list';
            for (var i = 0; i < BORDER_LINES.length; i++) {
                (function (item) {
                    var entry = doc.createElement('button');
                    entry.type = 'button';
                    entry.className = 'tp-line-item'
                        + (String(item[0]) === current ? ' tp-line-item-on' : '');
                    if (LINE_LOOKS_SAME[item[0]]) entry.title = DASH_HINT;
                    showLine(entry, item[0]);
                    entry.addEventListener('click', function () { pick(String(item[0])); });
                    list.appendChild(entry);
                })(BORDER_LINES[i]);
            }
            (doc.body || wrap).appendChild(list);
            placeUnder(list, button);
            if (doc.addEventListener) {
                doc.addEventListener('mousedown', outside, true);
                doc.addEventListener('keydown', onKey, true);
            }
        }

        button.addEventListener('click', function () {
            if (button.disabled) return;
            if (list) closeList(); else openList();
        });
        return wrap;
    }

    /* The name of a line type with its picture before it. */
    function showLine(into, style, width) {
        var sample = lineSample(doc, style, width);
        if (sample) into.appendChild(sample);
        var name = doc.createElement('span');
        name.className = 'tp-line-name';
        name.textContent = nameOfLine(style);
        into.appendChild(name);
    }

    function nameOfLine(style) {
        var want = style == null ? '' : String(style);
        for (var i = 0; i < BORDER_LINES.length; i++) {
            if (String(BORDER_LINES[i][0]) === want) return String(BORDER_LINES[i][1]);
        }
        return want;
    }

    /* Under the field and inside the window: the panel scrolls and sits at the
     * edge of a narrow pane, so a list left where it was opened would be cut
     * off by both. */
    function placeUnder(list, button) {
        list.style.position = 'fixed';
        if (!button.getBoundingClientRect || !doc.documentElement) return;
        var box = button.getBoundingClientRect();
        list.style.left = box.left + 'px';
        list.style.top = (box.bottom + 1) + 'px';
        list.style.minWidth = Math.max(120, box.width) + 'px';
        if (!list.getBoundingClientRect) return;
        var own = list.getBoundingClientRect();
        var vw = doc.documentElement.clientWidth || 0;
        var vh = doc.documentElement.clientHeight || 0;
        if (vw && own.right > vw - 4) list.style.left = Math.max(4, vw - own.width - 4) + 'px';
        if (vh && own.bottom > vh - 4) {
            list.style.top = Math.max(4, box.top - own.height - 1) + 'px';
        }
    }

    function flag(value, onSet) {
        var el = doc.createElement('input');
        el.className = 'fp-prop-check';
        el.type = 'checkbox';
        el.checked = !!value;
        el.disabled = !!options.readOnly;
        el.addEventListener('change', function () { onSet(!!el.checked); });
        return el;
    }

    /* A colour row is the toolbar's own picker, so the panel and the toolbar
     * offer the same gradient, the same web colours and the same ОК. */
    function colourRow(label, value, onSet, glyph) {
        var box = doc.createElement('div');
        box.className = 'tp-props-colour';
        var control = colourControl(doc, session, label, value == null ? '' : String(value),
            function (picked) { onSet(picked); }, render, glyph);
        control.setValue(value == null ? '' : String(value));
        box.appendChild(control.element);
        var clear = doc.createElement('button');
        clear.type = 'button';
        clear.className = 'tp-tool tp-props-clear';
        clear.textContent = '×';
        clear.title = 'Авто';
        clear.disabled = !!options.readOnly;
        clear.addEventListener('click', function () { onSet(null); });
        box.appendChild(clear);
        var shown = doc.createElement('span');
        shown.className = 'tp-props-colourname';
        shown.textContent = colourLabel(value);
        shown.title = shown.textContent;
        box.appendChild(shown);
        row(label, box);
        return control;
    }

    /* A border is two properties in one row, as in the Designer: the type of
     * the line and how thick it is. Either one alone is not the border the
     * user wants — a double line of one point and of three look nothing
     * alike. */
    function borderRow(label, side, line) {
        var width = line ? Math.max(1, Math.round(Number(line.width) || 1)) : 1;
        var style = line ? String(line.style || 'Solid') : '';
        var box = doc.createElement('div');
        box.className = 'tp-border-value';
        box.appendChild(lineChoice(style, function (value) {
            var changes = {};
            /* The type is changed without touching the thickness the side
             * already has, and the other way round. */
            changes[side] = value === '' ? null : { style: value, width: width };
            format(changes);
        }, false, width));
        box.appendChild(thickness(width, !line, function (value) {
            var changes = {};
            changes[side] = { style: style || 'Solid', width: value };
            format(changes);
        }));
        row(label, box);
    }

    /* The thickness of a border, in the 1…20 the engine takes. With no line
     * there is nothing to thicken, so the field waits until there is one. */
    function thickness(value, disabled, onSet) {
        var el = doc.createElement('input');
        el.className = 'fp-prop-input tp-border-width';
        el.type = 'number';
        el.min = '1';
        el.max = '20';
        el.step = '1';
        el.value = String(value);
        el.title = 'Толщина линии, от 1 до 20';
        el.disabled = !!disabled || !!options.readOnly;
        el.addEventListener('change', function () {
            var n = Math.round(Number(String(el.value == null ? '' : el.value).trim()));
            if (!isFinite(n) || n < 1 || n > 20) {
                fail('Толщина линии: от 1 до 20.');
                render();
                return;
            }
            if (n === value) return;
            onSet(n);
        });
        return el;
    }

    function fontLabel(font) {
        if (!font) return '';
        var parts = [font.faceName || 'Arial', String(font.height || 8)];
        if (font.bold) parts.push('полужирный');
        if (font.italic) parts.push('курсив');
        if (font.underline) parts.push('подчёркнутый');
        return parts.join(', ');
    }

    /* Every edit rewrites the document, the sheet is drawn again and the panel
     * with it. Without this the field under the hand would be replaced by a
     * new one: the focus would land on nothing and the list would jump back to
     * the top, which is what clicking a spinner arrow looked like. */
    function keepPlace(rebuild) {
        var active = doc.activeElement;
        var inside = false;
        var node = active;
        while (node) {
            if (node === list) { inside = true; break; }
            node = node.parentNode;
        }
        var at = null;
        if (inside && active) {
            var line = active;
            while (line && line !== list && !(line.getAttribute && line.getAttribute('data-prop'))) {
                line = line.parentNode;
            }
            at = {
                prop: line && line.getAttribute ? line.getAttribute('data-prop') : null,
                start: active.selectionStart,
                end: active.selectionEnd
            };
        }
        var scrolled = list.scrollTop;
        rebuild();
        list.scrollTop = scrolled;
        if (!at || !at.prop) return;
        var lines = list.querySelectorAll('div');
        for (var i = 0; i < lines.length; i++) {
            if (lines[i].getAttribute('data-prop') !== at.prop) continue;
            var fields = lines[i].querySelectorAll('input');
            var field = fields[0] || lines[i].querySelectorAll('select')[0];
            if (!field || !field.focus) return;
            field.focus();
            if (at.start != null && field.setSelectionRange) {
                try { field.setSelectionRange(at.start, at.end); } catch (err) {}
            }
            return;
        }
    }

    function render() {
        keepPlace(draw);
    }

    function draw() {
        list.innerHTML = '';
        var info = current();
        if (!info) {
            title.textContent = 'Ячейка не выбрана';
            return;
        }
        var rect = info.rect;
        var one = rect.r0 === rect.r1 && rect.c0 === rect.c1;
        var name = 'R' + (rect.r0 + 1) + 'C' + (rect.c0 + 1);
        title.textContent = one ? name
            : name + ':R' + (rect.r1 + 1) + 'C' + (rect.c1 + 1);
        var fmt = info.format || {};
        var isParam = info.fillType === 'Parameter';

        row('Текст', text(isParam ? '' : (info.cell && info.cell.text) || '',
            function (value) { content({ text: value }); }, isParam || !one));
        row('РазмещениеТекста', choice(PLACEMENT, fmt.textPlacement || 'Auto',
            function (value) { format({ textPlacement: value }); }));
        row('Имя', frozen(name), 'Адрес ячейки; именованные области задаются отдельно');
        row('Защита', flag(fmt.protection === 'true' || fmt.protection === true,
            function (on) { format({ protection: on ? true : null }); }));

        group('Значения');
        /* The type reaches every selected cell, each with its own value: a
         * row of a table is made of parameters one name at a time. */
        row('ТипЗаполнения', choice(FILL, info.fillType || 'Text', function (value) {
            var ops = fillOps(model(), rect, value);
            if (!ops.length) { fail(nothingToFill(value)); render(); return; }
            session.runAll(ops);
            render();
        }));
        /* An empty name is allowed: the cell stays a parameter and goes back to
         * «<>» until a name is typed. */
        row('Параметр', text(info.parameter, function (value) {
            content({ name: value.trim() });
        }, !isParam || !one));
        row('ПараметрРасшифровки', text(info.detail,
            function (value) { content({ detail: value.trim() }); }, !one));
        row('Формат', text(fmt.format, function (value) { format({ format: value || null }); }));
        row('ФорматРедактирования', text(fmt.editFormat,
            function (value) { format({ editFormat: value || null }); }));
        row('Маска', text(fmt.mask, function (value) { format({ mask: value || null }); }));

        group('Положение');
        row('ГоризонтальноеПоложение', choice(H_ALIGN, fmt.horizontalAlignment || 'Auto',
            function (value) { format({ horizontalAlignment: value }); }));
        row('ВертикальноеПоложение', choice(V_ALIGN, fmt.verticalAlignment || 'Top',
            function (value) { format({ verticalAlignment: value }); }));
        row('Отступ', number(fmt.indent, function (value) { format({ indent: value == null ? null : value }); }));
        row('АвтоОтступ', flag(fmt.autoIndent === 'true' || fmt.autoIndent === true,
            function (on) { format({ autoIndent: on ? true : null }); }));
        row('ФакторВесаШирины', number(fmt.widthWeightFactor,
            function (value) { format({ widthWeightFactor: value == null ? null : value }); }));

        group('Оформление');
        if (root.FontEditor && root.FontEditor.control) {
            var fontControl = root.FontEditor.control(doc, {
                title: 'Выбор шрифта', value: info.font,
                readOnly: !!options.readOnly,
                onApply: function (value) {
                    format({ font: {
                        face: value.face, size: value.height, scale: value.scale,
                        bold: value.bold, italic: value.italic,
                        underline: value.underline, strikeout: value.strikeout
                    } });
                },
                onError: fail
            });
            row('Шрифт', fontControl.element);
        } else row('Шрифт', frozen(fontLabel(info.font)), 'Шрифт меняется на панели инструментов');
        colourRow('ЦветТекста', fmt.textColor, function (value) { format({ textColor: value }); }, 'A');
        colourRow('ЦветФона', fmt.backColor, function (value) { format({ backColor: value }); }, '■');
        colourRow('ЦветУзора', fmt.patternColor, function (value) { format({ patternColor: value }); }, '▨');
        panelNote(DASH_NOTE);
        borderRow('ГраницаСлева', 'leftBorder', info.borders && info.borders.left);
        borderRow('ГраницаСверху', 'topBorder', info.borders && info.borders.top);
        borderRow('ГраницаСправа', 'rightBorder', info.borders && info.borders.right);
        borderRow('ГраницаСнизу', 'bottomBorder', info.borders && info.borders.bottom);

        group('Размер');
        row('ШиринаКолонки', number(info.size && info.size.width,
            function (value) { size({ width: value == null ? null : value }); },
            false, function () { return session.currentSize ? session.currentSize('width') : 0; }),
            'В единицах 1С; пусто — ширина по умолчанию');
        row('ВысотаСтроки', number(info.size && info.size.height,
            function (value) { size({ height: value == null ? null : value }); },
            false, function () { return session.currentSize ? session.currentSize('height') : 0; }),
            'В пунктах; пусто — автоматическая высота');
    }

    draw();

    return {
        element: host,
        refresh: render,
        /* The sheet is rebuilt after every edit and the session with it; the
         * panel outlives both so the field under the hand survives. */
        setSession: function (next) {
            if (next) session = next;
        },
        /* The same writes a row performs, for a host with its own way in and
         * for the tests, which cannot dispatch a change event. */
        format: format,
        content: content,
        size: size,
        current: current
    };
}

root.TemplateEdit = {
    select: { cells: cells, rows: rows, columns: columns, sheet: sheet, extendTo: extendTo },
    rectOf: rectOf,
    rangeArgs: rangeArgs,
    dirtyOf: dirtyOf,
    unionDirty: unionDirty,
    isSingleCell: isSingleCell,
    attach: attach,
    toolbar: toolbar,
    properties: properties,
    colourControl: colourControl,
    _test: { sameByteOrderMark: sameByteOrderMark, rgbToHsv: rgbToHsv, hsvToRgb: hsvToRgb, rgbToHex: rgbToHex, hexToRgb: hexToRgb }
};

})(typeof window !== 'undefined' ? window : globalThis);
