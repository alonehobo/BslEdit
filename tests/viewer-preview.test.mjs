/* Tests for the preview-provider registry in web/viewer.js: which module claims
 * a file, which module draws it, and the per-provider chrome flags. Everything
 * else in viewer.js needs Monaco and a real DOM; this part does not. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWebModules, parseXmlDom } from './helpers/dom.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* viewer.js ends by appending Monaco's loader script; in this stub its onload
 * never fires, so the module's functions are defined and nothing else runs. */
/* The viewer's per-user settings (the chosen theme) live in localStorage. */
const storage = new Map();

function stubDom() {
  const noop = () => {};
  const element = () => ({
    style: {}, classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    setAttribute: noop, getAttribute: () => null, addEventListener: noop,
    appendChild: noop, querySelector: () => null, querySelectorAll: () => [],
    textContent: '', innerHTML: '', children: []
  });
  return {
    location: { hostname: 'bslview.invalid' },
    localStorage: {
      getItem: (key) => (storage.has(key) ? storage.get(key) : null),
      setItem: (key, value) => storage.set(key, String(value))
    },
    addEventListener: noop,
    document: {
      head: { appendChild: noop },
      body: element(),
      createElement: element,
      getElementById: element,
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener: noop
    },
    DOMParser: function DOMParser() {
      this.parseFromString = (xml) => parseXmlDom(xml);
    }
  };
}

function loadViewer() {
  const sandbox = loadWebModules(
    root,
    ['xml-util.js', 'bsl-format.js', 'form-preview.js', 'template-preview.js', 'mxl-preview.js', 'sarif-rules-ru.js', 'sarif-preview.js', 'providers.js', 'viewer.js'],
    stubDom()
  );
  return sandbox.window.ViewerInternals;
}

const V = loadViewer();

function read(name) {
  return fs.readFileSync(path.join(root, 'testdata', name), 'utf8');
}

/* detect() for the form provider consults state.language, so set it the way
 * applyLoad would before asking. */
function detectAs(language, content) {
  V.state.language = language;
  return V.detectProvider(content);
}

function select(id) {
  V.state.previewId = id;
}

test('form preview toggle uses a window icon instead of the edit-mode eye', () => {
  const html = fs.readFileSync(path.join(root, 'web', 'viewer.html'), 'utf8');
  const js = fs.readFileSync(path.join(root, 'web', 'viewer.js'), 'utf8');
  assert.match(html, /<symbol id="i-window"/);
  assert.match(html, /id="btn-preview"[^>]*>[\s\S]*?<use href="#i-window">/);
  assert.match(js, /setIcon\('btn-preview', state\.previewMode \? 'code' : 'window'\)/);
});
/* applyLoad needs Monaco and a real DOM, so what is worth pinning here is that
 * opening a file clears the renderers' per-document view state. Folded groups
 * and the selected tab are keyed by element id and ids repeat across unrelated
 * forms, but the reset cannot live in parse() — that runs on every keystroke
 * while a form is edited. */
test('opening a file clears the renderers per-document view state', () => {
  const js = fs.readFileSync(path.join(root, 'web', 'viewer.js'), 'utf8');
  const start = js.indexOf('function applyLoad(');
  assert.ok(start > 0, 'viewer.js still loads documents through applyLoad');
  assert.match(js.slice(start, start + 4000), /PreviewProviders\.resetViewState\(\)/);
  assert.equal(typeof V.PreviewProviders.resetViewState, 'function');
});

// --- registry shape --------------------------------------------------------

test('every provider names a parser and a viewer module and its chrome', () => {
  assert.ok(V.providers.length >= 3);
  for (const p of V.providers) {
    assert.ok(p.id, 'provider has an id');
    assert.ok(p.parser && p.viewer, `${p.id} names both modules`);
    assert.ok(p.label, `${p.id} has a display label`);
    assert.ok(p.rootCls && p.emptyCls && p.emptyMsg, `${p.id} has an empty-state`);
    assert.ok(p.outlineTitle && p.sourceTitle, `${p.id} has button titles`);
  }
});

/* Detection and parsing moved to the shared registry so all three hosts claim
 * files identically; the entries themselves are now plain data. */
test('the shared registry, not each entry, owns detect and parse', () => {
  const core = V.PreviewProviders;
  assert.equal(typeof core.detect, 'function');
  assert.equal(typeof core.parse, 'function');
  assert.equal(typeof core.ready, 'function');
  assert.equal(typeof core.view, 'function');
  assert.ok(core.unsupportedMessage);
  for (const p of V.providers) {
    assert.equal(p.detect, undefined, `${p.id} carries no detect of its own`);
    assert.equal(p.parse, undefined, `${p.id} carries no parse of its own`);
  }
});

test('provider ids are unique and lookup finds them', () => {
  const ids = V.providers.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.equal(V.providerById(id).id, id);
  assert.equal(V.providerById('nope'), null);
});

/* This is the coupling that used to be implicit: an .mxl file is decoded by
 * MxlPreview but drawn by TemplatePreview, because both build the same model. */
test('mxl parses through MxlPreview and renders through TemplatePreview', () => {
  const mxl = V.providerById('mxl');
  assert.equal(mxl.parser, 'MxlPreview');
  assert.equal(mxl.viewer, 'TemplatePreview');
});

// --- detection -------------------------------------------------------------

test('a managed form is claimed by the form provider', () => {
  assert.equal(detectAs('xml', read('Форма.xml')).id, 'form');
});

test('a spreadsheet template is claimed by the template provider', () => {
  assert.equal(detectAs('xml', read('Template.xml')).id, 'template');
});

test('a binary MXL is claimed by the mxl provider', () => {
  const mxl = fs.readFileSync(path.join(root, 'testdata', 'mxl-capabilities.mxl')).toString('utf8');
  assert.equal(detectAs('plaintext', mxl).id, 'mxl');
});

test('managed forms expose configurator-style Form and Module tabs', () => {
  const html = fs.readFileSync(path.join(root, 'web', 'viewer.html'), 'utf8');
  const js = fs.readFileSync(path.join(root, 'web', 'viewer.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'web', 'form-workbench.css'), 'utf8');
  assert.match(html, /id="form-workbench-tabs"[\s\S]*?>Форма<[\s\S]*?>Модуль</);
  assert.match(js, /state\.previewMode && isFormView\(\) && state\.formModulePath/);
  assert.match(js, /monaco\.editor\.createModel\(state\.formModule, 'bsl'\)/);
  assert.match(js, /editor\.setModel\(formModuleModel\)/);
  assert.match(js, /editor\.updateOptions\(editingOptions\(true\)\)/,
    'the Module tab follows the edit mode instead of staying read-only');
  assert.match(js, /if \(formModuleOpen\(\)\) parseOutline\(formModuleModel\)/,
    'the Module tab must build its outline from the BSL module model');
  assert.match(css, /#form-workbench-tabs:not\(\[hidden\]\)\s*\{\s*display:flex/);
  assert.match(css, /#form-workbench-tabs button\s*\{[^}]*border-top:0/,
    'bottom tabs must open toward the content above');
  assert.match(css, /#form-workbench-tabs button\.active\s*\{[^}]*top:-1px/,
    'the active bottom tab must overlap the strip top border');
  const host = fs.readFileSync(path.join(root, 'webview2host.cpp'), 'utf8');
  assert.match(host, /FindFormModuleFile\(mFilePath\.c_str\(\)\)/);
  assert.match(host, /formModulePath/);
  for (const untouched of [
    path.join(root, 'packages', '1c-form-viewer', 'ui', 'index.template.html'),
    path.join(root, 'packages', '1c-form-viewer-vscode', 'ui', 'webview.js'),
    path.join(root, 'packages', '1c-form-viewer', 'native', 'mcp-server.cpp'),
  ]) {
    assert.doesNotMatch(fs.readFileSync(untouched, 'utf8'), /form-workbench|formModule/,
      `${untouched} must keep the VS Code/MCP workflow unchanged`);
  }
});

test('managed form caption follows the canonical snapshot name', () => {
  const viewer = fs.readFileSync(path.join(root, 'web', 'viewer.js'), 'utf8');
  const renderer = fs.readFileSync(path.join(root, 'packages', '1c-preview-core', 'browser', 'form-preview.js'), 'utf8');
  const host = fs.readFileSync(path.join(root, 'webview2host.cpp'), 'utf8');
  const common = fs.readFileSync(path.join(root, 'bslcommon.cpp'), 'utf8');
  const editor = fs.readFileSync(path.join(root, 'bsledit.cpp'), 'utf8');
  assert.match(viewer, /state\.formTitle = req\.formTitle \|\| ''/);
  assert.match(viewer, /windowTitle: state\.formTitle/);
  assert.match(renderer, /var formTitle = options\.windowTitle \|\| rawTitle\(model\)/);
  assert.match(renderer, /options\.windowTitle \? false :/);
  assert.match(host, /FormSnapshotBaseName\(mFilePath\.c_str\(\)\)/);
  assert.match(common, /std::wstring FormSnapshotBaseName\(const wchar_t\* formPath\)/);
  assert.match(editor, /FormSnapshotBaseName\(filePath\.c_str\(\)\)/);
});

test('managed form outline separates attributes and renders a compact inspector', () => {
  const html = fs.readFileSync(path.join(root, 'web', 'viewer.html'), 'utf8');
  const js = fs.readFileSync(path.join(root, 'web', 'viewer.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'packages', '1c-preview-core', 'browser', 'viewer.css'), 'utf8');
  assert.match(html, /id="outline-kinds"[\s\S]*?>Элементы<[\s\S]*?>Реквизиты</);
  assert.match(html, /id="property-inspector"[^>]*hidden/);
  assert.match(html, /id="property-resize-handle"[^>]*aria-orientation="horizontal"/);
  assert.match(js, /attributeOutline\(parsed\.model, src\)/);
  assert.match(js, /attributeMode && it\.itemKind === 'attribute'/);
  assert.match(js, /FormPreview\.attributeIcon\(it\.typeName\)/);
  assert.match(js, /iconAsset = aic\.asset/);
  assert.match(css, /\.icon-form-number\s*\{/);
  assert.match(js, /data-kind="/);
  assert.match(js, /Заданные свойства|info\.heading/);
  assert.match(css, /#property-inspector\s*\{[^}]*max-height:90%/);
  assert.match(css, /#property-resize-handle\s*\{[^}]*cursor:row-resize/);
  assert.match(js, /1cFormViewer\.propertyInspectorHeight/);
  assert.match(js, /property-resize-handle/);
  assert.match(js, /detail\.link === 'form-handler'/);
  assert.match(js, /findFormHandlerLine\(detail\.handler\)/);
  assert.match(js, /switchFormWorkbenchView\('module'\)/);
  assert.doesNotMatch(js, /class="form-type"/);
  assert.match(css, /\.attribute-property\s*\{[^}]*grid-template-columns/);
  assert.match(css, /\.form-handler-link\s*\{/);
  assert.doesNotMatch(css, /\.form-type\s*\{/);
});

test('a SARIF report is claimed only as JSON', () => {
  assert.equal(detectAs('json', read('sample.sarif')).id, 'sarif');
  assert.equal(detectAs('plaintext', read('sample.sarif')), null);
});

/* Order matters: a form is also well-formed XML, and only the form provider
 * gates on the language being xml. */
test('form detection wins over template for the same content', () => {
  const form = read('Форма.xml');
  assert.equal(V.providers.findIndex((p) => p.id === 'form'), 0);
  assert.equal(detectAs('xml', form).id, 'form');
});

test('a form is not claimed when the language is not xml', () => {
  assert.equal(detectAs('bsl', read('Форма.xml')), null);
});

test('ordinary source and markup are claimed by nobody', () => {
  assert.equal(detectAs('bsl', 'Процедура П()\nКонецПроцедуры'), null);
  assert.equal(detectAs('markdown', '# Заголовок\n\nтекст'), null);
  assert.equal(detectAs('xml', '<?xml version="1.0"?><Catalog><Name>Товары</Name></Catalog>'), null);
  assert.equal(detectAs('plaintext', ''), null);
});

// --- state derived from the active provider --------------------------------

test('no provider means no document preview', () => {
  select('');
  assert.equal(V.currentProvider(), null);
  assert.equal(V.isDocPreview(), false);
  assert.equal(V.isFormView(), false);
  assert.equal(V.docTree(), false);
  assert.equal(V.previewView(), null);
});

test('an unknown provider id degrades to no preview', () => {
  select('does-not-exist');
  assert.equal(V.currentProvider(), null);
  assert.equal(V.isDocPreview(), false);
});

test('the form provider drives the form-only chrome', () => {
  select('form');
  assert.equal(V.isDocPreview(), true);
  assert.equal(V.isFormView(), true);
  assert.equal(V.docTree(), true, 'form outline is a collapsible tree');
  const view = V.previewView();
  assert.ok(view.render && view.outline && view.itemKey, 'form view module is complete');
  assert.ok(view.outlineExpandTo && view.outlineCollapseAll, 'form view can fold its tree');
});

test('spreadsheet providers are document views, not form views', () => {
  for (const id of ['template', 'mxl']) {
    select(id);
    assert.equal(V.isDocPreview(), true, `${id} is a document preview`);
    assert.equal(V.isFormView(), false, `${id} is not a form`);
    assert.equal(V.docTree(), false, `${id} outline is flat`);
    assert.ok(V.previewView().render, `${id} view module can render`);
  }
});

test('form and spreadsheet visual previews are never saveable', () => {
  V.state.isEditing = true;
  V.state.previewMode = true;

  for (const id of ['form', 'template', 'mxl']) {
    select(id);
    assert.equal(V.sourceEditingActive(), false, `${id} preview is read-only`);
  }

  V.state.previewMode = false;
  assert.equal(V.sourceEditingActive(), true, 'the XML/source remains editable');

  select('');
  V.state.previewMode = true;
  assert.equal(V.sourceEditingActive(), true, 'markdown/html split preview keeps its existing edit behavior');

  V.state.isEditing = false;
  assert.equal(V.sourceEditingActive(), false, 'ordinary view mode is read-only');
  V.state.previewMode = false;
});

test('the Module tab of a form is saveable in edit mode', () => {
  select('form');
  V.state.previewMode = true;
  V.state.formWorkbenchView = 'module';
  V.state.isEditing = true;
  assert.equal(V.sourceEditingActive(), true, 'module edits save from the Module tab');
  V.state.isEditing = false;
  assert.equal(V.sourceEditingActive(), false, 'view mode keeps the module read-only');
  V.state.formWorkbenchView = 'form';
  V.state.previewMode = false;

  const js = fs.readFileSync(path.join(root, 'web', 'viewer.js'), 'utf8');
  assert.match(js, /if \(target === 'module'\) msg\.target = 'module'/,
    'module saves are tagged so the host writes Module.bsl');
  const host = fs.readFileSync(path.join(root, 'webview2host.cpp'), 'utf8');
  assert.match(host, /JsonFieldEquals\(msg, L"target", L"module"\)/);
  assert.match(host, /toModule \? mFormModulePath : mFilePath/,
    'the module path comes from the host, never from the page');
  const bsledit = fs.readFileSync(path.join(root, 'bsledit.cpp'), 'utf8');
  assert.match(bsledit, /FindFormLayoutForModule\(filePath\.c_str\(\)\)/,
    'BSLEdit opens Ext/Form/Module.bsl as its whole form');
  const lister = fs.readFileSync(path.join(root, 'main.cpp'), 'utf8');
  assert.match(lister, /if \(webView\) \{\s*layout = FindFormLayoutForModule/,
    'the Lister opens the whole form only when WebView2 can show it');
  assert.equal((lister.match(/req\.openFormModule = openFormModule/g) || []).length, 2,
    'both the first open and the next-file path start on the module tab');
});

test('SARIF mode is always read-only and keeps Monaco beside the tree', () => {
  select('sarif');
  V.state.sarifMode = true;
  V.state.isEditing = true;
  V.state.previewMode = true;
  assert.equal(V.sourceEditingActive(), false);
  assert.equal(V.languageForPath('X:\\Module.bsl'), 'bsl');
  assert.equal(V.languageForPath('report.sarif'), 'json');
  assert.equal(V.minimapButtonVisible(), true, 'SARIF keeps the minimap toggle because Monaco stays visible');
  const source = fs.readFileSync(path.join(root, 'web', 'viewer.js'), 'utf8');
  assert.match(source, /provider && provider\.keepsEditor[\s\S]*?editorEl\.style\.display = ''/);
  assert.match(source, /function onSarifCursorPosition\(\)[\s\S]*?SarifPreview\.reveal\(formPreviewEl\(\), diag\.id\)/,
    'moving the editor cursor must expand the selected diagnostic in the tree');
  V.state.sarifMode = false;
  V.state.isEditing = false;
  V.state.previewMode = false;
});

test('minimap button is hidden only when a document preview hides Monaco', () => {
  V.state.previewMode = true;
  select('form');
  assert.equal(V.minimapButtonVisible(), false);
  select('template');
  assert.equal(V.minimapButtonVisible(), false);
  select('');
  assert.equal(V.minimapButtonVisible(), true, 'plain and split editor views keep the toggle');
  V.state.previewMode = false;
});

test('SARIF source roots are independent of the report location', () => {
  const source = 'C:\\BuildAgent\\checkout\\Object\\Ext\\ObjectModule.bsl';
  assert.equal(
    V.sarifRemapPath(source, 'Z:\\Sources', 'C:\\BuildAgent\\checkout'),
    'Z:\\Sources\\Object\\Ext\\ObjectModule.bsl',
    'manual root uses the common source root recorded by SARIF',
  );
  assert.equal(
    V.sarifRemapPath(source, 'Z:\\ExactModuleDir', 'C:\\BuildAgent\\checkout\\Object\\Ext'),
    'Z:\\ExactModuleDir\\ObjectModule.bsl',
    'a one-file report treats the selected folder as that file directory',
  );
  assert.equal(V.sarifRemapPath(source, '', ''), source, 'an existing absolute URI stays intact on any drive');
  const css = fs.readFileSync(path.join(root, 'packages', '1c-preview-core', 'browser', 'viewer.css'), 'utf8');
  assert.match(css, /#form-preview\.sf-root\s*\{[^}]*overflow:auto;[^}]*font-size:15px/,
    'the SARIF panel must override the generic hidden overflow and use the enlarged font');
  assert.match(css, /\.sf-message\s*\{[^}]*font-size:15px;[^}]*line-height:1\.45/,
    'diagnostic text must be large enough and have a readable line height');
  assert.match(css, /html\.theme-dark #form-preview\.sf-root\s*\{[^}]*background:#1e1e1e/,
    'the SARIF tree must override the generic forced-light preview background');
  for (const level of ['error', 'warning', 'note', 'none']) {
    assert.match(css, new RegExp(`\\.sf-${level} \\.sf-level\\s*\\{[^}]*background:`),
      `${level} severity label must keep its own visible color`);
    assert.match(css, new RegExp(`html\\.theme-dark \\.sf-${level} \\.sf-level\\s*\\{[^}]*background:`),
      `${level} severity label must keep a visible color in the dark theme`);
  }
});

test('save acknowledgement keeps edits made after the sent snapshot dirty', () => {
  assert.deepEqual(
    { ...V.savedSnapshotState('new unsaved keystrokes', 'snapshot sent to disk') },
    { baseline: 'snapshot sent to disk', dirty: true },
  );
  assert.deepEqual(
    { ...V.savedSnapshotState('snapshot sent to disk', 'snapshot sent to disk') },
    { baseline: 'snapshot sent to disk', dirty: false },
  );
  const source = fs.readFileSync(path.join(root, 'web', 'viewer.js'), 'utf8');
  assert.match(source, /function onSavePromptYes\(\)[\s\S]*?saveFile\(true\)/,
    'closing from a visual preview must save the underlying source model');
});

test('external save conflict stays dirty and is shown distinctly', () => {
  const source = fs.readFileSync(path.join(root, 'web', 'viewer.js'), 'utf8');
  assert.match(source, /case 'saved':\s+onSaveResult\(d\.ok, d\.saveId, d\.conflict, d\.target\)/,
    'host conflict flag reaches the save-result handler');
  assert.match(source, /conflict \? '&#9888; ' \+ \(toModule \? 'Модуль изменён извне' : 'Файл изменён извне'\)/,
    'an external edit is not presented as a generic successful save');
  assert.match(source, /function onSaveResult\(ok, saveId, conflict, target\)[\s\S]*?if \(ok\)[\s\S]*?state\.dirty = saved\.dirty/,
    'only a successful save advances the editor baseline');
});

test('WLX close and next-file paths both ask the viewer before replacing the model', () => {
  const source = fs.readFileSync(path.join(root, 'main.cpp'), 'utf8');
  const closeStart = source.indexOf('void __stdcall ListCloseWindow');
  const nextStart = source.indexOf('static int DoListLoadNext');
  assert.match(source.slice(closeStart, closeStart + 700), /RequestClose\(\)/);
  assert.match(source.slice(nextStart, nextStart + 900), /RequestClose\(\)/);
  assert.match(source, /case WM_BSLVIEW_CLOSE_ACK:[\s\S]*?pendingLoad[\s\S]*?LoadNextNow/);
});

/* A form mockup stands in for the real 1C window, so it forces light chrome;
 * a template is an ordinary document and follows the user's theme. */
test('only the form provider forces light chrome while previewing', () => {
  V.state.isDark = true;

  select('form');
  V.state.previewMode = true;
  assert.equal(V.formPreviewOpen(), true);
  assert.equal(V.uiIsDark(), false);

  V.state.previewMode = false;
  assert.equal(V.formPreviewOpen(), false, 'closed preview does not force light');
  assert.equal(V.uiIsDark(), true);

  V.state.previewPending = true;
  assert.equal(V.uiIsDark(), false, 'a form still loading under the overlay is already light');
  V.state.previewPending = false;

  const form = read('Форма.xml');
  const code = { theme: 'dark', language: 'bsl', content: 'Процедура А() КонецПроцедуры' };
  assert.equal(V.loadThemeClass(code), 'theme-light', 'light until the user picks dark, whatever the host says');
  storage.set('bslview.darkTheme', '1');
  assert.equal(V.loadThemeClass({ theme: 'light', language: 'xml', content: form }), 'theme-light',
    'a form paints light chrome from the first frame even when dark was chosen');
  assert.equal(V.loadThemeClass({ ...code, theme: 'light' }), 'theme-dark', 'the chosen theme beats the host');
  storage.delete('bslview.darkTheme');

  select('template');
  V.state.previewMode = true;
  assert.equal(V.formPreviewOpen(), false);
  assert.equal(V.uiIsDark(), true, 'a template keeps the dark theme');

  V.state.isDark = false;
  V.state.previewMode = false;
});

test('canPreviewLang covers markdown, html and any claimed document', () => {
  select('');
  V.state.language = 'bsl';
  assert.equal(V.canPreviewLang(), false);
  V.state.language = 'markdown';
  assert.equal(V.canPreviewLang(), true);
  V.state.language = 'html';
  assert.equal(V.canPreviewLang(), true);

  V.state.language = 'plaintext';
  select('mxl');
  assert.equal(V.canPreviewLang(), true, 'an mxl is plaintext but still previewable');
  select('');
});
