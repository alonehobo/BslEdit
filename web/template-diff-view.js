/* Показ сравнения двух табличных документов: два листа бок о бок, подсветка
 * различий прямо на сетке и список изменений под ними.
 *
 * Считает различия `template-diff.js`; здесь только отрисовка. Оба листа
 * рисует обычный `TemplatePreview.render`, поэтому сравнение выглядит ровно
 * так же, как сам макет, — никакой второй реализации сетки. */
(function (root) {
'use strict';

/* Классы разметки: строка или колонка целиком, изменённая ячейка и ячейка,
 * у которой поменялось только оформление. */
var EOL = '\r\n';
var ADDED = 'tpd-added';
var REMOVED = 'tpd-removed';
var CHANGED = 'tpd-changed';
var LOOK = 'tpd-look';
/* Куда смотреть сейчас: рамка вокруг выбранной в списке области. */
var FOCUS = 'tpd-focus';
var splitRatio = 66;

function nodesOf(host, selector) {
    if (!host || !host.querySelectorAll) return [];
    var found = host.querySelectorAll(selector);
    var out = [];
    for (var i = 0; i < found.length; i++) out.push(found[i]);
    return out;
}

function markCell(host, row, col, cls) {
    var cells = nodesOf(host, 'td');
    for (var i = 0; i < cells.length; i++) {
        var td = cells[i];
        if (td.getAttribute('data-row') == null) continue;
        var r = Number(td.getAttribute('data-row'));
        var c = Number(td.getAttribute('data-col'));
        /* Объединённая ячейка нарисована одним td на всю свою площадь. */
        var rows = td.rowSpan > 1 ? td.rowSpan : 1;
        var cols = td.colSpan > 1 ? td.colSpan : 1;
        if (row >= r && row < r + rows && col >= c && col < c + cols) td.classList.add(cls);
    }
}

function markRow(host, row, cls) {
    var cells = nodesOf(host, 'td');
    var i;
    for (i = 0; i < cells.length; i++) {
        var td = cells[i];
        if (td.getAttribute('data-row') == null) continue;
        var r = Number(td.getAttribute('data-row'));
        var rows = td.rowSpan > 1 ? td.rowSpan : 1;
        if (row >= r && row < r + rows) td.classList.add(cls);
    }
    var nums = nodesOf(host, '.tp-row-num');
    for (i = 0; i < nums.length; i++) {
        if (Number(nums[i].getAttribute('data-row')) === row) nums[i].classList.add(cls);
    }
}

function colWidth(col, table) {
    if (col && col.getBoundingClientRect) {
        var measured = col.getBoundingClientRect().width;
        if (measured > 0) return measured;
    }
    var styleWidth = col && col.style ? parseFloat(col.style.width) : 0;
    if (styleWidth > 0) return styleWidth;
    var attrWidth = col && col.getAttribute ? parseFloat(col.getAttribute('width')) : 0;
    if (attrWidth > 0) return attrWidth;
    var tableWidth = table && table.getBoundingClientRect ? table.getBoundingClientRect().width : 0;
    var count = table && table.querySelectorAll ? table.querySelectorAll('col').length : 0;
    return count && tableWidth > 0 ? tableWidth / count : 0;
}

function markMergedColumn(td, col, cls, start, span) {
    var table = td.parentNode && td.parentNode.parentNode && td.parentNode.parentNode.parentNode;
    if (!td.ownerDocument || !td.ownerDocument.createElement) {
        td.classList.add(cls);
        return;
    }
    var columns = table && table.querySelectorAll ? table.querySelectorAll('col') : [];
    var left = 0, width = 0;
    for (var i = start; i < start + span; i++) {
        var size = colWidth(columns[i], table);
        if (!size) size = 1;
        if (i < col) left += size;
        else if (i === col) width = size;
    }
    if (!width) width = 1;
    var slice = td.ownerDocument.createElement('span');
    slice.className = cls + ' tpd-column-slice';
    slice.setAttribute('aria-hidden', 'true');
    slice.style.left = left + 'px';
    slice.style.width = width + 'px';
    td.appendChild(slice);
}

function markColumn(host, col, cls) {
    var cells = nodesOf(host, 'td');
    var i;
    for (i = 0; i < cells.length; i++) {
        var td = cells[i];
        if (td.getAttribute('data-col') == null) continue;
        var c = Number(td.getAttribute('data-col'));
        var cols = td.colSpan > 1 ? td.colSpan : 1;
        if (col < c || col >= c + cols) continue;
        if (cols > 1) markMergedColumn(td, col, cls, c, cols);
        else td.classList.add(cls);
    }
    var heads = nodesOf(host, 'th');
    for (i = 0; i < heads.length; i++) {
        if (Number(heads[i].getAttribute('data-col')) === col) heads[i].classList.add(cls);
    }
}

/* Адрес ячейки так, как его пишет 1С в строке состояния: R12C3. */
function address(row, col) {
    return 'R' + (row + 1) + 'C' + (col + 1);
}

function valueText(value) {
    if (value == null || value === '') return 'пусто';
    return '«' + String(value) + '»';
}

var AUTO_VALUE_FIELDS = {
    font: true, width: true, height: true, textColor: true, backColor: true, pattern: true,
    numberFormat: true, horizontalAlignment: true, verticalAlignment: true, textPlacement: true,
    textOrientation: true, hyperLink: true, borderLeft: true, borderTop: true,
    borderRight: true, borderBottom: true
};

function detailValueText(field, value) {
    return AUTO_VALUE_FIELDS[field] && (value == null || value === '') ? 'Авто' : valueText(value);
}

function colorCss(property, value) {
    if (!/(?:color|цвет)/i.test(String(property || ''))) return '';
    var raw = String(value == null ? '' : value).trim();
    if (/^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(raw)) return raw;
    var web = /^web:([a-z]+)$/i.exec(raw);
    if (web) return web[1];
    /* Некоторые цвета из шаблонов приходят с XML-префиксом типа цвета,
     * например d3p1:Gainsboro. Префикс не часть CSS-имени. */
    var qualified = /^d3p1:([a-z]+)$/i.exec(raw);
    if (qualified) return qualified[1];
    var rgb = /^(?:rgb\s*\()?\s*(\d{1,3})\s*[,;]\s*(\d{1,3})\s*[,;]\s*(\d{1,3})\s*\)?$/i.exec(raw);
    if (rgb && Number(rgb[1]) <= 255 && Number(rgb[2]) <= 255 && Number(rgb[3]) <= 255)
        return 'rgb(' + Number(rgb[1]) + ',' + Number(rgb[2]) + ',' + Number(rgb[3]) + ')';
    return '';
}

function valueNode(doc, cls, property, value, field) {
    var cssColor = colorCss(property, value);
    var text = detailValueText(field, value);
    if (!cssColor) return el(doc, 'span', cls, text);
    var node = el(doc, 'span', cls + ' tpd-color-value');
    node.appendChild(el(doc, 'span', 'tpd-color-text', text));
    var swatch = el(doc, 'span', 'tpd-color-swatch');
    swatch.style.backgroundColor = cssColor;
    swatch.setAttribute('aria-label', 'Образец цвета');
    swatch.setAttribute('title', 'Образец цвета');
    node.appendChild(swatch);
    return node;
}

/* Текст остаётся тем же плоским представлением для буфера,
 * а остальные поля дают экрану ту же карточку «было → стало»,
 * что и в сравнении форм. */
function changeEntry(kind, title, text, location, property, from, to, note, extra) {
    var out = location || {};
    out.kind = kind;
    out.title = title;
    out.text = text;
    if (property) out.property = property;
    if (from != null) out.from = from;
    if (to != null) out.to = to;
    if (note) out.note = note;
    if (extra) Object.keys(extra).forEach(function (key) { out[key] = extra[key]; });
    return out;
}

/* Строки списка изменений. У каждой — сторона и адрес, чтобы клик мог
 * показать её на обоих листах. */
function columnRange(columns) {
    var sorted = columns.slice().sort(function (a, b) { return a - b; });
    var ranges = [], start = sorted[0], end = sorted[0];
    for (var i = 1; i < sorted.length; i++) {
        if (sorted[i] <= end + 1) { end = sorted[i]; continue; }
        ranges.push(start === end ? String(start + 1) : (start + 1) + '–' + (end + 1));
        start = end = sorted[i];
    }
    if (sorted.length) ranges.push(start === end ? String(start + 1) : (start + 1) + '–' + (end + 1));
    return ranges.join(', ');
}

function rowChangeEntry(row, leftModel, rightModel) {
    var details = [];
    (row.changes || []).forEach(function (change) {
        details.push({ field: change.field, property: change.title, from: change.from, to: change.to,
            targets: [{ side: 'both', row: row.right, col: null, leftRow: row.left, leftCol: null }] });
    });
    var grouped = {};
    for (var i = 0; i < row.cells.length; i++) {
        var cell = row.cells[i];
        for (var j = 0; j < cell.changes.length; j++) {
            var change = cell.changes[j];
            var key = JSON.stringify([change.field, change.from, change.to]);
            var detail = grouped[key];
            if (!detail) detail = grouped[key] = { field: change.field, property: change.title,
                from: change.from, to: change.to, columns: [], targets: [] };
            detail.columns.push(cell.rightCol);
            detail.targets.push({ side: 'both', row: row.right, col: cell.rightCol,
                leftRow: row.left, leftCol: cell.leftCol });
            if (!detail.cellInfoSet) {
                detail.cellBeforeInfo = root.TemplatePreview && root.TemplatePreview.cellInfo
                    ? root.TemplatePreview.cellInfo(leftModel, row.left, cell.leftCol) : null;
                detail.cellAfterInfo = root.TemplatePreview && root.TemplatePreview.cellInfo
                    ? root.TemplatePreview.cellInfo(rightModel, row.right, cell.rightCol) : null;
                detail.cellInfoSet = true;
            }
            if (change.field === 'font' && !detail.fontSampleSet) {
                detail.fontBefore = detail.cellBeforeInfo && detail.cellBeforeInfo.font || null;
                detail.fontAfter = detail.cellAfterInfo && detail.cellAfterInfo.font || null;
                detail.textBefore = detail.cellBeforeInfo ? detail.cellBeforeInfo.text : null;
                detail.textAfter = detail.cellAfterInfo ? detail.cellAfterInfo.text : null;
                detail.fontSampleSet = true;
            }
        }
    }
    Object.keys(grouped).forEach(function (key) {
        var detail = grouped[key];
        detail.columnLabel = columnRange(detail.columns);
        details.push(detail);
    });
    details.sort(function (a, b) {
        var ac = a.columns && a.columns.length ? a.columns[0] : -1;
        var bc = b.columns && b.columns.length ? b.columns[0] : -1;
        return ac - bc;
    });
    var rowNumber = row.right + 1;
    var text = details.map(function (detail) {
        return 'Строка ' + rowNumber + ', ' + detail.property + ' '
            + valueText(detail.from) + ' → ' + valueText(detail.to);
    }).join(EOL);
    var targets = [];
    details.forEach(function (detail) { targets = targets.concat(detail.targets || []); });
    return changeEntry('changed', 'Строка ' + rowNumber, text,
        { row: row.right, rowEnd: row.right, leftRow: row.left, leftRowEnd: row.left, side: 'both' }, null, null, null, null, {
            details: details, targets: targets
        });
}

function rowChangeSignature(entry) {
    return JSON.stringify((entry.details || []).map(function (detail) {
        return [detail.field || '', detail.property || '', detail.from, detail.to,
            detail.columns ? detail.columns.slice().sort(function (a, b) { return a - b; }) : []];
    }));
}

function mergeRowChangeEntries(first, next) {
    first.rowEnd = next.rowEnd;
    first.leftRowEnd = next.leftRowEnd;
    first.title = 'Строки ' + (first.row + 1) + '–' + (first.rowEnd + 1);
    first.text = first.details.map(function (detail) {
        return first.title + ', ' + detail.property + ' '
            + valueText(detail.from) + ' → ' + valueText(detail.to);
    }).join(EOL);
    first.targets = first.targets.concat(next.targets || []);
    for (var i = 0; i < first.details.length; i++) {
        first.details[i].targets = (first.details[i].targets || []).concat(
            next.details[i] && next.details[i].targets || []);
    }
    return first;
}

function findMerge(model, id) {
    var merges = model && model.merges || [];
    for (var i = 0; i < merges.length; i++) {
        var merge = merges[i];
        var key = [merge.columnsID || '', merge.r, merge.c, merge.h, merge.w].join(':');
        if (key === id) return merge;
    }
    return null;
}

function mergeSummary(metaEntries, leftModel, rightModel) {
    var removed = [], added = [], changed = [], targets = [];
    function rangeText(merge) {
        if (!merge) return '';
        var row = Number(merge.r), col = Number(merge.c);
        var rows = Math.max(1, (Number(merge.h) || 0) + 1);
        var cols = Math.max(1, (Number(merge.w) || 0) + 1);
        var rowText = row < 0 ? 'все строки' : rows === 1 ? 'строка ' + (row + 1)
            : 'строки ' + (row + 1) + '–' + (row + rows);
        var colText = cols === 1 ? 'столбец ' + (col + 1)
            : 'столбцы ' + (col + 1) + '–' + (col + cols);
        return rowText + ', ' + colText;
    }
    function mergeTarget(merge, side, model) {
        if (!merge) return null;
        var row = Number(merge.r), rows = Math.max(1, (Number(merge.h) || 0) + 1);
        return { side: side, row: row < 0 ? 0 : row, col: Number(merge.c),
            rows: row < 0 ? Math.max(1, (model.rows || []).length) : rows,
            cols: Math.max(1, (Number(merge.w) || 0) + 1) };
    }
    metaEntries.forEach(function (meta) {
        var merge = meta.kind === 'added' ? findMerge(rightModel, meta.id) : findMerge(leftModel, meta.id);
        var text = rangeText(merge) || meta.id;
        if (meta.kind === 'added') {
            added.push(text);
            var addedTarget = mergeTarget(merge, 'right', rightModel);
            if (addedTarget) targets.push(addedTarget);
        } else if (meta.kind === 'removed') {
            removed.push(text);
            var removedTarget = mergeTarget(merge, 'left', leftModel);
            if (removedTarget) targets.push(removedTarget);
        } else if (meta.kind === 'changed') {
            changed.push(rangeText(meta.before) + ' → ' + rangeText(meta.after));
            var beforeTarget = mergeTarget(meta.before, 'left', leftModel);
            var afterTarget = mergeTarget(meta.after, 'right', rightModel);
            if (beforeTarget) targets.push(beforeTarget);
            if (afterTarget) targets.push(afterTarget);
        }
    });
    var note = [];
    if (removed.length) note.push('Удалено: ' + removed.length + ' (' + removed.slice(0, 5).join('; ') + (removed.length > 5 ? '; …' : '') + ')');
    if (added.length) note.push('Добавлено: ' + added.length + ' (' + added.slice(0, 5).join('; ') + (added.length > 5 ? '; …' : '') + ')');
    if (changed.length) note.push('Изменено: ' + changed.length + ' (' + changed.slice(0, 5).join('; ') + (changed.length > 5 ? '; …' : '') + ')');
    var text = metaEntries.map(function (meta) {
        if (meta.kind === 'changed') return 'Изменено объединение '
            + (rangeText(meta.before) || meta.id) + ' → ' + (rangeText(meta.after) || meta.id);
        return (meta.kind === 'added' ? 'Добавлено объединение ' : 'Удалено объединение ')
            + (rangeText(meta.after || meta.before) || meta.id);
    }).join(EOL);
    return changeEntry('changed', 'Объединения ячеек', text,
        { side: 'both' }, null, null, null, note.join(' · '), { targets: targets, structural: 'merge' });
}

function changeList(diff, leftModel, rightModel) {
    var out = [];
    var mergeChanges = [];
    var i, j;
    for (i = 0; i < diff.columns.length; i++) {
        var col = diff.columns[i];
        if (col.kind === 'added') out.push(changeEntry('added', 'Колонка ' + (col.right + 1),
            'Колонка ' + (col.right + 1) + ' добавлена', { col: col.right, colEnd: col.right, side: 'right' }, null, null, null, null,
            { structural: 'column' }));
        else if (col.kind === 'removed') out.push(changeEntry('removed', 'Колонка ' + (col.left + 1),
            'Колонка ' + (col.left + 1) + ' удалена', { col: col.left, colEnd: col.left, side: 'left' }, null, null, null, null,
            { structural: 'column' }));
        else if (col.kind === 'changed') {
            for (j = 0; j < col.changes.length; j++) {
                var cc = col.changes[j];
                out.push(changeEntry('changed', 'Колонка ' + (col.right + 1),
                    'Колонка ' + (col.right + 1) + ': ' + cc.title + ' ' + valueText(cc.from) + ' → ' + valueText(cc.to),
                    { col: col.right, leftCol: col.left, side: 'both' }, cc.title, cc.from, cc.to, null,
                    { field: cc.field }));
            }
        }
    }
    for (i = 0; i < diff.rows.length; i++) {
        var row = diff.rows[i];
        if (row.kind === 'added' || row.kind === 'removed') {
            var first = row.kind === 'added' ? row.right : row.left;
            var last = first, next = i + 1;
            while (next < diff.rows.length && diff.rows[next].kind === row.kind
                && (row.kind === 'added' ? diff.rows[next].right : diff.rows[next].left) === last + 1) {
                last++;
                next++;
            }
            var label = first === last ? 'Строка ' + (first + 1)
                : 'Строки ' + (first + 1) + '–' + (last + 1);
            var verb = row.kind === 'added' ? 'добавлены' : 'удалены';
            var groupedRow = changeEntry(row.kind, label, label + ' ' + verb,
                { row: first, rowEnd: last, side: row.kind === 'added' ? 'right' : 'left' }, null, null, null, null, null,
                { structural: 'row' });
            groupedRow.rowEnd = last;
            groupedRow.targets = [];
            for (var targetRow = first; targetRow <= last; targetRow++)
                groupedRow.targets.push({ side: groupedRow.side, row: targetRow, col: null });
            out.push(groupedRow);
            i = next - 1;
            continue;
        }
        if (row.kind !== 'changed') continue;
        var rowEntry = rowChangeEntry(row, leftModel, rightModel);
        var previous = out.length ? out[out.length - 1] : null;
        if (previous && previous.details && previous.rowEnd + 1 === rowEntry.row
            && previous.leftRowEnd + 1 === rowEntry.leftRow
            && rowChangeSignature(previous) === rowChangeSignature(rowEntry)) {
            mergeRowChangeEntries(previous, rowEntry);
        } else out.push(rowEntry);
    }
    for (i = 0; i < diff.meta.length; i++) {
        var meta = diff.meta[i];
        if (meta.what === 'merge' || meta.what === 'unmerge') { mergeChanges.push(meta); continue; }
        var what = META_NAMES[meta.what] || meta.what;
        if (meta.kind === 'added') out.push(changeEntry('added', what + ' ' + meta.id,
            what + ' ' + meta.id + ': добавлено (' + meta.to + ')', { side: 'right' }, null, null, null, meta.to));
        else if (meta.kind === 'removed') out.push(changeEntry('removed', what + ' ' + meta.id,
            what + ' ' + meta.id + ': удалено (' + meta.from + ')', { side: 'left' }, null, null, null, meta.from));
        else out.push(changeEntry('changed', what + ' ' + meta.id,
            what + ' ' + meta.id + ': ' + valueText(meta.from) + ' → ' + valueText(meta.to),
            { side: 'both' }, 'Значение', meta.from, meta.to));
    }
    if (mergeChanges.length) out.push(mergeSummary(mergeChanges, leftModel, rightModel));
    return out;
}

var META_NAMES = {
    namedItem: 'Область',
    merge: 'Объединение',
    unmerge: 'Разъединение',
    drawing: 'Рисунок',
    option: 'Свойство'
};

/* Подсветка на обоих листах по уже посчитанному сравнению. */
function paint(left, right, diff) {
    var i, j;
    for (i = 0; i < diff.columns.length; i++) {
        var col = diff.columns[i];
        if (col.kind === 'added') markColumn(right, col.right, ADDED);
        else if (col.kind === 'removed') markColumn(left, col.left, REMOVED);
        else if (col.kind === 'changed') {
            markColumn(left, col.left, CHANGED);
            markColumn(right, col.right, CHANGED);
        }
    }
    for (i = 0; i < diff.rows.length; i++) {
        var row = diff.rows[i];
        if (row.kind === 'added') { markRow(right, row.right, ADDED); continue; }
        if (row.kind === 'removed') { markRow(left, row.left, REMOVED); continue; }
        if (row.kind !== 'changed') continue;
        if (row.changes.length) {
            markRow(left, row.left, CHANGED);
            markRow(right, row.right, CHANGED);
        }
        for (j = 0; j < row.cells.length; j++) {
            var cell = row.cells[j];
            var cls = cell.content ? CHANGED : LOOK;
            markCell(left, row.left, cell.leftCol, cls);
            markCell(right, row.right, cell.rightCol, cls);
        }
    }
}

/* Куда встал фокус, видно по яркой рамке: подсветка различий заливает целые
 * строки и колонки, и без рамки после клика непонятно, о какой именно
 * области речь. Рамка живёт на обоих листах сразу — сравнивают их парой. */
function clearFocus(host) {
    var marked = nodesOf(host, '.' + FOCUS);
    for (var i = 0; i < marked.length; i++) marked[i].classList.remove(FOCUS);
}

function focusArea(host, row, col) {
    if (row != null && col != null) markCell(host, row, col, FOCUS);
    else if (row != null) markRow(host, row, FOCUS);
    else if (col != null) markColumn(host, col, FOCUS);
}

function focusEntry(leftSheet, rightSheet, entry) {
    clearFocus(leftSheet);
    clearFocus(rightSheet);
    if (entry.targets && entry.targets.length) {
        entry.targets.forEach(function (target) {
            function mark(host, row, col) {
                if (target.rows && target.cols) {
                    for (var r = 0; r < target.rows; r++) for (var c = 0; c < target.cols; c++)
                        focusArea(host, row + r, col + c);
                } else focusArea(host, row, col);
            }
            if (target.side !== 'left') mark(rightSheet, target.row, target.col);
            if (target.side !== 'right') mark(leftSheet,
                target.leftRow != null ? target.leftRow : target.row,
                target.leftCol != null ? target.leftCol : target.col);
        });
        return;
    }
    if (entry.rowEnd != null && entry.col == null) {
        var host = entry.side === 'left' ? leftSheet : rightSheet;
        for (var row = entry.row; row <= entry.rowEnd; row++) markRow(host, row, FOCUS);
        return;
    }
    if (entry.side !== 'left') focusArea(rightSheet, entry.row, entry.col);
    /* У правки ячейки свой адрес слева: строки и колонки могли сдвинуться. */
    if (entry.side === 'left') focusArea(leftSheet, entry.row, entry.col);
    else if (entry.side === 'both')
        focusArea(leftSheet, entry.leftRow != null ? entry.leftRow : entry.row,
                  entry.leftCol != null ? entry.leftCol : entry.col);
}

function el(doc, tag, cls, text) {
    var node = doc.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
}

var KIND_NAMES = { added: 'Добавлено', removed: 'Удалено', changed: 'Изменено' };

function fontSummary(font) {
    if (!font) return 'Шрифт не задан';
    var parts = [font.faceName || 'Системный шрифт'];
    if (font.height) parts.push(font.height + ' пт');
    if (font.bold) parts.push('полужирный');
    if (font.italic) parts.push('курсив');
    if (font.underline) parts.push('подчёркнутый');
    if (font.strikeout) parts.push('зачёркнутый');
    if (font.scale && font.scale !== 100) parts.push(font.scale + '%');
    return parts.join(', ');
}

function applyCellAppearance(node, info, fallbackFont) {
    var font = info && info.font || fallbackFont;
    if (font) {
        node.style.fontFamily = (font.faceName || 'Arial') + ', Arial, sans-serif';
        node.style.fontSize = Math.max(8, Math.min(20, Number(font.height) || 8)) + 'pt';
        node.style.fontWeight = font.bold ? 'bold' : 'normal';
        node.style.fontStyle = font.italic ? 'italic' : 'normal';
        var decorations = [];
        if (font.underline) decorations.push('underline');
        if (font.strikeout) decorations.push('line-through');
        node.style.textDecoration = decorations.length ? decorations.join(' ') : 'none';
    }
    var format = info && info.format || {};
    var textColor = colorCss('textColor', format.textColor);
    var backColor = colorCss('backColor', format.backColor);
    if (textColor) node.style.color = textColor;
    if (backColor) node.style.backgroundColor = backColor;
}

function cellSample(doc, cls, info, fallback) {
    var text = info && info.text != null ? info.text : fallback;
    text = text || 'пусто';
    var node = el(doc, 'span', 'tpd-cell-sample ' + cls, text);
    node.title = text;
    applyCellAppearance(node, info, null);
    return node;
}

function fontValue(doc, cls, font, raw, cellText, cellInfo) {
    if (!font) return el(doc, 'span', cls, detailValueText('font', raw));
    var value = el(doc, 'span', cls + ' tpd-font-value');
    var sampleText = cellText == null ? '—' : (cellText || 'пусто');
    var sample = el(doc, 'span', 'tpd-font-sample', sampleText);
    sample.title = cellText == null ? '' : (cellText || 'пусто');
    applyCellAppearance(sample, cellInfo, font);
    value.appendChild(sample);
    value.appendChild(el(doc, 'span', 'tpd-font-caption', fontSummary(font)));
    value.setAttribute('title', valueText(raw));
    return value;
}

function detailRow(doc, entry, detail, options) {
    var row = el(doc, 'span', 'tpd-item-row');
    row.appendChild(el(doc, 'span', 'tpd-property', detail.property || ''));
    if (detail.field === 'font') {
        row.appendChild(fontValue(doc, 'tpd-before', detail.fontBefore, detail.from,
            detail.textBefore, detail.cellBeforeInfo));
        row.appendChild(el(doc, 'span', 'tpd-arrow', '→'));
        row.appendChild(fontValue(doc, 'tpd-after', detail.fontAfter, detail.to,
            detail.textAfter, detail.cellAfterInfo));
    } else if (detail.field === 'text') {
        row.appendChild(cellSample(doc, 'tpd-before', detail.cellBeforeInfo, detail.from));
        row.appendChild(el(doc, 'span', 'tpd-arrow', '→'));
        row.appendChild(cellSample(doc, 'tpd-after', detail.cellAfterInfo, detail.to));
    } else {
        row.appendChild(valueNode(doc, 'tpd-before', detail.property, detail.from, detail.field));
        row.appendChild(el(doc, 'span', 'tpd-arrow', '→'));
        row.appendChild(valueNode(doc, 'tpd-after', detail.property, detail.to, detail.field));
    }
    var verdict = options && options.canRestore ? options.canRestore(entry, detail) : false;
    if (verdict) row.appendChild(restoreButton(doc, 'tpd-restore', 'Вернуть только это изменение к эталону',
        function () { if (options.onRestore) options.onRestore(entry, detail); }, verdict));
    return row;
}

/* Кнопка «Вернуть» общая для всех сравнений; без DiffNav — прежняя своя.
 * verdict: true — откат доступен, строка — почему недоступен (кнопка
 * показывается выключенной с этой причиной). */
function restoreButton(doc, cls, title, onRestore, verdict) {
    var reason = typeof verdict === 'string' ? verdict : null;
    if (root.DiffNav) return root.DiffNav.restoreButton(doc, { className: cls, title: title,
        onRestore: onRestore, disabled: reason });
    var restore = el(doc, 'button', cls, 'Вернуть');
    restore.type = 'button';
    if (reason) { restore.disabled = true; restore.title = reason; return restore; }
    if (title) restore.title = title;
    restore.addEventListener('click', function (event) {
        if (event.stopPropagation) event.stopPropagation();
        onRestore();
    });
    return restore;
}

/* Второй ряд фильтров макета: к чему относится изменение. Строка с
 * правками отдельных ячеек считается изменением ячеек, со шрифтом — шрифта. */
var TYPE_FILTERS = [
    { id: 'cells', label: 'Ячейки' },
    { id: 'rows', label: 'Строки' },
    { id: 'columns', label: 'Колонки' },
    { id: 'merges', label: 'Объединения' },
    { id: 'fonts', label: 'Шрифты' }
];
function entryType(entry) {
    if (entry.structural === 'merge') return 'merges';
    if (entry.structural === 'column' || (entry.col != null && entry.row == null && entry.property)) return 'columns';
    if (entry.structural === 'row') return 'rows';
    var details = entry.details || (entry.field ? [entry] : []);
    if (details.some(function (detail) { return detail.field === 'font'; })) return 'fonts';
    if (entry.row == null) return 'other';
    return details.some(function (detail) {
        return (detail.targets || []).some(function (target) { return target.col != null; });
    }) ? 'cells' : 'rows';
}

function changeCard(doc, entry, options) {
    var item = el(doc, 'div', 'tpd-item tpd-item-' + entry.side + ' tpd-card-' + entry.kind);
    item.setAttribute('role', 'button');
    item.setAttribute('tabindex', '0');
    item.title = entry.text;
    var head = el(doc, 'span', 'tpd-item-head');
    head.setAttribute('data-badge', KIND_NAMES[entry.kind] || '');
    head.appendChild(el(doc, 'strong', 'tpd-item-title', entry.title || entry.text));
    item.appendChild(head);
    if (entry.details && entry.details.length) {
        entry.details.forEach(function (detail) { item.appendChild(detailRow(doc, entry, detail, options)); });
    } else if (entry.property) item.appendChild(detailRow(doc, entry, entry, options));
    else {
        var verdict = options && options.canRestore ? options.canRestore(entry, entry) : false;
        if (verdict) item.appendChild(restoreButton(doc, 'tpd-restore tpd-restore-structure', '',
            function () { if (options.onRestore) options.onRestore(entry, entry); }, verdict));
    }
    if (entry.note) item.appendChild(el(doc, 'span', 'tpd-item-note', entry.note));
    return item;
}

/* Прокрутка двух листов вместе. Флаг нужен потому, что заданная программно
 * прокрутка второго листа сама поднимает событие. */
function syncScroll(a, b) {
    if (!a || !b || !a.addEventListener) return function () {};
    var busy = false;
    function follow(from, to) {
        return function () {
            if (busy) return;
            busy = true;
            to.scrollTop = from.scrollTop;
            to.scrollLeft = from.scrollLeft;
            busy = false;
        };
    }
    var onA = follow(a, b);
    var onB = follow(b, a);
    a.addEventListener('scroll', onA);
    b.addEventListener('scroll', onB);
    return function () {
        a.removeEventListener('scroll', onA);
        b.removeEventListener('scroll', onB);
    };
}

function bindSplitter(handle, wrap, panes, list) {
    var dragging = false;
    function setRatio(value) {
        splitRatio = Math.max(20, Math.min(82, Math.round(value)));
        panes.style.flex = '0 1 ' + splitRatio + '%';
        list.style.flex = '1 1 0';
        handle.setAttribute('aria-valuenow', String(splitRatio));
    }
    function moveTo(clientY) {
        var rect = wrap.getBoundingClientRect();
        if (!rect.height) return;
        setRatio((clientY - rect.top) * 100 / rect.height);
    }
    function start(event) {
        if (event.button != null && event.button !== 0) return;
        dragging = true;
        handle.classList.add('tpd-resizer-dragging');
        if (event.preventDefault) event.preventDefault();
        if (handle.setPointerCapture && event.pointerId != null) {
            try { handle.setPointerCapture(event.pointerId); } catch (ignore) {}
        }
    }
    function move(event) { if (dragging) moveTo(event.clientY); }
    function end(event) {
        if (!dragging) return;
        dragging = false;
        handle.classList.remove('tpd-resizer-dragging');
        if (handle.releasePointerCapture && event.pointerId != null) {
            try { handle.releasePointerCapture(event.pointerId); } catch (ignore) {}
        }
    }
    function keydown(event) {
        var next = splitRatio;
        if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') next -= 3;
        else if (event.key === 'ArrowDown' || event.key === 'ArrowRight') next += 3;
        else if (event.key === 'Home') next = 20;
        else if (event.key === 'End') next = 82;
        else return;
        if (event.preventDefault) event.preventDefault();
        setRatio(next);
    }
    handle.setAttribute('aria-valuemin', '20');
    handle.setAttribute('aria-valuemax', '82');
    handle.setAttribute('aria-valuenow', String(splitRatio));
    setRatio(splitRatio);
    handle.addEventListener('pointerdown', start);
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
    handle.addEventListener('keydown', keydown);
    return function () {
        end({});
        handle.removeEventListener('pointerdown', start);
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', end);
        handle.removeEventListener('pointercancel', end);
        handle.removeEventListener('keydown', keydown);
    };
}

function scrollerOf(host) {
    return host && host.querySelector ? host.querySelector('.tp-scroll') : null;
}

/* Показать строку — и на том листе, где её выделили, и на втором: их
 * прокрутка синхронна, поэтому достаточно довести до вида одну. */
function reveal(host, row) {
    var scroll = scrollerOf(host);
    if (!scroll || !host.querySelectorAll) return;
    var cells = nodesOf(host, 'td');
    for (var i = 0; i < cells.length; i++) {
        if (Number(cells[i].getAttribute('data-row')) !== row) continue;
        if (cells[i].scrollIntoView) cells[i].scrollIntoView({ block: 'center' });
        return;
    }
}

function cellEntryScore(entry, side, row, col) {
    function matchesTarget(target) {
        if (target.side && target.side !== 'both' && target.side !== side) return 0;
        var targetRow = side === 'left' && target.leftRow != null ? target.leftRow : target.row;
        var targetCol = side === 'left' && target.leftCol != null ? target.leftCol : target.col;
        var rows = target.rows || 1, cols = target.cols || 1;
        if (targetRow != null && (row < targetRow || row >= targetRow + rows)) return 0;
        if (targetCol != null && (col < targetCol || col >= targetCol + cols)) return 0;
        if (targetRow != null && targetCol != null) return rows > 1 || cols > 1 ? 4 : 5;
        if (targetRow != null) return 2;
        if (targetCol != null) return 1;
        return 0;
    }
    var targets = entry.targets || [];
    var score = 0;
    for (var i = 0; i < targets.length; i++) score = Math.max(score, matchesTarget(targets[i]));
    if (targets.length) return score;
    if (entry.side && entry.side !== 'both' && entry.side !== side) return 0;
    var targetRow = side === 'left' && entry.leftRow != null ? entry.leftRow : entry.row;
    var targetCol = side === 'left' && entry.leftCol != null ? entry.leftCol : entry.col;
    if (targetRow != null && (row < targetRow || row > (entry.rowEnd != null ? entry.rowEnd : targetRow))) return 0;
    if (targetCol != null && targetCol !== col) return 0;
    if (targetRow != null && targetCol != null) return 5;
    if (targetRow != null) return 2;
    if (targetCol != null) return 1;
    return 0;
}

function selectEntry(list, leftSheet, rightSheet, entry, item, scrollItem) {
    if (entry.row != null && entry.side !== 'left') {
        var lastRow = entry.rowEnd != null ? entry.rowEnd : entry.row;
        for (var row = entry.row; row <= lastRow; row++) reveal(rightSheet, row);
    }
    if (entry.leftRow != null) {
        var lastMappedLeftRow = entry.leftRowEnd != null ? entry.leftRowEnd : entry.leftRow;
        for (var mappedLeftRow = entry.leftRow; mappedLeftRow <= lastMappedLeftRow; mappedLeftRow++)
            reveal(leftSheet, mappedLeftRow);
    }
    else if (entry.row != null && entry.side === 'left') {
        var lastLeftRow = entry.rowEnd != null ? entry.rowEnd : entry.row;
        for (var leftRow = entry.row; leftRow <= lastLeftRow; leftRow++) reveal(leftSheet, leftRow);
    }
    if (entry.targets && entry.targets.length) {
        var seen = {};
        entry.targets.forEach(function (target) {
            var side = target.side === 'left' ? 'left' : 'right';
            if (seen[side] || target.row == null) return;
            seen[side] = true;
            reveal(side === 'left' ? leftSheet : rightSheet, target.row);
        });
    }
    var marked = nodesOf(list, '.tpd-item-on');
    for (var k = 0; k < marked.length; k++) marked[k].classList.remove('tpd-item-on');
    item.classList.add('tpd-item-on');
    focusEntry(leftSheet, rightSheet, entry);
    if (scrollItem && item.scrollIntoView) item.scrollIntoView({ block: 'nearest' });
}

function bindCellSelection(leftSheet, rightSheet, entries, items, onSelect) {
    var bindings = [];
    function bind(host, side) {
        var cells = nodesOf(host, 'td');
        for (var i = 0; i < cells.length; i++) {
            var cell = cells[i];
            var rowValue = cell.getAttribute('data-row'), colValue = cell.getAttribute('data-col');
            if (rowValue == null || colValue == null) continue;
            (function (td, row, col) {
                var handler = function () {
                    var best = -1, bestScore = 0;
                    for (var j = 0; j < entries.length; j++) {
                        var score = cellEntryScore(entries[j], side, row, col);
                        if (score > bestScore) { best = j; bestScore = score; }
                    }
                    if (best >= 0) onSelect(entries[best], items[best], true);
                };
                td.addEventListener('click', handler);
                bindings.push({ cell: td, handler: handler });
            })(cell, Number(rowValue), Number(colValue));
        }
    }
    bind(leftSheet, 'left');
    bind(rightSheet, 'right');
    return function () {
        for (var i = 0; i < bindings.length; i++)
            bindings[i].cell.removeEventListener('click', bindings[i].handler);
        bindings = [];
    };
}

/* Тот же список, что и на экране, только строками: его уносят в письмо или
 * в задачу, поэтому переносы — windows-овские, как везде в плагине. */
function listText(entries) {
    var lines = [];
    for (var i = 0; i < entries.length; i++) lines.push(entries[i].text);
    return lines.join(EOL);
}

/* Буфер обмена: сначала обычный путь, а если хост не дал прав — старый
 * execCommand через скрытое поле. Ответ приходит в callback, потому что
 * clipboard.writeText асинхронный. */
function writeClipboard(doc, text, done) {
    function fallback() {
        try {
            var area = doc.createElement('textarea');
            area.value = text;
            area.setAttribute('style', 'position:fixed;left:-9999px;top:0;');
            doc.body.appendChild(area);
            area.focus();
            area.select();
            var ok = doc.execCommand && doc.execCommand('copy');
            doc.body.removeChild(area);
            done(!!ok);
        } catch (err) { done(false); }
    }
    var nav = root.navigator;
    if (!nav || !nav.clipboard || !nav.clipboard.writeText) { fallback(); return; }
    try {
        var result = nav.clipboard.writeText(text);
        if (result && result.then) result.then(function () { done(true); }, fallback);
        else done(true);
    } catch (err) { fallback(); }
}

/* options: { left: {model, label}, right: {model, label}, diff } */
function render(doc, host, options) {
    var preview = root.TemplatePreview;
    if (!doc || !host || !preview || !options) return null;
    var diff = options.diff;
    host.innerHTML = '';
    var wrap = el(doc, 'div', 'tpd');

    var panes = el(doc, 'div', 'tpd-panes');
    var leftPane = el(doc, 'div', 'tpd-pane tpd-pane-left');
    var rightPane = el(doc, 'div', 'tpd-pane tpd-pane-right');
    leftPane.appendChild(el(doc, 'div', 'tpd-pane-head', options.left.label || 'эталон'));
    rightPane.appendChild(el(doc, 'div', 'tpd-pane-head', options.right.label || 'текущее состояние'));
    var leftSheet = el(doc, 'div', 'tpd-sheet');
    var rightSheet = el(doc, 'div', 'tpd-sheet');
    leftPane.appendChild(leftSheet);
    rightPane.appendChild(rightSheet);
    panes.appendChild(leftPane);
    panes.appendChild(rightPane);
    wrap.appendChild(panes);

    var splitter = el(doc, 'div', 'tpd-resizer');
    splitter.setAttribute('role', 'separator');
    splitter.setAttribute('aria-orientation', 'horizontal');
    splitter.setAttribute('aria-label', 'Изменить высоту просмотра и списка изменений');
    splitter.setAttribute('title', 'Перетащите, чтобы изменить высоту просмотра и списка изменений');
    splitter.setAttribute('tabindex', '0');
    wrap.appendChild(splitter);

    var list = el(doc, 'div', 'tpd-list');
    wrap.appendChild(list);
    host.appendChild(wrap);

    if (diff && diff.error) {
        list.appendChild(el(doc, 'div', 'tpd-empty', diff.error));
        return { element: wrap, destroy: function () {} };
    }

    if (diff && diff.approximate) {
        var axes = [];
        if (diff.approximate.rows) axes.push('строки');
        if (diff.approximate.columns) axes.push('колонки');
        list.appendChild(el(doc, 'div', 'tpd-approx', 'Упрощённое сравнение: макет слишком большой, '
            + axes.join(' и ') + ' сопоставлены по номерам, а не по содержимому. '
            + 'Вставки и удаления могут показаться сдвигом всех последующих.'));
    }

    preview.render(options.left.model, leftSheet, {});
    preview.render(options.right.model, rightSheet, {});
    paint(leftSheet, rightSheet, diff);

    var entries = changeList(diff, options.left.model, options.right.model);
    var items = [];
    var rows = [];
    var filters = null;
    var nav = null;
    var text = listText(entries);
    if (!entries.length) {
        list.appendChild(el(doc, 'div', 'tpd-empty', 'Различий нет'));
    } else {
        var head = el(doc, 'div', 'tpd-list-head');
        head.appendChild(el(doc, 'span', 'tpd-list-count', 'Изменения: ' + entries.length));
        var copy = el(doc, 'button', 'tpd-copy', 'Копировать');
        copy.type = 'button';
        copy.title = 'Скопировать список изменений в буфер обмена';
        if (copy.addEventListener) copy.addEventListener('click', function () {
            writeClipboard(doc, text, function (ok) {
                copy.textContent = ok ? 'Скопировано' : 'Не вышло';
                if (root.setTimeout) root.setTimeout(function () { copy.textContent = 'Копировать'; }, 1500);
            });
        });
        head.appendChild(copy);
        list.appendChild(head);
        for (var i = 0; i < entries.length; i++) {
            (function (entry) {
                var item = changeCard(doc, entry, options);
                item.addEventListener('click', function () {
                    choose(entry, item, false);
                });
                item.addEventListener('keydown', function (event) {
                    if (event.target !== item || (event.key !== 'Enter' && event.key !== ' ')) return;
                    if (event.preventDefault) event.preventDefault();
                    choose(entry, item, false);
                });
                list.appendChild(item);
                items.push(item);
                rows.push({ entry: entry, card: item });
            })(entries[i]);
        }
        /* Счётчик и «XML-текст» — в строке заголовка, фильтры — под ней. */
        if (root.DiffNav) {
            filters = root.DiffNav.filterBar(doc, rows, { types: TYPE_FILTERS, typeOf: entryType,
                onChange: function () { if (nav) nav.refresh(); } });
            nav = root.DiffNav.navBar(doc, {
                keyTarget: wrap,
                items: function () { return filters.visibleRows().map(function (row) { return row.card; }); },
                onSelect: function (item, index) {
                    var row = filters.visibleRows()[index];
                    if (row) selectEntry(list, leftSheet, rightSheet, row.entry, item, true);
                }
            });
            head.insertBefore(nav.element, head.firstChild);
            if (options.onShowXml) head.appendChild(root.DiffNav.xmlButton(doc, options.onShowXml));
            list.insertBefore(filters.element, items[0]);
            filters.empty.classList.add('tpd-empty');
            list.appendChild(filters.empty);
            filters.apply();
            nav.refresh();
        }
    }
    function choose(entry, item, scrollItem) {
        selectEntry(list, leftSheet, rightSheet, entry, item, scrollItem);
        if (nav) nav.setCurrent(item);
    }

    var unbindCellSelection = bindCellSelection(leftSheet, rightSheet, entries, items, function (entry, item, scrollItem) {
        choose(entry, item, scrollItem);
    });
    var unsync = syncScroll(scrollerOf(leftSheet), scrollerOf(rightSheet));
    var unbindSplitter = bindSplitter(splitter, wrap, panes, list);
    return {
        element: wrap,
        entries: entries,
        text: text,
        next: function () { return nav ? nav.next() : null; },
        prev: function () { return nav ? nav.prev() : null; },
        destroy: function () { unsync(); unbindSplitter(); unbindCellSelection(); if (nav) nav.destroy(); }
    };
}

root.TemplateDiffView = {
    render: render,
    _test: {
        changeList: changeList,
        listText: listText,
        focusEntry: focusEntry,
        paint: paint,
        markCell: markCell,
        markRow: markRow,
        markColumn: markColumn,
        syncScroll: syncScroll,
        rowChangeEntry: rowChangeEntry,
        mergeSummary: mergeSummary,
        bindSplitter: bindSplitter,
        colorCss: colorCss,
        cellEntryScore: cellEntryScore,
        bindCellSelection: bindCellSelection,
        entryType: entryType
    }
};

})(window);
