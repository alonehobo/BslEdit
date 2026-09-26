/* Markup editing of a 1C spreadsheet template (Ext/Template.xml): named areas,
 * parameter and template cells. Used by the MCP tools set_area, set_parameter
 * and list_markup, so an agent marks up a converted print form and checks the
 * result in the preview without touching the XML by hand.
 *
 * Works on the XML text in the browser and in Node alike. The document is read
 * into a plain element tree that keeps prefixes, attribute order and the
 * Designer's tab indentation on output, so an edit changes only what it must.
 *
 * Rows and columns in the public API are 1-based, as the preview and the
 * configurator number them; the XML stores them 0-based. */
(function (root) {
'use strict';

/* Designer's Template.xml starts with a byte order mark. */
var BOM = String.fromCharCode(0xFEFF);

/* ---------- XML tree ---------- */

function decode(s) {
    if (s.indexOf('&') < 0) return s;
    return s.replace(/&(#x[0-9a-fA-F]+|#\d+|lt|gt|amp|quot|apos);/g, function (m, e) {
        if (e === 'lt') return '<';
        if (e === 'gt') return '>';
        if (e === 'amp') return '&';
        if (e === 'quot') return '"';
        if (e === 'apos') return "'";
        return String.fromCodePoint(e.charAt(1) === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    });
}
function encodeText(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function encodeAttr(s) {
    return encodeText(s).replace(/"/g, '&quot;');
}

/* Element: { tag (qualified), name (local), attrs: [[k, v]], kids, text }. */
function parse(xml) {
    xml = String(xml);
    var doc ={ tag: '#document', name: '#document', attrs: [], kids: [], text: '' };
    var stack = [doc];
    var re = /<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[^\s=\/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|<!\[CDATA\[([\s\S]*?)\]\]>|<[?!][\s\S]*?>|([^<]+)/g;
    var m;
    while ((m = re.exec(xml))) {
        var top = stack[stack.length - 1];
        if (m[6] != null) { top.text += decode(m[6]); continue; }
        if (m[5] != null) { top.text += m[5]; continue; }
        if (!m[2]) continue;
        if (m[1]) {
            if (stack.length > 1) stack.pop();
            continue;
        }
        var attrs = [];
        var ar = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
        var a;
        while ((a = ar.exec(m[3]))) attrs.push([a[1], decode(a[2] != null ? a[2] : a[3])]);
        var el = { tag: m[2], name: m[2].slice(m[2].indexOf(':') + 1), attrs: attrs, kids: [], text: '' };
        top.kids.push(el);
        if (!m[4]) stack.push(el);
    }
    var rootEl = doc.kids[0];
    if (!rootEl || rootEl.name !== 'document') throw new Error('Это не табличный документ: нет корневого элемента document.');
    return rootEl;
}

/* eol separates elements only: text inside an element keeps its own line
 * breaks, which Designer leaves as LF even in a CRLF file. */
function serialize(el, depth, eol) {
    eol = eol || '\n';
    var pad = new Array(depth + 1).join('\t');
    var open = '<' + el.tag + el.attrs.map(function (a) { return ' ' + a[0] + '="' + encodeAttr(a[1]) + '"'; }).join('');
    if (el.kids.length) {
        return pad + open + '>' + eol + el.kids.map(function (k) { return serialize(k, depth + 1, eol); }).join('') + pad + '</' + el.tag + '>' + eol;
    }
    if (el.text === '' && !el.keepOpen) return pad + open + '/>' + eol;
    return pad + open + '>' + encodeText(el.text) + '</' + el.tag + '>' + eol;
}

/* Designer writes no newline after </document>; line endings follow the source. */
function toXml(rootEl, source) {
    var eol = /^[^\n]*\r\n/.test(source || '') ? '\r\n' : '\n';
    return BOM + '<?xml version="1.0" encoding="UTF-8"?>' + eol + serialize(rootEl, 0, eol).slice(0, -eol.length);
}

function node(tag, text, kids) {
    return { tag: tag, name: tag.slice(tag.indexOf(':') + 1), attrs: [], kids: kids || [], text: text == null ? '' : String(text), keepOpen: text != null };
}
function kid(el, name) {
    for (var i = 0; el && i < el.kids.length; i++) if (el.kids[i].name === name) return el.kids[i];
    return null;
}
function kids(el, name) {
    return el ? el.kids.filter(function (k) { return k.name === name; }) : [];
}
function intOf(el, dflt) {
    var n = el ? parseInt(el.text, 10) : NaN;
    return isNaN(n) ? dflt : n;
}
/* Text of a <tl> in the template's language, falling back to the first item. */
function localizedText(tl, lang) {
    var items = kids(tl, 'item');
    var pick = items.filter(function (it) { return kid(it, 'lang') && kid(it, 'lang').text === lang; })[0] || items[0];
    var content = pick && kid(pick, 'content');
    return content ? content.text : '';
}

/* ---------- template model helpers ---------- */

/* Element order inside <format>, derived from templates the configurator wrote. */
var FORMAT_ORDER = ['font', 'leftBorder', 'topBorder', 'rightBorder', 'bottomBorder', 'border', 'borderColor', 'height', 'width',
    'widthWeightFactor', 'horizontalAlignment', 'drawingBorder', 'verticalAlignment', 'textColor', 'backColor', 'patternColor',
    'pattern', 'textPlacement', 'fillType', 'protection', 'hidden', 'textOrientation', 'detailsUse', 'bySelectedColumns', 'markNegatives',
    'containsValue', 'valueType', 'format', 'hyperLink', 'picIndex', 'controlType', 'autoMarkIncomplete', 'markIncomplete',
    'indent', 'autoIndent', 'editFormat', 'columnSizeChange', 'mask', 'pictureSizeMode', 'picHorizontalAlignment',
    'picVerticalAlignment', 'textPosition', 'leftMargin', 'topMargin', 'rightMargin', 'bottomMargin'];

function formats(doc) { return kids(doc, 'format'); }

function languageOf(doc) {
    var ls = kid(doc, 'languageSettings');
    var cur = ls && kid(ls, 'defaultLanguage');
    return cur && cur.text ? cur.text : 'ru';
}

function insertAfterLast(doc, el, afterNames, beforeNames) {
    var idx = -1;
    doc.kids.forEach(function (k, i) { if (afterNames.indexOf(k.name) >= 0) idx = i; });
    if (idx < 0) {
        for (var i = 0; i < doc.kids.length; i++) {
            if (beforeNames.indexOf(doc.kids[i].name) >= 0) { idx = i - 1; break; }
        }
        if (idx < 0 && !doc.kids.some(function (k) { return beforeNames.indexOf(k.name) >= 0; })) idx = doc.kids.length - 1;
    }
    doc.kids.splice(idx + 1, 0, el);
}

/* The row element for a 0-based index, splitting an <indexTo> range so the
 * edit touches one row only. Creates the row when it does not exist. */
function rowFor(doc, index) {
    var items = kids(doc, 'rowsItem');
    for (var i = 0; i < items.length; i++) {
        var item = items[i];
        var from = intOf(kid(item, 'index'), -1);
        var toEl = kid(item, 'indexTo');
        var to = toEl ? intOf(toEl, from) : from;
        if (index < from || index > to) continue;
        if (from === to) return kid(item, 'row') || addRow(item);
        var pos = doc.kids.indexOf(item);
        var pieces = [];
        if (index > from) pieces.push(rangeItem(item, from, index - 1));
        var single = rangeItem(item, index, index);
        pieces.push(single);
        if (index < to) pieces.push(rangeItem(item, index + 1, to));
        doc.kids.splice.apply(doc.kids, [pos, 1].concat(pieces));
        return kid(single, 'row');
    }
    var fresh = node('rowsItem', null, [node('index', index), node('row', null, [])]);
    var after = -1;
    doc.kids.forEach(function (k, j) {
        if (k.name === 'columns') after = Math.max(after, j);
        if (k.name === 'rowsItem' && intOf(kid(k, 'index'), 0) < index) after = j;
    });
    doc.kids.splice(after + 1, 0, fresh);
    growHeight(doc, index + 1);
    return kid(fresh, 'row');
}

function addRow(item) {
    var row = node('row', null, []);
    item.kids.push(row);
    return row;
}

function rangeItem(item, from, to) {
    var copy = JSON.parse(JSON.stringify(item));
    copy.kids = copy.kids.filter(function (k) { return k.name !== 'index' && k.name !== 'indexTo'; });
    var head = [node('index', from)];
    if (to !== from) head.push(node('indexTo', to));
    copy.kids = head.concat(copy.kids);
    return copy;
}

function growHeight(doc, rows) {
    ['height', 'vgRows'].forEach(function (name) {
        var el = kid(doc, name);
        if (el && intOf(el, 0) < rows) el.text = String(rows);
    });
}

/* Cells of a row as [{ col, group }] where group is the outer <c>. */
function rowCells(row) {
    var out = [];
    var col = 0;
    kids(row, 'c').forEach(function (group) {
        var i = kid(group, 'i');
        if (i) col = intOf(i, col);
        out.push({ col: col, group: group });
        col++;
    });
    return out;
}

/* Re-emit the row's cells in column order with <i> wherever the implicit
 * running index would be wrong. */
function writeRowCells(row, cells) {
    cells.sort(function (a, b) { return a.col - b.col; });
    var rest = row.kids.filter(function (k) { return k.name !== 'c' && k.name !== 'empty'; });
    var expected = 0;
    var groups = cells.map(function (cell) {
        cell.group.kids = cell.group.kids.filter(function (k) { return k.name !== 'i'; });
        if (cell.col !== expected) cell.group.kids.unshift(node('i', cell.col));
        expected = cell.col + 1;
        return cell.group;
    });
    row.kids = rest.concat(groups);
    if (!groups.length) row.kids.push(node('empty', 'true'));
}

function cellContent(group) {
    return kid(group, 'c') || (function () {
        var c = node('c', null, []);
        group.kids.push(c);
        return c;
    })();
}

/* The column set an element (row, area) is laid out in: its columnsID, or
 * the first set when it names none — the way validateTemplate reads it. */
function columnSetFor(doc, el) {
    var sets = kids(doc, 'columns');
    var id = el && kid(el, 'columnsID') ? kid(el, 'columnsID').text : '';
    if (!id) return sets[0] || null;
    return sets.filter(function (s) { return kid(s, 'id') && kid(s, 'id').text === id; })[0] || null;
}

function growColumns(set, cols) {
    var size = set && kid(set, 'size');
    if (size && intOf(size, 0) < cols) size.text = String(cols);
}

function columnCount(doc) {
    var size = 0;
    kids(doc, 'columns').forEach(function (set) { size = Math.max(size, intOf(kid(set, 'size'), 0)); });
    return size;
}

/* A copy of format `index` (1-based, 0 = none) with some properties set or
 * (value null) removed, deduplicated against the existing list. Properties go
 * where Designer writes them. Returns the 1-based index. */
function formatWith(doc, index, changes) {
    var list = formats(doc);
    var base = index > 0 && list[index - 1] ? JSON.parse(JSON.stringify(list[index - 1])) : node('format', null, []);
    Object.keys(changes).forEach(function (name) {
        base.kids = base.kids.filter(function (k) { return k.name !== name; });
        var value = changes[name];
        if (value == null) return;
        var el = typeof value === 'object' ? value : node(name, value);
        var rank = FORMAT_ORDER.indexOf(name);
        var at = base.kids.length;
        for (var i = 0; rank >= 0 && i < base.kids.length; i++) {
            var r = FORMAT_ORDER.indexOf(base.kids[i].name);
            if (r > rank) { at = i; break; }
        }
        base.kids.splice(at, 0, el);
    });
    var key = serialize(base, 0);
    for (var j = 0; j < list.length; j++) {
        if (serialize(list[j], 0) === key) return j + 1;
    }
    insertAfterLast(doc, base, ['format'], []);
    return list.length + 1;
}

function formatWithFill(doc, index, fillType) {
    return formatWith(doc, index, { fillType: fillType || null });
}

function requirePosition(value, label) {
    var n = Number(value);
    if (!Number.isInteger(n) || n < 1) throw new Error(label + ' должен быть целым числом от 1.');
    return n;
}

function validName(name) {
    return /^[A-Za-zА-Яа-яЁё_][0-9A-Za-zА-Яа-яЁё_]*$/.test(name);
}

/* ---------- public operations ---------- */

/* Parameter names inside a template text; numeric footnote marks like [5] in
 * official forms are not parameters. */
function templateNames(text) {
    var out = [];
    String(text || '').replace(/\[([^\[\]]+)\]/g, function (m, name) {
        name = name.trim();
        if (!/^\d+$/.test(name) && name.charAt(0) !== '&' && out.indexOf(name) < 0) out.push(name);
        return m;
    });
    return out;
}

/* Everything an agent needs to write the print procedure: areas top to bottom
 * with the parameters they carry, Rows × Columns intersections for GetArea,
 * detail (drill-down) parameters and the names hidden inside template texts. */
function listMarkup(xml) {
    var doc = parse(xml);
    var list = formats(doc);
    var lang = languageOf(doc);
    var result = { rows: intOf(kid(doc, 'height'), 0), columns: columnCount(doc), areas: [], parameters: [], templates: [], intersections: [] };
    var sets = kids(doc, 'columns');
    if (sets.length > 1) {
        result.columnSets = sets.map(function (s) { return { id: kid(s, 'id') ? kid(s, 'id').text : '', size: intOf(kid(s, 'size'), 0) }; });
    }
    kids(doc, 'namedItem').forEach(function (item) {
        var area = kid(item, 'area');
        var entry = { name: kid(item, 'name') ? kid(item, 'name').text : '' };
        if (!area) { entry.type = 'Drawing'; result.areas.push(entry); return; }
        entry.type = kid(area, 'type') ? kid(area, 'type').text : 'Rows';
        var br = intOf(kid(area, 'beginRow'), -1), er = intOf(kid(area, 'endRow'), -1);
        var bc = intOf(kid(area, 'beginColumn'), -1), ec = intOf(kid(area, 'endColumn'), -1);
        if (br >= 0) { entry.beginRow = br + 1; entry.endRow = er + 1; }
        if (bc >= 0) { entry.beginColumn = bc + 1; entry.endColumn = ec + 1; }
        result.areas.push(entry);
    });
    result.areas.sort(function (a, b) {
        var ka = a.beginRow != null ? a.beginRow : Infinity, kb = b.beginRow != null ? b.beginRow : Infinity;
        return ka !== kb ? ka - kb : (a.beginColumn || 0) - (b.beginColumn || 0);
    });
    function areasAt(row, column) {
        return result.areas.filter(function (a) {
            if (a.type === 'Drawing') return false;
            var inRows = a.beginRow == null || (row >= a.beginRow && row <= a.endRow);
            var inCols = a.beginColumn == null || (column >= a.beginColumn && column <= a.endColumn);
            return inRows && inCols && a.type !== 'Columns';
        }).map(function (a) { return a.name; });
    }
    kids(doc, 'rowsItem').forEach(function (item) {
        var r = intOf(kid(item, 'index'), 0);
        rowCells(kid(item, 'row') || node('row')).forEach(function (cell) {
            var content = kid(cell.group, 'c');
            if (!content) return;
            var f = list[intOf(kid(content, 'f'), 0) - 1];
            var fill = f && kid(f, 'fillType') ? kid(f, 'fillType').text : '';
            var param = kid(content, 'parameter');
            var detail = kid(content, 'detailParameter');
            var at = { row: r + 1, column: cell.col + 1 };
            var entry;
            if (fill === 'Parameter' || param) {
                entry = { row: at.row, column: at.column, name: param ? param.text : '' };
                result.parameters.push(entry);
            } else if (fill === 'Template') {
                var text = localizedText(kid(content, 'tl'), lang);
                entry = { row: at.row, column: at.column, text: text, names: templateNames(text) };
                result.templates.push(entry);
            } else if (detail) {
                entry = { row: at.row, column: at.column, name: '' };
                result.parameters.push(entry);
            }
            if (!entry) return;
            if (detail && detail.text) entry.detail = detail.text;
            var owners = areasAt(at.row, at.column);
            if (owners.length) entry.areas = owners;
        });
    });
    result.areas.forEach(function (a) {
        if (a.type === 'Drawing' || a.type === 'Columns') return;
        var inside = function (e) { return (e.areas || []).indexOf(a.name) >= 0; };
        var names = [];
        result.parameters.filter(inside).forEach(function (p) { if (p.name && names.indexOf(p.name) < 0) names.push(p.name); });
        result.templates.filter(inside).forEach(function (t) { t.names.forEach(function (n) { if (names.indexOf(n) < 0) names.push(n); }); });
        a.parameters = names;
    });
    var ps = kid(doc, 'printSettings');
    var pa = kid(doc, 'printArea');
    var print = {};
    if (ps) {
        print.settings = {};
        ps.kids.forEach(function (k) { if (k.name !== 'printerName') print.settings[k.name] = k.text; });
    }
    if (pa) {
        print.area = { type: kid(pa, 'type') ? kid(pa, 'type').text : '' };
        if (intOf(kid(pa, 'beginRow'), -1) >= 0) { print.area.beginRow = intOf(kid(pa, 'beginRow'), 0) + 1; print.area.endRow = intOf(kid(pa, 'endRow'), 0) + 1; }
        if (intOf(kid(pa, 'beginColumn'), -1) >= 0) { print.area.beginColumn = intOf(kid(pa, 'beginColumn'), 0) + 1; print.area.endColumn = intOf(kid(pa, 'endColumn'), 0) + 1; }
    }
    ['Header', 'Footer'].forEach(function (kind) {
        var texts = {};
        ['left', 'center', 'right'].forEach(function (slot) {
            var el = kid(doc, slot + kind);
            var text = el ? localizedText(kid(el, 'tl'), lang) : '';
            if (text) texts[slot] = text;
        });
        if (Object.keys(texts).length) print[kind.toLowerCase()] = texts;
    });
    if (Object.keys(print).length) result.print = print;

    result.areas.filter(function (a) { return a.type === 'Rows'; }).forEach(function (rows) {
        result.areas.filter(function (a) { return a.type === 'Columns'; }).forEach(function (cols) {
            result.intersections.push(rows.name + '|' + cols.name);
        });
    });
    return result;
}

/* Structural checks before the template goes to the configurator: indexes
 * point at existing formats, fonts and lines, cells and merges stay inside the
 * document, areas are well-formed and uniquely named. */
function validateTemplate(xml) {
    var doc = parse(xml);
    var errors = [];
    var warnings = [];
    var list = formats(doc);
    var fonts = kids(doc, 'font').length;
    var lines = kids(doc, 'line').length;
    var pictures = kids(doc, 'picture').length;
    var heightEl = kid(doc, 'height');
    var height = intOf(heightEl, -1);
    if (!heightEl || height < 1) errors.push('Нет или неверная высота документа <height>.');
    var vg = kid(doc, 'vgRows');
    if (vg && intOf(vg, 0) > height) warnings.push('vgRows (' + vg.text + ') больше height (' + height + ').');

    function checkFormat(idx, where) {
        if (idx == null) return;
        if (!(idx >= 0 && idx <= list.length)) errors.push(where + ': формат ' + idx + ' не существует (форматов ' + list.length + ').');
    }
    var sets = {};
    kids(doc, 'columns').forEach(function (s, i) {
        var id = kid(s, 'id') ? kid(s, 'id').text : '';
        if (sets[id] != null) errors.push('Набор колонок ' + (id || 'по умолчанию') + ' объявлен дважды.');
        var size = intOf(kid(s, 'size'), -1);
        if (size < 1) errors.push('Набор колонок ' + (id || 'по умолчанию') + ': неверный size.');
        sets[id] = size;
        if (i === 0 && sets[''] == null) sets[''] = size;
        kids(s, 'columnsItem').forEach(function (item) {
            var idx = intOf(kid(item, 'index'), -1);
            if (idx < 0 || idx >= size) warnings.push('Колонка ' + (idx + 1) + ' вне набора ' + (id || 'по умолчанию') + ' (' + size + ').');
            var col = kid(item, 'column');
            if (col && kid(col, 'formatIndex')) checkFormat(intOf(kid(col, 'formatIndex'), -1), 'Колонка ' + (idx + 1));
        });
    });
    function sizeOf(id, where) {
        if (sets[id || ''] == null) { errors.push(where + ': нет набора колонок ' + id + '.'); return Infinity; }
        return sets[id || ''];
    }
    if (kid(doc, 'defaultFormatIndex')) checkFormat(intOf(kid(doc, 'defaultFormatIndex'), -1), 'defaultFormatIndex');

    var lastIndex = -1;
    kids(doc, 'rowsItem').forEach(function (item) {
        var from = intOf(kid(item, 'index'), -1);
        var to = kid(item, 'indexTo') ? intOf(kid(item, 'indexTo'), -1) : from;
        var label = 'Строка ' + (from + 1);
        if (from < 0 || to < from) { errors.push(label + ': неверный диапазон index/indexTo.'); return; }
        if (from <= lastIndex) errors.push(label + ': строки идут не по порядку или повторяются.');
        lastIndex = to;
        if (to >= height) errors.push(label + ': за пределами высоты документа (' + height + ').');
        var row = kid(item, 'row');
        if (!row) return;
        var size = sizeOf(kid(row, 'columnsID') ? kid(row, 'columnsID').text : '', label);
        if (kid(row, 'formatIndex')) checkFormat(intOf(kid(row, 'formatIndex'), -1), label);
        rowCells(row).forEach(function (cell) {
            var at = 'Ячейка ' + (from + 1) + ':' + (cell.col + 1);
            if (cell.col >= size) errors.push(at + ': за пределами набора колонок (' + size + ').');
            var content = kid(cell.group, 'c');
            if (!content) return;
            var f = kid(content, 'f') ? intOf(kid(content, 'f'), -1) : null;
            checkFormat(f, at);
            var fmt = f > 0 ? list[f - 1] : null;
            var fill = fmt && kid(fmt, 'fillType') ? kid(fmt, 'fillType').text : '';
            var param = kid(content, 'parameter');
            if (fill === 'Parameter' && (!param || !param.text)) warnings.push(at + ': ячейка-параметр без имени параметра.');
            if (param && param.text && !validName(param.text)) errors.push(at + ': имя параметра «' + param.text + '» не идентификатор.');
            if (fill === 'Template' && !templateNames(localizedText(kid(content, 'tl'), languageOf(doc))).length) {
                warnings.push(at + ': шаблон без [Параметров].');
            }
        });
    });

    list.forEach(function (fmt, i) {
        var label = 'Формат ' + (i + 1);
        var font = kid(fmt, 'font');
        if (font && !(intOf(font, -1) >= 0 && intOf(font, -1) < fonts)) errors.push(label + ': шрифт ' + font.text + ' не существует (шрифтов ' + fonts + ').');
        ['border', 'leftBorder', 'topBorder', 'rightBorder', 'bottomBorder', 'drawingBorder'].forEach(function (name) {
            var el = kid(fmt, name);
            if (el && !(intOf(el, -1) >= 0 && intOf(el, -1) < lines)) errors.push(label + ': линия ' + name + '=' + el.text + ' не существует (линий ' + lines + ').');
        });
    });

    /* A merge without columnsID uses the column set of the row it starts on. */
    var rowSet = {};
    kids(doc, 'rowsItem').forEach(function (item) {
        var row = kid(item, 'row');
        var from = intOf(kid(item, 'index'), 0);
        var to = kid(item, 'indexTo') ? intOf(kid(item, 'indexTo'), from) : from;
        for (var r = from; r <= to && r - from < 100000; r++) rowSet[r] = row && kid(row, 'columnsID') ? kid(row, 'columnsID').text : '';
    });
    var rects = [];
    kids(doc, 'merge').forEach(function (m) {
        var x = mergeRect(m);
        var id = kid(m, 'columnsID') ? kid(m, 'columnsID').text : (rowSet[x.r] || '');
        var label = 'Объединение ' + (x.r + 1) + ':' + (x.c + 1);
        if (x.r < 0) return;
        if (x.r + x.h >= height) errors.push(label + ': выходит за высоту документа.');
        if (x.c + x.w >= sizeOf(id, label)) errors.push(label + ': выходит за набор колонок.');
        rects.forEach(function (y) {
            if (y.id === id && x.r <= y.r + y.h && y.r <= x.r + x.h && x.c <= y.c + y.w && y.c <= x.c + x.w) {
                warnings.push(label + ': пересекается с объединением ' + (y.r + 1) + ':' + (y.c + 1) + '.');
            }
        });
        x.id = id;
        rects.push(x);
    });

    var names = {};
    kids(doc, 'namedItem').forEach(function (item) {
        var name = kid(item, 'name') ? kid(item, 'name').text : '';
        var label = 'Область «' + name + '»';
        if (!validName(name)) errors.push(label + ': имя не идентификатор 1С.');
        if (names[name]) errors.push(label + ': имя повторяется.');
        names[name] = true;
        var area = kid(item, 'area');
        if (!area) return;
        var type = kid(area, 'type') ? kid(area, 'type').text : '';
        var br = intOf(kid(area, 'beginRow'), -1), er = intOf(kid(area, 'endRow'), -1);
        var bc = intOf(kid(area, 'beginColumn'), -1), ec = intOf(kid(area, 'endColumn'), -1);
        var size = sizeOf(kid(area, 'columnsID') ? kid(area, 'columnsID').text : '', label);
        if (['Rows', 'Columns', 'Rectangle'].indexOf(type) < 0) errors.push(label + ': неизвестный тип ' + type + '.');
        if (type !== 'Columns' && (br < 0 || er < br || er >= height)) errors.push(label + ': неверные строки ' + (br + 1) + '–' + (er + 1) + '.');
        if (type !== 'Rows' && (bc < 0 || ec < bc || ec >= size)) errors.push(label + ': неверные колонки ' + (bc + 1) + '–' + (ec + 1) + '.');
        if (type === 'Rows' && (bc !== -1 || ec !== -1)) warnings.push(label + ': у области строк заданы колонки.');
        if (type === 'Columns' && (br !== -1 || er !== -1)) warnings.push(label + ': у области колонок заданы строки.');
    });

    var printArea = kid(doc, 'printArea');
    if (printArea) {
        var pr0 = intOf(kid(printArea, 'beginRow'), -1), pr1 = intOf(kid(printArea, 'endRow'), -1);
        if (pr0 >= 0 && (pr1 < pr0 || pr1 >= height)) errors.push('Область печати: неверные строки ' + (pr0 + 1) + '–' + (pr1 + 1) + '.');
    }
    var printSettings = kid(doc, 'printSettings');
    if (printSettings && kid(printSettings, 'scale')) {
        var sc = intOf(kid(printSettings, 'scale'), 0);
        if (sc < 10 || sc > 400) warnings.push('Масштаб печати ' + sc + ' вне 10–400.');
    }

    kids(doc, 'drawing').forEach(function (d, i) {
        var label = 'Рисунок ' + (i + 1);
        if (kid(d, 'formatIndex')) checkFormat(intOf(kid(d, 'formatIndex'), -1), label);
        var pic = kid(d, 'pictureIndex');
        if (pic && !(intOf(pic, 0) >= 1 && intOf(pic, 0) <= pictures)) errors.push(label + ': картинка ' + pic.text + ' не существует.');
        if (intOf(kid(d, 'endRow'), 0) >= height) warnings.push(label + ': заходит за высоту документа.');
    });

    return { ok: errors.length === 0, errors: errors, warnings: warnings };
}

/* setArea(xml, { name, beginRow, endRow, beginColumn, endColumn, remove })
 * Rows only → Rows area, columns only → Columns, both → Rectangle. */
function setArea(xml, args) {
    var doc = parse(xml);
    var name = String(args.name || '').trim();
    if (!validName(name)) throw new Error('Имя области должно быть идентификатором 1С: «' + name + '».');
    var existing = kids(doc, 'namedItem').filter(function (item) { return kid(item, 'name') && kid(item, 'name').text === name; });
    existing.forEach(function (item) { doc.kids.splice(doc.kids.indexOf(item), 1); });
    if (args.remove) {
        if (!existing.length) throw new Error('В макете нет области «' + name + '».');
        return { xml: toXml(doc, xml), result: { removed: name } };
    }
    var hasRows = args.beginRow != null || args.endRow != null;
    var hasCols = args.beginColumn != null || args.endColumn != null;
    if (!hasRows && !hasCols) throw new Error('Укажите строки (begin_row/end_row) и/или колонки (begin_column/end_column).');
    var br = -1, er = -1, bc = -1, ec = -1;
    if (hasRows) {
        br = requirePosition(args.beginRow != null ? args.beginRow : args.endRow, 'begin_row') - 1;
        er = requirePosition(args.endRow != null ? args.endRow : args.beginRow, 'end_row') - 1;
        if (er < br) throw new Error('end_row меньше begin_row.');
    }
    if (hasCols) {
        bc = requirePosition(args.beginColumn != null ? args.beginColumn : args.endColumn, 'begin_column') - 1;
        ec = requirePosition(args.endColumn != null ? args.endColumn : args.beginColumn, 'end_column') - 1;
        if (ec < bc) throw new Error('end_column меньше begin_column.');
    }
    var type = hasRows && hasCols ? 'Rectangle' : hasRows ? 'Rows' : 'Columns';
    var item = node('namedItem', null, [
        node('name', name),
        node('area', null, [node('type', type), node('beginRow', br), node('endRow', er), node('beginColumn', bc), node('endColumn', ec)])
    ]);
    item.attrs.push(['xsi:type', 'NamedItemCells']);
    insertAfterLast(doc, item, ['namedItem', 'merge', 'verticalUnmerge'], ['line', 'font', 'format', 'picture']);
    if (hasRows) growHeight(doc, er + 1);
    if (hasCols) growColumns(columnSetFor(doc, null), ec + 1);
    var entry = { name: name, type: type };
    if (hasRows) { entry.beginRow = br + 1; entry.endRow = er + 1; }
    if (hasCols) { entry.beginColumn = bc + 1; entry.endColumn = ec + 1; }
    return { xml: toXml(doc, xml), result: { area: entry, replaced: existing.length > 0 } };
}

/* setParameter(xml, { row, column, name, template, text, detail })
 * - name: the cell becomes a parameter (its text is dropped);
 * - template: the cell shows the text with [Имя] parameters inside;
 * - text: the cell becomes plain text again (name and template omitted).
 *
 * An empty `name` or `template` is a kind too, not a missing argument: the
 * Designer lets a cell be a parameter before it has a name — the sheet draws
 * «<>» there — and a template before anything is written into it. The fill
 * type is a property of the cell, and it is set by the argument that names it,
 * so a template without a single [Имя] is legal: it prints its own text. */
/* Items of a <tl> with the template's language set to value. The other
 * languages are translations of the same cell and stay as they were, like
 * the Designer keeps them when one language is edited. */
function withTranslation(tl, lang, value) {
    var items = tl ? kids(tl, 'item') : [];
    var replaced = false;
    var out = items.map(function (it) {
        if (replaced || !kid(it, 'lang') || kid(it, 'lang').text !== lang) return it;
        replaced = true;
        return node('v8:item', null, [node('v8:lang', lang), node('v8:content', value)]);
    });
    if (!replaced) out.unshift(node('v8:item', null, [node('v8:lang', lang), node('v8:content', value)]));
    return out;
}

function setParameter(xml, args) {
    var doc = parse(xml);
    var r = requirePosition(args.row, 'row') - 1;
    var c = requirePosition(args.column, 'column') - 1;
    var hasName = args.name != null;
    var name = hasName ? String(args.name).trim() : '';
    var hasTemplate = args.template != null;
    var hasText = args.text != null;
    var hasDetail = args.detail != null;
    var detail = hasDetail ? String(args.detail).trim() : '';
    var kinds = [hasName, hasTemplate, hasText].filter(Boolean).length;
    if (kinds > 1 || (kinds === 0 && !hasDetail)) {
        throw new Error('Передайте одно из: name (параметр), template (шаблон с [Имя]) или text (обычный текст); detail можно задать вместе с ними или отдельно.');
    }
    if (name && !validName(name)) throw new Error('Имя параметра должно быть идентификатором 1С: «' + name + '».');
    if (detail && !validName(detail)) throw new Error('Имя параметра расшифровки должно быть идентификатором 1С: «' + detail + '».');

    var row = rowFor(doc, r);
    var cells = rowCells(row);
    var cell = cells.filter(function (x) { return x.col === c; })[0];
    if (!cell) {
        cell = { col: c, group: node('c', null, [node('c', null, [])]) };
        cells.push(cell);
    }
    var content = cellContent(cell.group);
    var fEl = kid(content, 'f');
    var lang = languageOf(doc);
    var previous = {
        text: localizedText(kid(content, 'tl'), lang),
        parameter: kid(content, 'parameter') ? kid(content, 'parameter').text : '',
        detail: kid(content, 'detailParameter') ? kid(content, 'detailParameter').text : ''
    };
    var fill;
    var head;
    if (kinds) {
        fill = hasName ? 'Parameter' : hasTemplate ? 'Template' : '';
        head = [node('f', formatWithFill(doc, fEl ? intOf(fEl, 0) : 0, fill))];
        if (hasName) { if (name) head.push(node('parameter', name)); }
        else {
            var value = hasTemplate ? String(args.template) : String(args.text);
            if (value !== '') head.push(node('tl', null, withTranslation(kid(content, 'tl'), lang, value)));
        }
    } else {
        /* detail only: the cell keeps what it shows. */
        head = content.kids.filter(function (k) { return ['f', 'tl', 'parameter'].indexOf(k.name) >= 0; });
        var f = fEl ? intOf(fEl, 0) : 0;
        var fmt = f > 0 ? formats(doc)[f - 1] : null;
        fill = fmt && kid(fmt, 'fillType') ? kid(fmt, 'fillType').text : '';
    }
    var keep = content.kids.filter(function (k) { return ['f', 'tl', 'parameter', 'detailParameter'].indexOf(k.name) < 0; });
    var detailEl = hasDetail ? (detail ? [node('detailParameter', detail)] : [])
        : content.kids.filter(function (k) { return k.name === 'detailParameter'; });
    content.kids = head.concat(detailEl, keep);
    writeRowCells(row, cells);
    growColumns(columnSetFor(doc, row), c + 1);
    return {
        xml: toXml(doc, xml),
        result: { row: r + 1, column: c + 1, fillType: fill || 'Text', parameter: name || undefined,
            template: hasTemplate ? String(args.template) : undefined, detail: hasDetail ? detail || null : undefined, previous: previous }
    };
}

/* ---------- structure: rows and columns ---------- */

function setInt(el, name, value) {
    var k = kid(el, name);
    if (k) k.text = String(value);
}

function requireCount(value) {
    if (value == null) return 1;
    var n = Number(value);
    if (!Number.isInteger(n) || n < 1) throw new Error('count должен быть целым числом от 1.');
    return n;
}

function documentHeight(doc) {
    return intOf(kid(doc, 'height'), 0);
}

function setHeight(doc, rows) {
    ['height', 'vgRows'].forEach(function (name) {
        var el = kid(doc, name);
        if (el) el.text = String(Math.max(rows, name === 'height' ? 1 : 0));
    });
}

/* Break every rowsItem range that straddles `at`, so rows before and from `at`
 * live in separate items. */
/* A rowsItem copy that keeps only how its cells look: each cell keeps its
 * <f>, cells without one are dropped. */
function blankCopy(item) {
    var row = kid(item, 'row');
    if (!row) return item;
    var cells = rowCells(row).filter(function (cell) {
        var f = kid(cellContent(cell.group), 'f');
        if (!f || intOf(f, 0) <= 0) return false;
        cell.group.kids = [node('c', null, [node('f', f.text)])];
        return true;
    });
    writeRowCells(row, cells);
    return item;
}

function splitRangeAt(doc, at) {
    kids(doc, 'rowsItem').forEach(function (item) {
        var from = intOf(kid(item, 'index'), 0);
        var toEl = kid(item, 'indexTo');
        var to = toEl ? intOf(toEl, from) : from;
        if (from < at && at <= to) {
            var pos = doc.kids.indexOf(item);
            doc.kids.splice(pos, 1, rangeItem(item, from, at - 1), rangeItem(item, at, to));
        }
    });
}

/* Shift a [begin, begin + extent] span on one axis when `count` rows (or
 * columns) are inserted at `at` (count > 0) or removed from `at` (count < 0).
 * Returns null when a removal swallows the span. */
function shiftSpan(begin, extent, at, count) {
    var end = begin + extent;
    if (count > 0) {
        if (begin >= at) return { begin: begin + count, extent: extent };
        if (end >= at) return { begin: begin, extent: extent + count };
        return { begin: begin, extent: extent };
    }
    var gone = -count;
    var last = at + gone - 1;
    if (end < at) return { begin: begin, extent: extent };
    if (begin > last) return { begin: begin - gone, extent: extent };
    var keptBefore = Math.max(0, at - begin);
    var keptAfter = Math.max(0, end - last);
    if (keptBefore + keptAfter === 0) return null;
    return { begin: Math.min(begin, at), extent: keptBefore + keptAfter - 1 };
}

function removeKid(doc, el) {
    var i = doc.kids.indexOf(el);
    if (i >= 0) doc.kids.splice(i, 1);
}

/* insertRows / deleteRows: { at (1-based), count }. Everything below moves;
 * merges, areas and drawings that cross the edit grow or shrink with it. */
function shiftRows(xml, args, insert) {
    var doc = parse(xml);
    var at = requirePosition(args.at, 'at') - 1;
    var count = requireCount(args.count);
    var height = documentHeight(doc);
    if (!insert && at >= height) throw new Error('В макете ' + height + ' строк: удалять нечего.');
    /* Past the last row an insert appends: the sheet has no gap to keep. */
    if (insert && at > height) at = height;
    if (!insert) count = Math.min(count, height - at);
    var delta = insert ? count : -count;
    var report = { removedAreas: [], removedMerges: 0, removedDrawings: 0 };

    splitRangeAt(doc, at);
    if (!insert) splitRangeAt(doc, at + count);
    /* Like a column, a new row copies the format of the row it is inserted
     * before (the last row when appending): height, row format, column set
     * and cell formats, without content. */
    var source = insert && height ? Math.min(at, height - 1) : -1;
    var sourceItem = null;
    kids(doc, 'rowsItem').forEach(function (item) {
        var from = intOf(kid(item, 'index'), 0);
        var to = kid(item, 'indexTo') ? intOf(kid(item, 'indexTo'), from) : from;
        if (source >= from && source <= to) sourceItem = item;
    });
    var copies = [];
    for (var k = 0; sourceItem && k < count; k++) copies.push(blankCopy(rangeItem(sourceItem, at + k, at + k)));
    kids(doc, 'rowsItem').forEach(function (item) {
        var from = intOf(kid(item, 'index'), 0);
        var toEl = kid(item, 'indexTo');
        var to = toEl ? intOf(toEl, from) : from;
        if (from < at) return;
        if (!insert && from < at + count) { removeKid(doc, item); return; }
        setInt(item, 'index', from + delta);
        if (toEl) toEl.text = String(to + delta);
    });
    if (copies.length) {
        var pos = doc.kids.indexOf(sourceItem) + (source < at ? 1 : 0);
        doc.kids.splice.apply(doc.kids, [pos, 0].concat(copies));
    }

    ['merge', 'verticalUnmerge'].forEach(function (name) {
        kids(doc, name).forEach(function (m) {
            var r = intOf(kid(m, 'r'), 0);
            if (r < 0) return;
            var span = shiftSpan(r, intOf(kid(m, 'h'), 0), at, delta);
            if (!span) { removeKid(doc, m); report.removedMerges++; return; }
            setInt(m, 'r', span.begin);
            setExtent(m, 'h', span.extent, ['r', 'c']);
        });
    });
    kids(doc, 'namedItem').forEach(function (item) {
        var area = kid(item, 'area');
        if (!area) return;
        var br = intOf(kid(area, 'beginRow'), -1);
        if (br < 0) return;
        var span = shiftSpan(br, intOf(kid(area, 'endRow'), br) - br, at, delta);
        if (!span) { removeKid(doc, item); report.removedAreas.push(kid(item, 'name') ? kid(item, 'name').text : ''); return; }
        setInt(area, 'beginRow', span.begin);
        setInt(area, 'endRow', span.begin + span.extent);
    });
    kids(doc, 'drawing').forEach(function (d) {
        var b = intOf(kid(d, 'beginRow'), -1), e = intOf(kid(d, 'endRow'), b);
        if (b < 0) return;
        var span = shiftSpan(b, e - b, at, delta);
        if (!span) { removeKid(doc, d); report.removedDrawings++; return; }
        setInt(d, 'beginRow', span.begin);
        setInt(d, 'endRow', span.begin + span.extent);
    });
    setHeight(doc, height + delta);
    report.rows = height + delta;
    report[insert ? 'inserted' : 'deleted'] = { at: at + 1, count: count };
    return { xml: toXml(doc, xml), result: report };
}

/* <h>/<w> are omitted when zero, and follow the given siblings. */
function setExtent(el, name, value, after) {
    var existing = kid(el, name);
    if (value === 0) { if (existing) removeKid(el, existing); return; }
    if (existing) { existing.text = String(value); return; }
    var pos = 0;
    el.kids.forEach(function (k, i) { if (after.indexOf(k.name) >= 0) pos = i + 1; });
    el.kids.splice(pos, 0, node(name, value));
}

/* The column set the edit applies to: the default one or `columnsId`. */
function columnSet(doc, columnsId) {
    var sets = kids(doc, 'columns');
    var want = columnsId || '';
    var set = sets.filter(function (s) { return (kid(s, 'id') ? kid(s, 'id').text : '') === want; })[0];
    if (!set && !want) set = sets[0];
    if (!set) throw new Error(want ? 'В макете нет набора колонок ' + want + '.' : 'В макете нет колонок.');
    return set;
}

function rowUsesSet(row, set, doc) {
    var id = kid(row, 'columnsID') ? kid(row, 'columnsID').text : '';
    var setId = kid(set, 'id') ? kid(set, 'id').text : '';
    return id === setId || (!id && set === kids(doc, 'columns')[0]);
}

function shiftColumns(xml, args, insert) {
    var doc = parse(xml);
    var set = columnSet(doc, args.columnsId);
    var setId = kid(set, 'id') ? kid(set, 'id').text : '';
    /* Elements without columnsID belong to the first set, whatever its id. */
    var isDefault = set === kids(doc, 'columns')[0];
    var at = requirePosition(args.at, 'at') - 1;
    var count = requireCount(args.count);
    var size = intOf(kid(set, 'size'), 0);
    if (!insert && at >= size) throw new Error('В наборе ' + size + ' колонок: удалять нечего.');
    if (insert && at > size) at = size;
    if (!insert) count = Math.min(count, size - at);
    var delta = insert ? count : -count;
    var report = { removedAreas: [], removedMerges: 0, removedDrawings: 0 };

    /* A new column looks like the one it is inserted before (the last one
     * when appending), as in the Designer: same width and the same cell
     * formats down the sheet, but no content. */
    var source = insert && size ? Math.min(at, size - 1) : -1;
    var sourceItem = null;
    setInt(set, 'size', size + delta);
    kids(set, 'columnsItem').forEach(function (item) {
        var i = intOf(kid(item, 'index'), 0);
        if (i === source) sourceItem = item;
        if (i < at) return;
        if (!insert && i < at + count) { removeKid(set, item); return; }
        setInt(item, 'index', i + delta);
    });
    if (sourceItem) {
        var pos = set.kids.indexOf(sourceItem) + (source < at ? 1 : 0);
        var copies = [];
        for (var k = 0; k < count; k++) {
            var copy = JSON.parse(JSON.stringify(sourceItem));
            setInt(copy, 'index', at + k);
            copies.push(copy);
        }
        set.kids.splice.apply(set.kids, [pos, 0].concat(copies));
    }
    kids(doc, 'rowsItem').forEach(function (item) {
        var row = kid(item, 'row');
        if (!row || !rowUsesSet(row, set, doc)) return;
        var cells = rowCells(row);
        if (!cells.length) return;
        var kept = [];
        cells.forEach(function (cell) {
            if (cell.col === source) {
                var f = kid(cellContent(cell.group), 'f');
                for (var n = 0; f && intOf(f, 0) > 0 && n < count; n++) {
                    kept.push({ col: at + n, group: node('c', null, [node('c', null, [node('f', f.text)])]) });
                }
            }
            if (cell.col < at) kept.push(cell);
            else if (insert) kept.push({ col: cell.col + count, group: cell.group });
            else if (cell.col >= at + count) kept.push({ col: cell.col - count, group: cell.group });
        });
        writeRowCells(row, kept);
    });
    function inSet(el) {
        var id = kid(el, 'columnsID') ? kid(el, 'columnsID').text : '';
        return id ? id === setId : isDefault;
    }
    ['merge', 'verticalUnmerge'].forEach(function (name) {
        kids(doc, name).forEach(function (m) {
            if (!inSet(m)) return;
            var span = shiftSpan(intOf(kid(m, 'c'), 0), intOf(kid(m, 'w'), 0), at, delta);
            if (!span) { removeKid(doc, m); report.removedMerges++; return; }
            setInt(m, 'c', span.begin);
            setExtent(m, 'w', span.extent, ['r', 'c', 'h']);
        });
    });
    kids(doc, 'namedItem').forEach(function (item) {
        var area = kid(item, 'area');
        if (!area || !inSet(area)) return;
        var bc = intOf(kid(area, 'beginColumn'), -1);
        if (bc < 0) return;
        var span = shiftSpan(bc, intOf(kid(area, 'endColumn'), bc) - bc, at, delta);
        if (!span) { removeKid(doc, item); report.removedAreas.push(kid(item, 'name') ? kid(item, 'name').text : ''); return; }
        setInt(area, 'beginColumn', span.begin);
        setInt(area, 'endColumn', span.begin + span.extent);
    });
    if (isDefault) {
        kids(doc, 'drawing').forEach(function (d) {
            var b = intOf(kid(d, 'beginColumn'), -1), e = intOf(kid(d, 'endColumn'), b);
            if (b < 0) return;
            var span = shiftSpan(b, e - b, at, delta);
            if (!span) { removeKid(doc, d); report.removedDrawings++; return; }
            setInt(d, 'beginColumn', span.begin);
            setInt(d, 'endColumn', span.begin + span.extent);
        });
    }
    report.columns = size + delta;
    report[insert ? 'inserted' : 'deleted'] = { at: at + 1, count: count };
    return { xml: toXml(doc, xml), result: report };
}

/* Restore deleted grid bands from a baseline. The inverse is intentionally
 * conservative: format indices must still refer to identical tables and the
 * document must not contain coordinate metadata that would need a semantic
 * merge (merged cells, named areas, drawings or print areas). */
function sameNamedNodes(a, b, name) {
    var aa = kids(a, name), bb = kids(b, name);
    return aa.length === bb.length && aa.every(function (item, i) {
        return serialize(item, 0, '\n') === serialize(bb[i], 0, '\n');
    });
}
function assertRestoreCompatible(current, source) {
    ['font', 'line', 'format'].forEach(function (name) {
        if (!sameNamedNodes(current, source, name))
            throw new Error('Таблицы ' + name + ' отличаются от эталона; структуру нельзя восстановить безопасно.');
    });
    ['merge', 'verticalUnmerge', 'namedItem', 'drawing', 'printArea'].forEach(function (name) {
        if (kids(current, name).length || kids(source, name).length)
            throw new Error('В документе есть ' + name + '; безопасное восстановление строки/колонки не подтверждено.');
    });
}
function cloneNode(el) { return JSON.parse(JSON.stringify(el)); }

function restoreRows(xml, sourceXml, args) {
    var at = requirePosition(args.at, 'at') - 1;
    var sourceAt = requirePosition(args.sourceAt, 'source_at') - 1;
    var count = requireCount(args.count);
    var current = parse(xml), source = parse(sourceXml);
    assertRestoreCompatible(current, source);
    if (!sameNamedNodes(current, source, 'columns'))
        throw new Error('Наборы колонок изменились; строку нельзя восстановить без риска.');
    var inserted = shiftRows(xml, { at: at + 1, count: count }, true);
    current = parse(inserted.xml);
    for (var i = 0; i < count; i++) {
        var originalRow = rowFor(source, sourceAt + i);
        var targetRow = rowFor(current, at + i);
        targetRow.attrs = cloneNode(originalRow.attrs);
        targetRow.kids = cloneNode(originalRow.kids);
        targetRow.text = originalRow.text;
    }
    return { xml: toXml(current, inserted.xml), result: { restored: { at: at + 1, count: count } } };
}

function restoreColumns(xml, sourceXml, args) {
    var at = requirePosition(args.at, 'at') - 1;
    var sourceAt = requirePosition(args.sourceAt, 'source_at') - 1;
    var count = requireCount(args.count);
    var current = parse(xml), source = parse(sourceXml);
    assertRestoreCompatible(current, source);
    var currentSets = kids(current, 'columns'), sourceSets = kids(source, 'columns');
    if (currentSets.length !== 1 || sourceSets.length !== 1
        || (kid(currentSets[0], 'id') && kid(currentSets[0], 'id').text)
        || (kid(sourceSets[0], 'id') && kid(sourceSets[0], 'id').text))
        throw new Error('Восстановление поддерживает только один набор колонок по умолчанию.');
    if (documentHeight(current) !== documentHeight(source))
        throw new Error('Число строк изменилось; колонку нельзя сопоставить без риска.');
    var inserted = shiftColumns(xml, { at: at + 1, count: count }, true);
    current = parse(inserted.xml);
    var destSet = kids(current, 'columns')[0], srcSet = kids(source, 'columns')[0];
    var sourceItems = kids(srcSet, 'columnsItem');
    var destItems = kids(destSet, 'columnsItem');
    for (var c = 0; c < count; c++) {
        var sourceItem = sourceItems.filter(function (item) { return intOf(kid(item, 'index'), -1) === sourceAt + c; })[0];
        var destItem = destItems.filter(function (item) { return intOf(kid(item, 'index'), -1) === at + c; })[0];
        if (destItem) removeKid(destSet, destItem);
        if (sourceItem) {
            var copy = cloneNode(sourceItem);
            setInt(copy, 'index', at + c);
            var position = destSet.kids.length;
            for (var p = 0; p < destSet.kids.length; p++) {
                if (destSet.kids[p].name === 'columnsItem' && intOf(kid(destSet.kids[p], 'index'), -1) > at + c) { position = p; break; }
            }
            destSet.kids.splice(position, 0, copy);
        }
    }
    for (var r = 0; r < documentHeight(source); r++) {
        var sourceRow = rowFor(source, r), targetRow = rowFor(current, r);
        var sourceCells = rowCells(sourceRow), targetCells = rowCells(targetRow);
        for (c = 0; c < count; c++) {
            var sourceCell = sourceCells.filter(function (cell) { return cell.col === sourceAt + c; })[0];
            targetCells = targetCells.filter(function (cell) { return cell.col !== at + c; });
            if (sourceCell) targetCells.push({ col: at + c, group: cloneNode(sourceCell.group) });
        }
        writeRowCells(targetRow, targetCells);
    }
    return { xml: toXml(current, inserted.xml), result: { restored: { at: at + 1, count: count } } };
}

/* ---------- structure: merges and sizes ---------- */

function mergeRect(m) {
    return { r: intOf(kid(m, 'r'), 0), c: intOf(kid(m, 'c'), 0), h: intOf(kid(m, 'h'), 0), w: intOf(kid(m, 'w'), 0) };
}

/* mergeCells: { row, column, rows, columns } — rows × columns cells from the
 * top-left one. unmerge: true removes the merge that covers row/column. */
function mergeCells(xml, args) {
    var doc = parse(xml);
    var r = requirePosition(args.row, 'row') - 1;
    var c = requirePosition(args.column, 'column') - 1;
    var merges = kids(doc, 'merge').filter(function (m) { return !kid(m, 'columnsID') && intOf(kid(m, 'r'), 0) >= 0; });
    if (args.unmerge) {
        var hit = merges.filter(function (m) {
            var x = mergeRect(m);
            return r >= x.r && r <= x.r + x.h && c >= x.c && c <= x.c + x.w;
        })[0];
        if (!hit) throw new Error('Ячейка ' + (r + 1) + ':' + (c + 1) + ' не входит в объединение.');
        var gone = mergeRect(hit);
        removeKid(doc, hit);
        return { xml: toXml(doc, xml), result: { unmerged: { row: gone.r + 1, column: gone.c + 1, rows: gone.h + 1, columns: gone.w + 1 } } };
    }
    var h = requireCount(args.rows) - 1;
    var w = requireCount(args.columns) - 1;
    if (!h && !w) throw new Error('Объединение из одной ячейки: укажите rows или columns больше 1.');
    merges.forEach(function (m) {
        var x = mergeRect(m);
        if (r <= x.r + x.h && x.r <= r + h && c <= x.c + x.w && x.c <= c + w) {
            throw new Error('Пересекается с объединением ' + (x.r + 1) + ':' + (x.c + 1) + ' (' + (x.h + 1) + '×' + (x.w + 1) + '). Сначала снимите его.');
        }
    });
    var el = node('merge', null, [node('r', r), node('c', c)]);
    if (h) el.kids.push(node('h', h));
    if (w) el.kids.push(node('w', w));
    insertAfterLast(doc, el, ['merge'], ['verticalUnmerge', 'namedItem', 'line', 'font', 'format', 'picture']);
    if (r + h + 1 > documentHeight(doc)) growHeight(doc, r + h + 1);
    return { xml: toXml(doc, xml), result: { merged: { row: r + 1, column: c + 1, rows: h + 1, columns: w + 1 } } };
}

/* setSize: { column, width, hidden } in the template's width units (as the
 * configurator shows them), or { row, height, hidden } in points. Ranges
 * through toColumn / toRow; height 0 removes a fixed height (auto); hidden
 * true/false sets or clears the hidden flag independently of width/height —
 * at least one of width/height and hidden must be given. */
function setSize(xml, args) {
    var doc = parse(xml);
    var changed = [];
    var hasHidden = Object.prototype.hasOwnProperty.call(args, 'hidden');
    if (args.column != null) {
        var hasWidth = args.width != null;
        if (!hasWidth && !hasHidden) throw new Error('Для колонки укажите width и/или hidden.');
        var width;
        if (hasWidth) {
            width = Number(args.width);
            if (!(width >= 0)) throw new Error('width должен быть числом от 0.');
        }
        var set = columnSet(doc, args.columnsId);
        var from = requirePosition(args.column, 'column') - 1;
        var to = args.toColumn != null ? requirePosition(args.toColumn, 'to_column') - 1 : from;
        for (var c = from; c <= to; c++) {
            var item = kids(set, 'columnsItem').filter(function (it) { return intOf(kid(it, 'index'), -1) === c; })[0];
            if (!item) {
                item = node('columnsItem', null, [node('index', c), node('column', null, [])]);
                var after = -1;
                set.kids.forEach(function (k, i) {
                    if (k.name === 'size' || k.name === 'id' || (k.name === 'columnsItem' && intOf(kid(k, 'index'), 0) < c)) after = i;
                });
                set.kids.splice(after + 1, 0, item);
            }
            var column = kid(item, 'column') || (function () { var x = node('column', null, []); item.kids.push(x); return x; })();
            var fEl = kid(column, 'formatIndex');
            var colChanges = {};
            if (hasWidth) colChanges.width = Math.round(width);
            if (hasHidden) colChanges.hidden = args.hidden ? 'true' : null;
            var idx = formatWith(doc, fEl ? intOf(fEl, 0) : 0, colChanges);
            if (fEl) fEl.text = String(idx); else column.kids.unshift(node('formatIndex', idx));
            var colEntry = { column: c + 1 };
            if (hasWidth) colEntry.width = Math.round(width);
            if (hasHidden) colEntry.hidden = !!args.hidden;
            changed.push(colEntry);
        }
        if (to + 1 > intOf(kid(set, 'size'), 0)) setInt(set, 'size', to + 1);
    } else if (args.row != null) {
        var hasHeight = args.height != null;
        if (!hasHeight && !hasHidden) throw new Error('Для строки укажите height и/или hidden (height 0 — автовысота).');
        var pt;
        if (hasHeight) {
            pt = Number(args.height);
            if (!(pt >= 0)) throw new Error('height должен быть числом от 0.');
        }
        var rFrom = requirePosition(args.row, 'row') - 1;
        var rTo = args.toRow != null ? requirePosition(args.toRow, 'to_row') - 1 : rFrom;
        for (var r = rFrom; r <= rTo; r++) {
            var row = rowFor(doc, r);
            var rf = kid(row, 'formatIndex');
            var rowChanges = {};
            if (hasHeight) rowChanges.height = pt ? Math.round(pt * 4) : null;
            if (hasHidden) rowChanges.hidden = args.hidden ? 'true' : null;
            var rIdx = formatWith(doc, rf ? intOf(rf, 0) : 0, rowChanges);
            if (rf) rf.text = String(rIdx);
            else {
                var pos = kid(row, 'columnsID') ? 1 : 0;
                row.kids.splice(pos, 0, node('formatIndex', rIdx));
            }
            var rowEntry = { row: r + 1 };
            if (hasHeight) rowEntry.height = pt || 'auto';
            if (hasHidden) rowEntry.hidden = !!args.hidden;
            changed.push(rowEntry);
        }
    } else {
        throw new Error('Укажите column (и width и/или hidden) или row (и height и/или hidden).');
    }
    return { xml: toXml(doc, xml), result: { changed: changed } };
}

/* ---------- cell format ---------- */

/* The platform's cell line types, in its own order: None, Solid, Dotted,
 * Double, ThinDashed, ThickDashed, LargeDashed — «Нет линии», «Сплошная»,
 * «Точечная», «Двойная», «Редкий пунктир», «Частый пунктир», «Большой
 * пунктир». A cell has no dash-dot line; that belongs to drawings. */
var LINE_STYLES = ['None', 'Solid', 'Dotted', 'Double', 'ThinDashed', 'ThickDashed', 'LargeDashed'];
var H_ALIGNS = ['Left', 'Center', 'Right', 'Justify', 'Auto'];
var V_ALIGNS = ['Top', 'Center', 'Bottom'];
var PLACEMENTS = ['Auto', 'Wrap', 'Cut', 'Block'];

function pickEnum(value, allowed, label) {
    var hit = allowed.filter(function (a) { return a.toLowerCase() === String(value).toLowerCase(); })[0];
    if (!hit) throw new Error(label + ': одно из ' + allowed.join(', ') + '.');
    return hit;
}

function colorValue(value, label) {
    var v = String(value).trim();
    if (/^#[0-9a-fA-F]{6}$/.test(v)) return v.toUpperCase();
    if (/^(style|web|win):[A-Za-zА-Яа-яЁё0-9_]+$/.test(v)) return v;
    throw new Error(label + ': цвет #RRGGBB или style:/web:/win:Имя.');
}

function attr(el, name) {
    for (var i = 0; i < el.attrs.length; i++) if (el.attrs[i][0] === name) return el.attrs[i][1];
    return null;
}

/* The 0-based <font> a cell shows now, resolved like the preview does: the
 * cell's own format, then its row, its column and the sheet default. -1 when
 * none of them names a font. Starting a font change anywhere else turns
 * «make it bold» into a different face or size too. */
function inheritedFont(doc, row, col, cellFmt) {
    var list = formats(doc);
    function fontOf(fmt) { return fmt && kid(fmt, 'font') ? intOf(kid(fmt, 'font'), -1) : -1; }
    function byIndex(el) { var i = el ? intOf(el, 0) : 0; return i > 0 ? list[i - 1] : null; }
    var set = null;
    var id = kid(row, 'columnsID') ? kid(row, 'columnsID').text : '';
    kids(doc, 'columns').forEach(function (s) {
        if (!set && (kid(s, 'id') ? kid(s, 'id').text : '') === id) set = s;
    });
    if (!set && !id) set = kids(doc, 'columns')[0] || null;
    var colFmt = null;
    kids(set, 'columnsItem').forEach(function (item) {
        if (intOf(kid(item, 'index'), -1) === col) colFmt = byIndex(kid(kid(item, 'column'), 'formatIndex'));
    });
    var chain = [cellFmt, byIndex(kid(row, 'formatIndex')), colFmt, byIndex(kid(doc, 'defaultFormatIndex'))];
    for (var i = 0; i < chain.length; i++) {
        var f = fontOf(chain[i]);
        if (f >= 0) return f;
    }
    return -1;
}

/* The index of a doc-level <font> equal to base + changes, added when new. */
function fontIndex(doc, baseIndex, changes) {
    var fonts = kids(doc, 'font');
    var base = fonts[baseIndex];
    var props = {
        faceName: base ? attr(base, 'faceName') || 'Arial' : 'Arial',
        height: base ? attr(base, 'height') || '8' : '8',
        bold: base ? attr(base, 'bold') || 'false' : 'false',
        italic: base ? attr(base, 'italic') || 'false' : 'false',
        underline: base ? attr(base, 'underline') || 'false' : 'false',
        strikeout: base ? attr(base, 'strikeout') || 'false' : 'false',
        kind: base ? attr(base, 'kind') || 'Absolute' : 'Absolute',
        scale: base ? attr(base, 'scale') || '100' : '100'
    };
    if (changes.face != null) props.faceName = String(changes.face);
    if (changes.size != null) {
        if (!(Number(changes.size) > 0)) throw new Error('font.size должен быть положительным числом.');
        props.height = String(Number(changes.size));
    }
    if (changes.scale != null) {
        if (!(Number(changes.scale) > 0)) throw new Error('font.scale должен быть положительным числом.');
        props.scale = String(Number(changes.scale));
    }
    ['bold', 'italic', 'underline', 'strikeout'].forEach(function (k) {
        if (changes[k] != null) props[k] = changes[k] ? 'true' : 'false';
    });
    var order = ['faceName', 'height', 'bold', 'italic', 'underline', 'strikeout', 'kind', 'scale'];
    for (var i = 0; i < fonts.length; i++) {
        if (order.every(function (k) { return attr(fonts[i], k) === props[k]; })) return i;
    }
    var el = node('font', null, []);
    el.keepOpen = false;
    order.forEach(function (k) { el.attrs.push([k, props[k]]); });
    insertAfterLast(doc, el, ['font'], ['format', 'picture']);
    return fonts.length;
}

/* The index of a doc-level cell <line>, added when new. */
function lineIndex(doc, spec) {
    var style = typeof spec === 'string' ? spec : spec && spec.style;
    style = pickEnum(style || 'Solid', LINE_STYLES, 'Стиль линии');
    var width = spec && typeof spec === 'object' && spec.width != null ? Number(spec.width) : 1;
    if (!(width >= 1 && width <= 20)) throw new Error('Толщина линии: от 1 до 20.');
    var lines = kids(doc, 'line');
    for (var i = 0; i < lines.length; i++) {
        var st = kid(lines[i], 'style');
        var kind = st ? attr(st, 'xsi:type') || '' : '';
        if (attr(lines[i], 'width') === String(width) && attr(lines[i], 'gap') !== 'true' && st && st.text === style && kind.indexOf('CellLineType') >= 0) return i;
    }
    if (!attr(doc, 'xmlns:v8ui')) doc.attrs.push(['xmlns:v8ui', 'http://v8.1c.ru/8.1/data/ui']);
    var styleEl = node('v8ui:style', style);
    styleEl.attrs.push(['xsi:type', 'v8ui:SpreadsheetDocumentCellLineType']);
    var el = node('line', null, [styleEl]);
    el.attrs.push(['width', String(width)], ['gap', 'false']);
    insertAfterLast(doc, el, ['line'], ['font', 'format', 'picture']);
    return lines.length;
}

/* setFormat: { row, column, toRow, toColumn, font{...}, horizontalAlignment,
 * verticalAlignment, textPlacement, indent, textColor, backColor, border,
 * leftBorder, topBorder, rightBorder, bottomBorder, borderColor, drawingBorder,
 * format, protection, mask, editFormat, autoIndent, widthWeightFactor,
 * patternColor }. A property set to null goes back to the inherited value. */
function setFormat(xml, args) {
    var doc = parse(xml);
    var r0 = requirePosition(args.row, 'row') - 1;
    var c0 = requirePosition(args.column, 'column') - 1;
    var r1 = args.toRow != null ? requirePosition(args.toRow, 'to_row') - 1 : r0;
    var c1 = args.toColumn != null ? requirePosition(args.toColumn, 'to_column') - 1 : c0;
    if (r1 < r0 || c1 < c0) throw new Error('to_row/to_column меньше row/column.');
    var keys = ['font', 'horizontalAlignment', 'verticalAlignment', 'textPlacement', 'indent', 'textColor', 'backColor',
        'border', 'leftBorder', 'topBorder', 'rightBorder', 'bottomBorder', 'borderColor', 'drawingBorder', 'format',
        'protection', 'mask', 'editFormat', 'autoIndent', 'widthWeightFactor', 'patternColor'];
    var given = keys.filter(function (k) { return Object.prototype.hasOwnProperty.call(args, k); });
    if (!given.length) throw new Error('Не задано ни одного свойства оформления.');

    /* Validate once, independent of the cell, before touching the document. */
    var fixed = {};
    given.forEach(function (k) {
        var v = args[k];
        if (v == null) { fixed[k] = null; return; }
        if (k === 'horizontalAlignment') fixed[k] = pickEnum(v, H_ALIGNS, 'horizontal_alignment');
        else if (k === 'verticalAlignment') fixed[k] = pickEnum(v, V_ALIGNS, 'vertical_alignment');
        else if (k === 'textPlacement') fixed[k] = pickEnum(v, PLACEMENTS, 'text_placement');
        else if (k === 'textColor' || k === 'backColor' || k === 'borderColor' || k === 'patternColor') fixed[k] = colorValue(v, k);
        else if (k === 'indent') {
            if (!(Number.isInteger(Number(v)) && Number(v) >= 0)) throw new Error('indent: целое число от 0.');
            fixed[k] = Number(v) || null;
        } else if (k === 'protection' || k === 'autoIndent') fixed[k] = v ? 'true' : null;
        else if (k === 'format') fixed[k] = String(v) || null;
        else if (k === 'mask' || k === 'editFormat') {
            var s = String(v).trim();
            if (!s) throw new Error(k + ': непустая строка.');
            fixed[k] = s;
        } else if (k === 'widthWeightFactor') {
            var factor = Number(v);
            if (!(factor > 0)) throw new Error('width_weight_factor должен быть положительным числом.');
            fixed[k] = factor;
        } else fixed[k] = v;
    });
    if (fixed.font && typeof fixed.font !== 'object') throw new Error('font: объект { face, size, bold, italic, underline, strikeout }.');
    var lang = languageOf(doc);
    var touched = 0;

    for (var r = r0; r <= r1; r++) {
        var row = rowFor(doc, r);
        var cells = rowCells(row);
        for (var c = c0; c <= c1; c++) {
            var cell = cells.filter(function (x) { return x.col === c; })[0];
            if (!cell) {
                cell = { col: c, group: node('c', null, [node('c', null, [])]) };
                cells.push(cell);
            }
            var content = cellContent(cell.group);
            var fEl = kid(content, 'f');
            var current = fEl ? intOf(fEl, 0) : 0;
            var baseFmt = current > 0 ? formats(doc)[current - 1] : null;
            var changes = {};
            Object.keys(fixed).forEach(function (k) {
                var v = fixed[k];
                if (k === 'font') {
                    if (v == null) { changes.font = null; return; }
                    changes.font = fontIndex(doc, inheritedFont(doc, row, c, baseFmt), v);
                } else if (k === 'border' || /Border$/.test(k) && k !== 'borderColor') {
                    var sides = k === 'border' ? ['leftBorder', 'topBorder', 'rightBorder', 'bottomBorder'] : [k];
                    if (k === 'border') changes.border = null;
                    sides.forEach(function (side) { changes[side] = v == null ? null : lineIndex(doc, v); });
                } else if (k === 'format') {
                    changes.format = v == null ? null
                        : node('format', null, [node('v8:item', null, [node('v8:lang', lang), node('v8:content', v)])]);
                } else {
                    changes[k] = v;
                }
            });
            var idx = formatWith(doc, current, changes);
            if (fEl) fEl.text = String(idx);
            else content.kids.unshift(node('f', idx));
            touched++;
        }
        writeRowCells(row, cells);
        growColumns(columnSetFor(doc, row), c1 + 1);
    }
    return { xml: toXml(doc, xml), result: { cells: touched, properties: given } };
}

/* ---------- printing ---------- */

/* Element order inside <printSettings>, as the configurator writes it. */
var PRINT_ORDER = ['pageOrientation', 'scale', 'collate', 'copies', 'perPage', 'topMargin', 'leftMargin', 'bottomMargin',
    'rightMargin', 'headerSize', 'footerSize', 'fitToPage', 'blackAndWhite', 'printerName', 'paper', 'paperSource',
    'pageWidth', 'pageHeight', 'duplexType', 'pagePlacementAlternation', 'firstPageNumber'];

/* Document-level elements that come after the grid, in Designer's order. */
var TAIL_ORDER = ['leftHeader', 'centerHeader', 'rightHeader', 'leftFooter', 'centerFooter', 'rightFooter', 'templateMode',
    'defaultFormatIndex', 'height', 'vgRows', 'merge', 'verticalUnmerge', 'namedItem', 'printSettings', 'printArea',
    'line', 'font', 'format', 'picture'];

/* Put `el` where Designer would: after every sibling that precedes it. */
function placeInTail(doc, el) {
    var rank = TAIL_ORDER.indexOf(el.name);
    var at = doc.kids.length;
    for (var i = 0; i < doc.kids.length; i++) {
        var r = TAIL_ORDER.indexOf(doc.kids[i].name);
        if (r > rank) { at = i; break; }
    }
    doc.kids.splice(at, 0, el);
}

function millimetres(value, label) {
    var n = Number(value);
    if (!(n >= 0 && n <= 1000)) throw new Error(label + ': миллиметры от 0 до 1000.');
    return Math.round(n * 100);
}

/* setPrintSettings: { orientation, scale, fitToPage, paper, copies, blackAndWhite,
 * firstPageNumber, topMargin, leftMargin, bottomMargin, rightMargin, headerSize,
 * footerSize (millimetres), printArea: { beginRow, endRow, beginColumn, endColumn } | null }. */
function setPrintSettings(xml, args) {
    var doc = parse(xml);
    var values = {};
    if (args.orientation != null) values.pageOrientation = pickEnum(args.orientation, ['Portrait', 'Landscape'], 'orientation');
    if (args.scale != null) {
        var scale = Number(args.scale);
        if (!(Number.isInteger(scale) && scale >= 10 && scale <= 400)) throw new Error('scale: целое от 10 до 400.');
        values.scale = scale;
    }
    if (args.fitToPage != null) values.fitToPage = args.fitToPage ? 'true' : 'false';
    if (args.blackAndWhite != null) values.blackAndWhite = args.blackAndWhite ? 'true' : 'false';
    ['paper', 'copies', 'firstPageNumber'].forEach(function (k) {
        if (args[k] == null) return;
        var n = Number(args[k]);
        if (!(Number.isInteger(n) && n >= 0)) throw new Error(k + ': целое число от 0.');
        values[k] = n;
    });
    ['topMargin', 'leftMargin', 'bottomMargin', 'rightMargin', 'headerSize', 'footerSize'].forEach(function (k) {
        if (args[k] != null) values[k] = millimetres(args[k], k);
    });
    var hasArea = Object.prototype.hasOwnProperty.call(args, 'printArea');
    if (!Object.keys(values).length && !hasArea) throw new Error('Не задано ни одного параметра печати.');

    if (Object.keys(values).length) {
        var ps = kid(doc, 'printSettings');
        if (!ps) {
            ps = node('printSettings', null, []);
            placeInTail(doc, ps);
        }
        Object.keys(values).forEach(function (k) {
            var existing = kid(ps, k);
            if (existing) { existing.text = String(values[k]); return; }
            var rank = PRINT_ORDER.indexOf(k);
            var at = ps.kids.length;
            for (var i = 0; i < ps.kids.length; i++) {
                if (PRINT_ORDER.indexOf(ps.kids[i].name) > rank) { at = i; break; }
            }
            ps.kids.splice(at, 0, node(k, values[k]));
        });
    }
    var area = null;
    if (hasArea) {
        var old = kid(doc, 'printArea');
        if (old) removeKid(doc, old);
        var a = args.printArea;
        if (a) {
            var br = requirePosition(a.beginRow, 'print_area.begin_row') - 1;
            var er = requirePosition(a.endRow != null ? a.endRow : a.beginRow, 'print_area.end_row') - 1;
            var hasCols = a.beginColumn != null || a.endColumn != null;
            var bc = hasCols ? requirePosition(a.beginColumn != null ? a.beginColumn : a.endColumn, 'print_area.begin_column') - 1 : -1;
            var ec = hasCols ? requirePosition(a.endColumn != null ? a.endColumn : a.beginColumn, 'print_area.end_column') - 1 : -1;
            if (er < br || ec < bc) throw new Error('print_area: конец раньше начала.');
            placeInTail(doc, node('printArea', null, [node('type', hasCols ? 'Rectangle' : 'Rows'), node('beginRow', br),
                node('endRow', er), node('beginColumn', bc), node('endColumn', ec)]));
            area = { beginRow: br + 1, endRow: er + 1 };
            if (hasCols) { area.beginColumn = bc + 1; area.endColumn = ec + 1; }
        }
    }
    var result = { printSettings: {} };
    var current = kid(doc, 'printSettings');
    if (current) current.kids.forEach(function (k) { result.printSettings[k.name] = k.text; });
    if (hasArea) result.printArea = area;
    return { xml: toXml(doc, xml), result: result };
}

/* setHeaderFooter: { kind: 'header' | 'footer', left, center, right, font,
 * remove }. Texts may carry [&НомерСтраницы], [&СтраницВсего], [&Дата], [&Время].
 * A slot left out keeps its text; an empty string clears it. */
function setHeaderFooter(xml, args) {
    var doc = parse(xml);
    var kind = pickEnum(args.kind, ['header', 'footer'], 'kind');
    var suffix = kind === 'header' ? 'Header' : 'Footer';
    var slots = ['left', 'center', 'right'];
    if (args.remove) {
        slots.forEach(function (s) { var el = kid(doc, s + suffix); if (el) removeKid(doc, el); });
        return { xml: toXml(doc, xml), result: { removed: kind } };
    }
    if (!slots.some(function (s) { return args[s] != null; }) && !args.font) throw new Error('Передайте left, center, right или font.');
    var lang = languageOf(doc);
    var fontChange = args.font;
    if (fontChange && typeof fontChange !== 'object') throw new Error('font: объект { face, size, bold, italic, underline, strikeout }.');
    var result = {};
    slots.forEach(function (s) {
        var el = kid(doc, s + suffix);
        if (!el) {
            el = node(s + suffix, null, [node('f', 0), node('tl', null, [])]);
            kid(el, 'tl').keepOpen = false;
            placeInTail(doc, el);
        }
        if (args[s] != null) {
            var tl = kid(el, 'tl') || (function () { var x = node('tl', null, []); el.kids.push(x); return x; })();
            var text = String(args[s]);
            tl.kids = text === '' ? [] : [node('v8:item', null, [node('v8:lang', lang), node('v8:content', text)])];
            tl.keepOpen = false;
        }
        if (fontChange) {
            var fEl = kid(el, 'f') || (function () { var x = node('f', 0); el.kids.unshift(x); return x; })();
            var current = intOf(fEl, 0);
            var baseFmt = current > 0 ? formats(doc)[current - 1] : null;
            var baseFont = baseFmt && kid(baseFmt, 'font') ? intOf(kid(baseFmt, 'font'), 0) : 0;
            fEl.text = String(formatWith(doc, current, { font: fontIndex(doc, baseFont, fontChange) }));
        }
        result[s] = localizedText(kid(el, 'tl'), lang);
    });
    return { xml: toXml(doc, xml), result: { kind: kind, slots: result } };
}

root.TemplateMarkup = {
    setFormat: setFormat,
    setPrintSettings: setPrintSettings,
    setHeaderFooter: setHeaderFooter,
    listMarkup: listMarkup,
    setArea: setArea,
    setParameter: setParameter,
    insertRows: function (xml, args) { return shiftRows(xml, args, true); },
    deleteRows: function (xml, args) { return shiftRows(xml, args, false); },
    restoreRows: restoreRows,
    insertColumns: function (xml, args) { return shiftColumns(xml, args, true); },
    deleteColumns: function (xml, args) { return shiftColumns(xml, args, false); },
    restoreColumns: restoreColumns,
    mergeCells: mergeCells,
    validateTemplate: validateTemplate,
    setSize: setSize,
    _test: { parse: parse, toXml: toXml }
};

})(typeof window !== 'undefined' ? window : globalThis);
