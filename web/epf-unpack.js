/* The unpacking panel of an external data processor or report (.epf/.erf).
 *
 * The host (webview2host.cpp, epfunpack.cpp) owns everything that touches the
 * disk and the platform: the lists of platforms and infobases, the dialogs,
 * ibcmd itself. The panel only keeps the fields, asks the host by "epf*"
 * commands and prints what it answers. "Открыть" does not start another
 * program: the viewer loads the unpacked object's root XML in place
 * (options.open), and "Уровень вверх" from there comes back here. */
(function (root) {
'use strict';

var el = {};
var send = null;
var options = {};
var model = {
    path: '',          // the file the panel was opened for
    bases: [],
    rootXml: '',
    rootExists: false,
    running: false,
    initialized: false,
    keepFields: false,  // coming back to the same file: only the host's state is refreshed
    newDirTouched: false  // the new base folder follows its name until edited by hand
};
var checkTimer = 0;
/* A saved password is shown as if it were in the field; the page never has
 * it. Left untouched, the host uses the saved one (useSaved). */
var SAVED_MASK = '********';
var masked = { ext: false, ib: false };

function $(id) { return document.getElementById(id); }

function bind() {
    if (el.panel) return;
    ['file', 'file-browse', 'target', 'target-browse', 'explore', 'platform', 'base', 'user', 'password', 'add-git',
     'save-auth', 'cf', 'cf-browse', 'cache-info', 'empty-note', 'unpack', 'open', 'open-after', 'clear-cache', 'log',
     'do-load', 'do-unpack', 'ib-base', 'ib-user', 'ib-password', 'ib-save-auth', 'new-name', 'new-dir',
     'new-dir-browse', 'ib-warning', 'ext-unsafe', 'ext-unsafe-row', 'target-row', 'ib-group', 'ib-existing',
     'ib-new', 'base-row', 'base-gap', 'cf-row', 'cf-gap', 'open-after-row', 'ext-unsafe-server', 'git-row']
        .forEach(function (id) { el[id.replace(/-(\w)/g, function (m, c) { return c.toUpperCase(); })] = $('epf-' + id); });
    el.panel = $('epf');
    enhanceSelect(el.base);
    enhanceSelect(el.ibBase);
    el.kinds = document.querySelectorAll('#epf input[name="epf-kind"]');
    el.ibModes = document.querySelectorAll('#epf input[name="epf-ib"]');

    el.doLoad.addEventListener('change', updateControls);
    el.ibBase.addEventListener('change', updateControls);
    el.doUnpack.addEventListener('change', function () { updateControls(); scheduleCheck(); });
    el.addGit.addEventListener('change', function () { send({ cmd: 'epfSetGitAdd', on: el.addGit.checked }); });
    Array.prototype.forEach.call(el.ibModes, function (radio) { radio.addEventListener('change', updateControls); });
    el.ibBase.addEventListener('change', onIbBaseChanged);
    el.ibSaveAuth.addEventListener('change', updatePasswordHint);
    el.newName.addEventListener('input', function () {
        if (!model.newDirTouched) el.newDir.value = defaultNewDir(el.file.value, el.newName.value);
    });
    el.newDir.addEventListener('input', function () { model.newDirTouched = true; });
    el.newDirBrowse.addEventListener('click', function () { browse('newDir', el.newDir.value); });

    el.fileBrowse.addEventListener('click', function () { browse('file', el.file.value); });
    el.targetBrowse.addEventListener('click', function () { browse('target', el.target.value); });
    el.cfBrowse.addEventListener('click', function () { browse('cf', el.cf.value); });
    el.explore.addEventListener('click', function () { send({ cmd: 'epfExplore', target: el.target.value }); });
    el.file.addEventListener('input', function () { onFileChanged(el.file.value); });
    el.target.addEventListener('input', scheduleCheck);
    el.cf.addEventListener('input', scheduleCheck);
    el.platform.addEventListener('change', scheduleCheck);
    el.base.addEventListener('change', onBaseChanged);
    Array.prototype.forEach.call(el.kinds, function (radio) {
        radio.addEventListener('change', function () { updateControls(); scheduleCheck(); });
    });
    el.unpack.addEventListener('click', onUnpackClick);
    el.open.addEventListener('click', openResult);
    el.openAfter.addEventListener('change', function () {
        send({ cmd: 'epfSetOpenAfter', on: el.openAfter.checked });
    });
    el.saveAuth.addEventListener('change', updatePasswordHint);
    wirePassword(el.password, 'ext');
    wirePassword(el.ibPassword, 'ib');
    el.clearCache.addEventListener('click', function (e) {
        e.preventDefault();
        if (model.running) return;
        if (window.confirm('Удалить все служебные базы распаковки?')) send({ cmd: 'epfClearCache' });
    });
    /* Enter anywhere in the form is «Распаковать», as the dialog's default button. */
    $('epf-form').addEventListener('keydown', function (e) {
        if (e.key !== 'Enter' || e.target.tagName === 'BUTTON' || e.target.tagName === 'A') return;
        e.preventDefault();
        if (!model.running) onUnpackClick();
    });
}

function kind() {
    for (var i = 0; i < el.kinds.length; i++) if (el.kinds[i].checked) return el.kinds[i].value;
    return 'empty';
}

function setKind(value) {
    for (var i = 0; i < el.kinds.length; i++) el.kinds[i].checked = el.kinds[i].value === value;
}

function selectedBase() {
    return model.bases[el.base.selectedIndex] || null;
}

function fileStem(path) {
    var name = String(path || '').trim().replace(/^"|"$/g, '').split(/[\\/]/).pop();
    var dot = name.lastIndexOf('.');
    return dot > 0 ? name.slice(0, dot) : name;
}

function defaultTarget(file) {
    var f = String(file || '').trim().replace(/^"|"$/g, '');
    var slash = Math.max(f.lastIndexOf('\\'), f.lastIndexOf('/'));
    if (!f || slash < 0) return '';
    var dir = f.slice(0, slash);
    var parentSlash = Math.max(dir.lastIndexOf('\\'), dir.lastIndexOf('/'));
    var dirName = dir.slice(parentSlash + 1);
    if (dirName.toLowerCase() === 'build') {
        dir = dir.slice(0, parentSlash + 1) + 'src';
        var ext = /\.([^.\\/]+)$/.exec(f);
        var bucket = ext && /^(epf|erf|cf|cfe)$/i.test(ext[1]) ? ext[1].toLowerCase() : '';
        if (bucket) dir += '\\' + bucket;
    }
    return dir + '\\' + fileStem(f);
}

/* A folder picked with «...» is where the processing goes, not the folder
 * itself: <picked>\<name of the processing>, unless it already is that. */
function targetIn(folder, file) {
    var dir = String(folder || '').replace(/[\\/]+$/, '');
    var stem = fileStem(file);
    if (!dir || !stem) return dir;
    var last = dir.split(/[\\/]/).pop();
    if (last.toLowerCase() === stem.toLowerCase()) return dir;
    return dir + '\\' + stem;
}

/* external: .epf/.erf; cf, cfe, dt: a configuration, an extension, an infobase dump. */
function fileKind(path) {
    var m = /\.(epf|erf|cf|cfe|dt)\s*"?\s*$/i.exec(String(path || ''));
    if (!m) return 'external';
    var ext = m[1].toLowerCase();
    return ext === 'epf' || ext === 'erf' ? 'external' : ext;
}

function configMode() { return fileKind(el.file.value) !== 'external'; }

function fileDir(file) {
    var f = String(file || '').trim().replace(/^"|"$/g, '');
    var slash = Math.max(f.lastIndexOf('\\'), f.lastIndexOf('/'));
    return slash < 0 ? '' : f.slice(0, slash);
}

function defaultNewDir(file, name) {
    var dir = fileDir(file);
    var n = String(name || '').trim() || fileStem(file);
    return dir && n ? dir + '\\' + n + '_base' : '';
}

function onFileChanged(path) {
    el.target.value = defaultTarget(path);
    el.newName.value = fileStem(path);
    model.newDirTouched = false;
    el.newDir.value = defaultNewDir(path, el.newName.value);
    updateControls();
    scheduleCheck();
}

function ibMode() {
    for (var i = 0; i < el.ibModes.length; i++) if (el.ibModes[i].checked) return el.ibModes[i].value;
    return 'existing';
}

function setIbMode(value) {
    for (var i = 0; i < el.ibModes.length; i++) el.ibModes[i].checked = el.ibModes[i].value === value;
}

function selectedIbBase() {
    return model.bases[el.ibBase.selectedIndex] || null;
}

function onIbBaseChanged() {
    var b = selectedIbBase();
    el.ibUser.value = b ? b.user || '' : '';
    el.ibPassword.value = '';
    masked.ib = false;
    el.ibSaveAuth.checked = !!(b && b.savedAuth);
    el.ibBase.title = b ? b.display : '';
    updatePasswordHint();
    updateControls();
}

/* What loading will do to the chosen base, said before it is done. */
function ibWarning() {
    if (!el.doLoad.checked || ibMode() !== 'existing') return '';
    var b = selectedIbBase();
    var name = b ? '«' + b.name + '»' : 'выбранной базы';
    var k = fileKind(el.file.value);
    if (k === 'dt') return 'Все данные базы ' + name + ' будут заменены данными из файла.';
    if (k === 'cf') return 'Конфигурация базы ' + name + ' будет заменена, конфигурация базы данных — обновлена.';
    return 'Расширение будет загружено в базу ' + name + '; расширение с тем же именем будет заменено.';
}

function actionTitle() {
    if (!configMode()) return 'Распаковать';
    var load = el.doLoad.checked, unpack = el.doUnpack.checked;
    return load && unpack ? 'Загрузить и распаковать' : load ? 'Загрузить' : 'Распаковать';
}

/* An empty base resolves no references: say so for what is being unpacked. */
function updateEmptyNote() {
    var report = /\.erf\s*"?\s*$/i.test(el.file.value);
    el.emptyNote.textContent = '— только если ' + (report ? 'отчёт' : 'обработка') + ' не содержит ссылочные типы';
}

function fields() {
    return {
        file: el.file.value,
        target: el.target.value,
        platform: el.platform.value,
        kind: kind(),
        cf: el.cf.value
    };
}

function scheduleCheck() {
    updateEmptyNote();
    el.panel.classList.toggle('config-mode', configMode());
    clearTimeout(checkTimer);
    checkTimer = setTimeout(function () {
        var f = fields();
        f.cmd = 'epfCheck';
        send(f);
    }, 150);
}

function browse(what, current) {
    send({ cmd: 'epfBrowse', what: what, current: current || '' });
}

function onBaseChanged() {
    var b = selectedBase();
    el.user.value = b ? b.user || '' : '';
    el.password.value = '';
    masked.ext = false;
    el.saveAuth.checked = !!(b && b.savedAuth);
    el.base.title = b ? b.display : '';
    updatePasswordHint();
}

function wirePassword(input, which) {
    input.addEventListener('input', function () { masked[which] = false; });
    /* Typing over the stand-in replaces it as a whole. */
    input.addEventListener('focus', function () { if (masked[which] && input.select) input.select(); });
}

function applyMask(input, which, base, save) {
    var saved = !!(base && base.savedAuth && save.checked);
    if (saved && (masked[which] || !input.value)) {
        input.value = SAVED_MASK;
        masked[which] = true;
    } else if (!saved && masked[which]) {
        input.value = '';
        masked[which] = false;
    }
}

function updatePasswordHint() {
    applyMask(el.password, 'ext', selectedBase(), el.saveAuth);
    applyMask(el.ibPassword, 'ib', selectedIbBase(), el.ibSaveAuth);
}

function updateControls() {
    var busy = model.running;
    var k = kind();
    [el.file, el.fileBrowse, el.target, el.targetBrowse, el.platform, el.addGit].forEach(function (c) { c.disabled = busy; });
    Array.prototype.forEach.call(el.kinds, function (radio) {
        radio.disabled = busy || (radio.value === 'base' && !model.bases.length);
    });
    el.base.disabled = el.user.disabled = el.password.disabled = el.saveAuth.disabled = busy;
    el.cf.disabled = el.cfBrowse.disabled = busy;
    /* Only the fields of the chosen context are shown. */
    el.baseRow.hidden = k !== 'base';
    el.baseGap.hidden = !el.baseRow.hidden;
    el.cfRow.hidden = k !== 'cf';
    el.cfGap.hidden = !el.cfRow.hidden;
    var config = configMode();
    el.panel.classList.toggle('config-mode', config);
    var fileType = fileKind(el.file.value);
    el.gitRow.hidden = config ? (!el.doUnpack.checked || (fileType !== 'cf' && fileType !== 'cfe'))
        : (fileType !== 'external');
    if (!config) {
        el.targetRow.hidden = el.openAfterRow.hidden = el.open.hidden = false;
    }
    if (config) {
        var load = el.doLoad.checked, unpack = el.doUnpack.checked, existing = ibMode() === 'existing';
        el.doLoad.disabled = el.doUnpack.disabled = busy;
        Array.prototype.forEach.call(el.ibModes, function (radio) {
            radio.disabled = busy || (radio.value === 'existing' && !model.bases.length);
        });
        el.ibBase.disabled = el.ibUser.disabled = el.ibPassword.disabled = el.ibSaveAuth.disabled = busy;
        el.newName.disabled = el.newDir.disabled = el.newDirBrowse.disabled = el.extUnsafe.disabled = busy;
        /* Only what the chosen actions use is shown. */
        el.targetRow.hidden = !unpack;
        el.openAfterRow.hidden = !unpack;
        el.open.hidden = !unpack;
        el.ibGroup.hidden = !load;
        el.ibExisting.hidden = !existing;
        el.ibNew.hidden = existing;
        /* ibcmd sets extension properties in a file base only. */
        var ib = selectedIbBase();
        var serverBase = existing && !!(ib && ib.server);
        el.extUnsafeRow.hidden = fileKind(el.file.value) !== 'cfe' || serverBase;
        el.extUnsafeServer.hidden = fileKind(el.file.value) !== 'cfe' || !serverBase;
        var warning = ibWarning();
        el.ibWarning.textContent = warning;
        el.ibWarning.hidden = !warning;
    }
    el.unpack.textContent = busy ? 'Отмена' : actionTitle();
    syncCombos();
    el.open.disabled = busy || !model.rootExists;
    el.clearCache.classList.toggle('disabled', busy);
    el.panel.classList.toggle('busy', busy);
}

function formatSize(bytes) {
    if (bytes >= 1073741824) return (bytes / 1073741824).toFixed(1).replace('.', ',') + ' ГБ';
    if (bytes >= 1048576) return Math.round(bytes / 1048576) + ' МБ';
    return Math.round(bytes / 1024) + ' КБ';
}

function pad2(n) { return (n < 10 ? '0' : '') + n; }

function log(line) {
    var d = new Date();
    var stamp = pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
    var atEnd = el.log.scrollTop + el.log.clientHeight >= el.log.scrollHeight - 4;
    el.log.value += stamp + '  ' + line + '\n';
    if (atEnd) el.log.scrollTop = el.log.scrollHeight;
}

function onUnpackClick() {
    if (model.running) {
        send({ cmd: 'epfCancel' });
        return;
    }
    if (!el.platform.value) { window.alert('Не найдена платформа 1С с ibcmd.exe.'); return; }
    var config = configMode();
    var fileType = fileKind(el.file.value);
    var unpack = !config || el.doUnpack.checked;
    if (config && !el.doLoad.checked && !unpack) { window.alert('Выберите действие: загрузить в базу и/или распаковать.'); return; }
    if (unpack && !el.target.value.trim()) { window.alert('Укажите каталог распаковки.'); return; }
    var warning = config ? ibWarning() : '';
    if (warning && !window.confirm(warning + '\n\nПродолжить?')) return;
    if (unpack && model.rootExists && !window.confirm('В каталоге уже есть распаковка:\n' + model.rootXml
            + '\n\nЗаменить её?')) return;
    var f = fields();
    f.cmd = 'epfUnpack';
    f.gitAdd = el.addGit.checked && (fileType === 'external' || fileType === 'cf' || fileType === 'cfe');
    if (config) {
        f.load = el.doLoad.checked;
        f.unpack = unpack;
        f.newBase = ibMode() === 'new';
        f.newName = el.newName.value;
        f.newDir = el.newDir.value;
        var ib = selectedIbBase();
        f.baseId = ib ? ib.id : '';
        f.user = el.ibUser.value;
        f.password = masked.ib ? '' : el.ibPassword.value;
        f.useSaved = masked.ib;
        f.saveAuth = el.ibSaveAuth.checked;
        f.extUnsafe = !el.extUnsafeRow.hidden && el.extUnsafe.checked;
        el.log.value = '';
        send(f);
        return;
    }
    var b = selectedBase();
    if (f.kind === 'base') {
        f.baseId = b ? b.id : '';
        f.user = el.user.value;
        f.password = masked.ext ? '' : el.password.value;
        f.useSaved = masked.ext;
        f.saveAuth = el.saveAuth.checked;
    }
    el.log.value = '';
    send(f);
}

function openResult() {
    if (model.running || !model.rootExists || !options.open) return;
    options.open(el.file.value, el.target.value, model.rootXml);
}

/* An infobase list shows each base's name and, in a smaller monospace line,
 * its connection string. A native <select> cannot mix fonts in an option, so
 * a drop-down is drawn over it; the hidden <select> stays the model the rest
 * of the panel reads (selectedIndex, change, disabled). */
var combos = [];

function enhanceSelect(select) {
    var parent = select.parentNode;
    if (!parent || typeof select.dispatchEvent !== 'function' || typeof Event !== 'function') return;
    var box = document.createElement('div');
    box.className = 'epf-combo ' + select.className;
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'epf-combo-btn';
    button.setAttribute('aria-haspopup', 'listbox');
    var list = document.createElement('div');
    list.className = 'epf-combo-list';
    list.setAttribute('role', 'listbox');
    list.hidden = true;
    box.appendChild(button);
    box.appendChild(list);
    parent.insertBefore(box, select);
    select.classList.add('epf-combo-model');
    var combo = { select: select, box: box, button: button, list: list, active: -1 };
    combos.push(combo);

    function choose(index) {
        close();
        if (index < 0 || index === select.selectedIndex) return;
        select.selectedIndex = index;
        select.dispatchEvent(new Event('change'));
        renderCombo(combo);
    }
    function open() {
        if (select.disabled || !model.bases.length) return;
        combo.active = select.selectedIndex;
        list.hidden = false;
        renderCombo(combo);
        box.classList.add('open');
        var current = list.children[combo.active];
        if (current && current.scrollIntoView) current.scrollIntoView({ block: 'nearest' });
    }
    function close() {
        list.hidden = true;
        box.classList.remove('open');
    }
    function move(delta) {
        var n = model.bases.length;
        if (!n) return;
        combo.active = Math.max(0, Math.min(n - 1, (combo.active < 0 ? select.selectedIndex : combo.active) + delta));
        if (list.hidden) { choose(combo.active); return; }
        renderCombo(combo);
        var item = list.children[combo.active];
        if (item && item.scrollIntoView) item.scrollIntoView({ block: 'nearest' });
    }
    combo.close = close;
    button.addEventListener('click', function () { if (list.hidden) open(); else close(); });
    button.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            if (e.altKey) { if (list.hidden) open(); else close(); return; }
            move(e.key === 'ArrowDown' ? 1 : -1);
        } else if ((e.key === 'Enter' || e.key === ' ') && !list.hidden) {
            e.preventDefault();
            e.stopPropagation();
            choose(combo.active);
        } else if (e.key === 'Escape' && !list.hidden) {
            e.preventDefault();
            e.stopPropagation();
            close();
        } else if (e.key === 'F4') {
            e.preventDefault();
            if (list.hidden) open(); else close();
        }
    });
    list.addEventListener('mousedown', function (e) { e.preventDefault(); });
    list.addEventListener('click', function (e) {
        var item = e.target.closest ? e.target.closest('.epf-combo-item') : null;
        if (item) choose(Number(item.getAttribute('data-index')));
    });
    button.addEventListener('blur', close);
}

function comboLine(cls, text) {
    var span = document.createElement('span');
    span.className = cls;
    span.textContent = text;
    return span;
}

function renderCombo(combo) {
    var select = combo.select;
    var b = model.bases[select.selectedIndex];
    combo.box.classList.toggle('disabled', !!select.disabled);
    combo.button.disabled = !!select.disabled;
    combo.button.innerHTML = '';
    combo.button.appendChild(comboLine('epf-combo-name', b ? b.name + (b.supported ? '' : ' (не поддерживается)') : ''));
    combo.button.appendChild(comboLine('epf-combo-conn', b ? b.display : ''));
    combo.button.title = b ? b.name + '\n' + b.display : '';
    if (combo.list.hidden) return;
    combo.list.innerHTML = '';
    model.bases.forEach(function (base, i) {
        var item = document.createElement('div');
        item.className = 'epf-combo-item' + (i === select.selectedIndex ? ' selected' : '')
            + (i === combo.active ? ' active' : '') + (base.supported ? '' : ' unsupported');
        item.setAttribute('role', 'option');
        item.setAttribute('data-index', String(i));
        item.appendChild(comboLine('epf-combo-name', base.name + (base.supported ? '' : ' (не поддерживается)')));
        item.appendChild(comboLine('epf-combo-conn', base.display));
        combo.list.appendChild(item);
    });
}

function syncCombos() {
    combos.forEach(renderCombo);
}

function fillBases(select, bases, id) {
    var keep = select.selectedIndex >= 0 && model.bases[select.selectedIndex]
        ? model.bases[select.selectedIndex].id : id;
    select.innerHTML = '';
    var index = 0;
    bases.forEach(function (b, i) {
        var o = document.createElement('option');
        o.textContent = b.name + (b.supported ? '' : ' (не поддерживается)');
        o.title = b.display;
        select.appendChild(o);
        if (b.id === keep) index = i;
    });
    if (bases.length) select.selectedIndex = index;
    /* The drop-down reads model.bases, set by the caller right after. */
    setTimeout(syncCombos, 0);
}

function fillState(d) {
    if (model.keepFields) {
        model.keepFields = false;
        /* A base created by the last run is in the list now. */
        var ibIndex = el.ibBase.selectedIndex;
        var ibId = ibIndex >= 0 && model.bases[ibIndex] ? model.bases[ibIndex].id : d.baseId;
        var bases = d.bases || [];
        /* Both drop-downs index model.bases: refill the other one as well,
         * or its selection points at whatever base now has that position. */
        var extIndex = el.base.selectedIndex;
        var extId = extIndex >= 0 && model.bases[extIndex] ? model.bases[extIndex].id : d.baseId;
        fillBases(el.base, bases, extId);
        fillBases(el.ibBase, bases, ibId);
        model.bases = bases;
        model.running = !!d.running;
        updateControls();
        scheduleCheck();
        return;
    }
    el.file.value = d.file || '';
    el.target.value = d.target || '';

    el.platform.innerHTML = '';
    (d.platforms || []).forEach(function (v) {
        var o = document.createElement('option');
        o.value = o.textContent = v;
        el.platform.appendChild(o);
    });
    if (!(d.platforms || []).length) {
        var none = document.createElement('option');
        none.value = '';
        none.textContent = 'Платформа 1С с ibcmd.exe не найдена';
        el.platform.appendChild(none);
    } else if (d.platform && d.platforms.indexOf(d.platform) >= 0) {
        el.platform.value = d.platform;
    }

    model.bases = [];
    el.base.innerHTML = '';
    el.ibBase.innerHTML = '';
    fillBases(el.base, d.bases || [], d.baseId);
    fillBases(el.ibBase, d.bases || [], d.baseId);
    model.bases = d.bases || [];
    onBaseChanged();
    onIbBaseChanged();

    el.doLoad.checked = !!d.cfgLoad;
    el.doUnpack.checked = d.cfgUnpack !== false;
    el.addGit.checked = !!d.gitAdd;
    el.extUnsafe.checked = !!d.cfgExtUnsafe;
    setIbMode(d.cfgNewBase || !model.bases.length ? 'new' : 'existing');
    el.newName.value = fileStem(el.file.value);
    model.newDirTouched = false;
    el.newDir.value = defaultNewDir(el.file.value, el.newName.value);

    el.cf.value = d.cf || '';
    el.openAfter.checked = !!d.openAfter;
    setKind(d.kind === 'base' && !model.bases.length ? 'empty' : d.kind || 'empty');
    model.running = !!d.running;
    model.initialized = true;
    updateControls();
    scheduleCheck();
}

function onMessage(d) {
    if (!el.panel) return;
    switch (d.cmd) {
        case 'epfState':
            fillState(d);
            break;
        case 'epfInfo':
            model.rootExists = !!d.rootExists;
            model.rootXml = d.rootXml || '';
            el.cacheInfo.textContent = d.cacheInfo || '';
            el.cacheInfo.hidden = !d.cacheInfo;
            el.clearCache.textContent = 'Очистить кэш служебных баз ('
                + (d.cacheSize > 0 ? formatSize(d.cacheSize) : 'пусто') + ')';
            updateControls();
            break;
        case 'epfBrowsed':
            if (!d.path) break;
            if (d.what === 'file') {
                el.file.value = d.path;
                onFileChanged(d.path);
                break;
            } else if (d.what === 'newDir') {
                el.newDir.value = targetIn(d.path, el.newName.value);
                model.newDirTouched = true;
            } else if (d.what === 'target') {
                el.target.value = targetIn(d.path, el.file.value);
            } else if (d.what === 'cf') {
                el.cf.value = d.path;
            }
            scheduleCheck();
            break;
        case 'epfStarted':
            model.running = true;
            updateControls();
            break;
        case 'epfLog':
            log(d.line || '');
            break;
        case 'epfDone':
            model.running = false;
            if (d.canceled) log('Отменено.');
            else if (!d.ok && d.error) log('ОШИБКА: ' + d.error);
            var unpacked = !configMode() || el.doUnpack.checked;
            if (d.ok && configMode()) {
                var ibb = selectedIbBase();
                if (ibb && el.doLoad.checked && ibMode() === 'existing') {
                    ibb.savedAuth = el.ibSaveAuth.checked;
                    ibb.user = el.ibUser.value;
                    el.ibPassword.value = '';
                    masked.ib = false;
                    updatePasswordHint();
                }
                /* A new base joined the list: pick it up without losing the fields. */
                if (el.doLoad.checked && ibMode() === 'new') {
                    model.keepFields = true;
                    send({ cmd: 'epfInit' });
                }
            }
            if (d.ok && unpacked) {
                model.rootExists = true;
                model.rootXml = d.rootXml || model.rootXml;
                /* The saved password now exists (or not) on the host side. */
                var b = selectedBase();
                if (b && kind() === 'base') {
                    b.savedAuth = el.saveAuth.checked;
                    b.user = el.user.value;
                    el.password.value = '';
                    masked.ext = false;
                    updatePasswordHint();
                }
            }
            updateControls();
            scheduleCheck();
            if (!d.ok && !d.canceled && d.error) window.alert(d.error);
            else if (d.ok && unpacked && el.openAfter.checked) openResult();
            break;
        case 'epfCacheCleared':
            if (d.ok) log('Кэш служебных баз очищен.');
            else if (d.error) window.alert(d.error);
            scheduleCheck();
            break;
        case 'epfNotice':
            if (d.text) window.alert(d.text);
            break;
    }
}

/* `req` is the host's load request of the .epf; `opts.open(file, target,
 * rootXml)` shows the unpacked object in place. Coming back to the same file
 * keeps what the panel had — fields, log, a running unpacking. */
function show(req, sendFn, opts) {
    send = sendFn;
    options = opts || {};
    bind();
    el.panel.hidden = false;
    document.documentElement.classList.add('epf-mode');
    model.keepFields = model.initialized && model.path === req.path;
    if (!model.keepFields) {
        model.path = req.path || '';
        model.initialized = false;
        model.rootExists = false;
        el.log.value = '';
    }
    send({ cmd: 'epfInit' });
}

function hide() {
    if (!el.panel) return;
    el.panel.hidden = true;
    document.documentElement.classList.remove('epf-mode');
}

root.EpfUnpack = {
    show: show,
    hide: hide,
    onMessage: onMessage,
    running: function () { return model.running; },
    visible: function () { return !!(el.panel && !el.panel.hidden); }
};
})(typeof globalThis !== 'undefined' ? globalThis : window);
