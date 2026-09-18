/* Excel workbook (.xlsx) → 1C spreadsheet template (Ext/Template.xml of a configuration dump).
 *
 * Runs unchanged in the preview page (headless Edge inside the MCP server and
 * the VS Code webview) and in Node 18+: ZIP entries are inflated with the
 * built-in DecompressionStream and the OOXML parts are read by a small XML
 * reader of our own, so neither a DOM nor a dependency is needed.
 *
 * Markup conventions an author can put into the workbook:
 * - a defined name becomes a named area (whole rows → Rows, whole columns →
 *   Columns, anything else → Rectangle);
 * - a cell whose whole text is `[Имя]` becomes a parameter cell;
 * - text with `[Имя]` inside becomes a template cell (fillType Template). */
(function (root) {
'use strict';

/* Designer's Template.xml starts with a byte order mark. */
var BOM = String.fromCharCode(0xFEFF);

/* Column widths count eighths of «X» of the standard font (Arial 8: 7 px), so
 * one unit is 7/8 px; heights count 1/288 inch, 4 per point. The platform's own
 * xlsx import takes an Excel character as 6 px, i.e. 48/7 units: measured on
 * workbooks opened in 1C and saved as MXL (10.5 → 72, 14.332 → 98, 25.832 → 177). */
var WIDTH_U_PER_CHAR = 48 / 7;
var HEIGHT_U_PER_PT = 4;

function excelWidthToUnits(chars) {
    return Math.max(0, Math.round(chars * WIDTH_U_PER_CHAR));
}
var DEFAULT_COL_CHARS = 8.43;
var DEFAULT_ROW_PT = 15;

/* ---------- ZIP ---------- */

function u16(b, o) { return b[o] | (b[o + 1] << 8); }
function u32(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0; }

function toBytes(input) {
    if (input instanceof Uint8Array) return input;
    if (input instanceof ArrayBuffer) return new Uint8Array(input);
    if (input && input.buffer instanceof ArrayBuffer) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    if (typeof input === 'string') {
        var bin = atob(input);
        var out = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        return out;
    }
    throw new Error('Ожидались байты xlsx (Uint8Array, ArrayBuffer или base64).');
}

function readZipDirectory(bytes) {
    var eocd = -1;
    for (var i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
        if (u32(bytes, i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('Файл не похож на xlsx: нет каталога ZIP.');
    var count = u16(bytes, eocd + 10);
    var p = u32(bytes, eocd + 16);
    var entries = {};
    var dec = new TextDecoder('utf-8');
    for (var n = 0; n < count; n++) {
        if (u32(bytes, p) !== 0x02014b50) throw new Error('Повреждённый каталог ZIP.');
        var method = u16(bytes, p + 10);
        var csize = u32(bytes, p + 20);
        var nameLen = u16(bytes, p + 28);
        var extraLen = u16(bytes, p + 30);
        var commentLen = u16(bytes, p + 32);
        var local = u32(bytes, p + 42);
        var name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
        entries[name.replace(/\\/g, '/')] = { method: method, csize: csize, local: local };
        p += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
}

function inflateRaw(data) {
    var ds = new DecompressionStream('deflate-raw');
    var stream = new Blob([data]).stream().pipeThrough(ds);
    return new Response(stream).arrayBuffer().then(function (buf) { return new Uint8Array(buf); });
}

function readEntry(bytes, entry) {
    var p = entry.local;
    var start = p + 30 + u16(bytes, p + 26) + u16(bytes, p + 28);
    var data = bytes.subarray(start, start + entry.csize);
    if (entry.method === 0) return Promise.resolve(data);
    if (entry.method === 8) return inflateRaw(data);
    return Promise.reject(new Error('Неподдерживаемое сжатие ZIP: ' + entry.method));
}

/* ---------- XML reader ---------- */

function decodeEntities(s) {
    if (s.indexOf('&') < 0) return s;
    return s.replace(/&(#x[0-9a-fA-F]+|#\d+|lt|gt|amp|quot|apos);/g, function (m, e) {
        if (e === 'lt') return '<';
        if (e === 'gt') return '>';
        if (e === 'amp') return '&';
        if (e === 'quot') return '"';
        if (e === 'apos') return "'";
        var code = e.charAt(1) === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return String.fromCodePoint(code);
    });
}

/* Element: { name (no prefix), attrs, kids, text }. */
function parseXml(xml) {
    var rootEl = { name: '#root', attrs: {}, kids: [], text: '' };
    var stack = [rootEl];
    var re = /<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[^\s=\/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|<!\[CDATA\[([\s\S]*?)\]\]>|<[?!][\s\S]*?>|([^<]+)/g;
    var m;
    while ((m = re.exec(xml))) {
        var top = stack[stack.length - 1];
        if (m[6] != null) { top.text += decodeEntities(m[6]); continue; }
        if (m[5] != null) { top.text += m[5]; continue; }
        if (!m[2]) continue;
        var name = m[2].slice(m[2].indexOf(':') + 1);
        if (m[1]) {
            if (stack.length > 1) stack.pop();
            continue;
        }
        var attrs = {};
        var ar = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
        var a;
        while ((a = ar.exec(m[3]))) {
            var an = a[1].slice(a[1].indexOf(':') + 1);
            attrs[an] = decodeEntities(a[2] != null ? a[2] : a[3]);
        }
        var el = { name: name, attrs: attrs, kids: [], text: '' };
        top.kids.push(el);
        if (!m[4]) stack.push(el);
    }
    return rootEl.kids[0] || rootEl;
}

function kid(el, name) {
    if (!el) return null;
    for (var i = 0; i < el.kids.length; i++) if (el.kids[i].name === name) return el.kids[i];
    return null;
}
function kids(el, name) {
    return el ? el.kids.filter(function (k) { return k.name === name; }) : [];
}
/* Text of a string item (<si>, <is>): only <t> elements count — whitespace
 * between elements is pretty-printing, and phonetic runs (<rPh>) are hints. */
function deepText(el) {
    if (!el) return '';
    if (el.name === 't') return el.text;
    var s = '';
    for (var i = 0; i < el.kids.length; i++) {
        if (el.kids[i].name === 'rPh') continue;
        s += deepText(el.kids[i]);
    }
    return s;
}
function boolAttr(el, name, dflt) {
    if (!el) return dflt;
    var v = el.attrs[name];
    if (v == null) return true;
    return v === '1' || v === 'true';
}

/* ---------- cell references ---------- */

function colIndex(letters) {
    var n = 0;
    for (var i = 0; i < letters.length; i++) n = n * 26 + (letters.charCodeAt(i) - 64);
    return n - 1;
}
function parseRef(ref) {
    var m = /^\$?([A-Z]+)\$?(\d+)$/.exec(ref);
    return m ? { c: colIndex(m[1]), r: parseInt(m[2], 10) - 1 } : null;
}

/* A defined name's range: "'Лист 1'!$A$1:$C$4", "Лист_1!$3:$5", "Лист_1!$B:$D". */
function parseDefinedRange(text) {
    var t = String(text || '').trim();
    var bang = t.lastIndexOf('!');
    var sheet = bang >= 0 ? t.slice(0, bang).replace(/^'|'$/g, '').replace(/''/g, "'") : '';
    var range = bang >= 0 ? t.slice(bang + 1) : t;
    if (range.indexOf(',') >= 0 || /#REF/.test(range)) return null;
    var parts = range.replace(/\$/g, '').split(':');
    var a = parts[0], b = parts[1] || parts[0];
    if (/^\d+$/.test(a) && /^\d+$/.test(b)) {
        return { sheet: sheet, type: 'Rows', beginRow: +a - 1, endRow: +b - 1, beginColumn: -1, endColumn: -1 };
    }
    if (/^[A-Z]+$/.test(a) && /^[A-Z]+$/.test(b)) {
        return { sheet: sheet, type: 'Columns', beginRow: -1, endRow: -1, beginColumn: colIndex(a), endColumn: colIndex(b) };
    }
    var p = parseRef(a), q = parseRef(b);
    if (!p || !q) return null;
    return {
        sheet: sheet, type: 'Rectangle',
        beginRow: Math.min(p.r, q.r), endRow: Math.max(p.r, q.r),
        beginColumn: Math.min(p.c, q.c), endColumn: Math.max(p.c, q.c)
    };
}

/* ---------- styles ---------- */

var THEME_DEFAULT = ['FFFFFF', '000000', 'EEECE1', '1F497D', '4F81BD', 'C0504D', '9BBB59', '8064A2', '4BACC6', 'F79646', '0000FF', '800080'];
var INDEXED = ['000000', 'FFFFFF', 'FF0000', '00FF00', '0000FF', 'FFFF00', 'FF00FF', '00FFFF',
    '000000', 'FFFFFF', 'FF0000', '00FF00', '0000FF', 'FFFF00', 'FF00FF', '00FFFF',
    '800000', '008000', '000080', '808000', '800080', '008080', 'C0C0C0', '808080',
    '9999FF', '993366', 'FFFFCC', 'CCFFFF', '660066', 'FF8080', '0066CC', 'CCCCFF',
    '000080', 'FF00FF', 'FFFF00', '00FFFF', '800080', '800000', '008080', '0000FF',
    '00CCFF', 'CCFFFF', 'CCFFCC', 'FFFF99', '99CCFF', 'FF99CC', 'CC99FF', 'FFCC99',
    '3366FF', '33CCCC', '99CC00', 'FFCC00', 'FF9900', 'FF6600', '666699', '969696',
    '003366', '339966', '003300', '333300', '993300', '993366', '333399', '333333'];

function applyTint(hex, tint) {
    if (!tint) return hex;
    var out = '';
    for (var i = 0; i < 3; i++) {
        var v = parseInt(hex.substr(i * 2, 2), 16);
        v = tint < 0 ? v * (1 + tint) : v + (255 - v) * tint;
        var s = Math.round(Math.max(0, Math.min(255, v))).toString(16).toUpperCase();
        out += s.length < 2 ? '0' + s : s;
    }
    return out;
}

/* OOXML color element → "#RRGGBB" or '' (auto/unknown). */
function colorOf(el, theme) {
    if (!el || el.attrs.auto === '1' || el.attrs.auto === 'true') return '';
    var hex = '';
    if (el.attrs.rgb) hex = el.attrs.rgb.replace(/^#/, '').slice(-6).toUpperCase();
    else if (el.attrs.theme != null) hex = theme[+el.attrs.theme] || '';
    else if (el.attrs.indexed != null) hex = INDEXED[+el.attrs.indexed] || '';
    if (!/^[0-9A-F]{6}$/.test(hex)) return '';
    return '#' + applyTint(hex, parseFloat(el.attrs.tint || '0'));
}

function readTheme(xml) {
    var theme = THEME_DEFAULT.slice();
    if (!xml) return theme;
    var scheme = null;
    (function find(el) {
        if (scheme || !el) return;
        if (el.name === 'clrScheme') { scheme = el; return; }
        el.kids.forEach(find);
    })(parseXml(xml));
    if (!scheme) return theme;
    var order = ['lt1', 'dk1', 'lt2', 'dk2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink'];
    order.forEach(function (n, i) {
        var e = kid(scheme, n);
        var c = e && (kid(e, 'srgbClr') || kid(e, 'sysClr'));
        var v = c && (c.attrs.val === 'windowText' ? '000000' : c.attrs.val === 'window' ? 'FFFFFF' : (c.attrs.lastClr || c.attrs.val));
        if (v && /^[0-9A-Fa-f]{6}$/.test(v)) theme[i] = v.toUpperCase();
    });
    return theme;
}

var BUILTIN_DATE_FORMATS = { 14: 1, 15: 1, 16: 1, 17: 1, 18: 2, 19: 2, 20: 2, 21: 2, 22: 1, 45: 2, 46: 2, 47: 2 };

function readStyles(xml, theme) {
    var st = { fonts: [], fills: [], borders: [], xfs: [], numFmts: {} };
    if (!xml) return st;
    var doc = parseXml(xml);
    kids(kid(doc, 'numFmts'), 'numFmt').forEach(function (n) { st.numFmts[n.attrs.numFmtId] = n.attrs.formatCode || ''; });
    st.fonts = kids(kid(doc, 'fonts'), 'font').map(function (f) {
        var u = kid(f, 'u');
        return {
            name: (kid(f, 'name') || kid(f, 'rFont') || { attrs: {} }).attrs.val || '',
            size: parseFloat((kid(f, 'sz') || { attrs: {} }).attrs.val || '') || 0,
            bold: boolAttr(kid(f, 'b'), 'val', false),
            italic: boolAttr(kid(f, 'i'), 'val', false),
            underline: !!u && u.attrs.val !== 'none',
            strike: boolAttr(kid(f, 'strike'), 'val', false),
            color: colorOf(kid(f, 'color'), theme)
        };
    });
    st.fills = kids(kid(doc, 'fills'), 'fill').map(function (f) {
        var p = kid(f, 'patternFill');
        if (p && p.attrs.patternType === 'solid') return colorOf(kid(p, 'fgColor'), theme) || colorOf(kid(p, 'bgColor'), theme);
        return '';
    });
    st.borders = kids(kid(doc, 'borders'), 'border').map(function (b) {
        var out = {};
        ['left', 'right', 'top', 'bottom'].forEach(function (side) {
            var e = kid(b, side);
            if (e && e.attrs.style && e.attrs.style !== 'none') {
                out[side] = { style: e.attrs.style, color: colorOf(kid(e, 'color'), theme) };
            }
        });
        return out;
    });
    st.xfs = kids(kid(doc, 'cellXfs'), 'xf').map(function (x) {
        var al = kid(x, 'alignment');
        return {
            font: +(x.attrs.fontId || 0),
            fill: +(x.attrs.fillId || 0),
            border: +(x.attrs.borderId || 0),
            numFmt: +(x.attrs.numFmtId || 0),
            h: al ? al.attrs.horizontal || '' : '',
            v: al ? al.attrs.vertical || '' : '',
            wrap: al ? al.attrs.wrapText === '1' || al.attrs.wrapText === 'true' : false,
            indent: al ? +(al.attrs.indent || 0) : 0,
            rotation: al ? +(al.attrs.textRotation || 0) : 0
        };
    });
    return st;
}

function isDateFormat(st, id) {
    if (BUILTIN_DATE_FORMATS[id]) return true;
    var code = st.numFmts[id];
    if (!code) return false;
    code = code.replace(/"[^"]*"|\[[^\]]*\]|\\./g, '');
    return /[dmyhs]/i.test(code) && !/[#0]/.test(code.replace(/[dmyhs]/gi, ''));
}

/* Excel number format → 1C format string (ЧДЦ/ЧГ for numbers, ДФ for dates).
 * Only the common shapes: decimals, grouping and date/time patterns; percent,
 * currency and conditional sections are left to the author. */
var BUILTIN_CODES = { 1: '0', 2: '0.00', 3: '#,##0', 4: '#,##0.00', 14: 'dd.mm.yyyy', 15: 'd-mmm-yy', 20: 'h:mm', 21: 'h:mm:ss', 22: 'dd.mm.yyyy h:mm' };

function oneCFormat(st, id) {
    var code = st.numFmts[id] != null ? st.numFmts[id] : BUILTIN_CODES[id];
    if (!code || /^general$|^@$/i.test(code)) return '';
    code = code.split(';')[0].replace(/"[^"]*"|\[[^\]]*\]|\\.|_.|\*./g, '');
    if (isDateFormat(st, id) || BUILTIN_CODES[id] && /[dy]|h:/.test(BUILTIN_CODES[id])) {
        var hasTime = /h/i.test(code);
        var out = code.replace(/(y+|m+|d+|h+|s+)/gi, function (token, m, offset, whole) {
            var t = token.toLowerCase();
            if (t.charAt(0) === 'y') return t.length > 2 ? 'yyyy' : 'yy';
            if (t.charAt(0) === 'd') return t.length > 2 ? (t.length > 3 ? 'dddd' : 'ddd') : t;
            if (t.charAt(0) === 'h') return t.length > 1 ? 'HH' : 'H';
            if (t.charAt(0) === 's') return t;
            /* m is minutes right after hours or before seconds, months otherwise. */
            var before = whole.slice(0, offset).replace(/[^a-z]/gi, '').slice(-1).toLowerCase();
            var after = whole.slice(offset + token.length).replace(/[^a-z]/gi, '').charAt(0).toLowerCase();
            if (hasTime && (before === 'h' || after === 's')) return t.length > 1 ? 'mm' : 'm';
            return t.length > 2 ? (t.length > 3 ? 'MMMM' : 'MMM') : t.toUpperCase();
        }).trim();
        if (!out) return '';
        return /\s/.test(out) ? "ДФ='" + out + "'" : 'ДФ=' + out;
    }
    if (/%/.test(code) || !/[0#]/.test(code)) return '';
    var decimals = (code.split('.')[1] || '').replace(/[^0#]/g, '').length;
    var parts = ['ЧДЦ=' + decimals];
    if (code.indexOf(',') < 0) parts.push('ЧГ=0');
    return parts.join('; ');
}

/* A cached number as the sheet shows it: the stored double (134933.32999999999)
 * rounded to its format's decimals, grouped when the format groups, in Russian
 * notation; General keeps up to 10 decimals like Excel's cell display. */
var NBSP = String.fromCharCode(160);

function displayNumber(num, st, id) {
    var code = st.numFmts[id] != null ? st.numFmts[id] : BUILTIN_CODES[id];
    var main = code ? String(code).split(';')[0].replace(/"[^"]*"|\[[^\]]*\]|\\.|_.|\*./g, '') : '';
    var percent = main.indexOf('%') >= 0;
    var value = percent ? num * 100 : num;
    var text;
    if (!main || /^general$/i.test(main) || !/[0#]/.test(main)) {
        text = String(Number(value.toPrecision(15)));
        if (/e/i.test(text)) return text;
        var dot = text.indexOf('.');
        if (dot >= 0 && text.length - dot - 1 > 10) text = String(Number(value.toFixed(10)));
        return text.replace('.', ',');
    }
    var decimals = (main.split('.')[1] || '').replace(/[^0#]/g, '').length;
    text = Math.abs(value).toFixed(decimals);
    var parts = text.split('.');
    if (main.indexOf(',') >= 0) parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
    text = parts.join(',');
    return (value < 0 && Number(text.split(NBSP).join('').replace(',', '.')) !== 0 ? '-' : '') + text + (percent ? '%' : '');
}

function serialToDate(serial, withTime) {
    var ms = Math.round((serial - 25569) * 86400000);
    var d = new Date(ms);
    function p(n) { return n < 10 ? '0' + n : '' + n; }
    var s = p(d.getUTCDate()) + '.' + p(d.getUTCMonth() + 1) + '.' + d.getUTCFullYear();
    if (withTime || serial % 1) s += ' ' + p(d.getUTCHours()) + ':' + p(d.getUTCMinutes()) + ':' + p(d.getUTCSeconds());
    return s;
}

/* ---------- workbook ---------- */

function resolvePath(base, target) {
    if (target.charAt(0) === '/') return target.slice(1);
    var parts = base.split('/');
    parts.pop();
    target.split('/').forEach(function (s) {
        if (s === '..') parts.pop();
        else if (s !== '.') parts.push(s);
    });
    return parts.join('/');
}

function readRels(xml, basePath) {
    var map = {};
    if (!xml) return map;
    kids(parseXml(xml), 'Relationship').forEach(function (r) {
        map[r.attrs.Id] = { target: r.attrs.TargetMode === 'External' ? r.attrs.Target : resolvePath(basePath, r.attrs.Target), type: r.attrs.Type || '' };
    });
    return map;
}

function openWorkbook(input) {
    var bytes = toBytes(input);
    var dir = readZipDirectory(bytes);
    var dec = new TextDecoder('utf-8');
    function text(name) {
        var e = dir[name];
        if (!e) return Promise.resolve('');
        return readEntry(bytes, e).then(function (b) { return dec.decode(b); });
    }
    return Promise.all([text('xl/workbook.xml'), text('xl/_rels/workbook.xml.rels')]).then(function (res) {
        if (!res[0]) throw new Error('В архиве нет xl/workbook.xml — это не книга Excel.');
        var wb = parseXml(res[0]);
        var rels = readRels(res[1], 'xl/workbook.xml');
        var sheets = kids(kid(wb, 'sheets'), 'sheet').map(function (s) {
            var rel = rels[s.attrs.id];
            return { name: s.attrs.name, state: s.attrs.state || 'visible', path: rel ? rel.target : '' };
        });
        var names = kids(kid(wb, 'definedNames'), 'definedName').map(function (d) {
            return { name: d.attrs.name, localSheetId: d.attrs.localSheetId, hidden: d.attrs.hidden === '1', ref: d.text.trim() };
        });
        var themeRel = Object.keys(rels).map(function (k) { return rels[k]; }).filter(function (r) { return /\/theme$/.test(r.type); })[0];
        var stylesRel = Object.keys(rels).map(function (k) { return rels[k]; }).filter(function (r) { return /\/styles$/.test(r.type); })[0];
        var sstRel = Object.keys(rels).map(function (k) { return rels[k]; }).filter(function (r) { return /\/sharedStrings$/.test(r.type); })[0];
        return { bytes: bytes, dir: dir, text: text, sheets: sheets, names: names,
            themePath: themeRel ? themeRel.target : 'xl/theme/theme1.xml',
            stylesPath: stylesRel ? stylesRel.target : 'xl/styles.xml',
            sstPath: sstRel ? sstRel.target : 'xl/sharedStrings.xml' };
    });
}

/* ---------- sheet → model ---------- */

function readSheet(book, sheetIndex, warnings) {
    var sheet = book.sheets[sheetIndex];
    var relPath = sheet.path.replace(/([^/]+)$/, '_rels/$1.rels');
    return Promise.all([book.text(sheet.path), book.text(book.stylesPath), book.text(book.sstPath),
        book.text(book.themePath), book.text(relPath)]).then(function (res) {
        if (!res[0]) throw new Error('Не найден лист «' + sheet.name + '» (' + sheet.path + ').');
        var theme = readTheme(res[3]);
        var st = readStyles(res[1], theme);
        var sst = kids(res[2] ? parseXml(res[2]) : null, 'si').map(function (si) {
            var runs = kids(si, 'r');
            if (runs.length > 1) {
                var fonts = runs.map(function (r) { return JSON.stringify(kid(r, 'rPr') || {}); });
                if (fonts.some(function (f) { return f !== fonts[0]; })) warnings.richText = true;
            }
            return deepText(si);
        });
        var ws = parseXml(res[0]);
        var sheetRels = readRels(res[4], sheet.path);

        var fmtPr = kid(ws, 'sheetFormatPr');
        var defColChars = fmtPr && fmtPr.attrs.defaultColWidth ? parseFloat(fmtPr.attrs.defaultColWidth)
            : fmtPr && fmtPr.attrs.baseColWidth ? parseFloat(fmtPr.attrs.baseColWidth) + 0.71 : DEFAULT_COL_CHARS;
        var defRowPt = fmtPr && fmtPr.attrs.defaultRowHeight ? parseFloat(fmtPr.attrs.defaultRowHeight) : DEFAULT_ROW_PT;

        var cols = [];
        kids(kid(ws, 'cols'), 'col').forEach(function (c) {
            for (var i = +c.attrs.min - 1; i <= +c.attrs.max - 1 && i < 16384; i++) {
                cols[i] = {
                    width: c.attrs.width != null ? parseFloat(c.attrs.width) : defColChars,
                    hidden: c.attrs.hidden === '1' || c.attrs.hidden === 'true',
                    style: c.attrs.style != null ? +c.attrs.style : -1
                };
            }
        });

        var rows = [];
        var maxCol = -1, maxRow = -1;
        var formulas = 0;
        var nextRow = 0;
        kids(kid(ws, 'sheetData'), 'row').forEach(function (r) {
            var ri = r.attrs.r ? +r.attrs.r - 1 : nextRow;
            nextRow = ri + 1;
            var row = {
                index: ri,
                /* Excel stores the laid-out height even without customHeight; keep it fixed. */
                height: r.attrs.ht != null ? parseFloat(r.attrs.ht) : null,
                hidden: r.attrs.hidden === '1' || r.attrs.hidden === 'true',
                style: r.attrs.customFormat === '1' || r.attrs.customFormat === 'true' ? +(r.attrs.s || 0) : -1,
                cells: []
            };
            var nextCol = 0;
            kids(r, 'c').forEach(function (c) {
                var ref = c.attrs.r ? parseRef(c.attrs.r) : { c: nextCol, r: ri };
                nextCol = ref.c + 1;
                var s = +(c.attrs.s || 0);
                var t = c.attrs.t || 'n';
                var v = kid(c, 'v');
                var value = '';
                if (kid(c, 'f')) formulas++;
                if (t === 's' && v) value = sst[+v.text] != null ? sst[+v.text] : '';
                else if (t === 'inlineStr') value = deepText(kid(c, 'is'));
                else if (t === 'str' && v) value = v.text;
                else if (t === 'b' && v) value = v.text === '1' ? 'Истина' : 'Ложь';
                else if (t === 'e') value = '';
                else if (v && v.text !== '') {
                    var num = parseFloat(v.text);
                    var xf = st.xfs[s];
                    value = xf && isDateFormat(st, xf.numFmt) && !isNaN(num) ? serialToDate(num, BUILTIN_DATE_FORMATS[xf.numFmt] === 2)
                        : isNaN(num) ? v.text : displayNumber(num, st, xf ? xf.numFmt : 0);
                }
                row.cells.push({ col: ref.c, style: s, text: value });
                if (ref.c > maxCol) maxCol = ref.c;
            });
            if (row.cells.length || row.height != null || row.style >= 0) {
                rows.push(row);
                if (ri > maxRow) maxRow = ri;
            }
        });
        if (formulas) warnings.formulas = formulas;
        /* <col> ranges often run to column XFD for a sheet-wide style; they size
         * columns that hold something but never widen the document. */

        var merges = kids(kid(ws, 'mergeCells'), 'mergeCell').map(function (m) {
            var parts = String(m.attrs.ref || '').split(':');
            var a = parseRef(parts[0]), b = parseRef(parts[1] || parts[0]);
            if (!a || !b) return null;
            if (Math.max(a.c, b.c) > maxCol) maxCol = Math.max(a.c, b.c);
            if (Math.max(a.r, b.r) > maxRow) maxRow = Math.max(a.r, b.r);
            return { r: Math.min(a.r, b.r), c: Math.min(a.c, b.c), h: Math.abs(b.r - a.r), w: Math.abs(b.c - a.c) };
        }).filter(Boolean);

        if (kid(ws, 'conditionalFormatting')) warnings.conditionalFormatting = true;
        if (kid(ws, 'dataValidations')) warnings.dataValidations = true;
        var drawingEl = kid(ws, 'drawing');
        var drawingPath = drawingEl && sheetRels[drawingEl.attrs.id] ? sheetRels[drawingEl.attrs.id].target : '';

        var areas = [];
        var printArea = null;
        book.names.forEach(function (n) {
            if (n.name.indexOf('_xlnm.') === 0) {
                if (n.localSheetId != null && +n.localSheetId !== sheetIndex) return;
                if (n.name === '_xlnm.Print_Area') {
                    var pa = parseDefinedRange(n.ref);
                    if (pa && (!pa.sheet || pa.sheet === sheet.name)) printArea = pa;
                } else if (n.name === '_xlnm.Print_Titles') {
                    warnings.printTitles = true;
                }
                return;
            }
            if (n.hidden || /^_xlnm\./.test(n.name)) return;
            if (n.localSheetId != null && +n.localSheetId !== sheetIndex) return;
            var range = parseDefinedRange(n.ref);
            if (!range) { (warnings.skippedNames = warnings.skippedNames || []).push(n.name); return; }
            if (range.sheet && range.sheet !== sheet.name) return;
            areas.push({ name: n.name, type: range.type, beginRow: range.beginRow, endRow: range.endRow,
                beginColumn: range.beginColumn, endColumn: range.endColumn });
        });

        var pageSetup = kid(ws, 'pageSetup');
        var hf = kid(ws, 'headerFooter');
        /* Excel keeps margins in inches; 1C in hundredths of a millimetre. */
        var print = null;
        var margins = kid(ws, 'pageMargins');
        var fitEl = kid(kid(ws, 'sheetPr'), 'pageSetUpPr');
        if (pageSetup || margins) {
            print = {};
            var ps = pageSetup ? pageSetup.attrs : {};
            print.pageOrientation = ps.orientation === 'landscape' ? 'Landscape' : 'Portrait';
            if (ps.scale && +ps.scale >= 10 && +ps.scale <= 400) print.scale = +ps.scale;
            if (margins) {
                var hundredths = function (v) { return Math.round(parseFloat(v || '0') * 2540); };
                print.topMargin = hundredths(margins.attrs.top);
                print.leftMargin = hundredths(margins.attrs.left);
                print.bottomMargin = hundredths(margins.attrs.bottom);
                print.rightMargin = hundredths(margins.attrs.right);
                if (margins.attrs.header != null) print.headerSize = hundredths(margins.attrs.header);
                if (margins.attrs.footer != null) print.footerSize = hundredths(margins.attrs.footer);
            }
            print.fitToPage = fitEl && (fitEl.attrs.fitToPage === '1' || fitEl.attrs.fitToPage === 'true') ? 'true' : 'false';
            if (ps.blackAndWhite === '1' || ps.blackAndWhite === 'true') print.blackAndWhite = 'true';
            if (ps.paperSize && +ps.paperSize > 0) print.paper = +ps.paperSize;
        }
        var model = {
            sheetName: sheet.name,
            styles: st,
            defColChars: defColChars,
            defRowPt: defRowPt,
            cols: cols,
            rows: rows,
            merges: merges,
            areas: areas,
            width: maxCol + 1,
            height: maxRow + 1,
            print: print,
            printArea: printArea,
            header: parseHeaderFooter(hf && kid(hf, 'oddHeader') ? kid(hf, 'oddHeader').text : ''),
            footer: parseHeaderFooter(hf && kid(hf, 'oddFooter') ? kid(hf, 'oddFooter').text : ''),
            pictures: []
        };
        if (!drawingPath) return model;
        return readPictures(book, drawingPath, warnings).then(function (pictures) {
            model.pictures = pictures;
            pictures.forEach(function (p) {
                if (p.toRow + 1 > model.height) model.height = p.toRow + 1;
                if (p.toCol + 1 > model.width) model.width = p.toCol + 1;
            });
            return model;
        });
    });
}

/* Pictures anchored to cells in xl/drawings/drawingN.xml. Offsets come in EMU
 * (914400 per inch); 1C counts 1/288 inch, so one unit is 3175 EMU. Shapes,
 * charts and absolutely placed pictures are reported, not converted. */
var EMU_PER_UNIT = 3175;

function bytesToBase64(bytes) {
    var chunks = [];
    for (var i = 0; i < bytes.length; i += 0x8000) {
        chunks.push(String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)));
    }
    return btoa(chunks.join(''));
}

function readPictures(book, drawingPath, warnings) {
    var relPath = drawingPath.replace(/([^/]+)$/, '_rels/$1.rels');
    return Promise.all([book.text(drawingPath), book.text(relPath)]).then(function (res) {
        if (!res[0]) return [];
        var rels = readRels(res[1], drawingPath);
        var root = parseXml(res[0]);
        var jobs = [];
        var skipped = 0;
        root.kids.forEach(function (anchor) {
            if (anchor.name !== 'twoCellAnchor' && anchor.name !== 'oneCellAnchor') {
                if (anchor.name === 'absoluteAnchor') skipped++;
                return;
            }
            var pic = kid(anchor, 'pic');
            if (!pic) { skipped++; return; }
            var blip = kid(kid(pic, 'blipFill'), 'blip');
            var rel = blip && rels[blip.attrs.embed];
            var entry = rel && book.dir[rel.target];
            if (!entry) { skipped++; return; }
            var from = kid(anchor, 'from');
            var at = function (el, name) { return parseInt(kid(el, name) ? kid(el, name).text : '0', 10) || 0; };
            var p = {
                fromCol: at(from, 'col'), fromColOff: Math.round(at(from, 'colOff') / EMU_PER_UNIT),
                fromRow: at(from, 'row'), fromRowOff: Math.round(at(from, 'rowOff') / EMU_PER_UNIT)
            };
            var to = kid(anchor, 'to');
            if (to) {
                p.toCol = at(to, 'col'); p.toColOff = Math.round(at(to, 'colOff') / EMU_PER_UNIT);
                p.toRow = at(to, 'row'); p.toRowOff = Math.round(at(to, 'rowOff') / EMU_PER_UNIT);
            } else {
                /* One-cell anchor: the extent decides the far corner; keep it within the start cell's offsets. */
                var ext = kid(anchor, 'ext');
                p.toCol = p.fromCol; p.toRow = p.fromRow;
                p.toColOff = p.fromColOff + Math.round((ext ? parseInt(ext.attrs.cx, 10) || 0 : 0) / EMU_PER_UNIT);
                p.toRowOff = p.fromRowOff + Math.round((ext ? parseInt(ext.attrs.cy, 10) || 0 : 0) / EMU_PER_UNIT);
            }
            var nv = kid(kid(pic, 'nvPicPr'), 'cNvPr');
            p.name = nv ? nv.attrs.name || '' : '';
            /* Locked aspect or a padded source rectangle: Excel fits the image into the box. */
            var locks = kid(kid(kid(pic, 'nvPicPr'), 'cNvPicPr'), 'picLocks');
            var src = kid(kid(pic, 'blipFill'), 'srcRect');
            var padded = src && ['l', 't', 'r', 'b'].some(function (k) { return parseInt(src.attrs[k] || '0', 10) < 0; });
            p.size = padded || (locks && locks.attrs.noChangeAspect === '1') ? 'Proportionally' : 'Stretch';
            jobs.push(readEntry(book.bytes, entry).then(function (data) {
                p.data = bytesToBase64(data);
                return p;
            }));
        });
        if (skipped) warnings.drawingsSkipped = skipped;
        return Promise.all(jobs);
    });
}

/* Excel header/footer codes → { left, center, right: { text, font } }.
 * &L &C &R switch sections, &"Face,Style" and &NN set the font, &P/&N/&D/&T
 * are page number, page count, date and time — 1C spells them [&Имя]. */
function parseHeaderFooter(code) {
    var out = {};
    if (!code) return out;
    var section = 'center';
    var re = /&([LCR])|&"([^"]*)"|&(\d+)|&([PNDTFAZG])|&([BIUSEXY])|&&|([^&]+)|&/g;
    var m;
    function cur() {
        return out[section] || (out[section] = { text: '', face: '', size: 0, bold: false, italic: false });
    }
    while ((m = re.exec(code))) {
        if (m[1]) section = { L: 'left', C: 'center', R: 'right' }[m[1]];
        else if (m[2] != null) {
            var parts = m[2].split(',');
            var sec = cur();
            if (!sec.face && parts[0] && parts[0] !== '-') sec.face = parts[0];
            var style = (parts[1] || '').toLowerCase();
            if (!sec.text) {
                sec.bold = /bold|полужирный/.test(style);
                sec.italic = /italic|курсив/.test(style);
            }
        } else if (m[3]) {
            if (!cur().size) cur().size = +m[3];
        } else if (m[4]) {
            cur().text += { P: '[&НомерСтраницы]', N: '[&СтраницВсего]', D: '[&Дата]', T: '[&Время]' }[m[4]] || '';
        } else if (m[0] === '&&') cur().text += '&';
        else if (m[6] != null) cur().text += m[6];
    }
    Object.keys(out).forEach(function (k) {
        out[k].text = out[k].text.replace(/\r\n/g, '\n');
        if (!out[k].text.trim()) delete out[k];
    });
    return out;
}

/* ---------- model → Template.xml ---------- */

function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

var LINE_OF = {
    thin: [1, 'Solid'], medium: [2, 'Solid'], thick: [3, 'Solid'], double: [3, 'Double'],
    hair: [1, 'Dotted'], dotted: [1, 'Dotted'],
    dashed: [1, 'Dashed'], dashDot: [1, 'DashDotted'], dashDotDot: [1, 'DashDottedDotted'],
    mediumDashed: [2, 'Dashed'], mediumDashDot: [2, 'DashDotted'], mediumDashDotDot: [2, 'DashDottedDotted'],
    slantDashDot: [2, 'DashDotted']
};

var H_ALIGN = { left: 'Left', center: 'Center', centerContinuous: 'Center', right: 'Right', justify: 'Justify', distributed: 'Justify', fill: 'Left' };
var V_ALIGN = { top: 'Top', center: 'Center', bottom: 'Bottom', justify: 'Center', distributed: 'Center' };

var PARAM_ONLY = /^\s*\[([^\[\]]+)\]\s*$/;
var PARAM_INSIDE = /\[[^\[\]]+\]/;

function Pool() {
    this.keys = {};
    this.items = [];
}
Pool.prototype.add = function (key, item) {
    if (this.keys[key] == null) {
        this.keys[key] = this.items.length;
        this.items.push(item);
    }
    return this.keys[key];
};

function buildTemplate(sheet, options) {
    options = options || {};
    var lang = options.language || 'ru';
    var st = sheet.styles;
    var fonts = new Pool();
    var lines = new Pool();
    var formats = new Pool();
    var stats = { parameters: [], templates: 0 };

    function fontIndex(f) {
        var face = (f && f.name) || 'Arial';
        var size = (f && f.size) || 10;
        var font = { faceName: face, height: size, bold: !!(f && f.bold), italic: !!(f && f.italic),
            underline: !!(f && f.underline), strikeout: !!(f && f.strike) };
        return fonts.add(JSON.stringify(font), font);
    }
    function lineIndex(b) {
        var spec = LINE_OF[b.style] || [1, 'Solid'];
        return lines.add(spec.join(':'), { width: spec[0], style: spec[1] });
    }
    /* Format object → 1-based format index; keys in the platform's element order. */
    function formatIndex(fmt) {
        var key = JSON.stringify(fmt);
        return formats.add(key, fmt) + 1;
    }

    /* layer: a column or row format, which must not pin Excel's implicit bottom
     * alignment over what the cells inherit from the other axis. */
    function cellFormat(styleIndex, fillType, edges, layer) {
        var xf = st.xfs[styleIndex] || st.xfs[0] || { font: 0, fill: 0, border: 0, h: '', v: '', wrap: false, indent: 0, rotation: 0 };
        var f = st.fonts[xf.font];
        var fmt = {};
        fmt.font = fontIndex(f);
        var b = st.borders[xf.border] || {};
        if (edges) {
            b = { left: b.left, top: b.top, right: edges.right, bottom: edges.bottom };
        }
        var borderColor = '';
        [['left', 'leftBorder'], ['top', 'topBorder'], ['right', 'rightBorder'], ['bottom', 'bottomBorder']].forEach(function (p) {
            if (b[p[0]]) {
                fmt[p[1]] = lineIndex(b[p[0]]);
                if (!borderColor && b[p[0]].color && b[p[0]].color !== '#000000') borderColor = b[p[0]].color;
            }
        });
        if (borderColor) fmt.borderColor = borderColor;
        if (xf.h && H_ALIGN[xf.h]) fmt.horizontalAlignment = H_ALIGN[xf.h];
        if (V_ALIGN[xf.v] || !layer) fmt.verticalAlignment = V_ALIGN[xf.v] || 'Bottom';
        if (xf.wrap || xf.h === 'justify' || xf.v === 'justify') fmt.textPlacement = 'Wrap';
        if (xf.indent) fmt.indent = xf.indent * 3;
        /* Excel: 1..90 counter-clockwise, 91..180 clockwise (90 + deg), 255 stacked.
         * 1C counts tenths of a degree counter-clockwise. */
        if (xf.rotation > 0 && xf.rotation <= 90) fmt.textOrientation = xf.rotation * 10;
        else if (xf.rotation > 90 && xf.rotation <= 180) fmt.textOrientation = 3600 - (xf.rotation - 90) * 10;
        else if (xf.rotation) stats.rotation = true;
        if (fillType) fmt.fillType = fillType;
        if (f && f.color && f.color !== '#000000') fmt.textColor = f.color;
        var fill = st.fills[xf.fill];
        if (fill) {
            fmt.backColor = fill;
            fmt.pattern = 'Solid';
        }
        /* The value format matters for what a parameter shows once filled. */
        var dataFormat = oneCFormat(st, xf.numFmt);
        if (dataFormat) fmt.format = dataFormat;
        return fmt;
    }

    var width = Math.max(1, sheet.width);
    var height = Math.max(1, sheet.height);

    /* Cells Excel never wrote still show the Normal style's font. */
    var defaultFormat = formatIndex({ font: fontIndex(st.fonts[(st.xfs[0] || { font: 0 }).font]), width: excelWidthToUnits(sheet.defColChars) });
    var columnFormats = [];
    for (var c = 0; c < width; c++) {
        var col = sheet.cols[c];
        var chars = col ? col.width : sheet.defColChars;
        /* A column style in Excel formats the empty cells of the column; in 1C that
         * is the column's own format, which cells inherit. */
        var fmt = col && col.style > 0 ? cellFormat(col.style, '', null, true) : {};
        fmt.width = col && col.hidden ? 0 : excelWidthToUnits(chars);
        columnFormats.push(formatIndex(fmt));
    }

    /* A merged area is one cell in 1C: its right and bottom borders come from
     * the cells on the far edges of the Excel range, as the platform import does. */
    var styleAt = {};
    sheet.rows.forEach(function (row) {
        row.cells.forEach(function (cell) { styleAt[row.index + ':' + cell.col] = cell.style; });
    });
    function borderOf(r, c, side) {
        var xf = st.xfs[styleAt[r + ':' + c]];
        var b = xf && st.borders[xf.border];
        return b ? b[side] : undefined;
    }
    var mergeEdges = {};
    sheet.merges.forEach(function (m) {
        mergeEdges[m.r + ':' + m.c] = { right: borderOf(m.r, m.c + m.w, 'right'), bottom: borderOf(m.r + m.h, m.c, 'bottom') };
    });

    var rowsXml = [];
    sheet.rows.forEach(function (row) {
        var rfmt = row.style > 0 ? cellFormat(row.style, '', null, true) : {};
        var pt = row.height != null ? row.height : null;
        if (row.hidden) rfmt.height = 0;
        else if (pt != null) rfmt.height = Math.max(1, Math.round(pt * HEIGHT_U_PER_PT));
        var parts = [];
        var expected = 0;
        row.cells.forEach(function (cell) {
            var text = cell.text == null ? '' : String(cell.text);
            var fillType = '';
            var parameter = '';
            var pm = PARAM_ONLY.exec(text);
            if (pm) {
                fillType = 'Parameter';
                parameter = pm[1].trim();
                stats.parameters.push(parameter);
            } else if (PARAM_INSIDE.test(text)) {
                fillType = 'Template';
                stats.templates++;
            }
            var idx = formatIndex(cellFormat(cell.style, fillType, mergeEdges[row.index + ':' + cell.col]));
            var body = '\t\t\t\t\t<f>' + idx + '</f>\n';
            if (parameter) {
                body += '\t\t\t\t\t<parameter>' + esc(parameter) + '</parameter>\n';
            } else if (text !== '') {
                body += '\t\t\t\t\t<tl>\n\t\t\t\t\t\t<v8:item>\n\t\t\t\t\t\t\t<v8:lang>' + lang + '</v8:lang>\n' +
                    '\t\t\t\t\t\t\t<v8:content>' + esc(text) + '</v8:content>\n\t\t\t\t\t\t</v8:item>\n\t\t\t\t\t</tl>\n';
            }
            var head = cell.col !== expected ? '\t\t\t\t<i>' + cell.col + '</i>\n' : '';
            parts.push('\t\t\t<c>\n' + head + '\t\t\t\t<c>\n' + body + '\t\t\t\t</c>\n\t\t\t</c>\n');
            expected = cell.col + 1;
        });
        var x = '\t<rowsItem>\n\t\t<index>' + row.index + '</index>\n\t\t<row>\n';
        if (Object.keys(rfmt).length) x += '\t\t\t<formatIndex>' + formatIndex(rfmt) + '</formatIndex>\n';
        if (!parts.length) x += '\t\t\t<empty>true</empty>\n';
        x += parts.join('') + '\t\t</row>\n\t</rowsItem>\n';
        rowsXml.push(x);
    });

    var out = [];
    out.push(BOM + '<?xml version="1.0" encoding="UTF-8"?>\n');
    out.push('<document xmlns="http://v8.1c.ru/8.2/data/spreadsheet" xmlns:style="http://v8.1c.ru/8.1/data/ui/style" xmlns:v8="http://v8.1c.ru/8.1/data/core" xmlns:v8ui="http://v8.1c.ru/8.1/data/ui" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">\n');
    out.push('\t<languageSettings>\n\t\t<currentLanguage>' + lang + '</currentLanguage>\n\t\t<defaultLanguage>' + lang + '</defaultLanguage>\n' +
        '\t\t<languageInfo>\n\t\t\t<id>' + lang + '</id>\n\t\t\t<code>' + (lang === 'ru' ? 'Русский' : lang) + '</code>\n\t\t\t<description>' + (lang === 'ru' ? 'Русский' : lang) + '</description>\n\t\t</languageInfo>\n\t</languageSettings>\n');
    out.push('\t<columns>\n\t\t<size>' + width + '</size>\n');
    for (c = 0; c < width; c++) {
        out.push('\t\t<columnsItem>\n\t\t\t<index>' + c + '</index>\n\t\t\t<column>\n\t\t\t\t<formatIndex>' + columnFormats[c] + '</formatIndex>\n\t\t\t</column>\n\t\t</columnsItem>\n');
    }
    out.push('\t</columns>\n');
    out.push(rowsXml.join(''));
    var drawingFormat = 0;
    if (sheet.pictures.length) {
        /* Pictures carry no frame: one format whose drawing border is a None line. */
        var noLine = lines.add('drawing:None', { width: 1, style: 'None', kind: 'Drawing' });
        drawingFormat = formatIndex({ drawingBorder: noLine });
    }
    sheet.pictures.forEach(function (p, i) {
        out.push('\t<drawing>\n\t\t<drawingType>Picture</drawingType>\n\t\t<id>' + (i + 1) + '</id>\n' +
            '\t\t<formatIndex>' + drawingFormat + '</formatIndex>\n' +
            '\t\t<beginRow>' + p.fromRow + '</beginRow>\n\t\t<beginRowOffset>' + p.fromRowOff + '</beginRowOffset>\n' +
            '\t\t<endRow>' + p.toRow + '</endRow>\n\t\t<endRowOffset>' + p.toRowOff + '</endRowOffset>\n' +
            '\t\t<beginColumn>' + p.fromCol + '</beginColumn>\n\t\t<beginColumnOffset>' + p.fromColOff + '</beginColumnOffset>\n' +
            '\t\t<endColumn>' + p.toCol + '</endColumn>\n\t\t<endColumnOffset>' + p.toColOff + '</endColumnOffset>\n' +
            '\t\t<autoSize>false</autoSize>\n\t\t<pictureSize>' + p.size + '</pictureSize>\n\t\t<zOrder>' + (i + 1) + '</zOrder>\n' +
            '\t\t<pictureIndex>' + (i + 1) + '</pictureIndex>\n\t</drawing>\n');
    });
    [['header', 'Header'], ['footer', 'Footer']].forEach(function (kind) {
        var parts = sheet[kind[0]] || {};
        if (!parts.left && !parts.center && !parts.right) return;
        ['left', 'center', 'right'].forEach(function (side) {
            var p = parts[side];
            var tag = side + kind[1];
            var face = (p && p.face) || (parts.left || parts.center || parts.right).face;
            var size = (p && p.size) || (parts.left || parts.center || parts.right).size;
            var fi = formatIndex({ font: fontIndex({ name: face || 'Arial', size: size || 10, bold: p && p.bold, italic: p && p.italic }),
                verticalAlignment: 'Bottom' });
            var body = p ? '\t\t<tl>\n\t\t\t<v8:item>\n\t\t\t\t<v8:lang>' + lang + '</v8:lang>\n\t\t\t\t<v8:content>' +
                esc(p.text) + '</v8:content>\n\t\t\t</v8:item>\n\t\t</tl>\n' : '\t\t<tl/>\n';
            out.push('\t<' + tag + '>\n\t\t<f>' + fi + '</f>\n' + body + '\t</' + tag + '>\n');
        });
    });
    out.push('\t<templateMode>true</templateMode>\n');
    out.push('\t<defaultFormatIndex>' + defaultFormat + '</defaultFormatIndex>\n');
    out.push('\t<height>' + height + '</height>\n');
    out.push('\t<vgRows>' + height + '</vgRows>\n');
    sheet.merges.forEach(function (m) {
        var x = '\t<merge>\n\t\t<r>' + m.r + '</r>\n\t\t<c>' + m.c + '</c>\n';
        if (m.h) x += '\t\t<h>' + m.h + '</h>\n';
        if (m.w) x += '\t\t<w>' + m.w + '</w>\n';
        out.push(x + '\t</merge>\n');
    });
    sheet.areas.forEach(function (a) {
        out.push('\t<namedItem xsi:type="NamedItemCells">\n\t\t<name>' + esc(a.name) + '</name>\n\t\t<area>\n' +
            '\t\t\t<type>' + a.type + '</type>\n\t\t\t<beginRow>' + a.beginRow + '</beginRow>\n\t\t\t<endRow>' + a.endRow + '</endRow>\n' +
            '\t\t\t<beginColumn>' + a.beginColumn + '</beginColumn>\n\t\t\t<endColumn>' + a.endColumn + '</endColumn>\n\t\t</area>\n\t</namedItem>\n');
    });
    if (sheet.print) {
        var PRINT_ORDER = ['pageOrientation', 'scale', 'topMargin', 'leftMargin', 'bottomMargin', 'rightMargin',
            'headerSize', 'footerSize', 'fitToPage', 'blackAndWhite', 'paper'];
        var printXml = '\t<printSettings>\n';
        PRINT_ORDER.forEach(function (k) {
            if (sheet.print[k] != null) printXml += '\t\t<' + k + '>' + sheet.print[k] + '</' + k + '>\n';
        });
        out.push(printXml + '\t</printSettings>\n');
    }
    if (sheet.printArea) {
        var area = sheet.printArea;
        out.push('\t<printArea>\n\t\t<type>' + area.type + '</type>\n\t\t<beginRow>' + area.beginRow + '</beginRow>\n\t\t<endRow>' +
            area.endRow + '</endRow>\n\t\t<beginColumn>' + area.beginColumn + '</beginColumn>\n\t\t<endColumn>' + area.endColumn +
            '</endColumn>\n\t</printArea>\n');
    }
    lines.items.forEach(function (l) {
        out.push('\t<line width="' + l.width + '" gap="false">\n\t\t<v8ui:style xsi:type="v8ui:SpreadsheetDocument' + (l.kind || 'Cell') + 'LineType">' + l.style + '</v8ui:style>\n\t</line>\n');
    });
    fonts.items.forEach(function (f) {
        out.push('\t<font faceName="' + esc(f.faceName) + '" height="' + f.height + '" bold="' + f.bold + '" italic="' + f.italic +
            '" underline="' + f.underline + '" strikeout="' + f.strikeout + '" kind="Absolute" scale="100"/>\n');
    });
    /* Designer's order, checked against templates exported from the configurator. */
    var ORDER = ['font', 'leftBorder', 'topBorder', 'rightBorder', 'bottomBorder', 'borderColor', 'height', 'width',
        'horizontalAlignment', 'drawingBorder', 'verticalAlignment', 'textColor', 'backColor', 'pattern', 'textPlacement', 'fillType',
        'textOrientation', 'format', 'indent'];
    formats.items.forEach(function (fmt) {
        var x = '\t<format>\n';
        ORDER.forEach(function (k) {
            if (fmt[k] == null) return;
            if (k === 'format') {
                x += '\t\t<format>\n\t\t\t<v8:item>\n\t\t\t\t<v8:lang>' + lang + '</v8:lang>\n\t\t\t\t<v8:content>' + esc(fmt[k]) +
                    '</v8:content>\n\t\t\t</v8:item>\n\t\t</format>\n';
            } else {
                x += '\t\t<' + k + '>' + esc(fmt[k]) + '</' + k + '>\n';
            }
        });
        out.push(x + '\t</format>\n');
    });
    sheet.pictures.forEach(function (p, i) {
        out.push('\t<picture>\n\t\t<index>' + i + '</index>\n\t\t<picture t="false">' + p.data + '</picture>\n\t</picture>\n');
    });
    out.push('</document>\n');

    return { xml: out.join(''), stats: stats };
}

function summarize(sheet, built, warnings) {
    var list = [];
    if (warnings.formulas) list.push('Формулы (' + warnings.formulas + '): перенесены последние вычисленные значения.');
    if (warnings.richText) list.push('Текст с разным оформлением внутри ячейки: взято оформление ячейки.');
    if (warnings.conditionalFormatting) list.push('Условное форматирование не переносится.');
    if (warnings.dataValidations) list.push('Проверка данных не переносится.');
    if (warnings.drawingsSkipped) list.push('Фигуры, диаграммы и картинки без привязки к ячейкам не переносятся (' + warnings.drawingsSkipped + ').');
    if (warnings.skippedNames) list.push('Имена с несколькими диапазонами или #REF пропущены: ' + warnings.skippedNames.join(', ') + '.');
    if (built.stats.rotation) list.push('Вертикальный текст «столбиком» не переносится.');
    if (warnings.printTitles) list.push('Сквозные строки и колонки печати (Print_Titles) не переносятся — задайте их в конфигураторе.');
    return {
        sheet: sheet.sheetName,
        rows: sheet.height,
        columns: sheet.width,
        merges: sheet.merges.length,
        pictures: sheet.pictures.length,
        areas: sheet.areas.map(function (a) { return { name: a.name, type: a.type, beginRow: a.beginRow, endRow: a.endRow, beginColumn: a.beginColumn, endColumn: a.endColumn }; }),
        parameters: built.stats.parameters,
        templateCells: built.stats.templates,
        warnings: list
    };
}

/* convert(bytes, { sheet: name|index, language }) → Promise<{ xml, summary, sheets }> */
function convert(input, options) {
    options = options || {};
    /* Start inside a promise so a malformed file rejects instead of throwing. */
    return Promise.resolve().then(function () { return openWorkbook(input); }).then(function (book) {
        var visible = book.sheets.map(function (s, i) { return i; }).filter(function (i) { return book.sheets[i].state === 'visible'; });
        var index = visible.length ? visible[0] : 0;
        if (typeof options.sheet === 'number') index = options.sheet;
        else if (typeof options.sheet === 'string' && options.sheet) {
            index = book.sheets.map(function (s) { return s.name; }).indexOf(options.sheet);
            if (index < 0) throw new Error('В книге нет листа «' + options.sheet + '». Листы: ' + book.sheets.map(function (s) { return s.name; }).join(', '));
        }
        if (!book.sheets[index]) throw new Error('В книге нет листа с номером ' + index + '.');
        var warnings = {};
        return readSheet(book, index, warnings).then(function (sheet) {
            var built = buildTemplate(sheet, options);
            var summary = summarize(sheet, built, warnings);
            summary.sheets = book.sheets.map(function (s) { return s.name; });
            return { xml: built.xml, summary: summary };
        });
    });
}

root.XlsxTemplate = {
    convert: convert,
    _test: {
        parseXml: parseXml,
        parseRef: parseRef,
        parseDefinedRange: parseDefinedRange,
        colorOf: colorOf,
        serialToDate: serialToDate,
        oneCFormat: oneCFormat,
        displayNumber: displayNumber,
        readZipDirectory: readZipDirectory
    }
};

})(typeof window !== 'undefined' ? window : globalThis);
