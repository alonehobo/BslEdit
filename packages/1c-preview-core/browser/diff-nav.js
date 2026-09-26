/* Общие элементы всех видов сравнения: панель «N из M» с переходом к
 * соседнему изменению, фильтры по виду изменения и поиск, единая кнопка
 * «Вернуть» и кнопка перехода к текстовому сравнению XML. Каждый вид сам
 * решает, какие карточки у него есть и что значит «выбрать» карточку. */
(function (root) {
'use strict';

var CATEGORIES = [
    { id: 'all', label: 'Все' },
    { id: 'added', label: 'Добавлено' },
    { id: 'removed', label: 'Удалено' },
    { id: 'changed', label: 'Изменено' },
    { id: 'moved', label: 'Перемещено' }
];

function el(doc, tag, cls, text) {
    var node = doc.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
}
function stop(event) { if (event && event.stopPropagation) event.stopPropagation(); }

/* F7 / Shift+F7 — как в редакторах сравнения, Alt+↓ / Alt+↑ — для тех, у
 * кого F7 занята хостом. Ответ: 1 — вперёд, −1 — назад, 0 — не наша клавиша. */
function navKey(event) {
    if (!event) return 0;
    if (event.key === 'F7' && !event.ctrlKey && !event.altKey) return event.shiftKey ? -1 : 1;
    if (event.altKey && !event.ctrlKey && !event.shiftKey) {
        if (event.key === 'ArrowDown') return 1;
        if (event.key === 'ArrowUp') return -1;
    }
    return 0;
}

/* options: { items() → видимые карточки по порядку, onSelect(node, index),
 * keyTarget — узел, на котором слушаются клавиши }. Текущей считается
 * последняя выбранная карточка; если фильтр её скрыл, переход идёт от
 * ближайшей видимой. */
function navBar(doc, options) {
    options = options || {};
    var bar = el(doc, 'div', 'dn-nav');
    var prevButton = el(doc, 'button', 'dn-nav-prev', '↑');
    prevButton.type = 'button';
    prevButton.title = 'Предыдущее изменение (Shift+F7, Alt+↑)';
    prevButton.setAttribute('aria-label', 'Предыдущее изменение');
    var counter = el(doc, 'span', 'dn-nav-counter');
    counter.setAttribute('aria-live', 'polite');
    var nextButton = el(doc, 'button', 'dn-nav-next', '↓');
    nextButton.type = 'button';
    nextButton.title = 'Следующее изменение (F7, Alt+↓)';
    nextButton.setAttribute('aria-label', 'Следующее изменение');
    bar.appendChild(prevButton);
    bar.appendChild(counter);
    bar.appendChild(nextButton);
    var current = null;

    function items() { return options.items ? options.items() || [] : []; }
    function refresh() {
        var list = items();
        var index = current ? list.indexOf(current) : -1;
        counter.textContent = (index >= 0 ? index + 1 : '—') + ' из ' + list.length;
        prevButton.disabled = !list.length;
        nextButton.disabled = !list.length;
    }
    function go(index) {
        var list = items();
        if (!list.length) { refresh(); return null; }
        index = Math.max(0, Math.min(list.length - 1, index));
        current = list[index];
        refresh();
        if (current.scrollIntoView) current.scrollIntoView({ block: 'nearest' });
        if (options.onSelect) options.onSelect(current, index);
        return current;
    }
    function step(delta) {
        var list = items();
        if (!list.length) { refresh(); return null; }
        var index = current ? list.indexOf(current) : -1;
        if (index < 0) return go(delta > 0 ? 0 : list.length - 1);
        return go((index + delta + list.length) % list.length);
    }
    function onKey(event) {
        var delta = navKey(event);
        if (!delta) return false;
        if (event.preventDefault) event.preventDefault();
        step(delta);
        return true;
    }
    prevButton.addEventListener('click', function (event) { stop(event); step(-1); });
    nextButton.addEventListener('click', function (event) { stop(event); step(1); });
    var target = options.keyTarget;
    if (target && target.addEventListener) target.addEventListener('keydown', onKey);
    refresh();
    return {
        element: bar,
        next: function () { return step(1); },
        prev: function () { return step(-1); },
        go: go,
        onKey: onKey,
        refresh: refresh,
        /* Выбор мышью: счётчик должен знать, где мы, без повторного onSelect. */
        setCurrent: function (node) { current = node || null; refresh(); },
        current: function () { return current; },
        destroy: function () {
            if (target && target.removeEventListener) target.removeEventListener('keydown', onKey);
        }
    };
}

/* rows: [{ entry, card }]. options: { categoryOf(entry) → id из CATEGORIES,
 * types, typeOf(entry) — необязательная вторая группа (например, ячейки и
 * строки макета), onChange(visibleRows) }. Кнопки без карточек выключены,
 * чтобы набор фильтров был одинаковым во всех видах. */
function filterBar(doc, rows, options) {
    options = options || {};
    var bar = el(doc, 'div', 'dn-filter-bar');
    var search = el(doc, 'input', 'dn-filter-search');
    search.type = 'search';
    search.placeholder = 'Найти в изменениях';
    search.setAttribute('aria-label', 'Найти в изменениях');
    bar.appendChild(search);
    var status = el(doc, 'span', 'dn-filter-status');
    var empty = el(doc, 'div', 'dn-filter-empty', 'По этому фильтру изменений нет');
    empty.hidden = true;
    var state = { category: 'all', type: 'all', query: '' };

    function categoryOf(entry) { return options.categoryOf ? options.categoryOf(entry) : entry.kind; }
    function typeOf(entry) { return options.typeOf ? options.typeOf(entry) : ''; }
    function matches(row) {
        return (state.category === 'all' || categoryOf(row.entry) === state.category)
            && (state.type === 'all' || typeOf(row.entry) === state.type)
            && (!state.query || String(row.card.textContent || '').toLocaleLowerCase().indexOf(state.query) >= 0);
    }
    function apply() {
        var visible = [];
        rows.forEach(function (row) {
            var on = matches(row);
            row.card.hidden = !on;
            if (on) visible.push(row);
        });
        status.textContent = 'Показано ' + visible.length + ' из ' + rows.length;
        empty.hidden = visible.length > 0;
        if (options.onChange) options.onChange(visible);
        return visible;
    }
    function group(list, key, of, label) {
        var box = el(doc, 'div', 'dn-filter-buttons');
        if (label) box.setAttribute('aria-label', label);
        var counts = { all: rows.length };
        rows.forEach(function (row) {
            var id = of(row.entry);
            counts[id] = (counts[id] || 0) + 1;
        });
        list.forEach(function (item) {
            var count = counts[item.id] || 0;
            var button = el(doc, 'button', 'dn-filter-button' + (item.id === state[key] ? ' dn-filter-active' : ''),
                item.label + ' ' + count);
            button.type = 'button';
            button.setAttribute('data-filter', item.id);
            button.setAttribute('aria-pressed', item.id === state[key] ? 'true' : 'false');
            if (!count && item.id !== 'all') button.disabled = true;
            button.addEventListener('click', function (event) {
                stop(event);
                state[key] = item.id;
                var all = box.querySelectorAll('.dn-filter-button');
                for (var i = 0; i < all.length; i++) {
                    var selected = all[i] === button;
                    all[i].classList.toggle('dn-filter-active', selected);
                    all[i].setAttribute('aria-pressed', selected ? 'true' : 'false');
                }
                apply();
            });
            box.appendChild(button);
        });
        bar.appendChild(box);
    }
    group(options.categories || CATEGORIES, 'category', categoryOf, 'Вид изменения');
    if (options.types && options.types.length)
        group([{ id: 'all', label: 'Все типы' }].concat(options.types), 'type', typeOf, 'Тип изменения');
    search.addEventListener('input', function () {
        state.query = String(search.value || '').trim().toLocaleLowerCase();
        apply();
    });
    search.addEventListener('keydown', stop);
    bar.appendChild(status);
    return {
        element: bar,
        empty: empty,
        apply: apply,
        visibleRows: function () { return rows.filter(function (row) { return !row.card.hidden; }); }
    };
}

/* Одна кнопка «Вернуть» на все виды. disabled — строка с причиной: такая
 * кнопка видна, но не нажимается, и объясняет в подсказке почему. */
function restoreButton(doc, options) {
    options = options || {};
    var button = el(doc, 'button', 'dn-restore' + (options.className ? ' ' + options.className : ''), 'Вернуть');
    button.type = 'button';
    if (options.disabled) {
        button.disabled = true;
        button.classList.add('dn-restore-disabled');
        button.title = String(options.disabled);
    } else button.title = options.title || 'Вернуть это изменение к эталону';
    button.addEventListener('click', function (event) {
        stop(event);
        if (!button.disabled && options.onRestore) options.onRestore();
    });
    return button;
}

/* Переход от смыслового сравнения к построчному сравнению исходника. */
function xmlButton(doc, onClick) {
    var button = el(doc, 'button', 'dn-xml', 'XML-текст');
    button.type = 'button';
    button.title = 'Показать текстовое сравнение XML-исходника';
    button.addEventListener('click', function (event) { stop(event); if (onClick) onClick(); });
    return button;
}

root.DiffNav = {
    CATEGORIES: CATEGORIES,
    navKey: navKey,
    navBar: navBar,
    filterBar: filterBar,
    restoreButton: restoreButton,
    xmlButton: xmlButton
};
})(window);
