/* BSLView / BSLEdit viewer.
 *
 * The page is static and always served from the same URL so that Chromium can
 * reuse its HTTP and V8 code caches between openings. File content never goes
 * into the markup; the host pushes it over postMessage after the page reports
 * that it is ready. That keeps reopening a file down to a model swap instead of
 * a full navigation. */
(function () {
'use strict';

var LOCAL_HOST = 'bslview.invalid';
var CDN_BASE = 'https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/vs';
var isLocal = (location.hostname === LOCAL_HOST
            || location.hostname === 'localhost'
            || location.hostname === '127.0.0.1');
var VS_BASE = isLocal ? 'vs' : CDN_BASE;
var MARKED_URL = isLocal ? 'marked.min.js' : 'https://cdn.jsdelivr.net/npm/marked@15.0.6/marked.min.js';
var TURNDOWN_URL = isLocal ? 'turndown.min.js' : 'https://cdn.jsdelivr.net/npm/turndown@7.2.1/dist/turndown.js';

/* Beyond this, Monaco's minimap, folding and bracket colourisation cost more
 * than they are worth and make scrolling stutter. */
var BIG_FILE_LINES = 20000;
var BIG_FILE_CHARS = 2 * 1024 * 1024;

var host = (window.chrome && window.chrome.webview) ? window.chrome.webview : null;
var CONTEXT_WAIT_MS = 1500;   // how long a form waits for its context under the overlay
var pending = null;      // load request that arrived before Monaco finished loading
var monacoReady = false;
var editor = null;
var model = null;
var formModuleModel = null;

var state = {
    mdRelations: null,
    /* The Roles tab of an object: null until opened, then 'loading', the
     * list of roles, or 'failed'. mdRolesAvailable: the object is in a
     * configuration export, so the tab is offered at all. */
    mdRoles: null,
    mdRolesAvailable: false,
    /* Rights ticked in the Roles tab filter; kept across objects, so the same
     * question («who may edit?») can be asked of the next object. */
    mdRoleRights: {},
    mdRoleFilterOpen: true,
    language: 'bsl',
    isDark: false,
    fontSize: 14,
    readOnly: true,
    isEditing: false,
    previewMode: false,
    /* Set while a loaded document waits (for its form context) to be shown in
     * the preview; the chrome already takes the preview's theme. */
    previewPending: false,
    sortByName: false,
    dirty: false,
    /* Unsaved edits of the form module, saved alongside the layout. */
    moduleDirty: false,
    minimap: readStoredBool('bsl.minimap', true),
    /* Пробелы, табуляции и управляющие символы видимы — выбор
     * пользователя, который держится между файлами и сессиями. */
    whitespace: readStoredBool('bsl.whitespace', false),
    /* Расположение исходника и просмотра для markdown и HTML:
     * 'source', 'split' или 'preview'. Держится между файлами и сессиями. */
    textLayout: readStoredText('bsl.textLayout', ['source', 'split', 'preview'], 'split'),
    bigFile: false,
    previewId: '',
    /* The kind of root this document is, when it is one that the unpacking
     * panel works with: 'external' for an external data processor or report,
     * 'config' for the root of a configuration or an extension. Empty for
     * everything else, and the toolbar button to the panel follows it. */
    epfRoot: '',
    formSelectedId: '',
    outlineKind: 'elements',
    selectedAttributeId: '',
    filePath: '',
    formModule: '',
    formModulePath: '',
    formWorkbenchView: 'form',
    sarifMode: false,
    sarifRoot: '',
    sarifSourcePath: '',
    sarifSourceLang: '',
    sarifSelectedId: '',
    baseForm: '',
    objectMeta: '',
    interfaceMode: 'Any',
    contextInterfaceMode: 'Any',
    formInterfaceMode: 'Auto',
    refMeta: {},
    formTitle: '',
    commonCommands: {},
    commonPictures: {},
    styleItems: {},
    outlineCollapsed: {}
};
var allItems = [];
var formElementItems = [];
var formAttributeItems = [];
/* Parent index of each form element outline entry (-1 at the root) and the
 * module procedures the form wires up, keyed by lower-cased handler name. */
var formElementParents = [];
var formHandlers = {};
var formFitToken = 0;
var baselineContent = '';
var moduleBaselineContent = '';
/* Номер состояния Monaco, в котором документ дословно совпадает с эталоном,
 * или -1, когда такого состояния нет (сохранён снимок, снятый до текущих
 * правок). Пока номер известен, «есть ли несохранённые правки» — сравнение
 * двух чисел, а не пересборка всего текста на каждое нажатие: Monaco
 * возвращает прежний номер, когда отмена приводит документ в прежний вид.
 * Считается там же, где меняется эталон, — см. markBaseline(). */
var baselineVersion = -1;
var moduleBaselineVersion = -1;
var suppressDirty = false;
var pendingLeaveEdit = false;
var pendingClose = false;
var nextSaveId = 1;
var pendingSaveSnapshots = {};
var saveBatchFailed = false;
var sarifReportContent = '';
var sarifParsedModel = null;
var sarifFileCache = new Map();
var sarifPendingReads = {};
var sarifNextReqId = 1;
var sarifSourceMeta = null;
var sarifBaseDecorations = [];
var sarifSelectedDecorations = [];
var sarifDecorationsKey = '';
var syncingFromEditor = false;

function readStoredBool(key, fallback) {
    try {
        var v = localStorage.getItem(key);
        if (v === '0') return false;
        if (v === '1') return true;
    } catch (e) { /* private mode / file:// */ }
    return fallback;
}

function writeStoredBool(key, on) {
    try { localStorage.setItem(key, on ? '1' : '0'); } catch (e) { /* ignore */ }
}

/* Такой же ящик для настроек, у которых не два состояния, а несколько. */
function readStoredText(key, allowed, fallback) {
    try {
        var v = localStorage.getItem(key);
        if (v && allowed.indexOf(v) >= 0) return v;
    } catch (e) { /* private mode / file:// */ }
    return fallback;
}

function writeStoredText(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { /* ignore */ }
}

function formInterfaceModeKey(filePath) {
    return '1cFormViewer.interfaceMode.' + encodeURIComponent(String(filePath || '').replace(/\\/g, '/').toLowerCase());
}

function storedFormInterfaceMode(filePath) {
    try {
        var value = localStorage.getItem(formInterfaceModeKey(filePath));
        return value === 'Taxi' || value === 'Version85' ? value : '';
    } catch (e) { return ''; }
}

function saveFormInterfaceMode(filePath, mode) {
    try {
        var key = formInterfaceModeKey(filePath);
        if (mode === 'Taxi' || mode === 'Version85') localStorage.setItem(key, mode);
        else localStorage.removeItem(key);
    } catch (e) { /* storage may be disabled */ }
}

var formFitWidth = readStoredBool('1cFormViewer.fitWidth', false);

/* The theme is the user's choice made with the toolbar button, kept across
 * files and sessions; until one is made the viewer is light, whatever the
 * host or Windows prefer. */
var THEME_KEY = 'bslview.darkTheme';
function preferredDark() { return readStoredBool(THEME_KEY, false); }

function isBslModule(lang) { return (lang || state.language) === 'bsl'; }
function isBslFamily(lang) { return isBslModule(lang) || (lang || state.language) === 'bsl_query'; }

/* Preview providers live in packages/1c-preview-core/browser/providers.js so
 * that this viewer, the MCP agent page and the VS Code webview all claim files
 * the same way. Everything below is the thin host-side wrapper: it supplies the
 * source language and the owning object's metadata, which only this host has. */
var PREVIEW_PROVIDERS = PreviewProviders.list;

function providerReady(p) {
    return PreviewProviders.ready(p);
}

function detectProvider(content) {
    return PreviewProviders.detect(content, { language: state.language });
}

function providerById(id) {
    return PreviewProviders.byId(id);
}

var parseMemo = null;

function parseWithProvider(p, content) {
    var m = parseMemo;
    if (m && m.p === p && m.content === content && m.baseForm === state.baseForm
        && m.objectMeta === state.objectMeta && m.interfaceMode === state.interfaceMode && m.commonCommands === state.commonCommands
        && m.commonPictures === state.commonPictures && m.styleItems === state.styleItems
        && m.refMeta === state.refMeta && m.mdRelations === state.mdRelations) return m.result;
    var result = parseWithProviderUncached(p, content);
    parseMemo = {
        p: p, content: content, result: result, baseForm: state.baseForm, objectMeta: state.objectMeta,
        interfaceMode: state.interfaceMode,
        commonCommands: state.commonCommands, commonPictures: state.commonPictures,
        styleItems: state.styleItems, refMeta: state.refMeta, mdRelations: state.mdRelations
    };
    return result;
}

function parseWithProviderUncached(p, content) {
    return PreviewProviders.parse(p, content, {
        baseForm: state.baseForm, objectMeta: state.objectMeta,
        interfaceMode: state.interfaceMode,
        commonCommands: state.commonCommands, commonPictures: state.commonPictures,
        styleItems: state.styleItems, refMeta: state.refMeta, relations: state.mdRelations
    });
}

/* The provider claiming the file currently loaded, or null for plain source. */
function currentProvider() {
    var p = providerById(state.previewId);
    return providerReady(p) ? p : null;
}

/* The module that renders, highlights and outlines for the active provider. */
function previewView() {
    var p = currentProvider();
    return p ? window[p.viewer] : null;
}

function isFormView() { var p = currentProvider(); return !!(p && p.id === 'form'); }

function formModuleOpen() {
    return !!(state.previewMode && isFormView() && state.formWorkbenchView === 'module');
}

/* The form layout and its module are one document for saving and closing. */
function anyDirty() {
    return !!(state.dirty || state.moduleDirty);
}

/* True whenever a provider owns the view, i.e. the editor is replaced rather
 * than split with the preview iframe. */
function isDocPreview() { return !!currentProvider(); }

/* True when it is Monaco that is being edited. A visual preview hides the
 * source, so editing it is not editing the source; a preview that is edited
 * where it is drawn saves through previewEditingActive instead. */
function sourceEditingActive() {
    return !!(!state.sarifMode && state.isEditing
        && (!(state.previewMode && isDocPreview()) || formModuleOpen()));
}

/* A preview that is edited where it is drawn rather than through its XML: the
 * pencil turns editing on and the picture stays. */
function previewEditable() {
    var provider = currentProvider();
    return !!(provider && provider.editable && state.previewMode && !state.readOnly && !state.sarifMode);
}

/* Editing is on and it is the picture that is being edited, so saving means
 * saving the document the picture was built from. */
function previewEditingActive() {
    return !!(state.isEditing && previewEditable());
}

function languageForPath(path) {
    var m = String(path || '').toLowerCase().match(/\.([^.\\/]+)$/), ext = m ? m[1] : '';
    if (ext === 'bsl' || ext === 'os') return 'bsl';
    if (ext === 'sdbl' || ext === 'query') return 'bsl_query';
    if (ext === 'json' || ext === 'sarif') return 'json';
    if (ext === 'xml' || ext === 'mxlx') return 'xml';
    if (ext === 'md' || ext === 'markdown' || ext === 'mdc') return 'markdown';
    if (ext === 'ps1' || ext === 'psm1' || ext === 'psd1') return 'powershell';
    if (ext === 'html' || ext === 'htm') return 'html';
    return 'plaintext';
}

function severityFor(level) {
    if (!window.monaco || !monaco.MarkerSeverity) return level === 'error' ? 8 : (level === 'warning' ? 4 : 2);
    return level === 'error' ? monaco.MarkerSeverity.Error :
        (level === 'warning' ? monaco.MarkerSeverity.Warning : monaco.MarkerSeverity.Info);
}

/* True when the outline is a collapsible tree rather than a flat list. */
function docTree() { var p = currentProvider(); return !!(!formModuleOpen() && p && p.tree); }

/* Only a real 1C form mockup must always render as light UI chrome (it stands
 * in for the actual application window). A table-document (template) preview
 * is just a document view, so it follows the user's chosen theme like any
 * other file — it must not silently flip when previewMode toggles. */
function formPreviewOpen() {
    var p = currentProvider();
    return !!(p && p.lightChrome && (state.previewMode || state.previewPending)
        && state.formWorkbenchView !== 'module');
}
function uiIsDark() { return formPreviewOpen() ? false : !!state.isDark; }
function canPreviewLang() {
    return state.language === 'markdown' || state.language === 'html' || isDocPreview();
}
function formPreviewEl() { return document.getElementById('form-preview'); }

var QUERY_WORDS = [
    'ВЫБРАТЬ', 'РАЗРЕШЕННЫЕ', 'РАЗЛИЧНЫЕ', 'ПЕРВЫЕ', 'КАК', 'ПУСТАЯТАБЛИЦА', 'ПОМЕСТИТЬ',
    'ИЗ', 'ВНУТРЕННЕЕ', 'ЛЕВОЕ', 'ВНЕШНЕЕ', 'ПРАВОЕ', 'ПОЛНОЕ', 'СОЕДИНЕНИЕ',
    'ГДЕ', 'СГРУППИРОВАТЬ', 'ПО', 'ИМЕЮЩИЕ', 'ОБЪЕДИНИТЬ', 'ВСЕ', 'УПОРЯДОЧИТЬ',
    'АВТОУПОРЯДОЧИВАНИЕ', 'ИТОГИ', 'ОБЩИЕ', 'ТОЛЬКО', 'ИЕРАРХИЯ', 'ПЕРИОДАМИ', 'ДЛЯ',
    'ИЗМЕНЕНИЯ', 'SELECT', 'ALLOWED', 'DISTINCT', 'TOP', 'AS', 'EMPTYTABLE',
    'INTO', 'FROM', 'INNER', 'LEFT', 'OUTER', 'RIGHT', 'FULL',
    'JOIN', 'ON', 'WHERE', 'GROUP', 'BY', 'HAVING', 'UNION',
    'ALL', 'ORDER', 'AUTOORDER', 'TOTALS', 'OVERALL', 'ONLY', 'HIERARCHY',
    'СГРУППИРОВАНОПО', 'GROUPEDBY', 'БУЛЕВО', 'BOOLEAN', 'ВОЗР', 'ASC',
    'ЗНАЧЕНИЕ', 'VALUE', 'ИНДЕКСИРОВАТЬ', 'INDEX', 'ТИП', 'TYPE', 'ТИПЗНАЧЕНИЯ',
    'VALUETYPE', 'УБЫВ', 'DESC', 'УНИЧТОЖИТЬ', 'DROP',
    'ГРУППИРУЮЩИМ', 'НАБОРАМ', 'GROUPING', 'SETS',
    'ДОБАВИТЬ', 'УНИКАЛЬНО'
];
var QUERY_EXP = [
    'АВТОНОМЕРЗАПИСИ', 'RECORDAUTONUMBER', 'В', 'IN', 'ВЫБОР', 'CASE',
    'ВЫРАЗИТЬ', 'CAST', 'ГОД', 'YEAR', 'ДАТА', 'DATE', 'ДАТАВРЕМЯ',
    'DATETIME', 'ДЕКАДА', 'TENDAYS', 'ДЕНЬ', 'DAY', 'ДЕНЬГОДА',
    'DAYOFYEAR', 'ДЕНЬНЕДЕЛИ', 'WEEKDAY', 'ДОБАВИТЬКДАТЕ', 'DATEADD',
    'ЕСТЬ', 'IS', 'ЕСТЬNULL', 'ISNULL', 'И', 'AND', 'ИЕРАРХИЯ',
    'HIERARCHY', 'ИЛИ', 'OR', 'ИНАЧЕ', 'ELSE', 'ИСТИНА', 'TRUE',
    'КВАРТАЛ', 'QUARTER', 'КОЛИЧЕСТВО', 'COUNT', 'КОНЕЦПЕРИОДА',
    'ENDOFPERIOD', 'КОНЕЦ', 'END', 'ЛОЖЬ', 'FALSE', 'МАКСИМУМ',
    'MAX', 'МЕЖДУ', 'BETWEEN', 'МЕСЯЦ', 'MONTH', 'МИНИМУМ', 'MIN',
    'МИНУТА', 'MINUTE', 'НАЧАЛОПЕРИОДА', 'BEGINOFPERIOD', 'НЕ', 'NOT',
    'НЕДЕЛЯ', 'WEEK', 'НЕОПРЕДЕЛЕНО', 'UNDEFINED', 'ПОДОБНО', 'LIKE',
    'ПОДСТРОКА', 'SUBSTRING', 'ПОЛУГОДИЕ', 'HALFYEAR', 'ПРЕДСТАВЛЕНИЕ',
    'PRESENTATION', 'ПРЕДСТАВЛЕНИЕССЫЛКИ', 'REFPRESENTATION',
    'РАЗНОСТЬДАТ', 'DATEDIFF', 'СЕКУНДА', 'SECOND', 'СПЕЦСИМВОЛ',
    'ESCAPE', 'СРЕДНЕЕ', 'AVG', 'ССЫЛКА', 'REFS', 'СТРОКА', 'STRING',
    'СУММА', 'SUM', 'ТОГДА', 'THEN', 'УБЫВ', 'DESC', 'ЧАС', 'HOUR',
    'ЧИСЛО', 'NUMBER', 'NULL', 'КОГДА', 'WHEN',
    'СОКРЛП', 'TRIMALL', 'СОКРП', 'TRIMAR', 'СОКРЛ', 'TRIMAL',
    'ACOS', 'ASIN', 'ATAN', 'COS', 'EXP', 'LOG', 'LOG10', 'SIN', 'SQRT', 'POW',
    'TAN', 'ОКР', 'ROUND', 'ЦЕЛ', 'INT', 'ДЛИНАСТРОКИ', 'STRINGLENGTH', 'ЛЕВ',
    'LEFT', 'ПРАВ', 'RIGHT', 'СТРНАЙТИ', 'STRFIND', 'ВРЕГ', 'UPPER', 'НРЕГ',
    'LOWER', 'СТРЗАМЕНИТЬ', 'STRREPLACE', 'РАЗМЕРХРАНИМЫХДАННЫХ', 'STOREDDATASIZE',
    'УНИКАЛЬНЫЙИДЕНТИФИКАТОР', 'UUID'
];
var QUERY_THEME_LIGHT = [
    { token: 'query', foreground: '000000' },
    { token: 'query.quote', foreground: '000000' },
    { token: 'query.innerquotes', foreground: 'd38949' },
    { token: 'query.string', foreground: 'df0000' },
    { token: 'query.keyword', foreground: '0000ff' },
    { token: 'query.exp', foreground: 'a50000' },
    { token: 'query.param', foreground: '007b7c' },
    { token: 'query.brackets', foreground: '0000ff' },
    { token: 'query.operator', foreground: '0000ff' },
    { token: 'query.float', foreground: 'ff00ff' },
    { token: 'query.int', foreground: 'ff00ff' },
    { token: 'query.comment', foreground: '008000' }
];
var QUERY_THEME_DARK = [
    { token: 'query', foreground: 'e7db6a' },
    { token: 'query.quote', foreground: 'e7db6a' },
    { token: 'query.innerquotes', foreground: 'd7ba62' },
    { token: 'query.string', foreground: 'ff4242' },
    { token: 'query.keyword', foreground: 'f92472' },
    { token: 'query.exp', foreground: 'a50000' },
    { token: 'query.param', foreground: '007b7c' },
    { token: 'query.brackets', foreground: 'd4d4d4' },
    { token: 'query.operator', foreground: 'd4d4d4' },
    { token: 'query.float', foreground: 'ff00ff' },
    { token: 'query.int', foreground: 'ff00ff' },
    { token: 'query.comment', foreground: '6a9955' }
];
var BSL_SNIPPETS = [
    { label: 'Если', prefix: 'Если', body: 'Если ${1:Условие} Тогда\n\t$0\nКонецЕсли;' },
    { label: 'ЕслиИначе', prefix: 'ЕслиИначе', body: 'Если ${1:Условие} Тогда\n\t$0\nИначе\n\t\nКонецЕсли;' },
    { label: 'Пока', prefix: 'Пока', body: 'Пока ${1:Условие} Цикл\n\t$0\nКонецЦикла;' },
    { label: 'Для', prefix: 'Для', body: 'Для ${1:Счетчик} = ${2:1} По ${3:Ограничение} Цикл\n\t$0\nКонецЦикла;' },
    { label: 'ДляКаждого', prefix: 'ДляКаждого', body: 'Для Каждого ${1:Элемент} Из ${2:Коллекция} Цикл\n\t$0\nКонецЦикла;' },
    { label: 'Процедура', prefix: 'Процедура', body: 'Процедура ${1:ИмяПроцедуры}()\n\t$0\nКонецПроцедуры' },
    { label: 'Функция', prefix: 'Функция', body: 'Функция ${1:ИмяФункции}()\n\t$0\nКонецФункции' },
    { label: 'Попытка', prefix: 'Попытка', body: 'Попытка\n\t$0\nИсключение\n\t\nКонецПопытки;' },
    { label: 'Область', prefix: 'Область', body: '#Область ${1:Имя}\n$0\n#КонецОбласти' },
    { label: 'Возврат', prefix: 'Возврат', body: 'Возврат ${1:Результат};' },
    { label: 'If', prefix: 'If', body: 'If ${1:Condition} Then\n\t$0\nEndIf;' },
    { label: 'While', prefix: 'While', body: 'While ${1:Condition} Do\n\t$0\nEndDo;' },
    { label: 'Procedure', prefix: 'Procedure', body: 'Procedure ${1:Name}()\n\t$0\nEndProcedure' },
    { label: 'Function', prefix: 'Function', body: 'Function ${1:Name}()\n\t$0\nEndFunction' },
    { label: 'Try', prefix: 'Try', body: 'Try\n\t$0\nExcept\n\t\nEndTry;' },
    { label: 'Region', prefix: 'Region', body: '#Region ${1:Name}\n$0\n#EndRegion' }
];
var FOLD_OPEN = {
    'процедура': 'proc', 'procedure': 'proc',
    'функция': 'proc', 'function': 'proc',
    'если': 'if', 'if': 'if',
    '#если': 'ppif', '#if': 'ppif',
    'пока': 'loop', 'while': 'loop', 'для': 'loop', 'for': 'loop',
    'попытка': 'try', 'try': 'try',
    '#область': 'region', '#region': 'region'
};
var FOLD_CLOSE = {
    'конецпроцедуры': 'proc', 'endprocedure': 'proc',
    'конецфункции': 'proc', 'endfunction': 'proc',
    'конецесли': 'if', 'endif': 'if',
    '#конецесли': 'ppif', '#endif': 'ppif',
    'конеццикла': 'loop', 'enddo': 'loop',
    'конецпопытки': 'try', 'endtry': 'try',
    '#конецобласти': 'region', '#endregion': 'region'
};

// ---------------------------------------------------------------- host I/O

function send(msg) { if (host) host.postMessage(msg); }

/* The chrome theme for an incoming document, before applyLoad runs. A form
 * opens in its light mockup, so theming it dark here flashed dark -> light. */
function loadThemeClass(req) {
    if (!preferredDark()) return 'theme-light';
    var provider = PreviewProviders.detect(req.content || '', { language: req.language || 'bsl' });
    return provider && provider.lightChrome ? 'theme-light' : 'theme-dark';
}

// ------------------------------------------------ MCP preview annotations

/* A window the form viewer MCP server opened (--editor) carries that
 * preview's base URL. While the same form is shown, its form view offers the
 * annotations of the MCP preview page, kept in that session where the agent
 * reads them with preview(operation="annotations"). */
var previewSession = null;       // { path, url }
var sessionAnnotations = null;
var annotationRevision = null;
var annotationVersion = null;
var annotationPollTimer = null;
var annotationFetching = false;

function annotationSessionActive() {
    var provider = currentProvider();
    return !!(previewSession && sessionAnnotations && provider && /^(form|template|mxl)$/.test(provider.id)
        && String(state.filePath || '').toLowerCase() === previewSession.path.toLowerCase());
}

function withdrawSessionAnnotations() {
    if (annotationRevision === null) return;
    annotationRevision = null;
    sessionAnnotations.snapshot([], -1, false);
}

function syncSessionAnnotations() {
    if (!sessionAnnotations) return;
    if (!annotationSessionActive()) { withdrawSessionAnnotations(); return; }
    if (annotationFetching) return;
    annotationFetching = true;
    var session = previewSession;
    fetch(session.url + 'annotations', { cache: 'no-store' }).then(function (response) {
        /* A closed preview is gone for good; a busy server is asked again. */
        if (response.status === 404) {
            if (previewSession === session) { previewSession = null; withdrawSessionAnnotations(); }
            return null;
        }
        return response.ok ? response.json() : null;
    }).then(function (data) {
        if (!data || previewSession !== session || !annotationSessionActive()) return;
        /* A poll notices a reload of the file on the server (a new revision,
         * cleared list) and a change to the list made elsewhere, such as the
         * agent resolving a note (a new version); an edit
         * in progress waits for the next one. */
        if (data.revision === annotationRevision && data.version === annotationVersion || sessionAnnotations.busy()) return;
        annotationRevision = data.revision;
        annotationVersion = data.version;
        sessionAnnotations.snapshot(data.annotations || [], data.revision, true);
        placeAnnotationTray();
    }).catch(function () {}).then(function () { annotationFetching = false; });
}

function initSessionAnnotations() {
    var formEl = formPreviewEl();
    if (!window.SessionAnnotations || !formEl || !document.getElementById('annotation-toggle')) return;
    sessionAnnotations = SessionAnnotations(formEl, document.getElementById('workspace'), function (id) {
        var index = formElementIndex(id);
        var entry = index >= 0 ? formElementItems[index] : null;
        var name = entry && entry.name || id;
        return { id: id, name: name, title: entry && entry.title && entry.title !== name ? entry.title + ' (' + name + ')' : name,
            /* Spreadsheet cells are not in the element list; they are never missing. */
            missing: formElementItems.length > 0 && !entry && !/^r\d+c\d+$/.test(id) };
    }, { baseUrl: previewSession ? previewSession.url : '', selectedId: function () { return state.formSelectedId || ''; },
        reveal: revealAnnotation });
    /* The form is redrawn on every edit, mode switch and fit; the markers
     * follow the elements. */
    var scheduled = false;
    new MutationObserver(function () {
        if (scheduled) return;
        scheduled = true;
        requestAnimationFrame(function () { scheduled = false; placeAnnotationTray(); sessionAnnotations.updatePositions(); });
    }).observe(formEl, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'style', 'class'] });
    /* Dragging the element panel wider changes the form's width alone. */
    if (window.ResizeObserver) new ResizeObserver(placeAnnotationTray).observe(formEl);
}

/* A spreadsheet note selects its cells rNcM (to endElementId for a range) by
 * id, since the agent may name them freely; notes saved before the range was
 * kept fall back to the R1C1:R2C2 name. A form note selects its element. */
function revealAnnotation(entry) {
    var cell = /^r(\d+)c(\d+)$/;
    var from = cell.exec(String(entry.elementId || ''));
    var to = cell.exec(String(entry.endElementId || ''));
    var named = /^R(\d+)C(\d+)(?::R(\d+)C(\d+))?$/.exec(String(entry.elementName || ''));
    if (from && templateSession) {
        var r0 = +from[1], c0 = +from[2], r1 = r0, c1 = c0;
        if (to) { r1 = +to[1]; c1 = +to[2]; }
        else if (named && named[3]) { r0 = +named[1] - 1; c0 = +named[2] - 1; r1 = +named[3] - 1; c1 = +named[4] - 1; }
        templateSession.select({ mode: 'cells', anchor: { row: r0, col: c0 }, focus: { row: r1, col: c1 } });
        var cell = formPreviewEl().querySelector('[data-id="r' + r0 + 'c' + c0 + '"]');
        if (cell && cell.scrollIntoView) cell.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        return;
    }
    selectFormElement(entry.elementId);
}

/* The list stays over the form, not over the element panel beside it. */
function placeAnnotationTray() {
    var tray = document.getElementById('annotation-tray');
    var formEl = formPreviewEl();
    var workspace = document.getElementById('workspace');
    if (!tray || !formEl || !workspace || formEl.hidden || tray.hasAttribute('data-moved')) return;
    var gap = workspace.getBoundingClientRect().right - formEl.getBoundingClientRect().right;
    tray.style.right = Math.max(0, gap) + 8 + 'px';
}

function setPreviewSession(req) {
    if (!req.previewSession) return;
    previewSession = { path: String(req.path || ''), url: String(req.previewSession).replace(/\/?$/, '/') };
    if (sessionAnnotations) sessionAnnotations.setBaseUrl(previewSession.url);
    if (!annotationPollTimer) annotationPollTimer = setInterval(syncSessionAnnotations, 2000);
}

function onHostMessage(ev) {
    var d = ev.data;
    if (!d || typeof d !== 'object') return;
    switch (d.cmd) {
        case 'load':
            /* Paint the page chrome before Monaco finishes so a dark WebView2
             * surface is not left empty while the bundle parses. */
            document.documentElement.className = loadThemeClass(d);
            /* Настройки есть только у отдельного окна BSLEdit, не у Lister. */
            var settingsBtn = document.getElementById('btn-settings');
            if (settingsBtn) settingsBtn.style.display = d.settings ? '' : 'none';
            /* An .epf/.erf opens on its unpacking panel, which needs no Monaco. */
            if (d.language === 'epf') { showEpf(d); break; }
            if (d.language === 'pack') { showPack(d); break; }
            /* Fetch the markdown renderer in parallel with Monaco, not after it. */
            if (d.language === 'markdown') loadMarked();
            setPreviewSession(d);
            if (monacoReady) applyLoad(d); else pending = d;
            break;
        case 'find':    doFind(d); break;
        case 'focusEditor':
            if (editor) {
                editor.focus();
                setTimeout(function () { if (editor) editor.focus(); }, 0);
            }
            break;
        case 'copy':    if (editor) editor.trigger('host', 'editor.action.clipboardCopyAction', null); break;
        case 'selectAll':
            if (editor && editor.getModel()) {
                var shownModel = editor.getModel();
                var last = shownModel.getLineCount();
                editor.setSelection({ startLineNumber: 1, startColumn: 1, endLineNumber: last, endColumn: shownModel.getLineMaxColumn(last) });
                editor.focus();
            }
            break;
        case 'park':    parkEditor(); break;
        case 'saved':   onSaveResult(d.ok, d.saveId, d.conflict, d.target); break;
        case 'reverted': onReverted(d); break;
        case 'externalChange': onExternalChange(d); break;
        case 'gitInfo':
        case 'gitContent':
        case 'gitCommitPlan':
        case 'gitCommitted': onGitMessage(d); break;
        case 'sourceContent': onSarifSourceContent(d); break;
        case 'rootChosen': onSarifRootChosen(d); break;
        case 'screenshotDone': finishFormScreenshot(!!d.ok); break;
        case 'confirmClose': requestClose(); break;
        case 'openFailed': onOpenFailed(d); break;
        case 'templateSaved': onTemplateSaved(d); break;
        case 'openWindowFailed': if (d && d.path) navigateTo(d.path, false, {
            line: d.line, search: d.search, regexp: d.regexp, matchCase: d.matchCase
        }); break;
        default:
            if (typeof d.cmd === 'string' && d.cmd.indexOf('epf') === 0 && window.EpfUnpack) EpfUnpack.onMessage(d);
            if (typeof d.cmd === 'string' && d.cmd.indexOf('pack') === 0 && window.EpfPack) EpfPack.onMessage(d);
    }
}

if (host) host.addEventListener('message', onHostMessage);
else window.addEventListener('message', onHostMessage);

// ------------------------------------------------------------ Monaco setup

function defineBsl(monaco) {
    monaco.languages.register({ id: 'bsl', extensions: ['.bsl', '.os'], aliases: ['1C', 'BSL'] });

    monaco.languages.setMonarchTokensProvider('bsl', {
        ignoreCase: true,
        keywords: [
            'КонецПроцедуры', 'EndProcedure', 'КонецФункции', 'EndFunction',
            'Прервать', 'Break', 'Продолжить', 'Continue', 'Возврат', 'Return',
            'Если', 'If', 'Иначе', 'Else', 'ИначеЕсли', 'ElsIf', 'Тогда', 'Then',
            'КонецЕсли', 'EndIf', 'Попытка', 'Try', 'Исключение', 'Except',
            'КонецПопытки', 'EndTry', 'ВызватьИсключение', 'Raise',
            'Пока', 'While', 'Для', 'For', 'Каждого', 'Each', 'Из', 'In', 'По', 'To',
            'Цикл', 'Do', 'КонецЦикла', 'EndDo',
            'НЕ', 'NOT', 'И', 'AND', 'ИЛИ', 'OR',
            'Новый', 'New', 'Процедура', 'Procedure', 'Функция', 'Function',
            'Перем', 'Var', 'Экспорт', 'Export', 'Знач', 'Val',
            'Неопределено', 'Undefined', 'Истина', 'True', 'Ложь', 'False', 'Null',
            'Выполнить', 'Execute', 'Асинх', 'Async', 'Ждать', 'Await',
            'ДобавитьОбработчик', 'AddHandler', 'УдалитьОбработчик', 'RemoveHandler',
            'Перейти', 'Goto'
        ],
        queryWords: QUERY_WORDS,
        queryExp: QUERY_EXP,
        queryOperators: /[=><+\-*\/%;,]+/,
        operators: ['=', '<=', '>=', '<>', '<', '>', '+', '-', '*', '/', '%'],
        symbols: /[=><!~?:&+\-*\/\^%]+/,
        tokenizer: {
            root: [
                [/\/\/.*$/, 'comment'],
                [/^\s*#[^\n]*/, 'preproc'],
                [/&[a-zA-Z\u0410-\u044F_\u0401\u0451][a-zA-Z\u0410-\u044F_\u0401\u04510-9]*/, 'compile'],
                [/~[a-zA-Z\u0410-\u044F_\u0401\u0451][a-zA-Z\u0410-\u044F_\u0401\u04510-9]*/, 'gotomark'],
                [/[a-zA-Z\u0410-\u044F_\u0401\u0451][a-zA-Z\u0410-\u044F_\u0401\u04510-9]*\s*(?=\()/, {
                    cases: { '@keywords': 'keyword', '@default': 'funcname' }
                }],
                [/[a-zA-Z\u0410-\u044F_\u0401\u0451][a-zA-Z\u0410-\u044F_\u0401\u04510-9]*/, {
                    cases: { '@keywords': 'keyword', '@default': 'identifier' }
                }],
                [/[()\[\]]/, 'delimiter.bracket'],
                [/@symbols/, { cases: { '@operators': 'operator', '@default': '' } }],
                [/\d*\.\d+([eE][\-+]?\d+)?/, 'number.float'],
                [/\d+/, 'number'],
                [/[;,.]/, 'delimiter'],
                [/(")(выбрать|select)/, [
                    { token: 'query.quote', next: '@query' },
                    { token: 'query.keyword' }
                ]],
                [/"/, { token: 'string.quote', next: '@string' }],
                [/'[^']*'/, 'date']
            ],
            query: [
                [/\s+/, 'query'],
                [/[a-zA-Z\u0410-\u044F_\u0401\u0451][a-zA-Z\u0410-\u044F_\u0401\u04510-9]*/, {
                    cases: {
                        '@queryWords': 'query.keyword',
                        '@queryExp': 'query.exp',
                        '@default': 'query'
                    }
                }],
                [/&[a-zA-Z\u0410-\u044F_\u0401\u0451][a-zA-Z\u0410-\u044F_\u0401\u04510-9]*/, 'query.param'],
                [/&/, 'query.param'],
                [/("")+/, 'query.innerquotes'],
                [/""[^"]*""/, 'query.string'],
                [/[({})]/, 'query.brackets'],
                [/\/\/.*$/, 'query.comment'],
                [/@queryOperators/, 'query.operator'],
                [/\d*\.\d+([eE][\-+]?\d+)?/, 'query.float'],
                [/\d+/, 'query.int'],
                [/\|/, 'query'],
                [/\./, 'query'],
                [/"/, { token: 'query.quote', next: '@pop' }],
                [/[^"&]/, 'query']
            ],
            string: [
                [/""/, 'string.escape'],
                [/"/, { token: 'string.quote', next: '@pop' }],
                [/\|/, 'string'],
                [/[^"|]+/, 'string']
            ]
        }
    });

    monaco.languages.setLanguageConfiguration('bsl', {
        comments: { lineComment: '//' },
        brackets: [['(', ')'], ['[', ']']],
        autoClosingPairs: [
            { open: '(', close: ')' },
            { open: '[', close: ']' },
            { open: '"', close: '"' }
        ],
        surroundingPairs: [
            { open: '(', close: ')' },
            { open: '"', close: '"' }
        ],
        indentationRules: {
            increaseIndentPattern: /^\s*(Процедура|Procedure|Функция|Function|Если|If|Иначе|Else|ИначеЕсли|ElsIf|Пока|While|Для|For|Попытка|Try|Исключение|Except)\b/i,
            decreaseIndentPattern: /^\s*(КонецПроцедуры|EndProcedure|КонецФункции|EndFunction|КонецЕсли|EndIf|КонецЦикла|EndDo|КонецПопытки|EndTry|Иначе|Else|ИначеЕсли|ElsIf|Исключение|Except)\b/i
        },
        onEnterRules: window.BslEditing ? BslEditing.enterRules(monaco) : [],
        folding: {
            markers: {
                start: new RegExp('^\\s*#\\s*(Область|Region)\\b', 'i'),
                end: new RegExp('^\\s*#\\s*(КонецОбласти|EndRegion)\\b', 'i')
            }
        }
    });

    monaco.editor.defineTheme('bsl-light', {
        base: 'vs',
        inherit: false,
        rules: [
            { token: '', foreground: '0000ff' },
            { token: 'comment', foreground: '008000' },
            { token: 'keyword', foreground: 'ff0000' },
            { token: 'identifier', foreground: '0000ff' },
            { token: 'funcname', foreground: '0000ff' },
            { token: 'operator', foreground: 'ff0000' },
            { token: 'delimiter', foreground: 'ff0000' },
            { token: 'delimiter.bracket', foreground: 'ff0000' },
            { token: 'string', foreground: '000000' },
            { token: 'string.quote', foreground: '000000' },
            { token: 'string.escape', foreground: '000000' },
            { token: 'string.key', foreground: '0000ff' },
            { token: 'number', foreground: '000000' },
            { token: 'number.float', foreground: '000000' },
            { token: 'date', foreground: '000000' },
            { token: 'preproc', foreground: '963200' },
            { token: 'compile', foreground: '963200' },
            { token: 'gotomark', foreground: '3a3a3a' },
            { token: 'tag', foreground: 'ff0000' },
            { token: 'metatag', foreground: '963200' },
            { token: 'attribute.name', foreground: '0000ff' },
            { token: 'attribute.value', foreground: '000000' }
        ].concat(QUERY_THEME_LIGHT),
        colors: {
            'editor.background': '#FFFFFF',
            'editor.foreground': '#0000ff',
            'editor.selectionBackground': '#ffe877',
            'editor.selectionHighlightBackground': '#fef6d0',
            'editor.inactiveSelectionBackground': '#fef6d0',
            'editorLineNumber.foreground': '#2b91af',
            'editorLineNumber.activeForeground': '#0000ff',
            /* Отметки непечатаемых символов. Умолчание vs — #33333333, то
             * есть 20 % непрозрачности: на экране их попросту не видно. */
            'editorWhitespace.foreground': '#8A8A8A'
        }
    });

    monaco.editor.defineTheme('bsl-dark', {
        base: 'vs-dark',
        /* inherit:false so a switch from bsl-light (also inherit:false) fully
         * replaces token CSS. Merging onto vs-dark left the previous light
         * colours in place, so only the HTML outline panel appeared to change. */
        inherit: false,
        rules: [
            { token: '', foreground: 'd4d4d4' },
            { token: 'comment', foreground: '6A9955' },
            { token: 'keyword', foreground: '499caa' },
            { token: 'identifier', foreground: 'd4d4d4' },
            { token: 'funcname', foreground: 'd4d4d4' },
            { token: 'operator', foreground: 'd4d4d4' },
            { token: 'delimiter', foreground: 'd4d4d4' },
            { token: 'delimiter.bracket', foreground: 'd4d4d4' },
            { token: 'string', foreground: 'c3602c' },
            { token: 'string.quote', foreground: 'c3602c' },
            { token: 'string.escape', foreground: 'c3602c' },
            { token: 'string.key', foreground: '9cdcfe' },
            { token: 'number', foreground: 'b5cea8' },
            { token: 'number.float', foreground: 'b5cea8' },
            { token: 'date', foreground: 'b5cea8' },
            { token: 'preproc', foreground: 'ce9178' },
            { token: 'compile', foreground: 'ce9178' },
            { token: 'gotomark', foreground: 'ff9000' },
            { token: 'tag', foreground: '569cd6' },
            { token: 'metatag', foreground: 'c586c0' },
            { token: 'attribute.name', foreground: '9cdcfe' },
            { token: 'attribute.value', foreground: 'c3602c' }
        ].concat(QUERY_THEME_DARK),
        colors: {
            'editor.background': '#1E1E1E',
            'editor.foreground': '#D4D4D4',
            'editor.lineHighlightBackground': '#2A2A2A',
            'editor.selectionBackground': '#264F78',
            'editor.inactiveSelectionBackground': '#3A3D41',
            'editorLineNumber.foreground': '#858585',
            'editorLineNumber.activeForeground': '#C6C6C6',
            'editorCursor.foreground': '#AEAFAD',
            'editorWidget.background': '#252526',
            'editorWidget.foreground': '#CCCCCC',
            'minimap.background': '#1E1E1E',
            'editorWhitespace.foreground': '#7A7A7A'
        }
    });

    monaco.languages.registerDocumentSymbolProvider('bsl', {
        provideDocumentSymbols: function (m) {
            var syms = [], lines = m.getLinesContent();
            var re = /^\s*(Процедура|Procedure|Функция|Function)\s+([a-zA-Z\u0410-\u044F_\u0401\u0451][a-zA-Z\u0410-\u044F_\u0401\u04510-9]*)/i;
            for (var i = 0; i < lines.length; i++) {
                var mm = lines[i].match(re);
                if (!mm) continue;
                var k = mm[1].toLowerCase();
                var isF = (k === 'функция' || k === 'function');
                var range = { startLineNumber: i + 1, startColumn: 1, endLineNumber: i + 1, endColumn: lines[i].length + 1 };
                syms.push({
                    name: mm[2], detail: mm[1],
                    kind: isF ? monaco.languages.SymbolKind.Function : monaco.languages.SymbolKind.Method,
                    range: range, selectionRange: range
                });
            }
            return syms;
        }
    });

    monaco.languages.registerFoldingRangeProvider('bsl', {
        provideFoldingRanges: function (m) { return foldRangesBsl(m); }
    });
    monaco.languages.registerDefinitionProvider('bsl', {
        provideDefinition: function (m, pos) { return findLocalDefinition(m, pos); }
    });
    if (window.BslEditing) BslEditing.install(monaco, 'bsl');
    monaco.languages.registerCompletionItemProvider('bsl', {
        triggerCharacters: ['.'],
        provideCompletionItems: function (m, pos) { return completionSuggestions(m, pos); }
    });
    monaco.languages.registerDocumentFormattingEditProvider('bsl', {
        provideDocumentFormattingEdits: function (m) { return formatBsl(m, null); }
    });
    monaco.languages.registerDocumentRangeFormattingEditProvider('bsl', {
        provideDocumentRangeFormattingEdits: function (m, range) { return formatBsl(m, range); }
    });

    defineBslQuery(monaco);
    defineJsonXml(monaco);
}

function defineBslQuery(monaco) {
    monaco.languages.register({ id: 'bsl_query', extensions: ['.sdbl', '.query'], aliases: ['1C Query', 'SDBL'] });
    monaco.languages.setMonarchTokensProvider('bsl_query', {
        ignoreCase: true,
        keywords: QUERY_WORDS,
        expressions: QUERY_EXP,
        operators: /[=><+\-*\/%;,]+/,
        tokenizer: {
            root: [
                [/\/\/.*$/, 'query.comment'],
                [/[a-zA-Z\u0410-\u044F_\u0401\u0451][a-zA-Z\u0410-\u044F_\u0401\u04510-9]*/, {
                    cases: {
                        '@keywords': 'query.keyword',
                        '@expressions': 'query.exp',
                        '@default': 'query'
                    }
                }],
                [/&[a-zA-Z\u0410-\u044F_\u0401\u0451][a-zA-Z\u0410-\u044F_\u0401\u04510-9]*/, 'query.param'],
                [/&/, 'query.param'],
                [/"[^"]*"/, 'query.string'],
                [/[({})]/, 'query.brackets'],
                [/@operators/, 'query.operator'],
                [/\d*\.\d+([eE][\-+]?\d+)?/, 'query.float'],
                [/\d+/, 'query.int'],
                [/[^\s]/, 'query']
            ]
        }
    });
    monaco.languages.setLanguageConfiguration('bsl_query', {
        comments: { lineComment: '//' },
        brackets: [['(', ')'], ['[', ']']],
        autoClosingPairs: [
            { open: '(', close: ')' },
            { open: '[', close: ']' },
            { open: '"', close: '"' }
        ]
    });
    monaco.languages.registerFoldingRangeProvider('bsl_query', {
        provideFoldingRanges: function (m) { return foldRangesQuery(m); }
    });
}

function bslStructureWord(line, inString) {
    if (inString) return '';
    var t = line.replace(/^\s+/, '');
    if (!t || t.indexOf('//') === 0) return '';
    if (t.charAt(0) === '&') return '';
    var hash = false;
    if (t.charAt(0) === '#') {
        hash = true;
        t = t.slice(1).replace(/^\s+/, '');
    }
    var m = t.match(/^([A-Za-z\u0410-\u044F_\u0401\u0451]+)/);
    if (!m) return '';
    var w = m[1].toLowerCase();
    if (w === 'асинх' || w === 'async') {
        var rest = t.slice(m[1].length).replace(/^\s+/, '');
        var m2 = rest.match(/^([A-Za-z\u0410-\u044F_\u0401\u0451]+)/);
        if (m2) w = m2[1].toLowerCase();
    }
    return hash ? ('#' + w) : w;
}

function scanQuoteState(line, inString) {
    var i = 0;
    var queryStart = false;
    if (!inString) {
        var trimmed = line.replace(/^\s+/, '');
        if (trimmed.charAt(0) === '|') {
            /* Continuation of a multiline string is handled by inString from
             * the previous line; a lone pipe at the start of a code line is
             * still a string continuation in 1C. */
        }
    }
    while (i < line.length) {
        var ch = line.charAt(i);
        if (inString) {
            if (ch === '"') {
                if (line.charAt(i + 1) === '"') { i += 2; continue; }
                inString = false;
            }
            i++;
            continue;
        }
        if (ch === '/' && line.charAt(i + 1) === '/') break;
        if (ch === '"') {
            inString = true;
            var rest = line.slice(i + 1).replace(/^\s+/, '');
            if (/^(выбрать|select)\b/i.test(rest)) queryStart = true;
        }
        i++;
    }
    return { inString: inString, queryStart: queryStart };
}

function foldRangesBsl(m) {
    var lines = m.getLinesContent();
    var ranges = [];
    var stack = [];
    var inString = false;
    var queryFoldStart = -1;
    var i, word, kind, j, item;
    for (i = 0; i < lines.length; i++) {
        var prevString = inString;
        var scan = scanQuoteState(lines[i], inString);
        inString = scan.inString;
        if (!prevString && scan.queryStart && scan.inString) queryFoldStart = i;
        if (prevString && !inString && queryFoldStart >= 0) {
            if (i > queryFoldStart) ranges.push({ start: queryFoldStart + 1, end: i + 1, kind: monaco.languages.FoldingRangeKind.Region });
            queryFoldStart = -1;
        }
        word = bslStructureWord(lines[i], prevString);
        if (!word) continue;
        kind = FOLD_OPEN[word];
        if (kind) {
            stack.push({ kind: kind, start: i, proc: kind === 'proc' });
            continue;
        }
        kind = FOLD_CLOSE[word];
        if (!kind) continue;
        for (j = stack.length - 1; j >= 0; j--) {
            if (stack[j].kind === kind) {
                item = stack.splice(j, 1)[0];
                if (i > item.start) ranges.push({ start: item.start + 1, end: i + 1, kind: monaco.languages.FoldingRangeKind.Region });
                break;
            }
        }
    }
    if (queryFoldStart >= 0 && lines.length - 1 > queryFoldStart) {
        ranges.push({ start: queryFoldStart + 1, end: lines.length, kind: monaco.languages.FoldingRangeKind.Region });
    }
    return ranges;
}

function foldRangesQuery(m) {
    var lines = m.getLinesContent();
    var ranges = [];
    var stack = [];
    var i, line, c, top;
    for (i = 0; i < lines.length; i++) {
        line = lines[i];
        for (var k = 0; k < line.length; k++) {
            c = line.charAt(k);
            if (c === '/' && line.charAt(k + 1) === '/') break;
            if (c === '"') {
                k++;
                while (k < line.length && line.charAt(k) !== '"') k++;
                continue;
            }
            if (c === '(') stack.push(i);
            else if (c === ')' && stack.length) {
                top = stack.pop();
                if (i > top) ranges.push({ start: top + 1, end: i + 1 });
            }
        }
    }
    return ranges;
}

function collectProcedureStarts(m) {
    var lines = m.getLinesContent();
    var starts = [];
    var inString = false;
    var i, word, kind;
    for (i = 0; i < lines.length; i++) {
        var prevString = inString;
        inString = scanQuoteState(lines[i], inString).inString;
        word = bslStructureWord(lines[i], prevString);
        if (!word) continue;
        kind = FOLD_OPEN[word];
        if (kind === 'proc' || kind === 'region') starts.push(i);
    }
    return starts;
}

function foldAllProcedures(fold) {
    var activeModel = editor && editor.getModel();
    if (!activeModel || (!isBslModule() && !formModuleOpen())) return;
    var starts = collectProcedureStarts(activeModel);
    if (!starts.length) return;
    editor.trigger('bsl', fold ? 'editor.fold' : 'editor.unfold', { selectionLines: starts });
    editor.focus();
}

function findLocalDefinition(m, pos) {
    var word = m.getWordAtPosition(pos);
    if (!word || !word.word) return null;
    var name = word.word;
    /* \b is ASCII-only in JS regex: between a Cyrillic letter and "(" neither
     * side counts as \w, so no boundary is ever found and every Cyrillic
     * procedure name (i.e. almost all of them) silently fails to match.
     * Use an explicit negative lookahead over the real identifier charset. */
    var re = new RegExp('^\\s*(?:Асинх\\s+|Async\\s+)?(Процедура|Procedure|Функция|Function)\\s+' +
        name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![a-zA-Z\\u0410-\\u044F_\\u0401\\u04510-9])', 'i');
    var lines = m.getLinesContent();
    for (var i = 0; i < lines.length; i++) {
        if (!re.test(lines[i])) continue;
        return {
            uri: m.uri,
            range: {
                startLineNumber: i + 1, startColumn: 1,
                endLineNumber: i + 1, endColumn: lines[i].length + 1
            }
        };
    }
    return null;
}

function snippetSuggestions(m, pos) {
    if (!state.isEditing) return { suggestions: [] };
    var word = m.getWordUntilPosition(pos);
    var range = {
        startLineNumber: pos.lineNumber,
        endLineNumber: pos.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn
    };
    var out = [];
    for (var i = 0; i < BSL_SNIPPETS.length; i++) {
        var sn = BSL_SNIPPETS[i];
        out.push({
            label: sn.label,
            kind: monaco.languages.CompletionItemKind.Snippet,
            insertText: sn.body,
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            documentation: sn.label,
            filterText: sn.prefix,
            range: range
        });
    }
    return { suggestions: out };
}

function completionSuggestions(m, pos) {
    var result = snippetSuggestions(m, pos);
    if (!state.isEditing || !window.BslCompletionData) return result;
    var word = m.getWordUntilPosition(pos);
    var range = {
        startLineNumber: pos.lineNumber,
        endLineNumber: pos.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn
    };
    var kinds = monaco.languages.CompletionItemKind;
    var entries = window.BslCompletionData;
    for (var i = 0; i < entries.length; i++) {
        var item = entries[i];
        var suggestion = {
            label: item.label,
            kind: kinds[item.kind] || kinds.Text,
            insertText: item.label,
            detail: item.detail,
            filterText: item.filterText || item.label,
            range: range
        };
        if (item.documentation) suggestion.documentation = item.documentation;
        result.suggestions.push(suggestion);
    }
    var metadata = window.BslMetadataCompletion;
    var metadataContext = metadata && metadata.context(m, pos);
    if (metadataContext && (metadataContext.category || metadataContext.commonModuleCandidate)) {
        var pending = metadataContext.commonModuleCandidate
            ? metadata.commonModuleSuggestions(state.filePath, formContextIo, metadataContext.commonModuleCandidate)
            : metadata.suggestions(state.filePath, formContextIo, metadataContext.category);
        return pending.then(function (items) {
            for (var j = 0; j < items.length; j++) {
                var item = items[j];
                result.suggestions.push({
                    label: item.label,
                    kind: kinds[item.kind] || kinds.Text,
                    insertText: item.insertText,
                    detail: item.detail,
                    filterText: item.filterText,
                    range: range
                });
            }
            return result;
        }, function () { return result; });
    }
    return result;
}

/* The Configurator indents a line by its block nesting level alone, so a range
 * has to know how deep it starts; the final newline belongs to the document,
 * not to a range inside it. */
function formatBsl(m, range) {
    if (!window.BslFormatter) return [];
    var full = m.getFullModelRange();
    var use = range || full;
    var text = m.getValueInRange(use);
    var options = m.getOptions();
    var level = 0;
    try {
        if (range) {
            level = window.BslFormatter.getIndentLevel(m.getValueInRange({
                startLineNumber: 1,
                startColumn: 1,
                endLineNumber: use.startLineNumber,
                endColumn: use.startColumn
            }));
        }
        return window.BslFormatter.format(text, use, {
            eol: m.getEOL(),
            useTabs: !options.insertSpaces,
            indentSize: options.tabSize,
            initialLevel: level,
            indentFirstLine: Boolean(range) && use.startColumn === 1,
            insertFinalNewline: !range
        }) || [];
    } catch (e) {
        return [];
    }
}

/* JSON/XML: register monarch tokenisers up front. Monaco's jsonMode loads
 * asynchronously (and may later replace JSON tokens); XML is lazy-loaded
 * from basic-languages. Without our own providers the first paint is
 * plaintext, and bsl-light/bsl-dark (inherit:false) had no colours for
 * tag / attribute / string.key anyway. */
function defineJsonXml(monaco) {
    monaco.languages.setMonarchTokensProvider('json', {
        tokenPostfix: '.json',
        defaultToken: '',
        tokenizer: {
            root: [
                { include: '@whitespace' },
                [/[{}]/, 'delimiter.bracket'],
                [/[\[\]]/, 'delimiter.array'],
                [/[,:]/, 'delimiter'],
                [/"([^"\\]|\\.)*"(?=\s*:)/, 'string.key'],
                [/"([^"\\]|\\.)*$/, 'string.invalid'],
                [/"/, { token: 'string.quote', next: '@string' }],
                [/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/, 'number'],
                [/true|false|null/, 'keyword']
            ],
            string: [
                [/[^\\"']+/, 'string'],
                [/\\./, 'string.escape'],
                [/"/, { token: 'string.quote', next: '@pop' }]
            ],
            whitespace: [
                [/[ \t\r\n]+/, ''],
                [/\/\*/, { token: 'comment', next: '@comment' }],
                [/\/\/.*$/, 'comment']
            ],
            comment: [
                [/[^*]+/, 'comment'],
                [/\*\//, { token: 'comment', next: '@pop' }],
                [/./, 'comment']
            ]
        }
    });
    monaco.languages.setLanguageConfiguration('json', {
        comments: { lineComment: '//', blockComment: ['/*', '*/'] },
        brackets: [['{', '}'], ['[', ']']],
        autoClosingPairs: [
            { open: '{', close: '}' },
            { open: '[', close: ']' },
            { open: '"', close: '"' }
        ]
    });

    monaco.languages.setMonarchTokensProvider('xml', {
        defaultToken: '',
        tokenPostfix: '.xml',
        ignoreCase: true,
        qualifiedName: /(?:[\w.\-]+:)?[\w.\-]+/,
        tokenizer: {
            root: [
                [/[^<&]+/, ''],
                { include: '@whitespace' },
                [/(<\?)(@qualifiedName)/, [{ token: 'delimiter' }, { token: 'metatag', next: '@tag' }]],
                [/<!\[CDATA\[/, { token: 'delimiter.cdata', next: '@cdata' }],
                [/(<\!)(@qualifiedName)/, [{ token: 'delimiter' }, { token: 'metatag', next: '@tag' }]],
                [/(<\/)(@qualifiedName)(\s*)(>)/, [
                    { token: 'delimiter' }, { token: 'tag' }, '', { token: 'delimiter' }
                ]],
                [/(<)(@qualifiedName)/, [{ token: 'delimiter' }, { token: 'tag', next: '@tag' }]],
                [/&\w+;/, 'string.escape']
            ],
            cdata: [
                [/[^\]]+/, ''],
                [/\]\]>/, { token: 'delimiter.cdata', next: '@pop' }],
                [/\]/, '']
            ],
            tag: [
                [/[ \t\r\n]+/, ''],
                [/(@qualifiedName)(\s*=\s*)("[^"]*"|'[^']*')/, [
                    'attribute.name', '', 'attribute.value'
                ]],
                [/@qualifiedName/, 'attribute.name'],
                [/\?>/, { token: 'delimiter', next: '@pop' }],
                [/(\/)(>)/, [{ token: 'tag' }, { token: 'delimiter', next: '@pop' }]],
                [/>/, { token: 'delimiter', next: '@pop' }]
            ],
            whitespace: [
                [/[ \t\r\n]+/, ''],
                [/<!--/, { token: 'comment', next: '@comment' }]
            ],
            comment: [
                [/-->/, { token: 'comment', next: '@pop' }],
                [/[^-]+/, 'comment.content'],
                [/./, 'comment.content']
            ]
        }
    });
    monaco.languages.setLanguageConfiguration('xml', {
        comments: { blockComment: ['<!--', '-->'] },
        brackets: [['<', '>']],
        autoClosingPairs: [
            { open: '<', close: '>' },
            { open: '"', close: '"' },
            { open: "'", close: "'" }
        ]
    });
}

// ------------------------------------------------------------------ editor

function editorOptions(big) {
    return {
        theme: state.isDark ? 'bsl-dark' : 'bsl-light',
        readOnly: state.sarifMode || !state.isEditing || dcsLocked(),
        fontSize: state.fontSize,
        fontFamily: "Consolas, 'Courier New', monospace",
        fontLigatures: false,
        /* Extra translate3d layers on .lines-content fight WebView2's compositor. */
        disableLayerHinting: true,
        minimap: { enabled: !big && !!state.minimap },
        folding: !big,
        bracketPairColorization: { enabled: !big },
        occurrencesHighlight: big ? 'off' : 'singleFile',
        renderLineHighlight: big ? 'none' : 'line',
        lineNumbers: 'on',
        scrollBeyondLastLine: false,
        smoothScrolling: false,
        automaticLayout: true,
        wordWrap: (state.language === 'markdown' || state.language === 'html') ? 'on' : 'off',
        renderWhitespace: state.whitespace ? 'all' : 'none',
        guides: { indentation: false, highlightActiveIndentation: false },
        renderControlCharacters: !!state.whitespace,
        /* Почему не 'svg' — см. whitespaceRenderOptions(). */
        experimentalWhitespaceRendering: 'font',
        links: false,
        contextmenu: true,
        quickSuggestions: !!(state.isEditing && isBslModule()),
        parameterHints: { enabled: false },
        suggestOnTriggerCharacters: false,
        acceptSuggestionOnEnter: (state.isEditing && isBslModule()) ? 'smart' : 'off',
        tabCompletion: (state.isEditing && isBslModule()) ? 'on' : 'off',
        snippetSuggestions: (state.isEditing && isBslModule()) ? 'inline' : 'none',
        wordBasedSuggestions: 'off',
        find: { addExtraSpaceOnTop: false },
        unicodeHighlight: { ambiguousCharacters: false, invisibleCharacters: false }
    };
}

/* BSLEdit and the Total Commander viewer resolve a form's context with the
 * shared form-context.js, the same module the MCP server runs. Configuration
 * files are read through the host's read-only endpoint, which only exposes the
 * opened form's configuration. The preview first paints from the form alone and
 * repaints once the context arrives. The cache keeps configuration indexes for
 * the life of the page, as the MCP server keeps them for its loader. */
var FORM_CONTEXT_MAX_BYTES = 64 * 1024 * 1024;
var formContextCache = {};
var formContextToken = 0;
var formContextPending = false;
/* Lookups go out in batches to /batch, which the host serves off the UI
 * thread; see FormContext.createHttpIo for the wire format. */
var formContextIo = window.FormContext
    ? FormContext.createHttpIo('https://bslcfg.invalid/file', 'https://bslcfg.invalid/batch') : null;

/* Форма показывается сразу, а команды и картинки конфигурации доезжают
 * отдельным проходом. Пока он идёт, значок держит пользователя в курсе, что
 * эскиз ещё не окончательный. */
function syncFormContextProgress() {
    var badge = document.getElementById('form-context-progress');
    if (!badge) return;
    badge.hidden = !(formContextPending && formPreviewOpen()
        && !document.documentElement.classList.contains('screenshot-mode'));
}

function setFormContextPending(pending) {
    formContextPending = !!pending;
    syncFormContextProgress();
}

function resolveFormContext(req) {
    var token = ++formContextToken;
    var filePath = req.path || '';
    setFormContextPending(false);
    if (!req.resolveContext || !window.FormContext || !/\.(?:xml|form)$/i.test(filePath)) return null;
    /* Only a form reads its owner's metadata, styles and commands; an object
     * descriptor or a template would only wait for context it never uses. */
    var claimed = detectProvider(req.content || '');
    if (!claimed || !claimed.usesObjectMeta) return null;
    setFormContextPending(true);
    return FormContext.createResolver(formContextIo, { maxBytes: FORM_CONTEXT_MAX_BYTES, cache: formContextCache })
        .resolve(filePath, req.content || '')
        .then(function (context) {
            if (token !== formContextToken || state.filePath !== filePath) return;
            setFormContextPending(false);
            state.baseForm = context.baseForm;
            state.objectMeta = context.objectMeta;
            state.contextInterfaceMode = context.interfaceMode || 'Any';
            if (state.formInterfaceMode === 'Auto') state.interfaceMode = state.contextInterfaceMode;
            state.refMeta = context.refMeta || {};
            state.commonCommands = context.commonCommands;
            state.commonPictures = context.commonPictures;
            state.styleItems = context.styleItems;
            syncFormInterfaceModeMenu();
            if (state.previewMode && isDocPreview()) {
                refreshDocPreview();
                allItems = [];
                renderOutline();
                setTimeout(refreshOutline, 0);
            }
        })
        .catch(function (error) {
            if (token === formContextToken) setFormContextPending(false);
            if (window.console) console.warn('form context was not resolved', error);
        });
}

/* An object window also shows what the rest of the configuration says about
 * the object (registrars, subordinate catalogs, subsystems...). The window
 * paints from the descriptor alone and repaints once the scan answers; scans
 * stay cached per configuration for the life of the page. */
var mdRelationsCache = {};
var mdRelationsToken = 0;

var mdRolesTarget = null;

/* Roles read every Rights.xml of the configuration, so they load only when
 * the Roles tab is opened, never with the object window itself. */
function loadMdRoles() {
    var target = mdRolesTarget;
    if (!target || state.mdRoles || !state.mdRolesAvailable) return;
    state.mdRoles = 'loading';
    MetadataRelations.create(formContextIo, mdRelationsCache)
        .loadRoles(target.path, target.kind, target.name)
        .then(function (roles) {
            if (mdRolesTarget !== target || state.filePath !== target.path) return;
            state.mdRoles = roles || [];
            if (!roles) state.mdRolesAvailable = false;
            renderOutline();
        }, function (error) {
            if (mdRolesTarget !== target) return;
            state.mdRoles = 'failed';
            renderOutline();
            if (window.console) console.warn('roles were not resolved', error);
        });
}

function mdTabsActive() {
    var p = currentProvider();
    return !!(p && p.id === 'metadata' && isDocPreview() && state.mdRolesAvailable);
}

function resolveMdRelations(req) {
    var token = ++mdRelationsToken;
    var filePath = req.path || '';
    state.mdRelations = null;
    state.mdRoles = null;
    state.mdRolesAvailable = false;
    if (!window.MetadataRelations || !formContextIo || !/\.(?:xml|form)$/i.test(filePath)) return;
    var claimed = detectProvider(req.content || '');
    if (!claimed || claimed.id !== 'metadata') return;
    var parsed = MetadataPreview.parse(req.content || '');
    if (!parsed.model) return;
    /* An external object has no configuration to scan, only its templates. */
    var external = /^External/.test(parsed.model.kind);
    if (!external) {
        state.mdRolesAvailable = true;
        mdRolesTarget = { path: filePath, kind: parsed.model.kind, name: parsed.model.name, token: token };
    }
    var templates = parsed.model.groups.filter(function (g) { return g.kind === 'Template'; })
        .reduce(function (names, g) { return names.concat(g.items.map(function (t) { return t.name; })); }, []);
    var forms = parsed.model.groups.filter(function (g) { return g.kind === 'Form'; })
        .reduce(function (names, g) { return names.concat(g.items.map(function (f) { return f.name; })); }, []);
    MetadataRelations.create(formContextIo, mdRelationsCache)
        .load(filePath, parsed.model.kind, parsed.model.name, templates, forms)
        .then(function (relations) {
            if (!relations || token !== mdRelationsToken || state.filePath !== filePath) return;
            state.mdRelations = relations;
            if (state.previewMode && isDocPreview()) {
                refreshDocPreview();
                allItems = [];
                renderOutline();
                setTimeout(refreshOutline, 0);
            }
        })
        .catch(function (error) {
            if (window.console) console.warn('object relations were not resolved', error);
        });
}

function applyLoad(req) {
    if (window.EpfUnpack) EpfUnpack.hide();
    if (window.EpfPack) EpfPack.hide();
    /* Сообщение о прошлом файле новому документу не принадлежит. */
    hideExternalBar();
    var content = req.content || '';
    var isProjSource = /\.form$/i.test(String(req.path || ''));
    var isProjMetadata = /\.mdo$/i.test(String(req.path || ''));
    var projModuleView = isProjSource && req.formView === 'module' && !!req.formModulePath;
    if (isProjSource && !projModuleView && window.ProjFormConverter) {
        var converted = window.ProjFormConverter.convert(content);
        if (!converted.ok) {
            showTemplateError('Структура формы проекта пока не поддерживается; показан исходный Form.form.');
            req.language = 'xml';
            req.readOnly = true;
        } else {
            content = converted.xml;
            req.language = 'xml';
            if (!projModuleView) req.readOnly = true;
        }
    }
    if (isProjMetadata && window.ProjMetadataConverter) {
        var metadataConverted = window.ProjMetadataConverter.convert(content);
        if (!metadataConverted.ok) {
            showTemplateError('Этот тип объекта проекта пока не поддерживается; показан исходный .mdo.');
            req.language = 'xml';
            req.readOnly = true;
        } else {
            content = metadataConverted.xml;
            req.language = 'xml';
            req.readOnly = true;
        }
    }
    req.content = content;
    state.language = req.language || 'bsl';
    state.isDark = preferredDark();
    state.fontSize = req.fontSize || 14;
    state.readOnly = (req.readOnly !== false) || (isProjSource && !projModuleView) || isProjMetadata;
    state.isEditing = !state.readOnly;
    state.previewMode = false;
    state.filePath = req.path || '';
    state.formTitle = req.formTitle || '';
    state.formModule = req.formModule || '';
    state.formModulePath = req.formModulePath || '';
    state.formWorkbenchView = req.formView === 'module' && state.formModulePath ? 'module' : 'form';
    state.baseForm = req.baseForm || '';
    state.objectMeta = req.objectMeta || '';
    state.contextInterfaceMode = req.interfaceMode || 'Any';
    state.formInterfaceMode = storedFormInterfaceMode(state.filePath) || 'Auto';
    state.interfaceMode = state.formInterfaceMode === 'Auto'
        ? state.contextInterfaceMode : state.formInterfaceMode;
    state.refMeta = req.refMeta || {};
    state.commonCommands = req.commonCommands || {};
    state.commonPictures = req.commonPictures || {};
    state.styleItems = req.styleItems || {};
    state.epfRoot = epfRootKind(content);
    var contextReady = resolveFormContext(req);
    resolveMdRelations(req);
    var loadToken = formContextToken;
    var loaded = detectProvider(content);
    state.previewId = loaded ? loaded.id : '';
    /* A form or a template opens as a picture to look at, not as a document
     * being typed into: the pencil is what turns the mockup into an editor,
     * and until it is pressed a stray click cannot change the layout. A text
     * file still opens ready to edit - that is what an editor is for - and so
     * does a form opened on its module tab, which is text. */
    if (loaded && loaded.editable && state.formWorkbenchView !== 'module') state.isEditing = false;
    /* BSLEdit's «Настройки» can turn both around: a template straight into
     * editing, a module into reading until the pencil. Read-only files stay so. */
    if (!state.readOnly) {
        var isTemplate = loaded && (loaded.id === 'template' || loaded.id === 'mxl');
        var isModule = state.formWorkbenchView === 'module' || (!loaded && state.language === 'bsl');
        if (isTemplate && req.openTemplates === 'edit') state.isEditing = true;
        if (isModule && req.openModules === 'view') state.isEditing = false;
    }
    state.sarifMode = !!(loaded && loaded.id === 'sarif');
    state.sarifRoot = '';
    state.sarifSourcePath = '';
    state.sarifSourceLang = '';
    state.sarifSelectedId = '';
    sarifReportContent = state.sarifMode ? content : '';
    sarifParsedModel = null;
    if (state.sarifMode) {
        var sarifParsed = parseWithProvider(loaded, content);
        sarifParsedModel = sarifParsed && sarifParsed.model || null;
    }
    sarifFileCache.clear();
    sarifPendingReads = {};
    sarifSourceMeta = null;
    sarifDecorationsKey = '';
    state.formSelectedId = '';
    state.outlineKind = 'elements';
    state.selectedAttributeId = '';
    formElementItems = [];
    formAttributeItems = [];
    state.outlineCollapsed = {};
    /* A different file starts with a clean preview: folded groups and the
     * selected tab are keyed by element id, and those repeat across forms. */
    PreviewProviders.resetViewState();
    trackNavigation(state.filePath);
    state.dirty = false;
    state.moduleDirty = false;
    pendingLeaveEdit = false;
    hideSavePrompt();
    resetDiffPanel();
    /* Спрашиваем git сразу: кнопка сравнения показывается вне режима правки
     * только тогда, когда файлу есть с чем сравниваться. */
    requestGitInfo('file');
    if (state.formModulePath) requestGitInfo('module');

    var big = content.length > BIG_FILE_CHARS;
    var old = model;
    var oldFormModule = formModuleModel;
    model = monaco.editor.createModel(content, state.language);
    formModuleModel = state.formModulePath
        ? monaco.editor.createModel(state.formModule, 'bsl') : null;
    /* Monaco normalises line endings (and may consume a leading BOM). Its
     * value is the snapshot every later edit and undo is compared with; raw
     * host text would leave a document dirty even after an exact undo. */
    baselineContent = model.getValue();
    baselineVersion = model.getAlternativeVersionId();
    moduleBaselineContent = formModuleModel ? formModuleModel.getValue() : state.formModule;
    moduleBaselineVersion = formModuleModel ? formModuleModel.getAlternativeVersionId() : -1;
    if (!big && model.getLineCount() > BIG_FILE_LINES) big = true;
    state.bigFile = !!big;

    ensureEditor(big);
    editor.setModel(model);
    if (old) old.dispose();
    if (oldFormModule) oldFormModule.dispose();

    model.onDidChangeContent(function () {
        /* Undo back to the loaded/saved snapshot is clean. Treating every
         * Monaco change as dirty made the XML return byte-for-byte while the
         * save button and window title still kept their star. */
        if (!suppressDirty) state.dirty = modelDirty(model, baselineContent, baselineVersion);
        updateStatusBar();
        if (!applyingFromPreview && !suppressDirty) schedulePreviewRefresh();
    });
    if (formModuleModel) formModuleModel.onDidChangeContent(function () {
        if (!suppressDirty)
            state.moduleDirty = modelDirty(formModuleModel, moduleBaselineContent, moduleBaselineVersion);
        updateStatusBar();
    });

    // A reused instance may still be showing the previous file's UI state.
    document.getElementById('outline-filter').value = '';
    editor.setScrollPosition({ scrollTop: 0, scrollLeft: 0 });
    applyInitialSearch(req);

    /* A form opens in its light mockup. Theming the loading overlay and editor
     * dark here and light once the preview shows flashed dark -> light on
     * every form opened from a dark host. */
    state.previewPending = isDocPreview();
    applyTheme();
    updateStatusBar();
    allItems = [];
    renderOutline();

    /* Keep the loading overlay up until the split view is complete: revealing
     * the bare editor first and then the preview reads as several flashes. */
    var show = function () {
        if (loadToken !== formContextToken) return;
        /* Выбор «только исходник» держится и при открытии следующего файла:
         * иначе каждый .md снова открывался бы в два окна. */
        var wantsPreview = isDocPreview()
            || (textLayoutAvailable() && state.textLayout !== 'source');
        setPreviewMode(wantsPreview, finishFirstPaint);
        /* Outline scanning walks every line, so let the editor paint first. */
        setTimeout(refreshOutline, 0);
    };
    /* A form drawn before its context arrives is drawn again once commands,
     * pictures and titles resolve - a visible jump and twice the layout work.
     * Usually the context is quick; wait for it briefly under the overlay and
     * fall back to the bare form (updated later) only when it is slow. */
    refreshHelp();
    refreshUpTarget();
    if (contextReady && isDocPreview()) {
        var shown = false;
        var once = function () { if (!shown) { shown = true; show(); } };
        contextReady.then(once, once);
        setTimeout(once, CONTEXT_WAIT_MS);
    } else {
        show();
    }
}

/* Create the editor once, preferably while the parked warm instance is still
 * off-screen. The first on-screen open then only swaps the model — the path
 * that already worked when the user closed and reopened the viewer. */
function ensureEditor(big) {
    document.getElementById('main').style.display = 'flex';
    if (!editor) {
        editor = monaco.editor.create(document.getElementById('editor'), editorOptions(!!big));
        wireEditorCommands();
        wireEditorScrollFix();
        wireStatusBar();
        wirePreviewScroll();
    } else {
        editor.updateOptions(editorOptions(!!big));
    }
}

function monacoCssReady() {
    try {
        for (var i = 0; i < document.styleSheets.length; i++) {
            var href = document.styleSheets[i].href || '';
            if (href.indexOf('editor.main.css') < 0) continue;
            var rules = document.styleSheets[i].cssRules || document.styleSheets[i].rules;
            return !!(rules && rules.length);
        }
    } catch (e) { /* opaque sheet */ }
    return false;
}

function viewLinesPositioned() {
    var line = document.querySelector('.monaco-editor .view-line');
    return !!(line && getComputedStyle(line).position === 'absolute');
}

function finishFirstPaint() {
    if (!editor) return;
    editor.layout();
    clampLinesContent();
    var tries = 0;
    /* Use setTimeout, not rAF: when the host briefly hides the WebView,
     * requestAnimationFrame is paused and we never reach "painted". */
    function tick() {
        if (!editor) return;
        editor.layout();
        clampLinesContent();
        tries++;
        var ready = monacoCssReady() && viewLinesPositioned();
        if (ready || tries > 30) {
            document.getElementById('loading').style.display = 'none';
            editor.layout();
            clampLinesContent();
            send({ cmd: 'painted' });
            setTimeout(function () { send({ cmd: 'painted' }); }, 50);
            setTimeout(function () { send({ cmd: 'painted' }); }, 250);
            return;
        }
        setTimeout(tick, 50);
    }
    setTimeout(tick, 0);
}

function prewarmEditor() {
    if (editor) return;
    ensureEditor(false);
    /* Keep the loading overlay up until a real file arrives and paints. */
}

/* The host keeps this page alive between files. Drop the document so a parked
 * instance does not hold a whole file in memory, but keep Monaco itself warm. */
function parkEditor() {
    if (!editor) return;
    var old = model;
    model = monaco.editor.createModel('', 'plaintext');
    editor.setModel(model);
    if (old) old.dispose();
    allItems = [];
    state.dirty = false;
    state.moduleDirty = false;
    baselineContent = '';
    moduleBaselineContent = '';
    baselineVersion = -1;
    moduleBaselineVersion = -1;
    pendingLeaveEdit = false;
    hideSavePrompt();
    resetDiffPanel();
    if (state.previewMode) setPreviewMode(false);
    state.previewId = '';
    renderOutline();
    updateStatusBar();
    document.getElementById('loading').style.display = 'flex';
}

function wireEditorCommands() {
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyE, toggleEdit);
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, saveFile);
    editor.addAction({
        id: 'bsl.format',
        label: 'Форматировать выделение или документ',
        keybindings: [monaco.KeyMod.Alt | monaco.KeyMod.Shift | monaco.KeyCode.KeyF],
        run: function () { formatDocument(); }
    });
    editor.addAction({
        id: 'bsl.comment',
        label: 'Комментировать строку',
        run: function () { toggleLineComment(); }
    });
    if (window.BslEditing) BslEditing.attach(monaco, editor, function () { return isBslModule() || formModuleOpen(); });
}

/* Monaco's _applyLayout sets .lines-content to 16777216×16777216. That square
 * layer breaks WebView2 compositing. Replace it with the real scroll size.
 * Do NOT clamp height to ~16k — that clipped view-lines after ~860 rows
 * (860 × 19px ≈ 16340). Width can stay modest; height must cover scrollHeight. */
var MAX_LINES_CONTENT_WIDTH = 100000;
var MAX_LINES_CONTENT_HEIGHT = 1000000;   // same ceiling Monaco uses for margins
function clampLinesContentOf(instance) {
    if (!instance) return;
    var root = instance.getDomNode();
    if (!root) return;
    var lc = root.querySelector('.lines-content');
    if (!lc) return;
    var layout = instance.getLayoutInfo();
    var h = Math.max(instance.getScrollHeight(), layout.height) + layout.height + 64;
    var w = Math.max(instance.getScrollWidth(), layout.width) + layout.width + 64;
    if (h > MAX_LINES_CONTENT_HEIGHT) h = MAX_LINES_CONTENT_HEIGHT;
    if (w > MAX_LINES_CONTENT_WIDTH) w = MAX_LINES_CONTENT_WIDTH;
    if (lc.style.height !== h + 'px') lc.style.height = h + 'px';
    if (lc.style.width !== w + 'px') lc.style.width = w + 'px';
}

function clampLinesContent() { clampLinesContentOf(editor); }

function wireScrollFixFor(instance) {
    clampLinesContentOf(instance);
    instance.onDidLayoutChange(function () { clampLinesContentOf(instance); });
    instance.onDidScrollChange(function () { clampLinesContentOf(instance); });
}

function wireEditorScrollFix() {
    wireScrollFixFor(editor);
}

// --------------------------------------------------------------- SARIF source

function sarifDir(path) {
    var at = String(path || '').lastIndexOf('\\');
    if (at < 0) at = String(path || '').lastIndexOf('/');
    return at >= 0 ? String(path).slice(0, at) : '';
}

function sarifRemapPath(path, selectedRoot, suggestedRoot) {
    path = String(path || '').replace(/\//g, '\\');
    selectedRoot = String(selectedRoot || '').replace(/[\\/]+$/, '');
    if (!selectedRoot || !(/^[A-Za-z]:\\/.test(path) || /^\\\\/.test(path))) return path;
    /* The report may be in Documents while sources live on Z:.  Its location
     * therefore says nothing about the source root.  For a one-file report
     * suggestedRoot is that file's directory, so choosing the corresponding
     * directory on another machine still produces the expected file path. */
    var originalRoot = String(suggestedRoot || '').replace(/[\\/]+$/, '');
    if (originalRoot && (path.toLowerCase() === originalRoot.toLowerCase() ||
        path.toLowerCase().indexOf(originalRoot.toLowerCase() + '\\') === 0))
        return selectedRoot + path.slice(originalRoot.length);
    return path;
}

function sarifResolvedPath(diag) {
    var path = String(diag && diag.path || '').replace(/\//g, '\\');
    if (/^[A-Za-z]:\\/.test(path) || /^\\\\/.test(path))
        return sarifRemapPath(path, state.sarifRoot, sarifParsedModel && sarifParsedModel.suggestedRoot);
    var base = state.sarifRoot || sarifDir(state.filePath);
    return base ? base.replace(/[\\/]+$/, '') + '\\' + path : path;
}

function putSarifCache(path, value) {
    if (sarifFileCache.has(path)) sarifFileCache.delete(path);
    sarifFileCache.set(path, value);
    while (sarifFileCache.size > 32) sarifFileCache.delete(sarifFileCache.keys().next().value);
}

function clearSarifError() {
    var el = document.getElementById('sarif-source-error');
    if (el && el.parentNode) el.parentNode.removeChild(el);
}

function showSarifError(text) {
    clearSarifError();
    var editorEl = document.getElementById('editor');
    var box = document.createElement('div');
    box.id = 'sarif-source-error';
    box.className = 'sf-source-error';
    box.innerHTML = '<span>' + esc(text) + '</span><button type="button">Выбрать корень…</button>';
    var button = box.querySelector('button');
    if (button) button.onclick = function () {
        send({ cmd: 'chooseRoot', suggest: sarifParsedModel && sarifParsedModel.suggestedRoot || sarifDir(state.filePath) });
    };
    editorEl.appendChild(box);
    setSarifStatus(text, true);
}

function setSarifStatus(text, error) {
    var el = document.getElementById('sb-status');
    if (!el) return;
    el.textContent = text || '';
    el.classList.toggle('error', !!error);
}

function setSarifModel(content, language, path, encoding) {
    clearSarifError();
    var old = model;
    model = monaco.editor.createModel(content, language);
    editor.setModel(model);
    editor.updateOptions({ readOnly: true });
    if (old) old.dispose();
    state.sarifSourcePath = path || '';
    state.sarifSourceLang = language || '';
    sarifSourceMeta = path ? { encoding: encoding || '', eol: SarifPreview._test.detectEol(content) } : null;
    sarifDecorationsKey = '';
    updateStatusBar();
    refreshOutline();
    editor.layout();
}

function toggleSarifSource() {
    if (!state.sarifMode) return;
    if (state.sarifSourcePath) {
        setSarifModel(sarifReportContent, 'json', '', '');
        setSarifStatus('Исходник отчёта', false);
    } else if (state.sarifSelectedId && sarifParsedModel) {
        var diag = sarifParsedModel.diagnostics.find(function (d) { return d.id === state.sarifSelectedId; });
        if (diag) onSarifSelect(diag);
    }
    applyChrome();
}

function onSarifSelect(diag) {
    if (!diag || !state.sarifMode) return;
    state.sarifSelectedId = diag.id;
    var path = sarifResolvedPath(diag);
    if (path === state.sarifSourcePath) {
        focusSarifDiagnostic(diag);
        return;
    }
    var cached = sarifFileCache.get(path);
    if (cached) {
        putSarifCache(path, cached);
        setSarifModel(cached.content, languageForPath(path), path, cached.encoding);
        focusSarifDiagnostic(diag);
        return;
    }
    var reqId = String(sarifNextReqId++);
    sarifPendingReads[reqId] = { diag: diag, path: path };
    setSarifStatus('Загрузка ' + path + '…', false);
    send({ cmd: 'readSource', reqId: reqId, path: path });
}

function onSarifSourceContent(reply) {
    var pendingRead = sarifPendingReads[String(reply.reqId || '')];
    if (!pendingRead) return;
    delete sarifPendingReads[String(reply.reqId || '')];
    if (!reply.ok) {
        showSarifError('Не удалось открыть исходник: ' + (reply.error || pendingRead.path));
        return;
    }
    var value = { content: reply.content || '', encoding: reply.encoding || '' };
    putSarifCache(pendingRead.path, value);
    setSarifModel(value.content, languageForPath(pendingRead.path), pendingRead.path, value.encoding);
    focusSarifDiagnostic(pendingRead.diag);
}

function onSarifRootChosen(reply) {
    if (!reply || !reply.ok || !reply.path) return;
    state.sarifRoot = reply.path;
    var diag = sarifParsedModel && sarifParsedModel.diagnostics.find(function (d) { return d.id === state.sarifSelectedId; });
    if (diag) onSarifSelect(diag);
}

function updateSarifDecorations(selected) {
    if (!editor || !model || !sarifParsedModel || !state.sarifSourcePath) return;
    var pathLower = state.sarifSourcePath.toLowerCase();
    var fileDiags = sarifParsedModel.diagnostics.filter(function (d) {
        return sarifResolvedPath(d).toLowerCase() === pathLower;
    });
    var key = pathLower + '|' + fileDiags.map(function (d) { return d.id; }).join(',');
    if (key !== sarifDecorationsKey) {
        sarifDecorationsKey = key;
        monaco.editor.setModelMarkers(model, 'sarif', fileDiags.map(function (d) {
            var col = d.col || 1;
            return { startLineNumber:d.line, startColumn:col, endLineNumber:d.endLine || d.line,
                endColumn:d.endCol || col + 1, message:(d.ruleTitle || d.ruleId) + ': ' + (d.message || ''),
                severity:severityFor(d.level), source:'sarif', code:String(d.id) };
        }));
        sarifBaseDecorations = editor.deltaDecorations(sarifBaseDecorations,
            fileDiags.filter(SarifPreview._test.isShortDiagnosticRange).map(function (d) {
                var col=d.col||1;
                return { range:new monaco.Range(d.line,col,d.endLine||d.line,d.endCol||col+1), options:{
                    isWholeLine:!d.col, className:'sf-diag-line', inlineClassName:'sf-diag-inline',
                    overviewRuler:{color:'#ff6b6b',position:monaco.editor.OverviewRulerLane.Right},
                    minimap:{color:'#ff6b6b',position:monaco.editor.MinimapPosition.Inline} } };
            }));
    }
    var selectedList = selected && SarifPreview._test.isShortDiagnosticRange(selected) ? [selected] : [];
    sarifSelectedDecorations = editor.deltaDecorations(sarifSelectedDecorations, selectedList.map(function(d){
        var col=d.col||1;
        return { range:new monaco.Range(d.line,col,d.endLine||d.line,d.endCol||col+1), options:{
            isWholeLine:!d.col,className:'sf-diag-sel-line',inlineClassName:'sf-diag-sel-inline',
            overviewRuler:{color:'#4f8cff',position:monaco.editor.OverviewRulerLane.Right},
            minimap:{color:'#4f8cff',position:monaco.editor.MinimapPosition.Inline} } };
    }));
}

function focusSarifDiagnostic(diag) {
    if (!editor || !diag) return;
    syncingFromEditor = true;
    updateSarifDecorations(diag);
    editor.revealLineNearTop(diag.line);
    editor.setPosition({ lineNumber: diag.line, column: diag.col || 1 });
    syncingFromEditor = false;
    setSarifStatus((diag.ruleTitle || diag.ruleId) + ': ' + (diag.message || ''), false);
    SarifPreview.highlight(formPreviewEl(), diag.id);
    updateStatusBar();
}

function onSarifCursorPosition() {
    if (!state.sarifMode || syncingFromEditor || !state.sarifSourcePath || !sarifParsedModel || !editor) return;
    var line = editor.getPosition().lineNumber, path = state.sarifSourcePath.toLowerCase();
    var diag = sarifParsedModel.diagnostics.find(function(d){
        return sarifResolvedPath(d).toLowerCase()===path && line>=d.line && line<=(d.endLine||d.line);
    });
    if (!diag) return;
    state.sarifSelectedId = diag.id;
    updateSarifDecorations(diag);
    SarifPreview.reveal(formPreviewEl(), diag.id);
    setSarifStatus((diag.ruleTitle || diag.ruleId) + ': ' + (diag.message || ''), false);
}

// -------------------------------------------------------------- status bar

function updateStatusBar() {
    var posEl = document.getElementById('sb-pos');
    var selEl = document.getElementById('sb-sel');
    var linesEl = document.getElementById('sb-lines');
    var statusEl = document.getElementById('sb-status');
    var summaryEl = document.getElementById('sb-summary');
    var fileEl = document.getElementById('sb-file');
    if (!posEl || !selEl || !linesEl) return;

    if (summaryEl) {
        var c = state.sarifMode && sarifParsedModel && sarifParsedModel.counts;
        summaryEl.textContent = c ? ('Всего: ' + c.total + ' · Ошибок: ' + c.error +
            ' · Предупреждений: ' + c.warning + ' · Заметок: ' + (c.note + c.none) +
            (c.suppressed ? ' · Подавлено: ' + c.suppressed : '')) : '';
    }
    if (fileEl) {
        var shortName = state.sarifSourcePath.replace(/^.*[\\/]/, '');
        var enc = sarifSourceMeta && sarifSourceMeta.encoding;
        if (enc) enc = ({utf8bom:'Utf8Bom',utf8:'Utf8',utf16le:'Utf16Le',utf16be:'Utf16Be',ansi:'Ansi'})[enc] || enc;
        fileEl.textContent = state.sarifMode && shortName ? (shortName + (enc ? ' · ' + enc : '') +
            (sarifSourceMeta ? ', ' + sarifSourceMeta.eol : '')) : '';
    }
    if (!state.sarifMode && statusEl) { statusEl.textContent = ''; statusEl.classList.remove('error'); }
    syncUndoButtons();
    syncDirtyMarks();

    /* Over a form mockup the hidden XML caret means nothing: show where the
     * selected element sits and what it is bound to instead. */
    var crumbsEl = document.getElementById('sb-crumbs');
    var elementEl = document.getElementById('sb-element');
    var formStatus = !state.sarifMode && formOutlineActive();
    posEl.style.display = linesEl.style.display = formStatus ? 'none' : '';
    if (crumbsEl && elementEl) {
        crumbsEl.innerHTML = '';
        elementEl.textContent = '';
        if (formStatus) renderFormStatus(crumbsEl, elementEl);
    }
    if (formStatus) {
        selEl.textContent = '';
        return;
    }

    var m = (editor && editor.getModel()) || model;
    if (!m) {
        posEl.textContent = 'Стр 1, Кол 1';
        selEl.textContent = '';
        linesEl.textContent = 'Строк: 0';
        return;
    }

    var pos = editor ? editor.getPosition() : null;
    posEl.textContent = 'Стр ' + (pos ? pos.lineNumber : 1) + ', Кол ' + (pos ? pos.column : 1);

    var n = 0;
    if (editor) {
        var sels = editor.getSelections();
        if (sels) {
            for (var i = 0; i < sels.length; i++) {
                if (!sels[i].isEmpty()) n += m.getValueLengthInRange(sels[i]);
            }
        }
    }
    selEl.textContent = n > 0 ? ('Выделено: ' + n) : '';
    linesEl.textContent = 'Строк: ' + m.getLineCount();
}

function renderFormStatus(crumbsEl, elementEl) {
    if (state.outlineKind === 'attributes') {
        for (var a = 0; a < formAttributeItems.length; a++) {
            if (formAttributeItems[a].id !== state.selectedAttributeId) continue;
            crumbsEl.textContent = 'Реквизиты \u203A ' + formAttributeItems[a].name;
            elementEl.textContent = formAttributeItems[a].typeName || '';
            return;
        }
        return;
    }
    var index = formElementIndex(state.formSelectedId);
    if (index < 0) return;
    var chain = formElementPath(index);
    var h = [];
    for (var c = 0; c < chain.length; c++) {
        if (c) h.push('<span class="sb-crumb-sep">\u203A</span>');
        h.push('<a href="#" class="sb-crumb" data-crumb-id="', esc(String(chain[c].id)), '" title="',
            esc(String(chain[c].name)), '">', esc(String(formElementLabel(chain[c]))), '</a>');
    }
    crumbsEl.innerHTML = h.join('');
    var entry = formElementItems[index];
    var view = previewView();
    var kindLabel = entry.tag && view && view.itemKindTitle ? view.itemKindTitle(entry.tag) : entry.tag;
    var typeShown = entry.typeName && window.FormPreview ? FormPreview.typePresentation(entry.typeName) : entry.typeName;
    elementEl.textContent = [kindLabel, entry.dataPath && ruDataPath(entry.dataPath), typeShown]
        .filter(function (part) { return !!part; }).join(' \u00B7 ');
}

function wireStatusBar() {
    editor.onDidChangeCursorPosition(function () { updateStatusBar(); onSarifCursorPosition(); });
    editor.onDidChangeCursorSelection(function () {
        updateStatusBar();
        syncHighlightFromEditor();
    });
    updateStatusBar();
}

// ----------------------------------------------------------------- outline

/* Outline of the rendered document (form elements, template areas), as opposed
 * to parseOutline() which scans BSL source for procedures and regions. */
function parseDocOutline() {
    allItems = [];
    formElementItems = [];
    formAttributeItems = [];
    formElementParents = [];
    formHandlers = {};
    var p = currentProvider();
    if (!p || !model || p.id === 'sarif') return;
    var src = model.getValue();
    var parsed = parseWithProvider(p, src);
    if (!parsed || !parsed.model) return;
    formElementItems = window[p.viewer].outline(parsed.model, src);
    if (p.id === 'form') {
        formElementParents = outlineParents(formElementItems);
        if (window[p.viewer].attributeOutline)
            formAttributeItems = window[p.viewer].attributeOutline(parsed.model, src);
        if (window[p.viewer].formHandlerIndex)
            formHandlers = window[p.viewer].formHandlerIndex(parsed.model, formElementItems);
    }
    allItems = p.id === 'form' && state.outlineKind === 'attributes'
        ? formAttributeItems : formElementItems;
    /* Some document trees have a meaningful root of their own. Select it on
     * first open so its inspector is visible immediately; a selection restored
     * by navigation always wins. */
    if (!state.formSelectedId && p.defaultSelection)
        state.formSelectedId = String(p.defaultSelection);
}

function outlineParents(items) {
    var parents = [], stack = [];
    for (var i = 0; i < items.length; i++) {
        var depth = items[i].depth || 0;
        stack.length = depth;
        parents.push(depth > 0 && stack[depth - 1] != null ? stack[depth - 1] : -1);
        items[i].outlineIndex = i;
        stack[depth] = i;
    }
    return parents;
}

function formElementIndex(id) {
    for (var i = 0; id && i < formElementItems.length; i++)
        if (formElementItems[i].id === id) return i;
    return -1;
}

/* Ancestors a reader recognises: pages, tables and captioned groups. The
 * Pages container and untitled technical groups only add noise, so the path
 * reads «30% › Сведения о доходах › Сумма» rather than the full XML nesting. */
function formElementPath(index) {
    var chain = [];
    for (var i = index; i >= 0 && i < formElementItems.length; i = formElementParents[i]) {
        var entry = formElementItems[i];
        if (i === index || (entry.tag !== 'Pages' && (entry.title || entry.tag === 'Page' || entry.tag === 'Table')))
            chain.unshift(entry);
    }
    return chain;
}

function formElementLabel(entry) { return entry.title || entry.name; }

/* DataPath's first segment names a form attribute, or a table whose own
 * DataPath leads to one (column paths look like «Товары.Номенклатура»). */
function attributeIdForDataPath(path) {
    for (var guard = 0; path && guard < 8; guard++) {
        var head = String(path).split('.')[0].trim().toLowerCase();
        if (!head) return '';
        for (var a = 0; a < formAttributeItems.length; a++)
            if (String(formAttributeItems[a].name).toLowerCase() === head) return formAttributeItems[a].id;
        var next = '';
        for (var e = 0; e < formElementItems.length; e++) {
            var el = formElementItems[e];
            if (el.dataPath && el.dataPath !== path && String(el.name).toLowerCase() === head) { next = el.dataPath; break; }
        }
        path = next;
    }
    return '';
}

/* Selects a form element from outside the tree (status bar crumbs, module
 * handler links): editor line, mockup highlight and outline row together. */
function selectFormElement(id) {
    var index = formElementIndex(id);
    if (index < 0) return;
    var entry = formElementItems[index];
    /* A filter left over from the other list (or one the target does not
     * match) would hide the row being selected. */
    var input = document.getElementById('outline-filter');
    var filterText = input ? input.value.toLowerCase() : '';
    var haystack = (entry.name + ' ' + (entry.title || '') + ' ' + (entry.tag || '') + ' ' + (entry.dataPath || '')).toLowerCase();
    if (state.outlineKind !== 'elements' || (filterText && haystack.indexOf(filterText) < 0)) {
        state.outlineKind = 'elements';
        if (input) input.value = '';
    }
    if (editor && model && editor.getModel() === model) {
        editor.revealLineInCenter(entry.line);
        editor.setPosition({ lineNumber: entry.line, column: 1 });
    }
    var view = previewView();
    if (view && view.highlight) view.highlight(formPreviewEl(), id);
    state.formSelectedId = String(id);
    renderOutline();
    highlightFormOutline(id);
    scheduleFormFit();
}

function formOutlineActive() {
    var p = currentProvider();
    return !!(p && p.id === 'form' && isDocPreview() && !formModuleOpen());
}

function selectOutlineKind(kind) {
    if (mdTabsActive() && (kind === 'elements' || kind === 'roles')) {
        state.outlineKind = kind;
        var filterInput = document.getElementById('outline-filter');
        if (filterInput) filterInput.value = '';
        if (kind === 'roles') loadMdRoles();
        renderOutline();
        return;
    }
    if (!formOutlineActive() || (kind !== 'elements' && kind !== 'attributes')) return;
    state.outlineKind = kind;
    allItems = kind === 'attributes' ? formAttributeItems : formElementItems;
    var input = document.getElementById('outline-filter');
    if (input) input.value = '';
    renderOutline();
}

/* ---- Moving form elements ----------------------------------------------
 *
 * The order of ChildItems in the document is the order on the form, so the
 * tree moves an element by rewriting the document and everything else is
 * drawn from it again. The engine owns the rules of what may lie where; the
 * tree only offers the moves it would accept, and reports the refusal when
 * one still comes back. */

/* FormEdit.moveTree for the document as it stands. It is read on every arrow
 * press and on every drag step, and the document only changes between them,
 * so it is kept for the version of the model it was built from. */
var formMoveTreeCache = { version: -1, list: [] };

function formMoveTree() {
    if (!model || !window.FormEdit || !window.FormEdit.moveTree) return [];
    var version = model.getVersionId();
    if (formMoveTreeCache.version === version) return formMoveTreeCache.list;
    var list;
    try { list = window.FormEdit.moveTree(model.getValue()); } catch (err) { list = []; }
    formMoveTreeCache = { version: version, list: list };
    return list;
}

function formMoveEntry(name) {
    var tree = formMoveTree();
    for (var i = 0; i < tree.length; i++) if (tree[i].name === name) return tree[i];
    return null;
}

/* True while the tree may reorder the form: an element list of a form open for
 * editing, shown in document order. Sorted by name it shows an order the
 * document does not have, and an arrow would move the element somewhere the
 * user is not looking. */
function formMovingEnabled() {
    return formOutlineActive() && state.outlineKind === 'elements'
        && state.isEditing && !state.readOnly && state.previewId === 'form'
        && !state.sortByName && !!(window.FormEdit && window.FormEdit.moveTree && window.DocEdits);
}

/* One move, as the engine takes it: into a container, or before/after a
 * neighbour. Everything the change touches is redrawn from the document, and
 * the element keeps the selection it had. */
function moveFormElement(name, params) {
    if (!formMovingEnabled() || !name || !model) return false;
    var before = model.getValue();
    var request = { element: name };
    Object.keys(params || {}).forEach(function (key) { request[key] = params[key]; });
    var out;
    try {
        out = window.FormEdit.moveElement(before, request);
    } catch (err) {
        showTemplateError((err && err.message) || String(err));
        return false;
    }
    if (!out || !out.xml || out.xml === before) return false;
    var keep = state.formSelectedId;
    applyPreviewEdits(window.DocEdits.textEdits(before, out.xml));
    showTemplateError('');
    refreshDocPreview();
    parseDocOutline();
    renderOutline();
    if (keep) {
        var view = previewView();
        if (view && view.highlight) view.highlight(formPreviewEl(), keep);
        highlightFormOutline(keep);
    }
    return true;
}

/* The neighbours of an element: the items the document keeps in the same
 * container, in its own order. */
function formMoveNeighbours(entry) {
    if (!entry) return [];
    return formMoveTree().filter(function (row) { return row.container === entry.container; });
}

/* Whether the element has anywhere to step: a lone item in its container
 * stays where it is, everything else can be moved. */
function formMoveStepEnabled(entry) {
    return formMoveNeighbours(entry).length > 1;
}

/* The arrows and Ctrl+Shift+Up/Down: one step among the neighbours the
 * document gives the element, never out of its container. At the edge the
 * step wraps round - up from the first place lands last, down from the last
 * lands first - so the arrows keep working instead of dead-ending. */
function moveFormElementStep(name, delta) {
    var entry = formMoveEntry(name);
    if (!entry) {
        showTemplateError('«' + name + '» не переставляется: это не элемент формы.');
        return false;
    }
    var neighbours = formMoveNeighbours(entry);
    var at = -1;
    for (var i = 0; i < neighbours.length; i++) if (neighbours[i].name === name) at = i;
    if (at < 0 || neighbours.length < 2) return false;
    var target = neighbours[at + delta];
    if (target) return moveFormElement(name, delta < 0 ? { before: target.name } : { after: target.name });
    /* Round the edge: to the other end of the same container. */
    return delta < 0
        ? moveFormElement(name, { after: neighbours[neighbours.length - 1].name })
        : moveFormElement(name, { before: neighbours[0].name });
}

/* The element the arrows act on: the selected row of the tree. */
function formMoveSelection() {
    if (!formMovingEnabled()) return null;
    var index = formElementIndex(state.formSelectedId);
    if (index < 0) return null;
    return formMoveEntry(formElementItems[index].name);
}

/* Whether a step exists at all, so a button that cannot do anything says so
 * before it is pressed. Both directions work at the edges: the step wraps to
 * the other end of the container. */
function formMoveStepPossible() {
    return formMoveStepEnabled(formMoveSelection());
}

function syncFormMoveButtons() {
    var up = document.getElementById('outline-move-up');
    var down = document.getElementById('outline-move-down');
    if (!up || !down) return;
    var on = formMovingEnabled();
    up.hidden = !on;
    down.hidden = !on;
    if (!on) return;
    up.disabled = !formMoveStepPossible();
    down.disabled = !formMoveStepPossible();
}

/* ---- Dragging a row of the tree ----------------------------------------
 *
 * A row is dropped on another row: over its upper or lower edge it takes the
 * place before or after it, and over its middle it goes inside, when the kind
 * of the target takes the kind being dragged. */
var formDrag = { name: '', index: -1, row: null, mode: '' };

function formDragPlan(row, event) {
    if (!formDrag.name || !row) return null;
    var target = shownOutlineEntry(row);
    if (!target || !target.name || target.name === formDrag.name) return null;
    /* An element cannot be moved inside itself, and the tree already knows
     * which rows lie under the one being dragged. */
    for (var up = target.outlineIndex; up != null && up >= 0; up = formElementParents[up])
        if (up === formDrag.index) return null;
    var dragged = formMoveEntry(formDrag.name);
    if (!dragged) return null;
    var entry = formMoveEntry(target.name);
    var canContain = window.FormEdit.canContain;
    /* A row that is not an item of ChildItems - a command bar, a search
     * addition - is not a neighbour, but it is a container of its own. */
    var into = canContain(target.tag || (entry && entry.kind) || '', dragged.kind);
    var beside = !!entry && canContain(entry.containerKind, dragged.kind);
    if (!into && !beside) return null;
    var rect = row.getBoundingClientRect();
    var mode = formDropMode(into, beside, rect.height ? (event.clientY - rect.top) / rect.height : 0.5);
    return mode ? { mode: mode, target: target.name } : null;
}

/* Where the pointer is over the row decides the move: the upper and lower
 * edges put the element beside it, the middle puts it inside. A row that only
 * takes one of the two has no edges to speak of, and the whole of it means
 * that one thing. */
function formDropMode(into, beside, ratio) {
    if (into && beside) return ratio < 0.3 ? 'before' : ratio > 0.7 ? 'after' : 'into';
    if (beside) return ratio < 0.5 ? 'before' : 'after';
    return into ? 'into' : '';
}

function clearFormDropMark() {
    var marked = document.querySelectorAll('#outline-list .drop-before, #outline-list .drop-after, #outline-list .drop-into');
    for (var i = 0; i < marked.length; i++) marked[i].classList.remove('drop-before', 'drop-after', 'drop-into');
}

function endFormDrag() {
    clearFormDropMark();
    var dragging = document.querySelector('#outline-list .dragging');
    if (dragging) dragging.classList.remove('dragging');
    formDrag = { name: '', index: -1, row: null, mode: '' };
}

/* The editable property panel of a managed form. It replaces the read-only
 * inspector while the form is open for editing; outside editing the inspector
 * stays as it was, since it shows the same values with the presentation the
 * renderer builds. */
var formPropertyPanel = null;

function formPropertyPanelFor(host) {
    if (formPropertyPanel) return formPropertyPanel;
    if (!window.FormProperties || !window.FormEdit || !window.DocEdits) return null;
    formPropertyPanel = window.FormProperties.panel(document, {
        xml: function () { return model ? model.getValue() : ''; },
        apply: function (edits) {
            applyPreviewEdits(edits);
            showTemplateError('');
            /* The mockup is drawn from the document, so it has to follow the
             * change; the panel redraws itself. */
            refreshDocPreview();
        },
        onError: showTemplateError,
        readOnly: !!state.readOnly,
        /* Handlers: the panel assigns names itself; opening or writing the
         * procedure needs the module, which a lone Form.xml does not have. */
        handlers: {
            exists: function (name) { return !!findFormHandlerLine(name); },
            open: function (element, kind, event, handler) {
                var entry = formEntryByName(element);
                if (!entry || !entry.item) entry = { name: element, item: { tag: kind } };
                createFormHandler(entry, event, handler, kind);
            },
            openCommand: function (handler) { createFormHandler(null, '', handler, ''); }
        }
    });
    if (formPropertyPanel) host.appendChild(formPropertyPanel.element);
    return formPropertyPanel;
}

/* True when the property panel, rather than the read-only inspector, belongs
 * in the right-hand pane right now. */
function formPropertiesEditable() {
    return formOutlineActive() && state.outlineKind === 'elements'
        && state.isEditing && !state.readOnly && state.previewId === 'form'
        && !!window.FormProperties;
}

function renderPropertyInspector() {
    var host = document.getElementById('property-inspector');
    if (!host) return;
    var propertyHandle = document.getElementById('property-resize-handle');
    if (templateEditingActive()) {
        var cells = templatePropertyPanelFor(host);
        if (cells) {
            host.hidden = false;
            /* The handle is display:none in the stylesheet, so an empty inline
             * value hides it rather than showing it. */
            if (propertyHandle) propertyHandle.style.display = 'block';
            cells.refresh();
            updateStatusBar();
            return;
        }
    }
    /* Leaving the sheet drops its panel: whatever takes the pane next owns
     * the markup and would wipe it out from under it. */
    if (templateProperties) {
        templateProperties = null;
        host.innerHTML = '';
    }

    if (formPropertiesEditable()) {
        var entry = null;
        for (var e = 0; e < formElementItems.length; e++) {
            if (formElementItems[e].id === state.formSelectedId) { entry = formElementItems[e]; break; }
        }
        var panel = formPropertyPanelFor(host);
        if (panel) {
            host.hidden = false;
            if (propertyHandle) propertyHandle.style.display = 'block';
            panel.show(entry ? entry.name : 'Form');
            updateStatusBar();
            return;
        }
    }
    /* Leaving edit mode drops the panel: the read-only inspector owns the
     * pane's markup and would wipe it out from under it. */
    if (formPropertyPanel) {
        formPropertyPanel = null;
        host.innerHTML = '';
    }
    function hideInspector() {
        host.hidden = true;
        host.innerHTML = '';
        if (propertyHandle) propertyHandle.style.display = 'none';
        updateStatusBar();
    }
    var view = previewView();
    /* Besides the form, any tree provider may describe its selected node. */
    var generic = !formOutlineActive() && docTree() && view && view.inspector;
    if (!formOutlineActive() && !generic) {
        hideInspector();
        return;
    }
    var entry = null;
    var attributesKind = !generic && state.outlineKind === 'attributes';
    var selectedId = attributesKind ? state.selectedAttributeId : state.formSelectedId;
    var source = generic ? allItems : attributesKind ? formAttributeItems : formElementItems;
    if (!selectedId) { hideInspector(); return; }
    for (var i = 0; i < source.length; i++) {
        if (source[i].id === selectedId) { entry = source[i]; break; }
    }
    var inspector = generic ? 'inspector' : attributesKind ? 'attributeInspector' : 'elementInspector';
    var info = entry && view && view[inspector] ? view[inspector](entry) : null;
    if (!info) { hideInspector(); return; }
    var h = ['<div class="attribute-inspector-head"><div><strong>', esc(String(info.name || 'Реквизит')),
        '</strong>', info.typeName ? '<span>' + esc(String(info.typeName)) + '</span>' : '',
        '</div><button type="button" id="property-inspector-close" title="Свернуть инспектор">&times;</button></div>',
        info.open && host ? '<a class="inspector-open-link" href="#" data-open-related="' + esc(String(info.open)) +
            '">' + esc(String(info.openTitle || 'Открыть')) + '</a>' : '',
        '<div class="attribute-inspector-title">', esc(String(info.heading)),
        '<span>', info.rows.length, '</span></div>'];
    if (!info.rows.length) {
        h.push('<div class="attribute-inspector-empty">',
            info.isDiff ? 'Нет отличающихся свойств' : 'Нет явно заданных свойств', '</div>');
    } else {
        h.push('<dl class="attribute-properties">');
        for (var r = 0; r < info.rows.length; r++) {
            var row = info.rows[r];
            h.push('<div class="attribute-property"><dt>', esc(String(row.label)), '</dt><dd title="',
                esc(String(row.value)), '">');
            if (row.color) h.push('<span class="property-color" style="background:', esc(String(row.color)), '"></span>');
            if (row.changed) h.push('<span class="attribute-before">', esc(String(row.before)), '</span><span class="attribute-arrow">→</span>');
            var attributeId = row.link === 'data-path' ? attributeIdForDataPath(row.value) : '';
            if (attributeId)
                h.push('<a class="attribute-value data-path-link" href="#" data-attribute-id="', esc(attributeId),
                    '" title="Показать реквизит">', esc(String(row.value)), '</a></dd></div>');
            else
                h.push('<span class="attribute-value">', esc(String(row.value)), '</span></dd></div>');
        }
        h.push('</dl>');
    }
    for (var g = 0; info.groups && g < info.groups.length; g++) {
        var group = info.groups[g];
        h.push('<details class="attribute-detail"', group.open ? ' open' : '', '><summary>', esc(String(group.label)), '</summary><dl>');
        for (var gi = 0; gi < group.items.length; gi++) {
            var detail = group.items[gi];
            h.push('<div><dt>', esc(String(detail.label)), '</dt><dd>');
            if (detail.link === 'form-handler' && findFormHandlerLine(detail.handler)) {
                h.push('<a class="form-handler-link" href="#" data-form-handler="',
                    esc(String(detail.handler)), '" title="Перейти к обработчику в модуле формы">',
                    esc(String(detail.value)), '</a>');
            } else {
                h.push(esc(String(detail.value)));
            }
            h.push('</dd></div>');
        }
        h.push('</dl></details>');
    }
    host.innerHTML = h.join('');
    host.hidden = false;
    if (propertyHandle) propertyHandle.style.display = 'block';
    /* The inspector appearing (or changing height) shrinks the outline list,
     * which can push the just-selected row below its visible edge. */
    var selectedRow = document.querySelector('#outline-list .proc-item.selected');
    if (selectedRow && selectedRow.scrollIntoView) {
        try { selectedRow.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
        catch (e) { selectedRow.scrollIntoView(); }
    }
    updateStatusBar();
}

/* Opens the form module on the procedure `name`; false when it is not there. */
function goToFormHandler(name) {
    var line = findFormHandlerLine(name);
    if (!line) return false;
    switchFormWorkbenchView('module');
    if (editor && formModuleModel) {
        editor.revealLineInCenter(line);
        editor.setPosition({ lineNumber: line, column: 1 });
        editor.focus();
    }
    return true;
}

/* The handlers of a form element as its inspector lists them: the command's
 * action of a button first, then the element's own events. */
function formElementHandlers(entry) {
    var view = previewView();
    var info = entry && view && view.elementInspector ? view.elementInspector(entry) : null;
    var out = [];
    var groups = (info && info.groups) || [];
    for (var g = 0; g < groups.length; g++) {
        for (var i = 0; i < groups[g].items.length; i++) {
            var item = groups[g].items[i];
            if (item.link !== 'form-handler' || !item.handler) continue;
            var command = groups[g].label === 'Команда';
            var label = command ? 'команды' : '«' + item.label + '»';
            var entryOut = { label: label, handler: item.handler, event: command ? '' : eventNameOf(entry, item.handler) };
            if (groups[g].label === 'Команда') out.unshift(entryOut); else out.push(entryOut);
        }
    }
    return out;
}

/* The XML name of the element's event that `handler` is assigned to. */
function eventNameOf(entry, handler) {
    var events = (entry && entry.item && entry.item.events) || [];
    for (var i = 0; i < events.length; i++) {
        if (String(events[i].handler || '').trim() === handler) return events[i].name;
    }
    return '';
}

/* The form's layout and module can both be written from the picture. */
function formHandlersEditable() {
    return !!(state.isEditing && !state.readOnly && state.previewId === 'form'
        && window.FormEdit && window.FormEdit.setEvent && window.DocEdits);
}

function formEntryByName(name) {
    for (var i = 0; i < formElementItems.length; i++) {
        if (formElementItems[i].name === name) return formElementItems[i];
    }
    return null;
}

/* The handler entries of an element's context menu. Viewing lists only the
 * handlers the module has; editing lists every event of the element's kind:
 * an assigned one opens (or writes) its procedure, a free one gets a new
 * handler the way the Designer names and writes it. Long lists go into a
 * submenu. */
function formHandlerMenu(entry) {
    var assigned = formElementHandlers(entry);
    var editable = formHandlersEditable();
    var out = [];
    var byEvent = {};
    assigned.forEach(function (h) {
        if (h.event) byEvent[h.event] = h.handler;
        var found = !!findFormHandlerLine(h.handler);
        if (!found && !editable) return;
        out.push({
            label: (found ? '' : 'Создать процедуру ') + (assigned.length > 1 ? h.label + ': ' : '') + h.handler,
            link: found,
            disabled: !found && !formModuleModel,
            hint: !found && !formModuleModel ? 'нет модуля формы' : '',
            action: function () { found ? goToFormHandler(h.handler) : createFormHandler(entry, h.event, h.handler); }
        });
    });
    if (!editable) return out;
    var kind = entry.item && entry.item.tag;
    var free = window.FormEdit.eventsFor(kind).filter(function (e) { return !byEvent[e.name]; });
    var add = free.map(function (e) {
        return {
            label: e.title,
            action: function () { createFormHandler(entry, e.name, window.FormEdit.handlerName(entry.name, e.name)); }
        };
    });
    var verb = formModuleModel ? 'Создать обработчик' : 'Назначить обработчик';
    if (add.length > 3) out.push({ label: verb + ' события', items: add });
    else add.forEach(function (a) { out.push({ label: verb + ' «' + a.label + '»', action: a.action }); });
    return out;
}

/* Assigns `handler` to the element's event and writes its procedure at the
 * end of the module unless the module already has it; then shows it. */
function createFormHandler(entry, event, handler, kind) {
    if (!formHandlersEditable() || !handler || (event && !entry)) return;
    kind = kind || (entry && entry.item && entry.item.tag) || '';
    var before = model.getValue();
    var out = null;
    if (event) {
        try {
            out = window.FormEdit.setEvent(before, { element: entry.name, event: event, handler: handler });
        } catch (err) {
            showTemplateError((err && err.message) || String(err));
            return;
        }
        if (out && out.xml !== before) {
            applyPreviewEdits(window.DocEdits.textEdits(before, out.xml));
            showTemplateError('');
            refreshDocPreview();
            parseDocOutline();
            renderOutline();
        }
    }
    /* A lone Form.xml has no module: the name is assigned and that is all. */
    if (!formModuleModel) {
        if (formPropertyPanel) formPropertyPanel.refresh();
        syncDirtyMarks();
        applyChrome();
        return;
    }
    if (!findFormHandlerLine(handler)) {
        var text = formModuleModel.getValue();
        var eol = /\r\n/.test(text) ? '\r\n' : '\n';
        var stub = window.FormEdit.handlerStub(kind, event, handler, eol);
        var tail = text && !/\n$/.test(text) ? eol + eol : text ? eol : '';
        var end = formModuleModel.getFullModelRange().getEndPosition();
        formModuleModel.pushStackElement();
        formModuleModel.pushEditOperations([], [{
            range: new monaco.Range(end.lineNumber, end.column, end.lineNumber, end.column),
            text: tail + stub
        }], function () { return null; });
        formModuleModel.pushStackElement();
        state.moduleDirty = true;
    }
    syncDirtyMarks();
    applyChrome();
    goToFormHandler(handler);
}

function findFormHandlerLine(name) {
    if (!formModuleModel || !name) return 0;
    var escaped = String(name).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (!escaped) return 0;
    var re = new RegExp('^\\s*(?:Асинх\\s+|Async\\s+)?(?:Процедура|Procedure|Функция|Function)\\s+' +
        escaped + '(?![a-zA-Z\\u0410-\\u044F_\\u0401\\u04510-9])', 'i');
    var lines = formModuleModel.getLinesContent();
    for (var i = 0; i < lines.length; i++) {
        if (re.test(lines[i])) return i + 1;
    }
    return 0;
}

/* Rebuilds whichever outline the loaded file has; a no-op for everything else. */
function refreshOutline() {
    if (formModuleOpen()) parseOutline(formModuleModel);
    else if (state.sarifMode && state.sarifSourceLang === 'bsl') parseOutline();
    else if (state.sarifMode) { allItems = []; }
    else if (state.language === 'bsl') parseOutline();
    else if (isDocPreview()) parseDocOutline();
    else return;
    renderOutline();
}

function parseOutline(sourceModel) {
    var outlineModel = sourceModel || model;
    if (!outlineModel) { allItems = []; return; }
    var lines = outlineModel.getLinesContent();
    var procRe = /^\s*(?:Асинх\s+|Async\s+)?(Процедура|Procedure|Функция|Function)\s+([a-zA-Z\u0410-\u044F_\u0401\u0451][a-zA-Z\u0410-\u044F_\u0401\u04510-9]*)/i;
    var regionRe = /^\s*#\s*(Область|Region)\s+(.*)/i;
    var inProc = false;
    var inString = false;
    allItems = [];
    for (var i = 0; i < lines.length; i++) {
        var prevString = inString;
        inString = scanQuoteState(lines[i], inString).inString;
        var word = bslStructureWord(lines[i], prevString);
        if (!word) continue;
        if (inProc) {
            if (FOLD_CLOSE[word] === 'proc') inProc = false;
            continue;
        }
        if (FOLD_OPEN[word] === 'region') {
            var rm = lines[i].match(regionRe);
            if (rm) allItems.push({ type: 'region', name: rm[2].trim(), line: i + 1 });
            continue;
        }
        if (FOLD_OPEN[word] === 'proc') {
            var m = lines[i].match(procRe);
            if (!m) continue;
            var k = m[1].toLowerCase();
            var isF = (k === 'функция' || k === 'function');
            allItems.push({ type: isF ? 'func' : 'proc', name: m[2], line: i + 1 });
            inProc = true;
        }
    }
}

function esc(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* The rows the outline currently shows, in their shown order: data-idx
 * points into this list. */
var shownOutlineItems = [];

/* A provider whose outline is a tree of typed groups (the object window)
 * sorts by name inside each group and keeps the tree. */
function sortKeepsTree() {
    var view = docTree() ? previewView() : null;
    return !!(view && view.outlineSortByName);
}

function renderOutline() {
    if (formOutlineActive())
        allItems = state.outlineKind === 'attributes' ? formAttributeItems : formElementItems;
    var rolesTab = mdTabsActive() && state.outlineKind === 'roles';
    var roleRights = rolesTab && Array.isArray(state.mdRoles) ? MetadataPreview.rightsInOrder(state.mdRoles) : [];
    var ticked = roleRights.filter(function (r) { return state.mdRoleRights[r]; });
    if (mdTabsActive()) {
        /* A role stays when it grants any of the ticked rights. */
        allItems = rolesTab ? (Array.isArray(state.mdRoles) ? MetadataPreview.rolesOutline(state.mdRoles.filter(function (r) {
            return !ticked.length || r.rights.some(function (x) { return state.mdRoleRights[x.name]; });
        })) : []) : formElementItems;
    }
    /* Inspector-only roots can be selected from links in the preview without
     * adding duplicate rows to the visible section tree. Keep them in
     * allItems for property lookup. */
    var items = allItems.filter(function (item) { return !item.inspectorOnly; });
    var sortView = previewView();
    if (state.sortByName && sortKeepsTree()) {
        items = sortView.outlineSortByName(items);
    } else if (state.sortByName) {
        items = items.filter(function (x) { return x.type !== 'region'; })
                     .sort(function (a, b) { return a.name.toLowerCase().localeCompare(b.name.toLowerCase()); });
    }
    shownOutlineItems = items;
    var cnt = 0;
    for (var i = 0; i < items.length; i++) if (items[i].type !== 'region') cnt++;

    var outlineKinds = document.getElementById('outline-kinds');
    outlineKinds.hidden = !formOutlineActive() && !mdTabsActive();
    /* A form has Elements/Attributes, an object Structure/Roles. */
    var objectTabs = mdTabsActive();
    var kindButton = function (kind) { return outlineKinds.querySelector('button[data-outline-kind="' + kind + '"]'); };
    kindButton('elements').textContent = objectTabs ? 'Структура' : 'Элементы';
    kindButton('attributes').hidden = objectTabs;
    kindButton('roles').hidden = !objectTabs;
    var kindButtons = outlineKinds.querySelectorAll('button[data-outline-kind]');
    for (var kb = 0; kb < kindButtons.length; kb++) {
        var kindOn = kindButtons[kb].getAttribute('data-outline-kind') === state.outlineKind;
        kindButtons[kb].classList.toggle('active', kindOn);
        kindButtons[kb].setAttribute('aria-selected', kindOn ? 'true' : 'false');
    }
    state.outlineCountPrefix = rolesTab ? 'Роли' : formOutlineActive()
        ? (state.outlineKind === 'attributes' ? 'Реквизиты' : 'Элементы')
        : (isDocPreview() && !formModuleOpen() ? 'Элементы' : 'Структура');
    state.outlineTotal = cnt;
    document.getElementById('outline-count').textContent = state.outlineCountPrefix + ' (' + cnt
        + (rolesTab && ticked.length ? ' из ' + state.mdRoles.length : '') + ')';
    var sortBtn = document.getElementById('sort-btn');
    var attributeMode = formOutlineActive() && state.outlineKind === 'attributes';
    document.getElementById('outline-fold').hidden = attributeMode;
    document.getElementById('outline-unfold').hidden = attributeMode;
    /* The shell's own pictures, not the platform's: the list follows the
     * document's structure (an indented tree) or is sorted by name (A→Z). */
    setIcon('sort-btn', state.sortByName ? 'sort-letters' : 'outline');
    sortBtn.title = state.sortByName ? 'Сортировка: по имени (нажмите — по порядку)' : 'Сортировка: по порядку (нажмите — по имени)';
    var movingOn = formMovingEnabled();
    var h = [];
    for (var j = 0; j < items.length; j++) {
        var it = items[j];
        if (it.type === 'region') {
            h.push('<div class="region-group">', esc(it.name), '</div>');
        } else if (it.type === 'form') {
            var iconCls = 'icon-form-etc';
            var iconName = 'box';
            var iconCh = '';
            var iconAsset = '';
            var iconSprite = '';
            var ownIcons = previewView();
            if (it.tag === 'TemplateArea') {
                var tic = (window.TemplatePreview && TemplatePreview.outlineIcon)
                    ? TemplatePreview.outlineIcon(it)
                    : { cls: 'icon-form-tbl', ch: 'A' };
                iconCls = tic.cls;
                iconCh = tic.ch;
            } else if ((it.itemKind === 'metadata' || it.itemKind === 'dcs') && ownIcons && ownIcons.outlineIcon) {
                var mic = ownIcons.outlineIcon(it);
                iconCls = mic.cls;
                iconName = mic.icon || 'box';
                iconAsset = mic.asset || '';
                iconCh = mic.ch || '';
                iconSprite = mic.sprite || '';
            } else if (attributeMode && it.itemKind === 'attribute') {
                var aic = (window.FormPreview && FormPreview.attributeIcon)
                    ? FormPreview.attributeIcon(it.typeName)
                    : { cls: 'icon-form-etc', icon: 'box' };
                iconCls = aic.cls;
                iconName = aic.icon || 'box';
                iconCh = aic.ch || '';
                iconAsset = aic.asset || '';
            } else {
                var fic = (window.FormPreview && FormPreview.iconFor)
                    ? FormPreview.iconFor(it.tag)
                    : { cls: 'icon-form-etc', icon: 'box' };
                iconCls = fic.cls;
                iconName = fic.icon || 'box';
                iconAsset = fic.asset || '';
            }
            var pad = 8 + (it.depth || 0) * 12;
            var shown = it.title || it.name;
            var treeOn = docTree() && (!state.sortByName || sortKeepsTree()) && !attributeMode;
            /* Only an element of the form itself is dragged; the rows of the
             * other trees (an object, a template) carry no order to change. */
            var dragOn = movingOn && !attributeMode && it.itemKind !== 'attribute' && !!it.name;
            h.push('<div class="proc-item form-el" data-line="', it.line, '" data-id="', esc(it.id || ''), '"',
                   dragOn ? ' draggable="true"' : '',
                   ' data-kind="', esc(it.itemKind || 'element'),
                   '" data-idx="', j, '" data-name="', esc((it.name + ' ' + (it.title || '') + ' ' + (it.tag || '') +
                       ' ' + (it.dataPath || '')).toLowerCase()),
                   '" style="padding-left:', pad, 'px">');
            if (treeOn && it.hasChildren) {
                var closed = !!(it.id && state.outlineCollapsed[it.id]);
                h.push('<span class="twisty" data-fold="', esc(it.id || ''), '">', closed ? '\u25B8' : '\u25BE', '</span>');
            } else if (treeOn) {
                h.push('<span class="twisty-ph"></span>');
            }
            /* A frame of a picture strip, positioned by the provider's style. */
            if (iconSprite) h.push('<span class="outline-sprite ', iconCls, '" style="', esc(iconSprite), '"></span>');
            else if (iconCh) h.push('<span class="icon ', iconCls, '">', iconCh, '</span>');
            else if (iconAsset) h.push('<img class="tb-icon outline-icon platform-icon ', iconCls, '" src="', iconAsset, '" alt="">');
            else h.push('<svg class="tb-icon outline-icon ', iconCls, '"><use href="#i-', iconName, '"></use></svg>');
            h.push('<span class="name">', esc(shown), '</span>');
            if (it.title && it.name && it.title !== it.name)
                h.push('<span class="name-sub">', esc(it.name), '</span>');
            else if (it.itemKind === 'metadata' && it.typeName)
                h.push('<span class="name-sub">', esc(it.typeName), '</span>');
            h.push('<span class="line-num">', it.line, '</span>');
            if (!attributeMode && it.outlineIndex != null && formElementItems[it.outlineIndex] === it) {
                var path = formElementPath(it.outlineIndex).map(formElementLabel).join(' \u203A ');
                h.push('<span class="name-path" title="', esc(path), '">', esc(path), '</span>');
            }
            h.push('</div>');
        } else {
            h.push('<div class="proc-item" data-line="', it.line, '" data-name="', esc(it.name.toLowerCase()), '">',
                   '<span class="icon ', (it.type === 'func' ? 'icon-func">F' : 'icon-proc">P'), '</span>',
                   '<span class="name">', esc(it.name), '</span>',
                   '<span class="line-num">', it.line, '</span>');
            var usages = formModuleOpen() ? formHandlers[it.name.toLowerCase()] : null;
            if (usages && usages.length) {
                h.push('<span class="handler-usages">');
                for (var u = 0; u < usages.length; u++) {
                    var usageText = usages[u].label + ' \u00B7 ' + usages[u].event;
                    if (u) h.push('<span class="handler-sep">, </span>');
                    if (usages[u].id)
                        h.push('<a href="#" class="handler-usage" data-usage-id="', esc(usages[u].id),
                            '" title="Показать элемент на форме">', esc(usageText), '</a>');
                    else
                        h.push('<span class="handler-usage-form">', esc(usageText), '</span>');
                }
                h.push('</span>');
            }
            h.push('</div>');
        }
    }
    if (rolesTab && !items.length) {
        h = ['<div class="outline-note">', state.mdRoles === 'loading' ? 'Поиск ролей по конфигурации…'
            : state.mdRoles === 'failed' ? 'Не удалось прочитать роли конфигурации'
            : ticked.length ? 'Нет ролей с отмеченными правами' : 'Нет ролей с правами на объект', '</div>'];
    }
    if (roleRights.length) {
        var rf = ['<details class="roles-filter"', state.mdRoleFilterOpen ? ' open' : '', '><summary>Права',
            ticked.length ? ' <span class="roles-filter-count">(' + ticked.length + ')</span>' : '',
            '<button type="button" id="roles-filter-clear"', ticked.length ? '' : ' disabled',
            ' title="Снять все флажки">Сбросить</button></summary><div class="roles-filter-list">'];
        for (var rr = 0; rr < roleRights.length; rr++) {
            rf.push('<label><input type="checkbox" data-right="', esc(roleRights[rr]), '"',
                state.mdRoleRights[roleRights[rr]] ? ' checked' : '', '>',
                esc(MetadataPreview.rightTitle(roleRights[rr])), '</label>');
        }
        rf.push('</div></details>');
        h = rf.concat(h);
    }
    document.getElementById('outline-list').innerHTML = h.join('');
    applyFilter();
    if (formOutlineActive() && state.outlineKind === 'attributes' && state.selectedAttributeId)
        highlightOutlineRow(state.selectedAttributeId);
    else if (isDocPreview() && state.formSelectedId) highlightFormOutline(state.formSelectedId);
    syncFormMoveButtons();
    renderPropertyInspector();
}

function applyFilter() {
    var v = document.getElementById('outline-filter').value.toLowerCase();
    document.getElementById('filter-clear').style.display = v ? 'block' : 'none';
    var filtering = !!v;
    var treeView = (docTree() && (!state.sortByName || sortKeepsTree()) && !filtering) ? previewView() : null;
    var foldOn = !!(treeView && treeView.outlineHidden);
    var list = document.getElementById('outline-list');
    list.classList.toggle('flat', filtering || (!!state.sortByName && !sortKeepsTree()));
    var ps = list.querySelectorAll('.proc-item');
    var matched = 0;
    for (var k = 0; k < ps.length; k++) {
        var match = !v || (ps[k].getAttribute('data-name') || '').indexOf(v) >= 0;
        if (match) matched++;
        var hidden = false;
        if (foldOn && ps[k].classList.contains('form-el')) {
            var idx = parseInt(ps[k].getAttribute('data-idx'), 10);
            hidden = treeView.outlineHidden(shownOutlineItems, idx, state.outlineCollapsed);
        }
        ps[k].style.display = (match && !hidden) ? '' : 'none';
    }
    if (state.outlineCountPrefix) {
        document.getElementById('outline-count').textContent = state.outlineCountPrefix + ' (' +
            (filtering ? matched + ' из ' + state.outlineTotal : state.outlineTotal) + ')';
    }
}

// ----------------------------------------------------------------- chrome

function applyTheme() {
    var dk = uiIsDark();
    var name = dk ? 'bsl-dark' : 'bsl-light';
    document.documentElement.className = dk ? 'theme-dark' : 'theme-light';
    /* Bounce through the built-in theme so Monaco rebuilds its token
     * stylesheet from a known base before our colours replace it. Skip the
     * bounce on the very first paint: create() already used `name`, and an
     * extra vs-dark flash reads as a black screen. */
    if (editor && editor.__bslThemeApplied) {
        monaco.editor.setTheme(dk ? 'vs-dark' : 'vs');
    }
    monaco.editor.setTheme(name);
    if (editor) {
        editor.__bslThemeApplied = true;
        editor.render(true);
    }
    applyChrome();
    applyPreviewTheme();
    applyPreviewEditable();
    send({ cmd: 'theme', dark: !!state.isDark });
}

/* The panel button reads as pressed while the side panel is shown. */
function syncOutlineToggle() {
    var button = document.getElementById('outline-toggle');
    var panel = document.getElementById('outline-panel');
    if (!button || !panel) return;
    var shown = panel.style.display !== 'none';
    button.classList.toggle('active', shown);
    button.setAttribute('aria-pressed', shown ? 'true' : 'false');
    button.title = button.disabled ? 'У этого файла нет структуры'
        : (shown ? 'Скрыть панель: ' : 'Показать панель: ')
        + (button.getAttribute('data-panel-title') || 'структура');
}

function setIcon(id, name) {
    var svg = document.querySelector('#' + id + ' svg');
    if (!svg) svg = document.querySelector('#' + id + '.tb-btn');
    var use = svg ? svg.querySelector('use') : null;
    /* Every button of the toolbar wears the viewer's own icon set: the
     * platform's own pictures stay where they mean something (the kinds of
     * objects in the outline), not in the chrome around them. */
    if (!svg) return;
    if (use) use.setAttribute('href', '#i-' + name);
}

function applyChrome() {
    var dk = uiIsDark();
    var outlinePanel = document.getElementById('outline-panel');
    var outlineToggle = document.getElementById('outline-toggle');
    var chromeLang = state.sarifMode && state.sarifSourceLang ? state.sarifSourceLang : state.language;
    var isBsl = isBslModule(chromeLang);
    var isCode = isBslFamily(chromeLang);
    var formOpen = formPreviewOpen();
    var moduleOpen = formModuleOpen();

    outlinePanel.className = dk ? 'dark' : 'light';
    var pv = currentProvider();
    var tree = docTree();
    /* The right edge of the bar holds buttons that never leave it, greyed out
     * when a document has no use for them: whatever comes and goes per
     * document sits further in, so the edge does not slide under the cursor. */
    outlineToggle.disabled = !(isBsl || pv || moduleOpen);
    outlinePanel.style.display = (isBsl || pv || moduleOpen) ? 'flex' : 'none';
    var panelTitle = moduleOpen ? 'Список процедур/функций' : (pv ? pv.outlineTitle : 'Список процедур/функций');
    outlineToggle.setAttribute('data-panel-title', panelTitle.charAt(0).toLowerCase() + panelTitle.slice(1));
    syncOutlineToggle();
    document.getElementById('outline-fold').style.display = (isBsl || tree || moduleOpen) ? '' : 'none';
    document.getElementById('outline-unfold').style.display = (isBsl || tree || moduleOpen) ? '' : 'none';
    document.getElementById('outline-fold').title = tree ? 'Свернуть все группы' : 'Свернуть все процедуры и области';
    document.getElementById('outline-unfold').title = tree ? 'Развернуть все группы' : 'Развернуть все процедуры и области';

    var ot = document.getElementById('outline-top');
    ot.classList.remove('dark', 'light');
    ot.classList.add(dk ? 'dark' : 'light');

    setIcon('btn-theme', dk ? 'sun' : 'moon');
    document.getElementById('btn-theme').title = formOpen ? 'У макета формы всегда светлая тема' : 'Переключить тему';
    document.getElementById('btn-theme').disabled = formOpen;

    var mapBtn = document.getElementById('btn-minimap');
    mapBtn.classList.toggle('active', !!state.minimap);
    mapBtn.title = state.minimap ? 'Скрыть карту кода' : 'Показать карту кода';

    var btnEdit = document.getElementById('btn-edit');
    var btnSave = document.getElementById('btn-save');
    setIcon('btn-edit', state.isEditing ? 'eye' : 'pencil');
    btnEdit.title = state.isEditing ? 'Режим просмотра (Ctrl+E)' : 'Редактировать (Ctrl+E)';
    /* The eye and the pencil already say which mode is on: the highlight of
     * the panel toggles beside it would claim this button opens a panel. */
    /* Editing is about source: a form, template or object window shown as a
     * picture has nothing to toggle (the form's Module tab does). */
    btnEdit.style.display = state.sarifMode
        || (state.previewMode && isDocPreview() && !formModuleOpen() && !previewEditable())
        ? 'none' : '';
    var saveAvailable = sourceEditingActive() || previewEditingActive();
    btnSave.style.display = '';
    btnSave.disabled = !saveAvailable;
    syncUndoButtons();
    syncDirtyMarks();
    var editingToolbar = document.getElementById('editor-toolbar');
    if (editingToolbar) editingToolbar.hidden = !(sourceEditingActive() || previewEditingActive());
    var codeEditing = sourceEditingActive() && monacoVisible() && !state.readOnly && !state.sarifMode;
    var codeCommands = document.querySelectorAll('#editor-toolbar .code-edit-only');
    for (var ci = 0; ci < codeCommands.length; ci++)
        codeCommands[ci].style.display = codeEditing ? '' : 'none';
    document.getElementById('btn-format').style.display = (!state.sarifMode && state.isEditing && (isBsl || moduleOpen)) ? '' : 'none';
    document.getElementById('btn-comment').style.display = (!state.sarifMode && state.isEditing && (isCode || moduleOpen)) ? '' : 'none';
    document.getElementById('btn-string-bar').style.display = (codeEditing && (isBslFamily() || moduleOpen)) ? '' : 'none';

    var commitBtn = document.getElementById('btn-commit');
    if (commitBtn) {
        var commitInfo = gitState.info[gitTargetKey()];
        commitBtn.style.display = !state.sarifMode && gitAvailable() && commitInfo && commitInfo.ok ? '' : 'none';
    }
    var diffBtn = document.getElementById('btn-diff');
    if (diffBtn) {
        diffBtn.style.display = (diffAvailable() || diffOpen) ? '' : 'none';
        diffBtn.classList.toggle('active', diffOpen);
        diffBtn.setAttribute('aria-pressed', diffOpen ? 'true' : 'false');
        diffBtn.title = (diffOpen ? 'Скрыть изменения' : 'Показать изменения') + ' (Alt+Shift+D)';
        if (diffOpen) syncDiffControls();
    }
    var wsBtn = document.getElementById('btn-whitespace');
    if (wsBtn) {
        wsBtn.style.display = monacoVisible() ? '' : 'none';
        wsBtn.classList.toggle('active', !!state.whitespace);
        wsBtn.setAttribute('aria-pressed', state.whitespace ? 'true' : 'false');
        wsBtn.title = (state.whitespace ? 'Скрыть' : 'Показать')
            + ' непечатаемые символы (Alt+Shift+W)';
    }
    /* Сохранение переписывает baseline, поэтому открытое сравнение
     * перечитывается здесь, а не только при открытии панели. */
    if (diffOpen) refreshDiffPanel();

    setIcon('btn-preview', state.previewMode ? 'code' : 'window');
    var canPreview = canPreviewLang();
    /* У markdown и HTML расположений три, и их выбирает группа кнопок:
     * одна кнопка-переключатель рядом с ней означала бы то же самое дважды. */
    document.getElementById('btn-preview').style.display =
        (canPreview && !textLayoutAvailable()) ? '' : 'none';
    syncTextLayoutButtons();
    mapBtn.style.display = minimapButtonVisible() ? '' : 'none';

    var back = document.getElementById('btn-back');
    var forward = document.getElementById('btn-forward');
    /* The navigation buttons keep their places in the right toolbar whatever
     * the document: a step up must not slide another button under the cursor. */
    var navToolbar = document.getElementById('nav-toolbar');
    if (navToolbar) navToolbar.hidden = !host;
    var navSaveToolbar = document.getElementById('nav-save-toolbar');
    var navSaveSep = document.getElementById('nav-save-sep');
    var hasNavSaveActions = !!((navToolbar && !navToolbar.hidden) || saveAvailable);
    if (navSaveToolbar) navSaveToolbar.hidden = !hasNavSaveActions;
    if (navSaveSep) navSaveSep.hidden = !hasNavSaveActions;
    if (back && forward) {
        back.disabled = !navHistory.length;
        forward.disabled = !navForward.length;
        back.title = navHistory.length ? 'Назад: ' + navLabel(navHistory[navHistory.length - 1].path) + ' (Alt+←)' : 'Назад';
        forward.title = navForward.length ? 'Вперёд: ' + navLabel(navForward[navForward.length - 1].path) + ' (Alt+→)' : 'Вперёд';
    }
    var historyBtn = document.getElementById('btn-nav-history');
    if (historyBtn) historyBtn.disabled = !navHistory.length && !navForward.length;
    var up = document.getElementById('btn-up');
    if (up) {
        up.disabled = !upTarget.path;
        up.title = upTarget.path ? 'Уровень вверх: ' + navLabel(upTarget.path)
            + ' (Alt+\u2191, Backspace в режиме просмотра)' : 'Уровень вверх';
    }
    var epfBtn = document.getElementById('btn-epf');
    if (epfBtn) epfBtn.style.display = state.epfRoot && host ? '' : 'none';
    var screenshotActions = document.getElementById('form-preview-actions');
    if (screenshotActions) {
        screenshotActions.hidden = !(formPreviewOpen() && isFormView()
            && !document.documentElement.classList.contains('screenshot-mode'));
    }
    syncFormInterfaceModeMenu();
    syncFormContextProgress();
    if (annotationSessionActive() !== (annotationRevision !== null)) syncSessionAnnotations();
}

function minimapButtonVisible() {
    var provider = currentProvider();
    return state.formWorkbenchView !== 'module' && !(provider && state.previewMode && !provider.keepsEditor);
}

function toggleMinimap() {
    state.minimap = !state.minimap;
    writeStoredBool('bsl.minimap', state.minimap);
    if (editor) editor.updateOptions({ minimap: { enabled: !state.bigFile && !!state.minimap } });
    applyChrome();
}

// --------------------------- расположение исходника и просмотра (md, html)

/* Markdown и HTML показываются двумя окнами, и какие из них нужны — решает
 * читатель: правит он текст, сверяет с готовым видом или только читает.
 * Формы и макеты сюда не входят: там рисунок и есть документ, и выбор между
 * ним и XML делает отдельная кнопка. */
function textLayoutAvailable() {
    return !state.sarifMode && !isDocPreview()
        && (state.language === 'markdown' || state.language === 'html');
}

/* Что показано сейчас. previewMode остаётся главным признаком «превью
 * поднято», а textLayout говорит, делит ли оно окно с исходником. */
function currentTextLayout() {
    if (!state.previewMode) return 'source';
    return state.textLayout === 'preview' ? 'preview' : 'split';
}

/* Показать или спрятать редактор рядом с превью. Ширину не трогаем: её мог
 * задать пользователь разделителем, и возврат к «исходник и просмотр» должен
 * вернуть именно его пропорции. */
function applyTextPreviewLayout() {
    if (!textLayoutAvailable() || !state.previewMode) return;
    var full = state.textLayout === 'preview';
    document.getElementById('editor').style.display = full ? 'none' : '';
    document.getElementById('preview-handle').style.display = full ? 'none' : 'block';
}

function setTextPreviewLayout(layout) {
    if (!textLayoutAvailable()) return;
    if (layout !== 'source' && layout !== 'preview') layout = 'split';
    var was = currentTextLayout();
    state.textLayout = layout;
    writeStoredText('bsl.textLayout', layout);
    if (layout === 'source') { setPreviewMode(false); return; }
    /* Поднять превью впервые — это перестроить окно целиком; переложить уже
     * поднятое — только спрятать или вернуть редактор. */
    if (was === 'source') { setPreviewMode(true); return; }
    applyTextPreviewLayout();
    applyChrome();
    if (editor) editor.layout();
}

function syncTextLayoutButtons() {
    var group = document.getElementById('md-layout');
    if (!group) return;
    var available = textLayoutAvailable();
    group.hidden = !available;
    var separator = document.getElementById('md-layout-sep');
    if (separator) separator.hidden = !available;
    if (!available) return;
    var now = currentTextLayout();
    group.querySelectorAll('button[data-md-layout]').forEach(function (button) {
        var on = button.getAttribute('data-md-layout') === now;
        button.classList.toggle('active', on);
        button.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
}

/* Monaco показан, а не заменён рисующим превью: вкладка модуля формы — это
 * снова редактор, чем бы ни был сам документ. */
function monacoVisible() {
    if (formModuleOpen()) return true;
    var provider = currentProvider();
    return !(provider && state.previewMode && !provider.keepsEditor);
}

/* Пробелы, табуляции и управляющие символы. Настройка общая для редактора и
 * панели сравнения: непечатаемые символы ищут как раз в том, что изменилось. */
/* Непечатаемые символы рисует Monaco: точка вместо пробела, стрелка вместо
 * табуляции — как в конфигураторе 1С.
 *
 * `experimentalWhitespaceRendering: 'font'` обязателен. По умолчанию Monaco
 * выбирает 'svg', и в нашей сборке этот путь не рисует ничего: слой с
 * отметками не появляется вовсе, сколько бы ни стоял renderWhitespace:'all'.
 * Режим 'font' кладёт каждый символ отдельным <div class="mwh">, и отметки
 * видно. Цвет берётся из темы (editorWhitespace.foreground). */
function whitespaceRenderOptions() {
    return {
        renderWhitespace: state.whitespace ? 'all' : 'none',
        renderControlCharacters: !!state.whitespace,
        experimentalWhitespaceRendering: 'font'
    };
}

function toggleWhitespace() {
    state.whitespace = !state.whitespace;
    writeStoredBool('bsl.whitespace', state.whitespace);
    if (editor) editor.updateOptions(whitespaceRenderOptions());
    if (diffEditor) diffEditor.updateOptions(whitespaceRenderOptions());
    applyChrome();
}

// ------------------------------------------- изменения против файла на диске

/* Ревизии git как эталон сравнения.
 *
 * Хост умеет спросить git о файле («gitInfo»: где он лежит в репозитории, на
 * какой ветке, какие коммиты его меняли) и выдать его содержимое на
 * выбранной ревизии («gitShow»). Здесь только выбор эталона и кэш уже полученных ревизий:
 * запускать git и ходить в файловую систему странице нечем. */
/* base: 'disk' — файл на диске, 'index' — индекс git, иначе имя ревизии.
 * info: ответ «gitInfo» по каждой цели.
 * blobs: 'file|<rev>' -> { ok, text }, { ok:false, error } или 'pending'. */
var gitState = { base: 'disk', info: { file: null, module: null }, blobs: {} };
var gitPending = {};
var gitReqSeq = 0;
/* Чем занята левая сторона панели прямо сейчас: ждём git или он отказал. */
var diffBaseState = { pending: false, error: '' };

function gitAvailable() { return !!host; }

/* Без оболочки (просто страница в браузере) ни диска, ни git нет: эталоном
 * служит текст, каким его открыли или последний раз сохранили. */
var NO_HOST_ERROR = 'нет связи с оболочкой';
function diffWithoutHost() {
    if (host) return false;
    var info = gitState.info[gitTargetKey()];
    return !!(info && !info.ok && info.error === NO_HOST_ERROR);
}

function gitSend(msg, done) {
    if (!host) return;
    var id = String(++gitReqSeq);
    gitPending[id] = done;
    msg.reqId = id;
    send(msg);
}

function onGitMessage(d) {
    var id = String((d && d.reqId) || '');
    var done = gitPending[id];
    delete gitPending[id];
    if (done) done(d);
}

/* Цель сравнения в терминах хоста: у модуля формы своя история в git. */
function gitTargetKey() {
    var target = diffTarget();
    return target ? target.key : 'file';
}

/* Спросить git заново. Делается и при загрузке файла — от ответа зависит,
 * показывать ли кнопку сравнения, когда файл только смотрят, — и при каждом
 * открытии панели: список коммитов мог пополниться, пока файл был открыт.
 * Индекс тоже мог измениться, поэтому его копию забываем. */
function requestGitInfo(key) {
    if (!host) {
        gitState.info[key] = { ok: false, error: NO_HOST_ERROR };
        return;
    }
    delete gitState.blobs[key + '|'];
    gitSend({ cmd: 'gitInfo', target: key }, function (d) {
        gitState.info[key] = d && d.ok ? d : { ok: false, error: (d && d.error) || 'git недоступен' };
        if (key !== gitTargetKey()) return;
        syncDiffBase();
        if (diffOpen) refreshDiffPanel();
        /* Ответ git решает, показывать ли кнопку вне режима правки. */
        applyChrome();
    });
}

function requestGitBlob(key, rev) {
    var cacheKey = key + '|' + rev;
    if (gitState.blobs[cacheKey] === 'pending') return;
    gitState.blobs[cacheKey] = 'pending';
    gitSend({ cmd: 'gitShow', target: key, rev: rev }, function (d) {
        gitState.blobs[cacheKey] = d && d.ok
            ? { ok: true, text: String(d.content == null ? '' : d.content) }
            : { ok: false, error: (d && d.error) || 'git не отдал эту ревизию' };
        /* Ревизия без файла уходит из списка, выбор переходит на соседнюю. */
        if (!gitState.blobs[cacheKey].ok) syncDiffBase();
        if (diffOpen) refreshDiffPanel();
    });
}

/* Имя выбранной ревизии для git: индекс — это пустая строка. */
function gitBaseRev() { return gitState.base === 'index' ? '' : gitState.base; }

/* Как называется левая сторона панели. Падежей два: «Слева — файл на диске»
 * и «отличий от файла на диске нет», и подставить один вместо другого —
 * значит написать не по-русски. */
function gitBaseLabel(genitive) {
    if (gitState.base === 'disk' && diffWithoutHost())
        return genitive ? 'загруженной версии' : 'загруженная версия';
    if (gitState.base === 'disk') return genitive ? 'файла на диске' : 'файл на диске';
    if (gitState.base === 'index') return genitive ? 'индекса git' : 'индекс git';
    var info = gitState.info[gitTargetKey()];
    var list = (info && info.revisions) || [];
    for (var i = 0; i < list.length; i++) {
        if (list[i].id !== gitState.base) continue;
        if (genitive) return 'ревизии ' + list[i].short;
        var where = list[i].ref ? ' (' + list[i].ref + ', ' + list[i].date + ')'
                                : ' (' + list[i].date + ')';
        return 'ревизия ' + list[i].short + where + ' — ' + list[i].subject;
    }
    return (genitive ? 'ревизии ' : 'ревизия ') + gitState.base;
}

/* Строка коммита в списке: идентификатор, ветка, дата, заголовок. Колонки
 * выровнены пробелами, а список набран моноширинным шрифтом (#diff-base в
 * viewer.css): в <select> иначе колонок не сделать. */
var GIT_COLUMNS = { id: 8, ref: 22, date: 11 };

function padColumn(text, width) {
    var value = String(text == null ? '' : text);
    if (value.length > width - 1) value = value.slice(0, width - 2) + '…';
    while (value.length < width) value += '\u00a0';
    return value;
}

function gitRevisionLabel(rev) {
    var subject = rev.subject || '';
    if (subject.length > 60) subject = subject.slice(0, 59) + '…';
    return padColumn(rev.short, GIT_COLUMNS.id)
         + padColumn(rev.ref, GIT_COLUMNS.ref)
         + padColumn(rev.date, GIT_COLUMNS.date)
         + subject;
}

/* Заголовок колонок коммитов. Ширины те же, что у самих строк, поэтому
 * подписи стоят над своими колонками. */
function gitColumnsHeader() {
    return padColumn('ид', GIT_COLUMNS.id)
         + padColumn('ветка', GIT_COLUMNS.ref)
         + padColumn('дата', GIT_COLUMNS.date)
         + 'комментарий';
}

/* Правка идёт либо в исходнике, либо в рисунке превью. Вне правки сравнивать
 * с файлом на диске нечего: на экране он и есть. */
function diffEditingActive() {
    return !!(sourceEditingActive() || previewEditingActive());
}

/* Не сохранены ли правки той цели, которую сравниваем: у модуля формы своя
 * отметка. Пока правок нет, открытый документ равен файлу на диске. */
function targetDirty() {
    return gitTargetKey() === 'module' ? !!state.moduleDirty : !!state.dirty;
}

/* Совпадает ли ревизия с тем, что на экране: сравнение с ней ничего не
 * покажет. Без правок это отметка хоста; с правками — загруженный текст
 * ревизии (например, после отката всех изменений из сравнения). */
function revisionMatchesScreen(key, rev, clean) {
    if (clean && rev.same) return true;
    var blob = gitState.blobs[key + '|' + rev.id];
    if (!blob || blob === 'pending' || !blob.ok) return false;
    var target = diffTarget();
    if (!target || target.key !== key) return false;
    function norm(t) { return String(t).replace(/^\uFEFF/, '').replace(/\r\n/g, '\n'); }
    return norm(blob.text) === norm(target.model.getValue());
}

/* Есть ли у файла история в git — то есть имеет ли смысл сравнение, когда
 * файл только смотрят и «файла на диске» в списке нет. Ревизии, совпадающие с
 * открытым файлом, не в счёт: сравнение с ними ничего не покажет. */
function gitBaselinesAvailable() {
    var info = gitState.info[gitTargetKey()];
    if (!(info && info.ok && info.tracked)) return false;
    if (targetDirty()) return true;
    if (info.status) return true;
    var list = info.revisions || [];
    for (var i = 0; i < list.length; i++) {
        var blob = gitState.blobs[gitTargetKey() + '|' + list[i].id];
        if (!revisionMatchesScreen(gitTargetKey(), list[i], true) && !(blob && blob !== 'pending' && !blob.ok)) return true;
    }
    return false;
}

/* Список эталонов для выпадающего списка. Он же — признак того, что список
 * пора перестроить: пока он тот же, выбор пользователя трогать нельзя.
 * `group` заводит <optgroup>: коммиты отделены от файла и индекса, а подпись
 * группы служит шапкой колонок. `disabled` — не эталон, а объяснение, почему
 * список пуст: молчащий список ничем не отличается от сломанного. */
function diffBaseOptions() {
    /* Дисковый файл — базовый эталон и без git. Это важно для готовых XML-
     * выгрузок внешних объектов: их часто хранят в обычном каталоге, а не в
     * репозитории, но формы, макеты и модули всё равно нужно сравнивать. */
    /* Без правок файл на диске и есть то, что на экране: пустое сравнение. */
    var key = gitTargetKey();
    if (diffWithoutHost()) return [{ value: 'disk', text: 'загруженной версией' }];
    var out = targetDirty() ? [{ value: 'disk', text: 'файлом на диске' }] : [];
    var info = gitState.info[key];
    if (!info) {
        out.push({ value: '', text: '— git: спрашиваем… —', disabled: true });
        return out;
    }
    if (!info.ok) {
        out.push({ value: '', text: '— git: ' + (info.error || 'недоступен') + ' —', disabled: true });
        return out;
    }
    /* Эталон, совпадающий с тем, что на экране, показал бы пустое сравнение,
     * поэтому в списке его нет. Пока документ не правили, это индекс (когда в
     * нём то же, что в файле) и ревизии, помеченные хостом. Есть несохранённые
     * правки — сравнивать есть с чем со всеми. */
    var clean = !targetDirty();
    if (!(clean && !info.status)) out.push({ value: 'index', text: 'индексом git' });
    var list = info.revisions || [];
    var shown = 0;
    for (var i = 0; i < list.length; i++) {
        if (revisionMatchesScreen(key, list[i], clean)) continue;
        /* git уже ответил, что файла в этой ревизии нет: клик вёл бы в пустоту. */
        var blob = gitState.blobs[key + '|' + list[i].id];
        if (blob && blob !== 'pending' && !blob.ok) continue;
        shown++;
        out.push({ value: list[i].id, text: gitRevisionLabel(list[i]), group: gitColumnsHeader() });
    }
    if (!list.length)
        out.push({ value: '', text: '— git: коммитов этого файла нет —', disabled: true });
    else if (!shown)
        out.push({ value: '', text: '— git: отличий от истории нет —', disabled: true });
    /* Набранная руками ссылка стоит в списке наравне с коммитами. Иначе
     * перестроение списка (ответ git, смена цели) молча сбрасывало бы выбор,
     * а повторный ввод той же ссылки добавлял бы ещё один такой же пункт. */
    var typed = gitState.base;
    if (typed && typed !== 'disk' && typed !== 'index' && typed !== 'ref'
        && !out.some(function (o) { return o.value === typed; }))
        out.push({ value: typed, text: typed });
    out.push({ value: 'ref', text: 'другой ревизией…' });
    return out;
}

function syncDiffBase() {
    var sel = document.getElementById('diff-base');
    if (!sel) return;
    var options = diffBaseOptions();
    /* Строки-объяснения все пустые по value, поэтому в отпечаток идёт их
     * текст: смена причины должна перерисовать список. */
    var stamp = gitTargetKey() + '::' + options.map(function (o) {
        return o.value || o.text;
    }).join(',');
    if (sel.getAttribute('data-stamp') !== stamp) {
        sel.setAttribute('data-stamp', stamp);
        sel.innerHTML = '';
        var group = null;
        for (var i = 0; i < options.length; i++) {
            var option = document.createElement('option');
            option.value = options[i].value;
            option.textContent = options[i].text;
            if (options[i].disabled) option.disabled = true;
            if (!options[i].group) {
                group = null;
                sel.appendChild(option);
                continue;
            }
            if (!group || group.label !== options[i].group) {
                group = document.createElement('optgroup');
                group.label = options[i].group;
                sel.appendChild(group);
            }
            group.appendChild(option);
        }
        /* Список перестроился под другую цель, другую историю или выход из
         * режима правки: выбранного эталона в нём может уже не быть. */
        var known = options.some(function (o) {
            return !o.disabled && o.value === gitState.base;
        });
        if (!known) gitState.base = diffDefaultBase(options);
    }
    sel.value = gitState.base;
    var info = gitState.info[gitTargetKey()];
    sel.title = info && info.ok
        ? 'Ветка ' + (info.branch || '?') + ', файл ' + info.relative
        : (info && info.error) || 'С чем сравнивать текущее состояние';
}

/* Чем сравнивать, когда прежний выбор пропал: файлом на диске в режиме
 * правки, иначе первым, что предлагает git. */
function diffDefaultBase(options) {
    for (var i = 0; i < options.length; i++)
        if (!options[i].disabled && options[i].value && options[i].value !== 'ref')
            return options[i].value;
    return 'disk';
}

/* Ввод произвольной ссылки: ветка, тег или хэш, которых нет в списке. */
function openGitRefInput() {
    var input = document.getElementById('diff-rev');
    if (!input) return;
    input.hidden = false;
    input.value = '';
    input.focus();
}

function closeGitRefInput() {
    var input = document.getElementById('diff-rev');
    if (input) { input.hidden = true; input.value = ''; }
}

function applyGitRef(text) {
    var rev = String(text || '').trim();
    closeGitRefInput();
    if (!rev) { setDiffBase('disk'); return; }
    setDiffBase(rev);
}

function setDiffBase(value) {
    if (value === 'ref') { openGitRefInput(); return; }
    gitState.base = value;
    closeGitRefInput();
    /* Список сам покажет набранную руками ссылку: она входит в
     * diffBaseOptions(), поэтому перестроение её не теряет и не удваивает. */
    syncDiffBase();
    if (diffOpen) refreshDiffPanel();
}

/* Что показывать слева. Пока git не ответил — { pending: true }; если
 * ревизии нет — { error }. Сам запрос уходит отсюда: эталон спрашивают
 * ровно тогда, когда его собираются показать. */
function diffBaseline(target) {
    if (gitState.base === 'disk') return { text: target.baseline || '' };
    var info = gitState.info[target.key];
    if (!info || !info.ok) return { error: (info && info.error) || 'git недоступен' };
    var cacheKey = target.key + '|' + gitBaseRev();
    var blob = gitState.blobs[cacheKey];
    if (blob === undefined) { requestGitBlob(target.key, gitBaseRev()); return { pending: true }; }
    if (blob === 'pending') return { pending: true };
    return blob.ok ? { text: blob.text } : { error: blob.error };
}

/* Сравнение с тем, что лежит на диске: «Форматировать» переписывает весь
 * документ, и до сохранения нужно увидеть, что именно поменялось. Панель
 * накрывает рабочую область и только показывает — правят под ней. */
var diffEditor = null;
var diffOriginalModel = null;
var diffModifiedModel = null;
var diffOpen = false;
/* Что уже показано, чтобы перерисовывать панель только при настоящей
 * перемене, а не на каждый вызов applyChrome. */
var diffShown = { model: null, version: -1, baseline: null };

/* Табличный документ сравнивается не текстом: в Template.xml сдвиг одной
 * строки перенумеровывает весь файл, и построчный diff показывает «изменилось
 * всё». Для макета панель показывает два листа рядом; кнопка в заголовке
 * возвращает обычное текстовое сравнение, когда нужен именно XML. */
var templateDiffView = null;
var templateDiffSummary = '';

/* Что сравнивать: вкладка «Модуль» формы правит собственную модель, всё
 * остальное — сам файл. `key` — та же цель в терминах хоста: он сам знает
 * пути обоих файлов, со страницы путь не приходит. */
function diffTarget() {
    if (formModuleOpen() && formModuleModel)
        return { key: 'module', model: formModuleModel, baseline: moduleBaselineContent,
                 language: 'bsl', title: pathLabel(state.formModulePath) || 'модуль формы' };
    if (!model) return null;
    return { key: 'file', model: model, baseline: baselineContent,
             language: state.language, title: pathLabel(state.filePath) || 'документ' };
}

/* Сравнивать есть смысл и когда правят (с файлом на диске), и когда просто
 * смотрят — если файл лежит в git и есть с какой ревизией сравнить. Отчёт
 * SARIF и панели распаковки — не документы, их сравнивать не с чем. */
/* Макет ли это: сравнение листами есть только у самого файла, у модуля формы
 * своя история и свой текст. */
function templateDiffPossible(target) {
    if (!target || target.key !== 'file') return false;
    if (!window.TemplateDiff || !window.TemplateDiffView || !window.TemplatePreview) return false;
    if (!window.TemplatePreview.detect) return false;
    return window.TemplatePreview.detect(target.model.getValue());
}

/* Листами или текстом — это тот же выбор, что и в самом окне: кнопка
 * «макет/исходник» одна на весь документ, своего переключателя у панели
 * сравнения нет. */
function templateDiffMode(target) {
    return !!state.previewMode && templateDiffPossible(target);
}

/* Управляемая форма тоже сравнивается по модели: перестановка XML-узлов не
 * должна выглядеть как сотни изменённых строк. Исходник остаётся доступен
 * той же кнопкой «форма/исходник», что и в основном окне. */
function formDiffPossible(target) {
    if (!target || target.key !== 'file') return false;
    if (!window.FormDiff || !window.FormDiffView || !window.FormPreview) return false;
    return !!(window.FormPreview.detect && window.FormPreview.detect(target.model.getValue()));
}

function formDiffMode(target) {
    var provider = currentProvider();
    return !!state.previewMode && !!provider && provider.id === 'form' && formDiffPossible(target);
}

/* СКД остаётся одним широким окном: список слева выбирает смысловую правку,
 * а справа показывается обычный редактор СКД с текущей строкой и «было →
 * стало». Два полных окна рядом сделали бы таблицы нечитаемыми. */
function dcsDiffPossible(target) {
    if (!target || target.key !== 'file') return false;
    if (!window.DcsDiff || !window.DcsDiffView || !window.DcsPreview) return false;
    return !!(window.DcsPreview.detect && window.DcsPreview.detect(target.model.getValue()));
}

function dcsDiffMode(target) {
    var provider = currentProvider();
    return !!state.previewMode && !!provider && provider.id === 'dcs' && dcsDiffPossible(target);
}

/* Кнопка есть, только когда сравнение что-то покажет: несохранённые правки
 * (с файлом на диске) или ревизия git, отличная от открытого файла. */
function diffAvailable() {
    if (state.sarifMode || state.language === 'epf' || state.language === 'pack') return false;
    if (!diffTarget()) return false;
    return targetDirty() || gitBaselinesAvailable();
}

/* Вид сравнения выбирает пользователь, и выбор переживает перезапуск.
 * Пробелы по умолчанию видны: форматирование меняет прежде всего отступы. */
var DIFF_SIDE_KEY = 'bslviewer.diff.sideBySide';
var DIFF_WS_KEY = 'bslviewer.diff.ignoreWhitespace';
var diffPrefs = {
    sideBySide: readStoredBool(DIFF_SIDE_KEY, true),
    ignoreWhitespace: readStoredBool(DIFF_WS_KEY, false)
};

function setDiffPref(name, on) {
    diffPrefs[name] = !!on;
    writeStoredBool(name === 'sideBySide' ? DIFF_SIDE_KEY : DIFF_WS_KEY, !!on);
    if (diffEditor) diffEditor.updateOptions(diffEditorOptions());
    syncDiffControls();
}

/* Правка, возвращающая участок правой стороны к левой. Только числа и
 * строки — без Monaco, чтобы её можно было проверить отдельно. change —
 * ILineChange: конец 0 означает, что на этой стороне строк нет и участок
 * стоит после строки start. modLengths — длины строк правой стороны. */
function hunkRestoreEdit(origLines, modLengths, change, eol) {
    var os = change.originalStartLineNumber, oe = change.originalEndLineNumber;
    var ms = change.modifiedStartLineNumber, me = change.modifiedEndLineNumber;
    var seg = oe > 0 ? origLines.slice(os - 1, oe) : [];
    var count = modLengths.length;
    function end(line) { return modLengths[line - 1] + 1; }
    if (me === 0) {
        if (ms === 0) return { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1, text: seg.join(eol) + eol };
        return { startLineNumber: ms, startColumn: end(ms), endLineNumber: ms, endColumn: end(ms), text: eol + seg.join(eol) };
    }
    if (seg.length) return { startLineNumber: ms, startColumn: 1, endLineNumber: me, endColumn: end(me), text: seg.join(eol) };
    if (me < count) return { startLineNumber: ms, startColumn: 1, endLineNumber: me + 1, endColumn: 1, text: '' };
    if (ms > 1) return { startLineNumber: ms - 1, startColumn: end(ms - 1), endLineNumber: me, endColumn: end(me), text: '' };
    return { startLineNumber: 1, startColumn: 1, endLineNumber: me, endColumn: end(me), text: '' };
}

var diffChanges = [];
var diffNav = null;

function diffRestoreAllowed(target) {
    return !!(target && state.isEditing && !state.readOnly && !state.sarifMode
        && !diffBaseState.pending && !diffBaseState.error && !templateDiffView);
}

function currentDiffChange() {
    var cur = diffNav && diffNav.current();
    if (cur && diffChanges.indexOf(cur) >= 0) return cur;
    return diffChanges.length === 1 ? diffChanges[0] : null;
}

function syncDiffControls() {
    var side = document.getElementById('diff-side');
    if (side) {
        side.textContent = diffPrefs.sideBySide ? 'Одной колонкой' : 'Рядом';
        side.setAttribute('aria-pressed', diffPrefs.sideBySide ? 'false' : 'true');
    }
    var ws = document.getElementById('diff-ignore-ws');
    if (ws) ws.checked = diffPrefs.ignoreWhitespace;
    var restore = document.getElementById('diff-restore');
    if (restore) {
        var allowed = diffRestoreAllowed(diffTarget());
        var change = currentDiffChange();
        restore.disabled = !(allowed && change);
        restore.title = !allowed ? 'Вернуть фрагмент можно только в режиме правки'
            : !change ? 'Выберите изменение (F7 / Shift+F7)'
            : 'Заменить выбранный фрагмент справа версией слева';
    }
    if (diffNav) diffNav.refresh();
}

/* Вернуть текущий участок: правится настоящая модель документа (или модуля
 * формы), одним шагом отмены; копию справа перерисует refreshDiffPanel(). */
function restoreDiffHunk() {
    var target = diffTarget();
    var change = currentDiffChange();
    if (!diffRestoreAllowed(target) || !change || !diffOriginalModel) return false;
    var m = target.model;
    if (m.getValue() !== diffModifiedModel.getValue()) return false;
    var lengths = [];
    for (var i = 1; i <= m.getLineCount(); i++) lengths.push(m.getLineMaxColumn(i) - 1);
    var edit = hunkRestoreEdit(diffOriginalModel.getLinesContent(), lengths, change, m.getEOL());
    var range = new monaco.Range(edit.startLineNumber, edit.startColumn, edit.endLineNumber, edit.endColumn);
    m.pushStackElement();
    m.pushEditOperations([], [{ range: range, text: edit.text, forceMoveMarkers: true }], function () { return null; });
    m.pushStackElement();
    if (diffNav) diffNav.setCurrent(null);
    refreshDiffPanel();
    applyChrome();
    return true;
}

function revealDiffChange(change) {
    if (!diffEditor || !change) return;
    var ed = diffEditor.getModifiedEditor();
    var line = Math.max(1, change.modifiedStartLineNumber || 1);
    var last = Math.max(line, change.modifiedEndLineNumber || line);
    ed.revealLinesInCenterIfOutsideViewport(line, last);
    ed.setPosition({ lineNumber: line, column: 1 });
    syncDiffControls();
}

function wireDiffControls() {
    var head = document.querySelector('#diff-panel .diff-head');
    var anchor = document.getElementById('diff-restore');
    if (!head || diffNav || !window.DiffNav) return;
    diffNav = window.DiffNav.navBar(document, {
        items: function () { return diffChanges; },
        onSelect: function (change) { revealDiffChange(change); },
        keyTarget: document.getElementById('diff-panel')
    });
    if (anchor && anchor.parentNode === head) head.insertBefore(diffNav.element, anchor);
    else head.appendChild(diffNav.element);
    var restore = document.getElementById('diff-restore');
    if (restore) restore.addEventListener('click', function () { restoreDiffHunk(); });
    var side = document.getElementById('diff-side');
    if (side) side.addEventListener('click', function () { setDiffPref('sideBySide', !diffPrefs.sideBySide); });
    var ws = document.getElementById('diff-ignore-ws');
    if (ws) ws.addEventListener('change', function () { setDiffPref('ignoreWhitespace', ws.checked); });
    syncDiffControls();
}

function onDiffUpdated() {
    var prev = diffNav ? diffNav.current() : null;
    var prevIndex = prev ? diffChanges.indexOf(prev) : -1;
    diffChanges = (diffEditor && diffEditor.getLineChanges()) || [];
    if (diffNav) diffNav.setCurrent(prevIndex >= 0 && prevIndex < diffChanges.length ? diffChanges[prevIndex] : null);
    syncDiffSummary();
    syncDiffControls();
}

function diffEditorOptions() {
    return {
        theme: uiIsDark() ? 'bsl-dark' : 'bsl-light',
        readOnly: true,
        originalEditable: false,
        renderSideBySide: diffPrefs.sideBySide,
        automaticLayout: true,
        fontSize: state.fontSize,
        fontFamily: "Consolas, 'Courier New', monospace",
        fontLigatures: false,
        /* Extra translate3d layers on .lines-content fight WebView2's compositor. */
        disableLayerHinting: true,
        /* Ради этого кнопка и заведена: форматирование меняет прежде всего
         * отступы, и сравнение не вправе их прятать. */
        ignoreTrimWhitespace: diffPrefs.ignoreWhitespace,
        renderWhitespace: state.whitespace ? 'all' : 'none',
        guides: { indentation: false, highlightActiveIndentation: false },
        renderControlCharacters: !!state.whitespace,
        experimentalWhitespaceRendering: 'font',
        minimap: { enabled: false },
        folding: false,
        scrollBeyondLastLine: false,
        smoothScrolling: false,
        lineNumbers: 'on',
        links: false,
        contextmenu: false,
        unicodeHighlight: { ambiguousCharacters: false, invisibleCharacters: false }
    };
}

function ensureDiffEditor(language) {
    var body = document.getElementById('diff-body');
    if (!body || !window.monaco) return null;
    if (diffEditor) {
        diffEditor.updateOptions(diffEditorOptions());
        return diffEditor;
    }
    diffEditor = monaco.editor.createDiffEditor(body, diffEditorOptions());
    diffOriginalModel = monaco.editor.createModel('', language);
    diffModifiedModel = monaco.editor.createModel('', language);
    diffEditor.setModel({ original: diffOriginalModel, modified: diffModifiedModel });
    wireScrollFixFor(diffEditor.getOriginalEditor());
    wireScrollFixFor(diffEditor.getModifiedEditor());
    diffEditor.onDidUpdateDiff(onDiffUpdated);
    wireDiffControls();
    /* Курсор в правой стороне выбирает участок, на котором стоит. */
    diffEditor.getModifiedEditor().onDidChangeCursorPosition(function (e) {
        var line = e.position.lineNumber;
        for (var i = 0; i < diffChanges.length; i++) {
            var c = diffChanges[i];
            var from = c.modifiedStartLineNumber, to = c.modifiedEndLineNumber || from;
            if (line >= from && line <= Math.max(from, to)) {
                if (diffNav && diffNav.current() !== c) { diffNav.setCurrent(c); syncDiffControls(); }
                return;
            }
        }
    });
    return diffEditor;
}

/* Сколько участков разошлось. Пока Monaco считает, getLineChanges() отдаёт
 * null — тогда в заголовке нечего обещать. */
function syncDiffSummary() {
    var out = document.getElementById('diff-summary');
    if (!out) return;
    if (diffBaseState.pending) { out.textContent = 'читаем ревизию из git…'; return; }
    if (diffBaseState.error) { out.textContent = diffBaseState.error; return; }
    if (templateDiffView || templateDiffSummary) { out.textContent = templateDiffSummary; return; }
    var changes = diffEditor ? diffEditor.getLineChanges() : null;
    if (!changes) { out.textContent = 'сравниваем…'; return; }
    out.textContent = changes.length
        ? 'изменённых участков: ' + changes.length
        : 'отличий от ' + gitBaseLabel(true) + ' нет';
}

function syncDiffLegend() {
    var legend = document.getElementById('diff-legend');
    if (legend) legend.textContent = 'Слева — ' + gitBaseLabel() + ', справа — текущее состояние';
}

/* Два листа рядом вместо текста. Слева — выбранный эталон, справа — то, что
 * открыто; подсветка и список изменений считаются `TemplateDiff`. */
function renderTemplateDiff(target, base) {
    var host = document.getElementById('diff-sheets');
    var body = document.getElementById('diff-body');
    if (!host) return;
    if (body) body.hidden = true;
    host.hidden = false;
    if (templateDiffView && templateDiffView.destroy) templateDiffView.destroy();
    templateDiffView = null;
    host.innerHTML = '';

    function say(text) {
        templateDiffSummary = text;
        var note = document.createElement('div');
        note.className = 'tpd-empty';
        note.textContent = text;
        host.appendChild(note);
        syncDiffSummary();
    }

    if (base.pending) { say('читаем ревизию из git…'); return; }
    if (base.error) { say(base.error); return; }

    var P = window.TemplatePreview;
    var left = P.parse(base.text);
    if (left.error) { say('Эталон не разобрался: ' + left.error); return; }
    var right = P.parse(target.model.getValue());
    if (right.error) { say('Текущий макет не разобрался: ' + right.error); return; }

    var diff = window.TemplateDiff.compare(left.model, right.model);
    if (diff.error) { say(diff.error); return; }
    var renderText = target.model.getValue();
    var canEditDiff = state.isEditing && !state.readOnly && !state.sarifMode
        && target.model === model && state.previewId === 'template';
    function targetsOf(entry, detail) {
        if (detail && detail.targets && detail.targets.length) return detail.targets;
        if (entry && entry.targets && entry.targets.length) return entry.targets;
        if (entry && entry.row != null) return [{ row: entry.row, col: null, leftRow: entry.leftRow }];
        if (entry && entry.col != null) return [{ row: null, col: entry.col, leftCol: entry.leftCol }];
        return [];
    }
    function formatArgs(field, info) {
        var f = info && info.format || {}, args = {};
        if (field === 'font' && info.font) args.font = { face: info.font.faceName, size: info.font.height,
            bold: !!info.font.bold, italic: !!info.font.italic, underline: !!info.font.underline,
            strikeout: !!info.font.strikeout };
        else if (field === 'textColor' || field === 'backColor' || field === 'horizontalAlignment'
            || field === 'verticalAlignment' || field === 'textPlacement') args[field] = f[field] == null ? null : f[field];
        else if (/^border(Left|Top|Right|Bottom)$/.test(field)) {
            var side = field.slice(6).toLowerCase();
            var line = info.borders && info.borders[side];
            args[side + 'Border'] = line ? { style: line.style, width: line.width || 1 } : null;
        }
        return args;
    }
    /* true — откат возможен; строка — почему нет (кнопка выключена с этой
     * причиной); false — у изменения отката нет вовсе. Проверка — тот же
     * пробный прогон TemplateMarkup, что и при нажатии. */
    function canRestoreTemplate(entry, detail) {
        if (!canEditDiff) return false;
        if (target.model.getValue() !== renderText) return 'Макет изменился после сравнения — обновите сравнение';
        if (entry.structural === 'row' || entry.structural === 'column') {
            var count = entry.structural === 'row' ? entry.rowEnd - entry.row + 1 : entry.colEnd - entry.col + 1;
            if (entry.kind === 'added' && entry.side === 'right') {
                try {
                    var removal = entry.structural === 'row'
                        ? window.TemplateMarkup.deleteRows(renderText, { at: entry.row + 1, count: count })
                        : window.TemplateMarkup.deleteColumns(renderText, { at: entry.col + 1, count: count });
                    if (removal.result.removedMerges) return 'Нельзя вернуть: удаление затронет объединения ячеек';
                    if (removal.result.removedDrawings) return 'Нельзя вернуть: удаление затронет рисунки';
                    if (removal.result.removedAreas && removal.result.removedAreas.length)
                        return 'Нельзя вернуть: удаление затронет именованные области';
                    return true;
                } catch (removeError) { return 'Нельзя вернуть: ' + (removeError && removeError.message || removeError); }
            }
            if (entry.kind !== 'removed' || entry.side !== 'left') return false;
            try {
                if (entry.structural === 'row') {
                    var nextRow = null;
                    for (var ri = 0; ri < diff.rows.length; ri++) {
                        var pair = diff.rows[ri];
                        if (pair.kind !== 'removed' && pair.left > entry.rowEnd) { nextRow = pair.right; break; }
                    }
                    var insertRowAt = nextRow == null ? right.model.rows.length : nextRow;
                    window.TemplateMarkup.restoreRows(renderText, base.text,
                        { at: insertRowAt + 1, sourceAt: entry.row + 1, count: count });
                    return true;
                }
                var nextColumn = null;
                for (var ci = 0; ci < diff.columns.length; ci++) {
                    var columnPair = diff.columns[ci];
                    if (columnPair.kind !== 'removed' && columnPair.left > entry.colEnd) { nextColumn = columnPair.right; break; }
                }
                var insertColumnAt = nextColumn == null ? window.TemplatePreview.sheetWidth(right.model) : nextColumn;
                window.TemplateMarkup.restoreColumns(renderText, base.text,
                    { at: insertColumnAt + 1, sourceAt: entry.col + 1, count: count });
                return true;
            } catch (restoreError) {
                return 'Нельзя вернуть без потерь: ' + (restoreError && restoreError.message || restoreError);
            }
        }
        if (!detail) return false;
        if (detail.field === 'width' || detail.field === 'height' || detail.field === 'hidden') {
            var sizeTargets = targetsOf(entry, detail), sizePreview = window.TemplatePreview;
            if (!sizeTargets.length) return false;
            for (var si = 0; si < sizeTargets.length; si++) {
                var st = sizeTargets[si];
                var sr = st.leftRow != null ? st.leftRow : st.row;
                var sc = st.leftCol != null ? st.leftCol : st.col;
                var baseSize = sizePreview.cellSize(left.model, sr == null ? 0 : sr, sc == null ? 0 : sc);
            }
            return true;
        }
        var supported = { font: 1, textColor: 1, backColor: 1, horizontalAlignment: 1,
            verticalAlignment: 1, textPlacement: 1, borderLeft: 1, borderTop: 1,
            borderRight: 1, borderBottom: 1, parameter: 1, text: 1, detail: 1 };
        if (!supported[detail.field]) return false;
        var targets = targetsOf(entry, detail);
        if (!targets.length) return false;
        var P = window.TemplatePreview;
        for (var i = 0; i < targets.length; i++) {
            var t = targets[i];
            var br = t.leftRow != null ? t.leftRow : t.row;
            var bc = t.leftCol != null ? t.leftCol : t.col;
            if (br == null || bc == null) return false;
            var beforeInfo = P.cellInfo(left.model, br, bc);
            if (!beforeInfo) return false;
            if (detail.field === 'parameter' && beforeInfo.fillType !== 'Parameter') return false;
            if (detail.field === 'text' && beforeInfo.fillType !== 'Text' && beforeInfo.fillType !== 'Template') return false;
            if (detail.field !== 'parameter' && detail.field !== 'text' && detail.field !== 'detail'
                && !Object.keys(formatArgs(detail.field, beforeInfo)).length) return false;
        }
        return true;
    }
    function restoreTemplate(entry, detail) {
        var verdict = canRestoreTemplate(entry, detail);
        if (verdict !== true) {
            if (typeof verdict === 'string') showTemplateNote(verdict);
            return;
        }
        var before = target.model.getValue(), xml = before, result;
        try {
            if (entry.structural === 'row') {
                if (entry.kind === 'added') result = window.TemplateMarkup.deleteRows(xml,
                    { at: entry.row + 1, count: entry.rowEnd - entry.row + 1 });
                else {
                    var rowAt = null;
                    for (var ri = 0; ri < diff.rows.length; ri++) {
                        var rowPair = diff.rows[ri];
                        if (rowPair.kind !== 'removed' && rowPair.left > entry.rowEnd) { rowAt = rowPair.right; break; }
                    }
                    if (rowAt == null) rowAt = right.model.rows.length;
                    result = window.TemplateMarkup.restoreRows(xml, base.text,
                        { at: rowAt + 1, sourceAt: entry.row + 1, count: entry.rowEnd - entry.row + 1 });
                }
                xml = result.xml;
            } else if (entry.structural === 'column') {
                if (entry.kind === 'added') result = window.TemplateMarkup.deleteColumns(xml,
                    { at: entry.col + 1, count: entry.colEnd - entry.col + 1 });
                else {
                    var columnAt = null;
                    for (var ci = 0; ci < diff.columns.length; ci++) {
                        var columnPair = diff.columns[ci];
                        if (columnPair.kind !== 'removed' && columnPair.left > entry.colEnd) { columnAt = columnPair.right; break; }
                    }
                    if (columnAt == null) columnAt = window.TemplatePreview.sheetWidth(right.model);
                    result = window.TemplateMarkup.restoreColumns(xml, base.text,
                        { at: columnAt + 1, sourceAt: entry.col + 1, count: entry.colEnd - entry.col + 1 });
                }
                xml = result.xml;
            } else {
                var P = window.TemplatePreview, targets = targetsOf(entry, detail);
                for (var i = 0; i < targets.length; i++) {
                    var t = targets[i];
                    var r = t.row != null ? t.row : t.leftRow;
                    var c = t.col != null ? t.col : t.leftCol;
                    var br = t.leftRow != null ? t.leftRow : t.row;
                    var bc = t.leftCol != null ? t.leftCol : t.col;
                    if (detail.field === 'width' || detail.field === 'height' || detail.field === 'hidden') {
                        var baseSize = P.cellSize(left.model, br == null ? 0 : br, bc == null ? 0 : bc);
                        var sizeArgs = detail.field === 'width'
                            ? { column: c + 1, width: baseSize.width || 0 }
                            : detail.field === 'height'
                                ? { row: r + 1, height: baseSize.height || 0 }
                                : c != null ? { column: c + 1, hidden: baseSize.hidden }
                                    : { row: r + 1, hidden: baseSize.hidden };
                        result = window.TemplateMarkup.setSize(xml, sizeArgs);
                    } else if (detail.field === 'parameter' || detail.field === 'text' || detail.field === 'detail') {
                        var baseCell = P.cellInfo(left.model, br, bc).cell || {};
                        var contentArgs = { row: r + 1, column: c + 1 };
                        if (detail.field === 'parameter') contentArgs.name = baseCell.parameter || '';
                        else if (detail.field === 'detail') contentArgs.detail = baseCell.detailParameter || '';
                        else if (P.cellInfo(left.model, br, bc).fillType === 'Template') contentArgs.template = baseCell.text || '';
                        else contentArgs.text = baseCell.text || '';
                        result = window.TemplateMarkup.setParameter(xml, contentArgs);
                    } else {
                        var info = P.cellInfo(left.model, br, bc), format = formatArgs(detail.field, info);
                        format.row = r + 1; format.column = c + 1;
                        result = window.TemplateMarkup.setFormat(xml, format);
                    }
                    xml = result.xml;
                }
            }
            if (xml !== before) {
                applyPreviewEdits(window.DocEdits.textEdits(before, xml));
                refreshDocPreview();
                refreshDiffPanel();
            }
        } catch (err) { showTemplateNote('Откат не выполнен: ' + (err && err.message || err)); }
    }
    templateDiffView = window.TemplateDiffView.render(document, host, {
        left: { model: left.model, label: gitBaseLabel() },
        right: { model: right.model, label: 'текущее состояние' },
        diff: diff,
        canRestore: canRestoreTemplate,
        onRestore: restoreTemplate,
        onShowXml: showXmlDiff
    });
    var counted = (templateDiffView && templateDiffView.entries) ? templateDiffView.entries.length : 0;
    templateDiffSummary = counted
        ? 'изменений: ' + counted
        : 'отличий от ' + gitBaseLabel(true) + ' нет';
    syncDiffSummary();
}

/* Сводка формы вместо построчного XML: сущности сопоставляются по имени,
 * поэтому перемещение или одно свойство остаётся одной читаемой правкой. */
/* Модуль формы для вкладки «Модуль» того же сравнения: та же выбранная
 * ревизия, но своя цель git. null — у формы нет модуля. */
function formModuleDiffSide() {
    if (!formModuleModel || !state.formModulePath) return null;
    var base = diffBaseline({ key: 'module', model: formModuleModel, baseline: moduleBaselineContent });
    return { text: base.pending || base.error ? null : base.text, pending: !!base.pending,
        error: base.error || '', current: formModuleModel.getValue() };
}

function renderFormDiff(target, base) {
    var host = document.getElementById('diff-sheets');
    var body = document.getElementById('diff-body');
    if (!host) return;
    if (body) body.hidden = true;
    host.hidden = false;
    if (templateDiffView && templateDiffView.destroy) templateDiffView.destroy();
    templateDiffView = null;
    host.innerHTML = '';
    function say(text) {
        templateDiffSummary = text;
        var note = document.createElement('div');
        note.className = 'fpd-empty'; note.textContent = text; host.appendChild(note);
        syncDiffSummary();
    }
    if (base.pending) { say('читаем ревизию из git…'); return; }
    if (base.error) { say(base.error); return; }
    var currentText = target.model.getValue();
    var moduleSide = formModuleDiffSide();
    var diff = window.FormDiff.compareXml(base.text, currentText, moduleSide && moduleSide.text != null
        ? { moduleBefore: moduleSide.text, moduleAfter: moduleSide.current } : null);
    if (diff.error) { say(diff.error); return; }
    var renderText = currentText;
    var canEditDiff = state.isEditing && !state.readOnly && !state.sarifMode
        && target.model === model && state.previewId === 'form';
    function safeFormProperty(change) {
        return !!(change && /^[A-Za-z][A-Za-z0-9]*$/.test(change.property)
            && ['Вид', 'Родитель', 'Страница'].indexOf(change.property) < 0);
    }
    function canRestoreForm(entry, change) {
        return canEditDiff && entry && entry.kind === 'changed' && entry.type !== 'order'
            && !!entry.name && safeFormProperty(change);
    }
    function restoreForm(entry, change) {
        if (!canRestoreForm(entry, change) || target.model.getValue() !== renderText) return;
        var fresh = window.FormDiff.compareXml(base.text, target.model.getValue());
        var stillChanged = fresh.entries && fresh.entries.some(function (candidate) {
            return candidate.name === entry.name && candidate.type === entry.type
                && candidate.changes && candidate.changes.some(function (item) {
                    return item.property === change.property && item.from === change.from && item.to === change.to;
                });
        });
        if (!stillChanged) return;
        var before = target.model.getValue();
        try {
            var restored = window.FormEdit.restoreProperty(before, base.text,
                { element: entry.name, property: change.property });
            if (restored.xml === before) return;
            applyPreviewEdits(window.DocEdits.textEdits(before, restored.xml));
            refreshDocPreview();
            refreshDiffPanel();
        } catch (err) { showTemplateNote('Откат не выполнен: ' + (err && err.message || err)); }
    }
    /* Удалённый элемент возвращается целиком, если его родитель на месте:
     * null — кнопки нет (только смотрим), строка — причина недоступности. */
    function restoreElementState(entry) {
        if (!canEditDiff || !entry || entry.type !== 'element' || entry.kind !== 'removed') return null;
        return window.FormEdit.restoreElementBlocked
            ? window.FormEdit.restoreElementBlocked(renderText, base.text, entry.name) : null;
    }
    function restoreElement(entry) {
        if (restoreElementState(entry) !== '' || target.model.getValue() !== renderText) return;
        var before = target.model.getValue();
        try {
            var restored = window.FormEdit.restoreElement(before, base.text, { element: entry.name });
            if (restored.xml === before) return;
            applyPreviewEdits(window.DocEdits.textEdits(before, restored.xml));
            refreshDocPreview();
            refreshDiffPanel();
        } catch (err) { showTemplateNote('Элемент не восстановлен: ' + (err && err.message || err)); }
    }
    var renderOptions = { diff: diff, canRestore: canRestoreForm, onRestore: restoreForm, onShowXml: showXmlDiff,
        restoreElementState: restoreElementState, onRestoreElement: restoreElement };
    if (moduleSide) {
        renderOptions.module = { before: moduleSide.text || '', after: moduleSide.current,
            pending: moduleSide.pending, error: moduleSide.error, changes: diff.moduleChanges || null,
            changed: moduleSide.text != null && moduleSide.text.replace(/\r\n?/g, '\n') !== moduleSide.current.replace(/\r\n?/g, '\n') };
        renderOptions.createModuleDiff = createFormModuleDiff;
    }
    var formProvider = providerById('form');
    if (formProvider) {
        var beforePreview = parseWithProviderUncached(formProvider, base.text);
        var afterPreview = parseWithProviderUncached(formProvider, currentText);
        if (beforePreview && beforePreview.model && afterPreview && afterPreview.model) {
            renderOptions.left = { model: beforePreview.model, label: gitBaseLabel() };
            renderOptions.right = { model: afterPreview.model, label: 'текущее состояние' };
        }
    }
    templateDiffView = window.FormDiffView.render(document, host, renderOptions);
    var count = diff.entries ? diff.entries.length : 0;
    templateDiffSummary = count ? 'изменённых сущностей: ' + count
        : 'отличий от ' + gitBaseLabel(true) + ' нет';
    syncDiffSummary();
}

/* Кнопка «XML-текст» смыслового сравнения: тот же переход, что и кнопкой
 * «форма/исходник» — без режима просмотра панель сравнивает текст. */
function showXmlDiff() {
    if (state.previewMode) setPreviewMode(false);
}

/* Встроенный Monaco для единственного места, где две стороны полезнее
 * объединённого представления: текста запроса набора данных. */
function createDcsQueryDiff(host, before, after) {
    return createMonacoTextDiff(host, before, after, 'bsl_query');
}

/* Вкладка «Модуль» сравнения формы: тот же встроенный Monaco, язык BSL. */
function createFormModuleDiff(host, before, after) {
    return createMonacoTextDiff(host, before, after, 'bsl');
}

function createMonacoTextDiff(host, before, after, language) {
    if (!window.monaco || !monaco.editor) return null;
    var original = monaco.editor.createModel(before || '', language);
    var modified = monaco.editor.createModel(after || '', language);
    var opts = diffEditorOptions();
    opts.fontSize = Math.max(11, (state.fontSize || 14) - 1);
    var view = monaco.editor.createDiffEditor(host, opts);
    view.setModel({ original: original, modified: modified });
    wireScrollFixFor(view.getOriginalEditor());
    wireScrollFixFor(view.getModifiedEditor());
    return {
        destroy: function () {
            view.dispose();
            original.dispose();
            modified.dispose();
        }
    };
}

function renderDcsDiff(target, base) {
    var host = document.getElementById('diff-sheets');
    var body = document.getElementById('diff-body');
    if (!host) return;
    if (body) body.hidden = true;
    host.hidden = false;
    if (templateDiffView && templateDiffView.destroy) templateDiffView.destroy();
    templateDiffView = null;
    host.innerHTML = '';
    function say(text) {
        templateDiffSummary = text;
        var note = document.createElement('div');
        note.className = 'dcsd-empty'; note.textContent = text; host.appendChild(note);
        syncDiffSummary();
    }
    if (base.pending) { say('читаем ревизию из git…'); return; }
    if (base.error) { say(base.error); return; }
    var diff = window.DcsDiff.compareXml(base.text, target.model.getValue());
    if (diff.error) { say(diff.error); return; }
    var renderText = target.model.getValue();
    var p = currentProvider();
    var canEditDiff = state.isEditing && !state.readOnly && !state.sarifMode
        && target.model === model && !!p && p.id === 'dcs';
    function freshDcsModel() {
        var parsed = parseWithProvider(p, model.getValue());
        return parsed && parsed.model ? parsed.model : null;
    }
    /* true — откат свойства возможен, строка — почему нет, false — у этого
     * изменения отката нет. Проверка — пробная правка той же функцией. */
    function canRestoreDcs(entry, change) {
        if (!canEditDiff || !window.DcsDiff.restorePlan(diff, entry, change)) return false;
        if (target.model.getValue() !== renderText) return 'Схема изменилась после сравнения — обновите сравнение';
        var edit = window.DcsDiff.restoreEdit(diff, entry, change, freshDcsModel());
        if (!edit) return false;
        return edit.error ? String(edit.error) : true;
    }
    function restoreDcs(entry, change) {
        var verdict = canRestoreDcs(entry, change);
        if (verdict !== true) {
            if (typeof verdict === 'string') showTemplateNote(verdict);
            return;
        }
        var edit = window.DcsDiff.restoreEdit(diff, entry, change, freshDcsModel());
        if (!edit || edit.error) return;
        applyDcsEdit(edit);
        model.pushStackElement();
        refreshDocPreview();
        refreshDiffPanel();
    }
    templateDiffView = window.DcsDiffView.render(document, host, {
        diff: diff,
        canRestore: canRestoreDcs,
        onRestore: restoreDcs,
        leftLabel: gitBaseLabel(),
        rightLabel: 'текущее состояние',
        createQueryDiff: createDcsQueryDiff,
        onShowXml: showXmlDiff
    });
    var count = diff.entries ? diff.entries.length : 0;
    templateDiffSummary = count ? 'изменений в СКД: ' + count
        : diff.unmodeled ? 'есть различия только в XML'
        : 'отличий от ' + gitBaseLabel(true) + ' нет';
    syncDiffSummary();
}

/* Текстовое сравнение снова занимает панель: лист убирается вместе со своими
 * обработчиками прокрутки. */
function dropTemplateDiff() {
    if (templateDiffView && templateDiffView.destroy) templateDiffView.destroy();
    templateDiffView = null;
    templateDiffSummary = '';
    var host = document.getElementById('diff-sheets');
    if (host) { host.hidden = true; host.innerHTML = ''; }
    var body = document.getElementById('diff-body');
    if (body) body.hidden = false;
}

function refreshDiffPanel() {
    var target = diffTarget();
    if (!target) return;
    /* Сначала список эталонов: смена цели могла выбросить выбранную ревизию
     * (у модуля формы своя история), и baseline надо считать по уже
     * исправленному выбору. Иначе слева пусто с «git недоступен», а легенда
     * тут же обещает файл на диске. */
    syncDiffBase();
    var templateSheets = templateDiffMode(target);
    var formSheets = formDiffMode(target);
    var dcsSheets = dcsDiffMode(target);
    var sheets = templateSheets || formSheets || dcsSheets;
    var version = target.model.getAlternativeVersionId();
    var base = diffBaseline(target);
    /* Отпечаток левой стороны: по нему видно, что перерисовывать нечего.
     * Ожидание и отказ — такие же состояния, как готовый текст. */
    /* Кнопки «Вернуть» есть только в режиме правки, так что режим входит в
     * отпечаток: карандаш при открытом диффе перерисовывает листы. */
    var stamp = (sheets ? 'sheet::' + (state.isEditing && !state.readOnly ? 'edit::' : 'view::') : 'text::')
        + gitState.base + '::'
        + (base.pending ? '<ждём>' : base.error ? '<нет> ' + base.error : base.text);
    /* Вкладка «Модуль» и пометки обработчиков зависят и от модуля формы. */
    if (formSheets) {
        var moduleSide = formModuleDiffSide();
        if (moduleSide) stamp += '::module::' + (moduleSide.pending ? '<ждём>' : moduleSide.error ? '<нет> ' + moduleSide.error
            : moduleSide.text) + '::' + moduleSide.current;
    }
    if (diffShown.model === target.model && diffShown.version === version
        && diffShown.baseline === stamp) return;
    diffShown = { model: target.model, version: version, baseline: stamp };
    diffBaseState = { pending: !!base.pending, error: base.error || '' };
    if (sheets) {
        var sheetTitle = document.getElementById('diff-title');
        if (sheetTitle) sheetTitle.textContent = 'Изменения: ' + target.title;
        syncDiffLegend();
        if (dcsSheets) renderDcsDiff(target, base);
        else if (formSheets) renderFormDiff(target, base);
        else renderTemplateDiff(target, base);
        return;
    }
    dropTemplateDiff();
    /* Из листов можно прийти в текст, ни разу не заводив Monaco. */
    if (!ensureDiffEditor(target.language)) return;
    monaco.editor.setModelLanguage(diffOriginalModel, target.language);
    monaco.editor.setModelLanguage(diffModifiedModel, target.language);
    /* Нечего показать слева — пусты обе стороны: пустой эталон против целого
     * документа нарисовал бы «весь файл добавлен», а это неправда. Что
     * именно случилось, говорит заголовок. */
    var blank = !!(base.pending || base.error);
    diffOriginalModel.setValue(blank ? '' : base.text);
    diffModifiedModel.setValue(blank ? '' : target.model.getValue());
    var title = document.getElementById('diff-title');
    if (title) title.textContent = 'Изменения: ' + target.title;
    syncDiffLegend();
    syncDiffSummary();
}

function openDiffPanel() {
    var target = diffTarget();
    var panel = document.getElementById('diff-panel');
    if (!target || !panel) return;
    /* Листам редактор Monaco не нужен, и заводить его ради них не за чем. */
    if (!templateDiffMode(target) && !ensureDiffEditor(target.language)) return;
    panel.hidden = false;
    diffOpen = true;
    /* Коммиты могли появиться, пока файл был открыт, а индекс — измениться. */
    if (gitAvailable()) requestGitInfo(target.key);
    /* Список эталонов перестраивает refreshDiffPanel() — он же считает по
     * нему левую сторону, поэтому второй вызов здесь был бы лишним. */
    refreshDiffPanel();
    if (diffEditor && !templateDiffView) diffEditor.layout();
    applyChrome();
}

function closeDiffPanel() {
    if (!diffOpen) return;
    diffOpen = false;
    var panel = document.getElementById('diff-panel');
    if (panel) panel.hidden = true;
    /* Повторное открытие всегда собирает представление заново: пока панель
     * скрыта, режим превью или её DOM могли измениться. */
    diffShown = { model: null, version: -1, baseline: null };
    applyChrome();
    if (editor) editor.layout();
}

function toggleDiffPanel() {
    if (diffOpen) { closeDiffPanel(); return; }
    if (diffAvailable()) openDiffPanel();
}

/* Другой файл — другой baseline: открытое сравнение относится к прошлому
 * документу, а его текст незачем держать в памяти. Другой файл лежит и в
 * другом месте в git — или не лежит там вовсе. */
function resetDiffPanel() {
    closeDiffPanel();
    closeGitRefInput();
    dropTemplateDiff();
    diffShown = { model: null, version: -1, baseline: null };
    diffBaseState = { pending: false, error: '' };
    gitState.base = 'disk';
    gitState.info = { file: null, module: null };
    gitState.blobs = {};
    gitPending = {};
    var sel = document.getElementById('diff-base');
    if (sel) sel.setAttribute('data-stamp', '');
    if (diffOriginalModel) diffOriginalModel.setValue('');
    if (diffModifiedModel) diffModifiedModel.setValue('');
}

function flushPreviewEdits() {
    if (previewInputTimer) {
        clearTimeout(previewInputTimer);
        previewInputTimer = null;
        writeSourceFromPreview();
    }
}

/* Read-only state and BSL typing aids for the model the editor shows. */
/* A data composition schema is not edited by hand for now: neither its XML
 * nor its window. Only restoring a change from the diff writes into it. */
function dcsLocked() {
    var p = currentProvider();
    return !!p && p.id === 'dcs';
}

function editingOptions(bsl) {
    var snip = !!(state.isEditing && bsl);
    return {
        readOnly: !state.isEditing || dcsLocked(),
        quickSuggestions: snip,
        acceptSuggestionOnEnter: snip ? 'smart' : 'off',
        tabCompletion: snip ? 'on' : 'off',
        snippetSuggestions: snip ? 'inline' : 'none'
    };
}

function setEditing(on) {
    if (state.sarifMode) return;
    state.isEditing = !!on;
    /* The module tab is edited in place; only the form mockup gives way to
     * its XML source. */
    var moduleOpen = formModuleOpen();
    editor.updateOptions(editingOptions(isBslModule() || moduleOpen));
    /* A picture that can be edited in place keeps the picture; the rest give
     * way to their XML, which is where they are edited. */
    if (isDocPreview() && !moduleOpen && !previewEditable()) setPreviewMode(!on);
    applyChrome();
    applyPreviewEditable();
    /* The picture is drawn read-only or editable, with its toolbar and its
     * session, so switching the mode has to draw it again. */
    if (previewEditable()) refreshDocPreview();
    /* The tree carries the reordering of a form, and only while the form is
     * edited: its rows become draggable and the header grows the arrows, so
     * the mode has to redraw it. */
    if (formOutlineActive()) renderOutline();
    /* Which panel belongs in the right-hand pane follows the mode: the
     * read-only inspector in view mode, the property editor in edit mode. The
     * template path redraws it from bindTemplateEditing, the form path had
     * nothing, so the pencil left the old panel standing until the user picked
     * an element again. The call is idempotent, so both are served here. */
    renderPropertyInspector();
    if (diffOpen) refreshDiffPanel();
    if (state.isEditing && state.previewMode && !isDocPreview()) focusPreview();
    else if (editor) editor.focus();
}

function hideSavePrompt() {
    var el = document.getElementById('save-prompt');
    if (el) el.hidden = true;
}

function showSavePrompt() {
    var el = document.getElementById('save-prompt');
    if (!el) return;
    el.hidden = false;
    var yes = document.getElementById('save-prompt-yes');
    if (yes) yes.focus();
}

function applyRevert(content) {
    if (!model) return;
    var scroll = editor ? editor.getScrollTop() : 0;
    var pos = editor ? editor.getPosition() : null;
    suppressDirty = true;
    applyingFromPreview = true;
    model.setValue(content || '');
    applyingFromPreview = false;
    suppressDirty = false;
    state.dirty = false;
    baselineContent = model.getValue();
    baselineVersion = model.getAlternativeVersionId();
    if (editor) {
        editor.setScrollTop(scroll);
        if (pos) editor.setPosition(pos);
    }
    if (state.previewMode) {
        refreshPreviewContent();
        applyPreviewEditable();
        syncPreviewFromEditor();
        if (typeof syncHighlightFromEditor === 'function') syncHighlightFromEditor();
    }
    refreshOutline();
    updateStatusBar();
}

function applyModuleRevert(content) {
    if (!formModuleModel) return;
    suppressDirty = true;
    formModuleModel.setValue(content || '');
    suppressDirty = false;
    state.moduleDirty = false;
    moduleBaselineContent = formModuleModel.getValue();
    moduleBaselineVersion = formModuleModel.getAlternativeVersionId();
    if (formModuleOpen()) refreshOutline();
    updateStatusBar();
}

function revertUnsaved() {
    applyRevert(baselineContent);
    applyModuleRevert(moduleBaselineContent);
    setEditing(false);
    if (host) send({ cmd: 'reload' });
}

function savePromptOpen() {
    var el = document.getElementById('save-prompt');
    return !!(el && !el.hidden);
}

function toggleEdit() {
    if (pendingLeaveEdit || pendingClose || savePromptOpen()) return;
    if (state.previewMode && isDocPreview() && !formModuleOpen() && !previewEditable()
        && !state.isEditing) return;
    if (state.isEditing) {
        flushPreviewEdits();
        if (anyDirty()) {
            showSavePrompt();
            return;
        }
        setEditing(false);
    } else {
        setEditing(true);
    }
}

/* Host asks (on window close) whether it is safe to shut down. Unsaved edits
 * get the same save-prompt as leaving edit mode; otherwise ack right away. */
function requestClose() {
    if (window.EpfPack && EpfPack.visible() && EpfPack.running()) {
        return window.confirm('Сборка ещё идёт. Прервать её и закрыть?');
    }
    if (window.EpfUnpack && EpfUnpack.visible() && EpfUnpack.running()) {
        send({ cmd: 'closeAck', allow: window.confirm('Идёт распаковка. Прервать её и закрыть?') });
        return;
    }
    if (savePromptOpen()) {
        // A prompt is already up for another reason (e.g. leaving edit mode);
        // piggyback the close on whatever the user decides there instead of
        // dropping this request on the floor.
        pendingClose = true;
        return;
    }
    flushPreviewEdits();
    if (anyDirty()) {
        pendingClose = true;
        showSavePrompt();
    } else {
        send({ cmd: 'closeAck', allow: true });
    }
}

function formatDocument() {
    if (!state.isEditing || !(isBslModule() || formModuleOpen()) || !editor) return;
    var selection = editor.getSelection && editor.getSelection();
    var currentModel = editor.getModel && editor.getModel();
    var selectedLength = selection && currentModel
        ? currentModel.getValueInRange(selection).length : 0;
    var actionId = selectedLength > 2
        ? 'editor.action.formatSelection' : 'editor.action.formatDocument';
    var act = editor.getAction(actionId);
    if (act) act.run();
    editor.focus();
}

function toggleLineComment() {
    if (!state.isEditing || !(isBslFamily() || formModuleOpen()) || !editor) return;
    editor.trigger('bsl', 'editor.action.commentLine');
    editor.focus();
}

/* Continuation lines of a multi-line BSL string (a query text) start with
 * "|" after the indent. Toggles it on every line the selections touch: when
 * all non-blank lines already carry it, it is removed, otherwise added where
 * missing. A selection ending at column 1 does not claim that last line. */
function toggleStringBar() {
    if (!state.isEditing || !(isBslFamily() || formModuleOpen()) || !editor) return;
    var model = editor.getModel();
    var selections = editor.getSelections() || [];
    if (!model || !selections.length) return;
    var seen = {}, lines = [];
    selections.forEach(function (sel) {
        var last = sel.endLineNumber;
        if (last > sel.startLineNumber && sel.endColumn === 1) last--;
        for (var ln = sel.startLineNumber; ln <= last; ln++) {
            if (seen[ln]) continue;
            seen[ln] = true;
            var text = model.getLineContent(ln);
            var indent = text.length - text.replace(/^\s+/, '').length;
            lines.push({ line: ln, col: indent + 1, blank: indent === text.length, bar: text.charAt(indent) === '|' });
        }
    });
    var filled = lines.filter(function (l) { return !l.blank; });
    var remove = filled.length > 0 && filled.every(function (l) { return l.bar; });
    var edits = [];
    lines.forEach(function (l) {
        if (remove && l.bar)
            edits.push({ range: new monaco.Range(l.line, l.col, l.line, l.col + 1), text: '' });
        else if (!remove && !l.bar && (!l.blank || lines.length === 1))
            edits.push({ range: new monaco.Range(l.line, l.col, l.line, l.col), text: '|' });
    });
    if (edits.length) {
        editor.pushUndoStop();
        editor.executeEdits('string-bar', edits);
        editor.pushUndoStop();
    }
    editor.focus();
}

/* Toolbar shortcuts call the same public actions as Monaco's F1 palette.
 * getAction() also covers actions that complete asynchronously; trigger() is
 * retained for compatibility with older Monaco bundles. */
function runEditorAction(id) {
    if (!editor || !monacoVisible()) return;
    var action = editor.getAction && editor.getAction(id);
    if (action) action.run();
    else editor.trigger('toolbar', id, null);
    editor.focus();
}

function onSavePromptYes() {
    hideSavePrompt();
    if (!pendingClose) pendingLeaveEdit = true;
    saveFile(true);
}

function onSavePromptNo() {
    hideSavePrompt();
    pendingLeaveEdit = false;
    if (pendingClose) {
        pendingClose = false;
        send({ cmd: 'closeAck', allow: true });
    } else {
        revertUnsaved();
    }
}

function onSavePromptCancel() {
    hideSavePrompt();
    pendingLeaveEdit = false;
    if (pendingClose) {
        pendingClose = false;
        send({ cmd: 'closeAck', allow: false });
    }
    if (editor) editor.focus();
}

/* An object window opens its forms, templates and modules in place: the host
 * swaps the loaded file, and the page keeps the way back. `navHistory` holds
 * the files left behind, newest last; `navPending` is the request in flight,
 * so a load the host starts on its own (Total Commander's next file) clears
 * the history instead of extending it. `navForward` holds the files «Назад»
 * left, newest last, until a new jump drops them. */
var navHistory = [];
var navForward = [];
var navPending = null;

function pathLabel(path) {
    var s = String(path || '');
    var parts = s.split(/[\\/]/);
    var name = parts[parts.length - 1] || s;
    /* Ext/Form.xml, Ext/Template.xml and Ext/*Module.bsl are named by their
     * owner's folder. */
    if (/^(Form\.xml|Template\.xml|\w*Module\.bsl)$/i.test(name)
            && parts.length > 2 && /^Ext$/i.test(parts[parts.length - 2]))
        return parts[parts.length - 3] + (/\.bsl$/i.test(name) ? ' (' + name + ')' : '');
    return name;
}

/* A file of the Designer dump named the way the Designer names it:
 * Справочник.Номенклатура.Форма.ФормаЭлемента, with the module after a colon.
 * Anything outside a dump keeps its file name (pathLabel). */
var NAV_CLASSES = {
    Catalogs: 'Справочник', Documents: 'Документ', DocumentJournals: 'ЖурналДокументов',
    Enums: 'Перечисление', Constants: 'Константа', InformationRegisters: 'РегистрСведений',
    AccumulationRegisters: 'РегистрНакопления', AccountingRegisters: 'РегистрБухгалтерии',
    CalculationRegisters: 'РегистрРасчета', ChartsOfCharacteristicTypes: 'ПланВидовХарактеристик',
    ChartsOfAccounts: 'ПланСчетов', ChartsOfCalculationTypes: 'ПланВидовРасчета',
    BusinessProcesses: 'БизнесПроцесс', Tasks: 'Задача', ExchangePlans: 'ПланОбмена',
    DataProcessors: 'Обработка', Reports: 'Отчет', CommonModules: 'ОбщийМодуль',
    CommonForms: 'ОбщаяФорма', CommonCommands: 'ОбщаяКоманда', CommonTemplates: 'ОбщийМакет',
    CommonPictures: 'ОбщаяКартинка', CommonAttributes: 'ОбщийРеквизит', Subsystems: 'Подсистема',
    Roles: 'Роль', HTTPServices: 'HTTPСервис', WebServices: 'WebСервис',
    SettingsStorages: 'ХранилищеНастроек', FilterCriteria: 'КритерийОтбора',
    DefinedTypes: 'ОпределяемыйТип', EventSubscriptions: 'ПодпискаНаСобытие',
    ScheduledJobs: 'РегламентноеЗадание', SessionParameters: 'ПараметрСеанса',
    FunctionalOptions: 'ФункциональнаяОпция', StyleItems: 'ЭлементСтиля', Styles: 'Стиль',
    XDTOPackages: 'ПакетXDTO', Sequences: 'Последовательность',
    DocumentNumerators: 'НумераторДокументов', CommandGroups: 'ГруппаКоманд', Languages: 'Язык'
};
var NAV_PARTS = { Forms: 'Форма', Templates: 'Макет', Commands: 'Команда', Recalculations: 'Перерасчет' };
var NAV_MODULES = {
    module: 'Модуль', objectmodule: 'Модуль объекта', managermodule: 'Модуль менеджера',
    valuemanagermodule: 'Модуль менеджера значения', recordsetmodule: 'Модуль набора записей',
    commandmodule: 'Модуль команды', sessionmodule: 'Модуль сеанса',
    applicationmodule: 'Модуль приложения', managedapplicationmodule: 'Модуль управляемого приложения',
    ordinaryapplicationmodule: 'Модуль обычного приложения',
    externalconnectionmodule: 'Модуль внешнего соединения'
};

function navLabel(path) {
    var parts = String(path || '').split(/[\\/]/).filter(Boolean);
    var file = parts[parts.length - 1] || '';
    var module = /\.bsl$/i.test(file) ? NAV_MODULES[file.replace(/\.bsl$/i, '').toLowerCase()] || '' : '';
    var at = -1;
    for (var i = parts.length - 2; i >= 0 && at < 0; i--) {
        if (!Object.prototype.hasOwnProperty.call(NAV_CLASSES, parts[i])) continue;
        var rest = parts.slice(i + 1);
        /* Catalogs/X.xml, Catalogs/X/X.mdo or anything under Catalogs/X/. */
        if (rest.length === 1 ? /\.(xml|mdo)$/i.test(rest[0])
                : /^(Ext|Forms|Templates|Commands|Recalculations)$/i.test(rest[1])
                    || rest.length === 2 && /\.(mdo|bsl)$/i.test(rest[1]))
            at = i;
    }
    if (at < 0) {
        if (/^Configuration\.(xml|mdo)$/i.test(file)) return 'Конфигурация';
        if (module && parts.length > 1 && /^Ext$/i.test(parts[parts.length - 2])
                && /^(session|application|managedapplication|ordinaryapplication|externalconnection)module\.bsl$/i.test(file))
            return 'Конфигурация: ' + module;
        return pathLabel(path);
    }
    var label = NAV_CLASSES[parts[at]] + '.' + parts[at + 1].replace(/\.(xml|mdo)$/i, '');
    var j = at + 2;
    if (NAV_PARTS[parts[j]] && parts[j + 1] && j + 1 < parts.length - 1) {
        label += '.' + NAV_PARTS[parts[j]] + '.' + parts[j + 1];
        j += 2;
    } else if (NAV_PARTS[parts[j]] && parts[j + 1]) {
        /* Forms/F.xml: the form's own descriptor. */
        label += '.' + NAV_PARTS[parts[j]] + '.' + parts[j + 1].replace(/\.(xml|mdo)$/i, '');
    }
    return module ? label + ': ' + module : label;
}

function navigationMessage(path, target) {
    var msg = { cmd: 'open', path: path };
    if (!target) return msg;
    if (target.formView === 'module') msg.formView = 'module';
    if (target.line > 0) msg.line = Math.floor(target.line);
    if (target.search) msg.search = String(target.search);
    if (target.regexp) msg.regexp = true;
    if (target.matchCase) msg.matchCase = true;
    return msg;
}

/* `direction` is true or 'back' for a step back through navHistory, 'forward'
 * for a step through navForward, a number for that many steps (negative is
 * back, from the history menu), anything else for a new jump. */
function navigateTo(path, direction, target) {
    if (!host || !path) return false;
    flushPreviewEdits();
    if (anyDirty() && !window.confirm('Несохранённые изменения будут потеряны. Перейти?')) return false;
    var steps = typeof direction === 'number' ? direction
        : direction === true || direction === 'back' ? -1 : direction === 'forward' ? 1 : 0;
    navPending = { path: path, steps: steps, from: state.filePath, selectedId: state.formSelectedId };
    send(navigationMessage(path, target));
    return true;
}

/* `rel` is relative to the object's own folder: Catalogs/Имя.xml owns
 * Catalogs/Имя/Forms/..., exactly as the Designer dump lays them out. */
function relatedPath(rel) {
    /* Another object of the configuration comes with its full path. */
    if (/^([A-Za-z]:[\\/]|\\\\|\/)/.test(String(rel || ''))) return String(rel);
    var current = String(state.filePath || '');
    var lastSeparator = Math.max(current.lastIndexOf('\\'), current.lastIndexOf('/'));
    var base = /\.mdo$/i.test(current)
        ? current.slice(0, lastSeparator)
        : current.replace(/\.xml$/i, '');
    if (!base || !rel) return '';
    var sep = base.indexOf('\\') >= 0 ? '\\' : '/';
    var related = String(rel);
    if (/\.mdo$/i.test(state.filePath || '')) {
        related = related.replace(/^Forms\/(.+)\/Ext\/Form\.xml$/i, 'Forms/$1/Form.form')
            .replace(/^Forms\/(.+)\/Ext\/Module\.bsl$/i, 'Forms/$1/Module.bsl')
            .replace(/^Commands\/(.+)\/Ext\/CommandModule\.bsl$/i, 'Commands/$1/CommandModule.bsl')
            .replace(/^Ext\/(ObjectModule|ManagerModule|RecordSetModule|ValueManagerModule)\.bsl$/i, '$1.bsl');
    }
    return base + sep + related.split('/').join(sep);
}

/* An object window's link: a file to open, an HTML template to show
 * ('html:' + the base of its Template.xml) or a binary template to save
 * ('save:' + type + ':' + its Template.bin). */
function relatedTarget(rel) {
    var m = String(rel || '').match(/^(?:(html):|(save):([A-Za-z]+):)?([\s\S]*)$/);
    return { action: m[1] || m[2] || 'open', type: m[3] || '', path: relatedPath(m[4]) };
}

function openRelated(rel, openAt) {
    var target = relatedTarget(rel);
    if (!target.path) return;
    if (target.action === 'html') showHelp(target.path, htmlTemplateTitle(target.path));
    else if (target.action === 'save') send({ cmd: 'saveTemplate', path: target.path, type: target.type });
    else {
        var path = target.path;
        var portablePath = path.replace(/\\/g, '/');
        var separator = path.indexOf('\\') >= 0 ? '\\' : '/';
        var formView = null;
        var projModule = portablePath.match(/^(.*\/(?:Forms\/[^/]+|CommonForms\/[^/]+))\/Module\.bsl$/i);
        var dumpedModule = portablePath.match(/^(.*\/Ext)\/Form\/Module\.bsl$/i);
        if (projModule) {
            path = (projModule[1] + '/Form.form').replace(/\//g, separator);
            formView = 'module';
        } else if (dumpedModule) {
            path = (dumpedModule[1] + '/Form.xml').replace(/\//g, separator);
            formView = 'module';
        }
        /* A hit in a form module opens the form on its Module tab, still at
         * the hit's line and with its search. */
        var navTarget = openAt ? Object.assign({}, openAt) : null;
        if (formView) (navTarget = navTarget || {}).formView = formView;
        navigateTo(path, false, navTarget);
    }
}

/* Templates/<Имя>/Ext/Template -> Макет: <Имя>. */
function htmlTemplateTitle(base) {
    var parts = String(base).split(/[\\/]/);
    return 'Макет: ' + (parts[parts.length - 3] || '');
}

function objectMetadataCandidates(directory, sep) {
    var parts = String(directory || '').split(/[\\/]/);
    var name = parts[parts.length - 1] || '';
    if (!name) return [];
    var objectDir = parts.join(sep);
    var parentDir = parts.slice(0, -1).join(sep);
    return [objectDir + sep + name + '.mdo', parentDir + sep + name + '.xml', objectDir + sep + name + '.xml'];
}

function onTemplateSaved(d) {
    if (d && !d.ok && !d.cancelled) window.alert('Не удалось сохранить макет:\n' + (d.path || ''));
}

/* Whether a related file exists, asked through the same configuration host the
 * form context reads from; a host that cannot answer says "yes", so nothing is
 * hidden by mistake. */
function relatedExists(rel) {
    var target = relatedTarget(rel);
    var path = target.action === 'html' ? target.path + '.xml' : target.path;
    if (!path || !window.fetch) return Promise.resolve(true);
    return fetch('https://bslcfg.invalid/file?p=' + encodeURIComponent(path) + '&exists=1')
        .then(function (r) { return r.ok ? r.text() : '1'; })
        .then(function (t) { return t !== '0'; }, function () { return true; });
}

/* «Уровень вверх»: a form, template or module goes up to its object, an
 * object to the configuration root (a nested subsystem to its parent). The
 * path alone gives the candidates; the first one that exists wins. */
function upCandidates(path) {
    var p = String(path || '');
    var sep = p.indexOf('\\') >= 0 ? '\\' : '/';
    var parts = p.split(/[\\/]/);
    if (/\.mdo$/i.test(p) && !/^Configuration\.mdo$/i.test(parts[parts.length - 1])) {
        if (parts.length < 5) return [];
        var mdoParent = parts.slice(0, -3).join(sep);
        if (/(?:^|[\\/])Subsystems[\\/][^\\/]+(?:[\\/]|$)/i.test(mdoParent)) {
            return objectMetadataCandidates(mdoParent, sep).concat([
                mdoParent + sep + 'Configuration.xml', mdoParent + sep + 'Configuration.mdo',
                mdoParent + sep + 'Configuration' + sep + 'Configuration.mdo'
            ]);
        }
        return [mdoParent + sep + 'Configuration' + sep + 'Configuration.mdo',
            mdoParent + sep + 'Configuration.mdo', mdoParent + sep + 'Configuration.xml', mdoParent + '.xml'];
    }
    if (/\.bsl$/i.test(p) && !parts.some(function (part) { return /^Ext$/i.test(part); })) {
        var objectFolderAt = -1;
        for (var b = parts.length - 2; b > 0; b--) {
            if (/^(Forms|Commands|Templates|Recalculations)$/i.test(parts[b])) {
                objectFolderAt = b;
                break;
            }
        }
        var projObject = objectFolderAt > 0
            ? parts.slice(0, objectFolderAt).join(sep)
            : parts.slice(0, -1).join(sep);
        if (projObject) return objectMetadataCandidates(projObject, sep);
    }
    if (/\.form$/i.test(p)) {
        var formsAt = -1;
        for (var f = parts.length - 2; f > 0; f--) if (/^Forms$/i.test(parts[f])) { formsAt = f; break; }
        if (formsAt > 0) {
            var projOwner = parts.slice(0, formsAt).join(sep);
            return objectMetadataCandidates(projOwner, sep);
        }
    }
    var ext = -1;
    for (var i = parts.length - 2; i > 0; i--) if (/^Ext$/i.test(parts[i])) { ext = i; break; }
    if (ext > 0) {
        var owner = parts.slice(0, ext);
        /* Catalogs/X/Forms/F/Ext/Form.xml: the form belongs to Catalogs/X. */
        if (owner.length > 2 && /^(Forms|Templates|Commands|Recalculations)$/i.test(owner[owner.length - 2])) {
            var objectBase = owner.slice(0, -2).join(sep);
            return objectMetadataCandidates(objectBase, sep);
        }
        return [owner.concat(['Configuration.xml']).join(sep), owner.join(sep) + '.xml'];
    }
    if (!/\.(?:xml|mdo)$/i.test(p) || /^Configuration\.xml$/i.test(parts[parts.length - 1]) || parts.length < 4) return [];
    var grand = parts.slice(0, -2);
    return [grand.concat(['Configuration.xml']).join(sep), grand.join(sep) + '.mdo', grand.join(sep) + '.xml'];
}

var upTarget = { path: '', token: 0 };
function refreshUpTarget() {
    var token = ++upTarget.token;
    upTarget.path = '';
    /* An object opened from the unpacking panel goes up to that panel. */
    if (epfOrigin && sameEpfPath(state.filePath, epfOrigin.rootXml)
            && navHistory.some(function (e) { return sameEpfPath(e.path, epfOrigin.epf); })) {
        upTarget.path = epfOrigin.epf;
        applyChrome();
        return;
    }
    var list = host && window.fetch ? upCandidates(state.filePath) : [];
    (function next(i) {
        if (i >= list.length || token !== upTarget.token) return;
        fetch(configFileUrl(list[i], true))
            .then(function (r) { return r.ok ? r.text() : '0'; }, function () { return '0'; })
            .then(function (t) {
                if (token !== upTarget.token) return;
                if (t === '0') { next(i + 1); return; }
                upTarget.path = list[i];
                applyChrome();
            });
    })(0);
}

/* Going up to a file left behind brings back what was selected there. */
function navigateUp() {
    if (!upTarget.path) return;
    var last = navHistory.length ? navHistory[navHistory.length - 1] : null;
    navigateTo(upTarget.path, !!(last && last.path.toLowerCase() === upTarget.path.toLowerCase()));
}

function navigateBack() {
    if (navHistory.length) navigateTo(navHistory[navHistory.length - 1].path, 'back');
}

function navigateForward() {
    if (navForward.length) navigateTo(navForward[navForward.length - 1].path, 'forward');
}

/* The history menu lists the way in the order it was walked: the files left
 * behind, the current one, then those «Назад» stepped out of. Each item
 * carries how many steps away it is. */
function navHistoryItems() {
    var items = navHistory.map(function (e, i) {
        return { path: e.path, steps: i - navHistory.length };
    });
    items.push({ path: state.filePath, steps: 0 });
    for (var j = navForward.length - 1; j >= 0; j--)
        items.push({ path: navForward[j].path, steps: navForward.length - j });
    return items;
}

function closeNavHistoryMenu(returnFocus) {
    var menu = document.getElementById('nav-history-menu');
    var button = document.getElementById('btn-nav-history');
    if (menu) menu.hidden = true;
    if (button) button.setAttribute('aria-expanded', 'false');
    if (returnFocus && button) button.focus();
}

function toggleNavHistoryMenu() {
    var menu = document.getElementById('nav-history-menu');
    var button = document.getElementById('btn-nav-history');
    if (!menu || !button) return;
    if (!menu.hidden) { closeNavHistoryMenu(false); return; }
    menu.textContent = '';
    var current = null;
    navHistoryItems().forEach(function (item) {
        var row = document.createElement('div');
        row.className = 'nav-history-item';
        row.setAttribute('role', item.steps ? 'menuitem' : 'menuitemradio');
        row.textContent = navLabel(item.path);
        row.title = item.path;
        if (!item.steps) {
            row.setAttribute('aria-checked', 'true');
            row.classList.add('current');
            current = row;
        } else {
            row.tabIndex = -1;
            row.addEventListener('click', function () {
                closeNavHistoryMenu(false);
                navigateTo(item.path, item.steps);
            });
        }
        menu.appendChild(row);
    });
    /* Fixed to the window, not the toolbar: an absolutely placed menu that
     * runs past the right edge makes the toolbar scroll sideways. */
    var anchor = button.getBoundingClientRect();
    menu.style.left = '0px';
    menu.style.top = Math.round(anchor.bottom + 3) + 'px';
    menu.hidden = false;
    var width = menu.offsetWidth;
    menu.style.left = Math.max(4, Math.min(anchor.left, window.innerWidth - width - 4)) + 'px';
    button.setAttribute('aria-expanded', 'true');
    if (current && current.scrollIntoView) current.scrollIntoView({ block: 'nearest' });
    var first = menu.querySelector('.nav-history-item:not(.current)');
    if (first) first.focus({ preventScroll: true });
}

/* Alt+← / Alt+→, as in a browser. */
function historyKeyDirection(event) {
    if (!event || !event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return '';
    return event.key === 'ArrowLeft' ? 'back' : event.key === 'ArrowRight' ? 'forward' : '';
}

/* Backspace behaves like the toolbar's «Уровень вверх» only while the
 * document is being viewed. An input in a preview keeps Backspace for text
 * editing; Alt+↑ remains available in both viewing and editing modes. */
function isNavigateUpKey(event) {
    if (!event) return false;
    if (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && event.key === 'ArrowUp') return true;
    if (event.key !== 'Backspace' || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey
            || state.isEditing) return false;
    var target = event.target;
    return !(target && target.closest
        && target.closest('input, textarea, select, [contenteditable="true"]'));
}

/* The configuration window opens objects in a separate BSLEdit, so closing
 * the object brings the user back to the window, not to an empty editor.
 * A host that cannot start one answers openWindowFailed: open in place. */
function openInWindow(rel, target) {
    var path = relatedPath(rel);
    if (path) {
        var msg = navigationMessage(path, target);
        msg.cmd = 'openWindow';
        send(msg);
    }
}

function trackNavigation(path) {
    var nav = navPending;
    navPending = null;
    if (!nav || nav.path !== path) {
        navHistory = [];
        navForward = [];
        return;
    }
    var left = nav.from ? { path: nav.from, selectedId: nav.selectedId } : null;
    if (nav.steps) {
        var from = nav.steps < 0 ? navHistory : navForward;
        var to = nav.steps < 0 ? navForward : navHistory;
        if (left) to.push(left);
        for (var k = Math.abs(nav.steps); k > 1 && from.length; k--) to.push(from.pop());
        var entry = from.pop();
        if (entry && entry.selectedId) state.formSelectedId = entry.selectedId;
    } else if (left) {
        navHistory.push(left);
        navForward = [];
    }
}

/* The unpacking panel of an .epf/.erf (epf-unpack.js). «Открыть» there loads
 * the unpacked object's root XML in this same window, with the panel kept as
 * the way back. */
var epfOrigin = null;   // { epf, rootXml } of the last object opened from the panel

function sameEpfPath(a, b) {
    return !!a && !!b && String(a).toLowerCase() === String(b).toLowerCase();
}

/* Designer складывает корневой XML и все дочерние файлы внешнего объекта в
 * один каталог. Сравнение сегментное: `C:\\Dump2` не является частью
 * `C:\\Dump`, а разные направления слешей в сообщениях хоста допустимы. */
/* What the assembly panel has to say about the document now open. Anything
 * the Designer dumps is a <MetaDataObject>: the external object it assembles
 * on its own ('external'), the root of a configuration or an extension
 * ('config'), and any object of such an export ('object'), which is the one
 * to load back into an infobase. */
function epfRootKind(content) {
    var head = String(content || '').slice(0, 8192);
    var m = /<MetaDataObject[^>]*>\s*<([A-Za-z]+)[\s>]/.exec(head);
    var root = m ? m[1] : '';
    if (!root) return '';
    if (root === 'ExternalDataProcessor' || root === 'ExternalReport') return 'external';
    if (root === 'Configuration') return 'config';
    return 'object';
}

/* «Сборка и загрузка»: the host opens the assembly panel on the dump this
 * object belongs to in a new window, and in this one only when it cannot. The
 * assembly reads the files on disk, so unsaved edits do not reach it. */
function openEpfPanel() {
    if (!host || !state.epfRoot) return;
    flushPreviewEdits();
    if (anyDirty() && !window.confirm('Несохранённые изменения не попадут в сборку. Открыть окно сборки?')) return;
    send({ cmd: 'packPanel' });
}

function showEpf(req) {
    pending = null;
    trackNavigation(req.path || '');
    state.language = 'epf';
    state.epfRoot = '';
    state.filePath = req.path || '';
    state.previewId = '';
    state.previewMode = false;
    state.sarifMode = false;
    state.dirty = false;
    state.moduleDirty = false;
    hideSavePrompt();
    refreshUpTarget();
    if (!window.EpfUnpack) return;
    EpfUnpack.show(req, send, { open: openEpfResult });
    document.getElementById('loading').style.display = 'none';
    send({ cmd: 'painted' });
}

/* The assembly panel (epf-pack.js): the same window switches to it and back
 * to the object with «К объекту». */
function showPack(req) {
    pending = null;
    trackNavigation(req.path || '');
    state.language = 'pack';
    state.epfRoot = '';
    state.filePath = req.path || '';
    state.previewId = '';
    state.previewMode = false;
    state.sarifMode = false;
    state.dirty = false;
    state.moduleDirty = false;
    hideSavePrompt();
    refreshUpTarget();
    if (!window.EpfPack) return;
    if (window.EpfUnpack) EpfUnpack.hide();
    EpfPack.show(req, send);
    document.getElementById('loading').style.display = 'none';
    send({ cmd: 'painted' });
}

function openEpfResult(file, target, rootXml) {
    if (!host || !rootXml) return;
    epfOrigin = { epf: state.filePath, rootXml: rootXml };
    navPending = { path: rootXml, back: false, from: state.filePath, selectedId: '' };
    send({ cmd: 'epfOpen', file: file, target: target });
}

function onOpenFailed(d) {
    navPending = null;
    window.alert('Не удалось открыть файл:\n' + ((d && d.path) || ''));
}

/* Help pages (Справка) of an object or a form. The dump keeps them the same
 * way for both: <owner>/Ext/Help.xml lists the pages, <owner>/Ext/Help/<lang>.html
 * holds each one. The owner is the object for its root XML and the form for
 * its Ext/Form.xml. Files are read through the configuration host. */
var helpState = { base: '', available: false, token: 0 };

function helpBaseFor(path) {
    var p = String(path || '');
    var sep = p.indexOf('\\') >= 0 ? '\\' : '/';
    if (/[\\/]Ext[\\/]Form\.(?:xml|form)$/i.test(p)) return p.replace(/Form\.(?:xml|form)$/i, 'Help');
    var provider = currentProvider();
    if (provider && provider.id === 'metadata' && /\.xml$/i.test(p))
        return p.replace(/\.xml$/i, '') + sep + 'Ext' + sep + 'Help';
    return '';
}

function configFileUrl(path, existsOnly) {
    return 'https://bslcfg.invalid/file?p=' + encodeURIComponent(path) + (existsOnly ? '&exists=1' : '');
}

function readConfigText(path) {
    return fetch(configFileUrl(path)).then(function (r) {
        if (!r.ok) throw new Error('not found');
        return r.arrayBuffer();
    }).then(function (buffer) {
        return new TextDecoder('utf-8').decode(buffer).replace(/^\uFEFF/, '');
    });
}

function syncHelpButton() {
    var inWindow = document.querySelectorAll('#form-preview .md-help-button');
    for (var i = 0; i < inWindow.length; i++) inWindow[i].hidden = !helpState.available;
}

function refreshHelp() {
    var token = ++helpState.token;
    helpState.base = host && window.fetch ? helpBaseFor(state.filePath) : '';
    helpState.available = false;
    hideHelp();
    syncHelpButton();
    if (!helpState.base) return;
    fetch(configFileUrl(helpState.base + '.xml', true))
        .then(function (r) { return r.ok ? r.text() : '0'; })
        .then(function (t) {
            if (token !== helpState.token) return;
            helpState.available = t === '1';
            syncHelpButton();
        }, function () { /* no configuration host: no help */ });
}

function helpTitle() {
    var parts = String(state.filePath || '').split(/[\\/]/);
    var name = parts[parts.length - 1] || '';
    if (/^Form\.xml$/i.test(name) && parts.length > 2) return parts[parts.length - 3];
    return name.replace(/\.(?:xml|mdo)$/i, '');
}

/* The page body without the platform's stylesheet (v8help: in help,
 * __STYLE__ in an HTML template), which a browser cannot load; links inside
 * help lead into the platform's help system and are shown as text. */
function helpDocument(html) {
    var body = String(html).replace(/<link[^>]*(?:v8help:|__STYLE__)[^>]*>(\s*<\/link>)?/gi, '');
    var style = '<style>body{font:13px Arial,Segoe UI,sans-serif;color:#000;background:#fff;margin:12px 16px;}' +
        'h1{font-size:18px;margin:0 0 10px;}h2{font-size:15px;}h3{font-size:13px;}' +
        'a{color:#0645ad;text-decoration:none;cursor:default;}table{border-collapse:collapse;}' +
        'td,th{border:1px solid #ccc;padding:3px 6px;}img{max-width:100%;}</style>';
    return /<head[^>]*>/i.test(body) ? body.replace(/<head[^>]*>/i, function (m) { return m + style; })
        : style + body;
}

/* An object's help, or the page of an HTML template, which is kept the same
 * way: <base>.xml lists the pages, <base>/<lang>.html holds each one. */
function showHelp(templateBase, templateTitle) {
    var isTemplate = typeof templateBase === 'string';
    if (!isTemplate && (!helpState.available || !helpState.base)) return;
    var base = isTemplate ? templateBase : helpState.base;
    var token = helpState.token;
    var sep = base.indexOf('\\') >= 0 ? '\\' : '/';
    readConfigText(base + '.xml').then(function (xml) {
        var pages = [];
        xml.replace(/<Page>\s*([^<\s]+)\s*<\/Page>/g, function (m, lang) { pages.push(lang); return m; });
        var lang = pages.indexOf('ru') >= 0 ? 'ru' : (pages[0] || 'ru');
        return readConfigText(base + sep + lang + '.html');
    }).then(function (html) {
        if (token !== helpState.token) return;
        var panel = document.getElementById('help-panel');
        var frame = document.getElementById('help-frame');
        document.getElementById('help-title').textContent = isTemplate ? templateTitle : 'Справка: ' + helpTitle();
        frame.onload = function () {
            var doc = frame.contentDocument;
            if (!doc) return;
            doc.addEventListener('click', function (e) {
                var link = e.target.closest && e.target.closest('a');
                if (link) e.preventDefault();
            });
            doc.addEventListener('keydown', function (e) { if (e.key === 'Escape') hideHelp(); });
        };
        frame.srcdoc = helpDocument(html);
        panel.hidden = false;
    }).catch(function () {
        window.alert(isTemplate ? 'Не удалось прочитать HTML документ.' : 'Не удалось прочитать справку.');
    });
}

function hideHelp() {
    var panel = document.getElementById('help-panel');
    if (!panel || panel.hidden) return;
    panel.hidden = true;
    document.getElementById('help-frame').removeAttribute('srcdoc');
}

/* Re-read the file from disk so an agent's edit shows without reopening the
 * lister; cached configuration metadata is dropped with it. */
function reloadFromDisk(asked) {
    if (!host) return;
    /* asked: спрашивать второй раз нечего — выбор уже сделан в полоске
     * «файл изменён на диске». */
    if (!asked && anyDirty() && !window.confirm('Несохранённые изменения будут потеряны. Перечитать файл?')) return;
    hideExternalBar();
    dropContextCaches();
    send({ cmd: 'reload' });
}

function onReverted(d) {
    if (d && d.ok && typeof d.content === 'string') applyRevert(d.content);
    if (d && d.ok && typeof d.formModule === 'string') applyModuleRevert(d.formModule);
    pendingLeaveEdit = false;
    /* Перечитанный файл сам стал baseline: сравнивать больше не с чем, а
     * открытая панель продолжала бы показывать прошлое сравнение. */
    if (d && d.ok) resetDiffPanel();
}

/* --- Файл изменился на диске -------------------------------------------- */

/* Хост следит за открытыми файлами и сообщает о записи со стороны — обычно это
 * агент, правящий тот же файл. Чистый документ хост заменяет сам и присылает
 * новый текст: пользователю остаётся сообщение, а курсор, прокрутка и вкладка
 * на месте. Документ с несохранёнными правками не заменяется — выбор за
 * пользователем, и до его решения ревизия на стороне хоста остаётся прежней,
 * поэтому сохранение поверх спросит, а не затрёт. */
var externalBarTimer = 0;

function hideExternalBar() {
    if (externalBarTimer) { clearTimeout(externalBarTimer); externalBarTimer = 0; }
    var bar = document.getElementById('external-change');
    if (bar) bar.hidden = true;
}

/* actions: [{ text, onClick }]; autoHideMs — для сообщения, которое не требует
 * ответа. */
function showExternalBar(text, actions, autoHideMs) {
    var bar = document.getElementById('external-change');
    var msg = document.getElementById('external-change-msg');
    var btns = document.getElementById('external-change-btns');
    if (!bar || !msg || !btns) return;
    if (externalBarTimer) { clearTimeout(externalBarTimer); externalBarTimer = 0; }
    msg.textContent = text;
    btns.innerHTML = '';
    (actions || []).forEach(function (action) {
        var button = document.createElement('button');
        button.type = 'button';
        button.textContent = action.text;
        button.addEventListener('click', function () {
            hideExternalBar();
            action.onClick();
        });
        btns.appendChild(button);
    });
    bar.hidden = false;
    if (autoHideMs) externalBarTimer = setTimeout(hideExternalBar, autoHideMs);
}

/* Кэш метаданных конфигурации описывает файлы, которые тоже могли измениться:
 * перечитанный документ начинает с чистого кэша, как и перечитывание по
 * кнопке. */
function dropContextCaches() {
    Object.keys(formContextCache).forEach(function (key) { delete formContextCache[key]; });
    Object.keys(mdRelationsCache).forEach(function (key) { delete mdRelationsCache[key]; });
}

function onExternalChange(d) {
    if (!d || state.sarifMode || !model) return;
    var toModule = d.target === 'module';
    var what = toModule ? 'Модуль' : 'Файл';
    if (d.apply && typeof d.content === 'string') {
        dropContextCaches();
        if (toModule) applyModuleRevert(d.content); else applyRevert(d.content);
        resetDiffPanel();
        syncDirtyMarks();
        syncUndoButtons();
        showExternalBar(what + ' изменён на диске и перечитан.', [], 5000);
        return;
    }
    showExternalBar(what + ' изменён на диске, а здесь есть несохранённые правки.', [
        { text: 'Перечитать', onClick: function () { reloadFromDisk(true); } },
        { text: 'Оставить мои правки', onClick: function () {} }
    ]);
}

/* Сохранение отказано: файл изменился под буфером. Выбор именно здесь, а не в
 * молчаливой перезаписи — один из двух текстов будет потерян в любом случае, и
 * решает это пользователь. */
function showSaveConflict(target, snapshot) {
    var toModule = target === 'module';
    var actions = [];
    /* Без снимка перезаписывать нечем: остаётся посмотреть, что на диске. */
    if (typeof snapshot === 'string')
        actions.push({ text: 'Перезаписать', onClick: function () { saveTarget(target, snapshot, true); } });
    actions.push({ text: 'Посмотреть, что на диске', onClick: function () { reloadFromDisk(); } });
    showExternalBar((toModule ? 'Модуль' : 'Файл') + ' изменён на диске после того, как документ был открыт.', actions);
}

function savedSnapshotState(currentContent, snapshot) {
    return { baseline: snapshot, dirty: currentContent !== snapshot };
}

/* Номер состояния для нового эталона: он есть, только если документ сейчас
 * эталону дословно равен. Сохранение отдаёт снимок, снятый до последних
 * нажатий, и тогда номера нет — до первого совпадения сравниваем текст. */
function markBaseline(target, baseline) {
    return target && target.getValue() === baseline ? target.getAlternativeVersionId() : -1;
}

/* Расходится ли модель со своим эталоном. Дешёвый путь — номер состояния;
 * сравнение целого текста остаётся на случай, когда номера нет. */
function modelDirty(target, baseline, cleanVersion) {
    if (!target) return false;
    if (cleanVersion >= 0) return target.getAlternativeVersionId() !== cleanVersion;
    return target.getValue() !== baseline;
}

/* The toolbar is a row of icons, so the save button keeps its icon while it
 * reports: the result is the colour and the tooltip. Only a failure spells
 * itself out, because "which file, and why" does not fit in a colour - and
 * that text is what the user acts on. The button used to come back from its
 * report as a floppy emoji beside the word "Сохранить", left over from the
 * toolbar's text days, and stayed that way until the next document. */
var SAVE_BUTTON_ICON = '<svg class="tb-icon"><use href="#i-save"></use></svg>';

function setSaveButton(kind, message) {
    var btnSave = document.getElementById('btn-save');
    if (!btnSave) return;
    btnSave.classList.remove('save-ok', 'save-err');
    if (kind) btnSave.classList.add(kind === 'ok' ? 'save-ok' : 'save-err');
    btnSave.innerHTML = kind === 'err' ? message : SAVE_BUTTON_ICON;
    btnSave.title = message;
}

function onSaveResult(ok, saveId, conflict, target) {
    var pending = pendingSaveSnapshots[String(saveId)] || {};
    delete pendingSaveSnapshots[String(saveId)];
    var toModule = target === 'module';
    var snapshot = pending.snapshot;
    /* The layout and the module save as one batch: a failure of either stays
     * on the button even when the other one lands after it. */
    if (!ok) saveBatchFailed = true;
    if (!ok && conflict) showSaveConflict(toModule ? 'module' : 'form',
        typeof snapshot === 'string' ? snapshot : null);
    if (!ok || !saveBatchFailed) {
        setSaveButton(ok ? 'ok' : 'err', ok ? 'Сохранено'
            : (conflict ? '&#9888; ' + (toModule ? 'Модуль изменён извне' : 'Файл изменён извне')
                : '&#10006; Ошибка' + (toModule ? ' записи модуля' : '')));
    }
    if (ok) {
        if (toModule) {
            var savedModule = savedSnapshotState(formModuleModel ? formModuleModel.getValue() : moduleBaselineContent,
                typeof snapshot === 'string' ? snapshot : moduleBaselineContent);
            moduleBaselineContent = savedModule.baseline;
            moduleBaselineVersion = markBaseline(formModuleModel, savedModule.baseline);
            state.moduleDirty = savedModule.dirty;
        } else {
            var saved = savedSnapshotState(model ? model.getValue() : baselineContent,
                typeof snapshot === 'string' ? snapshot : baselineContent);
            baselineContent = saved.baseline;
            baselineVersion = markBaseline(model, saved.baseline);
            state.dirty = saved.dirty;
        }
        /* Pending leave/close waits for the other half of the batch. */
        if (!Object.keys(pendingSaveSnapshots).length) {
            if (pendingLeaveEdit && !anyDirty()) {
                pendingLeaveEdit = false;
                setEditing(false);
            }
            if (pendingClose && !anyDirty()) {
                pendingClose = false;
                send({ cmd: 'closeAck', allow: true });
            } else if ((pendingClose || pendingLeaveEdit) && anyDirty()) {
                showSavePrompt();
            }
        }
    } else {
        // Save failed: keep the window open so the error stays visible and
        // the user can retry instead of losing the edit on a forced close.
        var wasClosing = pendingClose;
        pendingLeaveEdit = false;
        pendingClose = false;
        if (wasClosing) send({ cmd: 'closeAck', allow: false });
    }
    syncDirtyMarks();
    syncUndoButtons();
    /* Запись меняет файл на диске: какие ревизии совпадают с ним теперь и
     * отличается ли он от индекса, знает только git — спрашиваем заново. */
    if (ok && gitAvailable()) requestGitInfo(toModule ? 'module' : 'file');
    setTimeout(function () {
        setSaveButton('', 'Сохранить (Ctrl+S)');
        applyChrome();
    }, 2000);
}

function saveFile(forPendingAction) {
    if (state.sarifMode) return;
    if ((!sourceEditingActive() && !previewEditingActive() && !forPendingAction)
        || !state.isEditing || !model) return;
    flushPreviewEdits();
    /* Save whatever part of the form changed: the layout, the module or both.
     * With nothing changed, save the part on screen, as a plain file would. */
    var targets = [];
    if (state.dirty) targets.push('form');
    if (state.moduleDirty && formModuleModel) targets.push('module');
    if (!targets.length) targets.push(formModuleOpen() && formModuleModel ? 'module' : 'form');
    saveBatchFailed = false;
    targets.forEach(function (target) {
        saveTarget(target, target === 'module' ? formModuleModel.getValue() : model.getValue(), false);
    });
}

/* Одна запись одного файла. `force` — ответ на конфликт: файл изменился под
 * буфером, и пользователь выбрал буфер. */
function saveTarget(target, snapshot, force) {
    var saveId = String(nextSaveId++);
    pendingSaveSnapshots[saveId] = { target: target, snapshot: snapshot };
    var msg = { cmd: 'save', content: snapshot, saveId: saveId };
    if (target === 'module') msg.target = 'module';
    if (force) msg.force = true;
    send(msg);
}

// ------------------------------------------------------------------ commit
/* Коммит открытого файла или всего объекта 1С, к которому он относится.
 * Что именно войдёт в коммит, решает хост по пути открытого файла; страница
 * выбирает только охват и сообщение. Несохранённое в коммит не попадает. */
var commitKey = 'file';

function commitEl(id) { return document.getElementById(id); }

function commitError(text) {
    var box = commitEl('commit-error');
    box.textContent = text || '';
    box.hidden = !text;
}

function openCommitPrompt() {
    if (!gitAvailable()) return;
    commitKey = gitTargetKey();
    commitEl('commit-prompt').hidden = false;
    commitEl('commit-file').textContent = '…';
    commitEl('commit-object').textContent = '…';
    commitEl('commit-branch').textContent = '';
    commitEl('commit-ok').disabled = true;
    commitError(anyDirty() ? 'Есть несохранённые изменения — в коммит попадёт только то, что записано на диск.' : '');
    var message = commitEl('commit-message');
    message.focus();
    gitSend({ cmd: 'gitCommitPlan', target: commitKey }, function (d) {
        if (!d || !d.ok) { commitError((d && d.error) || 'git недоступен'); return; }
        commitEl('commit-branch').textContent = d.branch ? '(' + d.branch + ')' : '';
        commitEl('commit-file').textContent = d.file;
        var object = d.object || [];
        var whole = object.length > 1 || (object.length === 1 && object[0] !== d.file);
        /* По пути на строку: через запятую длинные пути сливаются в кашу. */
        commitEl('commit-object').textContent = whole ? object.join('\n') : 'файл не входит в объект';
        var radios = document.querySelectorAll('input[name="commit-scope"]');
        radios[1].disabled = !whole;
        /* Из окна объекта естественнее коммитить объект целиком. */
        var preferObject = whole && currentProvider() && currentProvider().id === 'metadata';
        radios[preferObject ? 1 : 0].checked = true;
        commitEl('commit-ok').disabled = false;
    });
}

function closeCommitPrompt() {
    commitEl('commit-prompt').hidden = true;
    commitError('');
}

function runCommit() {
    var message = commitEl('commit-message').value;
    if (!message.trim()) { commitError('Введите сообщение коммита.'); commitEl('commit-message').focus(); return; }
    var scope = document.querySelector('input[name="commit-scope"]:checked');
    var ok = commitEl('commit-ok');
    ok.disabled = true;
    commitError('');
    gitSend({ cmd: 'gitCommit', target: commitKey, scope: scope ? scope.value : 'file', message: message }, function (d) {
        ok.disabled = false;
        if (!d || !d.ok) { commitError((d && d.error) || 'Коммит не выполнен'); return; }
        commitEl('commit-message').value = '';
        closeCommitPrompt();
        var btn = commitEl('btn-commit');
        btn.classList.add('save-ok');
        btn.title = 'Закоммичено' + (d.id ? ' ' + d.id : '');
        setTimeout(function () { btn.classList.remove('save-ok'); btn.title = 'Закоммитить в git'; }, 2500);
        requestGitInfo(commitKey);
    });
}

function wireCommitPrompt() {
    commitEl('btn-commit').addEventListener('click', openCommitPrompt);
    commitEl('commit-ok').addEventListener('click', runCommit);
    commitEl('commit-cancel').addEventListener('click', closeCommitPrompt);
    commitEl('commit-prompt').addEventListener('keydown', function (e) {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeCommitPrompt(); }
        else if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); e.stopPropagation(); runCommit(); }
    });
}

// ------------------------------------------------------------------ search

/* A global-search result opens on its exact hit and seeds Monaco's find
 * controller. The widget may stay closed: its F3 command still continues
 * from the selected occurrence with the same text and options. */
function applyInitialSearch(req) {
    if (!editor || !model || !req) return;
    if (!(Number(req.line) > 0) && !req.search) return;
    var line = Math.max(1, Math.min(model.getLineCount(), Number(req.line) || 1));
    var search = String(req.search || '');
    var match = search && model.findNextMatch
        ? model.findNextMatch(search, { lineNumber: line, column: 1 }, !!req.regexp,
            !!req.matchCase, null, false) : null;
    if (match && match.range.startLineNumber === line) {
        editor.setSelection(match.range);
        editor.revealRangeInCenterIfOutsideViewport(match.range);
    } else {
        editor.setPosition({ lineNumber: line, column: 1 });
        editor.revealLineInCenterIfOutsideViewport(line);
    }
    if (search && editor.getContribution) {
        var controller = editor.getContribution('editor.contrib.findController');
        var findState = controller && controller.getState && controller.getState();
        if (findState && findState.change) {
            findState.change({ searchString: search, isRegex: !!req.regexp,
                matchCase: !!req.matchCase }, false);
        } else if (controller && controller.setSearchString) {
            controller.setSearchString(search);
        }
    }
    editor.focus();
}

function doFind(req) {
    var model = editor && editor.getModel();
    if (!editor || !model || !req.text) return;
    var sel = editor.getSelection();
    var from = req.first
        ? { lineNumber: 1, column: 1 }
        : (req.backwards ? sel.getStartPosition() : sel.getEndPosition());

    var match = req.backwards
        ? model.findPreviousMatch(req.text, from, false, !!req.matchCase, req.wholeWords ? ' \t\n(),;<>/' : null, false)
        : model.findNextMatch(req.text, from, false, !!req.matchCase, req.wholeWords ? ' \t\n(),;<>/' : null, false);

    if (!match) return;
    editor.setSelection(match.range);
    editor.revealRangeInCenterIfOutsideViewport(match.range);
    editor.focus();
}

// ----------------------------------------------------------------- preview
// Markdown/HTML: editor on the left, rendered page on the right. Scroll is
// mapped via source-line anchors (markdown) or height ratio (html). Typing
// refreshes the right pane without hiding the source.

var markedLoading = null;
var turndownLoading = null;
var previewTimer = null;
var previewSyncLock = 0;     // 1 = driven by editor, 2 = driven by preview
var previewScrollWired = false;
var applyingFromPreview = false;
var previewInputTimer = null;
var highlightSyncLock = 0;   // 1 = driven by editor, 2 = driven by preview
var revealHlTimer = null;

function loadScriptNoAmd(url) {
    return new Promise(function (resolve) {
        var s = document.createElement('script');
        s.src = url;
        var amd = (typeof define === 'function' && define.amd) ? define.amd : null;
        if (amd) define.amd = null;
        var done = function () {
            if (amd && typeof define === 'function') define.amd = amd;
            resolve();
        };
        s.onload = s.onerror = done;
        document.head.appendChild(s);
    });
}

function loadMarked() {
    if (window.marked) return Promise.resolve();
    if (!markedLoading) markedLoading = loadScriptNoAmd(MARKED_URL);
    return markedLoading;
}

function loadTurndown() {
    if (window.TurndownService) return Promise.resolve();
    if (!turndownLoading) turndownLoading = loadScriptNoAmd(TURNDOWN_URL);
    return turndownLoading;
}

function loadPreviewDeps() {
    if (state.language !== 'markdown') return Promise.resolve();
    /* Turndown is only needed once the user edits inside the preview. */
    loadTurndown();
    return loadMarked();
}

function countNewlines(s) {
    var n = 0;
    for (var i = 0; i < s.length; i++) if (s.charCodeAt(i) === 10) n++;
    return n;
}

function tokenEndLine(start, raw) {
    if (!raw) return start;
    var n = countNewlines(raw);
    if (!n) return start;
    return (raw.charCodeAt(raw.length - 1) === 10) ? start + n - 1 : start + n;
}

function renderMarkdown(src) {
    try {
        if (window.marked) {
            if (marked.setOptions) marked.setOptions({ gfm: true, breaks: false });
            if (typeof marked.lexer === 'function' && typeof marked.parser === 'function') {
                var tokens = marked.lexer(src);
                var line = 1;
                var html = [];
                for (var i = 0; i < tokens.length; i++) {
                    var t = tokens[i];
                    var start = line;
                    var end = tokenEndLine(start, t.raw);
                    if (t.raw) line += countNewlines(t.raw);
                    if (t.type === 'space' || t.type === 'def') continue;
                    var one = [t];
                    if (tokens.links) one.links = tokens.links;
                    html.push('<div class="md-block" data-line="' + start + '" data-end="' + end + '">'
                        + marked.parser(one) + '</div>');
                }
                return html.join('');
            }
            return marked.parse(src);
        }
    } catch (e) { /* fall through to plain text */ }
    return '<pre>' + esc(src) + '</pre>';
}

function previewCss() {
    var dk = state.isDark;
    return 'html{position:relative;margin:0;padding:0;background:'
         + (dk ? '#1e1e1e' : '#ffffff') + '}'
         + 'body{margin:0;padding:16px 22px 48px;background:'
         + (dk ? '#1e1e1e' : '#ffffff') + ';color:' + (dk ? '#d4d4d4' : '#24292e') + ';'
         + 'font-family:Segoe UI,Arial,sans-serif;line-height:1.6}'
         + '.md-block{scroll-margin-top:8px}'
         + '.md-block.md-hl-line{background:' + (dk ? 'rgba(55,148,255,0.12)' : 'rgba(0,120,212,0.10)') + ';border-radius:4px}'
         + '.md-block.md-hl-sel{background:' + (dk ? 'rgba(38,79,120,0.42)' : 'rgba(255,232,119,0.50)') + ';border-radius:4px}'
         + '#md-sync-hl{position:absolute;left:0;right:0;pointer-events:none;z-index:5;box-sizing:border-box;'
         + 'border-left:3px solid ' + (dk ? '#3794ff' : '#0078d4') + ';'
         + 'background:' + (dk ? 'rgba(55,148,255,0.14)' : 'rgba(0,120,212,0.12)') + '}'
         + '#md-sync-hl.md-sync-sel{border-left-color:' + (dk ? '#4fc1ff' : '#c9a227') + ';'
         + 'background:' + (dk ? 'rgba(38,79,120,0.48)' : 'rgba(255,232,119,0.42)') + '}'
         + '::selection{background:' + (dk ? '#264F78' : '#ffe877') + '}'
         + '::highlight(md-sel){background:' + (dk ? 'rgba(38,79,120,0.85)' : 'rgba(255,232,119,0.9)') + '}'
         + '[contenteditable="true"]{outline:none;caret-color:' + (dk ? '#d4d4d4' : '#24292e') + ';min-height:70vh;cursor:text}'
         + '[contenteditable="true"]:focus{box-shadow:none}'
         + 'pre{background:' + (dk ? '#2d2d2d' : '#f6f8fa') + ';padding:12px;border-radius:4px;overflow:auto;max-width:100%}'
         + 'code{font-family:Consolas,monospace;background:' + (dk ? '#2d2d2d' : '#f6f8fa') + ';padding:2px 4px;border-radius:3px}'
         + 'pre code{background:none;padding:0}'
         + 'h1,h2,h3{border-bottom:1px solid ' + (dk ? '#333' : '#eaecef') + ';padding-bottom:6px}'
         + 'h1:first-child,h2:first-child,h3:first-child{margin-top:0}'
         + 'a{color:' + (dk ? '#58a6ff' : '#0366d6') + '}'
         + 'table{border-collapse:collapse;max-width:100%}'
         + 'td,th{border:1px solid ' + (dk ? '#444' : '#ddd') + ';padding:4px 8px;overflow-wrap:anywhere}'
         + 'img{max-width:100%;height:auto}'
         + 'blockquote{border-left:4px solid ' + (dk ? '#444' : '#dfe2e5') + ';margin:0;padding:0 12px;color:' + (dk ? '#9e9e9e' : '#6a737d') + '}'
         + 'hr{border:none;border-top:1px solid ' + (dk ? '#333' : '#eaecef') + '}';
}

function buildPreviewDoc() {
    var content = model.getValue();
    if (state.language === 'html') return content;
    return '<!DOCTYPE html><html><head><meta charset="utf-8"><style>' + previewCss()
         + '</style></head><body><div id="md-root">' + renderMarkdown(content) + '</div></body></html>';
}

function previewFrame() { return document.getElementById('preview'); }

function previewWin() {
    var f = previewFrame();
    return (f && f.contentWindow) ? f.contentWindow : null;
}

function applyPreviewTheme() {
    if (!state.previewMode) return;
    if (isDocPreview()) {
        refreshDocPreview();
        return;
    }
    if (state.language !== 'markdown') return;
    var doc = previewFrame().contentDocument;
    if (!doc) return;
    var st = doc.querySelector('style');
    if (st) st.textContent = previewCss();
}

function schedulePreviewRefresh() {
    if (!state.previewMode || !model || applyingFromPreview) return;
    if (previewHasFocus()) return;
    if (previewTimer) clearTimeout(previewTimer);
    previewTimer = setTimeout(function () {
        previewTimer = null;
        if (previewHasFocus()) return;
        refreshPreviewContent();
        if (isDocPreview()) return;
        applyPreviewEditable();
        syncPreviewFromEditor();
        syncHighlightFromEditor();
    }, 120);
}

/* Draws the active provider's document into the preview host. The content can
 * stop being a form or a template while it is edited, so the provider is
 * re-detected on every refresh; the message shown when nothing claims it any
 * more keeps the wording of the provider that was active. */
function refreshDocPreview() {
    var host = formPreviewEl();
    var was = currentProvider();
    if (!host || !model || !was) return;
    var src = was.id === 'sarif' ? sarifReportContent : model.getValue();
    var p = detectProvider(src);
    state.previewId = p ? p.id : '';
    if (!p) {
        // Editing can turn a previewable document into ordinary XML. Leave
        // preview mode immediately so the user always has a visible editor
        // and a button to switch back after the provider disappears.
        setPreviewMode(false);
        return;
    }
    var parsed = p.id === 'sarif' && sarifParsedModel ? { model: sarifParsedModel } : parseWithProvider(p, src);
    if (parsed.error) {
        showPreviewMessage(host, p, parsed.error);
        return;
    }
    if (p.id === 'metadata' && /\.mdo$/i.test(state.filePath)
            && parsed.model.kind === 'CommonForm') {
        if (parsed.model.nodes.Own) parsed.model.nodes.Own.open = 'Form.form';
        parsed.model.modules.forEach(function (module) { module.open = 'Module.bsl'; });
    }
    if (p.id === 'template') parsed = { model: templateSheetModel(parsed.model) };
    /* A redraw throws the scrolled sheet away and builds a new one at the top.
     * The user is working somewhere in the middle of it, so the position is
     * taken back afterwards. */
    var scrolled = host.querySelector('.tp-scroll');
    var keepTop = scrolled ? scrolled.scrollTop : 0;
    var keepLeft = scrolled ? scrolled.scrollLeft : 0;
    window[p.viewer].render(parsed.model, host, {
        onSelect: p.id === 'sarif' ? onSarifSelect : onDocPreviewSelect,
        onOpen: !(window.chrome && window.chrome.webview) ? null : p.id === 'configuration' ? openInWindow : openRelated,
        onHelp: window.chrome && window.chrome.webview ? showHelp : null,
        sortByName: !!state.sortByName,
        probe: window.chrome && window.chrome.webview ? relatedExists : null,
        windowTitle: state.formTitle,
        io: p.usesConfigurationIo || p.id === 'metadata' ? formContextIo : null,
        queryEditor: p.id === 'dcs' ? createQueryEditor : null,
        /* Hand editing of the schema is closed (dcsLocked); the handlers stay
         * for when it opens again. */
        onPropertyEdit: null,
        onSchemaEdit: null,
        onObjectEdit: p.id === 'metadata' && state.isEditing && !state.readOnly ? onObjectEdit : null,
        onOutlineChanged: function () {
            allItems = [];
            renderOutline();
            setTimeout(refreshOutline, 0);
        },
        filePath: state.filePath
    });
    if (p.id === 'template') {
        var back = host.querySelector('.tp-scroll');
        if (back && (keepTop || keepLeft)) {
            back.scrollTop = keepTop;
            back.scrollLeft = keepLeft;
        }
        bindTemplateEditing(host, parsed.model);
    }
    syncHelpButton();
    /* A redrawn document keeps the selection the outline already shows. */
    if (p.selectHighlightsPreview && state.formSelectedId && window[p.viewer].highlight)
        window[p.viewer].highlight(host, state.formSelectedId);
    scheduleFormFit();
}

/* The query of a data composition schema's data set, shown in a Monaco editor
 * of its own inside the schema window — read-only: a query is rewritten in the
 * source or in the query designer, not from the schema window. No theme
 * option: Monaco has one theme per page, and the main editor owns it. */
function createQueryEditor(host, text, opts) {
    if (!window.monaco || !monaco.editor) return null;
    var queryModel = monaco.editor.createModel(text || '', 'bsl_query');
    var queryEditor = monaco.editor.create(host, {
        model: queryModel,
        readOnly: !!opts.readOnly,
        fontSize: Math.max(11, (state.fontSize || 14) - 1),
        fontFamily: "Consolas, 'Courier New', monospace",
        fontLigatures: false,
        disableLayerHinting: true,
        minimap: { enabled: false },
        lineNumbers: 'on',
        scrollBeyondLastLine: false,
        automaticLayout: true,
        wordWrap: 'off',
        links: false,
        contextmenu: true,
        unicodeHighlight: { ambiguousCharacters: false, invisibleCharacters: false }
    });
    return {
        dispose: function () {
            queryEditor.dispose();
            queryModel.dispose();
        }
    };
}

var dcsOutlineTimer = null;

/* A property changed in the schema window (an expression, a title, a flag, a
 * parameter value): one undoable edit of the source. The window redraws from
 * the source handed back; an { error } keeps its editor open. */
function onDcsPropertyEdit(id, prop, value) {
    var p = currentProvider();
    if (!model || !p || p.id !== 'dcs' || !state.isEditing) return null;
    var parsed = parseWithProvider(p, model.getValue());
    var edit = parsed && parsed.model ? DcsPreview.propertyEdit(parsed.model, id, prop, value) : null;
    if (!edit) return null;
    if (edit.error) return { error: edit.error };
    applyDcsEdit(edit);
    /* Each property change is an undo step of its own. */
    model.pushStackElement();
    return { source: model.getValue() };
}

/* A change the schema window computes itself (adding a field, a calculated
 * field, a resource): `compute` gets the source freshly parsed and returns
 * the edit. One undoable edit; the new record's id goes back with the source. */
function onDcsSchemaEdit(compute) {
    var p = currentProvider();
    if (!model || !p || p.id !== 'dcs' || !state.isEditing) return null;
    var parsed = parseWithProvider(p, model.getValue());
    var edit = parsed && parsed.model ? compute(parsed.model) : null;
    if (!edit) return null;
    if (edit.error) return { error: edit.error };
    applyDcsEdit(edit);
    model.pushStackElement();
    return { source: model.getValue(), id: edit.id };
}

/* The object window's name, synonym or comment, written into its XML as one
 * undoable edit; the toolbar's floppy saves it like any other change. */
function onObjectEdit(prop, value) {
    var p = currentProvider();
    if (!model || !p || p.id !== 'metadata' || !state.isEditing) return null;
    var edit = MetadataPreview.propertyEdit(model.getValue(), prop, value);
    if (!edit || edit.error) return edit;
    applyDcsEdit(edit);
    model.pushStackElement();
    syncDirtyMarks();
    applyChrome();
    return { source: model.getValue() };
}

function applyDcsEdit(edit) {
    var from = model.getPositionAt(edit.start);
    var to = model.getPositionAt(edit.end);
    if (model.getValueInRange(new monaco.Range(from.lineNumber, from.column, to.lineNumber, to.column)) === edit.text) return;
    applyingFromPreview = true;
    model.pushStackElement();
    model.pushEditOperations([], [{
        range: new monaco.Range(from.lineNumber, from.column, to.lineNumber, to.column),
        text: edit.text
    }], function () { return null; });
    applyingFromPreview = false;
    state.dirty = true;
    updateStatusBar();
    /* Lines below the edit moved: the outline follows once typing pauses. */
    if (dcsOutlineTimer) clearTimeout(dcsOutlineTimer);
    dcsOutlineTimer = setTimeout(function () {
        dcsOutlineTimer = null;
        if (isDocPreview()) refreshOutline();
    }, 500);
}

/* --------------------------------- editing a spreadsheet template or a form
 * The preview owns the selection and the toolbar (TemplateEdit); the markup
 * engine rewrites the document; this end turns that rewrite into ranges over
 * the Monaco model, so one toolbar click is one undo step and the source view
 * stays the same text the user would have typed. */

var templateSession = null;
var templateToolbar = null;
/* The selection outlives a redraw: the sheet is rebuilt from scratch after
 * every edit, and losing the range the user is working in would make the
 * toolbar unusable. */
var templateSelection = null;
var templateErrorTimer = null;
/* Set while a named area is being made the current selection, so the session's
 * own onSelect does not wipe the area highlight that click is about to draw. */
var templateAreaSelecting = false;
/* The parsed sheet the session works on, and the cell property panel that
 * shows what the selected cell has. Both belong to the current binding. */
var templateModel = null;
var templateProperties = null;

function showTemplateError(message) {
    var statusEl = document.getElementById('sb-status');
    if (!statusEl) return;
    statusEl.textContent = message || '';
    statusEl.classList.toggle('error', !!message);
    if (templateErrorTimer) clearTimeout(templateErrorTimer);
    if (message) templateErrorTimer = setTimeout(function () { showTemplateError(''); }, 6000);
}

/* A note is not a refusal: the edit went through and there is only something
 * worth knowing about it. Same line at the bottom, without the red, and it
 * stays a little longer because it is meant to be read, not reacted to. */
function showTemplateNote(message) {
    var statusEl = document.getElementById('sb-status');
    if (!statusEl) return;
    statusEl.textContent = message || '';
    statusEl.classList.remove('error');
    if (templateErrorTimer) clearTimeout(templateErrorTimer);
    if (message) templateErrorTimer = setTimeout(function () { showTemplateNote(''); }, 9000);
}

/* Several ranges from one engine call go in as a single edit operation, which
 * is what makes them a single undo step. The ranges are computed against the
 * text the model holds right now and never overlap. Shared by the spreadsheet
 * editor and the form property panel: both engines rewrite the document and
 * hand over the difference the same way. */
function applyPreviewEdits(edits) {
    if (!model || !edits || !edits.length) return;
    var ops = [];
    for (var i = 0; i < edits.length; i++) {
        var from = model.getPositionAt(edits[i].start);
        var to = model.getPositionAt(edits[i].end);
        ops.push({
            range: new monaco.Range(from.lineNumber, from.column, to.lineNumber, to.column),
            text: edits[i].text
        });
    }
    applyingFromPreview = true;
    model.pushStackElement();
    model.pushEditOperations([], ops, function () { return null; });
    model.pushStackElement();
    applyingFromPreview = false;
    state.dirty = true;
    updateStatusBar();
}

/* Puts an edit on screen. A change that stays inside its cells repaints only
 * the rows it touched: the sheet keeps its scroll position, the selection and
 * the focus, and the session, the toolbar and the property panel are not torn
 * down and built again. Anything else — a size, a merge, rows, columns, an
 * area — draws the sheet from scratch, and so does an incremental repaint that
 * the renderer refuses because the new document lays out differently. */
function refreshTemplateAfterEdit(dirty) {
    var host = formPreviewEl();
    var preview = window.TemplatePreview;
    if (host && model && templateSession && preview && preview.update
        && dirty && !dirty.structural) {
        var parsed = preview.parse(model.getValue());
        var next = parsed.error ? null : templateSheetModel(parsed.model);
        if (next && preview.update(next, host, dirty)) {
            templateModel = next;
            /* Hands the session the sheet it now shows and repaints the
             * selection onto the rows that were replaced. */
            templateSession.setModel(next);
            if (templateToolbar) templateToolbar.sync();
            renderPropertyInspector();
            return;
        }
    }
    refreshDocPreview();
}

/* Ctrl+Z over a drawn document. Every change made in a picture — a cell of a
 * template, a form property, a data composition schema — is written as an undo
 * step of the Monaco model, but Monaco only hears the keyboard while its own
 * editor has the focus, and while the picture is being edited the focus is in
 * the picture. Without this the step is on the stack and nothing can reach it.
 *
 * A field being typed into keeps its own undo: the browser's, over that field.
 * Focus inside the editor is Monaco's own business and is left alone. */
function previewUndoKey(ev, editorDom) {
    if (!ev || !(ev.ctrlKey || ev.metaKey) || ev.altKey) return '';
    var key = String(ev.key || '').toLowerCase();
    /* `key` follows the active keyboard layout (Ctrl+Z can arrive as the
     * Russian letter «я»). `code` identifies the physical shortcut key. */
    var code = String(ev.code || '');
    if (code === 'KeyZ') key = 'z';
    else if (code === 'KeyY') key = 'y';
    if (key !== 'z' && key !== 'y') return '';
    var target = ev.target;
    /* A field being typed into keeps its own undo: the browser's, over that
     * field. Focus inside the editor is Monaco's own business. */
    if (target && target.closest && target.closest('input, textarea, [contenteditable="true"]')) return '';
    if (editorDom && target && editorDom.contains && editorDom.contains(target)) return '';
    return (key === 'y' || ev.shiftKey) ? 'redo' : 'undo';
}

function onPreviewUndoKey(ev) {
    if (!model || !state.isEditing || state.readOnly || state.sarifMode) return;
    if (!(state.previewMode && isDocPreview())) return;
    /* The module tab shows a different document in the same editor; undo there
     * belongs to Monaco and to that model, not to the picture's XML. */
    if (formModuleOpen()) return;
    var what = previewUndoKey(ev, editor && editor.getDomNode ? editor.getDomNode() : null);
    if (!what) return;
    if (!undoDocument(what === 'redo')) return;
    ev.preventDefault();
}

/* One step back (or forward) through the document the picture is drawn from,
 * and the picture drawn again from what is left. The redraw is done here
 * rather than left to the model's change hook so the sheet is never redrawn
 * twice for one keystroke. */
function undoDocument(redo) {
    var target = undoTargetModel();
    if (!target) return false;
    var fn = redo ? 'redo' : 'undo';
    /* A picture is redrawn here rather than by the model's change hook, so it
     * is never drawn twice for one step. */
    var picture = previewUndoTarget();
    var before = target.getValue();
    applyingFromPreview = picture;
    try {
        /* The model undoes itself whoever holds the focus. Monaco's own undo
         * command runs on the focused editor, and while a picture is edited
         * the focus is in the picture: the command reached nothing and the
         * step stayed on the stack. */
        if (typeof target[fn] === 'function') target[fn]();
        else if (editor && editor.getModel && editor.getModel() === target) editor.trigger('preview', fn, null);
    } finally {
        applyingFromPreview = false;
    }
    if (target.getValue() === before) return false;
    /* Undone all the way back to what is on disk, the document is not dirty
     * any more: 1C drops the star there, and so does this. */
    if (target === formModuleModel)
        state.moduleDirty = modelDirty(target, moduleBaselineContent, moduleBaselineVersion);
    else state.dirty = modelDirty(target, baselineContent, baselineVersion);
    updateStatusBar();
    if (picture) refreshDocPreview();
    return true;
}

/* The document a step back belongs to: the module tab edits its own model in
 * the same editor, everything else edits the file itself. */
function undoTargetModel() {
    return formModuleOpen() ? (formModuleModel || model) : model;
}

/* True when the step is taken over a drawn document rather than over the
 * source Monaco shows. */
function previewUndoTarget() {
    return !!(state.previewMode && isDocPreview()) && !formModuleOpen();
}

/* The toolbar's own undo and redo: the same step the keyboard takes, for a
 * user working with the mouse in a picture. */
function undoFromToolbar(redo) {
    if (!state.isEditing || state.readOnly || state.sarifMode) return;
    undoDocument(redo);
    syncUndoButtons();
}

/* Both buttons show up wherever saving does — the modes where an edit is being
 * made — and go grey when there is nothing left on the stack. */
function syncUndoButtons() {
    var undoBtn = document.getElementById('btn-undo');
    var redoBtn = document.getElementById('btn-redo');
    if (!undoBtn || !redoBtn) return;
    var on = !state.sarifMode && (sourceEditingActive() || previewEditingActive());
    undoBtn.style.display = redoBtn.style.display = on ? '' : 'none';
    var target = on ? undoTargetModel() : null;
    undoBtn.disabled = !(target && (!target.canUndo || target.canUndo()));
    redoBtn.disabled = !(target && (!target.canRedo || target.canRedo()));
}

/* Unsaved changes have to be visible: the save button is marked, and the host
 * puts a star after the file name in the window title, the way 1C does. */
var lastReportedDirty = null;
function syncDirtyMarks() {
    var dirty = !state.sarifMode && anyDirty();
    var btnSave = document.getElementById('btn-save');
    if (btnSave) btnSave.classList.toggle('dirty', dirty);
    /* Который из двух файлов не сохранён, а не только «есть ли такой»: хост
     * держит маркер занятости по файлу и по файлу же решает, можно ли заменить
     * документ, изменившийся на диске. */
    var fileDirty = !state.sarifMode && !!state.dirty;
    var moduleDirty = !state.sarifMode && !!state.moduleDirty;
    var stamp = (dirty ? '1' : '0') + (fileDirty ? '1' : '0') + (moduleDirty ? '1' : '0');
    if (stamp === lastReportedDirty) return;
    lastReportedDirty = stamp;
    /* Первая правка сама делает возможным сравнение с файлом на диске, а
     * applyChrome() при наборе текста не вызывается. */
    var diffBtn = document.getElementById('btn-diff');
    if (diffBtn) diffBtn.style.display = (diffAvailable() || diffOpen) ? '' : 'none';
    send({ cmd: 'dirty', dirty: dirty, file: fileDirty, module: moduleDirty });
}

/* True while a spreadsheet template is being edited: the cell property panel
 * takes the right pane only then, the way the form panel does. */
function templateEditingActive() {
    return state.previewId === 'template' && !!templateSession && !!state.isEditing && !state.readOnly;
}

/* The cell property panel mounted in the right pane, built once per session. */
function templatePropertyPanelFor(host) {
    if (!host || !window.TemplateEdit || !window.TemplateEdit.properties) return null;
    /* The panel outlives the session: the sheet is rebuilt after every edit,
     * and throwing the panel away with it would take the focus and the scroll
     * position out from under the user's hand. */
    if (templateProperties && templateProperties.host === host) {
        templateProperties.session = templateSession;
        templateProperties.panel.setSession(templateSession);
        return templateProperties.panel;
    }
    var panel = window.TemplateEdit.properties(document, templateSession, {
        model: function () { return templateModel; },
        readOnly: !!state.readOnly,
        onError: showTemplateError,
        onNote: showTemplateNote
    });
    if (!panel) return null;
    host.innerHTML = '';
    host.appendChild(panel.element);
    templateProperties = { host: host, session: templateSession, panel: panel };
    /* A cell has two dozen properties and a sheet has a handful of areas, so
     * the pane opens the other way round from the form's: the tree keeps about
     * a third and the properties the rest. A height the user has already
     * dragged to wins over this. */
    var saved = 0;
    try { saved = parseInt(sessionStorage.getItem('1cFormViewer.propertyInspectorHeight'), 10) || 0; }
    catch (error) { saved = 0; }
    if (!saved) {
        host.style.flex = '0 1 70%';
        host.style.height = '';
    }
    return panel;
}

/* The sheet the user works on while editing: the document plus a few rows
 * under it. A template ends at its last row, and without them there is no way
 * to add anything below it — 1C and Excel simply go on downwards. They are
 * drawn paler, carry no content, and become real rows of the file as soon as
 * something is written into them. */
var TEMPLATE_TRAILING_ROWS = 3;
/* То же справа: без запасных колонок к макету нечего дописать правее
 * последней. Их меньше, чем строк: колонка шире и дороже по месту. */
var TEMPLATE_TRAILING_COLUMNS = 2;

function templateSheetModel(parsedModel) {
    var preview = window.TemplatePreview;
    if (!parsedModel || !preview || !preview.withTrailingRows) return parsedModel;
    if (!state.isEditing || state.readOnly) return parsedModel;
    var sheet = preview.withTrailingRows(parsedModel, TEMPLATE_TRAILING_ROWS);
    if (preview.withTrailingColumns)
        sheet = preview.withTrailingColumns(sheet, TEMPLATE_TRAILING_COLUMNS);
    return sheet;
}

/* Attaches the editing session to a freshly rendered sheet. Called from
 * refreshDocPreview, which rebuilds the DOM, so the previous session and its
 * toolbar are dropped every time. */
function bindTemplateEditing(host, parsedModel) {
    if (templateSession) {
        templateSession.destroy();
        templateSession = null;
    }
    templateToolbar = null;
    templateModel = parsedModel;
    /* No session means no cell panel either: the pane has to let go of it. */
    if (!host || !window.TemplateEdit || !window.TemplateMarkup) { renderPropertyInspector(); return; }
    /* Viewing selects cells exactly as editing does, but changes nothing:
     * no toolbar, no cell panel, a session that refuses every edit. */
    if (!state.isEditing || state.readOnly) {
        templateSession = window.TemplateEdit.attach(host, {
            model: parsedModel,
            xml: function () { return model.getValue(); },
            readOnly: true,
            onSelect: function (selection) {
                templateSelection = selection;
                if (!templateAreaSelecting && window.TemplatePreview && window.TemplatePreview.clearHighlight) {
                    window.TemplatePreview.clearHighlight(host);
                }
            }
        }) || null;
        if (templateSession && templateSelection) templateSession.select(templateSelection);
        renderPropertyInspector();
        return;
    }

    var session = window.TemplateEdit.attach(host, {
        model: parsedModel,
        xml: function () { return model.getValue(); },
        apply: function (edits, next, result, dirty) {
            applyPreviewEdits(edits);
            showTemplateError('');
            refreshTemplateAfterEdit(dirty);
        },
        onError: showTemplateError,
        /* «Свойства» in the cell menu: the panel is already in the right pane,
         * so the command brings the pane forward and puts the focus in it. */
        onProperties: function () {
            var panel = document.getElementById('property-inspector');
            if (!panel) return;
            renderPropertyInspector();
            if (panel.scrollIntoView) panel.scrollIntoView({ block: 'nearest' });
            var first = panel.querySelector('input, select, button');
            if (first && first.focus) first.focus();
        },
        onSelect: function (selection) {
            templateSelection = selection;
            /* A range picked in the sheet replaces the named area the outline
             * points at: the sheet must never show two selections at once. */
            if (!templateAreaSelecting && window.TemplatePreview && window.TemplatePreview.clearHighlight) {
                window.TemplatePreview.clearHighlight(host);
            }
            if (templateToolbar) templateToolbar.sync();
            renderPropertyInspector();
        }
    });
    if (!session) return;
    templateSession = session;

    var built = window.TemplateEdit.toolbar(document, session, {
        /* The model is replaced by every edit, so the toolbar reads the
         * current one rather than the one this binding started with. */
        model: function () { return templateModel; },
        readOnly: !!state.readOnly,
        onError: showTemplateError
    });
    if (built) {
        templateToolbar = built;
        host.insertBefore(built.element, host.firstChild);
    }
    if (templateSelection) session.select(templateSelection);
    else if (templateToolbar) templateToolbar.sync();
    renderPropertyInspector();
}

/* «Вписать по ширине»: a form wider than the pane is zoomed out until its
 * minimum layout fits. The form still stretches like a 1C window, so one
 * narrower than the pane is never scaled up. Zoom rather than transform keeps
 * scrolling, hit-testing and the layout width in step. */
function scheduleFormFit() {
    var host = formPreviewEl();
    var token = ++formFitToken;
    syncFormFitButton();
    if (!host) return;
    host.classList.remove('fp-fit-width');
    host.style.removeProperty('--fp-fit-zoom');
    if (!formFitWidth || !isFormView() || !formPreviewOpen()
        || document.documentElement.classList.contains('screenshot-mode')) return;
    function afterLayout(fn) {
        requestAnimationFrame(function () {
            requestAnimationFrame(function () { if (token === formFitToken) fn(); });
        });
    }
    /* The form relays itself out at every zoom, so its minimum width moves a
     * little: converge over a few passes instead of trusting one measurement. */
    var zoom = 1, passes = 0;
    function step() {
        var body = host.querySelector('.fp-body');
        if (!body || body.scrollWidth <= body.clientWidth * 1.01 + 1 || zoom <= 0.3 || ++passes > 8) return;
        zoom = Math.max(0.3, zoom * body.clientWidth / body.scrollWidth * 0.99);
        host.style.setProperty('--fp-fit-zoom', String(zoom));
        host.classList.add('fp-fit-width');
        afterLayout(step);
    }
    afterLayout(step);
}

function syncFormFitButton() {
    var button = document.getElementById('btn-form-fit');
    if (!button) return;
    button.classList.toggle('active', formFitWidth);
    button.setAttribute('aria-pressed', formFitWidth ? 'true' : 'false');
}

function showPreviewMessage(host, provider, text) {
    host.className = provider.rootCls;
    host.innerHTML = '<div class="' + provider.emptyCls + '">' + esc(text) + '</div>';
}

/* Clicking an element in the rendered document jumps the editor to the source
 * line behind it and selects the matching outline row. */
function onDocPreviewSelect(item) {
    var p = currentProvider();
    if (!item || !editor || !p) return;
    var view = window[p.viewer];
    if (p.id === 'configuration' && item.inspectorOnly) {
        var selectedId = view.itemKey(item);
        if (!allItems.some(function (entry) { return entry.id === selectedId; })) {
            parseDocOutline();
            renderOutline();
        }
        if (allItems.some(function (entry) { return entry.id === selectedId; }))
            highlightFormOutline(selectedId);
        return;
    }
    if (!allItems.length) {
        parseDocOutline();
        renderOutline();
    }
    var id = view.itemKey(item);
    var line = 1;
    for (var i = 0; i < allItems.length; i++) {
        if (allItems[i].id === id || (p.selectMatchesByName && allItems[i].name === item.name)) {
            line = allItems[i].line;
            break;
        }
    }
    /* Template parameters have no outline entry of their own, so fall back to
     * finding the parameter name in the source. */
    if (line === 1 && p.selectMatchesByName && item.parameter) {
        var found = model.getValue().split(/\r?\n/);
        for (var k = 0; k < found.length; k++) {
            if (found[k].indexOf('>' + item.name + '<') >= 0 || found[k].indexOf('<parameter>' + item.name + '</parameter>') >= 0) {
                line = k + 1;
                break;
            }
        }
    }
    editor.revealLineInCenter(line);
    editor.setPosition({ lineNumber: line, column: 1 });
    highlightFormOutline(id);
    /* The form preview marks its own selection on click; the spreadsheet one
     * has to be told. */
    /* A clicked cell is keyed by its parameter name, which may coincide with a
     * named area («Контрагент» in a «Контрагент» row): the cell must not be
     * taken for that area, it keeps the selection the sheet already drew. */
    var isCell = p.id === 'template' && item.row != null;
    if (p.selectHighlightsPreview && view.highlight && !isCell) view.highlight(formPreviewEl(), id);
    /* A named area is a selection too, so it takes the place of whatever range
     * was selected in the sheet before. */
    if (!isCell && p.id === 'template' && templateSession && templateSession.selectArea) {
        templateAreaSelecting = true;
        try { templateSession.selectArea(item.name || id); }
        finally { templateAreaSelecting = false; }
    }
}

function highlightFormOutline(id) {
    state.formSelectedId = id ? String(id) : '';
    var treeView = docTree() ? previewView() : null;
    if (treeView && treeView.outlineExpandTo && treeView.outlineExpandTo(allItems, id, state.outlineCollapsed)) {
        renderOutline();
        return;
    }
    highlightOutlineRow(state.formSelectedId);
    /* The arrows act on the selected element, so they follow the selection. */
    syncFormMoveButtons();
    renderPropertyInspector();
    updateStatusBar();
}

function highlightOutlineRow(id) {
    var selectedId = id ? String(id) : '';
    var rows = document.querySelectorAll('.proc-item.form-el');
    var hit = null;
    for (var r = 0; r < rows.length; r++) {
        var on = rows[r].getAttribute('data-id') === selectedId;
        rows[r].classList.toggle('selected', on);
        rows[r].style.background = '';
        if (on) hit = rows[r];
    }
    if (hit && hit.scrollIntoView) {
        try { hit.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
        catch (e) { hit.scrollIntoView(); }
    }
}

function hideFormPreview() {
    var host = formPreviewEl();
    if (!host) return;
    var view = previewView();
    if (view && view.dismiss) view.dismiss(host);
    host.style.display = 'none';
    host.hidden = true;
    host.innerHTML = '';
}

function refreshPreviewContent() {
    if (!state.previewMode || !model) return;
    /* Either a provider already owns the view, or one claims the new content. */
    var p = currentProvider() || detectProvider(model.getValue());
    if (p) {
        var wasId = state.previewId;
        state.previewId = p.id;
        refreshDocPreview();
        parseDocOutline();
        renderOutline();
        /* Editing can turn a form into a template and back, and the outline
         * titles and fold buttons belong to the provider, not to the file. */
        if (state.previewId !== wasId) applyChrome();
        return;
    }
    var frame = previewFrame();
    var doc = frame.contentDocument;
    if (state.language === 'markdown' && doc) {
        var root = doc.getElementById('md-root');
        if (root) {
            root.innerHTML = renderMarkdown(model.getValue());
            return;
        }
    }
    frame.srcdoc = buildPreviewDoc();
}

function setPreviewMode(on, onShown) {
    var frame = previewFrame();
    var formEl = formPreviewEl();
    var editorEl = document.getElementById('editor');
    var handle = document.getElementById('preview-handle');
    var btn = document.getElementById('btn-preview');
    var tabsEl = document.getElementById('form-workbench-tabs');
    var apply = function () {
        state.previewMode = on;
        state.previewPending = false;
        if (on) {
            /* Переключатель вида только меняет значок: подсветка читалась
             * бы как включённый режим, а вида здесь два равноправных. */
            if (isDocPreview()) {
                var provider = currentProvider();
                if (provider && provider.keepsEditor) {
                    editorEl.style.display = '';
                    editorEl.style.width = '';
                    editorEl.style.flex = '1';
                    editorEl.style.order = '0';
                    handle.style.display = 'block';
                    handle.style.order = provider.previewFirst ? '-1' : '';
                    formEl.style.order = provider.previewFirst ? '-2' : '';
                    formEl.style.flex = '0 0 34%';
                    formEl.style.minWidth = '280px';
                } else {
                    editorEl.style.display = 'none';
                    editorEl.style.width = '';
                    editorEl.style.flex = '';
                    editorEl.style.order = '';
                    handle.style.display = 'none';
                    handle.style.order = '';
                    formEl.style.order = '';
                    formEl.style.minWidth = '';
                    formEl.style.flex = '1';
                }
                frame.style.display = 'none';
                frame.removeAttribute('srcdoc');
                formEl.hidden = false;
                formEl.style.display = 'flex';
                btn.title = provider && provider.sourceTitle || 'Показать исходник';
                /* applyTheme() below renders the document; doing it here too
                 * laid the whole form out twice on every open. */
            } else {
                hideFormPreview();
                var sourceToo = state.textLayout !== 'preview';
                editorEl.style.display = sourceToo ? '' : 'none';
                handle.style.display = sourceToo ? 'block' : 'none';
                frame.style.display = 'block';
                if (onShown) {
                    var shown = onShown;
                    onShown = null;
                    var fired = false;
                    var once = function () {
                        if (fired) return;
                        fired = true;
                        frame.removeEventListener('load', once);
                        shown();
                    };
                    frame.addEventListener('load', once);
                    setTimeout(once, 1500);
                }
                frame.srcdoc = buildPreviewDoc();
                btn.title = 'Скрыть превью';
                applyTextPreviewLayout();
            }
            if (editor) editor.layout();
            applyPreviewEditable();
        } else {
            if (previewTimer) { clearTimeout(previewTimer); previewTimer = null; }
            handle.style.display = 'none';
            frame.style.display = 'none';
            frame.removeAttribute('srcdoc');
            hideFormPreview();
            tabsEl.hidden = true;
            editorEl.style.display = '';
            editorEl.style.flex = '1';
            editorEl.style.width = '';
            editorEl.style.order = '';
            formEl.style.order = '';
            formEl.style.minWidth = '';
            btn.classList.remove('active');
            var shown = currentProvider();
            btn.title = shown ? shown.sourceTitle : 'Исходник и просмотр';
            if (editor) editor.layout();
        }
        applyFormWorkbenchView(state.formWorkbenchView);
        applyTheme();
        if (onShown) onShown();
    };
    if (on && (state.language === 'markdown' || state.language === 'html'))
        loadPreviewDeps().then(apply);
    else apply();
}

function applyFormWorkbenchView(view) {
    var available = !!(state.previewMode && isFormView() && state.formModulePath);
    var tabs = document.getElementById('form-workbench-tabs');
    tabs.hidden = !available;
    if (!available) view = 'form';
    state.formWorkbenchView = view === 'module' ? 'module' : 'form';
    var moduleOpen = state.formWorkbenchView === 'module';
    tabs.querySelectorAll('button[data-view]').forEach(function (button) {
        var active = button.getAttribute('data-view') === state.formWorkbenchView;
        button.classList.toggle('active', active);
        button.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    if (!moduleOpen) {
        if (editor && model && editor.getModel() !== model) editor.setModel(model);
        if (editor) editor.updateOptions(editingOptions(isBslModule()));
        refreshOutline();
        updateStatusBar();
        return;
    }
    if (editor && formModuleModel && editor.getModel() !== formModuleModel)
        editor.setModel(formModuleModel);
    if (editor) editor.updateOptions(editingOptions(true));
    var editorEl = document.getElementById('editor');
    editorEl.style.display = '';
    editorEl.style.flex = '1';
    editorEl.style.width = '';
    document.getElementById('preview').style.display = 'none';
    document.getElementById('preview-handle').style.display = 'none';
    document.getElementById('form-preview').hidden = true;
    document.getElementById('form-preview').style.display = 'none';
    refreshOutline();
    updateStatusBar();
    if (editor) editor.layout();
}

function switchFormWorkbenchView(view) {
    if (!state.previewMode || !isFormView() || !state.formModulePath) return;
    state.formWorkbenchView = view === 'module' ? 'module' : 'form';
    setPreviewMode(true);
}

function previewAnchors(win) {
    var doc = win.document;
    var els = doc.querySelectorAll('.md-block[data-line]');
    var a = [];
    for (var i = 0; i < els.length; i++) {
        var line = parseInt(els[i].getAttribute('data-line'), 10);
        if (!line) continue;
        a.push({ line: line, top: els[i].getBoundingClientRect().top + win.pageYOffset });
    }
    return a;
}

function editorLineFrac() {
    if (!editor || !model) return 1;
    var top = editor.getScrollTop();
    var lo = 1, hi = model.getLineCount();
    while (lo < hi) {
        var mid = (lo + hi + 1) >> 1;
        if (editor.getTopForLineNumber(mid) <= top) lo = mid;
        else hi = mid - 1;
    }
    var a = editor.getTopForLineNumber(lo);
    var b = (lo < model.getLineCount())
        ? editor.getTopForLineNumber(lo + 1)
        : a + editor.getOption(monaco.editor.EditorOption.lineHeight);
    var frac = (b > a) ? (top - a) / (b - a) : 0;
    if (frac < 0) frac = 0;
    if (frac > 1) frac = 1;
    return lo + frac;
}

function setEditorLineFrac(lineFrac) {
    if (!editor || !model) return;
    var last = model.getLineCount();
    var line = Math.floor(lineFrac);
    var frac = lineFrac - line;
    if (line < 1) { editor.setScrollTop(0); return; }
    if (line >= last) {
        var topLast = editor.getTopForLineNumber(last);
        var lh = editor.getOption(monaco.editor.EditorOption.lineHeight);
        editor.setScrollTop(topLast + frac * lh);
        return;
    }
    var a = editor.getTopForLineNumber(line);
    var b = editor.getTopForLineNumber(line + 1);
    editor.setScrollTop(a + frac * (b - a));
}

function mapLineToPreviewY(lineFrac, anchors, previewMax, lastLine) {
    if (!anchors.length) return null;
    if (lineFrac <= anchors[0].line) {
        var first = anchors[0].line;
        return first > 1 ? (lineFrac / first) * anchors[0].top : anchors[0].top;
    }
    for (var i = 0; i < anchors.length - 1; i++) {
        if (lineFrac < anchors[i + 1].line) {
            var span = anchors[i + 1].line - anchors[i].line;
            var t = span ? (lineFrac - anchors[i].line) / span : 0;
            return anchors[i].top + t * (anchors[i + 1].top - anchors[i].top);
        }
    }
    var last = anchors[anchors.length - 1];
    if (lastLine <= last.line) return last.top;
    var tEnd = (lineFrac - last.line) / (lastLine - last.line);
    if (tEnd < 0) tEnd = 0;
    if (tEnd > 1) tEnd = 1;
    return last.top + tEnd * Math.max(0, previewMax - last.top);
}

function mapPreviewYToLine(y, anchors, previewMax, lastLine) {
    if (!anchors.length) return null;
    if (y <= anchors[0].top) {
        var first = anchors[0].line;
        return first > 1 && anchors[0].top > 0 ? (y / anchors[0].top) * first : 1;
    }
    for (var i = 0; i < anchors.length - 1; i++) {
        if (y < anchors[i + 1].top) {
            var spanY = anchors[i + 1].top - anchors[i].top;
            var t = spanY ? (y - anchors[i].top) / spanY : 0;
            return anchors[i].line + t * (anchors[i + 1].line - anchors[i].line);
        }
    }
    var last = anchors[anchors.length - 1];
    var rest = previewMax - last.top;
    if (rest <= 0 || lastLine <= last.line) return last.line;
    var tEnd = (y - last.top) / rest;
    if (tEnd < 0) tEnd = 0;
    if (tEnd > 1) tEnd = 1;
    return last.line + tEnd * (lastLine - last.line);
}

function previewScrollMax(win) {
    var se = win.document.scrollingElement || win.document.documentElement;
    return Math.max(0, se.scrollHeight - win.innerHeight);
}

function syncByRatio(fromEditor) {
    if (!editor) return;
    var win = previewWin();
    if (!win) return;
    var edMax = Math.max(1, editor.getScrollHeight() - editor.getLayoutInfo().height);
    var pvMax = Math.max(1, previewScrollMax(win));
    if (fromEditor) win.scrollTo(0, (editor.getScrollTop() / edMax) * pvMax);
    else editor.setScrollTop((win.pageYOffset / pvMax) * edMax);
}

function syncPreviewFromEditor() {
    if (!state.previewMode || !editor) return;
    var win = previewWin();
    if (!win || !win.document) return;
    previewSyncLock = 1;
    var anchors = previewAnchors(win);
    if (anchors.length) {
        var y = mapLineToPreviewY(editorLineFrac(), anchors, previewScrollMax(win), model.getLineCount());
        if (y != null) win.scrollTo(0, y);
    } else {
        syncByRatio(true);
    }
    requestAnimationFrame(function () { if (previewSyncLock === 1) previewSyncLock = 0; });
}

function syncEditorFromPreview() {
    if (!state.previewMode || !editor) return;
    var win = previewWin();
    if (!win || !win.document) return;
    previewSyncLock = 2;
    var anchors = previewAnchors(win);
    if (anchors.length) {
        var lineFrac = mapPreviewYToLine(win.pageYOffset, anchors, previewScrollMax(win), model.getLineCount());
        if (lineFrac != null) setEditorLineFrac(lineFrac);
    } else {
        syncByRatio(false);
    }
    requestAnimationFrame(function () { if (previewSyncLock === 2) previewSyncLock = 0; });
}

function onPreviewScroll() {
    if (!state.previewMode || previewSyncLock === 1) return;
    syncEditorFromPreview();
}

function mdPreviewOn() {
    return !!(state.previewMode && state.language === 'markdown' && editor && model);
}

function clampLine(n) {
    var last = model.getLineCount();
    n = Math.round(n);
    if (n < 1) return 1;
    if (n > last) return last;
    return n;
}

function posToLineFrac(pos) {
    var maxCol = model.getLineMaxColumn(pos.lineNumber);
    var len = Math.max(1, maxCol - 1);
    var col = pos.column - 1;
    if (col < 0) col = 0;
    if (col > len) col = len;
    return pos.lineNumber + col / len;
}

function editorSelSpan() {
    var sel = editor.getSelection();
    if (!sel) {
        var p = editor.getPosition();
        var ln = p ? p.lineNumber : 1;
        return { startLine: ln, endLine: ln, yStart: ln, yEnd: ln + 1, isSel: false };
    }
    var a = sel.getStartPosition();
    var b = sel.getEndPosition();
    if (sel.isEmpty()) {
        return { startLine: a.lineNumber, endLine: a.lineNumber, yStart: a.lineNumber, yEnd: a.lineNumber + 1, isSel: false };
    }
    var endLine = b.lineNumber;
    if (b.column === 1 && endLine > a.lineNumber) endLine--;
    return {
        startLine: a.lineNumber,
        endLine: endLine,
        yStart: posToLineFrac(a),
        yEnd: posToLineFrac(b),
        isSel: true
    };
}

function mdBlockLineRange(el, nextEl, lastLine) {
    var start = parseInt(el.getAttribute('data-line'), 10) || 1;
    var endAttr = el.getAttribute('data-end');
    var end;
    if (endAttr) end = parseInt(endAttr, 10);
    else if (nextEl) end = (parseInt(nextEl.getAttribute('data-line'), 10) || start) - 1;
    else end = lastLine || start;
    if (!(end >= start)) end = start;
    return { start: start, end: end };
}

function closestMdBlock(node) {
    while (node && node.nodeType !== 1) node = node.parentNode;
    if (!node || !node.closest) return null;
    return node.closest('.md-block');
}

function previewAnchorBoxes(win) {
    var doc = win.document;
    var els = doc.querySelectorAll('.md-block[data-line]');
    var a = [];
    for (var i = 0; i < els.length; i++) {
        var line = parseInt(els[i].getAttribute('data-line'), 10);
        if (!line) continue;
        var r = els[i].getBoundingClientRect();
        a.push({
            line: line,
            top: r.top + win.pageYOffset,
            bottom: r.bottom + win.pageYOffset
        });
    }
    return a;
}

function mapLineToPreviewDocY(lineFrac, boxes, lastLine) {
    if (!boxes.length) return null;
    if (lineFrac <= boxes[0].line) return boxes[0].top;
    for (var i = 0; i < boxes.length - 1; i++) {
        if (lineFrac < boxes[i + 1].line) {
            var span = boxes[i + 1].line - boxes[i].line;
            var t = span ? (lineFrac - boxes[i].line) / span : 0;
            return boxes[i].top + t * (boxes[i + 1].top - boxes[i].top);
        }
    }
    var last = boxes[boxes.length - 1];
    var spanEnd = Math.max(1, lastLine + 1 - last.line);
    var tEnd = (lineFrac - last.line) / spanEnd;
    if (tEnd < 0) tEnd = 0;
    if (tEnd > 1) tEnd = 1;
    return last.top + tEnd * Math.max(0, last.bottom - last.top);
}

function mapPreviewDocYToLine(y, boxes, lastLine) {
    if (!boxes.length) return null;
    if (y <= boxes[0].top) return boxes[0].line;
    for (var i = 0; i < boxes.length - 1; i++) {
        if (y < boxes[i + 1].top) {
            var spanY = boxes[i + 1].top - boxes[i].top;
            var t = spanY ? (y - boxes[i].top) / spanY : 0;
            return boxes[i].line + t * (boxes[i + 1].line - boxes[i].line);
        }
    }
    var last = boxes[boxes.length - 1];
    var spanY = Math.max(1, last.bottom - last.top);
    var tEnd = (y - last.top) / spanY;
    if (tEnd < 0) tEnd = 0;
    if (tEnd > 1) tEnd = 1;
    return last.line + tEnd * Math.max(0, lastLine + 1 - last.line);
}

function ensurePreviewOverlay(doc) {
    var el = doc.getElementById('md-sync-hl');
    if (el) return el;
    el = doc.createElement('div');
    el.id = 'md-sync-hl';
    doc.documentElement.appendChild(el);
    return el;
}

function clearPreviewBlockHl(doc) {
    var els = doc.querySelectorAll('.md-block.md-hl-line,.md-block.md-hl-sel');
    for (var i = 0; i < els.length; i++) els[i].classList.remove('md-hl-line', 'md-hl-sel');
}

function applyPreviewBlockHl(doc, startLine, endLine, isSel) {
    var els = doc.querySelectorAll('.md-block[data-line]');
    var lastLine = model.getLineCount();
    var cls = isSel ? 'md-hl-sel' : 'md-hl-line';
    for (var i = 0; i < els.length; i++) {
        var range = mdBlockLineRange(els[i], els[i + 1], lastLine);
        if (range.start <= endLine && range.end >= startLine) els[i].classList.add(cls);
    }
}

function stripMdLight(s) {
    return String(s || '')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/^\s{0,3}#{1,6}\s+/gm, '')
        .replace(/^\s*[-*+]\s+/gm, '')
        .replace(/^\s*\d+\.\s+/gm, '')
        .replace(/^\s*>\s?/gm, '')
        .replace(/[*_~]+/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function findTextRangeInRoot(doc, root, needle) {
    if (!root || !needle) return null;
    var walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false);
    var parts = [], acc = '', node;
    while ((node = walker.nextNode())) {
        parts.push({ node: node, start: acc.length });
        acc += node.nodeValue;
    }
    if (!parts.length) return null;
    var idx = acc.indexOf(needle);
    if (idx < 0) return null;
    var endIdx = idx + needle.length;
    function at(off) {
        for (var i = 0; i < parts.length; i++) {
            var len = parts[i].node.nodeValue.length;
            var next = parts[i].start + len;
            if (off < next || i === parts.length - 1)
                return { node: parts[i].node, offset: Math.max(0, Math.min(len, off - parts[i].start)) };
        }
        var last = parts[parts.length - 1];
        return { node: last.node, offset: last.node.nodeValue.length };
    }
    var a = at(idx);
    var b = at(endIdx);
    var range = doc.createRange();
    try {
        range.setStart(a.node, a.offset);
        range.setEnd(b.node, b.offset);
    } catch (e) { return null; }
    return range;
}

function applyPreviewTextHighlight(win, doc, span) {
    if (!win.CSS || !win.CSS.highlights || typeof win.Highlight !== 'function') return;
    try { win.CSS.highlights.delete('md-sel'); } catch (e) { /* ignore */ }
    if (!span.isSel) return;
    var raw = model.getValueInRange(editor.getSelection());
    var needle = stripMdLight(raw);
    if (needle.length < 2) return;
    var root = doc.getElementById('md-root') || doc.body;
    var range = findTextRangeInRoot(doc, root, needle);
    if (!range && raw.indexOf('\n') >= 0)
        range = findTextRangeInRoot(doc, root, stripMdLight(raw.split('\n')[0]));
    if (!range) return;
    try { win.CSS.highlights.set('md-sel', new win.Highlight(range)); } catch (e) { /* ignore */ }
}

function revealPreviewRange(win, y1, y2) {
    var viewTop = win.pageYOffset;
    var viewH = win.innerHeight;
    var viewBot = viewTop + viewH;
    if (y1 >= viewTop + 8 && y2 <= viewBot - 8) return;
    previewSyncLock = 1;
    var pad = 16;
    if (y2 - y1 >= viewH) win.scrollTo(0, Math.max(0, y1 - pad));
    else if (y1 < viewTop) win.scrollTo(0, Math.max(0, y1 - pad));
    else win.scrollTo(0, Math.max(0, y2 - viewH + pad));
    requestAnimationFrame(function () { if (previewSyncLock === 1) previewSyncLock = 0; });
}

function coveringBox(boxes, line, lastLine) {
    for (var i = 0; i < boxes.length; i++) {
        var end = (i + 1 < boxes.length) ? boxes[i + 1].line : lastLine + 1;
        if (line >= boxes[i].line && line < end) return boxes[i];
    }
    return boxes.length ? boxes[boxes.length - 1] : null;
}

function syncHighlightFromEditor() {
    if (!mdPreviewOn()) return;
    var win = previewWin();
    var doc = win && win.document;
    if (!doc) return;
    var span = editorSelSpan();
    var overlay = ensurePreviewOverlay(doc);
    var boxes = previewAnchorBoxes(win);
    var lastLine = model.getLineCount();
    var y1 = mapLineToPreviewDocY(span.yStart, boxes, lastLine);
    var y2 = mapLineToPreviewDocY(span.yEnd, boxes, lastLine);
    if (!span.isSel) {
        var box = coveringBox(boxes, span.startLine, lastLine);
        if (box) { y1 = box.top; y2 = box.bottom; }
    }
    if (y1 == null || y2 == null) {
        overlay.style.display = 'none';
        clearPreviewBlockHl(doc);
        return;
    }
    if (y2 < y1) { var tmp = y1; y1 = y2; y2 = tmp; }
    var h = y2 - y1;
    if (h < 10) h = 10;
    overlay.style.display = 'block';
    overlay.style.top = y1 + 'px';
    overlay.style.height = h + 'px';
    overlay.className = span.isSel ? 'md-sync-sel' : '';
    overlay.id = 'md-sync-hl';
    clearPreviewBlockHl(doc);
    applyPreviewBlockHl(doc, span.startLine, span.endLine, span.isSel);
    applyPreviewTextHighlight(win, doc, span);
    if (highlightSyncLock === 2) return;
    if (revealHlTimer) clearTimeout(revealHlTimer);
    revealHlTimer = setTimeout(function () {
        revealHlTimer = null;
        if (!mdPreviewOn() || highlightSyncLock === 2) return;
        var w = previewWin();
        if (w) revealPreviewRange(w, y1, y2);
    }, 0);
}

function pickMatchNear(text, fromLine, toLine) {
    if (!text || text.length < 2 || text.length > 800 || !model.findMatches) return null;
    var matches = model.findMatches(text, true, false, false, null, false, 24);
    if (!matches || !matches.length) return null;
    var best = null, bestDist = 1e9;
    for (var i = 0; i < matches.length; i++) {
        var ln = matches[i].range.startLineNumber;
        if (ln >= fromLine && ln <= toLine) return matches[i].range;
        var dist = ln < fromLine ? fromLine - ln : ln - toLine;
        if (dist < bestDist) { bestDist = dist; best = matches[i].range; }
    }
    return (best && bestDist <= 12) ? best : null;
}

function previewSelectionInfo(win) {
    var doc = win.document;
    var sel = doc.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    var range = sel.getRangeAt(0);
    var info = {
        collapsed: sel.isCollapsed,
        text: (sel.toString() || '').replace(/\s+/g, ' ').trim(),
        startLine: 0,
        endLine: 0,
        yTop: null,
        yBot: null
    };
    var rects = range.getClientRects();
    if (rects && rects.length) {
        info.yTop = rects[0].top + win.pageYOffset;
        info.yBot = rects[rects.length - 1].bottom + win.pageYOffset;
    } else {
        var br = range.getBoundingClientRect();
        if (br && (br.height || br.width || br.top)) {
            info.yTop = br.top + win.pageYOffset;
            info.yBot = br.bottom + win.pageYOffset;
        }
    }
    var startBlock = closestMdBlock(range.startContainer);
    var endBlock = closestMdBlock(range.endContainer);
    var lastLine = model.getLineCount();
    if (startBlock) {
        var sr = mdBlockLineRange(startBlock, startBlock.nextElementSibling, lastLine);
        info.startLine = sr.start;
    }
    if (endBlock) {
        var er = mdBlockLineRange(endBlock, endBlock.nextElementSibling, lastLine);
        info.endLine = er.end;
    } else if (startBlock) {
        info.endLine = info.startLine;
    }
    return info;
}

function syncEditorFromPreviewSelection() {
    if (!mdPreviewOn() || highlightSyncLock === 1 || applyingFromPreview) return;
    var win = previewWin();
    if (!win || !win.document) return;
    var info = previewSelectionInfo(win);
    if (!info) return;
    if (!info.startLine && info.yTop == null) return;
    var boxes = previewAnchorBoxes(win);
    var lastLine = model.getLineCount();
    var startLine = info.startLine || 1;
    var endLine = info.endLine || startLine;
    if (info.yTop != null && boxes.length) {
        startLine = clampLine(mapPreviewDocYToLine(info.yTop, boxes, lastLine));
        endLine = clampLine(mapPreviewDocYToLine(info.yBot != null ? info.yBot : info.yTop, boxes, lastLine));
    }
    if (endLine < startLine) { var t = startLine; startLine = endLine; endLine = t; }

    highlightSyncLock = 2;
    previewSyncLock = 2;
    var match = (!info.collapsed && info.text) ? pickMatchNear(info.text, startLine, endLine) : null;
    if (match) {
        editor.setSelection(match);
        editor.revealRangeInCenterIfOutsideViewport(match);
    } else if (info.collapsed) {
        editor.setPosition({ lineNumber: startLine, column: 1 });
        editor.revealLineInCenterIfOutsideViewport(startLine);
    } else {
        editor.setSelection({
            startLineNumber: startLine,
            startColumn: 1,
            endLineNumber: endLine,
            endColumn: model.getLineMaxColumn(endLine)
        });
        editor.revealRangeInCenterIfOutsideViewport({
            startLineNumber: startLine, startColumn: 1,
            endLineNumber: endLine, endColumn: model.getLineMaxColumn(endLine)
        });
    }
    syncHighlightFromEditor();
    requestAnimationFrame(function () {
        if (highlightSyncLock === 2) highlightSyncLock = 0;
        if (previewSyncLock === 2) previewSyncLock = 0;
    });
}

function previewHasFocus() {
    var doc = previewFrame() && previewFrame().contentDocument;
    return !!(doc && doc.hasFocus && doc.hasFocus());
}

function previewEditRoot(doc) {
    if (!doc) return null;
    return doc.getElementById('md-root') || doc.body;
}

function applyPreviewEditable() {
    if (!state.previewMode) return;
    var doc = previewFrame() && previewFrame().contentDocument;
    var root = previewEditRoot(doc);
    if (!root) return;
    var on = !!state.isEditing;
    root.contentEditable = on ? 'true' : 'false';
    root.spellcheck = on;
}

function focusPreview() {
    var doc = previewFrame() && previewFrame().contentDocument;
    var root = previewEditRoot(doc);
    if (!root) return;
    root.focus();
    try {
        var sel = doc.getSelection();
        if (sel && sel.rangeCount === 0) {
            var range = doc.createRange();
            range.selectNodeContents(root);
            range.collapse(true);
            sel.removeAllRanges();
            sel.addRange(range);
        }
    } catch (e) { /* ignore */ }
}

function htmlTableToMarkdown(table) {
    var trs = table.querySelectorAll('tr');
    if (!trs.length) return '';
    var rows = [];
    for (var i = 0; i < trs.length; i++) {
        var cells = trs[i].querySelectorAll('th,td');
        var cols = [];
        for (var j = 0; j < cells.length; j++)
            cols.push(cells[j].textContent.replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim());
        if (cols.length) rows.push(cols);
    }
    if (!rows.length) return '';
    var n = rows[0].length;
    var lines = ['| ' + rows[0].join(' | ') + ' |'];
    var sep = [];
    for (var k = 0; k < n; k++) sep.push('---');
    lines.push('| ' + sep.join(' | ') + ' |');
    for (var r = 1; r < rows.length; r++) lines.push('| ' + rows[r].join(' | ') + ' |');
    return lines.join('\n');
}

function getTurndown() {
    if (!window.TurndownService) return null;
    if (getTurndown._svc) return getTurndown._svc;
    var td = new TurndownService({
        headingStyle: 'atx',
        hr: '---',
        bulletListMarker: '-',
        codeBlockStyle: 'fenced',
        emDelimiter: '*',
        strongDelimiter: '**'
    });
    td.addRule('mdBlock', {
        filter: function (node) {
            return node.nodeName === 'DIV' && node.classList && node.classList.contains('md-block');
        },
        replacement: function (content) { return content + '\n\n'; }
    });
    td.addRule('table', {
        filter: 'table',
        replacement: function (content, node) { return '\n\n' + htmlTableToMarkdown(node) + '\n\n'; }
    });
    getTurndown._svc = td;
    return td;
}

function serializeHtmlDoc(doc) {
    var html = doc.documentElement ? doc.documentElement.outerHTML : (doc.body ? doc.body.innerHTML : '');
    if (doc.doctype) html = '<!DOCTYPE ' + doc.doctype.name + '>\n' + html;
    return html;
}

function writeSourceFromPreview() {
    if (!state.isEditing || !state.previewMode || !model) return;
    var doc = previewFrame() && previewFrame().contentDocument;
    var root = previewEditRoot(doc);
    if (!root) return;
    var text;
    if (state.language === 'html') {
        text = serializeHtmlDoc(doc);
    } else {
        var td = getTurndown();
        if (!td) return;
        text = td.turndown(root)
            .replace(/[ \t]+\n/g, '\n')
            .replace(/\n{3,}/g, '\n\n')
            .replace(/^(\s*)- {2,}/gm, '$1- ')
            .replace(/^(\s*)(\d+)\. {2,}/gm, '$1$2. ');
        if (text) text = text.replace(/^\n+/, '').replace(/\n+$/, '') + '\n';
    }
    if (text === model.getValue()) return;
    applyingFromPreview = true;
    var scroll = editor ? editor.getScrollTop() : 0;
    model.setValue(text);
    if (editor) editor.setScrollTop(scroll);
    applyingFromPreview = false;
    state.dirty = true;
    updateStatusBar();
}

function onPreviewInput() {
    if (!state.isEditing) return;
    if (previewInputTimer) clearTimeout(previewInputTimer);
    previewInputTimer = setTimeout(function () {
        previewInputTimer = null;
        writeSourceFromPreview();
    }, 140);
}

function onPreviewKeydown(e) {
    var mod = e.ctrlKey || e.metaKey;
    if (!mod) return;
    var key = (e.key || '').toLowerCase();
    var doc = previewFrame() && previewFrame().contentDocument;
    if (key === 's') {
        e.preventDefault();
        saveFile();
    } else if (key === 'e') {
        e.preventDefault();
        toggleEdit();
    } else if (state.isEditing && doc && (key === 'b' || key === 'i')) {
        e.preventDefault();
        try { doc.execCommand(key === 'b' ? 'bold' : 'italic'); } catch (err) { /* ignore */ }
        onPreviewInput();
    }
}

function onPreviewClick(e) {
    var a = e.target && e.target.closest ? e.target.closest('a') : null;
    if (a) e.preventDefault();
    if (!mdPreviewOn()) return;
    syncEditorFromPreviewSelection();
}

function onPreviewSelectionChange() {
    if (!mdPreviewOn() || highlightSyncLock === 1) return;
    if (!previewHasFocus()) return;
    syncEditorFromPreviewSelection();
}

function bindPreviewEditing(win) {
    var doc = win && win.document;
    if (!doc || doc.__bslEditBound) return;
    doc.__bslEditBound = true;
    doc.addEventListener('input', onPreviewInput);
    doc.addEventListener('keydown', onPreviewKeydown);
    doc.addEventListener('click', onPreviewClick);
    doc.addEventListener('selectionchange', onPreviewSelectionChange);
    applyPreviewEditable();
}

function wirePreviewScroll() {
    if (previewScrollWired || !editor) return;
    previewScrollWired = true;
    editor.onDidScrollChange(function () {
        if (!state.previewMode || previewSyncLock === 2) return;
        syncPreviewFromEditor();
    });
}

var formScreenshotScroll = null;

var FORM_INTERFACE_MODE_LABELS = {
    Auto: { short: 'Режим: авто', title: 'Автоматически по конфигурации' },
    Taxi: { short: 'Режим: Taxi', title: 'Такси 8.3' },
    Version85: { short: 'Режим: 8.5', title: 'Интерфейс 8.5' }
};

function syncFormInterfaceModeMenu() {
    var button = document.getElementById('btn-form-interface-mode');
    var menu = document.getElementById('form-interface-mode-menu');
    var selected = state.formInterfaceMode || 'Auto';
    if (button) {
        var label = FORM_INTERFACE_MODE_LABELS[selected] || FORM_INTERFACE_MODE_LABELS.Auto;
        button.textContent = label.short;
        button.title = 'Режим представления: ' + label.title;
    }
    if (menu) menu.querySelectorAll('[data-form-interface-mode]').forEach(function (item) {
        var active = item.getAttribute('data-form-interface-mode') === selected;
        item.setAttribute('aria-checked', active ? 'true' : 'false');
    });
}

function closeFormInterfaceModeMenu(returnFocus) {
    var menu = document.getElementById('form-interface-mode-menu');
    var button = document.getElementById('btn-form-interface-mode');
    if (menu) menu.hidden = true;
    if (button) button.setAttribute('aria-expanded', 'false');
    if (returnFocus && button && button.focus) button.focus();
}

function setFormInterfaceMode(mode) {
    if (mode !== 'Auto' && mode !== 'Taxi' && mode !== 'Version85') return false;
    state.formInterfaceMode = mode;
    saveFormInterfaceMode(state.filePath, mode);
    state.interfaceMode = mode === 'Auto'
        ? (state.contextInterfaceMode || 'Any') : mode;
    parseMemo = null;
    syncFormInterfaceModeMenu();
    closeFormInterfaceModeMenu(true);
    if (state.previewMode && isFormView()) {
        var preview = formPreviewEl();
        var body = preview && preview.querySelector('.fp-body');
        var scrollTop = body ? body.scrollTop : 0;
        var scrollLeft = body ? body.scrollLeft : 0;
        refreshDocPreview();
        requestAnimationFrame(function () {
            var nextBody = preview && preview.querySelector('.fp-body');
            if (!nextBody) return;
            nextBody.scrollTop = scrollTop;
            nextBody.scrollLeft = scrollLeft;
        });
    }
    return true;
}

// CapturePreview is viewport-sized. Freeze the layout size before applying a
// paint-only scale: zoom on a percentage-sized root expands its layout again.
function requestFormScreenshot() {
    if (!formPreviewOpen() || !host || document.documentElement.classList.contains('screenshot-mode')) return;
    var preview = formPreviewEl();
    var body = preview && preview.querySelector('.fp-body');
    formFitToken++;
    if (preview) {
        preview.classList.remove('fp-fit-width');
        preview.style.removeProperty('--fp-fit-zoom');
    }
    formScreenshotScroll = [];
    [preview, body].forEach(function (node) {
        if (!node) return;
        formScreenshotScroll.push({ node: node, left: node.scrollLeft, top: node.scrollTop });
        node.scrollLeft = node.scrollTop = 0;
    });
    document.documentElement.classList.add('screenshot-mode');
    if (preview) {
        preview.style.setProperty('--screenshot-width', preview.clientWidth + 'px');
        preview.style.setProperty('--screenshot-height', preview.clientHeight + 'px');
        preview.classList.add('screenshot-fit');
    }
    var actions = document.getElementById('form-preview-actions');
    if (actions) actions.hidden = true;
    syncFormContextProgress();
    // The form refits inside its ResizeObserver, before paint, but its command
    // bars still settle in a frame callback. Measure after that, then let the
    // scaled frame paint before native capture.
    requestAnimationFrame(function () {
        requestAnimationFrame(function () {
            if (!document.documentElement.classList.contains('screenshot-mode')) return;
            if (preview) {
                var rect = preview.getBoundingClientRect();
                var bodyRect = body && body.getBoundingClientRect();
                var width = Math.max(preview.scrollWidth, body ? bodyRect.left - rect.left + body.scrollWidth : 0);
                var height = Math.max(preview.scrollHeight, body ? bodyRect.top - rect.top + body.scrollHeight : 0);
                var scale = Math.min(1, preview.clientWidth / Math.max(1, width), preview.clientHeight / Math.max(1, height));
                preview.style.setProperty('--screenshot-scale', String(scale));
            }
            requestAnimationFrame(function () {
                if (document.documentElement.classList.contains('screenshot-mode')) send({ cmd: 'screenshot' });
            });
        });
    });
}

function finishFormScreenshot() {
    var preview = formPreviewEl();
    if (preview) {
        preview.classList.remove('screenshot-fit');
        preview.style.removeProperty('--screenshot-scale');
        preview.style.removeProperty('--screenshot-width');
        preview.style.removeProperty('--screenshot-height');
    }
    document.documentElement.classList.remove('screenshot-mode');
    applyChrome();
    scheduleFormFit();
    var scroll = formScreenshotScroll;
    formScreenshotScroll = null;
    var previousSize = '', stableFrames = 0, frames = 0;
    function restoreScroll() {
        if (document.documentElement.classList.contains('screenshot-mode')) return;
        var size = '';
        (scroll || []).forEach(function (entry) {
            if (!entry.node.isConnected) return;
            size += [entry.node.clientWidth, entry.node.clientHeight,
                entry.node.scrollWidth, entry.node.scrollHeight].join(',') + ';';
            entry.node.scrollLeft = entry.left;
            entry.node.scrollTop = entry.top;
        });
        // Responsive tables can publish their scroll canvas over several
        // frames. Restoring earlier clamps the old position to a transient max.
        stableFrames = size === previousSize ? stableFrames + 1 : 0;
        previousSize = size;
        if (++frames < 12 && stableFrames < 3) requestAnimationFrame(restoreScroll);
    }
    requestAnimationFrame(restoreScroll);
}

// ------------------------------------------------------------ context menu

/* The page's own context menu in place of the browser's (Back, Refresh,
 * Inspect, Save as...): Копировать for selected text, editing commands in a
 * text box, and what the thing under the pointer offers — an outline row, an
 * inspector property, a form element, a command of the configuration root.
 * Monaco keeps its own menu. */
var contextMenuEl = null;

function copyText(text) {
    text = String(text == null ? '' : text);
    if (!text) return;
    var fallback = function () {
        var box = document.createElement('textarea');
        box.value = text;
        box.style.position = 'fixed';
        box.style.left = '-9999px';
        document.body.appendChild(box);
        box.select();
        try { document.execCommand('copy'); } catch (e) { /* nothing else to try */ }
        document.body.removeChild(box);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).catch(fallback);
    else fallback();
}

/* Объект.Description as the Designer shows it: Объект.Наименование. */
function ruDataPath(path) {
    return window.XmlUtil && XmlUtil.terms ? XmlUtil.terms.dataPath(path) : String(path || '');
}

function hideContextMenu() {
    if (contextMenuEl) contextMenuEl.hidden = true;
    hideContextSubmenu();
}

function showContextMenu(x, y, items) {
    if (!contextMenuEl) {
        contextMenuEl = document.createElement('div');
        contextMenuEl.className = 'ctx-menu';
        contextMenuEl.setAttribute('role', 'menu');
        document.body.appendChild(contextMenuEl);
        contextMenuEl.addEventListener('mousedown', function (e) { e.preventDefault(); });
        wireContextMenuRows(contextMenuEl);
        /* A row with `items` opens them beside itself. */
        contextMenuEl.addEventListener('mouseover', function (e) {
            var row = e.target.closest && e.target.closest('.ctx-item');
            if (!row || row.parentNode !== contextMenuEl) return;
            var sub = contextMenuEl._subs[+row.getAttribute('data-i')];
            if (!sub) { hideContextSubmenu(); return; }
            if (contextSubEl && !contextSubEl.hidden && contextSubEl._row === row) return;
            var r = row.getBoundingClientRect();
            if (!contextSubEl) {
                contextSubEl = document.createElement('div');
                contextSubEl.className = 'ctx-menu ctx-submenu';
                contextSubEl.setAttribute('role', 'menu');
                document.body.appendChild(contextSubEl);
                wireContextMenuRows(contextSubEl);
            }
            contextSubEl._row = row;
            fillContextMenu(contextSubEl, sub);
            var w = contextSubEl.offsetWidth, ht = contextSubEl.offsetHeight;
            var left = r.right + w + 2 > window.innerWidth ? r.left - w : r.right;
            contextSubEl.style.left = Math.max(0, left) + 'px';
            contextSubEl.style.top = Math.max(0, Math.min(r.top - 4, window.innerHeight - ht - 2)) + 'px';
        });
    }
    hideContextSubmenu();
    fillContextMenu(contextMenuEl, items);
    var w = contextMenuEl.offsetWidth, ht = contextMenuEl.offsetHeight;
    contextMenuEl.style.left = Math.max(0, Math.min(x, window.innerWidth - w - 2)) + 'px';
    contextMenuEl.style.top = Math.max(0, Math.min(y, window.innerHeight - ht - 2)) + 'px';
}

var contextSubEl = null;

function hideContextSubmenu() {
    if (contextSubEl) { contextSubEl.hidden = true; contextSubEl._row = null; }
}

function wireContextMenuRows(menu) {
    menu.addEventListener('mousedown', function (e) { e.preventDefault(); });
    menu.addEventListener('click', function (e) {
        var row = e.target.closest && e.target.closest('.ctx-item');
        if (!row || row.classList.contains('ctx-disabled')) return;
        var i = +row.getAttribute('data-i');
        if (menu._subs && menu._subs[i]) return;
        var action = menu._actions[i];
        hideContextMenu();
        if (action) action();
    });
}

function fillContextMenu(menu, items) {
    var h = [];
    var actions = [];
    var subs = [];
    for (var i = 0; i < items.length; i++) {
        var it = items[i];
        if (it.sep) {
            if (h.length && i < items.length - 1) h.push('<div class="ctx-sep"></div>');
            continue;
        }
        actions.push(it.action);
        subs.push(it.items && it.items.length ? it.items : null);
        h.push('<div class="ctx-item', it.disabled ? ' ctx-disabled' : '', '" role="menuitem" data-i="', actions.length - 1,
            '"', it.items ? ' aria-haspopup="menu"' : '', '><span class="ctx-label', it.link ? ' ctx-link' : '', '">', esc(it.label), '</span>',
            it.items ? '<span class="ctx-hint">›</span>'
                : it.hint ? '<span class="ctx-hint">' + esc(it.hint) + '</span>' : '', '</div>');
    }
    menu._actions = actions;
    menu._subs = subs;
    menu.innerHTML = h.join('');
    menu.hidden = false;
}

function shownOutlineEntry(row) {
    var idx = parseInt(row.getAttribute('data-idx'), 10);
    if (!isNaN(idx) && shownOutlineItems[idx]) return shownOutlineItems[idx];
    var id = row.getAttribute('data-id');
    for (var i = 0; id && i < allItems.length; i++) if (allItems[i].id === id) return allItems[i];
    return null;
}

/* Shows the source line of an outline entry in the XML text. */
function revealSourceLine(line) {
    if (!line || !editor) return;
    var go = function () {
        editor.revealLineInCenter(line);
        editor.setPosition({ lineNumber: line, column: 1 });
        editor.focus();
    };
    if (state.previewMode && !(currentProvider() && currentProvider().keepsEditor)) setPreviewMode(false, go);
    else go();
}

function textBoxItems(box) {
    var hasSel = box.selectionStart !== box.selectionEnd;
    var editable = !box.readOnly && !box.disabled;
    return [
        { label: 'Вырезать', hint: 'Ctrl+X', disabled: !hasSel || !editable, action: function () { box.focus(); document.execCommand('cut'); } },
        { label: 'Копировать', hint: 'Ctrl+C', disabled: !hasSel, action: function () { box.focus(); document.execCommand('copy'); } },
        { label: 'Вставить', hint: 'Ctrl+V', disabled: !editable || !(navigator.clipboard && navigator.clipboard.readText), action: function () {
            navigator.clipboard.readText().then(function (text) {
                box.focus();
                box.setRangeText(text, box.selectionStart, box.selectionEnd, 'end');
                box.dispatchEvent(new Event('input', { bubbles: true }));
            });
        } },
        { sep: true },
        { label: 'Выделить все', hint: 'Ctrl+A', action: function () { box.focus(); box.select(); } }
    ];
}

function outlineRowItems(row) {
    var it = shownOutlineEntry(row);
    if (!it) return [];
    var out = [];
    var p = currentProvider();
    if (row.classList.contains('form-el')) {
        var target = it.node ? it.node.open : it.role ? it.role.path : '';
        if (target && host && p && p.id === 'metadata')
            out.push({ label: 'Открыть', action: function () { openRelated(target); } });
        if (it.itemKind !== 'attribute' && it.id && p && p.id === 'form')
            out.push({ label: 'Показать на форме', action: function () { switchFormWorkbenchView('form'); selectFormElement(it.id); } });
        if (it.line > 1) out.push({ label: 'Показать в тексте XML', action: function () { revealSourceLine(it.line); } });
        if (formMovingEnabled() && formMoveEntry(it.name)) {
            var moved = formMoveEntry(it.name);
            out.push({ sep: true });
            var canStep = formMoveStepEnabled(moved);
            out.push({ label: 'Переместить выше', hint: 'Ctrl+Shift+↑', disabled: !canStep,
                action: function () { moveFormElementStep(it.name, -1); } });
            out.push({ label: 'Переместить ниже', hint: 'Ctrl+Shift+↓', disabled: !canStep,
                action: function () { moveFormElementStep(it.name, 1); } });
        }
    } else {
        out.push({ label: 'Перейти к процедуре', action: function () { revealSourceLine(it.line); } });
    }
    if (docTree() && !document.getElementById('outline-fold').hidden) {
        out.push({ sep: true });
        out.push({ label: 'Развернуть все', action: function () { document.getElementById('outline-unfold').click(); } });
        out.push({ label: 'Свернуть все', action: function () { document.getElementById('outline-fold').click(); } });
    }
    return out;
}

function inspectorItems(target) {
    var host_ = document.getElementById('property-inspector');
    var pair = target.closest('.attribute-property, .attribute-detail dl > div');
    var out = [];
    if (pair) {
        var label = pair.querySelector('dt') ? pair.querySelector('dt').textContent : '';
        var valueEl = pair.querySelector('.attribute-value, dd');
        var value = valueEl ? valueEl.textContent : '';
        var link = pair.querySelector('a[data-form-handler], a[data-attribute-id]');
        if (link) out.push({ label: link.hasAttribute('data-form-handler') ? 'Перейти к обработчику' : 'Показать реквизит',
            action: function () { link.click(); } });
        out.push({ label: 'Копировать значение', action: function () { copyText(value); } });
        out.push({ label: 'Копировать «' + label + '»', action: function () { copyText(label + ': ' + value); } });
        out.push({ sep: true });
    }
    out.push({ label: 'Копировать все свойства', action: function () {
        var lines = [];
        var name = host_.querySelector('.attribute-inspector-head strong');
        if (name) lines.push(name.textContent);
        var pairs = host_.querySelectorAll('dl > div');
        for (var i = 0; i < pairs.length; i++) {
            var dt = pairs[i].querySelector('dt'), dd = pairs[i].querySelector('dd');
            if (dt && dd) lines.push(dt.textContent + ': ' + dd.textContent.replace(/\s*→\s*/, ' → '));
        }
        copyText(lines.join('\n'));
    } });
    return out;
}

function formPreviewItems(target) {
    var hit = target.closest('.fp-item[data-id], th[data-id], .fp-popup-entry[data-id]');
    if (!hit) return [];
    var id = hit.getAttribute('data-id');
    var index = formElementIndex(id);
    if (index < 0) return [];
    var entry = formElementItems[index];
    var out = [
        { label: 'Свойства элемента', action: function () { selectFormElement(id); } },
        { label: 'Показать в тексте XML', disabled: !(entry.line > 1), action: function () { revealSourceLine(entry.line); } }
    ];
    var handlerItems = formHandlerMenu(entry);
    if (handlerItems.length) out.push({ sep: true });
    out = out.concat(handlerItems);
    /* The same move the tree offers, from the element itself. */
    var moved = formMovingEnabled() ? formMoveEntry(entry.name) : null;
    if (moved) {
        out.push({ sep: true });
        out.push({ label: 'Переместить выше', hint: 'Ctrl+Shift+↑', disabled: !formMoveStepEnabled(moved),
            action: function () { moveFormElementStep(entry.name, -1); } });
        out.push({ label: 'Переместить ниже', hint: 'Ctrl+Shift+↓', disabled: !formMoveStepEnabled(moved),
            action: function () { moveFormElementStep(entry.name, 1); } });
    }
    out.push({ sep: true });
    out.push({ label: 'Копировать имя', action: function () { copyText(entry.name); } });
    if (entry.title && entry.title !== entry.name) out.push({ label: 'Копировать заголовок', action: function () { copyText(entry.title); } });
    if (entry.dataPath) out.push({ label: 'Копировать путь к данным', action: function () { copyText(ruDataPath(entry.dataPath)); } });
    return out;
}

/* A command or section of the configuration root: its link opens the
 * object; data-ref carries the metadata name in Russian. */
function configurationItems(target) {
    var hit = target.closest('[data-ref]');
    if (!hit) return [];
    var out = [];
    if (hit.tagName === 'A' || hit.hasAttribute('data-open'))
        out.push({ label: 'Открыть', action: function () { hit.click(); } });
    out.push({ label: 'Копировать представление', action: function () { copyText(hit.textContent.trim()); } });
    out.push({ label: 'Копировать имя', action: function () { copyText(hit.getAttribute('data-ref')); } });
    return out;
}

/* A row of the object window's own tree: the same entry as the structure panel. */
function objectWindowItems(row) {
    var id = row.getAttribute('data-id');
    var entry = null;
    for (var i = 0; i < allItems.length; i++) if (allItems[i].id === id) { entry = allItems[i]; break; }
    var name = row.querySelector('.md-name');
    var type = row.querySelector('.md-type');
    var out = [];
    if (row.hasAttribute('data-open') && host)
        out.push({ label: relatedTarget(row.getAttribute('data-open')).action === 'save' ? 'Сохранить как…' : 'Открыть', action: function () { row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); } });
    if (entry && entry.line > 1) out.push({ label: 'Показать в тексте XML', action: function () { revealSourceLine(entry.line); } });
    out.push({ sep: true });
    out.push({ label: 'Копировать имя', action: function () { copyText(entry && entry.name || (name && name.textContent)); } });
    if (type && type.textContent) out.push({ label: 'Копировать тип', action: function () { copyText(type.textContent); } });
    return out;
}

function contextMenuItems(e) {
    var t = e.target;
    if (!t || !t.closest) return [];
    /* Fields drawn inside a form mockup are the element, not a text box. */
    var box = t.closest('input:not([type=checkbox]):not([type=radio]):not([type=button]), textarea');
    if (box && !box.closest('#form-preview .fp-item')) return textBoxItems(box);
    var items = [];
    var sel = String(window.getSelection ? window.getSelection() : '');
    if (sel.trim()) items.push({ label: 'Копировать', hint: 'Ctrl+C', action: function () { copyText(sel); } }, { sep: true });
    var row = t.closest('#outline-list .proc-item');
    if (row) return items.concat(outlineRowItems(row));
    if (t.closest('#property-inspector')) return items.concat(inspectorItems(t));
    var mdRow = t.closest('#form-preview .md-row[data-id]');
    if (mdRow) return items.concat(objectWindowItems(mdRow));
    if (t.closest('#form-preview')) {
        var own = configurationItems(t);
        if (!own.length && currentProvider() && currentProvider().id === 'form') own = formPreviewItems(t);
        return items.concat(own);
    }
    var crumbs = t.closest('#sb-crumbs, #sb-element, #sb-file');
    if (crumbs && crumbs.textContent.trim()) return items.concat([{ label: 'Копировать', action: function () { copyText(crumbs.textContent.trim()); } }]);
    return items;
}

function wireContextMenu() {
    document.addEventListener('contextmenu', function (e) {
        if (e.target && e.target.closest && e.target.closest('.monaco-editor')) { hideContextMenu(); return; }
        e.preventDefault();
        var items = contextMenuItems(e);
        while (items.length && items[items.length - 1].sep) items.pop();
        if (items.length) showContextMenu(e.clientX, e.clientY, items);
        else hideContextMenu();
    });
    document.addEventListener('mousedown', function (e) {
        if (contextMenuEl && !contextMenuEl.hidden && !(e.target.closest && e.target.closest('.ctx-menu'))) hideContextMenu();
    }, true);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') hideContextMenu(); }, true);
    window.addEventListener('blur', hideContextMenu);
    window.addEventListener('resize', hideContextMenu);
    document.addEventListener('scroll', hideContextMenu, true);
}

// ------------------------------------------------------- one-time UI wiring

function wireUi() {
    wireContextMenu();
    document.getElementById('outline-list').addEventListener('click', function (e) {
        var usageLink = e.target.closest && e.target.closest('a.handler-usage[data-usage-id]');
        if (usageLink) {
            e.preventDefault();
            e.stopPropagation();
            var usageId = usageLink.getAttribute('data-usage-id');
            switchFormWorkbenchView('form');
            selectFormElement(usageId);
            return;
        }
        var tw = e.target.closest && e.target.closest('.twisty');
        if (tw && docTree()) {
            e.preventDefault();
            e.stopPropagation();
            var fid = tw.getAttribute('data-fold');
            if (!fid) return;
            if (!state.outlineCollapsed) state.outlineCollapsed = {};
            if (state.outlineCollapsed[fid]) delete state.outlineCollapsed[fid];
            else state.outlineCollapsed[fid] = true;
            renderOutline();
            return;
        }
        var el = e.target.closest('.proc-item');
        if (!el) return;
        var ln = parseInt(el.getAttribute('data-line'), 10);
        editor.revealLineInCenter(ln);
        editor.setPosition({ lineNumber: ln, column: 1 });
        var view = previewView();
        var rowId = el.getAttribute('data-id');
        if (el.getAttribute('data-kind') === 'attribute') {
            state.selectedAttributeId = rowId || '';
            highlightOutlineRow(state.selectedAttributeId);
            renderPropertyInspector();
            return;
        }
        if (view && view.highlight && rowId) {
            view.highlight(formPreviewEl(), rowId);
            highlightFormOutline(rowId);
        }
    });

    /* Reordering the form by dragging a row of the tree. The row is the
     * element; the mark on the row under the pointer says where it would
     * land, and a row that cannot take it carries no mark and no drop. */
    var outlineList = document.getElementById('outline-list');
    outlineList.addEventListener('dragstart', function (e) {
        var row = e.target.closest && e.target.closest('.proc-item.form-el[draggable]');
        var entry = row ? shownOutlineEntry(row) : null;
        if (!row || !entry || !formMovingEnabled()) return;
        formDrag = { name: entry.name, index: entry.outlineIndex, row: row, mode: '' };
        row.classList.add('dragging');
        if (e.dataTransfer) {
            e.dataTransfer.effectAllowed = 'move';
            /* Chromium starts no drag without data on the transfer. */
            try { e.dataTransfer.setData('text/plain', entry.name); } catch (err) { /* ignore */ }
        }
    });
    outlineList.addEventListener('dragover', function (e) {
        if (!formDrag.name) return;
        var row = e.target.closest && e.target.closest('.proc-item.form-el');
        var plan = row ? formDragPlan(row, e) : null;
        clearFormDropMark();
        if (!plan) {
            if (e.dataTransfer) e.dataTransfer.dropEffect = 'none';
            return;
        }
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        row.classList.add('drop-' + plan.mode);
    });
    outlineList.addEventListener('drop', function (e) {
        if (!formDrag.name) return;
        var row = e.target.closest && e.target.closest('.proc-item.form-el');
        var plan = row ? formDragPlan(row, e) : null;
        var name = formDrag.name;
        endFormDrag();
        if (!plan) return;
        e.preventDefault();
        moveFormElement(name, plan.mode === 'into' ? { into: plan.target }
            : plan.mode === 'before' ? { before: plan.target } : { after: plan.target });
    });
    outlineList.addEventListener('dragend', endFormDrag);
    outlineList.addEventListener('dragleave', function (e) {
        if (e.target === outlineList) clearFormDropMark();
    });

    document.getElementById('outline-move-up').addEventListener('click', function () {
        var entry = formMoveSelection();
        if (entry) moveFormElementStep(entry.name, -1);
    });
    document.getElementById('outline-move-down').addEventListener('click', function () {
        var entry = formMoveSelection();
        if (entry) moveFormElementStep(entry.name, 1);
    });
    /* Ctrl+Shift+Up/Down, as the Designer moves an element of the form. */
    document.addEventListener('keydown', function (e) {
        if (!e.ctrlKey || !e.shiftKey || e.altKey) return;
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
        var entry = formMoveSelection();
        if (!entry) return;
        e.preventDefault();
        moveFormElementStep(entry.name, e.key === 'ArrowUp' ? -1 : 1);
    }, true);

    /* The Roles tab filter: a right ticked or cleared redraws the list. */
    document.getElementById('outline-list').addEventListener('change', function (e) {
        var box = e.target.closest && e.target.closest('input[data-right]');
        if (!box) return;
        var right = box.getAttribute('data-right');
        if (box.checked) state.mdRoleRights[right] = true;
        else delete state.mdRoleRights[right];
        renderOutline();
    });
    document.getElementById('outline-list').addEventListener('toggle', function (e) {
        if (e.target.classList && e.target.classList.contains('roles-filter')) state.mdRoleFilterOpen = e.target.open;
    }, true);
    document.getElementById('outline-list').addEventListener('click', function (e) {
        if (!(e.target.closest && e.target.closest('#roles-filter-clear'))) return;
        e.preventDefault();
        state.mdRoleRights = {};
        renderOutline();
    });

    /* An object's structure panel opens what its window would: a form, a
     * template, a command module, another object of the configuration. */
    document.getElementById('outline-list').addEventListener('dblclick', function (e) {
        var el = e.target.closest && e.target.closest('.proc-item');
        var p = currentProvider();
        if (!el || !host || !p || p.id !== 'metadata') return;
        var rowId = el.getAttribute('data-id');
        for (var i = 0; i < allItems.length; i++) {
            if (allItems[i].id !== rowId) continue;
            var target = allItems[i].node ? allItems[i].node.open : allItems[i].role ? allItems[i].role.path : '';
            if (target) { e.preventDefault(); openRelated(target); }
            return;
        }
    });

    document.getElementById('outline-kinds').addEventListener('click', function (e) {
        var button = e.target.closest && e.target.closest('button[data-outline-kind]');
        if (button) selectOutlineKind(button.getAttribute('data-outline-kind'));
    });
    document.getElementById('property-inspector').addEventListener('click', function (e) {
        var attributeLink = e.target.closest && e.target.closest('a[data-attribute-id]');
        if (attributeLink) {
            e.preventDefault();
            state.selectedAttributeId = attributeLink.getAttribute('data-attribute-id') || '';
            selectOutlineKind('attributes');
            return;
        }
        var openLink = e.target.closest && e.target.closest('a[data-open-related]');
        if (openLink) {
            e.preventDefault();
            openRelated(openLink.getAttribute('data-open-related'));
            return;
        }
        var handlerLink = e.target.closest && e.target.closest('a[data-form-handler]');
        if (handlerLink) {
            e.preventDefault();
            goToFormHandler(handlerLink.getAttribute('data-form-handler') || '');
            return;
        }
        if (!e.target.closest || !e.target.closest('#property-inspector-close')) return;
        if (state.outlineKind === 'attributes') state.selectedAttributeId = '';
        else {
            state.formSelectedId = '';
            var view = previewView();
            if (view && view.highlight) view.highlight(formPreviewEl(), '');
        }
        renderOutline();
    });

    document.getElementById('outline-filter').addEventListener('input', applyFilter);
    document.getElementById('filter-clear').addEventListener('click', function () {
        var fi = document.getElementById('outline-filter');
        fi.value = '';
        applyFilter();
        fi.focus();
    });
    document.getElementById('sort-btn').addEventListener('click', function () {
        state.sortByName = !state.sortByName;
        renderOutline();
        /* The object window's own tree follows the same order. */
        if (sortKeepsTree()) refreshDocPreview();
    });
    document.getElementById('outline-fold').addEventListener('click', function () {
        var collapseView = docTree() ? previewView() : null;
        if (collapseView && collapseView.outlineCollapseAll) {
            if (!state.outlineCollapsed) state.outlineCollapsed = {};
            collapseView.outlineCollapseAll(allItems, state.outlineCollapsed);
            renderOutline();
            return;
        }
        foldAllProcedures(true);
    });
    document.getElementById('outline-unfold').addEventListener('click', function () {
        if (docTree()) {
            state.outlineCollapsed = {};
            renderOutline();
            return;
        }
        foldAllProcedures(false);
    });

    document.getElementById('outline-toggle').addEventListener('click', function () {
        var p = document.getElementById('outline-panel');
        p.style.display = (p.style.display === 'none') ? 'flex' : 'none';
        syncOutlineToggle();
        editor.layout();
    });

    document.getElementById('btn-theme').addEventListener('click', function () {
        if (formPreviewOpen()) return;
        state.isDark = !state.isDark;
        writeStoredBool(THEME_KEY, state.isDark);
        applyTheme();
    });
    document.getElementById('btn-minimap').addEventListener('click', toggleMinimap);
    document.getElementById('btn-edit').addEventListener('click', toggleEdit);
    document.getElementById('btn-save').addEventListener('click', saveFile);
    wireCommitPrompt();
    document.getElementById('btn-undo').addEventListener('click', function () { undoFromToolbar(false); });
    document.getElementById('btn-redo').addEventListener('click', function () { undoFromToolbar(true); });
    document.getElementById('btn-format').addEventListener('click', formatDocument);
    document.getElementById('btn-comment').addEventListener('click', toggleLineComment);
    document.getElementById('btn-move-line-up').addEventListener('click', function () { runEditorAction('editor.action.moveLinesUpAction'); });
    document.getElementById('btn-move-line-down').addEventListener('click', function () { runEditorAction('editor.action.moveLinesDownAction'); });
    document.getElementById('btn-copy-line-down').addEventListener('click', function () { runEditorAction('editor.action.copyLinesDownAction'); });
    document.getElementById('btn-delete-line').addEventListener('click', function () { runEditorAction('editor.action.deleteLines'); });
    document.getElementById('btn-string-bar').addEventListener('click', toggleStringBar);
    document.getElementById('btn-diff').addEventListener('click', function () {
        toggleDiffPanel();
        if (!diffOpen && editor) editor.focus();
    });
    document.getElementById('btn-whitespace').addEventListener('click', toggleWhitespace);
    document.getElementById('diff-close').addEventListener('click', function () {
        closeDiffPanel();
        if (editor) editor.focus();
    });
    document.getElementById('diff-base').addEventListener('change', function () {
        setDiffBase(this.value);
    });
    document.getElementById('diff-rev').addEventListener('keydown', function (e) {
        /* Поле живёт внутри панели: Esc здесь отменяет ввод, а не закрывает
         * сравнение целиком. */
        if (e.key === 'Enter') { e.preventDefault(); applyGitRef(this.value); }
        else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeGitRefInput(); syncDiffBase(); }
    });
    document.getElementById('diff-rev').addEventListener('blur', function () {
        if (this.value.trim()) applyGitRef(this.value); else { closeGitRefInput(); syncDiffBase(); }
    });
    /* Ловим до Monaco: иначе редактор съест сочетание, пока в нём фокус.
     * e.code, а не e.key: в русской раскладке Alt+Shift+D — это «В». */
    document.addEventListener('keydown', function (e) {
        if (!e.altKey || !e.shiftKey || e.ctrlKey || e.metaKey) return;
        if (e.code === 'KeyD') { e.preventDefault(); e.stopPropagation(); toggleDiffPanel(); }
        else if (e.code === 'KeyW') { e.preventDefault(); e.stopPropagation(); toggleWhitespace(); }
    }, true);
    document.addEventListener('keydown', function (e) {
        if (e.key !== 'Escape' || !diffOpen) return;
        var input = document.getElementById('diff-rev');
        if (input && !input.hidden) return;   /* поле ввода ревизии отменяет само себя */
        e.preventDefault();
        closeDiffPanel();
        if (editor) editor.focus();
    });
    document.getElementById('save-prompt-yes').addEventListener('click', onSavePromptYes);
    document.getElementById('save-prompt-no').addEventListener('click', onSavePromptNo);
    document.getElementById('save-prompt-cancel').addEventListener('click', onSavePromptCancel);
    document.addEventListener('keydown', function (e) {
        if (!savePromptOpen()) return;
        if (e.key === 'Escape') { e.preventDefault(); onSavePromptCancel(); }
        else if (e.key === 'Enter') { e.preventDefault(); onSavePromptYes(); }
    });
    document.querySelectorAll('#md-layout button[data-md-layout]').forEach(function (button) {
        button.addEventListener('click', function () {
            setTextPreviewLayout(button.getAttribute('data-md-layout'));
        });
    });
    document.getElementById('btn-preview').addEventListener('click', function () {
        if (state.sarifMode) toggleSarifSource();
        else setPreviewMode(!state.previewMode);
    });
    document.querySelectorAll('#form-workbench-tabs button[data-view]').forEach(function (button) {
        button.addEventListener('click', function () {
            switchFormWorkbenchView(button.getAttribute('data-view'));
        });
    });
    document.getElementById('btn-reload').addEventListener('click', reloadFromDisk);
    document.getElementById('btn-explorer').addEventListener('click', function () {
        send({ cmd: 'showInExplorer', target: formModuleOpen() ? 'module' : 'file' });
    });
    document.getElementById('btn-agent').addEventListener('click', function () {
        send({ cmd: 'launchAgent' });
    });
    document.getElementById('btn-up').addEventListener('click', navigateUp);
    document.getElementById('btn-back').addEventListener('click', navigateBack);
    document.getElementById('btn-forward').addEventListener('click', navigateForward);
    document.getElementById('btn-nav-history').addEventListener('click', toggleNavHistoryMenu);
    document.getElementById('btn-settings').addEventListener('click', function () { send({ cmd: 'openSettings' }); });
    document.addEventListener('mousedown', function (e) {
        var box = document.getElementById('nav-history');
        if (box && !box.contains(e.target)) closeNavHistoryMenu(false);
    });
    document.getElementById('nav-history-menu').addEventListener('keydown', function (e) {
        if (e.key === 'Escape') { e.preventDefault(); closeNavHistoryMenu(true); return; }
        if (e.key === 'Enter' && document.activeElement && this.contains(document.activeElement)) {
            e.preventDefault();
            document.activeElement.click();
            return;
        }
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
        e.preventDefault();
        var items = Array.prototype.slice.call(this.querySelectorAll('.nav-history-item:not(.current)'));
        var i = items.indexOf(document.activeElement) + (e.key === 'ArrowDown' ? 1 : -1);
        if (items.length) items[(i + items.length) % items.length].focus();
    });
    document.addEventListener('keydown', function (e) {
        var dir = historyKeyDirection(e);
        if (!dir || !(dir === 'back' ? navHistory : navForward).length) return;
        e.preventDefault();
        if (dir === 'back') navigateBack(); else navigateForward();
    }, true);
    /* Mouse side buttons. */
    document.addEventListener('mouseup', function (e) {
        if (e.button === 3 && navHistory.length) { e.preventDefault(); navigateBack(); }
        else if (e.button === 4 && navForward.length) { e.preventDefault(); navigateForward(); }
    });
    document.getElementById('btn-epf').addEventListener('click', openEpfPanel);
    document.addEventListener('keydown', function (e) {
        if (upTarget.path && isNavigateUpKey(e)) {
            e.preventDefault();
            navigateUp();
        }
    }, true);
    document.addEventListener('keydown', onPreviewUndoKey, true);
    document.getElementById('help-close').addEventListener('click', hideHelp);
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && !document.getElementById('help-panel').hidden) {
            e.preventDefault();
            hideHelp();
        }
    });
    document.getElementById('btn-form-screenshot').addEventListener('click', requestFormScreenshot);
    initSessionAnnotations();
    document.getElementById('btn-form-interface-mode').addEventListener('click', function () {
        var menu = document.getElementById('form-interface-mode-menu');
        var open = !!(menu && menu.hidden);
        if (menu) menu.hidden = !open;
        this.setAttribute('aria-expanded', open ? 'true' : 'false');
        if (open && menu) {
            var selected = menu.querySelector('[aria-checked="true"]');
            if (selected && selected.focus) selected.focus();
        }
    });
    document.getElementById('form-interface-mode-menu').addEventListener('click', function (event) {
        var item = event.target.closest && event.target.closest('[data-form-interface-mode]');
        if (item) setFormInterfaceMode(item.getAttribute('data-form-interface-mode'));
    });
    document.addEventListener('click', function (event) {
        if (!event.target.closest || !event.target.closest('#form-interface-mode'))
            closeFormInterfaceModeMenu(false);
    });
    document.addEventListener('keydown', function (event) {
        var menu = document.getElementById('form-interface-mode-menu');
        if (event.key === 'Escape' && menu && !menu.hidden) {
            event.preventDefault();
            closeFormInterfaceModeMenu(true);
        }
    });
    document.getElementById('btn-form-fit').addEventListener('click', function () {
        formFitWidth = !formFitWidth;
        writeStoredBool('1cFormViewer.fitWidth', formFitWidth);
        scheduleFormFit();
    });
    document.getElementById('statusbar').addEventListener('click', function (e) {
        var crumb = e.target.closest && e.target.closest('a[data-crumb-id]');
        if (!crumb) return;
        e.preventDefault();
        selectFormElement(crumb.getAttribute('data-crumb-id'));
    });
    if (window.ResizeObserver && formPreviewEl()) {
        var fitResizeTimer = null;
        new ResizeObserver(function () {
            if (!formFitWidth) return;
            clearTimeout(fitResizeTimer);
            fitResizeTimer = setTimeout(scheduleFormFit, 120);
        }).observe(formPreviewEl());
    }

    document.getElementById('preview').addEventListener('load', function () {
        if (!state.previewMode) return;
        var win = previewWin();
        if (!win) return;
        win.addEventListener('scroll', onPreviewScroll, { passive: true });
        bindPreviewEditing(win);
        syncPreviewFromEditor();
        syncHighlightFromEditor();
    });

    var handle = document.getElementById('resize-handle');
    var panel = document.getElementById('outline-panel');
    var startX = 0, startW = 0;
    function onResize(e) {
        var w = startW - (e.clientX - startX);
        w = Math.max(200, Math.min(w, window.innerWidth * 0.6));
        panel.style.width = w + 'px';
        editor.layout();
    }
    function stopResize() {
        document.removeEventListener('mousemove', onResize);
        document.removeEventListener('mouseup', stopResize);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
    }
    handle.addEventListener('mousedown', function (e) {
        startX = e.clientX;
        startW = panel.offsetWidth;
        e.preventDefault();
        document.addEventListener('mousemove', onResize);
        document.addEventListener('mouseup', stopResize);
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
    });

    var propertyResizeHandle = document.getElementById('property-resize-handle');
    var propertyInspector = document.getElementById('property-inspector');
    var propertyStartY = 0, propertyStartH = 0;
    function onPropertyResize(e) {
        var available = panel.clientHeight;
        var h = propertyStartH - (e.clientY - propertyStartY);
        h = Math.max(132, Math.min(h, Math.floor(available * 0.9)));
        propertyInspector.style.flex = '0 0 ' + h + 'px';
        propertyInspector.style.height = h + 'px';
    }
    function stopPropertyResize() {
        document.removeEventListener('mousemove', onPropertyResize);
        document.removeEventListener('mouseup', stopPropertyResize);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        try { sessionStorage.setItem('1cFormViewer.propertyInspectorHeight', propertyInspector.offsetHeight); } catch (error) {}
    }
    propertyResizeHandle.addEventListener('mousedown', function (e) {
        if (propertyInspector.hidden) return;
        propertyStartY = e.clientY;
        propertyStartH = propertyInspector.offsetHeight;
        e.preventDefault();
        document.addEventListener('mousemove', onPropertyResize);
        document.addEventListener('mouseup', stopPropertyResize);
        document.body.style.cursor = 'row-resize';
        document.body.style.userSelect = 'none';
    });
    try {
        var savedPropertyHeight = parseInt(sessionStorage.getItem('1cFormViewer.propertyInspectorHeight'), 10);
        if (savedPropertyHeight > 0) {
            propertyInspector.style.flex = '0 0 ' + savedPropertyHeight + 'px';
            propertyInspector.style.height = savedPropertyHeight + 'px';
        }
    } catch (error) {}

    var splitHandle = document.getElementById('preview-handle');
    var editorEl = document.getElementById('editor');
    var splitTarget = editorEl;
    var splitStartX = 0, splitStartW = 0;
    function onSplitResize(e) {
        var w = splitStartW + (e.clientX - splitStartX);
        var max = document.getElementById('main').clientWidth - 140;
        var min = splitTarget === formPreviewEl() ? 280 : 160;
        w = Math.max(min, Math.min(w, max));
        splitTarget.style.flex = 'none';
        splitTarget.style.width = w + 'px';
        if (editor) editor.layout();
    }
    function stopSplitResize() {
        document.removeEventListener('mousemove', onSplitResize);
        document.removeEventListener('mouseup', stopSplitResize);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
    }
    splitHandle.addEventListener('mousedown', function (e) {
        var p = currentProvider();
        splitTarget = p && p.keepsEditor && p.previewFirst ? formPreviewEl() : editorEl;
        splitStartX = e.clientX;
        splitStartW = splitTarget.offsetWidth;
        e.preventDefault();
        document.addEventListener('mousemove', onSplitResize);
        document.addEventListener('mouseup', stopSplitResize);
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
    });
}

// ------------------------------------------------------------------ startup

/* Preview-provider selection is the one piece of this file that is pure logic,
 * and it decides how every file is displayed — so it is exported for
 * tests/viewer-preview.test.mjs, the way the preview modules export `_test`. */
window.ViewerInternals = {
    providers: PREVIEW_PROVIDERS,
    PreviewProviders: PreviewProviders,
    state: state,
    detectProvider: detectProvider,
    upCandidates: upCandidates,
    isNavigateUpKey: isNavigateUpKey,
    historyKeyDirection: historyKeyDirection,
    navHistoryItems: navHistoryItems,
    navLabel: navLabel,
    trackNavigation: trackNavigation,
    navState: function (history, forward, pending) {
        if (history) navHistory = history;
        if (forward) navForward = forward;
        if (pending !== undefined) navPending = pending;
        return { history: navHistory, forward: navForward };
    },
    loadThemeClass: loadThemeClass,
    providerById: providerById,
    currentProvider: currentProvider,
    previewView: previewView,
    isDocPreview: isDocPreview,
    sourceEditingActive: sourceEditingActive,
    previewEditable: previewEditable,
    previewEditingActive: previewEditingActive,
    isFormView: isFormView,
    docTree: docTree,
    formPreviewOpen: formPreviewOpen,
    canPreviewLang: canPreviewLang,
    uiIsDark: uiIsDark,
    savedSnapshotState: savedSnapshotState
    ,languageForPath: languageForPath
    ,severityFor: severityFor
    ,onSarifSelect: onSarifSelect
    ,sarifRemapPath: sarifRemapPath
    ,minimapButtonVisible: minimapButtonVisible
    ,setFormInterfaceMode: setFormInterfaceMode
    ,storedFormInterfaceMode: storedFormInterfaceMode
    ,epfRootKind: epfRootKind
    ,previewUndoKey: previewUndoKey
    ,undoDocument: undoDocument
    ,undoTargetModel: undoTargetModel
    ,previewUndoTarget: previewUndoTarget
    ,syncUndoButtons: syncUndoButtons
    ,formMovingEnabled: formMovingEnabled
    ,formMoveTree: formMoveTree
    ,formMoveEntry: formMoveEntry
    ,formDropMode: formDropMode
    ,monacoVisible: monacoVisible
    ,whitespaceRenderOptions: whitespaceRenderOptions
    ,diffTarget: diffTarget
    ,diffAvailable: diffAvailable
    ,diffEditorOptions: diffEditorOptions
    ,hunkRestoreEdit: hunkRestoreEdit
    ,setDiffPref: setDiffPref
    ,diffPrefs: diffPrefs
    ,diffWithoutHost: diffWithoutHost
    ,diffBaseOptions: diffBaseOptions
    ,gitBaselinesAvailable: gitBaselinesAvailable
    ,diffBaseline: diffBaseline
    ,gitBaseLabel: gitBaseLabel
    ,gitRevisionLabel: gitRevisionLabel
    ,gitColumnsHeader: gitColumnsHeader
    ,gitState: gitState
    ,textLayoutAvailable: textLayoutAvailable
    ,currentTextLayout: currentTextLayout
};

function fail(text) {
    var el = document.getElementById('loading');
    el.className = 'error';
    el.textContent = text;
}

/* Announce readiness before Monaco is done so the host can start pushing
 * content while the editor bundle is still being parsed. */
send({ cmd: 'ready' });

var loaderScript = document.createElement('script');
loaderScript.src = VS_BASE + '/loader.js';
loaderScript.onerror = function () {
    fail('Не удалось загрузить Monaco Editor из ' + VS_BASE + '. Переустановите плагин или проверьте подключение к сети.');
};
loaderScript.onload = function () {
    /* Russian UI strings (F1 palette, menus, find widget): editor.main pulls
     * vs/nls.messages.ru.js through the loader before the editor starts. */
    require.config({
        paths: { vs: VS_BASE },
        'vs/nls': { availableLanguages: { '*': 'ru' } }
    });
    require(['vs/editor/editor.main'], function () {
        defineBsl(monaco);
        wireUi();
        monacoReady = true;
        if (pending) {
            var p = pending; pending = null; applyLoad(p);
        } else {
            /* Build the editor while parked/idle so the first F3 is a model
             * swap, not a cold monaco.editor.create in the Lister window. */
            prewarmEditor();
        }
    });
};
document.head.appendChild(loaderScript);

})();
