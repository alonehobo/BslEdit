/* In-place editing of a 1C managed form (Ext/Form.xml): properties of form
 * items and of the form itself, moving and removing items. Used by the MCP
 * tool edit_form, so an agent adjusts a form and checks it in the preview
 * without touching the XML by hand.
 *
 * Works on the XML text in the browser and in Node alike. Unlike the template
 * markup module the file is never re-serialized: the scanner records source
 * offsets and every edit splices text, so everything outside the touched nodes
 * stays byte for byte as Designer wrote it (BOM, CRLF, tabs, attribute order).
 *
 * The element model (companion nodes, which containers take which items) follows
 * the form skills of cc-1c-skills (MIT, (c) 2025-2026 Nick Shirokov,
 * https://github.com/Nikolay-Shirokov/cc-1c-skills). Property kinds and the schema
 * order of property nodes come from root.FormItemProperties when it is loaded. */
(function (root) {
'use strict';

/* ---------- XML scanner with offsets ---------- */

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

/* Node: { tag, name (local), attrs {}, start, openEnd, closeStart, end, kids, parent, text }.
 * For a self-closing node openEnd === end and closeStart === -1. */
function scan(xml) {
    var doc = { tag: '#document', name: '#document', attrs: {}, kids: [], start: 0, openEnd: 0, closeStart: xml.length, end: xml.length, text: '' };
    var stack = [doc];
    var re = /<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[^\s=\/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|<!\[CDATA\[([\s\S]*?)\]\]>|<[?!][\s\S]*?>|([^<]+)/g;
    var m;
    while ((m = re.exec(xml))) {
        var top = stack[stack.length - 1];
        if (m[6] != null) { top.text += decode(m[6]); continue; }
        if (m[5] != null) { top.text += m[5]; continue; }
        if (!m[2]) continue;
        if (m[1]) {
            if (stack.length < 2 || top.tag !== m[2]) throw new Error('Файл формы повреждён: лишний закрывающий тег </' + m[2] + '>.');
            top.closeStart = m.index;
            top.end = re.lastIndex;
            stack.pop();
            continue;
        }
        var attrs = {};
        var ar = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
        var a;
        while ((a = ar.exec(m[3]))) attrs[a[1]] = decode(a[2] != null ? a[2] : a[3]);
        var node = { tag: m[2], name: m[2].slice(m[2].indexOf(':') + 1), attrs: attrs, kids: [], parent: top,
            start: m.index, openEnd: re.lastIndex, closeStart: -1, end: re.lastIndex, text: '' };
        top.kids.push(node);
        if (!m[4]) stack.push(node);
    }
    if (stack.length > 1) throw new Error('Файл формы повреждён: не закрыт тег <' + stack[stack.length - 1].tag + '>.');
    var form = doc.kids[0];
    if (!form || form.name !== 'Form') throw new Error('Это не управляемая форма: нет корневого элемента Form.');
    return form;
}

function kid(node, name) {
    for (var i = 0; i < node.kids.length; i++) if (node.kids[i].name === name) return node.kids[i];
    return null;
}

/* ---------- Form model ---------- */

/* Nodes that sit beside a form item's properties and are not properties. */
var STRUCTURE = {
    ContextMenu: 1, ExtendedTooltip: 1, AutoCommandBar: 1, SearchStringAddition: 1,
    ViewStatusAddition: 1, SearchControlAddition: 1, Events: 1, ChildItems: 1
};

/* Which item kinds a container accepts in its ChildItems. */
var BAR_ITEMS = { Button: 1, Popup: 1, ButtonGroup: 1 };
function accepts(container, item) {
    var c = container.name;
    var k = item.name;
    if (k === 'Page') return c === 'Pages';
    if (c === 'Pages') return false;
    if (c === 'AutoCommandBar' || c === 'CommandBar' || c === 'Popup' || c === 'ButtonGroup' || c === 'ContextMenu') return !!BAR_ITEMS[k];
    if (k === 'ButtonGroup' || k === 'Popup') return false;
    if (c === 'Table' || c === 'ColumnGroup') return k !== 'Pages' && k !== 'Table' && k !== 'UsualGroup' && k !== 'CommandBar';
    if (k === 'ColumnGroup') return false;
    return c === 'Form' || c === 'UsualGroup' || c === 'Page';
}

function isItem(node) {
    return node.attrs.name != null && node.attrs.id != null && node.parent && node.parent.name === 'ChildItems';
}

/* Every named node with an id: items and their companions. */
function collect(form) {
    var byName = {};
    (function walk(node) {
        node.kids.forEach(function (k) {
            if (k.attrs.name != null && k.attrs.id != null && !byName[k.attrs.name]) byName[k.attrs.name] = k;
            walk(k);
        });
    })(form);
    return byName;
}

function findElement(form, name) {
    if (!name || name === 'Form') return form;
    var byName = collect(form);
    var node = byName[name];
    if (!node) throw new Error('В форме нет элемента «' + name + '».');
    return node;
}

function contains(outer, inner) {
    for (var n = inner; n; n = n.parent) if (n === outer) return true;
    return false;
}

/* ---------- Text helpers ---------- */

function eolOf(xml) {
    return /\r\n/.test(xml) ? '\r\n' : '\n';
}
function lineStart(xml, pos) {
    var i = pos;
    while (i > 0 && xml.charAt(i - 1) !== '\n') i--;
    return i;
}
function indentOf(xml, node) {
    var s = lineStart(xml, node.start);
    var pad = xml.slice(s, node.start);
    return /^[\t ]*$/.test(pad) ? pad : '';
}
/* Span of the node's whole lines: leading indentation through the line break. */
function lineSpan(xml, node) {
    var s = lineStart(xml, node.start);
    if (!/^[\t ]*$/.test(xml.slice(s, node.start))) s = node.start;
    var e = node.end;
    if (xml.charAt(e) === '\r') e++;
    if (xml.charAt(e) === '\n') e++;
    return [s, e];
}
function splice(xml, from, to, text) {
    return xml.slice(0, from) + text + xml.slice(to);
}
function reindent(text, from, to, eol) {
    return text.split(eol).map(function (line) {
        if (!line) return line;
        return line.indexOf(from) === 0 ? to + line.slice(from.length) : line;
    }).join(eol);
}

/* ---------- Property dictionary ---------- */

function dictionary() {
    return root.FormItemProperties && root.FormItemProperties.kinds ? root.FormItemProperties.kinds : null;
}

var LOCAL_STRINGS = { Title: 1, ToolTip: 1, InputHint: 1, FooterText: 1, EditFormat: 1, Format: 1 };

function propertyInfo(kindName, prop) {
    var kinds = dictionary();
    if (!kinds) return null;
    var kind = kinds[kindName];
    if (!kind) return null;
    return { kind: kind, prop: kind.props ? kind.props[prop] : null };
}

/* ---------- Value writers ---------- */

function langItem(pad, eol, lang, content) {
    return pad + '<v8:item>' + eol
        + pad + '\t<v8:lang>' + encodeText(lang) + '</v8:lang>' + eol
        + pad + '\t<v8:content>' + encodeText(content) + '</v8:content>' + eol
        + pad + '</v8:item>' + eol;
}

/* Multilingual value: a string sets «ru», an object sets the listed languages;
 * other languages already in the node are kept, null removes a language. */
function localStringInner(existing, xml, value, pad, eol) {
    var langs = [];
    var map = {};
    if (existing) {
        existing.kids.forEach(function (item) {
            if (item.name !== 'item') return;
            var lang = kid(item, 'lang');
            var content = kid(item, 'content');
            if (!lang) return;
            langs.push(lang.text);
            map[lang.text] = content ? content.text : '';
        });
    }
    var patch = typeof value === 'string' ? { ru: value } : value;
    Object.keys(patch).forEach(function (lang) {
        if (patch[lang] == null) {
            delete map[lang];
            return;
        }
        if (typeof patch[lang] !== 'string') throw new Error('Текст на языке «' + lang + '» должен быть строкой.');
        if (!(lang in map)) langs.push(lang);
        map[lang] = patch[lang];
    });
    if (!existing) langs.sort(function (a, b) { return languageRank(a) - languageRank(b) || (a < b ? -1 : a > b ? 1 : 0); });
    var out = '';
    langs.forEach(function (lang) {
        if (lang in map) out += langItem(pad, eol, lang, map[lang]);
    });
    return out;
}

function languageRank(lang) {
    return lang === 'ru' ? 0 : lang === 'en' ? 1 : 2;
}

function scalarText(value, info, prop) {
    if (typeof value === 'object') throw new Error('Свойство ' + prop + ' принимает простое значение, а не объект.');
    var kind = info && info.kind;
    if (kind === 'boolean') {
        if (value !== true && value !== false && value !== 'true' && value !== 'false') throw new Error('Свойство ' + prop + ' логическое: true или false.');
        return String(value);
    }
    if (kind === 'number') {
        if (typeof value === 'string' ? !/^-?\d+(\.\d+)?$/.test(value) : typeof value !== 'number' || !isFinite(value)) throw new Error('Свойство ' + prop + ' числовое.');
        return String(value);
    }
    if (kind === 'enum' && info.values && info.values.indexOf(String(value)) < 0) {
        throw new Error('Недопустимое значение ' + prop + ': «' + value + '». Допустимо: ' + info.values.join(', ') + '.');
    }
    return String(value);
}

/* Where a new property node goes: before the first sibling that follows it in
 * schema order; without the order, before the structure nodes. */
function insertionPoint(xml, node, prop) {
    var order = null;
    var kinds = dictionary();
    if (kinds && kinds[node.name] && kinds[node.name].order) order = kinds[node.name].order;
    var rank = order ? order.indexOf(prop) : -1;
    for (var i = 0; i < node.kids.length; i++) {
        var k = node.kids[i];
        if (rank >= 0) {
            var r = order.indexOf(k.name);
            if (r > rank) return k;
        } else if (STRUCTURE[k.name]) {
            return k;
        }
    }
    return null;
}

function setOne(xml, form, node, prop, value, eol) {
    if (STRUCTURE[prop]) throw new Error(prop + ' — часть состава элемента, а не свойство.');
    if (!/^[A-Za-z][A-Za-z0-9]*$/.test(prop)) throw new Error('Недопустимое имя свойства: «' + prop + '».');
    var looked = propertyInfo(node.name, prop);
    if (looked && looked.kind && !looked.prop) {
        throw new Error('У элемента ' + node.name + ' нет свойства ' + prop + '.');
    }
    var info = looked ? looked.prop : null;
    if (info && info.attribute) throw new Error('Свойство ' + prop + ' записано атрибутом и так не меняется.');
    var complex = complexKindOf(prop, info);
    if (UNSUPPORTED_COMPLEX[prop] || (info && info.kind === 'complex' && !complex)) {
        throw new Error('Составное свойство ' + prop + ' (например список выбора) этой операцией не меняется.');
    }
    var existing = kid(node, prop);
    var pad = indentOf(xml, node) + '\t';
    var multilingual = info ? info.kind === 'localString' || info.kind === 'formattedString'
        : LOCAL_STRINGS[prop] || (existing && kid(existing, 'item'));

    if (value === null) {
        if (!existing) return { xml: xml, changed: false };
        var span = lineSpan(xml, existing);
        return { xml: splice(xml, span[0], span[1], ''), changed: true };
    }

    if (complex) {
        var bare = complexNode(complex, prop, value, pad, eol);
        if (existing) {
            if (xml.slice(existing.start, existing.end) === bare) return { xml: xml, changed: false };
            return { xml: splice(xml, existing.start, existing.end, bare), changed: true };
        }
        return insertProperty(xml, node, prop, pad + bare + eol, eol);
    }

    if (info && info.default != null && !multilingual && !complex
        && String(info.default) === String(typeof value === 'boolean' ? value : value)) {
        /* The platform drops a default-valued node on its next save, so writing
         * one only creates a spurious diff. */
        if (!existing) return { xml: xml, changed: false };
        var stale = lineSpan(xml, existing);
        return { xml: splice(xml, stale[0], stale[1], ''), changed: true };
    }

    var inner;
    if (multilingual) {
        if (typeof value !== 'string' && (typeof value !== 'object' || Array.isArray(value))) throw new Error('Свойство ' + prop + ' — многоязычная строка: строка или объект { ru, en }.');
        var items = localStringInner(existing, xml, value, pad + '\t', eol);
        if (!items) {
            if (!existing) return { xml: xml, changed: false };
            var gone = lineSpan(xml, existing);
            return { xml: splice(xml, gone[0], gone[1], ''), changed: true };
        }
        inner = eol + items + pad;
    } else {
        inner = encodeText(scalarText(value, info, prop));
    }

    if (existing) {
        var open = existing.closeStart < 0
            ? xml.slice(existing.start, existing.end).replace(/\s*\/>$/, '>')
            : xml.slice(existing.start, existing.openEnd);
        var replaced = open + inner + '</' + existing.tag + '>';
        var before = xml.slice(existing.start, existing.end);
        if (before === replaced) return { xml: xml, changed: false };
        return { xml: splice(xml, existing.start, existing.end, replaced), changed: true };
    }

    var text = pad + '<' + prop + '>' + inner + '</' + prop + '>' + eol;
    return insertProperty(xml, node, prop, text, eol);
}

/* Colors, fonts and pictures: written as whole nodes, not as a text value.
 * The shapes are the ones Designer writes (checked on a production
 * configuration); a choice list is out of scope — it holds values of arbitrary
 * 1C types and needs a serializer of its own. */
/* Structures this operation does not build: a choice list holds values of
 * arbitrary 1C types, the others are role and functional-option tables. */
var UNSUPPORTED_COMPLEX = {
    ChoiceList: 1, ChoiceParameters: 1, ChoiceParameterLinks: 1,
    FunctionalOptions: 1, View: 1, Edit: 1, Settings: 1
};
function complexKindOf(prop, info) {
    var declared = info && info.kind === 'complex' ? info.type : null;
    if (declared === 'Color' || declared === 'Font' || declared === 'Picture') return declared;
    if (declared) return null;
    if (info) return null;
    /* Without the dictionary, go by the property name. */
    if (/Color$/.test(prop)) return 'Color';
    if (/Font$/.test(prop)) return 'Font';
    if (/Picture$/.test(prop)) return 'Picture';
    return null;
}

function complexNode(complex, prop, value, pad, eol) {
    if (complex === 'Color') {
        if (typeof value !== 'string') throw new Error('Цвет ' + prop + ' — строка: style:ИмяЭлементаСтиля, web:FireBrick, win:Window или #RRGGBB.');
        if (!/^(style:|web:|win:)\S+$|^#[0-9A-Fa-f]{6}$/.test(value)) {
            throw new Error('Непонятный цвет «' + value + '». Допустимо: style:Имя, web:Имя, win:Имя или #RRGGBB.');
        }
        return '<' + prop + '>' + encodeText(value) + '</' + prop + '>';
    }
    if (complex === 'Font') {
        if (typeof value !== 'object' || Array.isArray(value) || value == null) {
            throw new Error('Шрифт ' + prop + ' — объект: { ref: "style:Имя" } либо { face: "Arial", height: 11 }, плюс bold, italic, underline, strikeout, scale.');
        }
        var attrs = [];
        if (value.ref) {
            if (!/^style:\S+$/.test(String(value.ref))) throw new Error('ref шрифта — элемент стиля вида style:Имя.');
            attrs.push(['ref', String(value.ref)]);
        } else if (!value.face) {
            throw new Error('Шрифт ' + prop + ': укажите ref (элемент стиля) или face (имя шрифта).');
        }
        if (value.face) attrs.push(['faceName', String(value.face)]);
        if (value.height != null) {
            if (typeof value.height !== 'number' || !(value.height > 0)) throw new Error('height шрифта — положительное число.');
            attrs.push(['height', String(value.height)]);
        }
        ['bold', 'italic', 'underline', 'strikeout'].forEach(function (flag) {
            if (value[flag] == null) return;
            if (value[flag] !== true && value[flag] !== false) throw new Error(flag + ' шрифта — true или false.');
            attrs.push([flag, String(value[flag])]);
        });
        attrs.push(['kind', value.ref ? 'StyleItem' : 'Absolute']);
        if (!value.ref) attrs.push(['scale', String(value.scale != null ? value.scale : 100)]);
        return '<' + prop + attrs.map(function (a) { return ' ' + a[0] + '="' + encodeText(a[1]) + '"'; }).join('') + '/>';
    }
    /* Picture: a reference to the configuration's picture library. */
    var reference = typeof value === 'string' ? { ref: value } : value;
    if (!reference || typeof reference !== 'object' || !reference.ref) {
        throw new Error('Картинка ' + prop + ' — «CommonPicture.Имя», «StdPicture.Имя» или объект { ref, load_transparent }.');
    }
    var match = /^(CommonPicture|StdPicture)\.(\S+)$/.exec(String(reference.ref));
    if (!match) {
        throw new Error('Непонятная картинка «' + reference.ref + '». Допустимо: CommonPicture.Имя или StdPicture.Имя.');
    }
    if (match[1] === 'StdPicture') {
        var library = root.FormPreview && root.FormPreview.stdPictureRu;
        if (library && !library[match[2]] && !/[А-Яа-яЁё]/.test(match[2])) {
            throw new Error('В библиотеке картинок платформы нет «' + match[2] + '». Неверное имя платформа не примет: она откажется читать весь файл формы.');
        }
    }
    var transparent = reference.load_transparent === true;
    return '<' + prop + '>' + eol
        + pad + '\t<xr:Ref>' + encodeText(String(reference.ref)) + '</xr:Ref>' + eol
        + pad + '\t<xr:LoadTransparent>' + transparent + '</xr:LoadTransparent>' + eol
        + pad + '</' + prop + '>';
}

/* Puts a freshly built property node in its place among the siblings. */
function insertProperty(xml, node, prop, text, eol) {
    if (node.closeStart < 0) {
        /* <Item name="x" id="1"/> → open it. */
        var head = xml.slice(node.start, node.end).replace(/\s*\/>$/, '>');
        var body = head + eol + text + indentOf(xml, node) + '</' + node.tag + '>';
        return { xml: splice(xml, node.start, node.end, body), changed: true };
    }
    var next = insertionPoint(xml, node, prop);
    var at = next ? lineSpan(xml, next)[0] : lineStart(xml, node.closeStart);
    if (!next && !/^[\t ]*$/.test(xml.slice(at, node.closeStart))) {
        /* Close tag shares a line with content (unusual): put ours on its own line. */
        return { xml: splice(xml, node.closeStart, node.closeStart, eol + text + indentOf(xml, node)), changed: true };
    }
    return { xml: splice(xml, at, at, text), changed: true };
}

/* ---------- New items ---------- */

/* Companion nodes per item kind, as Designer writes them. Counted on 500 forms
 * of a production configuration: every item of a kind has exactly this set. */
var COMPANIONS = {
    InputField: ['ContextMenu', 'ExtendedTooltip'],
    CheckBoxField: ['ContextMenu', 'ExtendedTooltip'],
    RadioButtonField: ['ContextMenu', 'ExtendedTooltip'],
    LabelField: ['ContextMenu', 'ExtendedTooltip'],
    LabelDecoration: ['ContextMenu', 'ExtendedTooltip'],
    PictureField: ['ContextMenu', 'ExtendedTooltip'],
    PictureDecoration: ['ContextMenu', 'ExtendedTooltip'],
    CalendarField: ['ContextMenu', 'ExtendedTooltip'],
    TextDocumentField: ['ContextMenu', 'ExtendedTooltip'],
    SpreadSheetDocumentField: ['ContextMenu', 'ExtendedTooltip'],
    FormattedDocumentField: ['ContextMenu', 'ExtendedTooltip'],
    ChartField: ['ContextMenu', 'ExtendedTooltip'],
    Table: ['ContextMenu', 'AutoCommandBar', 'ExtendedTooltip', 'SearchStringAddition', 'ViewStatusAddition', 'SearchControlAddition'],
    UsualGroup: ['ExtendedTooltip'],
    ColumnGroup: ['ExtendedTooltip'],
    Pages: ['ExtendedTooltip'],
    Page: ['ExtendedTooltip'],
    Button: ['ExtendedTooltip'],
    ButtonGroup: ['ExtendedTooltip'],
    Popup: ['ExtendedTooltip'],
    CommandBar: ['ExtendedTooltip']
};
var SUFFIXES = {
    ru: { ContextMenu: 'КонтекстноеМеню', ExtendedTooltip: 'РасширеннаяПодсказка', AutoCommandBar: 'КоманднаяПанель',
        SearchStringAddition: 'СтрокаПоиска', ViewStatusAddition: 'СостояниеПросмотра', SearchControlAddition: 'УправлениеПоиском' },
    en: { ContextMenu: 'ContextMenu', ExtendedTooltip: 'ExtendedTooltip', AutoCommandBar: 'CommandBar',
        SearchStringAddition: 'SearchString', ViewStatusAddition: 'ViewStatus', SearchControlAddition: 'SearchControl' }
};

/* Designer names a companion after its item in the language of the item's name. */
function suffixesFor(name) {
    return /[А-Яа-яЁё]/.test(name) ? SUFFIXES.ru : SUFFIXES.en;
}

/* Ids are per pool: items with their companions, attributes with their columns,
 * commands. A form borrowed by an extension numbers its own items from 1000000. */
function nextId(form, pool) {
    var top = 0;
    (function walk(node) {
        var inPool = pool === 'item'
            ? node.attrs.id != null && node.attrs.name != null && !insideOf(node, ['Attributes', 'Commands', 'Parameters'])
            : pool === 'attribute' ? node.name === 'Attribute' && node.parent && node.parent.name === 'Attributes'
            : node.name === 'Command' && node.parent && node.parent.name === 'Commands';
        if (inPool && /^\d+$/.test(node.attrs.id || '')) top = Math.max(top, parseInt(node.attrs.id, 10));
        node.kids.forEach(walk);
    })(form);
    var base = pool === 'item' && kid(form, 'BaseForm') ? 1000000 : 1;
    return Math.max(top + 1, base);
}
function insideOf(node, sections) {
    for (var n = node.parent; n; n = n.parent) if (sections.indexOf(n.name) >= 0) return true;
    return false;
}

function addElement(xml, params) {
    params = params || {};
    var name = params.element;
    var kind = params.kind;
    if (!name || !/^[A-Za-zА-Яа-яЁё_][A-Za-zА-Яа-яЁё0-9_]*$/.test(name)) throw new Error('Передайте element — имя нового элемента (идентификатор 1С).');
    if (!kind || !COMPANIONS[kind]) throw new Error('Передайте kind — вид элемента: ' + Object.keys(COMPANIONS).join(', ') + '.');
    var eol = eolOf(xml);
    var form = scan(xml);
    if (collect(form)[name]) throw new Error('В форме уже есть элемент «' + name + '».');
    var anchorName = params.after || params.before;
    if (params.after && params.before) throw new Error('Укажите after или before, не оба.');
    var anchor = anchorName ? findElement(form, anchorName) : null;
    if (anchor && !isItem(anchor)) throw new Error('«' + anchorName + '» не элемент формы.');
    var container = params.into ? findElement(form, params.into) : anchor ? anchor.parent.parent : form;
    if (anchor && anchor.parent.parent !== container) {
        throw new Error('«' + anchorName + '» лежит не в «' + (params.into || 'Form') + '».');
    }
    if (!accepts(container, { name: kind })) {
        throw new Error(container.name + ' «' + (container.attrs.name || 'Form') + '» не может содержать ' + kind + '.');
    }

    /* The skeleton first, properties afterwards: setProperties already knows the
     * schema order and checks the values. */
    var id = nextId(form, 'item');
    var suffixes = suffixesFor(name);
    var kinds = dictionary();
    var order = kinds && kinds[kind] && kinds[kind].order ? kinds[kind].order : null;
    var tags = COMPANIONS[kind].slice();
    if (order) tags.sort(function (a, b) { return order.indexOf(a) - order.indexOf(b); });
    var companions = tags.map(function (tag, index) {
        return { tag: tag, name: name + suffixes[tag], id: id + 1 + index };
    });
    var childItems = kid(container, 'ChildItems');
    var pad = childItems ? indentOf(xml, childItems) + '\t'
        : (container === form ? '\t' : indentOf(xml, container) + '\t') + '\t';
    var body = companions.map(function (c) {
        return pad + '\t<' + c.tag + ' name="' + c.name + '" id="' + c.id + '"/>' + eol;
    }).join('');
    var text = pad + '<' + kind + ' name="' + name + '" id="' + id + '">' + eol + body + pad + '</' + kind + '>' + eol;

    var out;
    if (childItems) {
        var at = anchor ? (params.after ? lineSpan(xml, anchor)[1] : lineSpan(xml, anchor)[0]) : lineStart(xml, childItems.closeStart);
        out = splice(xml, at, at, text);
    } else {
        var cPad = container === form ? '\t' : indentOf(xml, container) + '\t';
        text = cPad + '<ChildItems>' + eol + text + cPad + '</ChildItems>' + eol;
        if (container.closeStart < 0) {
            /* An empty container is written <Bar name="x" id="1"/>: open it. */
            var opened = xml.slice(container.start, container.end).replace(/\s*\/>$/, '>')
                + eol + text + indentOf(xml, container) + '</' + container.tag + '>';
            out = splice(xml, container.start, container.end, opened);
        } else {
            var after = null;
            for (var i = 0; i < container.kids.length && container === form; i++) {
                if ({ Attributes: 1, Commands: 1, Parameters: 1, CommandInterface: 1, CommandSet: 1, ConditionalAppearance: 1, BaseForm: 1 }[container.kids[i].name]) { after = container.kids[i]; break; }
            }
            var end = after ? lineSpan(xml, after)[0] : lineStart(xml, container.closeStart);
            out = splice(xml, end, end, text);
        }
    }
    scan(out);
    if (params.properties && Object.keys(params.properties).length) {
        out = setProperties(out, { element: name, properties: params.properties }).xml;
    }
    var warnings = [];
    var commandName = params.properties && params.properties.CommandName;
    if (commandName) {
        var reference = /^Form\.Command\.(.+)$/.exec(String(commandName));
        var commands = kid(scan(out), 'Commands');
        var known = reference && commands && commands.kids.some(function (c) { return c.attrs.name === reference[1]; });
        if (reference && !known) warnings.push('Команды формы «' + reference[1] + '» нет: добавьте её операцией set_command.');
    }
    return {
        xml: out,
        result: {
            element: name, kind: kind, id: id,
            into: container.attrs.name || 'Form',
            companions: companions.map(function (c) { return c.name; }),
            warnings: warnings.length ? warnings : undefined,
            note: 'Обработчики событий и модуль формы не изменялись.'
        }
    };
}

/* ---------- Attributes and commands ---------- */

/* Child order of <Attribute> and <Command>, and the place of the sections in
 * <Form>: taken from a production configuration (130 932 attributes and 58 471
 * commands, no counter-examples). */
var ATTRIBUTE_ORDER = ['Title', 'Type', 'MainAttribute', 'View', 'Edit', 'SavedData', 'FillCheck', 'Save', 'UseAlways', 'FunctionalOptions', 'Columns', 'Settings'];
var COMMAND_ORDER = ['Title', 'ToolTip', 'Shortcut', 'Picture', 'Use', 'Action', 'FunctionalOptions', 'Representation', 'ModifiesSavedData', 'CurrentRowUse'];
var FORM_SECTIONS = ['Title', 'AutoTitle', 'CommandBarLocation', 'CommandSet', 'WindowOpeningMode', 'AutoCommandBar',
    'ChildItems', 'Events', 'Attributes', 'Commands', 'Parameters', 'CommandInterface', 'BaseForm'];

/* Type spelling → the <Type> body. Numbers, strings and dates carry their
 * qualifier block; references and type sets never do. */
function typeBody(spelling, pad, eol) {
    var parts = String(spelling).split('|').map(function (part) { return part.trim(); }).filter(Boolean);
    if (!parts.length) throw new Error('Пустой тип.');
    var entries = [];
    var qualifiers = { number: '', string: '', date: '' };
    parts.forEach(function (part) {
        var match;
        if (/^(string|Строка)$/i.test(part) || (match = /^(?:string|Строка)\s*\(\s*(\d+)\s*(?:,\s*(fixed|variable))?\s*\)$/i.exec(part))) {
            var length = match ? match[1] : '0';
            var allowed = match && /fixed/i.test(match[2] || '') ? 'Fixed' : 'Variable';
            entries.push('xs:string');
            qualifiers.string = pad + '<v8:StringQualifiers>' + eol
                + pad + '\t<v8:Length>' + length + '</v8:Length>' + eol
                + pad + '\t<v8:AllowedLength>' + allowed + '</v8:AllowedLength>' + eol
                + pad + '</v8:StringQualifiers>' + eol;
            return;
        }
        if (/^(boolean|Булево)$/i.test(part)) { entries.push('xs:boolean'); return; }
        if ((match = /^(?:number|decimal|Число)\s*(?:\(\s*(\d+)\s*(?:,\s*(\d+))?\s*(?:,\s*(nonnegative|any))?\s*\))?$/i.exec(part))) {
            entries.push('xs:decimal');
            qualifiers.number = pad + '<v8:NumberQualifiers>' + eol
                + pad + '\t<v8:Digits>' + (match[1] || '10') + '</v8:Digits>' + eol
                + pad + '\t<v8:FractionDigits>' + (match[2] || '0') + '</v8:FractionDigits>' + eol
                + pad + '\t<v8:AllowedSign>' + (/nonnegative/i.test(match[3] || '') ? 'Nonnegative' : 'Any') + '</v8:AllowedSign>' + eol
                + pad + '</v8:NumberQualifiers>' + eol;
            return;
        }
        if (/^(date|dateTime|time|Дата|ДатаВремя|Время)$/i.test(part)) {
            var fractions = /^(dateTime|ДатаВремя)$/i.test(part) ? 'DateTime' : /^(time|Время)$/i.test(part) ? 'Time' : 'Date';
            entries.push('xs:dateTime');
            qualifiers.date = pad + '<v8:DateQualifiers>' + eol
                + pad + '\t<v8:DateFractions>' + fractions + '</v8:DateFractions>' + eol
                + pad + '</v8:DateQualifiers>' + eol;
            return;
        }
        if (/^(v8|xs|cfg|mxl):/.test(part)) { entries.push(part); return; }
        if (/^(ValueTable|ValueTree|ValueList|ValueStorage|UUID|Type|FormattedDocument|SpreadsheetDocument|TextDocument)$/.test(part)) { entries.push('v8:' + part); return; }
        if (/^(DefinedType|FilterCriterionRef)\./.test(part)) { entries.push('SET:cfg:' + part); return; }
        if (/^[A-Za-z]+\.[^.]+/.test(part)) { entries.push('cfg:' + part); return; }
        throw new Error('Непонятный тип: «' + part + '». Допустимо: string, string(100), boolean, number(15,2), date, dateTime, time, CatalogRef.Имя, DocumentObject.Имя, DefinedType.Имя, ValueTable, составной через «|», либо готовое имя с префиксом (cfg:, v8:, xs:).');
    });
    var body = entries.map(function (entry) {
        return entry.indexOf('SET:') === 0
            ? pad + '<v8:TypeSet>' + encodeText(entry.slice(4)) + '</v8:TypeSet>' + eol
            : pad + '<v8:Type>' + encodeText(entry) + '</v8:Type>' + eol;
    }).join('');
    /* Qualifier blocks follow every type entry, in the order Designer writes. */
    return body + qualifiers.number + qualifiers.string + qualifiers.date;
}

/* A type value names its namespace by prefix, and the platform reads the file
 * through XDTO: an undeclared prefix makes the form unreadable. Designer's own
 * forms declare all of these, but a hand-written or trimmed one may not. */
var NAMESPACES = {
    xs: 'http://www.w3.org/2001/XMLSchema',
    v8: 'http://v8.1c.ru/8.1/data/core',
    cfg: 'http://v8.1c.ru/8.1/data/enterprise/current-config',
    xr: 'http://v8.1c.ru/8.3/xcf/readable',
    xsi: 'http://www.w3.org/2001/XMLSchema-instance'
};
/* Prefixes the file uses in type entries and xsi:type values. */
function prefixesOf(xml) {
    var found = {};
    var re = /<(?:v8:Type|v8:TypeSet)>\s*([A-Za-z0-9]+):|xsi:type="([A-Za-z0-9]+):|<(v8|xr|xs|cfg|xsi):/g;
    var m;
    while ((m = re.exec(xml))) found[m[1] || m[2] || m[3]] = true;
    return Object.keys(found);
}
function ensurePrefixes(xml) {
    var form = scan(xml);
    var missing = prefixesOf(xml).filter(function (prefix) {
        return NAMESPACES[prefix] && form.attrs['xmlns:' + prefix] == null;
    });
    if (!missing.length) return xml;
    var patched = xml.slice(form.start, form.openEnd).replace(/^<Form/, '<Form' + missing.map(function (prefix) {
        return ' xmlns:' + prefix + '="' + NAMESPACES[prefix] + '"';
    }).join(''));
    return splice(xml, form.start, form.openEnd, patched);
}

/* The section node, created in its place among the form's children when absent. */
function section(xml, form, tag, eol) {
    var node = kid(form, tag);
    if (node) return { xml: xml, tag: tag };
    var rank = FORM_SECTIONS.indexOf(tag);
    var next = null;
    for (var i = 0; i < form.kids.length; i++) {
        var r = FORM_SECTIONS.indexOf(form.kids[i].name);
        if (r > rank) { next = form.kids[i]; break; }
    }
    var at = next ? lineSpan(xml, next)[0] : lineStart(xml, form.closeStart);
    return { xml: splice(xml, at, at, '\t<' + tag + '>' + eol + '\t</' + tag + '>' + eol), tag: tag };
}

/* One writer for both sections: they differ only in tag names and child order. */
function setMember(xml, params, options) {
    var name = params.name;
    if (!name || !/^[A-Za-zА-Яа-яЁё_][A-Za-zА-Яа-яЁё0-9_]*$/.test(name)) throw new Error('Передайте name — имя ' + options.what + ' (идентификатор 1С).');
    var eol = eolOf(xml);
    var form = scan(xml);
    var holder = kid(form, options.section);
    var existing = null;
    if (holder) {
        holder.kids.forEach(function (node) { if (node.name === options.tag && node.attrs.name === name) existing = node; });
    }

    if (params.remove) {
        if (!existing) return { xml: xml, result: { name: name, removed: false } };
        var refs = options.references(xml, form, name);
        if (refs.length && !params.force) {
            throw new Error('На ' + options.accusative + ' «' + name + '» ссылаются: ' + refs.join('; ') + '. Уберите ссылки или передайте force=true.');
        }
        /* The last one leaves the section behind as Designer writes it: empty
         * <Attributes/> exists in real configurations, an empty <Commands> never does. */
        var alone = holder.kids.length === 1;
        var cut;
        if (alone && options.keepEmpty) {
            cut = splice(xml, holder.start, holder.end, '<' + holder.tag + '/>');
        } else {
            var span = alone ? lineSpan(xml, holder) : lineSpan(xml, existing);
            cut = splice(xml, span[0], span[1], '');
        }
        scan(cut);
        return { xml: cut, result: { name: name, removed: true, references: refs.length ? refs : undefined } };
    }

    if (!existing) {
        var created = section(xml, form, options.section, eol);
        xml = created.xml;
        form = scan(xml);
        holder = kid(form, options.section);
        if (holder.closeStart < 0) {
            var opened = xml.slice(holder.start, holder.end).replace(/\s*\/>$/, '>') + eol + indentOf(xml, holder) + '</' + holder.tag + '>';
            xml = splice(xml, holder.start, holder.end, opened);
            form = scan(xml);
            holder = kid(form, options.section);
        }
        var id = nextId(form, options.pool);
        var pad = indentOf(xml, holder) + '\t';
        var text = pad + '<' + options.tag + ' name="' + name + '" id="' + id + '">' + eol
            + options.skeleton(pad + '\t', eol, params)
            + pad + '</' + options.tag + '>' + eol;
        /* The form's ConditionalAppearance is the last child of Attributes. */
        var appearance = kid(holder, 'ConditionalAppearance');
        var at = appearance ? lineSpan(xml, appearance)[0] : lineStart(xml, holder.closeStart);
        xml = splice(xml, at, at, text);
        scan(xml);
        /* The skeleton already carries these; do not write them twice. */
        var copy = {};
        Object.keys(params).forEach(function (key) { copy[key] = params[key]; });
        options.skeletonFields.forEach(function (key) { delete copy[key]; });
        params = copy;
    }

    /* Everything else is an ordinary property of the member node. */
    var changed = [];
    options.fields.forEach(function (field) {
        if (!(field.key in params) || params[field.key] === undefined) return;
        var value = params[field.key];
        var pass = scan(xml);
        var holderNow = kid(pass, options.section);
        var node = null;
        holderNow.kids.forEach(function (candidate) { if (candidate.name === options.tag && candidate.attrs.name === name) node = candidate; });
        var written = writeMemberField(xml, node, field, value, options.order, eol);
        xml = written.xml;
        if (written.changed) changed.push(field.tag);
    });
    if (params.columns !== undefined) {
        var withColumns = setColumns(xml, options, name, params.columns, eol);
        xml = withColumns.xml;
        if (withColumns.changed.length) changed.push('Columns(' + withColumns.changed.join(', ') + ')');
    }
    xml = ensurePrefixes(xml);
    var out = scan(xml);
    var self = null;
    kid(out, options.section).kids.forEach(function (candidate) { if (candidate.name === options.tag && candidate.attrs.name === name) self = candidate; });
    return { xml: xml, result: { name: name, id: self.attrs.id, changed: changed, note: options.note } };
}

/* A member's own field: a multilingual title, a plain value or a <Type> body. */
function writeMemberField(xml, node, field, value, order, eol) {
    var pad = indentOf(xml, node) + '\t';
    var existing = kid(node, field.tag);
    var inner;
    if (value === null) {
        if (!existing) return { xml: xml, changed: false };
        var span = lineSpan(xml, existing);
        return { xml: splice(xml, span[0], span[1], ''), changed: true };
    }
    if (field.kind === 'localString') {
        if (typeof value !== 'string' && (typeof value !== 'object' || Array.isArray(value))) throw new Error(field.tag + ' — многоязычная строка: строка или объект { ru, en }.');
        inner = eol + localStringInner(existing, xml, value, pad + '\t', eol) + pad;
    } else if (field.kind === 'type') {
        inner = eol + typeBody(value, pad + '\t', eol) + pad;
    } else if (field.kind === 'boolean') {
        if (value !== true && value !== false) throw new Error(field.tag + ' — true или false; null убирает узел.');
        inner = String(value);
    } else {
        if (field.values && field.values.indexOf(String(value)) < 0) throw new Error('Недопустимое значение ' + field.tag + ': «' + value + '». Допустимо: ' + field.values.join(', ') + '.');
        inner = encodeText(String(value));
    }
    if (existing) {
        var open = existing.closeStart < 0 ? xml.slice(existing.start, existing.end).replace(/\s*\/>$/, '>') : xml.slice(existing.start, existing.openEnd);
        var replaced = open + inner + '</' + existing.tag + '>';
        if (xml.slice(existing.start, existing.end) === replaced) return { xml: xml, changed: false };
        return { xml: splice(xml, existing.start, existing.end, replaced), changed: true };
    }
    var text = pad + '<' + field.tag + '>' + inner + '</' + field.tag + '>' + eol;
    var rank = order.indexOf(field.tag);
    var next = null;
    for (var i = 0; i < node.kids.length; i++) {
        var r = order.indexOf(node.kids[i].name);
        if (r > rank) { next = node.kids[i]; break; }
    }
    var at = next ? lineSpan(xml, next)[0] : lineStart(xml, node.closeStart);
    if (node.closeStart < 0) {
        var body = xml.slice(node.start, node.end).replace(/\s*\/>$/, '>') + eol + text + indentOf(xml, node) + '</' + node.tag + '>';
        return { xml: splice(xml, node.start, node.end, body), changed: true };
    }
    return { xml: splice(xml, at, at, text), changed: true };
}

/* Columns of a table attribute (v8:ValueTable, v8:ValueTree). Their ids are a
 * counter of their own attribute, not of the form: 94.8 % of the column-owning
 * attributes in a production configuration start at 1, and the numbers repeat
 * across attributes. */
function setColumns(xml, options, attributeName, columns, eol) {
    if (!Array.isArray(columns)) throw new Error('columns — массив: [{ name, type, title, remove }].');
    var changed = [];
    columns.forEach(function (column) {
        if (!column || !column.name) throw new Error('У колонки должно быть name.');
        var form = scan(xml);
        var attribute = null;
        var holder = kid(form, options.section);
        holder.kids.forEach(function (candidate) { if (candidate.name === 'Attribute' && candidate.attrs.name === attributeName) attribute = candidate; });
        var box = kid(attribute, 'Columns');
        var existing = null;
        if (box) box.kids.forEach(function (candidate) { if (candidate.name === 'Column' && candidate.attrs.name === column.name) existing = candidate; });

        if (column.remove) {
            if (!existing) return;
            var alone = box.kids.length === 1;
            var span = alone ? lineSpan(xml, box) : lineSpan(xml, existing);
            xml = splice(xml, span[0], span[1], '');
            changed.push('-' + column.name);
            return;
        }
        if (!column.type && !existing) throw new Error('Для новой колонки «' + column.name + '» передайте type.');
        if (!box) {
            var attributePad = indentOf(xml, attribute) + '\t';
            var inserted = insertProperty(xml, attribute, 'Columns',
                attributePad + '<Columns>' + eol + attributePad + '</Columns>' + eol, eol);
            xml = inserted.xml;
            form = scan(xml);
            holder = kid(form, options.section);
            holder.kids.forEach(function (candidate) { if (candidate.name === 'Attribute' && candidate.attrs.name === attributeName) attribute = candidate; });
            box = kid(attribute, 'Columns');
        }
        var pad = indentOf(xml, box) + '\t';
        if (existing) {
            var typeNode = kid(existing, 'Type');
            if (column.type) {
                var body = eol + typeBody(column.type, pad + '\t\t', eol) + pad + '\t';
                xml = splice(xml, typeNode.start, typeNode.end, '<Type>' + body + '</Type>');
                changed.push(column.name);
            }
            if (column.title !== undefined) {
                var written = writeMemberField(xml, existing, { tag: 'Title', kind: 'localString' }, column.title, ['Title', 'Type'], eol);
                xml = written.xml;
                if (written.changed && changed.indexOf(column.name) < 0) changed.push(column.name);
            }
            return;
        }
        var top = 0;
        box.kids.forEach(function (candidate) {
            if (/^\d+$/.test(candidate.attrs.id || '')) top = Math.max(top, parseInt(candidate.attrs.id, 10));
        });
        var text = pad + '<Column name="' + column.name + '" id="' + (top + 1) + '">' + eol
            + (column.title !== undefined && column.title !== null
                ? pad + '\t<Title>' + eol + localStringInner(null, xml, column.title, pad + '\t\t', eol) + pad + '\t</Title>' + eol
                : '')
            + pad + '\t<Type>' + eol + typeBody(column.type, pad + '\t\t', eol) + pad + '\t</Type>' + eol
            + pad + '</Column>' + eol;
        var at = lineStart(xml, box.closeStart);
        xml = splice(xml, at, at, text);
        changed.push(column.name);
    });
    xml = ensurePrefixes(xml);
    scan(xml);
    return { xml: xml, changed: changed };
}

function dataPathReferences(xml, form, attribute) {
    var refs = [];
    (function walk(node) {
        if (node.name === 'DataPath') {
            var head = node.text.trim().split('.')[0];
            if (head === attribute) refs.push('DataPath ' + node.text.trim() + ' (' + owner(node) + ')');
        }
        node.kids.forEach(walk);
    })(form);
    return refs;
}
function commandReferences(xml, form, command) {
    var refs = [];
    (function walk(node) {
        if (node.name === 'CommandName' && node.text.trim() === 'Form.Command.' + command) refs.push('CommandName ' + node.text.trim() + ' (' + owner(node) + ')');
        node.kids.forEach(walk);
    })(form);
    return refs;
}

function setAttribute(xml, params) {
    params = params || {};
    return setMember(xml, params, {
        section: 'Attributes', tag: 'Attribute', pool: 'attribute', what: 'реквизита', accusative: 'реквизит', skeletonFields: ['type'], keepEmpty: true,
        order: ATTRIBUTE_ORDER,
        references: dataPathReferences,
        note: 'Тип реквизита по метаданным конфигурации не проверяется.',
        skeleton: function (pad, eol, args) {
            if (!args.type) throw new Error('Для нового реквизита передайте type.');
            return pad + '<Type>' + eol + typeBody(args.type, pad + '\t', eol) + pad + '</Type>' + eol;
        },
        fields: [
            { key: 'title', tag: 'Title', kind: 'localString' },
            { key: 'type', tag: 'Type', kind: 'type' },
            { key: 'main', tag: 'MainAttribute', kind: 'boolean' },
            { key: 'saved_data', tag: 'SavedData', kind: 'boolean' },
            { key: 'fill_check', tag: 'FillCheck', kind: 'enum', values: ['ShowError', 'DontCheck'] }
        ]
    });
}

function setCommand(xml, params) {
    params = params || {};
    return setMember(xml, params, {
        section: 'Commands', tag: 'Command', pool: 'command', what: 'команды', accusative: 'команду', skeletonFields: ['action'],
        order: COMMAND_ORDER,
        references: commandReferences,
        note: 'Процедура-обработчик в модуле формы не создаётся.',
        skeleton: function (pad, eol, args) {
            return args.action ? pad + '<Action>' + encodeText(String(args.action)) + '</Action>' + eol : '';
        },
        fields: [
            { key: 'title', tag: 'Title', kind: 'localString' },
            { key: 'tooltip', tag: 'ToolTip', kind: 'localString' },
            { key: 'shortcut', tag: 'Shortcut', kind: 'string' },
            { key: 'action', tag: 'Action', kind: 'string' },
            { key: 'representation', tag: 'Representation', kind: 'enum', values: ['Auto', 'Text', 'Picture', 'TextPicture'] },
            { key: 'modifies_saved_data', tag: 'ModifiesSavedData', kind: 'boolean' },
            { key: 'current_row_use', tag: 'CurrentRowUse', kind: 'enum', values: ['Auto', 'Use', 'DontUse'] }
        ]
    });
}

/* ---------- Operations ---------- */

function setProperties(xml, params) {
    params = params || {};
    var props = params.properties;
    if (!props || typeof props !== 'object' || Array.isArray(props) || !Object.keys(props).length) {
        throw new Error('Передайте properties — объект «свойство → значение»; null возвращает свойство к значению по умолчанию.');
    }
    var eol = eolOf(xml);
    var changed = [];
    var kindName = findElement(scan(xml), params.element).name;
    Object.keys(props).forEach(function (prop) {
        /* Offsets move after each splice: rescan per property. */
        var form = scan(xml);
        var node = findElement(form, params.element);
        var r = setOne(xml, form, node, prop, props[prop], eol);
        xml = r.xml;
        if (r.changed) changed.push(prop);
    });
    scan(xml);
    return { xml: xml, result: { element: params.element || 'Form', kind: kindName, changed: changed } };
}

function moveElement(xml, params) {
    params = params || {};
    if (!params.element) throw new Error('Передайте element — имя перемещаемого элемента.');
    if (params.after && params.before) throw new Error('Укажите after или before, не оба.');
    if (!params.into && !params.after && !params.before) throw new Error('Укажите into (группа, страница, таблица или Form) и/или after/before.');
    var eol = eolOf(xml);
    var form = scan(xml);
    var node = findElement(form, params.element);
    if (node === form || !isItem(node)) throw new Error('«' + params.element + '» не элемент формы и не перемещается.');

    var anchorName = params.after || params.before;
    var anchor = anchorName ? findElement(form, anchorName) : null;
    if (anchor && (anchor === form || !isItem(anchor))) throw new Error('«' + anchorName + '» не элемент формы.');
    if (anchor === node) throw new Error('Элемент нельзя поставить относительно самого себя.');
    var container = params.into ? findElement(form, params.into) : anchor.parent.parent;
    if (anchor && anchor.parent.parent !== container) {
        throw new Error('«' + anchorName + '» лежит не в «' + (params.into || 'Form') + '», а в «' + (anchor.parent.parent.attrs.name || 'Form') + '».');
    }
    if (contains(node, container)) throw new Error('Элемент нельзя переместить внутрь самого себя.');
    if (!accepts(container, node)) {
        throw new Error(container.name + ' «' + (container.attrs.name || 'Form') + '» не может содержать ' + node.name + '.');
    }
    var fromContainer = node.parent.parent;
    if (container === fromContainer && !anchor && node.parent.kids.length === 1) return { xml: xml, result: { element: params.element, moved: false } };

    /* Cut the element with its whole lines. */
    var span = lineSpan(xml, node);
    var chunk = xml.slice(span[0], span[1]);
    var oldPad = indentOf(xml, node);
    var siblings = node.parent.kids.length;
    var removeFrom = span[0];
    var removeTo = span[1];
    if (siblings === 1) {
        /* Designer writes no empty ChildItems. */
        var box = lineSpan(xml, node.parent);
        removeFrom = box[0];
        removeTo = box[1];
    }

    var childItems = kid(container, 'ChildItems');
    var newPad;
    var insertAt;
    var insertText;
    if (childItems && !(childItems === node.parent && siblings === 1)) {
        newPad = indentOf(xml, childItems) + '\t';
        if (anchor) {
            var anchorSpan = lineSpan(xml, anchor);
            insertAt = params.after ? anchorSpan[1] : anchorSpan[0];
        } else {
            insertAt = lineStart(xml, childItems.closeStart);
        }
        insertText = reindent(chunk, oldPad, newPad, eol);
    } else {
        var cPad = container === form ? '\t' : indentOf(xml, container) + '\t';
        newPad = cPad + '\t';
        insertText = cPad + '<ChildItems>' + eol + reindent(chunk, oldPad, newPad, eol) + cPad + '</ChildItems>' + eol;
        if (container.closeStart < 0) throw new Error('У «' + container.attrs.name + '» нет вложенных узлов; сначала откройте его в конфигураторе.');
        /* ChildItems is the last structure node, except that a form keeps
         * Attributes, Commands and the rest after it. */
        var after = null;
        for (var i = 0; i < container.kids.length; i++) {
            var k = container.kids[i];
            if (container === form ? { Attributes: 1, Commands: 1, Parameters: 1, CommandInterface: 1, CommandSet: 1, ConditionalAppearance: 1 }[k.name] : false) { after = k; break; }
        }
        insertAt = after ? lineSpan(xml, after)[0] : lineStart(xml, container.closeStart);
    }

    if (insertAt >= removeFrom && insertAt <= removeTo) {
        /* Same place (e.g. after its own previous sibling). */
        if (insertAt === removeFrom || insertAt === removeTo) return { xml: xml, result: { element: params.element, moved: false } };
    }
    var out;
    if (insertAt > removeTo) {
        out = xml.slice(0, removeFrom) + xml.slice(removeTo, insertAt) + insertText + xml.slice(insertAt);
    } else {
        out = xml.slice(0, insertAt) + insertText + xml.slice(insertAt, removeFrom) + xml.slice(removeTo);
    }
    scan(out);
    return {
        xml: out,
        result: {
            element: params.element,
            moved: true,
            from: fromContainer.attrs.name || 'Form',
            into: container.attrs.name || 'Form'
        }
    };
}

/* Places outside the element that name it: standard commands of the item and
 * conditional appearance fields. Module code (Элементы.Имя) is not visible here. */
function referencesTo(xml, form, node) {
    var names = {};
    (function walk(n) {
        if (n.attrs.name != null && n.attrs.id != null) names[n.attrs.name] = n;
        n.kids.forEach(walk);
    })(node);
    var refs = [];
    (function walk(n) {
        if (n === node) return;
        if (n.name === 'CommandName') {
            var m = /^Form\.Item\.([^.]+)\./.exec(n.text.trim());
            if (m && names[m[1]]) refs.push({ node: 'CommandName', value: n.text.trim(), owner: owner(n) });
        }
        if (n.tag === 'dcsset:field' && names[n.text.trim()]) {
            refs.push({ node: 'ConditionalAppearance', value: n.text.trim(), owner: 'Form' });
        }
        n.kids.forEach(walk);
    })(form);
    return refs;
}
function owner(n) {
    for (var p = n.parent; p; p = p.parent) if (p.attrs && p.attrs.name != null && p.attrs.id != null) return p.attrs.name;
    return 'Form';
}

function removeElement(xml, params) {
    params = params || {};
    if (!params.element) throw new Error('Передайте element — имя удаляемого элемента.');
    var form = scan(xml);
    var node = findElement(form, params.element);
    if (node === form || !isItem(node)) throw new Error('«' + params.element + '» не элемент формы и не удаляется отдельно.');
    var refs = referencesTo(xml, form, node);
    if (refs.length && !params.force) {
        throw new Error('На «' + params.element + '» ссылаются: ' + refs.map(function (r) { return r.node + ' ' + r.value + ' (' + r.owner + ')'; }).join('; ')
            + '. Уберите ссылки или передайте force=true.');
    }
    var handlers = [];
    (function walk(n) {
        if (n.name === 'Event' && n.parent && n.parent.name === 'Events') handlers.push(n.text.trim());
        n.kids.forEach(walk);
    })(node);
    var removed = 0;
    (function walk(n) { if (n.attrs.name != null && n.attrs.id != null) removed++; n.kids.forEach(walk); })(node);
    var span = node.parent.kids.length === 1 ? lineSpan(xml, node.parent) : lineSpan(xml, node);
    var out = splice(xml, span[0], span[1], '');
    scan(out);
    return {
        xml: out,
        result: {
            element: params.element,
            removedNodes: removed,
            references: refs.length ? refs : undefined,
            orphanHandlers: handlers.length ? handlers : undefined,
            note: 'Обращения из модуля формы (Элементы.' + params.element + ') не проверяются.'
        }
    };
}

/* Compact outline for the agent: item tree with kinds and data paths. */
function listElements(xml) {
    var form = scan(xml);
    var out = [];
    (function walk(n, depth) {
        var items = kid(n, 'ChildItems');
        if (!items) return;
        items.kids.forEach(function (k) {
            var dp = kid(k, 'DataPath');
            out.push({ name: k.attrs.name, kind: k.name, depth: depth, parent: n === form ? 'Form' : n.attrs.name, dataPath: dp ? dp.text.trim() : undefined });
            walk(k, depth + 1);
        });
    })(form, 0);
    return { version: form.attrs.version, elements: out };
}

root.FormEdit = {
    addElement: addElement,
    setAttribute: setAttribute,
    setCommand: setCommand,
    setProperties: setProperties,
    moveElement: moveElement,
    removeElement: removeElement,
    listElements: listElements,
    _scan: scan
};
})(typeof window !== 'undefined' ? window : globalThis);
