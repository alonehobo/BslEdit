/* The property panel of a managed form: what the selected element has, and a
 * way to change it. Reading and writing both go through FormEdit, and the
 * rewritten document reaches the host as the text edits DocEdits works out, so
 * one row changed is one undo step.
 *
 * An element kind has upwards of a hundred properties and a form file usually
 * sets a handful, so the panel opens on the ones actually written and the rest
 * are one checkbox away. Properties the engine refuses to write — a choice
 * list, a start-tag attribute — are shown with their value and disabled
 * rather than hidden: what the element has should be visible even when this
 * editor cannot change it.
 *
 * Nothing here parses XML of its own; the DOM it builds is plain enough for
 * the viewer shell and the VS Code webview alike. */
(function (root) {
'use strict';

/* A value the file does not carry: the platform default applies. */
var UNSET = '';

var BOOLEANS = [[UNSET, 'по умолчанию'], ['true', 'Да'], ['false', 'Нет']];

/* The language a multilingual property is shown and edited in. A form dump
 * carries every language the configuration has; the panel edits the one the
 * user reads and leaves the others alone. */
var LANG = 'ru';

function textOf(value) {
    if (value == null) return '';
    if (typeof value === 'object') {
        if (value[LANG] != null) return String(value[LANG]);
        for (var key in value) {
            if (Object.prototype.hasOwnProperty.call(value, key)) return String(value[key]);
        }
        return '';
    }
    return String(value);
}

/* What a complex property holds, for a row that cannot be edited. */
function shapeOf(value) {
    if (value == null) return '';
    if (typeof value !== 'object') return String(value);
    var parts = [];
    for (var key in value) {
        if (Object.prototype.hasOwnProperty.call(value, key)) parts.push(key + ': ' + value[key]);
    }
    return parts.join(', ');
}

/* Builds the panel. The host mounts `element` and calls show() whenever the
 * selection in the form changes.
 *
 * options:
 *   xml()      the form document as it stands now
 *   apply(edits, next, result)   the change as text ranges and the whole new
 *              document, exactly as the template editor hands it over
 *   onError(message)   an engine refusal, already worded for the user
 *   readOnly   show the values but change nothing */
function panel(doc, options) {
    options = options || {};
    if (!doc || !doc.createElement) return null;

    var element = null;
    var showAll = false;
    var filter = '';

    var host = doc.createElement('div');
    host.className = 'fp-props';

    var head = doc.createElement('div');
    head.className = 'fp-props-head';
    host.appendChild(head);

    var title = doc.createElement('div');
    title.className = 'fp-props-title';
    head.appendChild(title);

    var tools = doc.createElement('div');
    tools.className = 'fp-props-tools';
    head.appendChild(tools);

    var search = doc.createElement('input');
    search.type = 'search';
    search.className = 'fp-props-filter';
    search.placeholder = 'Свойство';
    search.addEventListener('input', function () {
        filter = String(search.value || '').toLowerCase();
        render();
    });
    tools.appendChild(search);

    var allLabel = doc.createElement('label');
    allLabel.className = 'fp-props-all';
    var allBox = doc.createElement('input');
    allBox.type = 'checkbox';
    allBox.addEventListener('change', function () {
        showAll = !!allBox.checked;
        render();
    });
    var allText = doc.createElement('span');
    allText.textContent = 'Все свойства';
    allLabel.appendChild(allBox);
    allLabel.appendChild(allText);
    tools.appendChild(allLabel);

    var list = doc.createElement('div');
    list.className = 'fp-props-list';
    host.appendChild(list);

    function fail(message) {
        if (options.onError) options.onError(message);
    }

    function read() {
        if (!element || !root.FormEdit || !root.FormEdit.readProperties) return null;
        try {
            return root.FormEdit.readProperties(options.xml ? options.xml() : '', element);
        } catch (err) {
            fail((err && err.message) || String(err));
            return null;
        }
    }

    /* One property written back. An empty field clears the property, which is
     * what returns it to the platform default. */
    function write(name, value) {
        if (options.readOnly) return;
        var props = {};
        props[name] = value;
        var before = options.xml ? options.xml() : '';
        var out;
        try {
            out = root.FormEdit.setProperties(before, { element: element, properties: props });
        } catch (err) {
            fail((err && err.message) || String(err));
            render();
            return;
        }
        if (!out || out.xml === before) {
            render();
            return;
        }
        if (options.apply) options.apply(root.DocEdits.textEdits(before, out.xml), out.xml, out.result);
        render();
    }

    /* The Russian name of a property. The viewer's own glossary comes first,
     * so the panel reads the same as the read-only inspector beside it; it
     * knows a handful of terms, and the rest come from the property dictionary,
     * which carries the Designer's wording for every property of every kind.
     * Only the composition nodes (ChildItems, Events, ContextMenu) have no
     * Russian name in either, and those are not shown as properties anyway. */
    function label(entry) {
        var name = typeof entry === 'string' ? entry : entry.name;
        var terms = root.XmlUtil && root.XmlUtil.terms;
        var ru = terms && terms.propertyName ? terms.propertyName(name) : '';
        if (!ru && entry && entry.ru) ru = entry.ru;
        return ru || name;
    }

    function row(entry) {
        var line = doc.createElement('div');
        line.className = 'fp-prop' + (entry.set ? ' fp-prop-set' : '');
        var caption = doc.createElement('div');
        caption.className = 'fp-prop-name';
        caption.textContent = label(entry);
        caption.title = entry.name + (entry.kind ? ' · ' + entry.kind : '');
        line.appendChild(caption);

        var box = doc.createElement('div');
        box.className = 'fp-prop-value';
        line.appendChild(box);
        box.appendChild(editor(entry));
        return line;
    }

    function select(entry, values, current) {
        var el = doc.createElement('select');
        el.className = 'fp-prop-input';
        for (var i = 0; i < values.length; i++) {
            var option = doc.createElement('option');
            option.value = String(values[i][0]);
            option.textContent = String(values[i][1]);
            el.appendChild(option);
        }
        el.value = current;
        el.addEventListener('change', function () {
            var raw = el.value;
            if (raw === UNSET) write(entry.name, null);
            else if (entry.kind === 'boolean') write(entry.name, raw === 'true');
            else write(entry.name, raw);
        });
        return el;
    }

    function field(entry, current, numeric) {
        var el = doc.createElement('input');
        el.className = 'fp-prop-input';
        el.type = numeric ? 'number' : 'text';
        el.value = current;
        el.addEventListener('change', function () {
            var raw = String(el.value == null ? '' : el.value);
            if (raw === '') write(entry.name, null);
            else if (numeric) {
                var n = Number(raw);
                if (!isFinite(n)) { fail('Свойство ' + entry.name + ': нужно число.'); render(); return; }
                write(entry.name, n);
            } else write(entry.name, raw);
        });
        return el;
    }

    function colour(entry) {
        var box = doc.createElement('div');
        box.className = 'form-colour-edit';
        var raw = field(entry, entry.value == null ? '' : String(entry.value), false);
        raw.placeholder = 'Авто, #RRGGBB, web:, win: или style:';
        box.appendChild(raw);
        if (root.TemplateEdit && root.TemplateEdit.colourControl) {
            var dummy = { selection: function () { return null; }, select: function () {} };
            var picker = root.TemplateEdit.colourControl(doc, dummy, label(entry),
                entry.value == null ? '' : String(entry.value),
                function (value) { write(entry.name, value); }, null, '■');
            picker.element.classList.add('form-colour-picker');
            box.appendChild(picker.element);
        }
        return box;
    }

    function font(entry) {
        if (!root.FontEditor || !root.FontEditor.control) {
            var unavailable = doc.createElement('div');
            unavailable.className = 'fp-prop-frozen';
            unavailable.textContent = shapeOf(entry.value);
            return unavailable;
        }
        return root.FontEditor.control(doc, {
            title: label(entry), value: entry.value, allowStyle: true,
            readOnly: !!options.readOnly,
            onApply: function (value) { write(entry.name, value); },
            onClear: function () { write(entry.name, null); },
            onError: fail
        }).element;
    }

    function editor(entry) {
        var current = textOf(entry.value);
        var el;
        if (entry.readOnly) {
            el = doc.createElement('div');
            el.className = 'fp-prop-frozen';
            el.textContent = entry.kind === 'complex' ? shapeOf(entry.value) : current;
            el.title = entry.readOnly;
            return el;
        }
        if (entry.kind === 'complex' && entry.type === 'Color') el = colour(entry);
        else if (entry.kind === 'complex' && entry.type === 'Font') el = font(entry);
        else if (entry.kind === 'boolean') el = select(entry, BOOLEANS, current === 'true' ? 'true' : current === 'false' ? 'false' : UNSET);
        else if (entry.kind === 'enum' && entry.values && entry.values.length) {
            var values = [[UNSET, 'по умолчанию']];
            for (var i = 0; i < entry.values.length; i++) values.push([entry.values[i], entry.values[i]]);
            el = select(entry, values, current);
        } else if (entry.kind === 'number') el = field(entry, current, true);
        else el = field(entry, current, false);
        if (options.readOnly) el.disabled = true;
        return el;
    }

    /* One handler assigned or cleared: the same text edit a property makes. */
    function writeEvent(event, handler) {
        if (options.readOnly) return;
        var before = options.xml ? options.xml() : '';
        var out;
        try {
            out = root.FormEdit.setEvent(before, { element: element, event: event, handler: handler });
        } catch (err) {
            fail((err && err.message) || String(err));
            render();
            return;
        }
        if (out && out.xml !== before && options.apply)
            options.apply(root.DocEdits.textEdits(before, out.xml), out.xml, out.result);
        render();
    }

    /* The button beside a handler: open its procedure, or create it — the
     * name the Designer proposes when the field is empty. The host decides
     * what opening means; without a module it only assigns the name. */
    function handlerButton(caption, hint, action) {
        var b = doc.createElement('button');
        b.type = 'button';
        b.className = 'fp-event-go';
        b.textContent = caption;
        b.title = hint;
        b.disabled = !!options.readOnly;
        b.addEventListener('click', action);
        return b;
    }

    function eventRow(kind, e) {
        var line = doc.createElement('div');
        line.className = 'fp-prop' + (e.handler ? ' fp-prop-set' : '');
        var caption = doc.createElement('div');
        caption.className = 'fp-prop-name';
        caption.textContent = e.title;
        caption.title = e.name + (e.directive ? ' · ' + e.directive : '');
        line.appendChild(caption);
        var box = doc.createElement('div');
        box.className = 'fp-prop-value fp-event-value';
        var input = doc.createElement('input');
        input.className = 'fp-prop-input';
        input.type = 'text';
        input.value = e.handler;
        input.disabled = !!options.readOnly;
        input.addEventListener('change', function () {
            writeEvent(e.name, String(input.value || '').trim());
        });
        box.appendChild(input);
        var hooks = options.handlers || {};
        var exists = !!(e.handler && hooks.exists && hooks.exists(e.handler));
        if (e.handler) {
            if (hooks.open) box.appendChild(handlerButton(exists ? '→' : '+',
                exists ? 'Перейти к процедуре' : 'Создать процедуру в модуле',
                function () { hooks.open(element, kind, e.name, e.handler); }));
        } else {
            box.appendChild(handlerButton('+', hooks.open ? 'Создать обработчик' : 'Назначить обработчик', function () {
                var name = root.FormEdit.handlerName(element, e.name);
                if (hooks.open) hooks.open(element, kind, e.name, name);
                else writeEvent(e.name, name);
            }));
        }
        line.appendChild(box);
        return line;
    }

    function commandRow(command) {
        var line = doc.createElement('div');
        line.className = 'fp-prop' + (command.action ? ' fp-prop-set' : '');
        var caption = doc.createElement('div');
        caption.className = 'fp-prop-name';
        caption.textContent = 'Действие команды ' + command.name;
        caption.title = 'У кнопки нет своих событий: она выполняет команду формы.';
        line.appendChild(caption);
        var box = doc.createElement('div');
        box.className = 'fp-prop-value fp-event-value';
        var input = doc.createElement('input');
        input.className = 'fp-prop-input';
        input.type = 'text';
        input.value = command.action;
        input.disabled = !!options.readOnly || !command.exists;
        function assign(action) {
            if (options.readOnly) return;
            var before = options.xml ? options.xml() : '';
            var out;
            try {
                out = root.FormEdit.setCommand(before, { name: command.name, action: action || null });
            } catch (err) { fail((err && err.message) || String(err)); render(); return; }
            if (out && out.xml !== before && options.apply)
                options.apply(root.DocEdits.textEdits(before, out.xml), out.xml, out.result);
            render();
        }
        input.addEventListener('change', function () { assign(String(input.value || '').trim()); });
        box.appendChild(input);
        var hooks = options.handlers || {};
        if (command.exists) {
            var action = command.action || command.name;
            var exists = !!(command.action && hooks.exists && hooks.exists(command.action));
            box.appendChild(handlerButton(exists ? '→' : '+', exists ? 'Перейти к процедуре' : 'Создать обработчик команды', function () {
                if (!command.action) assign(action);
                if (hooks.openCommand) hooks.openCommand(action);
            }));
        }
        line.appendChild(box);
        return line;
    }

    function readEvents() {
        if (element == null || !root.FormEdit || !root.FormEdit.readEvents) return null;
        try {
            return root.FormEdit.readEvents(options.xml ? options.xml() : '', element);
        } catch (err) {
            return null;
        }
    }

    function renderEvents() {
        var data = readEvents();
        if (!data) return;
        var rows = data.events.filter(function (e) {
            return !filter || (e.name + ' ' + e.title).toLowerCase().indexOf(filter) >= 0;
        });
        if (!rows.length && !data.command && filter) return;
        var head = doc.createElement('div');
        head.className = 'fp-props-section';
        head.textContent = 'События';
        list.appendChild(head);
        if (data.command) list.appendChild(commandRow(data.command));
        rows.forEach(function (e) { list.appendChild(eventRow(data.kind, e)); });
        if (!rows.length && !data.command) {
            var none = doc.createElement('div');
            none.className = 'fp-props-empty';
            none.textContent = 'У элементов этого вида нет событий.';
            list.appendChild(none);
        }
    }

    function render() {
        list.innerHTML = '';
        var data = read();
        if (!data) {
            title.textContent = element ? element : element === '' ? 'Форма' : 'Элемент не выбран';
            renderEvents();
            return;
        }
        title.textContent = data.element + ' · ' + data.kind;
        var shown = 0;
        for (var i = 0; i < data.properties.length; i++) {
            var entry = data.properties[i];
            if (!showAll && !entry.set) continue;
            if (filter && (entry.name + ' ' + label(entry)).toLowerCase().indexOf(filter) < 0) continue;
            list.appendChild(row(entry));
            shown++;
        }
        if (!shown) {
            var empty = doc.createElement('div');
            empty.className = 'fp-props-empty';
            empty.textContent = filter ? 'Нет свойств с таким именем.'
                : 'У элемента нет заданных свойств — включите «Все свойства».';
            list.appendChild(empty);
        }
        renderEvents();
    }

    render();

    return {
        element: host,
        /* The form element the panel speaks for; an empty name means the form
         * itself, which has properties of its own. */
        show: function (name) {
            element = name == null ? null : String(name);
            render();
        },
        current: function () { return element; },
        /* The same write a row performs, for a host that offers its own way in
         * — a keyboard shortcut, a context menu — and for the tests, which
         * cannot dispatch a change event through the lightest DOM. */
        set: write,
        refresh: render
    };
}

root.FormProperties = { panel: panel, _test: { textOf: textOf, shapeOf: shapeOf } };

})(typeof window !== 'undefined' ? window : globalThis);
