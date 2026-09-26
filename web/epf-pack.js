/* The assembly panel: the other direction of epf-unpack.js.
 *
 * What it offers follows the object the user came from, not a set of options
 * to combine:
 *   external — the root XML of an external data processor or report: assemble
 *              it back into its .epf/.erf against an empty base, a base of
 *              the list or a .cf, exactly as unpacking resolved it;
 *   object   — one object of a configuration export: load that object, with
 *              every file of it, into an infobase of the list;
 *   config   — the root of a configuration or an extension: assemble it into
 *              a .cf/.cfe, load it into an infobase, or both.
 * The host (webview2host.cpp, epfunpack.cpp) owns the disk and the platform;
 * the panel keeps the fields, asks by "pack*" commands and prints the answer. */
(function (root) {
'use strict';

var el = {};
var send = null;
var model = {
    source: '',        // the dump the panel was opened for
    sourcePath: '',    // the root XML shown as a link, kept out of the DOM
    dump: 'none',      // external | config | none
    mode: 'none',      // external | object | config | none
    dumpDir: '',
    rootXml: '',
    extension: '',
    report: false,     // an external object: a report rather than a data processor
    object: '',        // the object to load, relative to the dump
    bases: [],
    running: false,
    initialized: false,
    keepFields: false,
    outTouched: false  // the file to assemble into follows the source until edited
};
/* A saved password is shown as if it were in the field; the page never has
 * it. The infobase to load into and the one an external object resolves its
 * references against are chosen separately, so each keeps its own. */
var SAVED_MASK = '********';
var masked = { load: false, ctx: false };

function $(id) { return document.getElementById(id); }

function bind() {
    if (el.panel) return;
    ['source', 'explore', 'dump', 'object', 'object-row', 'do-row',
     'do-assemble', 'do-load', 'out', 'out-row', 'out-browse', 'platform', 'context-group',
     'ctx-base', 'ctx-base-row', 'ctx-user', 'ctx-password', 'ctx-save-auth',
     'cf', 'cf-row', 'cf-browse', 'ib-group',
     'ib-legend', 'base', 'user', 'password', 'save-auth', 'update-db', 'load-note',
     'run', 'log', 'form']
        .forEach(function (id) { el[id.replace(/-(\w)/g, function (m, c) { return c.toUpperCase(); })] = $('pack-' + id); });
    el.panel = $('pack');
    el.kinds = document.querySelectorAll('#pack input[name="pack-kind"]');

    el.outBrowse.addEventListener('click', function () { browse('out', el.out.value); });
    el.cfBrowse.addEventListener('click', function () { browse('cf', el.cf.value); });
    el.explore.addEventListener('click', function () { send({ cmd: 'packExplore', out: el.out.value }); });
    /* The dump is shown, not edited: the link leads back to the object it
     * was opened from — what the «К объекту» button used to do. */
    el.source.addEventListener('click', function (e) {
        e.preventDefault();
        if (!model.running) send({ cmd: 'packBack' });
    });
    el.out.addEventListener('input', function () { model.outTouched = true; updateControls(); });
    el.cf.addEventListener('input', updateControls);
    el.doAssemble.addEventListener('change', updateControls);
    el.doLoad.addEventListener('change', updateControls);
    el.base.addEventListener('change', onBaseChanged);
    el.ctxBase.addEventListener('change', onContextBaseChanged);
    Array.prototype.forEach.call(el.kinds, function (r) { r.addEventListener('change', updateControls); });
    el.run.addEventListener('click', onRunClick);
    el.password.addEventListener('focus', function () {
        if (masked.load) { el.password.value = ''; masked.load = false; }
    });
    el.ctxPassword.addEventListener('focus', function () {
        if (masked.ctx) { el.ctxPassword.value = ''; masked.ctx = false; }
    });
    /* Enter anywhere in the form runs the panel's one action. */
    el.form.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter' || e.target.tagName === 'BUTTON' || e.target.tagName === 'A') return;
        e.preventDefault();
        if (!model.running) onRunClick();
    });
}

function setSource(path) {
    model.sourcePath = path || '';
    el.source.textContent = model.sourcePath;
}

function browse(what, current) {
    send({ cmd: 'packBrowse', what: what, current: current || '' });
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

function selectedContextBase() {
    return model.bases[el.ctxBase.selectedIndex] || null;
}

function log(line) {
    el.log.value += (el.log.value ? '\n' : '') + line;
    el.log.scrollTop = el.log.scrollHeight;
}

function fillBases(select) {
    select.innerHTML = '';
    for (var i = 0; i < model.bases.length; i++) {
        var b = model.bases[i];
        var option = document.createElement('option');
        option.textContent = b.name + (b.display ? '  —  ' + b.display : '');
        option.disabled = !b.supported;
        select.appendChild(option);
    }
}

/* The authorization of one infobase drop-down: the user it was last used
 * with, and a stand-in for the password the host keeps. */
function fillAuth(which, base, userEl, passwordEl, saveEl) {
    userEl.value = base ? (base.user || '') : '';
    passwordEl.value = '';
    masked[which] = false;
    saveEl.checked = !!(base && base.savedAuth);
    if (base && base.savedAuth) {
        passwordEl.value = SAVED_MASK;
        masked[which] = true;
    }
}

function onBaseChanged() {
    fillAuth('load', selectedBase(), el.user, el.password, el.saveAuth);
    updateControls();
}

function onContextBaseChanged() {
    fillAuth('ctx', selectedContextBase(), el.ctxUser, el.ctxPassword, el.ctxSaveAuth);
    updateControls();
}

/* What the panel came from decides what it offers. */
function modeOf(dump, object) {
    if (dump === 'external') return 'external';
    if (dump === 'config') return object ? 'object' : 'config';
    return 'none';
}

function assembling() {
    return model.mode === 'external' || (model.mode === 'config' && el.doAssemble.checked);
}

function loading() {
    return model.mode === 'object' || (model.mode === 'config' && el.doLoad.checked);
}

function updateControls() {
    var extension = !!model.extension;
    el.dump.textContent = model.mode === 'external' ? (model.report ? 'Внешний отчёт' : 'Внешняя обработка')
        : model.mode === 'object' ? 'Объект метаданных '
            + (extension ? 'расширения «' + model.extension + '»' : 'конфигурации')
        : model.mode === 'config' ? (extension ? 'Расширение конфигурации «' + model.extension + '»' : 'Конфигурация')
        : 'Не выгрузка объекта: не найден корневой XML';
    el.object.textContent = model.object;
    el.objectRow.hidden = model.mode !== 'object';
    /* Only the root of a configuration has two things to do with it; the
     * other two entries have one each and no checkbox to get it wrong. */
    el.doRow.hidden = model.mode !== 'config';
    el.outRow.hidden = !assembling();
    el.contextGroup.hidden = model.mode !== 'external';
    el.ibGroup.hidden = !loading();
    el.ctxBaseRow.hidden = kind() !== 'base';
    el.cf.disabled = el.cfBrowse.disabled = kind() !== 'cf';
    el.ibLegend.textContent = model.mode === 'object'
        ? 'Информационная база для частичной загрузки' : 'Информационная база для загрузки';
    el.loadNote.textContent = model.mode === 'object' ? ''
        : extension ? 'Загружается всё расширение целиком.' : 'Загружается вся конфигурация целиком.';
    el.loadNote.hidden = !el.loadNote.textContent;

    var ready = model.mode !== 'none' && (assembling() || loading());
    if (ready && assembling() && !el.out.value.trim()) ready = false;
    if (ready && model.mode === 'external' && kind() === 'cf' && !el.cf.value.trim()) ready = false;
    if (ready && model.mode === 'external' && kind() === 'base' && !selectedContextBase()) ready = false;
    if (ready && loading() && !selectedBase()) ready = false;
    el.run.textContent = model.running ? 'Прервать'
        : model.mode === 'external' ? 'Собрать'
        : model.mode === 'object' ? 'Загрузить'
        : 'Выполнить';
    el.run.disabled = !model.running && !ready;
    el.out.disabled = model.running;
    el.source.classList.toggle('disabled', model.running);
}

function onRunClick() {
    if (model.running) {
        send({ cmd: 'packCancel' });
        return;
    }
    el.log.value = '';
    /* Whichever infobase this run needs brings its own authorization. */
    var b = loading() ? selectedBase()
        : (model.mode === 'external' && kind() === 'base' ? selectedContextBase() : null);
    var which = loading() ? 'load' : 'ctx';
    var userEl = loading() ? el.user : el.ctxUser;
    var passwordEl = loading() ? el.password : el.ctxPassword;
    var saveEl = loading() ? el.saveAuth : el.ctxSaveAuth;
    send({
        cmd: 'packBuild',
        source: model.sourcePath,
        out: el.out.value,
        assemble: assembling(),
        load: loading(),
        updateDb: !!el.updateDb.checked,
        kind: model.mode === 'external' ? kind() : 'empty',
        cf: el.cf.value,
        baseId: b ? b.id : '',
        user: b ? userEl.value : '',
        password: !b || masked[which] ? '' : passwordEl.value,
        useSaved: !!b && masked[which],
        saveAuth: !!b && !!saveEl.checked,
        platform: el.platform.value,
        /* An object is loaded by naming its own file: the Designer takes its
         * forms, templates and modules along with it. */
        files: model.mode === 'object' && model.object ? [model.object] : []
    });
}

function fillState(d) {
    model.bases = d.bases || [];
    el.platform.innerHTML = '';
    var platforms = d.platforms || [];
    for (var i = 0; i < platforms.length; i++) {
        var option = document.createElement('option');
        option.textContent = option.value = platforms[i].version;
        el.platform.appendChild(option);
    }
    if (d.platform) el.platform.value = d.platform;
    if (!el.platform.value && platforms.length) el.platform.value = platforms[0].version;

    fillBases(el.base);
    fillBases(el.ctxBase);
    var pick = 0;
    for (var b = 0; b < model.bases.length; b++) if (model.bases[b].id === d.baseId) pick = b;
    el.base.selectedIndex = el.ctxBase.selectedIndex = pick;
    onBaseChanged();
    onContextBaseChanged();

    if (!model.keepFields) setSource(d.source);
    el.doAssemble.checked = d.assemble !== false;
    el.doLoad.checked = !!d.load;
    el.updateDb.checked = d.updateDb !== false;
    setKind(d.kind || 'empty');
    el.cf.value = d.cf || '';
    model.initialized = true;
    updateControls();
}

function fillInfo(d) {
    model.dump = d.dump || 'none';
    model.dumpDir = d.dumpDir || '';
    model.rootXml = d.rootXml || '';
    model.extension = d.extension || '';
    model.report = !!d.report;
    model.object = d.current || '';
    model.mode = modeOf(model.dump, model.object);
    if (!model.outTouched && d.out) el.out.value = d.out;
    updateControls();
}

function onMessage(d) {
    if (!el.panel) return;
    switch (d.cmd) {
        case 'packState':
            fillState(d);
            break;
        case 'packInfo':
            fillInfo(d);
            break;
        case 'packBrowsed':
            if (!d.path) break;
            if (d.what === 'out') {
                el.out.value = d.path;
                model.outTouched = true;
            } else if (d.what === 'cf') {
                el.cf.value = d.path;
            }
            updateControls();
            break;
        case 'packStarted':
            model.running = true;
            updateControls();
            break;
        case 'packLog':
            log(d.line || '');
            break;
        case 'packDone':
            model.running = false;
            if (d.canceled) log('Отменено.');
            else if (!d.ok && d.error) log('ОШИБКА: ' + d.error);
            /* The saved password now exists (or not) on the host side. */
            if (d.ok && loading() && selectedBase()) {
                var lb = selectedBase();
                lb.savedAuth = el.saveAuth.checked;
                lb.user = el.user.value;
                fillAuth('load', lb, el.user, el.password, el.saveAuth);
            } else if (d.ok && model.mode === 'external' && kind() === 'base' && selectedContextBase()) {
                var cb = selectedContextBase();
                cb.savedAuth = el.ctxSaveAuth.checked;
                cb.user = el.ctxUser.value;
                fillAuth('ctx', cb, el.ctxUser, el.ctxPassword, el.ctxSaveAuth);
            }
            updateControls();
            if (!d.ok && !d.canceled && d.error) window.alert(d.error);
            break;
        case 'packNotice':
            if (d.text) window.alert(d.text);
            break;
    }
}

/* `req` is the host's load request of the panel. Coming back to the same dump
 * keeps what the panel had — fields, log, a running job. */
function show(req, sendFn) {
    send = sendFn;
    bind();
    el.panel.hidden = false;
    document.documentElement.classList.add('epf-mode');
    model.keepFields = model.initialized && model.source === req.path;
    if (!model.keepFields) {
        model.source = req.path || '';
        model.initialized = false;
        model.outTouched = false;
        model.object = '';
        model.mode = 'none';
        el.log.value = '';
    }
    send({ cmd: 'packInit' });
}

function hide() {
    if (!el.panel) return;
    el.panel.hidden = true;
    document.documentElement.classList.remove('epf-mode');
}

root.EpfPack = {
    show: show,
    hide: hide,
    onMessage: onMessage,
    running: function () { return model.running; },
    visible: function () { return !!(el.panel && !el.panel.hidden); }
};
})(typeof globalThis !== 'undefined' ? globalThis : window);
