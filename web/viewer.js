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
    bigFile: false,
    previewId: '',
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
        && m.objectMeta === state.objectMeta && m.commonCommands === state.commonCommands
        && m.commonPictures === state.commonPictures && m.styleItems === state.styleItems
        && m.refMeta === state.refMeta && m.mdRelations === state.mdRelations) return m.result;
    var result = parseWithProviderUncached(p, content);
    parseMemo = {
        p: p, content: content, result: result, baseForm: state.baseForm, objectMeta: state.objectMeta,
        commonCommands: state.commonCommands, commonPictures: state.commonPictures,
        styleItems: state.styleItems, refMeta: state.refMeta, mdRelations: state.mdRelations
    };
    return result;
}

function parseWithProviderUncached(p, content) {
    return PreviewProviders.parse(p, content, {
        baseForm: state.baseForm, objectMeta: state.objectMeta,
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

/* A managed form or spreadsheet preview is a read-only representation.  The
 * standalone editor may still be in its global editing session underneath,
 * but saving is allowed only after the user switches back to the XML/source. */
function sourceEditingActive() {
    return !!(!state.sarifMode && state.isEditing
        && (!(state.previewMode && isDocPreview()) || formModuleOpen()));
}

function languageForPath(path) {
    var m = String(path || '').toLowerCase().match(/\.([^.\\/]+)$/), ext = m ? m[1] : '';
    if (ext === 'bsl' || ext === 'os') return 'bsl';
    if (ext === 'sdbl' || ext === 'query') return 'bsl_query';
    if (ext === 'json' || ext === 'sarif') return 'json';
    if (ext === 'xml') return 'xml';
    if (ext === 'md' || ext === 'markdown') return 'markdown';
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

function onHostMessage(ev) {
    var d = ev.data;
    if (!d || typeof d !== 'object') return;
    switch (d.cmd) {
        case 'load':
            /* Paint the page chrome before Monaco finishes so a dark WebView2
             * surface is not left empty while the bundle parses. */
            document.documentElement.className = loadThemeClass(d);
            /* Fetch the markdown renderer in parallel with Monaco, not after it. */
            if (d.language === 'markdown') loadMarked();
            if (monacoReady) applyLoad(d); else pending = d;
            break;
        case 'find':    doFind(d); break;
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
        case 'sourceContent': onSarifSourceContent(d); break;
        case 'rootChosen': onSarifRootChosen(d); break;
        case 'pdfDone': clearPrintContent(); break;
        case 'screenshotDone': finishFormScreenshot(!!d.ok); break;
        case 'confirmClose': requestClose(); break;
        case 'openFailed': onOpenFailed(d); break;
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
            'editorLineNumber.activeForeground': '#0000ff'
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
            'minimap.background': '#1E1E1E'
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
    monaco.languages.registerCompletionItemProvider('bsl', {
        provideCompletionItems: function (m, pos) { return snippetSuggestions(m, pos); }
    });
    monaco.languages.registerDocumentFormattingEditProvider('bsl', {
        provideDocumentFormattingEdits: function (m) { return formatBsl(m, null); },
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

function formatBsl(m, range) {
    if (!window.BslFormatter) return [];
    var full = m.getFullModelRange();
    var use = range || full;
    var text = m.getValueInRange(use);
    try {
        return window.BslFormatter.format(text, use, { eol: m.getEOL() }) || [];
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
        readOnly: state.sarifMode || !state.isEditing,
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
        renderWhitespace: 'none',
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
    if (!req.resolveContext || !window.FormContext || !/\.xml$/i.test(filePath)) return null;
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
            state.refMeta = context.refMeta || {};
            state.commonCommands = context.commonCommands;
            state.commonPictures = context.commonPictures;
            state.styleItems = context.styleItems;
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
    if (!window.MetadataRelations || !formContextIo || !/\.xml$/i.test(filePath)) return;
    var claimed = detectProvider(req.content || '');
    if (!claimed || claimed.id !== 'metadata') return;
    var parsed = MetadataPreview.parse(req.content || '');
    if (!parsed.model || /^External/.test(parsed.model.kind)) return;
    state.mdRolesAvailable = true;
    mdRolesTarget = { path: filePath, kind: parsed.model.kind, name: parsed.model.name, token: token };
    MetadataRelations.create(formContextIo, mdRelationsCache)
        .load(filePath, parsed.model.kind, parsed.model.name)
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
    var content = req.content || '';
    state.language = req.language || 'bsl';
    state.isDark = preferredDark();
    state.fontSize = req.fontSize || 14;
    state.readOnly = (req.readOnly !== false);
    state.isEditing = !state.readOnly;
    state.previewMode = false;
    state.filePath = req.path || '';
    state.formTitle = req.formTitle || '';
    state.formModule = req.formModule || '';
    state.formModulePath = req.formModulePath || '';
    state.formWorkbenchView = req.formView === 'module' && state.formModulePath ? 'module' : 'form';
    state.baseForm = req.baseForm || '';
    state.objectMeta = req.objectMeta || '';
    state.refMeta = req.refMeta || {};
    state.commonCommands = req.commonCommands || {};
    state.commonPictures = req.commonPictures || {};
    state.styleItems = req.styleItems || {};
    var contextReady = resolveFormContext(req);
    resolveMdRelations(req);
    var loadToken = formContextToken;
    var loaded = detectProvider(content);
    state.previewId = loaded ? loaded.id : '';
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
    baselineContent = content;
    moduleBaselineContent = state.formModule;
    pendingLeaveEdit = false;
    hideSavePrompt();

    var big = content.length > BIG_FILE_CHARS;
    var old = model;
    var oldFormModule = formModuleModel;
    model = monaco.editor.createModel(content, state.language);
    formModuleModel = state.formModulePath
        ? monaco.editor.createModel(state.formModule, 'bsl') : null;
    if (!big && model.getLineCount() > BIG_FILE_LINES) big = true;
    state.bigFile = !!big;

    ensureEditor(big);
    editor.setModel(model);
    if (old) old.dispose();
    if (oldFormModule) oldFormModule.dispose();

    model.onDidChangeContent(function () {
        if (!suppressDirty) state.dirty = true;
        updateStatusBar();
        if (!applyingFromPreview && !suppressDirty) schedulePreviewRefresh();
    });
    if (formModuleModel) formModuleModel.onDidChangeContent(function () {
        if (!suppressDirty) state.moduleDirty = true;
        updateStatusBar();
    });

    // A reused instance may still be showing the previous file's UI state.
    document.getElementById('outline-filter').value = '';
    editor.setScrollPosition({ scrollTop: 0, scrollLeft: 0 });

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
        setPreviewMode(state.language === 'markdown' || state.language === 'html' || isDocPreview(),
                       finishFirstPaint);
        /* Outline scanning walks every line, so let the editor paint first. */
        setTimeout(refreshOutline, 0);
    };
    /* A form drawn before its context arrives is drawn again once commands,
     * pictures and titles resolve - a visible jump and twice the layout work.
     * Usually the context is quick; wait for it briefly under the overlay and
     * fall back to the bare form (updated later) only when it is slow. */
    refreshHelp();
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
    pendingLeaveEdit = false;
    hideSavePrompt();
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
        label: 'Форматировать документ',
        keybindings: [monaco.KeyMod.Alt | monaco.KeyMod.Shift | monaco.KeyCode.KeyF],
        run: function () { formatDocument(); }
    });
    editor.addAction({
        id: 'bsl.comment',
        label: 'Комментировать строку',
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Slash],
        run: function () { toggleLineComment(); }
    });
}

/* Monaco's _applyLayout sets .lines-content to 16777216×16777216. That square
 * layer breaks WebView2 compositing. Replace it with the real scroll size.
 * Do NOT clamp height to ~16k — that clipped view-lines after ~860 rows
 * (860 × 19px ≈ 16340). Width can stay modest; height must cover scrollHeight. */
var MAX_LINES_CONTENT_WIDTH = 100000;
var MAX_LINES_CONTENT_HEIGHT = 1000000;   // same ceiling Monaco uses for margins
function clampLinesContent() {
    if (!editor) return;
    var root = editor.getDomNode();
    if (!root) return;
    var lc = root.querySelector('.lines-content');
    if (!lc) return;
    var layout = editor.getLayoutInfo();
    var h = Math.max(editor.getScrollHeight(), layout.height) + layout.height + 64;
    var w = Math.max(editor.getScrollWidth(), layout.width) + layout.width + 64;
    if (h > MAX_LINES_CONTENT_HEIGHT) h = MAX_LINES_CONTENT_HEIGHT;
    if (w > MAX_LINES_CONTENT_WIDTH) w = MAX_LINES_CONTENT_WIDTH;
    if (lc.style.height !== h + 'px') lc.style.height = h + 'px';
    if (lc.style.width !== w + 'px') lc.style.width = w + 'px';
}

function wireEditorScrollFix() {
    clampLinesContent();
    editor.onDidLayoutChange(clampLinesContent);
    editor.onDidScrollChange(clampLinesContent);
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
    elementEl.textContent = [kindLabel, entry.dataPath, entry.typeName]
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

function renderPropertyInspector() {
    var host = document.getElementById('property-inspector');
    if (!host) return;
    var propertyHandle = document.getElementById('property-resize-handle');
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
    updateStatusBar();
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
    var items = allItems;
    var sortView = previewView();
    if (state.sortByName && sortKeepsTree()) {
        items = sortView.outlineSortByName(allItems);
    } else if (state.sortByName) {
        items = items.filter(function (x) { return x.type !== 'region'; })
                     .sort(function (a, b) { return a.name.toLowerCase().localeCompare(b.name.toLowerCase()); });
    }
    shownOutlineItems = items;
    var cnt = 0;
    for (var i = 0; i < allItems.length; i++) if (allItems[i].type !== 'region') cnt++;

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
            } else if (it.itemKind === 'metadata' && ownIcons && ownIcons.outlineIcon) {
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
            h.push('<div class="proc-item form-el" data-line="', it.line, '" data-id="', esc(it.id || ''),
                   '" data-kind="', esc(it.itemKind || 'element'),
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
    button.title = (shown ? 'Скрыть панель: ' : 'Показать панель: ')
        + (button.getAttribute('data-panel-title') || 'структура');
}

function setIcon(id, name) {
    var svg = document.querySelector('#' + id + ' svg');
    if (!svg) svg = document.querySelector('#' + id + '.tb-btn');
    var use = svg ? svg.querySelector('use') : null;
    var platform = {
        save: 'platform-save.png', edit: 'platform-edit.png', refresh: 'platform-refresh.png',
        search: 'platform-search.png', help: 'platform-help.png', close: 'platform-close.png',
        'arrow-back-up': 'platform-back.png', 'arrow-forward-up': 'platform-forward.png',
        'arrow-up': 'platform-up.png', 'arrow-down': 'platform-down.png',
        'arrow-left': 'platform-left.png', 'arrow-right': 'platform-right.png'
    }[name];
    if (!svg) return;
    var img = svg.parentNode.querySelector('img.platform-icon');
    if (platform) {
        if (!img) {
            img = document.createElement('img');
            img.className = 'tb-icon platform-icon';
            img.alt = '';
            svg.parentNode.appendChild(img);
        }
        img.src = platform;
        svg.style.display = 'none';
        img.style.display = '';
    } else {
        if (use) use.setAttribute('href', '#i-' + name);
        svg.style.display = '';
        if (img) img.style.display = 'none';
    }
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
    outlineToggle.style.display = (isBsl || pv || moduleOpen) ? '' : 'none';
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
    document.getElementById('btn-theme').style.display = formOpen ? 'none' : '';

    var mapBtn = document.getElementById('btn-minimap');
    mapBtn.classList.toggle('active', !!state.minimap);
    mapBtn.title = state.minimap ? 'Скрыть карту кода' : 'Показать карту кода';

    var btnEdit = document.getElementById('btn-edit');
    var btnSave = document.getElementById('btn-save');
    setIcon('btn-edit', state.isEditing ? 'eye' : 'pencil');
    btnEdit.title = state.isEditing ? 'Режим просмотра (Ctrl+E)' : 'Редактировать (Ctrl+E)';
    btnEdit.classList.toggle('active', state.isEditing && !state.sarifMode);
    /* Editing is about source: a form, template or object window shown as a
     * picture has nothing to toggle (the form's Module tab does). */
    btnEdit.style.display = state.sarifMode || (state.previewMode && isDocPreview() && !formModuleOpen())
        ? 'none' : '';
    btnSave.style.display = sourceEditingActive() ? '' : 'none';
    document.getElementById('btn-format').style.display = (!state.sarifMode && state.isEditing && (isBsl || moduleOpen)) ? '' : 'none';
    document.getElementById('btn-comment').style.display = (!state.sarifMode && state.isEditing && (isCode || moduleOpen)) ? '' : 'none';

    setIcon('btn-preview', state.previewMode ? 'code' : 'window');
    var canPreview = canPreviewLang();
    document.getElementById('btn-preview').style.display = canPreview ? '' : 'none';
    mapBtn.style.display = minimapButtonVisible() ? '' : 'none';

    var back = document.getElementById('btn-back');
    if (back) {
        var previous = navHistory.length ? navHistory[navHistory.length - 1] : null;
        back.style.display = previous && host ? '' : 'none';
        back.title = previous ? 'Назад: ' + pathLabel(previous.path) + ' (Alt+\u2190)' : 'Назад';
    }
    var screenshotActions = document.getElementById('form-preview-actions');
    if (screenshotActions) {
        screenshotActions.hidden = !(formPreviewOpen() && isFormView()
            && !document.documentElement.classList.contains('screenshot-mode'));
    }
    syncFormContextProgress();
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

function flushPreviewEdits() {
    if (previewInputTimer) {
        clearTimeout(previewInputTimer);
        previewInputTimer = null;
        writeSourceFromPreview();
    }
}

/* Read-only state and BSL typing aids for the model the editor shows. */
function editingOptions(bsl) {
    var snip = !!(state.isEditing && bsl);
    return {
        readOnly: !state.isEditing,
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
    if (isDocPreview() && !moduleOpen) setPreviewMode(!on);
    applyChrome();
    applyPreviewEditable();
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
    if (state.previewMode && isDocPreview() && !formModuleOpen() && !state.isEditing) return;
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
    var act = editor.getAction('editor.action.formatDocument');
    if (act) act.run();
    editor.focus();
}

function toggleLineComment() {
    if (!state.isEditing || !(isBslFamily() || formModuleOpen()) || !editor) return;
    editor.trigger('bsl', 'editor.action.commentLine');
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
 * the history instead of extending it. */
var navHistory = [];
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

function navigateTo(path, back) {
    if (!host || !path) return false;
    flushPreviewEdits();
    if (anyDirty() && !window.confirm('Несохранённые изменения будут потеряны. Перейти?')) return false;
    navPending = { path: path, back: !!back, from: state.filePath, selectedId: state.formSelectedId };
    send({ cmd: 'open', path: path });
    return true;
}

/* `rel` is relative to the object's own folder: Catalogs/Имя.xml owns
 * Catalogs/Имя/Forms/..., exactly as the Designer dump lays them out. */
function relatedPath(rel) {
    /* Another object of the configuration comes with its full path. */
    if (/^([A-Za-z]:[\\/]|\\\\|\/)/.test(String(rel || ''))) return String(rel);
    var base = String(state.filePath || '').replace(/\.xml$/i, '');
    if (!base || !rel) return '';
    var sep = base.indexOf('\\') >= 0 ? '\\' : '/';
    return base + sep + String(rel).split('/').join(sep);
}

function openRelated(rel) {
    var path = relatedPath(rel);
    if (path) navigateTo(path, false);
}

/* Whether a related file exists, asked through the same configuration host the
 * form context reads from; a host that cannot answer says "yes", so nothing is
 * hidden by mistake. */
function relatedExists(rel) {
    var path = relatedPath(rel);
    if (!path || !window.fetch) return Promise.resolve(true);
    return fetch('https://bslcfg.invalid/file?p=' + encodeURIComponent(path) + '&exists=1')
        .then(function (r) { return r.ok ? r.text() : '1'; })
        .then(function (t) { return t !== '0'; }, function () { return true; });
}

function navigateBack() {
    if (!navHistory.length) return;
    navigateTo(navHistory[navHistory.length - 1].path, true);
}

function trackNavigation(path) {
    var nav = navPending;
    navPending = null;
    if (!nav || nav.path !== path) {
        navHistory = [];
        return;
    }
    if (nav.back) {
        var entry = navHistory.pop();
        if (entry && entry.selectedId) state.formSelectedId = entry.selectedId;
    } else if (nav.from) {
        navHistory.push({ path: nav.from, selectedId: nav.selectedId });
    }
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
    if (/[\\/]Ext[\\/]Form\.xml$/i.test(p)) return p.replace(/Form\.xml$/i, 'Help');
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
    var button = document.getElementById('btn-help');
    if (button) button.style.display = helpState.available ? '' : 'none';
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
    return name.replace(/\.xml$/i, '');
}

/* The page body without the platform's v8help stylesheet, which a browser
 * cannot load; links inside help lead into the platform's help system and
 * are shown as text. */
function helpDocument(html) {
    var body = String(html).replace(/<link[^>]*v8help:[^>]*>(\s*<\/link>)?/gi, '');
    var style = '<style>body{font:13px Arial,Segoe UI,sans-serif;color:#000;background:#fff;margin:12px 16px;}' +
        'h1{font-size:18px;margin:0 0 10px;}h2{font-size:15px;}h3{font-size:13px;}' +
        'a{color:#0645ad;text-decoration:none;cursor:default;}table{border-collapse:collapse;}' +
        'td,th{border:1px solid #ccc;padding:3px 6px;}img{max-width:100%;}</style>';
    return /<head[^>]*>/i.test(body) ? body.replace(/<head[^>]*>/i, function (m) { return m + style; })
        : style + body;
}

function showHelp() {
    if (!helpState.available || !helpState.base) return;
    var base = helpState.base;
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
        document.getElementById('help-title').textContent = 'Справка: ' + helpTitle();
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
        window.alert('Не удалось прочитать справку.');
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
function reloadFromDisk() {
    if (!host) return;
    if (anyDirty() && !window.confirm('Несохранённые изменения будут потеряны. Перечитать файл?')) return;
    Object.keys(formContextCache).forEach(function (key) { delete formContextCache[key]; });
    Object.keys(mdRelationsCache).forEach(function (key) { delete mdRelationsCache[key]; });
    send({ cmd: 'reload' });
}

function onReverted(d) {
    if (d && d.ok && typeof d.content === 'string') applyRevert(d.content);
    if (d && d.ok && typeof d.formModule === 'string') applyModuleRevert(d.formModule);
    pendingLeaveEdit = false;
}

function savedSnapshotState(currentContent, snapshot) {
    return { baseline: snapshot, dirty: currentContent !== snapshot };
}

function onSaveResult(ok, saveId, conflict, target) {
    var pending = pendingSaveSnapshots[String(saveId)] || {};
    delete pendingSaveSnapshots[String(saveId)];
    var toModule = target === 'module';
    var snapshot = pending.snapshot;
    var btnSave = document.getElementById('btn-save');
    /* The layout and the module save as one batch: a failure of either stays
     * on the button even when the other one lands after it. */
    if (!ok) saveBatchFailed = true;
    if (!ok || !saveBatchFailed) {
        btnSave.classList.remove('save-ok', 'save-err');
        btnSave.classList.add(ok ? 'save-ok' : 'save-err');
        btnSave.innerHTML = ok ? '&#10004; Сохранено'
            : (conflict ? '&#9888; ' + (toModule ? 'Модуль изменён извне' : 'Файл изменён извне')
                : '&#10006; Ошибка' + (toModule ? ' записи модуля' : ''));
    }
    if (ok) {
        if (toModule) {
            var savedModule = savedSnapshotState(formModuleModel ? formModuleModel.getValue() : moduleBaselineContent,
                typeof snapshot === 'string' ? snapshot : moduleBaselineContent);
            moduleBaselineContent = savedModule.baseline;
            state.moduleDirty = savedModule.dirty;
        } else {
            var saved = savedSnapshotState(model ? model.getValue() : baselineContent,
                typeof snapshot === 'string' ? snapshot : baselineContent);
            baselineContent = saved.baseline;
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
    setTimeout(function () {
        btnSave.classList.remove('save-ok', 'save-err');
        btnSave.innerHTML = '&#128190; Сохранить';
        applyChrome();
    }, 2000);
}

function saveFile(forPendingAction) {
    if (state.sarifMode) return;
    if ((!sourceEditingActive() && !forPendingAction) || !state.isEditing || !model) return;
    flushPreviewEdits();
    /* Save whatever part of the form changed: the layout, the module or both.
     * With nothing changed, save the part on screen, as a plain file would. */
    var targets = [];
    if (state.dirty) targets.push('form');
    if (state.moduleDirty && formModuleModel) targets.push('module');
    if (!targets.length) targets.push(formModuleOpen() && formModuleModel ? 'module' : 'form');
    saveBatchFailed = false;
    targets.forEach(function (target) {
        var snapshot = target === 'module' ? formModuleModel.getValue() : model.getValue();
        var saveId = String(nextSaveId++);
        pendingSaveSnapshots[saveId] = { target: target, snapshot: snapshot };
        var msg = { cmd: 'save', content: snapshot, saveId: saveId };
        if (target === 'module') msg.target = 'module';
        send(msg);
    });
}

// ------------------------------------------------------------------ search

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
    window[p.viewer].render(parsed.model, host, {
        onSelect: p.id === 'sarif' ? onSarifSelect : onDocPreviewSelect,
        onOpen: window.chrome && window.chrome.webview ? openRelated : null,
        onHelp: window.chrome && window.chrome.webview ? showHelp : null,
        sortByName: !!state.sortByName,
        probe: window.chrome && window.chrome.webview ? relatedExists : null,
        windowTitle: state.formTitle
    });
    syncHelpButton();
    /* A redrawn document keeps the selection the outline already shows. */
    if (p.selectHighlightsPreview && state.formSelectedId && window[p.viewer].highlight)
        window[p.viewer].highlight(host, state.formSelectedId);
    scheduleFormFit();
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
    if (!allItems.length) {
        parseDocOutline();
        renderOutline();
    }
    var view = window[p.viewer];
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
    if (p.selectHighlightsPreview && view.highlight) view.highlight(formPreviewEl(), id);
}

function highlightFormOutline(id) {
    state.formSelectedId = id ? String(id) : '';
    var treeView = docTree() ? previewView() : null;
    if (treeView && treeView.outlineExpandTo && treeView.outlineExpandTo(allItems, id, state.outlineCollapsed)) {
        renderOutline();
        return;
    }
    highlightOutlineRow(state.formSelectedId);
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
            btn.classList.add('active');
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
                editorEl.style.display = '';
                handle.style.display = 'block';
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

// --------------------------------------------------------------------- PDF

function printFrame() { return document.getElementById('print-frame'); }

function printCss() {
    return 'html,body{margin:0;padding:16px 22px;background:#fff;color:#000;'
         + 'font-family:Segoe UI,Arial,sans-serif;font-size:11pt;line-height:1.5}'
         + 'pre{white-space:pre-wrap;word-wrap:break-word;'
         + 'font-family:Consolas,\'Courier New\',monospace;font-size:11pt;margin:0}'
         + '.md-body{font-family:Segoe UI,Arial,sans-serif;font-size:11pt;max-width:100%}'
         + '.md-body pre{background:#f6f8fa;padding:8px;border-radius:4px}'
         + '.md-body code{font-family:Consolas,monospace}'
         + '.md-body h1,.md-body h2,.md-body h3{border-bottom:1px solid #ddd;padding-bottom:4px}'
         + '.md-body table{border-collapse:collapse}'
         + '.md-body td,.md-body th{border:1px solid #999;padding:3px 6px}'
         + 'img{max-width:100%}'
         + '.tp-root{background:#fff;color:#000}'
         + '.tp-scroll{overflow:visible}'
         + '.tp-sheet{display:flex;align-items:flex-start}'
         + '.tp-left{flex:0 0 auto;display:flex;flex-direction:column;background:#ececec}'
         + '.tp-left-body{display:flex}'
         + '.tp-right{flex:0 0 auto}'
         + '.tp-areas{width:92px;flex:0 0 92px;background:#f3f3f3;border-right:1px solid #c8c8c8;font:11px Segoe UI,sans-serif}'
         + '.tp-area-label{border-top:1px solid #e14c4c;border-bottom:1px solid #e14c4c;padding:2px 4px;overflow:hidden}'
         + '.tp-rowhead{width:32px;flex:0 0 32px;background:#ececec;text-align:center;font:10px Segoe UI,sans-serif}'
         + '.tp-grid{border-collapse:collapse;table-layout:fixed;font-family:Arial,sans-serif}'
         + '.tp-grid td,.tp-grid th{border:1px solid #ccc;padding:0 2px;vertical-align:top}'
         + '.tp-grid th{background:#ececec;font:10px Segoe UI,sans-serif}'
         + '.tp-param{color:#7a2e00}'
         + '.tp-row-area-lines{position:relative}'
         + '.tp-row-area-line{border-top:1px solid #e14c4c}'
         + '.tp-drawings{position:relative}'
         + '.tp-drawing{position:absolute}';
}

// The PDF export renders through #print-frame, a sandboxed iframe with no
// allow-scripts: the file being viewed is untrusted input, and this is the
// one path (unlike the read-only preview pane) that used to inject it as
// raw HTML into the viewer's own document. `done` fires only once the new
// srcdoc has actually loaded, so the native PrintToPdf call that follows
// never captures stale or blank content.
function preparePrintContent(done) {
    var frame = printFrame();
    var content = model.getValue();
    var body;
    if (state.previewMode && isDocPreview() && formPreviewEl()) {
        body = '<div class="md-body">' + formPreviewEl().innerHTML + '</div>';
    } else if (state.previewMode && state.language === 'markdown') {
        body = '<div class="md-body">' + renderMarkdown(content) + '</div>';
    } else if (state.previewMode && state.language === 'html') {
        body = '<div class="md-body">' + content + '</div>';
    } else {
        body = '<pre>' + esc(content) + '</pre>';
    }
    var onLoad = function () {
        frame.removeEventListener('load', onLoad);
        // An iframe with height:auto keeps its small CSS/layout viewport when
        // it is printed. Expand it to the document's actual height first, so
        // PrintToPdf captures every line and lets the print engine paginate.
        var doc = frame.contentDocument;
        var height = doc && doc.documentElement && doc.body
            ? Math.max(doc.documentElement.scrollHeight, doc.body.scrollHeight)
            : 0;
        frame.style.height = Math.max(1, height) + 'px';
        if (done) done();
    };
    // Display the frame off-screen while measuring it; a display:none iframe
    // reports a zero layout height even though its document has content.
    frame.classList.add('print-me');
    frame.style.height = '0px';
    frame.addEventListener('load', onLoad);
    frame.srcdoc = '<!DOCTYPE html><html><head><meta charset="utf-8"><style>' + printCss()
                 + '</style></head><body>' + body + '</body></html>';
}

function clearPrintContent() {
    var frame = printFrame();
    frame.removeAttribute('srcdoc');
    frame.classList.remove('print-me');
    frame.style.height = '0px';
}

// ------------------------------------------------------- one-time UI wiring

function wireUi() {
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
            var line = findFormHandlerLine(handlerLink.getAttribute('data-form-handler') || '');
            if (!line) return;
            switchFormWorkbenchView('module');
            if (editor && formModuleModel) {
                editor.revealLineInCenter(line);
                editor.setPosition({ lineNumber: line, column: 1 });
                editor.focus();
            }
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
    document.getElementById('btn-format').addEventListener('click', formatDocument);
    document.getElementById('btn-comment').addEventListener('click', toggleLineComment);
    document.getElementById('save-prompt-yes').addEventListener('click', onSavePromptYes);
    document.getElementById('save-prompt-no').addEventListener('click', onSavePromptNo);
    document.getElementById('save-prompt-cancel').addEventListener('click', onSavePromptCancel);
    document.addEventListener('keydown', function (e) {
        if (!savePromptOpen()) return;
        if (e.key === 'Escape') { e.preventDefault(); onSavePromptCancel(); }
        else if (e.key === 'Enter') { e.preventDefault(); onSavePromptYes(); }
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
    document.getElementById('btn-back').addEventListener('click', navigateBack);
    document.addEventListener('keydown', function (e) {
        if (e.altKey && !e.ctrlKey && !e.shiftKey && e.key === 'ArrowLeft' && navHistory.length) {
            e.preventDefault();
            navigateBack();
        }
    }, true);
    document.getElementById('btn-help').addEventListener('click', showHelp);
    document.getElementById('help-close').addEventListener('click', hideHelp);
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && !document.getElementById('help-panel').hidden) {
            e.preventDefault();
            hideHelp();
        }
    });
    document.getElementById('btn-pdf').addEventListener('click', function () {
        preparePrintContent(function () { send({ cmd: 'pdf' }); });
    });
    document.getElementById('btn-form-screenshot').addEventListener('click', requestFormScreenshot);
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
    loadThemeClass: loadThemeClass,
    providerById: providerById,
    currentProvider: currentProvider,
    previewView: previewView,
    isDocPreview: isDocPreview,
    sourceEditingActive: sourceEditingActive,
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
    require.config({ paths: { vs: VS_BASE } });
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
