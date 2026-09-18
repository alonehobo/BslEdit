import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { decodeText, FileLoader, findBaseConfigurations } from '../src/files.js';

async function sandbox(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), '1c-form-viewer-'));
}

test('decodes UTF-8 BOM, UTF-16 LE/BE and Windows-1251', () => {
  assert.deepEqual(decodeText(Uint8Array.from([0xef, 0xbb, 0xbf, 0x41])), { content: 'A', encoding: 'utf8-bom' });
  assert.deepEqual(decodeText(Uint8Array.from([0xff, 0xfe, 0x10, 0x04])), { content: 'А', encoding: 'utf16le' });
  assert.deepEqual(decodeText(Uint8Array.from([0xfe, 0xff, 0x04, 0x10])), { content: 'А', encoding: 'utf16be' });
  const cp1251 = Uint8Array.from([0x3c, 0x78, 0x3e, 0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2, 0x3c, 0x2f, 0x78, 0x3e]);
  assert.deepEqual(decodeText(cp1251), { content: '<x>Привет</x>', encoding: 'windows-1251' });
});

test('resolves a form descriptor and loads object metadata', async (t) => {
  const root = await sandbox();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const forms = path.join(root, 'Catalogs', 'Products', 'Forms');
  const actual = path.join(forms, 'Card', 'Ext', 'Form.xml');
  await fs.mkdir(path.dirname(actual), { recursive: true });
  await fs.writeFile(path.join(forms, 'Card.xml'), '<FormDescriptor/>');
  await fs.writeFile(actual, '<Form xmlns="http://v8.1c.ru/8.3/xcf/logform"/>');
  await fs.writeFile(path.join(root, 'Catalogs', 'Products.xml'), '<MetaDataObject/>');

  const loader = await FileLoader.create([root], 1024 * 1024);
  const loaded = await loader.load(path.join(forms, 'Card.xml'));
  assert.equal(loaded.resolvedPath, await fs.realpath(actual));
  assert.match(loaded.content, /xcf\/logform/);
  assert.equal(loaded.objectMeta, '<MetaDataObject/>');
});

test('loads Catalogs/Name.xml for a CatalogRef on the form', async (t) => {
  const root = await sandbox();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const form = path.join(root, 'Documents', 'Order', 'Forms', 'Card', 'Ext', 'Form.xml');
  const catalogs = path.join(root, 'Catalogs');
  await fs.mkdir(path.dirname(form), { recursive: true });
  await fs.mkdir(catalogs, { recursive: true });
  await fs.writeFile(form, '<Form xmlns="http://v8.1c.ru/8.3/xcf/logform"><Attribute>'
    + '<Type><v8:Type>cfg:CatalogRef.Items</v8:Type></Type></Attribute></Form>');
  await fs.writeFile(path.join(root, 'Documents', 'Order.xml'),
    '<MetaDataObject><Document><Properties><Name>Order</Name></Properties></Document></MetaDataObject>');
  await fs.writeFile(path.join(catalogs, 'Items.xml'),
    '<MetaDataObject><Catalog><Properties><Name>Items</Name>'
    + '<DescriptionLength>10</DescriptionLength></Properties></Catalog></MetaDataObject>');
  const loaded = await (await FileLoader.create([root], 1024 * 1024)).load(form);
  assert.match(loaded.refMeta?.Items || '', /DescriptionLength>10/);
});

test('loads referenced configuration style values without name heuristics', async (t) => {
  const root = await sandbox();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const actual = path.join(root, 'Documents', 'Doc', 'Forms', 'Card', 'Ext', 'Form.xml');
  const styles = path.join(root, 'StyleItems');
  await fs.mkdir(path.dirname(actual), { recursive: true });
  await fs.mkdir(styles, { recursive: true });
  await fs.writeFile(actual, '<Form xmlns="http://v8.1c.ru/8.3/xcf/logform"><BackColor>style:AnyConfiguredName</BackColor></Form>');
  await fs.writeFile(path.join(styles, 'AnyConfiguredName.xml'), '<MetaDataObject><StyleItem><Properties><Value>#A1B2C3</Value></Properties></StyleItem></MetaDataObject>');
  const loader = await FileLoader.create([root], 1024 * 1024);
  const loaded = await loader.load(actual);
  assert.deepEqual(loaded.styleItems, { AnyConfiguredName: '#A1B2C3' });
});

test('loads common commands referenced only by the form command interface', async (t) => {
  const root = await sandbox();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const form = path.join(root, 'Documents', 'Order', 'Forms', 'Card', 'Ext', 'Form.xml');
  const commandDir = path.join(root, 'CommonCommands');
  await fs.mkdir(path.dirname(form), { recursive: true });
  await fs.mkdir(commandDir, { recursive: true });
  await fs.writeFile(form, '<Form><CommandInterface><CommandBar><Item><Command>CommonCommand.Protocol</Command></Item></CommandBar></CommandInterface></Form>');
  await fs.writeFile(path.join(commandDir, 'Protocol.xml'), '<MetaDataObject><CommonCommand/></MetaDataObject>');
  const loaded = await (await FileLoader.create([root], 1024 * 1024)).load(form);
  assert.match(loaded.commonCommands?.Protocol || '', /CommonCommand/);
});

test('loads applicable global commands for an autofilled empty form command bar', async (t) => {
  const root = await sandbox();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const form = path.join(root, 'Documents', 'Order', 'Forms', 'Card', 'Ext', 'Form.xml');
  const commandDir = path.join(root, 'CommonCommands');
  await fs.mkdir(path.dirname(form), { recursive: true });
  await fs.mkdir(commandDir, { recursive: true });
  await fs.writeFile(form, '<Form><AutoCommandBar name="ФормаКоманднаяПанель" id="-1"/></Form>');
  await fs.writeFile(path.join(root, 'Documents', 'Order.xml'),
    '<MetaDataObject><Document><Properties><Name>Order</Name></Properties></Document></MetaDataObject>');
  await fs.writeFile(path.join(root, 'ConfigDumpInfo.xml'),
    '<ConfigDumpInfo><Metadata name="CommonCommand.History" id="1"/></ConfigDumpInfo>');
  await fs.writeFile(path.join(commandDir, 'History.xml'),
    '<MetaDataObject><CommonCommand><Properties><Name>History</Name><Group>FormCommandBarImportant</Group>'
    + '<ParameterType><v8:Type>cfg:DocumentRef.Order</v8:Type></ParameterType></Properties></CommonCommand></MetaDataObject>');
  const loaded = await (await FileLoader.create([root], 1024 * 1024)).load(form);
  assert.match(loaded.commonCommands?.['@global:History'] || '', /CommonCommand/);
});

test('does not load implicit global commands when form command-bar autofill is disabled', async (t) => {
  const root = await sandbox();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const form = path.join(root, 'Documents', 'Order', 'Forms', 'Card', 'Ext', 'Form.xml');
  const commandDir = path.join(root, 'CommonCommands');
  await fs.mkdir(path.dirname(form), { recursive: true });
  await fs.mkdir(commandDir, { recursive: true });
  await fs.writeFile(form,
    '<Form><AutoCommandBar name="ФормаКоманднаяПанель" id="-1"><Autofill>false</Autofill></AutoCommandBar></Form>');
  await fs.writeFile(path.join(root, 'Documents', 'Order.xml'),
    '<MetaDataObject><Document><Properties><Name>Order</Name></Properties></Document></MetaDataObject>');
  await fs.writeFile(path.join(root, 'ConfigDumpInfo.xml'),
    '<ConfigDumpInfo><Metadata name="CommonCommand.History" id="1"/></ConfigDumpInfo>');
  await fs.writeFile(path.join(commandDir, 'History.xml'),
    '<MetaDataObject><CommonCommand><Properties><Name>History</Name><Group>FormCommandBarImportant</Group>'
    + '<ParameterType><v8:Type>cfg:DocumentRef.Order</v8:Type></ParameterType></Properties></CommonCommand></MetaDataObject>');
  const loaded = await (await FileLoader.create([root], 1024 * 1024)).load(form);
  assert.equal(loaded.commonCommands?.['@global:History'], undefined);
});

test('loads global commands for a Form-sourced button group inside an autofill-false bar', async (t) => {
  const root = await sandbox();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const form = path.join(root, 'Documents', 'Order', 'Forms', 'Card', 'Ext', 'Form.xml');
  const commandDir = path.join(root, 'CommonCommands');
  await fs.mkdir(path.dirname(form), { recursive: true });
  await fs.mkdir(commandDir, { recursive: true });
  await fs.writeFile(form, '<Form><AutoCommandBar name="ФормаКоманднаяПанель" id="-1"><Autofill>false</Autofill>'
    + '<ChildItems><ButtonGroup name="ФормаГлобальныеКоманды" id="10"><CommandSource>Form</CommandSource>'
    + '</ButtonGroup></ChildItems></AutoCommandBar></Form>');
  await fs.writeFile(path.join(root, 'Documents', 'Order.xml'),
    '<MetaDataObject><Document><Properties><Name>Order</Name></Properties></Document></MetaDataObject>');
  await fs.writeFile(path.join(root, 'ConfigDumpInfo.xml'),
    '<ConfigDumpInfo><Metadata name="CommonCommand.History" id="1"/></ConfigDumpInfo>');
  await fs.writeFile(path.join(commandDir, 'History.xml'),
    '<MetaDataObject><CommonCommand><Properties><Name>History</Name><Group>FormCommandBarImportant</Group>'
    + '<ParameterType><v8:Type>cfg:DocumentRef.Order</v8:Type></ParameterType></Properties></CommonCommand></MetaDataObject>');
  const loaded = await (await FileLoader.create([root], 1024 * 1024)).load(form);
  assert.match(loaded.commonCommands?.['@global:History'] || '', /CommonCommand/);
});

test('loads an applicable metadata-object command indexed by ConfigDumpInfo', async (t) => {
  const root = await sandbox();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const form = path.join(root, 'Documents', 'Order', 'Forms', 'Card', 'Ext', 'Form.xml');
  await fs.mkdir(path.dirname(form), { recursive: true });
  await fs.mkdir(path.join(root, 'CommonCommands'), { recursive: true });
  await fs.mkdir(path.join(root, 'DataProcessors'), { recursive: true });
  await fs.mkdir(path.join(root, 'DefinedTypes'), { recursive: true });
  await fs.writeFile(form, '<Form><AutoCommandBar><Autofill>false</Autofill><ChildItems>'
    + '<ButtonGroup><CommandSource>Form</CommandSource></ButtonGroup></ChildItems></AutoCommandBar></Form>');
  await fs.writeFile(path.join(root, 'Documents', 'Order.xml'),
    '<MetaDataObject><Document><Properties><Name>Order</Name></Properties></Document></MetaDataObject>');
  await fs.writeFile(path.join(root, 'ConfigDumpInfo.xml'), '<ConfigDumpInfo>'
    + '<Metadata name="DataProcessor.Payroll.Command.CreatePayment" id="1"/></ConfigDumpInfo>');
  await fs.writeFile(path.join(root, 'DefinedTypes', 'PaymentBase.xml'),
    '<DefinedType><Type><v8:Type>cfg:DocumentRef.Order</v8:Type></Type></DefinedType>');
  await fs.writeFile(path.join(root, 'DataProcessors', 'Payroll.xml'), '<MetaDataObject><DataProcessor><ChildObjects>'
    + '<Command><Properties><Name>CreatePayment</Name><Synonym><v8:item><v8:lang>ru</v8:lang>'
    + '<v8:content>Выплатить</v8:content></v8:item></Synonym><Group>FormCommandBarImportant</Group>'
    + '<CommandParameterType><v8:TypeSet>cfg:DefinedType.PaymentBase</v8:TypeSet></CommandParameterType>'
    + '<Representation>PictureAndText</Representation></Properties></Command></ChildObjects></DataProcessor></MetaDataObject>');
  const loaded = await (await FileLoader.create([root], 1024 * 1024)).load(form);
  const key = '@global-fqn:DataProcessor.Payroll.Command.CreatePayment';
  assert.match(loaded.commonCommands?.[key] || '', /Выплатить/);
});
test('loads a referenced CommonPicture resource from its Ext descriptor', async (t) => {
  const root = await sandbox();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const form = path.join(root, 'Documents', 'Order', 'Forms', 'Card', 'Ext', 'Form.xml');
  const pictureExt = path.join(root, 'CommonPictures', 'RefreshCustom', 'Ext');
  await fs.mkdir(path.dirname(form), { recursive: true });
  await fs.mkdir(path.join(pictureExt, 'Picture'), { recursive: true });
  await fs.writeFile(form, '<Form><ChildItems><Button><Picture><xr:Ref>CommonPicture.RefreshCustom</xr:Ref></Picture></Button></ChildItems></Form>');
  await fs.writeFile(path.join(pictureExt, 'Picture.xml'), '<ExtPicture><Picture><xr:Abs>Picture.png</xr:Abs></Picture></ExtPicture>');
  await fs.writeFile(path.join(pictureExt, 'Picture', 'Picture.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const loaded = await (await FileLoader.create([root], 1024 * 1024)).load(form);
  assert.deepEqual(loaded.commonPictures?.RefreshCustom, {
    mime: 'image/png', data: Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64'),
  });
});

test('loads the base cf form beside an extension cfe form', async (t) => {
  const root = await sandbox();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const suffix = path.join('Documents', 'Order', 'Forms', 'Card', 'Ext', 'Form.xml');
  const extension = path.join(root, 'cfe', 'MyExtension', suffix);
  const base = path.join(root, 'cf', suffix);
  await fs.mkdir(path.dirname(extension), { recursive: true });
  await fs.mkdir(path.dirname(base), { recursive: true });
  await fs.writeFile(extension, '<Form xmlns="http://v8.1c.ru/8.3/xcf/logform"><BaseForm/></Form>');
  await fs.writeFile(base, '<Form xmlns="http://v8.1c.ru/8.3/xcf/logform"><Commands/></Form>');
  const loader = await FileLoader.create([root], 1024 * 1024);
  const loaded = await loader.load(extension);
  assert.match(loaded.baseForm, /<Commands\/>/);
});

test('an extension finds its configuration by Configuration.xml in any layout', async (t) => {
  const root = await sandbox();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const extensionXml = '<MetaDataObject><Configuration><Properties>'
    + '<ConfigurationExtensionPurpose>Customization</ConfigurationExtensionPurpose></Properties>'
    + '<ChildObjects/></Configuration></MetaDataObject>';
  const suffix = path.join('Documents', 'Order', 'Forms', 'Card', 'Ext', 'Form.xml');
  const extensionRoot = path.join(root, 'extensions', 'MyExtension');
  const otherExtension = path.join(root, 'extensions', 'Other');
  const baseRoot = path.join(root, 'vendor', 'erp');
  const extension = path.join(extensionRoot, suffix);
  const base = path.join(baseRoot, suffix);
  await fs.mkdir(path.dirname(extension), { recursive: true });
  await fs.mkdir(path.dirname(base), { recursive: true });
  await fs.mkdir(path.join(otherExtension, 'Documents', 'Order', 'Forms', 'Card', 'Ext'), { recursive: true });
  await fs.writeFile(path.join(extensionRoot, 'Configuration.xml'), extensionXml);
  await fs.writeFile(path.join(otherExtension, 'Configuration.xml'), extensionXml);
  await fs.writeFile(path.join(otherExtension, suffix), '<Form>other</Form>');
  await fs.writeFile(path.join(baseRoot, 'Configuration.xml'), '<MetaDataObject><Configuration><ChildObjects/></Configuration></MetaDataObject>');
  await fs.writeFile(extension, '<Form xmlns="http://v8.1c.ru/8.3/xcf/logform"><BaseForm/></Form>');
  await fs.writeFile(base, '<Form xmlns="http://v8.1c.ru/8.3/xcf/logform"><Commands/></Form>');
  assert.deepEqual(await findBaseConfigurations(extensionRoot), [baseRoot]);
  const loaded = await (await FileLoader.create([root], 1024 * 1024)).load(extension);
  assert.match(loaded.baseForm, /<Commands\/>/);
  const confined = await (await FileLoader.create([extensionRoot], 1024 * 1024)).load(extension);
  assert.equal(confined.baseForm, '');
});

test('rejects traversal, directories, unsupported files and oversized files', async (t) => {
  const base = await sandbox();
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const root = path.join(base, 'allowed');
  await fs.mkdir(root);
  const outside = path.join(base, 'outside.xml');
  await fs.writeFile(outside, '<Form/>');
  await fs.writeFile(path.join(root, 'large.xml'), '12345');
  await fs.writeFile(path.join(root, 'note.txt'), 'hello');
  const loader = await FileLoader.create([root], 4);

  await assert.rejects(loader.load(outside), /outside the allowed roots/);
  await assert.rejects(loader.load(root), /not a file/);
  await assert.rejects(loader.load(path.join(root, 'large.xml')), /limit is 4/);
  const normalLoader = await FileLoader.create([root], 1024);
  await assert.rejects(normalLoader.load(path.join(root, 'note.txt')), /Unsupported file extension/);
});

test('rejects a symlink that escapes an allowed root', async (t) => {
  const base = await sandbox();
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const root = path.join(base, 'allowed');
  const outsideDirectory = path.join(base, 'outside');
  const outside = path.join(outsideDirectory, 'escape.xml');
  await fs.mkdir(root);
  await fs.mkdir(outsideDirectory);
  await fs.writeFile(outside, '<Form/>');
  const link = path.join(root, 'junction');
  await fs.symlink(outsideDirectory, link, process.platform === 'win32' ? 'junction' : 'dir');
  const loader = await FileLoader.create([root], 1024);
  await assert.rejects(loader.load(path.join(link, 'escape.xml')), /outside the allowed roots/);
});

test('opens a form when optional object metadata is outside the allowed root', async (t) => {
  const base = await sandbox();
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const forms = path.join(base, 'Object', 'Forms');
  const actual = path.join(forms, 'Card', 'Ext', 'Form.xml');
  await fs.mkdir(path.dirname(actual), { recursive: true });
  await fs.writeFile(actual, '<Form xmlns="http://v8.1c.ru/8.3/xcf/logform"/>');
  const loader = await FileLoader.create([forms], 1024);
  const loaded = await loader.load(actual);
  assert.equal(loaded.objectMeta, '');
});

test('explicit unrestricted mode loads an absolute path outside configured roots', async (t) => {
  const base = await sandbox();
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const outside = path.join(base, 'AnyForm.xml');
  await fs.writeFile(outside, '<Form xmlns="http://v8.1c.ru/8.3/xcf/logform"/>');
  const loader = await FileLoader.create([], 1024, process.cwd(), true);
  const loaded = await loader.load(outside);
  assert.equal(loaded.resolvedPath, await fs.realpath(outside));
});
