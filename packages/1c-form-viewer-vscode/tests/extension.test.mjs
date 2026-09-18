import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scripts, styles } from '1c-preview-core/manifest.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgDir = path.resolve(here, '..');
const read = (...parts) => readFile(path.join(pkgDir, ...parts), 'utf8');

test('the manifest exposes the preview command and the supported file menus', async () => {
  const manifest = JSON.parse(await read('package.json'));
  assert.equal(manifest.main, 'extension.js');
  assert.equal(manifest.contributes.commands[0].command, '1cFormViewer.openPreview');
  assert.equal(manifest.contributes.menus.commandPalette[0].when, 'true');
  assert.equal(manifest.contributes.menus['editor/title'][0].command, '1cFormViewer.openPreview');
  assert.match(manifest.contributes.menus['explorer/context'][0].when, /resourceExtname == \.xml/);
  assert.match(manifest.contributes.menus['explorer/context'][0].when, /resourceExtname == \.mxl/);
});

test('the extension contributes and registers its bundled MCP server', async () => {
  const manifest = JSON.parse(await read('package.json'));
  assert.equal(manifest.engines.vscode, '^1.101.0');
  assert.deepEqual(manifest.os, ['win32']);
  assert.deepEqual(manifest.contributes.mcpServerDefinitionProviders, [{
    id: '1cFormViewer.mcp',
    label: '1C Form Viewer',
  }]);
  assert.equal(manifest.contributes.configuration.properties['1cFormViewer.mcp.enabled'].default, true);
  assert.equal(manifest.contributes.configuration.properties['1cFormViewer.mcp.allowAnyPath'].default, false);
  assert.equal(manifest.contributes.configuration.properties['1cFormViewer.mcp.templateEditTools'].default, true, 'template editing tools are on by default');
  assert.ok(manifest.activationEvents.includes('onStartupFinished'));
  assert.ok(manifest.activationEvents.includes('onUri'));
  assert.ok(manifest.activationEvents.includes('onCommand:1cFormViewer.openPreview'));

  const extension = await read('extension.js');
  assert.match(extension, /registerMcpServerDefinitionProvider\(MCP_PROVIDER_ID/);
  assert.match(extension, /new vscode\.McpStdioServerDefinition\(/);
  assert.match(extension, /args\.push\('--root', root\)/);
  assert.match(extension, /args\.push\('--allow-any-path'\)/);
  assert.match(extension, /if \(!configuration\.get\('templateEditTools', true\)\) args\.push\('--no-template-edit-tools'\)/);
  assert.match(extension, /--open-vscode-browser/);
  assert.match(extension, /--vscode-uri-scheme', vscode\.env\.uriScheme/);
});

test('the bundled native MCP completes the initialize and tools/list handshake', {
  skip: process.platform !== 'win32',
}, async () => {
  const executable = path.join(pkgDir, 'mcp', '1c-form-viewer.exe');
  const repositoryDir = path.resolve(pkgDir, '..', '..');
  const outsideRoot = path.join(repositoryDir, 'testdata', 'Template.xml');
  await access(executable);
  const child = spawn(executable, ['--stdio', '--root', pkgDir], {
    cwd: repositoryDir,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const responses = [];
  let buffered = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buffered += chunk;
    const lines = buffered.split(/\r?\n/);
    buffered = lines.pop() || '';
    for (const line of lines) if (line.trim()) responses.push(JSON.parse(line));
  });
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })}\n`);
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })}\n`);
  child.stdin.write(`${JSON.stringify({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: { name: 'open_preview', arguments: { path: outsideRoot } },
  })}\n`);
  child.stdin.end();
  await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`MCP exited with ${code}`)));
  });
  assert.equal(responses[0].result.serverInfo.name, '1c-form-viewer-native');
  assert.match(responses[0].result.instructions, /instead of opening XML source or launching 1C/);
  assert.match(responses[0].result.instructions, /визуального просмотра макетов форм 1С/);
  assert.ok(responses[1].result.tools.some((tool) => tool.name === 'open_preview'));
  assert.match(
    responses[1].result.tools.find((tool) => tool.name === 'capture_preview').description,
    /1C preview/,
  );
  assert.equal(responses[2].result.isError, true);
  assert.match(responses[2].result.content[0].text, /outside the allowed roots/);
  assert.match(responses[2].result.content[0].text, /additionalRoots/);
});

/* vsce runs vscode:prepublish, not prepack. Without it a package can be cut
 * from whatever happens to be sitting in media/, which is how an extension
 * ships with renderers older than the core it was built from. */
test('packaging rebuilds the shared assets first', async () => {
  const manifest = JSON.parse(await read('package.json'));
  assert.equal(manifest.scripts['vscode:prepublish'], 'npm run build');
  assert.match(manifest.scripts.build, /sync/);
  assert.match(manifest.scripts.build, /build-native\.ps1/);
});

test('the Marketplace README includes the preview-button screenshot', async () => {
  const readme = await read('README.md');
  assert.match(readme, /images\/open-preview-button\.png/);
  await access(path.join(pkgDir, 'images', 'open-preview-button.png'));
  const ignore = await read('.vscodeignore');
  assert.match(ignore, /!images\/\*\*/);
});

test('the Marketplace README has current MCP setup examples for major agents', async () => {
  const readme = await read('README.md');
  for (const heading of [
    'VS Code Agent mode / GitHub Copilot',
    'Codex IDE extension для VS Code',
    'Cursor Agent',
    'Claude Code extension для VS Code',
  ]) assert.match(readme, new RegExp(heading));
  assert.match(readme, /Почему VSIX недостаточно для каждого агента/);
  assert.match(readme, /MCP servers.*Add server/s);
  assert.match(readme, /Restart extension/);
  assert.match(readme, /"servers": \{/);
  assert.match(readme, /\[mcp_servers\.one_c_form_viewer\]/);
  assert.match(readme, /"mcpServers": \{/);
  assert.match(readme, /claude mcp add --transport stdio --scope local/);
  assert.match(readme, /C:\\\\Tools\\\\1c-form-viewer-native\\\\1c-form-viewer\.exe/);
  assert.doesNotMatch(readme, /1c-form-viewer@(?:latest|\d)/);
  assert.doesNotMatch(readme, /Node\.js-вариант/);
});

test('the bundled native page loads exactly the shared assets, in the core load order', async () => {
  const assets = JSON.parse(await read('media', 'assets.json'));
  assert.deepEqual(assets.scripts, scripts);
  assert.deepEqual(assets.styles, styles);
  const html = await read('mcp', 'app', 'web', 'index.html');
  let position = -1;
  for (const name of [...styles, ...scripts]) {
    const next = html.indexOf(name);
    assert.ok(next > position, `${name} must be present in generated load order`);
    position = next;
  }
});

test('agent and manual commands open the native URL in VS Code Simple Browser', async () => {
  const extension = await read('extension.js');
  assert.match(extension, /registerUriHandler\(/);
  assert.match(extension, /executeCommand\('simpleBrowser\.show', url\)/);
  assert.match(extension, /--open-vscode-browser/);
  assert.match(extension, /--vscode-uri-scheme', vscode\.env\.uriScheme/);
  assert.match(extension, /new NativeRpcClient\(/);
  assert.match(extension, /client\.callTool\('open_preview'/);
  assert.match(extension, /'--no-open-browser'/);
  assert.doesNotMatch(extension, /createWebviewPanel\(/);
});

test('the URI handler rejects non-loopback and credentialed preview URLs', async () => {
  const extension = await read('extension.js');
  assert.match(extension, /url\.protocol !== 'http:'/);
  assert.match(extension, /host !== '127\.0\.0\.1'/);
  assert.match(extension, /host !== 'localhost'/);
  assert.match(extension, /url\.username \|\| url\.password/);
});

test('opening a form descriptor resolves to the layout the renderers want', async () => {
  const { formLayoutFor } = await import('1c-preview-core/node/document.cjs');
  const layout = formLayoutFor(path.join('C:', 'cfg', 'Catalogs', 'Товары', 'Forms', 'ФормаСписка.xml'));
  assert.equal(layout, path.join('C:', 'cfg', 'Catalogs', 'Товары', 'Forms', 'ФормаСписка', 'Ext', 'Form.xml'));
  assert.equal(formLayoutFor(path.join('C:', 'cfg', 'Catalogs', 'Товары.xml')), '');

  const extension = await read('extension.js');
  assert.match(extension, /require\('\.\/core\/document\.cjs'\)/);
  assert.match(extension, /core\.isSupportedExtension\(/);
  assert.match(extension, /resolveDocumentUri/);
  assert.match(extension, /core\.formLayoutFor\(/);
});

test('the browser outline can be collapsed and selects through the shared highlight API', async () => {
  const html = await read('mcp', 'app', 'web', 'index.html');
  const viewer = await read('mcp', 'app', 'web', 'agent-viewer.js');
  const css = await read('mcp', 'app', 'web', 'agent-viewer.css');
  assert.match(html, /id="outline-toggle"/);
  assert.match(html, /id="outline-pane"/);
  assert.match(viewer, /classList\.toggle\('outline-collapsed'/);
  assert.match(viewer, /sessionStorage\.setItem\('1cFormViewer\.outlineCollapsed'/);
  assert.match(viewer, /selectElement\(itemId\(item\)\)/);
  assert.match(viewer, /view\.highlight\(host, String\(id\)\)/);
  assert.match(css, /body\.browser-ui\.outline-collapsed #outline-pane/);
});
