import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repositoryDir = path.resolve(packageDir, '..', '..');

test('the MCP package exposes only the native executable', async () => {
  const manifest = JSON.parse(await fs.readFile(path.join(packageDir, 'package.json'), 'utf8')) as Record<string, unknown>;
  const scripts = manifest.scripts as Record<string, string>;

  assert.equal(manifest.private, true);
  assert.equal('bin' in manifest, false);
  assert.equal('publishConfig' in manifest, false);
  assert.equal('dependencies' in manifest, false);
  assert.equal(scripts.build, 'npm run build:native');
  assert.equal(Object.keys(scripts).some((name) => /portable|compact|prepack/i.test(name)), false);

  const removedFiles = [
    'src/cli.ts',
    'src/config.ts',
    'src/mcp-server.ts',
    'scripts/build-portable.ps1',
    'scripts/build-compact.ps1',
    'native/launcher.cpp',
    'native/install.ps1',
    'native/PORTABLE-README.md',
    'native/COMPACT-README.md',
  ];
  for (const relativePath of removedFiles) {
    await assert.rejects(fs.access(path.join(packageDir, relativePath)), undefined, `${relativePath} must stay removed`);
  }
});

test('documentation and CI do not advertise the removed Node distribution', async () => {
  const files = [
    path.join(repositoryDir, 'README.md'),
    path.join(packageDir, 'README.md'),
    path.join(repositoryDir, 'packages', '1c-form-viewer-vscode', 'README.md'),
    path.join(repositoryDir, '.github', 'workflows', 'ci.yml'),
  ];
  const forbidden = [
    /1c-form-viewer@(?:latest|\d)/i,
    /npm\s+pack\s+--workspace=1c-form-viewer/i,
    /build-(?:portable|compact)\.ps1/i,
  ];

  for (const file of files) {
    const content = await fs.readFile(file, 'utf8');
    for (const pattern of forbidden) {
      assert.doesNotMatch(content, pattern, `${path.relative(repositoryDir, file)} contains ${pattern}`);
    }
  }
});

test('native command polling waits for the document revision and HTTP parsing is non-throwing', async () => {
  const native = await fs.readFile(path.join(packageDir, 'native', 'mcp-server.cpp'), 'utf8');
  const ui = await fs.readFile(path.join(packageDir, 'ui', 'agent-viewer.js'), 'utf8');
  assert.match(native, /pending_->revision/);
  assert.match(ui, /ensureRevision\(command\.revision\)/);
  assert.match(ui, /lastRevision = input\.revision/);
  assert.doesNotMatch(native, /std::stoull\(request\.substr/);
  assert.ok(native.indexOf('try {\n            std::string request;') < native.indexOf('receiveRequest(client, request)'),
    'receiveRequest must execute inside the detached worker error boundary');
});

test('native discovery contract contains descriptor resolution and bilingual visual guidance', async () => {
  const native = await fs.readFile(path.join(packageDir, 'native', 'mcp-server.cpp'), 'utf8');
  assert.match(native, /requested\.extension\(\).*L"\.xml"/s);
  assert.doesNotMatch(native, /requested\.filename\(\).*== L"\.xml"/s);
  assert.match(native, /assertAllowed\(options, form\)/);
  assert.match(native, /"requestedPath"/);
  assert.match(native, /"resolvedPath"/);
  assert.match(native, /"previewUrl"/);
  assert.match(native, /"kind"/);
  assert.match(native, /покажи форму/);
  assert.match(native, /визуального просмотра макетов форм 1С/);
  assert.match(native, /1cFormViewer\.mcp\.additionalRoots/);
  /* Form context is resolved in the page by the shared form-context.js; the
   * native server only serves files through the session's access policy. */
  assert.match(native, /resolveContext\\"\s*:\s*true|resolveContext\\":true/);
  assert.match(native, /relative == "context-file"/);
  assert.match(native, /allowed\(options_, candidate\)/);
  assert.doesNotMatch(native, /CommonPictures.*Picture\.xml/s);
});

test('native VS Code mode routes the loopback URL through the extension URI handler', async () => {
  const native = await fs.readFile(path.join(packageDir, 'native', 'mcp-server.cpp'), 'utf8');
  assert.match(native, /--open-vscode-browser/);
  assert.match(native, /--vscode-uri-scheme/);
  assert.match(native, /alonehobo\.1c-form-viewer-vscode\/open-preview\?url=/);
  assert.match(native, /url_encode_component\(url\)/);
  assert.match(native, /openPreviewUrl\(options_, url\)/);
});

test('native default presentation is a hidden browser confined to a kill-on-close job', async () => {
  const native = await fs.readFile(path.join(packageDir, 'native', 'mcp-server.cpp'), 'utf8');
  assert.match(native, /--headless=new/);
  assert.match(native, /--user-data-dir=/);
  assert.match(native, /CREATE_NO_WINDOW/);
  assert.match(native, /JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE/);
  /* A visible window opens only behind the explicit show argument. */
  assert.match(native, /argBool\(arguments, "show"\)\) \{\s*headless_\.stop\(\);\s*openPreviewUrl\(options_, url\)/);
  assert.equal(native.match(/openPreviewUrl\(options_, url\)/g)?.length, 1);
  assert.match(native, /headless_\.start\(preview_\.url\(\) \+ "&bare=1"\)/);
});

test('internal captures frame only the form and carry the icon sprite into the SVG image', async () => {
  const ui = await fs.readFile(path.join(packageDir, 'ui', 'agent-viewer.js'), 'utf8');
  const css = await fs.readFile(path.join(packageDir, 'ui', 'agent-viewer.css'), 'utf8');
  assert.match(ui, /if \(internalMode\) return captureNode\(host, scope === 'document'\)/);
  assert.match(ui, /appendSpriteSymbols\(clone, wrapper\)/);
  assert.match(css, /body\.bare #agent-header, body\.bare #outline-pane \{ display: none; \}/);
});
