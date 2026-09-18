import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWebModules } from './helpers/dom.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FE = loadWebModules(root, ['form-edit.js']).window.FormEdit;
const plain = (v) => JSON.parse(JSON.stringify(v));

/* Designer layout: BOM-less here, CRLF, tabs, companions after properties. */
const form = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<Form xmlns="http://v8.1c.ru/8.3/xcf/logform" xmlns:v8="http://v8.1c.ru/8.1/data/core" version="2.20">',
  '\t<AutoCommandBar name="ФормаКоманднаяПанель" id="-1"/>',
  '\t<ChildItems>',
  '\t\t<UsualGroup name="Шапка" id="1">',
  '\t\t\t<Group>AlwaysHorizontal</Group>',
  '\t\t\t<ExtendedTooltip name="ШапкаРасширеннаяПодсказка" id="2"/>',
  '\t\t\t<ChildItems>',
  '\t\t\t\t<InputField name="Код" id="3">',
  '\t\t\t\t\t<DataPath>Объект.Code</DataPath>',
  '\t\t\t\t\t<Title>',
  '\t\t\t\t\t\t<v8:item>',
  '\t\t\t\t\t\t\t<v8:lang>ru</v8:lang>',
  '\t\t\t\t\t\t\t<v8:content>Код</v8:content>',
  '\t\t\t\t\t\t</v8:item>',
  '\t\t\t\t\t\t<v8:item>',
  '\t\t\t\t\t\t\t<v8:lang>en</v8:lang>',
  '\t\t\t\t\t\t\t<v8:content>Code</v8:content>',
  '\t\t\t\t\t\t</v8:item>',
  '\t\t\t\t\t</Title>',
  '\t\t\t\t\t<ContextMenu name="КодКонтекстноеМеню" id="4"/>',
  '\t\t\t\t\t<ExtendedTooltip name="КодРасширеннаяПодсказка" id="5"/>',
  '\t\t\t\t</InputField>',
  '\t\t\t</ChildItems>',
  '\t\t</UsualGroup>',
  '\t\t<Pages name="Страницы" id="6">',
  '\t\t\t<ExtendedTooltip name="СтраницыРасширеннаяПодсказка" id="7"/>',
  '\t\t\t<ChildItems>',
  '\t\t\t\t<Page name="Основное" id="8">',
  '\t\t\t\t\t<ExtendedTooltip name="ОсновноеРасширеннаяПодсказка" id="9"/>',
  '\t\t\t\t</Page>',
  '\t\t\t</ChildItems>',
  '\t\t</Pages>',
  '\t\t<InputField name="Наименование" id="10">',
  '\t\t\t<DataPath>Объект.Description</DataPath>',
  '\t\t\t<ContextMenu name="НаименованиеКонтекстноеМеню" id="11"/>',
  '\t\t\t<ExtendedTooltip name="НаименованиеРасширеннаяПодсказка" id="12"/>',
  '\t\t\t<Events>',
  '\t\t\t\t<Event name="OnChange">НаименованиеПриИзменении</Event>',
  '\t\t\t</Events>',
  '\t\t</InputField>',
  '\t</ChildItems>',
  '\t<Commands>',
  '\t\t<Command name="Обновить" id="1">',
  '\t\t\t<Action>Обновить</Action>',
  '\t\t</Command>',
  '\t</Commands>',
  '</Form>',
].join('\r\n');

test('set_properties inserts scalar nodes before the companions and resets them back byte for byte', () => {
  const set = FE.setProperties(form, { element: 'Наименование', properties: { Width: 20, HorizontalStretch: true } });
  assert.deepEqual(plain(set.result.changed), ['Width', 'HorizontalStretch']);
  assert.match(set.xml, /<DataPath>Объект\.Description<\/DataPath>\r\n\t\t\t<Width>20<\/Width>\r\n\t\t\t<HorizontalStretch>true<\/HorizontalStretch>\r\n\t\t\t<ContextMenu/);
  const reset = FE.setProperties(set.xml, { element: 'Наименование', properties: { Width: null, HorizontalStretch: null } });
  assert.equal(reset.xml, form);
});

test('set_properties replaces an existing value in place and reports no change when equal', () => {
  const r = FE.setProperties(form, { element: 'Шапка', properties: { Group: 'Vertical' } });
  assert.equal(r.xml, form.replace('<Group>AlwaysHorizontal</Group>', '<Group>Vertical</Group>'));
  assert.deepEqual(plain(FE.setProperties(form, { element: 'Шапка', properties: { Group: 'AlwaysHorizontal' } }).result.changed), []);
});

test('a multilingual title keeps the other languages; an object sets several', () => {
  const ru = FE.setProperties(form, { element: 'Код', properties: { Title: 'Артикул' } }).xml;
  assert.match(ru, /<v8:content>Артикул<\/v8:content>/);
  assert.match(ru, /<v8:content>Code<\/v8:content>/);
  const both = FE.setProperties(form, { element: 'Наименование', properties: { Title: { ru: 'Имя', en: 'Name' } } }).xml;
  assert.match(both, /\t\t\t<Title>\r\n\t\t\t\t<v8:item>\r\n\t\t\t\t\t<v8:lang>ru<\/v8:lang>\r\n\t\t\t\t\t<v8:content>Имя<\/v8:content>/);
  const noEn = FE.setProperties(form, { element: 'Код', properties: { Title: { en: null } } }).xml;
  assert.doesNotMatch(noEn, /Code<\/v8:content>/);
});

test('form-level properties go to the root before its structure nodes', () => {
  const r = FE.setProperties(form, { properties: { AutoTitle: false } });
  assert.match(r.xml, /version="2\.20">\r\n\t<AutoTitle>false<\/AutoTitle>\r\n\t<AutoCommandBar/);
});

test('set_properties rejects structure nodes and unknown elements', () => {
  assert.throws(() => FE.setProperties(form, { element: 'Код', properties: { ContextMenu: 1 } }), /состава/);
  assert.throws(() => FE.setProperties(form, { element: 'Нет', properties: { Visible: false } }), /нет элемента/);
  assert.throws(() => FE.setProperties(form, { element: 'Код', properties: {} }), /properties/);
});

test('the property dictionary checks values and orders new nodes', () => {
  const sandbox = loadWebModules(root, ['form-edit.js']).window;
  sandbox.FormItemProperties = { kinds: { InputField: {
    order: ['DataPath', 'Title', 'Width', 'HorizontalStretch', 'ContextMenu', 'ExtendedTooltip', 'Events'],
    props: { DataPath: { kind: 'string' }, Title: { kind: 'localString' }, Width: { kind: 'number' }, HorizontalStretch: { kind: 'boolean' },
      TitleLocation: { kind: 'enum', values: ['Auto', 'Left', 'Top', 'None'] }, Font: { kind: 'complex' } },
  } } };
  const D = sandbox.FormEdit;
  assert.throws(() => D.setProperties(form, { element: 'Код', properties: { Width: 'wide' } }), /числовое/);
  assert.throws(() => D.setProperties(form, { element: 'Код', properties: { TitleLocation: 'Middle' } }), /Допустимо: Auto/);
  assert.throws(() => D.setProperties(form, { element: 'Код', properties: { Font: 'x' } }), /Составное/);
  assert.throws(() => D.setProperties(form, { element: 'Код', properties: { Bogus: 1 } }), /нет свойства Bogus/);
  const ordered = D.setProperties(form, { element: 'Код', properties: { Width: 5 } }).xml;
  assert.match(ordered, /<\/Title>\r\n\t\t\t\t\t<Width>5<\/Width>\r\n\t\t\t\t\t<ContextMenu/);
});

test('move_element re-indents the item, creates and drops ChildItems as needed', () => {
  const into = FE.moveElement(form, { element: 'Код', into: 'Основное' });
  assert.equal(plain(into.result).from, 'Шапка');
  assert.doesNotMatch(into.xml, /<ExtendedTooltip name="ШапкаРасширеннаяПодсказка" id="2"\/>\r\n\t\t\t<ChildItems>/, 'the emptied ChildItems is removed');
  assert.match(into.xml, /\t\t\t\t\t<ExtendedTooltip name="ОсновноеРасширеннаяПодсказка" id="9"\/>\r\n\t\t\t\t\t<ChildItems>\r\n\t\t\t\t\t\t<InputField name="Код" id="3">\r\n\t\t\t\t\t\t\t<DataPath>/);
  const back = FE.moveElement(into.xml, { element: 'Код', into: 'Шапка' });
  assert.equal(back.xml, form, 'moving back restores the file');
});

test('move_element orders by after/before and refuses impossible targets', () => {
  const first = FE.moveElement(form, { element: 'Наименование', before: 'Шапка' });
  assert.ok(first.xml.indexOf('name="Наименование"') < first.xml.indexOf('name="Шапка"'));
  assert.equal(FE.moveElement(first.xml, { element: 'Наименование', after: 'Страницы' }).xml, form);
  assert.equal(plain(FE.moveElement(form, { element: 'Страницы', after: 'Шапка' }).result).moved, false);
  assert.throws(() => FE.moveElement(form, { element: 'Шапка', into: 'Шапка' }), /внутрь самого себя/);
  assert.throws(() => FE.moveElement(form, { element: 'Основное', into: 'Шапка' }), /не может содержать Page/);
  assert.throws(() => FE.moveElement(form, { element: 'Код', into: 'Страницы' }), /не может содержать InputField/);
  assert.throws(() => FE.moveElement(form, { element: 'Код', into: 'Шапка', after: 'Наименование' }), /лежит не в/);
  assert.throws(() => FE.moveElement(form, { element: 'КодКонтекстноеМеню', into: 'Шапка' }), /не элемент формы/);
});

test('remove_element drops the item with companions and reports module handlers', () => {
  const r = FE.removeElement(form, { element: 'Наименование' });
  assert.doesNotMatch(r.xml, /Наименование/);
  assert.equal(r.result.removedNodes, 3);
  assert.deepEqual(plain(r.result.orphanHandlers), ['НаименованиеПриИзменении']);
  const group = FE.removeElement(form, { element: 'Шапка' });
  assert.equal(group.result.removedNodes, 5);
  assert.match(group.xml, /\t<ChildItems>\r\n\t\t<Pages name="Страницы"/);
});

test('remove_element refuses while a standard command refers to the item unless forced', () => {
  const withRef = form.replace('\t<AutoCommandBar name="ФормаКоманднаяПанель" id="-1"/>',
    '\t<AutoCommandBar name="ФормаКоманднаяПанель" id="-1">\r\n\t\t<ChildItems>\r\n\t\t\t<Button name="Добавить" id="20">\r\n\t\t\t\t<CommandName>Form.Item.Код.StandardCommand.Add</CommandName>\r\n\t\t\t\t<ExtendedTooltip name="ДобавитьРасширеннаяПодсказка" id="21"/>\r\n\t\t\t</Button>\r\n\t\t</ChildItems>\r\n\t</AutoCommandBar>');
  assert.throws(() => FE.removeElement(withRef, { element: 'Шапка' }), /ссылаются: CommandName Form\.Item\.Код/);
  const forced = FE.removeElement(withRef, { element: 'Шапка', force: true });
  assert.equal(plain(forced.result.references).length, 1);
});

test('list_elements gives the item tree without companions', () => {
  const list = plain(FE.listElements(form));
  assert.equal(list.version, '2.20');
  assert.deepEqual(list.elements.map((e) => [e.name, e.kind, e.parent, e.depth]), [
    ['Шапка', 'UsualGroup', 'Form', 0], ['Код', 'InputField', 'Шапка', 1],
    ['Страницы', 'Pages', 'Form', 0], ['Основное', 'Page', 'Страницы', 1],
    ['Наименование', 'InputField', 'Form', 0],
  ]);
});

test('a broken file is refused before any edit', () => {
  assert.throws(() => FE.listElements('<Form><ChildItems></Form>'), /повреждён/);
  assert.throws(() => FE.listElements('<document/>'), /не управляемая форма/);
});

test('add_element writes the item with its companions from the right id pool', () => {
  const r = FE.addElement(form, { element: 'Комментарий', kind: 'InputField', into: 'Шапка', after: 'Код', properties: { DataPath: 'Объект.Comment', Title: 'Комментарий', MultiLine: true } });
  assert.deepEqual(plain(r.result), {
    element: 'Комментарий', kind: 'InputField', id: 13, into: 'Шапка',
    companions: ['КомментарийКонтекстноеМеню', 'КомментарийРасширеннаяПодсказка'],
    note: 'Обработчики событий и модуль формы не изменялись.',
  });
  assert.match(r.xml, /<\/InputField>\r\n\t\t\t\t<InputField name="Комментарий" id="13">\r\n\t\t\t\t\t<DataPath>Объект\.Comment<\/DataPath>\r\n\t\t\t\t\t<Title>/);
  assert.match(r.xml, /<MultiLine>true<\/MultiLine>\r\n\t\t\t\t\t<ContextMenu name="КомментарийКонтекстноеМеню" id="14"\/>\r\n\t\t\t\t\t<ExtendedTooltip name="КомментарийРасширеннаяПодсказка" id="15"\/>\r\n\t\t\t\t<\/InputField>/);
  assert.deepEqual(plain(FE.listElements(r.xml).elements).map((e) => e.name), ['Шапка', 'Код', 'Комментарий', 'Страницы', 'Основное', 'Наименование']);
});

test('add_element builds a table with all six companions and an English-named item in English', () => {
  const table = FE.addElement(form, { element: 'Товары', kind: 'Table' });
  assert.deepEqual(plain(table.result.companions), [
    'ТоварыКонтекстноеМеню', 'ТоварыКоманднаяПанель', 'ТоварыРасширеннаяПодсказка',
    'ТоварыСтрокаПоиска', 'ТоварыСостояниеПросмотра', 'ТоварыУправлениеПоиском',
  ]);
  const latin = FE.addElement(form, { element: 'Goods', kind: 'Table' });
  assert.deepEqual(plain(latin.result.companions), [
    'GoodsContextMenu', 'GoodsCommandBar', 'GoodsExtendedTooltip',
    'GoodsSearchString', 'GoodsViewStatus', 'GoodsSearchControl',
  ]);
});

test('add_element creates ChildItems, respects containers and refuses duplicates', () => {
  const page = FE.addElement(form, { element: 'Итого', kind: 'LabelDecoration', into: 'Основное' });
  assert.match(page.xml, /<ExtendedTooltip name="ОсновноеРасширеннаяПодсказка" id="9"\/>\r\n\t\t\t\t\t<ChildItems>\r\n\t\t\t\t\t\t<LabelDecoration name="Итого" id="13">/);
  assert.throws(() => FE.addElement(form, { element: 'Код', kind: 'InputField' }), /уже есть элемент/);
  assert.throws(() => FE.addElement(form, { element: 'Новое', kind: 'Widget' }), /kind — вид элемента/);
  assert.throws(() => FE.addElement(form, { element: 'Новое', kind: 'InputField', into: 'Страницы' }), /не может содержать InputField/);
  assert.throws(() => FE.addElement(form, { element: 'Новая', kind: 'Page', into: 'Шапка' }), /не может содержать Page/);
  assert.throws(() => FE.addElement(form, { element: 'не имя!', kind: 'InputField' }), /идентификатор 1С/);
});

test('add_element warns when a button points at a command the form has not got', () => {
  const ok = FE.addElement(form, { element: 'КнопкаОбновить', kind: 'Button', into: 'ФормаКоманднаяПанель', properties: { CommandName: 'Form.Command.Обновить' } });
  assert.equal(plain(ok.result).warnings, undefined);
  const missing = FE.addElement(form, { element: 'КнопкаПечать', kind: 'Button', into: 'ФормаКоманднаяПанель', properties: { CommandName: 'Form.Command.Печать' } });
  assert.match(plain(missing.result).warnings[0], /Команды формы «Печать» нет/);
});

test('set_attribute writes Designer-shaped types and their qualifiers', () => {
  const number = FE.setAttribute(form, { name: 'СуммаИтого', type: 'number(15,2,nonnegative)', title: { ru: 'Итого', en: 'Total' }, saved_data: true });
  assert.match(number.xml, /\t<Attributes>\r\n\t\t<Attribute name="СуммаИтого" id="1">\r\n\t\t\t<Title>/);
  assert.match(number.xml, /<\/Title>\r\n\t\t\t<Type>\r\n\t\t\t\t<v8:Type>xs:decimal<\/v8:Type>\r\n\t\t\t\t<v8:NumberQualifiers>\r\n\t\t\t\t\t<v8:Digits>15<\/v8:Digits>\r\n\t\t\t\t\t<v8:FractionDigits>2<\/v8:FractionDigits>\r\n\t\t\t\t\t<v8:AllowedSign>Nonnegative<\/v8:AllowedSign>\r\n\t\t\t\t<\/v8:NumberQualifiers>\r\n\t\t\t<\/Type>\r\n\t\t\t<SavedData>true<\/SavedData>/);
  const text = FE.setAttribute(form, { name: 'Комментарий', type: 'string' }).xml;
  assert.match(text, /<v8:Type>xs:string<\/v8:Type>\r\n\t\t\t\t<v8:StringQualifiers>\r\n\t\t\t\t\t<v8:Length>0<\/v8:Length>\r\n\t\t\t\t\t<v8:AllowedLength>Variable<\/v8:AllowedLength>/);
  assert.match(FE.setAttribute(form, { name: 'Код', type: 'string(9,fixed)' }).xml, /<v8:Length>9<\/v8:Length>\r\n\t\t\t\t\t<v8:AllowedLength>Fixed</);
  assert.match(FE.setAttribute(form, { name: 'Дата', type: 'dateTime' }).xml, /<v8:Type>xs:dateTime<\/v8:Type>\r\n\t\t\t\t<v8:DateQualifiers>\r\n\t\t\t\t\t<v8:DateFractions>DateTime</);
  assert.match(FE.setAttribute(form, { name: 'Флаг', type: 'boolean' }).xml, /<Type>\r\n\t\t\t\t<v8:Type>xs:boolean<\/v8:Type>\r\n\t\t\t<\/Type>/);
  assert.match(FE.setAttribute(form, { name: 'Склад', type: 'CatalogRef.Склады' }).xml, /<v8:Type>cfg:CatalogRef\.Склады<\/v8:Type>/);
  assert.match(FE.setAttribute(form, { name: 'Партнёр', type: 'DefinedType.Партнёр' }).xml, /<v8:TypeSet>cfg:DefinedType\.Партнёр<\/v8:TypeSet>/);
  assert.match(FE.setAttribute(form, { name: 'Значение', type: 'string(10) | number(5,0) | CatalogRef.Склады' }).xml,
    /<v8:Type>xs:string<\/v8:Type>\r\n\t\t\t\t<v8:Type>xs:decimal<\/v8:Type>\r\n\t\t\t\t<v8:Type>cfg:CatalogRef\.Склады<\/v8:Type>\r\n\t\t\t\t<v8:NumberQualifiers>/);
  assert.throws(() => FE.setAttribute(form, { name: 'Плохой', type: 'строкаЧего' }), /Непонятный тип/);
  assert.throws(() => FE.setAttribute(form, { name: 'Плохой' }), /передайте type/);
});

test('set_attribute changes and removes an attribute, refusing while a data path uses it', () => {
  const created = FE.setAttribute(form, { name: 'Склад', type: 'CatalogRef.Склады' }).xml;
  const retyped = FE.setAttribute(created, { name: 'Склад', type: 'DocumentRef.Заказ' });
  assert.deepEqual(plain(retyped.result.changed), ['Type']);
  assert.match(retyped.xml, /<v8:Type>cfg:DocumentRef\.Заказ<\/v8:Type>/);
  /* Designer keeps an empty <Attributes/> in real configurations but never an
   * empty <Commands>. */
  /* The cfg prefix the type needed stays declared: another value may use it. */
  const declared = form.replace('<Form xmlns=', '<Form xmlns:cfg="http://v8.1c.ru/8.1/data/enterprise/current-config" xmlns=');
  assert.equal(FE.setAttribute(retyped.xml, { name: 'Склад', remove: true }).xml, declared.replace('\t<Commands>', '\t<Attributes/>\r\n\t<Commands>'));
  const used = FE.setAttribute(form, { name: 'Объект', type: 'CatalogObject.Товары', main: true }).xml;
  assert.throws(() => FE.setAttribute(used, { name: 'Объект', remove: true }), /На реквизит «Объект» ссылаются: DataPath Объект\.Code/);
  assert.equal(plain(FE.setAttribute(used, { name: 'Объект', remove: true, force: true }).result).removed, true);
});

test('set_command writes the command in schema order and refuses removal while a button uses it', () => {
  const r = FE.setCommand(form, { name: 'Печать', action: 'ПечатьКоманда', title: 'Печать', tooltip: { ru: 'Напечатать' }, shortcut: 'Ctrl+P', representation: 'TextPicture', modifies_saved_data: true, current_row_use: 'DontUse' });
  assert.match(r.xml, /<Command name="Печать" id="2">\r\n\t\t\t<Title>/);
  assert.match(r.xml, /<\/ToolTip>\r\n\t\t\t<Shortcut>Ctrl\+P<\/Shortcut>\r\n\t\t\t<Action>ПечатьКоманда<\/Action>\r\n\t\t\t<Representation>TextPicture<\/Representation>\r\n\t\t\t<ModifiesSavedData>true<\/ModifiesSavedData>\r\n\t\t\t<CurrentRowUse>DontUse<\/CurrentRowUse>/);
  assert.equal(FE.setCommand(r.xml, { name: 'Печать', remove: true }).xml, form);
  assert.throws(() => FE.setCommand(form, { name: 'Печать', representation: 'Круглая' }), /Допустимо: Auto, Text/);
  const button = FE.addElement(form, { element: 'КнопкаОбновить', kind: 'Button', into: 'ФормаКоманднаяПанель', properties: { CommandName: 'Form.Command.Обновить' } }).xml;
  assert.throws(() => FE.setCommand(button, { name: 'Обновить', remove: true }), /ссылаются: CommandName Form\.Command\.Обновить/);
});

test('a type prefix the form has not declared is added to the root', () => {
  const r = FE.setAttribute(form, { name: 'Склад', type: 'CatalogRef.Склады' });
  assert.match(r.xml, /<Form xmlns:cfg="http:\/\/v8\.1c\.ru\/8\.1\/data\/enterprise\/current-config" xmlns="http:\/\/v8\.1c\.ru\/8\.3\/xcf\/logform"/);
  const declared = FE.setAttribute(r.xml, { name: 'Второй', type: 'CatalogRef.Организации' });
  assert.equal((declared.xml.match(/xmlns:cfg=/g) || []).length, 1, 'declared once');
});

test('colors, fonts and pictures are written as Designer writes them', () => {
  const r = FE.setProperties(form, { element: 'Код', properties: {
    TextColor: 'style:ПоясняющийТекст',
    BackColor: '#EEEEEE',
    Font: { ref: 'style:NormalTextFont', height: 11, bold: true },
    Picture: 'CommonPicture.ЗаполнитьПоШаблону',
  } });
  assert.deepEqual(plain(r.result.changed), ['TextColor', 'BackColor', 'Font', 'Picture']);
  assert.match(r.xml, /<TextColor>style:ПоясняющийТекст<\/TextColor>/);
  assert.match(r.xml, /<BackColor>#EEEEEE<\/BackColor>/);
  assert.match(r.xml, /<Font ref="style:NormalTextFont" height="11" bold="true" kind="StyleItem"\/>/);
  assert.match(r.xml, /<Picture>\r\n\t\t\t\t\t\t<xr:Ref>CommonPicture\.ЗаполнитьПоШаблону<\/xr:Ref>\r\n\t\t\t\t\t\t<xr:LoadTransparent>false<\/xr:LoadTransparent>\r\n\t\t\t\t\t<\/Picture>/);
  const absolute = FE.setProperties(form, { element: 'Код', properties: { Font: { face: 'Arial', height: 10, italic: false } } });
  assert.match(absolute.xml, /<Font faceName="Arial" height="10" italic="false" kind="Absolute" scale="100"\/>/);
  assert.equal(FE.setProperties(r.xml, { element: 'Код', properties: { TextColor: null, BackColor: null, Font: null, Picture: null } }).xml, form);
});

test('a malformed color, font or picture is refused', () => {
  assert.throws(() => FE.setProperties(form, { element: 'Код', properties: { TextColor: 'красный' } }), /Непонятный цвет/);
  assert.throws(() => FE.setProperties(form, { element: 'Код', properties: { Font: 'жирный' } }), /Шрифт Font — объект/);
  assert.throws(() => FE.setProperties(form, { element: 'Код', properties: { Font: { height: 11 } } }), /укажите ref .* или face/);
  assert.throws(() => FE.setProperties(form, { element: 'Код', properties: { Picture: 'Картинка' } }), /Непонятная картинка/);
  assert.throws(() => FE.setProperties(form, { element: 'Код', properties: { ChoiceList: ['а'] } }), /список выбора/);
});

test('a table attribute gets columns numbered inside the attribute', () => {
  const r = FE.setAttribute(form, { name: 'Товары', type: 'ValueTable', columns: [
    { name: 'Номенклатура', type: 'CatalogRef.Номенклатура', title: 'Номенклатура' },
    { name: 'Количество', type: 'number(15,3,nonnegative)' },
  ] });
  assert.deepEqual(plain(r.result.changed), ['Columns(Номенклатура, Количество)']);
  assert.match(r.xml, /<Type>\r\n\t\t\t\t<v8:Type>v8:ValueTable<\/v8:Type>\r\n\t\t\t<\/Type>\r\n\t\t\t<Columns>\r\n\t\t\t\t<Column name="Номенклатура" id="1">\r\n\t\t\t\t\t<Title>/);
  assert.match(r.xml, /<Column name="Количество" id="2">\r\n\t\t\t\t\t<Type>\r\n\t\t\t\t\t\t<v8:Type>xs:decimal<\/v8:Type>\r\n\t\t\t\t\t\t<v8:NumberQualifiers>/);

  const second = FE.setAttribute(r.xml, { name: 'Прочее', type: 'ValueTable', columns: [{ name: 'Значение', type: 'string' }] });
  assert.match(second.xml, /<Column name="Значение" id="1">/, 'the column counter is per attribute');

  const changed = FE.setAttribute(r.xml, { name: 'Товары', columns: [
    { name: 'Номенклатура', type: 'CatalogRef.Склады' },
    { name: 'Количество', remove: true },
  ] });
  assert.match(changed.xml, /<Column name="Номенклатура" id="1">[\s\S]*<v8:Type>cfg:CatalogRef\.Склады<\/v8:Type>/);
  assert.doesNotMatch(changed.xml, /Количество/);
  assert.throws(() => FE.setAttribute(form, { name: 'Товары', type: 'ValueTable', columns: [{ name: 'Нет' }] }), /передайте type/);
  assert.throws(() => FE.setAttribute(form, { name: 'Товары', type: 'ValueTable', columns: {} }), /columns — массив/);
});

test('a value equal to the schema default is written as no node at all', () => {
  const sandbox = loadWebModules(root, ['form-edit.js']).window;
  sandbox.FormItemProperties = { kinds: { InputField: {
    order: ['DataPath', 'Visible', 'Width', 'ContextMenu', 'ExtendedTooltip'],
    props: { Visible: { kind: 'boolean', default: 'true' }, Width: { kind: 'number', default: '0' } },
  } } };
  const D = sandbox.FormEdit;
  assert.deepEqual(plain(D.setProperties(form, { element: 'Код', properties: { Visible: true } }).result.changed), [],
    'the platform drops such a node on its next save, so writing one only makes a diff');
  const hidden = D.setProperties(form, { element: 'Код', properties: { Visible: false } });
  assert.match(hidden.xml, /<Visible>false<\/Visible>/);
  assert.deepEqual(plain(D.setProperties(hidden.xml, { element: 'Код', properties: { Visible: true } }).result.changed), ['Visible']);
  assert.equal(D.setProperties(hidden.xml, { element: 'Код', properties: { Visible: true } }).xml, form);
});

test('a new section lands where Designer keeps it, before CommandInterface', () => {
  const withInterface = form.replace('\t<Commands>', '\t<CommandInterface>\r\n\t\t<NavigationPanel/>\r\n\t</CommandInterface>\r\n\t<Commands>')
    .replace(/\t<Commands>\r\n\t\t<Command name="Обновить" id="1">\r\n\t\t\t<Action>Обновить<\/Action>\r\n\t\t<\/Command>\r\n\t<\/Commands>\r\n/, '');
  const r = FE.setCommand(withInterface, { name: 'Печать', action: 'ПечатьКоманда' });
  assert.ok(r.xml.indexOf('<Commands>') < r.xml.indexOf('<CommandInterface>'), 'Commands precedes CommandInterface');
});

test('a multilingual node lists ru before en whatever order the caller used', () => {
  const r = FE.setProperties(form, { element: 'Наименование', properties: { Title: { en: 'Name', ru: 'Имя' } } });
  assert.match(r.xml, /<Title>\r\n\t\t\t\t<v8:item>\r\n\t\t\t\t\t<v8:lang>ru<\/v8:lang>\r\n\t\t\t\t\t<v8:content>Имя<\/v8:content>\r\n\t\t\t\t<\/v8:item>\r\n\t\t\t\t<v8:item>\r\n\t\t\t\t\t<v8:lang>en<\/v8:lang>/);
});

test('a picture name outside the platform library is refused', () => {
  const sandbox = loadWebModules(root, ['form-edit.js']).window;
  sandbox.FormPreview = { stdPictureRu: { Information: 'Информация', Write: 'Записать' } };
  const D = sandbox.FormEdit;
  assert.match(D.setProperties(form, { element: 'Код', properties: { Picture: 'StdPicture.Information' } }).xml, /StdPicture\.Information/);
  assert.throws(() => D.setProperties(form, { element: 'Код', properties: { Picture: 'StdPicture.Information32' } }),
    /нет «Information32»/, 'the platform refuses the whole file for one bad name');
  assert.match(D.setProperties(form, { element: 'Код', properties: { Picture: 'CommonPicture.ЧтоУгодно' } }).xml, /CommonPicture\.ЧтоУгодно/);
});
