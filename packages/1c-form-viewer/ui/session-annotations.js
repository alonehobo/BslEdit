(function (root) {
'use strict';

root.SessionAnnotations = function (host, pane, elementInfo) {
    var toggle = document.getElementById('annotation-toggle');
    var editor = document.getElementById('annotation-editor');
    var targetLabel = document.getElementById('annotation-target');
    var textField = document.getElementById('annotation-text');
    var tray = document.getElementById('annotation-tray');
    var trayToggle = document.getElementById('annotation-tray-toggle');
    var list = document.getElementById('annotation-list');
    var entries = [];
    var revision = -1;
    var available = false;
    var active = false;
    var pending = null;
    var editing = null;
    var deleting = false;

    function errorText(error) { return error && error.message || String(error); }
    function closeEditor() { editor.hidden = true; pending = null; }
    function findTarget(id) {
        var nodes = host.querySelectorAll('[data-id]');
        for (var i = 0; i < nodes.length; i++) if (nodes[i].getAttribute('data-id') === id) return nodes[i];
        return null;
    }
    function updatePositions() {
        var paneBox = pane.getBoundingClientRect();
        pane.querySelectorAll('.annotation-anchor').forEach(function (marker) {
            var target = findTarget(marker.getAttribute('data-element-id'));
            if (!target || !target.getClientRects().length) {
                marker.hidden = true;
                return;
            }
            var box = target.getBoundingClientRect();
            marker.hidden = box.bottom <= paneBox.top || box.top >= paneBox.bottom || box.right <= paneBox.left || box.left >= paneBox.right;
            marker.style.left = Math.max(0, Math.min(box.left - paneBox.left, paneBox.width - 24)) + 'px';
            marker.style.top = Math.max(0, Math.min(box.top - paneBox.top - 12 + marker.annotationIndex * 24, paneBox.height - 24)) + 'px';
        });
    }
    function request(url, method, body) {
        return fetch(url, { method: method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
            .then(function (response) {
                if (!response.ok) return response.text().then(function (message) { throw new Error(message || 'HTTP ' + response.status); });
                return response.status === 204 ? null : response.json();
            });
    }
    function render() {
        pane.querySelectorAll('.annotation-anchor').forEach(function (node) { node.remove(); });
        list.replaceChildren();
        tray.hidden = !available || !entries.length;
        if (tray.hidden) return;
        trayToggle.textContent = 'Аннотации (' + entries.length + ')';
        var counts = Object.create(null);
        entries.forEach(function (entry, index) {
            var marker = document.createElement('span');
            marker.className = 'annotation-anchor';
            marker.setAttribute('data-element-id', entry.elementId);
            marker.textContent = String(index + 1);
            marker.title = entry.elementName + ': ' + entry.text;
            marker.annotationIndex = counts[entry.elementId] || 0;
            counts[entry.elementId] = marker.annotationIndex + 1;
            pane.appendChild(marker);

            var row = document.createElement('li');
            row.className = 'annotation-row';
            var number = document.createElement('span');
            number.className = 'annotation-number';
            number.textContent = String(index + 1);
            var content = document.createElement('span');
            content.className = 'annotation-content';
            var name = document.createElement('strong');
            name.textContent = entry.elementName;
            var note = document.createElement('span');
            note.textContent = entry.text;
            content.appendChild(name);
            content.appendChild(note);
            var edit = document.createElement('button');
            edit.type = 'button';
            edit.className = 'ann-edit';
            edit.title = 'Изменить аннотацию';
            edit.setAttribute('aria-label', 'Изменить аннотацию ' + (index + 1) + ': ' + entry.elementName);
            edit.textContent = '✎';
            edit.disabled = deleting || !!(editing && editing.saving);
            edit.addEventListener('click', function () { startEdit(entry); });
            var remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'ann-delete';
            remove.title = 'Удалить аннотацию';
            remove.setAttribute('aria-label', 'Удалить аннотацию ' + (index + 1) + ': ' + entry.elementName);
            remove.textContent = '×';
            remove.disabled = deleting || !!(editing && editing.saving);
            remove.addEventListener('click', function () {
                var expected = revision;
                deleting = true;
                list.querySelectorAll('button').forEach(function (button) { button.disabled = true; });
                list.querySelectorAll('textarea').forEach(function (field) { field.disabled = true; });
                request('annotations/' + encodeURIComponent(entry.id), 'DELETE', { revision: expected })
                    .then(function () {
                        if (revision !== expected) return;
                        entries = entries.filter(function (item) { return item.id !== entry.id; });
                        if (editing && editing.id === entry.id) editing = null;
                    }).catch(function (error) {
                        if (revision === expected) window.alert('Не удалось удалить аннотацию: ' + errorText(error));
                    }).finally(function () {
                        deleting = false;
                        render();
                    });
            });
            row.appendChild(number);
            row.appendChild(content);
            row.appendChild(edit);
            row.appendChild(remove);
            list.appendChild(row);
            if (editing && editing.id === entry.id) renderEdit(entry, row);
        });
        updatePositions();
    }
    function startEdit(entry) {
        if (deleting || editing && editing.saving) return;
        closeEditor();
        editing = { id: entry.id, text: entry.text, error: '', saving: false };
        render();
        list.children[entries.indexOf(entry)].querySelector('textarea').focus();
    }
    function renderEdit(entry, row) {
        var editState = editing;
        var content = row.querySelector('.annotation-content');
        var textarea = document.createElement('textarea');
        textarea.className = 'annotation-edit-text';
        textarea.value = editState.text;
        textarea.setAttribute('aria-label', 'Текст аннотации');
        textarea.addEventListener('input', function () { editState.text = textarea.value; });
        content.querySelector('span').replaceWith(textarea);
        var actions = document.createElement('span');
        actions.className = 'annotation-edit-actions';
        var cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.textContent = 'Отмена';
        cancel.disabled = editState.saving || deleting;
        cancel.addEventListener('click', function () { if (editing === editState) { editing = null; render(); } });
        var save = document.createElement('button');
        save.type = 'button';
        save.textContent = 'Сохранить';
        save.disabled = editState.saving || deleting;
        textarea.disabled = editState.saving || deleting;
        var errorMessage = document.createElement('span');
        errorMessage.className = 'annotation-error';
        errorMessage.setAttribute('role', 'alert');
        errorMessage.textContent = editState.error;
        save.addEventListener('click', function () {
            var value = textarea.value.trim();
            if (!value) { editState.error = errorMessage.textContent = 'Введите текст аннотации'; return; }
            var expected = revision;
            editState.text = textarea.value;
            editState.saving = true;
            save.disabled = true;
            cancel.disabled = true;
            row.querySelector('.ann-delete').disabled = true;
            row.querySelector('.ann-edit').disabled = true;
            textarea.disabled = true;
            request('annotations/' + encodeURIComponent(entry.id), 'PATCH', { revision: expected, text: value })
                .then(function (updated) {
                    if (revision !== expected || editing !== editState) return;
                    var index = entries.findIndex(function (item) { return item.id === entry.id; });
                    if (index < 0) return;
                    entries[index] = updated;
                    editing = null;
                    render();
                }).catch(function (error) {
                    if (revision === expected && editing === editState) editState.error = 'Не удалось сохранить: ' + errorText(error);
                }).finally(function () {
                    editState.saving = false;
                    if (revision === expected && editing === editState) render();
                });
        });
        actions.appendChild(cancel);
        actions.appendChild(save);
        content.appendChild(actions);
        content.appendChild(errorMessage);
    }
    function snapshot(items, nextRevision, enabled) {
        available = !!enabled;
        revision = nextRevision;
        entries = available ? items.slice() : [];
        editing = null;
        closeEditor();
        toggle.hidden = !available;
        if (!available) {
            active = false;
            document.body.classList.remove('annotating');
            toggle.setAttribute('aria-pressed', 'false');
        }
        render();
    }
    toggle.addEventListener('click', function () {
        if (!available) return;
        active = !active;
        document.body.classList.toggle('annotating', active);
        toggle.setAttribute('aria-pressed', active ? 'true' : 'false');
        if (!active) closeEditor();
    });
    trayToggle.addEventListener('click', function () {
        list.hidden = !list.hidden;
        trayToggle.setAttribute('aria-expanded', list.hidden ? 'false' : 'true');
    });
    document.getElementById('annotation-cancel').addEventListener('click', closeEditor);
    editor.addEventListener('submit', function (event) {
        event.preventDefault();
        if (!pending || !textField.value.trim()) return;
        var selected = pending;
        var value = textField.value.trim();
        var expected = revision;
        closeEditor();
        request('annotations', 'POST', { revision: expected, elementId: selected.id, elementName: selected.name, text: value })
            .then(function (entry) {
                if (revision !== expected) return;
                entries.push(entry);
                render();
            }).catch(function (error) { window.alert('Не удалось добавить аннотацию: ' + errorText(error)); });
    });
    host.addEventListener('click', function (event) {
        if (!available || !active) return;
        var node = event.target.closest('[data-id]');
        if (!node || !host.contains(node)) return;
        if (!node.classList.contains('fp-item')) {
            var owner = node.closest('.fp-item[data-id]');
            if (owner) node = owner;
        }
        event.preventDefault();
        event.stopPropagation();
        var id = node.getAttribute('data-id');
        pending = elementInfo(id);
        targetLabel.textContent = pending.title;
        textField.value = '';
        editor.hidden = false;
        var box = node.getBoundingClientRect();
        var paneBox = pane.getBoundingClientRect();
        editor.style.left = Math.max(8, Math.min(box.left - paneBox.left, paneBox.width - editor.offsetWidth - 8)) + 'px';
        editor.style.top = Math.max(8, Math.min(box.bottom - paneBox.top + 8, paneBox.height - editor.offsetHeight - 8)) + 'px';
        textField.focus();
    }, true);
    document.addEventListener('scroll', updatePositions, true);
    window.addEventListener('resize', updatePositions);
    host.addEventListener('click', function () { requestAnimationFrame(updatePositions); }, true);
    return { snapshot: snapshot, updatePositions: updatePositions };
};
})(window);
