#!/usr/bin/env node
/* Node.js MCP server for 1C Form Viewer — the cross-platform sibling of
 * native/mcp-server.cpp. The C++ server exists because a single Windows exe
 * needs no runtime; everywhere else (and on Windows too) this server offers
 * the same ten tools over the same stdio NDJSON protocol, built on the shared
 * 1c-preview-core modules and the Node-side pipeline of this package
 * (FileLoader, StaticAssetServer, BrowserSession, ViewerController).
 *
 * Transforms (list/validate/edit of forms and templates, xlsx conversion) run
 * right here: form-edit.js, form-validate.js, template-markup.js and
 * xlsx-template.js are host-agnostic and attach to globalThis, so unlike the
 * native server this one does not need a browser page for them. Previews are
 * rendered by one headless Chromium, a browser context per open preview.
 *
 * Usage: node dist/mcp-server.js --stdio [--root PATH]... [--allow-any-path]
 *        [--no-template-edit-tools] [--no-form-edit-tools]
 */
import { execFile, spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import '1c-preview-core/browser/form-edit.js';
import '1c-preview-core/browser/form-validate.js';
import '1c-preview-core/browser/template-markup.js';
import '1c-preview-core/browser/xlsx-template.js';
import { BrowserSession, SharedBrowser, type CaptureScope } from './browser-session.js';
import { ViewerController, type DocumentPreparer } from './controller.js';
import { decodeText, FileLoader } from './files.js';
import { TOOL_SCHEMAS } from './tool-schemas.js';
import type { LoadedDocument } from './types.js';

const require = createRequire(import.meta.url);
const PACKAGE_VERSION: string = require('../package.json').version;
const SERVER_NAME = '1c-form-viewer';
const PROTOCOL_VERSION = '2025-06-18';
const MAX_BYTES = 64 * 1024 * 1024;

interface FormEditApi {
  listElements(xml: string): unknown;
  setProperties(xml: string, params: Record<string, unknown>): { xml: string; result: unknown };
  moveElement(xml: string, params: Record<string, unknown>): { xml: string; result: unknown };
  removeElement(xml: string, params: Record<string, unknown>): { xml: string; result: unknown };
  addElement(xml: string, params: Record<string, unknown>): { xml: string; result: unknown };
  setAttribute(xml: string, params: Record<string, unknown>): { xml: string; result: unknown };
  setCommand(xml: string, params: Record<string, unknown>): { xml: string; result: unknown };
}
interface FormValidateApi { validateForm(xml: string, options: Record<string, unknown>): unknown }
interface TemplateMarkupApi {
  listMarkup(xml: string): unknown;
  validateTemplate(xml: string): unknown;
  [action: string]: unknown;
}
interface XlsxTemplateApi {
  convert(data: string, options: { sheet?: string }): Promise<{ xml: string; summary: unknown }>;
}

const FormEdit = (globalThis as unknown as { FormEdit: FormEditApi }).FormEdit;
const FormValidate = (globalThis as unknown as { FormValidate: FormValidateApi }).FormValidate;
const TemplateMarkup = (globalThis as unknown as { TemplateMarkup: TemplateMarkupApi }).TemplateMarkup;
const XlsxTemplate = (globalThis as unknown as { XlsxTemplate: XlsxTemplateApi }).XlsxTemplate;

interface CliOptions {
  roots: string[];
  allowAnyPath: boolean;
  templateEditTools: boolean;
  formEditTools: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { roots: [], allowAnyPath: false, templateEditTools: true, formEditTools: true };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--root' && argv[i + 1]) options.roots.push(argv[++i]);
    else if (argv[i] === '--allow-any-path') options.allowAnyPath = true;
    else if (argv[i] === '--no-template-edit-tools') options.templateEditTools = false;
    else if (argv[i] === '--no-form-edit-tools') options.formEditTools = false;
    else if (argv[i] === '--stdio') { /* the only transport */ }
  }
  return options;
}

/* The native server says the same thing; keep the wording so agents behave
 * identically against either server. */
function buildInstructions(options: CliOptions): string {
  return 'This server provides visual inspection of 1C form layouts and print templates. When the user asks to show, open or see a 1C form or template ("покажи форму", "открой макет"), call open_preview with audience="user" instead of opening XML source or launching 1C; audience="agent" is only for your own checks in a hidden browser the user never sees. Forms/Name.xml descriptors resolve to Ext/Form.xml. After opening, preview operation=inspect lists page and element ids for switch_tab, select and scroll; capture_preview takes a PNG. Annotations ("аннотации", "пометки", "замечания" on a form or template) are notes pinned to elements or cells in the open preview, kept by this server and never written to the file: add them with preview operation=add_annotation, read the user\'s with operation=annotations, answer with resolve_annotation. Do not put them into the XML as cell notes or comments.'
    + ' Print templates: convert_xlsx_to_template turns an xlsx layout into Template.xml; list_markup shows areas and parameters, validate_template checks it'
    + (options.templateEditTools ? ', edit_template changes it' : '')
    + '. Managed forms: list_form_elements shows the item tree, validate_form checks it'
    + (options.formEditTools ? ', edit_form changes properties, items, attributes and commands' : '')
    + '.'
    + (options.templateEditTools || options.formEditTools
      ? ' After an edit the open preview refreshes: check it with capture_preview and run the matching validate tool.'
      : '');
}

/* A data composition schema is also stored as Template.xml; its root element
 * tells it apart from a spreadsheet template (documentKind in the C++ server). */
function documentKind(resolvedPath: string, content: string): string {
  const filename = path.basename(resolvedPath).toLowerCase();
  const extension = path.extname(resolvedPath).toLowerCase();
  if (filename === 'form.xml' || extension === '.form') return 'managed-form';
  if (content.slice(0, 1024).includes('<DataCompositionSchema')) return 'dcs';
  if (filename === 'template.xml' || extension === '.mxlx') return 'spreadsheet-template';
  if (extension === '.mxl') return 'mxl';
  return 'xml';
}

function normalizeForComparison(value: string): string {
  const normalized = path.resolve(value).replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function isInside(root: string, candidate: string): boolean {
  const normalizedRoot = normalizeForComparison(root);
  const normalizedCandidate = normalizeForComparison(candidate);
  return normalizedCandidate === normalizedRoot
    || normalizedCandidate.startsWith(`${normalizedRoot}${path.sep}`);
}

/* Write through a sibling temp file and a rename, so a failed write never
 * leaves a half-written file behind (write_file_replacing in the C++ server). */
async function writeFileReplacing(target: string, bytes: string): Promise<void> {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temp = `${target}.tmp-${Math.random().toString(16).slice(2, 10)}`;
  try {
    await fs.writeFile(temp, bytes, 'utf8');
    await fs.rename(temp, target);
  } catch (error) {
    await fs.rm(temp, { force: true }).catch(() => undefined);
    throw error;
  }
}

/* snake_case tool arguments → the shared modules' camelCase (edit_template). */
function camelize(key: string): string {
  return key.replace(/_([a-z])/g, (_match, ch: string) => ch.toUpperCase());
}

function openExternal(url: string): void {
  const [command, args] = process.platform === 'win32'
    ? ['cmd', ['/c', 'start', '', url]]
    : process.platform === 'darwin'
      ? ['open', [url]]
      : ['xdg-open', [url]];
  const child = spawn(command, args, { detached: true, stdio: 'ignore' });
  child.on('error', () => undefined);
  child.unref();
}

/* A git revision name open_preview base_revision may pass on (ValidRevision in
 * gitquery.cpp): never an option, no revision:path, range or shell syntax. */
function validRevision(revision: string): boolean {
  if (!revision) return true;
  if (revision.length > 200 || revision.startsWith('-')) return false;
  if (/[\u0000-\u001f\u007f \t:\\"'`;&|<>*?[\]()$]/.test(revision)) return false;
  return revision !== '.' && !revision.includes('..');
}

function runGit(cwd: string, args: string[], maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, encoding: 'buffer', maxBuffer: maxBytes, timeout: 15000, windowsHide: true },
      (error, stdout, stderr) => {
        if (!error) { resolve(stdout); return; }
        const failure = error as NodeJS.ErrnoException & { killed?: boolean; code?: string | number };
        if (failure.code === 'ENOENT') reject(new Error('base_revision needs git: git was not found in PATH.'));
        else if (failure.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') reject(new Error('base_revision: that version of the file is too large.'));
        else if (failure.killed) reject(new Error('base_revision: git did not answer in time.'));
        else reject(Object.assign(new Error(String(stderr).trim() || failure.message), { gitFailed: true }));
      });
  });
}

/* The text of a file as git holds it: "index" (or nothing) is what is staged,
 * anything else is a revision git accepts — HEAD, HEAD~2, a branch, a tag.
 * A revision also brings the commit behind it (short sha, date, subject):
 * "HEAD" alone does not say which version the page compares against. */
async function readRevision(file: string, revision: string, maxBytes: number): Promise<{ content: string; description: string }> {
  const rev = revision === 'index' ? '' : revision;
  if (!validRevision(rev)) throw new Error(`base_revision is not a valid git revision name: ${revision}`);
  let root: string;
  try {
    root = (await runGit(path.dirname(file), ['rev-parse', '--show-toplevel'], 64 * 1024)).toString('utf8').trim();
  } catch (error) {
    if ((error as { gitFailed?: boolean }).gitFailed) throw new Error(`base_revision: the file is not in a git repository: ${file}`);
    throw error;
  }
  const relative = path.relative(await fs.realpath(root), await fs.realpath(file)).split(path.sep).join('/');
  let bytes: Buffer;
  try {
    bytes = await runGit(root, ['show', `${rev}:${relative}`], maxBytes + 1);
  } catch (error) {
    if (!(error as { gitFailed?: boolean }).gitFailed) throw error;
    throw new Error(rev ? `base_revision: git has no such revision of this file: ${revision} (${relative}).`
      : 'base_revision: the file is not in the git index.');
  }
  if (bytes.length > maxBytes) throw new Error('base_revision: that version of the file is too large.');
  let description = '';
  if (rev) {
    description = await runGit(root, ['log', '-1', '--date=format:%d.%m.%Y %H:%M', '--format=%h %ad %s', rev, '--'], 4096)
      .then((out) => out.toString('utf8').trimEnd(), () => '');
  }
  return { content: decodeText(bytes).content, description };
}

interface PreviewEntry {
  id: string;
  browser: BrowserSession;
  controller: ViewerController;
  input: string;
  document: LoadedDocument;
  /* open_preview base_path / base_revision as given: a comparison is its own
   * preview, next to the plain one of the same file. */
  baseInput: string;
  baseRevision: string;
  /* Shown in a user window: its asset server must outlive idle periods. */
  forUser: boolean;
}

/* Hidden previews and the headless browser are released after this long
 * without a request; the process itself stays, because the client does not
 * restart a stdio server that went away. */
const IDLE_RELEASE_MS = Number(process.env.ONE_C_FORM_VIEWER_IDLE_MS) || 15 * 60_000;
const PARENT_CHECK_MS = 30_000;

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/* How a comparison is named in replies: a file, or git:<revision>. */
function baseLabel(document: LoadedDocument): string {
  if (!document.basePath) return '';
  return document.baseRevision ? `git:${document.baseRevision}` : document.basePath;
}

interface JsonRpcRequest {
  id?: unknown;
  method?: string;
  params?: { name?: string; arguments?: Record<string, unknown> };
}

export class NodeMcpServer {
  private loader!: FileLoader;
  private readonly sessions = new Map<string, PreviewEntry>();
  private sessionCounter = 0;
  private activeId = '';
  private readonly browser = new SharedBrowser(true);
  private readonly idleClosed = new Set<string>();
  private lastActivity = Date.now();
  private busy = false;

  constructor(private readonly options: CliOptions, private readonly assetsDir: string) {}

  async run(): Promise<void> {
    await fs.stat(path.join(this.assetsDir, 'index.html')).catch(() => {
      throw new Error(`Preview assets are not built in ${this.assetsDir}; run "npm run build:assets --workspace=1c-form-viewer".`);
    });
    const roots = this.options.allowAnyPath ? [process.cwd()] : this.options.roots;
    if (!roots.length) throw new Error('No allowed roots: pass --root PATH or --allow-any-path.');
    this.loader = await FileLoader.create(roots, MAX_BYTES, process.cwd(), this.options.allowAnyPath);

    const parentPid = process.ppid;
    const parentTimer = setInterval(() => {
      /* The client died without closing stdin (a crash or a killed tree). */
      if (parentPid > 1 && !isAlive(parentPid)) {
        void this.shutdown().finally(() => process.exit(0));
      }
    }, PARENT_CHECK_MS);
    parentTimer.unref();
    const idleTimer = setInterval(() => {
      if (!this.busy && Date.now() - this.lastActivity >= IDLE_RELEASE_MS) void this.releaseIdle();
    }, Math.min(IDLE_RELEASE_MS, 60_000));
    idleTimer.unref();

    const rl = readline.createInterface({ input: process.stdin });
    for await (const line of rl) {
      if (!line.trim()) continue;
      let request: JsonRpcRequest;
      try {
        request = JSON.parse(line) as JsonRpcRequest;
      } catch {
        continue;
      }
      this.busy = true;
      try {
        const response = await this.handle(request);
        if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
      } finally {
        this.busy = false;
        this.lastActivity = Date.now();
      }
    }
    clearInterval(parentTimer);
    clearInterval(idleTimer);
    await this.shutdown();
  }

  private async shutdown(): Promise<void> {
    await this.closeAll();
    await this.browser.close();
  }

  /* Closes the hidden previews and, when no user window still needs it, the
   * headless browser. The next open_preview launches it again. */
  private async releaseIdle(): Promise<void> {
    this.busy = true;
    try {
      for (const entry of [...this.sessions.values()]) {
        if (entry.forUser) continue;
        this.idleClosed.add(entry.id);
        await this.closeEntry(entry);
      }
      if (!this.sessions.size) await this.browser.close();
    } finally {
      this.busy = false;
      this.lastActivity = Date.now();
    }
  }

  private newBrowserSession(): BrowserSession {
    return new BrowserSession({
      roots: this.loader.allowedRoots(),
      allowAnyPath: this.options.allowAnyPath,
      viewport: { width: 1280, height: 900 },
      headless: true,
      maxBytes: MAX_BYTES,
      assetsDir: this.assetsDir,
      internalPreview: true,
    }, this.browser);
  }

  private async handle(request: JsonRpcRequest): Promise<object | null> {
    const id = request.id;
    const method = request.method || '';
    if (id === undefined && method.startsWith('notifications/')) return null;
    try {
      if (method === 'initialize') {
        return {
          jsonrpc: '2.0',
          id: id ?? null,
          result: {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: { tools: {} },
            serverInfo: { name: SERVER_NAME, version: PACKAGE_VERSION },
            instructions: buildInstructions(this.options),
          },
        };
      }
      if (method === 'ping') return { jsonrpc: '2.0', id: id ?? null, result: {} };
      if (method === 'tools/list') {
        const tools = TOOL_SCHEMAS.filter((tool) => {
          if (tool.name === 'edit_template') return this.options.templateEditTools;
          if (tool.name === 'edit_form') return this.options.formEditTools;
          return true;
        });
        return { jsonrpc: '2.0', id: id ?? null, result: { tools } };
      }
      if (method !== 'tools/call') return this.failure(id, `Unknown MCP method: ${method}`);
      const name = request.params?.name || '';
      const args = request.params?.arguments || {};
      return await this.callTool(id, name, args);
    } catch (error) {
      return this.failure(id, error instanceof Error ? error.message : String(error));
    }
  }

  private success(id: unknown, value: unknown, image?: Buffer, text?: string): object {
    const content: Array<Record<string, unknown>> = [{ type: 'text', text: text ?? JSON.stringify(value) }];
    if (image) content.push({ type: 'image', data: image.toString('base64'), mimeType: 'image/png' });
    return { jsonrpc: '2.0', id: id ?? null, result: { content, structuredContent: value ?? {} } };
  }

  private failure(id: unknown, message: string): object {
    return { jsonrpc: '2.0', id: id ?? null, result: { isError: true, content: [{ type: 'text', text: message }] } };
  }

  /* The preview a tool call targets: the given id, or the last one used. */
  private resolvePreview(requested: string): PreviewEntry {
    if (!requested) {
      const active = this.activeId && this.sessions.get(this.activeId);
      if (!active) throw new Error('No preview is open. Call open_preview first.');
      return active;
    }
    const entry = this.sessions.get(requested);
    if (!entry && this.idleClosed.has(requested)) {
      throw new Error(`Preview ${requested} was closed after inactivity. Call open_preview again.`);
    }
    if (!entry) throw new Error(`Unknown preview_id: ${requested}. Call preview with operation=url to list open previews.`);
    this.activeId = requested;
    return entry;
  }

  private listPreviews(): Array<Record<string, unknown>> {
    return [...this.sessions.values()].map((entry) => ({
      previewId: entry.id,
      path: entry.document.resolvedPath,
      ...(entry.document.basePath ? { base: baseLabel(entry.document) } : {}),
      previewUrl: entry.browser.previewUrl(),
      active: entry.id === this.activeId,
    }));
  }

  /* open_preview base_path / base_revision: attaches the earlier version to
   * the document on open and on every reload (loadComparison in the C++
   * server). The page draws the BSLEdit diff views from it. */
  private comparison(baseInput: string, baseRevision: string): DocumentPreparer | null {
    if (baseInput && baseRevision) throw new Error('Pass either base_path or base_revision, not both.');
    if (baseRevision) {
      return async (document) => {
        if (document.extension === '.mxl') throw new Error('base_revision: a binary MXL file cannot be compared; use Template.xml.');
        const base = await readRevision(document.resolvedPath, baseRevision, MAX_BYTES);
        return {
          ...document, basePath: document.resolvedPath, baseRevision,
          baseContent: base.content, baseDescription: base.description,
        };
      };
    }
    if (!baseInput) return null;
    return async (document) => {
      const base = await this.loader.load(baseInput);
      if (document.extension === '.mxl' || base.extension === '.mxl') {
        throw new Error('base_path: a binary MXL file cannot be compared; use Template.xml.');
      }
      const kind = documentKind(document.resolvedPath, document.content);
      const baseKind = documentKind(base.resolvedPath, base.content);
      if (kind !== baseKind) throw new Error(`base_path must be the same kind of document as path: ${baseKind} vs ${kind}.`);
      return { ...document, basePath: base.resolvedPath, baseRevision: '', baseContent: base.content };
    };
  }

  private async closeEntry(entry: PreviewEntry): Promise<void> {
    this.sessions.delete(entry.id);
    if (this.activeId === entry.id) this.activeId = '';
    await entry.controller.close().catch(() => undefined);
  }

  private async closeAll(): Promise<void> {
    for (const entry of [...this.sessions.values()]) await this.closeEntry(entry);
  }

  /* A path an authoring tool reads or writes: absolute, canonical, inside the
   * allowed roots and with the expected extension (resolveAuthoringPath). */
  private async resolveAuthoringPath(input: string, extension: string, mustExist: boolean): Promise<string> {
    if (!input) throw new Error('The path must be a non-empty UTF-8 string.');
    let candidate = path.resolve(process.cwd(), input);
    if (path.extname(candidate).toLowerCase() !== extension) {
      throw new Error(`Expected a ${extension} file: ${input}`);
    }
    if (mustExist) {
      candidate = await fs.realpath(candidate).catch(() => {
        throw new Error(`File does not exist: ${input}`);
      });
      const stat = await fs.stat(candidate);
      if (!stat.isFile()) throw new Error(`Path is not a file: ${input}`);
    }
    if (!this.options.allowAnyPath
      && !this.loader.allowedRoots().some((root) => isInside(root, candidate))) {
      throw new Error(`Path is outside the allowed roots: ${candidate}`);
    }
    return candidate;
  }

  /* The open previews of a file are refreshed after a write, so the next
   * capture_preview shows the edit (refreshIfOpen in the C++ server). */
  private async refreshIfOpen(written: string): Promise<boolean> {
    let refreshed = false;
    const target = normalizeForComparison(written);
    for (const entry of this.sessions.values()) {
      if (normalizeForComparison(entry.document.resolvedPath) !== target) continue;
      try {
        await entry.controller.reload();
        refreshed = true;
      } catch {
        /* A preview that cannot re-read the file keeps its old content. */
      }
    }
    return refreshed;
  }

  private async callTool(id: unknown, rawName: string, args: Record<string, unknown>): Promise<object> {
    const argString = (key: string): string => (typeof args[key] === 'string' ? (args[key] as string) : '');
    const argBool = (key: string): boolean => args[key] === true;

    /* `preview` is one tool for the agent; every operation maps to the
     * controller method of the targeted preview. */
    if (rawName === 'preview') {
      const operation = argString('operation');
      if (operation === 'url') {
        const entry = this.resolvePreview(argString('preview_id'));
        return this.success(id, {
          previewId: entry.id,
          previewUrl: entry.browser.previewUrl(),
          previews: this.listPreviews(),
          externalBrowser: true,
          presentationTarget: 'external-browser',
        });
      }
      if (operation === 'close') {
        const requested = argString('preview_id');
        if (!requested) {
          await this.closeAll();
          return this.success(id, { closed: true });
        }
        const entry = this.resolvePreview(requested);
        await this.closeEntry(entry);
        return this.success(id, { closed: true, previewId: entry.id });
      }
      const entry = this.resolvePreview(argString('preview_id'));
      if (operation === 'inspect') {
        const { payload } = await entry.controller.inspect(argString('query') || undefined, argBool('visible_only'));
        return this.success(id, payload);
      }
      if (operation === 'switch_tab') {
        const { payload } = await entry.controller.switchTab(argString('page_id'), argString('pages_id') || undefined);
        return this.success(id, payload);
      }
      if (operation === 'select') {
        const { payload } = await entry.controller.selectElement(argString('element_id'));
        return this.success(id, payload);
      }
      if (operation === 'scroll') {
        const renames: Record<string, string> = { element_id: 'elementId', delta_x: 'deltaX', delta_y: 'deltaY' };
        const options: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(args)) {
          if (key === 'operation' || key === 'preview_id') continue;
          options[renames[key] || key] = value;
        }
        const { payload } = await entry.controller.scroll(options);
        return this.success(id, payload);
      }
      if (operation === 'annotations') {
        /* Annotations are written in the native server's preview and in
         * BSLEdit; this page offers no editor, so the list is always empty. */
        return this.success(id, { previewId: entry.id, annotations: [] });
      }
      if (operation === 'add_annotation') {
        throw new Error('This preview has no annotations; the native server and BSLEdit keep them.');
      }
      if (operation === 'resolve_annotation' || operation === 'remove_annotation') {
        throw new Error(`No annotation ${argString('annotation_id')} on this preview; list them with operation=annotations.`);
      }
      if (operation === 'reload') {
        const prepare = this.comparison(entry.baseInput, entry.baseRevision);
        const document = await this.loader.load(entry.input);
        entry.document = prepare ? await prepare(document) : document;
        const { payload } = await entry.controller.reload();
        return this.success(id, payload.state);
      }
      throw new Error('operation must be one of inspect, switch_tab, select, scroll, reload, annotations, resolve_annotation, add_annotation, remove_annotation, url, close.');
    }

    if (rawName === 'open_preview') {
      const input = argString('path');
      if (!input) throw new Error('path is required');
      const audienceArg = argString('audience');
      if (audienceArg && audienceArg !== 'user' && audienceArg !== 'agent') {
        throw new Error('audience must be "user" or "agent".');
      }
      const forUser = audienceArg ? audienceArg === 'user' : argBool('show');
      /* Auto keeps the layout inferred from the export; Taxi and Version85
       * override it, as in the native server. */
      const modeArg = argString('interface_mode');
      if (modeArg && modeArg !== 'Auto' && modeArg !== 'Taxi' && modeArg !== 'Version85') {
        throw new Error('interface_mode must be Auto, Taxi, or Version85.');
      }
      const interfaceMode = modeArg === 'Auto' ? '' : modeArg;
      const baseInput = argString('base_path');
      const baseRevision = argString('base_revision');
      const prepare = this.comparison(baseInput, baseRevision);
      const loaded = await this.loader.load(input);
      const document = prepare ? await prepare(loaded) : loaded;

      /* Reopening a file reuses its preview; a comparison is its own preview,
       * one per earlier version. */
      const keyOf = (candidate: LoadedDocument): string => [
        normalizeForComparison(candidate.resolvedPath),
        candidate.basePath ? normalizeForComparison(candidate.basePath) : '',
        candidate.baseRevision || '',
      ].join('|');
      const key = keyOf(document);
      let entry = [...this.sessions.values()].find((candidate) => keyOf(candidate.document) === key);
      let presentation: string;
      if (entry) {
        entry.input = input;
        entry.document = document;
        entry.baseInput = baseInput;
        entry.baseRevision = baseRevision;
        await entry.controller.open(input, interfaceMode, prepare);
      } else {
        const browser = this.newBrowserSession();
        entry = {
          id: `p${++this.sessionCounter}`,
          browser,
          controller: new ViewerController(this.loader, browser),
          input,
          document,
          baseInput,
          baseRevision,
          forUser,
        };
        await entry.controller.open(input, interfaceMode, prepare);
        this.sessions.set(entry.id, entry);
      }
      this.activeId = entry.id;
      if (forUser) entry.forUser = true;
      const url = entry.browser.previewUrl();
      if (forUser) {
        openExternal(url);
        presentation = 'window';
      } else {
        presentation = 'hidden';
      }
      const value = {
        requestedPath: document.requestedPath,
        resolvedPath: document.resolvedPath,
        path: document.resolvedPath,
        size: document.size,
        encoding: document.encoding,
        previewId: entry.id,
        previewUrl: url,
        presentation,
        audience: forUser ? 'user' : 'agent',
        kind: documentKind(document.resolvedPath, document.content),
        ...(document.basePath ? { base: baseLabel(document) } : {}),
      };
      const lead = presentation === 'hidden'
        ? 'Открыто ДЛЯ АГЕНТА в скрытом браузере: пользователь этого не видит, и снимки capture_preview ему тоже не видны. Если пользователь просил показать или открыть — вызовите open_preview с audience="user".'
        : 'Открыто ДЛЯ ПОЛЬЗОВАТЕЛЯ: отдельное окно браузера на его экране. Другие открытые превью остаются доступны по своим ссылкам.';
      const compared = document.basePath ? `\nСравнение: было ${baseLabel(document)} → стало ${document.resolvedPath}` : '';
      const message = `${lead}${compared}\nФактический макет: ${document.resolvedPath}\npreview_id: ${entry.id}\nPreview URL: ${url}`;
      return this.success(id, value, undefined, message);
    }

    if (rawName === 'capture_preview') {
      const entry = this.resolvePreview(argString('preview_id'));
      const scope = (argString('scope') || 'viewport') as CaptureScope;
      const { image } = await entry.controller.capture(scope, argString('element_id') || undefined);
      return this.success(id, { scope }, image);
    }

    /* The shared-module transforms run in this process: form-edit.js,
     * form-validate.js, template-markup.js and xlsx-template.js are
     * host-agnostic, so no browser page is needed for them. */
    if (rawName === 'edit_form' || rawName === 'list_form_elements' || rawName === 'validate_form') {
      if (rawName === 'edit_form' && !this.options.formEditTools) {
        throw new Error('Form editing tools are disabled for this server (--no-form-edit-tools).');
      }
      const target = await this.resolveAuthoringPath(argString('path'), '.xml', true);
      const document = await this.loader.load(target);
      const formActions: Record<string, keyof FormEditApi> = {
        set_properties: 'setProperties', move_element: 'moveElement', remove_element: 'removeElement',
        add_element: 'addElement', set_attribute: 'setAttribute', set_command: 'setCommand',
      };
      let payload: { xml: string; result: unknown };
      if (rawName === 'list_form_elements') {
        payload = { xml: document.content, result: FormEdit.listElements(document.content) };
      } else if (rawName === 'validate_form') {
        payload = { xml: document.content, result: FormValidate.validateForm(document.content, {}) };
      } else {
        const action = formActions[argString('operation')];
        if (!action) {
          throw new Error('operation must be one of set_properties, add_element, move_element, remove_element, set_attribute, set_command.');
        }
        if (document.encoding !== 'utf8-bom' && document.encoding !== 'utf8') {
          throw new Error(`Only UTF-8 forms are edited; this file is ${document.encoding}.`);
        }
        const params: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(args)) {
          if (key === 'path' || key === 'operation') continue;
          params[key] = value;
        }
        const transform = FormEdit[action] as (xml: string, params: Record<string, unknown>) => { xml: string; result: unknown };
        payload = transform(document.content, params);
      }
      const readOnly = rawName !== 'edit_form';
      let previewRefreshed = false;
      if (!readOnly) {
        /* The loader drops the byte order mark; Designer's forms carry one. */
        await writeFileReplacing(document.resolvedPath, (document.encoding === 'utf8-bom' ? '﻿' : '') + payload.xml);
        previewRefreshed = await this.refreshIfOpen(document.resolvedPath);
      }
      return this.success(id, {
        path: document.resolvedPath,
        result: payload.result,
        ...(readOnly ? {} : { previewRefreshed }),
      });
    }

    if (rawName === 'edit_template' || rawName === 'list_markup' || rawName === 'validate_template') {
      if (rawName === 'edit_template' && !this.options.templateEditTools) {
        throw new Error('Template editing tools are disabled for this server (--no-template-edit-tools).');
      }
      const target = await this.resolveAuthoringPath(argString('path'), '.xml', true);
      const document = await this.loader.load(target);
      const editActions: Record<string, string> = {
        set_area: 'setArea', set_parameter: 'setParameter', set_format: 'setFormat',
        insert_rows: 'insertRows', delete_rows: 'deleteRows',
        insert_columns: 'insertColumns', delete_columns: 'deleteColumns',
        merge_cells: 'mergeCells', set_size: 'setSize',
        set_print_settings: 'setPrintSettings', set_header_footer: 'setHeaderFooter',
      };
      let action: string;
      if (rawName === 'edit_template') {
        action = editActions[argString('operation')] || '';
        if (!action) {
          throw new Error('operation must be one of set_area, set_parameter, set_format, insert_rows, delete_rows, insert_columns, delete_columns, merge_cells, set_size, set_print_settings, set_header_footer.');
        }
      } else {
        action = rawName === 'list_markup' ? 'list' : 'validate';
      }
      const readOnly = action === 'list' || action === 'validate';
      let payload: { xml: string; result: unknown };
      if (action === 'list') {
        payload = { xml: document.content, result: (TemplateMarkup.listMarkup as (xml: string) => unknown)(document.content) };
      } else if (action === 'validate') {
        payload = { xml: document.content, result: (TemplateMarkup.validateTemplate as (xml: string) => unknown)(document.content) };
      } else {
        const params: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(args)) {
          if (key === 'path' || key === 'operation') continue;
          params[camelize(key)] = value;
        }
        /* Nested objects (print_area) keep the tool's snake_case keys. */
        if (params.printArea && typeof params.printArea === 'object') {
          const area: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(params.printArea as Record<string, unknown>)) {
            area[camelize(key)] = value;
          }
          params.printArea = area;
        }
        const transform = TemplateMarkup[action] as (xml: string, params: Record<string, unknown>) => { xml: string; result: unknown };
        if (typeof transform !== 'function') throw new Error(`Unknown markup action: ${action}`);
        payload = transform(document.content, params);
      }
      let previewRefreshed = false;
      if (!readOnly) {
        await writeFileReplacing(document.resolvedPath, payload.xml);
        previewRefreshed = await this.refreshIfOpen(document.resolvedPath);
      }
      return this.success(id, {
        path: document.resolvedPath,
        result: payload.result,
        ...(readOnly ? {} : { previewRefreshed }),
      });
    }

    if (rawName === 'convert_xlsx_to_template') {
      const xlsx = await this.resolveAuthoringPath(argString('xlsx_path'), '.xlsx', true);
      const output = await this.resolveAuthoringPath(argString('output_path'), '.xml', false);
      const exists = await fs.stat(output).then(() => true, () => false);
      if (exists && !argBool('overwrite')) {
        throw new Error(`The output file already exists: ${output}. Pass overwrite=true to replace it.`);
      }
      const bytes = await fs.readFile(xlsx);
      if (bytes.length > MAX_BYTES) throw new Error(`File is too large: ${xlsx}`);
      const { xml, summary } = await XlsxTemplate.convert(bytes.toString('base64'), { sheet: argString('sheet') || undefined });
      await writeFileReplacing(output, xml);
      /* Show the freshly written template the way open_preview does by default. */
      let previewId = '';
      let previewUrl = '';
      try {
        const opened = await this.callTool(id, 'open_preview', { path: output, audience: 'agent' }) as { result?: { structuredContent?: { previewId?: string; previewUrl?: string } } };
        previewId = opened.result?.structuredContent?.previewId || '';
        previewUrl = opened.result?.structuredContent?.previewUrl || '';
      } catch {
        /* The template is written; the preview is a convenience. */
      }
      const value = { outputPath: output, previewId, previewUrl, summary };
      const message = `Макет записан: ${output} и открыт в скрытом превью (capture_preview — снимок).\n${JSON.stringify(summary)}`;
      return this.success(id, value, undefined, message);
    }

    throw new Error(`Unknown tool: ${rawName}`);
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const assetsDir = process.env.ONE_C_FORM_VIEWER_ASSETS || path.join(packageDir, 'build', 'web');
  const server = new NodeMcpServer(options, assetsDir);
  await server.run();
  /* The client closed stdin: go away even if a handle (a browser that failed
   * to close, a pending fetch) would otherwise keep the event loop alive. */
  process.exit(0);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
