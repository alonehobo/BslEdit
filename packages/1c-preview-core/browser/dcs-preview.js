/* A data composition schema (Template.xml whose root is DataCompositionSchema)
 * drawn as the Designer's schema editor: vertical tabs for data sets, links,
 * calculated fields, resources, parameters, templates, nested schemas and
 * settings variants.
 *
 * A host that can edit the source passes options.onPropertyEdit for a small set
 * of properties — expressions, Russian titles, use restriction flags, parameter
 * flags and values of a primitive type (propertyEdit()). Each is a text edit of
 * the one element it touches, written the way every schema of the AT export
 * writes it; the rest of the schema stays read-only. The query text of a data
 * set is shown but never edited: rewriting a query from here is a whole-report
 * change no single element edit can be checked against.
 *
 * Source positions come from a small scanner over the raw XML rather than from
 * the DOM: elements are matched to the DOM in document order, which gives every
 * row its exact line. */
(function (root) {
'use strict';

var XU = root.XmlUtil;
var localName = XU.localName;
var namedChildren = XU.namedChildren;
var firstChild = XU.firstChild;
var textOf = XU.textOf;
var localizedFrom = XU.localizedFrom;
var terms = XU.terms;

function own(map, key) {
    return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : '';
}

// ----------------------------------------------------------------- terms

var SET_KINDS = {
    DataSetQuery: 'Запрос', DataSetObject: 'Объект', DataSetUnion: 'Объединение'
};

var COMPARISON = {
    Equal: 'Равно', NotEqual: 'Не равно', Less: 'Меньше', LessOrEqual: 'Меньше или равно',
    Greater: 'Больше', GreaterOrEqual: 'Больше или равно', InList: 'В списке', NotInList: 'Не в списке',
    InListByHierarchy: 'В группе из списка', NotInListByHierarchy: 'Не в группе из списка',
    InHierarchy: 'В группе', NotInHierarchy: 'Не в группе', Contains: 'Содержит',
    NotContains: 'Не содержит', BeginsWith: 'Начинается с', NotBeginsWith: 'Не начинается с',
    Like: 'Соответствует шаблону', NotLike: 'Не соответствует шаблону', Filled: 'Заполнено', NotFilled: 'Не заполнено'
};

var FILTER_GROUPS = { AndGroup: 'Группа И', OrGroup: 'Группа ИЛИ', NotGroup: 'Группа НЕ' };

var GROUP_TYPES = { Items: 'Без иерархии', Hierarchy: 'Иерархия', HierarchyOnly: 'Только иерархия' };

var PERIOD_ADDITION = {
    None: 'Без дополнения', Second: 'Секунда', Minute: 'Минута', Hour: 'Час', Day: 'День', Week: 'Неделя',
    TenDays: 'Декада', Month: 'Месяц', Quarter: 'Квартал', HalfYear: 'Полугодие', Year: 'Год'
};

var TEMPLATE_TYPES = {
    Header: 'Заголовок', Footer: 'Подвал', OverallHeader: 'Общий заголовок', OverallFooter: 'Общий подвал'
};

var TEMPLATE_KINDS = {
    template: 'Макет', groupTemplate: 'Макет группировки', groupHeaderTemplate: 'Макет заголовка группировки',
    fieldTemplate: 'Макет поля', totalFieldsTemplate: 'Макет полей итога'
};

var PARAMETER_USE = { Always: 'Всегда', Auto: 'Авто' };

/* Enumerations a settings value can hold: output, placement, totals. */
var VALUES = {
    Auto: 'Авто', Output: 'Выводить', DontOutput: 'Не выводить', None: 'Нет', Begin: 'Начало',
    End: 'Конец', BeginAndEnd: 'Начало и конец', Vertically: 'Вертикально', Horizontally: 'Горизонтально',
    Together: 'Вместе', Separately: 'Отдельно', SpecialColumn: 'Отдельная колонка',
    SeparatelyAndInTotalsOnly: 'Отдельно и только в итогах', Use: 'Использовать', DontUse: 'Не использовать',
    Wrap: 'Переносить', Cut: 'Обрезать', Clip: 'Обрезать', Left: 'Лево', Right: 'Право', Center: 'Центр',
    Top: 'Верх', Bottom: 'Низ', Full: 'Полное', Short: 'Краткое', Default: 'По умолчанию',
    Bold: 'Жирный', Normal: 'Обычный', Inaccessible: 'Недоступный', QuickAccess: 'Быстрый доступ'
};

var STANDARD_PERIODS = {
    Custom: 'Произвольный период', Today: 'Сегодня', Yesterday: 'Вчера', Tomorrow: 'Завтра',
    ThisWeek: 'Эта неделя', ThisTenDays: 'Эта декада', ThisMonth: 'Этот месяц', ThisQuarter: 'Этот квартал',
    ThisHalfYear: 'Это полугодие', ThisYear: 'Этот год', FromBeginningOfThisWeek: 'С начала этой недели',
    FromBeginningOfThisTenDays: 'С начала этой декады', FromBeginningOfThisMonth: 'С начала этого месяца',
    FromBeginningOfThisQuarter: 'С начала этого квартала', FromBeginningOfThisHalfYear: 'С начала этого полугодия',
    FromBeginningOfThisYear: 'С начала этого года', LastWeek: 'Прошлая неделя', LastTenDays: 'Прошлая декада',
    LastMonth: 'Прошлый месяц', LastQuarter: 'Прошлый квартал', LastHalfYear: 'Прошлое полугодие',
    LastYear: 'Прошлый год', NextDay: 'Следующий день', NextWeek: 'Следующая неделя',
    NextTenDays: 'Следующая декада', NextMonth: 'Следующий месяц', NextQuarter: 'Следующий квартал',
    NextHalfYear: 'Следующее полугодие', NextYear: 'Следующий год',
    TillEndOfThisYear: 'До конца этого года', LastWeekTillSameWeekDay: 'Прошлая неделя по такой же день',
    LastMonthTillSameDate: 'Прошлый месяц по такую же дату', Month: 'Месяц'
};

/* `rows` tells what the tab shows: the window reads, so a tab the schema
 * leaves empty is not drawn at all — the Designer keeps it only because
 * there one can fill it. */
var TABS = [
    { id: 'sets', title: 'Наборы данных', rows: function (m) { return m.sets; } },
    { id: 'links', title: 'Связи наборов данных', rows: function (m) { return m.links; } },
    { id: 'calculated', title: 'Вычисляемые поля', rows: function (m) { return m.calculated; } },
    { id: 'totals', title: 'Ресурсы', rows: function (m) { return m.totals; } },
    { id: 'parameters', title: 'Параметры', rows: function (m) { return m.parameters; } },
    { id: 'templates', title: 'Макеты', rows: function (m) { return m.templates; } },
    { id: 'nested', title: 'Вложенные схемы', rows: function (m) { return m.nested; } },
    { id: 'settings', title: 'Настройки', rows: function (m) { return m.variants; } }
];

/* The tabs with something on them, and always at least one. */
function filledTabs(model) {
    var shown = TABS.filter(function (t) { return (t.rows(model) || []).length > 0; });
    return shown.length ? shown : [TABS[0]];
}

// ------------------------------------------------------------- raw source

/* Every element of the raw XML in document order with its start offset and
 * the range of its content. Comments, CDATA and processing instructions are
 * skipped, so the order is the DOM's. */
function scanElements(xml) {
    var out = [];
    var stack = [];
    var re = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<![^>]*>|<(\/?)([^\s>\/!?]+)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
    var m;
    while ((m = re.exec(xml))) {
        if (!m[2]) continue;
        if (m[1]) {
            var open = stack.pop();
            if (open) { open.end = m.index; open.close = m.index + m[0].length; }
            continue;
        }
        var after = m.index + m[0].length;
        var rec = { start: m.index, contentStart: after, end: after, close: after, selfClosing: !!m[4], tag: m[2] };
        out.push(rec);
        if (!m[4]) stack.push(rec);
    }
    return out;
}

function lineIndex(xml) {
    var starts = [0];
    for (var i = 0; i < xml.length; i++) if (xml.charCodeAt(i) === 10) starts.push(i + 1);
    return function (offset) {
        var lo = 0, hi = starts.length - 1;
        while (lo < hi) {
            var mid = (lo + hi + 1) >> 1;
            if (starts[mid] <= offset) lo = mid; else hi = mid - 1;
        }
        return lo + 1;
    };
}

/* Pairs DOM elements with scanned records by pre-order position. */
function positions(doc, xml) {
    var recs = scanElements(xml);
    var lineOf = lineIndex(xml);
    var list = [];
    function walk(node) {
        list.push(node);
        var kids = node.children || [];
        for (var i = 0; i < kids.length; i++) walk(kids[i]);
    }
    if (doc && doc.documentElement) walk(doc.documentElement);
    var aligned = list.length === recs.length;
    var map = typeof Map === 'function' ? new Map() : null;
    for (var i = 0; aligned && map && i < list.length; i++) map.set(list[i], recs[i]);
    return {
        line: function (el) {
            var rec = map && el && map.get(el);
            return rec ? lineOf(rec.start) : 0;
        },
        range: function (el) {
            var rec = map && el && map.get(el);
            return rec ? { start: rec.contentStart, end: rec.end } : null;
        },
        rec: function (el) {
            return (map && el && map.get(el)) || null;
        }
    };
}

function decodeXml(s) {
    return String(s).replace(/&(lt|gt|quot|apos|amp|#(\d+)|#x([0-9a-fA-F]+));/g, function (all, name, dec, hex) {
        if (dec) return String.fromCharCode(parseInt(dec, 10));
        if (hex) return String.fromCharCode(parseInt(hex, 16));
        return { lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' }[name];
    });
}

function encodeXml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ------------------------------------------------------------------ values

function xsiType(el) {
    if (!el || typeof el.getAttribute !== 'function') return '';
    var t = el.getAttribute('xsi:type') || '';
    var i = t.indexOf(':');
    return i >= 0 ? t.slice(i + 1) : t;
}

function isNil(el) {
    return !!(el && typeof el.getAttribute === 'function' && el.getAttribute('xsi:nil') === 'true');
}

function isTrue(el) {
    return textOf(el) === 'true';
}

function dateText(raw) {
    var m = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)/.exec(String(raw || ''));
    if (!m) return String(raw || '');
    if (m[1] === '0001' && m[2] === '01' && m[3] === '01' && m[4] + m[5] + m[6] === '000000') return '';
    var date = m[3] + '.' + m[2] + '.' + m[1];
    return m[4] + m[5] + m[6] === '000000' ? date : date + ' ' + m[4] + ':' + m[5] + ':' + m[6];
}

function typePresentation(typeEl) {
    if (!typeEl) return '';
    var md = root.MetadataPreview;
    if (md && md.typePresentation) return md.typePresentation(typeEl);
    var parts = [];
    var kids = typeEl.children || [];
    for (var i = 0; i < kids.length; i++) {
        var tag = localName(kids[i]);
        if (tag === 'Type' || tag === 'TypeSet') parts.push(terms.typeName(textOf(kids[i])) || textOf(kids[i]));
    }
    return parts.join(', ');
}

/* A value as the Designer's grids show it. `titleOf` turns a field path into
 * the field's title. */
function valueText(el, titleOf) {
    if (!el || isNil(el)) return '';
    var type = xsiType(el);
    var text = textOf(el);
    switch (type) {
        case 'Field': return titleOf ? titleOf(text) : text;
        case 'Parameter': return '&' + text;
        case 'boolean': return text === 'true' ? 'Да' : 'Нет';
        case 'dateTime': return dateText(text);
        case 'decimal': return text.replace('.', ',');
        case 'string': return text;
        case 'LocalStringType': return localizedFrom(el);
        case 'DesignTimeValue': return terms.metadataRef(text) || text;
        case 'StandardPeriod': {
            var variant = textOf(firstChild(el, 'variant'));
            var shown = own(STANDARD_PERIODS, variant) || variant;
            if (variant === 'Custom') {
                var from = dateText(textOf(firstChild(el, 'startDate')));
                var to = dateText(textOf(firstChild(el, 'endDate')));
                if (from || to) shown = from + ' – ' + to;
            }
            return shown;
        }
        case 'StandardBeginningDate': {
            var v = textOf(firstChild(el, 'variant'));
            return v === 'Custom' ? dateText(textOf(firstChild(el, 'date'))) : terms.identWords(v);
        }
        case 'Type': return terms.typeName(text) || text;
        case 'ValueListType': {
            var items = [];
            var list = namedChildren(el, 'item');
            for (var i = 0; i < list.length; i++) items.push(valueText(firstChild(list[i], 'value'), titleOf));
            return items.join('; ');
        }
    }
    if (el.children && el.children.length && !text) return '';
    if (/^(style|web|win|sys):/.test(text)) return text.replace(/^[a-z]+:/, '');
    if (!/\s/.test(text) && own(VALUES, text)) return VALUES[text];
    if (!text && typeof el.getAttribute === 'function') {
        var ref = el.getAttribute('ref');
        if (ref) return ref.replace(/^[a-z]+:/, '');
        var face = el.getAttribute('faceName');
        if (face) return face + (el.getAttribute('height') ? ', ' + el.getAttribute('height') : '');
    }
    return text;
}

// ------------------------------------------------------------------- parse

function detect(xml) {
    if (!xml || typeof xml !== 'string') return false;
    return /^\s*(?:\uFEFF)?(?:<\?xml[^>]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*<(?:\w+:)?DataCompositionSchema[\s>]/.test(xml);
}

function restriction(el) {
    return {
        field: isTrue(firstChild(el, 'field')), condition: isTrue(firstChild(el, 'condition')),
        group: isTrue(firstChild(el, 'group')), order: isTrue(firstChild(el, 'order'))
    };
}

/* The field's "Доступные значения" cell: presentations, else the values. */
function availableText(el) {
    return namedChildren(el, 'availableValue').map(function (a) {
        return localizedFrom(firstChild(a, 'presentation')) || valueText(firstChild(a, 'value'), null);
    }).join('; ');
}

/* "Оформление" and "Параметры редактирования": the names of the parameters
 * set, as the Designer lists them. */
function parameterNames(el) {
    if (!el) return '';
    return namedChildren(el, 'item').filter(function (it) {
        return textOf(firstChild(it, 'use')) !== 'false';
    }).map(function (it) {
        var p = textOf(firstChild(it, 'parameter'));
        return terms.identWords(p) || p;
    }).join(', ');
}

function orderText(el) {
    return namedChildren(el, 'orderExpression').map(function (o) {
        return textOf(firstChild(o, 'expression')) + (textOf(firstChild(o, 'orderType')) === 'Desc' ? ' Убыв' : '');
    }).join(', ');
}

function roleText(el) {
    if (!el) return '';
    var parts = [];
    var kids = el.children || [];
    for (var i = 0; i < kids.length; i++) {
        var tag = localName(kids[i]);
        var v = textOf(kids[i]);
        if (tag === 'dimension' && v === 'true') parts.push('Измерение');
        else if (tag === 'periodNumber') parts.push('Период ' + v);
        else if (tag === 'periodType') parts.push(v === 'Additional' ? 'Дополнительный' : 'Основной');
        else if (tag === 'account' && v === 'true') parts.push('Счет');
        else if (tag === 'accountTypeExpression') parts.push('Выражение вида счета: ' + v);
        else if (tag === 'balance' && v === 'true') parts.push('Остаток');
        else if (tag === 'balanceGroup') parts.push('Группа: ' + v);
        else if (tag === 'balanceType') parts.push(v === 'ClosingBalance' ? 'Конечный остаток' : 'Начальный остаток');
        else if (tag === 'accountField') parts.push('Счет: ' + v);
        else if (tag === 'parentDimension') parts.push('Родитель: ' + v);
        else if (tag === 'ignoreNullValues' && v === 'true') parts.push('Игнорировать NULL');
        else if (tag === 'required' && v === 'true') parts.push('Обязательное');
    }
    return parts.join(', ');
}

function Parser(xml, doc) {
    this.pos = positions(doc, xml);
    this.titles = {};
    this.xml = xml;
    /* The elements a host may edit, by the id of their record. */
    this.owners = {};
}

Parser.prototype.owner = function (id, kind, el, auto) {
    this.owners[id] = { kind: kind, el: el, auto: auto || '' };
};

/* A parameter value the window can edit: one value of a single primitive
 * type, not a list. Anything else stays read-only. */
var SIMPLE_VALUE_TYPES = { 'xs:boolean': 'boolean', 'xs:string': 'string', 'xs:decimal': 'decimal', 'xs:dateTime': 'dateTime' };

function simpleValue(el) {
    var vt = firstChild(el, 'valueType');
    if (!vt || firstChild(vt, 'TypeSet') || firstChild(vt, 'TypeId') || isTrue(firstChild(el, 'valueListAllowed'))) return null;
    var types = namedChildren(vt, 'Type');
    var kind = types.length === 1 ? own(SIMPLE_VALUE_TYPES, textOf(types[0])) : '';
    var values = namedChildren(el, 'value');
    if (!kind || values.length > 1) return null;
    var v = values[0];
    var raw = !v || isNil(v) || xsiType(v) !== kind ? '' : textOf(v);
    var fractions = textOf(firstChild(firstChild(vt, 'DateQualifiers'), 'DateFractions'));
    var text = kind === 'dateTime' ? dateText(raw) : kind === 'decimal' ? raw.replace('.', ',')
        : kind === 'boolean' ? (raw === 'true' ? 'Да' : raw === 'false' ? 'Нет' : '') : raw;
    return { kind: kind, text: text, dateOnly: fractions === 'Date' };
}

Parser.prototype.set = function (el, path) {
    var type = xsiType(el) || 'DataSetQuery';
    var name = textOf(firstChild(el, 'name'));
    var id = 'set:' + path;
    var set = {
        id: id, kind: type, kindTitle: own(SET_KINDS, type) || type, name: name,
        source: textOf(firstChild(el, 'dataSource')), objectName: textOf(firstChild(el, 'objectName')),
        autoFill: textOf(firstChild(el, 'autoFillFields')) !== 'false',
        useQueryGroup: textOf(firstChild(el, 'useQueryGroupIfPossible')) !== 'false',
        line: this.pos.line(el), fields: [], items: [], query: null
    };
    this.owner(id, 'set', el);
    var q = firstChild(el, 'query');
    if (q) {
        var range = this.pos.range(q);
        var raw = range ? this.xml.slice(range.start, range.end) : '';
        set.query = {
            text: range ? decodeXml(raw).replace(/\r\n/g, '\n') : textOf(q),
            line: this.pos.line(q)
        };
    }
    var fields = namedChildren(el, 'field');
    for (var i = 0; i < fields.length; i++) set.fields.push(this.field(fields[i], id));
    var items = namedChildren(el, 'item');
    for (var k = 0; k < items.length; k++) set.items.push(this.set(items[k], path + '/' + textOf(firstChild(items[k], 'name'))));
    return set;
};

Parser.prototype.field = function (el, setId) {
    var type = xsiType(el);
    var path = textOf(firstChild(el, 'dataPath'));
    var title = localizedFrom(firstChild(el, 'title'));
    if (path && title && !own(this.titles, path)) this.titles[path] = title;
    this.owner('field:' + setId.slice(4) + ':' + path, 'field', el, path);
    return {
        id: 'field:' + setId.slice(4) + ':' + path,
        kind: type === 'DataSetFieldFolder' ? 'folder' : type === 'DataSetFieldNestedDataSet' ? 'nested' : 'field',
        dataPath: path, field: textOf(firstChild(el, 'field')), title: title,
        restrict: restriction(firstChild(el, 'useRestriction')),
        attrRestrict: restriction(firstChild(el, 'attributeUseRestriction')),
        role: roleText(firstChild(el, 'role')),
        type: typePresentation(firstChild(el, 'valueType')),
        presentation: textOf(firstChild(el, 'presentationExpression')),
        order: orderText(el), available: availableText(el),
        appearance: parameterNames(firstChild(el, 'appearance')),
        editParameters: parameterNames(firstChild(el, 'inputParameters')),
        hierarchySet: textOf(firstChild(el, 'inHierarchyDataSet')),
        hierarchyParameter: textOf(firstChild(el, 'inHierarchyDataSetParameter')),
        line: this.pos.line(el)
    };
};

Parser.prototype.titleOf = function () {
    var titles = this.titles;
    return function (path) {
        path = String(path || '');
        if (own(titles, path)) return titles[path];
        /* Организация.ИНН -> the owner's title and the attribute. */
        var dot = path.lastIndexOf('.');
        if (dot > 0 && own(titles, path.slice(0, dot))) return titles[path.slice(0, dot)] + '.' + path.slice(dot + 1);
        if (path === 'SystemFields.SerialNumber') return 'Номер по порядку';
        if (path === 'SystemFields.GroupSerialNumber') return 'Номер по порядку в группировке';
        if (path.indexOf('ПараметрыДанных.') === 0 || path.indexOf('DataParameters.') === 0)
            return 'Параметры данных.' + path.slice(path.indexOf('.') + 1);
        /* A field without its own title is titled from its name, as the
         * platform does: ПериодМесяц -> Период месяц. */
        return terms.identWords(path) || path;
    };
};

Parser.prototype.settingsItems = function (list, kind, depth, out) {
    var titleOf = this.titleOf();
    var items = namedChildren(list, 'item');
    for (var i = 0; i < items.length; i++) {
        var it = items[i];
        var type = xsiType(it);
        var use = textOf(firstChild(it, 'use')) !== 'false';
        var row = { depth: depth, use: use, line: this.pos.line(it) };
        if (kind === 'selection') {
            if (type === 'SelectedItemAuto') row.text = 'Авто (поля)';
            else if (type === 'SelectedItemFolder') {
                row.text = localizedFrom(firstChild(it, 'lwsTitle')) || 'Группа';
                row.folder = true;
                var pl = textOf(firstChild(it, 'placement'));
                row.placement = own(VALUES, pl) || pl;
            } else {
                var f = textOf(firstChild(it, 'field'));
                row.text = titleOf(f);
                row.path = f;
                row.title = localizedFrom(firstChild(it, 'lwsTitle'));
            }
            out.push(row);
            if (type === 'SelectedItemFolder') this.settingsItems(it, kind, depth + 1, out);
        } else if (kind === 'filter') {
            if (type === 'FilterItemGroup') {
                row.text = own(FILTER_GROUPS, textOf(firstChild(it, 'groupType'))) || 'Группа';
                row.folder = true;
                out.push(row);
                this.settingsItems(it, kind, depth + 1, out);
                continue;
            }
            var left = firstChild(it, 'left');
            row.text = valueText(left, titleOf) || textOf(left);
            row.path = textOf(left);
            var cmp = textOf(firstChild(it, 'comparisonType'));
            row.comparison = own(COMPARISON, cmp) || cmp;
            row.value = valueText(firstChild(it, 'right'), titleOf);
            row.presentation = localizedFrom(firstChild(it, 'presentation'));
            out.push(row);
        } else if (kind === 'order') {
            if (type === 'OrderItemAuto') row.text = 'Авто';
            else {
                var of = textOf(firstChild(it, 'field'));
                row.text = titleOf(of);
                row.path = of;
                row.direction = textOf(firstChild(it, 'orderType')) === 'Desc' ? 'По убыванию' : 'По возрастанию';
            }
            out.push(row);
        } else if (kind === 'groupFields') {
            if (type === 'GroupItemAuto') row.text = 'Авто';
            else {
                var gf = textOf(firstChild(it, 'field'));
                row.text = titleOf(gf);
                row.path = gf;
                var gt = textOf(firstChild(it, 'groupType'));
                row.groupType = own(GROUP_TYPES, gt) || gt;
                var pa = textOf(firstChild(it, 'periodAdditionType'));
                row.period = own(PERIOD_ADDITION, pa) || '';
            }
            out.push(row);
        } else if (kind === 'parameters') {
            var pname = textOf(firstChild(it, 'parameter'));
            row.text = terms.identWords(pname) || pname;
            row.path = pname;
            row.value = valueText(firstChild(it, 'value'), titleOf);
            out.push(row);
            this.settingsItems(it, kind, depth + 1, out);
        } else if (kind === 'appearance') {
            var fields = [];
            var sel = namedChildren(firstChild(it, 'selection'), 'item');
            for (var s = 0; s < sel.length; s++) fields.push(titleOf(textOf(firstChild(sel[s], 'field'))));
            var conds = [];
            this.settingsItems(firstChild(it, 'filter'), 'filter', 0, conds);
            var looks = [];
            this.settingsItems(firstChild(it, 'appearance'), 'parameters', 0, looks);
            row.text = looks.filter(function (x) { return x.use && x.depth === 0; }).map(function (x) {
                return x.text + (x.value ? ': ' + x.value : '');
            }).join('; ');
            row.condition = filterSummary(conds);
            row.fields = fields.join(', ');
            row.presentation = localizedFrom(firstChild(it, 'presentation'));
            out.push(row);
        } else if (kind === 'userFields') {
            var dp = textOf(firstChild(it, 'dataPath'));
            row.text = localizedFrom(firstChild(it, 'lwsTitle')) || dp;
            row.path = dp;
            row.value = type === 'UserFieldCase' ? 'Выбор' : textOf(firstChild(it, 'detailExpression'));
            out.push(row);
        }
    }
    return out;
};

function filterSummary(rows) {
    var parts = [];
    for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
        if (!r.use || r.folder) continue;
        parts.push(r.text + ' ' + (r.comparison || '').toLowerCase() + (r.value ? ' ' + r.value : ''));
    }
    return parts.join('; ');
}

var NODE_TITLES = {
    StructureItemTable: 'Таблица', StructureItemChart: 'Диаграмма', StructureItemNestedObject: 'Вложенный объект'
};

Parser.prototype.node = function (el, kind, id, title) {
    var node = {
        id: id, kind: kind, title: title, name: textOf(firstChild(el, 'name')),
        use: textOf(firstChild(el, 'use')) !== 'false', line: this.pos.line(el), children: [],
        groupFields: this.settingsItems(firstChild(el, 'groupItems'), 'groupFields', 0, []),
        selection: this.settingsItems(firstChild(el, 'selection'), 'selection', 0, []),
        filter: this.settingsItems(firstChild(el, 'filter'), 'filter', 0, []),
        order: this.settingsItems(firstChild(el, 'order'), 'order', 0, []),
        appearance: this.settingsItems(firstChild(el, 'conditionalAppearance'), 'appearance', 0, []),
        outputParameters: this.settingsItems(firstChild(el, 'outputParameters'), 'parameters', 0, []),
        dataParameters: this.settingsItems(firstChild(el, 'dataParameters'), 'parameters', 0, []),
        userFields: this.settingsItems(firstChild(el, 'userFields'), 'userFields', 0, [])
    };
    if (kind === 'group') {
        var fields = node.groupFields.map(function (f) { return f.text; }).join(', ');
        node.title = fields || 'Детальные записи';
        node.detail = !fields;
    }
    if (node.name && kind !== 'root') node.title += ' (' + node.name + ')';
    var kids = el.children || [];
    var n = 0;
    var axes = { row: 'Строки', column: 'Колонки', point: 'Точки', series: 'Серии' };
    var axisNodes = {};
    for (var i = 0; i < kids.length; i++) {
        var tag = localName(kids[i]);
        if (tag === 'item') {
            var type = xsiType(kids[i]);
            var childKind = type === 'StructureItemTable' ? 'table' : type === 'StructureItemChart' ? 'chart'
                : type === 'StructureItemNestedObject' ? 'nestedObject' : 'group';
            node.children.push(this.node(kids[i], childKind, id + '.' + (n++), own(NODE_TITLES, type)));
        } else if (own(axes, tag)) {
            var axis = axisNodes[tag];
            if (!axis) {
                axis = axisNodes[tag] = {
                    id: id + '.' + tag, kind: 'axis', title: axes[tag], use: true, line: this.pos.line(kids[i]),
                    children: [], groupFields: [], selection: [], filter: [], order: [], appearance: [],
                    outputParameters: [], dataParameters: [], userFields: []
                };
            }
            axis.children.push(this.node(kids[i], 'group', axis.id + '.' + axis.children.length, ''));
        }
    }
    /* The Designer lists rows before columns whatever order the file has. */
    ['row', 'column', 'point', 'series'].forEach(function (tag) {
        if (axisNodes[tag]) node.children.push(axisNodes[tag]);
    });
    return node;
};

Parser.prototype.schema = function (top, prefix) {
    var self = this;
    if (!prefix) this.owner('schema', 'schema', top);
    var model = {
        sources: [], sets: [], links: [], calculated: [], totals: [], parameters: [],
        templates: [], nested: [], variants: []
    };
    var sources = namedChildren(top, 'dataSource');
    for (var s = 0; s < sources.length; s++) {
        model.sources.push({ name: textOf(firstChild(sources[s], 'name')), type: textOf(firstChild(sources[s], 'dataSourceType')) });
    }
    var sets = namedChildren(top, 'dataSet');
    for (var i = 0; i < sets.length; i++) model.sets.push(this.set(sets[i], prefix + textOf(firstChild(sets[i], 'name'))));
    namedChildren(top, 'calculatedField').forEach(function (el, k) {
        var path = textOf(firstChild(el, 'dataPath'));
        var title = localizedFrom(firstChild(el, 'title'));
        if (path && title && !own(self.titles, path)) self.titles[path] = title;
        self.owner('calc:' + prefix + k, 'calc', el, path);
        model.calculated.push({
            id: 'calc:' + prefix + k, dataPath: path, expression: textOf(firstChild(el, 'expression')), title: title,
            restrict: restriction(firstChild(el, 'useRestriction')), type: typePresentation(firstChild(el, 'valueType')),
            presentation: textOf(firstChild(el, 'presentationExpression')), order: orderText(el),
            available: availableText(el), appearance: parameterNames(firstChild(el, 'appearance')),
            editParameters: parameterNames(firstChild(el, 'inputParameters')), line: self.pos.line(el)
        });
    });
    var titleOf = this.titleOf();
    namedChildren(top, 'dataSetLink').forEach(function (el, k) {
        self.owner('link:' + prefix + k, 'link', el);
        model.links.push({
            id: 'link:' + prefix + k, source: textOf(firstChild(el, 'sourceDataSet')),
            dest: textOf(firstChild(el, 'destinationDataSet')),
            sourceExpr: textOf(firstChild(el, 'sourceExpression')), destExpr: textOf(firstChild(el, 'destinationExpression')),
            parameter: textOf(firstChild(el, 'parameter')), parameterList: isTrue(firstChild(el, 'parameterListAllowed')),
            condition: textOf(firstChild(el, 'linkConditionExpression')), start: textOf(firstChild(el, 'startExpression')),
            required: isTrue(firstChild(el, 'required')), line: self.pos.line(el)
        });
    });
    namedChildren(top, 'totalField').forEach(function (el, k) {
        var path = textOf(firstChild(el, 'dataPath'));
        self.owner('total:' + prefix + k, 'total', el);
        model.totals.push({
            id: 'total:' + prefix + k, dataPath: path, title: titleOf(path), expression: textOf(firstChild(el, 'expression')),
            groups: namedChildren(el, 'group').map(function (g) {
                var t = textOf(g);
                return t === 'ОбщийИтог' || t === 'Overall' ? 'Общий итог' : titleOf(t);
            }),
            line: self.pos.line(el)
        });
    });
    namedChildren(top, 'parameter').forEach(function (el) {
        var name = textOf(firstChild(el, 'name'));
        self.owner('param:' + prefix + name, 'param', el, name);
        model.parameters.push({
            id: 'param:' + prefix + name, name: name, title: localizedFrom(firstChild(el, 'title')),
            simpleValue: simpleValue(el),
            type: typePresentation(firstChild(el, 'valueType')), valueList: isTrue(firstChild(el, 'valueListAllowed')),
            value: valueText(firstChild(el, 'value'), titleOf), expression: textOf(firstChild(el, 'expression')),
            restricted: textOf(firstChild(el, 'useRestriction')) === 'true',
            availableAsField: textOf(firstChild(el, 'availableAsField')) !== 'false',
            use: own(PARAMETER_USE, textOf(firstChild(el, 'use'))) || 'Авто',
            denyIncomplete: isTrue(firstChild(el, 'denyIncompleteValues')), available: availableText(el),
            functionalOption: textOf(firstChild(el, 'functionalOptionsParameter')),
            editParameters: parameterNames(firstChild(el, 'inputParameters')), line: self.pos.line(el)
        });
    });
    var kids = top.children || [];
    var t = 0;
    for (var c = 0; c < kids.length; c++) {
        var tag = localName(kids[c]);
        if (!own(TEMPLATE_KINDS, tag)) continue;
        var el = kids[c];
        var group = textOf(firstChild(el, 'groupName')) || textOf(firstChild(el, 'groupName1'));
        var field = textOf(firstChild(el, 'groupField')) || textOf(firstChild(el, 'groupField1')) || textOf(firstChild(el, 'field'));
        var ttype = textOf(firstChild(el, 'templateType')) || textOf(firstChild(el, 'templateType1'));
        var inner = firstChild(el, 'template');
        model.templates.push({
            id: 'tpl:' + prefix + (t++), kind: TEMPLATE_KINDS[tag],
            name: tag === 'template' ? textOf(firstChild(el, 'name')) : textOf(inner),
            target: group || (field ? titleOf(field) : ''), templateType: own(TEMPLATE_TYPES, ttype) || ttype,
            parameters: tag === 'template' ? namedChildren(el, 'parameter').map(function (p) {
                return { name: textOf(firstChild(p, 'name')), expression: textOf(firstChild(p, 'expression')) };
            }) : [],
            area: tag === 'template' ? parseArea(inner) : null,
            line: self.pos.line(el)
        });
    }
    /* The Designer lists a template once: a binding (group, field, totals)
     * with the area it outputs, or an area no binding uses. */
    var defs = {};
    var used = {};
    model.templates.forEach(function (tpl) {
        if (tpl.kind === 'Макет') { if (!own(defs, tpl.name)) defs[tpl.name] = tpl; } else used[tpl.name] = true;
    });
    model.templates = model.templates.filter(function (tpl) {
        return tpl.kind !== 'Макет' || !own(used, tpl.name);
    });
    model.templates.forEach(function (tpl) {
        tpl.title = tpl.kind === 'Макет' ? tpl.kind : bindingText(tpl);
        if (tpl.kind !== 'Макет' && own(defs, tpl.name)) {
            tpl.parameters = defs[tpl.name].parameters;
            tpl.area = defs[tpl.name].area;
        }
    });
    namedChildren(top, 'nestedSchema').forEach(function (el) {
        var name = textOf(firstChild(el, 'name'));
        var schema = firstChild(el, 'schema');
        model.nested.push({
            id: 'nested:' + prefix + name, name: name, title: localizedFrom(firstChild(el, 'title')),
            sets: schema ? namedChildren(schema, 'dataSet').length : 0,
            setNames: schema ? namedChildren(schema, 'dataSet').map(function (d) { return textOf(firstChild(d, 'name')); }) : [],
            settings: !!firstChild(el, 'settings'),
            line: self.pos.line(el),
            schema: schema ? self.schema(schema, prefix + name + '/') : null
        });
    });
    namedChildren(top, 'settingsVariant').forEach(function (el, k) {
        var name = textOf(firstChild(el, 'name'));
        var settings = firstChild(el, 'settings');
        var variant = {
            id: 'variant:' + prefix + k, name: name, presentation: localizedFrom(firstChild(el, 'presentation')),
            line: self.pos.line(el)
        };
        variant.root = settings ? self.node(settings, 'root', variant.id + '/s', 'Отчет') : null;
        model.variants.push(variant);
    });
    return model;
};

/* --------------------------------------------------------------- areas

 * An area template (dcsat:AreaTemplate) is a list of table rows of cells.
 * A cell holds one field — a parameter of the area or a literal string — and
 * an appearance. The schema stores no grid: the Designer lays every area of
 * the template out into one spreadsheet and computes column widths and row
 * heights from the appearances, so the address it shows («R2C1») exists only
 * in that layout. The window draws each area on its own, with the widths the
 * appearance does state. */

var V_ALIGN = { Top: 'top', Center: 'middle', Bottom: 'bottom' };
var H_ALIGN = { Left: 'left', Center: 'center', Right: 'right' };

/* Widths and indents of an area count characters of the standard font
 * (Arial 8: 7 px at 96 dpi), as spreadsheet columns do. */
var AREA_CHAR_PX = 7;

function appearanceMap(el) {
    var out = {};
    var app = firstChild(el, 'appearance');
    if (!app) return out;
    namedChildren(app, 'item').forEach(function (it) {
        var name = textOf(firstChild(it, 'parameter'));
        if (!name) return;
        var v = firstChild(it, 'value');
        var ref = v && typeof v.getAttribute === 'function' ? (v.getAttribute('ref') || '') : '';
        out[name] = textOf(v) || ref;
    });
    return out;
}

function areaNumber(text) {
    var n = parseFloat(text);
    return isFinite(n) ? n : 0;
}

/* «style:ПравоПросмотраФон» -> «ПравоПросмотраФон»: the window cannot resolve
 * a colour or a picture of the configuration, so it only names it. */
function areaRefName(text) {
    var t = String(text || '');
    var i = t.indexOf(':');
    return i >= 0 ? t.slice(i + 1) : t;
}

function parseAreaCell(cell) {
    var app = appearanceMap(cell);
    var item = firstChild(cell, 'item');
    var value = item ? firstChild(item, 'value') : null;
    var type = value ? xsiType(value) : '';
    var own2 = function (k) { return own(app, k); };
    var notes = [];
    if (own2('Картинка')) notes.push('Картинка: ' + areaRefName(own2('Картинка')));
    if (own2('ЦветФона')) notes.push('Цвет фона: ' + areaRefName(own2('ЦветФона')));
    if (own2('ЦветТекста')) notes.push('Цвет текста: ' + areaRefName(own2('ЦветТекста')));
    var format = own(appearanceMap(item), 'Формат') || own2('Формат');
    if (format) notes.push('Формат: ' + format);
    if (own2('Расшифровка')) notes.push('Расшифровка: ' + own2('Расшифровка'));
    return {
        kind: type === 'Parameter' ? 'param' : (type ? 'text' : ''),
        text: type === 'Parameter' ? textOf(value) : localizedFrom(value),
        width: areaNumber(own2('МаксимальнаяШирина') || own2('МинимальнаяШирина')),
        indent: areaNumber(own2('Отступ')),
        rotated: areaNumber(own2('ОриентацияТекста')) === 90,
        wrap: own2('Размещение') === 'Wrap',
        valign: own(V_ALIGN, own2('ВертикальноеПоложение')),
        halign: own(H_ALIGN, own2('ГоризонтальноеПоложение')),
        picture: areaRefName(own2('Картинка')),
        note: notes.join('\n')
    };
}

function parseArea(el) {
    if (!el) return null;
    var rows = namedChildren(el, 'item').filter(function (it) {
        return xsiType(it) === 'TableRow';
    }).map(function (it) {
        return { cells: namedChildren(it, 'tableCell').map(parseAreaCell) };
    });
    return rows.length ? { rows: rows } : null;
}

function bindingText(b) {
    return b.kind + (b.target ? ' «' + b.target + '»' : '') + (b.templateType ? ', ' + b.templateType.toLowerCase() : '');
}

function parse(xml) {
    var doc;
    var src = String(xml || '').replace(/^\uFEFF/, '');
    try {
        doc = new DOMParser().parseFromString(src, 'application/xml');
    } catch (e) {
        return { error: 'Не удалось разобрать XML: ' + e.message };
    }
    var top = doc && doc.documentElement;
    if (!top || localName(top) !== 'DataCompositionSchema') return { error: 'Это не схема компоновки данных.' };
    var bad = doc.querySelector && doc.querySelector('parsererror');
    if (bad) return { error: 'Не удалось разобрать XML: ' + textOf(bad) };
    var parser = new Parser(src, doc);
    var model = parser.schema(top, '');
    model.titles = parser.titles;
    /* Offsets were taken without the BOM; a host edits the text with it. */
    model.bom = String(xml || '').charAt(0) === '\uFEFF' ? 1 : 0;
    /* What property edits need, kept out of the model's enumerable data. */
    Object.defineProperty(model, 'source', {
        value: { owners: parser.owners, pos: parser.pos, xml: src, eol: /\r\n/.test(src) ? '\r\n' : '\n' },
        enumerable: false
    });
    return { model: model };
}

// ---------------------------------------------------------- property edits

/* The child order of every element the window edits, as all 1338 schemas of
 * the AT export write it (none contradicts it). A new child goes right after
 * the last present child that precedes it. */
var CHILD_ORDER = {
    schema: ['dataSource', 'dataSet', 'dataSetLink', 'calculatedField', 'totalField', 'parameter', 'template', 'fieldTemplate',
        'groupTemplate', 'groupHeaderTemplate', 'nestedSchema', 'totalFieldsTemplate', 'settingsVariant'],
    set: ['name', 'field', 'dataSource', 'query', 'objectName', 'item', 'autoFillFields', 'useQueryGroupIfPossible'],
    field: ['dataPath', 'field', 'title', 'useRestriction', 'attributeUseRestriction', 'role', 'presentationExpression',
        'orderExpression', 'inHierarchyDataSet', 'inHierarchyDataSetParameter', 'valueType', 'appearance', 'availableValue',
        'inputParameters'],
    calc: ['dataPath', 'expression', 'title', 'useRestriction', 'presentationExpression', 'orderExpression', 'appearance',
        'availableValue', 'valueType', 'inputParameters'],
    total: ['dataPath', 'expression', 'group'],
    param: ['name', 'title', 'valueType', 'value', 'useRestriction', 'expression', 'availableValue', 'valueListAllowed',
        'availableAsField', 'functionalOptionsParameter', 'inputParameters', 'denyIncompleteValues', 'use'],
    link: ['sourceDataSet', 'destinationDataSet', 'sourceExpression', 'destinationExpression', 'parameter',
        'parameterListAllowed', 'startExpression', 'linkConditionExpression', 'required'],
    restriction: ['field', 'condition', 'group', 'order']
};

var RESTRICTIONS = { restrict: 'useRestriction', attrRestrict: 'attributeUseRestriction' };

/* How each editable property is written:
 * text      — the element's text, the element kept even when empty;
 * optional  — the same, an empty text removes the element;
 * title     — the Russian title, no element while the title is automatic;
 * flags     — a use restriction flag (`restrict.group`), written only when set;
 * bool:D    — true/false, the element absent while it equals D (no D: always written);
 * enum:D    — a word, absent while it equals D;
 * value     — a parameter value of a single primitive type.
 * The defaults are the values no schema of the AT export writes. */
var PROPERTIES = {
    set: { autoFillFields: 'bool:true', useQueryGroupIfPossible: 'bool:true', query: 'text' },
    field: { title: 'title', presentationExpression: 'optional', restrict: 'flags', attrRestrict: 'flags' },
    calc: { expression: 'text', title: 'title', presentationExpression: 'optional', restrict: 'flags' },
    total: { expression: 'text' },
    param: {
        title: 'title', expression: 'optional', value: 'value', useRestriction: 'bool:', availableAsField: 'bool:true',
        denyIncompleteValues: 'bool:false', use: 'enum:Auto'
    },
    link: { sourceExpression: 'text', destinationExpression: 'text', startExpression: 'optional', linkConditionExpression: 'optional' }
};

var ENUMS = { use: ['Auto', 'Always'] };

function propertySpec(model, id, prop) {
    var src = model && model.source;
    var owner = src && own(src.owners, id);
    if (!owner) return null;
    prop = String(prop || '');
    var dot = prop.indexOf('.');
    var base = dot > 0 ? prop.slice(0, dot) : prop;
    var how = own(PROPERTIES[owner.kind] || {}, base);
    if (!how) return null;
    var flag = dot > 0 ? prop.slice(dot + 1) : '';
    if ((how === 'flags') !== (CHILD_ORDER.restriction.indexOf(flag) >= 0)) return null;
    var colon = how.indexOf(':');
    return {
        src: src, owner: owner, base: base, flag: flag,
        how: colon > 0 ? how.slice(0, colon) : how, def: colon > 0 ? how.slice(colon + 1) : ''
    };
}

/* The exact text of an element, line breaks as \n. */
function exactText(src, el) {
    var rec = el && src.pos.rec(el);
    if (!rec) return textOf(el);
    return decodeXml(src.xml.slice(rec.contentStart, rec.end)).replace(/\r\n/g, '\n');
}

function ruItem(title) {
    var items = namedChildren(title, 'item');
    for (var i = 0; i < items.length; i++) if (textOf(firstChild(items[i], 'lang')) === 'ru') return items[i];
    return null;
}

/* The titles the platform would show by itself: writing one of them is the
 * same as writing none. */
function automaticTitle(owner, text) {
    var name = owner.auto;
    var last = lastName(name);
    return !text || text === name || text === last || text === terms.identWords(last) || text === terms.identWords(name);
}

/* The current value of an editable property: a string, or a boolean for a
 * flag. null when the property cannot be edited. */
function propertyValue(model, id, prop) {
    var s = propertySpec(model, id, prop);
    if (!s) return null;
    var el = s.owner.el;
    var c = firstChild(el, s.base);
    switch (s.how) {
        case 'text': case 'optional': return c ? exactText(s.src, c) : '';
        case 'title': {
            var item = ruItem(firstChild(el, 'title'));
            return item ? exactText(s.src, firstChild(item, 'content')) : '';
        }
        case 'flags': return isTrue(firstChild(firstChild(el, RESTRICTIONS[s.base]), s.flag));
        case 'bool': return (c ? textOf(c) : s.def) === 'true';
        case 'enum': return c ? textOf(c) : s.def;
        case 'value': {
            var sv = simpleValue(el);
            return sv ? sv.text : null;
        }
    }
    return null;
}

function indentBefore(xml, at) {
    var i = at;
    while (i > 0 && (xml.charAt(i - 1) === ' ' || xml.charAt(i - 1) === '\t')) i--;
    return xml.slice(i, at);
}

/* The start of the line break and indent before `at`, so removing an element
 * takes its line with it. */
function lineStart(xml, at) {
    var i = at - indentBefore(xml, at).length;
    if (xml.charAt(i - 1) !== '\n') return at;
    i--;
    if (xml.charAt(i - 1) === '\r') i--;
    return i;
}

function encodeText(src, rec, text) {
    var raw = rec ? src.xml.slice(rec.contentStart, rec.end) : '';
    var eol = /\n/.test(raw) ? (/\r\n/.test(raw) ? '\r\n' : '\n') : src.eol;
    return encodeXml(text).replace(/\n/g, eol);
}

/* Lines of [depth, text] joined at `indent`, the first one unindented. */
function fragment(lines, indent, eol) {
    return lines.map(function (l, i) {
        return (i ? eol + indent : '') + new Array(l[0] + 1).join('\t') + l[1];
    }).join('');
}

function textOp(src, el, text) {
    var rec = src.pos.rec(el);
    if (!rec) return null;
    var body = encodeText(src, rec, text);
    var open = src.xml.slice(rec.start, rec.contentStart);
    if (!body) return rec.selfClosing ? null : { start: rec.start, end: rec.close, text: open.replace(/>$/, '/>') };
    if (rec.selfClosing) return { start: rec.start, end: rec.close, text: open.replace(/\s*\/>$/, '>') + body + '</' + rec.tag + '>' };
    return { start: rec.contentStart, end: rec.end, text: body };
}

function removeOp(src, el) {
    var rec = src.pos.rec(el);
    return rec ? { start: lineStart(src.xml, rec.start), end: rec.close, text: '' } : null;
}

function insertOp(src, parent, order, name, lines) {
    var prec = src.pos.rec(parent);
    var at = order.indexOf(name);
    if (!prec || prec.selfClosing || at < 0) return null;
    var kids = parent.children || [];
    var anchor = null;
    /* After children of the same name too: a repeated element (a field, a
     * resource) is appended to its run. */
    for (var i = 0; i < kids.length; i++) {
        var k = order.indexOf(localName(kids[i]));
        if (k >= 0 && k <= at) anchor = kids[i];
    }
    var first = kids.length ? src.pos.rec(kids[0]) : null;
    var indent = first ? indentBefore(src.xml, first.start) : indentBefore(src.xml, prec.start) + '\t';
    var arec = anchor && src.pos.rec(anchor);
    var pos = arec ? arec.close : prec.contentStart;
    return { start: pos, end: pos, text: src.eol + indent + fragment(lines, indent, src.eol) };
}

function titleLines(text) {
    return [[0, '<title xsi:type="v8:LocalStringType">']].concat(ruItemLines(text, 1), [[0, '</title>']]);
}

function ruItemLines(text, depth) {
    return [[depth, '<v8:item>'], [depth + 1, '<v8:lang>ru</v8:lang>'],
        [depth + 1, '<v8:content>' + encodeXml(text) + '</v8:content>'], [depth, '</v8:item>']];
}

function titleOp(src, owner, value) {
    var text = String(value == null ? '' : value).replace(/\s*\n\s*/g, ' ');
    var el = owner.el;
    var title = firstChild(el, 'title');
    var item = ruItem(title);
    var content = item && firstChild(item, 'content');
    /* A written title left as it is stays, even one the platform would show anyway. */
    if (content && exactText(src, content) === text) return null;
    if (automaticTitle(owner, text.trim())) return title ? removeOp(src, title) : null;
    if (!title) return insertOp(src, el, CHILD_ORDER[owner.kind], 'title', titleLines(text));
    if (content) return textOp(src, content, text);
    var trec = src.pos.rec(title);
    if (!trec) return null;
    var kids = title.children || [];
    if (!kids.length) {
        var at = lineStart(src.xml, trec.start);
        var indent = indentBefore(src.xml, trec.start);
        return { start: at, end: trec.close, text: src.eol + indent + fragment(titleLines(text), indent, src.eol) };
    }
    var firstRec = src.pos.rec(kids[0]);
    var ind = indentBefore(src.xml, firstRec.start);
    return { start: trec.contentStart, end: trec.contentStart, text: src.eol + ind + fragment(ruItemLines(text, 0), ind, src.eol) };
}

function flagOp(src, s, on) {
    var el = s.owner.el;
    var name = RESTRICTIONS[s.base];
    var box = firstChild(el, name);
    var flag = box && firstChild(box, s.flag);
    if (!on) {
        if (!flag) return null;
        return (box.children || []).length === 1 ? removeOp(src, box) : removeOp(src, flag);
    }
    if (flag) return textOf(flag) === 'true' ? null : textOp(src, flag, 'true');
    var line = '<' + s.flag + '>true</' + s.flag + '>';
    if (box) return insertOp(src, box, CHILD_ORDER.restriction, s.flag, [[0, line]]);
    return insertOp(src, el, CHILD_ORDER[s.owner.kind], name, [[0, '<' + name + '>'], [1, line], [0, '</' + name + '>']]);
}

function scalarOp(src, s, word) {
    var el = s.owner.el;
    var c = firstChild(el, s.base);
    if (s.def && word === s.def) return c ? removeOp(src, c) : null;
    if (c) return textOf(c) === word ? null : textOp(src, c, word);
    return insertOp(src, el, CHILD_ORDER[s.owner.kind], s.base, [[0, '<' + s.base + '>' + word + '</' + s.base + '>']]);
}

var YES = { 'да': 1, 'истина': 1, 'true': 1, '1': 1, 'yes': 1 };
var NO = { 'нет': 1, 'ложь': 1, 'false': 1, '0': 1, 'no': 1, '': 1 };

function daysIn(y, m) {
    return [31, y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
}

/* A value typed in the window as the text its <value> element holds. */
function valueWord(sv, text) {
    var t = String(text == null ? '' : text);
    if (sv.kind === 'string') return { word: t };
    t = t.trim();
    if (sv.kind === 'boolean') {
        var low = t.toLowerCase();
        if (own(YES, low)) return { word: 'true' };
        if (own(NO, low)) return { word: 'false' };
        return { error: 'Ожидается «Да» или «Нет»' };
    }
    if (sv.kind === 'decimal') {
        var n = t.replace(/[\s ]/g, '').replace(',', '.');
        if (!n) return { word: '0' };
        var m = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(n);
        if (!m || !(m[2] || m[3])) return { error: 'Ожидается число' };
        var whole = m[2].replace(/^0+(?=\d)/, '') || '0';
        var frac = (m[3] || '').replace(/0+$/, '');
        var num = whole + (frac ? '.' + frac : '');
        return { word: m[1] === '-' && num !== '0' ? '-' + num : num };
    }
    if (!t) return { word: '0001-01-01T00:00:00' };
    var iso = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)$/.exec(t);
    var ru = /^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s+(\d{1,2}):(\d\d)(?::(\d\d))?)?$/.exec(t);
    var y, mo, d, h = 0, mi = 0, se = 0;
    if (iso) { y = +iso[1]; mo = +iso[2]; d = +iso[3]; h = +iso[4]; mi = +iso[5]; se = +iso[6]; }
    else if (ru) { d = +ru[1]; mo = +ru[2]; y = +ru[3]; h = +(ru[4] || 0); mi = +(ru[5] || 0); se = +(ru[6] || 0); }
    else return { error: 'Ожидается дата ДД.ММ.ГГГГ или ДД.ММ.ГГГГ ЧЧ:ММ:СС' };
    if (y < 1 || mo < 1 || mo > 12 || d < 1 || d > daysIn(y, mo) || h > 23 || mi > 59 || se > 59) return { error: 'Такой даты нет' };
    if (sv.dateOnly && h + mi + se) return { error: 'У параметра только дата, без времени' };
    function two(x) { return (x < 10 ? '0' : '') + x; }
    return { word: ('000' + y).slice(-4) + '-' + two(mo) + '-' + two(d) + 'T' + two(h) + ':' + two(mi) + ':' + two(se) };
}

function valueOp(src, s, text) {
    var el = s.owner.el;
    var sv = simpleValue(el);
    if (!sv) return { error: 'Значение такого типа здесь не меняется' };
    /* The text shown is the value: an untouched one, xsi:nil included, stays. */
    if (String(text == null ? '' : text) === sv.text) return null;
    var w = valueWord(sv, text);
    if (w.error) return w;
    var type = 'xs:' + sv.kind;
    var xml = sv.kind === 'string' && !w.word ? '<value xsi:type="' + type + '"/>'
        : '<value xsi:type="' + type + '">' + encodeText(src, null, w.word) + '</value>';
    var v = firstChild(el, 'value');
    var rec = v && src.pos.rec(v);
    if (!v) return insertOp(src, el, CHILD_ORDER.param, 'value', [[0, xml]]);
    if (!rec) return null;
    return src.xml.slice(rec.start, rec.close) === xml ? null : { start: rec.start, end: rec.close, text: xml };
}

/* The source edit that sets property `prop` of record `id` to `value`:
 * { start, end, text } in the text the model was parsed from (BOM included),
 * { error } for a value that cannot be written, null when nothing changes. */
function propertyEdit(model, id, prop, value) {
    var s = propertySpec(model, id, prop);
    if (!s) return null;
    var src = s.src;
    var op = null;
    if (s.how === 'text' || s.how === 'optional') {
        var text = String(value == null ? '' : value).replace(/\r\n/g, '\n');
        var c = firstChild(s.owner.el, s.base);
        if (c) op = s.how === 'optional' && !text.trim() ? removeOp(src, c) : textOp(src, c, text);
        else if (text.trim()) {
            op = insertOp(src, s.owner.el, CHILD_ORDER[s.owner.kind], s.base,
                [[0, '<' + s.base + '>' + encodeText(src, null, text) + '</' + s.base + '>']]);
        }
    } else if (s.how === 'title') op = titleOp(src, s.owner, value);
    else if (s.how === 'flags') op = flagOp(src, s, !!value);
    else if (s.how === 'bool') op = scalarOp(src, s, value ? 'true' : 'false');
    else if (s.how === 'enum') {
        if ((ENUMS[s.base] || []).indexOf(value) < 0) return { error: 'Недопустимое значение' };
        op = scalarOp(src, s, value);
    } else if (s.how === 'value') op = valueOp(src, s, value);
    if (!op || op.error) return op;
    if (src.xml.slice(op.start, op.end) === op.text) return null;
    var bom = model.bom || 0;
    return { start: op.start + bom, end: op.end + bom, text: op.text };
}

// ------------------------------------------------------------------ adding

var PATH_RE = /^[A-Za-zА-Яа-яЁё_][0-9A-Za-zА-Яа-яЁё_]*(?:\.[A-Za-zА-Яа-яЁё_][0-9A-Za-zА-Яа-яЁё_]*)*$/;

function findSet(sets, id) {
    for (var i = 0; i < sets.length; i++) {
        if (sets[i].id === id) return sets[i];
        var inner = findSet(sets[i].items, id);
        if (inner) return inner;
    }
    return null;
}

/* The source edit that adds a data set field (`what` 'field', `target` the
 * set id), a calculated field ('calc') or a resource ('total') in the
 * smallest form the AT export writes them: a field is its path and column,
 * a calculated field its path and expression (no title: the platform shows
 * one by itself), a resource its field and expression. It goes after the
 * last element of its kind. { start, end, text, id } with the id of the new
 * record, or { error }. */
function addEdit(model, what, target, values) {
    var src = model && model.source;
    if (!src) return null;
    values = values || {};
    var path = String(values.dataPath || '').trim();
    if (!path) return { error: 'Укажите путь к данным' };
    if (!PATH_RE.test(path)) return { error: 'Путь к данным — имена через точку: буквы, цифры и «_»' };
    var enc = function (s) { return encodeText(src, null, String(s).replace(/\r\n/g, '\n')); };
    var parent, order, name, lines, id;
    if (what === 'field') {
        var owner = own(src.owners, target);
        var set = owner && owner.kind === 'set' ? findSet(model.sets, target) : null;
        if (!set) return null;
        if (set.fields.some(function (f) { return f.dataPath === path; })) return { error: 'В наборе уже есть поле «' + path + '»' };
        var column = String(values.field || '').trim() || path;
        if (!PATH_RE.test(column)) return { error: 'Поле — имя колонки запроса: буквы, цифры и «_»' };
        parent = owner.el;
        order = CHILD_ORDER.set;
        name = 'field';
        lines = [[0, '<field xsi:type="DataSetFieldField">'], [1, '<dataPath>' + enc(path) + '</dataPath>'],
            [1, '<field>' + enc(column) + '</field>'], [0, '</field>']];
        id = 'field:' + target.slice(4) + ':' + path;
    } else if (what === 'calc' || what === 'total') {
        var schema = own(src.owners, 'schema');
        if (!schema) return null;
        var expression = String(values.expression || '');
        if (what === 'calc') {
            if (model.calculated.some(function (c) { return c.dataPath === path; })) return { error: 'Вычисляемое поле «' + path + '» уже есть' };
            if (!expression.trim()) return { error: 'Укажите выражение' };
        } else if (!expression.trim()) expression = 'Сумма(' + path + ')';
        parent = schema.el;
        order = CHILD_ORDER.schema;
        name = what === 'calc' ? 'calculatedField' : 'totalField';
        lines = [[0, '<' + name + '>'], [1, '<dataPath>' + enc(path) + '</dataPath>'],
            [1, '<expression>' + enc(expression) + '</expression>'], [0, '</' + name + '>']];
        id = what === 'calc' ? 'calc:' + model.calculated.length : 'total:' + model.totals.length;
    } else return null;
    var op = insertOp(src, parent, order, name, lines);
    if (!op) return null;
    var bom = model.bom || 0;
    return { start: op.start + bom, end: op.end + bom, text: op.text, id: id };
}

function applyAdd(xml, model, what, target, values) {
    var edit = addEdit(model, what, target, values);
    if (!edit || edit.error) return edit;
    return { xml: xml.slice(0, edit.start) + edit.text + xml.slice(edit.end), id: edit.id };
}

/* The output columns of a query, for the names a new field is offered:
 * the aliases of the first SELECT of the last statement that is not a
 * temporary table, else the last name of each column's path. A hint only —
 * the user may type any name. */
/* A keyword of the query language as a whole word: \b knows no Cyrillic. */
var WORD = 'A-Za-zА-Яа-яЁё0-9_';

function keyword(words, flags) {
    return new RegExp('(?:^|[^' + WORD + '])(?:' + words + ')(?![' + WORD + '])', flags || 'i');
}

var WORD_CHAR_RE = new RegExp('[' + WORD + ']');
var SELECT_RE = keyword('ВЫБРАТЬ|SELECT');
var TEMP_TABLE_RE = keyword('ПОМЕСТИТЬ|INTO');
var DROP_RE = new RegExp('^\\s*(?:УНИЧТОЖИТЬ|DROP)(?![' + WORD + '])', 'i');
var SELECT_HEAD_RE = new RegExp('(?:^|[^' + WORD + '])(?:ВЫБРАТЬ|SELECT)(?:\\s+(?:РАЗРЕШЕННЫЕ|РАЗЛИЧНЫЕ|ALLOWED|DISTINCT)|\\s+(?:ПЕРВЫЕ|TOP)\\s+\\d+)*(?![' + WORD + '])', 'i');
var LIST_END_RE = new RegExp('^(?:ИЗ|FROM|ОБЪЕДИНИТЬ|UNION|СГРУППИРОВАТЬ|GROUP|УПОРЯДОЧИТЬ|ORDER|ГДЕ|WHERE|ИТОГИ|TOTALS|ИМЕЮЩИЕ|HAVING|ДЛЯ|FOR)(?![' + WORD + '])', 'i');
var ALIAS_RE = new RegExp('(?:^|[^' + WORD + '])(?:КАК|AS)\\s+([A-Za-zА-Яа-яЁё_][' + WORD + ']*)\\s*$', 'i');

function queryColumns(text) {
    var q = String(text || '').replace(/\/\/[^\n]*/g, '').replace(/"(?:[^"]|"")*"/g, '""');
    /* Data composition braces ({ГДЕ ...}, {ВЫБРАТЬ ...}) hold no output columns. */
    var prev;
    do { prev = q; q = q.replace(/\{[^{}]*\}/g, ' '); } while (q !== prev);
    var statements = q.split(';').filter(function (s) {
        return SELECT_RE.test(s) && !TEMP_TABLE_RE.test(s) && !DROP_RE.test(s);
    });
    var st = statements[statements.length - 1];
    if (!st) return [];
    var m = SELECT_HEAD_RE.exec(st);
    if (!m) return [];
    var rest = st.slice(m.index + m[0].length);
    var list = '';
    var depth = 0;
    for (var i = 0; i < rest.length; i++) {
        var ch = rest.charAt(i);
        if (ch === '(') depth++;
        else if (ch === ')') depth--;
        else if (!depth && !WORD_CHAR_RE.test(rest.charAt(i - 1) || ' ') && LIST_END_RE.test(rest.slice(i))) break;
        list += ch;
    }
    var out = [];
    var part = '';
    depth = 0;
    function take(p) {
        p = p.trim();
        if (!p || /\*$/.test(p)) return;
        var alias = ALIAS_RE.exec(p);
        var name = alias ? alias[1] : (/(?:^|\.)([A-Za-zА-Яа-яЁё_][\wА-Яа-яЁё]*)$/.exec(p) || [])[1];
        if (name && out.indexOf(name) < 0) out.push(name);
    }
    for (var k = 0; k < list.length; k++) {
        var c = list.charAt(k);
        if (c === '(') depth++;
        else if (c === ')') depth--;
        if (c === ',' && !depth) { take(part); part = ''; } else part += c;
    }
    take(part);
    return out;
}

function applyProperty(xml, model, id, prop, value) {
    var edit = propertyEdit(model, id, prop, value);
    if (!edit || edit.error) return edit && edit.error ? edit : null;
    return xml.slice(0, edit.start) + edit.text + xml.slice(edit.end);
}

// ----------------------------------------------------------------- outline

function allSets(sets, depth, out) {
    for (var i = 0; i < sets.length; i++) {
        out.push({ set: sets[i], depth: depth });
        allSets(sets[i].items, depth + 1, out);
    }
    return out;
}

var PICTURES = {
    group: 'std-pictures/Papka.svg',
    set: 'std-pictures/NABOR.png',
    union: 'std-pictures/KonstruktorZaprosaGruppaVremennykhTablits.png',
    field: 'std-pictures/Rekvizit.png',
    folder: 'std-pictures/Papka.svg',
    dimension: 'std-pictures/Izmerenie.png',
    resource: 'std-pictures/Resurs.png',
    calculated: 'std-pictures/PolzovatelskiePolyaKomponovkiDannykh.png',
    parameter: 'std-pictures/ParametryDannykhKomponovkiDannykh.png',
    link: 'std-pictures/VlozhennayaTablitsa.png',
    template: 'std-pictures/NastroykaSpiska.png',
    nested: 'std-pictures/NovayaVlozhennayaSkhemaKomponovkiDannykh.png',
    variant: 'std-pictures/StandartnayaNastroykaKomponovkiDannykh.png',
    root: 'std-pictures/NastroykiOtcheta.png',
    groupNode: 'std-pictures/Gruppirovka.png',
    table: 'std-pictures/NovayaTablitsaKomponovkiDannykh.png',
    chart: 'std-pictures/NovayaDiagrammaKomponovkiDannykh.png',
    axis: 'std-pictures/PolyaGruppirovkiKomponovkiDannykh.png',
    nestedObject: 'std-pictures/NovayaVlozhennayaSkhemaKomponovkiDannykh.png'
};

function outline(model) {
    var out = [];
    if (!model) return out;
    function push(item) {
        item.type = 'form';
        item.itemKind = 'dcs';
        item.tag = 'Dcs' + item.pic;
        item.title = item.title || item.name;
        out.push(item);
        return item;
    }
    function group(id, title, count, line, tab) {
        return push({ id: id, name: title, pic: 'group', depth: 0, hasChildren: count > 0, line: line || 1, group: true, tab: tab });
    }
    var flat = allSets(model.sets, 1, []);
    group('tab:sets', 'Наборы данных', flat.length, flat.length ? flat[0].set.line : 1, 'sets');
    for (var i = 0; i < flat.length; i++) {
        var set = flat[i].set;
        push({ id: set.id, name: set.name, pic: set.kind === 'DataSetUnion' ? 'union' : 'set', depth: flat[i].depth,
            hasChildren: set.fields.length > 0 || set.items.length > 0, line: set.line, typeName: set.kindTitle, tab: 'sets' });
        /* A union's own members come right after it; its fields follow them
         * in the Designer too, but in the outline they stay with the set. */
        for (var f = 0; f < set.fields.length; f++) {
            var fld = set.fields[f];
            push({ id: fld.id, name: fld.dataPath,
                pic: fld.kind === 'folder' ? 'folder' : fld.role.indexOf('Измерение') >= 0 ? 'dimension' : 'field',
                depth: flat[i].depth + 1, hasChildren: false, line: fld.line, typeName: fld.type, tab: 'sets', setId: set.id,
                field: fld, setName: set.name });
        }
    }
    function simple(tab, title, list, pic, name) {
        if (!list.length) return;
        group('tab:' + tab, title, list.length, list[0].line, tab);
        for (var k = 0; k < list.length; k++) {
            push({ id: list[k].id, name: name(list[k]), pic: pic, depth: 1, hasChildren: false, line: list[k].line, tab: tab,
                record: list[k] });
        }
    }
    simple('links', 'Связи наборов данных', model.links, 'link', function (l) { return l.source + ' → ' + l.dest; });
    simple('calculated', 'Вычисляемые поля', model.calculated, 'calculated', function (c) { return c.dataPath; });
    simple('totals', 'Ресурсы', model.totals, 'resource', function (t) { return t.dataPath; });
    simple('parameters', 'Параметры', model.parameters, 'parameter', function (p) { return p.name; });
    simple('templates', 'Макеты', model.templates, 'template', function (t) { return t.title + (t.name ? ': ' + t.name : ''); });
    simple('nested', 'Вложенные схемы', model.nested, 'nested', function (n) { return n.name; });
    if (model.variants.length) {
        group('tab:settings', 'Варианты настроек', model.variants.length, model.variants[0].line, 'settings');
        for (var v = 0; v < model.variants.length; v++) {
            var variant = model.variants[v];
            push({ id: variant.id, name: variant.name, pic: 'variant', depth: 1, typeName: variant.presentation,
                hasChildren: !!(variant.root && variant.root.children.length), line: variant.line, tab: 'settings' });
            if (variant.root) nodeOutline(variant.root.children, 2);
        }
    }
    function nodeOutline(nodes, depth) {
        for (var n = 0; n < nodes.length; n++) {
            var node = nodes[n];
            push({ id: node.id, name: node.title, pic: node.kind === 'group' ? 'groupNode' : node.kind, depth: depth,
                hasChildren: node.children.length > 0, line: node.line, tab: 'settings' });
            nodeOutline(node.children, depth + 1);
        }
    }
    return out;
}

var RESTRICTION_TITLES = { field: 'Поле', condition: 'Условие', group: 'Группа', order: 'Упорядочивание' };

function restrictionText(r) {
    return ['field', 'condition', 'group', 'order'].filter(function (k) { return r[k]; })
        .map(function (k) { return RESTRICTION_TITLES[k]; }).join(', ');
}

function yes(on) {
    return on ? 'Да' : '';
}

/* The inspector of a calculated field, resource, parameter or link: the
 * columns of its row, the ones set in the schema. */
function recordInspector(entry) {
    var r = entry.record;
    var rows, name, kind;
    if (entry.tab === 'calculated') {
        name = r.title || r.dataPath;
        kind = 'Вычисляемое поле';
        rows = [['Путь к данным', r.dataPath], ['Выражение', r.expression], ['Заголовок', r.title], ['Тип значения', r.type],
            ['Ограничение доступности', restrictionText(r.restrict)], ['Выражение представления', r.presentation],
            ['Выражения упорядочивания', r.order], ['Доступные значения', r.available], ['Оформление', r.appearance],
            ['Параметры редактирования', r.editParameters]];
    } else if (entry.tab === 'totals') {
        name = r.title || r.dataPath;
        kind = 'Ресурс';
        rows = [['Поле', r.dataPath], ['Выражение', r.expression], ['Рассчитывать по', r.groups.join(', ')]];
    } else if (entry.tab === 'parameters') {
        name = r.title || r.name;
        kind = 'Параметр';
        rows = [['Имя', r.name], ['Заголовок', r.title], ['Тип', r.type], ['Значение', r.value], ['Выражение', r.expression],
            ['Доступен список значений', yes(r.valueList)], ['Включать в доступные поля', r.availableAsField ? '' : 'Нет'],
            ['Ограничение доступности', yes(r.restricted)], ['Запрещать незаполненные значения', yes(r.denyIncomplete)],
            ['Использование', r.use], ['Доступные значения', r.available], ['Параметр функциональной опции', r.functionalOption],
            ['Параметры редактирования', r.editParameters]];
    } else if (entry.tab === 'links') {
        name = r.source + ' → ' + r.dest;
        kind = 'Связь наборов данных';
        rows = [['Источник связи', r.source], ['Приемник связи', r.dest], ['Выражение источник', r.sourceExpr],
            ['Выражение приемник', r.destExpr], ['Параметр', r.parameter], ['Список параметров', yes(r.parameterList)],
            ['Условие связи', r.condition], ['Начальное значение связи', r.start], ['Обязательная связь', yes(r.required)]];
    } else return null;
    return {
        name: name, typeName: kind, heading: 'Свойства', groups: [],
        rows: rows.filter(function (x) { return x[1]; }).map(function (x) { return { label: x[0], value: x[1] }; })
    };
}

/* The property inspector of a data set field: the columns of its row in the
 * fields grid, the ones set in the schema. */
function inspector(entry) {
    if (entry && entry.record) return recordInspector(entry);
    var f = entry && entry.field;
    if (!f) return null;
    var folder = f.kind === 'folder';
    var rows = [
        { label: 'Путь', value: f.dataPath },
        { label: 'Поле', value: folder ? '' : f.field },
        { label: 'Заголовок', value: f.title || (folder ? '' : lastName(f.dataPath)) },
        { label: 'Тип значения', value: f.type },
        { label: 'Роль', value: f.role },
        { label: 'Ограничение поля', value: restrictionText(f.restrict) },
        { label: 'Ограничение реквизитов', value: restrictionText(f.attrRestrict) },
        { label: 'Выражение представления', value: f.presentation },
        { label: 'Выражения упорядочивания', value: f.order },
        { label: 'Проверка иерархии: набор данных', value: f.hierarchySet },
        { label: 'Проверка иерархии: параметр', value: f.hierarchyParameter },
        { label: 'Доступные значения', value: f.available },
        { label: 'Оформление', value: f.appearance },
        { label: 'Параметры редактирования', value: f.editParameters }
    ].filter(function (r) { return r.value; });
    return {
        name: f.title || f.dataPath,
        typeName: (folder ? 'Папка' : f.kind === 'nested' ? 'Вложенный набор данных' : 'Поле набора данных') +
            (entry.setName ? ' · ' + entry.setName : ''),
        heading: 'Свойства', rows: rows, groups: []
    };
}

function outlineIcon(it) {
    var asset = it && own(PICTURES, it.pic);
    return asset ? { cls: 'dcs-outline-icon', asset: asset } : { cls: 'icon-form-etc', icon: 'box' };
}

function outlineSortByName(items) {
    var md = root.MetadataPreview;
    return md && md.outlineSortByName ? md.outlineSortByName(items) : items;
}

function outlineHidden(items, index, collapsed) {
    if (!items || !collapsed || index < 0) return false;
    var d = items[index].depth || 0;
    for (var i = index - 1; i >= 0 && d > 0; i--) {
        var pd = items[i].depth || 0;
        if (pd < d) {
            if (items[i].id && collapsed[items[i].id]) return true;
            d = pd;
        }
    }
    return false;
}

function outlineExpandTo(items, id, collapsed) {
    if (!items || !id || !collapsed) return false;
    var idx = -1;
    for (var i = 0; i < items.length; i++) if (items[i].id === id) { idx = i; break; }
    if (idx < 0) return false;
    var d = items[idx].depth || 0;
    var changed = false;
    for (var j = idx - 1; j >= 0 && d > 0; j--) {
        var pd = items[j].depth || 0;
        if (pd < d) {
            if (items[j].id && collapsed[items[j].id]) { delete collapsed[items[j].id]; changed = true; }
            d = pd;
        }
    }
    return changed;
}

/* Sets keep their fields folded at start: a schema can have hundreds. */
function outlineCollapseAll(items, collapsed) {
    for (var k in collapsed) if (Object.prototype.hasOwnProperty.call(collapsed, k)) delete collapsed[k];
    for (var i = 0; items && i < items.length; i++) if (items[i].hasChildren && items[i].id) collapsed[items[i].id] = true;
    return collapsed;
}

function itemKey(it) {
    return it ? String(it.id || '') : '';
}

// ------------------------------------------------------------ view state

function initialViewState() {
    return { tab: 'sets', set: '', variant: 0, node: '', settingsTab: 'selection', template: '', selected: '', fieldsHeight: 0 };
}

var viewState = initialViewState();

function resetViewState() {
    viewState = initialViewState();
}

// ------------------------------------------------------------------- render

function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
}

function picture(key) {
    var img = el('img', 'dcs-pic');
    img.alt = '';
    img.src = PICTURES[key];
    return img;
}

/* A checkbox of the Designer's grids. `off` greys it out, as the Designer
 * shows a restriction that does not apply to the field. */
function check(on, off) {
    return el('span', 'dcs-check' + (on ? ' dcs-checked' : '') + (off ? ' dcs-check-off' : ''));
}

/* The command bars of the Designer. The window adds, copies and removes
 * nothing, so a bar with no working button is not drawn at all. */
var TOOLS = {
    add: ['std-pictures/DobavitElementSpiska.png', 'Добавить'],
    addMenu: ['std-pictures/DobavitElementSpiska.png', 'Добавить', true],
    copy: ['std-pictures/SkopirovatElementSpiska.png', 'Скопировать'],
    edit: ['std-pictures/IzmenitElementSpiska.png', 'Изменить'],
    folder: ['std-pictures/SozdatGruppu.png', 'Добавить папку'],
    nested: ['std-pictures/NovayaVlozhennayaSkhemaKomponovkiDannykh.png', 'Добавить набор данных - поле'],
    remove: ['std-pictures/UdalitElementSpiska.png', 'Удалить'],
    up: ['std-pictures/PeremestitVverkh.png', 'Переместить вверх'],
    down: ['std-pictures/PeremestitVniz.png', 'Переместить вниз']
};

/* `actions` makes the named buttons work: { add: function (button) {...} }.
 * Returns null when no key of the bar has an action. */
function toolbar(keys, cls, actions) {
    var live = keys.filter(function (k) { return k !== '|' && actions && own(actions, k); });
    if (!live.length) return null;
    var bar = el('div', 'dcs-toolbar' + (cls ? ' ' + cls : ''));
    for (var i = 0; i < live.length; i++) {
        var t = TOOLS[live[i]];
        var act = own(actions, live[i]);
        var b = el('span', 'dcs-tool dcs-tool-active');
        b.title = t[1];
        var img = el('img', 'dcs-pic');
        img.alt = '';
        img.src = t[0];
        b.appendChild(img);
        if (act) b.addEventListener('click', (function (fn, button) { return function () { fn(button); }; })(act, b));
        bar.appendChild(b);
    }
    return bar;
}

/* Maps the cells of a table onto its columns, honouring colspan and rowspan:
 * `heads[i]` is the first header cell that covers column `i` alone and
 * `cells[i]` its body cells. A column hidden inside a span on every line has
 * no cell of its own and so gets no grip. */
function columnMap(table, count) {
    var taken = [];
    var heads = [];
    var cells = [];
    for (var i = 0; i < count; i++) { heads.push(null); cells.push([]); }
    var rows = [];
    for (var g = 0; g < table.children.length; g++) {
        var section = table.children[g];
        if (section.tagName !== 'THEAD' && section.tagName !== 'TBODY') continue;
        for (var q = 0; q < section.children.length; q++) rows.push(section.children[q]);
    }
    for (var r = 0; r < rows.length; r++) {
        if (!taken[r]) taken[r] = [];
        var line = rows[r].children;
        var c = 0;
        for (var k = 0; k < line.length; k++) {
            var cell = line[k];
            if (cell.tagName !== 'TH' && cell.tagName !== 'TD') continue;
            while (taken[r][c]) c++;
            var cs = cell.colSpan || 1;
            var rs = cell.rowSpan || 1;
            for (var dr = 0; dr < rs; dr++) {
                if (!taken[r + dr]) taken[r + dr] = [];
                for (var dc = 0; dc < cs; dc++) taken[r + dr][c + dc] = true;
            }
            if (cs === 1 && c < count) {
                if (cell.tagName === 'TH') { if (!heads[c]) heads[c] = cell; }
                else cells[c].push(cell);
            }
            c += cs;
        }
    }
    return { heads: heads, cells: cells };
}

var COLUMN_MIN = 24;

/* Lets the user drag the right edge of a header cell to widen a column, as
 * the Designer's grids do, so a cut value can be read in place and not only
 * in its tooltip; a double click fits the column to its widest value. */
function resizableColumns(table, colgroup) {
    var cols = [];
    for (var n = 0; n < colgroup.children.length; n++) cols.push(colgroup.children[n]);
    var map = columnMap(table, cols.length);

    function width(i) { return parseFloat(cols[i].style.width) || cols[i].offsetWidth || 100; }
    function apply(i, px) {
        cols[i].style.width = Math.max(COLUMN_MIN, Math.round(px)) + 'px';
        var total = 0;
        for (var j = 0; j < cols.length; j++) total += width(j);
        table.style.width = total + 'px';
    }
    /* The cells cut their text, so `scrollWidth` is what the value asks for;
     * the borders of the cell are added back on top of it. */
    function fit(i) {
        var list = map.cells[i].slice();
        if (map.heads[i]) list.push(map.heads[i]);
        var want = COLUMN_MIN;
        for (var j = 0; j < list.length; j++) {
            var cell = list[j];
            var frame = cell.offsetWidth - cell.clientWidth;
            want = Math.max(want, cell.scrollWidth + frame + 5);
        }
        apply(i, want);
    }

    for (var i = 0; i < cols.length; i++) {
        var th = map.heads[i];
        if (!th) continue;
        var grip = el('span', 'dcs-col-grip');
        grip.title = 'Перетащите, чтобы изменить ширину столбца; двойной щелчок — по содержимому';
        th.appendChild(grip);
        bindGrip(grip, i);
    }

    function bindGrip(grip, index) {
        var start = 0;
        var from = 0;
        function move(e) { apply(index, from + (e.clientX - start)); }
        function stop(e) {
            grip.classList.remove('dcs-dragging');
            document.removeEventListener('pointermove', move, true);
            document.removeEventListener('pointerup', stop, true);
            if (grip.releasePointerCapture && e.pointerId != null) {
                try { grip.releasePointerCapture(e.pointerId); } catch (err) { /* already released */ }
            }
        }
        grip.addEventListener('pointerdown', function (e) {
            if (e.button) return;
            e.preventDefault();
            e.stopPropagation();
            start = e.clientX;
            from = width(index);
            grip.classList.add('dcs-dragging');
            if (grip.setPointerCapture) { try { grip.setPointerCapture(e.pointerId); } catch (err) { /* no capture */ } }
            document.addEventListener('pointermove', move, true);
            document.addEventListener('pointerup', stop, true);
        });
        grip.addEventListener('click', function (e) { e.stopPropagation(); });
        grip.addEventListener('dblclick', function (e) {
            e.preventDefault();
            e.stopPropagation();
            fit(index);
        });
    }
}

/* A grid with the Designer's look. A column is { title, width, get(row) ->
 * string | Node }; `options.lead` adds the narrow column of the use checkbox
 * that leads the settings grids. */
function grid(columns, rows, options) {
    options = options || {};
    if (options.lead) {
        columns = [{ title: '', width: 22, lead: true, get: function (r) { return r.root ? '' : check(r.use); } }].concat(columns);
    }
    var wrap = el('div', 'dcs-grid' + (options.cls ? ' ' + options.cls : ''));
    var table = el('table');
    var colgroup = el('colgroup');
    var head = el('tr', 'dcs-head');
    /* The columns keep their widths and share what is left of the window,
     * as the Designer's grids do; a long title is cut, not the column grown. */
    var total = 0;
    for (var c = 0; c < columns.length; c++) {
        var col = el('col');
        total += columns[c].width || 100;
        col.style.width = (columns[c].width || 100) + 'px';
        colgroup.appendChild(col);
        var th = el('th', '', columns[c].title);
        if (columns[c].title) th.title = columns[c].hint || columns[c].title;
        head.appendChild(th);
    }
    table.style.width = total + 'px';
    table.appendChild(colgroup);
    var thead = el('thead');
    thead.appendChild(head);
    table.appendChild(thead);
    var body = el('tbody');
    var first = options.lead ? 1 : 0;
    for (var r = 0; r < rows.length; r++) {
        var row = rows[r];
        var tr = el('tr', 'dcs-row' + (row.use === false ? ' dcs-unused' : '') + (row.root ? ' dcs-root-row' : ''));
        if (row.id) tr.setAttribute('data-id', row.id);
        for (var k = 0; k < columns.length; k++) {
            var td = el('td', columns[k].lead ? 'dcs-lead' : '');
            var v = columns[k].get(row);
            if (k === first && row.depth) td.style.paddingLeft = (4 + row.depth * 16) + 'px';
            if (v && typeof v === 'object' && v.nodeType) td.appendChild(v);
            else {
                td.textContent = v == null ? '' : String(v);
                if (v) td.title = String(v);
            }
            tr.appendChild(td);
        }
        body.appendChild(tr);
    }
    table.appendChild(body);
    wrap.appendChild(table);
    resizableColumns(table, colgroup);
    if (!rows.length && options.empty) wrap.appendChild(el('div', 'dcs-grid-empty', options.empty));
    return wrap;
}

/* A grid whose header and records span several lines, like the fields of a
 * data set: `head` is a list of header lines of { title, cs, rs } cells and
 * `cells(record)` gives the record's lines of { v, cs, rs, cls } cells. Each
 * record is a tbody of its own, so selecting it marks all its lines. */
function stackedGrid(widths, head, records, cells, options) {
    options = options || {};
    var wrap = el('div', 'dcs-grid dcs-stacked' + (options.cls ? ' ' + options.cls : ''));
    var table = el('table');
    var colgroup = el('colgroup');
    var total = 0;
    for (var c = 0; c < widths.length; c++) {
        var col = el('col');
        col.style.width = widths[c] + 'px';
        total += widths[c];
        colgroup.appendChild(col);
    }
    table.style.width = total + 'px';
    table.appendChild(colgroup);
    var thead = el('thead');
    for (var h = 0; h < head.length; h++) {
        var tr = el('tr', 'dcs-head');
        for (var k = 0; k < head[h].length; k++) {
            var cell = head[h][k];
            var th = el('th', '', cell.title || '');
            if (cell.cs) th.colSpan = cell.cs;
            if (cell.rs) th.rowSpan = cell.rs;
            if (cell.title) th.title = cell.hint || cell.title;
            /* Sticky cells keep their own line of the header in place. */
            th.style.top = (h * 21) + 'px';
            tr.appendChild(th);
        }
        thead.appendChild(tr);
    }
    table.appendChild(thead);
    for (var r = 0; r < records.length; r++) {
        var body = el('tbody', 'dcs-record' + (records[r].use === false ? ' dcs-unused' : ''));
        if (records[r].id) body.setAttribute('data-id', records[r].id);
        var lines = cells(records[r]);
        for (var l = 0; l < lines.length; l++) {
            var line = el('tr', 'dcs-row');
            for (var j = 0; j < lines[l].length; j++) {
                var d = lines[l][j];
                var td = el('td', d.cls || '');
                if (d.cs) td.colSpan = d.cs;
                if (d.rs) td.rowSpan = d.rs;
                var v = d.v;
                if (v && typeof v === 'object' && v.nodeType) td.appendChild(v);
                else {
                    td.textContent = v == null ? '' : String(v);
                    if (v) td.title = String(v);
                }
                line.appendChild(td);
            }
            body.appendChild(line);
        }
        table.appendChild(body);
    }
    wrap.appendChild(table);
    resizableColumns(table, colgroup);
    if (!records.length && options.empty) wrap.appendChild(el('div', 'dcs-grid-empty', options.empty));
    return wrap;
}

function restrictCells(r, off) {
    return ['field', 'condition', 'group', 'order'].map(function (k) {
        return { v: check(off || r[k], off), cls: 'dcs-center' };
    });
}

/* The tree mark of a row: a dash for a leaf, a circle with a sign for a node
 * that has children. */
function treeMark(kind) {
    return el('span', 'dcs-mark dcs-mark-' + kind);
}

function withIcon(key, text) {
    var span = el('span', 'dcs-cell-icon');
    if (key) span.appendChild(picture(key));
    span.appendChild(el('span', '', text));
    return span;
}

function lastName(path) {
    path = String(path || '');
    return path.slice(path.lastIndexOf('.') + 1);
}

/* The fields a settings page offers: every field of the data sets and the
 * calculated fields, an attribute under its owner when the owner is there. */
function availableFields(model) {
    var byPath = {};
    var order = [];
    function add(path, folder, title) {
        if (!path || own(byPath, path)) return;
        byPath[path] = { path: path, folder: folder, title: title || lastName(path), children: [] };
        order.push(byPath[path]);
    }
    allSets(model.sets, 0, []).forEach(function (x) {
        x.set.fields.forEach(function (f) { add(f.dataPath, f.kind === 'folder', f.title); });
    });
    model.calculated.forEach(function (c) { add(c.dataPath, false, c.title); });
    var roots = [];
    order.forEach(function (n) {
        var dot = n.path.lastIndexOf('.');
        var parent = dot > 0 ? own(byPath, n.path.slice(0, dot)) : '';
        if (parent) parent.children.push(n);
        else roots.push(n);
    });
    return roots;
}

/* Tokens of the 1C query language, just enough to colour a read-only query
 * where no code editor is available. */
var QUERY_WORDS = ('ВЫБРАТЬ РАЗРЕШЕННЫЕ РАЗЛИЧНЫЕ ПЕРВЫЕ КАК ИЗ ГДЕ И ИЛИ НЕ ЕСТЬ NULL ЛЕВОЕ ПРАВОЕ ПОЛНОЕ ВНУТРЕННЕЕ ' +
    'СОЕДИНЕНИЕ ПО СГРУППИРОВАТЬ УПОРЯДОЧИТЬ ИМЕЮЩИЕ ОБЪЕДИНИТЬ ВСЕ ПОМЕСТИТЬ УНИЧТОЖИТЬ ИНДЕКСИРОВАТЬ ВЫБОР ' +
    'КОГДА ТОГДА ИНАЧЕ КОНЕЦ МЕЖДУ В ИЕРАРХИИ ПОДОБНО УБЫВ ВОЗР ИТОГИ ОБЩИЕ ДЛЯ ИЗМЕНЕНИЯ ССЫЛКА ИСТИНА ЛОЖЬ ' +
    'НЕОПРЕДЕЛЕНО АВТОУПОРЯДОЧИВАНИЕ ПЕРИОДАМИ ХАРАКТЕРИСТИКИ ' +
    'SELECT ALLOWED DISTINCT TOP AS FROM WHERE AND OR NOT IS LEFT RIGHT FULL INNER JOIN ON GROUP BY ORDER ' +
    'HAVING UNION ALL INTO DROP INDEX CASE WHEN THEN ELSE END BETWEEN IN HIERARCHY LIKE DESC ASC TOTALS OVERALL ' +
    'FOR UPDATE REFS TRUE FALSE UNDEFINED').split(' ');
var QUERY_WORD_SET = {};
for (var qw = 0; qw < QUERY_WORDS.length; qw++) QUERY_WORD_SET[QUERY_WORDS[qw]] = true;

function highlightQuery(text) {
    var pre = el('pre', 'dcs-query-text');
    var re = /(\/\/[^\n]*)|("(?:[^"]|"")*"?)|(&[\wА-Яа-яЁё]+)|(\{[^}\n]*\}?)|(\d+(?:\.\d+)?)|([\wА-Яа-яЁё]+)|([\s\S])/g;
    var m;
    var plain = '';
    function flush() {
        if (plain) pre.appendChild(document.createTextNode(plain));
        plain = '';
    }
    function tok(cls, s) {
        flush();
        pre.appendChild(el('span', cls, s));
    }
    while ((m = re.exec(text))) {
        if (m[1]) tok('dcs-q-comment', m[1]);
        else if (m[2]) tok('dcs-q-string', m[2]);
        else if (m[3]) tok('dcs-q-param', m[3]);
        else if (m[4]) tok('dcs-q-brace', m[4]);
        else if (m[5]) tok('dcs-q-number', m[5]);
        else if (m[6] && own(QUERY_WORD_SET, m[6].toUpperCase())) tok('dcs-q-keyword', m[6]);
        else plain += m[0];
    }
    flush();
    return pre;
}

function render(model, container, options) {
    options = options || {};
    /* A semantic diff can annotate the ordinary Designer-like window without
     * forking its renderer. Removed rows use `beforeId` when the left model is
     * shown; current rows use `entityId`. */
    var diffKinds = {};
    var diffCounts = {};
    (options.diffEntries || []).forEach(function (entry) {
        var ids = [entry.entityId, entry.beforeId];
        for (var di = 0; di < ids.length; di++) if (ids[di]) diffKinds[ids[di]] = entry.kind || 'changed';
        if (entry.tab) diffCounts[entry.tab] = (diffCounts[entry.tab] || 0) + 1;
    });
    if (container._dcsDispose) { container._dcsDispose(); container._dcsDispose = null; }
    /* A window drawn over this one retires it before the old editor's blur. */
    if (container._dcsRetire) container._dcsRetire();
    var alive = true;
    container._dcsRetire = function () { alive = false; };
    container.innerHTML = '';
    container.className = 'dcs-root';
    if (!model) {
        container.appendChild(el('div', 'dcs-empty', 'Нет схемы компоновки данных'));
        return;
    }
    var disposers = [];
    container._dcsDispose = function () {
        for (var i = 0; i < disposers.length; i++) { try { disposers[i](); } catch (e) { /* ignore */ } }
        disposers = [];
    };
    var win = el('div', 'dcs-window');
    var caption = el('div', 'dcs-caption');
    var m = /[\\\/]Templates[\\\/]([^\\\/]+)[\\\/]Ext[\\\/]Template\.xml$/i.exec(options.filePath || '');
    caption.textContent = options.windowTitle || (m ? m[1] : 'Схема компоновки данных');
    win.appendChild(caption);
    var strip = el('div', 'dcs-tabs');
    var page = el('div', 'dcs-page');
    win.appendChild(strip);
    win.appendChild(page);
    container.appendChild(win);

    var tabButtons = {};
    var tabs = filledTabs(model);
    if (!tabs.some(function (t) { return t.id === viewState.tab; })) viewState.tab = tabs[0].id;
    tabs.forEach(function (tab) {
        var b = el('div', 'dcs-tab', tab.title);
        b.setAttribute('data-tab', tab.id);
        if (diffCounts[tab.id]) b.appendChild(el('span', 'dcs-diff-count', String(diffCounts[tab.id])));
        b.addEventListener('click', function () { showTab(tab.id); });
        strip.appendChild(b);
        tabButtons[tab.id] = b;
    });

    var rowsById = {};

    function notify(id) {
        if (options.onSelect && id) options.onSelect({ id: id });
    }

    function markSelected(id) {
        viewState.selected = id || '';
        var old = page.querySelectorAll('.dcs-selected');
        for (var i = 0; i < old.length; i++) old[i].classList.remove('dcs-selected');
        var row = id && rowsById[id];
        if (row) {
            row.classList.add('dcs-selected');
            if (row.scrollIntoView) { try { row.scrollIntoView({ block: 'nearest' }); } catch (e) { row.scrollIntoView(); } }
        }
        return row || null;
    }

    function collectRows(scope) {
        var rows = scope.querySelectorAll('[data-id]');
        for (var i = 0; i < rows.length; i++) {
            var rowId = rows[i].getAttribute('data-id');
            rowsById[rowId] = rows[i];
            if (diffKinds[rowId]) rows[i].classList.add('dcs-diff-' + diffKinds[rowId]);
        }
        /* The page outlives its redraws: one listener serves them all. */
        if (scope._dcsRowClicks) return;
        scope._dcsRowClicks = true;
        scope.addEventListener('click', function (e) {
            var row = e.target.closest && e.target.closest('[data-id]');
            if (!row || !scope.contains(row)) return;
            var id = row.getAttribute('data-id');
            markSelected(id);
            notify(id);
        });
    }

    /* Set while a page is drawn: an editor losing focus because its page goes
     * away must not write into the source in the middle of it. */
    var drawing = false;

    /* viewState общий для всех окон СКД, а у сравнения их два: какая вкладка
     * открыта в этом окне, помним отдельно. */
    var shownTab = null;
    function showTab(id) {
        container._dcsDispose();
        if (!tabButtons[id]) id = tabs[0].id;
        viewState.tab = id;
        shownTab = id;
        for (var k in tabButtons) {
            if (Object.prototype.hasOwnProperty.call(tabButtons, k)) tabButtons[k].classList.toggle('dcs-tab-active', k === id);
        }
        drawing = true;
        try {
            page.innerHTML = '';
            rowsById = {};
            var draw = PAGES[id];
            if (draw) draw();
        } finally {
            drawing = false;
        }
    }

    function label(text) {
        return el('div', 'dcs-label', text);
    }

    function row(cls) {
        var r = el('div', 'dcs-line' + (cls ? ' ' + cls : ''));
        for (var i = 1; i < arguments.length; i++) if (arguments[i]) r.appendChild(arguments[i]);
        return r;
    }

    function checkLabel(on, text, id, prop) {
        var span = el('span', 'dcs-check-label');
        span.appendChild(el('span', '', text));
        span.appendChild(id ? editCheck(id, prop, on) : check(on));
        return span;
    }

    // ------------------------------------------------------------ editing

    /* Properties a host lets the user change (options.onPropertyEdit): a text
     * cell opens an editor in place on double click, a checkbox flips on click.
     * The host writes each change into the source as one undoable edit and
     * hands the new source back; the window then redraws from it. */
    var editable = !!options.onPropertyEdit;

    function canEdit(id, prop) {
        return editable && propertyValue(model, id, prop) !== null;
    }

    function editText(id, prop, shown, cls) {
        var text = shown == null ? '' : String(shown);
        var span = el('span', 'dcs-cell-text' + (cls ? ' ' + cls : ''), text);
        if (canEdit(id, prop)) {
            span.classList.add('dcs-editable');
            span.setAttribute('data-edit', id);
            span.setAttribute('data-prop', prop);
            span.title = (text ? text + '\n\n' : '') + 'Двойной щелчок — изменить';
        } else if (text) span.title = text;
        return span;
    }

    function editCheck(id, prop, on, off) {
        var c = check(on, off);
        if (!off && canEdit(id, prop)) {
            c.classList.add('dcs-editable');
            c.setAttribute('data-edit', id);
            c.setAttribute('data-prop', prop);
            c.title = 'Щелчок — изменить';
        }
        return c;
    }

    function editRestrict(id, base, r, off) {
        return ['field', 'condition', 'group', 'order'].map(function (k) {
            return { v: editCheck(id, base + '.' + k, !off && r[k], off), cls: 'dcs-center' };
        });
    }

    function commit(id, prop, value) {
        if (!alive) return null;
        var res = options.onPropertyEdit(id, prop, value);
        if (res && res.source != null) reload(res.source);
        return res || null;
    }

    /* Redraws the open page from the edited source, where it was scrolled. */
    function reload(source) {
        var parsed = parse(source);
        if (!parsed.model) return;
        var boxes = page.querySelectorAll('.dcs-grid, .dcs-tree');
        var scrolls = [];
        for (var i = 0; i < boxes.length; i++) scrolls.push([boxes[i].scrollTop, boxes[i].scrollLeft]);
        model = parsed.model;
        flat = allSets(model.sets, 0, []);
        fieldTree = availableFields(model);
        showTab(viewState.tab);
        boxes = page.querySelectorAll('.dcs-grid, .dcs-tree');
        for (var k = 0; k < boxes.length && k < scrolls.length; k++) {
            boxes[k].scrollTop = scrolls[k][0];
            boxes[k].scrollLeft = scrolls[k][1];
        }
        var row = viewState.selected && rowsById[viewState.selected];
        if (row) row.classList.add('dcs-selected');
    }

    function openEditor(span) {
        var id = span.getAttribute('data-edit');
        var prop = span.getAttribute('data-prop');
        var current = propertyValue(model, id, prop);
        if (typeof current !== 'string') return;
        /* A choice of two flips at once, like a checkbox. */
        if (prop === 'use') { commit(id, prop, current === 'Always' ? 'Auto' : 'Always'); return; }
        var sv = prop === 'value' ? paramRecord(id) : null;
        if (sv && sv.kind === 'boolean') { commit(id, prop, current === 'Да' ? 'Нет' : 'Да'); return; }
        var cell = span.parentNode;
        var box = el('textarea', 'dcs-cell-editor');
        box.value = current;
        box.spellcheck = false;
        box.rows = Math.min(10, Math.max(1, current.split('\n').length));
        var message = el('div', 'dcs-cell-message');
        span.style.display = 'none';
        cell.classList.add('dcs-editing');
        cell.appendChild(box);
        cell.appendChild(message);
        box.focus();
        box.select();
        var done = false;
        function close() {
            done = true;
            if (box.parentNode) box.parentNode.removeChild(box);
            if (message.parentNode) message.parentNode.removeChild(message);
            span.style.display = '';
            cell.classList.remove('dcs-editing');
        }
        function save(leaving) {
            if (done) return;
            if (drawing || !alive || box.value === current) { close(); return; }
            done = true;
            var res = commit(id, prop, box.value);
            if (res && res.error) {
                done = false;
                if (leaving) { close(); return; }
                box.classList.add('dcs-cell-error');
                message.textContent = res.error;
                box.focus();
                return;
            }
            close();
        }
        box.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
            else if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); save(false); }
        });
        box.addEventListener('input', function () {
            box.rows = Math.min(10, Math.max(1, box.value.split('\n').length));
            box.classList.remove('dcs-cell-error');
            message.textContent = '';
        });
        box.addEventListener('blur', function () { save(true); });
        box.addEventListener('click', function (e) { e.stopPropagation(); });
        box.addEventListener('dblclick', function (e) { e.stopPropagation(); });
    }

    // ------------------------------------------------------------ adding

    /* Adding a record is written but too raw to offer, so the window never
     * shows the add buttons; `addEdit` stays for the host and the tests. */
    var adding = false;
    var hintLists = 0;

    /* Adds a record through the host and selects it. */
    function commitAdd(what, target, values) {
        if (!alive) return null;
        var res = options.onSchemaEdit(function (fresh) { return addEdit(fresh, what, target, values); });
        if (!res || res.error) return res || null;
        if (res.source != null) reload(res.source);
        if (res.id) {
            viewState.selected = res.id;
            markSelected(res.id);
            notify(res.id);
        }
        return res;
    }

    /* A small form under `anchor`: its fields are { key, label, value,
     * placeholder, hints, multiline }; submit(values) returns { error } to
     * keep the form open. Enter adds (Ctrl+Enter in a multi-line field), Esc
     * closes. */
    function addForm(anchor, title, fields, submit) {
        var old = win.querySelector('.dcs-add-form');
        if (old) old.parentNode.removeChild(old);
        var form = el('div', 'dcs-add-form');
        form.appendChild(el('div', 'dcs-add-title', title));
        var inputs = {};
        fields.forEach(function (f) {
            var line = el('label', 'dcs-add-line');
            line.appendChild(el('span', 'dcs-add-label', f.label));
            var input = el(f.multiline ? 'textarea' : 'input', 'dcs-add-input');
            if (!f.multiline) input.type = 'text';
            else input.rows = 3;
            input.spellcheck = false;
            input.value = f.value || '';
            if (f.placeholder) input.placeholder = f.placeholder;
            if (f.hints && f.hints.length) {
                var list = el('datalist');
                list.id = 'dcs-hints-' + (++hintLists);
                f.hints.forEach(function (h) { var o = el('option'); o.value = h; list.appendChild(o); });
                line.appendChild(list);
                input.setAttribute('list', list.id);
            }
            line.appendChild(input);
            form.appendChild(line);
            inputs[f.key] = input;
        });
        var message = el('div', 'dcs-cell-message dcs-add-message');
        var buttons = el('div', 'dcs-add-buttons');
        var ok = el('span', 'dcs-button', 'Добавить');
        var cancel = el('span', 'dcs-button', 'Отмена');
        buttons.appendChild(ok);
        buttons.appendChild(cancel);
        form.appendChild(message);
        form.appendChild(buttons);
        function close() {
            if (form.parentNode) form.parentNode.removeChild(form);
            document.removeEventListener('mousedown', outside, true);
        }
        function send() {
            var values = {};
            for (var k in inputs) if (Object.prototype.hasOwnProperty.call(inputs, k)) values[k] = inputs[k].value;
            var res = submit(values);
            if (res && res.error) { message.textContent = res.error; return; }
            close();
        }
        function outside(e) { if (!form.contains(e.target) && e.target !== anchor && !anchor.contains(e.target)) close(); }
        form.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
            else if (e.key === 'Enter' && (e.target.tagName !== 'TEXTAREA' || e.ctrlKey)) { e.preventDefault(); send(); }
        });
        form.addEventListener('input', function () { message.textContent = ''; });
        ok.addEventListener('click', send);
        cancel.addEventListener('click', close);
        document.addEventListener('mousedown', outside, true);
        var a = anchor.getBoundingClientRect();
        var w = win.getBoundingClientRect();
        form.style.top = (a.bottom - w.top + 2) + 'px';
        win.appendChild(form);
        /* Under the button, but inside the window when the window is narrow. */
        var visible = container.getBoundingClientRect();
        var right = Math.min(w.right, visible.right) - w.left;
        form.style.left = Math.max(Math.max(0, visible.left - w.left), Math.min(a.left - w.left, right - form.offsetWidth - 4)) + 'px';
        var first = inputs[fields[0].key];
        first.focus();
        first.select();
        return form;
    }

    function addSetField(set, button) {
        var have = {};
        set.fields.forEach(function (f) { have[f.field] = true; have[f.dataPath] = true; });
        var hints = set.query ? queryColumns(set.query.text).filter(function (c) { return !have[c]; }) : [];
        addForm(button, 'Новое поле набора «' + set.name + '»', [
            { key: 'dataPath', label: 'Путь к данным', hints: hints, placeholder: hints.length ? 'колонка запроса или своё имя' : '' },
            { key: 'field', label: 'Поле', placeholder: 'как путь к данным' }
        ], function (v) { return commitAdd('field', set.id, v); });
    }

    function addCalculated(button) {
        addForm(button, 'Новое вычисляемое поле', [
            { key: 'dataPath', label: 'Путь к данным' },
            { key: 'expression', label: 'Выражение', multiline: true, placeholder: 'Ctrl+Enter — добавить' }
        ], function (v) { return commitAdd('calc', null, v); });
    }

    function addTotal(button, path) {
        if (path) return commitAdd('total', null, { dataPath: path });
        var paths = [];
        (function walk(nodes) {
            nodes.forEach(function (n) { if (!n.folder) paths.push(n.path); walk(n.children); });
        })(fieldTree);
        return addForm(button, 'Новый ресурс', [
            { key: 'dataPath', label: 'Поле', hints: paths },
            { key: 'expression', label: 'Выражение', placeholder: 'Сумма(Поле)' }
        ], function (v) { return commitAdd('total', null, v); });
    }

    function paramRecord(id) {
        for (var i = 0; i < model.parameters.length; i++) if (model.parameters[i].id === id) return model.parameters[i].simpleValue;
        return null;
    }

    if (editable) {
        page.addEventListener('click', function (e) {
            var c = e.target.closest && e.target.closest('.dcs-check.dcs-editable');
            if (!c) return;
            var id = c.getAttribute('data-edit');
            var prop = c.getAttribute('data-prop');
            var on = propertyValue(model, id, prop);
            if (typeof on === 'boolean') commit(id, prop, !on);
        });
        page.addEventListener('dblclick', function (e) {
            var span = e.target.closest && e.target.closest('.dcs-cell-text.dcs-editable');
            if (!span) return;
            e.preventDefault();
            openEditor(span);
        });
    }

    /* "Доступные поля" of the resources and settings pages. */
    var fieldTree = availableFields(model);

    /* Ресурсы схемы: конфигуратор рисует их зелёной иконкой, остальные поля —
     * синей, а группу — папкой. */
    var resourcePaths = {};
    model.totals.forEach(function (t) { if (t.dataPath) resourcePaths[t.dataPath] = true; });

    function fieldPicture(path, folder) {
        if (folder) return picture('folder');
        if (!path) return null;
        return picture(own(resourcePaths, path) ? 'resource' : 'field');
    }

    function fieldsPanel(extra) {
        var box = el('div', 'dcs-grid dcs-available');
        var table = el('table');
        var head = el('tr', 'dcs-head');
        head.appendChild(el('th', '', 'Доступные поля'));
        var thead = el('thead');
        thead.appendChild(head);
        table.appendChild(thead);
        var body = el('tbody');
        function add(n, depth) {
            var tr = el('tr', 'dcs-row');
            if (!n.folder) tr.setAttribute('data-path', n.path);
            var td = el('td');
            td.style.paddingLeft = (6 + depth * 16) + 'px';
            var span = el('span', 'dcs-cell-icon');
            span.appendChild(treeMark(n.collapsed ? 'plus' : n.children.length ? 'minus' : 'leaf'));
            var pic = fieldPicture(n.path, n.folder);
            if (pic) span.appendChild(pic);
            span.appendChild(el('span', '', n.title));
            span.title = n.path;
            td.appendChild(span);
            tr.appendChild(td);
            body.appendChild(tr);
            if (!n.collapsed) for (var i = 0; i < n.children.length; i++) add(n.children[i], depth + 1);
        }
        fieldTree.concat(extra || []).forEach(function (n) { add(n, 0); });
        table.appendChild(body);
        box.appendChild(table);
        return box;
    }

    var SYSTEM_FIELDS = { path: 'СистемныеПоля', title: 'СистемныеПоля', folder: true, collapsed: true, children: [] };
    var DATA_PARAMETERS = { path: 'ПараметрыДанных', title: 'ПараметрыДанных', folder: true, collapsed: true, children: [] };

    // ------------------------------------------------------------- sets

    var flat = allSets(model.sets, 0, []);

    function drawSets() {
        var split = el('div', 'dcs-split dcs-sets');
        var left = el('div', 'dcs-column dcs-sets-left');
        var tree = el('div', 'dcs-tree');
        tree.appendChild(treeRow('tab:sets', 0, 'group', 'Наборы данных', false, '', 'minus'));
        for (var i = 0; i < flat.length; i++) {
            var s = flat[i].set;
            tree.appendChild(treeRow(s.id, flat[i].depth + 1, s.kind === 'DataSetUnion' ? 'union' : 'set', s.name, true, s.kindTitle,
                s.items.length ? 'minus' : ''));
        }
        left.appendChild(tree);
        split.appendChild(left);
        var right = el('div', 'dcs-column dcs-set-body');
        split.appendChild(right);
        page.appendChild(split);
        var current = null;
        for (var j = 0; j < flat.length; j++) if (flat[j].set.id === viewState.set) current = flat[j].set;
        if (!current && flat.length) current = flat[0].set;
        if (current) {
            viewState.set = current.id;
            var sel = tree.querySelector('[data-set="' + cssEscape(current.id) + '"]');
            if (sel) sel.classList.add('dcs-current');
            drawSet(current, right);
        } else {
            right.appendChild(el('div', 'dcs-grid-empty', 'Нет наборов данных'));
        }
        tree.addEventListener('click', function (e) {
            var r = e.target.closest && e.target.closest('[data-set]');
            if (!r) return;
            var id = r.getAttribute('data-set');
            viewState.set = id;
            showTab('sets');
            markSelected(id);
            notify(id);
        });
        collectRows(page);
    }

    function treeRow(id, depth, pic, text, isSet, hint, mark) {
        var r = el('div', 'dcs-tree-row');
        r.style.paddingLeft = (4 + depth * 20) + 'px';
        r.setAttribute('data-id', id);
        if (isSet) r.setAttribute('data-set', id);
        r.appendChild(mark ? treeMark(mark) : el('span', 'dcs-mark'));
        r.appendChild(picture(pic));
        r.appendChild(el('span', 'dcs-tree-name', text));
        if (hint) r.title = hint;
        return r;
    }

    /* The fields of a data set in the Designer's two-line layout. */
    function fieldsGrid(set) {
        var head = [
            [{ title: '', rs: 4 }, { title: 'Поле', rs: 4 }, { title: 'Путь', cs: 2 }, { title: 'Ограничение поля', cs: 4 },
                { title: 'Роль', rs: 4 }, { title: 'Выражение представления' }, { title: 'Проверка иерархии:' },
                { title: 'Тип значения' }, { title: 'Оформление' }],
            [{ title: '', rs: 3 }, { title: 'Заголовок', rs: 3 }, { title: 'Поле' }, { title: 'Условие' }, { title: 'Группа' },
                { title: 'Упорядочивание' }, { title: 'Выражения упорядочивания', rs: 3 }, { title: 'Набор данных' },
                { title: 'Доступные значения', rs: 3 }, { title: 'Параметры редактирования', rs: 3 }],
            [{ title: 'Ограничение реквизитов', cs: 4 }, { title: 'Параметр', rs: 2 }],
            [{ title: 'Поле' }, { title: 'Условие' }, { title: 'Группа' }, { title: 'Упорядочивание' }]
        ];
        return stackedGrid([22, 111, 26, 195, 40, 40, 40, 40, 111, 111, 221, 111, 111], head, set.fields, function (f) {
            /* A primitive field has no attributes to restrict. */
            var noAttributes = f.kind === 'folder' || !/[.]/.test(f.type) && !/Ссылка|ref/i.test(f.type);
            var nameCell = el('span', 'dcs-cell-icon' + (f.kind === 'folder' ? ' dcs-folder' : ''));
            if (f.kind === 'folder') nameCell.appendChild(picture('folder'));
            nameCell.appendChild(el('span', '', f.kind === 'folder' ? f.dataPath : f.field || f.dataPath));
            /* A folder or a nested set has no use restrictions of its own. */
            var plainField = f.kind === 'field';
            return [
                [{ v: treeMark(f.kind === 'folder' ? 'minus' : 'leaf'), rs: 2, cls: 'dcs-center' }, { v: nameCell, rs: 2, cls: 'dcs-f-name' },
                    { v: f.dataPath, cs: 2 }].concat(plainField ? editRestrict(f.id, 'restrict', f.restrict, false) : restrictCells(f.restrict, false), [
                    { v: f.role, rs: 2 }, { v: plainField ? editText(f.id, 'presentationExpression', f.presentation) : f.presentation },
                    { v: f.hierarchySet }, { v: f.type }, { v: f.appearance }]),
                [{ v: check(!f.title), cls: 'dcs-center' },
                    { v: editText(f.id, 'title', f.title || lastName(f.dataPath), f.title ? '' : 'dcs-auto') }].concat(
                    plainField ? editRestrict(f.id, 'attrRestrict', f.attrRestrict, noAttributes) : restrictCells(f.attrRestrict, noAttributes), [
                    { v: f.order }, { v: f.hierarchyParameter }, { v: f.available }, { v: f.editParameters }])
            ];
        }, { cls: 'dcs-fields', empty: set.kind === 'DataSetQuery' && set.autoFill ? 'Поля заполняются автоматически по запросу' : '' });
    }

    function drawSet(set, host) {
        var tools = set.kind === 'DataSetUnion' ? ['add', 'copy', 'folder', 'remove'] : ['add', 'copy', 'folder', 'nested', 'remove'];
        var setTools = toolbar(tools, '', adding ? { add: function (b) { addSetField(set, b); } } : null);
        host.appendChild(setTools ? row('', label('Поля:'), el('span', 'dcs-fill'), setTools) : row('', label('Поля:')));
        var fields = fieldsGrid(set);
        host.appendChild(fields);
        if (set.query) {
            if (viewState.fieldsHeight) fields.style.height = viewState.fieldsHeight + 'px';
            host.appendChild(rowSplitter(fields, host));
        }
        if (set.kind === 'DataSetObject') {
            host.appendChild(row('', label('Имя объекта, содержащего данные:'), el('span', 'dcs-input', set.objectName)));
        }
        if (set.source && model.sources.length > 1) {
            host.appendChild(row('', label('Источник данных:'), el('span', 'dcs-input', set.source)));
        }
        if (set.query) {
            host.appendChild(row('', label('Запрос:')));
            host.appendChild(queryBox(set));
            host.appendChild(row('dcs-query-flags', checkLabel(set.autoFill, 'Автозаполнение', set.id, 'autoFillFields'),
                checkLabel(set.useQueryGroup, 'Использовать группировки запроса если возможно', set.id, 'useQueryGroupIfPossible')));
        }
    }

    /* A drag bar under the fields grid: it trades height between the fields and
     * the query below, and the height outlives switching sets and tabs. */
    function rowSplitter(pane, host) {
        var bar = el('div', 'dcs-row-splitter');
        bar.title = 'Перетащите, чтобы изменить высоту';
        bar.addEventListener('pointerdown', function (e) {
            if (e.button !== 0) return;
            e.preventDefault();
            var startY = e.clientY;
            var startH = pane.getBoundingClientRect().height;
            /* The query area stretches into whatever is left; it keeps its 80px minimum. */
            var query = host.querySelector('.dcs-query-area');
            var maxH = startH + (query ? query.getBoundingClientRect().height - 80 : 0);
            bar.setPointerCapture(e.pointerId);
            bar.classList.add('dcs-dragging');
            function move(ev) {
                var h = Math.round(Math.min(Math.max(startH + ev.clientY - startY, 60), Math.max(60, maxH)));
                pane.style.height = h + 'px';
                viewState.fieldsHeight = h;
            }
            function up() {
                bar.classList.remove('dcs-dragging');
                bar.removeEventListener('pointermove', move);
                bar.removeEventListener('pointerup', up);
                bar.removeEventListener('pointercancel', up);
            }
            bar.addEventListener('pointermove', move);
            bar.addEventListener('pointerup', up);
            bar.addEventListener('pointercancel', up);
        });
        return bar;
    }

    /* Запрос только показывается: правится он в исходнике или в конструкторе
     * запроса, а не здесь. */
    function queryBox(set) {
        var area = el('div', 'dcs-query-area');
        var editor = options.queryEditor
            ? options.queryEditor(area, set.query.text, { readOnly: true }) : null;
        if (editor) disposers.push(function () { if (editor.dispose) editor.dispose(); });
        else area.appendChild(highlightQuery(set.query.text));
        return area;
    }

    // ---------------------------------------------------- simple tables

    function drawTable(tools, g, actions) {
        var bar = tools ? toolbar(tools, '', actions) : null;
        if (bar) page.appendChild(bar);
        page.appendChild(g);
        collectRows(page);
    }

    function col(title, width, key) {
        return { title: title, width: width, get: typeof key === 'function' ? key : function (r) { return r[key]; } };
    }

    function checkCol(title, width, key) {
        return { title: title, width: width, get: function (r) { return check(r[key]); } };
    }

    function editCheckCol(title, width, key, prop) {
        return { title: title, width: width, get: function (r) { return editCheck(r.id, prop, r[key]); } };
    }

    function drawLinks() {
        drawTable(['add', 'copy', 'remove'], grid([
            col('Источник связи', 171, 'source'), col('Приемник связи', 171, 'dest'),
            col('Выражение источник', 171, function (r) { return editText(r.id, 'sourceExpression', r.sourceExpr); }),
            col('Выражение приемник', 171, function (r) { return editText(r.id, 'destinationExpression', r.destExpr); }),
            col('Параметр', 171, 'parameter'), checkCol('Список параметров', 171, 'parameterList'),
            col('Условие связи', 171, function (r) { return editText(r.id, 'linkConditionExpression', r.condition); }),
            col('Начальное значение связи', 171, function (r) { return editText(r.id, 'startExpression', r.start); }),
            checkCol('Обязательная связь', 34, 'required')
        ], model.links, { cls: 'dcs-full' }));
    }

    function drawCalculated() {
        var head = [
            [{ title: 'Путь к данным', rs: 2 }, { title: 'Выражение', rs: 2 }, { title: 'Заголовок', rs: 2 },
                { title: 'Ограничение доступности', cs: 4 }, { title: 'Выражение представления', rs: 2 },
                { title: 'Выражения упорядочивания', rs: 2 }, { title: 'Тип значения', rs: 2 },
                { title: 'Доступные значения', rs: 2 }, { title: 'Оформление' }],
            [{ title: 'Поле' }, { title: 'Условие' }, { title: 'Группа' }, { title: 'Упорядочивание' }, { title: 'Параметры ввода' }]
        ];
        drawTable(['add', 'copy', 'remove'], stackedGrid([148, 148, 148, 54, 54, 54, 52, 148, 148, 148, 148, 152], head,
            model.calculated, function (c) {
                return [
                    [{ v: c.dataPath, rs: 2 }, { v: editText(c.id, 'expression', c.expression), rs: 2 },
                        { v: editText(c.id, 'title', c.title || lastName(c.dataPath), c.title ? '' : 'dcs-auto'), rs: 2 }]
                        .concat(editRestrict(c.id, 'restrict', c.restrict, false).map(function (x) { x.rs = 2; return x; }), [
                        { v: editText(c.id, 'presentationExpression', c.presentation), rs: 2 }, { v: c.order, rs: 2 },
                        { v: c.type, rs: 2 }, { v: c.available, rs: 2 },
                        { v: c.appearance }]),
                    [{ v: c.editParameters }]
                ];
            }, { cls: 'dcs-full' }), adding ? { add: addCalculated } : null);
    }

    function drawTotals() {
        var split = el('div', 'dcs-split dcs-totals');
        var panel = fieldsPanel();
        split.appendChild(panel);
        split.appendChild(grid([
            col('Поле', 325, function (r) { return r.dataPath; }),
            col('Выражение', 309, function (r) { return editText(r.id, 'expression', r.expression); }),
            col('Рассчитывать по...', 320, function (r) { return r.groups.join(', '); })
        ], model.totals, { cls: 'dcs-full' }));
        page.appendChild(split);
        collectRows(page);
    }

    function drawParameters() {
        drawTable(['add', 'copy', 'remove', 'up', 'down'], grid([
            col('Имя', 125, 'name'),
            col('Заголовок', 125, function (r) { return editText(r.id, 'title', r.title || terms.identWords(r.name) || r.name, r.title ? '' : 'dcs-auto'); }),
            col('Тип', 150, 'type'),
            col('Доступные значения', 125, 'available'), checkCol('Доступен список значений', 31, 'valueList'),
            col('Значение', 150, function (r) { return editText(r.id, 'value', r.value); }),
            col('Выражение', 130, function (r) { return editText(r.id, 'expression', r.expression); }),
            col('Параметр функциональной опции', 125, 'functionalOption'),
            editCheckCol('Включать в доступные поля', 31, 'availableAsField', 'availableAsField'),
            editCheckCol('Ограничение доступности', 31, 'restricted', 'useRestriction'),
            editCheckCol('Запрещать незаполненные значения', 31, 'denyIncomplete', 'denyIncompleteValues'),
            col('Использование', 113, function (r) { return editText(r.id, 'use', r.use); }),
            col('Параметры редактирования', 235, 'editParameters')
        ], model.parameters, { cls: 'dcs-full' }));
    }

    function drawTemplates() {
        var split = el('div', 'dcs-split dcs-templates');
        var left = el('div', 'dcs-column dcs-templates-left');
        var current = null;
        for (var i = 0; i < model.templates.length; i++) if (model.templates[i].id === viewState.template) current = model.templates[i];
        if (!current) current = model.templates[0] || null;
        var list = grid([col('Макет', 308, 'title'), col('Область', 150, 'name')],
            model.templates, { cls: 'dcs-template-list' });
        left.appendChild(list);
        left.appendChild(label('Параметры макета:'));
        left.appendChild(grid([col('Имя параметра', 221, 'name'), col('Выражение', 221, 'expression')],
            current ? current.parameters : [], { cls: 'dcs-template-params' }));
        split.appendChild(left);
        var sheet = el('div', 'dcs-sheet');
        sheet.appendChild(drawArea(current));
        split.appendChild(sheet);
        page.appendChild(split);
        collectRows(page);
        if (current && rowsById[current.id]) rowsById[current.id].classList.add('dcs-current');
        list.addEventListener('click', function (e) {
            var r = e.target.closest && e.target.closest('[data-id]');
            if (!r) return;
            var id = r.getAttribute('data-id');
            if (id === viewState.template) return;
            viewState.template = id;
            showTab('templates');
            markSelected(id);
        });
    }

    /* The area of the selected template, drawn on its own: rows of cells with
     * the widths the appearance states. The Designer instead lays all areas of
     * the template into one spreadsheet and gives each an address there, which
     * the schema does not store; pictures and style colours are named in the
     * hint of a cell, as the window cannot resolve them. */
    function drawArea(tpl) {
        var box = el('div', 'dcs-area');
        if (!tpl || !tpl.area) {
            box.appendChild(el('div', 'dcs-grid-empty', tpl ? 'Область пуста' : 'Макетов нет'));
            return box;
        }
        var table = el('table', 'dcs-area-table');
        for (var r = 0; r < tpl.area.rows.length; r++) {
            var tr = el('tr');
            var cells = tpl.area.rows[r].cells;
            for (var c = 0; c < cells.length; c++) {
                var cell = cells[c];
                var td = el('td', 'dcs-area-cell'
                    + (cell.rotated ? ' dcs-area-rotated' : '')
                    + (cell.wrap ? ' dcs-area-wrap' : '')
                    + (cell.picture ? ' dcs-area-picture' : ''));

                if (cell.valign) td.style.verticalAlign = cell.valign;
                if (cell.halign) td.style.textAlign = cell.halign;
                if (cell.indent) td.style.paddingLeft = (3 + cell.indent * AREA_CHAR_PX) + 'px';
                var text = cell.kind === 'param' ? '<' + cell.text + '>' : cell.text;
                var span = el('span', 'dcs-area-text', text);
                /* The width belongs to the text, not to the cell: the Designer
                 * cuts a value the column cannot hold, and a table cell of
                 * its own width would grow instead. */
                if (cell.width) span.style.width = Math.round(cell.width * AREA_CHAR_PX) + 'px';
                td.appendChild(span);
                if (cell.note) td.title = cell.note;
                tr.appendChild(td);
            }
            if (!cells.length) tr.appendChild(el('td', 'dcs-area-cell'));
            table.appendChild(tr);
        }
        box.appendChild(table);
        return box;
    }

    function drawNested() {
        drawTable(['add', 'copy', 'remove'], grid([
            col('Имя', 350, 'name'), col('Заголовок', 350, 'title'),
            col('Схема', 350, function (r) { return r.setNames.join(', '); }),
            col('Настройки', 350, function (r) { return r.settings ? 'Заданы' : ''; })
        ], model.nested, { cls: 'dcs-full' }));
    }

    // --------------------------------------------------------- settings

    /* The Designer's tabs under the structure, in its order. */
    var SETTINGS_TABS = [
        { id: 'groupFields', title: 'Поля группировки', group: true },
        { id: 'selection', title: 'Выбранные поля' },
        { id: 'filter', title: 'Отбор' },
        { id: 'order', title: 'Сортировка' },
        { id: 'appearance', title: 'Условное оформление' },
        { id: 'userFields', title: 'Пользовательские поля', root: true },
        { id: 'dataParameters', title: 'Параметры данных', root: true, parameters: true },
        { id: 'outputParameters', title: 'Другие настройки' }
    ];

    function findNode(node, id) {
        if (!node) return null;
        if (node.id === id) return node;
        for (var i = 0; i < node.children.length; i++) {
            var hit = findNode(node.children[i], id);
            if (hit) return hit;
        }
        return null;
    }

    function drawSettings() {
        var wrap = el('div', 'dcs-split dcs-settings');
        var left = el('div', 'dcs-column dcs-variants');
        var variant = model.variants.length ? model.variants[Math.min(viewState.variant, model.variants.length - 1)] : null;
        var variants = grid([col('Имя варианта', 148, 'name'), col('Представление', 148, 'presentation')],
            model.variants, { cls: 'dcs-variant-list' });
        left.appendChild(variants);
        wrap.appendChild(left);
        variants.addEventListener('click', function (e) {
            var r = e.target.closest && e.target.closest('[data-id]');
            if (!r) return;
            for (var v = 0; v < model.variants.length; v++) {
                if (model.variants[v].id !== r.getAttribute('data-id')) continue;
                viewState.variant = v;
                viewState.node = '';
                showTab('settings');
                markSelected(model.variants[v].id);
                notify(model.variants[v].id);
            }
        });
        var right = el('div', 'dcs-column dcs-settings-right');
        wrap.appendChild(right);
        page.appendChild(wrap);
        var rootNode = variant && variant.root;
        var node = findNode(rootNode, viewState.node) || rootNode;
        viewState.node = node ? node.id : '';

        var tree = el('div', 'dcs-tree dcs-structure');
        function addNode(n, depth) {
            var r = el('div', 'dcs-tree-row' + (n === node ? ' dcs-current' : '') + (n.use ? '' : ' dcs-unused'));
            r.style.paddingLeft = (4 + depth * 20) + 'px';
            r.setAttribute('data-id', n.id);
            r.setAttribute('data-node', n.id);
            r.appendChild(treeMark(n.children.length && n.kind !== 'root' ? 'minus' : ''));
            if (n.kind !== 'root' && n.kind !== 'axis') r.appendChild(check(n.use));
            r.appendChild(picture(n.kind === 'group' ? 'groupNode' : n.kind));
            r.appendChild(el('span', 'dcs-tree-name' + (n.detail ? ' dcs-detail' : ''), n.detail ? '<' + n.title + '>' : n.title));
            tree.appendChild(r);
            for (var i = 0; i < n.children.length; i++) addNode(n.children[i], depth + 1);
        }
        if (rootNode) addNode(rootNode, 0);
        right.appendChild(tree);
        tree.addEventListener('click', function (e) {
            var r = e.target.closest && e.target.closest('[data-node]');
            if (!r) return;
            viewState.node = r.getAttribute('data-node');
            showTab('settings');
            markSelected(viewState.node);
            notify(viewState.node);
        });
        if (node) {
            var title = node.detail ? '<' + node.title + '>' : node.title;
            right.appendChild(row('dcs-node-line', label('Настройки:'), el('span', 'dcs-chip', title), el('span', 'dcs-node-title', title)));
            right.appendChild(nodeSettings(node, node === rootNode));
        }
        collectRows(left);
        var rows = tree.querySelectorAll('[data-id]');
        for (var r = 0; r < rows.length; r++) rowsById[rows[r].getAttribute('data-id')] = rows[r];
        if (variant && rowsById[variant.id]) rowsById[variant.id].classList.add('dcs-current');
    }

    function nodeSettings(node, isRoot) {
        var box = el('div', 'dcs-node-settings');
        var tabs = el('div', 'dcs-tabs dcs-subtabs');
        var body = el('div', 'dcs-subpage');
        var shown = SETTINGS_TABS.filter(function (t) {
            if (t.root && !isRoot) return false;
            if (t.group && node.kind !== 'group') return false;
            if (t.parameters && !model.parameters.length && !node.dataParameters.length) return false;
            if (node.kind === 'axis') return false;
            /* Group fields stay: an empty list is «Детальные записи», not nothing. */
            return t.id === 'groupFields' || (node[t.id] || []).length > 0;
        });
        if (!shown.length) {
            body.appendChild(el('div', 'dcs-grid-empty', 'Выберите группировку'));
            box.appendChild(body);
            return box;
        }
        var active = shown.filter(function (t) { return t.id === viewState.settingsTab; })[0] || shown[0];
        shown.forEach(function (t) {
            var b = el('div', 'dcs-tab' + (t === active ? ' dcs-tab-active' : ''), t.title);
            b.addEventListener('click', function () {
                viewState.settingsTab = t.id;
                box.parentNode.replaceChild(nodeSettings(node, isRoot), box);
            });
            tabs.appendChild(b);
        });
        box.appendChild(tabs);
        box.appendChild(body);
        body.appendChild(settingsPage(active.id, node[active.id] || []));
        return box;
    }

    /* A settings page: the available fields where the Designer offers them,
     * the grid and the grid's command bar down its right side. */
    function settingsPage(kind, rows) {
        var pageBox = el('div', 'dcs-split dcs-settings-page');
        if (kind === 'selection' || kind === 'filter' || kind === 'order' || kind === 'groupFields') {
            pageBox.appendChild(fieldsPanel(kind === 'selection' ? [SYSTEM_FIELDS]
                : kind === 'filter' && model.parameters.length ? [DATA_PARAMETERS] : []));
        }
        pageBox.appendChild(settingsGrid(kind, rows));
        return pageBox;
    }

    /* Selected fields and filter items hang under a root row, as the
     * Designer shows them. */
    function underRoot(title, rows) {
        return [{ root: true, depth: 0, text: title }].concat(rows.map(function (r) {
            var copy = {};
            for (var k in r) if (Object.prototype.hasOwnProperty.call(r, k)) copy[k] = r[k];
            copy.depth = (r.depth || 0) + 1;
            return copy;
        }));
    }

    function settingsGrid(kind, rows) {
        var name = function (title, width) {
            return { title: title, width: width || 240, get: function (r) {
                var span = el('span', 'dcs-setting-name' + (r.folder ? ' dcs-folder' : '') + (r.root ? ' dcs-root-name' : ''));
                var pic = r.root ? picture('root') : fieldPicture(r.path, r.folder);
                if (pic) span.appendChild(pic);
                /* Своё представление поля конфигуратор пишет вместе с самим
                 * полем: «Начальный остаток (КоличествоНачальныйОстаток)». */
                var text = r.title && r.path ? r.title + ' (' + r.path + ')' : r.text;
                span.appendChild(el('span', '', text));
                if (r.path && r.path !== text) span.title = r.path;
                return span;
            } };
        };
        var opts = { lead: true, cls: 'dcs-settings-grid' };
        switch (kind) {
            case 'selection':
                return grid([name('Поле', 420),
                    col('Размещение', 180, function (r) { return r.placement || ''; })],
                    underRoot('Выбранные поля', rows), opts);
            case 'filter':
                return grid([name('Поле', 260), col('Вид сравнения', 150, function (r) { return r.comparison || ''; }),
                    col('Значение', 200, function (r) { return r.value || ''; }),
                    col('Представление', 160, function (r) { return r.presentation || ''; })],
                    underRoot('Отбор', rows), opts);
            case 'order':
                return grid([name('Поле', 340), col('Направление сортировки', 340, function (r) { return r.direction || ''; })], rows, opts);
            case 'appearance':
                return grid([name('Оформление', 206), col('Условие', 206, 'condition'), col('Оформляемые поля', 206, 'fields'),
                    col('Представление', 206, function (r) { return r.presentation || ''; }),
                    col('Область использования', 180, function () { return ''; })], rows, opts);
            case 'groupFields':
                return grid([name('Поле', 260), col('Тип группировки', 130, function (r) { return r.groupType || ''; }),
                    col('Тип дополнения', 120, function (r) { return r.period || ''; })], rows, opts);
            case 'userFields':
                return grid([name('Пользовательские поля', 600)], rows, opts);
            default:
                return grid([name('Параметр', 510), col('Значение', 500, function (r) { return r.value || ''; })], rows, opts);
        }
    }

    var PAGES = {
        sets: drawSets, links: drawLinks, calculated: drawCalculated, totals: drawTotals,
        parameters: drawParameters, templates: drawTemplates, nested: drawNested, settings: drawSettings
    };

    /* Which tab and which row an outline id stands for. */
    function locate(id) {
        id = String(id || '');
        if (id.indexOf('tab:') === 0) return { tab: id.slice(4) };
        if (id.indexOf('set:') === 0) return { tab: 'sets', set: id };
        if (id.indexOf('field:') === 0) {
            for (var i = 0; i < flat.length; i++) {
                for (var f = 0; f < flat[i].set.fields.length; f++)
                    if (flat[i].set.fields[f].id === id) return { tab: 'sets', set: flat[i].set.id };
            }
            return { tab: 'sets' };
        }
        var prefixes = { link: 'links', calc: 'calculated', total: 'totals', param: 'parameters', tpl: 'templates', nested: 'nested' };
        var head = id.slice(0, id.indexOf(':'));
        if (head === 'tpl') return { tab: 'templates', template: id };
        if (own(prefixes, head)) return { tab: prefixes[head] };
        if (head === 'variant') {
            for (var v = 0; v < model.variants.length; v++) {
                var vid = model.variants[v].id;
                if (id === vid) return { tab: 'settings', variant: v, node: '' };
                if (id.indexOf(vid + '/') === 0) return { tab: 'settings', variant: v, node: id };
            }
        }
        return null;
    }

    container._dcsSelect = function (id) {
        var where = locate(id);
        if (!where) return null;
        var redraw = where.tab !== shownTab;
        if (where.set && where.set !== viewState.set) { viewState.set = where.set; redraw = true; }
        if (where.template && where.template !== viewState.template) { viewState.template = where.template; redraw = true; }
        if (where.variant != null && (where.variant !== viewState.variant || where.node !== viewState.node)) {
            viewState.variant = where.variant;
            viewState.node = where.node;
            redraw = true;
        }
        if (redraw) showTab(where.tab);
        return markSelected(id);
    };
    container._dcsShowTab = function (id) {
        if (id && id !== shownTab) showTab(id);
    };

    showTab(viewState.tab);
    if (viewState.selected) markSelected(viewState.selected);
}

function cssEscape(s) {
    return String(s).replace(/["\\]/g, '\\$&');
}

/* Открыть вкладку без выделения: у сравнения на той стороне, где элемента
 * нет, вкладка должна совпасть с соседней. */
function showTab(container, id) {
    if (container && container._dcsShowTab) container._dcsShowTab(String(id || ''));
}

function highlight(container, id) {
    if (!container || !container._dcsSelect) return null;
    return container._dcsSelect(String(id || ''));
}

root.DcsPreview = {
    detect: detect,
    parse: parse,
    render: render,
    outline: outline,
    inspector: inspector,
    outlineIcon: outlineIcon,
    outlineHidden: outlineHidden,
    outlineExpandTo: outlineExpandTo,
    outlineCollapseAll: outlineCollapseAll,
    outlineSortByName: outlineSortByName,
    highlight: highlight,
    showTab: showTab,
    itemKey: itemKey,
    resetViewState: resetViewState,
    propertyValue: propertyValue,
    propertyEdit: propertyEdit,
    applyProperty: applyProperty,
    addEdit: addEdit,
    applyAdd: applyAdd,
    queryColumns: queryColumns,
    highlightQuery: highlightQuery
};

})(typeof globalThis !== 'undefined' ? globalThis : window);
