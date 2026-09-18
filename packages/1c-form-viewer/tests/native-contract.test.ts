import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import '1c-preview-core/browser/form-context.js';
import { contextCacheEntry } from '../src/files.js';

const FormContext = (globalThis as unknown as { FormContext: { TEXT_FILTERS: string[]; filterText(text: string, filter: string): string } }).FormContext;

const TOOL_NAMES = [
  'open_preview', 'preview', 'capture_preview',
  'convert_xlsx_to_template', 'list_markup', 'validate_template',
  'edit_template',
  'list_form_elements', 'validate_form',
  'edit_form',
] as const;

/* Tools that write files; everything else must stay read-only. */
const AUTHORING_TOOLS = new Set(['convert_xlsx_to_template', 'edit_template', 'edit_form']);
const PREVIEW_TOOLS = new Set(['preview', 'capture_preview']);

/* The native server speaks the protocol by hand instead of going through the
 * SDK, so nothing but a real round trip proves its replies parse. It shipped a
 * stray closing brace that made every successful tools/call malformed while
 * tools/list and the error path stayed valid, which is exactly the shape of bug
 * a schema-only check misses. Skipped when the binary has not been built. */
const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repositoryDir = path.resolve(packageDir, '..', '..');

function nativeExecutable(): string | null {
  const configured = process.env.NATIVE_MCP_EXE;
  const candidate = configured
    ? path.resolve(repositoryDir, configured)
    : path.join(repositoryDir, 'artifacts', '1c-form-viewer-native-win-x64', '1c-form-viewer.exe');
  return existsSync(candidate) ? candidate : null;
}

class NativeClient {
  private nextId = 1;
  private readonly pending = new Map<number, (value: Record<string, unknown>) => void>();

  private constructor(private readonly child: ChildProcessWithoutNullStreams) {}

  static start(executable: string, args: string[]): NativeClient {
    const child = spawn(executable, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const client = new NativeClient(child);
    createInterface({ input: child.stdout }).on('line', (line) => client.accept(line));
    return client;
  }

  private accept(line: string): void {
    if (!line.trim()) return;
    /* Deliberately strict: a malformed reply must fail the test, not be skipped. */
    const message = JSON.parse(line) as { id?: number };
    const resolve = typeof message.id === 'number' ? this.pending.get(message.id) : undefined;
    if (resolve) {
      this.pending.delete(message.id as number);
      resolve(message as Record<string, unknown>);
    }
  }

  get pid(): number | undefined { return this.child.pid; }

  send(method: string, params?: Record<string, unknown>, timeout = 10_000): Promise<Record<string, unknown>> {
    const id = this.nextId++;
    const promise = new Promise<Record<string, unknown>>((resolve, reject) => {
      this.pending.set(id, resolve);
      setTimeout(() => reject(new Error(`${method} timed out`)), timeout).unref();
    });
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    return promise;
  }

  async stop(): Promise<void> {
    if (this.child.exitCode !== null) return;
    const closed = new Promise<void>((resolve) => this.child.once('close', () => resolve()));
    this.child.stdin.end();
    await Promise.race([
      closed,
      new Promise<void>((resolve) => setTimeout(resolve, 1_000)),
    ]);
    if (this.child.exitCode === null) {
      this.child.kill();
      await closed;
    }
  }
}

test('the native server answers initialize, tools/list and a successful tools/call with parseable JSON', async (t) => {
  const executable = nativeExecutable();
  if (!executable) {
    t.skip('native binary not built; run npm run build:native or set NATIVE_MCP_EXE');
    return;
  }
  const client = NativeClient.start(executable, ['--stdio', '--root', repositoryDir]);
  t.after(() => client.stop());

  const initialized = await client.send('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'native-contract-test', version: '1.0.0' },
  });
  const initialization = initialized.result as { instructions: string; serverInfo: { name: string; version: string } };
  const serverInfo = initialization.serverInfo;
  assert.match(serverInfo.version, /^\d+\.\d+\.\d+/);
  assert.match(initialization.instructions, /visual inspection of 1C form layouts/);
  assert.match(initialization.instructions, /instead of opening XML source or launching 1C/);
  assert.match(initialization.instructions, /визуального просмотра макетов форм 1С/);

  assert.match(initialization.instructions, /edit_template/, 'the editing tool is described when enabled');
  const listed = await client.send('tools/list', {});
  const tools = (listed.result as { tools: Array<{ name: string; description?: string; inputSchema: { type: string }; outputSchema?: { type: string } }> }).tools;
  assert.deepEqual(tools.map((tool) => tool.name), [...TOOL_NAMES]);
  for (const tool of tools) {
    assert.equal(tool.inputSchema.type, 'object');
    assert.match(tool.description || '', /1C/);
    const hints = (tool as { annotations?: { readOnlyHint?: boolean } }).annotations;
    assert.equal(hints?.readOnlyHint, !AUTHORING_TOOLS.has(tool.name), `${tool.name} readOnlyHint`);
  }
  const openPreview = tools.find((tool) => tool.name === 'open_preview');
  assert.equal(openPreview?.outputSchema?.type, 'object');
  assert.match(openPreview?.description || '', /show a 1C form visually/);
  assert.match(openPreview?.description || '', /покажи форму/);
  assert.match(openPreview?.description || '', /do not show XML source/i);
  assert.match(openPreview?.description || '', /Ext\/Form\.xml/);
  assert.match(openPreview?.description || '', /hidden browser the user never sees/);
  assert.match(openPreview?.description || '', /own preview_id and URL/);
  const openSchema = openPreview?.inputSchema as { properties?: Record<string, { type: string; enum?: string[] }>; required?: string[] };
  assert.deepEqual(openSchema.properties?.audience?.enum, ['user', 'agent']);
  assert.deepEqual(openSchema.required, ['path', 'audience'], 'the agent must decide who the preview is for');
  assert.equal(openSchema.properties?.show?.type, 'boolean');
  for (const tool of tools.filter((item) => PREVIEW_TOOLS.has(item.name))) {
    const properties = (tool.inputSchema as { properties?: Record<string, unknown> }).properties;
    assert.ok(properties?.preview_id, `${tool.name} takes preview_id`);
  }

  /* preview(close) on a server that never started is a no-op, so this exercises
   * the success envelope without opening a browser window. */
  const closed = await client.send('tools/call', { name: 'preview', arguments: { operation: 'close' } });
  const result = closed.result as { isError?: boolean; content: Array<{ type: string; text: string }> };
  assert.notEqual(result.isError, true);
  assert.equal(result.content[0].type, 'text');
  assert.deepEqual(JSON.parse(result.content[0].text), { closed: true });

  const failed = await client.send('tools/call', { name: 'open_preview', arguments: {} });
  assert.equal((failed.result as { isError: boolean }).isError, true);
});

test('the native open_preview resolves a form descriptor and returns an explicitly visual result', async (t) => {
  const executable = nativeExecutable();
  if (!executable) {
    t.skip('native binary not built; run npm run build:native or set NATIVE_MCP_EXE');
    return;
  }

  const base = await fs.mkdtemp(path.join(os.tmpdir(), '1c-native-descriptor-'));
  const allowedRoot = path.join(base, 'configuration');
  const forms = path.join(allowedRoot, 'Documents', 'Sale', 'Forms');
  const descriptor = path.join(forms, 'ФормаДокумента.xml');
  const layout = path.join(forms, 'ФормаДокумента', 'Ext', 'Form.xml');
  const outside = path.join(base, 'outside', 'Form.xml');
  const escapedDescriptor = path.join(forms, 'ВнешняяФорма.xml');
  const escapedFormDirectory = path.join(base, 'escaped-form');
  const escapedLayout = path.join(escapedFormDirectory, 'Ext', 'Form.xml');
  const pictureExt = path.join(allowedRoot, 'CommonPictures', 'RefreshCustom', 'Ext');
  await fs.mkdir(path.dirname(layout), { recursive: true });
  await fs.mkdir(path.dirname(outside), { recursive: true });
  await fs.mkdir(path.dirname(escapedLayout), { recursive: true });
  await fs.mkdir(path.join(pictureExt, 'Picture'), { recursive: true });
  await fs.writeFile(descriptor, '<MetaDataObject/>');
  await fs.writeFile(layout, '<Form xmlns="http://v8.1c.ru/8.3/xcf/logform"><Picture><xr:Ref>CommonPicture.RefreshCustom</xr:Ref></Picture></Form>');
  await fs.writeFile(path.join(pictureExt, 'Picture.xml'),
    '<ExtPicture><Picture><xr:Abs>Picture.png</xr:Abs></Picture></ExtPicture>');
  await fs.writeFile(path.join(pictureExt, 'Picture', 'Picture.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  await fs.writeFile(outside, '<Form xmlns="http://v8.1c.ru/8.3/xcf/logform"/>');
  await fs.writeFile(escapedDescriptor, '<MetaDataObject/>');
  await fs.writeFile(escapedLayout, '<Form xmlns="http://v8.1c.ru/8.3/xcf/logform"/>');
  await fs.symlink(escapedFormDirectory, path.join(forms, 'ВнешняяФорма'),
    process.platform === 'win32' ? 'junction' : 'dir');

  const cacheDir = path.join(base, 'context-cache');
  process.env.ONE_C_FORM_VIEWER_CONTEXT_CACHE = cacheDir;
  const client = NativeClient.start(executable, [
    '--stdio', '--no-open-browser', '--root', allowedRoot,
  ]);
  t.after(async () => {
    await client.stop();
    await fs.rm(base, { recursive: true, force: true });
  });

  const opened = await client.send('tools/call', {
    name: 'open_preview', arguments: { path: descriptor },
  });
  const result = opened.result as {
    isError?: boolean;
    content: Array<{ type: string; text: string }>;
    structuredContent: Record<string, unknown>;
  };
  assert.notEqual(result.isError, true);
  assert.equal(result.structuredContent.requestedPath, await fs.realpath(descriptor));
  assert.equal(result.structuredContent.resolvedPath, await fs.realpath(layout));
  assert.equal(result.structuredContent.path, await fs.realpath(layout));
  assert.equal(result.structuredContent.kind, 'managed-form');
  assert.match(String(result.structuredContent.previewUrl), /^http:\/\/127\.0\.0\.1:/);
  const stateResponse = await fetch(new URL('state.json', String(result.structuredContent.previewUrl)));
  const previewState = await stateResponse.json() as { resolveContext?: boolean };
  /* The repository's default artifact may be held open by the user's active
   * MCP process and therefore intentionally stale. An explicitly supplied
   * candidate is the build under test: its page resolves the form context
   * with the shared form-context.js through context-file, limited to --root. */
  if (process.env.NATIVE_MCP_EXE) {
    assert.equal(previewState.resolveContext, true);
    const contextFile = (filePath: string, exists = false) => fetch(new URL(
      `context-file?p=${encodeURIComponent(filePath)}${exists ? '&exists=1' : ''}`,
      String(result.structuredContent.previewUrl)));
    const picture = await contextFile(path.join(pictureExt, 'Picture', 'Picture.png'));
    assert.equal(picture.status, 200);
    assert.deepEqual(new Uint8Array(await picture.arrayBuffer()), Uint8Array.from([0x89, 0x50, 0x4e, 0x47]));
    assert.equal(await (await contextFile(path.join(pictureExt, 'Picture.xml'), true)).text(), '1');
    assert.equal(await (await contextFile(outside, true)).text(), '0');
    assert.equal(await (await contextFile(path.join(pictureExt, 'Missing.xml'), true)).text(), '0');
    assert.equal((await contextFile(outside)).status, 404);

    /* The batched endpoint: same access policy, and the native text filters
     * are byte-for-byte the reference ones in form-context.js. */
    const batch = (lines: string[]) => fetch(new URL('context-batch', String(result.structuredContent.previewUrl)), {
      method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body: lines.join('\n'),
    });
    const pictureXml = path.join(pictureExt, 'Picture.xml');
    assert.equal(await (await batch(['exists', pictureXml, outside, path.join(pictureExt, 'Missing.xml')])).text(), '100');
    const stamps = (await (await batch(['stat', pictureXml, outside])).text()).split('\n');
    const pictureStat = await fs.stat(pictureXml);
    assert.deepEqual(stamps, [`${pictureStat.size}:${Math.floor(pictureStat.mtimeMs)}`, '']);

    const tricky = path.join(allowedRoot, 'Catalogs', 'Tricky.xml');
    const trickyText = '\ufeff<MetaDataObject><Catalog><Commands/><CommandParameterType/>'
      + '<Command uuid="1"><Name>Первая</Name><Group>FormCommandBarImportant</Group></Command>'
      + '<COMMAND><Name>Upper</Name></command><Command_x/><Command>unterminated'
      + '<Metadata name="CommonCommand.A"/><Metadata\n\tname="Catalog.X.Command.Y" id="1"/>'
      + '<Metadata name="Catalog.X"/><Metadataname="CommonCommand.B"/></Catalog></MetaDataObject>';
    await fs.mkdir(path.dirname(tricky), { recursive: true });
    await fs.writeFile(tricky, trickyText, 'utf8');
    for (const filter of FormContext.TEXT_FILTERS) {
      const response = await batch(['read', '0', filter, tricky, outside]);
      const buffer = Buffer.from(await response.arrayBuffer());
      const length = buffer.readInt32LE(0);
      const native = new TextDecoder('utf-8').decode(buffer.subarray(4, 4 + length));
      assert.equal(native, FormContext.filterText(trickyText, filter), filter);
      assert.equal(buffer.readInt32LE(4 + length), -1);
    }
    const limited = Buffer.from(await (await batch(['read', '3', '', pictureXml])).arrayBuffer());
    assert.equal(limited.readInt32LE(0), -1);

    assert.equal((await batch(['cache-get', allowedRoot, 'k'])).status, 404);
    assert.equal((await batch(['cache-put', allowedRoot, 'k', 'line1\nline2'])).status, 204);
    assert.equal(await (await batch(['cache-get', allowedRoot, 'k'])).text(), 'line1\nline2');
    assert.equal((await batch(['cache-put', path.dirname(outside), 'k', 'x'])).status, 204);
    assert.equal((await batch(['cache-get', path.dirname(outside), 'k'])).status, 404);
    const entry = contextCacheEntry(allowedRoot, 'k');
    assert.equal(await fs.readFile(path.join(cacheDir, entry.name), 'utf8'), `${entry.header}line1\nline2`);
  }
  assert.match(result.content[0].text, /Визуальное представление открыто/);
  assert.match(result.content[0].text, /Фактический макет/);
  assert.doesNotMatch(result.content[0].text, /<Form|MetaDataObject/);

  const openedDirectly = await client.send('tools/call', {
    name: 'open_preview', arguments: { path: layout },
  });
  const direct = (openedDirectly.result as { structuredContent: Record<string, unknown> }).structuredContent;
  assert.equal(direct.requestedPath, await fs.realpath(layout));
  assert.equal(direct.resolvedPath, await fs.realpath(layout));

  const denied = await client.send('tools/call', {
    name: 'open_preview', arguments: { path: outside },
  });
  const denial = denied.result as { isError: boolean; content: Array<{ text: string }> };
  assert.equal(denial.isError, true);
  assert.match(denial.content[0].text, /1cFormViewer\.mcp\.additionalRoots/);
  assert.match(denial.content[0].text, /--root PATH/);

  const escaped = await client.send('tools/call', {
    name: 'open_preview', arguments: { path: escapedDescriptor },
  });
  const escapeResult = escaped.result as { isError: boolean; content: Array<{ text: string }> };
  assert.equal(escapeResult.isError, true);
  assert.match(escapeResult.content[0].text, /outside the allowed roots/);

  await client.send('tools/call', { name: 'preview', arguments: { operation: 'close' } });
});

/* The authoring loop an agent runs on a print form: xlsx → Template.xml → areas
 * and parameters → refreshed preview. Needs the hidden renderer, so it runs
 * only against an explicitly supplied candidate build. The workbook is written
 * here from XML so no binary fixture lives in the repository. */
test('the native authoring tools convert an xlsx, mark it up and refresh the preview', async (t) => {
  const executable = nativeExecutable();
  if (!executable || !process.env.NATIVE_MCP_EXE) {
    t.skip('set NATIVE_MCP_EXE to the candidate build to run the authoring check');
    return;
  }
  const base = await fs.mkdtemp(path.join(os.tmpdir(), '1c-native-authoring-'));
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), '1c-native-outside-'));
  const client = NativeClient.start(executable, ['--stdio', '--root', base]);
  t.after(async () => {
    await client.send('tools/call', { name: 'preview', arguments: { operation: 'close' } }).catch(() => undefined);
    await client.stop();
    await fs.rm(base, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  });

  const xlsx = path.join(base, 'Акт.xlsx');
  await fs.writeFile(xlsx, storedZip({
    'xl/workbook.xml': '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Лист1" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>АКТ № 15</t></is></c></row><row r="2"><c r="B2" t="inlineStr"><is><t>[Сумма]</t></is></c></row></sheetData></worksheet>',
  }));
  const output = path.join(base, 'Templates', 'Акт', 'Ext', 'Template.xml');
  const call = async (name: string, args: Record<string, unknown>) => {
    const reply = await client.send('tools/call', { name, arguments: args }, 60_000);
    return reply.result as { isError?: boolean; content: Array<{ type: string; text?: string; data?: string }>; structuredContent: Record<string, any> };
  };

  const converted = await call('convert_xlsx_to_template', { xlsx_path: xlsx, output_path: output });
  assert.notEqual(converted.isError, true, converted.content[0]?.text);
  assert.deepEqual(converted.structuredContent.summary.parameters, ['Сумма']);
  assert.equal(existsSync(output), true);
  assert.match(converted.content[0].text || '', /Макет записан/);

  const again = await call('convert_xlsx_to_template', { xlsx_path: xlsx, output_path: output });
  assert.equal(again.isError, true, 'an existing template is not replaced without overwrite');
  const escaped = await call('convert_xlsx_to_template', { xlsx_path: xlsx, output_path: path.join(outside, 'Template.xml') });
  assert.equal(escaped.isError, true, 'writes stay inside the allowed roots');
  assert.match(escaped.content[0].text || '', /outside the allowed roots/);

  const before = await call('capture_preview', {});
  assert.notEqual(before.isError, true, before.content[0]?.text);

  const area = await call('edit_template', { path: output, operation: 'set_area', name: 'Шапка', begin_row: 1, end_row: 1 });
  assert.notEqual(area.isError, true, area.content[0]?.text);
  assert.equal(area.structuredContent.previewRefreshed, true);
  const parameter = await call('edit_template', { path: output, operation: 'set_parameter', row: 1, column: 1, template: 'АКТ № [Номер]' });
  assert.notEqual(parameter.isError, true, parameter.content[0]?.text);
  const bad = await call('edit_template', { path: output, operation: 'set_parameter', row: 1, column: 1 });
  assert.equal(bad.isError, true);

  const listed = await call('list_markup', { path: output });
  assert.deepEqual(listed.structuredContent.result.areas, [{ name: "Шапка", type: "Rows", beginRow: 1, endRow: 1, parameters: ["Номер"] }]);
  assert.deepEqual(listed.structuredContent.result.parameters, [{ row: 2, column: 2, name: 'Сумма' }]);
  assert.deepEqual(listed.structuredContent.result.templates, [{ row: 1, column: 1, text: 'АКТ № [Номер]', names: ['Номер'], areas: ['Шапка'] }]);

  const grid = await call('edit_template', { path: output, operation: 'insert_rows', at: 1, count: 2 });
  assert.notEqual(grid.isError, true, grid.content[0]?.text);
  assert.equal(grid.structuredContent.result.rows, 4);
  const merged = await call('edit_template', { path: output, operation: 'merge_cells', row: 3, column: 1, columns: 2 });
  assert.notEqual(merged.isError, true, merged.content[0]?.text);
  const sized = await call('edit_template', { path: output, operation: 'set_size', column: 1, width: 120 });
  const styled = await call('edit_template', { path: output, operation: 'set_format', row: 3, column: 1, font: { bold: true }, back_color: '#EEEEEE', bottom_border: { style: 'Solid', width: 2 }, format: 'ЧДЦ=2' });
  assert.notEqual(styled.isError, true, styled.content[0]?.text);
  assert.equal(styled.structuredContent.result.cells, 1);
  const printed = await call('edit_template', { path: output, operation: 'set_print_settings', orientation: 'Landscape', top_margin: 10, print_area: { begin_row: 1, end_row: 4 } });
  assert.notEqual(printed.isError, true, printed.content[0]?.text);
  assert.deepEqual(printed.structuredContent.result.printArea, { beginRow: 1, endRow: 4 });
  const footer = await call('edit_template', { path: output, operation: 'set_header_footer', kind: 'footer', right: '[&НомерСтраницы]' });
  assert.notEqual(footer.isError, true, footer.content[0]?.text);
  const detailed = await call('edit_template', { path: output, operation: 'set_parameter', row: 4, column: 2, detail: 'Документ' });
  assert.notEqual(detailed.isError, true, detailed.content[0]?.text);
  assert.notEqual(sized.isError, true, sized.content[0]?.text);
  const badGrid = await call('edit_template', { path: output, operation: 'shuffle', at: 1 });
  assert.equal(badGrid.isError, true);
  const moved = await call('list_markup', { path: output });
  assert.deepEqual(moved.structuredContent.result.areas.map((a: { name: string; beginRow: number }) => [a.name, a.beginRow]), [['Шапка', 3]], 'the area moved down with the insert');
  const checked = await call('validate_template', { path: output });
  assert.equal(checked.structuredContent.result.ok, true, JSON.stringify(checked.structuredContent.result.errors));

  const after = await call('capture_preview', {});
  const image = (reply: typeof after) => reply.content.find((item) => item.type === 'image')?.data;
  assert.ok(image(after));
  assert.notEqual(image(after), image(before), 'the preview shows the markup change');
});

/* --no-template-edit-tools keeps preview, xlsx conversion and reading a
 * template's markup, and hides every tool that edits a template. */
test('the native server hides the template editing tools with --no-template-edit-tools', async (t) => {
  const executable = nativeExecutable();
  if (!executable) {
    t.skip('native binary not built; run npm run build:native or set NATIVE_MCP_EXE');
    return;
  }
  const client = NativeClient.start(executable, ['--stdio', '--root', repositoryDir, '--no-template-edit-tools']);
  t.after(() => client.stop());
  const initialized = await client.send('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } });
  const instructions = (initialized.result as { instructions: string }).instructions;
  assert.match(instructions, /convert_xlsx_to_template/);
  assert.doesNotMatch(instructions, /edit_template/);
  const listed = await client.send('tools/list', {});
  const names = (listed.result as { tools: Array<{ name: string }> }).tools.map((tool) => tool.name);
  assert.deepEqual(names, TOOL_NAMES.filter((name) => name !== 'edit_template'));
  const refused = await client.send('tools/call', { name: 'edit_template', arguments: { path: 'x.xml', operation: 'merge_cells', row: 1, column: 1, columns: 2 } });
  const result = refused.result as { isError?: boolean; content: Array<{ text: string }> };
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /disabled/);
});

/* The form editing loop: list items, change a property, move and remove an
 * item, validate. The file keeps its BOM and CRLF, and everything outside the
 * touched nodes stays as it was. Needs the hidden renderer (the shared module
 * runs in the page), so it runs only against a supplied candidate build. */
test('the native form tools list, edit and validate a managed form', async (t) => {
  const executable = nativeExecutable();
  if (!executable || !process.env.NATIVE_MCP_EXE) {
    t.skip('set NATIVE_MCP_EXE to the candidate build to run the form editing check');
    return;
  }
  const base = await fs.mkdtemp(path.join(os.tmpdir(), '1c-native-form-'));
  const client = NativeClient.start(executable, ['--stdio', '--root', base]);
  t.after(async () => {
    await client.stop();
    await fs.rm(base, { recursive: true, force: true });
  });
  const descriptor = path.join(base, 'Forms', 'ФормаЭлемента.xml');
  const formXml = path.join(base, 'Forms', 'ФормаЭлемента', 'Ext', 'Form.xml');
  await fs.mkdir(path.dirname(formXml), { recursive: true });
  await fs.writeFile(descriptor, '<MetaDataObject/>');
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Form xmlns="http://v8.1c.ru/8.3/xcf/logform" xmlns:cfg="http://v8.1c.ru/8.1/data/enterprise/current-config" xmlns:v8="http://v8.1c.ru/8.1/data/core" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" version="2.20">',
    '	<AutoCommandBar name="ФормаКоманднаяПанель" id="-1"/>',
    '	<ChildItems>',
    '		<UsualGroup name="Шапка" id="1">',
    '			<ExtendedTooltip name="ШапкаРасширеннаяПодсказка" id="2"/>',
    '			<ChildItems>',
    '				<InputField name="Код" id="3">',
    '					<DataPath>Объект.Code</DataPath>',
    '					<ContextMenu name="КодКонтекстноеМеню" id="4"/>',
    '					<ExtendedTooltip name="КодРасширеннаяПодсказка" id="5"/>',
    '				</InputField>',
    '			</ChildItems>',
    '		</UsualGroup>',
    '		<InputField name="Наименование" id="6">',
    '			<DataPath>Объект.Description</DataPath>',
    '			<ContextMenu name="НаименованиеКонтекстноеМеню" id="7"/>',
    '			<ExtendedTooltip name="НаименованиеРасширеннаяПодсказка" id="8"/>',
    '		</InputField>',
    '	</ChildItems>',
    '	<Attributes>',
    '		<Attribute name="Объект" id="1">',
    '			<Type>',
    '				<v8:Type>cfg:CatalogObject.Товары</v8:Type>',
    '			</Type>',
    '			<MainAttribute>true</MainAttribute>',
    '		</Attribute>',
    '	</Attributes>',
    '</Form>',
  ];
  const original = '﻿' + lines.join('\r\n');
  await fs.writeFile(formXml, original, 'utf8');
  const call = async (name: string, args: Record<string, unknown>) => {
    const reply = await client.send('tools/call', { name, arguments: args }, 60_000);
    return reply.result as { isError?: boolean; content: Array<{ type: string; text?: string }>; structuredContent: Record<string, any> };
  };

  const listed = await call('list_form_elements', { path: descriptor });
  assert.notEqual(listed.isError, true, listed.content[0]?.text);
  assert.equal(listed.structuredContent.path, formXml, 'the descriptor resolves to Ext/Form.xml');
  assert.deepEqual(listed.structuredContent.result.elements.map((e: { name: string }) => e.name), ['Шапка', 'Код', 'Наименование']);

  const titled = await call('edit_form', { path: formXml, operation: 'set_properties', element: 'Код', properties: { Title: 'Артикул', Width: 10 } });
  assert.notEqual(titled.isError, true, titled.content[0]?.text);
  assert.deepEqual(titled.structuredContent.result.changed, ['Title', 'Width']);
  const reset = await call('edit_form', { path: formXml, operation: 'set_properties', element: 'Код', properties: { Title: null, Width: null } });
  assert.notEqual(reset.isError, true, reset.content[0]?.text);
  assert.equal(await fs.readFile(formXml, 'utf8'), original, 'resetting the properties restores the file byte for byte');

  const moved = await call('edit_form', { path: formXml, operation: 'move_element', element: 'Наименование', into: 'Шапка', after: 'Код' });
  assert.notEqual(moved.isError, true, moved.content[0]?.text);
  const bad = await call('edit_form', { path: formXml, operation: 'move_element', element: 'Шапка', into: 'Шапка' });
  assert.equal(bad.isError, true, 'a group does not move into itself');
  const added = await call('edit_form', { path: formXml, operation: 'add_element', element: 'Комментарий', kind: 'InputField', into: 'Шапка', properties: { DataPath: 'Объект.Comment', Title: 'Комментарий' } });
  assert.notEqual(added.isError, true, added.content[0]?.text);
  assert.deepEqual(added.structuredContent.result.companions, ['КомментарийКонтекстноеМеню', 'КомментарийРасширеннаяПодсказка']);
  const attribute = await call('edit_form', { path: formXml, operation: 'set_attribute', name: 'СуммаИтого', type: 'number(15,2,nonnegative)', title: { ru: 'Итого', en: 'Total' } });
  assert.notEqual(attribute.isError, true, attribute.content[0]?.text);
  const command = await call('edit_form', { path: formXml, operation: 'set_command', name: 'Пересчитать', action: 'ПересчитатьКоманда', title: 'Пересчитать' });
  assert.notEqual(command.isError, true, command.content[0]?.text);
  const button = await call('edit_form', { path: formXml, operation: 'add_element', element: 'КнопкаПересчитать', kind: 'Button', into: 'ФормаКоманднаяПанель', properties: { CommandName: 'Form.Command.Пересчитать' } });
  assert.notEqual(button.isError, true, button.content[0]?.text);
  assert.equal(button.structuredContent.result.warnings, undefined, 'the command exists by now');
  const badType = await call('edit_form', { path: formXml, operation: 'set_attribute', name: 'Плохой', type: 'строкаЧего' });
  assert.equal(badType.isError, true);

  const removed = await call('edit_form', { path: formXml, operation: 'remove_element', element: 'Код' });
  assert.notEqual(removed.isError, true, removed.content[0]?.text);
  assert.equal(removed.structuredContent.result.removedNodes, 3);

  const written = await fs.readFile(formXml);
  assert.deepEqual([...written.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'the byte order mark is kept');
  assert.doesNotMatch(written.toString('utf8').replace(/\r\n/g, ''), /\n/, 'line endings stay CRLF');
  const checked = await call('validate_form', { path: formXml });
  assert.notEqual(checked.isError, true, checked.content[0]?.text);
  assert.equal(checked.structuredContent.result.ok, true, JSON.stringify(checked.structuredContent.result.errors));
});

/* A ZIP with stored (uncompressed) entries: enough for the converter. */
function storedZip(files: Record<string, string>): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc32 = (data: Buffer) => {
    let crc = 0xffffffff;
    for (const byte of data) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  };
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text, 'utf8');
    const nameBytes = Buffer.from(name, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc32(data), 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc32(data), 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, data);
    centrals.push(central, nameBytes);
    offset += local.length + nameBytes.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

/* The default mode must never put a window in front of the user, yet capture
 * has to work. Runs a real headless Edge/Chrome, so only against an explicitly
 * supplied candidate build (the default artifact may be held by a live MCP). */
test('the native open_preview renders hidden by default and capture_preview still returns a PNG', async (t) => {
  const executable = nativeExecutable();
  if (!executable || !process.env.NATIVE_MCP_EXE) {
    t.skip('set NATIVE_MCP_EXE to the candidate build to run the headless capture check');
    return;
  }
  const base = await fs.mkdtemp(path.join(os.tmpdir(), '1c-native-headless-'));
  const layout = path.join(base, 'Form.xml');
  await fs.writeFile(layout, '<Form xmlns="http://v8.1c.ru/8.3/xcf/logform"/>');
  const client = NativeClient.start(executable, ['--stdio', '--root', base]);
  const profile = path.join(os.tmpdir(), `1c-form-viewer-headless-${client.pid}`);
  t.after(async () => {
    await client.stop();
    await fs.rm(base, { recursive: true, force: true });
  });

  const opened = await client.send('tools/call', { name: 'open_preview', arguments: { path: layout } });
  const result = opened.result as { isError?: boolean; content: Array<{ text: string }>; structuredContent: Record<string, unknown> };
  assert.notEqual(result.isError, true);
  if (result.structuredContent.presentation === 'unavailable') {
    t.skip('neither Microsoft Edge nor Google Chrome is installed');
    return;
  }
  assert.equal(result.structuredContent.presentation, 'hidden');
  assert.match(result.content[0].text, /скрытом браузере/);
  assert.equal(existsSync(profile), true, 'the hidden browser runs on its own profile');

  const captured = await client.send('tools/call', { name: 'capture_preview', arguments: { scope: 'viewport' } }, 60_000);
  const capture = captured.result as { isError?: boolean; content: Array<{ type: string; text?: string; data?: string; mimeType?: string }> };
  assert.notEqual(capture.isError, true, capture.content[0]?.text);
  const image = capture.content.find((item) => item.type === 'image');
  assert.equal(image?.mimeType, 'image/png');
  const png = Buffer.from(image?.data || '', 'base64');
  assert.deepEqual([...png.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
  /* 1280px window minus the visible vertical scrollbar the viewer keeps. */
  assert.ok(png.readUInt32BE(16) > 1200 && png.readUInt32BE(16) <= 1280, `hidden viewport width ${png.readUInt32BE(16)}`);

  /* One tool for the whole session: every operation reaches its handler, and a
   * second preview moves the hidden renderer while the first one still answers
   * when targeted by preview_id. */
  const preview = async (args: Record<string, unknown>) => {
    const reply = await client.send('tools/call', { name: 'preview', arguments: args }, 60_000);
    return reply.result as { isError?: boolean; content: Array<{ text?: string }>; structuredContent: Record<string, any> };
  };
  const inspected = await preview({ operation: 'inspect' });
  assert.notEqual(inspected.isError, true, inspected.content[0]?.text);
  assert.ok(Array.isArray(inspected.structuredContent.elements), 'inspect returns the element list');
  for (const operation of ['scroll', 'reload', 'url']) {
    const reply = await preview(operation === 'scroll' ? { operation, target: 'document', delta_y: 40 } : { operation });
    assert.notEqual(reply.isError, true, `${operation}: ${reply.content[0]?.text}`);
  }
  const unknown = await preview({ operation: 'zoom' });
  assert.equal(unknown.isError, true);
  assert.match(unknown.content[0]?.text || '', /operation must be one of/);

  const second = path.join(base, 'Second', 'Form.xml');
  await fs.mkdir(path.dirname(second), { recursive: true });
  await fs.writeFile(second, '<Form xmlns="http://v8.1c.ru/8.3/xcf/logform"/>');
  const openedSecond = await client.send('tools/call', { name: 'open_preview', arguments: { path: second, audience: 'agent' } });
  const secondId = (openedSecond.result as { structuredContent: Record<string, unknown> }).structuredContent.previewId;
  assert.notEqual(secondId, result.structuredContent.previewId);
  for (const previewId of [result.structuredContent.previewId, secondId]) {
    const state = await preview({ operation: 'inspect', preview_id: previewId });
    assert.notEqual(state.isError, true, `inspect ${previewId}`);
  }

  await client.send('tools/call', { name: 'preview', arguments: { operation: 'close' } });
  assert.equal(existsSync(profile), false, 'preview(close) stops the hidden browser and removes its profile');
});

/* Several files stay open side by side, each on its own link. Needs no browser:
 * with --no-open-browser the client presents the pages. */
test('the native server keeps several previews open, each with its own preview_id and URL', async (t) => {
  const executable = nativeExecutable();
  if (!executable || !process.env.NATIVE_MCP_EXE) {
    t.skip('set NATIVE_MCP_EXE to the candidate build to run the multi-preview check');
    return;
  }
  const base = await fs.mkdtemp(path.join(os.tmpdir(), '1c-native-multi-'));
  const first = path.join(base, 'A', 'Ext', 'Form.xml');
  const second = path.join(base, 'B', 'Ext', 'Template.xml');
  await fs.mkdir(path.dirname(first), { recursive: true });
  await fs.mkdir(path.dirname(second), { recursive: true });
  await fs.writeFile(first, '<Form xmlns="http://v8.1c.ru/8.3/xcf/logform"/>');
  await fs.writeFile(second, '<document/>');
  const client = NativeClient.start(executable, ['--stdio', '--no-open-browser', '--root', base]);
  t.after(async () => {
    await client.stop();
    await fs.rm(base, { recursive: true, force: true });
  });
  const open = async (file: string) => {
    const response = await client.send('tools/call', { name: 'open_preview', arguments: { path: file, audience: 'user' } });
    const result = response.result as { isError?: boolean; content: Array<{ text: string }>; structuredContent: Record<string, string> };
    assert.notEqual(result.isError, true, result.content[0]?.text);
    return result.structuredContent;
  };
  const statePath = async (url: string) => {
    const response = await fetch(new URL('state.json', url));
    return response.status === 200 ? ((await response.json()) as { path: string }).path : response.status;
  };

  const a = await open(first);
  const b = await open(second);
  assert.notEqual(a.previewId, b.previewId);
  assert.notEqual(a.previewUrl, b.previewUrl);
  assert.equal(a.audience, 'user');
  assert.equal(await statePath(a.previewUrl), await fs.realpath(first), 'opening B does not replace A');
  assert.equal(await statePath(b.previewUrl), await fs.realpath(second));
  assert.equal((await open(first)).previewUrl, a.previewUrl, 'reopening a file keeps its link');

  const listed = await client.send('tools/call', { name: 'get_preview_url', arguments: {} });
  const previews = (listed.result as { structuredContent: { previewId: string; previews: Array<{ previewId: string }> } }).structuredContent;
  assert.equal(previews.previewId, a.previewId, 'the last used preview is the default');
  assert.deepEqual(previews.previews.map((item) => item.previewId).sort(), [a.previewId, b.previewId].sort());

  const unknown = await client.send('tools/call', { name: 'get_preview_url', arguments: { preview_id: 'nope' } });
  assert.equal((unknown.result as { isError?: boolean }).isError, true);

  await client.send('tools/call', { name: 'close_preview', arguments: { preview_id: a.previewId } });
  assert.equal(await statePath(a.previewUrl), 404, 'a closed preview link stops working');
  assert.equal(await statePath(b.previewUrl), await fs.realpath(second), 'other previews stay open');
});
