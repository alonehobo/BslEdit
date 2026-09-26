(function (root) {
'use strict';

/* Annotations the user leaves on form elements of an MCP preview session.
 * The MCP preview page serves the endpoints itself; BSLEdit, launched for such
 * a preview, passes the session's base URL as options.baseUrl. */
root.SessionAnnotations = function (host, pane, elementInfo, options) {
    var baseUrl = options && options.baseUrl || '';
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
    var pending = null;
    var editing = null;
    var deleting = false;
    /* The element the user last clicked in the form, and the pencil that
     * offers to annotate it. There is no separate mode: clicks keep switching
     * tabs and selecting elements as usual. */
    var selected = null;
    var pencil = document.createElement('button');
    pencil.type = 'button';
    pencil.id = 'annotation-pencil';
    pencil.hidden = true;
    pencil.textContent = '✎';
    pencil.title = 'Аннотация к элементу (Alt+A)';
    pencil.setAttribute('aria-label', 'Добавить аннотацию к выделенному элементу (Alt+A)');
    pane.appendChild(pencil);
    /* Clear all sits in the list's header, beside the title that drags it. */
    var trayHeader = document.createElement('div');
    trayHeader.className = 'annotation-tray-header';
    trayToggle.replaceWith(trayHeader);
    trayHeader.appendChild(trayToggle);
    var clearAll = document.createElement('button');
    clearAll.type = 'button';
    clearAll.id = 'annotation-clear';
    clearAll.textContent = 'Очистить';
    clearAll.title = 'Удалить все аннотации';
    trayHeader.appendChild(clearAll);

    function errorText(error) { return error && error.message || String(error); }
    function closeEditor() { editor.hidden = true; pending = null; }
    function hidePencil() { pencil.hidden = true; }
    function elementNode(node) {
        node = node && node.closest ? node.closest('[data-id]') : null;
        if (!node || !host.contains(node)) return null;
        if (!node.classList.contains('fp-item')) {
            var owner = node.closest('.fp-item[data-id]');
            if (owner) node = owner;
        }
        return node;
    }
    /* The element to annotate: the one clicked last while it is still drawn,
     * else whatever the host has selected (BSLEdit's element tree). */
    function currentTarget() {
        if (selected && selected.node.isConnected && selected.node.getClientRects().length) return selected;
        var id = options && options.selectedId ? options.selectedId() : '';
        var node = id ? findTarget(String(id)) : null;
        return node && node.getClientRects().length ? { id: String(id), node: node } : null;
    }
    /* Spreadsheet cells have no outline entry; they read as R1C1 the way the
     * preview numbers them, with the start of their text. */
    function describe(target) {
        var info = elementInfo(target.id) || { id: target.id, name: target.id, title: target.id };
        var cell = /^r(\d+)c(\d+)$/.exec(target.id);
        if (cell && info.name === target.id) {
            var name = 'R' + (+cell[1] + 1) + 'C' + (+cell[2] + 1);
            var end = target.endId && /^r(\d+)c(\d+)$/.exec(target.endId);
            if (end) {
                var r1 = Math.min(+cell[1], +end[1]), r2 = Math.max(+cell[1], +end[1]);
                var c1 = Math.min(+cell[2], +end[2]), c2 = Math.max(+cell[2], +end[2]);
                name = 'R' + (r1 + 1) + 'C' + (c1 + 1) + ':R' + (r2 + 1) + 'C' + (c2 + 1);
            }
            var text = (target.node.textContent || '').replace(/\s+/g, ' ').trim();
            if (text.length > 40) text = text.slice(0, 40) + '…';
            info = { id: target.id, name: name, title: text ? name + ' «' + text + '»' : name };
        }
        return info;
    }
    function openEditor(target) {
        if (!available || !target) return;
        hidePencil();
        /* The same element or cell range already has an open note: edit it
         * in the list rather than start a second one. */
        var existing = entries.filter(function (entry) {
            return entry.status !== 'resolved' && entry.elementId === target.id
                && (entry.endElementId || '') === (target.endId || '');
        })[0];
        if (existing) {
            list.hidden = false;
            trayToggle.setAttribute('aria-expanded', 'true');
            startEdit(existing);
            return;
        }
        pending = describe(target);
        if (target.endId) pending.endId = target.endId;
        targetLabel.textContent = pending.title;
        textField.value = '';
        editor.hidden = false;
        var box = target.node.getBoundingClientRect();
        var paneBox = pane.getBoundingClientRect();
        editor.style.left = Math.max(8, Math.min(box.left - paneBox.left, paneBox.width - editor.offsetWidth - 8)) + 'px';
        editor.style.top = Math.max(8, Math.min(box.bottom - paneBox.top + 8, paneBox.height - editor.offsetHeight - 8)) + 'px';
        textField.focus();
    }
    function findTarget(id) {
        var nodes = host.querySelectorAll('[data-id]');
        for (var i = 0; i < nodes.length; i++) if (nodes[i].getAttribute('data-id') === id) return nodes[i];
        return null;
    }
    /* A click on a note selects what it is about; the pencil and Alt+A then
     * refer to that element, not to the one clicked in the form before. */
    function reveal(entry) {
        options.reveal(entry);
        hidePencil();
        var id = String(entry.elementId);
        var node = findTarget(id);
        selected = node && node.getClientRects().length ? { id: id, node: node } : null;
        if (selected && entry.endElementId) selected.endId = String(entry.endElementId);
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
        return fetch(baseUrl + url, { method: method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
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
        var open = entries.filter(function (entry) { return entry.status !== 'resolved'; }).length;
        trayToggle.textContent = 'Аннотации (' + (open === entries.length ? open : open + ' из ' + entries.length) + ')';
        var counts = Object.create(null);
        entries.forEach(function (entry, index) {
            var resolved = entry.status === 'resolved';
            var info = elementInfo(entry.elementId);
            var missing = !!(info && info.missing);
            var marker = document.createElement('span');
            /* The agent's own notes point something out to the user. */
            var agent = entry.author === 'agent';
            marker.className = 'annotation-anchor' + (resolved ? ' resolved' : '') + (agent ? ' agent' : '');
            marker.setAttribute('data-element-id', entry.elementId);
            marker.textContent = String(index + 1);
            marker.title = entry.elementName + ': ' + entry.text;
            marker.annotationIndex = counts[entry.elementId] || 0;
            counts[entry.elementId] = marker.annotationIndex + 1;
            /* The number on the preview selects like its row in the list. */
            if (options && options.reveal && !missing) {
                marker.classList.add('revealable');
                marker.addEventListener('click', function (event) {
                    event.stopPropagation();
                    reveal(entry);
                });
            }
            pane.appendChild(marker);

            var row = document.createElement('li');
            row.className = 'annotation-row' + (resolved ? ' resolved' : '') + (missing ? ' missing' : '') + (agent ? ' agent' : '');
            var number = document.createElement('span');
            number.className = 'annotation-number';
            number.textContent = String(index + 1);
            var content = document.createElement('span');
            content.className = 'annotation-content';
            var name = document.createElement('strong');
            name.textContent = entry.elementName + (agent ? ' · агент' : '');
            var note = document.createElement('span');
            note.className = 'annotation-note';
            note.textContent = entry.text;
            content.appendChild(name);
            content.appendChild(note);
            /* The file changed and the element is no longer in the form. */
            if (missing) {
                var gone = document.createElement('span');
                gone.className = 'annotation-missing';
                gone.textContent = 'Элемент не найден в форме';
                content.appendChild(gone);
            }
            /* The agent marked it done: the user accepts (deletes) or reopens it. */
            if (resolved) {
                var answer = document.createElement('span');
                answer.className = 'annotation-resolution';
                answer.textContent = '✓ ' + (entry.resolution || 'Исправлено агентом');
                content.appendChild(answer);
            }
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
            remove.title = resolved ? 'Принять исправление и убрать аннотацию' : 'Удалить аннотацию';
            remove.setAttribute('aria-label', (resolved ? 'Принять аннотацию ' : 'Удалить аннотацию ') + (index + 1) + ': ' + entry.elementName);
            remove.textContent = resolved ? '✓' : '×';
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
            /* A click on the note selects what it is about. */
            if (options && options.reveal && !missing) {
                row.classList.add('revealable');
                row.addEventListener('click', function (event) {
                    if (event.target.closest('button, textarea')) return;
                    reveal(entry);
                });
            }
            row.appendChild(number);
            row.appendChild(content);
            if (resolved) {
                var reopen = document.createElement('button');
                reopen.type = 'button';
                reopen.className = 'ann-reopen';
                reopen.title = 'Вернуть в работу';
                reopen.setAttribute('aria-label', 'Вернуть в работу аннотацию ' + (index + 1) + ': ' + entry.elementName);
                reopen.textContent = '↺';
                reopen.disabled = edit.disabled;
                reopen.addEventListener('click', function () { reopenEntry(entry); });
                row.appendChild(reopen);
            } else row.appendChild(edit);
            row.appendChild(remove);
            list.appendChild(row);
            if (editing && editing.id === entry.id) renderEdit(entry, row);
        });
        clearAll.disabled = deleting || !!(editing && editing.saving);
        restoreTray();
        updatePositions();
    }
    function reopenEntry(entry) {
        var expected = revision;
        deleting = true;
        list.querySelectorAll('button').forEach(function (button) { button.disabled = true; });
        request('annotations/' + encodeURIComponent(entry.id), 'PATCH', { revision: expected, status: 'open' })
            .then(function (updated) {
                if (revision !== expected) return;
                var index = entries.findIndex(function (item) { return item.id === entry.id; });
                if (index >= 0) entries[index] = updated;
            }).catch(function (error) {
                if (revision === expected) window.alert('Не удалось вернуть аннотацию: ' + errorText(error));
            }).finally(function () {
                deleting = false;
                render();
            });
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
        content.querySelector('.annotation-note').replaceWith(textarea);
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
        textarea.addEventListener('keydown', function (event) {
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !save.disabled) { event.preventDefault(); save.click(); }
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
        if (toggle) toggle.hidden = !available;
        if (!available) { selected = null; hidePencil(); }
        render();
    }
    clearAll.addEventListener('click', function () {
        if (deleting || !entries.length || !window.confirm('Удалить все аннотации (' + entries.length + ')?')) return;
        var expected = revision;
        deleting = true;
        list.querySelectorAll('button, textarea').forEach(function (node) { node.disabled = true; });
        clearAll.disabled = true;
        request('annotations', 'DELETE', { revision: expected })
            .then(function () {
                if (revision !== expected) return;
                entries = [];
                editing = null;
            }).catch(function (error) {
                if (revision === expected) window.alert('Не удалось очистить аннотации: ' + errorText(error));
            }).finally(function () {
                deleting = false;
                render();
            });
    });
    if (toggle) toggle.addEventListener('click', function () {
        var target = currentTarget();
        if (target) openEditor(target);
        else window.alert('Выделите элемент формы, затем нажмите «Аннотация» или Alt+A.');
    });
    pencil.addEventListener('mousedown', function (event) { event.preventDefault(); });
    pencil.addEventListener('click', function () { openEditor(currentTarget()); });
    /* The list's header drags it anywhere over the pane; a click without
     * movement still folds it. The place is kept per viewer in localStorage
     * as fractions of the pane, so a resize keeps it in view. */
    var TRAY_KEY = 'session-annotations.tray';
    trayToggle.title = 'Перетащите, чтобы переместить; щелчок сворачивает список';
    var dragged = false;
    function placeTray(left, top) {
        var paneBox = pane.getBoundingClientRect();
        left = Math.max(0, Math.min(left, paneBox.width - tray.offsetWidth));
        top = Math.max(0, Math.min(top, paneBox.height - tray.offsetHeight));
        tray.style.left = left + 'px';
        tray.style.top = top + 'px';
        tray.style.right = 'auto';
        tray.style.bottom = 'auto';
        tray.setAttribute('data-moved', '1');
    }
    function restoreTray() {
        var saved = null;
        try { saved = JSON.parse(localStorage.getItem(TRAY_KEY) || 'null'); } catch (error) { saved = null; }
        if (!saved || tray.hidden) return;
        var paneBox = pane.getBoundingClientRect();
        placeTray(saved.x * paneBox.width, saved.y * paneBox.height);
    }
    trayToggle.addEventListener('pointerdown', function (event) {
        if (event.button !== 0) return;
        var trayBox = tray.getBoundingClientRect();
        var dx = event.clientX - trayBox.left, dy = event.clientY - trayBox.top;
        var startX = event.clientX, startY = event.clientY;
        dragged = false;
        trayToggle.setPointerCapture(event.pointerId);
        function move(moveEvent) {
            if (!dragged && Math.abs(moveEvent.clientX - startX) + Math.abs(moveEvent.clientY - startY) < 4) return;
            dragged = true;
            var paneBox = pane.getBoundingClientRect();
            placeTray(moveEvent.clientX - paneBox.left - dx, moveEvent.clientY - paneBox.top - dy);
        }
        function up() {
            trayToggle.removeEventListener('pointermove', move);
            trayToggle.removeEventListener('pointerup', up);
            trayToggle.removeEventListener('pointercancel', up);
            if (!dragged) return;
            var paneBox = pane.getBoundingClientRect();
            try {
                localStorage.setItem(TRAY_KEY, JSON.stringify({
                    x: (parseFloat(tray.style.left) || 0) / paneBox.width,
                    y: (parseFloat(tray.style.top) || 0) / paneBox.height
                }));
            } catch (error) { /* storage off: the place lasts until reload */ }
        }
        trayToggle.addEventListener('pointermove', move);
        trayToggle.addEventListener('pointerup', up);
        trayToggle.addEventListener('pointercancel', up);
    });
    window.addEventListener('resize', restoreTray);
    trayToggle.addEventListener('click', function () {
        if (dragged) { dragged = false; return; }
        list.hidden = !list.hidden;
        trayToggle.setAttribute('aria-expanded', list.hidden ? 'false' : 'true');
    });
    document.getElementById('annotation-cancel').addEventListener('click', closeEditor);
    /* Ctrl+Enter adds the note without reaching for the mouse. */
    textField.addEventListener('keydown', function (event) {
        if (event.key !== 'Enter' || !(event.ctrlKey || event.metaKey)) return;
        event.preventDefault();
        editor.requestSubmit();
    });
    editor.addEventListener('submit', function (event) {
        event.preventDefault();
        if (!pending || !textField.value.trim()) return;
        var selected = pending;
        var value = textField.value.trim();
        var expected = revision;
        closeEditor();
        var body = { revision: expected, elementId: selected.id, elementName: selected.name, text: value };
        if (selected.endId) body.endElementId = selected.endId;
        request('annotations', 'POST', body)
            .then(function (entry) {
                if (revision !== expected) return;
                entries.push(entry);
                render();
            }).catch(function (error) { window.alert('Не удалось добавить аннотацию: ' + errorText(error)); });
    });
    /* A drag over spreadsheet cells ends in a click on their common row or
     * table, so the range is taken from where the button went down and up. */
    var downNode = null, upNode = null;
    host.addEventListener('mousedown', function (event) { downNode = elementNode(event.target); upNode = null; }, true);
    document.addEventListener('mouseup', function (event) { upNode = elementNode(event.target); }, true);
    host.addEventListener('click', function (event) {
        if (!available) return;
        var node = elementNode(event.target);
        var cellId = /^r\d+c\d+$/;
        var from = downNode && downNode.getAttribute('data-id'), to = upNode && upNode.getAttribute('data-id');
        var range = from && to && from !== to && cellId.test(from) && cellId.test(to);
        if (range) node = downNode;
        if (!node) { selected = null; hidePencil(); return; }
        selected = { id: node.getAttribute('data-id'), node: node };
        if (range) selected.endId = to;
        var paneBox = pane.getBoundingClientRect();
        pencil.hidden = false;
        pencil.style.left = Math.max(0, Math.min(event.clientX - paneBox.left + 10, paneBox.width - 26)) + 'px';
        pencil.style.top = Math.max(0, Math.min(event.clientY - paneBox.top + 10, paneBox.height - 26)) + 'px';
    }, true);   /* capture: hosts that handle the click themselves (BSLEdit) stop it */
    /* Alt+A by the physical key, so the Russian layout (Alt+Ф) works too. */
    document.addEventListener('keydown', function (event) {
        if (event.key === 'Escape') { hidePencil(); if (!editor.hidden) closeEditor(); return; }
        if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.code !== 'KeyA') return;
        if (!available || !editor.hidden || editing) return;
        var focused = document.activeElement;
        if (focused && focused !== document.body && !host.contains(focused) && focused.matches('input, textarea, [contenteditable]')) return;
        var target = currentTarget();
        if (!target || !host.getClientRects().length) return;
        event.preventDefault();
        event.stopPropagation();
        openEditor(target);
    }, true);
    document.addEventListener('scroll', hidePencil, true);
    document.addEventListener('scroll', updatePositions, true);
    window.addEventListener('resize', updatePositions);
    host.addEventListener('click', function () { requestAnimationFrame(updatePositions); }, true);
    return {
        snapshot: snapshot,
        updatePositions: updatePositions,
        setBaseUrl: function (url) { baseUrl = url || ''; },
        /* A poll must not wipe an edit in progress. */
        busy: function () { return !!(pending || editing || deleting); }
    };
};
})(window);
