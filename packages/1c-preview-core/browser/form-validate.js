/* Structural validation of a 1C managed form (Ext/Form.xml): unique ids and
 * names, companion elements, data paths, command references, event handlers,
 * main attribute, title, types, namespace prefixes and format version. Used by
 * the MCP tool validate_form, so an agent checks a generated or edited form
 * before loading it into the platform.
 *
 * Works on the XML text in the browser and in Node alike, without a DOM.
 *
 * Ported from form-validate v1.19 of cc-1c-skills:
 *   https://github.com/Nikolay-Shirokov/cc-1c-skills
 *   Copyright (c) 2025-2026 Nick Shirokov
 *   Licensed under the MIT License:
 *
 *   Permission is hereby granted, free of charge, to any person obtaining a copy
 *   of this software and associated documentation files (the "Software"), to deal
 *   in the Software without restriction, including without limitation the rights
 *   to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 *   copies of the Software, and to permit persons to whom the Software is
 *   furnished to do so, subject to the following conditions:
 *
 *   The above copyright notice and this permission notice shall be included in all
 *   copies or substantial portions of the Software.
 *
 *   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 *   IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 *   FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 *   AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 *   LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 *   OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 *   SOFTWARE.
 *
 * Differences from the original: extension forms (BaseForm) get one info
 * instead of the extension checks; checks that need the file location (format
 * version of the dump, External* types in a configuration) take it from
 * options; see validateForm. */
(function (root) {
'use strict';

var F_NS = 'http://v8.1c.ru/8.3/xcf/logform';
var V8_NS = 'http://v8.1c.ru/8.1/data/core';
var XSI_NS = 'http://www.w3.org/2001/XMLSchema-instance';
var XML_NS = 'http://www.w3.org/XML/1998/namespace';

var FORMAT_VERIFIED_MIN = '2.17';
var FORMAT_VERIFIED_MAX = '2.21';

var KNOWN_INVALID_TYPES = set([
    'FormDataStructure', 'FormDataCollection', 'FormDataTree',
    'FormDataTreeItem', 'FormDataCollectionItem',
    'FormGroup', 'FormField', 'FormButton', 'FormDecoration', 'FormTable'
]);

var VALID_CFG_PREFIXES = set([
    'AccountingRegisterRecordSet', 'AccumulationRegisterRecordSet',
    'BusinessProcessObject', 'BusinessProcessRef',
    'CatalogObject', 'CatalogRef',
    'ChartOfAccountsObject', 'ChartOfAccountsRef',
    'ChartOfCalculationTypesObject', 'ChartOfCalculationTypesRef',
    'ChartOfCharacteristicTypesObject', 'ChartOfCharacteristicTypesRef',
    'ConstantsSet', 'DataProcessorObject', 'DocumentObject', 'DocumentRef',
    'DynamicList', 'EnumRef', 'ExchangePlanObject', 'ExchangePlanRef',
    'ExternalDataProcessorObject', 'ExternalReportObject',
    'ExternalDataSourceTableObject', 'ExternalDataSourceTableRef',
    'ExternalDataSourceTableRecordManager',
    'InformationRegisterRecordManager', 'InformationRegisterRecordSet',
    'ReportObject', 'TaskObject', 'TaskRef'
]);

var COMPANIONS = {
    InputField: ['ContextMenu', 'ExtendedTooltip'],
    CheckBoxField: ['ContextMenu', 'ExtendedTooltip'],
    LabelDecoration: ['ContextMenu', 'ExtendedTooltip'],
    LabelField: ['ContextMenu', 'ExtendedTooltip'],
    PictureDecoration: ['ContextMenu', 'ExtendedTooltip'],
    PictureField: ['ContextMenu', 'ExtendedTooltip'],
    CalendarField: ['ContextMenu', 'ExtendedTooltip'],
    UsualGroup: ['ExtendedTooltip'],
    Pages: ['ExtendedTooltip'],
    Page: ['ExtendedTooltip'],
    Button: ['ExtendedTooltip'],
    Table: ['ContextMenu', 'AutoCommandBar', 'SearchStringAddition', 'ViewStatusAddition', 'SearchControlAddition']
};

var BINDING_TAGS = ['DataPath', 'TitleDataPath', 'FooterDataPath', 'HeaderDataPath',
    'MultipleValueDataPath', 'MultipleValuePresentDataPath', 'RowPictureDataPath', 'MultipleValuePictureDataPath'];

var COMPANION_TAGS = set(['ContextMenu', 'ExtendedTooltip', 'AutoCommandBar',
    'SearchStringAddition', 'ViewStatusAddition', 'SearchControlAddition']);

function set(list) {
    var s = Object.create(null);
    list.forEach(function (x) { s[x] = true; });
    return s;
}
function has(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
}

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

/* Element: { tag, prefix, name (local), ns, scope (prefix -> uri), attrs: {qname: value}, kids, text }.
 * Throws with a Russian message when the document is not well formed. */
function parse(xml) {
    xml = String(xml);
    if (xml.charCodeAt(0) === 0xFEFF) xml = xml.slice(1);
    var doc = { tag: '#document', name: '#document', scope: { xml: XML_NS }, attrs: {}, kids: [], text: '' };
    var stack = [doc];
    var re = /<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[^\s=\/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<[?!][\s\S]*?>|([^<]+)|(<)/g;
    var m;
    while ((m = re.exec(xml))) {
        var top = stack[stack.length - 1];
        if (m[7] != null) throw new Error('Некорректный XML: неразобранный символ "<" в позиции ' + m.index + '.');
        if (m[6] != null) {
            if (stack.length === 1) {
                if (/\S/.test(m[6])) throw new Error('Некорректный XML: текст вне корневого элемента.');
                continue;
            }
            top.text += decode(m[6]);
            continue;
        }
        if (m[5] != null) { top.text += m[5]; continue; }
        if (!m[2]) continue;
        if (m[1]) {
            if (stack.length === 1 || top.tag !== m[2]) {
                throw new Error('Некорректный XML: закрывающий тег </' + m[2] + '> не соответствует ' +
                    (stack.length === 1 ? 'открытому элементу' : '<' + top.tag + '>') + '.');
            }
            stack.pop();
            continue;
        }
        if (stack.length === 1 && doc.kids.length) throw new Error('Некорректный XML: больше одного корневого элемента.');
        var attrs = Object.create(null);
        var scope = null;
        var ar = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
        var a;
        while ((a = ar.exec(m[3]))) {
            var value = decode(a[2] != null ? a[2] : a[3]);
            if (has(attrs, a[1])) throw new Error('Некорректный XML: атрибут ' + a[1] + ' повторяется в <' + m[2] + '>.');
            attrs[a[1]] = value;
            if (a[1] === 'xmlns' || a[1].indexOf('xmlns:') === 0) {
                if (!scope) scope = Object.create(top.scope);
                scope[a[1] === 'xmlns' ? '' : a[1].slice(6)] = value;
            }
        }
        var colon = m[2].indexOf(':');
        var el = {
            tag: m[2],
            prefix: colon < 0 ? '' : m[2].slice(0, colon),
            name: m[2].slice(colon + 1),
            scope: scope || top.scope,
            attrs: attrs,
            kids: [],
            text: ''
        };
        el.ns = el.scope[el.prefix];
        top.kids.push(el);
        if (!m[4]) stack.push(el);
    }
    if (stack.length > 1) throw new Error('Некорректный XML: не закрыт элемент <' + stack[stack.length - 1].tag + '>.');
    if (!doc.kids.length) throw new Error('Некорректный XML: нет корневого элемента.');
    return doc.kids[0];
}

function attr(el, name) {
    return el && has(el.attrs, name) ? el.attrs[name] : '';
}
/* Direct child in the form namespace (or another one), like lxml find(). */
function kid(el, name, ns) {
    ns = ns || F_NS;
    if (!el) return null;
    for (var i = 0; i < el.kids.length; i++) {
        if (el.kids[i].name === name && el.kids[i].ns === ns) return el.kids[i];
    }
    return null;
}
function kids(el, name, ns) {
    ns = ns || F_NS;
    return el ? el.kids.filter(function (k) { return k.name === name && k.ns === ns; }) : [];
}
function textOf(el) {
    return el ? el.text.trim() : '';
}
function walk(el, fn) {
    fn(el);
    el.kids.forEach(function (k) { walk(k, fn); });
}

function formatRank(ver) {
    var m = /^(\d+)\.(\d+)$/.exec(ver || '');
    return m ? parseInt(m[1], 10) * 100 + parseInt(m[2], 10) : 0;
}

/* ---------- validation ---------- */

/* validateForm(xml, options) -> { ok, errors, warnings, info, summary }
 * options (all optional, the file location is unknown to the validator):
 *   context: 'config' | 'external' — a configuration form rejects
 *            cfg:ExternalDataProcessorObject/ExternalReportObject types (check 12);
 *   formatVersion: version of the dump (Configuration.xml or the external
 *            processor root), compared with the form version (check 14). */
function validateForm(xml, options) {
    options = options || {};
    var errors = [];
    var warnings = [];
    var info = [];
    var summary = { elements: 0, attributes: 0, commands: 0 };

    function issue(list, code, message, element) {
        var entry = { code: code, message: message };
        if (element) entry.element = element;
        list.push(entry);
    }
    function error(code, message, element) { issue(errors, code, message, element); }
    function warn(code, message, element) { issue(warnings, code, message, element); }
    function result() {
        return { ok: errors.length === 0, errors: errors, warnings: warnings, info: info, summary: summary };
    }

    var form;
    try {
        form = parse(xml);
    } catch (e) {
        error('xml', e.message);
        return result();
    }

    /* Check 1: root element and version. */
    if (form.name !== 'Form') {
        error('root', 'Корневой элемент <' + form.tag + '>, ожидается <Form>.');
        return result();
    }
    if (form.ns !== F_NS) {
        warn('root', 'Корневой элемент <Form> не в пространстве имён ' + F_NS + '.');
    }
    var version = attr(form, 'version');
    var rank = formatRank(version);
    if (!version) {
        warn('formVersion', 'У формы нет атрибута version.');
    } else if (rank === 0) {
        error('formVersion', 'Неверная версия формата "' + version + '" (ожидается N.N).');
    } else if (rank < formatRank(FORMAT_VERIFIED_MIN) || rank > formatRank(FORMAT_VERIFIED_MAX)) {
        warn('formVersion', 'Версия формата ' + version + ' вне проверенного диапазона ' +
            FORMAT_VERIFIED_MIN + '–' + FORMAT_VERIFIED_MAX + '.');
    }

    var baseForm = kid(form, 'BaseForm');
    if (baseForm) {
        info.push({ code: 'extensionForm', message: 'Форма расширения (BaseForm): проверки расширения не выполнялись.' });
    }

    /* Check 2: AutoCommandBar. */
    var acb = kid(form, 'AutoCommandBar');
    if (acb) {
        var acbId = attr(acb, 'id');
        if (acbId === '-1') {
            /* the usual case */
        } else if (!has(acb.attrs, 'id')) {
            warn('autoCommandBar', 'У AutoCommandBar нет id, обычно "-1".', attr(acb, 'name') || undefined);
        } else if (/^-?\d+$/.test(acbId)) {
            warn('autoCommandBar', 'AutoCommandBar id="' + acbId + '", обычно "-1".', attr(acb, 'name') || undefined);
        } else {
            error('autoCommandBar', 'AutoCommandBar id="' + acbId + '" не число.', attr(acb, 'name') || undefined);
        }
    } else {
        error('autoCommandBar', 'Нет элемента AutoCommandBar.');
    }

    /* Collect elements with ids. */
    var elementIds = Object.create(null);
    var elementNames = Object.create(null);
    var elements = [];
    function collect(container) {
        container.kids.forEach(function (child) {
            if (child.ns !== F_NS) return;
            var name = attr(child, 'name');
            var id = attr(child, 'id');
            if (name && id) {
                elements.push({ name: name, tag: child.name, id: id, node: child });
                if (id !== '-1') {
                    if (elementIds[id] != null) {
                        error('duplicateElementId', 'Повторяется id=' + id + ' элементов "' + name + '" и "' + elementIds[id] + '".', name);
                    } else {
                        elementIds[id] = name;
                    }
                    if (elementNames[name] != null) {
                        /* An extension dump repeats names the platform itself wrote
                         * (seen in a real cfe), so there it is only a warning. */
                        (baseForm ? warn : error)('duplicateElementName', 'Повторяется имя элемента "' + name + '": id=' + id + ' и id=' + elementNames[name] + '.', name);
                    } else {
                        elementNames[name] = id;
                    }
                }
            }
            /* The original descends only into elements that have an id; a hand-written
             * form may leave groups without ids, so their items are checked too. */
            var nested = kid(child, 'ChildItems');
            if (nested && name) collect(nested);
        });
    }
    var rootItems = kid(form, 'ChildItems');
    if (rootItems) collect(rootItems);
    var acbItems = kid(acb, 'ChildItems');
    if (acbItems) collect(acbItems);
    summary.elements = elements.length;

    /* Check 3: attributes, their columns, commands and parameters. */
    var attrMap = Object.create(null);
    var attrIds = Object.create(null);
    var attrNodes = kids(kid(form, 'Attributes'), 'Attribute');
    attrNodes.forEach(function (node) {
        var name = attr(node, 'name');
        var id = attr(node, 'id');
        if (name) {
            if (attrMap[name]) {
                error('duplicateAttributeName', 'Повторяется имя реквизита "' + name + '": id=' + id + ' и id=' + attr(attrMap[name], 'id') + '.', name);
            }
            attrMap[name] = node;
        }
        if (id) {
            if (attrIds[id] != null) {
                error('duplicateAttributeId', 'Повторяется id=' + id + ' реквизитов "' + name + '" и "' + attrIds[id] + '".', name);
            } else {
                attrIds[id] = name;
            }
        }
        var colIds = Object.create(null);
        var colNames = Object.create(null);
        kids(kid(node, 'Columns'), 'Column').forEach(function (col) {
            var colId = attr(col, 'id');
            var colName = attr(col, 'name');
            if (colId) {
                if (colIds[colId] != null) {
                    error('duplicateColumnId', 'Реквизит "' + name + '": повторяется id=' + colId + ' колонок "' + colName + '" и "' + colIds[colId] + '".', name);
                } else {
                    colIds[colId] = colName;
                }
            }
            if (colName) {
                if (colNames[colName] != null) {
                    error('duplicateColumnName', 'Реквизит "' + name + '": повторяется имя колонки "' + colName + '": id=' + colId + ' и id=' + colNames[colName] + '.', name);
                } else {
                    colNames[colName] = colId;
                }
            }
        });
    });
    summary.attributes = attrNodes.length;

    var cmdMap = Object.create(null);
    var cmdIds = Object.create(null);
    var cmdNodes = kids(kid(form, 'Commands'), 'Command');
    cmdNodes.forEach(function (node) {
        var name = attr(node, 'name');
        var id = attr(node, 'id');
        if (name) {
            if (cmdMap[name]) {
                error('duplicateCommandName', 'Повторяется имя команды "' + name + '": id=' + id + ' и id=' + attr(cmdMap[name], 'id') + '.', name);
            }
            cmdMap[name] = node;
        }
        if (id) {
            if (cmdIds[id] != null) {
                error('duplicateCommandId', 'Повторяется id=' + id + ' команд "' + name + '" и "' + cmdIds[id] + '".', name);
            } else {
                cmdIds[id] = name;
            }
        }
    });
    summary.commands = cmdNodes.length;

    var paramNames = Object.create(null);
    kids(kid(form, 'Parameters'), 'Parameter').forEach(function (node) {
        var name = attr(node, 'name');
        if (!name) return;
        if (paramNames[name]) error('duplicateParameterName', 'Повторяется имя параметра "' + name + '".', name);
        paramNames[name] = true;
    });

    /* Check 4: companion elements. The platform builds a missing companion on
     * load, so this is a warning (the original reports an error). */
    elements.forEach(function (el) {
        var required = COMPANIONS[el.tag];
        if (!required) return;
        required.forEach(function (comp) {
            if (!kid(el.node, comp)) {
                warn('companion', el.tag + ' "' + el.name + '": нет сопутствующего элемента <' + comp + '>.', el.name);
            }
        });
    });

    /* Check 5: data paths start at a form attribute. */
    var tables = Object.create(null);
    elements.forEach(function (el) { if (el.tag === 'Table' && !tables[el.name]) tables[el.name] = el; });
    function stripPath(p) {
        p = p.replace(/\[\d+\]/g, '');
        return p.charAt(0) === '~' ? p.slice(1) : p;
    }
    elements.forEach(function (el) {
        if (COMPANION_TAGS[el.tag]) return;
        if (baseForm && /^-?\d+$/.test(el.id) && parseInt(el.id, 10) < 1000000) return;
        BINDING_TAGS.forEach(function (bTag) {
            var dataPath = textOf(kid(el.node, bTag));
            if (!dataPath) return;
            if (/^\d+$/.test(dataPath) || /^\d+\/\d+:[0-9a-fA-F-]+$/.test(dataPath)) return;
            var segments = stripPath(dataPath).split('.');
            var rootAttr = segments[0];
            var hops = 0;
            while (rootAttr === 'Items') {
                if (++hops > 10) return;
                if (segments.length < 3 || segments[2] !== 'CurrentData') {
                    warn('dataPath', el.tag + ' "' + el.name + '": ' + bTag + '="' + dataPath +
                        '" — неизвестная форма Items.*, ожидается Items.<Таблица>.CurrentData.*', el.name);
                    return;
                }
                var table = tables[segments[1]];
                if (!table) {
                    error('dataPath', el.tag + ' "' + el.name + '": ' + bTag + '="' + dataPath +
                        '" — нет таблицы "' + segments[1] + '".', el.name);
                    return;
                }
                var tablePath = textOf(kid(table.node, 'DataPath'));
                if (!tablePath) return;
                segments = stripPath(tablePath).split('.');
                rootAttr = segments[0];
            }
            if (!attrMap[rootAttr]) {
                error('dataPath', el.tag + ' "' + el.name + '": ' + bTag + '="' + dataPath +
                    '" — нет реквизита "' + rootAttr + '".', el.name);
            }
        });
    });

    /* Check 6: buttons refer to existing form commands. */
    elements.forEach(function (el) {
        if (el.tag !== 'Button') return;
        var ref = textOf(kid(el.node, 'CommandName'));
        var m = /^Form\.Command\.(.+)$/.exec(ref);
        if (m && !cmdMap[m[1]]) {
            error('commandName', 'Кнопка "' + el.name + '": CommandName="' + ref + '" — нет команды "' + m[1] + '".', el.name);
        }
    });

    /* Check 7: events have handler names. */
    kids(kid(form, 'Events'), 'Event').forEach(function (evt) {
        if (!textOf(evt)) error('eventHandler', 'Событие формы "' + attr(evt, 'name') + '": пустое имя обработчика.');
    });
    elements.forEach(function (el) {
        kids(kid(el.node, 'Events'), 'Event').forEach(function (evt) {
            if (!textOf(evt)) {
                error('eventHandler', el.tag + ' "' + el.name + '", событие "' + attr(evt, 'name') + '": пустое имя обработчика.', el.name);
            }
        });
    });

    /* Check 8: commands have actions (may be assigned at runtime, so a warning). */
    cmdNodes.forEach(function (node) {
        if (!textOf(kid(node, 'Action'))) {
            var name = attr(node, 'name');
            warn('commandAction', 'Команда "' + name + '": нет Action — обработчик должен назначаться программно, иначе команда ничего не делает.', name);
        }
    });

    /* Check 9: at most one main attribute. */
    var mainCount = attrNodes.filter(function (node) { return textOf(kid(node, 'MainAttribute')) === 'true'; }).length;
    if (mainCount > 1) {
        error('mainAttribute', 'Основных реквизитов (MainAttribute=true) ' + mainCount + ', допустимо не больше одного.');
    }

    /* Check 10: the form title is multilingual. A plain-text title is a warning
     * (the original reports an error): hand-written and preview forms use it. */
    var title = kid(form, 'Title');
    if (title && !kids(title, 'item', V8_NS).length && textOf(title)) {
        warn('title', 'Заголовок формы задан простым текстом ("' + textOf(title) + '"), выгрузка конфигуратора хранит его как <v8:item>.');
    }

    /* callType without BaseForm. */
    if (!baseForm) {
        var callType = kids(kid(form, 'Events'), 'Event').some(function (e) { return has(e.attrs, 'callType'); }) ||
            cmdNodes.some(function (c) { return kids(c, 'Action').some(function (a) { return has(a.attrs, 'callType'); }); });
        if (callType) warn('callType', 'Атрибуты callType без BaseForm — возможно, неверная структура формы.');
    }

    /* Check 12: type values. */
    walk(form, function (node) {
        if (node.name !== 'Type' || node.ns !== V8_NS) return;
        var tv = textOf(node);
        if (!tv) return;
        if (KNOWN_INVALID_TYPES[tv]) {
            error('type', 'Тип "' + tv + '" — прикладной тип времени выполнения, в XDTO-схеме формы недопустим.');
        } else if (tv.indexOf('cfg:') === 0) {
            var prefix = tv.slice(4).split('.')[0];
            if (!VALID_CFG_PREFIXES[prefix]) {
                warn('type', 'Тип "' + tv + '": неизвестный вид cfg-типа.');
            } else if (options.context === 'config' && (prefix === 'ExternalDataProcessorObject' || prefix === 'ExternalReportObject')) {
                error('type', 'Тип "' + tv + '": External*-тип в форме конфигурации (нужен DataProcessorObject/ReportObject).');
            }
        } else if (tv.indexOf(':') < 0) {
            warn('type', 'Тип "' + tv + '" без префикса пространства имён.');
        }
    });

    /* Check 13: prefixes used in type values are declared in scope. */
    var prefixRe = /^([A-Za-z_][A-Za-z0-9_.-]*):.+$/;
    walk(form, function (node) {
        var values = [];
        if (node.name === 'Type' || node.name === 'TypeSet') values.push(['Type', textOf(node)]);
        Object.keys(node.attrs).forEach(function (qn) {
            var c = qn.indexOf(':');
            if (c > 0 && qn.slice(c + 1) === 'type' && node.scope[qn.slice(0, c)] === XSI_NS) {
                values.push(['xsi:type', node.attrs[qn].trim()]);
            }
        });
        values.forEach(function (v) {
            var m = prefixRe.exec(v[1]);
            if (m && node.scope[m[1]] == null) {
                error('namespacePrefix', v[0] + ' "' + v[1] + '": префикс "' + m[1] + ':" не объявлен — платформа не прочитает файл (XDTO).');
            }
        });
    });

    /* Check 14: form version matches the dump. */
    if (options.formatVersion && version && version !== String(options.formatVersion)) {
        error('formatVersion', 'Версия формата формы ' + version + ' отличается от версии выгрузки ' + options.formatVersion +
            ' — платформа не загрузит файл другой версии.');
    }

    return result();
}

root.FormValidate = {
    validateForm: validateForm,
    _test: { parse: parse }
};

})(typeof window !== 'undefined' ? window : globalThis);
