/* The object window for a metadata object's root XML: what it claims, the
 * structure and types it reads, and where its forms and templates live. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWebModules } from './helpers/dom.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sandbox = loadWebModules(root, ['xml-util.js', 'form-preview.js', 'metadata-preview.js', 'providers.js']);
const MP = sandbox.MetadataPreview;
const xml = fs.readFileSync(path.join(root, 'tests', 'fixtures', 'metadata', 'ЗагрузкаПрайса.xml'), 'utf8');

const header = '<?xml version="1.0"?><MetaDataObject xmlns="http://v8.1c.ru/8.3/MDClasses" version="2.20">';

test('claims an object descriptor, not form/template descriptors or the configuration', () => {
  assert.ok(MP.detect(xml));
  assert.equal(sandbox.PreviewProviders.detect(xml, { language: 'xml' }).id, 'metadata');
  assert.ok(!MP.detect(header + '<Form uuid="1"><Properties><Name>Ф</Name></Properties></Form></MetaDataObject>'));
  assert.ok(!MP.detect(header + '<Template uuid="1"><Properties><Name>М</Name></Properties></Template></MetaDataObject>'));
  assert.ok(!MP.detect(header + '<Configuration uuid="1"><Properties><Name>К</Name></Properties></Configuration></MetaDataObject>'));
  assert.ok(MP.detect(header + '<Catalog uuid="1"><Properties><Name>Номенклатура</Name></Properties></Catalog></MetaDataObject>'));
  assert.ok(!MP.detect('<Form xmlns="http://v8.1c.ru/8.3/xcf/logform"/>'));
});

test('reads the Designer tree with types as the Designer spells them', () => {
  const { model } = MP.parse(xml);
  assert.equal(model.kindTitle, 'Внешняя обработка');
  assert.equal(model.synonym, 'Загрузка прайса');
  assert.deepEqual(Array.from(model.groups, (g) => g.title), ['Реквизиты', 'Табличные части', 'Формы', 'Макеты']);
  const [attrs, sections, forms, templates] = model.groups;
  assert.deepEqual(Array.from(attrs.items, (a) => [a.name, a.type]), [
    ['Организация', 'СправочникСсылка.Организации'],
    ['ИмяФайла', 'Строка(неогр.)'],
  ]);
  assert.deepEqual(Array.from(sections.items[0].children, (a) => [a.name, a.type]), [
    ['Организация', 'Число(15, 2; неотрицательное)'],
    ['Дата', 'Дата(дата)'],
  ]);
  assert.equal(forms.items[0].open, 'Forms/Форма/Ext/Form.xml');
  assert.equal(templates.items[0].open, 'Templates/Макет/Ext/Template.xml');
  assert.deepEqual(Array.from(model.modules, (m) => m.open), ['Ext/ObjectModule.bsl']);
  assert.equal(model.forms[0].label, 'Основная форма');
  assert.equal(model.forms[0].formId, 'Form.Форма');
});

test('inspector lists the node and its non-empty properties in Russian', () => {
  const { model } = MP.parse(xml);
  const items = MP.outline(model, xml);
  const info = MP.inspector(items.find((i) => i.id === 'Attribute.Организация'));
  assert.deepEqual(Array.from(info.rows, (r) => [r.label, r.value]), [
    ['Имя', 'Организация'], ['Синоним', 'Организация'], ['Тип', 'СправочникСсылка.Организации'],
  ]);
  const other = info.groups.find((g) => g.label === 'Прочие свойства');
  assert.deepEqual(Array.from(other.items, (r) => [r.label, r.value]), [['Проверка заполнения', 'Выдавать ошибку']],
    'a nil MinValue is not shown');
  const form = MP.inspector(items.find((i) => i.id === 'Form.Форма'));
  assert.equal(form.open, 'Forms/Форма/Ext/Form.xml');
});

test('outline lines keep equal names in different sections apart', () => {
  const { model } = MP.parse(xml);
  const items = MP.outline(model, xml);
  const lines = xml.split(/\r?\n/);
  const top = items.find((i) => i.id === 'Attribute.Организация');
  const column = items.find((i) => i.id === 'TabularSection.Товары.Attribute.Организация');
  assert.ok(column.line > top.line);
  assert.match(lines[column.line - 1], /<Name>Организация<\/Name>/);
  assert.ok(lines[column.line - 3].includes('<Attribute') || lines[column.line - 2].includes('<Properties>'));
  assert.equal(column.depth, 2);
  assert.match(lines[items.find((i) => i.id === 'Form.Форма').line - 1], /<Form>Форма<\/Form>/);
});

const documentXml = `${header}
<Document uuid="1"><Properties>
<Name>Приход</Name><Synonym/><Comment/>
<NumberLength>11</NumberLength>
<Posting>Allow</Posting>
<InputByString><xr:Field>Document.Приход.StandardAttribute.Number</xr:Field></InputByString>
<RegisterRecords>
<xr:Item xsi:type="xr:MDObjectRef">AccumulationRegister.ТоварыНаСкладах</xr:Item>
<xr:Item xsi:type="xr:MDObjectRef">InformationRegister.Цены</xr:Item>
</RegisterRecords>
<DefaultObjectForm>Document.Приход.Form.ФормаДокумента</DefaultObjectForm>
</Properties><ChildObjects><Form>ФормаДокумента</Form></ChildObjects></Document></MetaDataObject>`;

test('a configuration document lists the Designer groups and its own properties', () => {
  const { model } = MP.parse(documentXml);
  assert.equal(model.kindTitle, 'Документ');
  assert.deepEqual(Array.from(model.groups, (g) => g.title),
    ['Реквизиты', 'Табличные части', 'Движения', 'Формы', 'Команды', 'Макеты'],
    'empty groups stay, as in the Designer; register records go before the forms');
  assert.deepEqual(Array.from(model.modules, (m) => m.open), ['Ext/ObjectModule.bsl', 'Ext/ManagerModule.bsl']);
  assert.equal(model.forms[0].formId, 'Form.ФормаДокумента');

  const items = MP.outline(model, documentXml);
  assert.equal(items[0].id, 'object', 'the object itself heads the outline');
  const info = MP.inspector(items[0]);
  const props = Object.fromEntries(Array.from(info.groups[0].items, (r) => [r.label, r.value]));
  assert.equal(props['Движения'], 'РегистрНакопления.ТоварыНаСкладах, РегистрСведений.Цены');
  assert.equal(props['Ввод по строке'], 'Номер');
  assert.equal(props['Проведение'], 'Разрешить');
});

test('sorting by name keeps the groups and sorts inside each of them', () => {
  const { model } = MP.parse(xml);
  const sorted = MP.outlineSortByName(MP.outline(model, xml));
  assert.deepEqual(Array.from(sorted, (i) => '  '.repeat(i.depth) + i.name), [
    'ЗагрузкаПрайса',
    'Реквизиты', '  ИмяФайла', '  Организация',
    'Табличные части', '  Товары', '    Дата', '    Организация',
    'Формы', '  Форма',
    'Макеты', '  Макет',
  ]);
});
