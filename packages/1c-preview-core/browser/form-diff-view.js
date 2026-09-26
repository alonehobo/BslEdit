/* Compact, copyable presentation of a semantic managed-form diff. */
(function (root) {
'use strict';
var TYPE = { form: 'Форма', element: 'Элемент', attribute: 'Реквизит', command: 'Команда' };
var KIND = { added: 'Добавлено', removed: 'Удалено', changed: 'Изменено' };
function el(doc, tag, cls, text) { var n = doc.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
function shown(v) { return v == null || v === '' ? '—' : String(v); }
function presented(value, property) {
    var raw = shown(value);
    if (raw === '—') return raw;
    var terms = root.XmlUtil && root.XmlUtil.terms;
    var readable = terms && terms.presentValue ? terms.presentValue(raw, property) : '';
    return readable || raw;
}
function colorCss(property, value) {
    if (!/(?:color|цвет)/i.test(String(property || ''))) return '';
    var raw = String(value == null ? '' : value).trim();
    if (/^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(raw)) return raw;
    var web = /^web:([a-z]+)$/i.exec(raw);
    if (web) return web[1];
    var rgb = /^(\d{1,3})\s*[,;]\s*(\d{1,3})\s*[,;]\s*(\d{1,3})$/.exec(raw);
    if (rgb && Number(rgb[1]) <= 255 && Number(rgb[2]) <= 255 && Number(rgb[3]) <= 255)
        return 'rgb(' + Number(rgb[1]) + ',' + Number(rgb[2]) + ',' + Number(rgb[3]) + ')';
    return '';
}
function valueNode(doc, cls, property, value) {
    var cssColor = colorCss(property, value);
    var text = presented(value, property);
    if (!cssColor) {
        var plain = el(doc, 'span', cls, text);
        if (text !== shown(value)) plain.setAttribute('title', shown(value));
        return plain;
    }
    var node = el(doc, 'span', cls + ' fpd-color-value');
    var valueText = el(doc, 'span', 'fpd-color-text', text);
    if (text !== shown(value)) valueText.setAttribute('title', shown(value));
    node.appendChild(valueText);
    var swatch = el(doc, 'span', 'fpd-color-swatch');
    swatch.style.backgroundColor = cssColor;
    swatch.setAttribute('aria-label', 'Образец цвета');
    swatch.setAttribute('title', 'Образец цвета');
    node.appendChild(swatch);
    return node;
}
var PART = { ExtendedTooltip: 'Расширенная подсказка', SearchStringAddition: 'Строка поиска',
    ViewStatusAddition: 'Состояние просмотра', SearchControlAddition: 'Управление поиском' };
function propertyTitle(name) {
    var ev = /^Событие (.+)$/.exec(name);
    if (ev) {
        var title = root.FormEdit && root.FormEdit.eventTitle ? root.FormEdit.eventTitle(ev[1]) : '';
        return 'Событие ' + (title || ev[1]);
    }
    var dot = name.indexOf('.');
    if (dot > 0 && PART[name.slice(0, dot)]) return PART[name.slice(0, dot)] + ': ' + propertyTitle(name.slice(dot + 1));
    if (name === 'Вид' || name === 'Родитель' || name === 'Страница' || name === 'Положение') return name;
    if (name.charAt(0) === '@') return name.slice(1);
    return root.FormPreview && root.FormPreview.propertyTitle ? root.FormPreview.propertyTitle(name) : name;
}
function propertyChange(entry, name) {
    return (entry.changes || []).filter(function (change) { return change.property === name; })[0] || null;
}
function isMove(entry) {
    return !!(entry && entry.type === 'element' && entry.before && entry.after
        && entry.before.parent !== entry.after.parent);
}
/* Категория общего фильтра: перестановка внутри группы и перенос в другую
 * группу — «перемещено», смена вида элемента остаётся изменением. */
function filterGroup(entry) {
    if (entry.kind === 'added' || entry.kind === 'removed') return entry.kind;
    return entry.type === 'order' || isMove(entry) ? 'moved' : 'changed';
}
function parentTitle(name) { return !name || name === 'Form' ? 'форма' : 'группа «' + name + '»'; }
function kindTitle(value) {
    return root.FormPreview && root.FormPreview.itemKindTitle
        ? root.FormPreview.itemKindTitle(value) : value;
}
function appendSemanticLine(doc, card, label, from, to) {
    var line = el(doc, 'div', 'fpd-semantic-line');
    line.appendChild(el(doc, 'strong', 'fpd-semantic-label', label));
    line.appendChild(el(doc, 'span', 'fpd-semantic-before', from));
    line.appendChild(el(doc, 'span', 'fpd-semantic-arrow', '→'));
    line.appendChild(el(doc, 'span', 'fpd-semantic-after', to));
    card.appendChild(line);
}
var SUMMARY_PROPERTIES = ['Title', 'Caption', 'DataPath', 'CommandName', 'Action',
    'Representation', 'Picture', 'BackColor', 'TextColor'];
function summaryProperties(entity) {
    var props = entity && entity.props || {};
    var out = [];
    for (var i = 0; i < SUMMARY_PROPERTIES.length && out.length < 3; i++) {
        var key = SUMMARY_PROPERTIES[i], value = props[key];
        if (value == null || value === '') continue;
        var text = presented(value, key);
        if (text.length > 110 || /(?:;\s*)?(?:ChildItems|Events|Items)=/.test(text)) continue;
        out.push({ key: key, value: value });
    }
    return out;
}
function renderEntitySummary(doc, card, entity) {
    var details = summaryProperties(entity);
    if (!details.length) return;
    var box = el(doc, 'div', 'fpd-entity-summary');
    details.forEach(function (item) {
        var row = el(doc, 'div', 'fpd-entity-summary-row');
        row.appendChild(el(doc, 'span', 'fpd-entity-summary-property', propertyTitle(item.key)));
        row.appendChild(valueNode(doc, 'fpd-entity-summary-value', item.key, item.value));
        box.appendChild(row);
    });
    card.appendChild(box);
}
function lines(diff) {
    var out = [];
    (diff.entries || []).forEach(function (entry) {
        if (entry.type === 'order') {
            out.push('Изменён порядок элементов: ' + (entry.parent === 'Form' ? 'форма' : 'группа «' + entry.parent + '»'));
            out.push('  Было: ' + entry.before.join(' → '));
            out.push('  Стало: ' + entry.after.join(' → '));
            return;
        }
        out.push(KIND[entry.kind] + ': ' + TYPE[entry.type].toLowerCase() + ' «' + entry.name + '»');
        (entry.changes || []).forEach(function (c) { out.push('  ' + propertyTitle(c.property) + ': ' + shown(c.from) + ' → ' + shown(c.to)); });
    });
    return out;
}
function orderSide(doc, label, names, other, after) {
    var side = el(doc, 'div', 'fpd-order-side ' + (after ? 'fpd-order-after' : 'fpd-order-before'));
    side.appendChild(el(doc, 'div', 'fpd-order-title', label));
    var list = el(doc, 'ol', 'fpd-order-list');
    names.forEach(function (name, index) {
        var oldIndex = other.indexOf(name);
        var item = el(doc, 'li', 'fpd-order-item' + (oldIndex !== index ? ' fpd-order-moved' : ''));
        item.appendChild(el(doc, 'span', 'fpd-order-name', name));
        if (oldIndex !== index) item.appendChild(el(doc, 'span', 'fpd-order-shift', after ? 'из ' + (oldIndex + 1) : 'в ' + (oldIndex + 1)));
        list.appendChild(item);
    });
    side.appendChild(list);
    return side;
}
function renderOrder(doc, entry) {
    var card = el(doc, 'section', 'fpd-card fpd-changed fpd-order-card');
    var head = el(doc, 'div', 'fpd-head');
    head.appendChild(el(doc, 'span', 'fpd-badge', 'Порядок'));
    head.appendChild(el(doc, 'strong', '', entry.parent === 'Form' ? 'Элементы формы' : 'Элементы группы «' + entry.parent + '»'));
    card.appendChild(head);
    var compare = el(doc, 'div', 'fpd-order');
    compare.appendChild(orderSide(doc, 'Было', entry.before, entry.after, false));
    compare.appendChild(el(doc, 'div', 'fpd-order-arrow', '→'));
    compare.appendChild(orderSide(doc, 'Стало', entry.after, entry.before, true));
    card.appendChild(compare);
    return card;
}
function visualEntry(entry) { return entry && (entry.type === 'element' || entry.type === 'order'); }
function previewTarget(entry, side) {
    if (!visualEntry(entry)) return { ids: [], context: false };
    if (entry.type === 'order') {
        var moved = entry.moved || [];
        var ids = moved.map(function (item) { return side === 'left' ? item.beforeId : item.afterId; }).filter(Boolean);
        if (!ids.length) ids = (side === 'left' ? entry.before : entry.after).slice();
        return { ids: ids, context: false };
    }
    var entity = side === 'left' ? entry.before : entry.after;
    if (entity) return { ids: [entity.id || entity.name], context: false };
    var other = side === 'left' ? entry.after : entry.before;
    return { ids: other && other.parentId ? [other.parentId] : [], context: true };
}
function attrValue(value) { return String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"'); }
function previewNode(host, id) {
    if (!host || !id || !host.querySelector) return null;
    var suffix = '[data-id="' + attrValue(id) + '"]';
    return host.querySelector('.fp-item' + suffix) || host.querySelector('th' + suffix)
        || host.querySelector('.fp-popup-entry' + suffix);
}
function clearPreviewMarks(host) {
    if (!host || !host.querySelectorAll) return;
    var marked = host.querySelectorAll('.fpd-preview-mark');
    for (var i = 0; i < marked.length; i++) marked[i].classList.remove('fpd-preview-mark');
    var context = host.querySelectorAll('.fpd-preview-context');
    for (var j = 0; j < context.length; j++) context[j].classList.remove('fpd-preview-context');
}
function markPreview(host, target, preview) {
    clearPreviewMarks(host);
    if (target.ids.length && preview && preview.highlight)
        preview.highlight(host, target.ids[0]);
    var first = null;
    for (var i = 0; i < target.ids.length; i++) {
        var node = previewNode(host, target.ids[i]);
        if (!node) continue;
        node.classList.add(target.context ? 'fpd-preview-context' : 'fpd-preview-mark');
        if (!first) first = node;
    }
    if (first && first.scrollIntoView) {
        try { first.scrollIntoView({ block: 'center', inline: 'nearest' }); }
        catch (e) { first.scrollIntoView(); }
    }
    return first;
}
function focusEntry(state, entry, card) {
    if (!state) return;
    markPreview(state.left, previewTarget(entry, 'left'), state.preview);
    markPreview(state.right, previewTarget(entry, 'right'), state.preview);
    for (var i = 0; i < state.cards.length; i++) state.cards[i].classList.remove('fpd-card-on');
    if (card) card.classList.add('fpd-card-on');
}
function previewPane(doc, side, data) {
    var pane = el(doc, 'div', 'fpd-preview-pane fpd-preview-' + side);
    pane.appendChild(el(doc, 'div', 'fpd-preview-head', data.label || (side === 'left' ? 'эталон' : 'текущее состояние')));
    var viewport = el(doc, 'div', 'fpd-preview-viewport');
    var canvas = el(doc, 'div', 'fpd-preview');
    viewport.appendChild(canvas);
    pane.appendChild(viewport);
    return { pane: pane, canvas: canvas };
}
/* The forms are laid out only once the panes are in the document. The form
 * renderer measures its host: drawn into a detached pane it fitted a width of
 * zero, and its ResizeObserver refit the real width later and only in part,
 * so a capture got one of two arrangements depending on timing. */
function renderPreviews(state, options) {
    [[state.left, options.left], [state.right, options.right]].forEach(function (side) {
        state.preview.render(side[1].model, side[0], {});
        side[0].classList.add('fpd-preview');
    });
}
function previews(doc, options) {
    var preview = root.FormPreview;
    if (!preview || !preview.render || !options.left || !options.right
        || !options.left.model || !options.right.model) return null;
    var box = el(doc, 'div', 'fpd-previews');
    var left = previewPane(doc, 'left', options.left);
    var right = previewPane(doc, 'right', options.right);
    box.appendChild(left.pane);
    box.appendChild(right.pane);
    return { element: box, left: left.canvas, right: right.canvas, preview: preview, cards: [] };
}
function normalCard(doc, entry, options) {
    var card = el(doc, 'section', 'fpd-card fpd-' + entry.kind);
    var head = el(doc, 'div', 'fpd-head');
    head.appendChild(el(doc, 'span', 'fpd-badge', KIND[entry.kind]));
    head.appendChild(el(doc, 'strong', '', TYPE[entry.type] + ' «' + entry.name + '»'));
    var entity = entry.after || entry.before;
    if (entity && entry.type === 'element') head.appendChild(el(doc, 'span', 'fpd-kind', entity.kind));
    card.appendChild(head);
    if (entry.kind !== 'changed') {
        var where = entity && entity.parent && entry.type === 'element' ? 'В группе: ' + entity.parent : '';
        if (where) card.appendChild(el(doc, 'div', 'fpd-where', where));
    }
    if (isMove(entry)) appendSemanticLine(doc, card, 'Перемещено:',
        parentTitle(entry.before.parent), parentTitle(entry.after.parent));
    var typeChange = propertyChange(entry, 'Вид');
    if (typeChange) appendSemanticLine(doc, card, 'Вид элемента:',
        kindTitle(typeChange.from), kindTitle(typeChange.to));
    (entry.handlers || []).forEach(function (h) {
        var title = h.event === 'Action' ? 'Действие' : propertyTitle('Событие ' + h.event).replace(/^Событие /, '');
        var line = el(doc, 'div', 'fpd-semantic-line fpd-handler-changed');
        line.appendChild(el(doc, 'strong', 'fpd-semantic-label', 'Обработчик изменён:'));
        line.appendChild(el(doc, 'span', 'fpd-handler-name', h.handler));
        line.appendChild(el(doc, 'span', 'fpd-kind', title));
        card.appendChild(line);
    });
    if (entry.kind === 'added' || entry.kind === 'removed') renderEntitySummary(doc, card, entity);
    if (entry.kind === 'removed' && entry.type === 'element' && options && options.restoreElementState) {
        var blocked = options.restoreElementState(entry);
        if (blocked != null && root.DiffNav) {
            var actions = el(doc, 'div', 'fpd-row fpd-restore-row');
            actions.appendChild(root.DiffNav.restoreButton(doc, { className: 'fpd-restore',
                title: 'Вернуть элемент целиком, как в эталоне', disabled: blocked || '',
                onRestore: function () { if (options.onRestoreElement) options.onRestoreElement(entry); } }));
            card.appendChild(actions);
        }
    }
    (entry.changes || []).forEach(function (change) {
        if ((isMove(entry) && change.property === 'Родитель') || change.property === 'Вид') return;
        var row = el(doc, 'div', 'fpd-row');
        row.appendChild(el(doc, 'span', 'fpd-property', propertyTitle(change.property)));
        row.appendChild(valueNode(doc, 'fpd-before', change.property, change.from));
        row.appendChild(el(doc, 'span', 'fpd-arrow', '→'));
        row.appendChild(valueNode(doc, 'fpd-after', change.property, change.to));
        if (options && options.canRestore && options.canRestore(entry, change))
            row.appendChild(restoreButton(doc, entry, change, options));
        card.appendChild(row);
    });
    return card;
}
function restoreButton(doc, entry, change, options) {
    var onRestore = function () { if (options.onRestore) options.onRestore(entry, change); };
    if (root.DiffNav) return root.DiffNav.restoreButton(doc, { className: 'fpd-restore',
        title: 'Вернуть только это свойство к эталону', onRestore: onRestore });
    var button = el(doc, 'button', 'fpd-restore', 'Вернуть');
    button.type = 'button';
    button.title = 'Вернуть только это свойство к эталону';
    button.addEventListener('click', function (event) {
        if (event.stopPropagation) event.stopPropagation();
        onRestore();
    });
    return button;
}
/* Верх списка карточек: «N из M», «XML-текст» и общие фильтры. Без
 * DiffNav (старый хост) список просто остаётся без них. */
function toolbar(doc, wrap, cards, rows, options, select) {
    var nav = root.DiffNav;
    if (!nav) return null;
    var head = el(doc, 'div', 'fpd-toolbar');
    var bar = null;
    var filters = rows.length ? nav.filterBar(doc, rows, { categoryOf: filterGroup,
        onChange: function () { if (bar) bar.refresh(); } }) : null;
    bar = nav.navBar(doc, {
        keyTarget: wrap,
        items: function () {
            return (filters ? filters.visibleRows() : rows).map(function (row) { return row.card; });
        },
        onSelect: function (card) { select(card); }
    });
    head.appendChild(bar.element);
    if (options.onShowXml) head.appendChild(nav.xmlButton(doc, options.onShowXml));
    if (filters) {
        head.appendChild(filters.element);
        filters.empty.classList.add('fpd-empty');
        cards.appendChild(filters.empty);
        filters.apply();
    }
    cards.appendChild(head);
    bar.refresh();
    return { nav: bar, filters: filters };
}
function makeFocusable(card, activate) {
    card.classList.add('fpd-card-action');
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.addEventListener('click', activate);
    card.addEventListener('keydown', function (event) {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        if (event.preventDefault) event.preventDefault();
        activate();
    });
}
/* Прокрутка превью «было/стало» вместе: пропорционально, потому что формы
 * разной длины. Прокручивается не сама панель, а узел внутри формы, поэтому
 * слушаем scroll на захвате и ищем такой же узел во второй панели. Ответное
 * событие от программной прокрутки гасится, иначе панели дёргают друг друга. */
function scrollPeer(from, fromHost, toHost) {
    if (from === fromHost) return toHost;
    var cls = from.classList && from.classList[0];
    if (!cls || !toHost.querySelectorAll) return null;
    var list = fromHost.querySelectorAll('.' + cls), index = Array.prototype.indexOf.call(list, from);
    var peers = toHost.querySelectorAll('.' + cls);
    return peers[index >= 0 ? index : 0] || null;
}
function syncScroll(a, b) {
    if (!a || !b || !a.addEventListener) return function () {};
    var echo = [];
    function ratio(n, vertical) {
        var range = vertical ? n.scrollHeight - n.clientHeight : n.scrollWidth - n.clientWidth;
        return range > 0 ? (vertical ? n.scrollTop : n.scrollLeft) / range : 0;
    }
    function follow(fromHost, toHost) {
        return function (event) {
            var from = event && event.target && event.target.nodeType === 1 ? event.target : fromHost;
            var seen = echo.indexOf(from);
            if (seen >= 0) { echo.splice(seen, 1); return; }
            var to = scrollPeer(from, fromHost, toHost);
            if (!to) return;
            var top = Math.round(ratio(from, true) * Math.max(0, to.scrollHeight - to.clientHeight));
            var left = Math.round(ratio(from, false) * Math.max(0, to.scrollWidth - to.clientWidth));
            if (Math.abs(to.scrollTop - top) < 1 && Math.abs(to.scrollLeft - left) < 1) return;
            echo.push(to);
            to.scrollTop = top;
            to.scrollLeft = left;
        };
    }
    var onA = follow(a, b), onB = follow(b, a);
    a.addEventListener('scroll', onA, true);
    b.addEventListener('scroll', onB, true);
    return function () {
        a.removeEventListener('scroll', onA, true);
        b.removeEventListener('scroll', onB, true);
    };
}
/* Простое построчное сравнение для вкладки «Модуль», когда хост не дал
 * Monaco: LCS по строкам после общего начала и конца; слишком большой
 * средний кусок показывается целиком как замена. */
var LINE_LIMIT = 4000000;
function lineDiff(before, after) {
    var a = String(before || '').replace(/\r\n?/g, '\n').split('\n');
    var b = String(after || '').replace(/\r\n?/g, '\n').split('\n');
    var head = 0;
    while (head < a.length && head < b.length && a[head] === b[head]) head++;
    var tail = 0;
    while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
    var ma = a.slice(head, a.length - tail), mb = b.slice(head, b.length - tail), out = [];
    for (var h = 0; h < head; h++) out.push({ op: ' ', text: a[h] });
    if (ma.length * mb.length > LINE_LIMIT) {
        ma.forEach(function (t) { out.push({ op: '-', text: t }); });
        mb.forEach(function (t) { out.push({ op: '+', text: t }); });
    } else {
        var n = ma.length, m = mb.length, dp = [], i, j;
        for (i = 0; i <= n; i++) dp.push(new Int32Array(m + 1));
        for (i = n - 1; i >= 0; i--) for (j = m - 1; j >= 0; j--)
            dp[i][j] = ma[i] === mb[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
        i = 0; j = 0;
        while (i < n || j < m) {
            if (i < n && j < m && ma[i] === mb[j]) { out.push({ op: ' ', text: ma[i] }); i++; j++; }
            else if (i < n && (j >= m || dp[i + 1][j] >= dp[i][j + 1])) { out.push({ op: '-', text: ma[i] }); i++; }
            else { out.push({ op: '+', text: mb[j] }); j++; }
        }
    }
    for (var t = a.length - tail; t < a.length; t++) out.push({ op: ' ', text: a[t] });
    return out;
}
function renderLineDiff(doc, host, before, after) {
    var box = el(doc, 'pre', 'fpd-module-lines');
    var changed = false;
    lineDiff(before, after).forEach(function (line) {
        if (line.op !== ' ') changed = true;
        box.appendChild(el(doc, 'div', 'fpd-module-line' + (line.op === '+' ? ' fpd-module-add' : line.op === '-' ? ' fpd-module-del' : ''),
            line.op + ' ' + line.text));
    });
    if (!changed) { host.appendChild(el(doc, 'div', 'fpd-empty', 'Модуль формы не изменился')); return; }
    host.appendChild(box);
}
/* Вкладки «Изменения» и «Модуль»: модуль формы — часть той же формы, его
 * правки видны в том же сравнении. */
function moduleTabs(doc, wrap, parts, options) {
    var module = options.module;
    var bar = el(doc, 'div', 'fpd-tabs');
    bar.setAttribute('role', 'tablist');
    var modulePane = el(doc, 'div', 'fpd-module');
    modulePane.hidden = true;
    var moduleView = null, built = false;
    var changedCount = module.changes ? Object.keys(module.changes).length : 0;
    var tabs = [
        { id: 'cards', label: 'Изменения' },
        { id: 'module', label: 'Модуль' + (changedCount ? ' (' + changedCount + ')' : '') }
    ];
    var buttons = tabs.map(function (tab) {
        var button = el(doc, 'button', 'fpd-tab', tab.label);
        button.type = 'button';
        button.setAttribute('role', 'tab');
        button.setAttribute('data-tab', tab.id);
        button.addEventListener('click', function (event) {
            if (event && event.stopPropagation) event.stopPropagation();
            show(tab.id);
        });
        bar.appendChild(button);
        return button;
    });
    function show(id) {
        buttons.forEach(function (b) {
            var on = b.getAttribute('data-tab') === id;
            b.classList.toggle('fpd-tab-on', on);
            b.setAttribute('aria-selected', on ? 'true' : 'false');
        });
        parts.forEach(function (p) { if (p) p.hidden = id === 'module'; });
        modulePane.hidden = id !== 'module';
        if (id === 'module' && !built) {
            built = true;
            if (module.error) modulePane.appendChild(el(doc, 'div', 'fpd-empty', module.error));
            else if (module.pending) modulePane.appendChild(el(doc, 'div', 'fpd-empty', 'читаем модуль из git…'));
            else {
                moduleView = options.createModuleDiff ? options.createModuleDiff(modulePane, module.before, module.after) : null;
                if (!moduleView) renderLineDiff(doc, modulePane, module.before, module.after);
            }
        }
    }
    wrap.insertBefore(bar, wrap.firstChild);
    wrap.appendChild(modulePane);
    show('cards');
    return { show: show, destroy: function () { if (moduleView && moduleView.destroy) moduleView.destroy(); } };
}
/* j/k и стрелки по списку карточек; Enter на карточке уже ведёт к элементу
 * в превью (makeFocusable), поэтому фокус переходит на выбранную карточку. */
function cardKeys(cards, tools) {
    function onKey(event) {
        if (!tools || event.altKey || event.ctrlKey || event.metaKey) return;
        var tag = event.target && event.target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON') return;
        var delta = event.key === 'j' || event.key === 'ArrowDown' ? 1 : event.key === 'k' || event.key === 'ArrowUp' ? -1 : 0;
        if (!delta) return;
        if (event.preventDefault) event.preventDefault();
        var card = delta > 0 ? tools.nav.next() : tools.nav.prev();
        if (card && card.focus) card.focus();
    }
    cards.addEventListener('keydown', onKey);
    return function () { cards.removeEventListener('keydown', onKey); };
}
function render(doc, host, options) {
    host.innerHTML = '';
    var diff = options.diff;
    if (diff.error) { host.appendChild(el(doc, 'div', 'fpd-empty', diff.error)); return { entries: [], text: diff.error }; }
    var wrap = el(doc, 'div', 'fpd');
    var hasVisual = (diff.entries || []).some(visualEntry);
    var previewState = hasVisual ? previews(doc, options) : null;
    if (previewState) wrap.appendChild(previewState.element);
    var cards = el(doc, 'div', 'fpd-cards' + (previewState ? '' : ' fpd-cards-only'));
    if (!diff.entries.length && !(options.module && options.module.changed)) cards.appendChild(el(doc, 'div', 'fpd-empty', 'Различий нет'));
    var rendered = [];
    var tools = null;
    function choose(row) {
        if (previewState) focusEntry(previewState, row.entry, row.card);
        else {
            rendered.forEach(function (item) { item.card.classList.remove('fpd-card-on'); });
            row.card.classList.add('fpd-card-on');
        }
        if (tools) tools.nav.setCurrent(row.card);
    }
    diff.entries.forEach(function (entry) {
        var card = entry.type === 'order' ? renderOrder(doc, entry) : normalCard(doc, entry, options);
        var row = { entry: entry, card: card };
        rendered.push(row);
        if (previewState) previewState.cards.push(card);
        makeFocusable(card, function () { choose(row); });
        cards.appendChild(card);
    });
    tools = toolbar(doc, wrap, cards, rendered, options, function (card) {
        for (var r = 0; r < rendered.length; r++) if (rendered[r].card === card) choose(rendered[r]);
    });
    wrap.appendChild(cards);
    var tabs = options.module ? moduleTabs(doc, wrap, [previewState && previewState.element, cards], options) : null;
    var unkeys = cardKeys(cards, tools);
    host.appendChild(wrap);
    if (previewState) {
        renderPreviews(previewState, options);
        previewState.unsync = syncScroll(previewState.left, previewState.right);
        for (var i = 0; i < rendered.length; i++) if (visualEntry(rendered[i].entry)) {
            choose(rendered[i]);
            break;
        }
    }
    return { element: wrap, entries: diff.entries, text: lines(diff).join('\r\n'),
        next: function () { return tools ? tools.nav.next() : null; },
        prev: function () { return tools ? tools.nav.prev() : null; },
        destroy: function () {
        if (tools) tools.nav.destroy();
        unkeys();
        if (tabs) tabs.destroy();
        if (previewState && previewState.unsync) previewState.unsync();
        if (!previewState || !previewState.preview.dispose) return;
        previewState.preview.dispose(previewState.left);
        previewState.preview.dispose(previewState.right);
    } };
}
root.FormDiffView = { render: render, _test: { lines: lines, renderOrder: renderOrder, colorCss: colorCss,
    presented: presented, filterGroup: filterGroup, summaryProperties: summaryProperties,
    previewTarget: previewTarget, focusEntry: focusEntry, visualEntry: visualEntry,
    syncScroll: syncScroll, lineDiff: lineDiff } };
})(window);
