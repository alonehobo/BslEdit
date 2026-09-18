/* What the object window adds beyond the descriptor's own collections:
 * standard attributes, the references the object keeps (owners, register
 * records, input on basis) and the inverse ones the configuration scan finds
 * (registrars, subordinate catalogs, subsystems, subscriptions...). */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWebModules } from './helpers/dom.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sandbox = loadWebModules(root, ['xml-util.js', 'form-context.js', 'form-preview.js', 'metadata-preview.js',
  'metadata-relations.js', 'providers.js'], { TextDecoder, Uint8Array });
const MP = sandbox.MetadataPreview;
const FC = sandbox.FormContext;

const header = '<?xml version="1.0"?><MetaDataObject xmlns="http://v8.1c.ru/8.3/MDClasses" version="2.20">';

const documentXml = `${header}
<Document uuid="1"><Properties>
<Name>Приход</Name><Synonym/><Comment/>
<Numerator>DocumentNumerator.Склад</Numerator>
<RegisterRecords>
<xr:Item xsi:type="xr:MDObjectRef">AccumulationRegister.ТоварыНаСкладах</xr:Item>
</RegisterRecords>
</Properties><ChildObjects><Attribute><Properties><Name>Склад</Name>
<Type><v8:Type>cfg:CatalogRef.Склады</v8:Type></Type></Properties></Attribute></ChildObjects></Document></MetaDataObject>`;

const catalogXml = `${header}
<Catalog uuid="1"><Properties>
<Name>Упаковки</Name><Synonym/><Comment/>
<Hierarchical>false</Hierarchical>
<Owners><xr:Item xsi:type="xr:MDObjectRef">Catalog.Номенклатура</xr:Item></Owners>
<CodeLength>9</CodeLength><CodeType>String</CodeType><DescriptionLength>100</DescriptionLength>
<StandardAttributes>
<xr:StandardAttribute name="Ref"><xr:Synonym/></xr:StandardAttribute>
<xr:StandardAttribute name="Owner"><xr:Synonym/></xr:StandardAttribute>
<xr:StandardAttribute name="Parent"><xr:Synonym/></xr:StandardAttribute>
<xr:StandardAttribute name="IsFolder"><xr:Synonym/></xr:StandardAttribute>
<xr:StandardAttribute name="Code"><xr:Synonym/></xr:StandardAttribute>
<xr:StandardAttribute name="Description"><xr:Synonym/></xr:StandardAttribute>
</StandardAttributes>
</Properties><ChildObjects/></Catalog></MetaDataObject>`;

test('standard attributes follow the object settings and carry their types', () => {
  const { model } = MP.parse(catalogXml);
  const standard = model.groups[0];
  assert.equal(standard.title, 'Стандартные реквизиты');
  assert.deepEqual(Array.from(standard.items, (a) => [a.name, a.type]), [
    ['Ссылка', 'СправочникСсылка.Упаковки'],
    ['Владелец', 'СправочникСсылка.Номенклатура'],
    ['Код', 'Строка(9)'],
    ['Наименование', 'Строка(100)'],
  ], 'a flat catalog has no parent and no folders');
});

test('the references an object keeps are groups whose entries point at the source line', () => {
  const { model } = MP.parse(catalogXml);
  const owners = model.groups.find((g) => g.title === 'Владельцы');
  assert.equal(owners.items[0].name, 'Справочник.Номенклатура');
  assert.equal(owners.items[0].open, '', 'without a configuration root nothing opens');
  const items = MP.outline(model, catalogXml);
  const entry = items.find((i) => i.id === 'Owners:Catalog.Номенклатура');
  assert.equal(entry.refClass, 'Catalog');
  assert.match(catalogXml.split(/\r?\n/)[entry.line - 1], /Catalog\.Номенклатура/);

  const doc = MP.parse(documentXml).model;
  assert.deepEqual(Array.from(doc.groups, (g) => g.title),
    ['Реквизиты', 'Табличные части', 'Движения', 'Связанные объекты', 'Формы', 'Команды', 'Макеты']);
  const numerator = doc.groups.find((g) => g.title === 'Связанные объекты').items[0];
  assert.deepEqual([numerator.name, numerator.synonym], ['НумераторДокументов.Склад', 'Нумератор']);
  const info = MP.inspector(MP.outline(doc, documentXml).find((i) => i.id === 'Linked:DocumentNumerator.Склад'));
  assert.deepEqual(Array.from(info.rows, (r) => [r.label, r.value]), [
    ['Объект', 'НумераторДокументов.Склад'], ['Вид', 'Нумератор документов'], ['Свойство', 'Нумератор'],
  ]);
});

test('relations found in the configuration join the tree and open by full path', () => {
  const relations = {
    root: 'C:\\cf',
    groups: [
      { tag: 'Subordinates', title: 'Подчиненные справочники', single: true, items: [] },
      { tag: 'Subsystems', title: 'Подсистемы', single: true,
        items: [{ ref: 'Subsystem.Склад', title: 'Продажи / Склад', path: 'C:\\cf\\Subsystems\\Продажи\\Subsystems\\Склад.xml' }] },
      { tag: 'FunctionalOptions', title: 'Функциональные опции', single: true,
        items: [{ ref: 'FunctionalOption.Упаковки', path: 'C:\\cf\\FunctionalOptions\\Упаковки.xml',
          detail: ['TabularSection.Состав.Attribute.Вес'] }] },
    ],
    predefined: [{ name: 'Штука', code: '001', description: 'шт', depth: 0 }],
  };
  const { model } = MP.parse(catalogXml, { relations });
  assert.deepEqual(Array.from(model.groups, (g) => g.title), [
    'Стандартные реквизиты', 'Реквизиты', 'Табличные части', 'Предопределенные', 'Владельцы',
    'Формы', 'Команды', 'Макеты', 'Подсистемы', 'Функциональные опции',
  ], 'empty relation groups are hidden; where-listed groups go last');
  assert.equal(model.groups.find((g) => g.title === 'Владельцы').items[0].open, 'C:\\cf\\Catalogs\\Номенклатура.xml');
  const option = model.groups.find((g) => g.title === 'Функциональные опции').items[0];
  assert.deepEqual([option.name, option.synonym], ['Упаковки', 'Состав.Вес']);
  const info = MP.inspector(MP.outline(model, catalogXml).find((i) => i.id === 'Subsystems:Subsystem.Склад'));
  assert.equal(info.open, 'C:\\cf\\Subsystems\\Продажи\\Subsystems\\Склад.xml');
  assert.equal(info.rows[0].value, 'Продажи / Склад');
});

test('the md-links filter keeps the link lists of the properties and the child subsystems', () => {
  const text = '<A><Properties><Name>X</Name><Owners/><BasedOn><xr:Item>Document.Б</xr:Item></BasedOn>'
    + '<RegisterRecords><xr:Item>AccumulationRegister.Р</xr:Item></RegisterRecords></Properties>'
    + '<ChildObjects><Attribute><Type><v8:Type>xs:string</v8:Type></Type></Attribute><Subsystem>Опт</Subsystem></ChildObjects></A>';
  assert.equal(FC.filterText(text, 'md-links'), [
    '<BasedOn><xr:Item>Document.Б</xr:Item></BasedOn>',
    '<RegisterRecords><xr:Item>AccumulationRegister.Р</xr:Item></RegisterRecords>',
    '<Subsystem>Опт</Subsystem>',
  ].join('\n'), 'attribute types below ChildObjects are not the object\'s links');
});

test('the configuration scan inverts register records, owners, basis, subsystems and subscriptions', async () => {
  const withRecords = (name, extra) => documentXml.replace('<Name>Приход</Name>', `<Name>${name}</Name>${extra}`);
  const files = {
    'C:\\cf\\Configuration.xml': '<Configuration><ChildObjects><Subsystem>Продажи</Subsystem>'
      + '<Document>Приход</Document><Document>Расход</Document><Catalog>Номенклатура</Catalog>'
      + '<Catalog>Упаковки</Catalog><EventSubscription>ПриЗаписи</EventSubscription></ChildObjects></Configuration>',
    'C:\\cf\\Documents\\Приход.xml': documentXml,
    'C:\\cf\\Documents\\Расход.xml': withRecords('Расход', '<BasedOn><xr:Item>Document.Приход</xr:Item></BasedOn>'),
    'C:\\cf\\Catalogs\\Номенклатура.xml': catalogXml.replace('<Name>Упаковки</Name>', '<Name>Номенклатура</Name>')
      .replace(/<Owners>[\s\S]*?<\/Owners>/, '<Owners/>'),
    'C:\\cf\\Catalogs\\Упаковки.xml': catalogXml,
    'C:\\cf\\Subsystems\\Продажи.xml': '<Subsystem><Properties><Name>Продажи</Name><Content/></Properties>'
      + '<ChildObjects><Subsystem>Опт</Subsystem></ChildObjects></Subsystem>',
    'C:\\cf\\Subsystems\\Продажи\\Subsystems\\Опт.xml': '<Subsystem><Properties><Name>Опт</Name><Content>'
      + '<xr:Item xsi:type="xr:MDObjectRef">Catalog.Номенклатура</xr:Item></Content></Properties><ChildObjects/></Subsystem>',
    'C:\\cf\\EventSubscriptions\\ПриЗаписи.xml': '<EventSubscription><Properties><Name>ПриЗаписи</Name><Source>'
      + '<v8:Type>cfg:CatalogObject.Номенклатура</v8:Type><v8:Type>cfg:DocumentObject.Приход</v8:Type></Source>'
      + '</Properties></EventSubscription>',
    'C:\\cf\\Catalogs\\Номенклатура\\Ext\\Predefined.xml': '<PredefinedData><Item id="1"><Name>Услуга</Name>'
      + '<Code>1</Code><Description>Услуга</Description><IsFolder>true</IsFolder><ChildItems><Item id="2">'
      + '<Name>Доставка</Name><Code>2</Code><Description>Доставка</Description></Item></ChildItems></Item></PredefinedData>',
    'C:\\cf\\AccumulationRegisters\\ТоварыНаСкладах.xml': '<MetaDataObject/>',
  };
  const filters = new Set();
  const io = {
    readMany: async (paths, limit, filter) => {
      filters.add(filter);
      return paths.map((p) => (files[p] == null ? null : new Uint8Array(Buffer.from(files[p], 'utf8'))));
    },
  };
  const rel = sandbox.MetadataRelations.create(io, {});
  const titles = (r) => Object.fromEntries(r.groups.filter((g) => g.items.length)
    .map((g) => [g.title, Array.from(g.items, (i) => i.title || i.ref)]));

  const catalog = await rel.load('C:\\cf\\Catalogs\\Номенклатура.xml', 'Catalog', 'Номенклатура');
  assert.deepEqual(titles(catalog), {
    'Подчиненные справочники': ['Catalog.Упаковки'],
    'Подсистемы': ['Продажи / Опт'],
    'Подписки на события': ['EventSubscription.ПриЗаписи'],
  });
  assert.equal(catalog.groups.find((g) => g.title === 'Подсистемы').items[0].path,
    'C:\\cf\\Subsystems\\Продажи\\Subsystems\\Опт.xml');
  assert.deepEqual(Array.from(catalog.predefined, (p) => [p.name, p.depth, p.folder]),
    [['Услуга', 0, true], ['Доставка', 1, false]]);

  const register = await rel.load('C:\\cf\\AccumulationRegisters\\ТоварыНаСкладах.xml', 'AccumulationRegister', 'ТоварыНаСкладах');
  assert.deepEqual(titles(register), { 'Регистраторы': ['Document.Приход', 'Document.Расход'] });

  const document = await rel.load('C:\\cf\\Documents\\Приход.xml', 'Document', 'Приход');
  assert.deepEqual(titles(document), {
    'Является основанием для': ['Document.Расход'],
    'Подписки на события': ['EventSubscription.ПриЗаписи'],
  });
  assert.ok(filters.has('md-links'), 'descriptors are read cut down by the host');

  assert.equal(await rel.load('C:\\loose\\Приход.xml', 'Document', 'Приход'), null,
    'a descriptor outside a configuration export has no relations');
});

const rightsXml = '<Rights><setForNewObjects>false</setForNewObjects>'
  + '<object><name>Document.Приход</name>'
  + '<right><name>Read</name><value>true</value><restrictionByCondition><condition>#X</condition></restrictionByCondition></right>'
  + '<right><name>Delete</name><value>false</value></right>'
  + '<right><name>Posting</name><value>true</value></right></object>'
  + '<object><name>Catalog.Склады</name><right><name>Read</name><value>false</value></right></object>'
  + '<restrictionTemplate><name>Т</name><condition>...</condition></restrictionTemplate></Rights>';

test('the rights-summary filter keeps granted rights per object and marks RLS', () => {
  assert.equal(FC.filterText(rightsXml, 'rights-summary'), 'Document.Приход\tRead*,Posting',
    'an object with no granted right is left out');
  assert.equal(FC.filterText('Document.Приход	Read*,Posting', 'rights-summary'), 'Document.Приход	Read*,Posting',
    'a summary filtered again stays the same');
});

test('roles load on request and read only the matching role descriptors', async () => {
  const files = {
    'C:\\cf\\Configuration.xml': '<Configuration><ChildObjects><Role>Кладовщик</Role><Role>Бухгалтер</Role>'
      + '<Document>Приход</Document></ChildObjects></Configuration>',
    'C:\\cf\\Roles\\Кладовщик\\Ext\\Rights.xml': rightsXml,
    'C:\\cf\\Roles\\Бухгалтер\\Ext\\Rights.xml': rightsXml.replace('Document.Приход', 'Document.Расход'),
    'C:\\cf\\Roles\\Кладовщик.xml': '<Role><Properties><Name>Кладовщик</Name><Synonym><v8:item><v8:lang>ru</v8:lang>'
      + '<v8:content>Кладовщик &quot;склада&quot;</v8:content></v8:item></Synonym></Properties></Role>',
  };
  const read = [];
  const io = {
    readMany: async (paths, limit, filter) => {
      read.push(...paths.map((p) => p.split('\\').pop() + ':' + filter));
      return paths.map((p) => (files[p] == null ? null : new Uint8Array(Buffer.from(files[p], 'utf8'))));
    },
  };
  const rel = sandbox.MetadataRelations.create(io, {});
  await rel.load('C:\\cf\\Documents\\Приход.xml', 'Document', 'Приход');
  assert.ok(!read.some((r) => r.startsWith('Rights.xml')), 'opening the object reads no role');

  const roles = await rel.loadRoles('C:\\cf\\Documents\\Приход.xml', 'Document', 'Приход');
  assert.deepEqual(JSON.parse(JSON.stringify(roles)), [{
    role: 'Кладовщик', title: 'Кладовщик "склада"', path: 'C:\\cf\\Roles\\Кладовщик.xml',
    rights: [{ name: 'Read', restricted: true }, { name: 'Posting', restricted: false }],
  }]);
  assert.ok(!read.includes('Бухгалтер.xml:configuration-properties'), 'a role without rights is not read further');

  const [entry] = MP.rolesOutline(roles);
  assert.deepEqual([entry.title, entry.typeName], ['Кладовщик "склада"', '2 · RLS']);
  const info = MP.inspector(entry);
  assert.deepEqual(Array.from(info.rows, (r) => [r.label, r.value]),
    [['Чтение', 'Да, с ограничением (RLS)'], ['Проведение', 'Да']]);

  assert.deepEqual(Array.from(MP.rightsInOrder([
    { rights: [{ name: 'Posting' }, { name: 'CustomRight' }] }, { rights: [{ name: 'Read' }, { name: 'Posting' }] },
  ])), ['Read', 'Posting', 'CustomRight'], 'filter checkboxes follow the role editor order, unknown rights last');

  const before = read.length;
  await rel.loadRoles('C:\\cf\\Documents\\Приход.xml', 'Document', 'Приход');
  assert.equal(read.filter((r) => r.startsWith('Rights.xml')).length, 2, 'rights are read once per configuration');
  assert.ok(read.length > before, 'role descriptors of the object are read again (they are small)');
  assert.equal(await rel.loadRoles('C:\\epf\\Обработка.xml', 'ExternalDataProcessor', 'Обработка'), null);
});

test('external data processors and reports start no configuration scan', async () => {
  let reads = 0;
  const rel = sandbox.MetadataRelations.create({ readMany: async (paths) => { reads += paths.length; return []; } }, {});
  assert.equal(await rel.load('C:\\cf\\ExternalDataProcessors\\Загрузка.xml', 'ExternalDataProcessor', 'Загрузка'), null);
  assert.equal(await rel.load('C:\\epf\\Отчет\\Отчет.xml', 'ExternalReport', 'Отчет'), null);
  assert.equal(reads, 0, 'not even Configuration.xml is read');
});
