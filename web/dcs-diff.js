/* Semantic diff for data-composition schemas. XML order and namespace prefixes
 * are transport details; named DCS entities and their effective properties are
 * what a reviewer needs to see. */
(function (root) {
'use strict';

var SECTIONS = {
    sets: 'Наборы данных', links: 'Связи наборов данных', calculated: 'Вычисляемые поля',
    totals: 'Ресурсы', parameters: 'Параметры', templates: 'Макеты',
    nested: 'Вложенные схемы', settings: 'Настройки'
};

var PROPERTIES = {
    kindTitle: 'Вид', source: 'Источник данных', objectName: 'Имя объекта', autoFill: 'Автозаполнение',
    useQueryGroup: 'Использовать группировки запроса', dataPath: 'Путь к данным', field: 'Поле',
    title: 'Заголовок', restrict: 'Ограничение поля', attrRestrict: 'Ограничение реквизитов',
    role: 'Роль', type: 'Тип значения', presentation: 'Выражение представления', order: 'Упорядочивание',
    available: 'Доступные значения', appearance: 'Оформление', editParameters: 'Параметры редактирования',
    hierarchySet: 'Набор проверки иерархии', hierarchyParameter: 'Параметр проверки иерархии',
    expression: 'Выражение', groups: 'Рассчитывать по', value: 'Значение', valueList: 'Список значений',
    restricted: 'Ограничение доступности', availableAsField: 'Включать в доступные поля',
    use: 'Использование', denyIncomplete: 'Запрещать незаполненные', functionalOption: 'Функциональная опция',
    sourceExpr: 'Выражение источника', destExpr: 'Выражение приёмника', parameter: 'Параметр',
    parameterList: 'Список параметров', condition: 'Условие связи', start: 'Начальное значение',
    required: 'Обязательная связь', target: 'Назначение', templateType: 'Тип макета',
    parameters: 'Параметры макета', area: 'Содержимое области', sets: 'Число наборов',
    setNames: 'Наборы данных', settings: 'Настройки заданы', selection: 'Выбранные поля',
    filter: 'Отбор', groupFields: 'Поля группировки', outputParameters: 'Другие настройки',
    dataParameters: 'Параметры данных', userFields: 'Пользовательские поля', parent: 'Родитель',
    position: 'Положение', query: 'Текст запроса'
};

/* Leaf tags whose values are represented by each semantic entry. Deliberately
 * absent tags (for example userSettingID) keep the XML fallback visible. */
var COVERED_TAGS = {
    set: ['name', 'dataSource', 'objectName', 'autoFillFields', 'useQueryGroupIfPossible'],
    field: ['dataPath', 'field', 'lang', 'content', 'useRestriction', 'attributeUseRestriction', 'role', 'dimension',
        'periodNumber', 'periodType', 'account', 'balance', 'required', 'presentationExpression', 'orderExpression',
        'inHierarchyDataSet', 'inHierarchyDataSetParameter', 'Type', 'TypeSet', 'availableValue', 'parameter'],
    query: ['query'],
    link: ['sourceDataSet', 'destinationDataSet', 'sourceExpression', 'destinationExpression', 'parameter',
        'parameterListAllowed', 'linkConditionExpression', 'startExpression', 'required'],
    calculated: ['dataPath', 'expression', 'lang', 'content', 'field', 'condition', 'group', 'order',
        'presentationExpression', 'Type', 'TypeSet', 'availableValue', 'parameter'],
    total: ['dataPath', 'expression', 'group'],
    parameter: ['name', 'lang', 'content', 'Type', 'TypeSet', 'value', 'variant', 'startDate', 'endDate', 'date',
        'expression', 'useRestriction', 'valueListAllowed', 'availableAsField', 'functionalOptionsParameter',
        'denyIncompleteValues', 'use', 'availableValue'],
    template: ['name', 'groupName', 'groupName1', 'groupField', 'groupField1', 'field', 'templateType', 'templateType1',
        'parameter', 'expression', 'value', 'lang', 'content'],
    nested: ['name', 'lang', 'content', 'URL'],
    variant: ['name', 'lang', 'content'],
    node: ['use', 'name', 'id', 'Id', 'field', 'groupType', 'periodAdditionType', 'left', 'comparisonType', 'right',
        'presentation', 'orderType', 'parameter', 'value', 'lang', 'content', 'placement']
};

function own(obj, key) { return Object.prototype.hasOwnProperty.call(obj, key); }
function cleanText(value) { return String(value == null ? '' : value).replace(/\r\n?/g, '\n').trim(); }
function stable(value) {
    if (value == null) return '';
    if (typeof value !== 'object') return cleanText(value);
    if (Array.isArray(value)) return value.map(stable).join(' | ');
    var keys = Object.keys(value).sort(), out = [];
    for (var i = 0; i < keys.length; i++) {
        if (keys[i] === 'id' || keys[i] === 'line' || keys[i] === 'source') continue;
        out.push(keys[i] + '=' + stable(value[keys[i]]));
    }
    return out.join('; ');
}
function shown(value) {
    if (value == null || value === '') return '';
    if (typeof value === 'boolean') return value ? 'Да' : 'Нет';
    if (Array.isArray(value)) return value.map(shown).filter(Boolean).join('; ');
    if (typeof value === 'object') {
        /* Поле выбора, группировки или отбора читается по заголовку, как в
         * конструкторе; служебные depth/line/path в описание не идут. */
        var name = value.text || value.title || value.path || value.field;
        if (name && typeof name !== 'object') return cleanText(name) + (value.use === false ? ' (не используется)' : '');
        var keys = Object.keys(value).filter(function (k) { return k !== 'id' && k !== 'line' && k !== 'source' && value[k] !== '' && value[k] !== false && value[k] != null; });
        return keys.map(function (k) { return (PROPERTIES[k] || k) + ': ' + shown(value[k]); }).join('; ');
    }
    return cleanText(value);
}
function pick(row, fields) {
    var out = {};
    for (var i = 0; i < fields.length; i++) out[fields[i]] = row && row[fields[i]];
    return out;
}
function propertyChanges(a, b) {
    var keys = {}, out = [];
    Object.keys(a || {}).forEach(function (k) { keys[k] = 1; });
    Object.keys(b || {}).forEach(function (k) { keys[k] = 1; });
    Object.keys(keys).forEach(function (key) {
        if (stable(a && a[key]) === stable(b && b[key])) return;
        out.push({ key: key, property: PROPERTIES[key] || key, from: shown(a && a[key]), to: shown(b && b[key]) });
    });
    return out;
}
function addBucket(map, key, item) {
    var list = map[key] || (map[key] = []);
    list.push(item);
}
function indexed(list, keyOf) {
    var out = {};
    for (var i = 0; i < list.length; i++) addBucket(out, keyOf(list[i], i), list[i]);
    return out;
}
function allKeys(a, b) {
    var keys = {};
    Object.keys(a).forEach(function (k) { keys[k] = 1; });
    Object.keys(b).forEach(function (k) { keys[k] = 1; });
    return Object.keys(keys);
}

function Collector() {
    this.groups = { sets: [], fields: [], links: [], calculated: [], totals: [], parameters: [], templates: [], nested: [], variants: [], nodes: [], queries: [] };
}
Collector.prototype.schema = function (model, prefix) {
    prefix = prefix || '';
    var self = this;
    function sets(list, parent) {
        for (var i = 0; i < (list || []).length; i++) {
            var set = list[i], path = parent ? parent + '/' + set.name : set.name;
            self.groups.sets.push({ key: prefix + path, label: set.name || path, tab: 'sets', entityId: set.id,
                value: pick(set, ['kindTitle', 'source', 'objectName', 'autoFill', 'useQueryGroup']) });
            if (set.query) self.groups.queries.push({ key: prefix + path, label: 'Запрос · ' + (set.name || path),
                tab: 'sets', entityId: set.id, value: cleanText(set.query.text) });
            for (var f = 0; f < (set.fields || []).length; f++) {
                var field = set.fields[f];
                self.groups.fields.push({ key: prefix + path + ':' + field.dataPath, label: field.dataPath || field.field,
                    context: set.name, tab: 'sets', entityId: field.id,
                    value: pick(field, ['kind', 'dataPath', 'field', 'title', 'restrict', 'attrRestrict', 'role', 'type',
                        'presentation', 'order', 'available', 'appearance', 'editParameters', 'hierarchySet', 'hierarchyParameter']) });
            }
            sets(set.items, path);
        }
    }
    sets(model.sets, '');
    function rows(name, list, key, label, tab, fields) {
        for (var i = 0; i < (list || []).length; i++) {
            var row = list[i];
            self.groups[name].push({ key: prefix + key(row, i), label: label(row, i), tab: tab,
                entityId: row.id, value: pick(row, fields) });
        }
    }
    rows('links', model.links, function (r) { return r.source + '→' + r.dest; },
        function (r) { return r.source + ' → ' + r.dest; }, 'links',
        ['source', 'dest', 'sourceExpr', 'destExpr', 'parameter', 'parameterList', 'condition', 'start', 'required']);
    rows('calculated', model.calculated, function (r) { return r.dataPath; }, function (r) { return r.dataPath; }, 'calculated',
        ['dataPath', 'expression', 'title', 'restrict', 'type', 'presentation', 'order', 'available', 'appearance', 'editParameters']);
    rows('totals', model.totals, function (r) { return r.dataPath; }, function (r) { return r.dataPath; }, 'totals',
        ['dataPath', 'expression', 'groups']);
    rows('parameters', model.parameters, function (r) { return r.name; }, function (r) { return r.title || r.name; }, 'parameters',
        ['name', 'title', 'type', 'value', 'expression', 'valueList', 'restricted', 'availableAsField', 'use', 'denyIncomplete',
            'available', 'functionalOption', 'editParameters']);
    rows('templates', model.templates, function (r) { return [r.kind, r.target, r.templateType, r.name].join('|'); },
        function (r) { return r.title + (r.name ? ': ' + r.name : ''); }, 'templates',
        ['kind', 'name', 'target', 'templateType', 'parameters', 'area']);
    rows('nested', model.nested, function (r) { return r.name; }, function (r) { return r.title || r.name; }, 'nested',
        ['name', 'title', 'sets', 'setNames', 'settings']);
    for (var n = 0; n < (model.nested || []).length; n++) {
        if (model.nested[n].schema) this.schema(model.nested[n].schema, prefix + model.nested[n].name + '/');
    }
    for (var v = 0; v < (model.variants || []).length; v++) {
        var variant = model.variants[v], variantKey = prefix + variant.name;
        self.groups.variants.push({ key: variantKey, label: variant.presentation || variant.name, tab: 'settings',
            entityId: variant.id, value: pick(variant, ['name', 'presentation']) });
        if (variant.root) this.nodes(variant.root, variantKey, 0, {}, '');
    }
};
/* Ключ узла служебный (сигнатура и номер вхождения) и нужен только для
 * сопоставления; в свойство «Родитель» идёт путь из заголовков, чтобы
 * перенос в другую группировку читался как «Отчет › Статья». */
Collector.prototype.nodes = function (node, variantKey, index, seen, parentPath) {
    var signature = [node.kind, node.name || '', node.title || '', stable(node.groupFields || [])].join('|');
    var occurrence = seen[signature] || 0;
    seen[signature] = occurrence + 1;
    var key = variantKey + ':' + signature + '#' + occurrence;
    var label = node.title || node.name || 'Элемент структуры';
    var path = parentPath ? parentPath + ' › ' + label : label;
    this.groups.nodes.push({ key: key, label: label, tab: 'settings', entityId: node.id,
        value: {
            use: node.use, parent: parentPath, position: index + 1, groupFields: node.groupFields,
            selection: node.selection, filter: node.filter, order: node.order, appearance: node.appearance,
            outputParameters: node.outputParameters, dataParameters: node.dataParameters, userFields: node.userFields
        }
    });
    for (var i = 0; i < (node.children || []).length; i++) this.nodes(node.children[i], variantKey, i, seen, path);
};

function collect(model) { var c = new Collector(); c.schema(model, ''); return c.groups; }
function entry(type, section, kind, before, after, changes) {
    var row = after || before;
    return {
        id: type + ':' + row.key, type: type, section: section, tab: row.tab, kind: kind,
        name: row.label, context: row.context || '', entityId: after ? after.entityId : '',
        beforeId: before ? before.entityId : '', before: before || null, after: after || null,
        changes: changes || []
    };
}
function compareGroup(type, section, left, right, out) {
    var a = indexed(left, function (r) { return r.key; });
    var b = indexed(right, function (r) { return r.key; });
    allKeys(a, b).sort().forEach(function (key) {
        var aa = a[key] || [], bb = b[key] || [], count = Math.max(aa.length, bb.length);
        for (var i = 0; i < count; i++) {
            if (!aa[i]) { out.push(entry(type, section, 'added', null, bb[i])); continue; }
            if (!bb[i]) { out.push(entry(type, section, 'removed', aa[i], null)); continue; }
            var changes = propertyChanges(aa[i].value, bb[i].value);
            if (!changes.length) continue;
            var changed = entry(type, section, 'changed', aa[i], bb[i], changes);
            /* Одноимённые сущности сопоставлены по порядку — какая чья, не ясно. */
            if (aa.length > 1 || bb.length > 1) changed.ambiguous = true;
            out.push(changed);
        }
    });
}
function compareQueries(left, right, out) {
    var a = indexed(left, function (r) { return r.key; });
    var b = indexed(right, function (r) { return r.key; });
    allKeys(a, b).sort().forEach(function (key) {
        var aa = (a[key] || [])[0], bb = (b[key] || [])[0];
        if (!aa || !bb || aa.value === bb.value) return;
        var e = entry('query', 'sets', 'changed', aa, bb,
            [{ key: 'query', property: PROPERTIES.query, from: aa.value, to: bb.value }]);
        if (a[key].length > 1 || b[key].length > 1) e.ambiguous = true;
        e.query = { before: aa.value, after: bb.value };
        out.push(e);
    });
}
function normalizedXml(xml) {
    var src = String(xml || '').replace(/^\uFEFF/, '').replace(/<!--[^]*?-->/g, '').replace(/>\s+</g, '><').replace(/\r\n?/g, '\n').trim();
    /* The platform freely omits effective defaults. Their explicit spelling
     * is not a semantic change and must not become an "unknown XML" warning. */
    var defaults = {
        autoFillFields: 'true', useQueryGroupIfPossible: 'true', availableAsField: 'true', required: 'true',
        useRestriction: 'false', valueListAllowed: 'false', denyIncompleteValues: 'false', use: 'Auto'
    };
    Object.keys(defaults).forEach(function (name) {
        var re = new RegExp('<(?:\\w+:)?' + name + '>' + defaults[name] + '<\\/(?:\\w+:)?' + name + '>', 'g');
        src = src.replace(re, '');
    });
    return src;
}
function leafBag(xml) {
    var doc;
    try { doc = new DOMParser().parseFromString(String(xml || '').replace(/^\uFEFF/, ''), 'application/xml'); }
    catch (e) { return {}; }
    var bag = {};
    function walk(node) {
        var kids = node && node.children || [];
        if (!kids.length) {
            var name = node && (node.localName || node.tagName) || '';
            var value = cleanText(node && node.textContent);
            var key = name + '\u0000' + value;
            bag[key] = (bag[key] || 0) + 1;
            return;
        }
        for (var i = 0; i < kids.length; i++) walk(kids[i]);
    }
    if (doc && doc.documentElement) walk(doc.documentElement);
    return bag;
}
function changedLeafTags(leftXml, rightXml) {
    var a = leafBag(leftXml), b = leafBag(rightXml), keys = {};
    Object.keys(a).forEach(function (k) { keys[k] = 1; });
    Object.keys(b).forEach(function (k) { keys[k] = 1; });
    var tags = {};
    Object.keys(keys).forEach(function (key) {
        if ((a[key] || 0) !== (b[key] || 0)) tags[key.slice(0, key.indexOf('\u0000'))] = 1;
    });
    return Object.keys(tags);
}
function hasUnmodeled(leftXml, rightXml, entries, rawChanged) {
    if (!rawChanged) return false;
    var changed = changedLeafTags(leftXml, rightXml);
    if (!entries.length) return true;
    var covered = {};
    entries.forEach(function (entry) {
        (COVERED_TAGS[entry.type] || []).forEach(function (tag) { covered[tag] = 1; });
    });
    for (var i = 0; i < changed.length; i++) if (!covered[changed[i]]) return true;
    return false;
}
function compareXml(leftXml, rightXml) {
    if (!root.DcsPreview || !root.DcsPreview.parse) return { error: 'Модуль разбора СКД не загружен.' };
    var left, right;
    try { left = root.DcsPreview.parse(leftXml); } catch (e) { return { error: 'Эталон не разобрался: ' + e.message }; }
    if (!left || left.error) return { error: 'Эталон не разобрался: ' + ((left && left.error) || 'неизвестная ошибка') };
    try { right = root.DcsPreview.parse(rightXml); } catch (e2) { return { error: 'Текущая схема не разобралась: ' + e2.message }; }
    if (!right || right.error) return { error: 'Текущая схема не разобралась: ' + ((right && right.error) || 'неизвестная ошибка') };
    var a = collect(left.model), b = collect(right.model), entries = [];
    compareGroup('set', 'sets', a.sets, b.sets, entries);
    compareGroup('field', 'sets', a.fields, b.fields, entries);
    compareQueries(a.queries, b.queries, entries);
    compareGroup('link', 'links', a.links, b.links, entries);
    compareGroup('calculated', 'calculated', a.calculated, b.calculated, entries);
    compareGroup('total', 'totals', a.totals, b.totals, entries);
    compareGroup('parameter', 'parameters', a.parameters, b.parameters, entries);
    compareGroup('template', 'templates', a.templates, b.templates, entries);
    compareGroup('nested', 'nested', a.nested, b.nested, entries);
    compareGroup('variant', 'settings', a.variants, b.variants, entries);
    compareGroup('node', 'settings', a.nodes, b.nodes, entries);
    var summary = { added: 0, removed: 0, changed: 0 };
    entries.forEach(function (e) { summary[e.kind]++; });
    var rawChanged = normalizedXml(leftXml) !== normalizedXml(rightXml);
    var unmodeled = hasUnmodeled(leftXml, rightXml, entries, rawChanged);
    return {
        equal: !entries.length && !unmodeled, entries: entries, summary: summary,
        unmodeled: unmodeled,
        leftModel: left.model, rightModel: right.model,
        sections: SECTIONS
    };
}

/* Какие изменённые свойства можно вернуть к эталону по одному: скалярное
 * свойство сущности, которая есть с обеих сторон под тем же ключом, и
 * которое окно схемы умеет записывать (DcsPreview.propertyEdit). Ключ
 * свойства сравнения → свойство правки. Ограничения доступности (набор
 * флагов), типы, оформление, связи наборов (ключ «источник→приёмник» не
 * уникален), макеты, настройки и структура сюда не входят. */
var RESTORABLE = {
    set: { autoFill: 'autoFillFields', useQueryGroup: 'useQueryGroupIfPossible' },
    query: { query: 'query' },
    field: { title: 'title', presentation: 'presentationExpression' },
    calculated: { expression: 'expression', title: 'title', presentation: 'presentationExpression' },
    total: { expression: 'expression' },
    parameter: { title: 'title', expression: 'expression', value: 'value', restricted: 'useRestriction',
        availableAsField: 'availableAsField', denyIncomplete: 'denyIncompleteValues', use: 'use' }
};

/* План отката одного свойства: { id, prop, value, current } — записать в
 * сущность id значение эталона value; current — значение справа на момент
 * сравнения. null — у этого изменения отката нет (кнопки нет вовсе). */
function restorePlan(diff, item, change) {
    if (!diff || !item || !change || item.kind !== 'changed' || item.ambiguous) return null;
    var P = root.DcsPreview;
    if (!P || !P.propertyValue || !diff.leftModel || !diff.rightModel) return null;
    var prop = own(RESTORABLE, item.type) && own(RESTORABLE[item.type], change.key) ? RESTORABLE[item.type][change.key] : null;
    if (!prop || !item.beforeId || !item.entityId) return null;
    var value = P.propertyValue(diff.leftModel, item.beforeId, prop);
    var current = P.propertyValue(diff.rightModel, item.entityId, prop);
    if (value === null || current === null || value === current) return null;
    return { id: item.entityId, prop: prop, value: value, current: current };
}

/* Правка исходника, возвращающая свойство: { start, end, text } по модели
 * fresh (разбор текущего текста), { error } с причиной отказа, null — нечего
 * менять. */
function restoreEdit(diff, item, change, fresh) {
    var plan = restorePlan(diff, item, change);
    if (!plan) return null;
    var P = root.DcsPreview;
    var now = fresh ? P.propertyValue(fresh, plan.id, plan.prop) : null;
    if (now === null) return { error: 'Нельзя вернуть: сущность не найдена в текущей схеме' };
    if (now !== plan.current) return { error: 'Свойство изменилось после сравнения — обновите сравнение' };
    return P.propertyEdit(fresh, plan.id, plan.prop, plan.value);
}

root.DcsDiff = {
    compareXml: compareXml,
    restorePlan: restorePlan,
    restoreEdit: restoreEdit,
    _test: { collect: collect, stable: stable, propertyChanges: propertyChanges, normalizedXml: normalizedXml,
        changedLeafTags: changedLeafTags, hasUnmodeled: hasUnmodeled }
};
})(window);
