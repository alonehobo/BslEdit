(function (root) {
'use strict';

var host = document.getElementById('preview');
var previewPane = document.getElementById('agent-preview-pane');
var empty = document.getElementById('agent-empty');
var pathLabel = document.getElementById('agent-path');
var formatLabel = document.getElementById('agent-format');
var outline = document.getElementById('outline');
var outlineToggle = document.getElementById('outline-toggle');
var current = null;
var lastRevision = -1;
var lastAnnotationVersion = -1;
var sessionAnnotations = root.SessionAnnotations(host, previewPane, function (id) {
    var item = byId(id);
    /* Spreadsheet cells are not in the outline; they are never missing. */
    return { id: id, name: item && item.name || id, title: titleOf(item || { name: id }), missing: !item && !/^r\d+c\d+$/.test(id) };
});
var internalMode = new URLSearchParams(window.location.search).get('internal') === '1';
/* The native server's hidden renderer: nobody looks at this page, so the form
 * gets the whole window without the header and the element outline. */
var bareMode = internalMode && new URLSearchParams(window.location.search).get('bare') === '1';

function fail(message) { throw new Error(message); }
function itemId(item) { return item && (item.id || item.name) ? String(item.id || item.name) : ''; }

/* Which module claims a file, and which one draws it, is decided by the shared
 * registry in packages/1c-preview-core/browser/providers.js — the same one the
 * Total Commander viewer and the VS Code webview use. Provider ids are the
 * `format` values this page reports back over MCP. */
var Providers = root.PreviewProviders;

function providerFor(format) {
    var entry = Providers.byId(format);
    if (!entry) fail('Unknown preview format: ' + format);
    return entry;
}

function titleOf(item) {
    return item.title || item.caption || item.name || item.tag || item.id || 'Без имени';
}

function selectOutlineRow(id) {
    if (!outline) return;
    var rows = outline.querySelectorAll('.outline-item');
    for (var i = 0; i < rows.length; i++) {
        rows[i].classList.toggle('selected', rows[i].getAttribute('data-id') === String(id));
    }
}

function renderOutline() {
    /* The automation page intentionally has no duplicate data-id nodes: its
     * selectors and element captures address the rendered form directly. */
    if (!internalMode || !outline || !current) return;
    outline.innerHTML = '';
    current.outline.forEach(function (item) {
        var row = document.createElement('div');
        row.className = 'outline-item';
        row.setAttribute('data-id', itemId(item));
        row.style.paddingLeft = (7 + Number(item.depth || 0) * 14) + 'px';
        var label = document.createElement('span');
        label.className = 'outline-label';
        label.textContent = titleOf(item);
        label.title = titleOf(item);
        var line = document.createElement('span');
        line.className = 'outline-line';
        line.textContent = item.line ? String(item.line) : '';
        row.appendChild(label);
        row.appendChild(line);
        row.addEventListener('click', function () {
            if (!itemId(item)) return;
            selectElement(itemId(item));
        });
        outline.appendChild(row);
    });
}

/* open_preview base_path: the diff views BSLEdit shows for a file against
 * its git revision, here against another file. Read-only: nothing offers to
 * restore a value, the agent edits with edit_form/edit_template. */
function shortPath(path) {
    return String(path || '').split(/[\\/]/).filter(Boolean).slice(-4).join('/');
}

var COMPARABLE = { form: 'FormDiff', template: 'TemplateDiff', dcs: 'DcsDiff' };

function renderComparison(entry) {
    if (current.diffView && current.diffView.destroy) current.diffView.destroy();
    var baseName = current.baseRevision
        ? (current.baseRevision === 'index' ? 'git: индекс'
            : 'git: ' + current.baseRevision + (current.baseDescription ? ' — ' + current.baseDescription : ''))
        : shortPath(current.basePath);
    var left = { model: current.baseModel, label: 'было: ' + baseName };
    var right = { model: current.model, label: 'стало: ' + shortPath(current.path) };
    if (current.format === 'form') {
        current.diffView = root.FormDiffView.render(document, host, {
            diff: root.FormDiff.compareXml(current.baseContent, current.content), left: left, right: right });
    } else if (current.format === 'template') {
        current.diffView = root.TemplateDiffView.render(document, host, {
            diff: root.TemplateDiff.compare(current.baseModel, current.model), left: left, right: right });
    } else {
        current.diffView = root.DcsDiffView.render(document, host, {
            diff: root.DcsDiff.compareXml(current.baseContent, current.content),
            leftLabel: left.label, rightLabel: right.label });
    }
    formatLabel.textContent = entry.label + ' — сравнение';
    pathLabel.textContent = (current.baseRevision ? baseName : current.basePath) + ' → ' + current.path;
    pathLabel.title = pathLabel.textContent;
}

function renderCurrent() {
    var entry = providerFor(current.format);
    host.hidden = false;
    empty.hidden = true;
    host.classList.toggle('agent-diff', !!current.basePath);
    if (current.basePath) { renderComparison(entry); return; }
    Providers.view(entry).render(current.model, host, {
        onSelect: function (item) {
            current.selectedId = itemId(item);
            selectOutlineRow(current.selectedId);
        }
    });
    formatLabel.textContent = entry.label;
    pathLabel.textContent = current.path;
    pathLabel.title = current.path;
    renderOutline();
    selectOutlineRow(current.selectedId);
    sessionAnnotations.updatePositions();
}

/* The native MCP server sends only the file and asks the page to resolve its
 * context with the shared form-context.js, reading through context-file under
 * the session's roots. The Node server passes a resolved context directly. */
var CONTEXT_MAX_BYTES = 64 * 1024 * 1024;
var contextCache = {};

/* Metadata resolved for the previous revision of the file - object properties,
 * the base form, style items. Anything that re-reads the file must drop it,
 * not only the refresh button: a save in BSLEdit may have changed exactly what
 * is cached here. */
function resetContextCache() {
    Object.keys(contextCache).forEach(function (key) { delete contextCache[key]; });
}
var contextToken = 0;

/* Lookups go out in batches to context-batch; see FormContext.createHttpIo. */
var contextIo = root.FormContext ? root.FormContext.createHttpIo('context-file', 'context-batch') : null;

function load(input) {
    var token = ++contextToken;
    if (!input || !input.resolveContext || !root.FormContext) return loadResolved(input);
    return root.FormContext.createResolver(contextIo, { maxBytes: CONTEXT_MAX_BYTES, cache: contextCache })
        .resolve(input.path, input.content || '')
        .then(function (context) {
            if (token !== contextToken) return state();
            var resolved = {};
            Object.keys(input).forEach(function (key) { resolved[key] = input[key]; });
            Object.keys(context).forEach(function (key) {
                if (key === 'interfaceMode' && input.interfaceMode && input.interfaceMode !== 'Any') return;
                resolved[key] = context[key];
            });
            return loadResolved(resolved);
        });
}

function loadResolved(input) {
    var entry = Providers.detect(input.content, {});
    if (!entry) fail(Providers.unsupportedMessage);
    var sameDocument = !!(current && current.path === input.path && current.basePath === (input.basePath || '')
        && current.baseRevision === (input.baseRevision || ''));
    var savedScrolls = sameDocument ? scrolls() : [];
    /* reload_preview re-loads the file that is already open and has to keep the
     * view the agent navigated to; a different file starts clean. */
    if (!sameDocument) Providers.resetViewState();
    var parsed = Providers.parse(entry, input.content, {
        baseForm: input.baseForm || '',
        objectMeta: input.objectMeta,
        interfaceMode: input.interfaceMode || 'Any',
        configInterfaceMode: input.configInterfaceMode || '',
        commonCommands: input.commonCommands || {},
        commonPictures: input.commonPictures || {},
        styleItems: input.styleItems || {},
        refMeta: input.refMeta || {}
    });
    if (!parsed || parsed.error || !parsed.model) fail((parsed && parsed.error) || 'The renderer did not produce a model.');
    var baseModel = null;
    if (input.basePath) {
        var module = COMPARABLE[entry.id];
        if (!module || !root[module] || !root[module + 'View'])
            fail('base_path: comparison is supported for managed forms, Template.xml and data composition schemas, not ' + entry.label + '.');
        var baseEntry = Providers.detect(input.baseContent || '', {});
        if (!baseEntry || baseEntry.id !== entry.id)
            fail('base_path is not the same kind of document as path (' + (baseEntry ? baseEntry.label : 'not recognised') + ' vs ' + entry.label + ').');
        /* Both versions describe the same object: the context resolved for
         * path (object metadata, base form, styles) serves the earlier one. */
        var baseParsed = Providers.parse(entry, input.baseContent, {
            baseForm: input.baseForm || '', objectMeta: input.objectMeta,
            interfaceMode: input.interfaceMode || 'Any', commonCommands: input.commonCommands || {},
            commonPictures: input.commonPictures || {}, styleItems: input.styleItems || {}, refMeta: input.refMeta || {}
        });
        if (!baseParsed || baseParsed.error || !baseParsed.model)
            fail('base_path could not be parsed: ' + ((baseParsed && baseParsed.error) || 'no model'));
        baseModel = baseParsed.model;
    }
    if (current && current.diffView && current.diffView.destroy) current.diffView.destroy();
    current = {
        format: entry.id,
        path: input.path,
        content: input.content,
        baseForm: input.baseForm || '',
        objectMeta: input.objectMeta || '',
        interfaceMode: input.interfaceMode || 'Any',
        refMeta: input.refMeta || {},
        commonCommands: input.commonCommands || {},
        commonPictures: input.commonPictures || {},
        styleItems: input.styleItems || {},
        model: parsed.model,
        basePath: input.basePath || '',
        baseContent: input.baseContent || '',
        baseRevision: input.baseRevision || '',
        baseDescription: input.baseDescription || '',
        baseModel: baseModel,
        diffView: null,
        outline: Providers.view(entry).outline(parsed.model, input.content) || [],
        selectedId: ''
    };
    renderCurrent();
    savedScrolls.forEach(function (saved) {
        var node;
        try { node = findScrollTarget(saved.target, saved.elementId || ''); } catch (error) { node = null; }
        if (!node) return;
        node.scrollLeft = saved.x;
        node.scrollTop = saved.y;
        node.dispatchEvent(new Event('scroll', { bubbles: true }));
    });
    return state();
}

function requireCurrent() {
    if (!current) fail('No preview is open. Call open_preview first.');
    return current;
}

function byId(id) {
    var items = requireCurrent().outline;
    for (var i = 0; i < items.length; i++) if (String(items[i].id) === String(id)) return items[i];
    return null;
}

function findDom(id) {
    var nodes = host.querySelectorAll('[data-id]');
    for (var i = 0; i < nodes.length; i++) if (nodes[i].getAttribute('data-id') === String(id)) return nodes[i];
    return null;
}

function visible(node) {
    if (!node) return false;
    var style = getComputedStyle(node);
    var rect = node.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
}

function modelPages() {
    var map = Object.create(null);
    function walk(items) {
        (items || []).forEach(function (item) {
            if (!item) return;
            if (item.tag === 'Pages') {
                map[itemId(item)] = (item.childItems || []).filter(function (child) { return child && child.tag === 'Page'; });
            }
            walk(item.childItems);
            if (item.autoCommandBar) walk([item.autoCommandBar]);
        });
    }
    if (current && current.model) {
        walk(current.model.childItemsRoot);
        if (current.model.autoCommandBar) walk([current.model.autoCommandBar]);
    }
    return map;
}

function tabs() {
    if (!current || current.format !== 'form') return [];
    var pages = modelPages();
    var result = [];
    var lists = host.querySelectorAll('.fp-pages-tablist');
    for (var i = 0; i < lists.length; i++) {
        var wrapper = lists[i].closest('.fp-item[data-id]');
        var pagesId = wrapper ? wrapper.getAttribute('data-id') : '';
        var pageItems = pages[pagesId] || [];
        var buttons = lists[i].querySelectorAll('[role="tab"]');
        for (var j = 0; j < buttons.length; j++) {
            result.push({
                pagesId: pagesId,
                pageId: itemId(pageItems[j]),
                name: pageItems[j] && pageItems[j].name || '',
                caption: buttons[j].textContent || '',
                active: buttons[j].getAttribute('aria-selected') === 'true'
            });
        }
    }
    return result;
}

function scrollInfo(node, target, elementId) {
    if (!node) return null;
    return {
        target: target,
        elementId: elementId || '',
        x: node.scrollLeft,
        y: node.scrollTop,
        maxX: Math.max(0, node.scrollWidth - node.clientWidth),
        maxY: Math.max(0, node.scrollHeight - node.clientHeight),
        clientWidth: node.clientWidth,
        clientHeight: node.clientHeight
    };
}

function scrolls() {
    if (!current) return [];
    var result = [];
    var documentScroll = current.format === 'form' ? host.querySelector('.fp-body') : host.querySelector('.tp-scroll');
    var info = scrollInfo(documentScroll, 'document', '');
    if (info) result.push(info);
    host.querySelectorAll('.fp-pages-active-panel').forEach(function (node) {
        var owner = node.closest('.fp-item[data-id]');
        result.push(scrollInfo(node, 'active-page', owner && owner.getAttribute('data-id')));
    });
    host.querySelectorAll('.fp-table-mock').forEach(function (node) {
        var owner = node.closest('.fp-item[data-id]');
        result.push(scrollInfo(node, 'table', owner && owner.getAttribute('data-id')));
    });
    host.querySelectorAll('.fp-spreadsheet-viewport').forEach(function (node) {
        var owner = node.closest('.fp-item[data-id]');
        result.push(scrollInfo(node, 'spreadsheet', owner && owner.getAttribute('data-id')));
    });
    return result.filter(Boolean);
}

function state() {
    requireCurrent();
    var rect = host.getBoundingClientRect();
    var props = current.model.properties || {};
    return {
        format: current.format,
        path: current.path,
        selectedId: current.selectedId,
        summary: {
            elements: current.outline.length,
            sourceWidth: current.model.width || props.Width || null,
            sourceHeight: current.model.height || props.Height || null,
            viewportWidth: document.documentElement.clientWidth,
            viewportHeight: document.documentElement.clientHeight,
            previewWidth: Math.round(rect.width),
            previewHeight: Math.round(rect.height)
        },
        tabs: tabs(),
        scrolls: scrolls()
    };
}

function inspect(options) {
    requireCurrent();
    options = options || {};
    var needle = String(options.query || '').trim().toLocaleLowerCase();
    var tabRows = tabs();
    var parents = [];
    return current.outline.map(function (item) {
        var id = String(item.id || '');
        var depth = Number(item.depth || 0);
        parents.length = depth;
        var node = findDom(id);
        var tab = tabRows.find(function (row) { return row.pageId === id; });
        var row = {
            id: id,
            name: item.name || '',
            caption: item.title || item.caption || item.name || '',
            tag: item.tag || item.kind || item.type || '',
            depth: depth,
            parentId: depth > 0 ? (parents[depth - 1] || '') : '',
            line: item.line || null,
            visible: tab ? true : visible(node),
            activePage: tab ? !!tab.active : false
        };
        parents[depth] = id;
        return row;
    }).filter(function (row) {
        if (options.visibleOnly && !row.visible) return false;
        if (!needle) return true;
        return [row.id, row.name, row.caption, row.tag].join('\n').toLocaleLowerCase().indexOf(needle) >= 0;
    });
}

function selectElement(id) {
    var item = byId(id);
    if (!item) fail('Unknown element_id: ' + id);
    var view = Providers.view(providerFor(current.format));
    if (!view.highlight) fail('The active renderer does not support selection.');
    var hit = view.highlight(host, String(id));
    current.selectedId = String(id);
    selectOutlineRow(id);
    sessionAnnotations.updatePositions();
    return { found: !!hit, element: item, state: state() };
}

function switchTab(pageId, pagesId) {
    if (requireCurrent().format !== 'form') fail('switch_tab is available only for Form.xml previews.');
    var allPages = modelPages();
    var matches = [];
    Object.keys(allPages).forEach(function (ownerId) {
        allPages[ownerId].forEach(function (page) {
            if (itemId(page) === String(pageId) && (!pagesId || ownerId === String(pagesId))) {
                matches.push({ pagesId: ownerId, page: page });
            }
        });
    });
    if (!matches.length) fail('Unknown page_id' + (pagesId ? ' for pages_id ' + pagesId : '') + ': ' + pageId);
    if (matches.length > 1) fail('page_id is ambiguous; provide pages_id. Candidates: ' + matches.map(function (m) { return m.pagesId; }).join(', '));
    root.FormPreview.highlight(host, String(pageId));
    current.selectedId = String(pageId);
    sessionAnnotations.updatePositions();
    return state();
}

function findScrollTarget(target, elementId) {
    if (target === 'document') return current.format === 'form' ? host.querySelector('.fp-body') : host.querySelector('.tp-scroll');
    if (target === 'active-page') {
        if (elementId) {
            var pages = findDom(elementId);
            return pages && pages.querySelector('.fp-pages-active-panel');
        }
        var panels = host.querySelectorAll('.fp-pages-active-panel');
        return panels.length ? panels[panels.length - 1] : null;
    }
    if (!elementId) fail('element_id is required for target ' + target + '.');
    var owner = findDom(elementId);
    if (!owner) fail('Element is not visible: ' + elementId);
    if (target === 'table') return owner.querySelector('.fp-table-mock');
    if (target === 'spreadsheet') return owner.querySelector('.fp-spreadsheet-viewport');
    fail('Unknown scroll target: ' + target);
}

function scroll(options) {
    requireCurrent();
    var node = findScrollTarget(options.target, options.elementId || '');
    if (!node) fail('Scrollable target is not available in the current view.');
    var before = scrollInfo(node, options.target, options.elementId);
    if (typeof options.x === 'number') node.scrollLeft = options.x;
    else node.scrollLeft += Number(options.deltaX || 0);
    if (typeof options.y === 'number') node.scrollTop = options.y;
    else node.scrollTop += Number(options.deltaY || 0);
    node.dispatchEvent(new Event('scroll', { bubbles: true }));
    return { before: before, after: scrollInfo(node, options.target, options.elementId), state: state() };
}

function elementSelector(id) {
    var node = findDom(id);
    if (!node) fail('Element is not visible: ' + id);
    node.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    return '[data-id="' + String(id).replace(/["\\]/g, '\\$&') + '"]';
}

function addFrozenScrollbar(node, horizontal, offset, scrollSize, clientSize, crossScrollable) {
    var thickness = 12;
    var inset = crossScrollable ? thickness : 0;
    var trackLength = Math.max(1, clientSize - inset - 2);
    var thumbLength = Math.max(20, Math.round(trackLength * clientSize / scrollSize));
    thumbLength = Math.min(trackLength, thumbLength);
    var maxOffset = Math.max(1, scrollSize - clientSize);
    var thumbOffset = Math.round((trackLength - thumbLength) * offset / maxOffset);
    var track = document.createElement('div');
    var thumb = document.createElement('div');
    track.style.cssText = 'position:absolute;z-index:2147483647;pointer-events:none;box-sizing:border-box;background:#f1f1f1;';
    thumb.style.cssText = 'position:absolute;box-sizing:border-box;background:#c1c1c1;border:2px solid #f1f1f1;border-radius:6px;';
    if (horizontal) {
        track.style.left = '1px';
        track.style.right = (inset + 1) + 'px';
        track.style.bottom = '1px';
        track.style.height = thickness + 'px';
        thumb.style.left = thumbOffset + 'px';
        thumb.style.top = '0';
        thumb.style.width = thumbLength + 'px';
        thumb.style.height = thickness + 'px';
    } else {
        track.style.top = '1px';
        track.style.bottom = (inset + 1) + 'px';
        track.style.right = '1px';
        track.style.width = thickness + 'px';
        thumb.style.left = '0';
        thumb.style.top = thumbOffset + 'px';
        thumb.style.width = thickness + 'px';
        thumb.style.height = thumbLength + 'px';
    }
    track.appendChild(thumb);
    node.appendChild(track);
}

/* cloneNode copies markup, not the live scrollLeft/scrollTop properties. The
 * screenshot is serialized immediately afterwards, so represent each current
 * scroll position as a static translation that survives XMLSerializer. */
function freezeScrollPosition(original, clone) {
    var x = original.scrollLeft;
    var y = original.scrollTop;
    if (!x && !y) return;
    var maxX = Math.max(0, original.scrollWidth - original.clientWidth);
    var maxY = Math.max(0, original.scrollHeight - original.clientHeight);
    var children = Array.prototype.slice.call(clone.children);
    for (var i = 0; i < children.length; i++) {
        var transform = children[i].style.getPropertyValue('transform');
        if (transform === 'none') transform = '';
        children[i].style.setProperty('transform',
            'translate(' + (-x) + 'px,' + (-y) + 'px)' + (transform ? ' ' + transform : ''), 'important');
        children[i].style.setProperty('transform-origin', '0 0', 'important');
    }
    clone.style.setProperty('overflow', 'hidden', 'important');
    if (getComputedStyle(original).position === 'static')
        clone.style.setProperty('position', 'relative', 'important');
    if (maxX) addFrozenScrollbar(clone, true, x, original.scrollWidth, original.clientWidth, !!maxY);
    if (maxY) addFrozenScrollbar(clone, false, y, original.scrollHeight, original.clientHeight, !!maxX);
}

/* The screenshot is an SVG image of a cloned subtree, a separate document: a
 * `<use href="#i-...">` there cannot reach the page's icon sprite and painted
 * as a black blot. Carry the referenced symbols along with the clone. */
function appendSpriteSymbols(clone, wrapper) {
    var ids = [];
    var uses = clone.querySelectorAll('use');
    for (var i = 0; i < uses.length; i++) {
        var reference = uses[i].getAttribute('href') || uses[i].getAttribute('xlink:href') || '';
        if (reference.charAt(0) === '#' && ids.indexOf(reference.substring(1)) < 0) ids.push(reference.substring(1));
    }
    if (!ids.length) return;
    var sprite = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    sprite.setAttribute('style', 'display:none');
    sprite.setAttribute('aria-hidden', 'true');
    ids.forEach(function (id) {
        var symbol = document.getElementById(id);
        if (symbol) sprite.appendChild(symbol.cloneNode(true));
    });
    wrapper.insertBefore(sprite, wrapper.firstChild);
}

function captureNode(node, fullDocument) {
    if (!node) fail('Capture target is not available.');
    var page = node === document.documentElement || node === document.body;
    /* Viewport and document captures of the internal page frame the form host
     * only: the header and the element outline are viewer chrome. */
    var frame = !page && node === host;
    var rect = node.getBoundingClientRect();
    var width = Math.max(1, Math.ceil(page ? document.documentElement.clientWidth : rect.width));
    var height = Math.max(1, Math.ceil(page ? document.documentElement.clientHeight : rect.height));
    if (fullDocument) {
        var documentScroll = current && (current.format === 'form' ? host.querySelector('.fp-body') : host.querySelector('.tp-scroll'));
        var originX = page ? 0 : rect.left;
        var originY = page ? 0 : rect.top;
        if (documentScroll) {
            var scrollRect = documentScroll.getBoundingClientRect();
            width = Math.max(width, Math.ceil(scrollRect.left - originX + documentScroll.scrollWidth));
            height = Math.max(height, Math.ceil(scrollRect.top - originY + documentScroll.scrollHeight));
        }
        if (page) {
            width = Math.max(width, document.body.scrollWidth, document.documentElement.scrollWidth);
            height = Math.max(height, document.body.scrollHeight, document.documentElement.scrollHeight);
        }
    }
    var clone = node.cloneNode(true);
    var allOriginal = [node].concat(Array.prototype.slice.call(node.querySelectorAll('*')));
    var allClone = [clone].concat(Array.prototype.slice.call(clone.querySelectorAll('*')));
    for (var i = 0; i < allOriginal.length && i < allClone.length; i++) {
        var computed = getComputedStyle(allOriginal[i]);
        for (var j = 0; j < computed.length; j++) {
            var property = computed[j];
            allClone[i].style.setProperty(property, computed.getPropertyValue(property), computed.getPropertyPriority(property));
        }
    }
    for (var k = 0; k < allOriginal.length && k < allClone.length; k++) {
        if (fullDocument &&(allOriginal[k].scrollWidth > allOriginal[k].clientWidth || allOriginal[k].scrollHeight > allOriginal[k].clientHeight)) {
            allClone[k].style.setProperty('width', allOriginal[k].scrollWidth + 'px', 'important');
            allClone[k].style.setProperty('height', allOriginal[k].scrollHeight + 'px', 'important');
            allClone[k].style.setProperty('max-width', 'none', 'important');
            allClone[k].style.setProperty('max-height', 'none', 'important');
            allClone[k].style.setProperty('overflow', 'visible', 'important');
        } else {
            freezeScrollPosition(allOriginal[k], allClone[k]);
        }
    }
    var wrapper = document.createElement('div');
    wrapper.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
    wrapper.style.cssText = 'width:' + width + 'px;height:' + height + 'px;overflow:hidden;background:' + getComputedStyle(document.body).backgroundColor + ';';
    if (page) {
        while (clone.firstChild) wrapper.appendChild(clone.firstChild);
    } else {
        if (frame) {
            clone.style.setProperty('position', 'relative', 'important');
            clone.style.setProperty('inset', 'auto', 'important');
            clone.style.setProperty('width', width + 'px', 'important');
            clone.style.setProperty('height', height + 'px', 'important');
        }
        wrapper.appendChild(clone);
    }
    appendSpriteSymbols(clone, wrapper);
    var markup = new XMLSerializer().serializeToString(wrapper);
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '"><foreignObject width="100%" height="100%">' + markup + '</foreignObject></svg>';
    return new Promise(function (resolve, reject) {
        var image = new Image();
        image.onload = function () {
            var canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            var context = canvas.getContext('2d');
            context.drawImage(image, 0, 0);
            var result = canvas.toDataURL('image/png');
            resolve({ data: result.substring(result.indexOf(',') + 1), mimeType: 'image/png' });
        };
        image.onerror = function () { reject(new Error('The browser could not render the preview as PNG.')); };
        image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    });
}

/* The whole spreadsheet as one PNG. Cloning the full sheet at its scroll size
 * lays the table out again at another width: rows grow and drawings leave
 * their rows. Instead the page is cloned once at its real viewport size, and
 * each tile only shifts the clone's content, as the viewport capture does for
 * a scrolled view; tiles are cut and stitched on a canvas. Column letters and
 * row numbers are taken from the first row and column of tiles. A huge
 * template is scaled down to stay within canvas limits. */
var STITCH_MAX_SIDE = 16000;
var STITCH_MAX_AREA = 120000000;

function renderMarkup(markup, width, height) {
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '"><foreignObject width="100%" height="100%">' + markup + '</foreignObject></svg>';
    return new Promise(function (resolve, reject) {
        var image = new Image();
        image.onload = function () { resolve(image); };
        image.onerror = function () { reject(new Error('The browser could not render the preview as PNG.')); };
        image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    });
}

function captureTemplateDocument(scroll) {
    var hostRect = host.getBoundingClientRect();
    var scrollRect = scroll.getBoundingClientRect();
    var offsetX = scrollRect.left - hostRect.left;
    var offsetY = scrollRect.top - hostRect.top;
    var left = scroll.querySelector('.tp-left');
    var chrome = scroll.querySelector('.tp-col-chrome');
    var headW = left ? Math.round(left.getBoundingClientRect().width) : 0;
    var headH = chrome ? Math.round(chrome.getBoundingClientRect().height) : 0;
    var viewW = scroll.clientWidth;
    var viewH = scroll.clientHeight;
    var totalW = Math.max(viewW, scroll.scrollWidth);
    var totalH = Math.max(viewH, scroll.scrollHeight);
    var maxX = totalW - viewW;
    var maxY = totalH - viewH;
    var stepX = Math.max(1, viewW - headW);
    var stepY = Math.max(1, viewH - headH);
    var scale = Math.min(1, STITCH_MAX_SIDE / totalW, STITCH_MAX_SIDE / totalH, Math.sqrt(STITCH_MAX_AREA / (totalW * totalH)));
    var width = Math.max(1, Math.ceil(hostRect.width));
    var height = Math.max(1, Math.ceil(hostRect.height));

    /* One clone with computed styles, at scroll 0,0 of the real layout. */
    var savedX = scroll.scrollLeft;
    var savedY = scroll.scrollTop;
    scroll.scrollLeft = 0;
    scroll.scrollTop = 0;
    var clone = host.cloneNode(true);
    var allOriginal = [host].concat(Array.prototype.slice.call(host.querySelectorAll('*')));
    var allClone = [clone].concat(Array.prototype.slice.call(clone.querySelectorAll('*')));
    var scrollClone = null;
    for (var i = 0; i < allOriginal.length && i < allClone.length; i++) {
        var computed = getComputedStyle(allOriginal[i]);
        for (var j = 0; j < computed.length; j++) {
            var property = computed[j];
            allClone[i].style.setProperty(property, computed.getPropertyValue(property), computed.getPropertyPriority(property));
        }
        if (allOriginal[i] === scroll) scrollClone = allClone[i];
    }
    scroll.scrollLeft = savedX;
    scroll.scrollTop = savedY;
    if (!scrollClone) fail('The spreadsheet scroll area is not available.');
    scrollClone.style.setProperty('overflow', 'hidden', 'important');
    if (getComputedStyle(scroll).position === 'static') scrollClone.style.setProperty('position', 'relative', 'important');
    clone.style.setProperty('position', 'relative', 'important');
    clone.style.setProperty('inset', 'auto', 'important');
    clone.style.setProperty('width', width + 'px', 'important');
    clone.style.setProperty('height', height + 'px', 'important');
    var content = Array.prototype.slice.call(scrollClone.children);
    var baseTransforms = content.map(function (child) {
        var t = child.style.getPropertyValue('transform');
        return t === 'none' ? '' : t;
    });
    var wrapper = document.createElement('div');
    wrapper.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
    wrapper.style.cssText = 'width:' + width + 'px;height:' + height + 'px;overflow:hidden;background:' + getComputedStyle(document.body).backgroundColor + ';';
    wrapper.appendChild(clone);
    appendSpriteSymbols(clone, wrapper);

    var canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.floor(totalW * scale));
    canvas.height = Math.max(1, Math.floor(totalH * scale));
    var context = canvas.getContext('2d');
    context.fillStyle = getComputedStyle(document.body).backgroundColor || '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);

    var positions = [];
    for (var y = 0; ; y = Math.min(maxY, y + stepY)) {
        for (var x = 0; ; x = Math.min(maxX, x + stepX)) {
            positions.push([x, y]);
            if (x >= maxX) break;
        }
        if (y >= maxY) break;
    }

    function draw(image, sx, sy, sw, sh, dx, dy) {
        if (sw <= 0 || sh <= 0) return;
        context.drawImage(image, offsetX + sx, offsetY + sy, sw, sh, dx * scale, dy * scale, sw * scale, sh * scale);
    }

    function tile(index) {
        if (index >= positions.length) return Promise.resolve();
        var px = positions[index][0];
        var py = positions[index][1];
        content.forEach(function (child, k) {
            child.style.setProperty('transform', 'translate(' + (-px) + 'px,' + (-py) + 'px)' + (baseTransforms[k] ? ' ' + baseTransforms[k] : ''), 'important');
            child.style.setProperty('transform-origin', '0 0', 'important');
        });
        return renderMarkup(new XMLSerializer().serializeToString(wrapper), width, height).then(function (image) {
            /* Sticky chrome moves with the shifted content in the clone, so it
             * is only taken where the tile is not shifted along that axis. */
            draw(image, headW, headH, viewW - headW, viewH - headH, headW + px, headH + py);
            if (py === 0) draw(image, headW, 0, viewW - headW, headH, headW + px, 0);
            if (px === 0) draw(image, 0, headH, headW, viewH - headH, 0, headH + py);
            if (px === 0 && py === 0) draw(image, 0, 0, headW, headH, 0, 0);
            return tile(index + 1);
        });
    }

    return tile(0).then(function () {
        var result = canvas.toDataURL('image/png');
        return { data: result.substring(result.indexOf(',') + 1), mimeType: 'image/png', width: canvas.width, height: canvas.height, scale: scale };
    });
}

/* Picture.zip resources decode asynchronously and show a placeholder glyph
 * meanwhile. A capture straight after open_preview must not freeze those
 * placeholders into the PNG, so wait (bounded) until they are replaced. */
function whenPicturesDecoded(timeoutMs) {
    var deadline = Date.now() + timeoutMs;
    return new Promise(function (resolve) {
        (function poll() {
            if (!host.querySelector('.fp-picture-loading') || Date.now() >= deadline) {
                requestAnimationFrame(function () { resolve(); });
                return;
            }
            setTimeout(poll, 25);
        })();
    });
}

function reflow() {
    if (current && current.format === 'form' && root.FormPreview && root.FormPreview.reflow)
        root.FormPreview.reflow(host);
    return state();
}

function capture(scope, elementId) {
    if (scope === 'element' && !elementId) fail('element_id is required when scope is element.');
    return whenPicturesDecoded(3000).then(function () {
        /* A template's drawings follow the laid-out rows; settle them first. */
        if (root.TemplatePreview && root.TemplatePreview.sync) {
            var sheet = host.querySelector('.tp-root') || host;
            root.TemplatePreview.sync(sheet._tpModel ? sheet : host);
        }
        if (scope === 'element') return captureNode(findDom(elementId), false);
        var sheetScroll = current && current.format !== 'form' && !current.basePath ? host.querySelector('.tp-scroll') : null;
        if (internalMode && scope === 'document' && sheetScroll) return captureTemplateDocument(sheetScroll);
        if (internalMode) return captureNode(host, scope === 'document');
        return captureNode(scope === 'document' ? document.body : document.documentElement, scope === 'document');
    });
}

root.AgentViewer = {
    ready: true,
    load: load,
    state: state,
    inspect: inspect,
    selectElement: selectElement,
    switchTab: switchTab,
    scroll: scroll,
    reflow: reflow,
    elementSelector: elementSelector,
    capture: capture
};

if (bareMode) document.body.classList.add('bare');
if (internalMode && !bareMode) {
    document.body.classList.add('browser-ui');
    var collapsed = true;
    try { collapsed = sessionStorage.getItem('1cFormViewer.outlineCollapsed') !== '0'; } catch (error) {}
    function updateOutline() {
        document.body.classList.toggle('outline-collapsed', collapsed);
        outlineToggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
        outlineToggle.title = collapsed ? 'Показать панель элементов' : 'Скрыть панель элементов';
    }
    outlineToggle.addEventListener('click', function () {
        collapsed = !collapsed;
        try { sessionStorage.setItem('1cFormViewer.outlineCollapsed', collapsed ? '1' : '0'); } catch (error) {}
        updateOutline();
    });
    updateOutline();
}

/* Internal mode: the page pulls the document and its commands over HTTP instead
 * of being driven from outside.
 *
 * Only the native C++ server implements the command channel — the Node server
 * drives this same page through the browser automation API and serves no
 * `command` endpoint. So the poll stops itself the first time the endpoint is
 * absent rather than issuing a 404 five times a second forever. */
if (internalMode) {
    var commandBusy = false;
    var commandTimer = 0;

    function postResult(command, result) {
        return fetch('result', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: command.id, ok: true, value: result })
        });
    }

    function postError(command, error) {
        return fetch('result', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: command.id, ok: false, error: error instanceof Error ? error.message : String(error) })
        });
    }

    /* File transforms for the authoring tools. They need no open document: the
     * server reads and writes the files, the page only runs the shared code. */
    var TRANSFORMS = { xlsxToTemplate: true, markup: true, form: true };

    function runTransform(command) {
        var args = command.args || {};
        if (command.op === 'xlsxToTemplate') {
            if (!root.XlsxTemplate) fail('The xlsx converter is not loaded.');
            return root.XlsxTemplate.convert(args.data, { sheet: args.sheet });
        }
        if (command.op === 'form') {
            if (!root.FormEdit) fail('The form editing module is not loaded.');
            if (args.action === 'list') return { xml: args.content, result: root.FormEdit.listElements(args.content) };
            if (args.action === 'validate') {
                if (!root.FormValidate) fail('The form validator is not loaded.');
                return { xml: args.content, result: root.FormValidate.validateForm(args.content, args.params || {}) };
            }
            if (args.action === 'setProperties' || args.action === 'moveElement' || args.action === 'removeElement'
                || args.action === 'addElement' || args.action === 'setAttribute' || args.action === 'setCommand') {
                return root.FormEdit[args.action](args.content, args.params || {});
            }
            fail('Unknown form action: ' + args.action);
        }
        if (!root.TemplateMarkup) fail('The template markup module is not loaded.');
        var markup = root.TemplateMarkup;
        if (args.action === 'list') return { xml: args.content, result: markup.listMarkup(args.content) };
        if (args.action === 'validate') return { xml: args.content, result: markup.validateTemplate(args.content) };
        /* Every other action edits: (xml, params) → { xml, result }. */
        if (args.action !== 'listMarkup' && args.action !== 'validateTemplate' && typeof markup[args.action] === 'function') {
            var params = args.params || {};
            /* Nested objects (print_area) keep the tool's snake_case keys. */
            if (params.printArea) {
                var area = {};
                Object.keys(params.printArea).forEach(function (key) {
                    area[key.replace(/_([a-z])/g, function (m, ch) { return ch.toUpperCase(); })] = params.printArea[key];
                });
                params.printArea = area;
            }
            return markup[args.action](args.content, params);
        }
        fail('Unknown markup action: ' + args.action);
    }

    function executeCommand(command) {
        var args = command.args || {};
        if (TRANSFORMS[command.op]) {
            return Promise.resolve().then(function () { return runTransform(command); })
                .then(function (value) { return postResult(command, value); }, function (error) { return postError(command, error); });
        }
        try {
            var value;
            if (command.op === 'inspect') value = { elements: root.AgentViewer.inspect(args), state: root.AgentViewer.state() };
            else if (command.op === 'select') value = root.AgentViewer.selectElement(args.elementId);
            else if (command.op === 'switchTab') value = root.AgentViewer.switchTab(args.pageId, args.pagesId);
            else if (command.op === 'scroll') value = root.AgentViewer.scroll(args);
            else if (command.op === 'capture') return root.AgentViewer.capture(args.scope, args.elementId).then(function (image) { return postResult(command, image); }, function (error) { return postError(command, error); });
            else if (command.op === 'state') value = root.AgentViewer.state();
            else fail('Unknown browser command: ' + command.op);
            return postResult(command, value).catch(function (error) { return postError(command, error); });
        } catch (error) {
            return postError(command, error);
        }
    }

    /* Resolving a native document's context is asynchronous. State polling and
     * command delivery both ask for the same revision meanwhile; they must share
     * one load instead of restarting (and discarding) it on every poll. */
    var loadingRevision = -1;
    var loadingPromise = null;
    var loadingToken = 0;

    function loadRevision(input) {
        if (input.revision < lastRevision) return Promise.resolve();
        if (input.revision === loadingRevision && loadingPromise) return loadingPromise;
        loadingRevision = input.revision;
        var token = ++loadingToken;
        var available = Array.isArray(input.annotations);
        loadingPromise = Promise.resolve(root.AgentViewer.load(input)).then(function () {
            if (token !== loadingToken) return;
            sessionAnnotations.snapshot(available ? input.annotations : [], input.revision, available && /^(form|template|mxl)$/.test(current.format));
            lastRevision = input.revision;
        }, function (error) {
            if (token === loadingToken) {
                loadingRevision = -1;
                loadingPromise = null;
            }
            throw error;
        });
        return loadingPromise;
    }

    function ensureRevision(revision) {
        if (typeof revision !== 'number' || lastRevision >= revision) return Promise.resolve();
        return fetch('state.json', { cache: 'no-store' })
            .then(function (response) {
                if (!response.ok) throw new Error('The requested preview revision is unavailable.');
                return response.json();
            })
            .then(function (input) {
                if (!input || input.revision < revision) throw new Error('The requested preview revision is not loaded yet.');
                /* A native document resolves its context asynchronously; the
                 * command must run against the fully loaded revision. */
                return loadRevision(input);
            });
    }

    function pollCommand() {
        if (commandBusy) return;
        commandBusy = true;
        fetch('command', { cache: 'no-store' })
            .then(function (response) {
                if (response.status === 404) {
                    window.clearInterval(commandTimer);
                    return null;
                }
                return response.status === 204 ? null : response.json();
            })
            .then(function (command) {
                if (command && TRANSFORMS[command.op]) return executeCommand(command);
                return command ? ensureRevision(command.revision)
                    .then(function () { return executeCommand(command); })
                    .catch(function (error) { return postError(command, error); }) : null;
            })
            .catch(function () {})
            .finally(function () { commandBusy = false; });
    }

    function refreshState() {
        fetch('state-meta.json', { cache: 'no-store' })
            .then(function (response) { return response.ok ? response.json() : null; })
            .then(function (meta) {
                if (editorButton) editorButton.classList.toggle('available', !!(meta && meta.editor));
                if (!meta || !meta.available) return null;
                if (meta.revision === lastRevision) {
                    /* Same file, changed list: the agent resolved a note. */
                    if (meta.annotationVersion === undefined || meta.annotationVersion === lastAnnotationVersion
                        || sessionAnnotations.busy()) return null;
                    var version = meta.annotationVersion;
                    return fetch('annotations', { cache: 'no-store' })
                        .then(function (response) { return response.ok ? response.json() : null; })
                        .then(function (data) {
                            if (!data || data.revision !== lastRevision || sessionAnnotations.busy()) return;
                            lastAnnotationVersion = version;
                            sessionAnnotations.snapshot(data.annotations || [], data.revision, /^(form|template|mxl)$/.test(current.format));
                        });
                }
                /* A newer revision is a different file on disk: the user saved
                 * in BSLEdit, or an agent tool wrote it. */
                resetContextCache();
                return fetch('state.json', { cache: 'no-store' })
                    .then(function (response) { return response.ok ? response.json() : null; })
                    .then(function (input) {
                        if (input) return loadRevision(input);
                    });
            })
            .catch(function () {});
    }

    /* Re-read the open file (and drop cached metadata) so an agent's edit on
     * disk shows without reopening the preview. Only the native server serves
     * `reload`; elsewhere the button reports that and stays usable. */
    /* Hand the open file to BSLEdit. Nothing comes back through this page:
     * the user edits and saves there, the server notices the file changed and
     * the preview above reloads itself. Unsaved edits change nothing here. */
    var editorButton = document.getElementById('open-editor');
    if (editorButton) editorButton.addEventListener('click', function () {
        editorButton.disabled = true;
        fetch('open-editor', { method: 'POST', cache: 'no-store' })
            .then(function (response) {
                if (!response.ok) return response.text().then(function (text) { throw new Error(text || ('HTTP ' + response.status)); });
                return null;
            })
            .catch(function (error) { window.alert('Не удалось открыть BSLEdit: ' + (error && error.message || error)); })
            .finally(function () { editorButton.disabled = false; });
    });

    var reloadButton = document.getElementById('reload-preview');
    if (reloadButton) reloadButton.addEventListener('click', function () {
        reloadButton.disabled = true;
        fetch('reload', { method: 'POST', cache: 'no-store' })
            .then(function (response) {
                if (!response.ok) return response.text().then(function (text) { throw new Error(text || ('HTTP ' + response.status)); });
                resetContextCache();
                lastRevision = -1;
                loadingRevision = -1;
                loadingPromise = null;
                ++loadingToken;
                refreshState();
            })
            .catch(function (error) { window.alert('Не удалось обновить: ' + (error && error.message || error)); })
            .finally(function () { reloadButton.disabled = false; });
    });

    refreshState();
    window.setInterval(refreshState, 300);
    commandTimer = window.setInterval(pollCommand, 120);
}
})(window);
