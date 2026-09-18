import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const browserDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'browser');
await import(pathToFileURL(path.join(browserDir, 'form-context.js')).href);
const FormContext = globalThis.FormContext;

/* An in-memory export behind the same io contract the hosts implement: a file
 * that is absent or denied simply does not exist for the resolver. */
function memoryIo(files, denied = []) {
  const table = new Map(Object.entries(files).map(([key, value]) => [key.toLowerCase(), value]));
  const blocked = new Set(denied.map((key) => key.toLowerCase()));
  const visible = (p) => table.has(p.toLowerCase()) && !blocked.has(p.toLowerCase());
  const reads = [];
  return {
    reads,
    exists: async (p) => visible(p),
    readBytes: async (p, limit) => {
      reads.push(p);
      if (!visible(p)) return null;
      const value = table.get(p.toLowerCase());
      const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
      return bytes.length > limit ? null : bytes;
    },
  };
}

const ROOT = 'C:\\cfg';
const FORM = `${ROOT}\\Documents\\Order\\Forms\\Card\\Ext\\Form.xml`;
const ORDER_META = '<MetaDataObject><Document><Properties><Name>Order</Name></Properties></Document></MetaDataObject>';
const HISTORY = '<MetaDataObject><CommonCommand><Properties><Name>History</Name><Group>FormCommandBarImportant</Group>'
  + '<CommandParameterType><v8:Type>cfg:DocumentRef.Order</v8:Type></CommandParameterType></Properties></CommonCommand></MetaDataObject>';
const UNRELATED = '<MetaDataObject><CommonCommand><Properties><Name>Other</Name><Group>FormCommandBarImportant</Group>'
  + '<CommandParameterType><v8:Type>cfg:CatalogRef.Items</v8:Type></CommandParameterType></Properties></CommonCommand></MetaDataObject>';
const AUTOFILL_FORM = '<Form><AutoCommandBar name="ФормаКоманднаяПанель" id="-1"/></Form>';

test('uses the ConfigDumpInfo index for automatic form commands', async () => {
  const io = memoryIo({
    [FORM]: AUTOFILL_FORM,
    [`${ROOT}\\Documents\\Order.xml`]: ORDER_META,
    [`${ROOT}\\ConfigDumpInfo.xml`]: '<ConfigDumpInfo><Metadata name="CommonCommand.Other"/>'
      + '<Metadata name="CommonCommand.History"/><Metadata name="CommonCommand.History.CommandModule"/></ConfigDumpInfo>',
    [`${ROOT}\\CommonCommands\\History.xml`]: HISTORY,
    [`${ROOT}\\CommonCommands\\Other.xml`]: UNRELATED,
  });
  const context = await FormContext.resolve(FORM, AUTOFILL_FORM, io, { maxBytes: 1024 * 1024 });
  assert.equal(context.objectMeta, ORDER_META);
  assert.deepEqual(Object.keys(context.commonCommands), ['@global:History']);
});

test('falls back to Configuration.xml when the export has no dump index', async () => {
  const io = memoryIo({
    [FORM]: AUTOFILL_FORM,
    [`${ROOT}\\Documents\\Order.xml`]: ORDER_META,
    [`${ROOT}\\Configuration.xml`]: '<MetaDataObject><Configuration><ChildObjects>'
      + '<CommonCommand>History</CommonCommand></ChildObjects></Configuration></MetaDataObject>',
    [`${ROOT}\\CommonCommands\\History.xml`]: HISTORY,
  });
  const context = await FormContext.resolve(FORM, AUTOFILL_FORM, io, { maxBytes: 1024 * 1024 });
  assert.match(context.commonCommands['@global:History'], /CommonCommand/);
});

test('autofill=false keeps only explicitly referenced commands', async () => {
  const form = '<Form><AutoCommandBar name="ФормаКоманднаяПанель" id="-1"><Autofill>false</Autofill></AutoCommandBar>'
    + '<Command>CommonCommand.History</Command></Form>';
  const io = memoryIo({
    [FORM]: form,
    [`${ROOT}\\Documents\\Order.xml`]: ORDER_META,
    [`${ROOT}\\ConfigDumpInfo.xml`]: '<ConfigDumpInfo><Metadata name="CommonCommand.History"/></ConfigDumpInfo>',
    [`${ROOT}\\CommonCommands\\History.xml`]: HISTORY,
  });
  const context = await FormContext.resolve(FORM, form, io, { maxBytes: 1024 * 1024 });
  assert.deepEqual(Object.keys(context.commonCommands), ['History']);
});

test('an extension form reads the base cf form, and denied files stay invisible', async () => {
  const extension = 'C:\\src\\cfe\\Ext1\\Documents\\Order\\Forms\\Card\\Ext\\Form.xml';
  const base = 'C:\\src\\cf\\Documents\\Order\\Forms\\Card\\Ext\\Form.xml';
  const io = memoryIo({
    [extension]: '<Form><BaseForm/><BackColor>style:Accent</BackColor></Form>',
    [base]: '<Form><Commands/></Form>',
    'C:\\src\\cfe\\Ext1\\StyleItems\\Accent.xml': '<StyleItem><Value>#123456</Value></StyleItem>',
    'C:\\src\\cfe\\Ext1\\Documents\\Order.xml': ORDER_META,
  }, ['C:\\src\\cfe\\Ext1\\Documents\\Order.xml']);
  const context = await FormContext.resolve(extension, '<Form><BackColor>style:Accent</BackColor></Form>', io,
    { maxBytes: 1024 * 1024 });
  assert.equal(context.baseForm, '<Form><Commands/></Form>');
  assert.equal(context.objectMeta, '');
  assert.deepEqual(context.styleItems, { Accent: '#123456' });
});

const EXTENSION_CONFIGURATION = '<MetaDataObject><Configuration><Properties>'
  + '<ConfigurationExtensionPurpose>Customization</ConfigurationExtensionPurpose></Properties>'
  + '<ChildObjects/></Configuration></MetaDataObject>';
const BASE_CONFIGURATION = '<MetaDataObject><Configuration><Properties><Name>Main</Name></Properties>'
  + '<ChildObjects/></Configuration></MetaDataObject>';

test('an extension finds its configuration through the host in any layout', async () => {
  const extensionRoot = 'D:\\repo\\extensions\\Ext1';
  const extension = `${extensionRoot}\\Documents\\Order\\Forms\\Card\\Ext\\Form.xml`;
  const io = memoryIo({
    [extension]: '<Form/>',
    [`${extensionRoot}\\Configuration.xml`]: EXTENSION_CONFIGURATION,
    'D:\\repo\\main\\Configuration.xml': BASE_CONFIGURATION,
    'D:\\repo\\main\\Documents\\Order\\Forms\\Card\\Ext\\Form.xml': '<Form><Commands/></Form>',
    'D:\\repo\\main\\Documents\\Order.xml': ORDER_META,
  });
  const asked = [];
  io.baseConfigurations = async (root) => { asked.push(root); return ['D:\\repo\\main']; };
  const context = await FormContext.resolve(extension, '<Form/>', io, { maxBytes: 1024 * 1024 });
  assert.deepEqual(asked, [extensionRoot]);
  assert.equal(context.baseForm, '<Form><Commands/></Form>');
});

test('of several configurations the one that has the form wins, extensions never do', async () => {
  const extensionRoot = 'D:\\repo\\ext\\Ext1';
  const extension = `${extensionRoot}\\Documents\\Order\\Forms\\Card\\Ext\\Form.xml`;
  const io = memoryIo({
    [extension]: '<Form/>',
    [`${extensionRoot}\\Configuration.xml`]: EXTENSION_CONFIGURATION,
    'D:\\repo\\ext\\Ext2\\Configuration.xml': EXTENSION_CONFIGURATION,
    'D:\\repo\\ext\\Ext2\\Documents\\Order\\Forms\\Card\\Ext\\Form.xml': '<Form>ext2</Form>',
    'D:\\repo\\cfgA\\Configuration.xml': BASE_CONFIGURATION,
    'D:\\repo\\cfgB\\Configuration.xml': BASE_CONFIGURATION,
    'D:\\repo\\cfgB\\Documents\\Order\\Forms\\Card\\Ext\\Form.xml': '<Form>cfgB</Form>',
  });
  io.baseConfigurations = async () => ['D:\\repo\\ext\\Ext2', 'D:\\repo\\cfgA', 'D:\\repo\\cfgB'];
  const context = await FormContext.resolve(extension, '<Form/>', io, { maxBytes: 1024 * 1024 });
  assert.equal(context.baseForm, '<Form>cfgB</Form>');
});

test('a host that cannot list directories keeps the cf/cfe layout', async () => {
  const extension = 'C:\\src\\cfe\\Ext1\\Documents\\Order\\Forms\\Card\\Ext\\Form.xml';
  const io = memoryIo({
    [extension]: '<Form/>',
    'C:\\src\\cfe\\Ext1\\Configuration.xml': EXTENSION_CONFIGURATION,
    'C:\\src\\cf\\Configuration.xml': BASE_CONFIGURATION,
    'C:\\src\\cf\\Documents\\Order\\Forms\\Card\\Ext\\Form.xml': '<Form>cf</Form>',
  });
  const context = await FormContext.resolve(extension, '<Form/>', io, { maxBytes: 1024 * 1024 });
  assert.equal(context.baseForm, '<Form>cf</Form>');
});

test('a configuration form has no base form even beside other configurations', async () => {
  const io = memoryIo({
    [FORM]: '<Form/>',
    [`${ROOT}\\Configuration.xml`]: BASE_CONFIGURATION,
  });
  io.baseConfigurations = async () => { throw new Error('must not be asked'); };
  const context = await FormContext.resolve(FORM, '<Form/>', io, { maxBytes: 1024 * 1024 });
  assert.equal(context.baseForm, '');
});

test('the configuration-properties filter stops before the object list', () => {
  assert.equal(FormContext.filterText('<A><P/><ChildObjects><X/></ChildObjects></A>', 'configuration-properties'), '<A><P/>');
  assert.equal(FormContext.rebase('D:\\e\\Ext1\\Documents\\X.xml', 'D:\\E\\ext1', 'C:\\cf'), 'C:\\cf\\Documents\\X.xml');
  assert.equal(FormContext.rebase('D:\\e\\Ext10\\X.xml', 'D:\\e\\Ext1', 'C:\\cf'), '');
});

test('common pictures are base64 encoded and respect the byte limit', async () => {
  const form = '<Form><Picture>CommonPicture.Refresh</Picture><Picture>CommonPicture.Huge</Picture></Form>';
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47]);
  const io = memoryIo({
    [FORM]: form,
    [`${ROOT}\\CommonPictures\\Refresh\\Ext\\Picture.xml`]: '<ExtPicture><xr:Abs>Picture.png</xr:Abs></ExtPicture>',
    [`${ROOT}\\CommonPictures\\Refresh\\Ext\\Picture\\Picture.png`]: png,
    [`${ROOT}\\CommonPictures\\Huge\\Ext\\Picture.xml`]: '<ExtPicture><xr:Abs>Picture.png</xr:Abs></ExtPicture>',
    [`${ROOT}\\CommonPictures\\Huge\\Ext\\Picture\\Picture.png`]: new Uint8Array(2048),
  });
  const context = await FormContext.resolve(FORM, form, io, { maxBytes: 1024 });
  assert.deepEqual(context.commonPictures, { Refresh: { mime: 'image/png', data: 'iVBORw==' } });
});

test('an item picture file is attributed to its owner and loaded beside the layout', async () => {
  const form = '<Form><ChildItems>'
    + '<UsualGroup name="Group" id="1"><ChildItems>'
    + '<Button name="Filter" id="2"><Picture><xr:Abs>Picture.bmp</xr:Abs><xr:LoadTransparent>false</xr:LoadTransparent></Picture>'
    + '<ExtendedTooltip name="FilterTooltip" id="3"/></Button>'
    + '<Button name="Mode" id="4"><ExtendedTooltip name="ModeTooltip" id="5"/>'
    + '<Picture><xr:Abs>Picture.svg</xr:Abs></Picture></Button>'
    + '<Button name="Escape" id="6"><Picture><xr:Abs>../x.png</xr:Abs></Picture></Button>'
    + '</ChildItems></UsualGroup>'
    + '<Table name="List" id="7"><RowsPicture><xr:Abs>RowsPicture.png</xr:Abs></RowsPicture></Table>'
    + '</ChildItems></Form>';
  assert.deepEqual(FormContext.referencedItemPictures(form).map((picture) => picture.key), [
    '@item:Filter/Picture.bmp', '@item:Mode/Picture.svg', '@item:List/RowsPicture.png'
  ]);
  const bmp = Uint8Array.from([0x42, 0x4d]);
  const io = memoryIo({
    [FORM]: form,
    [`${ROOT}\\Documents\\Order\\Forms\\Card\\Ext\\Form\\Items\\Filter\\Picture.bmp`]: bmp,
  });
  const context = await FormContext.resolve(FORM, form, io, { maxBytes: 1024 });
  assert.deepEqual(context.commonPictures, { '@item:Filter/Picture.bmp': { mime: 'image/bmp', data: 'Qk0=' } });
  assert.equal(FormContext.pictureResourceName('<xr:Abs>Picture.svg</xr:Abs>'), 'Picture.svg');
  assert.equal(FormContext.pictureMime('Picture.jpg'), 'image/jpeg');
});

test('loads Catalogs/Name.xml for CatalogRef types in the form', async () => {
  const form = '<Form><ChildItems><InputField name="Item"><DataPath>Объект.Item</DataPath>'
    + '<Type><v8:Type>cfg:CatalogRef.Items</v8:Type></Type></InputField></ChildItems></Form>';
  const items = '<MetaDataObject><Catalog><Properties><Name>Items</Name>'
    + '<DescriptionLength>10</DescriptionLength></Properties></Catalog></MetaDataObject>';
  const io = memoryIo({
    [FORM]: form,
    [`${ROOT}\\Documents\\Order.xml`]: ORDER_META,
    [`${ROOT}\\Catalogs\\Items.xml`]: items,
  });
  const context = await FormContext.resolve(FORM, form, io, { maxBytes: 1024 * 1024 });
  assert.equal(context.refMeta.Items, items);
  assert.deepEqual(FormContext.referencedCatalogs(form), ['Items']);
  assert.ok(FormContext.catalogMetaCandidates(FORM, 'Items')
    .some((candidate) => candidate.toLowerCase().endsWith('\\catalogs\\items.xml')));
});

test('path helpers work with Windows and POSIX separators without node:path', () => {
  const { dirname, basename, join, samePath } = FormContext._test;
  assert.equal(dirname('C:\\a\\b\\Form.xml'), 'C:\\a\\b');
  assert.equal(dirname('C:\\a'), 'C:\\');
  assert.equal(dirname('/srv/cfg/Form.xml'), '/srv/cfg');
  assert.equal(basename('/srv/cfg/Form.xml'), 'Form.xml');
  assert.equal(join('C:\\a', 'b', 'c.xml'), 'C:\\a\\b\\c.xml');
  assert.equal(samePath('C:\\A\\Form.xml', 'c:\\a\\form.xml'), true);
  assert.equal(FormContext.formLayoutFor('C:\\cfg\\Catalogs\\Items\\Forms\\Card.xml'),
    'C:\\cfg\\Catalogs\\Items\\Forms\\Card\\Ext\\Form.xml');
});

/* The export of the first test, behind a host that batches and stores. */
function batchingIo(files) {
  const io = memoryIo(files);
  const stamps = new Map(Object.keys(files).map((key) => [key.toLowerCase(), '1:1']));
  const store = new Map();
  const calls = { existsMany: 0, readMany: 0, statMany: 0, singles: 0, filters: [] };
  const exists = io.exists;
  const readBytes = io.readBytes;
  Object.assign(io, {
    calls, store, stamps,
    exists: async (p) => { calls.singles++; return exists(p); },
    readBytes: async (p, limit) => { calls.singles++; return readBytes(p, limit); },
    existsMany: async (paths) => { calls.existsMany++; return Promise.all(paths.map(exists)); },
    readMany: async (paths, limit, filter) => {
      calls.readMany++;
      if (filter) calls.filters.push(filter);
      return Promise.all(paths.map((p) => readBytes(p, limit)));
    },
    statMany: async (paths) => { calls.statMany++; return paths.map((p) => stamps.get(p.toLowerCase()) ?? null); },
    cacheGet: async (directory, key) => store.get(`${directory}\n${key}`) ?? null,
    cachePut: async (directory, key, text) => { store.set(`${directory}\n${key}`, text); },
  });
  return io;
}

const OBJECT_COMMAND_META = '<MetaDataObject><Document><Properties><Name>Order</Name></Properties><ChildObjects>'
  + '<Command uuid="1"><Properties><Name>Print</Name><Group>FormCommandBarImportant</Group>'
  + '<CommandParameterType><v8:Type>cfg:DocumentRef.Order</v8:Type></CommandParameterType></Properties></Command>'
  + '</ChildObjects></Document></MetaDataObject>';

function catalogExport() {
  return {
    [FORM]: AUTOFILL_FORM,
    [`${ROOT}\\Documents\\Order.xml`]: OBJECT_COMMAND_META,
    [`${ROOT}\\ConfigDumpInfo.xml`]: '<ConfigDumpInfo><Metadata name="CommonCommand.Other"/>'
      + '<Metadata name="CommonCommand.History"/><Metadata name="Document.Order"/>'
      + '<Metadata name="Document.Order.Command.Print"/></ConfigDumpInfo>',
    [`${ROOT}\\CommonCommands\\History.xml`]: HISTORY,
    [`${ROOT}\\CommonCommands\\Other.xml`]: UNRELATED,
  };
}

test('a batching host gets the same context in a handful of requests', async () => {
  const plain = await FormContext.resolve(FORM, AUTOFILL_FORM, memoryIo(catalogExport()), { maxBytes: 1024 * 1024 });
  const io = batchingIo(catalogExport());
  const batched = await FormContext.resolve(FORM, AUTOFILL_FORM, io, { maxBytes: 1024 * 1024 });
  assert.deepEqual(batched, plain);
  assert.deepEqual(Object.keys(batched.commonCommands), ['@global:History', '@global-fqn:Document.Order.Command.Print']);
  assert.equal(io.calls.singles, 0);
  assert.ok(io.calls.readMany <= 6, `readMany ${io.calls.readMany}`);
  assert.deepEqual([...new Set(io.calls.filters)].sort(), ['command-blocks', 'command-metadata', 'configuration-properties']);
});

test('the command catalog is stored and rebuilt when any source file moves', async () => {
  const io = batchingIo(catalogExport());
  const first = await FormContext.resolve(FORM, AUTOFILL_FORM, io, { maxBytes: 1024 * 1024 });
  assert.equal(io.store.size, 1);

  /* A new page (empty in-memory cache) reads no command descriptor at all. */
  io.reads.length = 0;
  const second = await FormContext.resolve(FORM, AUTOFILL_FORM, io, { maxBytes: 1024 * 1024 });
  assert.deepEqual(second, first);
  assert.equal(io.reads.some((p) => /CommonCommands|ConfigDumpInfo/.test(p)), false);

  /* History stops targeting the document: its stamp moves, the store is stale. */
  const table = catalogExport();
  table[`${ROOT}\\CommonCommands\\History.xml`] = UNRELATED.replace('Other', 'History');
  const edited = batchingIo(table);
  for (const [key, value] of io.store) edited.store.set(key, value);
  edited.stamps.set(`${ROOT}\\CommonCommands\\History.xml`.toLowerCase(), '2:2');
  const third = await FormContext.resolve(FORM, AUTOFILL_FORM, edited, { maxBytes: 1024 * 1024 });
  assert.deepEqual(Object.keys(third.commonCommands), ['@global-fqn:Document.Order.Command.Print']);
});

test('text filters keep exactly what the resolver reads', () => {
  const dump = '<Metadata name="CommonCommand.A" id="1"/><Metadata name="Catalog.X"/>'
    + '<Metadata\n name="Document.D.Command.P"/><Metadataname="CommandGroup.G"/><Metadata name="CommandGroup.G"/>';
  assert.equal(FormContext.filterText(dump, 'command-metadata'),
    '<Metadata name="CommonCommand.A"\n<Metadata\n name="Document.D.Command.P"\n<Metadata name="CommandGroup.G"');
  const meta = '<Commands/><Command uuid="1"><Name>A</Name></Command><CommandParameterType/>'
    + '<COMMAND><Name>B</Name></command><Command>open';
  assert.equal(FormContext.filterText(meta, 'command-blocks'),
    '<Command uuid="1"><Name>A</Name></Command>\n<COMMAND><Name>B</Name></command>');
  assert.equal(FormContext.filterText(meta, ''), meta);
});

test('the http adapter speaks the batch wire format and falls back without it', async () => {
  const sent = [];
  const frame = (parts) => {
    const chunks = parts.map((part) => {
      const length = Buffer.alloc(4);
      length.writeInt32LE(part === null ? -1 : part.length);
      return part === null ? length : Buffer.concat([length, Buffer.from(part)]);
    });
    return Buffer.concat(chunks);
  };
  const previous = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    sent.push({ url: String(url), body: init.body });
    if (init.method !== 'POST') return new Response('1');
    const [op] = init.body.split('\n');
    if (op === 'exists') return new Response('10');
    if (op === 'read') return new Response(frame(['abc', null]));
    if (op === 'stat') return new Response('3:5\n');
    return new Response('', { status: 404 });
  };
  try {
    const io = FormContext.createHttpIo('file', 'batch');
    assert.deepEqual(await io.existsMany(['a', 'b']), [true, false]);
    const read = await io.readMany(['a', 'b'], Infinity, 'command-blocks');
    assert.equal(sent.at(-1).body, 'read\n0\ncommand-blocks\na\nb');
    assert.deepEqual([new TextDecoder().decode(read[0]), read[1]], ['abc', null]);
    assert.deepEqual(await io.statMany(['a', 'b']), ['3:5', null]);
    assert.equal(await io.cacheGet('C:\cfg', 'k'), null);

    globalThis.fetch = async (url, init = {}) => {
      sent.push({ url: String(url), body: init.body });
      return init.method === 'POST' ? new Response('', { status: 405 }) : new Response('1');
    };
    const legacy = FormContext.createHttpIo('file', 'batch');
    assert.deepEqual(await legacy.existsMany(['a']), [true]);
    assert.equal(sent.at(-1).url, 'file?p=a&exists=1');
  } finally {
    globalThis.fetch = previous;
  }
});
