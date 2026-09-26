/* The root of a configuration export (Configuration.xml) drawn as the main
 * window of the 1C:Enterprise client in the Taxi interface: the header with
 * the application title, search and user, the main menu, the sections panel
 * and, for the section picked, its function panel — navigation commands
 * grouped by the nested subsystems and the Create / Reports / Tools action
 * groups. "Главное" is a section of its own, set up by the configuration's
 * Ext/MainSectionCommandInterface.xml.
 *
 * Configuration.xml only names the objects. Everything else is read from the
 * export through the host's batch io (FormContext.createHttpIo):
 * Ext/CommandInterface.xml orders the sections, each subsystem descriptor
 * gives its synonym, picture and content, the subsystem's own
 * Ext/CommandInterface.xml overrides visibility (for all or per role), group
 * and order of commands, and the content objects' descriptors (cut to their
 * properties and command blocks by the host) give the commands themselves.
 * The window paints from Configuration.xml at once and fills in as the reads
 * answer; a section is read only when it is opened.
 *
 * What the export cannot tell — the values of functional options, the user's
 * roles — is left to the viewer: commands under functional options are marked
 * or hidden on request, and the window can be looked at "as a role", with the
 * role's rights (Roles/<Роль>/Ext/Rights.xml) and its per-role visibility.
 *
 * An extension export has the same root, with the purpose, the name prefix
 * and the compatibility mode written among the properties. Its window says
 * so and gets a tab of its own: its content, class by class. Its name links
 * to the shared inspector, where the extension's properties are shown. An
 * object descriptor's ObjectBelonging="Adopted" marks what it took from the
 * configuration it extends. */
(function (root) {
'use strict';

/* Catalog.Товары.Command.Печать as the Russian Designer spells it (tooltips). */
function mdRef(ref) {
    return root.XmlUtil && root.XmlUtil.terms ? root.XmlUtil.terms.metadataRef(ref) : String(ref || '');
}

var DIRS = {
    Catalog: 'Catalogs', Document: 'Documents', DocumentJournal: 'DocumentJournals', Enum: 'Enums',
    Constant: 'Constants', Report: 'Reports', DataProcessor: 'DataProcessors',
    InformationRegister: 'InformationRegisters', AccumulationRegister: 'AccumulationRegisters',
    AccountingRegister: 'AccountingRegisters', CalculationRegister: 'CalculationRegisters',
    ChartOfCharacteristicTypes: 'ChartsOfCharacteristicTypes', ChartOfAccounts: 'ChartsOfAccounts',
    ChartOfCalculationTypes: 'ChartsOfCalculationTypes', BusinessProcess: 'BusinessProcesses', Task: 'Tasks',
    ExchangePlan: 'ExchangePlans', CommonCommand: 'CommonCommands', CommonForm: 'CommonForms',
    FilterCriterion: 'FilterCriteria', CommandGroup: 'CommandGroups', PaletteColor: 'PaletteColors'
};

/* "Все функции" lists the classes a user can open, in the client's order. */
var ALL_FUNCTIONS = [
    ['Catalog', 'Справочники'], ['Document', 'Документы'], ['DocumentJournal', 'Журналы документов'],
    ['Enum', 'Перечисления'], ['Report', 'Отчеты'], ['DataProcessor', 'Обработки'],
    ['ChartOfCharacteristicTypes', 'Планы видов характеристик'], ['ChartOfAccounts', 'Планы счетов'],
    ['ChartOfCalculationTypes', 'Планы видов расчета'], ['InformationRegister', 'Регистры сведений'],
    ['AccumulationRegister', 'Регистры накопления'], ['AccountingRegister', 'Регистры бухгалтерии'],
    ['CalculationRegister', 'Регистры расчета'], ['BusinessProcess', 'Бизнес-процессы'], ['Task', 'Задачи'],
    ['ExchangePlan', 'Планы обмена'], ['Constant', 'Константы'], ['CommonForm', 'Общие формы'],
    ['CommonCommand', 'Общие команды']
];

/* «Все функции» follows the configuration tree's class order and includes
 * every object class known to the metadata inspector. Keep the traditional
 * navigation classes as a fallback for partial hosts without that order. */
function allFunctionKinds() {
    var out = [];
    var seen = {};
    var preview = root.MetadataPreview;
    var order = (preview && preview.classOrder) || [];
    order.forEach(function (kind) {
        if (kind === 'Configuration' || seen[kind]) return;
        var title = preview.classPlurals && preview.classPlurals[kind];
        if (!title) return;
        seen[kind] = true;
        out.push([kind, title]);
    });
    ALL_FUNCTIONS.forEach(function (entry) {
        if (!seen[entry[0]]) out.push(entry);
    });
    return out;
}

/* An extension names what it is for and what it may change: the purpose,
 * the prefix every own object's name carries and the compatibility mode. */
var EXT_PURPOSES = {
    Customization: 'Адаптация', AddOn: 'Дополнение', Patch: 'Исправление (патч)'
};
var EXT_USE_PURPOSES = {
    PersonalComputer: 'Персональный компьютер', MobileDevice: 'Мобильное устройство'
};

/* Standard commands an object class gets while UseStandardCommands is on:
 * [name, group, visible by default, condition on the descriptor head]. */
var LIST = ['OpenList', 'NavigationPanelOrdinary', true];
var CREATE = ['Create', 'ActionsPanelCreate', false];
var STANDARD = {
    Catalog: [LIST, CREATE],
    Document: [LIST, CREATE],
    ExchangePlan: [LIST, CREATE],
    BusinessProcess: [LIST, CREATE],
    Task: [LIST, CREATE],
    ChartOfAccounts: [LIST, CREATE],
    ChartOfCalculationTypes: [LIST, CREATE],
    ChartOfCharacteristicTypes: [LIST, CREATE],
    InformationRegister: [['OpenList', 'NavigationPanelOrdinary', function (head) {
        return !/<WriteMode>RecorderSubordinate</.test(head);
    }]],
    AccumulationRegister: [['OpenList', 'NavigationPanelOrdinary', false]],
    AccountingRegister: [['OpenList', 'NavigationPanelOrdinary', false]],
    CalculationRegister: [['OpenList', 'NavigationPanelOrdinary', false]],
    Enum: [['OpenList', 'NavigationPanelOrdinary', false]],
    DocumentJournal: [LIST],
    DataProcessor: [['Open', 'ActionsPanelTools', true, function (head) { return hasValue(head, 'DefaultForm'); }]],
    Report: [['Open', 'ActionsPanelReports', true, function (head) {
        return hasValue(head, 'DefaultForm') || hasValue(head, 'MainDataCompositionSchema');
    }]],
    CommonForm: [['Open', 'ActionsPanelTools', true]],
    Constant: [['Open', 'ActionsPanelTools', true]]
};

/* The right a role needs on the object for a command to be available. */
var USE_KINDS = { Report: true, DataProcessor: true };
function requiredRight(commandId) {
    var parts = String(commandId).split('.');
    if (parts[0] === 'CommonCommand') return 'View';
    if (parts[2] === 'StandardCommand' && parts[3] === 'Create') return 'InteractiveInsert';
    return USE_KINDS[parts[0]] ? 'Use' : 'View';
}

var NAV_GROUPS = ['NavigationPanelImportant', 'NavigationPanelOrdinary', 'NavigationPanelSeeAlso'];
var ACTION_GROUPS = ['ActionsPanelCreate', 'ActionsPanelReports', 'ActionsPanelTools'];
var ACTION_TITLES = {
    ActionsPanelCreate: 'Создать', ActionsPanelReports: 'Отчеты', ActionsPanelTools: 'Сервис'
};

var MAX_BYTES = 64 * 1024 * 1024;
var CHUNK = 512;
var SEARCH_CHUNK = 32;
var HOME = 'home';

/* Configuration-only properties are rare in ordinary metadata objects, so
 * the shared dictionary intentionally does not carry all of their captions. */
var CONFIG_PROPERTY_TITLES = {
    Version: 'Версия', Vendor: 'Поставщик', BriefInformation: 'Краткая информация',
    DetailedInformation: 'Подробная информация', Copyright: 'Авторские права',
    DefaultLanguage: 'Основной язык', DefaultRunMode: 'Основной режим запуска',
    ScriptVariant: 'Вариант встроенного языка', CompatibilityMode: 'Режим совместимости',
    InterfaceCompatibilityMode: 'Режим совместимости интерфейса',
    ConfigurationExtensionPurpose: 'Назначение расширения конфигурации',
    ConfigurationExtensionCompatibilityMode: 'Режим совместимости расширения',
    NamePrefix: 'Префикс имен'
};

/* ------------------------------------------------------------ text scans */

function unescapeXml(s) {
    return String(s || '').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

/* The Russian text of a localized property, or the first language written. */
function localized(xml, tag) {
    var m = String(xml || '').match(new RegExp('<' + tag + '>([\\s\\S]*?)</' + tag + '>'));
    if (!m) return '';
    var items = m[1].match(/<v8:item>[\s\S]*?<\/v8:item>/g) || [];
    var first = '';
    for (var i = 0; i < items.length; i++) {
        var lang = (items[i].match(/<v8:lang>([^<]*)</) || [])[1];
        var content = unescapeXml((items[i].match(/<v8:content>([^<]*)</) || [])[1] || '');
        if (lang === 'ru') return content;
        if (!first) first = content;
    }
    return first;
}

function valueOf(xml, tag) {
    var m = String(xml || '').match(new RegExp('<' + tag + '>([^<]*)</' + tag + '>'));
    return m ? unescapeXml(m[1].trim()) : '';
}

function hasValue(xml, tag) { return !!valueOf(xml, tag); }

function propertiesOf(xml) {
    var text = String(xml || '');
    var at = text.indexOf('<Properties>');
    var end = text.indexOf('</Properties>', at);
    return at < 0 ? text : text.slice(at, end < 0 ? text.length : end);
}

/* Configuration.xml's ChildObjects as { Class: [names] }. */
function childObjects(xml) {
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

function listOf(xml, tag, item) {
    var m = String(xml || '').match(new RegExp('<' + tag + '>([\\s\\S]*?)</' + tag + '>'));
    if (!m) return [];
    var out = [];
    var re = new RegExp('<(?:\\w+:)?' + item + '\\b[^>]*>([^<]*)</', 'g');
    var l;
    while ((l = re.exec(m[1]))) if (l[1].trim()) out.push(l[1].trim());
    return out;
}

/* A subsystem's or the configuration's Ext/CommandInterface.xml. Visibility
 * keeps the common value and the per-role values apart. */
function parseCommandInterface(xml) {
    var text = String(xml || '');
    var out = { visibility: {}, roleVisibility: {}, placement: {}, order: {}, subsystems: [], groups: [] };
    if (text.indexOf('http://g5.1c.ru/v8/dt/cmi') >= 0) {
        var document = new DOMParser().parseFromString(text, 'application/xml');
        function nameOf(node) { return String(node && (node.localName || node.nodeName) || '').split(':').pop().toLowerCase(); }
        function childrenOf(node, name) {
            return Array.prototype.filter.call(node && node.childNodes || [], function (child) {
                return (child.nodeType == null || child.nodeType === 1) && nameOf(child) === name.toLowerCase();
            });
        }
        function firstOf(node, name) { return childrenOf(node, name)[0] || null; }
        function valueOfNode(node, name) {
            var child = firstOf(node, name);
            return child ? String(child.textContent || '').trim() : '';
        }
        function commandName(node) { return node.getAttribute('name') || valueOfNode(node, 'name'); }
        function items(section, singular) {
            var parent = firstOf(document.documentElement, section);
            return parent ? childrenOf(parent, singular) : [];
        }
        items('subsystemsOrder', 'subsystem').forEach(function (item) {
            var ref = String(item.textContent || '').trim();
            if (ref) out.subsystems.push(ref);
        });
        items('groupsOrder', 'group').forEach(function (item) {
            var ref = String(item.textContent || '').trim();
            if (ref) out.groups.push(ref);
        });
        items('commandsVisibility', 'command').forEach(function (item) {
            var ref = commandName(item), visibility = firstOf(item, 'visibility');
            if (!ref || !visibility) return;
            var common = valueOfNode(visibility, 'common');
            if (common) out.visibility[ref] = common.toLowerCase() === 'true';
            var roles = {};
            childrenOf(visibility, 'value').forEach(function (role) {
                var roleName = commandName(role);
                if (roleName) roles[roleName] = String(role.textContent || '').trim().toLowerCase() === 'true';
            });
            if (Object.keys(roles).length) out.roleVisibility[ref] = roles;
        });
        items('commandsPlacement', 'command').forEach(function (item) {
            var ref = commandName(item), group = valueOfNode(item, 'commandGroup');
            if (ref && group) out.placement[ref] = group;
        });
        items('commandsOrder', 'command').forEach(function (item, index) {
            var ref = commandName(item);
            if (ref) out.order[ref] = { group: valueOfNode(item, 'commandGroup'), index: index };
        });
        return out;
    }
    function section(tag) {
        var m = text.match(new RegExp('<' + tag + '>([\\s\\S]*?)</' + tag + '>'));
        return m ? m[1] : '';
    }
    var re = /<Command name="([^"]+)">([\s\S]*?)<\/Command>/g;
    var m;
    var vis = section('CommandsVisibility');
    while ((m = re.exec(vis))) {
        var common = m[2].match(/<xr:Common>(true|false)</);
        if (common) out.visibility[m[1]] = common[1] === 'true';
        var roles = null;
        var rv = /<xr:Value name="([^"]+)">(true|false)</g;
        var r;
        while ((r = rv.exec(m[2]))) (roles || (roles = {}))[r[1]] = r[2] === 'true';
        if (roles) out.roleVisibility[m[1]] = roles;
    }
    var place = section('CommandsPlacement');
    re.lastIndex = 0;
    while ((m = re.exec(place))) {
        var group = valueOf(m[2], 'CommandGroup');
        if (group) out.placement[m[1]] = group;
    }
    var order = section('CommandsOrder');
    re.lastIndex = 0;
    var position = 0;
    while ((m = re.exec(order))) {
        out.order[m[1]] = { group: valueOf(m[2], 'CommandGroup'), index: position++ };
    }
    var subs = section('SubsystemsOrder');
    var s = /<Subsystem>([^<]+)<\/Subsystem>/g;
    while ((m = s.exec(subs))) out.subsystems.push(m[1].trim());
    var groups = section('GroupsOrder');
    var g = /<Group>([^<]+)<\/Group>/g;
    while ((m = g.exec(groups))) out.groups.push(m[1].trim());
    return out;
}

/* HomePageWorkArea.xml: the template and the forms of each column. */
function parseHomePage(xml) {
    var text = String(xml || '');
    function column(tag) {
        var m = text.match(new RegExp('<' + tag + '>([\\s\\S]*?)</' + tag + '>'));
        if (!m) return [];
        var out = [];
        var re = /<Item>([\s\S]*?)<\/Item>/g;
        var i;
        while ((i = re.exec(m[1]))) {
            var form = valueOf(i[1], 'Form');
            if (!form) continue;
            var common = i[1].match(/<xr:Common>(true|false)</);
            out.push({ form: form, height: +valueOf(i[1], 'Height') || 10, visible: !common || common[1] === 'true' });
        }
        return out;
    }
    return {
        template: valueOf(text, 'WorkingAreaTemplate'),
        left: column('LeftColumn'),
        right: column('RightColumn')
    };
}

/* The <Command> blocks of an object descriptor (the host's 'command-blocks'
 * cut) as [{ name, title, group, parameter }]. */
function parseCommands(text) {
    var out = [];
    var re = /<Command\b[^>]*>([\s\S]*?)<\/Command>/g;
    var m;
    while ((m = re.exec(String(text || '')))) {
        var body = m[1];
        out.push({
            name: valueOf(body, 'Name'),
            title: localized(body, 'Synonym'),
            group: valueOf(body, 'Group'),
            parameter: /<CommandParameterType>\s*<v8:Type/.test(body)
        });
    }
    return out;
}

/* A role's Ext/Rights.xml as { all, objects: { name: { right: bool } } }.
 * The export writes only what differs from the role's setForNewObjects: an
 * object it leaves out, or a right it leaves out of a listed object, takes
 * that value. */
function parseRights(text) {
    text = String(text || '');
    var out = { all: /<setForNewObjects>true</.test(text), objects: {} };
    var at = 0;
    while ((at = text.indexOf('<object>', at)) >= 0) {
        var end = text.indexOf('</object>', at);
        if (end < 0) break;
        var block = text.slice(at, end);
        at = end + 9;
        var name = (block.match(/<name>([^<]+)<\/name>/) || [])[1];
        if (!name) continue;
        var rights = out.objects[name] = {};
        var re = /<right>\s*<name>([^<]+)<\/name>\s*<value>(true|false)<\/value>/g;
        var m;
        while ((m = re.exec(block))) rights[m[1]] = m[2] === 'true';
    }
    return out;
}

function hasRight(rights, object, right) {
    if (!rights) return true;
    if (rights.roles) {
        for (var i = 0; i < rights.roles.length; i++) if (hasRight(rights.roles[i], object, right)) return true;
        return false;
    }
    var granted = rights.objects[object];
    return granted && granted[right] != null ? granted[right] : !!rights.all;
}

/* The rights of a set of roles: a right granted by any of them. */
function unionRights(list) {
    return { roles: list.filter(Boolean) };
}

/* The object a command belongs to: Catalog.X.StandardCommand.OpenList ->
 * Catalog.X, CommonCommand.X -> itself. */
function commandObject(id) {
    return String(id).split('.').slice(0, 2).join('.');
}

/* The names written in a reference, the classes and the parts left out:
 * Catalog.Заказ.Command.Печать -> ['Заказ', 'Печать']. A synonym may say
 * nothing about the name, so the name is searched for and shown as well. */
function refNames(id) {
    var parts = String(id || '').split('.');
    var out = [];
    for (var i = 1; i < parts.length; i += 2) {
        /* StandardCommand.OpenList is the platform's own name, not the
         * configuration's: a search for it would hit every object. */
        if (parts[i - 1] === 'StandardCommand') break;
        if (parts[i]) out.push(parts[i]);
    }
    return out;
}

function matchesQuery(entry, q) {
    if (String(entry.title || '').toLowerCase().indexOf(q) >= 0) return true;
    var names = entry.name ? [entry.name] : refNames(entry.id);
    for (var i = 0; i < names.length; i++)
        if (names[i].toLowerCase().indexOf(q) >= 0) return true;
    return false;
}

/* -------------------------------------------------------------- model */

function detect(xml) {
    if (!xml || typeof xml !== 'string') return false;
    if (xml.indexOf('v8.1c.ru/8.3/MDClasses') < 0) return false;
    return /<(?:\w+:)?MetaDataObject\b[^>]*>\s*<(?:\w+:)?Configuration[\s>]/.test(xml);
}

/* Configuration.xml of an extension against that of a configuration: the
 * purpose tag is written only for an extension, the prefix only when set. */
function extensionInfo(props) {
    var purpose = valueOf(props, 'ConfigurationExtensionPurpose');
    var prefix = valueOf(props, 'NamePrefix');
    if (!purpose && !prefix) return null;
    return {
        purpose: purpose,
        purposeTitle: EXT_PURPOSES[purpose] || purpose || '',
        prefix: prefix,
        compatibility: valueOf(props, 'ConfigurationExtensionCompatibilityMode'),
        usePurposes: listOf(props, 'UsePurposes', 'Value').map(function (v) {
            return EXT_USE_PURPOSES[v] || v;
        })
    };
}

function parse(xml) {
    if (!detect(xml)) return { error: 'Это не корень конфигурации 1С (Configuration.xml).' };
    var props = propertiesOf(xml);
    var objects = childObjects(xml);
    /* The object window already has the exhaustive property reader: it knows
     * localized strings, metadata references, booleans and the platform's
     * Russian property names. Configuration is deliberately not claimed by
     * that provider, but its Properties block has the same schema, so reuse
     * the parsed rows for the root inspector instead of maintaining a second
     * partial list here. */
    var metadata = root.MetadataPreview && root.MetadataPreview.parse
        ? root.MetadataPreview.parse(xml).model : null;
    return {
        model: {
            name: valueOf(props, 'Name'),
            synonym: localized(props, 'Synonym'),
            comment: valueOf(props, 'Comment'),
            version: valueOf(props, 'Version'),
            vendor: valueOf(props, 'Vendor'),
            compatibilityMode: valueOf(props, 'CompatibilityMode'),
            interfaceCompatibilityMode: valueOf(props, 'InterfaceCompatibilityMode'),
            properties: metadata ? metadata.properties : [],
            extension: extensionInfo(props),
            subsystems: objects.Subsystem || [],
            roles: objects.Role || [],
            functionalOptions: objects.FunctionalOption || [],
            objects: objects
        }
    };
}

/* ------------------------------------------------------------- loading */

function sepOf(p) { return String(p).indexOf('\\') >= 0 ? '\\' : '/'; }
function dirname(p) {
    var s = String(p);
    var i = Math.max(s.lastIndexOf('\\'), s.lastIndexOf('/'));
    return i > 0 ? s.slice(0, i) : '';
}
function join() {
    var parts = Array.prototype.slice.call(arguments);
    var sep = sepOf(parts[0]);
    return parts.join(sep);
}

function objectPath(rootDir, ref) {
    var parts = String(ref || '').split('.');
    var dirs = classDirs();
    if (parts.length !== 2 || !dirs[parts[0]]) return '';
    return join(rootDir, dirs[parts[0]], parts[1] + '.xml');
}
function projObjectPath(rootDir, ref) {
    var parts = String(ref || '').split('.');
    var dirs = classDirs();
    if (parts.length !== 2 || !dirs[parts[0]]) return '';
    return join(rootDir, dirs[parts[0]], parts[1], parts[1] + '.mdo');
}
function projSubsystemPath(rootDir, ref) {
    var names = String(ref || '').split('.').filter(function (x, i) { return i % 2 === 1; });
    if (!names.length) return '';
    var parts = [rootDir];
    for (var i = 0; i < names.length; i++) parts.push('Subsystems', names[i]);
    parts.push(names[names.length - 1] + '.mdo');
    return join.apply(null, parts);
}
function projFormPaths(rootDir, ref) {
    var p = String(ref || '').split('.');
    if (p[0] === 'CommonForm' && p.length === 2) {
        var common = join(rootDir, 'CommonForms', p[1], p[1] + '.form');
        return { descriptor: common, layout: common };
    }
    if (p.length === 4 && p[2] === 'Form' && DIRS[p[0]]) {
        var form = join(rootDir, DIRS[p[0]], p[1], 'Forms', p[3], 'Form.form');
        return { descriptor: form, layout: form };
    }
    return null;
}
var PROJ_ROOTS = {};
function rootOfConfigPath(configPath) {
    var file = String(configPath || '');
    var proj = /(?:^|[\\/])Configuration\.mdo$/i.test(file);
    var dir = dirname(file);
    var rootDir = proj ? dirname(dir) : dir;
    if (rootDir) PROJ_ROOTS[rootDir.toLowerCase()] = proj;
    return rootDir;
}
function projRoot(rootDir) { return !!PROJ_ROOTS[String(rootDir || '').toLowerCase()]; }
function configurationInterfacePath(rootDir, name) {
    return projRoot(rootDir) ? join(rootDir, 'Configuration', name + '.cmi')
        : join(rootDir, 'Ext', name + '.xml');
}
function subsystemInterfacePath(rootDir, descriptor) {
    return projRoot(rootDir) ? join(dirname(descriptor), 'CommandInterface.cmi')
        : join(descriptor.replace(/\.xml$/i, ''), 'Ext', 'CommandInterface.xml');
}
function descriptorPath(rootDir, ref) {
    return PROJ_ROOTS[String(rootDir || '').toLowerCase()] ? projObjectPath(rootDir, ref) : objectPath(rootDir, ref);
}
function sectionPath(rootDir, ref) {
    return PROJ_ROOTS[String(rootDir || '').toLowerCase()] ? projSubsystemPath(rootDir, ref) : subsystemPath(rootDir, ref);
}
function formLocations(rootDir, ref) {
    return PROJ_ROOTS[String(rootDir || '').toLowerCase()] ? projFormPaths(rootDir, ref) : formPaths(rootDir, ref);
}

/* Every class an export writes a folder for, not just the ones the command
 * interface needs: an extension's content is listed in full. */
function classDirs() {
    var wide = root.MetadataRelations && root.MetadataRelations.DIRS;
    if (!wide) return DIRS;
    var out = {};
    Object.keys(wide).forEach(function (k) { out[k] = wide[k]; });
    Object.keys(DIRS).forEach(function (k) { out[k] = DIRS[k]; });
    return out;
}

function classTitle(kind) {
    var plurals = root.MetadataPreview && root.MetadataPreview.classPlurals;
    return (plurals && plurals[kind]) || kind;
}

/* An object descriptor's head says whose object it is: an extension writes
 * ObjectBelonging="Adopted" on the ones it took from the configuration. */
function isAdopted(text) {
    var head = String(text || '').split('<Properties>')[0];
    return /ObjectBelonging\s*=\s*"Adopted"/.test(head);
}

/* Subsystem.A.Subsystem.B -> <root>/Subsystems/A/Subsystems/B.xml */
function subsystemPath(rootDir, ref) {
    var names = String(ref || '').split('.').filter(function (x, i) { return i % 2 === 1; });
    if (!names.length) return '';
    var parts = [rootDir];
    for (var i = 0; i < names.length; i++) {
        if (i) parts.push(names[i - 1]);
        parts.push('Subsystems');
    }
    parts.push(names[names.length - 1] + '.xml');
    return join.apply(null, parts);
}

/* A form reference to its layout: Task.X.Form.Y -> Tasks/X/Forms/Y/Ext/Form.xml,
 * CommonForm.Y -> CommonForms/Y/Ext/Form.xml. */
function formPaths(rootDir, ref) {
    var p = String(ref || '').split('.');
    if (p[0] === 'CommonForm' && p.length === 2)
        return { descriptor: join(rootDir, 'CommonForms', p[1] + '.xml'), layout: join(rootDir, 'CommonForms', p[1], 'Ext', 'Form.xml') };
    if (p.length === 4 && p[2] === 'Form' && DIRS[p[0]])
        return {
            descriptor: join(rootDir, DIRS[p[0]], p[1], 'Forms', p[3] + '.xml'),
            layout: join(rootDir, DIRS[p[0]], p[1], 'Forms', p[3], 'Ext', 'Form.xml')
        };
    return null;
}

var MODULE_TITLES = {
    ObjectModule: 'МодульОбъекта', ManagerModule: 'МодульМенеджера',
    RecordSetModule: 'МодульНабораЗаписей', ValueManagerModule: 'МодульМенеджераЗначения',
    CommandModule: 'МодульКоманды', ManagedApplicationModule: 'МодульУправляемогоПриложения',
    OrdinaryApplicationModule: 'МодульОбычногоПриложения', SessionModule: 'МодульСеанса',
    ExternalConnectionModule: 'МодульВнешнегоСоединения', Module: 'Модуль'
};

function moduleInfoResult(filePath, label, relative, kind, name) {
    return { path: filePath, label: label, relative: relative, sortKind: kind || '', sortName: name || '' };
}

/* Translate an on-disk module path back to the name a 1C developer uses.
 * Form and common-module files already denote the module by the metadata
 * object itself, so they deliberately have no redundant suffix. */
function moduleInfo(rootDir, filePath) {
    var normalizedRoot = String(rootDir || '').replace(/\\/g, '/').replace(/\/$/, '');
    var normalized = String(filePath || '').replace(/\\/g, '/');
    var prefix = normalizedRoot.toLowerCase() + '/';
    var relative = normalized.toLowerCase().indexOf(prefix) === 0
        ? normalized.slice(normalizedRoot.length + 1) : '';
    var externalKind = '';
    var rootParts = normalizedRoot.split('/');
    var rootExternalName = '';
    rootParts.some(function (part, index) {
        if (/^epf$/i.test(part)) externalKind = 'ExternalDataProcessor';
        else if (/^erf$/i.test(part)) externalKind = 'ExternalReport';
        else return false;
        rootExternalName = rootParts[index + 1] || '';
        return true;
    });
    if (!relative) {
        /* A search can include sibling export roots (most often cfe) while
         * the active Configuration.xml lives under cf. Resolve those paths
         * against the common src directory before falling back to a basename;
         * otherwise every extension hit is shown merely as Module.bsl. */
        var rootScope = rootParts[rootParts.length - 1] || '';
        if (/^(cf|cfe|epf|erf)$/i.test(rootScope)) {
            var sourceRoot = rootParts.slice(0, -1).join('/');
            ['cf', 'cfe', 'epf', 'erf'].some(function (scope) {
                var sourcePrefix = sourceRoot.toLowerCase() + '/' + scope + '/';
                if (normalized.toLowerCase().indexOf(sourcePrefix) !== 0) return false;
                relative = normalized.slice(sourcePrefix.length);
                if (scope === 'epf') externalKind = 'ExternalDataProcessor';
                else if (scope === 'erf') externalKind = 'ExternalReport';
                if (scope === 'cfe') relative = relative.split('/').slice(1).join('/');
                return true;
            });
        }
    }
    if (!relative) relative = normalized.split('/').pop();
    var parts = relative.split('/').filter(Boolean);
    if (/^cfe$/i.test(parts[0] || '')) parts = parts.slice(2);
    var file = parts[parts.length - 1] || '';
    var module = file.replace(/\.bsl$/i, '');
    if (externalKind && parts.length >= 2
        && String(parts[parts.length - 2]).toLowerCase() === 'ext') {
        /* When the active root is the external object itself, the relative
         * path starts at Ext/ and its name comes from the root directory. */
        var externalName = parts.length >= 3 ? parts[parts.length - 3] : rootExternalName;
        if (externalName) {
            var externalRef = mdRef(externalKind + '.' + externalName);
            return moduleInfoResult(filePath, externalRef + '.' + (MODULE_TITLES[module] || module),
                relative, externalKind, externalName);
        }
    }
    if (parts.length === 2 && parts[0].toLowerCase() === 'ext')
        return moduleInfoResult(filePath, 'Конфигурация.' + (MODULE_TITLES[module] || module),
            relative, 'Configuration', '');
    var dirs = classDirs();
    var kind = '';
    Object.keys(dirs).some(function (candidate) {
        if (String(dirs[candidate]).toLowerCase() !== String(parts[0] || '').toLowerCase()) return false;
        kind = candidate;
        return true;
    });
    if (!kind || parts.length < 4)
        return moduleInfoResult(filePath, relative, relative, kind, parts[1]);
    var owner = parts[1];
    var ref = mdRef(kind + '.' + owner);
    if (String(parts[2]).toLowerCase() === 'forms' && parts[3])
        return moduleInfoResult(filePath, ref + '.' + parts[3], relative, kind, owner);
    if (String(parts[2]).toLowerCase() === 'commands' && parts[3])
        return moduleInfoResult(filePath, mdRef(kind + '.' + owner + '.Command.' + parts[3]), relative, kind, owner);
    if (kind === 'CommonForm' && /\/Form\/Module\.bsl$/i.test(normalized))
        return moduleInfoResult(filePath, ref, relative, kind, owner);
    if (kind === 'CommonModule' && module === 'Module')
        return moduleInfoResult(filePath, ref, relative, kind, owner);
    return moduleInfoResult(filePath, ref + '.' + (MODULE_TITLES[module] || module), relative, kind, owner);
}

var SEARCH_CATEGORIES = [
    { key: 'properties', title: 'Свойства' },
    { key: 'modules', title: 'Модули' },
    { key: 'formElements', title: 'Элементы форм' },
    { key: 'templates', title: 'Макеты' }
];

var SEARCH_SCOPES = [
    { key: 'cf', title: 'Конфигурация (cf)' },
    { key: 'cfe', title: 'Расширения (cfe)' },
    { key: 'epf', title: 'Внешние обработки (epf)' },
    { key: 'erf', title: 'Внешние отчёты (erf)' }
];

function searchFileInfo(rootDir, filePath) {
    if (/Module\.bsl$/i.test(String(filePath || ''))) return moduleInfo(rootDir, filePath);
    var normalizedRoot = String(rootDir || '').replace(/\\/g, '/').replace(/\/$/, '');
    var normalized = String(filePath || '').replace(/\\/g, '/');
    var src = normalizedRoot.replace(/\/(?:cf|cfe|epf|erf)$/i, '');
    var relative = normalized.toLowerCase().indexOf((src + '/').toLowerCase()) === 0
        ? normalized.slice(src.length + 1) : normalized.split('/').pop();
    return { path: filePath, label: relative, relative: relative };
}

function moduleMatcher(query, regexp, matchCase) {
    query = String(query || '');
    if (!query) return { error: 'Введите текст для поиска.' };
    if (regexp) {
        try {
            /* Search in source code is line-oriented: ^ and $ mean the start
             * and end of a module line, as in editors, not only of the whole
             * file. */
            var flags = matchCase ? 'm' : 'im';
            var expression = new RegExp(query, flags);
            return {
                find: function (text) {
                    var match = expression.exec(String(text || ''));
                    return match ? { index: match.index, length: match[0].length } : null;
                },
                count: function (text) {
                    text = String(text || '');
                    var all = new RegExp(query, flags + 'g');
                    var total = 0;
                    var match;
                    while ((match = all.exec(text))) {
                        total++;
                        /* JavaScript does not advance a global regexp after an
                         * empty match. Move by one UTF-16 unit so lookaheads
                         * and anchors are countable without an infinite loop. */
                        if (!match[0].length) all.lastIndex++;
                    }
                    return total;
                }
            };
        } catch (e) {
            return { error: 'Ошибка регулярного выражения: ' + (e && e.message || e) };
        }
    }
    var needle = matchCase ? query : query.toLowerCase();
    return {
        find: function (text) {
            text = String(text || '');
            var index = (matchCase ? text : text.toLowerCase()).indexOf(needle);
            return index >= 0 ? { index: index, length: query.length } : null;
        },
        count: function (text) {
            text = matchCase ? String(text || '') : String(text || '').toLowerCase();
            var total = 0;
            var at = 0;
            while ((at = text.indexOf(needle, at)) >= 0) {
                total++;
                at += needle.length;
            }
            return total;
        }
    };
}

/* A compact, editor-like explanation of the expression being typed. This is
 * intentionally not a full regexp parser: the JavaScript engine remains the
 * source of truth, while these hints translate the most useful BSL-search
 * constructs into plain Russian. */
function moduleRegexAssist(query) {
    query = String(query || '');
    var suggestions = [];
    function suggest(text, label, detail) {
        suggestions.push({ text: text, label: label, detail: detail || '', replaceEscape: false });
    }
    if (!query) {
        suggest('^\\s*', 'начало строки', 'строка начинается с возможных пробелов');
        suggest('.*', 'любой текст', 'любые символы между частями');
        suggest('(Процедура|Функция)', 'процедура или функция', 'один из двух вариантов');
        return { valid: true, message: 'Начните ввод — здесь появится разбор выражения.', suggestions: suggestions };
    }

    var escaped = false;
    var squareDepth = 0;
    var roundDepth = 0;
    for (var i = 0; i < query.length; i++) {
        var ch = query.charAt(i);
        if (escaped) { escaped = false; continue; }
        if (ch === '\\') { escaped = true; continue; }
        if (ch === '[') squareDepth++;
        else if (ch === ']' && squareDepth) squareDepth--;
        else if (!squareDepth && ch === '(') roundDepth++;
        else if (!squareDepth && ch === ')' && roundDepth) roundDepth--;
    }

    var error = '';
    try { new RegExp(query, 'im'); }
    catch (e) {
        if (escaped) error = 'После \\ ожидается специальный символ.';
        else if (squareDepth) error = 'Не закрыт диапазон символов: добавьте ].';
        else if (roundDepth) error = 'Не закрыта группа: добавьте ).';
        else error = 'Выражение пока не закончено: ' + (e && e.message || e);
    }
    if (escaped) {
        suggestions = [
            { text: '\\s', label: '\\s пробел', detail: 'пробел или перевод строки', replaceEscape: true },
            { text: '\\d', label: '\\d цифра', detail: 'одна цифра', replaceEscape: true },
            { text: '\\.', label: '\\. точка', detail: 'обычная точка', replaceEscape: true },
            { text: '\\(', label: '\\( скобка', detail: 'обычная открывающая скобка', replaceEscape: true }
        ];
    } else if (squareDepth) {
        suggest(']', 'закрыть ]', 'завершить диапазон символов');
    } else if (roundDepth) {
        suggest(')', 'закрыть )', 'завершить группу');
        suggest('|', 'или |', 'добавить ещё один вариант');
    } else {
        suggest('\\s*\\(', 'вызов метода', 'пробелы и открывающая скобка');
        suggest('\\s*=', 'присваивание', 'пробелы и знак равенства');
        suggest('.*', 'любой текст', 'любые символы между частями');
        suggest('|', 'или |', 'альтернативный вариант');
    }
    if (error) return { valid: false, message: error, suggestions: suggestions };

    var meaning = [];
    if (/^\^/.test(query)) meaning.push('от начала строки');
    if (/\\s[+*?]?/.test(query)) meaning.push('с пробельными символами');
    if (/\.\*/.test(query)) meaning.push('с любым текстом');
    if (/(^|[^\\])\|/.test(query)) meaning.push('с альтернативами');
    if (/\[[^\]]*\]/.test(query)) meaning.push('с диапазоном символов');
    if (/\$$/.test(query) && !/\\\$$/.test(query)) meaning.push('до конца строки');
    return {
        valid: true,
        message: meaning.length ? 'Корректно: поиск ' + meaning.join(', ') + '.' : 'Корректное регулярное выражение.',
        suggestions: suggestions
    };
}

function moduleSnippet(text, index, radius) {
    text = String(text || '').replace(/\r\n?/g, '\n');
    radius = radius == null ? 10 : radius;
    index = Math.max(0, Math.min(Number(index) || 0, text.length));
    var lineIndex = text.slice(0, index).split('\n').length - 1;
    var lines = text.split('\n');
    var start = Math.max(0, lineIndex - radius);
    var end = Math.min(lines.length, lineIndex + radius + 1);
    return {
        line: lineIndex + 1,
        lines: lines.slice(start, end).map(function (line, i) {
            return { number: start + i + 1, text: line, match: start + i === lineIndex };
        })
    };
}

function bytesToBase64(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i += 0x8000)
        s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return typeof btoa === 'function' ? btoa(s) : '';
}

var PICTURE_MIME = { png: 'image/png', svg: 'image/svg+xml', gif: 'image/gif', bmp: 'image/bmp', jpg: 'image/jpeg', jpeg: 'image/jpeg' };

function orderBy(list, order, keyOf) {
    var rank = {};
    order.forEach(function (key, i) { rank[key] = i; });
    return list.map(function (item, i) { return { item: item, i: i }; }).sort(function (a, b) {
        var ra = rank[keyOf(a.item)], rb = rank[keyOf(b.item)];
        if (ra != null && rb != null) return ra - rb;
        if (ra != null) return -1;
        if (rb != null) return 1;
        return a.i - b.i;
    }).map(function (x) { return x.item; });
}

function createLoader(io, cache) {
    cache = cache || {};
    var FC = root.FormContext;
    function filterConverted(text, filter) {
        return filter && FC && FC.filterText ? FC.filterText(text, filter) : text;
    }

    function decode(bytes, filter, filePath) {
        if (!bytes) return null;
        var text = FC && FC.decodeText ? FC.decodeText(bytes).content : new TextDecoder('utf-8').decode(bytes);
        if (/\.mdo$/i.test(filePath || '') && root.ProjMetadataConverter) {
            var metadata = root.ProjMetadataConverter.convert(text);
            if (metadata && metadata.ok) text = metadata.xml;
        } else if (/\.form$/i.test(filePath || '') && root.ProjFormConverter) {
            var form = root.ProjFormConverter.convert(text);
            if (form && form.ok) text = form.xml;
        }
        return filterConverted(text, filter);
    }

    function readTexts(paths, filter) {
        var chunks = [];
        for (var i = 0; i < paths.length; i += CHUNK) chunks.push(paths.slice(i, i + CHUNK));
        return Promise.all(chunks.map(function (chunk) {
            var hostFilter = chunk.some(function (path) { return /\.mdo$/i.test(path); }) ? '' : filter || '';
            return io.readMany(chunk, MAX_BYTES, hostFilter);
        })).then(function (parts) {
            var out = [];
            var offset = 0;
            parts.forEach(function (part) {
                for (var k = 0; k < part.length; k++) out.push(decode(part[k], filter, paths[offset++]));
            });
            return out;
        });
    }

    /* One result per module, not per occurrence. First find matching files,
     * then count occurrences only when the complete result stays small. */
    function searchModules(configPath, query, settings) {
        settings = settings || {};
        var matcher = moduleMatcher(query, !!settings.regexp, !!settings.matchCase);
        if (matcher.error) return Promise.resolve({ error: matcher.error, matches: [], scanned: 0, total: 0 });
        if (!io || (!settings.filePaths && typeof io.searchFiles !== 'function' && typeof io.moduleFiles !== 'function'))
            return Promise.resolve({ error: 'Этот хост не поддерживает глобальный поиск.', matches: [], scanned: 0, total: 0 });
        var rootDir = rootOfConfigPath(configPath);
        var selectedCategories = settings.categories || { modules: true };
        var selectedScopes = settings.scopes || { cf: true };
        var categories = SEARCH_CATEGORIES.filter(function (item) { return selectedCategories[item.key]; })
            .map(function (item) { return item.key; });
        var scopes = SEARCH_SCOPES.filter(function (item) { return selectedScopes[item.key]; })
            .map(function (item) { return item.key; });
        if (!categories.length) return Promise.resolve({ error: 'Выберите хотя бы одну область поиска.', matches: [], scanned: 0, total: 0 });
        if (!scopes.length) return Promise.resolve({ error: 'Выберите хотя бы один источник.', matches: [], scanned: 0, total: 0 });
        var pathsPromise = settings.filePaths ? Promise.resolve(settings.filePaths)
            : typeof io.searchFiles === 'function'
            ? io.searchFiles(rootDir, categories, scopes) : io.moduleFiles(rootDir);
        return Promise.resolve(pathsPromise).then(function (paths) {
            paths = Array.prototype.slice.call(paths || []);
            var found = [];
            var occurrenceCounts = [];
            var matched = 0;
            var at = 0;
            var limit = settings.limit || 500;
            function result(cancelled) {
                return { matches: found, scanned: at, files: paths.length, total: matched,
                    truncated: matched > found.length, cancelled: !!cancelled };
            }
            if (typeof settings.onProgress === 'function') settings.onProgress(0, paths.length);
            function countOccurrences() {
                if (matched >= 20 || !found.length) return Promise.resolve(result(false));
                if (typeof settings.onProgress === 'function') settings.onProgress(0, found.length, 'count');
                for (var countAt = 0; countAt < found.length; countAt++) {
                    if (typeof settings.cancelled === 'function' && settings.cancelled())
                        return Promise.resolve(result(true));
                    found[countAt].occurrences = occurrenceCounts[countAt];
                    if (typeof settings.onMatch === 'function') settings.onMatch(found[countAt], true);
                }
                if (typeof settings.onProgress === 'function') settings.onProgress(found.length, found.length, 'count');
                return Promise.resolve(result(false));
            }
            function next() {
                if (typeof settings.cancelled === 'function' && settings.cancelled())
                    return Promise.resolve(result(true));
                if (at >= paths.length) return countOccurrences();
                var chunk = paths.slice(at, at + SEARCH_CHUNK);
                at += chunk.length;
                return io.readMany(chunk, MAX_BYTES, '').then(function (bytes) {
                    for (var i = 0; i < chunk.length; i++) {
                        if (!bytes[i]) continue;
                        var text = String(decode(bytes[i], '', chunk[i]) || '').replace(/\r\n?/g, '\n');
                        var match = matcher.find(text);
                        if (!match) continue;
                        matched++;
                        if (found.length >= limit) continue;
                        var item = typeof settings.describePath === 'function'
                            ? settings.describePath(chunk[i]) : searchFileInfo(rootDir, chunk[i]);
                        var snippet = moduleSnippet(text, match.index, 10);
                        item.line = snippet.line;
                        item.snippet = snippet.lines;
                        found.push(item);
                        if (matched < 20) occurrenceCounts.push(matcher.count(text));
                        if (typeof settings.onMatch === 'function') settings.onMatch(item, false);
                    }
                    if (typeof settings.onProgress === 'function') settings.onProgress(at, paths.length);
                    if (typeof settings.cancelled === 'function' && settings.cancelled()) return result(true);
                    return next();
                });
            }
            return next();
        }, function (err) {
            return { error: 'Не удалось прочитать список файлов: ' + (err && err.message || err),
                matches: [], scanned: 0, total: 0 };
        });
    }

    function searchPaths(paths, query, settings) {
        settings = Object.assign({}, settings || {}, { filePaths: paths || [] });
        return searchModules(settings.rootDir || '', query, settings);
    }

    /* Picture descriptors (<X>.xml naming xr:Abs) to data URLs; the image
     * sits in the folder named like the descriptor. In current 8.5.1 exports
     * section pictures are normally scalable Picture.zip bundles, decoded by
     * the same routine as pictures on forms and in the metadata window. */
    function pictureFiles(descriptors) {
        var wanted = descriptors.filter(Boolean);
        var none = descriptors.map(function () { return ''; });
        if (!wanted.length) return Promise.resolve(none);
        return readTexts(wanted, '').then(function (texts) {
            var byPath = {};
            wanted.forEach(function (p, i) { byPath[p] = texts[i]; });
            var files = descriptors.map(function (d) {
                var text = d && byPath[d];
                var abs = text && (text.match(/<(?:xr:)?Abs>([^<]+)</) || [])[1];
                return abs ? join(d.replace(/\.xml$/i, ''), abs.trim()) : '';
            });
            var toRead = files.filter(function (f) {
                var ext = f.split('.').pop().toLowerCase();
                return f && (PICTURE_MIME[ext] || ext === 'zip');
            });
            if (!toRead.length) return none;
            return io.readMany(toRead, 4 * 1024 * 1024, '').then(function (blobs) {
                return Promise.all(toRead.map(function (f, i) {
                    if (!blobs[i]) return '';
                    var ext = f.split('.').pop().toLowerCase();
                    if (ext !== 'zip') return 'data:' + PICTURE_MIME[ext] + ';base64,' + bytesToBase64(blobs[i]);
                    var forms = root.FormPreview;
                    return forms && forms.zipPictureDataUrl
                        ? forms.zipPictureDataUrl({ mime: 'application/zip', data: bytesToBase64(blobs[i]), file: f })
                        : '';
                })).then(function (decoded) {
                    var urls = {};
                    toRead.forEach(function (f, i) { if (decoded[i]) urls[f] = decoded[i]; });
                    return files.map(function (f) { return urls[f] || ''; });
                });
            });
        }).catch(function () { return none; });
    }

    function pictures(rootDir, refs) {
        return pictureFiles(refs.map(function (ref) {
            var m = String(ref || '').match(/^CommonPicture\.(.+)$/);
            return m ? join(rootDir, 'CommonPictures', m[1], 'Ext', 'Picture.xml') : '';
        }));
    }

    function subsystemInfo(path, ref, text) {
        var props = propertiesOf(text);
        return {
            ref: ref,
            path: path,
            adopted: isAdopted(text),
            name: valueOf(props, 'Name'),
            title: localized(props, 'Synonym') || valueOf(props, 'Name'),
            include: valueOf(props, 'IncludeInCommandInterface') !== 'false',
            picture: (String(props).match(/<Picture>\s*<xr:Ref>([^<]+)</) || [])[1] || '',
            content: listOf(props, 'Content', 'Item'),
            children: (String(text).match(/<Subsystem>[^<]+<\/Subsystem>/g) || []).map(function (s) {
                return s.replace(/<\/?Subsystem>/g, '').trim();
            })
        };
    }

    function state(rootDir) {
        var key = rootDir.toLowerCase();
        return cache[key] || (cache[key] = { sections: {}, rights: {}, heads: {} });
    }

    /* The window without any section open: { root, sections, home, mainImage }. */
    function loadMain(configPath, model) {
        var rootDir = rootOfConfigPath(configPath);
        var st = state(rootDir);
        if (st.main) return st.main;
        var names = (model && model.subsystems) || [];
        var refs = names.map(function (n) { return 'Subsystem.' + n; });
        var paths = refs.map(function (r) { return sectionPath(rootDir, r); });
        st.main = Promise.all([
            readTexts(paths, ''),
            readTexts([configurationInterfacePath(rootDir, 'CommandInterface'),
                join(rootDir, 'Ext', 'HomePageWorkArea.xml')], '')
        ]).then(function (r) {
            var subs = [];
            r[0].forEach(function (text, i) { if (text) subs.push(subsystemInfo(paths[i], refs[i], text)); });
            var ci = parseCommandInterface(r[1][0]);
            var ordered = orderBy(subs.filter(function (s) { return s.include; }), ci.subsystems, function (s) { return s.ref; });
            var home = parseHomePage(r[1][1]);
            return Promise.all([
                pictures(rootDir, ordered.map(function (s) { return s.picture; })),
                homeForms(rootDir, home),
                pictureFiles([join(rootDir, 'Ext', 'MainSectionPicture.xml')])
            ]).then(function (p) {
                ordered.forEach(function (s, i) { s.image = p[0][i]; });
                return { root: rootDir, sections: ordered, home: p[1], mainImage: p[2][0] };
            });
        });
        st.main.catch(function () { st.main = null; });
        return st.main;
    }

    function homeForms(rootDir, home) {
        var all = home.left.concat(home.right).filter(function (i) { return i.visible; });
        var located = all.map(function (i) { return formLocations(rootDir, i.form); });
        var descriptors = located.filter(Boolean).map(function (l) { return l.descriptor; });
        var ownerPaths = all.map(function (i) { return descriptorPath(rootDir, i.form.split('.').slice(0, 2).join('.')); })
            .filter(Boolean);
        return Promise.all([
            readTexts(descriptors, 'configuration-properties'),
            readTexts(ownerPaths, 'configuration-properties')
        ]).then(function (r) {
            var ownerHeads = {};
            ownerPaths.forEach(function (p, i) { ownerHeads[p] = r[1][i] ? propertiesOf(r[1][i]) : ''; });
            var titles = {};
            descriptors.forEach(function (d, i) { titles[d] = r[0][i] ? localized(propertiesOf(r[0][i]), 'Synonym') : null; });
            /* A form named only by its role (Форма, Форма списка...) is titled
             * by its owner, as the client does: a list form by the list
             * presentation, any other by the object's synonym. */
            function titleOf(item, loc) {
                var own = loc && titles[loc.descriptor];
                if (own && !/^Форма(\s|$)/.test(own)) return own;
                var head = ownerHeads[descriptorPath(rootDir, item.form.split('.').slice(0, 2).join('.'))];
                var owner = head && ((/Список|List/i.test(item.form.split('.').pop()) && localized(head, 'ListPresentation'))
                    || localized(head, 'Synonym'));
                return owner || own || item.form.split('.').pop();
            }
            function column(list) {
                return list.filter(function (i) { return i.visible; }).map(function (item) {
                    var loc = formLocations(rootDir, item.form);
                    return {
                        form: item.form, height: item.height,
                        title: titleOf(item, loc),
                        path: loc && titles[loc.descriptor] != null ? loc.layout : ''
                    };
                });
            }
            return { template: home.template, left: column(home.left), right: column(home.right) };
        }).catch(function () { return { template: home.template, left: [], right: [] }; });
    }

    /* The whole tree below one section: subsystems with their command
     * interface settings. */
    function loadTree(rootDir, top) {
        function level(nodes) {
            if (!nodes.length) return Promise.resolve();
            var ciPaths = nodes.map(function (n) { return subsystemInterfacePath(rootDir, n.path); });
            return readTexts(ciPaths, '').then(function (cis) {
                var next = [];
                return Promise.all(nodes.map(function (node, i) {
                    node.ci = parseCommandInterface(cis[i]);
                    var childRefs = node.children.map(function (c) { return node.ref + '.Subsystem.' + c; });
                    var childPaths = childRefs.map(function (r) { return sectionPath(rootDir, r); });
                    return readTexts(childPaths, '').then(function (texts) {
                        var kids = [];
                        texts.forEach(function (t, k) { if (t) kids.push(subsystemInfo(childPaths[k], childRefs[k], t)); });
                        node.nodes = orderBy(kids.filter(function (k) { return k.include; }), node.ci.subsystems,
                            function (k) { return k.ref; });
                        next = next.concat(node.nodes);
                    });
                })).then(function () { return level(next); });
            });
        }
        return level([top]).then(function () { return top; });
    }

    /* Properties and commands of every content object, keyed by object ref. */
    function loadObjects(rootDir, refs) {
        var wanted = refs.filter(function (r) { return descriptorPath(rootDir, r); });
        var paths = wanted.map(function (r) { return descriptorPath(rootDir, r); });
        var sources = projRoot(rootDir) ? readTexts(paths, '').then(function (texts) {
            return [texts.map(function (text) { return text == null ? null : filterConverted(text, 'configuration-properties'); }),
                texts.map(function (text) { return text == null ? null : filterConverted(text, 'command-blocks'); })];
        }) : Promise.all([
            readTexts(paths, 'configuration-properties'),
            readTexts(paths, 'command-blocks')
        ]);
        return sources.then(function (r) {
            var out = {};
            wanted.forEach(function (ref, i) {
                if (r[0][i] == null) return;
                out[ref] = { ref: ref, path: paths[i], head: propertiesOf(r[0][i]), commands: parseCommands(r[1][i]) };
            });
            return out;
        });
    }

    /* Command groups a section places commands into: { ref: { title, category } }. */
    function loadGroups(rootDir, top, objects) {
        var refs = {};
        function note(group) { if (/^CommandGroup\./.test(group)) refs[group] = true; }
        Object.keys(objects).forEach(function (k) {
            note(valueOf(objects[k].head, 'Group'));
            objects[k].commands.forEach(function (c) { note(c.group); });
        });
        (function walk(node) {
            if (node.ci) {
                Object.keys(node.ci.placement).forEach(function (k) { note(node.ci.placement[k]); });
                Object.keys(node.ci.order).forEach(function (k) { note(node.ci.order[k].group); });
            }
            (node.nodes || []).forEach(walk);
        })(top);
        var list = Object.keys(refs);
        var paths = list.map(function (r) { return descriptorPath(rootDir, r); });
        return readTexts(paths, 'configuration-properties').then(function (texts) {
            var out = {};
            list.forEach(function (ref, i) {
                var head = propertiesOf(texts[i] || '');
                out[ref] = { title: localized(head, 'Synonym') || ref.split('.')[1], category: valueOf(head, 'Category') };
            });
            return out;
        });
    }

    function contentOf(top) {
        var refs = {};
        (function collect(node) {
            node.content.forEach(function (c) { refs[c] = true; });
            (node.nodes || []).forEach(collect);
        })(top);
        return Object.keys(refs);
    }

    /* What a panel is built from: { top, objects, groups }. "Главное" has
     * no subsystem: its commands are the ones its command interface turns on. */
    function loadSection(configPath, sectionRef) {
        var rootDir = rootOfConfigPath(configPath);
        var st = state(rootDir);
        if (st.sections[sectionRef]) return st.sections[sectionRef];
        var topReady = sectionRef === HOME
            ? readTexts([configurationInterfacePath(rootDir, 'MainSectionCommandInterface')], '').then(function (t) {
                var ci = parseCommandInterface(t[0]);
                var refs = {};
                [ci.visibility, ci.roleVisibility, ci.placement, ci.order].forEach(function (map) {
                    Object.keys(map).forEach(function (id) { refs[commandObject(id)] = true; });
                });
                return { ref: HOME, title: 'Главное', path: '', content: Object.keys(refs), ci: ci, nodes: [], explicit: true };
            })
            : loadMain(configPath, null).then(function (main) {
                var top = main.sections.filter(function (s) { return s.ref === sectionRef; })[0];
                return top ? loadTree(rootDir, top) : null;
            });
        st.sections[sectionRef] = topReady.then(function (top) {
            if (!top) return null;
            return loadObjects(rootDir, contentOf(top)).then(function (objects) {
                return loadGroups(rootDir, top, objects).then(function (groups) {
                    return { top: top, objects: objects, groups: groups };
                });
            });
        });
        st.sections[sectionRef].catch(function () { st.sections[sectionRef] = null; });
        return st.sections[sectionRef];
    }

    /* Functional options: { index: { 'Catalog.X': ['Опция'], 'Subsystem.Y': [...] },
     * titles: { Опция: 'Синоним' }, location: { Опция: 'Constant.X' } }. */
    function functionalOptions(configPath, names) {
        var rootDir = rootOfConfigPath(configPath);
        var st = state(rootDir);
        if (st.fo) return st.fo;
        var paths = (names || []).map(function (n) { return descriptorPath(rootDir, 'FunctionalOption.' + n); });
        st.fo = readTexts(paths, 'configuration-properties').then(function (texts) {
            var out = { index: {}, titles: {}, location: {} };
            texts.forEach(function (text, i) {
                if (!text) return;
                var head = propertiesOf(text);
                out.titles[names[i]] = localized(head, 'Synonym') || names[i];
                /* Constant.X, Catalog.X.Attribute.Y -> the object that stores the value. */
                out.location[names[i]] = valueOf(head, 'Location').split('.').slice(0, 2).join('.');
                listOf(head, 'Content', 'Item').concat(listOf(head, 'Content', 'Object')).forEach(function (ref) {
                    (out.index[ref] || (out.index[ref] = [])).push(names[i]);
                });
            });
            return out;
        });
        st.fo.catch(function () { st.fo = null; });
        return st.fo;
    }

    /* Every subsystem, technical ones too, depth first:
     * [{ ref, title, trail: ['Раздел', 'Подсистема'], include, content }].
     * `include` is the top subsystem's IncludeInCommandInterface. */
    function subsystemTree(configPath, names) {
        var rootDir = rootOfConfigPath(configPath);
        var st = state(rootDir);
        if (st.tree) return st.tree;
        function level(refs, trail, include) {
            var paths = refs.map(function (r) { return sectionPath(rootDir, r); });
            return readTexts(paths, '').then(function (texts) {
                var nodes = [];
                texts.forEach(function (t, i) { if (t) nodes.push(subsystemInfo(paths[i], refs[i], t)); });
                return Promise.all(nodes.map(function (n) {
                    var own = trail.concat([n.title]);
                    var top = include == null ? n.include : include;
                    return level(n.children.map(function (c) { return n.ref + '.Subsystem.' + c; }), own, top)
                        .then(function (below) {
                            return [{ ref: n.ref, title: n.title, trail: own, include: top, content: n.content }].concat(below);
                        });
                })).then(function (lists) { return [].concat.apply([], lists); });
            });
        }
        st.tree = level((names || []).map(function (n) { return 'Subsystem.' + n; }), [], null);
        st.tree.catch(function () { st.tree = null; });
        return st.tree;
    }

    function roleRights(configPath, role) {
        var rootDir = rootOfConfigPath(configPath);
        var st = state(rootDir);
        if (!st.rights[role]) {
            var path = PROJ_ROOTS[rootDir.toLowerCase()]
                ? join(rootDir, 'Roles', role, 'Rights.rights') : join(rootDir, 'Roles', role, 'Ext', 'Rights.xml');
            st.rights[role] = readTexts([path], '').then(function (t) {
                return t[0] == null ? null : parseRights(t[0]);
            });
            st.rights[role].catch(function () { st.rights[role] = null; });
        }
        return st.rights[role];
    }

    /* Synonyms of objects of one class, for "Все функции" and the search
     * over the whole configuration. A class the export writes no folder for
     * is named by its objects' names alone. */
    function synonyms(configPath, kind, names) {
        var rootDir = rootOfConfigPath(configPath);
        var st = state(rootDir);
        if (!st.heads[kind]) {
            var dir = classDirs()[kind];
            var paths = names.map(function (n) { return dir ? descriptorPath(rootDir, kind + '.' + n) : ''; });
            st.heads[kind] = readTexts(paths.filter(Boolean), 'configuration-properties').then(function (texts) {
                var i = 0;
                return names.map(function (n, k) {
                    var text = paths[k] ? texts[i++] : null;
                    var head = propertiesOf(text || '');
                    return {
                        name: n,
                        title: localized(head, 'ListPresentation') || localized(head, 'Synonym') || n,
                        path: text == null ? '' : paths[k]
                    };
                });
            });
            st.heads[kind].catch(function () { st.heads[kind] = null; });
        }
        return st.heads[kind];
    }

    /* The extensions of a configuration: the directories the host finds
     * near its root whose Configuration.xml is an extension. A host that
     * cannot list directories leaves the window with the configuration
     * alone. Each entry is { dir, configPath, name, title, model }. */
    function extensions(configPath) {
        var rootDir = rootOfConfigPath(configPath);
        var st = state(rootDir);
        if (st.exts) return st.exts;
        if (typeof io.extensionConfigurations !== 'function') return Promise.resolve([]);
        st.exts = Promise.resolve(io.extensionConfigurations(rootDir)).then(function (dirs) {
            var list = (Array.isArray(dirs) ? dirs : []).filter(function (d) {
                return typeof d === 'string' && d && d.toLowerCase() !== rootDir.toLowerCase();
            });
            if (!list.length) return [];
            var paths = list.map(function (d) { return join(d, 'Configuration.xml'); });
            return readTexts(paths, '').then(function (texts) {
                var out = [];
                texts.forEach(function (text, i) {
                    if (!text) return;
                    var parsed = parse(text);
                    if (!parsed.model || !parsed.model.extension) return;
                    out.push({
                        dir: list[i], configPath: paths[i], name: parsed.model.name,
                        title: parsed.model.synonym || parsed.model.name, model: parsed.model
                    });
                });
                out.sort(function (a, b) { return a.title.localeCompare(b.title, 'ru'); });
                return out;
            });
        }, function () { return []; });
        st.exts.catch(function () { st.exts = null; });
        return st.exts;
    }

    /* What an extension holds, class by class in the Designer's order:
     * [{ kind, title, items: [{ name, title, ref, path, adopted }] }]. An
     * object the export does not write a file for is listed by its name. */
    function extensionContent(configPath, objects) {
        var rootDir = rootOfConfigPath(configPath);
        var st = state(rootDir);
        if (st.ext) return st.ext;
        var dirs = classDirs();
        var kinds = Object.keys(objects || {}).filter(function (k) { return (objects[k] || []).length; });
        var order = (root.MetadataPreview && root.MetadataPreview.classOrder) || [];
        kinds = orderBy(kinds, order, function (k) { return k; });
        var paths = [];
        kinds.forEach(function (kind) {
            objects[kind].forEach(function (name) {
                paths.push(dirs[kind] ? descriptorPath(rootDir, kind + '.' + name) : '');
            });
        });
        st.ext = readTexts(paths.filter(Boolean), 'configuration-properties').then(function (texts) {
            var byPath = {};
            var i = 0;
            paths.filter(Boolean).forEach(function (path) { byPath[path] = texts[i++]; });
            var at = 0;
            var classes = kinds.map(function (kind) {
                return {
                    kind: kind,
                    title: classTitle(kind),
                    items: objects[kind].map(function (name) {
                        var path = paths[at++];
                        var text = path ? byPath[path] : null;
                        return {
                            name: name,
                            title: (text && localized(propertiesOf(text), 'Synonym')) || name,
                            ref: kind + '.' + name,
                            path: text == null ? '' : path,
                            adopted: isAdopted(text)
                        };
                    })
                };
            });
            var own = 0, adopted = 0;
            classes.forEach(function (c) {
                c.items.forEach(function (i) { if (i.adopted) adopted++; else own++; });
            });
            return { classes: classes, own: own, adopted: adopted };
        });
        st.ext.catch(function () { st.ext = null; });
        return st.ext;
    }

    return {
        loadMain: loadMain, loadSection: loadSection, functionalOptions: functionalOptions, subsystemTree: subsystemTree,
        roleRights: roleRights, synonyms: synonyms, extensionContent: extensionContent, extensions: extensions,
        searchModules: searchModules, searchPaths: searchPaths
    };
}

/* ------------------------------------------------------ command interface */

function commandsOf(object, ref) {
    var kind = ref.split('.')[0];
    var head = object ? object.head : '';
    var out = [];
    var synonym = localized(head, 'Synonym') || ref.split('.')[1];
    if (kind === 'CommonCommand') {
        var group = valueOf(head, 'Group');
        if (group) out.push({ id: ref, title: synonym, group: group, visible: true, path: object && object.path });
        return out;
    }
    if (object && valueOf(head, 'UseStandardCommands') !== 'false') {
        (STANDARD[kind] || []).forEach(function (std) {
            if (std[3] && !std[3](head)) return;
            var visible = typeof std[2] === 'function' ? std[2](head) : std[2];
            var title = std[0] === 'OpenList'
                ? localized(head, 'ListPresentation') || synonym
                : std[0] === 'Create' ? localized(head, 'ObjectPresentation') || synonym : synonym;
            out.push({ id: ref + '.StandardCommand.' + std[0], title: title, group: std[1], visible: visible, path: object.path });
        });
    }
    if (object) {
        object.commands.forEach(function (c) {
            if (!c.group || c.parameter) return;
            out.push({ id: ref + '.Command.' + c.name, title: c.title || c.name, group: c.group, visible: true,
                path: c.path || object.path, ext: c.ext || object.ext || '' });
        });
    }
    if (object && object.ext) out.forEach(function (c) { if (!c.ext) c.ext = object.ext; });
    return out;
}

/* A section as the client shows it when extensions are applied: the
 * configuration's own panel plus what every extension adds to the same
 * subsystem — its content, its command interface settings and the commands
 * it writes on adopted objects. Nothing is mutated: the loader keeps the
 * parts in its cache and they are merged anew for each drawing. */
function mergeSectionRaws(parts) {
    var first = parts[0];
    if (parts.length < 2 || !first) return first;
    function mergedMaps(a, b) {
        var out = {};
        Object.keys(a || {}).forEach(function (k) { out[k] = a[k]; });
        Object.keys(b || {}).forEach(function (k) { out[k] = b[k]; });
        return out;
    }
    var top = { ref: first.top.ref, title: first.top.title, path: first.top.path, explicit: first.top.explicit,
        content: first.top.content.slice(), nodes: (first.top.nodes || []).slice(), ci: first.top.ci, ext: first.top.ext };
    var objects = {};
    var groups = {};
    Object.keys(first.objects).forEach(function (k) { objects[k] = first.objects[k]; });
    Object.keys(first.groups).forEach(function (k) { groups[k] = first.groups[k]; });
    parts.slice(1).forEach(function (part) {
        if (!part || !part.top) return;
        var title = part.ext || '';
        top.content = top.content.concat(part.top.content || []);
        top.nodes = top.nodes.concat((part.top.nodes || []).map(function (n) { return markNode(n, title); }));
        if (part.top.ci) {
            top.ci = top.ci ? {
                visibility: mergedMaps(top.ci.visibility, part.top.ci.visibility),
                roleVisibility: mergedMaps(top.ci.roleVisibility, part.top.ci.roleVisibility),
                placement: mergedMaps(top.ci.placement, part.top.ci.placement),
                order: mergedMaps(top.ci.order, part.top.ci.order),
                subsystems: top.ci.subsystems.concat(part.top.ci.subsystems),
                groups: top.ci.groups.concat(part.top.ci.groups)
            } : part.top.ci;
        }
        Object.keys(part.objects).forEach(function (ref) {
            var add = part.objects[ref];
            var own = objects[ref];
            if (!own) {
                objects[ref] = { ref: ref, path: add.path, head: add.head, ext: title,
                    commands: add.commands.map(function (c) { return markCommand(c, title, add.path); }) };
                return;
            }
            /* An adopted object: the configuration's descriptor stands, the
             * extension only adds commands of its own. */
            objects[ref] = { ref: ref, path: own.path, head: own.head, ext: own.ext,
                commands: own.commands.concat(add.commands.filter(function (c) {
                    return !own.commands.some(function (k) { return k.name === c.name; });
                }).map(function (c) { return markCommand(c, title, add.path); })) };
        });
        Object.keys(part.groups).forEach(function (ref) { if (!groups[ref]) groups[ref] = part.groups[ref]; });
    });
    return { top: top, objects: objects, groups: groups };
}

function markCommand(command, ext, path) {
    var out = {};
    Object.keys(command).forEach(function (k) { out[k] = command[k]; });
    out.ext = command.ext || ext;
    out.path = command.path || path;
    return out;
}

function markNode(node, ext) {
    if (!ext || node.ext) return node;
    var out = {};
    Object.keys(node).forEach(function (k) { out[k] = node[k]; });
    out.ext = ext;
    out.nodes = (node.nodes || []).map(function (n) { return markNode(n, ext); });
    return out;
}

function mergeCi(parent, own) {
    if (!parent) return own;
    function merged(a, b) {
        var out = {};
        Object.keys(a).forEach(function (k) { out[k] = a[k]; });
        Object.keys(b).forEach(function (k) { out[k] = b[k]; });
        return out;
    }
    return {
        visibility: merged(parent.visibility, own.visibility),
        roleVisibility: merged(parent.roleVisibility, own.roleVisibility),
        placement: merged(parent.placement, own.placement),
        order: merged(parent.order, own.order),
        subsystems: own.subsystems,
        groups: own.groups
    };
}

function sortRanked(list) {
    return list.map(function (e, i) { return { e: e, i: i }; }).sort(function (a, b) {
        var ra = a.e.rank, rb = b.e.rank;
        if (ra != null && rb != null) return ra - rb;
        if (ra != null) return -1;
        if (rb != null) return 1;
        return a.i - b.i;
    }).map(function (x) { return x.e; });
}

/* The function panel of a loaded section, as seen with `view`:
 *   roles   — ['Role.X', ...] or none for everybody (common visibility, all rights),
 *   rights  — those roles' rights together (unionRights),
 *   fo      — functional options by object, command or subsystem (loader index),
 *   foOff   — { option: true } for the options taken as switched off: what
 *             only such options control is left out, as the client does.
 * One block per subsystem, depth first: { title, depth, groups: { Navigation
 * groups..., custom: [{ title, items }] } }; actions of the whole section in
 * `actions`, ordered by the section's GroupsOrder. */
function buildPanel(raw, view) {
    view = view || {};
    var top = raw.top;
    var objects = raw.objects;
    var groupsInfo = raw.groups || {};
    var blocks = [];
    var actions = {};
    var actionOrder = [];
    function actionList(key, title) {
        if (!actions[key]) { actions[key] = { key: key, title: title, items: [] }; actionOrder.push(key); }
        return actions[key].items;
    }
    ACTION_GROUPS.forEach(function (g) { actionList(g, ACTION_TITLES[g]); });
    var seen = {};

    function visible(ci, cmd) {
        var perRole = view.roles && view.roles.length && ci.roleVisibility[cmd.id];
        if (perRole) {
            var any = null;
            view.roles.forEach(function (r) { if (perRole[r] != null) any = any || perRole[r]; });
            if (any != null) return any;
        }
        if (ci.visibility[cmd.id] != null) return ci.visibility[cmd.id];
        return top.explicit ? false : cmd.visible;
    }

    function visit(node, depth, inherited) {
        if (depth && view.rights && !hasRight(view.rights, node.ref, 'View')) return;
        var nodeFo = depth && view.fo ? view.fo[node.ref] || null : null;
        if (switchedOff(nodeFo, view.foOff)) return;
        var ci = mergeCi(inherited, node.ci || parseCommandInterface(''));
        var groups = { custom: [] };
        var custom = {};
        NAV_GROUPS.forEach(function (g) { groups[g] = []; });
        node.content.forEach(function (ref) {
            commandsOf(objects[ref], ref).forEach(function (cmd) {
                if (!visible(ci, cmd)) return;
                if (view.rights && !hasRight(view.rights, commandObject(cmd.id), requiredRight(cmd.id))) return;
                var fo = view.fo ? (view.fo[cmd.id] || view.fo[commandObject(cmd.id)] || null) : null;
                if (switchedOff(fo, view.foOff)) return;
                var group = ci.placement[cmd.id] || (ci.order[cmd.id] && ci.order[cmd.id].group) || cmd.group;
                var entry = {
                    id: cmd.id, title: cmd.title, path: cmd.path, fo: fo, ext: cmd.ext || node.ext || '',
                    rank: ci.order[cmd.id] ? ci.order[cmd.id].index : null
                };
                if (groups[group]) { groups[group].push(entry); return; }
                var info = groupsInfo[group];
                if (info && info.category === 'NavigationPanel') {
                    if (!custom[group]) groups.custom.push(custom[group] = { title: info.title, items: [] });
                    custom[group].items.push(entry);
                    return;
                }
                var key = actionTitle(group, info);
                if (!key || seen[group + cmd.id]) return;
                seen[group + cmd.id] = true;
                actionList(group, key).push(entry);
            });
        });
        NAV_GROUPS.forEach(function (g) { groups[g] = sortRanked(groups[g]); });
        groups.custom.forEach(function (c) { c.items = sortRanked(c.items); });
        blocks.push({ ref: node.ref, title: node.title, depth: depth, path: node.path, groups: groups, fo: nodeFo,
            ext: node.ext || '' });
        (node.nodes || []).forEach(function (child) { visit(child, depth + 1, ci); });
    }
    visit(top, 0, null);
    var ordered = reorderSlots(actionOrder, (top.ci && top.ci.groups) || []);
    return {
        ref: top.ref, title: top.title, blocks: blocks,
        actions: ordered.map(function (k) {
            return { key: k, title: actions[k].title, items: sortRanked(actions[k].items) };
        }).filter(function (a) { return a.items.length; })
    };
}

/* GroupsOrder names only the groups the developer moved: they swap among
 * the places they hold in the default order, the rest stay where they are. */
function reorderSlots(list, order) {
    var listed = order.filter(function (k) { return list.indexOf(k) >= 0; });
    var at = 0;
    return list.map(function (k) { return listed.indexOf(k) >= 0 ? listed[at++] : k; });
}

/* Available while any of its options is on; with none it always is. */
function switchedOff(options, off) {
    if (!options || !options.length || !off) return false;
    for (var i = 0; i < options.length; i++) if (!off[options[i]]) return false;
    return true;
}

/* Functional options as a tree of the subsystems that list them in their
 * content; an option no subsystem lists goes by the subsystems of the object
 * that stores it (fo.location), else into the last node. An option listed
 * by several subsystems is in each of them. Only subsystems with options
 * somewhere below are kept; sections come before technical subsystems, each
 * part in the configuration's order.
 * -> [{ ref, title, technical, names, children, all }], `names` the node's
 *    own options, `all` every option of the node and its children. */
function groupOptions(fo, tree) {
    var byRef = {};
    (tree || []).forEach(function (node) {
        node.content.forEach(function (item) { (byRef[item] || (byRef[item] = [])).push(node.ref); });
    });
    var members = {};
    var loose = [];
    Object.keys(fo.titles).forEach(function (name) {
        var refs = byRef['FunctionalOption.' + name] || byRef[fo.location && fo.location[name]] || [];
        if (!refs.length) loose.push(name);
        refs.forEach(function (r) { (members[r] || (members[r] = [])).push(name); });
    });
    function byTitle(a, b) { return String(fo.titles[a]).localeCompare(String(fo.titles[b]), 'ru'); }
    var nodes = {};
    var tops = [];
    (tree || []).forEach(function (item) {
        var node = nodes[item.ref] = {
            ref: item.ref, title: item.trail[item.trail.length - 1], technical: !item.include,
            names: (members[item.ref] || []).sort(byTitle), children: [], all: []
        };
        var parent = nodes[item.ref.replace(/\.Subsystem\.[^.]+$/, '')];
        if (parent && parent !== node) parent.children.push(node); else tops.push(node);
    });
    function collect(node) {
        var seen = {};
        node.names.forEach(function (n) { seen[n] = true; });
        node.children = node.children.filter(function (c) {
            collect(c);
            c.all.forEach(function (n) { seen[n] = true; });
            return c.all.length;
        });
        node.all = Object.keys(seen);
    }
    tops.forEach(collect);
    /* Two subsystems with one synonym side by side are told apart by name. */
    (function tell(list) {
        var count = {};
        list.forEach(function (n) { count[n.title] = (count[n.title] || 0) + 1; });
        list.forEach(function (n) {
            if (count[n.title] > 1) n.title += ' (' + n.ref.split('.').pop() + ')';
            tell(n.children);
        });
    })(tops);
    var out = tops.filter(function (t) { return t.all.length && !t.technical; })
        .concat(tops.filter(function (t) { return t.all.length && t.technical; }));
    if (loose.length) out.push({ ref: '', title: 'Не входят в подсистемы', technical: false,
        names: loose.sort(byTitle), children: [], all: loose.slice() });
    return out;
}

function actionTitle(group, info) {
    if (ACTION_TITLES[group]) return ACTION_TITLES[group];
    return info && info.category === 'ActionsPanel' ? info.title : '';
}

function panelCount(panel) {
    var n = 0;
    panel.blocks.forEach(function (b) {
        NAV_GROUPS.forEach(function (g) { n += b.groups[g].length; });
        b.groups.custom.forEach(function (c) { n += c.items.length; });
    });
    panel.actions.forEach(function (a) { n += a.items.length; });
    return n;
}

/* --------------------------------------------------------------- render */

/* Roles and the functional option mode are the viewer's choice and outlive
 * the file; `roles` null means "not chosen yet" (ПолныеПрава if present). */
var viewState = { section: HOME, menu: '', mode: 'section', query: '', roles: null, foMark: false, foOff: {} };
var extensionInspectorModels = {};
function resetViewState() {
    viewState = { section: HOME, menu: '', mode: 'section', query: '', roles: viewState.roles,
        foMark: viewState.foMark, foOff: viewState.foOff };
    extensionInspectorModels = {};
}

var loaderCache = {};
/* Sections once read, by configuration, so the outline can name them; the
 * outline lists those the window shows under the current roles and options. */
var resolvedMains = {};
var shownSections = {};
function mainKey(model) { return model.name + '|' + model.subsystems.join(','); }

/* The roles and switched-off options picked for a configuration are kept in
 * the viewer's own storage, so reopening it shows the same window. */
function storedChoice(model) {
    try {
        var raw = localStorage.getItem('bslview.clientView.' + model.name);
        var v = raw ? JSON.parse(raw) : null;
        return v && Array.isArray(v.roles) && v.foOff && typeof v.foOff === 'object' ? v : null;
    } catch (e) { return null; }
}
function storeChoice(model) {
    try {
        localStorage.setItem('bslview.clientView.' + model.name,
            JSON.stringify({ roles: viewState.roles || [], foOff: viewState.foOff }));
    } catch (e) { /* private mode */ }
}

/* How the options list is laid out ('subsystems' or 'list') is the viewer's
 * habit, the same for every configuration; open groups live for the session. */
var foOpen = {};
var foGroupingMode = null;
function foGrouping() {
    if (!foGroupingMode) {
        try { foGroupingMode = localStorage.getItem('bslview.clientView.foGrouping'); } catch (e) { /* private mode */ }
        if (foGroupingMode !== 'list') foGroupingMode = 'subsystems';
    }
    return foGroupingMode;
}
function setFoGrouping(mode) {
    foGroupingMode = mode;
    try { localStorage.setItem('bslview.clientView.foGrouping', mode); } catch (e) { /* private mode */ }
}

function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
}

var SVG_NS = 'http://www.w3.org/2000/svg';
var GLYPHS = {
    menu: 'M3 5h14v1.6H3zM3 9.2h14v1.6H3zM3 13.4h14V15H3z',
    search: 'M8.5 3.5a5 5 0 0 1 4 8l3.6 3.6-1 1-3.6-3.6a5 5 0 1 1-3-9zm0 1.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z',
    section: 'M4 4h5v5H4zM11 4h5v5h-5zM4 11h5v5H4zM11 11h5v5h-5z',
    close: 'M5.6 4.5L10 8.9l4.4-4.4 1.1 1.1-4.4 4.4 4.4 4.4-1.1 1.1-4.4-4.4-4.4 4.4-1.1-1.1 4.4-4.4-4.4-4.4z',
    user: 'M10 3.5a3 3 0 1 1 0 6 3 3 0 0 1 0-6zM4 16c0-3 2.7-5 6-5s6 2 6 5z'
};

function glyph(name, cls) {
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 20 20');
    svg.setAttribute('class', 'ci-glyph' + (cls ? ' ' + cls : ''));
    var path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', GLYPHS[name] || '');
    svg.appendChild(path);
    return svg;
}

var MAIN_MENU = ['Файл', 'Правка', 'Вид', 'Избранное', 'Сервис и настройки', 'Окна', 'Справка'];
function isInterface85(model) {
    var mode = String(model && (model.interfaceCompatibilityMode || model.compatibilityMode) || '');
    return /(?:Version)?8[_\.]5(?:_|\.|$)/i.test(mode);
}
function render(model, container, options) {
    options = options || {};
    container.innerHTML = '';
    container.className = 'ci-root';
    if (!model) {
        container.appendChild(el('div', 'ci-empty', 'Нет модели конфигурации'));
        return;
    }
    var interface85 = isInterface85(model);
    var win = el('div', 'ci-window');
    if (interface85) win.classList.add('ci-interface-85');
    container.appendChild(win);
    var loader = options.io && options.filePath ? createLoader(options.io, loaderCache) : null;
    var configPath = options.filePath;
    var main = null;
    var fo = null;
    var rights = null;
    var itemsByRef = {};
    /* The extensions found near the configuration: [{ info, main }]. Their
     * own subsystems become sections of their own, what they add to an
     * adopted subsystem is merged into that section, and their objects join
     * "Все функции" and the search — as the client does with an extension
     * applied. `sectionOwner` says which root a section came from. */
    var exts = [];
    var sectionOwner = {};
    var extObjectsReady = null;
    var allExtObjects = {};
    var moduleSearchState = {
        query: '', regexp: false, matchCase: false,
        categories: { properties: false, modules: true, formElements: false, templates: false },
        scopes: { cf: true, cfe: true, epf: true, erf: true }
    };
    var moduleSearchToken = 0;
    var moduleSearchCancel = null;

    function cancelModuleSearch() {
        if (!moduleSearchCancel) return;
        moduleSearchCancel.cancelled = true;
        if (moduleSearchCancel.notify) moduleSearchCancel.notify();
        moduleSearchCancel = null;
    }

    /* ---- header */
    var header = el('div', 'ci-header');
    header.appendChild(el('span', 'ci-logo', '1С'));
    var menuBtn = el('button', 'ci-tool ci-menu-button');
    menuBtn.type = 'button';
    menuBtn.title = 'Главное меню';
    menuBtn.appendChild(glyph('menu'));
    header.appendChild(menuBtn);
    var ext = model.extension;
    if (!ext && viewState.mode === 'ext') viewState.mode = 'section';
    if (ext && viewState.mode === 'ext') viewState.mode = 'all';
    header.appendChild(el('span', 'ci-title', (model.synonym || model.name)
        + (ext ? ' (расширение конфигурации)' : ' (1С:Предприятие)')));
    var search = el('label', 'ci-search');
    var searchInput = el('input', 'ci-search-input');
    searchInput.type = 'text';
    searchInput.placeholder = 'Поиск Ctrl+Shift+F';
    searchInput.value = viewState.query;
    search.appendChild(searchInput);
    search.appendChild(glyph('search'));
    header.appendChild(search);
    /* The client's bell, history and favorites do nothing here; the header
     * holds what the viewer sets instead: functional options and roles. */
    var moreBtn = el('button', 'ci-user ci-fo-open');
    moreBtn.type = 'button';
    moreBtn.title = 'Какие функциональные опции включены';
    header.appendChild(moreBtn);
    var userBtn = el('button', 'ci-user');
    userBtn.type = 'button';
    userBtn.title = 'Смотреть интерфейс под ролью';
    header.appendChild(userBtn);
    win.appendChild(header);

    var popup = el('div', 'ci-popup');
    popup.hidden = true;
    win.appendChild(popup);

    /* "Все функции" is a tab of its own, one click from the object tree. */
    var tabs = el('div', 'ci-tabs');
    var homeTab = el('span', 'ci-tab', interface85 ? 'Начало' : 'Начальная страница');
    var allTab = el('span', 'ci-tab', 'Все функции');
    var modulesTab = el('span', 'ci-tab', 'Глобальный поиск');
    allTab.title = 'Все объекты конфигурации по видам';
    homeTab.addEventListener('click', function () {
        if (viewState.mode !== 'all' && viewState.mode !== 'ext' && viewState.mode !== 'modules') return;
        viewState.mode = leftAllMode();
        redraw();
    });
    allTab.addEventListener('click', function () {
        if (viewState.mode !== 'all') { viewState.mode = 'all'; redraw(); }
    });
    modulesTab.title = 'Поиск текста во всех модулях конфигурации без индекса';
    modulesTab.addEventListener('click', function () {
        if (viewState.mode !== 'modules') { viewState.mode = 'modules'; redraw(); }
    });
    tabs.appendChild(homeTab);
    tabs.appendChild(allTab);
    tabs.appendChild(modulesTab);
    /* An extension has no client window of its own: what it is for and what
     * it holds — its own objects and the ones adopted from the configuration
     * — is a tab beside "Все функции". */
    var extTab = el('span', 'ci-tab', 'Расширения');
    extTab.title = 'Расширения, найденные рядом с выгрузкой';
    extTab.hidden = !!ext;
    extTab.addEventListener('click', function () {
        if (viewState.mode !== 'ext') { viewState.mode = 'ext'; redraw(); }
    });
    tabs.appendChild(extTab);
    win.appendChild(tabs);

    var body = el('div', 'ci-body');
    var sectionsPanel = el('div', 'ci-sections');
    var work = el('div', 'ci-work');
    body.appendChild(sectionsPanel);
    body.appendChild(work);
    win.appendChild(body);
    var sideTools = el('div', 'ci-side-tools');
    function sideTool(name, title, activate) {
        var tool = el('button', 'ci-side-tool');
        tool.type = 'button';
        tool.title = title;
        tool.appendChild(glyph(name));
        tool.addEventListener('click', activate);
        sideTools.appendChild(tool);
        return tool;
    }
    sideTool('search', 'Глобальный поиск', function () { viewState.mode = 'modules'; redraw(); });
    sideTool('user', 'Смотреть интерфейс под ролью', function (event) { openPopup('roles', event.currentTarget); });
    sideTool('section', 'Все функции', function () { viewState.mode = 'all'; redraw(); });
    sideTool('menu', 'Главное меню', function (event) { openPopup('main', event.currentTarget); });
    win.appendChild(sideTools);
    var status = el('div', 'ci-status');
    win.appendChild(status);

    function view() {
        var on = rights && viewState.roles && viewState.roles.length;
        return { roles: on ? viewState.roles : null, rights: on ? rights : null, fo: fo && fo.index, foOff: viewState.foOff };
    }

    function offCount() { return Object.keys(viewState.foOff).length; }
    function foTitles(names) {
        return (names || []).map(function (n) { return (fo && fo.titles[n]) || n; });
    }

    function syncHeader() {
        moreBtn.textContent = 'Функциональные опции' + (offCount() ? ' (выключено: ' + offCount() + ')' : '');
        moreBtn.classList.toggle('ci-user-role', !!offCount());
        userBtn.textContent = '';
        userBtn.appendChild(glyph('user'));
        userBtn.appendChild(el('span', '', roleLabel() || 'Все роли'));
        userBtn.classList.toggle('ci-user-role', !!roleLabel());
        status.textContent = [model.name, model.version && 'версия ' + model.version, model.vendor,
            ext && ext.purposeTitle && 'назначение: ' + ext.purposeTitle,
            ext && ext.prefix && 'префикс: ' + ext.prefix,
            ext && ext.compatibility && 'режим совместимости: ' + ext.compatibility,
            roleLabel() ? 'роли: ' + roleNames().join(', ') : 'без учета ролей',
            offCount() ? 'выключено опций: ' + offCount() : '',
            exts.length ? 'расширения: ' + exts.map(function (e) { return e.info.title; }).join(', ') : '']
            .filter(Boolean).join(' · ');
    }

    /* ---- popups: main menu, roles, functional options */
    function closePopup() {
        viewState.menu = '';
        popup.hidden = true;
        popup.innerHTML = '';
        menuBtn.classList.remove('ci-pressed');
        userBtn.classList.remove('ci-pressed');
        moreBtn.classList.remove('ci-pressed');
    }

    function openPopup(kind, anchor) {
        if (viewState.menu === kind) { closePopup(); return; }
        closePopup();
        viewState.menu = kind;
        popup.hidden = false;
        popup.className = 'ci-popup ci-popup-' + kind;
        anchor.classList.add('ci-pressed');
        if (kind === 'main') drawMainMenu();
        else if (kind === 'roles') drawRoles();
        else drawFoModes();
        var a = anchor.getBoundingClientRect(), w = win.getBoundingClientRect();
        popup.style.top = (a.bottom - w.top) + 'px';
        if (kind === 'main') { popup.style.left = (a.left - w.left) + 'px'; popup.style.right = ''; }
        else { popup.style.right = Math.max(0, w.right - a.right) + 'px'; popup.style.left = ''; }
    }

    function drawMainMenu() {
        var col = el('div', 'ci-menu-column');
        visibleSections().forEach(function (s) {
            var row = el('div', 'ci-menu-item', s.title);
            row.addEventListener('click', function () { closePopup(); choose(s.ref, true); });
            col.appendChild(row);
        });
        popup.appendChild(col);
        var std = el('div', 'ci-menu-column ci-menu-standard');
        MAIN_MENU.forEach(function (t) { std.appendChild(el('div', 'ci-menu-item ci-menu-sub', t)); });
        popup.appendChild(std);
    }

    function roleNames() {
        return (viewState.roles || []).map(function (r) { return r.replace(/^Role\./, ''); });
    }
    function roleLabel() {
        var names = roleNames();
        return names.length > 1 ? names[0] + ' +' + (names.length - 1) : names[0] || '';
    }

    function drawRoles() {
        var box = el('div', 'ci-menu-column ci-roles');
        var filter = el('input', 'ci-roles-filter');
        filter.type = 'text';
        filter.placeholder = 'Найти роль…';
        box.appendChild(filter);
        var reset = el('div', 'ci-menu-item' + (!(viewState.roles || []).length ? ' ci-menu-checked' : ''),
            'Все роли (весь интерфейс, без проверки прав)');
        reset.addEventListener('click', function () { closePopup(); setRoles([]); });
        box.appendChild(reset);
        box.appendChild(el('div', 'ci-menu-note', 'Отметьте роли пользователя: права и видимость объединяются.'));
        var list = el('div', 'ci-roles-list');
        box.appendChild(list);
        function fill() {
            list.innerHTML = '';
            var q = filter.value.trim().toLowerCase();
            var chosen = viewState.roles || [];
            /* Chosen roles first, then the rest in configuration order. */
            var names = model.roles.filter(function (r) { return !q || r.toLowerCase().indexOf(q) >= 0; });
            names = names.filter(function (r) { return chosen.indexOf('Role.' + r) >= 0; })
                .concat(names.filter(function (r) { return chosen.indexOf('Role.' + r) < 0; }));
            names.slice(0, 300).forEach(function (r) {
                var row = el('label', 'ci-menu-item ci-role-row');
                var check = el('input');
                check.type = 'checkbox';
                check.checked = chosen.indexOf('Role.' + r) >= 0;
                check.addEventListener('change', function () {
                    var next = (viewState.roles || []).filter(function (x) { return x !== 'Role.' + r; });
                    if (check.checked) next.push('Role.' + r);
                    setRoles(next);
                });
                row.appendChild(check);
                row.appendChild(document.createTextNode(' ' + r));
                list.appendChild(row);
            });
            if (names.length > 300) list.appendChild(el('div', 'ci-menu-note', 'Показаны первые 300, уточните поиск.'));
        }
        filter.addEventListener('input', fill);
        box.addEventListener('click', function (e) { e.stopPropagation(); });
        fill();
        popup.appendChild(box);
        setTimeout(function () { filter.focus(); }, 0);
    }

    /* The export keeps no option values, so the viewer sets them: all on
     * until switched off here. By subsystems: the subsystems that list an
     * option in their content (groupOptions); as a list: options that
     * control sections and nested subsystems first. */
    function drawFoModes() {
        var box = el('div', 'ci-menu-column ci-roles ci-fo-box');
        box.addEventListener('click', function (e) { e.stopPropagation(); });
        var markRow = el('label', 'ci-menu-item ci-role-row');
        var markBox = el('input');
        markBox.type = 'checkbox';
        markBox.checked = viewState.foMark;
        markBox.addEventListener('change', function () { viewState.foMark = markBox.checked; redraw(); drawSections(); });
        markRow.appendChild(markBox);
        markRow.appendChild(document.createTextNode(' Отмечать то, что зависит от опций'));
        box.appendChild(markRow);
        if (!fo) {
            box.appendChild(el('div', 'ci-menu-note', loader ? 'Опции еще читаются…' : 'Опции недоступны.'));
            popup.appendChild(box);
            return;
        }
        box.appendChild(el('div', 'ci-menu-note', 'Значения опций в выгрузке не хранятся. Снимите флажок у выключенной опции: '
            + 'пропадет то, что зависит только от выключенных.'));
        var tools = el('div', 'ci-fo-tools');
        var filter = el('input', 'ci-roles-filter');
        filter.type = 'text';
        filter.placeholder = 'Найти опцию…';
        tools.appendChild(filter);
        var modes = el('span', 'ci-fo-modes');
        [['subsystems', 'По подсистемам'], ['list', 'Списком']].forEach(function (m) {
            var b = el('button', 'ci-fo-button' + (foGrouping() === m[0] ? ' ci-fo-button-on' : ''), m[1]);
            b.type = 'button';
            b.addEventListener('click', function () {
                setFoGrouping(m[0]);
                Array.prototype.forEach.call(modes.children, function (x) { x.classList.toggle('ci-fo-button-on', x === b); });
                fill();
            });
            modes.appendChild(b);
        });
        tools.appendChild(modes);
        var allOn = el('button', 'ci-fo-button', 'Все включены');
        allOn.type = 'button';
        allOn.addEventListener('click', function () { setOff({}); fill(); });
        tools.appendChild(allOn);
        box.appendChild(tools);
        var list = el('div', 'ci-roles-list ci-fo-list');
        box.appendChild(list);
        var sectionOptions = {};
        Object.keys(fo.index).forEach(function (ref) {
            if (/^Subsystem\./.test(ref)) fo.index[ref].forEach(function (n) { sectionOptions[n] = true; });
        });
        var names = Object.keys(fo.titles);
        names = names.filter(function (n) { return sectionOptions[n]; }).concat(names.filter(function (n) { return !sectionOptions[n]; }));
        var groups = null;
        var treeAsked = false;

        /* changes: { option: on }; the list is redrawn in place. */
        function switchTo(changes) {
            var next = {};
            Object.keys(viewState.foOff).forEach(function (k) { next[k] = true; });
            Object.keys(changes).forEach(function (k) { if (changes[k]) delete next[k]; else next[k] = true; });
            setOff(next);
            refill();
        }
        function refill() {
            var top = list.scrollTop;
            fill();
            list.scrollTop = top;
        }
        function optionRow(n, nested) {
            var row = el('label', 'ci-menu-item ci-role-row' + (nested ? ' ci-fo-nested' : ''));
            var check = el('input');
            check.type = 'checkbox';
            check.checked = !viewState.foOff[n];
            check.addEventListener('change', function () { var c = {}; c[n] = check.checked; switchTo(c); });
            row.appendChild(check);
            row.appendChild(document.createTextNode(' ' + fo.titles[n] + (sectionOptions[n] ? ' — разделы' : '')));
            row.title = n;
            return row;
        }
        function matches(q, n) {
            return !q || n.toLowerCase().indexOf(q) >= 0 || fo.titles[n].toLowerCase().indexOf(q) >= 0;
        }
        function fillList(q) {
            var shown = names.filter(function (n) { return matches(q, n); });
            shown.slice(0, 300).forEach(function (n) { list.appendChild(optionRow(n, false)); });
            if (shown.length > 300) list.appendChild(el('div', 'ci-menu-note', 'Показаны первые 300, уточните поиск.'));
            if (!shown.length) list.appendChild(el('div', 'ci-menu-note', 'Ничего не найдено'));
        }
        /* A subsystem row: its switch covers every option below it. */
        function groupHead(g, q, shown, open, depth) {
            var head = el('div', 'ci-menu-item ci-fo-group' + (open ? ' ci-fo-group-open' : '')
                + (g.technical ? ' ci-fo-technical' : ''));
            head.style.paddingLeft = (6 + depth * 18) + 'px';
            var check = el('input');
            check.type = 'checkbox';
            var on = g.all.filter(function (n) { return !viewState.foOff[n]; }).length;
            check.checked = on === g.all.length;
            check.indeterminate = on > 0 && on < g.all.length;
            check.title = 'Включить или выключить все опции подсистемы';
            check.addEventListener('click', function (e) { e.stopPropagation(); });
            check.addEventListener('change', function () {
                var c = {};
                g.all.forEach(function (n) { c[n] = check.checked; });
                switchTo(c);
            });
            head.appendChild(el('span', 'ci-fo-arrow'));
            head.appendChild(check);
            head.appendChild(el('span', 'ci-fo-group-title', g.title));
            head.appendChild(el('span', 'ci-fo-count', (q ? shown + ' из ' : '') + g.all.length
                + (g.technical && !depth ? ' · служебная' : '')));
            head.title = g.ref ? mdRef(g.ref) : 'Опции, которых нет в составе подсистем';
            head.addEventListener('click', function () {
                if (q) return;
                foOpen[g.ref || '-'] = !foOpen[g.ref || '-'];
                refill();
            });
            return head;
        }
        function fillGroups(q) {
            if (!groups) {
                list.appendChild(el('div', 'ci-menu-note', 'Читаются подсистемы…'));
                if (treeAsked) return;
                treeAsked = true;
                (loader ? loader.subsystemTree(configPath, model.subsystems) : Promise.resolve([]))
                    .catch(function () { return []; })
                    .then(function (tree) {
                        groups = groupOptions(fo, tree);
                        if (viewState.menu === 'fo' && list.isConnected) fill();
                    });
                return;
            }
            var rows = 0;
            /* Nested subsystems first, then the subsystem's own options. */
            function node(g, depth) {
                var shown = g.all.filter(function (n) { return matches(q, n); }).length;
                if (!shown) return;
                var open = q ? true : !!foOpen[g.ref || '-'];
                list.appendChild(groupHead(g, q, shown, open, depth));
                if (!open || rows > 500) return;
                g.children.forEach(function (c) { node(c, depth + 1); });
                g.names.forEach(function (n) {
                    if (!matches(q, n) || rows > 500) return;
                    rows++;
                    var row = optionRow(n, true);
                    row.style.paddingLeft = (24 + (depth + 1) * 18) + 'px';
                    list.appendChild(row);
                });
            }
            groups.forEach(function (g) { node(g, 0); });
            if (rows > 500) list.appendChild(el('div', 'ci-menu-note', 'Показаны не все опции, уточните поиск.'));
            if (!list.children.length) list.appendChild(el('div', 'ci-menu-note', 'Ничего не найдено'));
        }
        function fill() {
            list.innerHTML = '';
            var q = filter.value.trim().toLowerCase();
            if (foGrouping() === 'list') fillList(q); else fillGroups(q);
        }
        filter.addEventListener('input', fill);
        fill();
        popup.appendChild(box);
        setTimeout(function () { filter.focus(); }, 0);
    }

    function setOff(next) {
        viewState.foOff = next;
        storeChoice(model);
        syncHeader();
        drawSections();
        if (viewState.section !== HOME && !itemsByRef[viewState.section]) viewState.section = HOME;
        redraw();
    }

    menuBtn.addEventListener('click', function (e) { e.stopPropagation(); openPopup('main', menuBtn); });
    userBtn.addEventListener('click', function (e) { e.stopPropagation(); if (loader && model.roles.length) openPopup('roles', userBtn); });
    moreBtn.addEventListener('click', function (e) { e.stopPropagation(); openPopup('fo', moreBtn); });
    win.addEventListener('click', function (e) {
        if (viewState.menu && !popup.contains(e.target)) closePopup();
    });

    var rolesToken = 0;
    function setRoles(roles) {
        viewState.roles = roles;
        storeChoice(model);
        rights = null;
        var token = ++rolesToken;
        syncHeader();
        if (!roles.length || !loader) { drawSections(); redraw(); return; }
        Promise.all(roles.map(function (r) {
            return loader.roleRights(configPath, r.replace(/^Role\./, '')).catch(function () { return null; });
        })).then(function (list) {
            if (token !== rolesToken) return;
            rights = unionRights(list);
            drawSections();
            if (viewState.section !== HOME && !itemsByRef[viewState.section]) viewState.section = HOME;
            redraw();
        });
    }

    /* ---- sections panel */
    function visibleSections() {
        var list = main ? main.sections : model.subsystems.map(function (n) {
            return { ref: 'Subsystem.' + n, title: n, image: '' };
        });
        sectionOwner = {};
        exts.forEach(function (e) {
            if (!e.main) return;
            e.main.sections.forEach(function (sub) {
                /* A subsystem the extension adopted is the configuration's
                 * own section; only what the extension itself adds is new. */
                if (sub.adopted || list.some(function (s) { return s.ref === sub.ref; })) return;
                sectionOwner[sub.ref] = e.info;
                list = list.concat([{ ref: sub.ref, title: sub.title, image: sub.image, ext: e.info.title }]);
            });
        });
        if (rights && (viewState.roles || []).length)
            list = list.filter(function (s) { return hasRight(rights, s.ref, 'View'); });
        if (fo) list = list.filter(function (s) { return !switchedOff(fo.index[s.ref], viewState.foOff); });
        return list;
    }

    function sectionItem(ref, text, image, fallbackGlyph, extOf) {
        var item = el('div', 'ci-section');
        var icon = el('span', 'ci-section-icon');
        if (image) {
            var img = el('img');
            img.src = image;
            img.alt = '';
            icon.appendChild(img);
        } else icon.appendChild(glyph(fallbackGlyph || 'section'));
        item.appendChild(icon);
        item.appendChild(el('span', 'ci-section-text', text));
        item.appendChild(el('span', 'ci-section-chevron', '›'));
        if (extOf) {
            item.classList.add('ci-section-ext');
            item.appendChild(el('span', 'ci-ext-badge', extOf));
        }
        var options = fo && fo.index[ref];
        if (options && viewState.foMark) {
            item.classList.add('ci-section-fo');
            item.title = 'Функциональные опции: ' + foTitles(options).join(', ');
        }
        if (ref !== HOME) item.setAttribute('data-ref', mdRef(ref));
        item.addEventListener('click', function () { choose(ref, true); });
        itemsByRef[ref] = item;
        sectionsPanel.appendChild(item);
    }

    function drawSections() {
        sectionsPanel.innerHTML = '';
        itemsByRef = {};
        sectionItem(HOME, 'Главное', main && main.mainImage, 'menu');
        var list = visibleSections();
        list.forEach(function (s) { sectionItem(s.ref, s.title, s.image, '', s.ext); });
        mark();
        if (!main) return;
        var key = mainKey(model);
        var refs = list.map(function (s) { return s.ref; }).join('|');
        var before = shownSections[key];
        shownSections[key] = { refs: refs, list: list };
        if ((!before || before.refs !== refs) && options.onOutlineChanged) options.onOutlineChanged();
    }

    function mark() {
        homeTab.classList.toggle('ci-tab-active', viewState.mode !== 'all' && viewState.mode !== 'ext'
            && viewState.mode !== 'modules');
        allTab.classList.toggle('ci-tab-active', viewState.mode === 'all');
        modulesTab.classList.toggle('ci-tab-active', viewState.mode === 'modules');
        extTab.hidden = !!ext || !exts.length;
        extTab.classList.toggle('ci-tab-active', viewState.mode === 'ext');
        Object.keys(itemsByRef).forEach(function (ref) {
            itemsByRef[ref].classList.toggle('ci-section-active', viewState.mode === 'section' && ref === viewState.section);
        });
    }

    /* ---- work area */
    function open(path, target) {
        if (path && options.onOpen) options.onOpen(path, target || null);
    }

    /* A synonym can be worlds apart from the name, so lists that stand for
     * the configuration tree write the name in brackets after it. */
    function commandLink(entry, cls) {
        var a = el('a', 'ci-command' + (cls ? ' ' + cls : '') + (entry.fo && viewState.foMark ? ' ci-fo' : ''),
            entry.title);
        var name = entry.name || (entry.withName ? refNames(entry.id).pop() : '');
        if (name && name !== entry.title) a.appendChild(el('span', 'ci-command-name', ' (' + name + ')'));
        var extensionNames = entry.exts || (entry.ext ? [entry.ext] : []);
        if (extensionNames.length) {
            a.classList.add('ci-from-ext');
            a.appendChild(el('span', 'ci-ext-badge', (extensionNames.length > 1 ? 'Расширения: ' : 'Расширение: ')
                + extensionNames.join(', ')));
        }
        a.href = '#';
        a.setAttribute('data-ref', mdRef(entry.id));
        a.title = mdRef(entry.id) + (extensionNames.length ? '\nВ расширениях: ' + extensionNames.join(', ') : '')
            + (entry.fo ? '\nФункциональные опции: ' + foTitles(entry.fo).join(', ') : '');
        a.addEventListener('click', function (e) { e.preventDefault(); open(entry.path, entry.openAt); });
        return a;
    }

    function drawHome() {
        var page = el('div', 'ci-home');
        if (!main) {
            page.appendChild(el('div', 'ci-loading', loader ? 'Загрузка начальной страницы…' : 'Начальная страница'));
            return page;
        }
        var cols = [main.home.left, main.home.right].filter(function (c) { return c.length; });
        var linkRow = el('div', 'ci-config-link-row');
        var configLink = el('a', 'ci-config-link', model.synonym || model.name);
        configLink.href = '#';
        configLink.title = 'Показать свойства основной конфигурации';
        configLink.addEventListener('click', function (event) {
            event.preventDefault();
            if (options.onSelect) options.onSelect({ id: 'configuration', name: model.name, inspectorOnly: true });
        });
        linkRow.appendChild(configLink);
        page.appendChild(linkRow);
        if (!cols.length) page.appendChild(el('div', 'ci-loading', 'Начальная страница не заполнена'));
        page.classList.add(main.home.template === 'OneColumn' ? 'ci-home-one' : 'ci-home-two');
        var columns = el('div', 'ci-home-columns');
        cols.forEach(function (list) {
            var col = el('div', 'ci-home-column');
            list.forEach(function (f) {
                var box = el('div', 'ci-home-form');
                box.style.minHeight = Math.max(80, Math.min(400, f.height * 16)) + 'px';
                var head = el('div', 'ci-home-form-title', f.title);
                head.title = mdRef(f.form);
                head.setAttribute('data-ref', mdRef(f.form));
                if (f.path) {
                    head.setAttribute('data-open', '');
                    head.addEventListener('click', function () { open(f.path); });
                }
                box.appendChild(head);
                col.appendChild(box);
            });
            columns.appendChild(col);
        });
        if (cols.length) page.appendChild(columns);
        return page;
    }

    function panelBox(title, onClose) {
        var box = el('div', 'ci-functions');
        var head = el('div', 'ci-functions-head');
        head.appendChild(el('span', 'ci-functions-title', title));
        var find = el('span', 'ci-tool ci-functions-search');
        find.title = 'Поиск в разделе';
        find.appendChild(glyph('search'));
        head.appendChild(find);
        var close = el('span', 'ci-tool ci-functions-close');
        close.title = 'Закрыть';
        close.appendChild(glyph('close'));
        close.addEventListener('click', onClose);
        head.appendChild(close);
        box.appendChild(head);
        return box;
    }

    function navBlock(block) {
        var g = block.groups;
        var part = el('div', 'ci-block' + (block.depth ? ' ci-block-nested' : ''));
        if (block.depth) {
            var bt = el('div', 'ci-block-title' + (block.depth > 1 ? ' ci-block-title-deep' : ''), block.title);
            if (block.ext) bt.appendChild(el('span', 'ci-ext-badge', block.ext));
            bt.style.paddingLeft = ((block.depth - 1) * 12) + 'px';
            bt.setAttribute('data-ref', mdRef(block.ref));
            bt.title = mdRef(block.ref) + (block.fo ? '\nФункциональные опции: ' + foTitles(block.fo).join(', ') : '');
            if (block.fo && viewState.foMark) bt.classList.add('ci-fo');
            bt.setAttribute('data-open', '');
            bt.addEventListener('click', function () { open(block.path); });
            part.appendChild(bt);
        }
        g.NavigationPanelImportant.forEach(function (c) { part.appendChild(commandLink(c, 'ci-important')); });
        g.NavigationPanelOrdinary.forEach(function (c) { part.appendChild(commandLink(c)); });
        g.custom.forEach(function (c) {
            part.appendChild(el('div', 'ci-group-title', c.title));
            c.items.forEach(function (i) { part.appendChild(commandLink(i, 'ci-group-item')); });
        });
        if (g.NavigationPanelSeeAlso.length) {
            part.appendChild(el('div', 'ci-see-also', 'См. также'));
            g.NavigationPanelSeeAlso.forEach(function (c) { part.appendChild(commandLink(c)); });
        }
        var count = g.NavigationPanelImportant.length + g.NavigationPanelOrdinary.length
            + g.NavigationPanelSeeAlso.length + g.custom.length;
        return count ? part : null;
    }

    function drawPanel(panel, title) {
        var box = panelBox(panel ? panel.title : title, function () { choose(HOME, true); });
        if (!panel) {
            box.appendChild(el('div', 'ci-loading', 'Загрузка раздела…'));
            return box;
        }
        var columns = el('div', 'ci-functions-body');
        var nav = el('div', 'ci-nav');
        panel.blocks.forEach(function (block) {
            var part = navBlock(block);
            if (part) nav.appendChild(part);
        });
        if (!nav.children.length) nav.appendChild(el('div', 'ci-loading', 'В разделе нет команд навигации'));
        columns.appendChild(nav);
        if (panel.actions.length) {
            var acts = el('div', 'ci-actions');
            panel.actions.forEach(function (a) {
                var part = el('div', 'ci-block');
                part.appendChild(el('div', 'ci-action-title', a.title));
                a.items.forEach(function (c) { part.appendChild(commandLink(c)); });
                acts.appendChild(part);
            });
            columns.appendChild(acts);
        }
        box.appendChild(columns);
        return box;
    }

    function show(node) {
        work.classList.toggle('ci-work-menu-open', viewState.mode === 'section'
            && viewState.section !== HOME && !!node && node.classList.contains('ci-functions'));
        work.innerHTML = '';
        work.appendChild(node);
        work.scrollTop = 0;
    }

    /* The roots a section is read from: the configuration and every
     * extension that has the same subsystem, or the extension alone when the
     * section is its own. */
    function sectionParts(ref) {
        var owner = sectionOwner[ref];
        if (owner) return [{ path: owner.configPath, ext: owner.title }];
        var parts = [{ path: configPath, ext: '' }];
        exts.forEach(function (e) {
            var has = ref === HOME || (e.main && e.main.sections.some(function (s) { return s.ref === ref; }));
            if (has) parts.push({ path: e.info.configPath, ext: e.info.title });
        });
        return parts;
    }

    function loadMergedSection(ref) {
        var parts = sectionParts(ref);
        return Promise.all(parts.map(function (part) {
            return loader.loadSection(part.path, ref).then(function (raw) {
                return raw ? { top: raw.top, objects: raw.objects, groups: raw.groups, ext: part.ext } : null;
            }, function () { return null; });
        })).then(function (list) {
            var found = list.filter(Boolean);
            return found.length ? mergeSectionRaws(found) : null;
        });
    }

    /* Уход с вкладки не выбрасывает набранный запрос: он переезжает в общую
     * выдачу по разделам, как если бы его набрали там. */
    function leftAllMode() {
        return viewState.query.trim().length >= 2 ? 'search' : 'section';
    }

    var drawToken = 0;
    function redraw() {
        var token = ++drawToken;
        if (viewState.mode !== 'modules') cancelModuleSearch();
        mark();
        if (viewState.mode === 'search') return drawSearch(token);
        if (viewState.mode === 'all') return drawAll();
        if (viewState.mode === 'modules') return drawModuleSearch(token);
        if (viewState.mode === 'ext') {
            if (ext || exts.length) return drawExtension();
            viewState.mode = 'section';
        }
        var ref = viewState.section;
        if (ref === HOME && !loader) { show(drawHome()); return; }
        if (!loader) { show(drawPanel(null, ref)); return; }
        /* "Главное" shows the start page with its function panel over it
         * only when that panel has commands, as the client does. */
        if (ref === HOME) show(drawHome());
        else show(drawPanel(null, (itemsByRef[ref] && itemsByRef[ref].textContent) || ref));
        Promise.all([loadMergedSection(ref), fo ? Promise.resolve(fo) : foReady]).then(function (r) {
            if (token !== drawToken) return;
            if (!r[0]) { if (ref !== HOME) show(drawPanel({ title: ref, blocks: [], actions: [] })); return; }
            var panel = buildPanel(r[0], view());
            if (ref === HOME) {
                if (!panelCount(panel)) return;
                var wrap = el('div', 'ci-home-with-panel');
                wrap.appendChild(drawPanel(panel));
                wrap.appendChild(drawHome());
                show(wrap);
            } else show(drawPanel(panel));
        }, function (err) {
            if (token !== drawToken) return;
            show(el('div', 'ci-loading', 'Раздел не прочитан: ' + (err && err.message || err)));
        });
    }

    /* ---- search over every section */
    function drawSearch(token) {
        var q = viewState.query.trim().toLowerCase();
        var box = panelBox('Поиск: ' + viewState.query.trim(), clearSearch);
        var results = el('div', 'ci-search-results');
        results.appendChild(el('div', 'ci-loading', 'Поиск по разделам…'));
        box.appendChild(results);
        show(box);
        if (!loader) return;
        var refs = [HOME].concat(visibleSections().map(function (s) { return s.ref; }));
        Promise.all([Promise.all(refs.map(function (r) {
            return loadMergedSection(r).catch(function () { return null; });
        })), foReady]).then(function (r) {
            if (token !== drawToken) return;
            results.innerHTML = '';
            var found = 0;
            r[0].forEach(function (raw) {
                if (!raw) return;
                var panel = buildPanel(raw, view());
                var hits = [];
                function scan(list, where) {
                    list.forEach(function (c) {
                        if (matchesQuery(c, q)) hits.push({ c: c, where: where });
                    });
                }
                panel.blocks.forEach(function (b) {
                    var where = b.depth ? b.title : '';
                    NAV_GROUPS.forEach(function (g) { scan(b.groups[g], where); });
                    b.groups.custom.forEach(function (c) { scan(c.items, where); });
                });
                panel.actions.forEach(function (a) { scan(a.items, a.title); });
                if (!hits.length) return;
                found += hits.length;
                var part = el('div', 'ci-block');
                var title = el('div', 'ci-block-title ci-search-section', panel.title);
                title.addEventListener('click', function () { clearSearch(); choose(panel.ref, true); });
                part.appendChild(title);
                var shown = {};
                hits.forEach(function (h) {
                    if (shown[h.c.id]) return;
                    shown[h.c.id] = true;
                    var row = el('div', 'ci-search-row');
                    row.appendChild(commandLink({ id: h.c.id, title: h.c.title, path: h.c.path, fo: h.c.fo,
                        withName: true }));
                    if (h.where) row.appendChild(el('span', 'ci-search-where', h.where));
                    part.appendChild(row);
                });
                results.appendChild(part);
            });
            if (!found) results.appendChild(el('div', 'ci-empty-hits', 'В командах разделов ничего не найдено'));
            searchObjects(q, token, results);
        });
    }

    /* The command search only sees what a section puts on a panel; an object
     * outside every subsystem, or one with no command at all, is found here:
     * the whole ChildObjects list, by name and by synonym. */
    var SEARCH_LIMIT = 300;
    function searchObjects(q, token, results) {
        var part = el('div', 'ci-block');
        part.appendChild(el('div', 'ci-block-title', 'Объекты конфигурации'));
        var rows = el('div', 'ci-search-objects');
        rows.appendChild(el('div', 'ci-loading', 'Поиск по составу конфигурации…'));
        part.appendChild(rows);
        results.appendChild(part);
        var kinds = ALL_KINDS();
        Object.keys(allExtObjects).forEach(function (kind) { if (kinds.indexOf(kind) < 0) kinds.push(kind); });
        var lists = kinds.map(function (kind) {
            var names = model.objects[kind] || [];
            var added = allExtObjects[kind] || [];
            if (!loader) {
                return Promise.resolve(names.map(function (n) { return { name: n, title: n, path: '' }; })
                    .concat(added));
            }
            if (!names.length) return Promise.resolve(added.slice());
            return loader.synonyms(configPath, kind, names).then(function (rows) {
                return Array.prototype.slice.call(rows).concat(added);
            }, function () {
                return names.map(function (n) { return { name: n, title: n, path: '' }; }).concat(added);
            });
        });
        Promise.all(lists).then(function (all) {
            if (token !== drawToken) return;
            rows.innerHTML = '';
            var hits = 0;
            var shown = 0;
            all.forEach(function (list, i) {
                var kind = kinds[i];
                Array.prototype.slice.call(list).forEach(function (o) {
                    var ref = kind + '.' + o.name;
                    if (!matchesQuery({ id: ref, title: o.title, name: o.name }, q)) return;
                    hits++;
                    if (shown >= SEARCH_LIMIT) return;
                    shown++;
                    var row = el('div', 'ci-search-row');
                    row.appendChild(commandLink({ id: ref, title: o.title, name: o.name, path: o.path,
                        ext: o.ext, exts: o.exts }));
                    row.appendChild(el('span', 'ci-search-where', classTitle(kind)));
                    rows.appendChild(row);
                });
            });
            var empty0 = results.querySelector && results.querySelector('.ci-empty-hits');
            if (!hits) {
                part.parentNode.removeChild(part);
                if (empty0) empty0.textContent = 'Ничего не найдено';
                return;
            }
            if (hits > shown)
                rows.appendChild(el('div', 'ci-loading', 'Показаны первые ' + shown + ' из ' + hits
                    + ' — уточните запрос'));
            if (empty0) empty0.parentNode.removeChild(empty0);
        }, function (err) {
            if (token !== drawToken) return;
            rows.innerHTML = '';
            rows.appendChild(el('div', 'ci-loading', 'Состав не прочитан: ' + (err && err.message || err)));
        });
    }

    var searchTimer = 0;
    searchInput.addEventListener('input', function () {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(function () {
            viewState.query = searchInput.value;
            /* На вкладке «Все функции» отбор идёт по самому списку, поэтому
             * вкладку не подменяем общей выдачей. */
            if (viewState.mode === 'all') { redraw(); return; }
            if (searchInput.value.trim().length >= 2) { viewState.mode = 'search'; redraw(); }
            else if (viewState.mode === 'search') { viewState.mode = 'section'; redraw(); }
        }, 250);
    });
    searchInput.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') { e.preventDefault(); clearSearch(); }
        e.stopPropagation();
    });
    /* Ctrl+Shift+F из подсказки поля: фокус в поиск, где бы ни был фокус.
     * Перерисовка создаёт новое поле, поэтому слушатель старого снимается. */
    function focusSearchShortcut(e) {
        if (!searchInput.isConnected) { document.removeEventListener('keydown', focusSearchShortcut, true); return; }
        if (!e.ctrlKey || !e.shiftKey || e.altKey || e.metaKey || e.code !== 'KeyF') return;
        e.preventDefault();
        e.stopPropagation();
        searchInput.focus();
        searchInput.select();
    }
    document.addEventListener('keydown', focusSearchShortcut, true);
    function clearSearch() {
        searchInput.value = '';
        viewState.query = '';
        /* Сброс отбора на «Все функции» возвращает полный список, а не уводит
         * с вкладки. */
        if (viewState.mode !== 'all') viewState.mode = 'section';
        redraw();
    }

    /* ---- Расширение: состав и переход к свойствам */
    var extOpen = {};
    function extensionLink(extension) {
        var link = el('a', 'ci-block-title ci-extension-link', extension.info.title);
        link.href = '#';
        link.title = 'Показать свойства расширения ' + extension.info.title;
        link.addEventListener('click', function (event) {
            event.preventDefault();
            if (options.onSelect) options.onSelect({
                id: 'configuration-extension:' + extension.info.name,
                name: extension.info.name,
                inspectorOnly: true
            });
        });
        return link;
    }

    function extGroup(cls, list, key) {
        key = (key || '') + cls.kind;
        var group = el('div', 'ci-all-group');
        var own = cls.items.filter(function (i) { return !i.adopted; }).length;
        var head = el('div', 'ci-all-head' + (extOpen[key] ? ' ci-all-open' : ''),
            cls.title + ' (' + cls.items.length + (own < cls.items.length ? ', своих: ' + own : '') + ')');
        var items = el('div', 'ci-all-items');
        function fill() {
            items.innerHTML = '';
            if (!extOpen[key]) return;
            cls.items.forEach(function (i) {
                var link = commandLink({ id: i.ref, title: i.title, name: i.name, path: i.path },
                    i.adopted ? 'ci-ext-adopted' : '');
                if (i.adopted) link.appendChild(el('span', 'ci-ext-badge', 'заимствован'));
                items.appendChild(link);
            });
        }
        head.addEventListener('click', function () {
            extOpen[key] = !extOpen[key];
            head.classList.toggle('ci-all-open', !!extOpen[key]);
            fill();
        });
        fill();
        group.appendChild(head);
        group.appendChild(items);
        list.appendChild(group);
    }

    /* The tab of a configuration: every extension found near its export,
     * with a link to its properties and a summary of its content. */
    function drawExtensionList() {
        var box = panelBox('Расширения конфигурации (' + exts.length + ')',
            function () { viewState.mode = 'section'; redraw(); });
        var token = drawToken;
        exts.forEach(function (e) {
            var part = el('div', 'ci-ext-one');
            part.appendChild(extensionLink(e));
            var list = el('div', 'ci-all');
            list.appendChild(el('div', 'ci-loading', 'Чтение состава…'));
            part.appendChild(list);
            box.appendChild(part);
            loader.extensionContent(e.info.configPath, e.info.model.objects).then(function (content) {
                if (token !== drawToken) return;
                list.innerHTML = '';
                list.appendChild(el('div', 'ci-ext-summary', 'Собственных объектов: ' + content.own
                    + ' · заимствованных: ' + content.adopted));
                content.classes.forEach(function (cls) { extGroup(cls, list, e.info.name); });
            }, function (err) {
                if (token !== drawToken) return;
                list.innerHTML = '';
                list.appendChild(el('div', 'ci-loading', 'Состав не прочитан: ' + (err && err.message || err)));
            });
        });
        show(box);
    }

    function drawExtension() {
        if (!ext) return drawExtensionList();
        var box = panelBox('Состав', function () { viewState.mode = 'section'; redraw(); });
        var list = el('div', 'ci-all');
        box.appendChild(list);
        show(box);
        if (!loader) {
            ALL_KINDS().forEach(function (kind) {
                extGroup({ kind: kind, title: classTitle(kind),
                    items: model.objects[kind].map(function (n) {
                        return { name: n, title: n, ref: kind + '.' + n, path: '', adopted: false };
                    }) }, list);
            });
            return;
        }
        list.appendChild(el('div', 'ci-loading', 'Чтение состава расширения…'));
        var token = drawToken;
        loader.extensionContent(configPath, model.objects).then(function (content) {
            if (token !== drawToken) return;
            list.innerHTML = '';
            var summary = el('div', 'ci-ext-summary', 'Собственных объектов: ' + content.own
                + ' · заимствованных: ' + content.adopted);
            list.appendChild(summary);
            content.classes.forEach(function (cls) { extGroup(cls, list); });
            if (!content.classes.length) list.appendChild(el('div', 'ci-loading', 'Расширение пустое'));
        }, function (err) {
            if (token !== drawToken) return;
            list.innerHTML = '';
            list.appendChild(el('div', 'ci-loading', 'Состав не прочитан: ' + (err && err.message || err)));
        });
    }

    /* Classes the configuration has objects of, in the Designer's order. */
    function ALL_KINDS() {
        var kinds = Object.keys(model.objects || {}).filter(function (k) { return model.objects[k].length; });
        var order = (root.MetadataPreview && root.MetadataPreview.classOrder) || [];
        return orderBy(kinds, order, function (k) { return k; });
    }

    /* The objects the extensions add, by class: only their own, an adopted
     * one is already the configuration's. */
    function extObjects() {
        if (!exts.length || !loader) return Promise.resolve({});
        if (!extObjectsReady) {
            extObjectsReady = Promise.all(exts.map(function (e) {
                return loader.extensionContent(e.info.configPath, e.info.model.objects).then(function (content) {
                    return { info: e.info, content: content };
                }, function () { return null; });
            })).then(function (list) {
                var out = {};
                list.forEach(function (x) {
                    if (!x) return;
                    x.content.classes.forEach(function (cls) {
                        cls.items.forEach(function (i) {
                            var list = out[cls.kind] || (out[cls.kind] = []);
                            var existing = list.find(function (item) { return item.name === i.name; });
                            if (!existing) {
                                existing = { name: i.name, title: i.title, path: i.path, exts: [] };
                                list.push(existing);
                            }
                            if (existing.exts.indexOf(x.info.title) < 0) existing.exts.push(x.info.title);
                            /* Keep adopted objects as extension membership metadata,
                             * while only an own object can stand alone in the list. */
                            if (!i.adopted && !existing.path) existing.path = i.path;
                            if (!i.adopted) existing.own = true;
                        });
                    });
                });
                return out;
            });
            extObjectsReady.catch(function () { extObjectsReady = null; });
        }
        return extObjectsReady;
    }

    /* ---- Глобальный поиск */
    function drawModuleSearch(token) {
        cancelModuleSearch();
        var box = panelBox('Глобальный поиск', function () { viewState.mode = leftAllMode(); redraw(); });
        var controls = el('div', 'ci-module-search-controls');
        var input = el('input', 'ci-module-search-input');
        input.type = 'text';
        input.placeholder = 'Текст или регулярное выражение';
        input.value = moduleSearchState.query;
        controls.appendChild(input);
        function option(caption, key) {
            var label = el('label', 'ci-module-search-option');
            var check = el('input');
            check.type = 'checkbox';
            check.checked = !!moduleSearchState[key];
            check.addEventListener('change', function () { moduleSearchState[key] = !!check.checked; });
            label.appendChild(check);
            label.appendChild(document.createTextNode(' ' + caption));
            controls.appendChild(label);
            return check;
        }
        var regexpCheck = option('Регулярное выражение', 'regexp');
        var helpButton = el('button', 'ci-module-regex-help-button', '?');
        helpButton.type = 'button';
        helpButton.title = 'Справка по регулярным выражениям';
        helpButton.setAttribute('aria-label', 'Справка по регулярным выражениям');
        helpButton.setAttribute('aria-expanded', 'false');
        controls.appendChild(helpButton);
        option('Учитывать регистр', 'matchCase');
        var button = el('button', 'ci-module-search-button', 'Найти');
        button.type = 'button';
        controls.appendChild(button);
        var cancelButton = el('button', 'ci-module-search-cancel', 'Отмена');
        cancelButton.type = 'button';
        cancelButton.disabled = true;
        controls.appendChild(cancelButton);
        box.appendChild(controls);
        var choices = el('div', 'ci-module-search-choices');
        box.appendChild(choices);
        function checklistIn(container, title, items, values, className) {
            var group = el('fieldset', 'ci-module-search-checks ' + className);
            group.appendChild(el('legend', '', title));
            items.forEach(function (item) {
                var label = el('label', 'ci-module-search-check');
                var check = el('input');
                check.type = 'checkbox';
                check.checked = !!values[item.key];
                check.addEventListener('change', function () { values[item.key] = !!check.checked; });
                label.appendChild(check);
                label.appendChild(document.createTextNode(' ' + item.title));
                group.appendChild(label);
            });
            container.appendChild(group);
        }
        checklistIn(choices, 'Где искать', SEARCH_CATEGORIES, moduleSearchState.categories, 'ci-module-search-kinds');
        checklistIn(choices, 'Исходники', SEARCH_SCOPES, moduleSearchState.scopes, 'ci-module-search-scopes');
        var regexHelp = el('div', 'ci-module-regex-help');
        regexHelp.hidden = true;
        regexHelp.appendChild(el('div', 'ci-module-regex-help-title', 'Частые шаблоны для модулей BSL'));
        var examples = [
            [function (q) { return '^\\s*(Процедура|Функция)\\s+' + q; }, 'объявление процедуры или функции'],
            [function (q) { return q + '\\s*\\('; }, 'вызов метода'],
            [function (q) { return q + '\\s*='; }, 'присваивание'],
            [function (q) { return q + '|ДругойТекст'; }, 'любой из двух вариантов'],
            [function (q) { return '^\\s*//.*' + q; }, 'упоминание в комментарии'],
            [function (q) { return 'Начало.*' + q; }, 'любой текст между двумя частями']
        ];
        var exampleButtons = [];
        examples.forEach(function (example) {
            var row = el('div', 'ci-module-regex-example');
            var pattern = el('button', 'ci-module-regex-pattern');
            pattern.type = 'button';
            pattern.title = 'Подставить в строку поиска';
            pattern.addEventListener('click', function () {
                input.value = example[0](input.value.trim() || 'ТекстДляПоиска');
                moduleSearchState.query = input.value;
                moduleSearchState.regexp = true;
                regexpCheck.checked = true;
                updateRegexExamples();
                updateRegexAssist();
                if (input.focus) input.focus();
            });
            exampleButtons.push({ button: pattern, make: example[0] });
            row.appendChild(pattern);
            row.appendChild(el('span', 'ci-module-regex-description', ' — ' + example[1]));
            regexHelp.appendChild(row);
        });
        var syntax = el('div', 'ci-module-regex-syntax');
        syntax.appendChild(el('span', '', '. — любой символ;  .* — любая последовательность;  \\s — пробельный символ;  '
            + '^ и $ — начало и конец строки;  | — «или»;  (...) — группа;  [А-Я] — диапазон;  \\. — обычная точка.'));
        regexHelp.appendChild(syntax);
        regexHelp.appendChild(el('div', 'ci-module-regex-note',
            'Регистр задаётся отдельным флажком. Для простого точного текста регулярное выражение включать не нужно.'));
        box.appendChild(regexHelp);
        function updateRegexExamples() {
            var query = input.value.trim() || 'ТекстДляПоиска';
            exampleButtons.forEach(function (example) { example.button.textContent = example.make(query); });
        }
        updateRegexExamples();
        helpButton.addEventListener('click', function () {
            regexHelp.hidden = !regexHelp.hidden;
            helpButton.setAttribute('aria-expanded', regexHelp.hidden ? 'false' : 'true');
        });
        var regexAssist = el('div', 'ci-module-regex-assist');
        regexAssist.setAttribute('role', 'status');
        regexAssist.setAttribute('aria-live', 'polite');
        box.appendChild(regexAssist);
        function updateRegexAssist() {
            regexAssist.hidden = !regexpCheck.checked;
            regexAssist.innerHTML = '';
            if (regexAssist.hidden) return;
            var assist = moduleRegexAssist(input.value);
            var message = el('span', 'ci-module-regex-assist-message' + (assist.valid ? '' : ' ci-module-regex-assist-error'),
                assist.message);
            regexAssist.appendChild(message);
            if (assist.suggestions.length) {
                var choices = el('span', 'ci-module-regex-suggestions');
                choices.appendChild(el('span', 'ci-module-regex-suggestions-label', ' Добавить:'));
                assist.suggestions.forEach(function (suggestion) {
                    var choice = el('button', 'ci-module-regex-suggestion', suggestion.label);
                    choice.type = 'button';
                    choice.title = suggestion.detail;
                    choice.addEventListener('click', function () {
                        var start = typeof input.selectionStart === 'number' ? input.selectionStart : input.value.length;
                        var end = typeof input.selectionEnd === 'number' ? input.selectionEnd : start;
                        if (suggestion.replaceEscape && start > 0 && input.value.charAt(start - 1) === '\\') start--;
                        input.value = input.value.slice(0, start) + suggestion.text + input.value.slice(end);
                        moduleSearchState.query = input.value;
                        var caret = start + suggestion.text.length;
                        if (input.setSelectionRange) input.setSelectionRange(caret, caret);
                        if (input.focus) input.focus();
                        updateRegexAssist();
                    });
                    choices.appendChild(choice);
                });
                regexAssist.appendChild(choices);
            }
        }
        regexpCheck.addEventListener('change', updateRegexAssist);
        input.addEventListener('input', function () {
            moduleSearchState.query = input.value;
            updateRegexExamples();
            updateRegexAssist();
        });
        updateRegexAssist();
        var content = el('div', 'ci-module-search-content');
        var output = el('div', 'ci-module-search-results');
        output.appendChild(el('div', 'ci-loading', 'Введите текст и нажмите «Найти».'));
        var preview = el('div', 'ci-module-preview');
        var previewTitle = el('div', 'ci-module-preview-title', 'Быстрый просмотр');
        var previewBody = el('div', 'ci-module-preview-body');
        preview.appendChild(previewTitle);
        preview.appendChild(previewBody);
        content.appendChild(output);
        content.appendChild(preview);
        box.appendChild(content);
        show(box);

        function clearPreview() {
            previewTitle.textContent = 'Быстрый просмотр';
            previewBody.innerHTML = '';
            previewBody.appendChild(el('div', 'ci-loading', 'Наведите указатель на найденный модуль.'));
        }
        function showPreview(item) {
            previewTitle.textContent = item.label + ' · строка ' + item.line;
            previewBody.innerHTML = '';
            (item.snippet || []).forEach(function (row) {
                var line = el('div', 'ci-module-preview-line' + (row.match ? ' ci-module-preview-match' : ''));
                line.appendChild(el('span', 'ci-module-preview-number', String(row.number)));
                line.appendChild(el('span', 'ci-module-preview-code', row.text || ' '));
                previewBody.appendChild(line);
            });
        }
        clearPreview();

        function run() {
            moduleSearchState.query = input.value;
            regexHelp.hidden = true;
            regexAssist.hidden = true;
            helpButton.setAttribute('aria-expanded', 'false');
            output.innerHTML = '';
            clearPreview();
            if (!moduleSearchState.query.trim()) {
                output.appendChild(el('div', 'ci-empty-hits', 'Введите текст для поиска.'));
                return;
            }
            if (!loader || typeof loader.searchModules !== 'function') {
                output.appendChild(el('div', 'ci-empty-hits', 'Этот хост не поддерживает глобальный поиск.'));
                return;
            }
            var request = ++moduleSearchToken;
            cancelModuleSearch();
            var cancelState = { cancelled: false, notify: null };
            moduleSearchCancel = cancelState;
            button.disabled = true;
            cancelButton.disabled = false;
            var progress = el('div', 'ci-module-progress ci-module-progress-indeterminate');
            var progressLabel = el('span', 'ci-module-progress-label', 'Получение списка файлов…');
            var progressTrack = el('span', 'ci-module-progress-track');
            var progressFill = el('span', 'ci-module-progress-fill');
            progressTrack.setAttribute('role', 'progressbar');
            progressTrack.setAttribute('aria-label', 'Прогресс поиска по файлам');
            progressTrack.setAttribute('aria-valuemin', '0');
            progressTrack.setAttribute('aria-valuemax', '100');
            progressTrack.appendChild(progressFill);
            var progressPercent = el('span', 'ci-module-progress-percent', '0%');
            progress.appendChild(progressLabel);
            progress.appendChild(progressTrack);
            progress.appendChild(progressPercent);
            function setProgress(done, total, phase) {
                var value = phase === 'count' ? total : done;
                var percent = total > 0 ? Math.round(value * 100 / total) : 100;
                percent = Math.max(0, Math.min(100, percent));
                progress.className = 'ci-module-progress';
                progressLabel.textContent = phase === 'count'
                    ? 'Подсчёт вхождений: ' + done + ' из ' + total
                    : 'Обработано файлов: ' + done + ' из ' + total;
                progressFill.style.width = percent + '%';
                progressTrack.setAttribute('aria-valuenow', String(percent));
                progressPercent.textContent = percent + '%';
            }
            var streamed = el('div', 'ci-module-search-stream');
            var streamedLinks = [];
            output.appendChild(progress);
            output.appendChild(streamed);
            cancelState.notify = function () {
                cancelButton.disabled = true;
                progressLabel.textContent = 'Остановка поиска…';
            };
            function resultLink(item, showOccurrences) {
                var link = commandLink({
                    id: item.label,
                    title: item.label + (showOccurrences && item.occurrences != null
                        ? ' (' + item.occurrences + ')' : ''),
                    path: item.path,
                    openAt: { line: item.line, search: moduleSearchState.query,
                        regexp: moduleSearchState.regexp, matchCase: moduleSearchState.matchCase }
                }, 'ci-module-link');
                link.title = item.relative;
                link.addEventListener('mouseenter', function () { showPreview(item); });
                link.addEventListener('focus', function () { showPreview(item); });
                return link;
            }
            function resultOrder(item) {
                var kind = item.sortKind || '';
                if (kind === 'ExternalReport') kind = 'Report';
                else if (kind === 'ExternalDataProcessor') kind = 'DataProcessor';
                var classOrder = root.MetadataPreview && root.MetadataPreview.classOrder || [];
                var kindRank = classOrder.indexOf(kind);
                var names = model.objects && model.objects[kind] || [];
                var objectRank = item.sortName ? names.indexOf(item.sortName) : -1;
                return { kind: kind, kindRank: kindRank < 0 ? 10000 : kindRank,
                    objectRank: objectRank < 0 ? 10000 : objectRank, name: item.sortName || '', label: item.label || '' };
            }
            function compareResults(a, b) {
                var left = resultOrder(a), right = resultOrder(b);
                if (left.kindRank !== right.kindRank) return left.kindRank - right.kindRank;
                if (left.objectRank !== right.objectRank) return left.objectRank - right.objectRank;
                var byName = left.name.localeCompare(right.name, 'ru');
                if (byName) return byName;
                return left.label.localeCompare(right.label, 'ru');
            }
            function insertResult(item, showOccurrences) {
                var entry = { item: item, link: resultLink(item, showOccurrences) };
                var index = streamedLinks.findIndex(function (existing) {
                    return compareResults(item, existing.item) < 0;
                });
                if (index < 0) {
                    streamedLinks.push(entry);
                    streamed.appendChild(entry.link);
                } else {
                    streamedLinks.splice(index, 0, entry);
                    streamed.insertBefore(entry.link, streamed.children[index]);
                }
            }
            var searchSettings = {
                regexp: moduleSearchState.regexp,
                matchCase: moduleSearchState.matchCase,
                categories: moduleSearchState.categories,
                scopes: moduleSearchState.scopes,
                cancelled: function () { return cancelState.cancelled; },
                onMatch: function (item, showOccurrences) {
                    if (token !== drawToken || request !== moduleSearchToken) return;
                    var existing = item && streamedLinks.find(function (entry) { return entry.item.path === item.path; });
                    if (existing) {
                        existing.item = item;
                        existing.link.textContent = item.label + (showOccurrences && item.occurrences != null
                            ? ' (' + item.occurrences + ')' : '');
                        return;
                    }
                    insertResult(item, showOccurrences);
                },
                onProgress: function (done, total, phase) {
                    if (token !== drawToken || request !== moduleSearchToken) return;
                    setProgress(done, total, phase);
                }
            };
            loader.searchModules(configPath, moduleSearchState.query, searchSettings).then(function (result) {
                if (token !== drawToken || request !== moduleSearchToken) return;
                if (moduleSearchCancel === cancelState) moduleSearchCancel = null;
                button.disabled = false;
                cancelButton.disabled = true;
                if (result.error) {
                    output.innerHTML = '';
                    output.appendChild(el('div', 'ci-module-search-error', result.error));
                    return;
                }
                if (result.cancelled) {
                    progress.className = 'ci-module-progress ci-module-progress-cancelled';
                    progressLabel.textContent = 'Поиск отменён. Найдено файлов: ' + result.total
                        + '. Обработано: ' + result.scanned + ' из ' + result.files + '.';
                    return;
                }
                if (!result.matches.length) {
                    output.innerHTML = '';
                    output.appendChild(el('div', 'ci-empty-hits', 'Совпадений нет. Проверено файлов: ' + result.scanned + '.'));
                    return;
                }
                progress.className = 'ci-module-progress ci-module-progress-complete';
                progressLabel.textContent = 'Найдено файлов: ' + result.total + ' из ' + result.scanned
                    + (result.truncated ? '. Показаны первые ' + result.matches.length + '.' : '.');
                progressFill.style.width = '100%';
                progressTrack.setAttribute('aria-valuenow', '100');
                progressPercent.textContent = '100%';
                /* Hosts predating streaming still receive a complete final
                 * result through the same loader contract. */
                if (!streamedLinks.length) result.matches.forEach(function (item) {
                    insertResult(item, result.total < 20);
                });
            }, function (err) {
                if (token !== drawToken || request !== moduleSearchToken) return;
                if (moduleSearchCancel === cancelState) moduleSearchCancel = null;
                button.disabled = false;
                cancelButton.disabled = true;
                output.innerHTML = '';
                output.appendChild(el('div', 'ci-module-search-error', 'Поиск не выполнен: ' + (err && err.message || err)));
            });
        }
        button.addEventListener('click', run);
        cancelButton.addEventListener('click', cancelModuleSearch);
        input.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') { e.preventDefault(); run(); }
        });
        setTimeout(function () { if (input.focus) input.focus(); }, 0);
    }

    /* ---- Все функции */
    var allOpen = {};
    function drawAll() {
        /* Поиск из шапки работает и здесь: «Все функции» — такой же список
         * объектов, и уводить с вкладки на общую выдачу незачем. */
        var q = viewState.query.trim().toLowerCase();
        var filtering = q.length >= 2;
        var box = panelBox(filtering ? 'Все функции: ' + viewState.query.trim() : 'Все функции',
            function () { viewState.mode = leftAllMode(); redraw(); });
        var list = el('div', 'ci-all');
        var extByKind = allExtObjects;
        var token = drawToken;
        var jobs = [];
        allFunctionKinds().forEach(function (k) {
            var names = (model.objects && model.objects[k[0]]) || [];
            var added = extByKind[k[0]] || [];
            var baseNames = Object.create(null);
            names.forEach(function (name) { baseNames[name] = true; });
            var addedOnly = added.filter(function (item) { return !baseNames[item.name] && item.own; });
            if (!names.length && !addedOnly.length) return;
            var group = el('div', 'ci-all-group');
            /* Пока идёт отбор, вид раскрыт: иначе найденное пришлось бы
             * открывать вручную по одному. Свёрнутость обычного списка при
             * этом не меняется. */
            var opened = filtering || !!allOpen[k[0]];
            var head = el('div', 'ci-all-head' + (opened ? ' ci-all-open' : ''), '');
            var items = el('div', 'ci-all-items');
            function countText(shown, total) {
                if (filtering) return k[1] + ' (найдено: ' + shown + ' из ' + total + ')';
                return k[1] + ' (' + total + (addedOnly.length ? ', из расширений: ' + addedOnly.length : '') + ')';
            }
            head.textContent = countText(0, names.length + addedOnly.length);
            head.addEventListener('click', function () {
                opened = !opened;
                if (!filtering) allOpen[k[0]] = opened;
                head.classList.toggle('ci-all-open', opened);
                fill();
            });
            function addRows(rows) {
                var v = view();
                var extensionByName = Object.create(null);
                added.forEach(function (item) {
                    extensionByName[item.name] = item.exts || (item.ext ? [item.ext] : []);
                });
                var shown = rows.filter(function (r) {
                    var ref = k[0] + '.' + r.name;
                    /* An extension's object is outside the roles and the
                     * options of the configuration's own rights files. */
                    if (!baseNames[r.name]) return true;
                    if (v.rights && !hasRight(v.rights, ref, requiredRight(ref + '.StandardCommand.Open'))) return false;
                    return !(v.fo && switchedOff(v.fo[ref], v.foOff));
                });
                var hits = filtering ? shown.filter(function (r) {
                    return matchesQuery({ id: k[0] + '.' + r.name, title: r.title, name: r.name }, q);
                }) : shown;
                hits.sort(function (a, b) { return a.title.localeCompare(b.title, 'ru'); }).forEach(function (r) {
                    if (!r.ext && !r.exts && extensionByName[r.name]) r.exts = extensionByName[r.name];
                    items.appendChild(commandLink({ id: k[0] + '.' + r.name, title: r.title, name: r.name,
                        path: r.path, ext: r.ext, exts: r.exts, fo: v.fo && v.fo[k[0] + '.' + r.name] || null }));
                });
                head.textContent = countText(hits.length, shown.length);
                return hits.length;
            }
            function fill() {
                items.innerHTML = '';
                if (!opened) return Promise.resolve(0);
                if (!loader) {
                    var plain = filtering ? names.filter(function (n) {
                        return matchesQuery({ id: k[0] + '.' + n, title: n, name: n }, q);
                    }) : names;
                    plain.forEach(function (n) { items.appendChild(el('div', 'ci-command', n)); });
                    head.textContent = countText(plain.length, names.length);
                    if (filtering) group.hidden = !plain.length;
                    return Promise.resolve(plain.length);
                }
                items.appendChild(el('div', 'ci-loading', 'Загрузка…'));
                return (names.length ? loader.synonyms(configPath, k[0], names) : Promise.resolve([]))
                    .then(function (rows) {
                        if (token !== drawToken) return 0;
                        items.innerHTML = '';
                        var count = addRows(Array.prototype.slice.call(rows).concat(addedOnly));
                        /* Вид без попаданий не занимает колонку: при отборе он
                         * прячется целиком, а не показывает пустую строку. */
                        if (filtering) group.hidden = !count;
                        else if (!count) items.appendChild(el('div', 'ci-loading', 'Нет доступных объектов'));
                        return count;
                    });
            }
            jobs.push(fill());
            group.appendChild(head);
            group.appendChild(items);
            list.appendChild(group);
        });
        box.appendChild(list);
        if (filtering) {
            var empty = el('div', 'ci-empty-hits', 'Ничего не найдено');
            empty.hidden = true;
            box.appendChild(empty);
            Promise.all(jobs).then(function (counts) {
                if (token !== drawToken) return;
                empty.hidden = counts.some(function (c) { return c > 0; });
            });
        }
        show(box);
    }

    /* A section picked by the user is reported as the selection, so the host
     * keeps it in its outline and restores it when coming back. */
    function choose(ref, byUser) {
        if (viewState.mode !== 'section') {
            viewState.mode = 'section';
            if (searchInput.value) { searchInput.value = ''; viewState.query = ''; }
        } else if (viewState.section === ref && byUser) {
            return;
        }
        viewState.section = ref;
        if (byUser && options.onSelect) options.onSelect({ id: ref, name: ref });
        redraw();
    }
    container._ciSelect = function (ref) {
        if (ref === viewState.section && viewState.mode === 'section') return;
        choose(ref, false);
    };

    /* The extensions are read after the configuration's own window is up:
     * the window never waits for them, it fills in when they answer. */
    function loadExtensions() {
        if (!loader || model.extension || typeof loader.extensions !== 'function') return;
        loader.extensions(configPath).then(function (found) {
            if (!container.contains(win) || !found.length) return null;
            return Promise.all(found.map(function (info) {
                return loader.loadMain(info.configPath, info.model).then(function (m) {
                    return { info: info, main: m };
                }, function () { return { info: info, main: null }; });
            })).then(function (list) {
                if (!container.contains(win)) return null;
                exts = list;
                extensionInspectorModels[mainKey(model)] = exts.map(function (extension) {
                    return { type: 'form', tag: 'CiConfigurationExtension', itemKind: 'configuration',
                        id: 'configuration-extension:' + extension.info.name, name: extension.info.name,
                        title: extension.info.title, line: 1, depth: 0, hasChildren: false,
                        configuration: true, inspectorOnly: true, model: extension.info.model };
                });
                if (options.onOutlineChanged) options.onOutlineChanged();
                syncHeader();
                drawSections();
                redraw();
                return extObjects().then(function (byKind) {
                    if (!container.contains(win)) return;
                    allExtObjects = byKind;
                    if (viewState.mode !== 'section') redraw();
                });
            });
        }).catch(function (err) {
            if (window.console) console.warn('configuration extensions were not read', err);
        });
    }

    var foReady = loader && model.functionalOptions.length
        ? loader.functionalOptions(configPath, model.functionalOptions).then(function (f) {
            fo = f;
            drawSections();
            return f;
        }, function () { return null; })
        : Promise.resolve(null);

    syncHeader();
    drawSections();
    redraw();

    if (loader) {
        loader.loadMain(configPath, model).then(function (m) {
            if (!container.contains(win)) return;
            main = m;
            resolvedMains[mainKey(model)] = m;
            drawSections();
            if (viewState.section !== HOME && !itemsByRef[viewState.section]) viewState.section = HOME;
            if (viewState.mode === 'section' && viewState.section === HOME) redraw();
            mark();
            loadExtensions();
        }, function (err) {
            if (window.console) console.warn('configuration interface was not read', err);
        });
        /* Until the viewer picks roles, look as the full-rights role of the
         * standard subsystems library, when the configuration has one. */
        if (viewState.roles == null) {
            var stored = storedChoice(model);
            viewState.roles = stored ? stored.roles.filter(function (r) { return model.roles.indexOf(r.replace(/^Role\./, '')) >= 0; })
                : model.roles.indexOf('ПолныеПрава') >= 0 ? ['Role.ПолныеПрава'] : [];
            if (stored) viewState.foOff = stored.foOff;
            syncHeader();
        }
        if (viewState.roles.length) setRoles(viewState.roles);
    }
}

/* ------------------------------------------------------- outline / host */

function outline(model, xml) {
    var out = [];
    if (!model) return out;
    var lines = String(xml || '').split(/\r?\n/);
    function lineOf(needle) {
        for (var i = 0; i < lines.length; i++) if (lines[i].indexOf(needle) >= 0) return i + 1;
        return 1;
    }
    /* Unlike a client section, this row represents Configuration.xml itself.
     * It gives the right-hand pane a stable selection whose inspector can
     * show every property of the configuration root. */
    out.push({ type: 'form', tag: 'CiConfiguration', itemKind: 'configuration', id: 'configuration',
        name: model.name, title: model.synonym || model.name, line: lineOf('<Name>'), depth: 0,
        hasChildren: false, configuration: true, model: model });
    out.push({ type: 'form', tag: 'CiHome', itemKind: 'configuration', id: HOME, name: 'Главное',
        title: 'Главное', line: 1, depth: 0, hasChildren: false });
    var shown = shownSections[mainKey(model)];
    var main = resolvedMains[mainKey(model)];
    var sections = shown ? shown.list : main ? main.sections : model.subsystems.map(function (name) {
        return { ref: 'Subsystem.' + name, name: name, title: name };
    });
    sections.forEach(function (s) {
        out.push({ type: 'form', tag: 'CiSection', itemKind: 'configuration', id: s.ref, name: s.title,
            title: s.title, line: lineOf('<Subsystem>' + s.name + '</Subsystem>'), depth: 0, hasChildren: false });
    });
    (extensionInspectorModels[mainKey(model)] || []).forEach(function (entry) { out.push(entry); });
    return out;
}

function inspector(entry) {
    if (!entry || !entry.configuration || !entry.model) return null;
    var model = entry.model;
    var rows = [{ label: 'Имя', value: model.name }];
    if (model.synonym) rows.push({ label: 'Синоним', value: model.synonym });
    if (model.comment) rows.push({ label: 'Комментарий', value: model.comment });
    var properties = model.properties || [];
    return {
        name: model.name,
        typeName: model.extension ? 'Расширение конфигурации' : 'Конфигурация',
        heading: 'Свойства',
        rows: rows,
        groups: properties.length ? [{
            label: 'Свойства конфигурации (' + properties.length + ')',
            open: true,
            items: properties.map(function (property) {
                return { label: CONFIG_PROPERTY_TITLES[property.key] || property.label, value: property.value };
            })
        }] : []
    };
}

function highlight(container, id) {
    if (!container || !container._ciSelect) return null;
    id = String(id || '');
    if (id === HOME || /^Subsystem\.[^.]+$/.test(id)) container._ciSelect(id);
    return null;
}

function itemKey(item) { return item && item.id || ''; }

root.ConfigurationPreview = {
    detect: detect,
    parse: parse,
    render: render,
    outline: outline,
    inspector: inspector,
    highlight: highlight,
    itemKey: itemKey,
    resetViewState: resetViewState,
    createLoader: createLoader,
    buildPanel: buildPanel,
    _test: {
        parseCommandInterface: parseCommandInterface, parseHomePage: parseHomePage, parseCommands: parseCommands,
        parseRights: parseRights, hasRight: hasRight, unionRights: unionRights, requiredRight: requiredRight,
        refNames: refNames, matchesQuery: matchesQuery, reorderSlots: reorderSlots, mergeSectionRaws: mergeSectionRaws,
        groupOptions: groupOptions, subsystemPath: subsystemPath, projSubsystemPath: projSubsystemPath, formPaths: formPaths, commandsOf: commandsOf,
        localized: localized, moduleInfo: moduleInfo, moduleMatcher: moduleMatcher, moduleSnippet: moduleSnippet,
        moduleRegexAssist: moduleRegexAssist
    }
};

})(typeof window !== 'undefined' ? window : globalThis);
