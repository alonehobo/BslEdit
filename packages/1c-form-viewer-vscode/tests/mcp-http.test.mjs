import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgDir = path.resolve(here, '..');
const { startHttpMcpServer } = createRequire(import.meta.url)('../mcp-http.cjs');

test('the HTTP endpoint proxies an MCP session to the bundled native server', {
  skip: process.platform !== 'win32',
}, async () => {
  const executable = path.join(pkgDir, 'mcp', '1c-form-viewer.exe');
  await access(executable);
  const server = await startHttpMcpServer({ port: 0, executable, args: ['--stdio', '--allow-any-path', '--no-open-browser'] });
  const url = `http://127.0.0.1:${server.port}/mcp`;
  const post = (body, headers = {}) => fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...headers },
    body: JSON.stringify(body),
  });
  try {
    const init = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    assert.equal(init.status, 200);
    const sessionId = init.headers.get('mcp-session-id');
    assert.ok(sessionId);
    assert.equal((await init.json()).result.serverInfo.name, '1c-form-viewer-native');

    const note = await post({ jsonrpc: '2.0', method: 'notifications/initialized' }, { 'Mcp-Session-Id': sessionId });
    assert.equal(note.status, 202);

    const list = await post({ jsonrpc: '2.0', id: 'two', method: 'tools/list', params: {} }, { 'Mcp-Session-Id': sessionId });
    const tools = (await list.json()).result.tools;
    assert.ok(tools.some((tool) => tool.name === 'open_preview'));

    const stale = await post({ jsonrpc: '2.0', id: 3, method: 'tools/list' }, { 'Mcp-Session-Id': 'gone' });
    assert.equal(stale.status, 404, 'unknown sessions ask the client to initialize again');

    const foreign = await post({ jsonrpc: '2.0', id: 4, method: 'initialize' }, { Origin: 'https://evil.example' });
    assert.equal(foreign.status, 403, 'browser pages from other origins are rejected');

    const closed = await fetch(url, { method: 'DELETE', headers: { 'Mcp-Session-Id': sessionId } });
    assert.equal(closed.status, 200);
  } finally {
    await server.close();
  }
});

test('every open_preview is handed to the host browser', {
  skip: process.platform !== 'win32',
}, async () => {
  const shown = [];
  const server = await startHttpMcpServer({
    port: 0,
    executable: path.join(pkgDir, 'mcp', '1c-form-viewer.exe'),
    args: ['--stdio', '--allow-any-path'],
    onShowPreview: async (url) => { shown.push(url); },
  });
  const waitShown = async () => {
    for (let attempt = 0; attempt < 100 && shown.length === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  };
  const url = `http://127.0.0.1:${server.port}/mcp`;
  try {
    const init = await fetch(url, { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) });
    const sessionId = init.headers.get('mcp-session-id');
    const open = await fetch(url, {
      method: 'POST',
      headers: { 'Mcp-Session-Id': sessionId },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: {
        name: 'open_preview',
        arguments: { path: path.resolve(pkgDir, '..', '..', 'testdata', 'Template.xml'), audience: 'user' },
      } }),
    });
    const result = (await open.json()).result;
    assert.equal(result.isError, undefined);
    assert.equal(result.structuredContent.presentation, 'client');
    /* audience=user must not reach the agent's server: it would open an
     * external browser next to the VS Code tab. */
    assert.equal(result.structuredContent.audience, 'agent', 'the agent server rendered hidden');
    await waitShown();
    assert.equal(shown.length, 1, 'the visible copy is opened in the host browser');
    assert.notEqual(shown[0], result.structuredContent.previewUrl, 'the agent keeps its own hidden page');

    /* The agent's page answers even though nothing ever loads the shown URL. */
    const inspect = await fetch(url, {
      method: 'POST',
      headers: { 'Mcp-Session-Id': sessionId },
      body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'capture_preview', arguments: {} } }),
    });
    const inspected = (await inspect.json()).result;
    assert.ok(inspected.content?.some((part) => part.type === 'image'), 'the hidden page captured the preview');
    assert.equal(inspected.isError, undefined, inspected.content?.[0]?.text);
    assert.match(result.content[0].text, /^Визуальное представление открыто во внутреннем браузере VS Code/);
  } finally {
    await server.close();
  }
});

test('the extension serves HTTP MCP with any-path access on a stable port', async () => {
  const { readFile } = await import('node:fs/promises');
  const manifest = JSON.parse(await readFile(path.join(pkgDir, 'package.json'), 'utf8'));
  const props = manifest.contributes.configuration.properties;
  assert.equal(props['1cFormViewer.mcp.http.enabled'].default, true);
  assert.equal(props['1cFormViewer.mcp.http.port'].default, 47391);
  const extension = await readFile(path.join(pkgDir, 'extension.js'), 'utf8');
  assert.match(extension, /registerHttpMcp\(context, output\)/);
  assert.match(extension, /const args = \['--stdio', '--allow-any-path'\];/);
  assert.match(extension, /onShowPreview: showInternalPreview/);
  assert.match(await readFile(path.join(pkgDir, '.vscodeignore'), 'utf8'), /!mcp-http\.cjs/);
});
