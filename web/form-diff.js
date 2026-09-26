/* Semantic diff for managed forms. The XML order and indentation are not
 * user-facing changes, so named entities are matched first and only their
 * kind, parent, position and property values are compared. */
(function (root) {
'use strict';

var STRUCTURE = { ChildItems: 1, Events: 1, AutoCommandBar: 1, ContextMenu: 1,
    ExtendedTooltip: 1, SearchStringAddition: 1, ViewStatusAddition: 1,
    SearchControlAddition: 1 };

var ADDITION = { ExtendedTooltip: 1, SearchStringAddition: 1, ViewStatusAddition: 1,
    SearchControlAddition: 1 };

function localName(node) { return node ? node.name : ''; }
function child(node, name) {
    if (!node) return null;
    for (var i = 0; i < node.kids.length; i++) if (node.kids[i].name === name) return node.kids[i];
    return null;
}
function stable(value) {
    if (value == null) return '';
    /* Git stores text with LF while the file opened by BSLEdit commonly has
     * CRLF. Inside a multilingual value those line endings are content of the
     * XML text node, but for a form property they represent the same line
     * break and must not produce a visible no-op diff. */
    if (typeof value !== 'object') return String(value).replace(/\r\n?/g, '\n').trim();
    var keys = Object.keys(value).sort(), out = [];
    for (var i = 0; i < keys.length; i++) out.push(keys[i] + '=' + stable(value[keys[i]]));
    return out.join('; ');
}
function nodeValue(node) {
    if (!node.kids.length) return String(node.text || '').trim();
    var items = node.kids.filter(function (k) { return k.name === 'item'; });
    if (items.length) {
        var langs = {};
        items.forEach(function (item) {
            var lang = child(item, 'lang'), content = child(item, 'content');
            if (lang) langs[String(lang.text).trim()] = content ? String(content.text).trim() : '';
        });
        return langs;
    }
    var value = {};
    node.kids.forEach(function (k) {
        var v = nodeValue(k);
        /* Columns, parameters and the like differ by name, not by content. */
        var key = k.attrs && k.attrs.name != null ? k.name + ' ' + k.attrs.name : k.name;
        if (value[key] == null) value[key] = v;
        else value[key] = stable(value[key]) + ', ' + stable(v);
    });
    return value;
}
function properties(node) {
    var out = {};
    Object.keys(node.attrs || {}).forEach(function (key) {
        if (key !== 'name' && key !== 'id') out['@' + key] = node.attrs[key];
    });
    node.kids.forEach(function (k) {
        if (!STRUCTURE[k.name]) out[k.name] = stable(nodeValue(k));
        /* The tooltip and table additions are parts of their owner. */
        else if (ADDITION[k.name]) {
            var inner = properties(k);
            Object.keys(inner).forEach(function (key) { out[k.name + '.' + key] = inner[key]; });
        }
    });
    /* A handler assignment is one property per event, not a nested block. */
    var events = child(node, 'Events');
    if (events) events.kids.forEach(function (ev) {
        if (!ev.attrs || !ev.attrs.name) return;
        var call = ev.attrs.callType ? ' (' + ev.attrs.callType + ')' : '';
        out['Событие ' + ev.attrs.name] = String(ev.text || '').trim() + call;
    });
    return out;
}
function collect(rootNode) {
    var groups = { form: {}, element: {}, attribute: {}, command: {} };
    groups.form.Form = { name: 'Form', kind: 'Form', parent: '', index: 0, props: properties(rootNode) };
    /* Attributes and commands are compared one by one below. */
    delete groups.form.Form.props.Attributes;
    delete groups.form.Form.props.Commands;
    function add(node, type, parent, index) {
        if (!node.attrs || node.attrs.name == null) return;
        groups[type][node.attrs.name] = { name: node.attrs.name, kind: localName(node),
            id: node.attrs.id || '', parent: parent || 'Form', parentId: '',
            index: index, props: properties(node) };
    }
    function walk(owner) {
        var box = child(owner, 'ChildItems');
        if (box) box.kids.forEach(function (item, index) {
            add(item, 'element', owner === rootNode ? 'Form' : owner.attrs.name, index);
            walk(item);
        });
        owner.kids.forEach(function (k) {
            if ((k.name === 'AutoCommandBar' || k.name === 'ContextMenu') && k.attrs.name) {
                add(k, 'element', owner === rootNode ? 'Form' : owner.attrs.name, -1); walk(k);
            }
        });
    }
    walk(rootNode);
    Object.keys(groups.element).forEach(function (name) {
        var entity = groups.element[name];
        var parent = groups.element[entity.parent];
        entity.parentId = parent ? (parent.id || parent.name) : '';
        /* The page the element ends up on: a move between groups of one page
         * and a move to another tab read very differently. */
        for (var up = parent, guard = 0; up && guard < 100; up = groups.element[up.parent], guard++) {
            if (up.kind === 'Page') { entity.page = up.name; break; }
        }
    });
    var attrs = child(rootNode, 'Attributes');
    if (attrs) attrs.kids.forEach(function (n, i) {
        add(n, 'attribute', 'Form', i);
        /* A table's columns are attributes of their own: Товары.Цена. */
        var cols = child(n, 'Columns'), owner = groups.attribute[n.attrs && n.attrs.name];
        if (!cols || !owner) return;
        delete owner.props.Columns;
        cols.kids.forEach(function (c, j) {
            if (c.name !== 'Column' || !c.attrs || c.attrs.name == null) return;
            var name = owner.name + '.' + c.attrs.name;
            groups.attribute[name] = { name: name, kind: 'Column', id: c.attrs.id || '', parent: owner.name,
                parentId: owner.id, index: j, props: properties(c) };
        });
    });
    var commands = child(rootNode, 'Commands');
    if (commands) commands.kids.forEach(function (n, i) { add(n, 'command', 'Form', i); });
    return groups;
}
function propertyChanges(a, b) {
    var keys = {}, out = [];
    Object.keys(a || {}).forEach(function (k) { keys[k] = 1; });
    Object.keys(b || {}).forEach(function (k) { keys[k] = 1; });
    Object.keys(keys).sort().forEach(function (key) {
        var from = a && a[key] != null ? String(a[key]) : '';
        var to = b && b[key] != null ? String(b[key]) : '';
        if (from !== to) out.push({ property: key, from: from, to: to });
    });
    return out;
}
function compareGroup(type, left, right, out) {
    var names = {};
    Object.keys(left).forEach(function (n) { names[n] = 1; });
    Object.keys(right).forEach(function (n) { names[n] = 1; });
    Object.keys(names).sort().forEach(function (name) {
        var a = left[name], b = right[name];
        if (!a) { out.push({ type: type, kind: 'added', name: name, after: b }); return; }
        if (!b) { out.push({ type: type, kind: 'removed', name: name, before: a }); return; }
        var changes = propertyChanges(a.props, b.props);
        if (a.kind !== b.kind) changes.unshift({ property: 'Вид', from: a.kind, to: b.kind });
        if (a.parent !== b.parent) {
            if (a.page !== b.page) changes.unshift({ property: 'Страница', from: a.page || '', to: b.page || '' });
            changes.unshift({ property: 'Родитель', from: a.parent, to: b.parent });
        }
        if (changes.length) out.push({ type: type, kind: 'changed', name: name,
            before: a, after: b, changes: changes });
    });
}
/* An insertion shifts every following numeric index but does not reorder any
 * existing element. Compare the relative order of common siblings instead of
 * emitting one misleading "position" property per shifted element. */
function compareOrder(left, right, out) {
    var byParent = {};
    Object.keys(left).forEach(function (name) {
        var a = left[name], b = right[name];
        if (!b || a.parent !== b.parent || a.index < 0 || b.index < 0) return;
        (byParent[a.parent] || (byParent[a.parent] = [])).push(name);
    });
    Object.keys(byParent).sort().forEach(function (parent) {
        var common = byParent[parent];
        if (common.length < 2) return;
        var before = common.slice().sort(function (x, y) { return left[x].index - left[y].index; });
        var after = common.slice().sort(function (x, y) { return right[x].index - right[y].index; });
        var moved = [];
        for (var i = 0; i < before.length; i++) {
            var to = after.indexOf(before[i]);
            if (to !== i) moved.push({ name: before[i], from: i + 1, to: to + 1,
                beforeId: left[before[i]].id || before[i], afterId: right[before[i]].id || before[i] });
        }
        if (moved.length) out.push({ type: 'order', kind: 'changed', name: parent,
            parent: parent,
            beforeParentId: left[parent] ? (left[parent].id || parent) : '',
            afterParentId: right[parent] ? (right[parent].id || parent) : '',
            before: before, after: after, moved: moved, changes: [] });
    });
}
/* Procedures of a form module by name (lower case) with a normalised body:
 * line endings and trailing blanks are not a change of the handler. */
var PROC_START = /^[ \t]*(?:Асинх[ \t]+|Async[ \t]+)?(?:Процедура|Функция|Procedure|Function)[ \t]+([A-Za-zА-Яа-яЁё_][A-Za-zА-Яа-яЁё0-9_]*)/i;
var PROC_END = /^[ \t]*(?:КонецПроцедуры|КонецФункции|EndProcedure|EndFunction)(?![A-Za-zА-Яа-яЁё0-9_])/i;
function procedures(text) {
    var out = {}, current = null, body = [];
    String(text || '').replace(/\r\n?/g, '\n').split('\n').forEach(function (line) {
        var start = PROC_START.exec(line);
        if (!current && start) { current = start[1].toLowerCase(); body = []; }
        if (current) body.push(line.replace(/[ \t]+$/, ''));
        if (current && PROC_END.test(line)) { out[current] = body.join('\n'); current = null; }
    });
    return out;
}
/* Handler name → 'changed' | 'added' | 'removed' for every procedure whose
 * text differs between the two module revisions. */
function changedProcedures(beforeText, afterText) {
    var a = procedures(beforeText), b = procedures(afterText), out = {};
    Object.keys(a).forEach(function (n) { if (!(n in b)) out[n] = 'removed'; else if (a[n] !== b[n]) out[n] = 'changed'; });
    Object.keys(b).forEach(function (n) { if (!(n in a)) out[n] = 'added'; });
    return out;
}
function handlersOf(entity, type) {
    var out = [];
    Object.keys(entity && entity.props || {}).forEach(function (key) {
        var ev = /^Событие (.+)$/.exec(key);
        if (ev) out.push({ event: ev[1], handler: String(entity.props[key]).replace(/\s*\([^)]*\)$/, '').trim() });
        else if (type === 'command' && key === 'Action') out.push({ event: 'Action', handler: String(entity.props[key]).trim() });
    });
    return out.filter(function (h) { return h.handler; });
}
/* Marks entities whose event handler changed only in the module: the XML
 * is the same, yet the form behaves differently. */
function markHandlers(entries, groups, moduleChanges) {
    if (!moduleChanges || !Object.keys(moduleChanges).length) return;
    ['form', 'element', 'command'].forEach(function (type) {
        Object.keys(groups[type]).sort().forEach(function (name) {
            var hit = handlersOf(groups[type][name], type).filter(function (h) {
                return moduleChanges[h.handler.toLowerCase()] === 'changed';
            });
            if (!hit.length) return;
            var entry = entries.filter(function (e) { return e.type === type && e.name === name && e.kind !== 'removed'; })[0];
            if (!entry) {
                entry = { type: type, kind: 'changed', name: name, before: groups[type][name],
                    after: groups[type][name], changes: [] };
                entries.push(entry);
            }
            entry.handlers = hit;
        });
    });
}
function compareXml(leftXml, rightXml, options) {
    if (!root.FormEdit || !root.FormEdit._scan) return { error: 'Модуль разбора формы не загружен.' };
    var a, b;
    try { a = collect(root.FormEdit._scan(leftXml)); } catch (e) { return { error: 'Эталон не разобрался: ' + e.message }; }
    try { b = collect(root.FormEdit._scan(rightXml)); } catch (e2) { return { error: 'Текущая форма не разобралась: ' + e2.message }; }
    var entries = [];
    compareGroup('form', a.form, b.form, entries);
    compareGroup('element', a.element, b.element, entries);
    /* A context menu or command bar comes and goes with its owner: the owner's
     * own entry already says so. */
    entries = entries.filter(function (e) {
        if (e.type !== 'element') return true;
        if (e.kind === 'removed') return !(e.before.index < 0 && !b.element[e.before.parent] && a.element[e.before.parent]);
        if (e.kind === 'added') return !(e.after.index < 0 && !a.element[e.after.parent] && b.element[e.after.parent]);
        return true;
    });
    compareOrder(a.element, b.element, entries);
    compareGroup('attribute', a.attribute, b.attribute, entries);
    compareGroup('command', a.command, b.command, entries);
    var moduleChanges = null;
    if (options && (options.moduleBefore != null || options.moduleAfter != null)) {
        moduleChanges = changedProcedures(options.moduleBefore, options.moduleAfter);
        markHandlers(entries, b, moduleChanges);
    }
    var summary = { added: 0, removed: 0, changed: 0 };
    entries.forEach(function (e) { summary[e.kind]++; });
    return { equal: !entries.length, entries: entries, summary: summary, moduleChanges: moduleChanges };
}

root.FormDiff = { compareXml: compareXml, _test: { collect: collect, properties: properties,
    stable: stable, compareOrder: compareOrder, procedures: procedures, changedProcedures: changedProcedures } };
})(window);
