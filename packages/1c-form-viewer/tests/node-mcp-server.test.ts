import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

/* The Node.js server (src/mcp-server.ts) speaks the same stdio NDJSON protocol
 * as the native exe, so it is tested the same way native-contract.test.ts
 * tests the binary: real round trips, strict JSON.parse on every reply. The
 * authoring tools run in-process and need no browser, so this suite stays
 * browserless; the rendering path is covered by the e2e tests. */
const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repositoryDir = path.resolve(packageDir, '..', '..');
const testdataDir = path.join(repositoryDir, 'testdata');

const ALL_TOOLS = [
  'open_preview', 'preview', 'capture_preview',
  'convert_xlsx_to_template', 'list_markup', 'validate_template',
  'edit_template',
  'list_form_elements', 'validate_form',
  'edit_form',
];

class NodeServerClient {
  private nextId = 1;
  private readonly pending = new Map<number, (value: Record<string, unknown>) => void>();

  private constructor(private readonly child: ChildProcessWithoutNullStreams) {}

  static start(args: string[]): NodeServerClient {
    /* Spawn node with the tsx CLI directly: the .bin shim is a .cmd on Windows,
     * which spawn() cannot exec without a shell. */
    const tsxCli = path.join(repositoryDir, 'node_modules', 'tsx', 'dist', 'cli.mjs');
    const child = spawn(process.execPath, [tsxCli, path.join(packageDir, 'src', 'mcp-server.ts'), '--stdio', ...args], {
      cwd: packageDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ONE_C_FORM_VIEWER_CONTEXT_CACHE: 'off' },
    });
    const client = new NodeServerClient(child);
    createInterface({ input: child.stdout }).on('line', (line) => client.accept(line));
    return client;
  }

  private accept(line: string): void {
    if (!line.trim()) return;
    /* Deliberately strict: a malformed reply must fail the test, not be skipped. */
    const message = JSON.parse(line) as { id?: number };
    const resolve = typeof message.id === 'number' ? this.pending.get(message.id) : undefined;
    if (resolve) {
      this.pending.delete(message.id!);
      resolve(message as unknown as Record<string, unknown>);
    }
  }

  async request(method: string, params?: unknown): Promise<Record<string, unknown>> {
    const id = this.nextId++;
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    const message = await new Promise<Record<string, unknown>>((resolve) => this.pending.set(id, resolve));
    assert.equal(message.jsonrpc, '2.0');
    assert.equal(message.id, id);
    return message;
  }

  async initialize(): Promise<void> {
    const reply = await this.request('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'node-mcp-server-test', version: '0.1' },
    });
    const result = reply.result as { protocolVersion: string; serverInfo: { name: string } };
    assert.equal(result.protocolVersion, '2025-06-18');
    assert.equal(result.serverInfo.name, '1c-form-viewer');
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  }

  /* A successful call: content[0] is text, structuredContent carries the value. */
  async call(name: string, args: Record<string, unknown>): Promise<{ structured: Record<string, unknown>; text: string }> {
    const reply = await this.request('tools/call', { name, arguments: args });
    const result = reply.result as { isError?: boolean; content: Array<{ type: string; text?: string }>; structuredContent?: Record<string, unknown> };
    if (result.isError) throw new Error(`tools/call ${name} failed: ${result.content[0]?.text}`);
    assert.equal(result.content[0]?.type, 'text');
    return { structured: result.structuredContent || {}, text: result.content[0]?.text || '' };
  }

  /* A call expected to fail: isError with the message in content[0].text. */
  async callError(name: string, args: Record<string, unknown>): Promise<string> {
    const reply = await this.request('tools/call', { name, arguments: args });
    const result = reply.result as { isError?: boolean; content: Array<{ text?: string }> };
    assert.equal(result.isError, true, `tools/call ${name} should have failed`);
    return result.content[0]?.text || '';
  }

  async close(): Promise<void> {
    this.child.stdin.end();
    const exited = await Promise.race([
      new Promise((resolve) => this.child.once('exit', resolve)),
      new Promise((resolve) => setTimeout(() => resolve('timeout'), 5000)),
    ]);
    if (exited === 'timeout') this.child.kill();
  }
}

async function tempRoot(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

test('tools/list advertises the ten tools of the native server', async (t) => {
  const root = await tempRoot('1c-node-mcp-list-');
  t.after(() => fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
  const client = NodeServerClient.start(['--root', root]);
  t.after(() => client.close());
  await client.initialize();
  const reply = await client.request('tools/list');
  const tools = (reply.result as { tools: Array<{ name: string; inputSchema: unknown }> }).tools;
  assert.deepEqual(tools.map((tool) => tool.name).sort(), [...ALL_TOOLS].sort());
  for (const tool of tools) assert.ok(tool.inputSchema, `${tool.name} has no inputSchema`);
});

test('edit tools are hidden by --no-form-edit-tools and --no-template-edit-tools', async (t) => {
  const root = await tempRoot('1c-node-mcp-flags-');
  t.after(() => fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
  const client = NodeServerClient.start(['--root', root, '--no-form-edit-tools', '--no-template-edit-tools']);
  t.after(() => client.close());
  await client.initialize();
  const reply = await client.request('tools/list');
  const names = (reply.result as { tools: Array<{ name: string }> }).tools.map((tool) => tool.name);
  assert.ok(!names.includes('edit_form'));
  assert.ok(!names.includes('edit_template'));
  assert.ok(names.includes('list_form_elements') && names.includes('list_markup'));
  const message = await client.callError('edit_form', { path: 'x.xml', operation: 'set_properties' });
  assert.match(message, /disabled/);
});

test('list_form_elements and validate_form read a form through the protocol', async (t) => {
  const root = await tempRoot('1c-node-mcp-read-');
  t.after(() => fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
  await fs.copyFile(path.join(testdataDir, 'Форма.xml'), path.join(root, 'Form.xml'));
  const client = NodeServerClient.start(['--root', root]);
  t.after(() => client.close());
  await client.initialize();

  const listed = await client.call('list_form_elements', { path: path.join(root, 'Form.xml') });
  const listResult = listed.structured.result as { version: string; elements: Array<{ name: string; kind: string }> };
  assert.equal(listResult.version, '2.17');
  assert.ok(listResult.elements.length > 0);
  assert.ok(listResult.elements.some((element) => element.name === 'ГруппаШапка'));

  /* testdata/Форма.xml uses a cfg: type prefix without declaring it, so the
   * validator reports exactly that known error — and nothing else. */
  const validated = await client.call('validate_form', { path: path.join(root, 'Form.xml') });
  const validation = validated.structured.result as { ok: boolean; errors: Array<{ code: string }> };
  assert.equal(validation.ok, false);
  assert.ok(validation.errors.length > 0);
  assert.ok(validation.errors.every((error) => error.code === 'namespacePrefix'), JSON.stringify(validation.errors));
});

test('edit_form set_properties changes only the title and refreshes validation', async (t) => {
  const root = await tempRoot('1c-node-mcp-editform-');
  t.after(() => fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
  const target = path.join(root, 'Form.xml');
  await fs.copyFile(path.join(testdataDir, 'Форма.xml'), target);
  const client = NodeServerClient.start(['--root', root]);
  t.after(() => client.close());
  await client.initialize();

  /* The edit introduces no new validation errors. */
  const beforeValidation = await client.call('validate_form', { path: target });
  const beforeCodes = (beforeValidation.structured.result as { errors: Array<{ code: string }> }).errors.map((error) => error.code).sort();

  const edited = await client.call('edit_form', {
    path: target,
    operation: 'set_properties',
    properties: { Title: 'Проверка порта Node' },
  });
  assert.equal(edited.structured.previewRefreshed, false);
  const content = await fs.readFile(target, 'utf8');
  assert.match(content, /Проверка порта Node/);

  const validated = await client.call('validate_form', { path: target });
  const afterCodes = (validated.structured.result as { errors: Array<{ code: string }> }).errors.map((error) => error.code).sort();
  assert.deepEqual(afterCodes, beforeCodes);

  /* The untouched rest of the file stays byte for byte: the edit is a pure
   * insertion of the Title node, the prefix before and the tail after it are
   * identical to the original. */
  const original = await fs.readFile(path.join(testdataDir, 'Форма.xml'), 'utf8');
  const titleStart = content.lastIndexOf('\n', content.indexOf('<Title>')) + 1;
  const titleEnd = content.indexOf('</Title>', titleStart);
  assert.ok(titleStart > 0 && titleEnd > titleStart, 'no Title node in the edited form');
  const insertedEnd = content.indexOf('\n', titleEnd) + 1;
  assert.equal(content.slice(0, titleStart), original.slice(0, titleStart));
  assert.equal(content.slice(insertedEnd), original.slice(titleStart));
});

test('edit_form rejects an unknown operation', async (t) => {
  const root = await tempRoot('1c-node-mcp-badop-');
  t.after(() => fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
  const target = path.join(root, 'Form.xml');
  await fs.copyFile(path.join(testdataDir, 'Форма.xml'), target);
  const client = NodeServerClient.start(['--root', root]);
  t.after(() => client.close());
  await client.initialize();
  const message = await client.callError('edit_form', { path: target, operation: 'explode' });
  assert.match(message, /operation must be one of/);
});

test('list_markup, edit_template and validate_template work on a template copy', async (t) => {
  const root = await tempRoot('1c-node-mcp-template-');
  t.after(() => fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
  const target = path.join(root, 'Template.xml');
  await fs.copyFile(path.join(testdataDir, 'Template.xml'), target);
  const client = NodeServerClient.start(['--root', root]);
  t.after(() => client.close());
  await client.initialize();

  const before = await client.call('list_markup', { path: target });
  const markupBefore = before.structured.result as { areas: Array<{ name: string }>; parameters: Array<{ name: string }> };
  const areasBefore = markupBefore.areas.map((area) => area.name);

  const edited = await client.call('edit_template', {
    path: target,
    operation: 'set_area',
    name: 'Проверка',
    begin_row: 1,
    end_row: 1,
  });
  assert.equal(edited.structured.previewRefreshed, false);

  const after = await client.call('list_markup', { path: target });
  const markupAfter = after.structured.result as { areas: Array<{ name: string }> };
  assert.deepEqual(markupAfter.areas.map((area) => area.name).sort(), [...areasBefore, 'Проверка'].sort());

  const removed = await client.call('edit_template', { path: target, operation: 'set_area', name: 'Проверка', remove: true });
  assert.ok(removed.structured.result && typeof removed.structured.result === 'object');
  const restored = await client.call('list_markup', { path: target });
  const markupRestored = restored.structured.result as { areas: Array<{ name: string }> };
  assert.deepEqual(markupRestored.areas.map((area) => area.name).sort(), [...areasBefore].sort());
  const validated = await client.call('validate_template', { path: target });
  assert.equal((validated.structured.result as { ok: boolean }).ok, true);
});

/* Minimal stored (uncompressed) ZIP writer: just enough OOXML for the
 * converter's openWorkbook — workbook, rels, one sheet with a parameter cell. */
function crc32(bytes: Buffer): number {
  let table = (crc32 as unknown as { table?: number[] }).table;
  if (!table) {
    table = [];
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    (crc32 as unknown as { table?: number[] }).table = table;
  }
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (table[(crc ^ byte) & 0xff] ^ (crc >>> 8)) >>> 0;
  return (crc ^ 0xffffffff) >>> 0;
}

function zipStore(entries: Array<{ name: string; data: Buffer }>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const crc = crc32(entry.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(0, 8); // stored
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(entry.data.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    localParts.push(local, name, entry.data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(entry.data.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += 30 + name.length + entry.data.length;
  }
  const centralStart = offset;
  const central = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(centralStart, 16);
  return Buffer.concat([...localParts, central, end]);
}

function minimalXlsx(): Buffer {
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Лист1" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>[Номер]</t></is></c><c r="B1" t="inlineStr"><is><t>Акт № [Номер]</t></is></c></row></sheetData></worksheet>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="8"/><name val="Arial"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellXfs count="1"><xf/></cellXfs></styleSheet>`;
  return zipStore([
    { name: 'xl/workbook.xml', data: Buffer.from(workbook, 'utf8') },
    { name: 'xl/_rels/workbook.xml.rels', data: Buffer.from(rels, 'utf8') },
    { name: 'xl/worksheets/sheet1.xml', data: Buffer.from(sheet, 'utf8') },
    { name: 'xl/styles.xml', data: Buffer.from(styles, 'utf8') },
  ]);
}

test('convert_xlsx_to_template writes a template and lists its parameters', async (t) => {
  const root = await tempRoot('1c-node-mcp-xlsx-');
  t.after(() => fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
  const xlsxPath = path.join(root, 'input.xlsx');
  const outputPath = path.join(root, 'Templates', 'Ext', 'Template.xml');
  await fs.writeFile(xlsxPath, minimalXlsx());
  const client = NodeServerClient.start(['--root', root]);
  t.after(() => client.close());
  await client.initialize();

  const converted = await client.call('convert_xlsx_to_template', { xlsx_path: xlsxPath, output_path: outputPath });
  assert.equal(converted.structured.outputPath, outputPath);
  const content = await fs.readFile(outputPath, 'utf8');
  assert.match(content, /<document xmlns="http:\/\/v8.1c.ru\/8.2\/data\/spreadsheet"/);

  const markup = await client.call('list_markup', { path: outputPath });
  const result = markup.structured.result as { parameters: Array<{ name: string }> };
  assert.ok(result.parameters.some((parameter) => parameter.name === 'Номер'), JSON.stringify(result.parameters));

  /* No overwrite without the flag. */
  const message = await client.callError('convert_xlsx_to_template', { xlsx_path: xlsxPath, output_path: outputPath });
  assert.match(message, /already exists/);

  /* A path outside the root is refused. */
  const outside = await client.callError('list_markup', { path: path.join(os.tmpdir(), 'nowhere', 'Template.xml') });
  assert.match(outside, /outside the allowed roots|does not exist/);
});
