/* What the rest of a configuration says about one object: the documents that
 * record into a register, the catalogs subordinate to a catalog, the objects
 * entered on its basis, the journals, subsystems, functional options, event
 * subscriptions, defined types and filter criteria that list it, and its
 * predefined items. The object's own descriptor never holds these, so the
 * configuration export is scanned through the host's batch io
 * (FormContext.createHttpIo): Configuration.xml names the objects of each
 * class, and every descriptor of the classes that can point at this kind is
 * read cut down by the host to its link lists ('md-links').
 *
 * load() answers { root, groups: [...], predefined: [...] } or null for an
 * object outside a configuration export. Scans are kept per configuration
 * root in the cache the caller passes, so moving between objects of one
 * configuration reads each class once. */
(function (root) {
'use strict';

var DIRS = {
    Catalog: 'Catalogs', Document: 'Documents', DocumentJournal: 'DocumentJournals', Enum: 'Enums',
    Constant: 'Constants', Report: 'Reports', DataProcessor: 'DataProcessors',
    InformationRegister: 'InformationRegisters', AccumulationRegister: 'AccumulationRegisters',
    AccountingRegister: 'AccountingRegisters', CalculationRegister: 'CalculationRegisters',
    ChartOfCharacteristicTypes: 'ChartsOfCharacteristicTypes', ChartOfAccounts: 'ChartsOfAccounts',
    ChartOfCalculationTypes: 'ChartsOfCalculationTypes', BusinessProcess: 'BusinessProcesses', Task: 'Tasks',
    ExchangePlan: 'ExchangePlans', CommonModule: 'CommonModules', Subsystem: 'Subsystems',
    FunctionalOption: 'FunctionalOptions', EventSubscription: 'EventSubscriptions',
    DefinedType: 'DefinedTypes', FilterCriterion: 'FilterCriteria', Sequence: 'Sequences',
    DocumentNumerator: 'DocumentNumerators', CommonAttribute: 'CommonAttributes', Role: 'Roles',
    ScheduledJob: 'ScheduledJobs', CommonCommand: 'CommonCommands', SessionParameter: 'SessionParameters',
    CommonForm: 'CommonForms', CommonTemplate: 'CommonTemplates', CommandGroup: 'CommandGroups',
    WebService: 'WebServices', HTTPService: 'HTTPServices', SettingsStorage: 'SettingsStorages',
    FunctionalOptionsParameter: 'FunctionalOptionsParameters', ExternalDataSource: 'ExternalDataSources',
    IntegrationService: 'IntegrationServices', WSReference: 'WSReferences'
};

var EXTERNAL = { ExternalDataProcessor: true, ExternalReport: true };

var REFERENCE_KINDS = ['Catalog', 'Document', 'Enum', 'ChartOfCharacteristicTypes', 'ChartOfAccounts',
    'ChartOfCalculationTypes', 'BusinessProcess', 'Task', 'ExchangePlan'];
var BASED_ON_SOURCES = ['Document', 'Catalog', 'BusinessProcess', 'Task', 'ChartOfCharacteristicTypes',
    'ChartOfAccounts', 'ChartOfCalculationTypes', 'ExchangePlan'];
var OWNER_KINDS = ['Catalog', 'ExchangePlan', 'ChartOfCharacteristicTypes', 'ChartOfAccounts',
    'ChartOfCalculationTypes'];
var PREDEFINED_KINDS = ['Catalog', 'ChartOfCharacteristicTypes', 'ChartOfAccounts', 'ChartOfCalculationTypes'];

/* Inverse groups in the order the object window lists them. `sources` are
 * the classes read; `links` picks the list in each that must name the object;
 * `prefix` also accepts a path below the object (an attribute of it). */
var INVERSE = [
    { tag: 'Subordinates', title: 'Подчиненные справочники', sources: ['Catalog'], links: 'Owners',
        when: function (kind) { return OWNER_KINDS.indexOf(kind) >= 0; } },
    { tag: 'Registrars', title: 'Регистраторы', sources: ['Document'], links: 'RegisterRecords',
        when: function (kind) { return /Register$/.test(kind); } },
    { tag: 'Sequences', title: 'Последовательности', sources: ['Sequence'], links: 'Documents',
        when: function (kind) { return kind === 'Document'; } },
    { tag: 'SequenceRegisters', title: 'Последовательности', sources: ['Sequence'], links: 'RegisterRecords',
        when: function (kind) { return /Register$/.test(kind); } },
    { tag: 'Journals', title: 'Журналы документов', sources: ['DocumentJournal'], links: 'RegisteredDocuments',
        when: function (kind) { return kind === 'Document'; } },
    { tag: 'BasisFor', title: 'Является основанием для', sources: BASED_ON_SOURCES, links: 'BasedOn',
        when: function (kind) { return BASED_ON_SOURCES.indexOf(kind) >= 0; } },
    { tag: 'Subsystems', title: 'Подсистемы', sources: ['Subsystem'], links: 'Content',
        when: function () { return true; } },
    { tag: 'FunctionalOptions', title: 'Функциональные опции', sources: ['FunctionalOption'], links: 'Content',
        prefix: true, when: function () { return true; } },
    { tag: 'EventSubscriptions', title: 'Подписки на события', sources: ['EventSubscription'], links: 'Source',
        types: true, when: function () { return true; } },
    { tag: 'DefinedTypes', title: 'Входит в определяемые типы', sources: ['DefinedType'], links: 'Type',
        types: true, when: function (kind) { return REFERENCE_KINDS.indexOf(kind) >= 0; } },
    { tag: 'FilterCriteria', title: 'Критерии отбора', sources: ['FilterCriterion'], links: 'Content',
        prefix: true, when: function () { return true; } }
];

/* Every list element of one md-links cut: { RegisterRecords: [...], ... ,
 * Subsystem: [child names] }. Items are the text of the leaf elements —
 * <xr:Item>, <xr:Object>, <v8:Type> (without the cfg: prefix). */
function parseLinks(text) {
    var out = {};
    var re = /<(\w+)>([\s\S]*?)<\/\1>/g;
    var m;
    while ((m = re.exec(String(text || '')))) {
        var tag = m[1];
        var list = out[tag] || (out[tag] = []);
        if (tag === 'Subsystem') { list.push(m[2].trim()); continue; }
        var leaf = /<(?:\w+:)?(?:Item|Object|Type|Metadata)\b[^>]*>([^<]*)<\//g;
        var l;
        while ((l = leaf.exec(m[2]))) {
            var value = l[1].trim().replace(/^cfg:/, '');
            if (value) list.push(value);
        }
    }
    return out;
}

/* cfg:DocumentObject.Имя, cfg:InformationRegisterRecordSet.Имя,
 * cfg:CatalogRef.Имя -> the object's Class.Имя, or '' for a platform type. */
var TYPE_SUFFIXES = /^([A-Za-z]+?)(Object|RecordSet|RecordManager|ValueManager|Manager|Ref|List|Selection|RecordKey)\.([^.\s]+)$/;
function typeObject(type) {
    var m = String(type || '').match(TYPE_SUFFIXES);
    return m && DIRS[m[1]] ? m[1] + '.' + m[3] : '';
}

/* Configuration.xml's ChildObjects as { Class: [names] }. */
function configurationObjects(xml) {
    var out = {};
    var text = String(xml || '');
    var at = text.indexOf('<ChildObjects>');
    if (at < 0) return out;
    var end = text.indexOf('</ChildObjects>', at);
    var body = text.slice(at, end < 0 ? text.length : end);
    var re = /<(\w+)>([^<]+)<\/\1>/g;
    var m;
    while ((m = re.exec(body))) (out[m[1]] || (out[m[1]] = [])).push(m[2].trim());
    return out;
}

/* Objects whose `links` list names `ref`: a scan is [{ ref, path, links }]. */
function inverseOf(ref, scan, rule) {
    var out = [];
    var prefix = ref + '.';
    for (var i = 0; i < scan.length; i++) {
        var list = scan[i].links[rule.links] || [];
        var detail = [];
        var hit = false;
        for (var k = 0; k < list.length; k++) {
            var value = rule.types ? typeObject(list[k]) : list[k];
            if (value === ref) hit = true;
            else if (rule.prefix && value.indexOf(prefix) === 0) {
                hit = true;
                detail.push(value.slice(prefix.length));
            }
        }
        if (hit) out.push({ ref: scan[i].ref, path: scan[i].path, title: scan[i].title || '', detail: detail });
    }
    return out;
}

/* Predefined.xml as a flat list of { name, description, code, folder, depth }. */
function parsePredefined(xml) {
    var out = [];
    var doc;
    try {
        doc = new DOMParser().parseFromString(String(xml || '').replace(/^﻿/, ''), 'application/xml');
    } catch (e) { return out; }
    var XU = root.XmlUtil;
    function walk(parent, depth) {
        var items = XU.namedChildren(parent, 'Item');
        for (var i = 0; i < items.length; i++) {
            var item = items[i];
            out.push({
                name: XU.textOf(XU.firstChild(item, 'Name')),
                description: XU.textOf(XU.firstChild(item, 'Description')),
                code: XU.textOf(XU.firstChild(item, 'Code')),
                folder: XU.textOf(XU.firstChild(item, 'IsFolder')) === 'true',
                depth: depth
            });
            var kids = XU.firstChild(item, 'ChildItems');
            if (kids) walk(kids, depth + 1);
        }
    }
    if (doc && doc.documentElement) walk(doc.documentElement, 0);
    return out;
}

/* The Russian synonym of a descriptor head, or the first language written. */
function synonymOf(xml) {
    var m = String(xml || '').match(/<Synonym>([\s\S]*?)<\/Synonym>/);
    if (!m) return '';
    var items = m[1].match(/<v8:item>[\s\S]*?<\/v8:item>/g) || [];
    var first = '';
    for (var i = 0; i < items.length; i++) {
        var lang = (items[i].match(/<v8:lang>([^<]*)</) || [])[1];
        var content = (items[i].match(/<v8:content>([^<]*)</) || [])[1] || '';
        content = content.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>').replace(/&amp;/g, '&');
        if (lang === 'ru') return content;
        if (!first) first = content;
    }
    return first;
}

function sepOf(p) { return String(p).indexOf('\\') >= 0 ? '\\' : '/'; }
function dirname(p) {
    var s = String(p);
    var i = Math.max(s.lastIndexOf('\\'), s.lastIndexOf('/'));
    return i > 0 ? s.slice(0, i) : '';
}
function basename(p) {
    var s = String(p);
    return s.slice(Math.max(s.lastIndexOf('\\'), s.lastIndexOf('/')) + 1);
}

/* <root>/<Dir>/<Name>.xml of a configuration object, '' for a class the
 * export does not keep as a folder of descriptors. */
function objectPath(rootDir, ref) {
    var parts = String(ref || '').split('.');
    if (parts.length !== 2 || !DIRS[parts[0]] || !rootDir) return '';
    var sep = sepOf(rootDir);
    return rootDir + sep + DIRS[parts[0]] + sep + parts[1] + '.xml';
}

var CHUNK = 512;
var MAX_BYTES = 64 * 1024 * 1024;

function create(io, cache) {
    cache = cache || {};
    var FC = root.FormContext;

    function decode(bytes, filter) {
        if (!bytes) return null;
        var text = FC.decodeText(bytes).content;
        return filter ? FC.filterText(text, filter) : text;
    }

    function readMany(paths, filter) {
        var chunks = [];
        for (var i = 0; i < paths.length; i += CHUNK) chunks.push(paths.slice(i, i + CHUNK));
        return Promise.all(chunks.map(function (chunk) {
            return io.readMany(chunk, MAX_BYTES, filter || '');
        })).then(function (parts) {
            var out = [];
            parts.forEach(function (part) {
                for (var k = 0; k < part.length; k++) out.push(decode(part[k], filter));
            });
            return out;
        });
    }

    function state(rootDir) {
        var key = rootDir.toLowerCase();
        if (!cache[key]) {
            cache[key] = { scans: {} };
            var sep = sepOf(rootDir);
            cache[key].objects = readMany([rootDir + sep + 'Configuration.xml'], '')
                .then(function (texts) { return texts[0] ? configurationObjects(texts[0]) : null; });
        }
        return cache[key];
    }

    /* Subsystems nest: Subsystems/A.xml lists B, kept as Subsystems/A/Subsystems/B.xml. */
    function scanSubsystems(rootDir, names) {
        var sep = sepOf(rootDir);
        var out = [];
        function level(entries) {
            if (!entries.length) return Promise.resolve();
            return readMany(entries.map(function (e) { return e.path; }), 'md-links').then(function (texts) {
                var next = [];
                entries.forEach(function (entry, i) {
                    if (texts[i] == null) return;
                    var links = parseLinks(texts[i]);
                    out.push({ ref: 'Subsystem.' + entry.name, title: entry.title, path: entry.path, links: links });
                    var folder = entry.path.replace(/\.xml$/i, '') + sep + 'Subsystems' + sep;
                    (links.Subsystem || []).forEach(function (child) {
                        next.push({ name: child, title: entry.title + ' / ' + child, path: folder + child + '.xml' });
                    });
                });
                return level(next);
            });
        }
        return level(names.map(function (name) {
            return { name: name, title: name, path: rootDir + sep + 'Subsystems' + sep + name + '.xml' };
        })).then(function () { return out; });
    }

    function scan(rootDir, cls) {
        var st = state(rootDir);
        if (!st.scans[cls]) {
            st.scans[cls] = st.objects.then(function (objects) {
                var names = (objects && objects[cls]) || [];
                if (cls === 'Subsystem') return scanSubsystems(rootDir, names);
                var refs = names.map(function (name) { return cls + '.' + name; });
                var paths = refs.map(function (ref) { return objectPath(rootDir, ref); });
                return readMany(paths, 'md-links').then(function (texts) {
                    var out = [];
                    for (var i = 0; i < refs.length; i++) {
                        if (texts[i] != null) out.push({ ref: refs[i], path: paths[i], links: parseLinks(texts[i]) });
                    }
                    return out;
                });
            }).catch(function () { return []; });
        }
        return st.scans[cls];
    }

    /* objectPath: <root>/<Dir>/<Name>.xml; kind and name come from its XML. */
    function load(filePath, kind, name) {
        /* An external data processor or report belongs to no configuration:
         * nothing is read for it. */
        if (EXTERNAL[kind]) return Promise.resolve(null);
        var folder = dirname(filePath);
        var rootDir = dirname(folder);
        if (!rootDir || !DIRS[kind] || basename(folder).toLowerCase() !== DIRS[kind].toLowerCase())
            return Promise.resolve(null);
        var st = state(rootDir);
        var ref = kind + '.' + name;
        return st.objects.then(function (objects) {
            if (!objects) return null;
            var rules = INVERSE.filter(function (rule) { return rule.when(kind); });
            var groups = Promise.all(rules.map(function (rule) {
                return Promise.all(rule.sources.map(function (cls) { return scan(rootDir, cls); }))
                    .then(function (scans) {
                        var items = [];
                        scans.forEach(function (s) { items = items.concat(inverseOf(ref, s, rule)); });
                        return { tag: rule.tag, title: rule.title, items: items, single: rule.sources.length === 1 };
                    });
            }));
            var predefined = PREDEFINED_KINDS.indexOf(kind) >= 0
                ? readMany([folder + sepOf(folder) + name + sepOf(folder) + 'Ext' + sepOf(folder) + 'Predefined.xml'], '')
                    .then(function (texts) { return texts[0] ? parsePredefined(texts[0]) : []; }, function () { return []; })
                : Promise.resolve([]);
            return Promise.all([groups, predefined]).then(function (r) {
                /* Two rules share a title (a sequence lists documents and
                 * registers): merge them. */
                var merged = [];
                r[0].forEach(function (g) {
                    var same = merged.filter(function (m) { return m.title === g.title; })[0];
                    if (same) { same.items = same.items.concat(g.items); same.single = same.single && g.single; }
                    else merged.push(g);
                });
                return { root: rootDir, groups: merged, predefined: r[1] };
            });
        });
    }

    /* Every role's Rights.xml cut to 'rights-summary', as { objectName:
     * [[role, rights]] }. The largest read of all (hundreds of MB in a big
     * configuration), so it runs only when asked and once per root. */
    function rightsIndex(rootDir) {
        var st = state(rootDir);
        if (!st.rights) {
            var sep = sepOf(rootDir);
            st.rights = st.objects.then(function (objects) {
                var names = (objects && objects.Role) || [];
                var paths = names.map(function (n) { return rootDir + sep + 'Roles' + sep + n + sep + 'Ext' + sep + 'Rights.xml'; });
                return readMany(paths, 'rights-summary').then(function (texts) {
                    var index = {};
                    for (var i = 0; i < names.length; i++) {
                        var lines = texts[i] ? texts[i].split('\n') : [];
                        for (var k = 0; k < lines.length; k++) {
                            var tab = lines[k].indexOf('\t');
                            if (tab <= 0) continue;
                            var object = lines[k].slice(0, tab);
                            (index[object] || (index[object] = [])).push([names[i], lines[k].slice(tab + 1)]);
                        }
                    }
                    return index;
                });
            });
            st.rights.catch(function () { st.rights = null; });
        }
        return st.rights;
    }

    /* Roles that grant any right on the object: [{ role, title, path,
     * rights: [{ name, restricted }] }], or null outside a configuration. */
    function loadRoles(filePath, kind, name) {
        if (EXTERNAL[kind]) return Promise.resolve(null);
        var folder = dirname(filePath);
        var rootDir = dirname(folder);
        if (!rootDir || !DIRS[kind] || basename(folder).toLowerCase() !== DIRS[kind].toLowerCase())
            return Promise.resolve(null);
        var sep = sepOf(rootDir);
        return state(rootDir).objects.then(function (objects) {
            if (!objects) return null;
            return rightsIndex(rootDir).then(function (index) {
                var found = index[kind + '.' + name] || [];
                var paths = found.map(function (f) { return rootDir + sep + 'Roles' + sep + f[0] + '.xml'; });
                return readMany(paths, 'configuration-properties').then(function (heads) {
                    return found.map(function (f, i) {
                        return {
                            role: f[0], title: synonymOf(heads[i]), path: paths[i],
                            rights: f[1].split(',').map(function (r) {
                                return { name: r.replace(/\*$/, ''), restricted: /\*$/.test(r) };
                            })
                        };
                    });
                });
            });
        });
    }

    return { load: load, loadRoles: loadRoles };
}

root.MetadataRelations = {
    DIRS: DIRS,
    create: create,
    objectPath: objectPath,
    _test: {
        parseLinks: parseLinks, typeObject: typeObject, configurationObjects: configurationObjects,
        inverseOf: inverseOf, parsePredefined: parsePredefined, INVERSE: INVERSE, synonymOf: synonymOf
    }
};

})(typeof window !== 'undefined' ? window : globalThis);
