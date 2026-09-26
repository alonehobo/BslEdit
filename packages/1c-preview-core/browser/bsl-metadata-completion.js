/* Small, on-demand completion index for metadata names in a configuration
 * export. It reads only the nearest Configuration.xml and caches the parsed
 * ChildObjects list for the life of the editor page. */
(function (root) {
'use strict';

var CATEGORIES = [
    { prefix: 'Справочники', className: 'Catalog', detail: 'Справочник' },
    { prefix: 'Документы', className: 'Document', detail: 'Документ' },
    { prefix: 'Перечисления', className: 'Enum', detail: 'Перечисление' },
    { prefix: 'Константы', className: 'Constant', detail: 'Константа' },
    { prefix: 'Отчеты', className: 'Report', detail: 'Отчет' },
    { prefix: 'Обработки', className: 'DataProcessor', detail: 'Обработка' },
    { prefix: 'РегистрыСведений', className: 'InformationRegister', detail: 'Регистр сведений' },
    { prefix: 'РегистрыНакопления', className: 'AccumulationRegister', detail: 'Регистр накопления' },
    { prefix: 'РегистрыБухгалтерии', className: 'AccountingRegister', detail: 'Регистр бухгалтерии' },
    { prefix: 'РегистрыРасчета', className: 'CalculationRegister', detail: 'Регистр расчета' },
    { prefix: 'ПланыОбмена', className: 'ExchangePlan', detail: 'План обмена' },
    { prefix: 'ПланыСчетов', className: 'ChartOfAccounts', detail: 'План счетов' },
    { prefix: 'ПланыВидовХарактеристик', className: 'ChartOfCharacteristicTypes', detail: 'План видов характеристик' },
    { prefix: 'ПланыВидовРасчета', className: 'ChartOfCalculationTypes', detail: 'План видов расчета' },
    { prefix: 'БизнесПроцессы', className: 'BusinessProcess', detail: 'Бизнес-процесс' },
    { prefix: 'Задачи', className: 'Task', detail: 'Задача' },
    { prefix: 'ЖурналыДокументов', className: 'DocumentJournal', detail: 'Журнал документов' },
    { prefix: 'ОбщиеФормы', className: 'CommonForm', detail: 'Общая форма' },
    { prefix: 'ОбщиеКоманды', className: 'CommonCommand', detail: 'Общая команда' },
    { prefix: 'Подсистемы', className: 'Subsystem', detail: 'Подсистема' },
    { prefix: 'Роли', className: 'Role', detail: 'Роль' }
];
var byPrefix = Object.create(null);
CATEGORIES.forEach(function (category) { byPrefix[category.prefix.toLowerCase()] = category; });
var indexes = Object.create(null);
var MAX_CONFIG_BYTES = 16 * 1024 * 1024;
var MAX_MODULE_BYTES = 2 * 1024 * 1024;

function context(model, pos) {
    var line = model.getLineContent(pos.lineNumber).slice(0, pos.column - 1);
    /* Comments cannot contain a metadata expression. */
    var comment = line.indexOf('//');
    if (comment >= 0) line = line.slice(0, comment);
    var match = line.match(/(?:^|[^a-zA-Z\u0410-\u044f\u0401\u0451_0-9])([a-zA-Z\u0410-\u044f\u0401\u0451_][a-zA-Z\u0410-\u044f\u0401\u04510-9_]*)\.([a-zA-Z\u0410-\u044f\u0401\u0451_0-9]*)$/i);
    if (!match) return null;
    var category = byPrefix[match[1].toLowerCase()] || null;
    return category
        ? { category: category, partial: match[2] }
        : { commonModuleCandidate: match[1], partial: match[2] };
}

function parseIndex(xml) {
    var start = String(xml || '').indexOf('<ChildObjects>');
    if (start < 0) return {};
    var end = xml.indexOf('</ChildObjects>', start);
    if (end < 0) return {};
    var body = xml.slice(start + 14, end);
    var result = {};
    var re = /<([A-Za-z][A-Za-z0-9_]*)\b[^>]*>\s*([^<>]+?)\s*<\/\1\s*>/g;
    var match;
    while ((match = re.exec(body))) {
        var name = match[2].trim();
        if (!name) continue;
        (result[match[1]] || (result[match[1]] = [])).push(name);
    }
    return result;
}

function parseCommonModule(text) {
    var out = [];
    var re = /^\s*(Процедура|Функция|Procedure|Function)\s+([a-zA-Z\u0410-\u044f\u0401\u0451_][a-zA-Z\u0410-\u044f\u0401\u04510-9_]*)\s*\(([^)]*)\)\s*(Экспорт|Export)(?![a-zA-Z\u0410-\u044f\u0401\u04510-9_])/gim;
    var match;
    while ((match = re.exec(String(text || '')))) {
        var isFunction = /^(Функция|Function)$/i.test(match[1]);
        out.push({ name: match[2], kind: isFunction ? 'Function' : 'Method',
            detail: isFunction ? 'Экспортируемая функция' : 'Экспортируемая процедура' });
    }
    return out;
}

function rootDirectory(filePath, io) {
    var path = root.FormContext && root.FormContext._test;
    if (!path || !filePath) return Promise.resolve('');
    var directories = [];
    var directory = path.dirname(filePath);
    while (directory && directory !== path.dirname(directory)) {
        directories.push(directory);
        directory = path.dirname(directory);
    }
    var probes = directories.map(function (item) { return path.join(item, 'Configuration.xml'); });
    var exists = typeof io.existsMany === 'function'
        ? io.existsMany(probes)
        : Promise.all(probes.map(function (probe) { return io.exists(probe); }));
    return exists.then(function (found) {
        for (var i = 0; i < found.length; i++) if (found[i]) return directories[i];
        return '';
    });
}

function load(filePath, io) {
    if (!filePath || !io || typeof io.readBytes !== 'function') return Promise.resolve({});
    var key = String(filePath).replace(/\\/g, '/').toLowerCase();
    if (indexes[key]) return indexes[key];
    var path = root.FormContext && root.FormContext._test;
    var pending = rootDirectory(filePath, io).then(function (directory) {
        if (!directory || !path) return {};
        var rootKey = 'configuration:' + directory.replace(/\\/g, '/').toLowerCase();
        if (indexes[rootKey]) return indexes[rootKey];
        var configPath = path.join(directory, 'Configuration.xml');
        indexes[rootKey] = io.readBytes(configPath, MAX_CONFIG_BYTES).then(function (bytes) {
            if (!bytes) return {};
            var decoded = root.FormContext.decodeText(bytes);
            return parseIndex(decoded.content);
        });
        return indexes[rootKey];
    }).catch(function () { return {}; });
    indexes[key] = pending;
    return pending;
}

function suggestions(filePath, io, category) {
    if (!category) return Promise.resolve([]);
    return load(filePath, io).then(function (index) {
        return (index[category.className] || []).map(function (name) {
            return { label: name, kind: 'Class', detail: category.detail,
                insertText: name, filterText: name };
        });
    });
}

function memberSuggestions(filePath, io, moduleName) {
    if (!filePath || !io || !moduleName || typeof io.readBytes !== 'function') return Promise.resolve([]);
    var path = root.FormContext && root.FormContext._test;
    if (!path) return Promise.resolve([]);
    return rootDirectory(filePath, io).then(function (directory) {
        if (!directory) return [];
        var key = 'common-module:' + directory.replace(/\\/g, '/').toLowerCase() + '/' + moduleName.toLowerCase();
        if (!indexes[key]) {
            var modulePath = path.join(directory, 'CommonModules', moduleName, 'Ext', 'Module.bsl');
            indexes[key] = io.readBytes(modulePath, MAX_MODULE_BYTES).then(function (bytes) {
                if (!bytes) return [];
                return parseCommonModule(root.FormContext.decodeText(bytes).content);
            }).catch(function () { return []; });
        }
        return indexes[key];
    }).catch(function () { return []; });
}

function commonModuleSuggestions(filePath, io, candidate) {
    if (!candidate) return Promise.resolve([]);
    return load(filePath, io).then(function (index) {
        var moduleName = (index.CommonModule || []).filter(function (name) {
            return name.toLowerCase() === candidate.toLowerCase();
        })[0];
        return moduleName ? memberSuggestions(filePath, io, moduleName) : [];
    });
}

root.BslMetadataCompletion = {
    context: context, parseIndex: parseIndex, parseCommonModule: parseCommonModule,
    suggestions: suggestions, memberSuggestions: memberSuggestions,
    commonModuleSuggestions: commonModuleSuggestions
};
})(typeof window !== 'undefined' ? window : globalThis);
