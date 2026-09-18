/* The one preview-provider registry shared by every host: the Total Commander
 * viewer, the MCP agent page and the VS Code webview.
 *
 * A provider claims a file and then owns how it is drawn: the outline lists the
 * document's own structure and the preview replaces the source view entirely.
 *
 * First match wins, so order matters — a managed form is also valid XML.
 *
 * `parser` and `viewer` are separate on purpose: an .mxl binary is decoded by
 * MxlPreview but drawn by TemplatePreview, because both produce the same
 * spreadsheet model. Adding a format means adding an entry here, and nothing
 * else in any of the three hosts.
 *
 * Fields the browser hosts do not need are still declared here rather than in
 * each host, so the three stay in step; a host simply ignores what it has no
 * use for. */
(function (root) {
'use strict';

var PROVIDERS = [
    {
        id: 'form',
        parser: 'FormPreview',
        viewer: 'FormPreview',
        label: 'Форма 1С',
        /* A managed form is XML, so in a host that knows the source language
         * this provider must not claim, say, a Markdown file that happens to
         * mention <Form>. Hosts that do not track a language skip the check. */
        requiresLanguage: 'xml',
        /* FormPreview.parse takes the owning object's metadata as its second
         * argument; the other parsers take content only. */
        usesObjectMeta: true,
        /* A form mockup stands in for the real 1C application window, so it
         * always renders as light chrome and hides the theme toggle. */
        lightChrome: true,
        /* Its outline is a collapsible element tree, not a flat list. */
        tree: true,
        outlineTitle: 'Элементы формы',
        sourceTitle: 'Показать форму',
        rootCls: 'fp-root',
        emptyCls: 'fp-empty',
        emptyMsg: 'Это не форма 1С (нет корневого Form / logform).'
    },
    {
        /* The root XML of an object — an external data processor or report, a
         * catalog, a document — drawn as the Designer's object window. Its
         * forms and templates are separate files the host may open from it. */
        id: 'metadata',
        parser: 'MetadataPreview',
        viewer: 'MetadataPreview',
        label: 'Объект метаданных 1С',
        requiresLanguage: 'xml',
        lightChrome: true,
        tree: true,
        outlineTitle: 'Структура объекта',
        sourceTitle: 'Показать объект',
        rootCls: 'md-root',
        emptyCls: 'md-empty',
        emptyMsg: 'Это не объект метаданных 1С.',
        /* MetadataPreview.parse takes what the configuration scan found
         * about the object (metadata-relations.js) as context.relations. */
        usesRelations: true,
        selectHighlightsPreview: true
    },
    {
        id: 'sarif',
        parser: 'SarifPreview',
        viewer: 'SarifPreview',
        label: 'SARIF',
        requiresLanguage: 'json',
        keepsEditor: true,
        previewFirst: true,
        tree: true,
        outlineTitle: 'Структура модуля',
        sourceTitle: 'Показать исходник отчёта',
        rootCls: 'sf-root',
        emptyCls: 'sf-empty',
        emptyMsg: 'Это не отчёт SARIF 2.1.0.'
    },
    {
        id: 'mxl',
        parser: 'MxlPreview',
        viewer: 'TemplatePreview',
        label: 'MXL',
        outlineTitle: 'Области макета',
        sourceTitle: 'Показать макет',
        rootCls: 'tp-root',
        emptyCls: 'tp-empty',
        emptyMsg: 'Это не макет табличного документа 1С.',
        /* Area ids in a spreadsheet outline are synthesised, so selection also
         * matches on the area name and falls back to a text scan. */
        selectMatchesByName: true,
        selectHighlightsPreview: true
    },
    {
        id: 'template',
        parser: 'TemplatePreview',
        viewer: 'TemplatePreview',
        label: 'Макет 1С',
        outlineTitle: 'Области макета',
        sourceTitle: 'Показать макет',
        rootCls: 'tp-root',
        emptyCls: 'tp-empty',
        emptyMsg: 'Это не макет табличного документа 1С.',
        selectMatchesByName: true,
        selectHighlightsPreview: true
    }
];

/* Usable only once both the module that parses for it and the module that
 * draws it are on the page. */
function ready(entry) {
    return !!(entry && root[entry.parser] && root[entry.viewer]);
}

function byId(id) {
    for (var i = 0; i < PROVIDERS.length; i++) {
        if (PROVIDERS[i].id === id) return PROVIDERS[i];
    }
    return null;
}

/* `context.language` is optional: pass it in a host that knows the source
 * language, omit it in a host that only ever opens .xml and .mxl files. */
function detect(content, context) {
    var language = context && context.language;
    for (var i = 0; i < PROVIDERS.length; i++) {
        var entry = PROVIDERS[i];
        if (!ready(entry)) continue;
        if (entry.requiresLanguage && language !== undefined && language !== entry.requiresLanguage) continue;
        if (root[entry.parser].detect(content)) return entry;
    }
    return null;
}

function parse(entry, content, context) {
    var parser = root[entry.parser];
    return entry.usesObjectMeta
        ? parser.parse(content, (context && context.objectMeta) || '',
            (context && context.styleItems) || {}, (context && context.baseForm) || '',
            (context && context.commonCommands) || {}, (context && context.commonPictures) || {},
            (context && context.refMeta) || {})
        : entry.usesRelations ? parser.parse(content, { relations: (context && context.relations) || null })
        : parser.parse(content);
}

/* Clears whatever per-document UI state the renderers keep — folded groups,
 * the selected tab. A host calls this when it opens a different file and never
 * when it re-renders the same one: element ids repeat across unrelated forms,
 * but a form being edited is re-parsed on every keystroke and must keep the
 * view where the user left it. */
function resetViewState() {
    var done = [];
    for (var i = 0; i < PROVIDERS.length; i++) {
        var viewer = root[PROVIDERS[i].viewer];
        if (!viewer || typeof viewer.resetViewState !== 'function') continue;
        /* Two providers can share one viewer module. */
        if (done.indexOf(viewer) >= 0) continue;
        done.push(viewer);
        viewer.resetViewState();
    }
}

/* The module that renders, highlights and outlines for a provider. */
function view(entry) {
    return entry ? root[entry.viewer] : null;
}

root.PreviewProviders = {
    list: PROVIDERS,
    ready: ready,
    byId: byId,
    detect: detect,
    parse: parse,
    resetViewState: resetViewState,
    view: view,
    /* Every host reports an unrecognised file the same way. */
    unsupportedMessage: 'Файл не распознан как форма 1С, Template.xml или MXL.'
};
})(typeof globalThis !== 'undefined' ? globalThis : window);
