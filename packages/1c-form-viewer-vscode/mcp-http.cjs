const http = require('node:http');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');

/* Streamable HTTP front for the bundled stdio MCP. Agents outside VS Code's
 * MCP catalog (Claude Code, Codex, Cursor) get a stable loopback URL instead of
 * a path into the versioned extension folder, which changes on every update.
 * Each MCP session owns one native process; responses are plain JSON because
 * the native server never initiates messages. There is no token: the listener
 * is bound to loopback, and Host/Origin checks block DNS-rebinding pages.
 *
 * With onShowPreview every open_preview is shown in the host's own browser,
 * whatever show says, instead of the native vscode:// round trip: that one
 * needs a URI confirmation, may land in another window and stops the hidden
 * renderer, so commands hang while the webview sits in a background tab and
 * the queued URIs later open a burst of tabs. See McpSession. */

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

function hostnameOf(value) {
  try {
    return new URL(value.includes('://') ? value : `http://${value}`).hostname.toLowerCase();
  } catch {
    return '';
  }
}

class NativeSession {
  constructor(executable, args, log) {
    this.pending = new Map();
    this.buffer = '';
    this.closed = false;
    this.process = spawn(executable, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.process.stdout.setEncoding('utf8');
    this.process.stderr.setEncoding('utf8');
    this.process.stdout.on('data', (chunk) => this.accept(chunk));
    this.process.stderr.on('data', (chunk) => log(String(chunk)));
    const fail = () => this.close();
    this.process.once('error', fail);
    this.process.once('exit', fail);
    /* A write racing the process's exit fails with EPIPE on stdin; unhandled,
     * that is an uncaught exception in the extension host. */
    this.process.stdin.on('error', fail);
  }

  accept(chunk) {
    this.buffer += chunk;
    const lines = this.buffer.split(/\r?\n/);
    this.buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      const key = JSON.stringify(message.id ?? null);
      const resolve = this.pending.get(key);
      if (!resolve) continue;
      this.pending.delete(key);
      resolve(message);
    }
  }

  send(message) {
    const hasId = message && Object.prototype.hasOwnProperty.call(message, 'id') && message.id !== null;
    if (this.closed) {
      return Promise.resolve(hasId ? errorResponse(message.id, -32000, 'MCP session closed.') : undefined);
    }
    this.process.stdin.write(`${JSON.stringify(message)}\n`);
    if (!hasId) return Promise.resolve(undefined);
    return new Promise((resolve) => this.pending.set(JSON.stringify(message.id), resolve));
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    for (const [key, resolve] of this.pending) {
      resolve(errorResponse(JSON.parse(key), -32000, 'Native MCP process exited.'));
    }
    this.pending.clear();
    this.process.stdin.end();
    this.process.kill();
  }
}

function errorResponse(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

function readBody(req, limit = 16 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('Request body too large.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const SHOWN_LEAD = 'Визуальное представление открыто во внутреннем браузере VS Code; capture_preview и preview(operation="inspect") работают как обычно.';

/* Tools whose effect the user should see: replayed on the visible copy. The
 * preview tool is replayed by operation: inspect and url change nothing. */
const MIRRORED_TOOLS = new Set(['open_preview']);
const MIRRORED_PREVIEW_OPERATIONS = new Set(['reload', 'switch_tab', 'select', 'scroll', 'close']);
/* Tools that may change the open file: the visible copy re-reads it. */
const EDITING_TOOLS = new Set(['edit_template', 'convert_xlsx_to_template', 'edit_form']);
const MIRROR_BACKLOG = 4;

/* One agent session. The agent talks only to `main`, a native server with its
 * hidden renderer, so answers never depend on the VS Code tab. A second native
 * server serves the page shown in VS Code (--no-open-browser: that tab is its
 * only page) and gets the user-visible actions replayed without waiting. If the
 * tab is closed or throttled in the background, the replay lags or is dropped;
 * the agent is not affected. */
class McpSession {
  constructor({ executable, args, mirrorArgs, onShowPreview, log }) {
    this.executable = executable;
    this.mirrorArgs = mirrorArgs;
    this.onShowPreview = onShowPreview;
    this.log = log;
    this.main = new NativeSession(executable, args, log);
    this.mirror = undefined;
    this.mirrorChain = Promise.resolve();
    this.mirrorBacklog = 0;
    this.mirrorId = 0;
    this.closed = false;
  }

  async handle(message) {
    const tool = message?.method === 'tools/call' ? message.params?.name : undefined;
    const showing = this.onShowPreview && tool === 'open_preview';
    /* The main server must never open a window of its own: audience overrides
     * show in the native server, so both are forced to the hidden renderer. The
     * user sees the preview only in the VS Code tab. */
    const requested = message.params?.arguments || {};
    if (showing) message.params.arguments = { ...requested, audience: 'agent', show: false };
    const response = await this.main.send(message);
    if (!this.onShowPreview || !tool || !response?.result || response.result.isError) return response;

    if (MIRRORED_TOOLS.has(tool)) {
      this.replay(tool, requested, tool === 'open_preview' ? response.result.structuredContent?.previewId : undefined);
    }
    else if (tool === 'preview' && MIRRORED_PREVIEW_OPERATIONS.has(requested.operation)) this.replay(tool, requested);
    else if (EDITING_TOOLS.has(tool)) this.replay('preview', { operation: 'reload' });
    if (showing) {
      response.result.structuredContent = { ...response.result.structuredContent, presentation: 'client' };
      for (const part of response.result.content || []) {
        if (part.type === 'text') part.text = part.text.replace(/^[^\n]*/, SHOWN_LEAD);
      }
    }
    return response;
  }

  replay(tool, args, mainPreviewId) {
    const essential = tool === 'open_preview'
      || (tool === 'preview' && (args.operation === 'reload' || args.operation === 'close'));
    if (!essential && this.mirrorBacklog >= MIRROR_BACKLOG) return;
    this.mirrorBacklog += 1;
    this.mirrorChain = this.mirrorChain
      .then(() => this.replayNow(tool, args, mainPreviewId))
      .catch((error) => this.log(`Preview во вкладке VS Code не обновлён (${tool}): ${error.message || error}\n`))
      .finally(() => { this.mirrorBacklog -= 1; });
  }

  async replayNow(tool, args, mainPreviewId) {
    /* A replay still queued when the session closed must not start a mirror
     * process that nothing would ever close. */
    if (this.closed) return;
    if (!this.mirror || this.mirror.closed) {
      if (tool !== 'open_preview') return;
      this.mirror = new NativeSession(this.executable, this.mirrorArgs, this.log);
      this.previewIds = new Map();
      await this.mirror.send({ jsonrpc: '2.0', id: `mirror-${++this.mirrorId}`, method: 'initialize', params: {} });
    }
    /* Both servers number their previews on their own, so the agent's
     * preview_id is translated to the mirror's. */
    let mirrorArgs = args;
    if (tool === 'open_preview') mirrorArgs = { ...args, audience: 'agent', show: false };
    else if (args.preview_id) {
      const translated = this.previewIds.get(args.preview_id);
      if (!translated) return;
      mirrorArgs = { ...args, preview_id: translated };
    }
    const response = await this.mirror.send({
      jsonrpc: '2.0',
      id: `mirror-${++this.mirrorId}`,
      method: 'tools/call',
      params: { name: tool, arguments: mirrorArgs },
    });
    if (response.error || response.result?.isError) {
      throw new Error(response.error?.message || response.result.content?.[0]?.text || 'failed');
    }
    const content = response.result?.structuredContent || {};
    if (tool === 'open_preview' && mainPreviewId && content.previewId) this.previewIds.set(mainPreviewId, content.previewId);
    if (tool === 'preview' && args.operation === 'close') {
      if (args.preview_id) this.previewIds.delete(args.preview_id);
      else this.previewIds.clear();
    }
    if (tool === 'open_preview' && content.previewUrl) await this.onShowPreview(content.previewUrl);
  }

  send(message) {
    return this.main.send(message);
  }

  close() {
    this.closed = true;
    this.main.close();
    this.mirror?.close();
  }
}

function startHttpMcpServer({
  port, host = '127.0.0.1', executable, args, log = () => {}, onShowPreview, mirrorArgs = [...args, '--no-open-browser'],
}) {
  const sessions = new Map();

  const sendJson = (res, status, body, headers = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
    res.end(body === undefined ? undefined : JSON.stringify(body));
  };

  const handle = async (req, res) => {
    let url;
    try {
      url = new URL(req.url, 'http://127.0.0.1');
    } catch {
      return sendJson(res, 400, errorResponse(null, -32000, 'Bad request target.'));
    }
    if (url.pathname !== '/mcp') return sendJson(res, 404, errorResponse(null, -32000, 'Use /mcp.'));
    if (!LOOPBACK_HOSTS.has(hostnameOf(req.headers.host || ''))) {
      return sendJson(res, 403, errorResponse(null, -32000, 'Host is not loopback.'));
    }
    /* "null" is the opaque origin of a sandboxed iframe or a file: page, which
     * any website can produce; a simple text/plain POST from there needs no
     * preflight and could run tools. Non-browser clients send no Origin. */
    if (req.headers.origin && !LOOPBACK_HOSTS.has(hostnameOf(req.headers.origin))) {
      return sendJson(res, 403, errorResponse(null, -32000, 'Origin is not allowed.'));
    }

    const sessionId = req.headers['mcp-session-id'];
    if (req.method === 'DELETE') {
      const session = sessions.get(sessionId);
      if (!session) return sendJson(res, 404, errorResponse(null, -32001, 'Unknown MCP session.'));
      session.close();
      sessions.delete(sessionId);
      return sendJson(res, 200);
    }
    if (req.method !== 'POST') {
      res.writeHead(405, { Allow: 'POST, DELETE' });
      return res.end();
    }

    let payload;
    try {
      payload = JSON.parse(await readBody(req));
    } catch {
      return sendJson(res, 400, errorResponse(null, -32700, 'Parse error.'));
    }
    const messages = Array.isArray(payload) ? payload : [payload];
    const initialize = messages.find((message) => message?.method === 'initialize');

    let session;
    let headers = {};
    if (initialize) {
      const id = randomUUID();
      session = new McpSession({ executable, args, mirrorArgs, onShowPreview, log });
      sessions.set(id, session);
      session.main.process.once('exit', () => {
        sessions.delete(id);
        session.close();
      });
      headers = { 'Mcp-Session-Id': id };
    } else {
      session = sessions.get(sessionId);
      /* 404 tells a spec client to start over with initialize, which is also
       * what happens after VS Code restarts and old session ids are gone. */
      if (!session) return sendJson(res, sessionId ? 404 : 400, errorResponse(null, -32001, 'Unknown MCP session.'));
    }

    const responses = (await Promise.all(messages.map((message) => session.handle(message)))).filter(Boolean);
    if (responses.length === 0) {
      res.writeHead(202, headers);
      return res.end();
    }
    return sendJson(res, 200, Array.isArray(payload) ? responses : responses[0], headers);
  };

  /* The handler is async: a throw must become a response, not an unhandled
   * rejection that takes the extension host down. */
  const server = http.createServer((req, res) => {
    handle(req, res).catch((error) => {
      log(`HTTP MCP: ${error?.message || error}`);
      if (!res.headersSent) sendJson(res, 500, errorResponse(null, -32603, 'Internal error.'));
      else res.destroy();
    });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve({
        port: server.address().port,
        close() {
          for (const session of sessions.values()) session.close();
          sessions.clear();
          return new Promise((done) => server.close(() => done()));
        },
      });
    });
  });
}

module.exports = { startHttpMcpServer };
