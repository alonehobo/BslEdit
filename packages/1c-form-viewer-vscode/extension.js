const vscode = require('vscode');
const path = require('node:path');
const { spawn } = require('node:child_process');

/* Supported extensions and form-descriptor resolution are shared with every
 * other host. Rendering is served by the bundled native MCP, so a manual
 * command and an agent always open exactly the same browser page. */
const core = require('./core/document.cjs');
const { startHttpMcpServer } = require('./mcp-http.cjs');

const MCP_PROVIDER_ID = '1cFormViewer.mcp';
const EXTENSION_AUTHORITY = 'alonehobo.1c-form-viewer-vscode';

function isSupported(uri) {
  return !!uri && uri.scheme === 'file' && core.isSupportedExtension(uri.fsPath);
}

async function resolveDocumentUri(uri) {
  const layout = core.formLayoutFor(uri.fsPath);
  if (!layout) return uri;
  const candidate = vscode.Uri.file(layout);
  try {
    const stat = await vscode.workspace.fs.stat(candidate);
    return stat.type === vscode.FileType.File ? candidate : uri;
  } catch {
    return uri;
  }
}

function loopbackPreviewUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'http:' || (host !== '127.0.0.1' && host !== 'localhost' && host !== '[::1]')) {
    return undefined;
  }
  if (url.username || url.password) return undefined;
  return url.toString();
}

async function showInternalPreview(value) {
  const url = loopbackPreviewUrl(value);
  if (!url) throw new Error('1C Form Viewer отклонил небезопасный preview URL.');
  await vscode.commands.executeCommand('simpleBrowser.show', url);
}

class NativeRpcClient {
  constructor(executable, args, output) {
    this.output = output;
    this.pending = new Map();
    this.nextId = 0;
    this.buffer = '';
    this.disposed = false;
    this.exited = false;
    this.process = spawn(executable, args, {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.process.stdout.setEncoding('utf8');
    this.process.stderr.setEncoding('utf8');
    this.process.stdout.on('data', (chunk) => this.accept(chunk));
    this.process.stderr.on('data', (chunk) => output.append(String(chunk)));
    this.process.once('error', (error) => {
      this.exited = true;
      this.failAll(error);
    });
    this.process.once('exit', (code) => {
      this.exited = true;
      if (!this.disposed) this.failAll(new Error(`Native preview завершился с кодом ${code}.`));
    });
  }

  accept(chunk) {
    this.buffer += chunk;
    const lines = this.buffer.split(/\r?\n/);
    this.buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const response = JSON.parse(line);
        const pending = this.pending.get(response.id);
        if (!pending) continue;
        this.pending.delete(response.id);
        clearTimeout(pending.timer);
        if (response.error) pending.reject(new Error(response.error.message || 'Native preview RPC failed.'));
        else pending.resolve(response.result);
      } catch (error) {
        this.output.appendLine(`Некорректный ответ native preview: ${error}`);
      }
    }
  }

  request(method, params = {}, timeoutMs = 35000) {
    if (this.disposed || !this.process.stdin.writable) {
      return Promise.reject(new Error('Native preview уже закрыт.'));
    }
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Native preview не ответил на ${method}.`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.process.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`, (error) => {
        if (!error) return;
        const pending = this.pending.get(id);
        if (!pending) return;
        this.pending.delete(id);
        clearTimeout(pending.timer);
        reject(error);
      });
    });
  }

  get alive() {
    return !this.disposed && !this.exited;
  }

  async callTool(name, args = {}) {
    const result = await this.request('tools/call', { name, arguments: args });
    if (result?.isError) throw new Error(result.content?.[0]?.text || `Native tool ${name} failed.`);
    return result;
  }

  failAll(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.failAll(new Error('Native preview закрыт.'));
    this.process.stdin.end();
    this.process.kill();
  }
}

class ManualPreviewController {
  constructor(context, output) {
    this.context = context;
    this.output = output;
    this.state = undefined;
    this.serial = Promise.resolve();
  }

  open(inputUri) {
    const operation = this.serial.then(() => this.openNow(inputUri));
    this.serial = operation.catch(() => {});
    return operation;
  }

  async openNow(inputUri) {
    const selected = inputUri || vscode.window.activeTextEditor?.document.uri;
    if (!isSupported(selected)) {
      void vscode.window.showWarningMessage('Выберите файл Form.xml, Template.xml или MXL.');
      return;
    }
    const uri = await resolveDocumentUri(selected);
    const key = uri.toString();
    /* A preview whose native process has died is started again. */
    if (this.state?.key === key && this.state.client.alive) {
      await showInternalPreview(this.state.url);
      await this.state.client.callTool('reload_preview');
      return;
    }

    this.stop();
    const executable = this.context.asAbsolutePath(path.join('mcp', '1c-form-viewer.exe'));
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
    const root = workspaceFolder?.uri.fsPath || path.dirname(selected.fsPath);
    const client = new NativeRpcClient(executable, [
      '--stdio', '--root', root, '--no-open-browser',
    ], this.output);
    try {
      await client.request('initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: '1c-form-viewer-vscode', version: this.context.extension.packageJSON.version },
      });
      const result = await client.callTool('open_preview', { path: selected.fsPath });
      const url = loopbackPreviewUrl(result?.structuredContent?.previewUrl);
      if (!url) throw new Error('Native preview не вернул безопасный loopback URL.');

      const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(path.dirname(uri.fsPath), path.basename(uri.fsPath)),
      );
      const reload = () => {
        const current = this.state;
        if (!current || current.client !== client) return;
        current.reload = current.reload
          .then(() => client.callTool('reload_preview'))
          .catch((error) => this.output.appendLine(`Не удалось перечитать preview: ${error.message || error}`));
      };
      watcher.onDidChange(reload);
      watcher.onDidCreate(reload);
      this.state = { key, client, watcher, url, reload: Promise.resolve() };
      await showInternalPreview(url);
    } catch (error) {
      client.dispose();
      throw error;
    }
  }

  stop() {
    if (!this.state) return;
    this.state.watcher.dispose();
    this.state.client.dispose();
    this.state = undefined;
  }

  dispose() {
    this.stop();
  }
}

function mcpServerDefinitions(context) {
  const configuration = vscode.workspace.getConfiguration('1cFormViewer.mcp');
  if (!configuration.get('enabled', true)) return [];

  const args = [
    '--stdio',
    '--open-vscode-browser',
    '--vscode-uri-scheme', vscode.env.uriScheme,
  ];
  if (!configuration.get('templateEditTools', true)) args.push('--no-template-edit-tools');
  if (!configuration.get('formEditTools', true)) args.push('--no-form-edit-tools');
  if (configuration.get('allowAnyPath', false)) {
    args.push('--allow-any-path');
  } else {
    const workspaceRoots = (vscode.workspace.workspaceFolders || [])
      .filter((folder) => folder.uri.scheme === 'file')
      .map((folder) => folder.uri.fsPath);
    const configuredRoots = configuration.get('additionalRoots', []);
    const additionalRoots = Array.isArray(configuredRoots)
      ? configuredRoots.filter((root) => typeof root === 'string' && path.isAbsolute(root))
      : [];
    const roots = [...new Set([...workspaceRoots, ...additionalRoots])];
    if (roots.length === 0) return [];
    for (const root of roots) args.push('--root', root);
  }

  const executable = context.asAbsolutePath(path.join('mcp', '1c-form-viewer.exe'));
  return [new vscode.McpStdioServerDefinition(
    '1C Form Viewer',
    executable,
    args,
    {},
    context.extension.packageJSON.version,
  )];
}

function registerMcpProvider(context) {
  const definitionsChanged = new vscode.EventEmitter();
  const fireDefinitionsChanged = () => definitionsChanged.fire();
  context.subscriptions.push(
    definitionsChanged,
    vscode.workspace.onDidChangeWorkspaceFolders(fireDefinitionsChanged),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('1cFormViewer.mcp')) fireDefinitionsChanged();
    }),
    vscode.lm.registerMcpServerDefinitionProvider(MCP_PROVIDER_ID, {
      onDidChangeMcpServerDefinitions: definitionsChanged.event,
      provideMcpServerDefinitions: () => mcpServerDefinitions(context),
      resolveMcpServerDefinition: (server) => server,
    }),
  );
}

/* One loopback URL for agents that don't read VS Code's MCP catalog. The first
 * VS Code window owns the port; later windows just log that it is taken. Roots
 * differ per window, so this endpoint is not limited to a workspace. */
function registerHttpMcp(context, output) {
  let current;
  const stop = async () => {
    const pending = current;
    current = undefined;
    const server = pending && await pending;
    if (server) await server.close();
  };
  const start = () => {
    const configuration = vscode.workspace.getConfiguration('1cFormViewer.mcp');
    if (!configuration.get('enabled', true) || !configuration.get('http.enabled', true)) return;
    const port = configuration.get('http.port', 47391);
    /* The agent's server renders hidden; mcp-http.cjs replays what the user
     * should see on a second server whose page is the VS Code tab. */
    const args = ['--stdio', '--allow-any-path'];
    if (!configuration.get('templateEditTools', true)) args.push('--no-template-edit-tools');
    if (!configuration.get('formEditTools', true)) args.push('--no-form-edit-tools');
    current = startHttpMcpServer({
      port,
      executable: context.asAbsolutePath(path.join('mcp', '1c-form-viewer.exe')),
      args,
      log: (text) => output.append(text),
      onShowPreview: showInternalPreview,
    }).then((server) => {
      output.appendLine(`MCP HTTP: http://127.0.0.1:${server.port}/mcp`);
      return server;
    }, (error) => {
      output.appendLine(error.code === 'EADDRINUSE'
        ? `MCP HTTP: порт ${port} занят (другое окно VS Code или иной процесс).`
        : `MCP HTTP не запущен: ${error.message || error}`);
      return undefined;
    });
  };
  let restart = Promise.resolve();
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('1cFormViewer.mcp')) restart = restart.then(stop).then(start);
    }),
    { dispose: () => void stop() },
  );
  start();
}

function activate(context) {
  const output = vscode.window.createOutputChannel('1C Form Viewer');
  const manualPreview = new ManualPreviewController(context, output);
  registerMcpProvider(context);
  registerHttpMcp(context, output);

  const statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusItem.command = '1cFormViewer.openPreview';
  statusItem.text = '$(preview) 1C Preview';
  statusItem.tooltip = 'Открыть визуальное представление 1С во внутреннем браузере';
  const updateStatusItem = () => {
    if (isSupported(vscode.window.activeTextEditor?.document.uri)) statusItem.show();
    else statusItem.hide();
  };

  context.subscriptions.push(
    output,
    manualPreview,
    statusItem,
    vscode.window.registerUriHandler({
      handleUri: async (uri) => {
        if (uri.authority !== EXTENSION_AUTHORITY || uri.path !== '/open-preview') return;
        const url = new URLSearchParams(uri.query).get('url');
        try {
          await showInternalPreview(url);
        } catch (error) {
          void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
        }
      },
    }),
    vscode.commands.registerCommand('1cFormViewer.openPreview', (uri) => {
      void manualPreview.open(uri).catch((error) => {
        output.appendLine(error instanceof Error ? error.stack || error.message : String(error));
        void vscode.window.showErrorMessage(`Не удалось открыть 1C preview: ${error.message || error}`);
      });
    }),
    vscode.window.onDidChangeActiveTextEditor(updateStatusItem),
  );
  updateStatusItem();
}

function deactivate() {}

module.exports = { activate, deactivate, _test: { ManualPreviewController } };
