/* Visual preview of 1C spreadsheet templates (Designer Ext/Template.xml).
 *
 * SpreadsheetDocument XML: xmlns http://v8.1c.ru/8.2/data/spreadsheet
 * This module is read-only: it does not write XML back. */
(function (root) {
'use strict';

/* Two unit systems live side by side in a spreadsheet:
 * - column widths, indents and side margins count eighths of the width of «X»
 *   in the standard font (Arial 8: 7 px at 96 dpi);
 * - row heights, top/bottom margins and drawing offsets count 1/288 of an
 *   inch (4 per typographic point): a third of a pixel at 96 dpi. */
var CHAR_PX = 7;
var WIDTH_PX = CHAR_PX / 8;
var HEIGHT_PX = 96 / 288;
var DEFAULT_WIDTH_U = 72;
var DEFAULT_HEIGHT_U = 45;
/* Gap between a cell edge and its text, measured in the configurator on a
 * template at 100 %. */
var TEXT_MARGIN_PX = 3;
var DEFAULT_FONT = { faceName: 'Arial', height: 8, bold: false, italic: false, underline: false, strikeout: false };

/* Shared XML helpers live in xml-util.js; aliased locally for brevity. */
var XU = root.XmlUtil;
var localName = XU.localName;
var namedChildren = XU.namedChildren;
var firstChild = XU.firstChild;
var textOf = XU.textOf;
var rawText = XU.rawText;

function detect(xml) {
    if (!xml || typeof xml !== 'string') return false;
    if (xml.indexOf('xcf/logform') >= 0) return false;
    if (xml.indexOf('v8.1c.ru/8.2/data/spreadsheet') >= 0) return true;
    if (xml.indexOf('<rowsItem') < 0 || xml.indexOf('<columns') < 0) return false;
    return /<(?:\w+:)?document[\s>]/.test(xml);
}

/* Template cells keep their line breaks, so read content with rawText. */
function localizedFrom(el) {
    return XU.localizedFrom(el, rawText);
}

function attr(el, name) {
    if (!el || !el.getAttribute) return '';
    return el.getAttribute(name) || '';
}

function intOf(el, fallback) {
    var n = parseInt(textOf(el), 10);
    return isNaN(n) ? (fallback || 0) : n;
}

function widthToPx(u) {
    var n = Number(u);
    if (!isFinite(n)) n = 0;
    return Math.max(0, n * WIDTH_PX);
}

function heightToPx(u) {
    var n = Number(u);
    if (!isFinite(n)) n = 0;
    return Math.max(0, n * HEIGHT_PX);
}

function unitToPx(u) { return widthToPx(u); }

function formatByIndex(formats, idx) {
    var n = parseInt(idx, 10);
    if (!n || n < 1) return null;
    return formats[n - 1] || null;
}

/* Properties a cell must never inherit: width belongs to the column, height to
 * the row, and being a parameter is a trait of the cell itself — a row whose
 * format says `Parameter` would otherwise turn every cell in it into one. */
var ROW_ONLY_PROPS = { width: true, height: true, fillType: true, hidden: true };

function hasValue(v) {
    return v != null && v !== '';
}

function mergeLayer(out, fmt, own) {
    if (!fmt) return;
    for (var k in fmt) {
        if (!Object.prototype.hasOwnProperty.call(fmt, k)) continue;
        if (!own && ROW_ONLY_PROPS[k]) continue;
        if (!hasValue(fmt[k])) continue;
        out[k] = fmt[k];
    }
}

function defaultFormatOf(model) {
    return formatByIndex(model.formats, model.defaultFormatIndex);
}

function columnFormatOf(model, row, col) {
    if (col == null || col < 0) return null;
    var set = model.columnSetById ? columnSetOf(model, row && row.columnsID) : null;
    var idx = set && set.formatIndex ? set.formatIndex[col] : null;
    return formatByIndex(model.formats, idx);
}

/* A cell's look is resolved in layers, each one overriding the previous: the
 * sheet's default format, the format of the cell's column, the row, and the
 * cell itself. A column can therefore paint or set the font of every cell in
 * it without any of them carrying a format of its own. */
function effectiveFormat(model, row, cell, col) {
    if (col == null && cell) col = cell.col;
    var cellFmt = formatByIndex(model.formats, cell && cell.formatIndex);
    var layers = [defaultFormatOf(model), columnFormatOf(model, row, col),
        formatByIndex(model.formats, row && row.formatIndex)];
    if (!layers[0] && !layers[1] && !layers[2]) return cellFmt;
    var out = {};
    for (var i = 0; i < layers.length; i++) mergeLayer(out, layers[i], false);
    mergeLayer(out, cellFmt, true);
    return out;
}

function widthOfFormat(fmt) {
    if (!fmt || fmt.width == null || fmt.width === '') return widthToPx(DEFAULT_WIDTH_U);
    var n = Number(fmt.width);
    if (!isFinite(n) || n <= 0) return widthToPx(DEFAULT_WIDTH_U);
    return Math.max(1, widthToPx(n));
}

function isTrue(v) {
    return v === true || v === 'true';
}

/* A column's width comes from the first format that states one: the column's,
 * then the whole column set's, then the sheet default; failing all of them it
 * is 72 eighths. A hidden column takes no room at all. */
function columnWidthPx(colFmt, setFmt, sheetFmt) {
    if (colFmt && isTrue(colFmt.hidden)) return 0;
    var chain = [colFmt, setFmt, sheetFmt];
    for (var i = 0; i < chain.length; i++) {
        var f = chain[i];
        if (!f || !hasValue(f.width)) continue;
        var n = Number(f.width);
        if (isFinite(n) && n > 0) return Math.max(1, widthToPx(n));
    }
    return widthToPx(DEFAULT_WIDTH_U);
}

/* Columns flagged `autoWidthCalculation` share whatever width the fixed
 * columns leave free, in proportion to `widthWeightFactor`; none of them gets
 * narrower than its own stated width. */
function distributeAutoWidths(set, availablePx) {
    if (!set || !set.auto || !(availablePx > 0)) return set;
    var fixed = 0;
    var dyn = [];
    var c;
    for (c = 0; c < set.size; c++) {
        if (set.auto[c]) dyn.push(c);
        else fixed += set.widths[c] || 0;
    }
    if (!dyn.length) return set;
    var widths = set.widths.slice();
    var grabbed = fixed;
    for (var i = 0; i < dyn.length; i++) {
        var idx = dyn[i];
        var free = availablePx - grabbed;
        var min = set.widths[idx] || 0;
        if (free <= 0) {
            widths[idx] = min;
            continue;
        }
        var rest = 0;
        for (var k = i; k < dyn.length; k++) rest += set.auto[dyn[k]].weight;
        var w = rest > 0 ? free * set.auto[idx].weight / rest : 0;
        widths[idx] = Math.max(Math.round(w), min);
        grabbed += widths[idx];
    }
    var out = {};
    for (var key in set) {
        if (Object.prototype.hasOwnProperty.call(set, key)) out[key] = set[key];
    }
    out.widths = widths;
    return out;
}

/* Height of one line of text in a font, rounded the way a screen font is: the
 * point size becomes whole pixels, and the line gets a third on top for the
 * ascent and descent. Arial 8 gives 15 px — the height of an empty row. */
function fontLinePx(font) {
    var pt = (font && font.height) || 8;
    var scale = font && font.scale ? font.scale / 100 : 1;
    var em = Math.round(pt * scale * 4 / 3);
    return Math.round(em * 4 / 3);
}

function heightOfFormat(fmt) {
    if (!fmt || fmt.height == null || fmt.height === '') {
        return { px: heightToPx(DEFAULT_HEIGHT_U), auto: true };
    }
    var n = Number(fmt.height);
    if (!isFinite(n) || n === 0) return { px: heightToPx(DEFAULT_HEIGHT_U), auto: true };
    /* A negative height is not a size but a ceiling: the row still fits its
     * content, only never grows past |height|. */
    if (n < 0) {
        var max = heightToPx(-n);
        return { px: Math.min(max, heightToPx(DEFAULT_HEIGHT_U)), auto: true, max: max };
    }
    return { px: Math.max(1, heightToPx(n)), auto: false };
}

function parseLine(el) {
    var styleText = textOf(el) || 'Solid';
    return {
        width: parseInt(attr(el, 'width') || '1', 10) || 1,
        gap: attr(el, 'gap') === 'true',
        style: styleText
    };
}

function parseFont(el) {
    return {
        faceName: attr(el, 'faceName') || 'Arial',
        height: parseFloat(attr(el, 'height') || '8') || 8,
        bold: attr(el, 'bold') === 'true',
        italic: attr(el, 'italic') === 'true',
        underline: attr(el, 'underline') === 'true',
        strikeout: attr(el, 'strikeout') === 'true',
        kind: attr(el, 'kind') || '',
        scale: parseFloat(attr(el, 'scale') || '100') || 100
    };
}

function parseFormat(el) {
    var fmt = {};
    if (!el) return fmt;
    var kids = el.children || [];
    for (var i = 0; i < kids.length; i++) {
        var c = kids[i];
        var tag = localName(c);
        if (!tag) continue;
        if (tag === 'format') fmt.numberFormat = localizedFrom(c);
        /* The XML tag is borderColor; the model shares bordersColor with mxl-preview. */
        else if (tag === 'borderColor') fmt.bordersColor = textOf(c);
        else if (tag === 'width' || tag === 'height') fmt[tag] = textOf(c);
        else if (tag === 'font' || tag === 'border' || tag === 'leftBorder' || tag === 'rightBorder'
            || tag === 'topBorder' || tag === 'bottomBorder' || tag === 'drawingBorder')
            fmt[tag] = textOf(c);
        else if (tag === 'horizontalAlignment' || tag === 'verticalAlignment' || tag === 'textPlacement'
            || tag === 'fillType' || tag === 'backColor' || tag === 'textColor' || tag === 'pattern'
            || tag === 'hyperLink' || tag === 'bySelectedColumns' || tag === 'textOrientation')
            fmt[tag] = textOf(c);
        else fmt[tag] = textOf(c);
    }
    return fmt;
}

/* The other languages of a <tl> as «lang: text» lines, without the one the
 * preview shows. Nothing draws them, but a comparison has to notice when a
 * translation appears, changes or is lost. */
function translationsOf(tl, shown) {
    var out = [];
    var skipped = false;
    var items = tl.children || [];
    for (var i = 0; i < items.length; i++) {
        if (localName(items[i]) !== 'item') continue;
        var lang = '', content = '';
        for (var j = 0; j < items[i].children.length; j++) {
            var p = items[i].children[j];
            if (localName(p) === 'lang') lang = textOf(p);
            else if (localName(p) === 'content') content = rawText(p);
        }
        if (!content) continue;
        if (!skipped && content === shown) { skipped = true; continue; }
        out.push(lang + ': ' + content);
    }
    return out.join('\n');
}

function parseCell(content) {
    var cell = { formatIndex: 0, text: '', parameter: '', detailParameter: '', fillType: '' };
    if (!content) return cell;
    var kids = content.children || [];
    for (var i = 0; i < kids.length; i++) {
        var c = kids[i];
        var tag = localName(c);
        if (tag === 'f') cell.formatIndex = intOf(c, 0);
        else if (tag === 'tl') { cell.text = localizedFrom(c); cell.translations = translationsOf(c, cell.text); }
        else if (tag === 'parameter') cell.parameter = textOf(c);
        else if (tag === 'detailParameter') cell.detailParameter = textOf(c);
        else if (tag === 'note') cell.note = localizedFrom(c);
    }
    return cell;
}

function parseRow(rowEl) {
    var row = {
        columnsID: textOf(firstChild(rowEl, 'columnsID')),
        formatIndex: intOf(firstChild(rowEl, 'formatIndex'), 0),
        empty: textOf(firstChild(rowEl, 'empty')) === 'true',
        cells: []
    };
    var col = 0;
    var kids = rowEl.children || [];
    for (var i = 0; i < kids.length; i++) {
        var g = kids[i];
        if (localName(g) !== 'c') continue;
        var iEl = firstChild(g, 'i');
        if (iEl) col = intOf(iEl, col);
        var content = firstChild(g, 'c') || null;
        if (!content) {
            var innerKids = g.children || [];
            for (var k = 0; k < innerKids.length; k++) {
                if (localName(innerKids[k]) !== 'i') { content = innerKids[k]; break; }
            }
        }
        var cell = parseCell(content);
        cell.col = col;
        row.cells.push(cell);
        col += 1;
    }
    return row;
}

function parseColumnSet(el, formats, defaultFormatIndex) {
    var id = textOf(firstChild(el, 'id'));
    var size = intOf(firstChild(el, 'size'), 0);
    var setFormatIndex = intOf(firstChild(el, 'formatIndex'), 0);
    var setFmt = formatByIndex(formats, setFormatIndex);
    var sheetFmt = formatByIndex(formats, defaultFormatIndex);
    var byIndex = {};
    var items = namedChildren(el, 'columnsItem');
    for (var i = 0; i < items.length; i++) {
        var it = items[i];
        var idx = intOf(firstChild(it, 'index'), 0);
        var col = firstChild(it, 'column');
        byIndex[idx] = col ? intOf(firstChild(col, 'formatIndex'), 0) : 0;
    }
    var widths = [];
    var auto = null;
    var maxIdx = size;
    for (var k in byIndex) {
        var ki = parseInt(k, 10);
        if (ki + 1 > maxIdx) maxIdx = ki + 1;
    }
    if (!size) size = maxIdx;
    for (var c = 0; c < size; c++) {
        var colFmt = formatByIndex(formats, byIndex[c] != null ? byIndex[c] : 0);
        widths.push(columnWidthPx(colFmt, setFmt, sheetFmt));
        if (colFmt && isTrue(colFmt.autoWidthCalculation)) {
            if (!auto) auto = {};
            var weight = parseInt(colFmt.widthWeightFactor, 10);
            auto[c] = { weight: isFinite(weight) && weight > 0 ? weight : 1 };
        }
    }
    return { id: id, size: size, widths: widths, formatIndex: byIndex, setFormatIndex: setFormatIndex, auto: auto };
}

function parseMerge(el) {
    return {
        r: intOf(firstChild(el, 'r'), 0),
        c: intOf(firstChild(el, 'c'), 0),
        h: firstChild(el, 'h') ? intOf(firstChild(el, 'h'), 0) : 0,
        w: firstChild(el, 'w') ? intOf(firstChild(el, 'w'), 0) : 0,
        columnsID: textOf(firstChild(el, 'columnsID'))
    };
}

function parseNamedItem(el) {
    var typeAttr = attr(el, 'xsi:type') || attr(el, 'type') || '';
    var name = textOf(firstChild(el, 'name'));
    if (typeAttr.indexOf('NamedItemDrawing') >= 0) {
        return { kind: 'drawing', name: name, drawingID: intOf(firstChild(el, 'drawingID'), 0) };
    }
    var area = firstChild(el, 'area');
    if (!area) return { kind: 'cells', name: name };
    return {
        kind: 'cells',
        name: name,
        type: textOf(firstChild(area, 'type')) || 'Rows',
        beginRow: intOf(firstChild(area, 'beginRow'), 0),
        endRow: intOf(firstChild(area, 'endRow'), 0),
        beginColumn: intOf(firstChild(area, 'beginColumn'), -1),
        endColumn: intOf(firstChild(area, 'endColumn'), -1),
        columnsID: textOf(firstChild(area, 'columnsID'))
    };
}

function parseDrawing(el) {
    return {
        drawingType: textOf(firstChild(el, 'drawingType')),
        id: intOf(firstChild(el, 'id'), 0),
        formatIndex: intOf(firstChild(el, 'formatIndex'), 0),
        beginRow: intOf(firstChild(el, 'beginRow'), 0),
        beginRowOffset: intOf(firstChild(el, 'beginRowOffset'), 0),
        endRow: intOf(firstChild(el, 'endRow'), 0),
        endRowOffset: intOf(firstChild(el, 'endRowOffset'), 0),
        beginColumn: intOf(firstChild(el, 'beginColumn'), 0),
        beginColumnOffset: intOf(firstChild(el, 'beginColumnOffset'), 0),
        endColumn: intOf(firstChild(el, 'endColumn'), 0),
        endColumnOffset: intOf(firstChild(el, 'endColumnOffset'), 0),
        pictureSize: textOf(firstChild(el, 'pictureSize')),
        pictureIndex: intOf(firstChild(el, 'pictureIndex'), 0),
        zOrder: intOf(firstChild(el, 'zOrder'), 0),
        autoSize: textOf(firstChild(el, 'autoSize')) === 'true'
    };
}

function parsePicture(el) {
    var idx = intOf(firstChild(el, 'index'), 0);
    var pic = firstChild(el, 'picture');
    var data = pic ? String(pic.textContent || '').replace(/\s+/g, '') : '';
    var ref = '';
    if (pic && pic.getAttribute) ref = pic.getAttribute('ref') || '';
    var mime = 'image/png';
    if (data.indexOf('/9j') === 0) mime = 'image/jpeg';
    else if (data.indexOf('Qk') === 0) mime = 'image/bmp';
    else if (data.indexOf('R0lG') === 0) mime = 'image/gif';
    return { index: idx, data: data, ref: ref, mime: mime };
}

function parse(xml) {
    if (!xml || typeof xml !== 'string') return { error: 'Пустой XML' };
    var doc;
    try {
        doc = new DOMParser().parseFromString(xml, 'application/xml');
    } catch (e) {
        return { error: 'Не удалось разобрать XML' };
    }
    var parseErr = doc.querySelector && doc.querySelector('parsererror');
    if (parseErr) return { error: textOf(parseErr) || 'Ошибка разбора XML' };
    var root = doc.documentElement;
    if (!root || localName(root) !== 'document') {
        return { error: 'В файле нет корневого document табличного документа' };
    }

    var lines = namedChildren(root, 'line').map(parseLine);
    var fonts = namedChildren(root, 'font').map(parseFont);
    var formats = namedChildren(root, 'format').map(parseFormat);
    var pictures = namedChildren(root, 'picture').map(parsePicture);

    var defaultFormatIndex = intOf(firstChild(root, 'defaultFormatIndex'), 0);
    var columnSets = [];
    var columnSetById = {};
    var colNodes = namedChildren(root, 'columns');
    for (var i = 0; i < colNodes.length; i++) {
        var set = parseColumnSet(colNodes[i], formats, defaultFormatIndex);
        columnSets.push(set);
        columnSetById[set.id || ''] = set;
    }
    if (!columnSetById['']) {
        columnSetById[''] = columnSets[0] || { id: '', size: 1, widths: [widthToPx(DEFAULT_WIDTH_U)], formatIndex: {} };
    }

    var height = intOf(firstChild(root, 'height'), 0);
    var rowByIndex = {};
    var rowNodes = namedChildren(root, 'rowsItem');
    var maxRow = height - 1;
    for (var r = 0; r < rowNodes.length; r++) {
        var ri = rowNodes[r];
        var index = intOf(firstChild(ri, 'index'), 0);
        var indexTo = firstChild(ri, 'indexTo') ? intOf(firstChild(ri, 'indexTo'), index) : index;
        var rowEl = firstChild(ri, 'row');
        var parsedRow = rowEl ? parseRow(rowEl) : { columnsID: '', formatIndex: 0, empty: true, cells: [] };
        for (var rr = index; rr <= indexTo; rr++) {
            rowByIndex[rr] = parsedRow;
            if (rr > maxRow) maxRow = rr;
        }
    }
    if (height < maxRow + 1) height = maxRow + 1;
    if (height < 1) height = 1;

    var rows = [];
    for (var y = 0; y < height; y++) {
        rows.push(rowByIndex[y] || { columnsID: '', formatIndex: 0, empty: true, cells: [] });
    }

    var merges = namedChildren(root, 'merge').map(parseMerge);
    var unmerges = namedChildren(root, 'verticalUnmerge').map(parseMerge);
    var namedItems = namedChildren(root, 'namedItem').map(parseNamedItem);
    var drawings = namedChildren(root, 'drawing').map(parseDrawing);

    return {
        model: {
            height: height,
            rows: rows,
            columnSets: columnSets,
            columnSetById: columnSetById,
            formats: formats,
            defaultFormatIndex: defaultFormatIndex,
            fonts: fonts,
            lines: lines,
            pictures: pictures,
            merges: merges,
            unmerges: unmerges,
            namedItems: namedItems,
            drawings: drawings,
            templateMode: textOf(firstChild(root, 'templateMode')) === 'true'
        }
    };
}

/* A sheet is edited from the top down, and the row after the last one has to
 * be reachable: 1C and Excel simply go on below the document. The editing host
 * asks for a few rows past the end, which are drawn like any other, can be
 * selected and written into, and turn into real rows of the document as soon
 * as something is put in them. They are not part of the document's height:
 * `trailingRows` says how many of the last rows are only there to be filled. */
function withTrailingRows(model, count) {
    if (!model || !(count > 0)) return model;
    var last = model.rows[model.height - 1] || {};
    var rows = model.rows.slice();
    for (var i = 0; i < count; i++) {
        rows.push({ columnsID: last.columnsID || '', formatIndex: 0, empty: true, cells: [] });
    }
    var next = {};
    for (var key in model) {
        if (Object.prototype.hasOwnProperty.call(model, key)) next[key] = model[key];
    }
    next.rows = rows;
    next.height = model.height + count;
    next.trailingRows = count;
    return next;
}

/* The same to the right: a sheet ends at its last column, and without a few
 * spare ones there is no way to write past it. They are as wide as a column
 * of the sheet with no format of its own — exactly what an appended column
 * turns out to be — and belong to no column set until something is written
 * into them. */
function withTrailingColumns(model, count) {
    if (!model || !(count > 0)) return model;
    var sheetFmt = formatByIndex(model.formats, model.defaultFormatIndex);
    var plainFmt = formatByIndex(model.formats, 0);
    var sets = [];
    var byId = {};
    for (var i = 0; i < model.columnSets.length; i++) {
        var set = model.columnSets[i];
        var widths = (set.widths || []).slice();
        var setFmt = formatByIndex(model.formats, set.setFormatIndex || 0);
        for (var c = 0; c < count; c++) widths.push(columnWidthPx(plainFmt, setFmt, sheetFmt));
        var copy = {};
        for (var key in set) {
            if (Object.prototype.hasOwnProperty.call(set, key)) copy[key] = set[key];
        }
        copy.size = (set.size || 0) + count;
        copy.widths = widths;
        sets.push(copy);
        byId[copy.id || ''] = copy;
    }
    if (!sets.length) return model;
    var next = {};
    for (var k in model) {
        if (Object.prototype.hasOwnProperty.call(model, k)) next[k] = model[k];
    }
    next.columnSets = sets;
    next.columnSetById = byId;
    next.trailingColumns = count;
    return next;
}

/* The first row that is past the end of the document, or the height when
 * every row is a real one. */
function documentRows(model) {
    return model ? model.height - (model.trailingRows || 0) : 0;
}

/* The first column past the end of the document, columns counted the way
 * sheetWidth() counts them. */
function documentColumns(model) {
    return model ? sheetWidth(model) - (model.trailingColumns || 0) : 0;
}

function columnSetOf(model, columnsID) {
    var set = model.columnSetById[columnsID || ''] || model.columnSetById[''] || { size: 1, widths: [widthToPx(DEFAULT_WIDTH_U)] };
    return set.auto ? distributeAutoWidths(set, model._availableWidthPx) : set;
}

function cellAt(row, col) {
    if (!row || !row.cells) return null;
    for (var i = 0; i < row.cells.length; i++) {
        if (row.cells[i].col === col) return row.cells[i];
    }
    return null;
}

function displayText(cell, fmt) {
    if (!cell) return '';
    var fill = (fmt && fmt.fillType) || cell.fillType || '';
    if (fill === 'Parameter' || (!fill && cell.parameter && !cell.text)) {
        /* A parameter cell with no name yet is drawn «<>», the way the
         * Designer shows one: the cell is already a parameter, it is only
         * waiting for its name. */
        return '<' + (cell.parameter || '') + '>';
    }
    if (fill === 'Template' && cell.text) {
        return String(cell.text).replace(/\[([^\]\r\n]+)\]/g, '<$1>');
    }
    if (cell.text) return cell.text;
    if (cell.parameter) return '<' + cell.parameter + '>';
    return '';
}

function isParamCell(cell, fmt) {
    if (!cell) return false;
    var fill = (fmt && fmt.fillType) || '';
    if (fill === 'Parameter') return true;
    if (!cell.text && cell.parameter) return true;
    return false;
}

function fontOf(model, fmt) {
    if (!fmt || fmt.font == null || fmt.font === '') return DEFAULT_FONT;
    var idx = parseInt(fmt.font, 10);
    if (isNaN(idx) || idx < 0) return DEFAULT_FONT;
    return model.fonts[idx] || DEFAULT_FONT;
}

function lineOf(model, idx) {
    if (idx == null || idx === '') return null;
    var n = parseInt(idx, 10);
    if (isNaN(n) || n < 0) return null;
    return model.lines[n] || null;
}

function borderCss(line, color) {
    if (!line) return '';
    var st = String(line.style || 'Solid').toLowerCase();
    if (st === 'none' || st === 'нет') return '';
    var w = Math.max(1, Number(line.width) || 1);
    var kind = 'solid';
    if (st.indexOf('dot') >= 0) kind = 'dotted';
    else if (st.indexOf('dash') >= 0 || st.indexOf('пунктир') >= 0) kind = 'dashed';
    else if (st.indexOf('double') >= 0 || st.indexOf('двойн') >= 0) kind = 'double';
    if (line.gap && kind === 'solid') kind = 'dashed';
    return w + 'px ' + kind + ' ' + (styleColor(color) || '#000');
}

function borderRank(css) {
    if (!css) return 0;
    var w = parseInt(css, 10);
    if (!isFinite(w) || w < 1) return 0;
    if (String(css).indexOf('double') >= 0) w += 0.5;
    return w;
}

function strongerBorder(a, b) {
    return borderRank(b) > borderRank(a) ? b : a;
}

function spanBorders(model, rowIdx, colIdx, rowspan, colspan) {
    var out = { left: '', right: '', top: '', bottom: '' };
    var y, x;
    rowspan = rowspan || 1;
    colspan = colspan || 1;
    function add(cell, cellRow, left, right, top, bottom) {
        if (!cell) return;
        var fmt = effectiveFormat(model, cellRow, cell);
        if (!fmt) return;
        if (left) out.left = strongerBorder(out.left, sideBorder(model, fmt, 'left'));
        if (right) out.right = strongerBorder(out.right, sideBorder(model, fmt, 'right'));
        if (top) out.top = strongerBorder(out.top, sideBorder(model, fmt, 'top'));
        if (bottom) out.bottom = strongerBorder(out.bottom, sideBorder(model, fmt, 'bottom'));
    }
    add(cellAt(model.rows[rowIdx], colIdx), model.rows[rowIdx], true, true, true, true);
    for (y = 0; y < rowspan; y++) {
        var row = model.rows[rowIdx + y];
        for (x = 0; x < colspan; x++) {
            add(cellAt(row, colIdx + x), row, x === 0, x === colspan - 1, y === 0, y === rowspan - 1);
        }
    }
    return out;
}

/* 1C draws a shared grid edge once, whichever of the two cells defines it. The
 * table keeps `border-collapse: separate` (sticky headers and spills depend on
 * it), so two neighbours each painting their side doubled every line: a medium
 * 2 px frame came out 4 px.
 *
 * A cell takes over its right (bottom) edge when the neighbours' left (top)
 * sides are the same along the whole span; it has one CSS border for the span,
 * so it cannot paint a line over only part of it. Otherwise each neighbour
 * paints its own piece, and a cell keeps its left (top) side only where the
 * neighbour before it did not take the edge over and its own line is stronger. */
function collapseBorders(model, group, set, y, c, spanRows, spanCols, borders) {
    var out = { left: borders.left, right: borders.right, top: borders.top, bottom: borders.bottom };

    /* The merged area (or the single cell) that covers a position. */
    function areaAt(rowIdx, col) {
        var merges = model.merges || [];
        for (var k = 0; k < merges.length; k++) {
            var mg = merges[k];
            if (mg.r < 0) continue;
            if (mg.columnsID && mg.columnsID !== (group.columnsID || '')) continue;
            if (rowIdx >= mg.r && rowIdx <= mg.r + mg.h && col >= mg.c && col <= mg.c + mg.w) {
                return { r: mg.r, c: mg.c, h: mg.h + 1, w: mg.w + 1 };
            }
        }
        return { r: rowIdx, c: col, h: 1, w: 1 };
    }
    /* The side a neighbour lends to a shared edge. Cells hidden under a merge
     * keep the borders Excel gave them, but 1C draws a merged area from its
     * origin only, and only on the area's own edge. */
    function lent(rowIdx, col, side) {
        if (rowIdx < group.start || rowIdx >= group.end || col < 0 || col >= set.size) return null;
        var a = areaAt(rowIdx, col);
        if ((side === 'left' && col !== a.c) || (side === 'top' && rowIdx !== a.r)) return '';
        var row = model.rows[a.r];
        return row ? sideBorder(model, effectiveFormat(model, row, cellAt(row, a.c), a.c), side) : '';
    }
    function ownOf(a) {
        return spanBorders(model, a.r, a.c, a.h, a.w);
    }
    /* Neighbour sides along the far edge of an area, or null at the group edge. */
    function alongRight(a) {
        if (a.c + a.w >= set.size) return null;
        var sides = [];
        for (var i = 0; i < a.h; i++) sides.push(lent(a.r + i, a.c + a.w, 'left'));
        return sides;
    }
    function alongBottom(a) {
        if (a.r + a.h >= group.end) return null;
        var sides = [];
        for (var i = 0; i < a.w; i++) sides.push(lent(a.r + a.h, a.c + i, 'top'));
        return sides;
    }
    function uniform(sides) {
        return !!sides && sides.every(function (s) { return s === sides[0]; });
    }

    var self = { r: y, c: c, h: spanRows, w: spanCols };
    var right = alongRight(self);
    if (uniform(right)) out.right = strongerBorder(out.right, right[0]);
    var below = alongBottom(self);
    if (uniform(below)) out.bottom = strongerBorder(out.bottom, below[0]);

    var i, before, keep;
    if (c > 0) {
        keep = '';
        for (i = 0; i < spanRows; i++) {
            before = areaAt(y + i, c - 1);
            if (uniform(alongRight(before))) continue;
            if (borderRank(out.left) > borderRank(ownOf(before).right)) keep = out.left;
        }
        out.left = keep;
    }
    if (y > group.start) {
        keep = '';
        for (i = 0; i < spanCols; i++) {
            before = areaAt(y - 1, c + i);
            if (uniform(alongBottom(before))) continue;
            if (borderRank(out.top) > borderRank(ownOf(before).bottom)) keep = out.top;
        }
        out.top = keep;
    }
    return out;
}

function colSpanWidth(set, col, colspan) {
    var w = 0;
    var n = colspan || 1;
    var i;
    for (i = 0; i < n; i++) w += set.widths[col + i] || 0;
    return w;
}

function spillBox(model, row, set, spans, ly, col, colspan, align) {
    var cellW = colSpanWidth(set, col, colspan);
    function free(c) {
        if (c < 0 || c >= set.size) return false;
        if (spans.covered[ly][c] || spans.origin[ly][c]) return false;
        var neighbour = cellAt(row, c);
        if (!neighbour) return true;
        return !displayText(neighbour, effectiveFormat(model, row, neighbour));
    }
    var rightPx = 0;
    var leftPx = 0;
    var c;
    for (c = col + colspan; free(c); c++) rightPx += set.widths[c] || 0;
    for (c = col - 1; free(c); c--) leftPx += set.widths[c] || 0;
    if (align === 'right') return { left: leftPx ? -leftPx : 0, width: cellW + leftPx };
    if (align === 'center') {
        var sym = Math.min(leftPx, rightPx);
        return { left: sym ? -sym : 0, width: cellW + 2 * sym };
    }
    return { left: 0, width: cellW + rightPx };
}

function lockWidth(el, px) {
    var s = (Math.round(px * 10) / 10) + 'px';
    el.style.width = s;
    el.style.minWidth = s;
    el.style.maxWidth = s;
    el.style.boxSizing = 'border-box';
}

function sideBorder(model, fmt, side) {
    if (!fmt) return '';
    var key = side + 'Border';
    var idx = fmt[key];
    if (idx == null || idx === '') idx = fmt.border;
    return borderCss(lineOf(model, idx), fmt.bordersColor);
}

/* The web colours, the set the platform keeps under its own «Web» group: the
 * W3C names every browser knows. A template stores one of them as
 * «web:Name», which keeps the name rather than freezing today's value. */
var WEB_COLOURS = [
    ['AliceBlue', '#F0F8FF'], ['AntiqueWhite', '#FAEBD7'], ['Aqua', '#00FFFF'],
    ['Aquamarine', '#7FFFD4'], ['Azure', '#F0FFFF'], ['Beige', '#F5F5DC'],
    ['Bisque', '#FFE4C4'], ['Black', '#000000'], ['BlanchedAlmond', '#FFEBCD'],
    ['Blue', '#0000FF'], ['BlueViolet', '#8A2BE2'], ['Brown', '#A52A2A'],
    ['BurlyWood', '#DEB887'], ['CadetBlue', '#5F9EA0'], ['Chartreuse', '#7FFF00'],
    ['Chocolate', '#D2691E'], ['Coral', '#FF7F50'], ['CornflowerBlue', '#6495ED'],
    ['Cornsilk', '#FFF8DC'], ['Crimson', '#DC143C'], ['Cyan', '#00FFFF'],
    ['DarkBlue', '#00008B'], ['DarkCyan', '#008B8B'], ['DarkGoldenRod', '#B8860B'],
    ['DarkGray', '#A9A9A9'], ['DarkGreen', '#006400'], ['DarkKhaki', '#BDB76B'],
    ['DarkMagenta', '#8B008B'], ['DarkOliveGreen', '#556B2F'], ['DarkOrange', '#FF8C00'],
    ['DarkOrchid', '#9932CC'], ['DarkRed', '#8B0000'], ['DarkSalmon', '#E9967A'],
    ['DarkSeaGreen', '#8FBC8F'], ['DarkSlateBlue', '#483D8B'], ['DarkSlateGray', '#2F4F4F'],
    ['DarkTurquoise', '#00CED1'], ['DarkViolet', '#9400D3'], ['DeepPink', '#FF1493'],
    ['DeepSkyBlue', '#00BFFF'], ['DimGray', '#696969'], ['DodgerBlue', '#1E90FF'],
    ['FireBrick', '#B22222'], ['FloralWhite', '#FFFAF0'], ['ForestGreen', '#228B22'],
    ['Fuchsia', '#FF00FF'], ['Gainsboro', '#DCDCDC'], ['GhostWhite', '#F8F8FF'],
    ['Gold', '#FFD700'], ['GoldenRod', '#DAA520'], ['Gray', '#808080'],
    ['Green', '#008000'], ['GreenYellow', '#ADFF2F'], ['HoneyDew', '#F0FFF0'],
    ['HotPink', '#FF69B4'], ['IndianRed', '#CD5C5C'], ['Indigo', '#4B0082'],
    ['Ivory', '#FFFFF0'], ['Khaki', '#F0E68C'], ['Lavender', '#E6E6FA'],
    ['LavenderBlush', '#FFF0F5'], ['LawnGreen', '#7CFC00'], ['LemonChiffon', '#FFFACD'],
    ['LightBlue', '#ADD8E6'], ['LightCoral', '#F08080'], ['LightCyan', '#E0FFFF'],
    ['LightGoldenRodYellow', '#FAFAD2'], ['LightGray', '#D3D3D3'], ['LightGreen', '#90EE90'],
    ['LightPink', '#FFB6C1'], ['LightSalmon', '#FFA07A'], ['LightSeaGreen', '#20B2AA'],
    ['LightSkyBlue', '#87CEFA'], ['LightSlateGray', '#778899'], ['LightSteelBlue', '#B0C4DE'],
    ['LightYellow', '#FFFFE0'], ['Lime', '#00FF00'], ['LimeGreen', '#32CD32'],
    ['Linen', '#FAF0E6'], ['Magenta', '#FF00FF'], ['Maroon', '#800000'],
    ['MediumAquaMarine', '#66CDAA'], ['MediumBlue', '#0000CD'], ['MediumOrchid', '#BA55D3'],
    ['MediumPurple', '#9370DB'], ['MediumSeaGreen', '#3CB371'], ['MediumSlateBlue', '#7B68EE'],
    ['MediumSpringGreen', '#00FA9A'], ['MediumTurquoise', '#48D1CC'], ['MediumVioletRed', '#C71585'],
    ['MidnightBlue', '#191970'], ['MintCream', '#F5FFFA'], ['MistyRose', '#FFE4E1'],
    ['Moccasin', '#FFE4B5'], ['NavajoWhite', '#FFDEAD'], ['Navy', '#000080'],
    ['OldLace', '#FDF5E6'], ['Olive', '#808000'], ['OliveDrab', '#6B8E23'],
    ['Orange', '#FFA500'], ['OrangeRed', '#FF4500'], ['Orchid', '#DA70D6'],
    ['PaleGoldenRod', '#EEE8AA'], ['PaleGreen', '#98FB98'], ['PaleTurquoise', '#AFEEEE'],
    ['PaleVioletRed', '#DB7093'], ['PapayaWhip', '#FFEFD5'], ['PeachPuff', '#FFDAB9'],
    ['Peru', '#CD853F'], ['Pink', '#FFC0CB'], ['Plum', '#DDA0DD'],
    ['PowderBlue', '#B0E0E6'], ['Purple', '#800080'], ['Red', '#FF0000'],
    ['RosyBrown', '#BC8F8F'], ['RoyalBlue', '#4169E1'], ['SaddleBrown', '#8B4513'],
    ['Salmon', '#FA8072'], ['SandyBrown', '#F4A460'], ['SeaGreen', '#2E8B57'],
    ['SeaShell', '#FFF5EE'], ['Sienna', '#A0522D'], ['Silver', '#C0C0C0'],
    ['SkyBlue', '#87CEEB'], ['SlateBlue', '#6A5ACD'], ['SlateGray', '#708090'],
    ['Snow', '#FFFAFA'], ['SpringGreen', '#00FF7F'], ['SteelBlue', '#4682B4'],
    ['Tan', '#D2B48C'], ['Teal', '#008080'], ['Thistle', '#D8BFD8'],
    ['Tomato', '#FF6347'], ['Turquoise', '#40E0D0'], ['Violet', '#EE82EE'],
    ['Wheat', '#F5DEB3'], ['White', '#FFFFFF'], ['WhiteSmoke', '#F5F5F5'],
    ['Yellow', '#FFFF00'], ['YellowGreen', '#9ACD32']
];

/* The Windows system colours a template may name, with the values the classic
 * desktop scheme gives them. A viewer cannot ask this machine for the user's
 * scheme, so it draws the documented defaults — close enough to show what the
 * cell means, and the name itself is what the file keeps. */
var WIN_COLOURS = [
    ['WindowBackground', '#FFFFFF'], ['WindowText', '#000000'],
    ['WindowFrame', '#646464'], ['ButtonFace', '#F0F0F0'],
    ['ButtonText', '#000000'], ['ButtonShadow', '#A0A0A0'],
    ['ButtonHighlight', '#FFFFFF'], ['Highlight', '#0078D7'],
    ['HighlightText', '#FFFFFF'], ['GrayText', '#6D6D6D'],
    ['InfoBackground', '#FFFFE1'], ['InfoText', '#000000'],
    ['Menu', '#F0F0F0'], ['MenuText', '#000000'],
    ['Scrollbar', '#C8C8C8'], ['ActiveCaption', '#99B4D1'],
    ['InactiveCaption', '#BFCDDB'], ['CaptionText', '#000000'],
    ['AppWorkspace', '#ABABAB'], ['Background', '#000000'],
    ['ActiveBorder', '#B4B4B4'], ['InactiveBorder', '#F4F7FC']
];

/* The style colours this viewer knows a value for. The platform has many more
 * and keeps their values to itself, so an unknown style colour is drawn as
 * nothing set — the file keeps its name either way. */
var STYLE_COLOURS = [
    ['FormBackColor', '#FFFFFF'], ['FieldBackColor', '#FFFFFF'],
    ['ButtonBackColor', '#F0F0F0'], ['FieldTextColor', '#000000'],
    ['FormTextColor', '#000000'], ['ButtonTextColor', '#000000'],
    ['BorderColor', '#7F9DB9'], ['FieldBorderColor', '#7F9DB9']
];

function colourTable(list) {
    var map = {};
    for (var i = 0; i < list.length; i++) map[list[i][0].toLowerCase()] = list[i][1];
    return map;
}

var WEB_BY_NAME = colourTable(WEB_COLOURS);
var WIN_BY_NAME = colourTable(WIN_COLOURS);
var STYLE_BY_NAME = colourTable(STYLE_COLOURS);

/* A colour as a template may write it: an absolute «#RRGGBB», or a name from
 * one of the platform's groups — «web:DodgerBlue», «win:WindowBackground»,
 * «style:FormBackColor». Returns the CSS colour to paint with, or an empty
 * string when nothing is set and when the name is one whose value the
 * platform does not share. */
function styleColor(v) {
    if (!v) return '';
    var raw = String(v).trim();
    if (!raw) return '';
    if (raw.charAt(0) === '#') return raw;
    var at = raw.indexOf(':');
    var group = at > 0 ? raw.slice(0, at).toLowerCase() : '';
    var name = (at > 0 ? raw.slice(at + 1) : raw).toLowerCase();
    if (group === 'web') return WEB_BY_NAME[name] || '';
    if (group === 'win' || group === 'windows') return WIN_BY_NAME[name] || '';
    if (group === 'style') return STYLE_BY_NAME[name] || '';
    if (group === 'auto') return '';
    /* No group: the older files, and the platform's own bare names. */
    return STYLE_BY_NAME[name] || WIN_BY_NAME[name] || WEB_BY_NAME[name] || '';
}

function alignCss(v, axis, fallback) {
    var s = String(v || '').toLowerCase();
    if (axis === 'h') {
        if (s === 'center' || s.indexOf('центр') >= 0) return 'center';
        if (s === 'right' || s.indexOf('прав') >= 0) return 'right';
        if (s === 'justify' || s.indexOf('ширин') >= 0) return 'justify';
        if (s) return 'left';
        return fallback || 'left';
    }
    if (s === 'center' || s.indexOf('центр') >= 0) return 'middle';
    if (s === 'bottom' || s.indexOf('низ') >= 0) return 'bottom';
    if (s) return 'top';
    return fallback || 'top';
}

/* Template.xml writes the vertical alignment of every cell out; MXL leaves the
 * bit clear and relies on the platform default, which is the bottom edge. The
 * model says which default applies so the renderer stays format-agnostic. */
function defaultVAlign(model) {
    var d = model && model.defaults;
    return alignCss(d && d.verticalAlignment, 'v', 'top');
}

function inVerticalMerge(model, rowIdx, col) {
    var merges = model.merges || [];
    for (var i = 0; i < merges.length; i++) {
        var m = merges[i];
        if (!(m.h > 0) || m.r < 0) continue;
        if (rowIdx >= m.r && rowIdx <= m.r + m.h && col >= m.c && col <= m.c + (m.w || 0)) return true;
    }
    return false;
}

/* A row with a stated positive height keeps it. Any other row fits its
 * content: at least one line of the tallest font among the row's own format,
 * the formats of its columns and its cells. Cells that belong to a vertical
 * merge do not count — their text spreads over several rows. A hidden row is
 * collapsed. Wrapped text may grow the row further when it is laid out. */
function rowHeight(model, row, rowIdx) {
    var rowFmt = formatByIndex(model.formats, row && row.formatIndex);
    if (rowFmt && isTrue(rowFmt.hidden)) return { px: 0, auto: false };
    var layered = {};
    var set = model.columnSetById ? columnSetOf(model, row && row.columnsID) : null;
    mergeLayer(layered, defaultFormatOf(model), true);
    if (set) mergeLayer(layered, formatByIndex(model.formats, set.setFormatIndex), true);
    mergeLayer(layered, rowFmt, true);
    var h = heightOfFormat(hasValue(layered.height) ? layered : null);
    if (!h.auto) return h;
    var px = fontLinePx(fontOf(model, layered));
    var c;
    if (set && set.formatIndex) {
        for (c in set.formatIndex) {
            var colFmt = formatByIndex(model.formats, set.formatIndex[c]);
            if (colFmt && hasValue(colFmt.font)) px = Math.max(px, fontLinePx(fontOf(model, colFmt)));
        }
    }
    var cells = (row && row.cells) || [];
    for (var i = 0; i < cells.length; i++) {
        if (rowIdx != null && inVerticalMerge(model, rowIdx, cells[i].col)) continue;
        var fmt = effectiveFormat(model, row, cells[i]);
        px = Math.max(px, fontLinePx(fontOf(model, fmt)));
    }
    if (h.max != null) px = Math.min(px, h.max);
    return { px: px, auto: true, max: h.max };
}

function unmergeHits(unmerges, row, col, w) {
    for (var i = 0; i < unmerges.length; i++) {
        var u = unmerges[i];
        if (u.r !== row) continue;
        var u1 = u.c + (u.w || 0);
        var c1 = col + (w || 0);
        if (col <= u1 && u.c <= c1) return true;
    }
    return false;
}

function buildSpans(model, start, end, columnsID) {
    var nRows = end - start;
    var set = columnSetOf(model, columnsID);
    var nCols = set.size;
    var origin = [];
    var covered = [];
    var y, x;
    for (y = 0; y < nRows; y++) {
        origin[y] = [];
        covered[y] = [];
        for (x = 0; x < nCols; x++) {
            origin[y][x] = null;
            covered[y][x] = false;
        }
    }

    function applyMerge(m, rr, cc, hh, ww) {
        if (rr < start || rr >= end) return;
        var ly = rr - start;
        var h = Math.min(hh + 1, nRows - ly);
        var w = Math.min(ww + 1, nCols - cc);
        if (h < 1 || w < 1) return;
        if (covered[ly][cc] && !(h === 1 && w === 1)) return;
        origin[ly][cc] = { rowspan: h, colspan: w };
        for (var iy = 0; iy < h; iy++) {
            for (var ix = 0; ix < w; ix++) {
                if (iy === 0 && ix === 0) continue;
                if (ly + iy < nRows && cc + ix < nCols) covered[ly + iy][cc + ix] = true;
            }
        }
    }

    var merges = model.merges || [];
    for (var i = 0; i < merges.length; i++) {
        var m = merges[i];
        if (m.columnsID) {
            if (m.columnsID !== (columnsID || '')) continue;
        } else if (m.r === -1 && columnsID) {
            continue;
        }
        if (m.r === -1) {
            for (var rr = start; rr < end; rr++) {
                if (unmergeHits(model.unmerges || [], rr, m.c, m.w)) continue;
                applyMerge(m, rr, m.c, 0, m.w);
            }
        } else {
            applyMerge(m, m.r, m.c, m.h, m.w);
        }
    }
    return { origin: origin, covered: covered };
}

function groupsOf(model) {
    var groups = [];
    var height = model.height;
    var i = 0;
    while (i < height) {
        var id = model.rows[i].columnsID || '';
        var j = i + 1;
        while (j < height && (model.rows[j].columnsID || '') === id) j++;
        groups.push({ start: i, end: j, columnsID: id });
        i = j;
    }
    return groups;
}

function isColumnArea(it) {
    return !!(it && it.kind === 'cells' && it.type === 'Columns');
}

function isRowArea(it) {
    return !!(it && it.kind === 'cells' && it.type !== 'Columns');
}

function columnAreaItems(model, columnsID) {
    var items = (model && model.namedItems) || [];
    var out = [];
    var filter = arguments.length >= 2;
    var want = columnsID || '';
    for (var i = 0; i < items.length; i++) {
        if (!isColumnArea(items[i]) || !items[i].name) continue;
        if (filter && (items[i].columnsID || '') !== want) continue;
        out.push(items[i]);
    }
    return out;
}

function colAreaContains(a, b) {
    if (!a || !b || a === b) return false;
    var as = a.endColumn - a.beginColumn;
    var bs = b.endColumn - b.beginColumn;
    return a.beginColumn <= b.beginColumn && a.endColumn >= b.endColumn && as > bs;
}

function columnAreaLevels(items) {
    var out = [];
    var i, j, level, max = 0;
    for (i = 0; i < items.length; i++) {
        level = 0;
        for (j = 0; j < items.length; j++) {
            if (colAreaContains(items[j], items[i])) level++;
        }
        out.push({ item: items[i], level: level });
        if (level > max) max = level;
    }
    return { items: out, maxLevel: out.length ? max : -1 };
}

function colAreaBounds(it, size) {
    if (!it) return null;
    var b = it.beginColumn;
    var e = it.endColumn;
    if (b == null || b < 0) b = 0;
    if (e == null || e < 0) e = size - 1;
    if (b >= size) return null;
    if (e >= size) e = size - 1;
    if (e < b) e = b;
    return { begin: b, end: e };
}

function placementOf(fmt) {
    /* Justified text has to break into lines to be justified at all, so it
     * wraps whatever the placement says. */
    if (alignCss(fmt && fmt.horizontalAlignment, 'h') === 'justify') return 'wrap';
    var p = String((fmt && fmt.textPlacement) || 'Auto').toLowerCase();
    if (p === 'wrap' || p === 'перенос' || p.indexOf('wrap') >= 0) return 'wrap';
    if (p === 'block' || p.indexOf('забив') >= 0) return 'block';
    if (p === 'cut' || p === 'обрез' || p.indexOf('cut') >= 0) return 'cut';
    return 'auto';
}

function areaForRow(model, row) {
    var items = model.namedItems || [];
    var best = null;
    var bestSpan = Infinity;
    var bestRank = 9;
    for (var i = 0; i < items.length; i++) {
        var it = items[i];
        if (!isRowArea(it)) continue;
        if (row < it.beginRow || row > it.endRow) continue;
        var span = it.endRow - it.beginRow;
        var rank = it.type === 'Rows' ? 0 : 1;
        if (!best || rank < bestRank || (rank === bestRank && span < bestSpan)) {
            best = it;
            bestSpan = span;
            bestRank = rank;
        }
    }
    return best;
}

function rowAreaStarts(model) {
    var starts = {};
    var items = model.namedItems || [];
    for (var i = 0; i < items.length; i++) {
        var it = items[i];
        if (it.kind !== 'cells') continue;
        if (it.type && it.type !== 'Rows') continue;
        starts[it.beginRow] = it;
    }
    return starts;
}

function eachRowArea(model, fn) {
    var items = model.namedItems || [];
    var used = {};
    var last = model.height - 1;
    var i;
    for (i = 0; i < items.length; i++) {
        var it = items[i];
        if (!isRowArea(it)) continue;
        if (it.type && it.type !== 'Rows') continue;
        if (!it.name || used[it.name]) continue;
        used[it.name] = true;
        var b = Math.max(0, it.beginRow);
        var e = Math.min(last, it.endRow);
        if (e < b) continue;
        fn(it, b, e);
    }
}

function itemKey(it) {
    if (!it) return '';
    if (it.name) return String(it.name);
    if (it.row != null) return 'r' + it.row + 'c' + (it.col || 0);
    return '';
}

function indexNamedLines(xml) {
    var map = {};
    if (!xml) return map;
    var lines = String(xml).split(/\r?\n/);
    var inNamed = false;
    for (var i = 0; i < lines.length; i++) {
        if (/<namedItem\b/.test(lines[i])) inNamed = true;
        if (inNamed) {
            var m = lines[i].match(/<name>([^<]+)<\/name>/);
            if (m && map[m[1]] == null) map[m[1]] = i + 1;
        }
        if (/<\/namedItem>/.test(lines[i])) inNamed = false;
    }
    return map;
}

function outline(model, xml) {
    var out = [];
    var map = indexNamedLines(xml || '');
    var items = (model && model.namedItems) || [];
    var named = items.filter(function (it) { return it.kind === 'cells' && it.name; })
        .sort(function (a, b) {
            var ac = isColumnArea(a) ? 0 : 1;
            var bc = isColumnArea(b) ? 0 : 1;
            if (ac !== bc) return ac - bc;
            if (ac === 0) return a.beginColumn - b.beginColumn;
            return a.beginRow - b.beginRow;
        });
    for (var i = 0; i < named.length; i++) {
        var it = named[i];
        out.push({
            type: 'form',
            tag: 'TemplateArea',
            name: it.name,
            title: it.name,
            id: it.name,
            line: map[it.name] || 1,
            depth: 0,
            areaType: it.type,
            beginRow: it.beginRow,
            endRow: it.endRow,
            beginColumn: it.beginColumn,
            endColumn: it.endColumn
        });
    }
    return out;
}

var PATTERN_TILES = [
    [0xAA, 0xFF, 0x55, 0xFF, 0xAA, 0xFF, 0x55, 0xFF],
    [0xAA, 0x55, 0xAA, 0x55, 0xAA, 0x55, 0xAA, 0x55],
    [0x00, 0x55, 0x00, 0xAA, 0x00, 0x55, 0x00, 0xAA],
    [0xFF, 0x01, 0x01, 0x01, 0xFF, 0x10, 0x10, 0x10],
    [0x11, 0x2A, 0x44, 0xA2, 0x11, 0xA8, 0x44, 0x8A],
    [0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66],
    [0x00, 0xFF, 0xFF, 0x00, 0x00, 0xFF, 0xFF, 0x00],
    [0x99, 0xCC, 0x66, 0x33, 0x99, 0xCC, 0x66, 0x33],
    [0xCC, 0x99, 0x33, 0x66, 0xCC, 0x99, 0x33, 0x66],
    [0xCC, 0xCC, 0x33, 0x33, 0xCC, 0xCC, 0x33, 0x33],
    [0xDD, 0xDD, 0x77, 0x77, 0xDD, 0xDD, 0x77, 0x77],
    [0xE1, 0xF0, 0x78, 0x3C, 0x1E, 0x0F, 0x87, 0xC3],
    [0x87, 0x0F, 0x1E, 0x3C, 0x78, 0xF0, 0xE1, 0xC3],
    [0x88, 0x44, 0x22, 0x11, 0x88, 0x44, 0x22, 0x11],
    [0x44, 0x88, 0x11, 0x22, 0x44, 0x88, 0x11, 0x22],
    [0x44, 0xFF, 0x44, 0x44, 0x44, 0xFF, 0x44, 0x44],
    [0xC0, 0xC0, 0x33, 0x33, 0x0C, 0x0C, 0x33, 0x33]
];

var PATTERN_SOLID = 0;
var PATTERN_NONE = 255;
var patternUrlCache = {};

function patternTileUrl(tile, color) {
    var key = tile.join(',') + '|' + color;
    if (patternUrlCache[key]) return patternUrlCache[key];
    var rects = '';
    var y, x;
    for (y = 0; y < 8; y++) {
        for (x = 0; x < 8; x++) {
            if ((tile[y] >> x) & 1) rects += '<rect x="' + x + '" y="' + y + '" width="1" height="1"/>';
        }
    }
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" '
        + 'shape-rendering="crispEdges" fill="' + color + '">' + rects + '</svg>';
    var url = 'url("data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg) + '")';
    patternUrlCache[key] = url;
    return url;
}

/* Returns the background layers of a cell: a colour and, over it, the hatch of
 * the pattern. A pattern without an absolute colour is not drawn — real
 * invoices mark a column with a colourless pattern, and painting it black is
 * wrong. */
function patternFill(fmt) {
    if (!fmt || fmt.pattern == null || fmt.pattern === '') return null;
    var color = styleColor(fmt.patternColor);
    if (!color) return null;
    var n = parseInt(fmt.pattern, 10);
    if (!isFinite(n) || n === PATTERN_NONE) return null;
    if (n === PATTERN_SOLID) return { color: color };
    if (n < 1 || n > PATTERN_TILES.length) return null;
    return { image: patternTileUrl(PATTERN_TILES[n - 1], color) };
}

/* Text orientation is stored in degrees. 90 is the common case — text reading
 * bottom to top — and gets writing-mode so the line box keeps its height; any
 * other angle is a plain rotation. */
function applyOrientation(node, fmt) {
    if (!fmt || fmt.textOrientation == null || fmt.textOrientation === '') return false;
    var deg = Number(fmt.textOrientation);
    if (!isFinite(deg) || !deg) return false;
    if (deg === 90) {
        node.style.writingMode = 'vertical-rl';
        node.style.transform = 'rotate(180deg)';
        return true;
    }
    node.style.display = 'inline-block';
    node.style.transformOrigin = 'left bottom';
    node.style.transform = 'rotate(' + (-deg) + 'deg)';
    return true;
}

/* «Забивать» (Block): a value that fits is shown as is; one that does not fit
 * is not cut but replaced by a row of '#' of the same length, the way a
 * spreadsheet flags a number too wide for its column. The width is estimated
 * from the font size — close enough to decide fit or no fit. */
var BLOCK_MAX_CHARS = 32768;

function blockFit(text, widthPx, fontPt) {
    if (!text) return String(text || '');
    var s = String(text);
    var charPx = Math.max(3, (Number(fontPt) || 8) * (96 / 72) * 0.55);
    var lines = s.split(/\r?\n/);
    var widest = 0;
    for (var i = 0; i < lines.length; i++) widest = Math.max(widest, lines[i].length);
    if (widest * charPx <= widthPx) return s;
    var n = Math.min(BLOCK_MAX_CHARS, s.replace(/[\r\n]/g, '').length) || 1;
    return new Array(n + 1).join('#');
}

/* Inner padding of a cell's text: side margins count eighths of a character,
 * top and bottom margins 1/288 inch, and an indent whole characters on the
 * side the text is aligned to. Text never touches the grid line: a pixel of
 * air is always kept. */
function textPadding(fmt, align) {
    var num = function (v) { var n = Number(v); return isFinite(n) && n > 0 ? n : 0; };
    var pad = {
        left: TEXT_MARGIN_PX + widthToPx(num(fmt && fmt.leftMargin)),
        right: TEXT_MARGIN_PX + widthToPx(num(fmt && fmt.rightMargin)),
        top: heightToPx(num(fmt && fmt.topMargin)),
        bottom: heightToPx(num(fmt && fmt.bottomMargin))
    };
    var indent = num(fmt && fmt.indent) * CHAR_PX;
    if (align === 'right') pad.right += indent;
    else if (align !== 'center') pad.left += indent;
    return pad;
}

/* «По выделенным колонкам»: a value is centred (or aligned) across its own
 * cell and the empty cells to the right that carry the same flag. */
function acrossBox(model, row, set, spans, ly, col) {
    var width = set.widths[col] || 0;
    for (var c = col + 1; c < set.size; c++) {
        if (spans.covered[ly][c] || spans.origin[ly][c]) break;
        var neighbour = cellAt(row, c);
        var nf = effectiveFormat(model, row, neighbour, c);
        if (!nf || !isTrue(nf.bySelectedColumns)) break;
        if (neighbour && displayText(neighbour, nf)) break;
        width += set.widths[c] || 0;
    }
    return { left: 0, width: width };
}

function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null && text !== '') n.textContent = text;
    return n;
}

function applyCellStyle(td, model, cell, fmt, hPx, auto, place, borders) {
    var font = fontOf(model, fmt);
    td.style.fontFamily = (font.faceName || 'Arial') + ', Arial, sans-serif';
    td.style.fontSize = (font.height || 8) + 'pt';
    td.style.fontWeight = font.bold ? 'bold' : 'normal';
    td.style.fontStyle = font.italic ? 'italic' : 'normal';
    var dec = '';
    if (font.underline) dec += 'underline ';
    if (font.strikeout) dec += 'line-through ';
    if (dec) td.style.textDecoration = dec.trim();
    place = place || placementOf(fmt);
    td.style.textAlign = alignCss(fmt && fmt.horizontalAlignment, 'h');
    td.style.verticalAlign = alignCss(fmt && fmt.verticalAlignment, 'v', defaultVAlign(model));
    if (place === 'cut' || place === 'block') {
        /* `pre` rather than `nowrap`: 1C draws the value line by line and only
         * refuses to wrap. The overflow is clipped either way. */
        td.style.whiteSpace = 'pre';
        td.style.overflow = 'hidden';
    } else if (place === 'wrap') {
        td.style.whiteSpace = 'pre-wrap';
        td.style.overflow = 'hidden';
        td.style.wordBreak = 'break-word';
    } else {
        td.style.whiteSpace = 'nowrap';
        td.style.overflow = 'visible';
    }
    if (fmt) {
        var bg = styleColor(fmt.backColor);
        if (bg) td.style.background = bg;
        var pat = patternFill(fmt);
        if (pat && pat.color) td.style.background = pat.color;
        else if (pat && pat.image) td.style.backgroundImage = pat.image;
        var fg = styleColor(fmt.textColor);
        if (fg) td.style.color = fg;
    }
    if (!borders && fmt) {
        borders = {
            left: sideBorder(model, fmt, 'left'),
            right: sideBorder(model, fmt, 'right'),
            top: sideBorder(model, fmt, 'top'),
            bottom: sideBorder(model, fmt, 'bottom')
        };
    }
    if (borders) {
        if (borders.left) td.style.borderLeft = borders.left;
        if (borders.right) td.style.borderRight = borders.right;
        if (borders.top) td.style.borderTop = borders.top;
        if (borders.bottom) td.style.borderBottom = borders.bottom;
    }
    td.style.height = hPx + 'px';
    if (!auto && place !== 'auto') {
        td.style.maxHeight = hPx + 'px';
        td.style.overflow = 'hidden';
    } else if (auto) {
        td.style.overflow = 'visible';
    }
}

/* One row of a group's grid as its own <tr>. Split out of renderGroupTable
 * so the incremental path can rebuild a row without redrawing the sheet. */
function buildRow(model, group, set, spans, rowHeights, ctx, starts, y) {
    var c;
    var ly = y - group.start;
    var row = model.rows[y];
    var rh = rowHeights[y];
    var tr = el('tr');
    tr.style.height = rh + 'px';
    tr.setAttribute('data-row', String(y));
    var area = areaForRow(model, y);
    if (area) tr.setAttribute('data-area', area.name);
    if (starts[y]) tr.className = 'tp-area-start';
    /* Past the end of the document: drawn paler, so it is clear the sheet
     * itself ends above and these rows are there to be filled. */
    if (y >= documentRows(model)) tr.className += (tr.className ? ' ' : '') + 'tp-beyond';
    for (c = 0; c < set.size; c++) {
        if (spans.covered[ly][c]) continue;
        var sp = spans.origin[ly][c];
        var td = el('td');
        td.setAttribute('data-row', String(y));
        td.setAttribute('data-col', String(c));
        td.setAttribute('data-id', 'r' + y + 'c' + c);
        /* Правее макета — то же, что ниже него: место, куда можно писать. */
        if (c >= documentColumns(model)) td.className = 'tp-beyond';
        var spanRows = sp && sp.rowspan > 1 ? sp.rowspan : 1;
        var spanCols = sp && sp.colspan > 1 ? sp.colspan : 1;
        var cellH = 0;
        var autoHeight = false;
        var ownRow = rowHeight(model, row, y);
        var i;
        for (i = 0; i < spanRows; i++) {
            cellH += rowHeights[y + i] || rh;
            autoHeight = autoHeight || rowHeight(model, model.rows[y + i], y + i).auto;
        }
        if (sp) {
            if (sp.rowspan > 1) td.rowSpan = sp.rowspan;
            if (sp.colspan > 1) td.colSpan = sp.colspan;
        }
        lockWidth(td, colSpanWidth(set, c, spanCols));
        var cell = cellAt(row, c);
        var fmt = effectiveFormat(model, row, cell, c);
        var place = placementOf(fmt);
        var text = displayText(cell, fmt);
        var cellPx = spanRows === 1 ? rh : cellH;
        var borders = collapseBorders(model, group, set, y, c, spanRows, spanCols,
            spanBorders(model, y, c, spanRows, spanCols));
        applyCellStyle(td, model, cell, fmt, cellPx, autoHeight, place, borders);
        if (spanRows !== 1) {
            td.style.height = '';
            td.style.maxHeight = '';
        }
        if (text) td.className = (td.className ? td.className + ' ' : '') + 'tp-has-text';
        var inner = el('div', 'tp-cell tp-place-' + place);
        /* The cell's own top and bottom lines sit inside the row height:
         * a full-height inner box pushed every framed row down by its
         * border, and drawings placed by the computed row tops drifted. */
        var edges = (parseInt(borders.top, 10) || 0) + (parseInt(borders.bottom, 10) || 0);
        var innerPx = Math.max(0, cellPx - edges);
        if (autoHeight) inner.style.minHeight = innerPx + 'px';
        else inner.style.height = innerPx + 'px';
        if (spanRows === 1 && ownRow.max != null) {
            inner.style.maxHeight = Math.max(0, ownRow.max - edges) + 'px';
            td.style.overflow = 'hidden';
        }
        var halign = alignCss(fmt && fmt.horizontalAlignment, 'h');
        var pad = textPadding(fmt, halign);
        inner.style.boxSizing = 'border-box';
        inner.style.paddingLeft = pad.left + 'px';
        inner.style.paddingRight = pad.right + 'px';
        if (pad.top) inner.style.paddingTop = pad.top + 'px';
        if (pad.bottom) inner.style.paddingBottom = pad.bottom + 'px';
        /* The inner box fills the cell, so `vertical-align` on the td can
         * never move the text: the alignment has to live here. */
        var va = alignCss(fmt && fmt.verticalAlignment, 'v', defaultVAlign(model));
        inner.style.display = 'flex';
        inner.style.flexDirection = 'column';
        inner.style.justifyContent =
            va === 'bottom' ? 'flex-end' : va === 'middle' ? 'center' : 'flex-start';
        if (place === 'auto') {
            inner.style.overflow = 'visible';
            inner.style.whiteSpace = 'nowrap';
        } else {
            inner.style.overflow = 'hidden';
        }
        if (text && spanCols === 1 && spanRows === 1 && isTrue(fmt && fmt.bySelectedColumns)) {
            var across = acrossBox(model, row, set, spans, ly, c);
            lockWidth(inner, across.width);
            inner.style.overflow = 'hidden';
        } else if (text && place === 'auto' && spanCols === 1 && spanRows === 1) {
            var box = spillBox(model, row, set, spans, ly, c, spanCols, halign);
            lockWidth(inner, box.width);
            if (box.left) inner.style.marginLeft = box.left + 'px';
            inner.style.overflow = 'hidden';
        }
        if (text) {
            var shown = place === 'block'
                ? blockFit(text, colSpanWidth(set, c, spanCols) - pad.left - pad.right, fontOf(model, fmt).height)
                : text;
            var node = inner;
            if (isParamCell(cell, fmt) || (fmt && fmt.fillType === 'Template')) {
                node = el('span', 'tp-param', shown);
                inner.appendChild(node);
            } else {
                inner.textContent = shown;
            }
            if (applyOrientation(inner, fmt)) inner.style.display = 'block';
        }
        td.appendChild(inner);
        td.addEventListener('click', (function (rowIdx, colIdx, cellRef) {
            return function (ev) {
                ev.stopPropagation();
                /* A spreadsheet may use a different column set in every row.
                 * The Designer's ruler follows the focused cell immediately;
                 * scrolling is only the fallback before a cell has focus. */
                activateColumnRow(ctx.container, rowIdx);
                if (ctx.onSelect) ctx.onSelect({
                    name: (cellRef && (cellRef.parameter || cellRef.text)) || ('R' + (rowIdx + 1) + 'C' + (colIdx + 1)),
                    row: rowIdx,
                    col: colIdx,
                    id: 'r' + rowIdx + 'c' + colIdx,
                    area: area ? area.name : ''
                });
            };
        })(y, c, cell));
        tr.appendChild(td);
    }
    return tr;
}

function renderGroupTable(model, group, ctx, rowHeights) {
    var set = columnSetOf(model, group.columnsID);
    var spans = buildSpans(model, group.start, group.end, group.columnsID);
    var table = el('table', 'tp-grid');
    table.style.tableLayout = 'fixed';
    if (table.setAttribute) table.setAttribute('data-columns-id', group.columnsID || '');
    var colgroup = el('colgroup');
    var c;
    for (c = 0; c < set.size; c++) {
        var col = document.createElement('col');
        lockWidth(col, set.widths[c]);
        if (col.setAttribute) col.setAttribute('width', String(Math.round(set.widths[c])));
        colgroup.appendChild(col);
    }
    table.appendChild(colgroup);
    table.style.width = set.widths.reduce(function (a, b) { return a + b; }, 0) + 'px';

    var tbody = el('tbody');
    var starts = rowAreaStarts(model);
    for (var y = group.start; y < group.end; y++) {
        tbody.appendChild(buildRow(model, group, set, spans, rowHeights, ctx, starts, y));
    }
    table.appendChild(tbody);
    var groupEl = el('div', 'tp-group');
    groupEl.style.position = 'relative';
    groupEl.appendChild(table);
    var lines = renderColAreaLines(model, set, group.columnsID);
    if (lines) groupEl.appendChild(lines);
    return groupEl;
}

function pictureDataUrl(model, pictureIndex) {
    var pics = model.pictures || [];
    var pic = null;
    var want = pictureIndex;
    var i;
    for (i = 0; i < pics.length; i++) {
        if (pics[i].index === want || pics[i].index === want - 1) { pic = pics[i]; break; }
    }
    if (!pic && want >= 1 && pics[want - 1]) pic = pics[want - 1];
    if (!pic && pics[want]) pic = pics[want];
    if (!pic || !pic.data) return '';
    return 'data:' + (pic.mime || 'image/png') + ';base64,' + pic.data;
}

function colLefts(set) {
    var lefts = [0];
    var acc = 0;
    for (var i = 0; i < set.size; i++) {
        acc += set.widths[i] || 0;
        lefts.push(acc);
    }
    return lefts;
}

function renderDrawings(model, wrap, rowTops, rowHeights) {
    var layer = el('div', 'tp-drawings');
    var drawings = model.drawings || [];
    drawings = drawings.slice().sort(function (a, b) { return (a.zOrder || 0) - (b.zOrder || 0); });
    for (var i = 0; i < drawings.length; i++) {
        var d = drawings[i];
        if (d.drawingType === 'Other') continue;
        var row = model.rows[d.beginRow] || model.rows[0];
        var set = columnSetOf(model, row && row.columnsID);
        var lefts = colLefts(set);
        /* Offsets inside the anchor cell use the vertical unit on both axes. */
        var x0 = (lefts[d.beginColumn] || 0) + heightToPx(d.beginColumnOffset);
        var x1 = (lefts[d.endColumn] || 0) + heightToPx(d.endColumnOffset);
        var y0 = (rowTops[d.beginRow] || 0) + heightToPx(d.beginRowOffset);
        var y1 = (rowTops[d.endRow] || 0) + heightToPx(d.endRowOffset);
        var w = x1 - x0;
        var h = y1 - y0;
        if (w < 8 || h < 8) {
            var lines = String(d.text || '').split(/\r?\n/);
            var widest = 0;
            for (var li = 0; li < lines.length; li++) {
                if (lines[li].length > widest) widest = lines[li].length;
            }
            var fontPt = fontOf(model, formatByIndex(model.formats, d.formatIndex)).height || 8;
            var chPx = fontPt * (96 / 72) * 0.55;
            if (w < 8) w = Math.max(60, widest * chPx + 8);
            if (h < 8) h = Math.max(20, lines.length * fontPt * (96 / 72) * 1.2 + 6);
        }
        var anchored = w >= 8 && h >= 8;
        w = Math.max(4, w);
        h = Math.max(4, h);
        var box = el('div', 'tp-drawing');
        /* Real row heights can differ from the computed ones (wrapped text,
         * borders); syncChrome moves anchored drawings onto the laid-out rows. */
        if (anchored) box._tpAnchor = { beginRow: d.beginRow, beginOffset: heightToPx(d.beginRowOffset), endRow: d.endRow, endOffset: heightToPx(d.endRowOffset) };
        box.style.left = x0 + 'px';
        box.style.top = y0 + 'px';
        box.style.width = w + 'px';
        box.style.height = h + 'px';
        var fmt = formatByIndex(model.formats, d.formatIndex);
        var b = fmt ? borderCss(lineOf(model, fmt.drawingBorder), fmt.bordersColor) : '';
        /* A caption or a rectangle is nothing but its frame and its text: when
         * the format names no line, 1C still draws a thin one. */
        if (!b && (d.drawingType === 'Text' || d.drawingType === 'Rectangle')) {
            b = '1px solid ' + (styleColor(fmt && fmt.bordersColor) || '#000');
        }
        if (b && b !== 'none') box.style.border = b;
        if (fmt) {
            var dbg = styleColor(fmt.backColor);
            if (dbg) box.style.background = dbg;
            var dpat = patternFill(fmt);
            if (dpat && dpat.color) box.style.background = dpat.color;
            else if (dpat && dpat.image) box.style.backgroundImage = dpat.image;
        }
        /* A drawing that is not a picture carries pictureIndex 0, which means
         * «no picture» — resolving it would hand a caption the first image of
         * the document. */
        var url = d.pictureIndex ? pictureDataUrl(model, d.pictureIndex) : '';
        if (url) {
            var img = document.createElement('img');
            img.src = url;
            img.alt = '';
            /* Stretch fills the box, RealSize keeps pixels, the rest keep the aspect. */
            var sizeMode = String(d.pictureSize || '').toLowerCase();
            img.style.objectFit = sizeMode === 'stretch' ? 'fill' : sizeMode === 'realsize' ? 'none' : 'contain';
            img.style.width = '100%';
            img.style.height = '100%';
            box.appendChild(img);
        } else if (d.text) {
            var cap = el('div', 'tp-drawing-text', d.text);
            var dfont = fontOf(model, fmt);
            cap.style.fontFamily = (dfont.faceName || 'Arial') + ', Arial, sans-serif';
            cap.style.fontSize = (dfont.height || 8) + 'pt';
            cap.style.fontWeight = dfont.bold ? 'bold' : 'normal';
            cap.style.fontStyle = dfont.italic ? 'italic' : 'normal';
            var dfg = styleColor(fmt && fmt.textColor);
            if (dfg) cap.style.color = dfg;
            box.appendChild(cap);
        }
        layer.appendChild(box);
    }
    wrap.appendChild(layer);
}

var COLHEAD_H = 18;
var COL_AREA_ROW_H = 16;

function syncChrome(container) {
    var wrap = container.querySelector('.tp-grid-wrap');
    var model = container._tpModel;
    if (!wrap || !model) return;
    var wrapRect = wrap.getBoundingClientRect();
    var rowTops = [];
    var rowHeights = [];
    var y;
    for (y = 0; y < model.height; y++) {
        var tr = wrap.querySelector('tr[data-row="' + y + '"]');
        var r = tr ? tr.getBoundingClientRect() : null;
        if (r && r.height > 0.5) {
            rowTops[y] = r.top - wrapRect.top + wrap.scrollTop;
            rowHeights[y] = r.height;
        } else {
            rowTops[y] = y ? rowTops[y - 1] + rowHeights[y - 1] : 0;
            rowHeights[y] = y ? rowHeights[y - 1] : 17;
        }
    }
    var nums = container.querySelectorAll('.tp-row-num');
    var last = model.height - 1;
    var totalH = (rowTops[last] || 0) + (rowHeights[last] || 0);
    var rowhead = container.querySelector('.tp-rowhead');
    if (rowhead) rowhead.style.height = totalH + 'px';
    for (y = 0; y < nums.length; y++) {
        nums[y].style.top = (rowTops[y] || 0) + 'px';
        nums[y].style.height = rowHeights[y] + 'px';
    }
    var rail = container.querySelector('.tp-areas');
    if (rail) {
        rail.style.height = totalH + 'px';
        var labels = rail.querySelectorAll('.tp-area-label');
        for (var i = 0; i < labels.length; i++) {
            var area = areaRange(model, labels[i].getAttribute('data-id'));
            if (!area) continue;
            var b = Math.max(0, area.beginRow);
            var e = Math.min(last, area.endRow);
            labels[i].style.top = (rowTops[b] || 0) + 'px';
            labels[i].style.height = Math.max(12, (rowTops[e] || 0) + (rowHeights[e] || 0) - (rowTops[b] || 0)) + 'px';
        }
    }
    syncRowAreaLines(container, rowTops, rowHeights, last);
    var boxes = wrap.querySelectorAll('.tp-drawing');
    for (var k = 0; k < boxes.length; k++) {
        var anchor = boxes[k]._tpAnchor;
        if (!anchor) continue;
        var top = (rowTops[anchor.beginRow] || 0) + anchor.beginOffset;
        var bottom = (rowTops[anchor.endRow] || 0) + anchor.endOffset;
        if (bottom - top < 4) continue;
        boxes[k].style.top = top + 'px';
        boxes[k].style.height = (bottom - top) + 'px';
    }
    container._tpRowTops = rowTops;
    container._tpRowHeights = rowHeights;
}

function viewColumnSet(model, columnsID) {
    if (columnsID != null && columnsID !== false) {
        return columnSetOf(model, columnsID);
    }
    var best = null;
    var rows = model.rows || [];
    for (var i = 0; i < rows.length; i++) {
        var s = columnSetOf(model, rows[i].columnsID);
        if (!best || s.size > best.size) best = s;
    }
    return best || columnSetOf(model, '');
}

function fillColHead(bar, set, model) {
    bar.innerHTML = '';
    var table = el('table', 'tp-grid tp-colhead-table');
    table.style.tableLayout = 'fixed';
    /* Which column set these widths belong to: a sheet has several, and both
     * the editing layer's live resize and the write that follows it have to
     * act on the one the ruler is showing. */
    if (table.setAttribute) table.setAttribute('data-columns-id', set.id || '');
    var colgroup = el('colgroup');
    var tr = el('tr', 'tp-colhead');
    var c;
    for (c = 0; c < set.size; c++) {
        var col = document.createElement('col');
        lockWidth(col, set.widths[c]);
        if (col.setAttribute) col.setAttribute('width', String(Math.round(set.widths[c])));
        colgroup.appendChild(col);
        var th = el('th', (model && c >= documentColumns(model)) ? 'tp-beyond' : '', String(c + 1));
        th.setAttribute('data-col', String(c));
        lockWidth(th, set.widths[c]);
        tr.appendChild(th);
    }
    table.appendChild(colgroup);
    table.style.width = set.widths.reduce(function (a, b) { return a + b; }, 0) + 'px';
    var thead = el('thead');
    thead.appendChild(tr);
    table.appendChild(thead);
    bar.appendChild(table);
}

function areaRange(model, name) {
    var items = model.namedItems || [];
    for (var i = 0; i < items.length; i++) {
        var it = items[i];
        if (it.kind !== 'cells') continue;
        if (it.name === name) return it;
    }
    return null;
}

function renderColAreaRail(model, set) {
    var packed = columnAreaLevels(columnAreaItems(model, set && set.id));
    if (packed.maxLevel < 0) return null;
    var lefts = colLefts(set);
    var totalW = lefts[set.size] || 0;
    var rows = packed.maxLevel + 1;
    var rail = el('div', 'tp-col-areas');
    rail.style.position = 'relative';
    rail.style.height = (rows * COL_AREA_ROW_H) + 'px';
    rail.style.width = totalW + 'px';
    var i;
    for (i = 0; i < packed.items.length; i++) {
        var rec = packed.items[i];
        var it = rec.item;
        var bnds = colAreaBounds(it, set.size);
        if (!bnds) continue;
        var lab = el('div', 'tp-col-area-label', it.name);
        lab.style.position = 'absolute';
        lab.style.left = (lefts[bnds.begin] || 0) + 'px';
        lab.style.width = Math.max(12, (lefts[bnds.end + 1] || totalW) - (lefts[bnds.begin] || 0)) + 'px';
        lab.style.top = (rec.level * COL_AREA_ROW_H) + 'px';
        lab.style.height = COL_AREA_ROW_H + 'px';
        lab.setAttribute('data-id', it.name);
        lab.title = it.name;
        rail.appendChild(lab);
    }
    return rail;
}

function renderColAreaLines(model, set, columnsID) {
    var items = columnAreaItems(model, columnsID || '');
    if (!items.length) return null;
    var lefts = colLefts(set);
    var seen = {};
    var layer = el('div', 'tp-col-area-lines');
    var i;
    function addLine(x) {
        var key = String(Math.round(x * 10) / 10);
        if (seen[key] || x < 0) return;
        seen[key] = true;
        var ln = el('div', 'tp-col-area-line');
        ln.style.left = x + 'px';
        ln.style.top = '0';
        ln.style.bottom = '0';
        ln.style.height = '100%';
        layer.appendChild(ln);
    }
    for (i = 0; i < items.length; i++) {
        var bnds = colAreaBounds(items[i], set.size);
        if (!bnds) continue;
        addLine(lefts[bnds.begin] || 0);
        addLine(lefts[bnds.end + 1] || lefts[set.size] || 0);
    }
    if (!layer.children.length) return null;
    return layer;
}

function renderAreaRail(model, rowHeights, rowTops, totalH) {
    var rail = el('div', 'tp-areas');
    rail.style.height = totalH + 'px';
    rail.style.position = 'relative';
    eachRowArea(model, function (it, b, e) {
        var top = rowTops[b] || 0;
        var bottom = (rowTops[e] || 0) + (rowHeights[e] || 0);
        var lab = el('div', 'tp-area-label', it.name);
        lab.style.position = 'absolute';
        lab.style.left = '0';
        lab.style.right = '0';
        lab.style.top = top + 'px';
        lab.style.height = Math.max(12, bottom - top) + 'px';
        lab.setAttribute('data-id', it.name);
        lab.title = it.name;
        rail.appendChild(lab);
    });
    return rail;
}

function addRowAreaLine(layer, y, row, edge) {
    var ln = el('div', 'tp-row-area-line');
    ln.style.top = y + 'px';
    ln.setAttribute('data-row', String(row));
    ln.setAttribute('data-edge', edge);
    layer.appendChild(ln);
}

function renderRowAreaLines(model, rowTops, rowHeights) {
    var layer = el('div', 'tp-row-area-lines');
    eachRowArea(model, function (it, b, e) {
        addRowAreaLine(layer, rowTops[b] || 0, b, 'start');
        addRowAreaLine(layer, (rowTops[e] || 0) + (rowHeights[e] || 0), e, 'end');
    });
    return layer.children.length ? layer : null;
}

function syncRowAreaLines(container, rowTops, rowHeights, last) {
    var lines = container.querySelectorAll('.tp-row-area-line');
    if (!lines.length) return;
    var i;
    for (i = 0; i < lines.length; i++) {
        var row = parseInt(lines[i].getAttribute('data-row'), 10);
        if (!isFinite(row) || row < 0) continue;
        if (row > last) row = last;
        var y = rowTops[row] || 0;
        if (lines[i].getAttribute('data-edge') === 'end') y += rowHeights[row] || 0;
        lines[i].style.top = y + 'px';
    }
}

function renderRowHead(model, rowHeights) {
    var col = el('div', 'tp-rowhead');
    col.style.position = 'relative';
    var real = documentRows(model);
    for (var i = 0; i < model.height; i++) {
        var lab = el('div', 'tp-row-num' + (i >= real ? ' tp-beyond' : ''), String(i + 1));
        lab.style.position = 'absolute';
        lab.style.left = '0';
        lab.style.right = '0';
        lab.style.top = '0';
        lab.style.height = rowHeights[i] + 'px';
        lab.setAttribute('data-row', String(i));
        col.appendChild(lab);
    }
    return col;
}

function syncAreaHighlight(container, id) {
    var ov = container.querySelector('.tp-hi');
    var model = container._tpModel;
    var rowTops = container._tpRowTops;
    var rowHeights = container._tpRowHeights;
    if (!ov || !model || !rowTops) return;
    var area = areaRange(model, id);
    if (!area) {
        ov.hidden = true;
        return;
    }
    ov.hidden = false;
    if (isColumnArea(area)) {
        var set = viewColumnSet(model, area.columnsID);
        var lefts = colLefts(set);
        var bnds = colAreaBounds(area, set.size);
        if (!bnds) { ov.hidden = true; return; }
        var last = model.height - 1;
        var bottom = (rowTops[last] || 0) + (rowHeights[last] || 0);
        ov.style.left = (lefts[bnds.begin] || 0) + 'px';
        ov.style.width = Math.max(1, (lefts[bnds.end + 1] || lefts[set.size] || 0) - (lefts[bnds.begin] || 0)) + 'px';
        ov.style.right = 'auto';
        ov.style.top = '0';
        ov.style.height = Math.max(1, bottom) + 'px';
        return;
    }
    if (area.beginRow == null) {
        ov.hidden = true;
        return;
    }
    var b = Math.max(0, area.beginRow);
    var e = Math.min(model.height - 1, area.endRow);
    var top = rowTops[b] || 0;
    var bottom = (rowTops[e] || 0) + (rowHeights[e] || 0);
    ov.style.left = '0';
    ov.style.right = '0';
    ov.style.width = 'auto';
    ov.style.top = top + 'px';
    ov.style.height = Math.max(1, bottom - top) + 'px';
}

function centerInScroll(sc, target, axis) {
    if (!sc || !target) return;
    if (!sc.getBoundingClientRect || !target.getBoundingClientRect) return;
    var sr = sc.getBoundingClientRect();
    var tr = target.getBoundingClientRect();
    if (!(sr.width > 0 || sr.height > 0)) return;
    axis = axis || 'both';
    if (axis === 'v' || axis === 'both') {
        var nextTop = sc.scrollTop + (tr.top - sr.top) - (sr.height - tr.height) / 2;
        var maxTop = Math.max(0, (sc.scrollHeight || 0) - sr.height);
        sc.scrollTop = Math.max(0, Math.min(nextTop, maxTop));
    }
    if (axis === 'h' || axis === 'both') {
        var nextLeft = sc.scrollLeft + (tr.left - sr.left) - (sr.width - tr.width) / 2;
        var maxLeft = Math.max(0, (sc.scrollWidth || 0) - sr.width);
        sc.scrollLeft = Math.max(0, Math.min(nextLeft, maxLeft));
    }
}

function outlineIcon(it) {
    if (it && (it.areaType === 'Columns' || it.type === 'Columns')) {
        return { cls: 'icon-tpl-col', ch: '|' };
    }
    return { cls: 'icon-tpl-row', ch: '\u2014' };
}

/* Drops the named-area highlight. The sheet has two selections drawn on it:
 * the named area the outline points at, and the cell range the editing layer
 * owns. Only one of them can be the current selection, so whichever is set
 * last clears the other. */
function clearHighlight(container) {
    if (!container || !container.querySelectorAll) return;
    var prev = container.querySelectorAll('.tp-selected');
    for (var i = 0; i < prev.length; i++) prev[i].classList.remove('tp-selected');
    var ov = container.querySelector('.tp-hi');
    if (ov) ov.hidden = true;
}

function highlight(container, id) {
    if (!container || !id) return null;
    var model = container._tpModel;
    var area = model ? areaRange(model, id) : null;
    /* Rebuild the whole top chrome before looking for the label. Previously
     * only the numbered header was refilled, so a vertical area selected in
     * the right pane still had no label or red boundaries on the canvas. */
    if (area && isColumnArea(area)) activateColumnSet(container, area.columnsID);
    var prev = container.querySelectorAll('.tp-selected');
    for (var i = 0; i < prev.length; i++) prev[i].classList.remove('tp-selected');
    var safe = String(id).replace(/"/g, '');
    var hit = container.querySelector('.tp-area-label[data-id="' + safe + '"]')
        || container.querySelector('.tp-col-area-label[data-id="' + safe + '"]');
    var rows = container.querySelectorAll('tr[data-area="' + safe + '"]');
    if (hit) hit.classList.add('tp-selected');
    for (var r = 0; r < rows.length; r++) {
        rows[r].classList.add('tp-selected');
        if (!hit) hit = rows[r];
    }
    var cell = container.querySelector('td[data-id="' + safe + '"]');
    if (cell) {
        cell.classList.add('tp-selected');
        hit = cell;
    }
    syncAreaHighlight(container, id);
    var sc = container.querySelector('.tp-scroll');
    var ov = container.querySelector('.tp-hi');
    var target = (ov && !ov.hidden) ? ov : hit;
    var axis = 'both';
    if (area && isColumnArea(area)) axis = 'h';
    else if (area) axis = 'v';
    centerInScroll(sc, target, axis);
    return hit;
}

/* A row-group's own column set (`renderGroupTable`) is already correct — each
 * group draws with its own widths. The sticky ruler at the top is the part
 * that used to freeze on the widest set at mount and never follow the scroll:
 * scrolled into a section with its own (usually narrower, unevenly sized)
 * columns, the ruler kept showing the wrong widths and any Columns-type named
 * area belonging to that section never appeared in it. */
function buildColumnChrome(model, columnsID) {
    var set = viewColumnSet(model, columnsID);
    var colAreas = renderColAreaRail(model, set);
    var colHead = el('div', 'tp-colhead-bar');
    fillColHead(colHead, set, model);
    var chromeH = COLHEAD_H + (colAreas ? (columnAreaLevels(columnAreaItems(model, set.id)).maxLevel + 1) * COL_AREA_ROW_H : 0);
    return { colAreas: colAreas, colHead: colHead, chromeH: chromeH };
}

function groupForRowIndex(groups, row) {
    for (var i = 0; i < groups.length; i++) {
        if (row >= groups[i].start && row < groups[i].end) return groups[i];
    }
    return groups[0] || { columnsID: '' };
}

function rowAtScrollTop(rowTops, rowHeights, height, scrollTop) {
    var row = 0;
    for (var y = 0; y < height; y++) {
        row = y;
        if ((rowTops[y] || 0) + (rowHeights[y] || 0) > scrollTop + 1) break;
    }
    return row;
}

/* Re-picks the ruler for whichever row-group now sits at the top of the
 * viewport, and only touches the DOM when that group actually changed. */
function installColumnChrome(container, columnsID) {
    var model = container._tpModel;
    var colChrome = container.querySelector('.tp-col-chrome');
    var corner = container.querySelector('.tp-corner');
    if (!model || !colChrome || !corner) return;
    columnsID = columnsID || '';
    if (columnsID === container._tpChromeColumnsID) return;
    container._tpChromeColumnsID = columnsID;
    var chrome = buildColumnChrome(model, columnsID);
    colChrome.innerHTML = '';
    if (chrome.colAreas) colChrome.appendChild(chrome.colAreas);
    colChrome.appendChild(chrome.colHead);
    corner.style.height = chrome.chromeH + 'px';
    corner.style.flexBasis = chrome.chromeH + 'px';
    if (container._tpOnAreaClick && chrome.colAreas) {
        chrome.colAreas.addEventListener('click', container._tpOnAreaClick);
    }
}

/* Pins the ruler to the row that owns the keyboard/mouse focus. This is kept
 * separately from the current scroll position: a horizontal scroll also
 * emits `scroll`, but must not send the ruler back to the top visible row. */
function activateColumnRow(container, row) {
    var model = container && container._tpModel;
    var groups = container && container._tpGroups;
    if (!model || !groups || !isFinite(row)) return;
    row = Math.max(0, Math.min(model.height - 1, Number(row)));
    container._tpActiveColumnRow = row;
    container._tpActiveColumnsIDSet = false;
    installColumnChrome(container, groupForRowIndex(groups, row).columnsID || '');
}

/* A Columns named area carries its own column set and can be selected from
 * the outline even while no row of that set is visible. Keep that set active
 * until an actual cell/row takes focus. */
function activateColumnSet(container, columnsID) {
    if (!container || !container._tpModel) return;
    container._tpActiveColumnsIDSet = true;
    container._tpActiveColumnsID = columnsID || '';
    installColumnChrome(container, container._tpActiveColumnsID);
}

function updateColumnChrome(container) {
    var model = container._tpModel;
    var groups = container._tpGroups;
    var rowTops = container._tpRowTops;
    var rowHeights = container._tpRowHeights;
    var sc = container.querySelector('.tp-scroll');
    if (!model || !groups || !rowTops || !sc) return;
    if (container._tpActiveColumnsIDSet) {
        installColumnChrome(container, container._tpActiveColumnsID || '');
        return;
    }
    var row = container._tpActiveColumnRow != null && isFinite(container._tpActiveColumnRow)
        ? container._tpActiveColumnRow
        : rowAtScrollTop(rowTops, rowHeights, model.height, sc.scrollTop);
    installColumnChrome(container, groupForRowIndex(groups, row).columnsID || '');
}

/* Row heights and the tops they add up to. Both paths measure the sheet the
 * same way, and the incremental one compares the result with what the drawn
 * sheet was built from. */
function rowMetrics(model) {
    var rowHeights = [];
    var rowTops = [];
    var acc = 0;
    for (var y = 0; y < model.height; y++) {
        rowTops[y] = acc;
        var rh = rowHeight(model, model.rows[y], y);
        rowHeights[y] = rh.px;
        acc += rh.px;
    }
    return { rowHeights: rowHeights, rowTops: rowTops, total: acc };
}

/* Everything outside a cell's own paint that the sheet's layout is built on:
 * row heights, column widths and sets, the row groups, merges, named areas and
 * drawings. A cell edit that leaves this untouched can be repainted in place;
 * anything else has to be drawn again from scratch. The key is deliberately
 * cheap to build and compared as a whole, so a change the editing layer failed
 * to call structural still falls back to a full render instead of a wrong
 * sheet. */
function layoutKey(model, groups, rowHeights) {
    var parts = [model.height, rowHeights.join(','), model.templateMode ? 1 : 0,
        (model.pictures || []).length];
    for (var i = 0; i < groups.length; i++) {
        var set = columnSetOf(model, groups[i].columnsID);
        parts.push(groups[i].start + ':' + groups[i].end + ':' + (groups[i].columnsID || '')
            + ':' + set.size + ':' + (set.widths || []).join(','));
    }
    var sets = model.columnSets || [];
    for (i = 0; i < sets.length; i++) parts.push('s' + (sets[i].id || '') + ':' + sets[i].size);
    parts.push(JSON.stringify(model.merges || []));
    parts.push(JSON.stringify(model.unmerges || []));
    parts.push(JSON.stringify(model.namedItems || []));
    parts.push(JSON.stringify(model.drawings || []));
    return parts.join('\u0001');
}

/* Rows the repaint has to cover for `rect` to come out right. A cell's paint
 * reads its neighbours: borders collapse against the row above and below, and
 * text with automatic placement spills sideways, so whole rows are redrawn and
 * one row on each side comes along. A row covered by a merge that starts above
 * the range pulls that origin row in too, because the merged cell is drawn by
 * the row that owns it. */
function repaintRows(model, group, spans, rect) {
    var start = Math.max(group.start, rect.r0 - 1);
    var end = Math.min(group.end - 1, rect.r1 + 1);
    if (end < start) return null;
    for (;;) {
        var ly = start - group.start;
        var covered = false;
        for (var c = 0; c < spans.covered[ly].length; c++) {
            if (spans.covered[ly][c]) { covered = true; break; }
        }
        if (!covered || start === group.start) break;
        start--;
    }
    return { start: start, end: end };
}

/* Redraws the rows `dirty` touches and leaves the rest of the sheet — its
 * scroll position, the selection painted on it and the focus inside it —
 * exactly as it was. Returns false when the change is not one this path can
 * make, and the caller then calls render(). */
function update(model, container, dirty) {
    if (!model || !container || !dirty || dirty.structural) return false;
    var prev = container._tpModel;
    if (!prev || !container._tpLayoutKey) return false;
    if (!(dirty.r1 >= dirty.r0) || !(dirty.c1 >= dirty.c0)) return false;
    if (model.height !== prev.height) return false;
    model._availableWidthPx = prev._availableWidthPx;
    var groups = groupsOf(model);
    var metrics = rowMetrics(model);
    if (layoutKey(model, groups, metrics.rowHeights) !== container._tpLayoutKey) return false;

    var starts = rowAreaStarts(model);
    var ctx = { onSelect: container._tpOnSelect, container: container };
    var jobs = [];
    var g, y;
    /* Nothing is replaced until every row the repaint needs has been found:
     * a half-updated sheet would be worse than a full redraw. */
    for (g = 0; g < groups.length; g++) {
        var group = groups[g];
        if (dirty.r1 < group.start || dirty.r0 >= group.end) continue;
        var set = columnSetOf(model, group.columnsID);
        var spans = buildSpans(model, group.start, group.end, group.columnsID);
        var band = repaintRows(model, group, spans, dirty);
        if (!band) continue;
        for (y = band.start; y <= band.end; y++) {
            var tr = container.querySelector('tr[data-row="' + y + '"]');
            if (!tr || !tr.parentNode) return false;
            jobs.push({ tr: tr, group: group, set: set, spans: spans, row: y });
        }
    }
    if (!jobs.length) return false;
    for (var i = 0; i < jobs.length; i++) {
        var job = jobs[i];
        var next = buildRow(model, job.group, job.set, job.spans, metrics.rowHeights,
            ctx, starts, job.row);
        job.tr.parentNode.replaceChild(next, job.tr);
    }
    container._tpModel = model;
    container._tpRowTops = metrics.rowTops;
    container._tpRowHeights = metrics.rowHeights;
    container._tpGroups = groups;
    syncChrome(container);
    return true;
}

function render(model, container, options) {
    options = options || {};
    container.innerHTML = '';
    container.className = 'tp-root';
    if (!model) {
        container.appendChild(el('div', 'tp-empty', 'Нет модели макета'));
        return;
    }
    var scroll = el('div', 'tp-scroll');
    var sheet = el('div', 'tp-sheet');

    /* Auto-width columns share the visible width; the row header and the
     * area rail on the left take roughly this much of it. */
    model._availableWidthPx = options.width || Math.max(0, (container.clientWidth || 0) - 80);
    var groups = groupsOf(model);
    var metrics = rowMetrics(model);
    var rowHeights = metrics.rowHeights;
    var rowTops = metrics.rowTops;
    var acc = metrics.total;
    var y;

    var left = el('div', 'tp-left');
    var corner = el('div', 'tp-corner');
    var leftBody = el('div', 'tp-left-body');
    var chrome0 = buildColumnChrome(model, groupForRowIndex(groups, 0).columnsID || '');
    var colChrome = el('div', 'tp-col-chrome');
    var colAreas = chrome0.colAreas;
    if (colAreas) colChrome.appendChild(colAreas);
    colChrome.appendChild(chrome0.colHead);
    corner.style.height = chrome0.chromeH + 'px';
    corner.style.flexBasis = chrome0.chromeH + 'px';
    var rail = renderAreaRail(model, rowHeights, rowTops, acc);
    var nums = renderRowHead(model, rowHeights);
    leftBody.appendChild(rail);
    leftBody.appendChild(nums);
    left.appendChild(corner);
    left.appendChild(leftBody);

    var right = el('div', 'tp-right');
    var gridWrap = el('div', 'tp-grid-wrap');
    var ctx = { onSelect: options.onSelect, container: container };
    for (var g = 0; g < groups.length; g++) {
        gridWrap.appendChild(renderGroupTable(model, groups[g], ctx, rowHeights));
    }
    var hi = el('div', 'tp-hi');
    hi.hidden = true;
    gridWrap.appendChild(hi);
    var rowLines = renderRowAreaLines(model, rowTops, rowHeights);
    if (rowLines) gridWrap.appendChild(rowLines);
    renderDrawings(model, gridWrap, rowTops, rowHeights);
    right.appendChild(colChrome);
    right.appendChild(gridWrap);

    sheet.appendChild(left);
    sheet.appendChild(right);
    scroll.appendChild(sheet);
    container.appendChild(scroll);
    container._tpOnSelect = options.onSelect;
    container._tpModel = model;
    container._tpRowTops = rowTops;
    container._tpRowHeights = rowHeights;
    container._tpGroups = groups;
    container._tpActiveColumnRow = null;
    container._tpActiveColumnsIDSet = false;
    container._tpActiveColumnsID = '';
    container._tpChromeColumnsID = groupForRowIndex(groups, 0).columnsID || '';
    /* What the drawn sheet was laid out from, so an incremental repaint can
     * tell whether the new document still lays out the same way. */
    container._tpLayoutKey = layoutKey(model, groups, rowHeights);
    syncChrome(container);
    /* render() may run before the container is laid out, and wrapped text or
     * late fonts change row heights afterwards: measure again once the grid
     * has its final size, so row numbers and drawings follow the real rows. */
    if (typeof ResizeObserver === 'function') {
        if (container._tpResize) container._tpResize.disconnect();
        container._tpResize = new ResizeObserver(function () { syncChrome(container); });
        container._tpResize.observe(gridWrap);
    } else if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(function () { syncChrome(container); });
    }

    if (options.onSelect) {
        function onAreaClick(ev) {
            var lab = ev.target.closest && (ev.target.closest('.tp-area-label') || ev.target.closest('.tp-col-area-label'));
            if (!lab) return;
            options.onSelect({ name: lab.getAttribute('data-id'), id: lab.getAttribute('data-id') });
        }
        container._tpOnAreaClick = onAreaClick;
        rail.addEventListener('click', onAreaClick);
        if (colAreas) colAreas.addEventListener('click', onAreaClick);
    }
    scroll.addEventListener('scroll', function () { updateColumnChrome(container); });
}

/* What a cell holds and how it ends up looking, for the editing layer: the
 * cell's own node, the format it inherits from the sheet, the column and the
 * row, and the text the grid shows. Rows and columns are 0-based here. */
function cellInfo(model, rowIndex, colIndex) {
    if (!model || !model.rows) return null;
    var row = model.rows[rowIndex];
    if (!row) return null;
    var cell = cellAt(row, colIndex);
    var format = effectiveFormat(model, row, cell, colIndex) || {};
    return {
        row: rowIndex,
        col: colIndex,
        cell: cell,
        format: format,
        font: fontOf(model, format),
        /* The four sides already resolved through the document's line table,
         * so a caller that shows or edits a border does not have to know how
         * the format points at it. A side with no line is null. */
        borders: {
            left: lineOf(model, format.leftBorder != null && format.leftBorder !== '' ? format.leftBorder : format.border),
            top: lineOf(model, format.topBorder != null && format.topBorder !== '' ? format.topBorder : format.border),
            right: lineOf(model, format.rightBorder != null && format.rightBorder !== '' ? format.rightBorder : format.border),
            bottom: lineOf(model, format.bottomBorder != null && format.bottomBorder !== '' ? format.bottomBorder : format.border)
        },
        fillType: (cell && cell.fillType) || format.fillType || 'Text',
        parameter: (cell && cell.parameter) || '',
        detail: (cell && cell.detailParameter) || '',
        text: displayText(cell, format)
    };
}

/* The size a row and a column carry in their own formats, in the units the
 * markup engine takes: a column width in 1C width units and a row height in
 * points, with null for "not set" — an automatic height or a default width.
 * The cell's merged format is no use here: width belongs to the column and
 * height to the row, so neither is inherited down to the cell. */
function cellSize(model, rowIndex, colIndex) {
    var row = model && model.rows ? model.rows[rowIndex] : null;
    var columnFmt = row ? columnFormatOf(model, row, colIndex) : null;
    var rowFmt = row ? formatByIndex(model.formats, row.formatIndex) : null;
    var width = columnFmt && columnFmt.width != null && columnFmt.width !== ''
        ? Number(columnFmt.width) : null;
    var quarters = rowFmt && rowFmt.height != null && rowFmt.height !== ''
        ? Number(rowFmt.height) : null;
    return {
        width: isFinite(width) && width > 0 ? width : null,
        /* The format keeps quarter-points; a negative value is a ceiling on an
         * otherwise automatic row, which counts as no fixed height. */
        height: quarters != null && isFinite(quarters) && quarters > 0 ? quarters / 4 : null,
        hidden: !!((columnFmt && columnFmt.hidden === 'true') || (rowFmt && rowFmt.hidden === 'true'))
    };
}

/* Column count of the widest column set, which is how far a selection may
 * reach to the right. */
function sheetWidth(model) {
    var sets = (model && model.columnSets) || [];
    var width = 0;
    for (var i = 0; i < sets.length; i++) width = Math.max(width, sets[i].size || 0);
    return width || (columnSetOf(model, '').size || 1);
}

root.TemplatePreview = {
    detect: detect,
    /* Re-measure rows and move row numbers, areas and drawings onto them. */
    sync: function (container) { if (container && container._tpModel) syncChrome(container); },
    parse: parse,
    render: render,
    update: update,
    outline: outline,
    outlineIcon: outlineIcon,
    highlight: highlight,
    clearHighlight: clearHighlight,
    /* The colour tables and the resolver, so the editing layer shows a named
     * colour exactly as the sheet paints it. */
    resolveColor: styleColor,
    /* The unit conversions the grid itself uses, for a host that wants to show
     * a size change before it is written. */
    withTrailingRows: withTrailingRows,
    documentRows: documentRows,
    withTrailingColumns: withTrailingColumns,
    documentColumns: documentColumns,
    widthToPx: widthToPx,
    heightToPx: heightToPx,
    webColours: WEB_COLOURS,
    winColours: WIN_COLOURS,
    styleColours: STYLE_COLOURS,
    itemKey: itemKey,
    cellInfo: cellInfo,
    cellSize: cellSize,
    sheetWidth: sheetWidth,
    activateColumnRow: activateColumnRow,
    activateColumnSet: activateColumnSet,
    _test: {
        unitToPx: widthToPx,
        widthToPx: widthToPx,
        heightToPx: heightToPx,
        WIDTH_PX: WIDTH_PX,
        HEIGHT_PX: HEIGHT_PX,
        DEFAULT_WIDTH_U: DEFAULT_WIDTH_U,
        DEFAULT_HEIGHT_U: DEFAULT_HEIGHT_U,
        displayText: displayText,
        isParamCell: isParamCell,
        widthOfFormat: widthOfFormat,
        heightOfFormat: heightOfFormat,
        formatByIndex: formatByIndex,
        columnSetOf: columnSetOf,
        cellAt: cellAt,
        groupsOf: groupsOf,
        viewColumnSet: viewColumnSet,
        areaForRow: areaForRow,
        columnAreaItems: columnAreaItems,
        columnAreaLevels: columnAreaLevels,
        colAreaBounds: colAreaBounds,
        placementOf: placementOf,
        effectiveFormat: effectiveFormat,
        borderCss: borderCss,
        sideBorder: sideBorder,
        alignCss: alignCss,
        defaultVAlign: defaultVAlign,
        patternFill: patternFill,
        blockFit: blockFit,
        textPadding: textPadding,
        acrossBox: acrossBox,
        columnWidthPx: columnWidthPx,
        distributeAutoWidths: distributeAutoWidths,
        fontLinePx: fontLinePx,
        rowHeight: rowHeight,
        spillBox: spillBox,
        isColumnArea: isColumnArea,
        eachRowArea: eachRowArea,
        buildSpans: buildSpans,
        spanBorders: spanBorders,
        collapseBorders: collapseBorders,
        colSpanWidth: colSpanWidth,
        parseRow: parseRow,
        parseMerge: parseMerge,
        parseNamedItem: parseNamedItem,
        localizedFrom: localizedFrom,
        centerInScroll: centerInScroll,
        outlineIcon: outlineIcon,
        pictureDataUrl: pictureDataUrl,
        layoutKey: layoutKey,
        rowMetrics: rowMetrics,
        repaintRows: repaintRows
    }
};

})(window);
