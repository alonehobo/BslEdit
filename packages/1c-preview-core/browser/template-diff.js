/* Сравнение двух табличных документов по разобранной модели.
 *
 * Текстовый diff здесь бесполезен: .mxl двоичный, а в Template.xml один
 * сдвиг строки перенумеровывает весь файл. Поэтому сравниваются модели
 * TemplatePreview.parse(): сначала выравниваются колонки, затем строки, и
 * только у сопоставленных пар ячейки сличаются поле за полем.
 *
 * Модуль ничего не рисует и не трогает DOM: он отдаёт структуру, по которой
 * панель сравнения красит уже отрисованную сетку. */
(function (root) {
'use strict';

var TP = root.TemplatePreview;

/* Сколько пар строк/колонок ещё имеет смысл выравнивать полным LCS.
 * Дальше таблица O(n*m) съедает память, и сравнение идёт по индексам. */
var LCS_LIMIT = 4000000;

var SEP = String.fromCharCode(1);
var ROW_SEP = String.fromCharCode(2);
var DASH = String.fromCharCode(0x2013);

function isBlank(v) {
    return v == null || v === '';
}

function textKey(v) {
    return isBlank(v) ? '' : String(v);
}

/* Индекс объединений нужен для распознавания ячеек, которые не имеют
 * самостоятельного отображаемого содержимого. */
function mergeIndex(model) {
    var rows = {};
    var merges = (model && model.merges) || [];
    function add(merge, y, anchorRow) {
        var list = rows[y] || (rows[y] = []);
        list.push({ first: merge.c || 0, last: (merge.c || 0) + Math.max(0, merge.w || 0),
            row: anchorRow, col: merge.c || 0 });
    }
    for (var i = 0; i < merges.length; i++) {
        var merge = merges[i];
        if (merge.r === -1) {
            for (var groupRow = 0; groupRow < (model.rows || []).length; groupRow++) {
                var columnsID = (model.rows[groupRow] && model.rows[groupRow].columnsID) || '';
                if (merge.columnsID ? merge.columnsID !== columnsID : !!columnsID) continue;
                var split = false;
                var unmerges = model.unmerges || [];
                for (var u = 0; u < unmerges.length; u++) {
                    var unmerge = unmerges[u];
                    if (unmerge.r !== groupRow) continue;
                    if ((merge.c || 0) <= unmerge.c + (unmerge.w || 0)
                        && unmerge.c <= (merge.c || 0) + (merge.w || 0)) { split = true; break; }
                }
                if (!split) add(merge, groupRow, groupRow);
            }
            continue;
        }
        var first = Math.max(0, merge.r || 0);
        var last = first + Math.max(0, merge.h || 0);
        for (var y = first; y <= last; y++) {
            var rowID = (model.rows[y] && model.rows[y].columnsID) || '';
            if (merge.columnsID && merge.columnsID !== rowID) continue;
            add(merge, y, first);
        }
    }
    Object.keys(rows).forEach(function (y) {
        rows[y].sort(function (a, b) { return a.first - b.first; });
    });
    return rows;
}

function mergedAt(index, y, x) {
    var list = index && index[y];
    if (!list) return null;
    for (var i = 0; i < list.length; i++) {
        if (x < list[i].first) break;
        if (x <= list[i].last) return list[i];
    }
    return null;
}

function cellContentKey(model, y, x, merges) {
    if (merges && isCoveredCell(merges, y, x)) return '';
    var info = TP.cellInfo(model, y, x);
    if (!info) return '';
    return textKey(info.text) + SEP + textKey(info.parameter)
        + SEP + textKey(info.detail) + SEP + textKey(info.fillType)
        + SEP + textKey(info.cell && info.cell.translations);
}

function isCoveredCell(merges, y, x) {
    var merge = mergedAt(merges, y, x);
    return !!merge && (merge.row !== y || merge.col !== x);
}

/* Что в ячейке написано — без оформления. По этому ключу ищется общая
 * подпоследовательность: перекрашенная строка остаётся той же строкой. */

function fontKey(font) {
    if (!font) return '';
    return [font.faceName, font.height, font.bold ? 'b' : '', font.italic ? 'i' : '',
        font.underline ? 'u' : '', font.strikeout ? 's' : '',
        /* Шрифт без kind и scale — это Absolute 100: не изменение. */
        font.kind || 'Absolute', font.scale || 100].join(',');
}

function lineKey(line) {
    if (!line) return '';
    return [line.style, line.width, line.gap ? 'gap' : ''].join(',');
}

/* Поля ячейки, которые видит пользователь. Порядок задаёт и порядок строк
 * в списке изменений. */
var CELL_FIELDS = [
    { id: 'text', title: 'Текст', of: function (i) { return textKey(i.text); } },
    { id: 'translations', title: 'Переводы', of: function (i) { return textKey(i.cell && i.cell.translations); } },
    { id: 'parameter', title: 'Параметр', of: function (i) { return textKey(i.parameter); } },
    { id: 'detail', title: 'Расшифровка', of: function (i) { return textKey(i.detail); } },
    { id: 'fillType', title: 'Заполнение', of: function (i) { return textKey(i.fillType); } },
    { id: 'note', title: 'Примечание', of: function (i) { return textKey(i.cell && i.cell.note); } },
    { id: 'font', title: 'Шрифт', of: function (i) { return fontKey(i.font); } },
    { id: 'textColor', title: 'Цвет текста', of: function (i) { return textKey(i.format.textColor); } },
    { id: 'backColor', title: 'Цвет фона', of: function (i) { return textKey(i.format.backColor); } },
    { id: 'pattern', title: 'Узор', of: function (i) { return textKey(i.format.pattern); } },
    { id: 'numberFormat', title: 'Формат', of: function (i) { return textKey(i.format.numberFormat); } },
    { id: 'horizontalAlignment', title: 'Гор. положение', of: function (i) { return textKey(i.format.horizontalAlignment); } },
    { id: 'verticalAlignment', title: 'Верт. положение', of: function (i) { return textKey(i.format.verticalAlignment); } },
    { id: 'textPlacement', title: 'Размещение', of: function (i) { return textKey(i.format.textPlacement); } },
    { id: 'textOrientation', title: 'Ориентация', of: function (i) { return textKey(i.format.textOrientation); } },
    { id: 'hyperLink', title: 'Гиперссылка', of: function (i) { return textKey(i.format.hyperLink); } },
    { id: 'borderLeft', title: 'Граница слева', of: function (i) { return lineKey(i.borders.left); } },
    { id: 'borderTop', title: 'Граница сверху', of: function (i) { return lineKey(i.borders.top); } },
    { id: 'borderRight', title: 'Граница справа', of: function (i) { return lineKey(i.borders.right); } },
    { id: 'borderBottom', title: 'Граница снизу', of: function (i) { return lineKey(i.borders.bottom); } }
];

var CONTENT_FIELDS = { text: true, parameter: true, detail: true, fillType: true, note: true, translations: true };

function cellFields(model, y, x) {
    var info = TP.cellInfo(model, y, x);
    if (!info) return null;
    if (!info.format) info.format = {};
    var out = {};
    for (var i = 0; i < CELL_FIELDS.length; i++) {
        out[CELL_FIELDS[i].id] = CELL_FIELDS[i].of(info);
    }
    return out;
}

/* Общая подпоследовательность по ключам. Возвращает пары индексов;
 * непарные элементы вызывающий трактует как вставку или удаление. */
/* tieA/tieB — необязательные вторичные ключи. Совпадение основного ключа
 * весит MATCH, совпадение ещё и вторичного добавляет единицу: общая
 * подпоследовательность остаётся самой длинной, но среди равных по длине
 * выбирается та, где совпадает больше вторичных ключей. Так одинаковые пустые
 * колонки различаются по ширине и оформлению. */
/* Больше любого числа вторичных совпадений: min(n, m) <= sqrt(LCS_LIMIT). */
var MATCH = 65536;

/* Куда compare() собирает оси, выровненные упрощённо (по индексу). */
var approxAxis = null;
var approxHit = null;

function alignKeys(a, b, preferRightGaps, tieA, tieB) {
    var n = a.length, m = b.length;
    if (n * m > LCS_LIMIT) {
        if (approxHit && approxAxis) approxHit[approxAxis] = true;
        var byIndex = [];
        for (var k = 0; k < Math.min(n, m); k++) byIndex.push([k, k]);
        return byIndex;
    }
    function gain(i, j) {
        if (a[i] !== b[j]) return 0;
        return MATCH + (tieA && tieB && tieA[i] === tieB[j] ? 1 : 0);
    }
    var prev = new Int32Array(m + 1);
    var rows = [];
    for (var i = 0; i < n; i++) {
        var cur = new Int32Array(m + 1);
        for (var j = 0; j < m; j++) {
            var g = gain(i, j);
            cur[j + 1] = Math.max(cur[j], prev[j + 1], g ? prev[j] + g : 0);
        }
        rows.push(cur);
        prev = cur;
    }
    var pairs = [];
    var y = n, x = m;
    while (y > 0 && x > 0) {
        var diag = y > 1 ? rows[y - 2][x - 1] : 0;
        var here = gain(y - 1, x - 1);
        if (here && rows[y - 1][x] === diag + here) {
            pairs.push([y - 1, x - 1]);
            y--; x--;
        } else if ((y > 1 ? rows[y - 2][x] : 0) > rows[y - 1][x - 1]
            || (!preferRightGaps && (y > 1 ? rows[y - 2][x] : 0) === rows[y - 1][x - 1])) {
            y--;
        } else {
            x--;
        }
    }
    pairs.reverse();
    return pairs;
}

/* Разворачивает пары выравнивания в сплошную ленту: same/removed/added
 * в том порядке, в котором их покажут рядом друг с другом. */
function weave(pairs, n, m) {
    var out = [];
    var i = 0, j = 0;
    for (var p = 0; p < pairs.length; p++) {
        var li = pairs[p][0], ri = pairs[p][1];
        while (i < li) out.push({ kind: 'removed', left: i++, right: null });
        while (j < ri) out.push({ kind: 'added', left: null, right: j++ });
        out.push({ kind: 'same', left: li, right: ri });
        i = li + 1; j = ri + 1;
    }
    while (i < n) out.push({ kind: 'removed', left: i++, right: null });
    while (j < m) out.push({ kind: 'added', left: null, right: j++ });
    return out;
}

/* LCS сцепляет только совпавшие строки, а изменённая строка в него не
 * попадает никогда: её ключ другой. Без этого шага правка одной ячейки
 * выглядит как удаление строки и вставка новой. Поэтому подряд идущие
 * удаления и вставки сличаются между собой, и достаточно похожие пары
 * склеиваются обратно в одну строку. */
var PAIR_THRESHOLD = 0.4;

function hasContent(key) {
    var cells = key.split(ROW_SEP);
    for (var i = 0; i < cells.length; i++) {
        var fields = cells[i].split(SEP);
        if (fields[0] || fields[1] || fields[2] || (fields[3] && fields[3] !== 'Text') || fields[4]) return true;
    }
    return false;
}

function similarity(a, b) {
    if (!a.length && !b.length) return 1;
    var av = a.split(ROW_SEP), bv = b.split(ROW_SEP);
    var n = Math.max(av.length, bv.length);
    var same = 0, filled = 0;
    for (var i = 0; i < n; i++) {
        var l = av[i] || '', r = bv[i] || '';
        if (!hasContent(l) && !hasContent(r)) continue;
        filled++;
        if (l === r) same++;
    }
    return filled ? same / filled : 0;
}

function contentCellCount(key) {
    return key.split(ROW_SEP).filter(hasContent).length;
}

function pairSimilar(lane, leftKeys, rightKeys, allowSingleCellEdit) {
    var out = [];
    var i = 0;
    while (i < lane.length) {
        if (lane[i].kind !== 'removed' && lane[i].kind !== 'added') {
            out.push(lane[i++]);
            continue;
        }
        var start = i;
        while (i < lane.length && (lane[i].kind === 'removed' || lane[i].kind === 'added')) i++;
        var run = lane.slice(start, i);
        var removed = run.filter(function (x) { return x.kind === 'removed'; });
        var added = run.filter(function (x) { return x.kind === 'added'; });
        var pairs = [];
        var k = 0;
        while (k < removed.length && k < added.length) {
            var leftKey = leftKeys[removed[k].left], rightKey = rightKeys[added[k].right];
            var sim = similarity(leftKey, rightKey);
            var oneCellEdit = allowSingleCellEdit && contentCellCount(leftKey) === 1
                && contentCellCount(rightKey) === 1;
            if (sim < PAIR_THRESHOLD && !oneCellEdit) break;
            pairs.push({ kind: 'same', left: removed[k].left, right: added[k].right });
            k++;
        }
        out = out.concat(pairs);
        for (var r = k; r < removed.length; r++) out.push(removed[r]);
        for (var d = k; d < added.length; d++) out.push(added[d]);
    }
    return out;
}

function sheetWidthOf(model) {
    return Math.max(1, TP.sheetWidth(model) || 1);
}

function indexes(count) {
    var out = [];
    for (var i = 0; i < count; i++) out.push(i);
    return out;
}

/* Ключ колонки — её ячейки в перечисленных строках. Строки передаются
 * списком, а не числом: колонки сравниваются по уже сопоставленным строкам,
 * иначе вставка строки сдвигает содержимое колонки и ни одна не совпадает. */
function columnKeys(model, width, rows) {
    var keys = [];
    for (var x = 0; x < width; x++) {
        var parts = [];
        for (var i = 0; i < rows.length; i++) parts.push(cellContentKey(model, rows[i], x));
        keys.push(parts.join(ROW_SEP));
    }
    return keys;
}

/* У одинаковых пустых колонок нет содержимого для различения. Уникальная
 * заданная ширина служит дополнительным якорем: после него повторяющиеся
 * пустые позиции выравниваются локально, а не сдвигают весь хвост листа. */
function alignColumnKeys(leftKeys, rightKeys, leftModel, rightModel, leftLook, rightLook) {
    function uniqueWidths(model, count) {
        var byWidth = {};
        for (var i = 0; i < count; i++) {
            var width = sizeOf(model, 0, i).width;
            if (width == null) continue;
            var key = String(width);
            if (!byWidth[key]) byWidth[key] = [];
            byWidth[key].push(i);
        }
        return byWidth;
    }
    var leftWidths = uniqueWidths(leftModel, leftKeys.length);
    var rightWidths = uniqueWidths(rightModel, rightKeys.length);
    var anchors = [];
    Object.keys(leftWidths).forEach(function (key) {
        if (leftWidths[key].length !== 1 || !rightWidths[key] || rightWidths[key].length !== 1) return;
        anchors.push([leftWidths[key][0], rightWidths[key][0]]);
    });
    anchors.sort(function (a, b) { return a[0] - b[0]; });
    var ordered = [], lastRight = -1;
    for (var i = 0; i < anchors.length; i++) {
        if (anchors[i][1] <= lastRight) continue;
        ordered.push(anchors[i]);
        lastRight = anchors[i][1];
    }
    var pairs = [], leftStart = 0, rightStart = 0;
    function alignSegment(leftEnd, rightEnd) {
        var local = alignKeys(leftKeys.slice(leftStart, leftEnd), rightKeys.slice(rightStart, rightEnd), true,
            leftLook && leftLook.slice(leftStart, leftEnd), rightLook && rightLook.slice(rightStart, rightEnd));
        for (var k = 0; k < local.length; k++) pairs.push([local[k][0] + leftStart, local[k][1] + rightStart]);
    }
    for (i = 0; i < ordered.length; i++) {
        alignSegment(ordered[i][0], ordered[i][1]);
        pairs.push(ordered[i]);
        leftStart = ordered[i][0] + 1;
        rightStart = ordered[i][1] + 1;
    }
    alignSegment(leftKeys.length, rightKeys.length);
    return pairs;
}

/* Вторичный ключ колонки — как она выглядит: ширина, скрытие и оформление
 * её ячеек. Он не участвует в самом сопоставлении, а только выбирает между
 * равными по содержимому кандидатами. */
function columnLookKeys(model, width, rows) {
    var keys = [];
    for (var x = 0; x < width; x++) {
        var size = sizeOf(model, 0, x);
        var parts = [String(size.width), String(size.hidden)];
        for (var i = 0; i < rows.length; i++) {
            var fields = cellFields(model, rows[i], x);
            parts.push(fields ? CELL_FIELDS.map(function (f) { return fields[f.id]; }).join(SEP) : '');
        }
        keys.push(parts.join(ROW_SEP));
    }
    return keys;
}

/* Ключ строки — её ячейки в перечисленных колонках. */
function rowKeys(model, height, cols) {
    var keys = [];
    for (var y = 0; y < height; y++) {
        var parts = [];
        for (var c = 0; c < cols.length; c++) parts.push(cellContentKey(model, y, cols[c]));
        keys.push(parts.join(ROW_SEP));
    }
    return keys;
}

/* Начальное выравнивание строк ещё не знает, какие колонки сдвинулись.
 * Сравниваем последовательность заполненных ячеек без пустых координат,
 * чтобы вставленная колонка не скрывала совпадение всей строки. */
function rowSequenceKeys(model, height, width) {
    var keys = [];
    for (var y = 0; y < height; y++) {
        var parts = [];
        for (var x = 0; x < width; x++) {
            var key = cellContentKey(model, y, x);
            if (hasContent(key)) parts.push(key);
        }
        keys.push(parts.join(ROW_SEP));
    }
    return keys;
}

function sizeOf(model, y, x) {
    var size = TP.cellSize(model, y, x);
    return size || { width: null, height: null, hidden: false };
}

function mergeKey(m) {
    return [m.columnsID || '', m.r, m.c, m.h, m.w].join(':');
}

function namedKey(it) {
    return (it.kind || '') + ':' + (it.name || '');
}

function namedValue(it) {
    if (it.kind === 'drawing') return 'рисунок #' + it.drawingID;
    var type = it.type || 'Rows';
    var rows = it.beginRow + DASH + it.endRow;
    if (it.beginColumn != null && it.beginColumn >= 0) {
        return type + ' ' + rows + ' / ' + it.beginColumn + DASH + it.endColumn;
    }
    return type + ' ' + rows;
}

function drawingKey(d) {
    return String(d.id);
}

function drawingValue(d) {
    return [d.drawingType, d.beginRow + ':' + d.beginColumn, d.endRow + ':' + d.endColumn,
        d.pictureSize, d.pictureIndex, d.autoSize ? 'auto' : ''].join(' ');
}

function named(model, key) {
    var list = model.namedItems || [];
    for (var i = 0; i < list.length; i++) if (namedKey(list[i]) === key) return list[i];
    return null;
}

/* Область, чьи границы лишь сдвинуты вставкой или удалением строк и колонок
 * (или раздвинуты вставкой внутрь неё), не изменилась: это уже видно по
 * самим строкам и колонкам. Изменением считается только граница, которая
 * после проекции через сопоставление встала на другое место. */
function areaFollowsGrid(left, right, rowLane, colPairs) {
    if (!left || !right || left.kind === 'drawing' || (left.type || 'Rows') !== (right.type || 'Rows')) return false;
    var rows = {}, rowsBack = {}, cols = {}, colsBack = {};
    rowLane.forEach(function (pair) {
        if (pair.kind === 'added' || pair.kind === 'removed') return;
        rows[pair.left] = pair.right;
        rowsBack[pair.right] = pair.left;
    });
    colPairs.forEach(function (pair) { cols[pair[0]] = pair[1]; colsBack[pair[1]] = pair[0]; });
    function same(lb, le, rb, re, map, back) {
        var lh = lb != null && lb >= 0, rh = rb != null && rb >= 0;
        if (!lh || !rh) return lh === rh;
        if (map[lb] != null && map[le] != null) return map[lb] === rb && map[le] === re;
        for (var x = lb; x <= le; x++) if (map[x] != null && (map[x] < rb || map[x] > re)) return false;
        for (var y = rb; y <= re; y++) if (back[y] != null && (back[y] < lb || back[y] > le)) return false;
        return true;
    }
    return same(left.beginRow, left.endRow, right.beginRow, right.endRow, rows, rowsBack)
        && same(left.beginColumn, left.endColumn, right.beginColumn, right.endColumn, cols, colsBack);
}

/* Сравнение двух списков по ключу: что появилось, что пропало, что осталось
 * под тем же именем, но с другим содержимым. */
function diffList(what, left, right, keyOf, valueOf) {
    var out = [];
    var byKey = {};
    var order = [];
    var i, k;
    /* Повтор ключа (сломанный макет) — отдельный элемент, а не замена
     * первого: n-й повтор слева сопоставляется с n-м справа. */
    function keysOf(list) {
        var seen = {};
        return list.map(function (item) {
            var key = keyOf(item);
            seen[key] = (seen[key] || 0) + 1;
            return seen[key] > 1 ? key + '#' + seen[key] : key;
        });
    }
    var leftKeys = keysOf(left), rightKeys = keysOf(right);
    for (i = 0; i < left.length; i++) {
        k = leftKeys[i];
        if (!byKey[k]) { byKey[k] = {}; order.push(k); }
        byKey[k].left = left[i];
    }
    for (i = 0; i < right.length; i++) {
        k = rightKeys[i];
        if (!byKey[k]) { byKey[k] = {}; order.push(k); }
        byKey[k].right = right[i];
    }
    for (i = 0; i < order.length; i++) {
        var pair = byKey[order[i]];
        var from = pair.left ? valueOf(pair.left) : null;
        var to = pair.right ? valueOf(pair.right) : null;
        if (!pair.left) out.push({ what: what, id: order[i], kind: 'added', from: null, to: to });
        else if (!pair.right) out.push({ what: what, id: order[i], kind: 'removed', from: from, to: null });
        else if (from !== to) out.push({ what: what, id: order[i], kind: 'changed', from: from, to: to });
    }
    return out;
}

/* Вставка строки или колонки сдвигает координаты объединений. Сравниваем их
 * после проекции общих координат, чтобы каждый диапазон не превращался в
 * отдельные удаление и добавление. */
function diffMerges(left, right, rowLane, colPairs, what, label) {
    what = what || 'merge';
    label = label || 'объединение';
    var leftRows = {}, rightRows = {}, leftCols = {}, rightCols = {};
    rowLane.forEach(function (pair) {
        if (pair.kind !== 'same') return;
        leftRows[pair.left] = pair.right;
        rightRows[pair.right] = pair.left;
    });
    colPairs.forEach(function (pair) {
        leftCols[pair[0]] = pair[1];
        rightCols[pair[1]] = pair[0];
    });
    var used = {}, out = [];
    /* Объединение целиком в удалённых (добавленных) строках или колонках
     * уже показано удалением (вставкой) самих строк: отдельно о нём молчим. */
    function onlyIn(merge, rowsMap, colsMap) {
        var rowsGone = merge.r !== -1;
        for (var row = merge.r; rowsGone && row <= merge.r + merge.h; row++) if (rowsMap[row] != null) rowsGone = false;
        var colsGone = true;
        for (var col = merge.c; colsGone && col <= merge.c + merge.w; col++) if (colsMap[col] != null) colsGone = false;
        return rowsGone || colsGone;
    }
    function inside(merge, row, col) {
        return row >= merge.r && row <= merge.r + merge.h
            && col >= merge.c && col <= merge.c + merge.w;
    }
    function equivalent(a, b) {
        if ((a.columnsID || '') !== (b.columnsID || '')) return false;
        if (a.r === -1 || b.r === -1) {
            if (a.r !== -1 || b.r !== -1) return false;
            for (var groupCol = a.c; groupCol <= a.c + a.w; groupCol++) {
                if (leftCols[groupCol] == null) continue;
                if (leftCols[groupCol] < b.c || leftCols[groupCol] > b.c + b.w) return false;
            }
            for (groupCol = b.c; groupCol <= b.c + b.w; groupCol++) {
                if (rightCols[groupCol] == null) continue;
                if (rightCols[groupCol] < a.c || rightCols[groupCol] > a.c + a.w) return false;
            }
            return true;
        }
        for (var row = a.r; row <= a.r + a.h; row++) {
            if (leftRows[row] == null) continue;
            for (var col = a.c; col <= a.c + a.w; col++) {
                if (leftCols[col] == null) continue;
                if (!inside(b, leftRows[row], leftCols[col])) return false;
            }
        }
        for (row = b.r; row <= b.r + b.h; row++) {
            if (rightRows[row] == null) continue;
            for (col = b.c; col <= b.c + b.w; col++) {
                if (rightCols[col] == null) continue;
                if (!inside(a, rightRows[row], rightCols[col])) return false;
            }
        }
        return true;
    }
    for (var i = 0; i < left.length; i++) {
        var before = left[i];
        var mappedRow = before.r === -1 ? -1 : leftRows[before.r];
        var mappedCol = leftCols[before.c];
        var match = -1;
        if (mappedRow != null && mappedCol != null) {
            for (var j = 0; j < right.length; j++) {
                var after = right[j];
                if (used[j] || after.r !== mappedRow || after.c !== mappedCol
                    || (after.columnsID || '') !== (before.columnsID || '')) continue;
                match = j;
                break;
            }
        }
        if (match < 0) {
            if (!onlyIn(before, leftRows, leftCols)) out.push({ what: what, id: mergeKey(before), kind: 'removed', before: before,
                from: label, to: null });
            continue;
        }
        used[match] = true;
        if (!equivalent(before, right[match])) out.push({ what: what, id: mergeKey(before), kind: 'changed',
            before: before, after: right[match], from: label, to: label });
    }
    for (i = 0; i < right.length; i++) {
        if (!used[i] && !onlyIn(right[i], rightRows, rightCols)) out.push({ what: what, id: mergeKey(right[i]), kind: 'added', before: null,
            after: right[i], from: null, to: label });
    }
    return out;
}

function compareCells(a, b, ay, ax, by, bx) {
    var left = cellFields(a, ay, ax);
    var right = cellFields(b, by, bx);
    if (!left || !right) return null;
    var changes = [];
    var content = false;
    for (var i = 0; i < CELL_FIELDS.length; i++) {
        var f = CELL_FIELDS[i];
        if (left[f.id] === right[f.id]) continue;
        changes.push({ field: f.id, title: f.title, from: left[f.id], to: right[f.id] });
        if (CONTENT_FIELDS[f.id]) content = true;
    }
    if (!changes.length) return null;
    return { changes: changes, content: content };
}

/* Основное сравнение. На входе — две модели TemplatePreview.parse().model. */
function compare(a, b) {
    if (!a || !b) return { error: 'Нечего сравнивать' };
    var aw = sheetWidthOf(a), bw = sheetWidthOf(b);
    var ah = TP.documentRows(a) || a.height || 0;
    var bh = TP.documentRows(b) || b.height || 0;
    var leftMerges = mergeIndex(a), rightMerges = mergeIndex(b);

    /* Выравнивание идёт в три прохода, потому что строки и колонки зависят
     * друг от друга: вставка строки сдвигает каждую колонку, а вставка
     * колонки — каждую строку. Сначала строки по всему содержимому, затем
     * колонки по уже сопоставленным строкам, затем строки ещё раз — по
     * сопоставленным колонкам. Одного прохода не хватает: он сходится только
     * когда сдвига нет ни по одной оси. */
    var i;
    approxHit = {};
    approxAxis = 'rows';
    var roughLeft = rowSequenceKeys(a, ah, aw);
    var roughRight = rowSequenceKeys(b, bh, bw);
    var roughLane = pairSimilar(weave(alignKeys(roughLeft, roughRight), ah, bh),
        roughLeft, roughRight, true);
    var leftRows = [], rightRows = [];
    for (i = 0; i < roughLane.length; i++) {
        if (roughLane[i].kind !== 'same') continue;
        leftRows.push(roughLane[i].left);
        rightRows.push(roughLane[i].right);
    }
    /* Ни одной общей строки — сравнивать колонки не по чему: берём все. */
    if (!leftRows.length) { leftRows = indexes(ah); rightRows = indexes(bh); }

    var leftColKeys = columnKeys(a, aw, leftRows);
    var rightColKeys = columnKeys(b, bw, rightRows);
    /* У пустых повторяющихся колонок содержимое не различает позиции. При
     * равном LCS сохраняем ранние колонки и считаем лишние правые колонки
     * вставленными в хвост; иначе один хвостовой рост превращается в пачку
     * ложных вставок и удалений между одинаковыми колонками. */
    approxAxis = 'columns';
    var colLane = pairSimilar(weave(alignColumnKeys(leftColKeys, rightColKeys, a, b,
        columnLookKeys(a, aw, leftRows), columnLookKeys(b, bw, rightRows)), aw, bw),
        leftColKeys, rightColKeys);
    var colPairs = [];
    var leftCols = [], rightCols = [];
    for (i = 0; i < colLane.length; i++) {
        if (colLane[i].kind !== 'same') continue;
        colPairs.push([colLane[i].left, colLane[i].right]);
        leftCols.push(colLane[i].left);
        rightCols.push(colLane[i].right);
    }

    var leftRowKeys = leftCols.length ? rowKeys(a, ah, leftCols) : roughLeft;
    var rightRowKeys = rightCols.length ? rowKeys(b, bh, rightCols) : roughRight;
    approxAxis = 'rows';
    var rowPairs = alignKeys(leftRowKeys, rightRowKeys);
    var approximate = approxHit.rows || approxHit.columns
        ? { rows: !!approxHit.rows, columns: !!approxHit.columns } : null;
    approxHit = null; approxAxis = null;
    var rowLane = pairSimilar(weave(rowPairs, ah, bh), leftRowKeys, rightRowKeys, true);

    var summary = {
        rowsAdded: 0, rowsRemoved: 0, rowsChanged: 0,
        columnsAdded: 0, columnsRemoved: 0, columnsChanged: 0,
        cellsChanged: 0, metaChanged: 0
    };

    var columns = [];
    for (i = 0; i < colLane.length; i++) {
        var cl = colLane[i];
        var col = { kind: cl.kind, left: cl.left, right: cl.right, changes: [] };
        if (cl.kind === 'added') summary.columnsAdded++;
        else if (cl.kind === 'removed') summary.columnsRemoved++;
        else {
            var ls = sizeOf(a, 0, cl.left), rs = sizeOf(b, 0, cl.right);
            if (ls.width !== rs.width) col.changes.push({ field: 'width', title: 'Ширина', from: ls.width, to: rs.width });
            if (ls.hidden !== rs.hidden) col.changes.push({ field: 'hidden', title: 'Скрыта', from: ls.hidden, to: rs.hidden });
            if (col.changes.length) { col.kind = 'changed'; summary.columnsChanged++; }
        }
        columns.push(col);
    }

    var rows = [];
    for (i = 0; i < rowLane.length; i++) {
        var rl = rowLane[i];
        var row = { kind: rl.kind, left: rl.left, right: rl.right, cells: [], changes: [] };
        if (rl.kind === 'added') summary.rowsAdded++;
        else if (rl.kind === 'removed') summary.rowsRemoved++;
        else {
            var lrow = a.rows[rl.left] || {}, rrow = b.rows[rl.right] || {};
            var lh = sizeOf(a, rl.left, 0), rh = sizeOf(b, rl.right, 0);
            if (lh.height !== rh.height) row.changes.push({ field: 'height', title: 'Высота', from: lh.height, to: rh.height });
            if (lh.hidden !== rh.hidden) row.changes.push({ field: 'hidden', title: 'Скрыта', from: lh.hidden, to: rh.hidden });
            if ((lrow.columnsID || '') !== (rrow.columnsID || '')) {
                row.changes.push({ field: 'columnsID', title: 'Набор колонок', from: lrow.columnsID || '', to: rrow.columnsID || '' });
            }
            for (var c = 0; c < colPairs.length; c++) {
                /* Внутренние ячейки объединённой области не имеют отдельного
                 * отображаемого содержимого. Их отличия — геометрия merge,
                 * а сравнивать нужно только его якорь. */
                if (isCoveredCell(leftMerges, rl.left, colPairs[c][0])
                    || isCoveredCell(rightMerges, rl.right, colPairs[c][1])) continue;
                var res = compareCells(a, b, rl.left, colPairs[c][0], rl.right, colPairs[c][1]);
                if (!res) continue;
                row.cells.push({
                    leftCol: colPairs[c][0], rightCol: colPairs[c][1],
                    content: res.content, changes: res.changes
                });
                summary.cellsChanged++;
            }
            if (row.cells.length || row.changes.length) {
                row.kind = 'changed';
                summary.rowsChanged++;
            }
        }
        rows.push(row);
    }

    var meta = [];
    meta = meta.concat(diffList('namedItem', a.namedItems || [], b.namedItems || [], namedKey, namedValue)
        .filter(function (change) {
            /* ОбластьДокумента — вычисляемая граница использованной области.
             * Её сдвиг дублирует изменения строк и ячеек, показанные выше. */
            if (change.kind !== 'changed') return true;
            if (String(change.id).toLowerCase() === 'cells:областьдокумента') return false;
            return !areaFollowsGrid(named(a, change.id), named(b, change.id), rowLane, colPairs);
        }));
    meta = meta.concat(diffMerges(a.merges || [], b.merges || [], rowLane, colPairs));
    meta = meta.concat(diffMerges(a.unmerges || [], b.unmerges || [], rowLane, colPairs, 'unmerge', 'разъединение'));
    meta = meta.concat(diffList('drawing', a.drawings || [], b.drawings || [], drawingKey, drawingValue));
    if (!!a.templateMode !== !!b.templateMode) {
        meta.push({
            what: 'option', id: 'templateMode', kind: 'changed',
            from: a.templateMode ? 'да' : 'нет', to: b.templateMode ? 'да' : 'нет'
        });
    }
    summary.metaChanged = meta.length;

    var equal = !summary.rowsAdded && !summary.rowsRemoved && !summary.rowsChanged
        && !summary.columnsAdded && !summary.columnsRemoved && !summary.columnsChanged
        && !summary.metaChanged;

    var out = { columns: columns, rows: rows, meta: meta, summary: summary, equal: equal };
    if (approximate) out.approximate = approximate;
    return out;
}

/* Удобная обёртка: сравнить прямо два XML. */
function compareXml(leftXml, rightXml) {
    var a = TP.parse(leftXml);
    if (a.error) return { error: 'Слева: ' + a.error };
    var b = TP.parse(rightXml);
    if (b.error) return { error: 'Справа: ' + b.error };
    return compare(a.model, b.model);
}

root.TemplateDiff = {
    compare: compare,
    compareXml: compareXml,
    fields: CELL_FIELDS,
    _test: {
        alignKeys: alignKeys,
        weave: weave,
        pairSimilar: pairSimilar,
        similarity: similarity,
        cellContentKey: cellContentKey,
        cellFields: cellFields,
        diffList: diffList,
        namedValue: namedValue,
        setLcsLimit: function (limit) { var was = LCS_LIMIT; LCS_LIMIT = limit; return was; }
    }
};

})(window);
