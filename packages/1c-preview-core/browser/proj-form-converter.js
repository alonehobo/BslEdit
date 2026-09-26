(function (root) {
'use strict';

var PROJ_NS = 'http://g5.1c.ru/v8/dt/form';
var LOGFORM_NS = 'http://v8.1c.ru/8.3/xcf/logform';
var V8_NS = 'http://v8.1c.ru/8.1/data/core';
var XSI_NS = 'http://www.w3.org/2001/XMLSchema-instance';
var XR_NS = 'http://v8.1c.ru/8.3/xcf/readable';
var ITEM_TAGS = {
    InputField: 1, CheckBoxField: 1, RadioButtonField: 1, LabelField: 1,
    LabelDecoration: 1, PictureField: 1, PictureDecoration: 1, Table: 1,
    UsualGroup: 1, ColumnGroup: 1, Pages: 1, Page: 1, Button: 1,
    ButtonGroup: 1, Popup: 1, CommandBar: 1, AutoCommandBar: 1,
    CalendarField: 1, FormattedDocumentField: 1, ProgressBarField: 1,
    TrackBarField: 1, GanttChart: 1, SpreadSheetDocumentField: 1,
    ChartField: 1, DendrogramField: 1, PlannerField: 1, HTMLDocumentField: 1,
    PdfDocumentField: 1, GeographicSchemaField: 1, GraphicalSchemaField: 1,
    TextDocumentField: 1, PeriodField: 1, SearchControl: 1,
    SearchStringAddition: 1, SearchControlAddition: 1, ViewStatusAddition: 1
};
var ROOT_COLLECTIONS = {
    attributes: ['Attributes', 'Attribute'],
    commands: ['Commands', 'Command'],
    formCommands: ['Commands', 'Command'],
    events: ['Events', 'Event'],
    parameters: ['Parameters', 'Parameter'],
    items: ['ChildItems', 'item']
};
var NAME_OVERRIDES = {
    dataPath: 'DataPath', datapath: 'DataPath', valueType: 'Type', extendedTooltip: 'ExtendedTooltip',
    contextMenu: 'ContextMenu', autoCommandBar: 'AutoCommandBar',
    showTitle: 'ShowTitle', horStretch: 'HorizontalStretch', verStretch: 'VerticalStretch',
    horCompress: 'HorizontalCompress', verCompress: 'VerticalCompress',
    commandName: 'CommandName', buttonImportance: 'ButtonImportance',
    formType: 'FormType', titleLocation: 'TitleLocation',
    readOnly: 'ReadOnly', minValue: 'MinValue', maxValue: 'MaxValue',
    useQuickChoice: 'UseQuickChoice', choiceButton: 'ChoiceButton',
    choiceButtonPicture: 'ChoiceButtonPicture', choiceList: 'ChoiceList',
    choiceParameterLinks: 'ChoiceParameterLinks', choiceParameters: 'ChoiceParameters',
    defaultButton: 'DefaultButton', commandSet: 'CommandSet',
    numberQualifiers: 'v8:NumberQualifiers', stringQualifiers: 'v8:StringQualifiers',
    dateQualifiers: 'v8:DateQualifiers', precision: 'v8:Digits', scale: 'v8:FractionDigits',
    allowedSign: 'v8:AllowedSign', length: 'v8:Length', allowedLength: 'v8:AllowedLength',
    dateFractions: 'v8:DateFractions', modifiesStoredData: 'ModifiesSavedData', editMode: 'AutoEditMode',
    autoFill: 'Autofill', hyperlink: 'Hiperlink', common: 'xr:Common'
};
var TYPE_OVERRIDES = {
    Boolean: 'xs:boolean', Date: 'xs:dateTime', Number: 'xs:decimal', String: 'xs:string',
    ValueList: 'v8:ValueList', ValueTable: 'v8:ValueTable', ValueTree: 'v8:ValueTree'
};
var ITEM_TYPE_OVERRIDES = {
    Label: 'LabelDecoration', Picture: 'PictureDecoration',
    SpreadsheetDocumentField: 'SpreadSheetDocumentField',
    PDFDocumentField: 'PdfDocumentField', GeographicalSchemaField: 'GeographicSchemaField'
};
var unsupportedStructure = false;

function localName(node) {
    var value = node && (node.localName || node.nodeName) || '';
    var colon = value.indexOf(':');
    return colon < 0 ? value : value.slice(colon + 1);
}

function children(node, name) {
    var result = [];
    if (!node) return result;
    for (var i = 0; i < node.children.length; i++)
        if (!name || localName(node.children[i]) === name) result.push(node.children[i]);
    return result;
}

function first(node, name) { return children(node, name)[0] || null; }
function text(node) { return node ? String(node.textContent || '').trim() : ''; }

function xmlEscape(value) {
    return String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function tagName(name) {
    if (NAME_OVERRIDES[name]) return NAME_OVERRIDES[name];
    return String(name || '').replace(/(^|[-_])([a-z])/g, function (_, lead, letter) {
        return letter.toUpperCase();
    }).replace(/^([a-z])/, function (letter) { return letter.toUpperCase(); });
}

function writeTag(name, value, attributes) {
    var attrs = '';
    Object.keys(attributes || {}).forEach(function (key) {
        attrs += ' ' + key + '="' + xmlEscape(attributes[key]) + '"';
    });
    if (value == null || value === '') return '<' + name + attrs + '/>';
    return '<' + name + attrs + '>' + value + '</' + name + '>';
}

function dataPathValue(node) {
    var segments = children(node, 'segments').map(text).filter(Boolean);
    if (!segments.length) return text(node);
    return segments.join('.');
}

function typeValue(node) {
    var values = children(node, 'types').map(text).filter(Boolean);
    if (!values.length) values = children(node, 'type').map(text).filter(Boolean);
    return values.map(function (value) {
        if (TYPE_OVERRIDES[value]) return TYPE_OVERRIDES[value];
        return /^(?:cfg|v8|xs):/i.test(value) ? value : 'cfg:' + value;
    });
}

function typeMarkup(node) {
    var body = typeValue(node).map(function (value) {
        return writeTag('v8:Type', xmlEscape(value));
    }).join('');
    var qualifiers = {
        stringQualifiers: 'v8:StringQualifiers',
        numberQualifiers: 'v8:NumberQualifiers',
        dateQualifiers: 'v8:DateQualifiers'
    };
    Object.keys(qualifiers).forEach(function (sourceName) {
        var qualifier = first(node, sourceName);
        if (!qualifier) return;
        var fields = children(qualifier).map(function (field) {
            var key = localName(field);
            var mapped = { precision: 'Digits', scale: 'FractionDigits',
                nonNegative: 'AllowedSign', dateFractions: 'DateFractions' }[key] || tagName(key);
            var value = text(field);
            if (key === 'nonNegative') value = value === 'true' ? 'Nonnegative' : 'Any';
            return writeTag('v8:' + mapped, xmlEscape(value));
        }).join('');
        body += writeTag(qualifiers[sourceName], fields);
    });
    return writeTag('Type', body);
}

function localString(node) {
    var keys = children(node, 'key');
    var values = children(node, 'value');
    if (keys.length && values.length) {
        var entries = [];
        for (var entry = 0; entry < Math.min(keys.length, values.length); entry++) {
            entries.push({ lang: text(keys[entry]) || 'ru', content: text(values[entry]) });
        }
        return entries;
    }
    var items = children(node, 'item');
    if (!items.length) return null;
    if (!items.some(function (item) { return !!first(item, 'lang') || !!first(item, 'content'); })) return null;
    var result = [];
    for (var i = 0; i < items.length; i++) {
        var lang = text(first(items[i], 'lang'));
        var content = text(first(items[i], 'content'));
        if (!content) continue;
        result.push({ lang: lang || 'ru', content: content });
    }
    return result;
}

function localizedMarkup(value) {
    return writeTag('v8:item', writeTag('v8:lang', xmlEscape(value.lang))
        + writeTag('v8:content', xmlEscape(value.content)));
}

function localizedMarkups(values) {
    return values.map(localizedMarkup).join('');
}

function convertEvent(node) {
    var attrs = {};
    var eventName = text(first(node, 'event'));
    var handlerName = text(first(node, 'name'));
    if (eventName) attrs.name = eventName;
    return writeTag('Event', xmlEscape(handlerName), attrs);
}

function scalarOrStructured(node, name) {
    var value = localName(node) === 'dataPath' ? dataPathValue(node) : text(node);
    if (localName(node) === 'valueType') {
        return typeMarkup(node);
    }
    var translatedString = localString(node);
    if (translatedString !== null) return localizedMarkups(translatedString);
    if (!children(node).length) return xmlEscape(value);
    var inner = children(node).map(function (child) { return convertProperty(child); }).join('');
    var xsiType = node.getAttributeNS && node.getAttributeNS(XSI_NS, 'type');
    var typeAttr = xsiType ? { 'xsi:type': xsiType.replace(/^.*:/, '') } : null;
    return writeTag(name, inner, typeAttr);
}

function convertPropertyChildren(node, commandBar, skipHandlers) {
    var body = '';
    var childItemsDone = false;
    var eventsDone = false;
    var fields = children(node);
    var consumed = [];
    fields.forEach(function (child, index) {
        if (consumed[index]) return;
        var key = localName(child);
        var localized = localString(child);
        if (localized !== null) {
            var localizedItems = localized.slice();
            consumed[index] = true;
            for (var sibling = index + 1; sibling < fields.length; sibling++) {
                if (localName(fields[sibling]) !== key) continue;
                var translation = localString(fields[sibling]);
                if (translation === null) continue;
                localizedItems = localizedItems.concat(translation);
                consumed[sibling] = true;
            }
            body += writeTag(tagName(key), localizedMarkups(localizedItems));
            return;
        }
        if (key === 'name' || key === 'id' || key === 'type') return;
        if (key === 'handlers' || key === 'events') {
            if (eventsDone) return;
            eventsDone = true;
            if (skipHandlers && key === 'handlers') return;
            var handlers = children(node, 'handlers').map(convertEvent);
            children(node, 'events').forEach(function (eventList) {
                handlers = handlers.concat(children(eventList, 'event').map(convertEvent));
            });
            body += writeTag('Events', handlers.join(''));
            return;
        }
        if (key === 'items') {
            if (childItemsDone) return;
            childItemsDone = true;
            var nested = children(node, 'items').map(function (entry) {
                return convertItem(entry, commandBar);
            });
            if (nested.some(function (item) { return item === null; })) {
                unsupportedStructure = true;
                return;
            }
            body += writeTag('ChildItems', nested.join(''));
            return;
        }
        body += convertProperty(child);
    });
    return body;
}

function convertProperty(node) {
    var sourceName = localName(node);
    var possibleItemKind = tagName(sourceName);
    if (possibleItemKind === 'SearchStringAddition' || possibleItemKind === 'ViewStatusAddition'
            || possibleItemKind === 'SearchControlAddition')
        return convertItem(node, false, possibleItemKind);
    if (sourceName === 'items') return '';
    if (sourceName === 'group') {
        var groupValue = text(node);
        var groupTag = groupValue === 'Usual' || groupValue === 'Collapsible' ? 'Behavior' : 'Group';
        return writeTag(groupTag, xmlEscape(groupValue));
    }
    if (sourceName === 'columns') return convertColumn(node);
    if (sourceName === 'additionalColumns') return convertAdditionalColumns(node);
    if (sourceName === 'type' || sourceName === 'name' || sourceName === 'id') return '';
    if (sourceName === 'dataPath') return writeTag('DataPath', xmlEscape(dataPathValue(node)));
    if (sourceName === 'valueType') return scalarOrStructured(node, 'Type');
    var name = tagName(sourceName);
    if (sourceName === 'extInfo') {
        return convertPropertyChildren(node, false);
    }
    if (sourceName === 'segments') return '';
    if (sourceName === 'types') return writeTag('v8:Type', xmlEscape(typeValue(node)[0] || text(node)));
    var localized = localString(node);
    if (localized !== null) return writeTag(name, localizedMarkups(localized));
    var nested = children(node);
    if (!nested.length) return writeTag(name, xmlEscape(text(node)));
    var attrs = {};
    nested.forEach(function (child) {
        var childName = localName(child);
        if (childName === 'name' || childName === 'id') {
            var value = text(child);
            if (value) attrs[childName] = value;
        }
    });
    var body = convertPropertyChildren(node, sourceName === 'autoCommandBar');
    var xsiType = node.getAttributeNS && node.getAttributeNS(XSI_NS, 'type');
    if (xsiType) attrs['xsi:type'] = xsiType.replace(/^.*:/, '');
    return writeTag(name, body, attrs);
}

function itemKind(item) {
    var explicit = text(first(item, 'type'));
    if (ITEM_TAGS[explicit]) return explicit;
    var xsiType = item.getAttributeNS && item.getAttributeNS(XSI_NS, 'type') || '';
    var suffix = xsiType.replace(/^.*:/, '');
    if (ITEM_TYPE_OVERRIDES[explicit]) return ITEM_TYPE_OVERRIDES[explicit];
    if (suffix === 'FormGroup' || suffix === 'Decoration' || suffix === 'Addition') {
        var extInfo = first(item, 'extInfo');
        var extType = extInfo && extInfo.getAttributeNS && extInfo.getAttributeNS(XSI_NS, 'type') || '';
        var groupKind = extType.replace(/^.*:/, '').replace(/ExtInfo$/, '');
        if (ITEM_TAGS[groupKind]) return groupKind;
    }
    return ITEM_TAGS[suffix] ? suffix : '';
}

function convertItem(item, commandBar, knownKind) {
    var kind = knownKind || itemKind(item);
    if (!kind) return null;
    var name = text(first(item, 'name'));
    var id = text(first(item, 'id'));
    var attrs = {};
    if (name) attrs.name = name;
    if (id) attrs.id = id;
    var body = commandBar && kind === 'Button' ? writeTag('Type', 'CommandBarButton') : '';
    if (kind === 'UsualGroup') {
        var groupInfo = first(item, 'extInfo');
        if (!groupInfo || !first(groupInfo, 'behavior')) body += writeTag('Behavior', 'Usual');
        if (!first(groupInfo, 'showTitle')) body += writeTag('ShowTitle', 'false');
    }
    if (kind === 'SearchStringAddition' || kind === 'ViewStatusAddition' || kind === 'SearchControlAddition') {
        var source = first(item, 'source');
        if (source) {
            var additionType = kind === 'SearchStringAddition' ? 'SearchStringRepresentation'
                : kind === 'ViewStatusAddition' ? 'ViewStatusRepresentation' : 'SearchControl';
            body += writeTag('AdditionSource', writeTag('Item', xmlEscape(text(source)))
                + writeTag('Type', additionType));
        }
        children(item).forEach(function (child) {
            var key = localName(child);
            if (key !== 'name' && key !== 'id' && key !== 'type' && key !== 'source')
                body += convertProperty(child);
        });
    } else {
        body += convertPropertyChildren(item, commandBar);
    }
    return writeTag(kind, body, attrs);
}

function convertNamed(item, tag) {
    var name = text(first(item, 'name'));
    var id = text(first(item, 'id'));
    var attrs = {};
    if (name) attrs.name = name;
    if (id) attrs.id = id;
    var body = '';
    var columns = children(item, 'columns');
    var additionalColumns = children(item, 'additionalColumns');
    var fields = children(item), consumed = [];
    fields.forEach(function (child, index) {
        if (consumed[index]) return;
        var key = localName(child);
        if (key !== 'name' && key !== 'id' && key !== 'type'
                && key !== 'columns' && key !== 'additionalColumns') {
            var localized = localString(child);
            if (localized === null) {
                body += convertProperty(child);
                return;
            }
            var localizedItems = localized.slice();
            consumed[index] = true;
            for (var sibling = index + 1; sibling < fields.length; sibling++) {
                if (localName(fields[sibling]) !== key) continue;
                var translation = localString(fields[sibling]);
                if (translation === null) continue;
                localizedItems = localizedItems.concat(translation);
                consumed[sibling] = true;
            }
            body += writeTag(tagName(key), localizedMarkups(localizedItems));
        }
    });
    if (columns.length || additionalColumns.length) {
        var columnXml = columns.map(convertColumn).join('')
            + additionalColumns.map(convertAdditionalColumns).join('');
        body += writeTag('Columns', columnXml);
    }
    return writeTag(tag, body, attrs);
}

function convertColumn(node) {
    var name = text(first(node, 'name'));
    var id = text(first(node, 'id'));
    var attrs = {};
    if (name) attrs.name = name;
    if (id) attrs.id = id;
    return writeTag('Column', convertPropertyChildren(node, false), attrs);
}

function convertAdditionalColumns(node) {
    var tablePath = first(node, 'tablePath');
    var table = tablePath ? dataPathValue(tablePath) : '';
    var attrs = table ? { table: table } : {};
    var columns = children(node, 'columns').map(convertColumn).join('');
    return writeTag('AdditionalColumns', columns, attrs);
}

function convert(xml) {
    unsupportedStructure = false;
    if (typeof xml !== 'string' || !xml) return { ok: false, reason: 'empty' };
    xml = xml.replace(/^\uFEFF/, '');
    var document;
    try { document = new DOMParser().parseFromString(xml, 'application/xml'); }
    catch (_) { return { ok: false, reason: 'parse' }; }
    if (document.querySelector('parsererror')) return { ok: false, reason: 'parse' };
    var source = document.documentElement;
    if (!source || localName(source) !== 'Form') return { ok: false, reason: 'not-form' };
    if (source.namespaceURI === LOGFORM_NS || !source.namespaceURI) return { ok: true, xml: xml, format: 'logform' };
    if (source.namespaceURI !== PROJ_NS) return { ok: false, reason: 'unknown-format' };

    var version = source.getAttribute('version') || text(first(source, 'version'));
    var rootName = text(first(source, 'name'));
    var rootAttrs = {};
    if (rootName) rootAttrs.name = rootName;
    if (version) rootAttrs.version = version;
    var body = '';
    var rootItems = children(source, 'items').map(function (item) { return convertItem(item, false); });
    if (rootItems.some(function (item) { return item === null; }))
        return { ok: false, reason: 'unsupported-item' };
    if (rootItems.length) body += writeTag('ChildItems', rootItems.join(''));
    var rootCollections = {};
    Object.keys(ROOT_COLLECTIONS).forEach(function (key) {
        if (key === 'items') return;
        var collection = ROOT_COLLECTIONS[key];
        var entries = children(source, key).map(function (entry) {
            return key === 'events' ? convertEvent(entry) : convertNamed(entry, collection[1]);
        });
        if (entries.length) rootCollections[collection[0]] = (rootCollections[collection[0]] || '') + entries.join('');
    });
    Object.keys(rootCollections).forEach(function (name) {
        body += writeTag(name, rootCollections[name]);
    });
    var excludedCommands = children(source, 'excludedCommands');
    if (excludedCommands.length) body += writeTag('CommandSet', excludedCommands.map(function (entry) {
        return writeTag('ExcludedCommand', xmlEscape(text(entry)));
    }).join(''));
    var rootExtInfo = first(source, 'extInfo');
    var rootEvents = children(source, 'handlers').map(convertEvent);
    if (rootExtInfo) rootEvents = rootEvents.concat(children(rootExtInfo, 'handlers').map(convertEvent));
    if (rootEvents.length) body += writeTag('Events', rootEvents.join(''));
    children(source).forEach(function (child) {
        var key = localName(child);
        if (key !== 'items' && key !== 'attributes' && key !== 'commands' && key !== 'formCommands'
                && key !== 'events' && key !== 'handlers' && key !== 'parameters' && key !== 'excludedCommands'
                && key !== 'name' && key !== 'version' && key !== 'id') {
            body += key === 'extInfo' ? convertPropertyChildren(child, false, true)
                : convertProperty(child);
        }
    });
    if (unsupportedStructure || body.indexOf('<UNSUPPORTED_PROJ_ITEMS') >= 0)
        return { ok: false, reason: 'unsupported-item' };
    var result = '<?xml version="1.0" encoding="UTF-8"?>\n'
        + writeTag('Form', body, Object.assign({
            xmlns: LOGFORM_NS,
            'xmlns:v8': V8_NS,
            'xmlns:xr': XR_NS,
            'xmlns:xsi': XSI_NS
        }, rootAttrs));
    return { ok: true, xml: result, format: 'proj' };
}

root.ProjFormConverter = { convert: convert };
})(typeof window !== 'undefined' ? window : globalThis);
