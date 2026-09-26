(function (root) {
'use strict';

var MDO_NS = 'http://g5.1c.ru/v8/dt/metadata/mdclass';
var unsupportedValueType = false;
var TYPES = {
    String: 'xs:string', Number: 'xs:decimal', Date: 'xs:dateTime', Boolean: 'xs:boolean',
    CatalogRef: 'cfg:CatalogRef', DocumentRef: 'cfg:DocumentRef', EnumRef: 'cfg:EnumRef',
    ChartOfCharacteristicTypesRef: 'cfg:ChartOfCharacteristicTypesRef',
    ChartOfAccountsRef: 'cfg:ChartOfAccountsRef', ChartOfCalculationTypesRef: 'cfg:ChartOfCalculationTypesRef',
    ExchangePlanRef: 'cfg:ExchangePlanRef', BusinessProcessRef: 'cfg:BusinessProcessRef', TaskRef: 'cfg:TaskRef',
    DefinedType: 'cfg:DefinedType', AnyRef: 'v8:AnyRef', ValueStorage: 'v8:ValueStorage',
    UUID: 'v8:UUID', ValueList: 'v8:ValueList', ValueTable: 'v8:ValueTable', ValueTree: 'v8:ValueTree'
};
var SKIP_ROOT = {
    producedTypes: 1, standardAttributes: 1, characteristics: 1, attributes: 1, sessionParameters: 1,
    tabularSections: 1, forms: 1, commands: 1, templates: 1, enumValues: 1,
    dimensions: 1, resources: 1, columns: 1, recalculations: 1, basedOn: 1,
    registerRecords: 1, addressingAttributes: 1, accountingFlags: 1,
    extDimensionAccountingFlags: 1, operations: 1, urlTemplates: 1,
    integrationServiceChannels: 1, tables: 1, cubes: 1, functions: 1
};
/* Configuration.mdo keeps its top-level object index as typed references,
 * whereas Configuration.xml writes the object names under ChildObjects. */
var CONFIGURATION_OBJECTS = {
    subsystems: 'Subsystem', roles: 'Role', functionalOptions: 'FunctionalOption',
    functionalOptionsParameters: 'FunctionalOptionsParameter', languages: 'Language',
    catalogs: 'Catalog', documents: 'Document', documentJournals: 'DocumentJournal',
    enums: 'Enum', constants: 'Constant', reports: 'Report', dataProcessors: 'DataProcessor',
    informationRegisters: 'InformationRegister', accumulationRegisters: 'AccumulationRegister',
    accountingRegisters: 'AccountingRegister', calculationRegisters: 'CalculationRegister',
    chartsOfCharacteristicTypes: 'ChartOfCharacteristicTypes', chartsOfAccounts: 'ChartOfAccounts',
    chartsOfCalculationTypes: 'ChartOfCalculationTypes', businessProcesses: 'BusinessProcess',
    tasks: 'Task', exchangePlans: 'ExchangePlan', commonModules: 'CommonModule',
    commonCommands: 'CommonCommand', commonForms: 'CommonForm', commonTemplates: 'CommonTemplate',
    commonPictures: 'CommonPicture', commonAttributes: 'CommonAttribute', definedTypes: 'DefinedType',
    sessionParameters: 'SessionParameter',
    filterCriteria: 'FilterCriterion', commandGroups: 'CommandGroup', eventSubscriptions: 'EventSubscription',
    scheduledJobs: 'ScheduledJob', bots: 'Bot', settingsStorages: 'SettingsStorage',
    integrationServices: 'IntegrationService', wsReferences: 'WSReference', webServices: 'WebService',
    httpServices: 'HTTPService', xDTOPackages: 'XDTOPackage', styleItems: 'StyleItem', styles: 'Style',
    paletteColors: 'PaletteColor', sequences: 'Sequence', documentNumerators: 'DocumentNumerator',
    externalDataSources: 'ExternalDataSource', externalDataProcessors: 'ExternalDataProcessor',
    externalReports: 'ExternalReport'
};
Object.keys(CONFIGURATION_OBJECTS).forEach(function (key) { SKIP_ROOT[key] = 1; });
SKIP_ROOT.containedObjects = 1;
var GROUPS = {
    attributes: 'Attribute', tabularSections: 'TabularSection', forms: 'Form',
    commands: 'Command', templates: 'Template', enumValues: 'EnumValue',
    dimensions: 'Dimension', resources: 'Resource', columns: 'Column',
    recalculations: 'Recalculation', addressingAttributes: 'AddressingAttribute',
    accountingFlags: 'AccountingFlag', extDimensionAccountingFlags: 'ExtDimensionAccountingFlag',
    operations: 'Operation', urlTemplates: 'URLTemplate',
    integrationServiceChannels: 'IntegrationServiceChannel', tables: 'Table',
    cubes: 'Cube', functions: 'Function'
};
var LOCALIZED_FIELDS = {
    synonym: 1, toolTip: 1, objectPresentation: 1, listPresentation: 1,
    explanation: 1, listExplanation: 1
};

function localName(node) {
    var name = node && (node.localName || node.nodeName) || '';
    var colon = name.indexOf(':');
    return colon < 0 ? name : name.slice(colon + 1);
}
function children(node, name) {
    var out = [], list = node && node.childNodes || [];
    for (var i = 0; i < list.length; i++)
        if ((list[i].nodeType == null || list[i].nodeType === 1)
                && (!name || localName(list[i]) === name)) out.push(list[i]);
    return out;
}
function first(node, name) { return children(node, name)[0] || null; }
function text(node) { return node ? String(node.textContent || '').trim() : ''; }
function escape(value) {
    return String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
function tag(name, body, attrs) {
    var a = '';
    Object.keys(attrs || {}).forEach(function (key) { a += ' ' + key + '="' + escape(attrs[key]) + '"'; });
    return '<' + name + a + '>' + (body || '') + '</' + name + '>';
}
function pascal(name) { return name ? name.charAt(0).toUpperCase() + name.slice(1) : name; }

function localized(node, target) {
    var out = '', keys = children(node, 'key'), values = children(node, 'value');
    for (var i = 0; i < keys.length; i++) {
        if (!values[i]) continue;
        out += tag('v8:item', tag('v8:lang', escape(text(keys[i])))
            + tag('v8:content', escape(text(values[i]))));
    }
    return tag(target, out);
}

function localizedSiblings(fields, start, target, consumed) {
    var out = '';
    var key = localName(fields[start]);
    for (var i = start; i < fields.length; i++) {
        if (localName(fields[i]) !== key) continue;
        var keys = children(fields[i], 'key'), values = children(fields[i], 'value');
        for (var entry = 0; entry < Math.min(keys.length, values.length); entry++) {
            var lang = text(keys[entry]), content = text(values[entry]);
            if (!lang || content === '') continue;
            out += tag('v8:item', tag('v8:lang', escape(lang)) + tag('v8:content', escape(content)));
        }
        consumed[i] = true;
    }
    return tag(target, out);
}

function propertiesFromChildren(source, skip) {
    var fields = children(source), consumed = [], out = '';
    for (var i = 0; i < fields.length; i++) {
        if (consumed[i]) continue;
        var key = localName(fields[i]);
        if (skip && skip[key]) continue;
        if (LOCALIZED_FIELDS[key] && first(fields[i], 'key') && first(fields[i], 'value'))
            out += localizedSiblings(fields, i, pascal(key), consumed);
        else out += property(fields[i]);
    }
    return out;
}

function typeXml(source) {
    var out = '';
    children(source, 'types').forEach(function (type) {
        var raw = text(type), dot = raw.indexOf('.'), prefix = raw, suffix = '';
        if (dot >= 0) { prefix = raw.slice(0, dot); suffix = '.' + raw.slice(dot + 1); }
        out += tag('v8:Type', escape((TYPES[prefix] || ('cfg:' + prefix)) + suffix));
    });
    var qualifiers = { stringQualifiers: 'v8:StringQualifiers', numberQualifiers: 'v8:NumberQualifiers', dateQualifiers: 'v8:DateQualifiers' };
    Object.keys(qualifiers).forEach(function (sourceName) {
        var item = first(source, sourceName);
        if (!item) return;
        var body = '';
        children(item).forEach(function (field) {
            var key = localName(field);
            var mapped = { precision: 'v8:Digits', scale: 'v8:FractionDigits', nonNegative: 'v8:AllowedSign', dateFractions: 'v8:DateFractions' }[key] || pascal(key);
            var value = text(field);
            if (key === 'nonNegative') value = value === 'true' ? 'Nonnegative' : 'Any';
            body += tag(mapped, escape(value));
        });
        out += tag(qualifiers[sourceName], body);
    });
    return tag('Type', out);
}

function valueType(source) {
    var xsiType = source.getAttributeNS
        ? source.getAttributeNS('http://www.w3.org/2001/XMLSchema-instance', 'type') || ''
        : source.getAttribute('xsi:type') || '';
    var type = xsiType.split(':').pop();
    var mapped = { StringValue: 'xs:string', NumberValue: 'xs:decimal', BooleanValue: 'xs:boolean',
        DateValue: 'xs:dateTime', UndefinedValue: '', ReferenceValue: 'xr:DesignTimeRef',
        FixedArrayValue: 'v8:FixedArray', TypeDescriptionValue: 'v8:TypeDescription',
        ColorValue: 'v8:ColorValue', FontValue: 'v8:FontValue', BorderValue: 'v8:BorderValue',
        AccountTypeValue: 'ent:AccountType' }[type];
    if (mapped === undefined) { unsupportedValueType = true; return ''; }
    var value = first(source, 'value');
    var body = mapped && value && children(value).length ? property(value) : escape(text(value));
    return tag('FillValue', body, mapped ? { 'xsi:type': mapped } : { 'xsi:nil': 'true' });
}

function property(source, asStandard) {
    var key = localName(source);
    var outName = pascal(key);
    if (key === 'synonym' || key === 'toolTip' || key === 'objectPresentation'
            || key === 'listPresentation' || key === 'explanation' || key === 'listExplanation')
        return localized(source, outName);
    if (key === 'type') return typeXml(source);
    if (key === 'fillValue') return valueType(source);
    if (key === 'standardAttributes') return '';
    var kids = children(source);
    if (!kids.length) return tag(outName, escape(text(source)));
    /* MDO lists have repeated scalar children (e.g. produced references). */
    var body = '';
    kids.forEach(function (child) { body += property(child, asStandard); });
    return tag(outName, body);
}

function standardAttributes(items) {
    var body = '';
    items.forEach(function (item) {
        var name = text(first(item, 'name'));
        if (!name) return;
        var props = propertiesFromChildren(item, { name: 1 });
        body += tag('xr:StandardAttribute', props, { name: name });
    });
    return tag('StandardAttributes', body);
}

function referenceList(source, sourceName, targetName) {
    var items = children(source, sourceName).map(function (item) {
        return tag('xr:Item', tag('xr:Value', escape(text(item)), { 'xsi:type': 'xr:MDObjectRef' }));
    }).join('');
    return items ? tag(targetName, items) : '';
}
function contentList(source) {
    var items = children(source, 'content').map(function (item) {
        return tag('xr:Item', escape(text(item)));
    }).join('');
    return items ? tag('Content', items) : '';
}
function subsystemChildren(source) {
    var out = '';
    children(source, 'subsystems').forEach(function (item) {
        var ref = text(item), dot = ref.indexOf('.');
        if (dot >= 0) ref = ref.slice(dot + 1);
        if (ref) out += tag('Subsystem', escape(ref));
    });
    return out;
}

function nodeProperties(source) {
    var out = '';
    var fields = children(source), consumed = [];
    for (var i = 0; i < fields.length; i++) {
        if (consumed[i]) continue;
        var field = fields[i], key = localName(field);
        if (SKIP_ROOT[key] || GROUPS[key] || key === 'content' || key === 'subsystems') continue;
        if (key === 'name') out += tag('Name', escape(text(field)));
        else if (LOCALIZED_FIELDS[key] && first(field, 'key') && first(field, 'value'))
            out += localizedSiblings(fields, i, pascal(key), consumed);
        else out += property(field);
    }
    var standards = children(source, 'standardAttributes');
    if (standards.length) out += standardAttributes(standards);
    out += referenceList(source, 'basedOn', 'BasedOn');
    out += referenceList(source, 'registerRecords', 'RegisterRecords');
    out += contentList(source);
    return out;
}

function metadataNode(source, kind) {
    var attrs = source.getAttribute('uuid') ? { uuid: source.getAttribute('uuid') } : {};
    var body = tag('Properties', nodeProperties(source));
    var childBody = '';
    children(source).forEach(function (item) {
        var targetKind = GROUPS[localName(item)];
        if (targetKind) childBody += metadataNode(item, targetKind);
    });
    childBody += subsystemChildren(source);
    if (childBody) body += tag('ChildObjects', childBody);
    return tag(kind, body, attrs);
}

function configurationChildObjects(source) {
    var out = '';
    Object.keys(CONFIGURATION_OBJECTS).forEach(function (key) {
        var kind = CONFIGURATION_OBJECTS[key];
        children(source, key).forEach(function (item) {
            var ref = text(item), dot = ref.indexOf('.');
            if (dot >= 0) {
                if (ref.slice(0, dot) !== kind) return;
                ref = ref.slice(dot + 1);
            }
            if (ref) out += tag(kind, escape(ref));
        });
    });
    return out;
}

function generatedTypes(source, kind, objectName) {
    var produced = first(source, 'producedTypes');
    var parts = [];
    var categories = { objectType: 'Object', refType: 'Ref', selectionType: 'Selection', listType: 'List',
        managerType: 'Manager', valueManagerType: 'ValueManager', rowType: 'Row', recordSetType: 'RecordSet' };
    children(produced).forEach(function (item) {
        var category = categories[localName(item)];
        if (!category) return;
        var prefix = kind + (category === 'Object' ? 'Object' : category === 'Ref' ? 'Ref' : category);
        var name = prefix + '.' + objectName;
        var typeId = item.getAttribute('typeId'), valueId = item.getAttribute('valueTypeId');
        parts.push(tag('xr:GeneratedType', tag('xr:TypeId', escape(typeId)) + tag('xr:ValueId', escape(valueId)),
            { name: name, category: category }));
    });
    return parts.length ? tag('InternalInfo', parts.join('')) : '';
}

function convert(xml) {
    unsupportedValueType = false;
    if (!xml || typeof xml !== 'string') return { ok: false, reason: 'empty' };
    var doc;
    try { doc = new DOMParser().parseFromString(xml.replace(/^\uFEFF/, ''), 'application/xml'); }
    catch (e) { return { ok: false, reason: 'xml' }; }
    var source = doc.documentElement;
    if (!source || localName(source) === 'parsererror') return { ok: false, reason: 'xml' };
    if (source.namespaceURI !== MDO_NS) return { ok: false, reason: 'not-proj-metadata' };
    var kind = pascal(localName(source));
    /* Configuration has a dedicated main-window provider; project its root
     * properties into the same MetadataObject shape that Configuration.xml
     * uses. Form and Template descriptors belong to their own providers. */
    if (kind === 'Form' || kind === 'Template')
        return { ok: false, reason: 'unsupported-kind' };
    var name = text(first(source, 'name'));
    if (!name) return { ok: false, reason: 'missing-name' };
    var attrs = source.getAttribute('uuid') ? { uuid: source.getAttribute('uuid') } : {};
    var objectBody = generatedTypes(source, kind, name) + tag('Properties', nodeProperties(source));
    var childBody = kind === 'Configuration' ? configurationChildObjects(source) : '';
    children(source).forEach(function (item) {
        var targetKind = GROUPS[localName(item)];
        if (targetKind) childBody += metadataNode(item, targetKind);
    });
    if (kind === 'Subsystem') childBody += subsystemChildren(source);
    if (childBody) objectBody += tag('ChildObjects', childBody);
    if (unsupportedValueType) return { ok: false, reason: 'unsupported-value-type' };
    var result = '<?xml version="1.0" encoding="UTF-8"?>\n'
        + tag('MetaDataObject', tag(kind, objectBody, attrs), {
            xmlns: 'http://v8.1c.ru/8.3/MDClasses',
            'xmlns:cfg': 'http://v8.1c.ru/8.1/data/enterprise/current-config',
            'xmlns:ent': 'http://v8.1c.ru/8.1/data/enterprise',
            'xmlns:v8': 'http://v8.1c.ru/8.1/data/core',
            'xmlns:xr': 'http://v8.1c.ru/8.3/xcf/readable',
            'xmlns:xs': 'http://www.w3.org/2001/XMLSchema',
            'xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
            version: '2.21'
        });
    return { ok: true, xml: result, format: 'proj-mdo', kind: kind };
}

root.ProjMetadataConverter = { convert: convert };
})(typeof window !== 'undefined' ? window : globalThis);
