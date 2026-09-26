/* Presentation of a semantic DCS diff laid out like the template diff: the
 * old and new schema as normal DcsPreview windows side by side, and a list of
 * described changes below. Query text gets a dedicated side-by-side editor. */
(function (root) {
'use strict';

var KIND = { added: 'Добавлено', removed: 'Удалено', changed: 'Изменено' };
var TYPE = {
    set: 'Набор данных', field: 'Поле набора', query: 'Запрос', link: 'Связь',
    calculated: 'Вычисляемое поле', total: 'Ресурс', parameter: 'Параметр',
    template: 'Макет', nested: 'Вложенная схема', variant: 'Вариант настроек', node: 'Элемент структуры'
};

function el(doc, tag, cls, text) {
    var node = doc.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
}
function shown(value) { return value == null || value === '' ? '—' : String(value); }
function summaryText(diff) {
    var s = diff.summary || {};
    var total = (diff.entries || []).length;
    return total ? total + ' ' + (total === 1 ? 'изменение' : total < 5 ? 'изменения' : 'изменений')
        + ' · +' + (s.added || 0) + ' −' + (s.removed || 0) + ' ~' + (s.changed || 0) : 'Различий нет';
}
function lines(diff) {
    var out = [];
    (diff.entries || []).forEach(function (entry) {
        out.push(KIND[entry.kind] + ': ' + (TYPE[entry.type] || entry.type) + ' «' + entry.name + '»');
        (entry.changes || []).forEach(function (c) { out.push('  ' + c.property + ': ' + shown(c.from) + ' → ' + shown(c.to)); });
    });
    if (diff.unmodeled) out.push('Есть различия только в XML-представлении или пока не поддерживаемых свойствах.');
    return out;
}
function detail(doc, entry) {
    var box = el(doc, 'div', 'dcsd-detail');
    var title = el(doc, 'div', 'dcsd-detail-title');
    title.appendChild(el(doc, 'span', 'dcsd-badge dcsd-' + entry.kind, KIND[entry.kind]));
    title.appendChild(el(doc, 'strong', '', (TYPE[entry.type] || entry.type) + ' «' + entry.name + '»'));
    if (entry.context) title.appendChild(el(doc, 'span', 'dcsd-context', entry.context));
    box.appendChild(title);
    var changes = entry.changes || [];
    if (!changes.length) {
        box.appendChild(el(doc, 'div', 'dcsd-note', entry.kind === 'added' ? 'Сущность появилась в текущей схеме.' : 'Сущность отсутствует в текущей схеме.'));
        return box;
    }
    var table = el(doc, 'div', 'dcsd-properties');
    for (var i = 0; i < changes.length; i++) {
        table.appendChild(el(doc, 'div', 'dcsd-property', changes[i].property));
        table.appendChild(el(doc, 'div', 'dcsd-before', shown(changes[i].from)));
        table.appendChild(el(doc, 'div', 'dcsd-arrow', '→'));
        table.appendChild(el(doc, 'div', 'dcsd-after', shown(changes[i].to)));
    }
    box.appendChild(table);
    return box;
}
function fallbackQuery(doc, host, entry, leftLabel, rightLabel) {
    var pair = el(doc, 'div', 'dcsd-query-pair');
    function side(label, text, cls) {
        var col = el(doc, 'div', 'dcsd-query-side ' + cls);
        col.appendChild(el(doc, 'div', 'dcsd-query-label', label));
        col.appendChild(el(doc, 'pre', 'dcsd-query-text', text));
        return col;
    }
    pair.appendChild(side(leftLabel, entry.query.before, 'dcsd-query-before'));
    pair.appendChild(side(rightLabel, entry.query.after, 'dcsd-query-after'));
    host.appendChild(pair);
    return { destroy: function () {} };
}

/* Карточка изменения в нижнем списке — как у макетов: заголовок с видом
 * изменения и строки «свойство: было → стало». Текст запроса сюда не
 * выводится, он сравнивается вверху. */
/* Кнопка «Вернуть» свойства: options.canRestore(entry, change) даёт true,
 * строку-причину (кнопка выключена) или false (кнопки нет). */
function restoreControl(doc, entry, change, options) {
    var verdict = options && options.canRestore ? options.canRestore(entry, change) : false;
    if (!verdict) return null;
    var reason = typeof verdict === 'string' ? verdict : null;
    function onRestore() { if (options.onRestore) options.onRestore(entry, change); }
    if (root.DiffNav) return root.DiffNav.restoreButton(doc, { className: 'tpd-restore dcsd-restore',
        title: 'Вернуть это свойство к эталону', disabled: reason, onRestore: onRestore });
    var button = el(doc, 'button', 'tpd-restore dcsd-restore', 'Вернуть');
    button.type = 'button';
    button.title = reason || 'Вернуть это свойство к эталону';
    if (reason) button.disabled = true;
    else button.addEventListener('click', function (event) {
        if (event.stopPropagation) event.stopPropagation();
        onRestore();
    });
    return button;
}
function card(doc, entry, options) {
    var item = el(doc, 'div', 'tpd-item dcsd-item tpd-card-' + entry.kind);
    item.setAttribute('role', 'button');
    item.setAttribute('tabindex', '0');
    var head = el(doc, 'span', 'tpd-item-head');
    head.setAttribute('data-badge', KIND[entry.kind] || '');
    head.appendChild(el(doc, 'strong', 'tpd-item-title', (TYPE[entry.type] || entry.type) + ' «' + entry.name + '»'));
    if (entry.context) head.appendChild(el(doc, 'span', 'dcsd-context', entry.context));
    item.appendChild(head);
    var changes = (entry.changes || []).filter(function (c) { return !entry.query || c.property !== 'Текст запроса'; });
    for (var i = 0; i < changes.length; i++) {
        var row = el(doc, 'span', 'tpd-item-row');
        row.appendChild(el(doc, 'span', 'tpd-property', changes[i].property));
        row.appendChild(el(doc, 'span', 'tpd-before dcsd-before', shown(changes[i].from)));
        row.appendChild(el(doc, 'span', 'tpd-arrow', '→'));
        row.appendChild(el(doc, 'span', 'tpd-after dcsd-after', shown(changes[i].to)));
        var restore = restoreControl(doc, entry, changes[i], options);
        if (restore) row.appendChild(restore);
        item.appendChild(row);
    }
    if (entry.query) {
        item.appendChild(el(doc, 'span', 'tpd-item-note', 'Текст запроса сравнивается вверху.'));
        var queryRestore = restoreControl(doc, entry, (entry.changes || [])[0], options);
        if (queryRestore) item.appendChild(queryRestore);
    }
    else if (!changes.length) item.appendChild(el(doc, 'span', 'tpd-item-note',
        entry.kind === 'added' ? 'Появилось в текущей схеме.' : 'Отсутствует в текущей схеме.'));
    return item;
}

/* options: { diff, leftLabel, rightLabel, createQueryDiff(host,before,after),
 * canRestore(entry, change) / onRestore(entry, change) — откат свойства,
 * onShowXml() — переход к текстовому сравнению исходника }
 * Раскладка как у сравнения макетов: вверху «было» и «стало» рядом,
 * под разделителем — список изменений с описанием. */
function render(doc, host, options) {
    host.innerHTML = '';
    var diff = options.diff;
    if (diff.error) {
        host.appendChild(el(doc, 'div', 'dcsd-empty', diff.error));
        return { entries: [], text: diff.error, destroy: function () {} };
    }
    var wrap = el(doc, 'div', 'tpd dcsd');
    var panes = el(doc, 'div', 'tpd-panes');
    var sheets = [];
    var sides = [[diff.leftModel, options.leftLabel || 'Было', 'tpd-pane-left'],
                 [diff.rightModel, options.rightLabel || 'Стало', 'tpd-pane-right']];
    for (var s = 0; s < sides.length; s++) {
        var pane = el(doc, 'div', 'tpd-pane ' + sides[s][2]);
        pane.appendChild(el(doc, 'div', 'tpd-pane-head', sides[s][1]));
        var sheet = el(doc, 'div', 'tpd-sheet dcsd-sheet');
        var previewHost = el(doc, 'div');
        sheet.appendChild(previewHost);
        pane.appendChild(sheet);
        panes.appendChild(pane);
        sheets.push({ pane: pane, host: previewHost, model: sides[s][0] });
    }
    var queryHost = el(doc, 'div', 'dcsd-query-host');
    queryHost.style.display = 'none';
    panes.appendChild(queryHost);
    wrap.appendChild(panes);
    var splitter = el(doc, 'div', 'tpd-resizer');
    splitter.setAttribute('role', 'separator');
    splitter.setAttribute('aria-orientation', 'horizontal');
    splitter.setAttribute('tabindex', '0');
    splitter.setAttribute('title', 'Перетащите, чтобы изменить высоту просмотра и списка изменений');
    wrap.appendChild(splitter);
    var list = el(doc, 'div', 'tpd-list');
    wrap.appendChild(list);
    host.appendChild(wrap);

    var entries = diff.entries || [];
    for (var p = 0; p < sheets.length; p++) {
        if (root.DcsPreview && root.DcsPreview.render)
            root.DcsPreview.render(sheets[p].model, sheets[p].host,
                { windowTitle: 'Схема компоновки данных', diffEntries: entries });
    }
    var head = el(doc, 'div', 'tpd-list-head');
    head.appendChild(el(doc, 'span', 'tpd-list-count', 'Изменения: ' + summaryText(diff)));
    /* Счётчик, фильтры и поиск стоят над прокруткой списка. */
    var top = el(doc, 'div', 'dcsd-list-top');
    top.appendChild(head);
    list.appendChild(top);
    var items = [];
    var rows = [];
    var queryView = null;
    var nav = null;
    for (var i = 0; i < entries.length; i++) {
        var item = card(doc, entries[i], options);
        bind(item, i);
        list.appendChild(item);
        items.push(item);
        rows.push({ entry: entries[i], card: item });
    }
    if (!entries.length) list.appendChild(el(doc, 'div', 'tpd-empty', 'Различий нет'));
    /* Общие счётчик, фильтры и поиск — как у макета и формы. */
    if (root.DiffNav) {
        var filters = entries.length ? root.DiffNav.filterBar(doc, rows,
            { onChange: function () { if (nav) nav.refresh(); } }) : null;
        nav = root.DiffNav.navBar(doc, {
            keyTarget: wrap,
            items: function () { return (filters ? filters.visibleRows() : rows).map(function (row) { return row.card; }); },
            onSelect: function (node) {
                var at = items.indexOf(node);
                if (at >= 0) select(at);
            }
        });
        head.insertBefore(nav.element, head.firstChild);
        if (options.onShowXml) head.appendChild(root.DiffNav.xmlButton(doc, options.onShowXml));
        if (filters) {
            top.appendChild(filters.element);
            filters.empty.classList.add('tpd-empty');
            list.insertBefore(filters.empty, items[0]);
            filters.apply();
        }
        nav.refresh();
    }
    if (diff.unmodeled) {
        var warning = el(doc, 'div', 'dcsd-warning');
        warning.appendChild(el(doc, 'strong', '', 'Есть различия только в XML.'));
        warning.appendChild(el(doc, 'span', '', ' Они относятся к представлению или пока не поддерживаемым свойствам; проверьте режим исходника.'));
        list.appendChild(warning);
    }

    function bind(item, index) {
        item.addEventListener('click', function () { select(index); });
        item.addEventListener('keydown', function (event) {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            if (event.preventDefault) event.preventDefault();
            select(index);
        });
    }
    function clearQuery() {
        if (queryView && queryView.destroy) queryView.destroy();
        queryView = null;
        queryHost.innerHTML = '';
    }
    function select(index) {
        var entry = entries[index];
        if (!entry) return;
        for (var b = 0; b < items.length; b++) items[b].classList.toggle('tpd-item-on', b === index);
        if (nav) nav.setCurrent(items[index]);
        clearQuery();
        var query = !!entry.query;
        queryHost.style.display = query ? '' : 'none';
        for (var k = 0; k < sheets.length; k++) sheets[k].pane.style.display = query ? 'none' : '';
        if (query) {
            queryView = options.createQueryDiff
                ? options.createQueryDiff(queryHost, entry.query.before, entry.query.after) : null;
            if (!queryView) queryView = fallbackQuery(doc, queryHost, entry,
                options.leftLabel || 'Было', options.rightLabel || 'Стало');
        } else if (root.DcsPreview && root.DcsPreview.highlight) {
            /* Обе стороны открываются на одной вкладке; там, где элемента
             * нет, вкладка переключается без выделения. */
            var ids = [entry.kind === 'added' ? '' : (entry.beforeId || entry.entityId),
                       entry.kind === 'removed' ? '' : entry.entityId];
            for (var h = 0; h < sheets.length; h++) {
                var found = ids[h] ? root.DcsPreview.highlight(sheets[h].host, ids[h]) : null;
                if (!found && entry.tab && root.DcsPreview.showTab) root.DcsPreview.showTab(sheets[h].host, entry.tab);
            }
        }
        if (options.onSelect) options.onSelect(entry);
    }
    var tdv = root.TemplateDiffView && root.TemplateDiffView._test;
    var unbindSplitter = tdv && tdv.bindSplitter && wrap.getBoundingClientRect
        ? tdv.bindSplitter(splitter, wrap, panes, list) : function () {};
    if (entries.length) select(0);
    return {
        element: wrap, entries: entries, text: lines(diff).join('\r\n'),
        select: select,
        next: function () { return nav ? nav.next() : null; },
        prev: function () { return nav ? nav.prev() : null; },
        destroy: function () {
            if (nav) nav.destroy();
            clearQuery();
            unbindSplitter();
            for (var d = 0; d < sheets.length; d++)
                if (sheets[d].host._dcsDispose) sheets[d].host._dcsDispose();
        }
    };
}

root.DcsDiffView = { render: render, _test: { lines: lines, summaryText: summaryText, detail: detail, card: card } };
})(window);
