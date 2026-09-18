import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWebModules } from './helpers/dom.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadFormPreview() {
  return loadWebModules(root, ['xml-util.js', 'form-preview.js'], { CSS: { escape: (s) => String(s) } }).window.FormPreview;
}

const FP = loadFormPreview();
const T = FP._test;
const fixture = fs.readFileSync(path.join(root, 'testdata', 'Форма.xml'), 'utf8');

test('detects managed Form.xml', () => {
  assert.equal(FP.detect(fixture), true);
  assert.equal(FP.detect('<?xml version="1.0"?><Catalog/>'), false);
});

test('itemKey prefers id over name', () => {
  assert.equal(FP.itemKey({ id: '11', name: 'Номер' }), '11');
  assert.equal(FP.itemKey({ id: '', name: 'Номер' }), 'Номер');
});

test('form attribute types have concise 1C presentations', () => {
  assert.equal(T.typePresentation('cfg:CatalogRef.Номенклатура'), 'СправочникСсылка.Номенклатура');
  assert.equal(T.typePresentation('xs:string, xs:decimal'), 'Строка, Число');
  assert.equal(T.typePresentation('String(20)'), 'Строка(20)');
  assert.equal(T.typePresentation('Number(15, 2)'), 'Число(15, 2)');
  assert.equal(T.typePresentation('Boolean'), 'Булево');
  assert.equal(T.typePresentation('Date'), 'Дата');
  assert.equal(T.typePresentation('v8ui:FormattedString'), 'ФорматированнаяСтрока');
  assert.equal(T.typePresentation('v8:ValueList'), 'СписокЗначений');
  assert.equal(T.typePresentation('core:UndefinedValue'), 'Неопределено');
  assert.equal(T.typePresentation('cfg:DefinedType.КурсВалюты'), 'ОпределяемыйТип.КурсВалюты');
  assert.equal(T.typePresentation('Functional options'), 'Функциональные опции');
  assert.equal(T.typePresentation('FunctionalOption.ПоддержкаБанковскогоИКазначейскогоСопровожденияГосконтрактов'),
    'ФункциональнаяОпция.ПоддержкаБанковскогоИКазначейскогоСопровожденияГосконтрактов');
  assert.equal(T.typePresentation('cfg:FunctionalOption.ПоддержкаБанковскогоИКазначейскогоСопровожденияГосконтрактов'),
    'ФункциональнаяОпция.ПоддержкаБанковскогоИКазначейскогоСопровожденияГосконтрактов');
  assert.equal(T.typePresentation('cfg:Document.Order'), 'Документ.Order');
  assert.equal(T.typePresentation('cfg:ExternalReportObject.Report'), 'ВнешнийОтчетОбъект.Report');
  assert.equal(T.typePresentation('custom:SomeType'), 'custom:SomeType');
});

test('defined type sets use the translated value type in attribute presentation', () => {
  assert.equal(T.attributeTypeName({
    typeRefs: '',
    typeDescription: { types: [], typeSets: ['cfg:DefinedType.КурсВалюты'] },
    properties: { Type: 'cfg:DefinedType.КурсВалюты' }
  }), 'ОпределяемыйТип.КурсВалюты');
});

test('form outline exposes a bound field type without qualifier noise', () => {
  const xml = `<Form xmlns="http://v8.1c.ru/8.3/xcf/logform" xmlns:v8="http://v8.1c.ru/8.1/data/core">
    <ChildItems><InputField name="Товар" id="7"><DataPath>Объект.Товар</DataPath></InputField></ChildItems>
    <Attributes><Attribute name="Объект"><MainAttribute>true</MainAttribute></Attribute>
      <Attribute name="Товар"><Type><v8:Type>cfg:CatalogRef.Номенклатура</v8:Type>
        <v8:StringQualifiers><v8:Length>20</v8:Length></v8:StringQualifiers></Type></Attribute>
    </Attributes></Form>`;
  const parsed = FP.parse(xml);
  assert.ok(!parsed.error, parsed.error);
  const item = FP.outline(parsed.model, xml).find((entry) => entry.id === '7');
  assert.equal(item.typeName, 'СправочникСсылка.Номенклатура');
});

test('form attribute outline icons reflect the resolved value type', () => {
  const icon = (typeName) => JSON.parse(JSON.stringify(T.attributeIcon(typeName)));
  assert.deepEqual(icon('Строка(20)'), { cls: 'icon-form-in', icon: 'forms' });
  assert.deepEqual(icon('Число(15, 2)'), { cls: 'icon-form-number', ch: '123' });
  assert.deepEqual(icon('Дата (дата и время)'), { cls: 'icon-form-pg', icon: 'calendar' });
  assert.deepEqual(icon('Булево'), { cls: 'icon-form-chk', icon: 'checkbox' });
  assert.deepEqual(icon('СправочникСсылка.Номенклатура'), {
    cls: 'icon-form-attr', icon: 'tag', asset: 'platform-type-catalog.png'
  });
  assert.deepEqual(icon('ДокументОбъект.Заказ'), {
    cls: 'icon-form-attr', icon: 'tag', asset: 'platform-type-document-object.png'
  });
  assert.deepEqual(icon('ПеречислениеСсылка.Вид'), {
    cls: 'icon-form-attr', icon: 'tag', asset: 'platform-type-enum.png'
  });
  assert.deepEqual(icon('НеизвестныйТип'), { cls: 'icon-form-etc', icon: 'box' });
});

test('a painted descendant overhang raises the owning horizontal track minimum', () => {
  assert.equal(T.horizontalPaintedTrackMinimum(22, 412, 459), 437);
  assert.equal(T.horizontalPaintedTrackMinimum(420, 740, 740), 320);
});

test('element inspector places the bound value type after DataPath', () => {
  const xml = `<Form xmlns="http://v8.1c.ru/8.3/xcf/logform" xmlns:v8="http://v8.1c.ru/8.1/data/core">
    <ChildItems><InputField name="Товар" id="7"><DataPath>Объект.Товар</DataPath></InputField></ChildItems>
    <Attributes><Attribute name="Объект"><MainAttribute>true</MainAttribute></Attribute>
      <Attribute name="Товар"><Type><v8:Type>cfg:CatalogRef.Номенклатура</v8:Type></Type></Attribute></Attributes></Form>`;
  const parsed = FP.parse(xml);
  const entry = FP.outline(parsed.model, xml).find((item) => item.id === '7');
  const info = FP.elementInspector(entry);
  assert.deepEqual(JSON.parse(JSON.stringify(info.rows.map((row) => [row.label, row.value]))), [
    ['Путь к данным', 'Объект.Товар'],
    ['Тип', 'СправочникСсылка.Номенклатура']
  ]);
});

test('form outline keeps meaningful string, number and date qualifiers', () => {
  const xml = `<Form xmlns="http://v8.1c.ru/8.3/xcf/logform" xmlns:v8="http://v8.1c.ru/8.1/data/core">
    <ChildItems>
      <InputField name="Code" id="1"><DataPath>Code</DataPath></InputField>
      <InputField name="Amount" id="2"><DataPath>Amount</DataPath></InputField>
      <InputField name="Moment" id="3"><DataPath>Moment</DataPath></InputField>
    </ChildItems><Attributes>
      <Attribute name="Code"><Type><v8:Type>xs:string</v8:Type><v8:StringQualifiers><v8:Length>100</v8:Length></v8:StringQualifiers></Type></Attribute>
      <Attribute name="Amount"><Type><v8:Type>xs:decimal</v8:Type><v8:NumberQualifiers><v8:Digits>15</v8:Digits><v8:FractionDigits>2</v8:FractionDigits><v8:AllowedSign>Any</v8:AllowedSign></v8:NumberQualifiers></Type></Attribute>
      <Attribute name="Moment"><Type><v8:Type>xs:dateTime</v8:Type><v8:DateQualifiers><v8:DateFractions>DateTime</v8:DateFractions></v8:DateQualifiers></Type></Attribute>
    </Attributes></Form>`;
  const parsed = FP.parse(xml);
  assert.ok(!parsed.error, parsed.error);
  const items = FP.outline(parsed.model, xml);
  assert.equal(items.find((entry) => entry.id === '1').typeName, 'Строка(100)');
  assert.equal(items.find((entry) => entry.id === '2').typeName, 'Число(15, 2)');
  assert.equal(items.find((entry) => entry.id === '3').typeName, 'Дата(дата и время)');
});

test('attribute outline is separate from form elements and carries inspector data', () => {
  const xml = `<Form xmlns="http://v8.1c.ru/8.3/xcf/logform" xmlns:v8="http://v8.1c.ru/8.1/data/core">
    <ChildItems><InputField name="Amount" id="7"><DataPath>Amount</DataPath></InputField></ChildItems>
    <Attributes><Attribute name="Amount" id="10"><Type><v8:Type>xs:decimal</v8:Type>
      <v8:NumberQualifiers><v8:Digits>15</v8:Digits><v8:FractionDigits>2</v8:FractionDigits></v8:NumberQualifiers></Type>
      <FillChecking>ShowError</FillChecking></Attribute></Attributes></Form>`;
  const parsed = FP.parse(xml);
  const elements = FP.outline(parsed.model, xml);
  const attributes = FP.attributeOutline(parsed.model, xml);
  assert.equal(elements.some((item) => item.tag === 'Attribute'), false);
  assert.equal(attributes.length, 1);
  assert.equal(attributes[0].id, 'attribute:10');
  assert.equal(attributes[0].typeName, 'Число(15, 2)');
  assert.equal(attributes[0].itemKind, 'attribute');
  assert.ok(attributes[0].line > 1);
});

test('attribute inspector labels authored values honestly without a base form', () => {
  const xml = `<Form xmlns="http://v8.1c.ru/8.3/xcf/logform" xmlns:v8="http://v8.1c.ru/8.1/data/core"><Attributes>
    <Attribute name="Code"><Type><v8:Type>xs:string</v8:Type><v8:StringQualifiers><v8:Length>20</v8:Length></v8:StringQualifiers></Type>
      <MainAttribute>true</MainAttribute></Attribute></Attributes></Form>`;
  const parsed = FP.parse(xml);
  const info = FP.attributeInspector(FP.attributeOutline(parsed.model, xml)[0]);
  assert.equal(info.heading, 'Заданные свойства');
  assert.equal(info.typeName, 'Строка(20)');
  assert.deepEqual(JSON.parse(JSON.stringify(info.rows.map((row) => [row.label, row.value]))), [
    ['Тип', 'Строка(20)'], ['Основной реквизит', 'Да']
  ]);
});

test('attribute inspector shows only differences when a matching base attribute exists', () => {
  const extension = `<Form xmlns="http://v8.1c.ru/8.3/xcf/logform" xmlns:v8="http://v8.1c.ru/8.1/data/core"><Attributes>
    <Attribute name="Code"><Type><v8:Type>xs:string</v8:Type><v8:StringQualifiers><v8:Length>40</v8:Length></v8:StringQualifiers></Type>
      <MainAttribute>true</MainAttribute></Attribute></Attributes><BaseForm/></Form>`;
  const base = `<Form xmlns="http://v8.1c.ru/8.3/xcf/logform" xmlns:v8="http://v8.1c.ru/8.1/data/core"><Attributes>
    <Attribute name="Code"><Type><v8:Type>xs:string</v8:Type><v8:StringQualifiers><v8:Length>20</v8:Length></v8:StringQualifiers></Type>
      <MainAttribute>true</MainAttribute></Attribute></Attributes></Form>`;
  const parsed = FP.parse(extension, '', {}, base);
  const info = FP.attributeInspector(FP.attributeOutline(parsed.model, extension)[0]);
  assert.equal(info.heading, 'Изменённые свойства');
  assert.deepEqual(JSON.parse(JSON.stringify(info.rows.map((row) => [row.label, row.before, row.value]))), [
    ['Тип', 'Строка(20)', 'Строка(40)']
  ]);
});

test('element inspector exposes every XML-authored property of a highlighted field', () => {
  const xml = `<Form xmlns="http://v8.1c.ru/8.3/xcf/logform"><ChildItems>
    <InputField name="Статус" id="28">
      <TitleFont ref="style:NormalTextFont" bold="true" italic="false" underline="false" strikeout="false" kind="StyleItem"/>
      <EditMode>EnterOnInput</EditMode><AutoMaxWidth>false</AutoMaxWidth><MaxWidth>31</MaxWidth><BackColor>#FFFF99</BackColor>
      <ContextMenu name="СтатусКонтекстноеМеню" id="29"/><ExtendedTooltip name="СтатусРасширеннаяПодсказка" id="30"/>
    </InputField></ChildItems></Form>`;
  const parsed = FP.parse(xml);
  const entry = FP.outline(parsed.model, xml).find((item) => item.id === '28');
  const info = FP.elementInspector(entry);
  assert.equal(info.heading, 'Заданные свойства');
  assert.deepEqual(JSON.parse(JSON.stringify(info.rows.map((row) => [row.label, row.value, row.color]))), [
    ['Шрифт заголовка', 'style:NormalTextFont; жирный', ''],
    ['Режим редактирования', 'При вводе', ''],
    ['Автомаксимальная ширина', 'Нет', ''],
    ['Максимальная ширина', '31', ''],
    ['Цвет фона', '#FFFF99', '#FFFF99']
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(info.groups.map((group) => group.label))), [
    'Шрифт заголовка', 'Связанные объекты'
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(info.groups[0].items)), [
    { label: 'Вид', value: 'Элемент стиля' },
    { label: 'Ссылка на стиль', value: 'style:NormalTextFont' },
    { label: 'Жирный', value: 'Да' },
    { label: 'Курсив', value: 'Нет' },
    { label: 'Подчёркивание', value: 'Нет' },
    { label: 'Зачёркивание', value: 'Нет' }
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(info.groups[1].items)), [
    { label: 'Контекстное меню', value: 'СтатусКонтекстноеМеню' },
    { label: 'Расширенная подсказка', value: 'СтатусРасширеннаяПодсказка' }
  ]);
});

test('element inspector marks declared event handlers as form-module links', () => {
  const xml = `<Form xmlns="http://v8.1c.ru/8.3/xcf/logform"><ChildItems>
    <Button name="Open" id="1"><Events>
      <Event name="Click">  ОткрытьФорму  </Event>
      <Event name="OnChange"></Event>
    </Events></Button></ChildItems></Form>`;
  const parsed = FP.parse(xml);
  const entry = FP.outline(parsed.model, xml).find((item) => item.id === '1');
  const info = FP.elementInspector(entry);
  const events = info.groups.find((group) => group.label === 'События (2)');
  assert.equal(events.open, true);
  assert.deepEqual(JSON.parse(JSON.stringify(events.items)), [
    { label: 'Нажатие', value: 'ОткрытьФорму', link: 'form-handler', handler: 'ОткрытьФорму' },
    { label: 'ПриИзменении', value: 'Обработчик не указан', link: '', handler: '' }
  ]);
});

test('element inspector shows the procedure called by a custom command button', () => {
  const xml = `<Form xmlns="http://v8.1c.ru/8.3/xcf/logform"><AutoCommandBar><ChildItems>
    <Button name="RunAction" id="1"><CommandName>Form.Command.Run</CommandName></Button>
  </ChildItems></AutoCommandBar><Commands><Command name="Run" id="1">
    <Title>Выполнить</Title><Action>Run</Action>
  </Command></Commands></Form>`;
  const parsed = FP.parse(xml);
  const entry = FP.outline(parsed.model, xml).find((item) => item.id === '1');
  const command = FP.elementInspector(entry).groups.find((group) => group.label === 'Команда');
  assert.equal(command.open, true);
  assert.deepEqual(JSON.parse(JSON.stringify(command.items)), [
    { label: 'Обработчик', value: 'Run', link: 'form-handler', handler: 'Run' }
  ]);
});

test('element inspector translates the complete known event catalog and preserves unknown names', () => {
  const names = [
    'OnCreateAtServer', 'OnOpen', 'BeforeClose', 'OnClose', 'BeforeWrite',
    'BeforeWriteAtServer', 'OnWriteAtServer', 'AfterWriteAtServer', 'AfterWrite',
    'OnReadAtServer', 'NotificationProcessing', 'ChoiceProcessing', 'NewWriteProcessing',
    'NewObjectWriteProcessing', 'ActivationProcessing', 'RefreshRequestProcessing',
    'FillCheckProcessing', 'OnChange',
    'StartChoice', 'Choice', 'ValueChoice', 'AutoComplete', 'Clearing', 'Opening',
    'Click', 'TextEditEnd', 'OnStartEdit', 'OnEditEnd', 'BeforeEditEnd',
    'Selection', 'OnActivateRow', 'OnActivateField', 'OnActivateCell', 'OnActivateColumn',
    'OnCurrentPageChange', 'OnCurrentParentChange', 'OnRowOutput', 'OnDataGet',
    'OnCheckChange', 'BeforeRowChange', 'BeforeAddRow', 'BeforeDeleteRow',
    'AfterDeleteRow', 'AfterDeleteLine', 'BeforeExpand', 'BeforeCollapse', 'StartDrag',
    'DragStart', 'DragCheck', 'Drag', 'DragEnd', 'Drop', 'OnPeriodOutput', 'UnknownEvent'
  ];
  const xml = `<Form xmlns="http://v8.1c.ru/8.3/xcf/logform"><ChildItems><Button name="All" id="1"><Events>${
    names.map((name) => `<Event name="${name}"></Event>`).join('')
  }</Events></Button></ChildItems></Form>`;
  const parsed = FP.parse(xml);
  const entry = FP.outline(parsed.model, xml).find((item) => item.id === '1');
  const events = FP.elementInspector(entry).groups.find((group) => group.label === `События (${names.length})`);
  const labels = events.items.map((item) => item.label);
  assert.deepEqual(JSON.parse(JSON.stringify(labels)), [
    'ПриСозданииНаСервере', 'ПриОткрытии', 'ПередЗакрытием', 'ПриЗакрытии',
    'ПередЗаписью', 'ПередЗаписьюНаСервере', 'ПриЗаписиНаСервере',
    'ПослеЗаписиНаСервере', 'ПослеЗаписи', 'ПриЧтенииНаСервере',
    'ОбработкаОповещения', 'ОбработкаВыбора', 'ОбработкаЗаписиНового',
    'ОбработкаЗаписиНовогоОбъекта', 'ОбработкаАктивизации', 'ОбработкаЗапросаОбновления',
    'ОбработкаПроверкиЗаполнения', 'ПриИзменении', 'НачалоВыбора',
    'Выбор', 'ВыборЗначения', 'АвтоПодбор', 'Очистка', 'Открытие', 'Нажатие',
    'ОкончаниеВводаТекста', 'ПриНачалеРедактирования', 'ПриОкончанииРедактирования',
    'ПередОкончаниемРедактирования', 'Выбор',
    'ПриАктивизацииСтроки', 'ПриАктивизацииПоля', 'ПриАктивизацииЯчейки', 'ПриАктивизацииКолонки',
    'ПриСменеСтраницы', 'ПриСменеТекущегоРодителя', 'ПриВыводеСтроки',
    'ПриПолученииДанных', 'ПриИзмененииФлажка', 'ПередНачаломИзменения',
    'ПередНачаломДобавления', 'ПередУдалением', 'ПослеУдаления', 'ПослеУдаления',
    'ПередРазворачиванием', 'ПередСворачиванием', 'НачалоПеретаскивания', 'НачалоПеретаскивания', 'ПроверкаПеретаскивания',
    'Перетаскивание', 'ОкончаниеПеретаскивания', 'ОкончаниеПеретаскивания',
    'ПриВыводеПериода', 'UnknownEvent'
  ]);
});

test('checkboxes and buttons do not stretch by default', () => {
  const cb = { tag: 'CheckBoxField', properties: {} };
  const btn = { tag: 'Button', properties: {} };
  const input = { tag: 'InputField', properties: {} };
  assert.equal(T.wantsHStretch(cb, 'CheckBoxField', null), false);
  assert.equal(T.wantsHStretch(btn, 'Button', null), false);
  assert.equal(T.wantsHStretch(input, 'InputField', null), false);
  assert.equal(T.compactTag('CheckBoxField'), true);
});

test('explicit HorizontalStretch true still stretches', () => {
  const group = { properties: { HorizontalStretch: 'true' } };
  assert.equal(T.wantsHStretch(group, 'UsualGroup', null), true);
  const packed = { properties: { HorizontalStretch: 'false' } };
  assert.equal(T.wantsHStretch(packed, 'UsualGroup', null), false);
});

test('attribute TypeDescription preserves type sets, ids and every qualifier', () => {
  const xml = `<Form xmlns="http://v8.1c.ru/8.3/xcf/logform" xmlns:v8="http://v8.1c.ru/8.1/data/core">
    <Attributes><Attribute name="Value" id="1"><Type>
      <v8:Type>xs:string</v8:Type><v8:Type>xs:decimal</v8:Type>
      <v8:TypeSet>cfg:DefinedType.Contact</v8:TypeSet>
      <v8:TypeId>12345678-1234-1234-1234-123456789012</v8:TypeId>
      <v8:StringQualifiers><v8:Length>40</v8:Length><v8:AllowedLength>Fixed</v8:AllowedLength></v8:StringQualifiers>
      <v8:NumberQualifiers><v8:Digits>15</v8:Digits><v8:FractionDigits>3</v8:FractionDigits><v8:AllowedSign>Any</v8:AllowedSign></v8:NumberQualifiers>
      <v8:DateQualifiers><v8:DateFractions>DateTime</v8:DateFractions></v8:DateQualifiers>
      <v8:BinaryDataQualifiers><v8:Length>128</v8:Length><v8:AllowedLength>Variable</v8:AllowedLength></v8:BinaryDataQualifiers>
    </Type></Attribute></Attributes><ChildItems/></Form>`;
  const parsed = FP.parse(xml);
  assert.ok(!parsed.error, parsed.error);
  const attribute = parsed.model.attributes[0];
  assert.deepEqual(JSON.parse(JSON.stringify(attribute.typeDescription)), {
    types: ['xs:string', 'xs:decimal'],
    typeSets: ['cfg:DefinedType.Contact'],
    typeIds: ['12345678-1234-1234-1234-123456789012'],
    stringQualifiers: { length: '40', allowedLength: 'Fixed' },
    numberQualifiers: { digits: '15', fractionDigits: '3', allowedSign: 'Any' },
    dateQualifiers: { dateFractions: 'DateTime' },
    binaryDataQualifiers: { length: '128', allowedLength: 'Variable' },
  });
  assert.equal(attribute.typeRefs, 'xs:string, xs:decimal');
  assert.equal(attribute.stringLen, 40);
});

test('InputField keeps complex authored values as structured XML', () => {
  const xml = `<Form xmlns="http://v8.1c.ru/8.3/xcf/logform" xmlns:v8="http://v8.1c.ru/8.1/data/core" xmlns:xr="http://v8.1c.ru/8.3/xcf/readable" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xs="http://www.w3.org/2001/XMLSchema">
    <ChildItems><InputField name="Customer" id="4">
      <AvailableTypes><v8:Type>cfg:CatalogRef.Customers</v8:Type><v8:TypeSet>cfg:DefinedType.Partner</v8:TypeSet></AvailableTypes>
      <ChoiceParameterLinks><xr:item name="Company" mode="Clear"><xr:dataPath>Object.Company</xr:dataPath></xr:item></ChoiceParameterLinks>
      <ChoiceParameters><v8:item><v8:name>Filter.Owner</v8:name><v8:value xsi:type="xs:string">Main</v8:value></v8:item><v8:item><v8:name>Filter.Limit</v8:name><v8:value><v8:value xsi:type="xs:decimal">10</v8:value></v8:value></v8:item></ChoiceParameters>
      <MinValue xsi:type="xs:decimal">0.00</MinValue><MaxValue xsi:type="xs:decimal">999.99</MaxValue>
      <TypeLink><xr:pathItem>Object</xr:pathItem><xr:pathItem>Kind</xr:pathItem><xr:linkItem>1</xr:linkItem></TypeLink>
      <ChoiceButtonPicture><xr:Ref>StdPicture.InputFieldChoice</xr:Ref></ChoiceButtonPicture>
    </InputField></ChildItems></Form>`;
  const parsed = FP.parse(xml);
  assert.ok(!parsed.error, parsed.error);
  const field = parsed.model.childItemsRoot[0];
  const complex = field.complexProperties;
  assert.equal(field.structuredProperties, complex);
  assert.equal(complex.AvailableTypes.children[0].name, 'v8:Type');
  assert.equal(complex.AvailableTypes.children[1].text, 'cfg:DefinedType.Partner');
  assert.deepEqual(JSON.parse(JSON.stringify(complex.ChoiceParameterLinks.children[0].attributes)),
    { name: 'Company', mode: 'Clear' });
  assert.equal(complex.ChoiceParameterLinks.children[0].children[0].text, 'Object.Company');
  assert.equal(complex.MinValue.attributes['xsi:type'], 'xs:decimal');
  assert.equal(complex.MinValue.text, '0.00');
  assert.deepEqual(JSON.parse(JSON.stringify(complex.TypeLink.children.map((child) => child.text))),
    ['Object', 'Kind', '1']);
  assert.equal(parsed.model.childItemsRoot[0].properties.ChoiceButtonPicture,
    'StdPicture.InputFieldChoice');
  assert.deepEqual(JSON.parse(JSON.stringify(field.runtime.choiceParameterLinks)), [
    { name: 'Company', mode: 'Clear', dataPath: 'Object.Company' },
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(field.runtime.choiceParameters)), [
    { name: 'Filter.Owner', value: 'Main', type: 'xs:string' },
    { name: 'Filter.Limit', value: '10', type: 'xs:decimal' },
  ]);
});

test('all owner types keep complex authored values beside renderer projections', () => {
  const xml = `<Form xmlns="http://v8.1c.ru/8.3/xcf/logform" xmlns:v8="http://v8.1c.ru/8.1/data/core" xmlns:xr="http://v8.1c.ru/8.3/xcf/readable" xmlns:v8ui="http://v8.1c.ru/8.1/data/ui" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
    <ChildItems>
      <CalendarField name="Calendar" id="1">
        <UserVisible><xr:Common>false</xr:Common><xr:Value name="Role.Editor">true</xr:Value></UserVisible>
        <CommandSet><ExcludedCommand>CalendarCommand.Today</ExcludedCommand><ExcludedCommand>CalendarCommand.Month</ExcludedCommand></CommandSet>
        <BeginOfRepresentationPeriod>2026-01-01T00:00:00</BeginOfRepresentationPeriod>
        <FooterPicture><xr:Ref>CommonPicture.Warning</xr:Ref><xr:LoadTransparent>false</xr:LoadTransparent></FooterPicture>
        <Border width="1"><v8ui:style xsi:type="v8ui:ControlBorderType">WithoutBorder</v8ui:style></Border>
      </CalendarField>
      <Table name="Rows" id="2">
        <UserVisible><xr:Common>false</xr:Common></UserVisible>
        <Period><v8:variant xsi:type="v8:StandardPeriodVariant">Custom</v8:variant></Period>
        <TopLevelParent xsi:nil="true"/><RowFilter xsi:nil="true"/>
        <SearchStringAddition name="RowsSearch" id="4">
          <AdditionSource><Item>Rows</Item><Type>SearchStringRepresentation</Type></AdditionSource>
          <Source xsi:nil="true"/>
        </SearchStringAddition>
      </Table>
      <RadioButtonField name="Choice" id="3">
        <ChoiceList><Item><Presentation>One</Presentation></Item></ChoiceList>
      </RadioButtonField>
    </ChildItems></Form>`;
  const parsed = FP.parse(xml);
  assert.ok(!parsed.error, parsed.error);
  const [calendar, table, radio] = parsed.model.childItemsRoot;
  assert.equal(calendar.properties.ExcludedCommands[0], 'CalendarCommand.Today');
  assert.equal(calendar.structuredProperties.CommandSet.children[0].text, 'CalendarCommand.Today');
  assert.equal(calendar.structuredProperties.CommandSet.children[1].text, 'CalendarCommand.Month');
  assert.equal(calendar.structuredProperties.BeginOfRepresentationPeriod.text, '2026-01-01T00:00:00');
  assert.equal(calendar.structuredProperties.UserVisible.children[1].attributes.name, 'Role.Editor');
  assert.equal(calendar.structuredProperties.FooterPicture.children[0].name, 'xr:Ref');
  assert.equal(calendar.structuredProperties.FooterPicture.children[1].text, 'false');
  assert.equal(calendar.structuredProperties.Border.attributes.width, '1');
  assert.equal(calendar.structuredProperties.Border.children[0].attributes['xsi:type'], 'v8ui:ControlBorderType');
  assert.equal(table.structuredProperties.UserVisible.children[0].text, 'false');
  assert.equal(table.structuredProperties.Period.children[0].attributes['xsi:type'], 'v8:StandardPeriodVariant');
  assert.equal(table.structuredProperties.TopLevelParent.attributes['xsi:nil'], 'true');
  assert.equal(table.structuredProperties.RowFilter.attributes['xsi:nil'], 'true');
  assert.equal(table.runtime.period.active, false);
  assert.equal(table.runtime.rowFilter.active, false);
  assert.deepEqual(JSON.parse(JSON.stringify(calendar.runtime.footerPicture)),
    { ref: 'CommonPicture.Warning', loadTransparent: false });
  assert.deepEqual(JSON.parse(JSON.stringify(calendar.runtime.border)),
    { width: 1, style: 'WithoutBorder' });
  assert.deepEqual(Array.from(table.searchStringAddition.structuredProperties.AdditionSource.children,
    (child) => child.text), ['Rows', 'SearchStringRepresentation']);
  assert.equal(table.searchStringAddition.structuredProperties.Source.attributes['xsi:nil'], 'true');
  assert.deepEqual(Array.from(radio.properties.ChoiceListItems), ['One']);
  assert.equal(radio.structuredProperties.ChoiceList.children[0].name, 'Item');
});

test('structured runtime activates only meaningful table state and normalizes pictures', () => {
  const xml = `<Form xmlns="http://v8.1c.ru/8.3/xcf/logform" xmlns:v8="http://v8.1c.ru/8.1/data/core" xmlns:xr="http://v8.1c.ru/8.3/xcf/readable" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
    <CreateButtonsGroupPicture><xr:Ref>StdPicture.Create</xr:Ref></CreateButtonsGroupPicture>
    <ChildItems>
      <Table name="Default" id="1"><Period><v8:variant xsi:type="v8:StandardPeriodVariant">Custom</v8:variant><v8:beginDate>0001-01-01T00:00:00+05:00</v8:beginDate><v8:endDate>0001-01-01T00:00:00</v8:endDate></Period><RowFilter xsi:nil="true"/></Table>
      <Table name="Active" id="2"><Period><v8:variant xsi:type="v8:StandardPeriodVariant">Custom</v8:variant><v8:beginDate>2026-09-01T00:00:00</v8:beginDate></Period><RowFilter><v8:item name="Status"><v8:value>Open</v8:value></v8:item></RowFilter></Table>
      <UsualGroup name="PictureGroup" id="3"><BackPicture><xr:Ref>CommonPicture.Background</xr:Ref><xr:LoadTransparent>true</xr:LoadTransparent></BackPicture><ChildItems><LabelDecoration name="Text" id="4"><Title>Text</Title></LabelDecoration></ChildItems></UsualGroup>
    </ChildItems></Form>`;
  const parsed = FP.parse(xml);
  assert.ok(!parsed.error, parsed.error);
  const [defaultTable, activeTable, group] = parsed.model.childItemsRoot;
  assert.equal(defaultTable.runtime.period.active, false);
  assert.equal(defaultTable.runtime.rowFilter.active, false);
  assert.equal(activeTable.runtime.period.active, true);
  assert.equal(activeTable.runtime.period.begin, '2026-09-01T00:00:00');
  assert.equal(activeTable.runtime.rowFilter.active, true);
  assert.deepEqual(JSON.parse(JSON.stringify(group.runtime.backPicture)),
    { ref: 'CommonPicture.Background', loadTransparent: true });
  assert.deepEqual(JSON.parse(JSON.stringify(parsed.model.runtime.createButtonsGroupPicture)),
    { ref: 'StdPicture.Create', loadTransparent: null });
});

test('the Form root uses the same structured complex-property reader', () => {
  const xml = `<Form xmlns="http://v8.1c.ru/8.3/xcf/logform" xmlns:v8="http://v8.1c.ru/8.1/data/core">
    <MobileDeviceCommandBarContent><v8:item><v8:value>Save</v8:value></v8:item></MobileDeviceCommandBarContent>
    <CommandSet><ExcludedCommand>Form.Command.Help</ExcludedCommand></CommandSet>
    <ChildItems/></Form>`;
  const parsed = FP.parse(xml);
  assert.ok(!parsed.error, parsed.error);
  assert.equal(parsed.model.structuredProperties.MobileDeviceCommandBarContent.children[0].name, 'v8:item');
  assert.equal(parsed.model.structuredProperties.CommandSet.children[0].text, 'Form.Command.Help');
  assert.deepEqual(Array.from(parsed.model.excludedCommands), ['Form.Command.Help']);
});

test('form and item events keep handlers and call types', () => {
  const xml = `<Form xmlns="http://v8.1c.ru/8.3/xcf/logform" name="Форма">
    <Events>
      <Event name="NotificationProcessing">ОбработкаОповещения</Event>
      <Event name="OnCreateAtServer" callType="After">ПриСозданииНаСервере</Event>
      <Event name="OnOpen"></Event>
    </Events>
    <ChildItems><InputField name="Код" id="7">
      <Events><Event name="OnChange" callType="Before">КодПриИзменении</Event></Events>
    </InputField></ChildItems>
  </Form>`;
  const parsed = FP.parse(xml);
  assert.ok(!parsed.error, parsed.error);
  const plain = (value) => JSON.parse(JSON.stringify(value));
  assert.deepEqual(plain(parsed.model.events), [
    { name: 'NotificationProcessing', handler: 'ОбработкаОповещения' },
    { name: 'OnCreateAtServer', handler: 'ПриСозданииНаСервере', callType: 'After' },
    { name: 'OnOpen', handler: '' },
  ]);
  assert.deepEqual(plain(parsed.model.childItemsRoot[0].events), [
    { name: 'OnChange', handler: 'КодПриИзменении', callType: 'Before' },
  ]);
  assert.equal(T.hasEvent(parsed.model.childItemsRoot[0], 'OnChange'), true);
  assert.equal(T.hasEvent({ events: ['Clearing'] }, 'Clearing'), true);
  assert.deepEqual(plain(FP.activeEvents(parsed.model)), [
    { scope: 'form', ownerType: 'Form', ownerName: 'Форма', ownerId: '',
      name: 'NotificationProcessing', handler: 'ОбработкаОповещения' },
    { scope: 'form', ownerType: 'Form', ownerName: 'Форма', ownerId: '',
      name: 'OnCreateAtServer', handler: 'ПриСозданииНаСервере', callType: 'After' },
    { scope: 'item', ownerType: 'InputField', ownerName: 'Код', ownerId: '7',
      name: 'OnChange', handler: 'КодПриИзменении', callType: 'Before' },
  ]);
});

test('schema properties written as item attributes are preserved', () => {
  const xml = `<Form xmlns="http://v8.1c.ru/8.3/xcf/logform" version="2.20">
    <ChildItems><UsualGroup name="Priority" id="8" DisplayImportance="VeryHigh"/></ChildItems>
  </Form>`;
  const parsed = FP.parse(xml);
  assert.ok(!parsed.error, parsed.error);
  assert.equal(parsed.model.version, '2.20');
  assert.equal(parsed.model.childItemsRoot[0].properties.DisplayImportance, 'VeryHigh');
});

test('reference defaults omitted ordinary groups to HorizontalIfPossible', () => {
  const meta = T.layoutMeta({ tag: 'UsualGroup', properties: {}, childItems: [] });
  assert.equal(meta.orientation, 'horizontal');
  assert.equal(meta.groupMode, 'horizontal-if-possible');
  assert.equal(meta.responsiveGroup, true);
});

test('section-nav class is only for a None-spacing row of Pages=None chips', () => {
  const chip = (name, visible) => ({
    tag: 'Pages',
    name,
    properties: visible === false
      ? { PagesRepresentation: 'None', Visible: 'false' }
      : { PagesRepresentation: 'None' },
    childItems: []
  });
  const nav = T.layoutMeta({
    tag: 'UsualGroup',
    properties: { Group: 'AlwaysHorizontal', HorizontalSpacing: 'None' },
    childItems: [chip('A'), chip('B'), chip('C'), chip('D', false)]
  });
  assert.ok(nav.containerClassHints.includes('section-nav'));
  assert.match(T.layoutClass(nav), /fp-section-nav/);
  const status = T.layoutMeta({
    tag: 'UsualGroup',
    properties: { Group: 'AlwaysHorizontal' },
    childItems: [
      { tag: 'RadioButtonField', name: 'Kind', properties: {} },
      chip('Status')
    ]
  });
  assert.ok(!status.containerClassHints.includes('section-nav'));
  const pair = T.layoutMeta({
    tag: 'UsualGroup',
    properties: { Group: 'AlwaysHorizontal', HorizontalSpacing: 'None' },
    childItems: [chip('A'), chip('B')]
  });
  assert.ok(!pair.containerClassHints.includes('section-nav'));
});

test('reference default stretch applies only to authored titles in the right source position', () => {
  const first = { tag: 'InputField', name: 'First', properties: { Title: 'First' } };
  const second = { tag: 'InputField', name: 'Second', properties: { Title: 'Second' } };
  const inferred = { tag: 'InputField', name: 'Inferred', properties: { DataPath: 'Object.Inferred' } };
  const horizontal = T.layoutMeta({ tag: 'UsualGroup', properties: {}, childItems: [first, second] });
  const vertical = T.layoutMeta({ tag: 'UsualGroup', properties: { Group: 'Vertical' }, childItems: [first] });
  const root = T.layoutMeta({ tag: 'Form', properties: {}, childItems: [second, inferred] });
  assert.equal(T.refDefaultWrapperStretch(first, horizontal, {}), true);
  assert.equal(T.refDefaultWrapperStretch(second, horizontal, {}), false);
  assert.equal(T.refDefaultWrapperStretch(first, vertical, {}), false);
  assert.equal(T.refDefaultWrapperStretch(second, root, {}), true);
  assert.equal(T.refDefaultWrapperStretch(inferred, root, {}), false);
});

test('a LabelDecoration stretches its wrapper only when the reference can give it dynamic height', () => {
  const deco = (Title, extra = {}) => ({ tag: 'LabelDecoration', name: 'D', properties: { Title, ...extra } });
  assert.equal(T.labelDecorationCanDynamicHeight(deco('Опишите свойства')), true);
  assert.equal(T.labelDecorationCanDynamicHeight(deco('Подробнее')), false, 'no ASCII space');
  assert.equal(T.labelDecorationCanDynamicHeight(deco('')), false);
  assert.equal(T.labelDecorationCanDynamicHeight(deco('два слова', { MaxHeight: '2' })), false);
  assert.equal(T.labelDecorationCanDynamicHeight(deco('два слова', { Height: '1' })), false);
  assert.equal(T.labelDecorationCanDynamicHeight(deco('два слова', { HorizontalStretch: 'false' })), false);
  assert.equal(T.labelDecorationCanDynamicHeight(deco('два слова', { VerticalStretch: 'false' })), false);
  assert.equal(T.labelDecorationCanDynamicHeight(deco('два слова', { HorizontalStretch: 'true' })), true);
  const word = deco('Подробнее');
  const sentence = deco('Два слова');
  const root = T.layoutMeta({ tag: 'Form', properties: {}, childItems: [word, sentence] });
  assert.equal(T.refDefaultWrapperStretch(word, root, {}), false);
  assert.equal(T.refDefaultWrapperStretch(sentence, root, {}), true);
});

test('horizontal reference grid selects only confirmed automatic surplus owners', () => {
  const reason = { tag: 'InputField', name: 'Reason', properties: { Width: '10', Title: 'Reason' } };
  const fixed = { tag: 'InputField', name: 'Grounds', properties: { Width: '50', HorizontalStretch: 'false' } };
  const date = { tag: 'InputField', name: 'Date', properties: { Title: 'Date' } };
  const authoredRow = T.layoutMeta({ tag: 'UsualGroup', properties: { Group: 'Horizontal' },
    childItems: [date, fixed, reason] });
  assert.equal(authoredRow.defaultStretchChild, reason);
  assert.equal(T.refDefaultWrapperStretch(reason, authoredRow, {}), true);

  const amount = { tag: 'InputField', name: 'Amount', properties: { Title: 'Days', Width: '6' } };
  const selector = { tag: 'InputField', name: 'Kind', properties: { TitleLocation: 'None' } };
  const action = { tag: 'Button', name: 'Select', properties: {} };
  const compound = T.layoutMeta({ tag: 'UsualGroup', properties: { Group: 'AlwaysHorizontal' },
    childItems: [amount, selector, action] });
  assert.equal(compound.defaultStretchChild, selector);
  assert.equal(T.refDefaultWrapperStretch(amount, compound, {}), false);
  assert.equal(T.refDefaultWrapperStretch(selector, compound, {}), true);

  const mixed = T.layoutMeta({ tag: 'UsualGroup', properties: { Group: 'Horizontal' },
    childItems: [amount, action, selector] });
  assert.equal(mixed.defaultStretchChild, null);
});

test('ChildItemsWidth Equal stretches children', () => {
  const input = { properties: {} };
  const parent = T.layoutMeta({
    tag: 'UsualGroup',
    properties: { Group: 'Horizontal', ChildItemsWidth: 'Equal' }
  });
  assert.equal(parent.orientation, 'horizontal');
  assert.equal(parent.childItemsWidth, 'equal');
  assert.equal(T.wantsHStretch(input, 'InputField', parent), true);
});

test('horizontal groups do not wrap', () => {
  const meta = T.layoutMeta({
    tag: 'UsualGroup',
    properties: { Group: 'Horizontal', Representation: 'None' }
  });
  assert.equal(meta.orientation, 'horizontal');
  assert.ok(meta.containerClassHints.indexOf('nowrap') >= 0);
});

test('fixed tables use the reference authored width bands independently of vertical stretch', () => {
  const defaultFixed = T.tableWidthMetrics({ tag: 'Table', properties: {
    HorizontalStretch: 'false'
  } });
  assert.equal(defaultFixed.preferred, 400);
  assert.equal(defaultFixed.minimum, 400);
  assert.equal(defaultFixed.maximum, 400);
  assert.equal(defaultFixed.fixed, true);
  const width20 = T.tableWidthMetrics({ tag: 'Table', properties: {
    Width: '20', MaxWidth: '30', HorizontalStretch: 'false', VerticalStretch: 'true'
  } });
  assert.equal(width20.preferred, 200);
  assert.equal(width20.minimum, 200);
  assert.equal(width20.maximum, 200);
  assert.equal(width20.fixed, true);
  const width60 = T.tableWidthMetrics({ tag: 'Table', properties: {
    Width: '60', HorizontalStretch: 'false'
  } });
  assert.equal(width60.preferred, 600);
  assert.equal(width60.minimum, 600);
  assert.equal(width60.maximum, 600);
  assert.equal(width60.fixed, true);
});

test('table default width follows the reference table generator over visible top-level columns', () => {
  const column = (visible) => ({ tag: 'LabelField', properties: visible ? {} : { Visible: 'false' } });
  const table = (kids) => T.tableWidthMetrics({ tag: 'Table', properties: {}, childItems: kids });
  assert.equal(table([]).preferred, 400);
  assert.equal(table([column(true), column(true), column(true)]).preferred, 400);
  assert.equal(table([column(true), column(true), column(true), { tag: 'ColumnGroup', properties: {} }]).preferred, 520);
  /* 5 authored columns, one hidden -> 4 generated -> 52 units */
  assert.equal(table([column(true), column(true), column(true), column(false), column(true)]).preferred, 520);
  assert.equal(table(Array.from({ length: 12 }, () => column(true))).preferred, 880);
  assert.equal(T.tableWidthMetrics({ tag: 'Table', properties: { Width: '30' },
    childItems: Array.from({ length: 9 }, () => column(true)) }).preferred, 300);
});

test('stretchable table keeps authored width as a preference instead of a fixed maximum', () => {
  const metrics = T.tableWidthMetrics({ tag: 'Table', properties: {
    Width: '20', MaxWidth: '30', HorizontalStretch: 'true'
  } });
  assert.equal(metrics.preferred, 200);
  assert.equal(metrics.minimum, 10);
  assert.equal(metrics.maximum, 300);
  assert.equal(metrics.fixed, false);
});

test('fixed table widget is the wider of its grid and independent chrome bands', () => {
  const chromeWins = T.tableWidgetWidthMetrics(400, [451, 318]);
  assert.equal(chromeWins.grid, 400);
  assert.equal(chromeWins.widget, 451);
  assert.equal(T.tableWidgetWidthMetrics(600, [451, 318]).widget, 600);
  assert.equal(T.tableWidgetWidthMetrics(200, []).widget, 200);
  assert.equal(T.tableWidgetWidthMetrics(400, [451.2]).widget, 452);
});

test('short physical table columns keep native minima and give spare width to the trailing column', () => {
  assert.deepEqual(Array.from(T.allocateTableColumnWidths([97, 165], 537)), [97, 440]);
  assert.deepEqual(Array.from(T.allocateTableColumnWidths([118, 129, 165, 36], 537)), [118, 129, 165, 125]);
  assert.deepEqual(Array.from(T.allocateTableColumnWidths([97, 97, 165, 97, 90], 390)), [97, 97, 165, 97, 90]);
});

test('Reference group modes remain distinct until responsive layout selects a variant', () => {
  assert.equal(T.normGroupMode('Horizontal'), 'horizontal');
  assert.equal(T.normGroupMode('HorizontalIfPossible'), 'horizontal-if-possible');
  assert.equal(T.normGroupMode('AlwaysHorizontal'), 'always-horizontal');
  assert.equal(T.normGroupMode('AutoScreenTypeSensitive'), 'auto-screen-sensitive');
  assert.equal(T.normGroupMode('Vertical'), 'vertical');
  const responsive = T.layoutMeta({
    tag: 'UsualGroup', properties: { Group: 'HorizontalIfPossible', Representation: 'None' }
  });
  assert.equal(responsive.orientation, 'horizontal');
  assert.equal(responsive.groupMode, 'horizontal-if-possible');
  assert.equal(responsive.responsiveGroup, true);
  assert.equal(responsive.noWrap, false);
  assert.equal(T.layoutMeta({
    tag: 'UsualGroup', properties: { Group: 'AlwaysHorizontal', Representation: 'None' }
  }).responsiveGroup, false);
});

test('Taxi spacing uses independent horizontal and vertical scales', () => {
  assert.equal(T.normSpacing('None'), 'none');
  assert.equal(T.normSpacing('OneAndHalf'), 'oneandhalf');
  assert.equal(T.normSpacing('Auto'), 'auto');
  assert.deepEqual(
    ['none', 'half', 'single', 'oneandhalf', 'double'].map((kind) => T.spacingUnits(kind, 'horizontal')),
    [0, 5, 10, 15, 20]
  );
  assert.deepEqual(
    ['none', 'half', 'single', 'oneandhalf', 'double'].map((kind) => T.spacingUnits(kind, 'vertical')),
    [0, 5, 9, 14, 18]
  );
  assert.deepEqual(
    ['none', 'half', 'single', 'oneandhalf', 'double'].map((kind) => T.spacingPx(kind, 'horizontal')),
    [0, 4, 8, 12, 16],
    'the browser adapter calibrates the reference layout units to the 12px Taxi profile'
  );
  assert.equal(T.spacingPx('auto', 'horizontal'), null);
});

test('a four-field vertical column does not publish Single 9px: nested 29px chrome needs CSS 5px', () => {
  const fourFields = T.layoutMeta({
    tag: 'UsualGroup',
    properties: { Group: 'Vertical', Representation: 'None' },
    childItems: [
      { tag: 'InputField', properties: { MaxWidth: '29', AutoMaxWidth: 'false' } },
      { tag: 'InputField', properties: { MaxWidth: '29', AutoMaxWidth: 'false' } },
      { tag: 'InputField', properties: { MaxWidth: '29', AutoMaxWidth: 'false' } },
      { tag: 'InputField', properties: { MaxWidth: '29', AutoMaxWidth: 'false' } },
    ],
  });
  assert.equal(fourFields.compactOrdinaryRows, false);
  assert.equal(fourFields.defaultVerticalSpacing, false,
    'inline 9px on a 29px nested band would be 38px rows; CSS 5px makes 34');
  const style = {};
  T.applyLayout({ style, dataset: {} }, fourFields);
  assert.equal(style.rowGap, '', 'leave row-gap to CSS for the nested 29+5 cadence');
});

test('ordinary logical containers use native omitted Single gaps without changing explicit Auto', () => {
  const ordinary = T.layoutMeta({
    tag: 'UsualGroup', properties: { Group: 'Vertical', Representation: 'None' },
    childItems: [{ tag: 'InputField', properties: {} }, { tag: 'InputField', properties: {} }]
  });
  assert.equal(ordinary.defaultHorizontalSpacing, false);
  assert.equal(ordinary.defaultVerticalSpacing, true);
  const style = {};
  T.applyLayout({ style, dataset: {} }, ordinary);
  assert.equal(style.columnGap, '');
  assert.equal(style.rowGap, '9px');

  const checkboxThenField = T.layoutMeta({
    tag: 'UsualGroup', properties: { Group: 'Vertical', Representation: 'None' },
    childItems: [{ tag: 'CheckBoxField', properties: {} }, { tag: 'InputField', properties: {} }]
  });
  assert.equal(checkboxThenField.compactOrdinaryRows, true);
  assert.equal(checkboxThenField.defaultVerticalSpacing, false,
    'checkbox+field keeps omitted 3px, not header Single 9px');
  const checkboxThenFieldStyle = {};
  T.applyLayout({ style: checkboxThenFieldStyle, dataset: {} }, checkboxThenField);
  assert.equal(checkboxThenFieldStyle.rowGap, '');
  const twoChecks = T.layoutMeta({
    tag: 'UsualGroup', properties: { Group: 'Vertical', Representation: 'None' },
    childItems: [{ tag: 'CheckBoxField', properties: {} }, { tag: 'CheckBoxField', properties: {} }]
  });
  assert.equal(twoChecks.defaultVerticalSpacing, true,
    'two checkboxes keep Single 9px');

  const groupThenCheckbox = T.layoutMeta({
    tag: 'UsualGroup', properties: { Group: 'Vertical', Representation: 'None' },
    childItems: [
      {
        tag: 'UsualGroup',
        properties: { Group: 'Horizontal', Representation: 'None' },
        childItems: [{ tag: 'InputField', properties: {} }]
      },
      { tag: 'CheckBoxField', properties: {} }
    ]
  });
  assert.equal(groupThenCheckbox.compactOrdinaryRows, false,
    'a nested group plus checkbox is not two ordinary field rows');
  assert.equal(groupThenCheckbox.defaultVerticalSpacing, false);
  const groupThenCheckboxStyle = {};
  T.applyLayout({ style: groupThenCheckboxStyle, dataset: {} }, groupThenCheckbox);
  assert.equal(groupThenCheckboxStyle.rowGap, '',
    'leave omitted compact gap; Single 9px accumulated down the compensation stack');

  const pagesNoneThenGroup = T.layoutMeta({
    tag: 'UsualGroup', properties: { Group: 'Vertical', Representation: 'None' },
    childItems: [
      {
        tag: 'Pages',
        properties: { PagesRepresentation: 'None' },
        childItems: [{ tag: 'Page', properties: {}, childItems: [{ tag: 'InputField', properties: {} }] }]
      },
      {
        tag: 'UsualGroup',
        properties: { Group: 'AlwaysHorizontal', Representation: 'None' },
        childItems: [{ tag: 'InputField', properties: {} }]
      }
    ]
  });
  assert.equal(pagesNoneThenGroup.pagesNoneThenGroup, true);
  assert.equal(pagesNoneThenGroup.defaultVerticalSpacing, false);
  const pagesNoneStyle = {};
  T.applyLayout({ style: pagesNoneStyle, dataset: {} }, pagesNoneThenGroup);
  assert.equal(pagesNoneStyle.rowGap, '6px');

  const horizontal = T.layoutMeta({
    tag: 'UsualGroup', properties: { Group: 'Horizontal', Representation: 'None' },
    childItems: [{ tag: 'InputField', properties: {} }, { tag: 'InputField', properties: {} }]
  });
  const horizontalStyle = {};
  T.applyLayout({ style: horizontalStyle, dataset: {} }, horizontal);
  assert.equal(horizontalStyle.columnGap, '10px');
  assert.equal(horizontalStyle.rowGap, '');

  const detached = T.layoutMeta({
    tag: 'UsualGroup', properties: { Group: 'AlwaysHorizontal', Representation: 'None', United: 'false' },
    childItems: [{ tag: 'LabelDecoration', properties: {} }, { tag: 'InputField', properties: {} }]
  });
  assert.equal(detached.compactOrdinaryRows, false);
  assert.equal(detached.defaultHorizontalSpacing, false);
  const responsive = T.layoutMeta({
    tag: 'UsualGroup', properties: { Representation: 'None' },
    childItems: [{ tag: 'InputField', properties: {} }, { tag: 'CheckBoxField', properties: {} }]
  });
  assert.equal(responsive.groupMode, 'horizontal-if-possible');
  assert.equal(responsive.compactOrdinaryRows, false);
  assert.equal(responsive.defaultHorizontalSpacing, false);
  assert.equal(responsive.defaultVerticalSpacing, false);

  const implicitNotice = T.layoutMeta({
    tag: 'UsualGroup', properties: {},
    childItems: [{ tag: 'PictureDecoration', properties: {} }, { tag: 'LabelDecoration', properties: {} }]
  });
  assert.equal(implicitNotice.compactDecorationRow, true,
    'an omitted Representation is semantically None for a decoration-only notice');
  assert.equal(T.layoutMeta({
    tag: 'UsualGroup', properties: {},
    childItems: [{ tag: 'InputField', properties: {} }, { tag: 'CheckBoxField', properties: {} }]
  }).compactDecorationRow, false, 'ordinary responsive controls are not decoration notices');

  const explicitAuto = T.layoutMeta({
    tag: 'UsualGroup', properties: {
      Group: 'Vertical', Representation: 'None', HorizontalSpacing: 'Auto', VerticalSpacing: 'Auto'
    }, childItems: [{ tag: 'InputField', properties: {} }, { tag: 'InputField', properties: {} }]
  });
  assert.equal(explicitAuto.defaultHorizontalSpacing, false);
  assert.equal(explicitAuto.defaultVerticalSpacing, false);
  const autoStyle = {};
  T.applyLayout({ style: autoStyle, dataset: {} }, explicitAuto);
  assert.equal(autoStyle.columnGap, '');
  assert.equal(autoStyle.rowGap, '');

  for (const tag of ['AutoCommandBar', 'CommandBar', 'ButtonGroup', 'Table', 'Pages']) {
    const special = T.layoutMeta({ tag, properties: {}, childItems: [] });
    assert.equal(special.defaultHorizontalSpacing, false, tag);
    assert.equal(special.defaultVerticalSpacing, false, tag);
  }
});

test('inline vertical PopUp groups use omitted Single cadence without overriding authored spacing', () => {
  const childItems = [
    { tag: 'UsualGroup', properties: { Representation: 'None' }, childItems: [] },
    { tag: 'InputField', properties: {} },
    { tag: 'LabelDecoration', properties: {} },
  ];
  const popup = (spacing) => T.layoutMeta({
    tag: 'UsualGroup',
    properties: {
      Group: 'Vertical', Behavior: 'PopUp', Representation: 'None',
      ...(spacing === undefined ? {} : { VerticalSpacing: spacing }),
    },
    childItems,
  });

  const omitted = popup();
  assert.equal(omitted.compactOrdinaryRows, false, 'the rule is not the compact two-child shortcut');
  assert.equal(omitted.defaultVerticalSpacing, true);
  const omittedStyle = {};
  T.applyLayout({ style: omittedStyle, dataset: {} }, omitted);
  assert.equal(omittedStyle.rowGap, '9px');

  for (const [spacing, expected] of [['Auto', ''], ['None', '0px']]) {
    const authored = popup(spacing);
    assert.equal(authored.defaultVerticalSpacing, false, spacing);
    const style = {};
    T.applyLayout({ style, dataset: {} }, authored);
    assert.equal(style.rowGap, expected, spacing);
  }

  const gridOwner = T.layoutMeta({
    tag: 'UsualGroup',
    properties: { Group: 'Vertical', Behavior: 'PopUp', Representation: 'None' },
    childItems: [{ tag: 'Table', properties: {} }, { tag: 'LabelDecoration', properties: {} }],
  });
  assert.equal(gridOwner.defaultVerticalSpacing, false, 'special data grids retain their own cadence');
});

test('a repeated ListChoice tuple publishes equivalent selector tracks', () => {
  const selector = (titleLocation = '', extra = {}) => ({
    tag: 'InputField',
    properties: { ListChoiceMode: 'true', TitleLocation: titleLocation, ...extra }
  });
  const first = selector('', { Title: 'Условия исчисления' });
  const second = selector('None');
  const third = selector('None');
  const trailing = { tag: 'InputField', properties: { Title: 'Нарушение режима с' } };
  const children = [first, second, third, trailing];

  const selected = T.automaticCompoundSelectorChildren(children, 'horizontal-if-possible');
  assert.equal(selected.length, 3);
  assert.equal(selected[0], first);
  assert.equal(selected[1], second);
  assert.equal(selected[2], third);
  assert.equal(T.layoutMeta({ tag: 'UsualGroup', properties: {}, childItems: children })
    .compoundSelectorChildren.length, 3);
  assert.equal(T.automaticCompoundSelectorChildren([first, second, trailing],
    'horizontal-if-possible').length, 0, 'two selectors remain an ordinary compound pair');
  assert.equal(T.automaticCompoundSelectorChildren([first, second, third,
    { tag: 'Button', properties: {} }], 'horizontal-if-possible').length, 0,
  'an action tail does not turn a command row into selector tracks');
  assert.equal(T.automaticCompoundSelectorChildren([first, second,
    selector('None', { Width: '8' }), trailing], 'horizontal-if-possible').length, 0,
  'an authored selector width remains authoritative');
  assert.equal(T.automaticCompoundSelectorChildren(children, 'always-horizontal').length, 0,
    'fixed horizontal rows keep their existing authored allocator');
});

test('detached logical column height is advisory only for non-stretch horizontal children', () => {
  const item = { tag: 'UsualGroup', properties: { Representation: 'None', United: 'false' } };
  assert.equal(T.detachedLogicalColumnHeightIsAdvisory(item, { orientation: 'horizontal' }, false), true);
  assert.equal(T.detachedLogicalColumnHeightIsAdvisory(item, { orientation: 'vertical' }, false), false);
  assert.equal(T.detachedLogicalColumnHeightIsAdvisory(item, { orientation: 'horizontal' }, true), false);
  assert.equal(T.detachedLogicalColumnHeightIsAdvisory({
    tag: 'UsualGroup', properties: { Representation: 'None', United: 'true' }
  }, { orientation: 'horizontal' }, false), false);
});

test('page-local responsive decision width excludes authored and stretch columns', () => {
  assert.equal(T.pageLocalResponsiveColumnEligible({
    noStretch: true, throughAlign: 'use', width: 0, maxWidth: 0
  }), true);
  assert.equal(T.pageLocalResponsiveColumnEligible({
    noStretch: true, throughAlign: 'use', width: 47, maxWidth: 0
  }), false);
  assert.equal(T.pageLocalResponsiveColumnEligible({
    noStretch: true, throughAlign: 'use', width: 0, maxWidth: 100
  }), false);
  assert.equal(T.pageLocalResponsiveColumnEligible({
    noStretch: false, throughAlign: 'use', width: 0, maxWidth: 0
  }), false);
  assert.equal(T.pageLocalResponsiveColumnEligible({
    noStretch: true, throughAlign: 'dontuse', width: 0, maxWidth: 0
  }), false);
});

test('page-local compact responsive width belongs only to container-only columns', () => {
  assert.equal(T.pageLocalResponsiveColumnChildrenEligible([
    { tag: 'UsualGroup', properties: {} },
    { tag: 'Pages', properties: {} },
  ]), true);
  assert.equal(T.pageLocalResponsiveColumnChildrenEligible([
    { tag: 'UsualGroup', properties: {} },
    { tag: 'CheckBoxField', properties: {} },
  ]), false);
  assert.equal(T.pageLocalResponsiveColumnChildrenEligible([
    { tag: 'CheckBoxField', properties: { Visible: 'false' } },
    { tag: 'UsualGroup', properties: {} },
  ]), true);
  assert.equal(T.pageLocalResponsiveColumnChildrenEligible([]), false);
});

test('an auto ThroughAlign Page with a direct multiline field uses intrinsic title tracks', () => {
  assert.equal(T.pageIntrinsicThroughAlignEligible({
    page: true, throughAlign: 'use', throughAlignMode: 'auto', directMultiline: true
  }), true);
  for (const holdout of [
    { page: false, throughAlign: 'use', throughAlignMode: 'auto', directMultiline: true },
    { page: true, throughAlign: 'dontuse', throughAlignMode: 'auto', directMultiline: true },
    { page: true, throughAlign: 'use', throughAlignMode: 'dontuse', directMultiline: true },
    { page: true, throughAlign: 'use', throughAlignMode: 'auto', directMultiline: false }
  ]) assert.equal(T.pageIntrinsicThroughAlignEligible(holdout), false);
});

test('explicit left multiline captions retain their semantic editor paint band', () => {
  const explicit = T.multilineFieldLayoutContract({
    location: 'left', multiline: true, authoredTitleLocation: 'Left', authoredPaintWidth: 710,
    titleCellChrome: 20, authoredPaintHeight: 115, verticalStretch: true,
    captionLineHeight: 16, removedTopTitleBand: 19
  });
  assert.equal(explicit.location, 'left');
  assert.equal(explicit.editorPaintMaximum, 710);
  assert.equal(explicit.titleCellChrome, 20);
  assert.equal(explicit.editorTopInset, 16);
  assert.equal(explicit.editorPaintHeight, 96);
  const label = { style: {} };
  const editor = {
    style: {}, parentNode: { querySelector: (selector) => selector === '.fp-field-label' ? label : null }
  };
  assert.equal(T.applyMultilineEditorPaintBand(editor, explicit), true);
  assert.equal(editor.style.width, '710px');
  assert.equal(editor.style.maxWidth, '710px');
  assert.equal(editor.style.flex, '0 1 710px');
  assert.equal(label.style.paddingRight, '20px');
  assert.equal(label.style.boxSizing, 'border-box');
  assert.equal(T.applyMultilineEditorVerticalBand(editor, explicit), true);
  assert.equal(editor.style.height, '96px');
  assert.equal(editor.style.minHeight, '96px');
  assert.equal(editor.style.maxHeight, '96px');
  assert.equal(editor.style.marginTop, '16px');
  assert.equal(T.applyMultilineEditorPaintBand(editor, explicit), true);
  assert.equal(T.applyMultilineEditorVerticalBand(editor, explicit), true);
  assert.equal(editor.style.flex, '0 1 710px', 'a repeated resize pass is idempotent');
  assert.equal(editor.style.marginTop, '16px');

  const auto = T.multilineFieldLayoutContract({
    location: 'left', multiline: true, authoredTitleLocation: '', authoredPaintWidth: 240
  });
  assert.equal(auto.location, 'top', 'auto captions keep the narrow-column promotion');
  assert.equal(auto.editorPaintMaximum, 0);
  assert.equal(T.applyMultilineEditorPaintBand({ style: {} }, auto), false);
  assert.equal(T.multilineFieldLayoutContract({
    location: 'left', multiline: true, authoredTitleLocation: 'Auto', authoredPaintWidth: 240
  }).location, 'top');

  for (const holdout of [
    { location: 'left', multiline: true, authoredTitleLocation: 'Left', authoredPaintWidth: 0 },
    { location: 'top', multiline: true, authoredTitleLocation: 'Top', authoredPaintWidth: 710 },
    { location: 'left', multiline: false, authoredTitleLocation: 'Left', authoredPaintWidth: 710 }
  ]) assert.equal(T.multilineFieldLayoutContract(holdout).editorPaintMaximum, 0);
});

test('compact ordinary row paint chrome excludes radio and button layouts', () => {
  const group = T.layoutMeta({
    tag: 'UsualGroup', properties: { Group: 'Vertical', Representation: 'None' },
    childItems: [{ tag: 'InputField', properties: {} }, { tag: 'InputField', properties: {} }]
  });
  for (const tag of ['InputField', 'CheckBoxField', 'LabelField', 'LabelDecoration', 'PictureDecoration', 'UsualGroup'])
    assert.equal(T.isOrdinaryRowControl(tag, group, false), true, tag);
  for (const tag of ['Button', 'Hyperlink', 'Popup', 'RadioButtonField', 'RadioButton', 'Table',
    'AutoCommandBar', 'CommandBar', 'ButtonGroup'])
    assert.equal(T.isOrdinaryRowControl(tag, group, false), false, tag);
  assert.equal(T.isOrdinaryRowControl('InputField', T.layoutMeta({ tag: 'Table', properties: {} }), false), false);
  assert.equal(T.isOrdinaryRowControl('InputField', group, true), false);
  const radioRow = T.layoutMeta({
    tag: 'UsualGroup', properties: { Group: 'AlwaysHorizontal', Representation: 'None' },
    childItems: [{ tag: 'RadioButtonField', properties: {} }, { tag: 'CheckBoxField', properties: {} }]
  });
  assert.equal(radioRow.compactOrdinaryRows, false);
  assert.equal(radioRow.defaultHorizontalSpacing, false);
  const fieldCommandRow = T.layoutMeta({
    tag: 'UsualGroup', properties: { Representation: 'None' },
    childItems: [
      { tag: 'InputField', properties: { Width: '13', HorizontalStretch: 'false' } },
      { tag: 'CommandBar', properties: { HorizontalStretch: 'false' }, childItems: [] },
      { tag: 'LabelField', properties: { HorizontalStretch: 'true' } }
    ]
  });
  assert.equal(fieldCommandRow.authoredFieldCommandRow, true);
  assert.equal(fieldCommandRow.compactOrdinaryRows, false,
    'special CommandBar row must not become an ordinary two-control row');
  assert.equal(T.isOrdinaryRowControl('InputField', fieldCommandRow, false), true);
  assert.equal(T.isOrdinaryRowControl('CommandBar', fieldCommandRow, false), false);
  assert.equal(T.isOrdinaryRowControl('LabelField', fieldCommandRow, false), true);
  assert.equal(T.isOrdinaryRowControl('InputField', fieldCommandRow, true), false);
  const stretchCommandRow = T.layoutMeta({
    tag: 'UsualGroup', properties: { Representation: 'None' },
    childItems: [
      { tag: 'InputField', properties: { Width: '13', HorizontalStretch: 'false' } },
      { tag: 'CommandBar', properties: {}, childItems: [] }
    ]
  });
  assert.equal(stretchCommandRow.authoredFieldCommandRow, false);
  const notificationRow = T.layoutMeta({
    tag: 'UsualGroup', properties: { Group: 'Vertical', Representation: 'None' },
    childItems: [
      { tag: 'UsualGroup', properties: { BackColor: 'style:Warning' } },
      { tag: 'UsualGroup', properties: { BackColor: 'style:Error' } }
    ]
  });
  assert.equal(notificationRow.compactOrdinaryRows, false);
  const colouredPair = T.layoutMeta({
    tag: 'UsualGroup', properties: {
      Group: 'AlwaysHorizontal', Representation: 'None', BackColor: 'style:Warning'
    },
    childItems: [{ tag: 'PictureDecoration', properties: {} }, { tag: 'LabelDecoration', properties: {} }]
  });
  assert.equal(colouredPair.compactOrdinaryRows, true);
  const responsiveNotice = T.layoutMeta({
    tag: 'UsualGroup', properties: { Representation: 'None', BackColor: 'style:Warning' },
    childItems: [{ tag: 'PictureDecoration', properties: {} }, { tag: 'LabelDecoration', properties: {} }]
  });
  assert.equal(responsiveNotice.compactOrdinaryRows, true);
  assert.equal(responsiveNotice.compactDecorationRow, true);
  const fusedFields = T.layoutMeta({
    tag: 'UsualGroup', properties: {
      Group: 'AlwaysHorizontal', Representation: 'None', BackColor: 'style:FusedFields'
    },
    childItems: [{ tag: 'InputField', properties: {} }, { tag: 'InputField', properties: {} }]
  });
  assert.equal(fusedFields.compactOrdinaryRows, true);
});

test('authored container height remains an intrinsic floor for special rows', () => {
  assert.equal(T.authoredContainerHeightUsesIntrinsicFloor({
    tag: 'UsualGroup', properties: { Height: '1' },
    childItems: [{ tag: 'RadioButtonField', properties: {} }, { tag: 'LabelField', properties: {} }]
  }), true);
  assert.equal(T.authoredContainerHeightUsesIntrinsicFloor({
    tag: 'UsualGroup', properties: { Height: '1' },
    childItems: [{ tag: 'InputField', properties: {} }, { tag: 'LabelField', properties: {} }]
  }), false);
});

test('omitted vertical spacing expands only semantic radio section boundaries', () => {
  const parent = { tag: 'UsualGroup', properties: { Group: 'Vertical' }, childItems: [] };
  const radio = { tag: 'RadioButtonField', properties: {} };
  const group = { tag: 'UsualGroup', properties: { Group: 'Vertical' }, childItems: [] };
  const input = { tag: 'InputField', properties: {} };
  const spacer = { tag: 'LabelDecoration', properties: {} };
  const caption = { tag: 'LabelDecoration', properties: { Title: 'Section' } };
  assert.equal(T.omittedVerticalSectionBoundary(group, radio, parent), true);
  assert.equal(T.omittedVerticalSectionBoundary(radio, group, parent), true);
  assert.equal(T.omittedVerticalSectionBoundary(radio, radio, parent), false);
  assert.equal(T.omittedVerticalSectionBoundary(spacer, group, parent), true);
  assert.equal(T.omittedVerticalSectionBoundary(caption, group, parent), false);
  assert.equal(T.omittedVerticalSectionBoundary(input, group, parent), false);
  assert.equal(T.omittedVerticalSectionBoundary(group, radio,
    { ...parent, properties: { Group: 'Vertical', VerticalSpacing: 'Half' } }), false);
  assert.equal(T.omittedVerticalSectionSpacing(radio, group), 7,
    'projected radio wrapper edges split the native section cadence');
  assert.equal(T.omittedVerticalSectionSpacing(spacer, group), 9,
    'an authored empty spacer keeps the full Single cadence');
  assert.equal(T.taxiLayoutMetrics.verticalSpacing.single - T.taxiLayoutMetrics.compactRowGap, 6);
  const decoGroup = {
    tag: 'UsualGroup',
    properties: { Group: 'Horizontal', Representation: 'None', ShowTitle: 'false' },
    childItems: [caption]
  };
  const radioGroup = {
    tag: 'UsualGroup',
    properties: { Group: 'Horizontal', Representation: 'NormalSeparation', ShowTitle: 'false' },
    childItems: [radio, { tag: 'Pages', properties: { PagesRepresentation: 'None' } }]
  };
  const checkGroup = {
    tag: 'UsualGroup',
    properties: { Representation: 'None', ShowTitle: 'false' },
    childItems: [{ tag: 'CheckBoxField', properties: {} }]
  };
  assert.equal(T.omittedVerticalSectionBoundary(decoGroup, radioGroup, parent), true,
    'wrapped titled decoration then wrapped radio is a radio section edge');
  assert.equal(T.omittedVerticalSectionBoundary(decoGroup, decoGroup, parent), false);
  assert.equal(T.omittedVerticalSectionBoundary(radioGroup, checkGroup, parent), false,
    'radio wrapper to checkbox wrapper is not a second radio edge');
  assert.equal(T.omittedVerticalSectionSpacing(decoGroup, radioGroup), 7);
  const pagesNoneCheckbox = {
    tag: 'Pages',
    properties: { PagesRepresentation: 'None' },
    childItems: [{
      tag: 'Page', properties: {},
      childItems: [{ tag: 'CheckBoxField', properties: {} }]
    }]
  };
  assert.equal(T.omittedVerticalSectionBoundary(pagesNoneCheckbox, radio, parent), false,
    'Pages=None checkbox then radio stays on the compact field cadence');
  const innGroup = {
    tag: 'UsualGroup',
    properties: { Group: 'Vertical', Representation: 'None', ShowTitle: 'false' },
    childItems: [{
      tag: 'Pages', properties: { PagesRepresentation: 'None' },
      childItems: [{
        tag: 'Page', properties: {},
        childItems: [{ tag: 'InputField', properties: { Title: 'ИНН' } }]
      }]
    }]
  };
  assert.equal(T.omittedVerticalSectionBoundary(radio, innGroup, parent), false,
    'radio then registration field stack stays compact');
  assert.equal(T.omittedVerticalSectionBoundary(radio, group, parent), true);
  const legal = {
    tag: 'UsualGroup',
    properties: { Group: 'Vertical', Representation: 'NormalSeparation', ShowTitle: 'false' },
    childItems: [pagesNoneCheckbox, radio, innGroup]
  };
  const partner = {
    tag: 'UsualGroup',
    properties: { Group: 'Vertical', Representation: 'None', ShowTitle: 'false' },
    childItems: [{ tag: 'InputField', properties: {} }]
  };
  assert.equal(T.omittedVerticalSectionBoundary(legal, partner, parent), true,
    'NormalSeparation section then the next editor group uses Single');
  assert.equal(T.omittedVerticalSectionBoundary(partner, legal, parent), true,
    'entering NormalSeparation is the same Taxi section step');
  assert.equal(T.omittedVerticalSectionSpacing(legal, partner), 9);
});

test('ThroughAlign Auto follows the reference desktop Taxi generator contract', () => {
  const fieldColumn = (id) => ({
    tag: 'UsualGroup', id,
    properties: { Group: 'Vertical', Representation: 'None' },
    childItems: [{ tag: 'InputField', id: `${id}-field`, properties: {} }]
  });
  const auto = T.layoutMeta({
    tag: 'UsualGroup', properties: { Group: 'Horizontal', Representation: 'None' },
    childItems: [fieldColumn('left'), fieldColumn('right')]
  });
  assert.equal(auto.throughAlignMode, 'auto');
  assert.equal(auto.throughAlign, 'use');
  assert.equal(auto.throughAlignScope, 'linked-local');
  const blocked = T.layoutMeta({
    tag: 'UsualGroup', properties: {
      Group: 'Horizontal', Representation: 'None', ThroughAlign: 'DontUse'
    }, childItems: [fieldColumn('left'), fieldColumn('right')]
  });
  assert.equal(blocked.throughAlignMode, 'dontuse');
  assert.equal(blocked.throughAlign, 'dontuse');
  const forced = T.layoutMeta({
    tag: 'UsualGroup', properties: {
      Group: 'Horizontal', Representation: 'None', ThroughAlign: 'Use'
    }, childItems: [fieldColumn('left'), fieldColumn('right')]
  });
  assert.equal(forced.throughAlign, 'use');
  assert.equal(forced.throughAlignScope, 'across-columns');
  assert.equal(T.layoutMeta({
    tag: 'UsualGroup', properties: {
      Group: 'Horizontal', Representation: 'StrongSeparation'
    }, childItems: [fieldColumn('left'), fieldColumn('right')]
  }).throughAlign, 'dontuse');
  assert.equal(T.layoutMeta({
    tag: 'UsualGroup', properties: {
      Group: 'Horizontal', Representation: 'None', United: 'false'
    }, childItems: [fieldColumn('left'), fieldColumn('right')]
  }).throughAlign, 'dontuse');
  assert.equal(T.layoutMeta({
    tag: 'UsualGroup', properties: {
      Group: 'Horizontal', Representation: 'None', Behavior: 'Collapsible', ThroughAlign: 'Use'
    }, childItems: [fieldColumn('left'), fieldColumn('right')]
  }).throughAlign, 'dontuse');
  assert.equal(T.effectiveThroughAlign({ properties: {} }, 'auto'), 'use',
    'omitted UsualGroupRepresentation has the EMF default None');
  const omittedItem = {
    tag: 'UsualGroup',
    properties: { Group: 'Horizontal', ShowTitle: 'false' },
    childItems: [{ tag: 'CheckBoxField', properties: {} }]
  };
  const omittedPaint = T.layoutMeta(omittedItem);
  assert.equal(T.groupPaintIsNone(omittedItem), true);
  assert.ok(omittedPaint.containerClassHints.includes('container-bare'),
    'omitted Representation must drop the 4px item shell');
  const separatedItem = {
    tag: 'UsualGroup',
    properties: { Group: 'Vertical', Representation: 'NormalSeparation', ShowTitle: 'false' },
    childItems: [{ tag: 'InputField', properties: {} }]
  };
  const separatedPaint = T.layoutMeta(separatedItem);
  assert.equal(T.groupPaintIsNone(separatedItem), false);
  assert.ok(!separatedPaint.containerClassHints.includes('container-bare'));
});

test('paired titled detached columns opt into the native logical-column contract', () => {
  const titledColumn = (title = 'Column') => ({
    tag: 'UsualGroup',
    properties: {
      Title: title, Group: 'Vertical', Representation: 'None', United: 'false',
    },
    childItems: [{ tag: 'InputField', properties: {} }],
  });
  const pair = {
    tag: 'UsualGroup',
    properties: {
      Group: 'AlwaysHorizontal', Representation: 'None', United: 'false',
    },
    childItems: [titledColumn('Left'), titledColumn('Right')],
  };
  assert.equal(T.isPairedTitledLogicalColumns(pair), true);

  pair.properties.ThroughAlign = 'Use';
  assert.equal(T.isPairedTitledLogicalColumns(pair), false,
    'explicit ThroughAlign owns a different shared-column contract');
  delete pair.properties.ThroughAlign;
  pair.childItems[1].properties.ShowTitle = 'false';
  assert.equal(T.isPairedTitledLogicalColumns(pair), false,
    'paintless structural columns do not acquire caption/editor spacing');
  delete pair.childItems[1].properties.ShowTitle;
  pair.childItems.push(titledColumn('Third'));
  assert.equal(T.isPairedTitledLogicalColumns(pair), false,
    'the contract is a paired lane, not a generic wrapper-flow rule');
});

test('responsive group chooses vertical only for actual overflow', () => {
  const box = {
    clientWidth: 180, scrollWidth: 181, children: [],
    getBoundingClientRect: () => ({ left: 0, right: 180, width: 180 })
  };
  assert.equal(T.responsiveGroupNeedsVertical(box), false, 'one CSS pixel is tolerated');
  box.scrollWidth = 182;
  assert.equal(T.responsiveGroupNeedsVertical(box), true);
  box.scrollWidth = 180;
  assert.equal(T.responsiveGroupNeedsVertical(box), false);
});

test('HorizontalIfPossible preferred width includes right-title checkbox captions', () => {
  const fieldLabel = { offsetWidth: 90, scrollWidth: 90, textContent: 'Идентификатор:' };
  const checkLabel = {
    offsetWidth: 420, scrollWidth: 420,
    textContent: 'Иностранный исполнитель утвержден госзаказчиком'
  };
  const field = {
    classList: { contains: (name) => name === 'fp-item' },
    dataset: { fpAuthoredNormalWidth: '296' },
    querySelector: () => fieldLabel,
  };
  const check = {
    classList: { contains: (name) => name === 'fp-item' },
    dataset: { fpAuthoredNormalWidth: '17' },
    querySelector: () => checkLabel,
  };
  assert.ok(T.horizontalPreferredWidth({ children: [field, check] }) >= 296 + 90 + 17 + 420,
    'checkbox TitleLocation=Right must count its caption');
});

test('page-direct HIP field+checkbox decides against the preceding capped column', () => {
  const wrap = { getBoundingClientRect: () => ({ right: 432, width: 296 }) };
  const column = {
    classList: { contains: (name) => name === 'fp-item' },
    getBoundingClientRect: () => ({ width: 890, height: 120, left: 22 }),
    querySelectorAll: (sel) => sel.includes('fp-input-wrap') ? [wrap] : [],
  };
  const panel = { classList: { contains: (name) => name === 'fp-pages-active-panel' } };
  const owner = {
    parentNode: panel,
    previousElementSibling: column,
    _fpItem: {
      childItems: [
        { tag: 'InputField', properties: { AutoMaxWidth: 'false', MaxWidth: '29' } },
        { tag: 'CheckBoxField', properties: { TitleLocation: 'Right' } },
      ],
    },
  };
  const box = {
    clientWidth: 890, scrollWidth: 890, children: [],
    closest: (sel) => sel === '.fp-item' ? owner : (sel === '.fp-body' ? { clientWidth: 934 } : null),
    getBoundingClientRect: () => ({ left: 0, right: 890, width: 890 }),
  };
  assert.equal(T.precedingCappedPageColumnWidth(box), 410);
  const field = {
    classList: { contains: (name) => name === 'fp-item' },
    dataset: { fpAuthoredNormalWidth: '296' },
    querySelector: () => ({ offsetWidth: 90, scrollWidth: 90, textContent: 'Идентификатор:' }),
    querySelectorAll: () => [],
    getBoundingClientRect: () => ({ left: 0, right: 391, width: 391 }),
  };
  const check = {
    classList: { contains: (name) => name === 'fp-item' },
    dataset: { fpAuthoredNormalWidth: '17' },
    querySelector: () => ({ offsetWidth: 420, scrollWidth: 420, textContent: 'Иностранный исполнитель' }),
    querySelectorAll: () => [],
    getBoundingClientRect: () => ({ left: 399, right: 841, width: 442 }),
  };
  box.children = [field, check];
  assert.equal(T.responsiveGroupNeedsVertical(box), true,
    '830px field+checkbox must not stay horizontal on a 410px commission column');
});

test('page-following ThroughAlign reuses the preceding column title track', () => {
  const leftLabel = { style: { minWidth: '152px' } };
  const pair = {
    classList: { contains: (name) => name === 'fp-item' },
    querySelector: (sel) => sel.includes('fp-children-horizontal') ? hbox : null,
  };
  const hbox = {
    children: [{
      classList: { contains: (name) => name === 'fp-item' },
      querySelectorAll: (sel) => sel.includes('fp-field-label') ? [leftLabel] : [],
    }],
  };
  const gozLabel = { style: { minWidth: '194px' }, classList: { contains: () => false } };
  const gozField = {
    classList: { contains: (name) => name === 'fp-control' },
    querySelector: (sel) => {
      if (sel === '.fp-field-row') {
        return {
          classList: { contains: () => false },
          querySelector: (inner) => inner === '.fp-field-label' ? gozLabel : null,
        };
      }
      return null;
    },
  };
  const inner = {
    classList: { contains: (name) => name === 'fp-children-horizontal' },
    dataset: { fpThroughAlign: 'use' },
    children: [gozField],
  };
  const owner = {
    classList: { contains: (name) => name === 'fp-item' },
    parentNode: { classList: { contains: (name) => name === 'fp-pages-active-panel' } },
    previousElementSibling: pair,
    querySelector: (sel) => sel.includes('fp-children-vertical') ? inner : null,
    children: [],
  };
  owner.parentNode.children = [pair, owner];
  owner.parentNode.querySelectorAll = () => [];
  const body = {
    querySelectorAll: (sel) => sel.includes('fp-pages-active-panel')
      ? [owner.parentNode] : [],
  };
  assert.equal(T.precedingThroughAlignTitleTrackWidth(owner), 152);
  inner.classList.contains = (name) => name === 'fp-children-horizontal';
  assert.equal(T.inheritPageFollowingThroughAlignTracks(body), 0,
    'horizontal page pairs keep their own columns');
  inner.classList.contains = () => false;
  assert.equal(T.inheritPageFollowingThroughAlignTracks(body), 1);
  assert.equal(gozLabel.style.minWidth, '152px');
  assert.equal(gozLabel.style.maxWidth, '152px');
  assert.equal(gozLabel.style.whiteSpace, 'normal');
});

test('responsive group compares projected width with its finite parent track', () => {
  const parentTrack = { clientWidth: 300 };
  const owner = { parentNode: parentTrack, dataset: {} };
  const box = {
    clientWidth: 368,
    scrollWidth: 368,
    children: [],
    closest: (selector) => selector === '.fp-item' ? owner : null,
    getBoundingClientRect: () => ({ left: 0, right: 368, width: 368 }),
  };
  assert.equal(T.responsiveGroupNeedsVertical(box, true), true,
    'a projected horizontal row must not use its own widened width as available space');
  parentTrack.clientWidth = 430;
  assert.equal(T.responsiveGroupNeedsVertical(box, true), false,
    'the authored horizontal variant remains valid when the finite track is wide enough');
});

test('horizontal strategy reports the most compressed applied strategy', () => {
  assert.equal(T.selectHorizontalStrategy({}), 'auto');
  assert.equal(T.selectHorizontalStrategy({ smartCompressToRecommendedWidth: 1 }), 'smart-compress-to-recommended-width');
  assert.equal(T.horizontalStrategyValue('smart-compress-to-recommended-width'), 3);
  assert.equal(T.selectHorizontalStrategy({ smartCompressToRecommendedWidth: 2, verticalGrouping: 1 }), 'vertical-grouping');
  assert.equal(T.selectHorizontalStrategy({ smartCompressToRecommendedWidth: 2, smartCompressToMinWidth: true }), 'smart-compress-to-min-width');
  assert.equal(T.selectHorizontalStrategy({ verticalGrouping: 1 }), 'vertical-grouping');
  assert.equal(T.selectHorizontalStrategy({ verticalGrouping: 1, dontAlignButtons: 2 }), 'dont-align-buttons');
  assert.equal(T.selectHorizontalStrategy({ dontAlignButtons: 2, dontAlignTitles: 1 }), 'dont-align-titles');
  assert.equal(T.selectHorizontalStrategy({ dontAlignTitles: 1, titlesOnTop: 3 }), 'titles-on-top');
  assert.equal(T.selectHorizontalStrategy({ titlesOnTop: 3, compressWidth: true }), 'compress-width');
  assert.deepEqual(
    ['auto', 'vertical-grouping', 'dont-align-buttons', 'dont-align-titles', 'titles-on-top', 'compress-width']
      .map(T.horizontalStrategyValue),
    [0, 6, 7, 10, 11, 13]
  );
});

test('dimension bands preserve axes, authored bounds and priority categories', () => {
  const stretch = T.dimensionBands({
    properties: { Width: '20', MaxWidth: '40', HorizontalStretch: 'true' }
  }, 'InputField', { orientation: 'horizontal' });
  assert.deepEqual(
    { min: stretch.horizontal.min, normal: stretch.horizontal.normal,
      recommended: stretch.horizontal.recommended, max: stretch.horizontal.max },
    { min: 71, normal: 210, recommended: 210, max: 410 }
  );
  assert.equal(stretch.horizontal.stretchPriority, true);
  assert.equal(stretch.horizontal.compressPriority, false);
  const compact = T.dimensionBands({
    properties: { Width: '10', HorizontalStretch: 'false' }
  }, 'InputField', { orientation: 'horizontal' });
  assert.equal(compact.horizontal.compressPriority, true);
  assert.equal(compact.horizontal.stretch, false);
  assert.equal(compact.horizontal.min, 110);
  assert.equal(compact.horizontal.normal, 110);
  assert.equal(compact.horizontal.max, 110);
});

test('simple root vertical grid shares its normal column, then the viewport under pressure', () => {
  assert.equal(T.rootSimpleVerticalColumnWidth([60, 110, 210, 410], 1024, 0), 410);
  assert.equal(T.rootSimpleVerticalColumnWidth([210, 210], 480, 0), 210);
  assert.equal(T.rootSimpleVerticalColumnWidth([110, 356, 220], 1024, 0), 356);
  assert.equal(T.rootSimpleVerticalColumnWidth([410, 410], 320, 8), 320);
  assert.equal(T.rootSimpleVerticalColumnWidth([], 320, 0), 0);
});

test('authored input widths use the reference TextBox grid and chrome', () => {
  assert.deepEqual([5, 10, 20, 40].map((width) => {
    const band = T.dimensionBands({ properties: { Width: String(width) } }, 'InputField', { orientation: 'vertical' });
    return band.horizontal.normal;
  }), [60, 110, 210, 410]);
  const capped = T.dimensionBands({
    properties: { Width: '20', MaxWidth: '25', HorizontalStretch: 'true' }
  }, 'InputField', { orientation: 'vertical' });
  assert.deepEqual({ min: capped.horizontal.min, normal: capped.horizontal.normal, max: capped.horizontal.max },
    { min: 71, normal: 210, max: 260 });
  const generatedMaximum = T.dimensionBands({
    properties: { AutoMaxWidth: 'false', MaxWidth: '32' }
  }, 'InputField', { orientation: 'vertical' });
  assert.deepEqual(
    { normal: generatedMaximum.horizontal.normal, recommended: generatedMaximum.horizontal.recommended,
      max: generatedMaximum.horizontal.max },
    { normal: 320, recommended: 210, max: 320 },
    'a generated maximum does not erase the native 20-unit recommendation'
  );
  assert.equal(T.authoredEditorPaintWidth('15', 'InputField', 1), 182,
    'a drop-list button is appended after the authored 15-unit text lane');
  assert.equal(T.authoredEditorPaintWidth('12', 'InputField', 1), 152,
    'a calendar button is appended after the authored 12-unit text lane');
  assert.equal(T.authoredEditorPaintWidth('15', 'InputField', 0), 160);
  assert.equal(T.authoredAutoMaxEditorPaintWidth({ tag: 'InputField', properties: {
    Width: '5', MaxWidth: '16', AutoMaxWidth: 'false'
  } }, 'InputField'), 0,
  'an authored Width owns the paint band; MaxWidth remains a stretch cap');
  assert.equal(T.authoredAutoMaxEditorPaintWidth({ tag: 'InputField', properties: {
    Width: '15', MaxWidth: '17', AutoMaxWidth: 'false'
  } }, 'InputField', { orientation: 'horizontal' }), 180,
  'horizontal AutoMaxWidth=false paints MaxWidth=17 on the full reference ruler (ИНН 180), not Width=15');
  assert.equal(
    15 * 10 + T.taxiLayoutMetrics.authoredEditorInsetWidth,
    160,
    'Width=15 is the discarded slot; following siblings use the 176px paint'
  );
  assert.equal(T.authoredAutoMaxEditorPaintWidth({ tag: 'InputField', properties: {
    DataPath: 'Объект.НаименованиеДляПечати', MaxWidth: '29', AutoMaxWidth: 'false'
  } }, 'InputField', { orientation: 'horizontal' }), 300,
  'an omitted Width still uses the explicit non-automatic maximum paint band');
  assert.equal(T.authoredAutoMaxEditorPaintWidth({ tag: 'InputField', properties: {
    DataPath: 'КодПоОКПО', MaxWidth: '16', AutoMaxWidth: 'false'
  } }, 'InputField', { orientation: 'horizontal' }), 170,
  'ОКПО MaxWidth=16 paints the full 170px reference ruler in its horizontal row too');
  assert.equal(T.authoredAutoMaxEditorPaintWidth({ tag: 'InputField', properties: {
    MaxWidth: '31', AutoMaxWidth: 'false'
  } }, 'InputField', { orientation: 'horizontal' }), 0,
  'an unbound extension placeholder cannot paint its maximum over a following sibling');
  assert.equal(T.authoredAutoMaxEditorPaintWidth({ tag: 'InputField', properties: {
    DataPath: 'Объект.ОсобенностьУчета', MaxWidth: '50', AutoMaxWidth: 'false'
  } }, 'InputField', { orientation: 'vertical' }), 0,
  'a vertical-column maximum remains a shrinkable cap so appended buttons stay visible');
  assert.equal(T.authoredAutoMaxEditorPaintWidth({ tag: 'InputField', properties: {
    DataPath: 'Объект.НомерПервичногоДокумента', MaxWidth: '25', AutoMaxWidth: 'false'
  } }, 'InputField', { orientation: 'horizontal' }), 260,
  'a trailing MaxWidth-only editor claims its whole band instead of overpainting a narrower slot');
  const kpp = { tag: 'InputField', properties: { DataPath: 'КПП', MaxWidth: '14', AutoMaxWidth: 'false' } };
  const okpo = { tag: 'InputField', properties: { DataPath: 'КодПоОКПО', MaxWidth: '16', AutoMaxWidth: 'false' } };
  const ogrn = { tag: 'InputField', properties: { DataPath: 'ОГРН', MaxWidth: '16', AutoMaxWidth: 'false' } };
  assert.equal(T.isTrailingVisibleChild(kpp, {
    tag: 'UsualGroup', childItems: [
      { tag: 'InputField', properties: { DataPath: 'ИНН' } }, kpp
    ]
  }), true);
  assert.equal(T.isTrailingVisibleChild(okpo, {
    tag: 'UsualGroup', childItems: [okpo, ogrn]
  }), false);

  assert.equal(T.authoredEditorPaintWidth('15', 'LabelDecoration', 1), 120,
    'ordinary decorations keep the browser ruler outside a projected reference envelope');
  assert.equal(T.authoredLabelWidthEnvelopePx(
    { tag: 'LabelDecoration', properties: { Width: '15' } }), 151,
    'logical label tracks use the reference authored ruler once plus their native edge');
  assert.equal(T.unboundedLabelDecorationSlack(
    { tag: 'LabelDecoration', properties: { AutoMaxWidth: 'false' } }, 'always-horizontal'), 37);
  assert.equal(T.unboundedLabelDecorationSlack(
    { tag: 'LabelDecoration', properties: { AutoMaxWidth: 'false', Width: '15' } }, 'always-horizontal'), 0);
  assert.equal(T.authoredEditorActionCaptionWidth(41.28125), 45,
    'the compact status caption uses the DirectWrite paint advance');
  assert.equal(T.authoredEditorActionCaptionWidth(84.96875), 93,
    'the longer transfer caption uses the same paint calibration');

  const fixedEditor = (width, extra = {}) => ({
    tag: 'InputField', properties: { Width: String(width), ...extra }
  });
  const statusRow = T.layoutMeta({ tag: 'UsualGroup', properties: { Group: 'Horizontal' }, childItems: [
    fixedEditor(15, { HorizontalStretch: 'false' }), fixedEditor(12),
    { tag: 'Button', properties: {} }
  ] });
  assert.equal(statusRow.authoredEditorActionRow, true);
  assert.equal(T.layoutMeta({ tag: 'UsualGroup', properties: { Group: 'Horizontal' }, childItems: [
    fixedEditor(15, { HorizontalStretch: 'false' }), fixedEditor(12)
  ] }).authoredEditorActionRow, false, 'an ordinary fixed pair has no appended action segment');
  assert.equal(T.layoutMeta({ tag: 'UsualGroup', properties: { Group: 'Horizontal' }, childItems: [
    fixedEditor(15), fixedEditor(12), { tag: 'Button', properties: {} }
  ] }).authoredEditorActionRow, false, 'the leading explicit fixed marker is required');
});

test('AutoMaxWidth=false MaxWidth editors paint the full reference +10 ruler in rows and columns', () => {
  /* The reference paints MaxWidth 9/12/28/29/34/73 as 101/131/290/300/351/740 px
   * frames. The old +6 inset left these fields 4-5px narrow with the left edge
   * matching. */
  assert.deepEqual([9, 12, 28, 29, 34, 73].map((chars) => T.autoMaxEditorBandWidth(chars)),
    [100, 130, 290, 300, 350, 740]);
  assert.equal(T.autoMaxEditorBandWidth(17), 180,
    'a horizontal row paints the same ruler; an over-wide row is compressed instead');
  assert.equal(T.autoMaxEditorBandWidth(16), 170,
    'AutoMaxWidth=true keeps the char-unit ruler +10');
  assert.equal(T.autoMaxEditorBandWidth(0), 0);
});

test('native Taxi control heights, title gaps, page padding and window chrome match the reference', () => {
  assert.deepEqual([1, 2, 3].map((height) => T.authoredControlHeightPx(String(height), 'InputField')),
    [25, 55, 85]);
  assert.equal(T.authoredControlHeightPx('2', 'LabelDecoration'), 36);
  assert.equal(T.taxiLayoutMetrics.windowChrome.width, 21);
  assert.equal(T.taxiLayoutMetrics.windowChrome.height, 44);
  assert.equal(T.taxiLayoutMetrics.pagePadding.horizontal, 10);
  assert.equal(T.taxiLayoutMetrics.pagePadding.vertical, 9);
  assert.equal(T.taxiLayoutMetrics.throughAlignTitleChrome, 11);
  assert.equal(T.taxiLayoutMetrics.commandBarHeight, 27);
  assert.equal(T.taxiLayoutMetrics.checkBoxHeight, 17);
  assert.equal(T.taxiLayoutMetrics.radioButtonHeight, 17);
  assert.equal(T.taxiLayoutMetrics.buttonCaptionChromeWidth, 27);
  assert.equal(T.taxiLayoutMetrics.iconButtonWidth, 28);
  assert.equal(T.taxiLayoutMetrics.viewStatusHeight, 23);
  assert.equal(T.taxiLayoutMetrics.autoMaxEditorPaintInset, 10);
  assert.equal(T.taxiLayoutMetrics.compressedFieldMinimumWidth, 71);
  assert.equal(T.taxiLayoutMetrics.autoMaxEditorRowInset, undefined,
    'the temporary +6 row compensation is gone; over-wide rows compress instead');
  assert.equal(T.taxiLayoutMetrics.sideTitleGap, 5);
  assert.equal(T.taxiLayoutMetrics.topTitleGap, 4);
  assert.equal(T.taxiLayoutMetrics.rowGap, 9);
  assert.deepEqual(JSON.parse(JSON.stringify(T.htmlDocumentAuthoredSize({
    properties: { Width: '20', Height: '5' }
  }))), { width: 200, height: 132 });
  assert.deepEqual(JSON.parse(JSON.stringify(T.htmlDocumentAuthoredSize({
    properties: { Height: '1' }
  }))), { width: 0, height: 20 });
  assert.deepEqual(JSON.parse(JSON.stringify(T.chartAuthoredSize({
    properties: { Width: '45', MaxHeight: '15' }
  }))), { width: 450, height: 0, maxHeight: 240 });
  assert.deepEqual(JSON.parse(JSON.stringify(T.chartAuthoredSize({
    properties: { Width: '45', Height: '10', MaxHeight: '15' }
  }))), { width: 450, height: 160, maxHeight: 240 });
  assert.equal(T.chartFillRemainingHeight(240, 120), 120);
  assert.equal(T.chartFillRemainingHeight(240, 400), 240);
  assert.equal(T.chartFillRemainingHeight(240, 0), 240);
});

test('explicit cross-axis alignment overrides the ThroughAlign stretch default', () => {
  const meta = T.layoutMeta({
    tag: 'Page',
    properties: {
      Group: 'AlwaysHorizontal', HorizontalAlign: 'Center', VerticalAlign: 'Center',
    },
    childItems: [
      { tag: 'PictureDecoration', properties: {} },
      { tag: 'LabelDecoration', properties: { Title: 'Preview' } },
    ],
  });
  assert.equal(meta.flexJustifyContent, 'center');
  assert.equal(meta.flexAlignItems, 'center');
});

test('only a Pages that paints a tab strip drops the item shell top chrome', () => {
  /* The reference starts the strip on the top edge of the box the parent allocates. The
   * shell's 1px padding plus 1px selection border above it cost 2px per level
   * of nested Pages, so the vertical cadence drifted down with the nesting
   * depth (38px per level against the reference's 27px strip + 9px page inset).
   * PagesRepresentation=None paints no strip and keeps the ordinary shell. */
  const shellClasses = new Set(['fp-item']);
  const shell = {
    classList: {
      contains: (name) => shellClasses.has(name),
      add: (name) => shellClasses.add(name),
      remove: (name) => shellClasses.delete(name),
    },
  };
  const innerClasses = new Set(['fp-children']);
  const box = {
    parentNode: shell,
    classList: {
      contains: (name) => innerClasses.has(name),
      add: (name) => innerClasses.add(name),
      remove: (name) => innerClasses.delete(name),
    },
  };

  T.markPagesTabbedShell(box, true);
  assert.equal(shellClasses.has('fp-pages-tabbed'), true,
    'a tabbed Pages marks its owning item shell, not the inner box');
  assert.equal(innerClasses.has('fp-pages-tabbed'), false);

  // Re-rendering the same Pages as PagesRepresentation=None restores the shell.
  T.markPagesTabbedShell(box, false);
  assert.equal(shellClasses.has('fp-pages-tabbed'), false,
    'PagesRepresentation=None keeps the ordinary item shell chrome');

  // A box with no owning .fp-item ancestor must not throw or mark anything.
  const orphanClasses = new Set(['fp-children']);
  T.markPagesTabbedShell({
    parentNode: null,
    classList: {
      contains: (name) => orphanClasses.has(name),
      add: (name) => orphanClasses.add(name),
      remove: (name) => orphanClasses.delete(name),
    },
  }, true);
  assert.equal(orphanClasses.has('fp-pages-tabbed'), false);
});

test('root tabbed Pages keeps its active content preferred height while retaining viewport growth', () => {
  assert.equal(T.rootPagesPreferredHeight(632, 600, 1066), 1098);
  assert.equal(T.rootPagesPreferredHeight(700, 668, 300), 700,
    'short page content keeps the already allocated growing viewport height');
  const classes = new Set(['fp-item', 'fp-pages-tabs']);
  const panel = {
    clientHeight: 600, scrollHeight: 1066,
    querySelector: () => null,
  };
  const pages = {
    classList: {
      contains: (name) => classes.has(name),
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
    },
    dataset: { tag: 'Pages' }, style: { flex: '', minHeight: '' },
    querySelector: (selector) => selector === '.fp-pages-active-panel' ? panel : null,
    getBoundingClientRect: () => ({ height: 632 }),
  };
  const footer = {
    classList: { contains: (name) => name === 'fp-item' },
    getBoundingClientRect: () => ({ top: 883, height: 30 }),
  };
  const body = {
    children: [pages, footer], clientHeight: 983,
    getBoundingClientRect: () => ({ top: 0 }),
  };
  assert.equal(T.fitRootPagesPreferredHeights(body), 1);
  // Native Pages minHeight is the page content minimum.
  assert.equal(pages.style.minHeight, '1098px');
  assert.equal(pages.style.flex, '1 0 1098px');
  panel.querySelector = () => ({});
  pages.style.flex = '';
  pages.style.minHeight = '';
  assert.equal(T.fitRootPagesPreferredHeights(body), 0,
    'a table owns a shrinkable native height range inside root Pages');
});

test('a page-local command lane gives its filter editor the native 40-unit band', () => {
  const page = T.layoutMeta({ tag: 'Page', properties: {}, childItems: [
    { tag: 'CommandBar', properties: {} },
    { tag: 'InputField', properties: {} }
  ] });
  const band = T.dimensionBands({ properties: {} }, 'InputField', page);
  assert.equal(band.horizontal.normal, 410);
  assert.equal(band.horizontal.stretch, false);
});

test('dimension allocator grows stretch-first and compresses compress-first', () => {
  const bands = [
    { min: 20, normal: 50, max: 100, stretchPriority: true, compressPriority: false },
    { min: 20, normal: 50, max: 100, stretchPriority: false, compressPriority: false },
    { min: 20, normal: 50, max: 100, stretchPriority: false, compressPriority: true },
  ];
  assert.deepEqual(T.distributeDimensionBands(bands, 180), [80, 50, 50]);
  assert.deepEqual(T.distributeDimensionBands(bands, 120), [50, 50, 20]);
  assert.deepEqual(T.distributeDimensionBands(bands, 75), [35, 20, 20]);
});

test('horizontal reference allocator rounds deterministically and does not grow fixed tracks', () => {
  const tracks = [
    { min: 71, normal: 110, max: 410, stretch: true, stretchPriority: true },
    { min: 210, normal: 210, max: 210, stretch: false, compress: false },
    { min: 71, normal: 210, max: 260, stretch: true },
  ];
  assert.deepEqual(T.allocateHorizontalDimensionBands(tracks, 510), [110, 210, 190]);
  assert.deepEqual(T.allocateHorizontalDimensionBands(tracks, 391), [110, 210, 71]);
});

test('a plain row of a fixed reference editor and a stretch sibling is allocator owned', () => {
  const stretch = { dataset: { fpWidthStretch: '1', tag: 'InputField' } };
  const editor = { dataset: { fpWidthStretch: '0', tag: 'InputField', fieldKind: 'ref' } };
  assert.equal(T.plainSemanticEditorRow([stretch, editor]), true,
    'the trailing reference keeps its native presentation band');
  assert.equal(T.plainSemanticEditorRow([
    stretch, { dataset: { ...editor.dataset, fpAuthoredWidthPresent: '1' } },
  ]), false, 'an authored Width already owns a local band');
  assert.equal(T.plainSemanticEditorRow([editor, { ...editor }]), false,
    'without a stretch child CSS flex leaves no surplus to redistribute');
  assert.equal(T.plainSemanticEditorRow([
    stretch, { dataset: { fpWidthStretch: '0', tag: 'Button' } },
  ]), false, 'only value editors publish a native presentation band');
});

test('detached logical pair shares a bounded trailing authored normal band', () => {
  const pair = [
    { min: 282, normal: 405, recommended: 405, max: 405, stretch: false },
    { min: 228, normal: 437, recommended: 367, max: 437, stretch: false },
  ];
  assert.equal(T.balancedBoundedLogicalPairWidth(pair), 437);
  assert.equal(T.balancedBoundedLogicalPairWidth([
    { ...pair[0], stretch: true, max: Infinity }, pair[1],
  ]), 437, 'a responsive leading wrapper does not own the trailing value surplus');
  assert.equal(T.balancedBoundedLogicalPairWidth([
    pair[0], { ...pair[1], recommended: 437 },
  ]), 0, 'no recovery is needed without a recommendation shortfall');
  assert.equal(T.balancedBoundedLogicalPairWidth([
    { ...pair[0], recommended: 335 }, pair[1],
  ]), 0, 'the leading logical column must already own its normal band');
  assert.equal(T.balancedBoundedLogicalPairWidth([
    pair[0], { ...pair[1], stretch: true, max: Infinity },
  ]), 0, 'unbounded responsive columns keep the ordinary stretch allocator');
  assert.equal(T.balancedBoundedLogicalPairWidth([
    { ...pair[0], normal: 450, recommended: 450, max: 450 }, pair[1],
  ]), 0, 'a narrower trailing normal cannot become the common pair width');
});

test('ChildItemsWidth constraints replace viewport-dependent CSS ratios', () => {
  const equal = [
    { min: 50, normal: 100, max: 300, stretch: true },
    { min: 50, normal: 150, max: 300, stretch: true },
  ];
  assert.deepEqual(T.allocateHorizontalDimensionBands(equal, 400, 'equal'), [200, 200]);
  const leftWide = [
    { min: 100, normal: 550, max: 900, stretch: true },
    { min: 100, normal: 300, max: 600, stretch: true },
  ];
  assert.deepEqual(T.allocateHorizontalDimensionBands(leftWide, 1000, 'leftwidest'), [700, 300]);
  const leftWideFixed = [
    { min: 550, normal: 550, max: 550, stretch: false, compressPriority: true },
    { min: 100, normal: 300, max: Infinity, stretch: true },
  ];
  assert.deepEqual(
    T.allocateHorizontalDimensionBands(leftWideFixed, 960, 'leftwidest'),
    [550, 410],
    'LeftWide does not grow a HorizontalStretch=false Width column'
  );
});

test('compressed detached Equal and nested LeftWide lanes use stable semantic bands', () => {
  const outer = [
    { min: 253, normal: 601, max: 601, stretch: true },
    { min: 338, normal: 338, max: null, stretch: true },
  ];
  assert.deepEqual(T.detachedEqualPairSizes(outer, 990, 10), [480, 480]);
  assert.deepEqual(Array.from(T.managedCompressedLeftWideSizes(445)), [265, 180]);
  assert.equal(T.managedIndependentTitleTrackWidth([79, 40]), 84);
  assert.equal(T.managedIndependentTitleTrackWidth([31, 40]), 43);
});

test('recursive bare column trees are distinguished from detached logical subgrids', () => {
  const makeItem = (orientation, children = [], logical = false) => {
    const item = {};
    const names = new Set(['fp-children', 'fp-container-bare', `fp-children-${orientation}`]);
    if (logical) names.add('fp-logical-subgrid');
    const box = {
      classList: { contains: (name) => names.has(name) },
      children,
      closest: (selector) => selector === '.fp-item' ? item : null,
    };
    item.classList = { contains: (name) => name === 'fp-item' };
    item.querySelectorAll = () => [box];
    return { item, box };
  };
  const first = makeItem('vertical');
  const secondA = makeItem('vertical');
  const secondB = makeItem('vertical');
  const nested = makeItem('horizontal', [secondA.item, secondB.item]);
  const last = makeItem('vertical');
  const outer = makeItem('horizontal', [first.item, nested.item, last.item]);
  assert.equal(T.isRecursiveAutomaticColumnTree(outer.box, outer.box.children), true);

  const detached = makeItem('vertical', [], true);
  const guarded = makeItem('horizontal', [first.item, nested.item, detached.item]);
  assert.equal(T.isRecursiveAutomaticColumnTree(guarded.box, guarded.box.children), false);
});

test('UsualGroup without Group is horizontal (configurator default)', () => {
  const omitted = T.layoutMeta({
    tag: 'UsualGroup',
    properties: { Representation: 'None', ShowTitle: 'false' }
  });
  assert.equal(omitted.orientation, 'horizontal');
  const vertical = T.layoutMeta({
    tag: 'UsualGroup',
    properties: { Group: 'Vertical', Representation: 'None' }
  });
  assert.equal(vertical.orientation, 'vertical');
  const page = T.layoutMeta({ tag: 'Page', properties: {} });
  assert.equal(page.orientation, 'vertical');
});

test('top-title inputs stretch, default width is compact for side titles', () => {
  const top = { properties: { TitleLocation: 'Top' } };
  const side = { properties: {} };
  assert.equal(T.wantsHStretch(top, 'InputField', null), true);
  assert.equal(T.wantsHStretch(side, 'InputField', null), false);
  assert.equal(T.wantsHStretch(side, 'InputField', T.layoutMeta({
    tag: 'UsualGroup', properties: { Group: 'Vertical' }
  })), true, 'a scalar field fills the value column of its vertical group');
  assert.equal(T.wantsHStretch(side, 'InputField', T.layoutMeta({
    tag: 'Page', properties: {}, childItems: [
      { tag: 'CommandBar', properties: {} },
      { tag: 'InputField', properties: {} }
    ]
  })), false, 'a page-local command lane keeps its adjacent filter field intrinsic');
  assert.equal(T.wantsHStretch({ properties: { HorizontalStretch: 'false' } },
    'InputField', T.layoutMeta({ tag: 'UsualGroup', properties: { Group: 'Vertical' } })), false,
  'an explicitly compact field remains compact in a vertical group');
  assert.equal(T.wantsHStretch(side, 'InputField', T.layoutMeta({
    tag: 'UsualGroup', properties: { Group: 'Vertical', Width: '83' }
  })), false, 'an explicit-width column preserves the field preferred width');
  const ctx = { captionIndex: { types: {
    'Объект.Значение1': 'xs:dateTime',
    'Объект.Значение2': 'xs:decimal'
  } } };
  assert.equal(T.defaultFieldChars({ properties: { DataPath: 'Объект.Значение1' } }, ctx), 17);
  assert.equal(T.defaultFieldChars({ properties: { DataPath: 'Объект.Значение2' } }, ctx), 15);
  assert.equal(T.defaultFieldChars({ properties: { DataPath: 'Объект.Контрагент' } }), 20);
});

test('a lone short qualified string keeps its native compact horizontal band', () => {
  const objectMeta = `<?xml version="1.0" encoding="UTF-8"?>
<MetaDataObject xmlns="http://v8.1c.ru/8.3/MDClasses" xmlns:v8="http://v8.1c.ru/8.1/data/core">
  <Document><Properties><Name>Документ</Name></Properties><ChildObjects>
    <Attribute><Properties><Name>Код</Name><Type><v8:Type>xs:string</v8:Type>
      <v8:StringQualifiers><v8:Length>4</v8:Length></v8:StringQualifiers>
    </Type></Properties></Attribute>
  </ChildObjects></Document>
</MetaDataObject>`;
  const model = {
    attributes: [{ name: 'Объект', properties: { MainAttribute: 'true' }, columns: [], stringLen: 0 }],
    objectMeta: T.parseObjectMeta(objectMeta),
  };
  const ctx = { captionIndex: T.buildCaptionIndex(model) };
  const field = { tag: 'InputField', properties: { DataPath: 'Объект.Код', Title: 'Код' } };
  const parent = T.layoutMeta({ tag: 'UsualGroup', properties: {
    Group: 'Horizontal', Representation: 'None', ShowTitle: 'false',
  }, childItems: [field] });
  assert.equal(T.compactQualifiedSingleFieldWidth(field, field.tag, parent, ctx), 50);
  assert.equal(T.wantsHStretch(field, field.tag, parent, ctx), false);
  assert.deepEqual({ ...T.dimensionBands(field, field.tag, parent, ctx).horizontal }, {
    min: 50, normal: 50, recommended: 50, max: 50,
    stretch: false, stretchPriority: false, compressPriority: false,
  });
  assert.equal(T.compactQualifiedSingleFieldWidth({ ...field, properties: {
    ...field.properties, HorizontalStretch: 'true',
  } }, field.tag, parent, ctx), 0, 'an explicit stretch remains authoritative');
  const pair = T.layoutMeta({ tag: 'UsualGroup', properties: { Group: 'Horizontal' },
    childItems: [field, { tag: 'InputField', properties: {} }] });
  assert.equal(T.compactQualifiedSingleFieldWidth(field, field.tag, pair, ctx), 0,
    'a multi-field row keeps its ordinary surplus owner');
});

test('typed reference fields use the native 15-char presentation width', () => {
  const objectMeta = `<?xml version="1.0" encoding="UTF-8"?>
<MetaDataObject xmlns="http://v8.1c.ru/8.3/MDClasses" xmlns:v8="http://v8.1c.ru/8.1/data/core">
  <Document><Properties><Name>Документ</Name></Properties><ChildObjects>
    <Attribute><Properties><Name>Ответственный</Name><Type><v8:Type>cfg:CatalogRef.Пользователи</v8:Type></Type></Properties></Attribute>
  </ChildObjects></Document>
</MetaDataObject>`;
  const model = {
    attributes: [{ name: 'Объект', properties: { MainAttribute: 'true' }, columns: [], stringLen: 0 }],
    objectMeta: T.parseObjectMeta(objectMeta)
  };
  const ctx = { captionIndex: T.buildCaptionIndex(model) };
  const field = { properties: { DataPath: 'Объект.Ответственный' } };
  assert.equal(T.metaType(field, ctx), 'cfg:CatalogRef.Пользователи');
  assert.equal(T.defaultFieldChars(field, ctx), 15);
});

test('enum references use the compact native selector width', () => {
  const ctx = { captionIndex: { types: {
    'Объект.Статус': 'cfg:EnumRef.СтатусыДокументов',
    'Объект.Партнер': 'cfg:CatalogRef.Партнеры',
  } } };
  assert.equal(T.defaultFieldChars({ properties: { DataPath: 'Объект.Статус' } }, ctx), 15);
  assert.equal(T.defaultFieldChars({ properties: { DataPath: 'Объект.Партнер' } }, ctx), 15);
  assert.equal(T.defaultEditorPaintWidth(
    { properties: { DataPath: 'Объект.Статус' } }, ctx, 'InputField', 1), 141,
    'the compact value lane keeps its appended drop-list button');
});

test('a default width clamped to 40 units keeps its buttons inside the band', () => {
  assert.equal(T.presentationLengthOf(['xs:string'], { stringLen: 100 }), 50);
  assert.equal(T.defaultCharsOf(['xs:string'], { stringLen: 100 }), 40);
  assert.equal(T.presentationLengthOf(['xs:string'], { stringLen: 40 }), 40);
  const clamped = { properties: {}, runtime: { defaultChars: 40, presentationLength: 50 } };
  const exact = { properties: {}, runtime: { defaultChars: 40, presentationLength: 40 } };
  assert.equal(T.defaultWidthClampsButtons(clamped, {}), true);
  const lifted = { properties: { AutoMaxWidth: 'false', MaxWidth: '59' }, runtime: { presentationLength: 50 } };
  const capped = { properties: { AutoMaxWidth: 'false', MaxWidth: '29' }, runtime: { presentationLength: 50 } };
  assert.equal(T.defaultWidthClampsButtons(lifted, {}), false,
    'AutoMaxWidth=false skips the 40-unit clamp; MaxWidth 59 does not clamp 50');
  assert.equal(T.defaultWidthClampsButtons(capped, {}), true);
  assert.equal(T.defaultEditorPaintWidth(clamped, {}, 'InputField', 1), 320,
    'String(100) with ChoiceButton: DefFilter drops buttonsCount after the dataMaxLength clamp');
  assert.equal(T.defaultEditorPaintWidth(exact, {}, 'InputField', 1), 341,
    'String(40) is not clamped and keeps its appended button lane');
});

test('NumberQualifiers and DateQualifiers size fields by their actual precision', () => {
  const objectMeta = `<?xml version="1.0" encoding="UTF-8"?>
<MetaDataObject xmlns="http://v8.1c.ru/8.3/MDClasses" xmlns:v8="http://v8.1c.ru/8.1/data/core">
  <Document><Properties><Name>Документ</Name></Properties><ChildObjects>
    <Attribute><Properties><Name>Количество</Name><Type><v8:Type>xs:decimal</v8:Type>
      <v8:NumberQualifiers><v8:Digits>1</v8:Digits><v8:FractionDigits>0</v8:FractionDigits>
      <v8:AllowedSign>Nonnegative</v8:AllowedSign></v8:NumberQualifiers></Type></Properties></Attribute>
    <Attribute><Properties><Name>СуммаДокумента</Name><Type><v8:Type>xs:decimal</v8:Type>
      <v8:NumberQualifiers><v8:Digits>15</v8:Digits><v8:FractionDigits>3</v8:FractionDigits>
      <v8:AllowedSign>Any</v8:AllowedSign></v8:NumberQualifiers></Type></Properties></Attribute>
    <Attribute><Properties><Name>ДатаОплаты</Name><Type><v8:Type>xs:dateTime</v8:Type>
      <v8:DateQualifiers><v8:DateFractions>Date</v8:DateFractions></v8:DateQualifiers></Type></Properties></Attribute>
    <Attribute><Properties><Name>НачалоСмены</Name><Type><v8:Type>xs:dateTime</v8:Type>
      <v8:DateQualifiers><v8:DateFractions>Time</v8:DateFractions></v8:DateQualifiers></Type></Properties></Attribute>
    <Attribute><Properties><Name>ДатаВремяСобытия</Name><Type><v8:Type>xs:dateTime</v8:Type>
      <v8:DateQualifiers><v8:DateFractions>DateTime</v8:DateFractions></v8:DateQualifiers></Type></Properties></Attribute>
  </ChildObjects></Document>
</MetaDataObject>`;
  const model = {
    attributes: [{ name: 'Объект', properties: { MainAttribute: 'true' }, columns: [], stringLen: 0 }],
    objectMeta: T.parseObjectMeta(objectMeta)
  };
  const ctx = { captionIndex: T.buildCaptionIndex(model) };
  const count = { properties: { DataPath: 'Объект.Количество' } };
  const sum = { properties: { DataPath: 'Объект.СуммаДокумента' } };
  const date = { properties: { DataPath: 'Объект.ДатаОплаты' } };
  /* NumberQualifiers/DateQualifiers refine width after the metadata type,
   * independently of how the attribute happens to be named. */
  const time = { properties: { DataPath: 'Объект.НачалоСмены' } };
  const dateTime = { properties: { DataPath: 'Объект.ДатаВремяСобытия' } };
  assert.equal(T.metaNumberQualifiers(count, ctx).digits, 1);
  /* Reference property defaults: digits-to-chars with 5.4/5.5÷8, dates after the
   * presentationLength cut (+2 past compat 8.3.6). */
  assert.equal(T.defaultFieldChars(count, ctx), 1);
  assert.equal(T.defaultFieldChars(sum, ctx), 14);
  assert.equal(T.defaultFieldChars(date, ctx), 9);
  assert.equal(T.defaultFieldChars(time, ctx), 8);
  assert.equal(T.defaultFieldChars(dateTime, ctx), 17);
});

test('tables and pages stretch, inputs stay compact', () => {
  assert.equal(T.wantsHStretch({ properties: {} }, 'Table', null), true);
  assert.equal(T.wantsHStretch({ properties: {} }, 'Pages', null), true);
  assert.equal(T.wantsHStretch({ properties: { PagesRepresentation: 'None' } }, 'Pages', null), false);
  assert.equal(T.wantsHStretch({ properties: {} }, 'InputField', null), false);
});

test('hidden pages propagate spreadsheet stretch through wrapper groups', () => {
  const sheet = { tag: 'SpreadSheetDocumentField', properties: {} };
  const page = { tag: 'Page', properties: {}, childItems: [sheet] };
  const pages = {
    tag: 'Pages', properties: { PagesRepresentation: 'None' }, childItems: [page]
  };
  const group = { tag: 'UsualGroup', properties: { Group: 'Horizontal' }, childItems: [pages] };
  assert.equal(T.wantsHStretch(pages, 'Pages', null), true);
  assert.equal(T.wantsVStretch(pages, 'Pages'), true);
  assert.equal(T.wantsVStretch(group, 'UsualGroup'), true);
});

test('a tab set nested in a tabbed page stays content-sized unless it opts in', () => {
  /* Pages > tabbed Page > nested Pages. */
  const inner = { tag: 'Pages', properties: { PagesRepresentation: 'TabsOnTop' }, childItems: [
    { tag: 'Page', properties: {}, childItems: [{ tag: 'LabelDecoration', properties: {} }] },
  ] };
  const outer = { tag: 'Pages', properties: { PagesRepresentation: 'TabsOnTop' }, childItems: [
    { tag: 'Page', properties: {}, childItems: [inner] },
  ] };
  const ctx = { model: { childItemsRoot: [outer] } };
  assert.equal(T.wantsVStretch(outer, 'Pages', ctx), true, 'the outermost tab set keeps the default stretch');
  assert.equal(T.wantsVStretch(inner, 'Pages', ctx), false, 'a nested tab set is content-sized');
  const explicit = { ...inner, properties: { PagesRepresentation: 'TabsOnTop', VerticalStretch: 'true' } };
  const explicitCtx = { model: { childItemsRoot: [{ ...outer, childItems: [{ tag: 'Page', properties: {}, childItems: [explicit] }] }] } };
  assert.equal(T.wantsVStretch(explicit, 'Pages', explicitCtx), true, 'authored VerticalStretch=true still stretches');
  const hidden = { tag: 'Pages', properties: { PagesRepresentation: 'None' }, childItems: [
    { tag: 'Page', properties: {}, childItems: [inner] },
  ] };
  assert.equal(T.wantsVStretch(inner, 'Pages', { model: { childItemsRoot: [hidden] } }), true,
    'a hidden-tab layer is not a tabbed page');
});

test('a hidden page stretches locally without expanding a compact parent', () => {
  const page = {
    tag: 'Page', properties: { VerticalStretch: 'true' },
    childItems: [{ tag: 'InputField', properties: { Width: '10' } }]
  };
  const pages = {
    tag: 'Pages', properties: { PagesRepresentation: 'None' }, childItems: [page]
  };
  const footer = {
    tag: 'UsualGroup', properties: { Group: 'Horizontal' }, childItems: [pages]
  };

  assert.equal(T.wantsVStretch(page, 'Page'), true,
    'the page still fills its own Pages control');
  assert.equal(T.wantsVStretch(pages, 'Pages'), false,
    'the hidden page layer does not request remaining form height');
  assert.equal(T.wantsVStretch(footer, 'UsualGroup'), false,
    'the compact footer remains content-sized');
});

test('an authored-height hidden page explicitly joins its parent vertical split', () => {
  const pages = {
    tag: 'Pages', name: 'PreviewPages', properties: { PagesRepresentation: 'None' },
    childItems: [{
      tag: 'Page', name: 'Preview', properties: { Height: '10', VerticalStretch: 'true' },
      childItems: [{ tag: 'LabelDecoration', properties: { Title: 'Preview' } }],
    }],
  };
  assert.equal(T.wantsVStretch(pages, 'Pages', {}), true);
});

test('regular horizontal logical columns get separators unless detached', () => {
  const column = (id, united) => ({
    tag: 'UsualGroup', id, properties: {
      Group: 'Vertical', Representation: 'None', ...(united == null ? {} : { United: united })
    }, childItems: [{ tag: 'InputField', id: `${id}-field`, properties: {} }]
  });
  const ordinary = T.layoutMeta({
    tag: 'UsualGroup', properties: { Group: 'Horizontal', Representation: 'None' },
    childItems: [column('left'), column('right')]
  });
  assert.equal(ordinary.automaticColumnSeparators, true);
  const omittedRepresentation = column('implicit');
  delete omittedRepresentation.properties.Representation;
  assert.equal(T.layoutMeta({
    tag: 'UsualGroup', properties: { Group: 'Horizontal', Representation: 'None' },
    childItems: [omittedRepresentation, column('explicit')]
  }).automaticColumnSeparators, true,
  'omitted UsualGroupRepresentation is the EMF default None');
  assert.equal(T.layoutMeta({
    tag: 'UsualGroup', properties: { Group: 'AlwaysHorizontal', Representation: 'None' },
    childItems: [column('left'), column('right')]
  }).automaticColumnSeparators, false);
  assert.equal(T.layoutMeta({
    tag: 'UsualGroup', properties: { Group: 'Horizontal', Representation: 'None' },
    childItems: [column('left', 'false'), column('right', 'false')]
  }).automaticColumnSeparators, false);
});

test('bare non-united groups keep their own logical subgrid in either parent orientation', () => {
  const group = (orientation) => ({
    tag: 'UsualGroup', properties: {
      Group: orientation, Representation: 'None', ShowTitle: 'false', United: 'false'
    }, childItems: [{ tag: 'InputField', properties: {} }, { tag: 'InputField', properties: {} }]
  });
  for (const orientation of ['Vertical', 'AlwaysHorizontal']) {
    const meta = T.layoutMeta(group(orientation));
    assert.equal(meta.logicalSubgrid, true);
    assert.match(T.layoutClass(meta), /(?:^| )fp-logical-subgrid(?: |$)/);
    assert.match(T.layoutClass(meta), new RegExp(`(?:^| )fp-children-${meta.orientation}(?: |$)`));
  }
  const css = fs.readFileSync(path.join(root, 'packages', '1c-preview-core', 'browser', 'viewer.css'), 'utf8');
  assert.doesNotMatch(css, /\.fp-group-split\s*\{/,
    'a logical subgrid uses its authored Taxi spacing instead of an independent split gap');
});

test('a title stays inside the logical subgrid; visible representations and tooltips keep a wrapper', () => {
  const base = { tag: 'UsualGroup', properties: {
    Group: 'Vertical', Representation: 'None', ShowTitle: 'false', United: 'false'
  }, childItems: [] };
  const titled = { ...base, properties: { ...base.properties, ShowTitle: 'true', Title: 'Caption' } };
  assert.equal(T.layoutMeta(titled).logicalSubgrid, true,
    'Reference projects the title as a grid leaf instead of retaining the non-united wrapper');
  const variants = [
    { ...base, properties: { ...base.properties, Representation: 'NormalSeparation' } },
    { ...base, properties: { ...base.properties, ToolTip: 'Help' } },
    { ...base, tag: 'CollapsibleGroup' },
  ];
  for (const item of variants) {
    const meta = T.layoutMeta(item);
    assert.equal(meta.logicalSubgrid, false);
    assert.doesNotMatch(T.layoutClass(meta), /(?:^| )fp-logical-subgrid(?: |$)/);
  }
});

test('logical subgrid bands preserve nested row grouping and use value recommendations', () => {
  const leaf = (normal, recommended, minimum = 71) => ({
    min: minimum, normal, recommended, max: normal, stretch: false
  });
  const horizontal = T.combineLogicalSubgridBands([leaf(170, 170), leaf(200, 200)], 'horizontal', 8);
  assert.deepEqual(
    { min: horizontal.min, normal: horizontal.normal, recommended: horizontal.recommended, max: horizontal.max },
    { min: 150, normal: 378, recommended: 378, max: 378 }
  );
  const vertical = T.combineLogicalSubgridBands([horizontal, leaf(439, 348)], 'vertical', 3);
  assert.deepEqual(
    { min: vertical.min, normal: vertical.normal, recommended: vertical.recommended, max: vertical.max },
    { min: 150, normal: 439, recommended: 378, max: 439 }
  );
  assert.equal(vertical.stretch, false, 'a dissolved wrapper cannot consume the parent surplus');
  for (const sample of [
    { id: 'a', left: 412, right: 422, total: 844 },
    { id: 'b', left: 383, right: 348, total: 741 },
    { id: 'c', left: 430, right: 305, total: 745 },
  ]) {
    const envelope = T.combineLogicalSubgridBands(
      [leaf(sample.left, sample.left), leaf(sample.right, sample.right)],
      'horizontal', 10
    );
    assert.equal(envelope.recommended, sample.total, `sample ${sample.id} logical envelope`);
    assert.equal(sample.left + 10, { a: 422, b: 393, c: 440 }[sample.id],
      `sample ${sample.id} right-column offset`);
  }
});

test('semantic editor bands keep native text and appended-button lanes separate', () => {
  const automaticReference = T.semanticEditorAllocationBand(
    { min: 71, normal: 161, recommended: 161, max: Infinity },
    { reference: true, buttons: 2 }
  );
  assert.deepEqual(
    { min: automaticReference.min, recommended: automaticReference.recommended },
    { min: 113, recommended: 203 }
  );

  const explicitDate = T.semanticEditorAllocationBand(
    { min: 71, normal: 110, recommended: 110, max: 110 },
    { declared: 110, buttons: 1, explicitSideTitle: true }
  );
  assert.deepEqual({ ...explicitDate }, { min: 71, normal: 132, recommended: 132, max: 132 });

  const automaticTitle = T.semanticEditorAllocationBand(
    { min: 71, normal: 110, recommended: 110, max: 110 },
    { declared: 110, buttons: 1, tooltip: true, explicitSideTitle: false }
  );
  assert.deepEqual({ ...automaticTitle }, { min: 71, normal: 124, recommended: 124, max: 124 });
});

test('page scroll canvas restores the automatic reference editor presentation band', () => {
  const compressed = {
    min: 71, normal: 486, recommended: 486, max: Infinity,
    stretch: true, stretchPriority: false, compressPriority: false,
    compress: true, explicit: false,
  };
  const restored = T.automaticEditorScrollAllocationBand(compressed, 320, true);
  assert.deepEqual(
    { normal: restored.normal, recommended: restored.recommended, max: restored.max },
    { normal: 576, recommended: 576, max: Infinity }
  );
  assert.deepEqual(
    { ...T.automaticEditorScrollAllocationBand(compressed, 320, false) },
    compressed,
    'ordinary responsive rows keep their established compressed allocation'
  );
});

test('semantic editor paint bands use the reference cap only for its rich tooltip owner', () => {
  const tooltipChrome = T.taxiLayoutMetrics.tooltipButtonWidth
    + T.taxiLayoutMetrics.tooltipButtonGap
    + T.taxiLayoutMetrics.inputBorderChromeWidth;
  assert.deepEqual(
    { ...T.semanticEditorPaintBand({
      maximum: 290, natural: 160, autoMaxWidth: false
    }) },
    { preferred: 290, maximum: 290 }
  );
  assert.deepEqual(
    { ...T.semanticEditorPaintBand({
      maximum: 270, appendedChrome: tooltipChrome, natural: 160,
      autoMaxWidth: true, occupiesMaximum: true,
    }) },
    { preferred: 287, maximum: 287 }
  );
  assert.deepEqual(
    { ...T.semanticEditorPaintBand({
      maximum: 270, natural: 160, autoMaxWidth: true
    }) },
    { preferred: 160, maximum: 270 }
  );
});

test('automatic compound editors reserve generated text and button tracks', () => {
  assert.equal(T.automaticCompoundEditorPaintWidth(72, 2), 124);
  assert.equal(T.automaticCompoundEditorPaintWidth(32, 1), 63);
});

test('projected TitleOnTop tracks keep finite intrinsic and tooltip lanes', () => {
  assert.deepEqual({ ...T.projectedTopTitleTrackBand({
    editor: 124, title: 124.29, tooltip: 15.55,
  }) }, { minimum: 148, preferred: 159, trailing: 164 });
  assert.deepEqual({ ...T.projectedTopTitleTrackBand({
    editor: 92, title: 171.04,
  }) }, { minimum: 92, preferred: 192, trailing: 187 });
  assert.deepEqual(Array.from(T.finiteProjectedTrackSizes([415, 447], 856)), [412, 444]);
  assert.deepEqual(Array.from(T.finiteProjectedTrackSizes([415, 447], 856)), [412, 444],
    'the projection is deterministic across resize passes');
});

test('managed responsive pair and ThroughAlign title tracks use stable Taxi bands', () => {
  assert.deepEqual(Array.from(T.managedResponsivePairSizes({
    bodyWidth: 992, pairLeft: 13, gap: 10, minimums: [252, 201]
  })), [478, 450]);
  assert.deepEqual(Array.from(T.managedResponsivePairSizes({
    bodyWidth: 992, pairLeft: 13, gap: 10, minimums: [500, 201]
  })), [500, 428], 'semantic minima remain hard floors');
  assert.equal(T.taxiLayoutMetrics.throughAlignTitleChrome, 11);
  assert.equal(T.throughAlignTitleTrackWidth([89.2, 161.6, 107.4]), 173);
  assert.equal(T.throughAlignTitleTrackWidth([89.2, 161.6, 107.4]), 173,
    'repeated passes never feed the painted track back into glyph measurement');
  assert.equal(T.localCompoundTitleTrackWidth(13.01), 14,
    'a trailing compound caption keeps only its intrinsic glyph band');
  assert.equal(T.localCompoundTitleTrackWidth(500), 280,
    'local captions retain the ordinary safety cap');
  assert.equal(T.compoundTrailingTitlesAreLocal({
    dataset: { fpThroughAlign: 'use', fpThroughAlignMode: 'auto' }
  }, false), true, 'resolved Auto links only the leading caption to its outer column');
  assert.equal(T.compoundTrailingTitlesAreLocal({
    dataset: { fpThroughAlign: 'use', fpThroughAlignMode: 'use' }
  }, false), false, 'authored Use explicitly shares the track across the compound row');
  assert.equal(T.compoundTrailingTitlesAreLocal({
    dataset: { fpThroughAlignMode: 'use' }
  }, true), true, 'nested horizontal columns keep independent local tracks');
  const equalOwner = {};
  const logicalItem = { parentElement: equalOwner };
  const logicalColumn = { closest: (selector) => selector === '.fp-item' ? logicalItem : null };
  assert.equal(T.compoundTrailingTitlesAreLocal({
    dataset: { fpThroughAlign: 'use', fpThroughAlignMode: 'auto' },
    closest: (selector) => selector === '.fp-children-horizontal.fp-ciwidth-equal'
      ? equalOwner : selector === '.fp-logical-subgrid' ? logicalColumn : null
  }, false), false, 'a direct logical column in an Equal owner retains its shared caption track');
});

test('a horizontal row opening with a titled column keeps that column in the outer caption scope', () => {
  const classes = (...names) => ({ contains: (name) => names.indexOf(name) >= 0 });
  const container = (box) => ({
    classList: classes('fp-item', 'fp-container'),
    querySelector: (selector) => (selector === '.fp-children' ? box : null)
  });
  const column = (through) => ({
    classList: classes('fp-children', 'fp-children-vertical'),
    dataset: { fpThroughAlign: through }
  });
  const columnBox = column('use');
  assert.equal(T.leadingThroughAlignColumnBox({
    children: [container(columnBox), container(column('use'))]
  }), columnBox, 'a band of Use columns shares one caption scope');
  assert.equal(T.leadingThroughAlignColumnBox({ children: [container(columnBox)] }), null,
    'a lone wrapper column keeps its own caption track');
  assert.equal(T.leadingThroughAlignColumnBox({
    children: [container(columnBox), container(column('dontuse'))]
  }), null, 'an explicit DontUse partner keeps the established local behaviour');
  assert.equal(T.leadingThroughAlignColumnBox({
    children: [container({
      classList: classes('fp-children', 'fp-children-vertical'),
      dataset: { fpThroughAlign: 'dontuse' }
    })]
  }), null, 'explicit DontUse remains a hard caption boundary');
  assert.equal(T.leadingThroughAlignColumnBox({
    children: [container({
      classList: classes('fp-children', 'fp-children-horizontal'),
      dataset: { fpThroughAlign: 'use' }
    })]
  }), null, 'a leading horizontal box is not a caption column');
  assert.equal(T.leadingThroughAlignColumnBox({
    children: [{ classList: classes('fp-item', 'fp-control') }]
  }), null, 'a leading field keeps the established local-row behaviour');
  assert.equal(T.leadingThroughAlignColumnBox({ children: [] }), null);
  assert.equal(T.leadingThroughAlignColumnBox(null), null);
});

test('table-column pairs publish immutable authored grid recommendations', () => {
  const table = (normal, physicalWidths) => ({
    dataset: { fpAuthoredRecommendedWidth: String(normal),
      fpTableGridWidth: String(normal) },
    querySelectorAll: (selector) => selector === 'colgroup col'
      ? (physicalWidths || []).map((width) => ({ style: { width: `${width}px` } })) : [],
  });
  const wrapper = (...tables) => ({
    querySelectorAll: (selector) => selector === '.fp-item[data-tag="Table"]' ? tables : [],
  });
  assert.equal(T.descendantTableColumnRecommendation(wrapper(table(400, [97, 264, 264]))), 405,
    'the outer recommendation uses the immutable table grid band, not physical col minima');
  assert.equal(T.descendantTableColumnRecommendation(wrapper(
    table(400, [97, 167]), table(400, [118, 129, 165, 110]))), 558);

  const childBox = () => ({ dataset: {
    fpGroupMode: 'vertical', fpGroupRepresentation: 'none',
  } });
  const child = () => ({ querySelectorAll: () => [childBox()] });
  const row = { dataset: {
    fpGroupMode: 'horizontal', fpGroupRepresentation: 'none', fpChildItemsWidth: '',
  } };
  assert.equal(T.isTableColumnResponsivePair(row, [child(), child()], [405, 558]), true);
  assert.equal(T.isTableColumnResponsivePair(row, [child(), child()], [400, 400]), false,
    'balanced columns retain the ordinary managed pair split');
  row.dataset.fpChildItemsWidth = 'equal';
  assert.equal(T.isTableColumnResponsivePair(row, [child(), child()], [405, 558]), false,
    'an explicit ChildItemsWidth contract remains authoritative');
  row.dataset.fpChildItemsWidth = '';

  /* A headerless List group beside a Pages column. */
  const compactChild = () => ({ ...child(), classList: { contains: (name) => name === 'fp-compact-list-group' } });
  const plainChild = () => ({ ...child(), classList: { contains: () => false } });
  assert.equal(T.isTableColumnResponsivePair(row, [compactChild(), plainChild()], [405, 900]), false,
    'the inner table band does not make a compact List column table-dominant');
  const bands = JSON.parse(JSON.stringify(T.compactListColumnBands([compactChild(), plainChild()], [
    { min: 10, normal: 405, recommended: 405, max: 405, stretch: true },
    { min: 867, normal: 867, recommended: 867, max: 867, stretch: false },
  ])));
  assert.deepEqual(bands[0], {
    min: 64, normal: 64, recommended: 64, max: 64, stretch: false,
    stretchPriority: false, compressPriority: false, explicit: true,
  }, 'the compact List column keeps its native 64px track');
  assert.equal(bands[1].stretch, true, 'the neighbour owns the remaining row width');
  assert.deepEqual(T.allocateHorizontalDimensionBands(
    T.compactListColumnBands([compactChild(), plainChild()], [
      { min: 10, normal: 405, recommended: 405, max: 405, stretch: true },
      { min: 867, normal: 867, recommended: 867, max: 867, stretch: false },
    ]), 964), [64, 900]);

  assert.equal(T.tableSummaryStretchStackEligible({
    activeVerticalPage: true, directItems: 2, tablePairIsFirst: true,
    leadingStretch: true, trailingStretch: false,
  }), true, 'the table-backed stretch row absorbs the gap before its fixed summary');
  for (const guard of [
    { activeVerticalPage: false }, { directItems: 3 }, { tablePairIsFirst: false },
    { leadingStretch: false }, { trailingStretch: true },
  ]) assert.equal(T.tableSummaryStretchStackEligible({
    activeVerticalPage: true, directItems: 2, tablePairIsFirst: true,
    leadingStretch: true, trailingStretch: false, ...guard,
  }), false, JSON.stringify(guard));
});

test('table columns keep the reference editor minima inside the grid only', () => {
  const col = (properties, tag = 'InputField') => ({ tag, properties });
  assert.equal(T.columnWidthPx(col({ Width: '6', DropListButton: 'true' }), null), 97,
    'dropdown/list columns reserve the native button lane');
  assert.equal(T.columnWidthPx(col({ Width: '6', ChoiceButton: 'true' }), null), 118,
    'reference columns reserve the native presentation lane');
  assert.equal(T.columnWidthPx(col({ Width: '6', ChoiceButton: 'true', OpenButton: 'false' }), null), 97,
    'compact reference codes without an Open lane use the dropdown minimum');
  assert.equal(T.columnWidthPx(col({ Width: '9', ChoiceButton: 'true', ChoiceButtonPicture: 'Calendar' }), null), 129,
    'date columns reserve the calendar lane');
  assert.equal(T.columnWidthPx(col({ Width: '20', HorizontalStretch: 'true' }), null), 165,
    'a long text column keeps the 20-character native minimum');
  assert.equal(T.columnWidthPx(col({ Width: '4' }), null), 36,
    'short plain code columns remain compact and can receive table surplus');
});

test('horizontal allocator projects logical subgrids and restores a bounded trailing normal band', () => {
  const classes = (...names) => {
    const values = new Set(names.flatMap((name) => String(name).split(/\s+/)).filter(Boolean));
    return { contains: (name) => values.has(name) };
  };
  const style = () => ({ width: '', minWidth: '', maxWidth: '', flex: '' });
  const leaf = (normal, recommended) => ({
    classList: classes('fp-item', 'fp-control', 'fp-no-hstretch'),
    dataset: {
      fpAuthoredNormalWidth: String(normal), fpAuthoredRecommendedWidth: String(recommended),
      fpWidthBandMin: '71', fpWidthBandMax: String(normal), fpWidthStretch: '0'
    },
    style: style(), scrollWidth: normal,
    querySelector: () => null, querySelectorAll: () => [],
    getBoundingClientRect: () => ({ width: normal })
  });
  const subgrid = (...leaves) => {
    const item = {
      classList: classes('fp-item', 'fp-container', 'fp-hstretch'), dataset: {}, style: style(),
      querySelector: () => null, querySelectorAll: () => [box]
    };
    const box = {
      classList: classes('fp-children', 'fp-children-vertical', 'fp-logical-subgrid'),
      children: leaves, dataset: {}, style: style(), closest: () => item
    };
    return item;
  };
  const left = subgrid(leaf(398, 398), leaf(412, 412));
  const right = subgrid(leaf(439, 348), leaf(413, 348));
  const row = {
    classList: classes('fp-children', 'fp-children-horizontal'), children: [left, right],
    clientWidth: 948, dataset: {}, style: style(), closest: () => null
  };
  const sandbox = loadWebModules(root, ['xml-util.js', 'form-preview.js'], {
    CSS: { escape: (s) => String(s) },
    getComputedStyle: (node) => ({ columnGap: node === row ? '10px' : '3px', gap: '3px' })
  });
  const allocated = () => [left, right].filter((item) => item.dataset.fpHorizontalAllocated === '1');
  const body = {
    querySelectorAll(selector) {
      if (selector === '.fp-children-horizontal') return [row];
      if (selector === '[data-fp-horizontal-allocated="1"]') return allocated();
      if (selector === '[data-fp-logical-row-allocated="1"]')
        return row.dataset.fpLogicalRowAllocated === '1' ? [row] : [];
      return [];
    }
  };
  assert.equal(sandbox.window.FormPreview._test.applyHorizontalWidthAllocations(body), 1);
  assert.equal(left.style.width, '439px');
  assert.equal(right.style.width, '439px');
  assert.equal(row.style.width, '888px');
  assert.equal(left.style.flex, '0 0 439px');
  assert.equal(right.style.flex, '0 0 439px');
  assert.equal(left.querySelectorAll()[0].children.length, 2,
    'the vertical rows remain inside their logical wrapper');
  row.clientWidth = 1400;
  assert.equal(sandbox.window.FormPreview._test.applyHorizontalWidthAllocations(body), 1);
  assert.equal(left.style.width, '439px', 'a wider viewport does not split surplus between wrappers');
  assert.equal(right.style.width, '439px', 'the trailing wrapper stops at its authored normal band');
});

test('detached field columns reserve a standard decoration tail and one flexible value owner', () => {
  const logical = ({ stretch = false, tags = ['InputField'] } = {}) => {
    const item = {
      querySelector(selector) {
        return selector === '.fp-item.fp-control.fp-hstretch' && stretch ? {} : null;
      },
      querySelectorAll(selector) {
        if (selector === '.fp-children') return [box];
        if (selector === '.fp-item.fp-control') return tags.map((tag) => ({ dataset: { tag } }));
        return [];
      },
    };
    const box = {
      classList: { contains: (name) => name === 'fp-logical-subgrid' },
      closest: (selector) => selector === '.fp-item' ? item : null,
    };
    return item;
  };
  const entries = [
    { min: 260, normal: 390, recommended: 390, max: 390 },
    { min: 160, normal: 449, recommended: 449, max: 449 },
    { min: 10, normal: 260, recommended: 260, max: 260 },
  ];
  const projected = T.projectFieldColumnsWithDecorationTail([
    logical(), logical({ stretch: true }),
    logical({ tags: ['PictureDecoration', 'LabelDecoration'] }),
  ], entries);
  assert.deepEqual(projected.map(({ min, normal, recommended, max }) =>
    ({ min, normal, recommended, max })), [
    { min: 390, normal: 390, recommended: 390, max: 390 },
    { min: 160, normal: 449, recommended: 449, max: 449 },
    { min: 210, normal: 210, recommended: 210, max: 210 },
  ]);
  assert.equal(projected[1].compressPriority, true);
  assert.equal(T.projectFieldColumnsWithDecorationTail([
    logical(), logical(), logical({ tags: ['PictureDecoration', 'LabelDecoration'] }),
  ], entries), null, 'a row without one flexible value owner keeps the ordinary allocator');
  assert.equal(T.projectFieldColumnsWithDecorationTail([
    logical(), logical({ stretch: true }), logical({ tags: ['InputField'] }),
  ], entries), null, 'a trailing field column is not a decoration track');
});

test('AdditionalColumns supply qualifiers for indexed nested value-table paths', () => {
  const xml = `<Form xmlns="http://v8.1c.ru/8.3/xcf/logform" xmlns:v8="http://v8.1c.ru/8.1/data/core">
    <Attributes><Attribute name="Доверенность" id="1"><Type><v8:Type>v8:ValueTable</v8:Type></Type><Columns>
      <AdditionalColumns table="Доверенность.Документ.СвРосОрг"><Column name="КПП" id="2"><Type>
        <v8:Type>xs:string</v8:Type><v8:StringQualifiers><v8:Length>9</v8:Length></v8:StringQualifiers>
      </Type></Column></AdditionalColumns>
    </Columns></Attribute></Attributes><ChildItems/></Form>`;
  const parsed = FP.parse(xml);
  assert.ok(!parsed.error, parsed.error);
  const extra = parsed.model.attributes[0].columns[0];
  assert.equal(extra.path, 'Доверенность.Документ.СвРосОрг.КПП');
  assert.equal(extra.stringLen, 9);
  const captionIndex = T.buildCaptionIndex(parsed.model);
  const field = { properties: { DataPath: 'Доверенность[0].Документ[0].СвРосОрг[0].КПП' } };
  assert.equal(T.metaStringLengthQualifier(field, { captionIndex }), 9);
  assert.equal(T.defaultFieldChars(field, { captionIndex }), 9);
  assert.equal(T.defaultFieldWidthPx(field, { captionIndex }), 90);
});

test('attributes preserve authored Columns and AdditionalColumns hierarchy', () => {
  const xml = `<Form xmlns="http://v8.1c.ru/8.3/xcf/logform" xmlns:v8="http://v8.1c.ru/8.1/data/core">
    <Attributes><Attribute name="Data" id="1"><Type><v8:Type>v8:ValueTable</v8:Type></Type><Columns>
      <AdditionalColumns table="Data.Parent"><Column name="Code" id="2"><Type><v8:Type>xs:string</v8:Type></Type></Column></AdditionalColumns>
      <AdditionalColumns table="Data.Empty"/>
    </Columns></Attribute></Attributes><ChildItems/></Form>`;
  const parsed = FP.parse(xml);
  assert.ok(!parsed.error, parsed.error);
  const attribute = parsed.model.attributes[0];
  assert.deepEqual(JSON.parse(JSON.stringify(attribute.columnStructure)), {
    columns: [],
    additionalColumns: [
      { table: 'Data.Parent', columns: [{
        name: 'Code', path: 'Data.Parent.Code', additional: true, id: '2',
        properties: { Type: 'xs:string' },
        typeDescription: { types: ['xs:string'], typeSets: [], typeIds: [] },
        typeRefs: 'xs:string', stringLen: 0, numberQ: null, dateFraction: '',
      }] },
      { table: 'Data.Empty', columns: [] },
    ],
  });
  assert.equal(attribute.columns.length, 1);
  assert.equal(attribute.columns[0], attribute.columnStructure.additionalColumns[0].columns[0]);
});

test('attributes preserve Settings.MainTable and the complete structured Settings value', () => {
  const xml = `<Form xmlns="http://v8.1c.ru/8.3/xcf/logform" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:dcsset="http://v8.1c.ru/8.1/data-composition-system/settings">
    <Attributes><Attribute name="List" id="1"><Type/><Settings xsi:type="DynamicList">
      <ManualQuery>false</ManualQuery><MainTable>Catalog.Products</MainTable>
      <ListSettings><dcsset:filter><dcsset:viewMode>Normal</dcsset:viewMode></dcsset:filter></ListSettings>
    </Settings></Attribute></Attributes><ChildItems/></Form>`;
  const parsed = FP.parse(xml);
  assert.ok(!parsed.error, parsed.error);
  const settings = parsed.model.attributes[0].settings;
  assert.equal(settings.type, 'DynamicList');
  assert.equal(settings.mainTable, 'Catalog.Products');
  assert.equal(settings.structuredValue.name, 'Settings');
  assert.equal(settings.structuredValue.attributes['xsi:type'], 'DynamicList');
  assert.deepEqual(Array.from(settings.structuredValue.children, (child) => child.name),
    ['ManualQuery', 'MainTable', 'ListSettings']);
  assert.equal(settings.structuredValue.children[2].children[0].name, 'dcsset:filter');
});

test('a vertically stretched wrapper stays cross-axis inside a horizontal totals row', () => {
  const bottomAlignedAmount = {
    tag: 'UsualGroup',
    properties: { VerticalStretch: 'true', Group: 'Vertical', VerticalAlign: 'Bottom' },
    childItems: [{ tag: 'InputField', properties: { Width: '10', ReadOnly: 'true' } }]
  };
  const totals = {
    tag: 'UsualGroup', properties: { Group: 'Horizontal' }, childItems: [bottomAlignedAmount]
  };
  const footer = {
    tag: 'UsualGroup', properties: { Group: 'Vertical' }, childItems: [totals]
  };

  assert.equal(T.wantsVStretch(bottomAlignedAmount, 'UsualGroup'), true,
    'the wrapper can fill an explicitly allocated row');
  assert.equal(T.wantsVStretch(totals, 'UsualGroup'), false,
    'cross-axis wrapper stretch does not make the horizontal row height-hungry');
  assert.equal(T.wantsVStretch(footer, 'UsualGroup'), false,
    'the compact footer does not claim remaining form height');
});

test('structurally empty pages stay in the model but are omitted from the reference visual tabs', () => {
  const empty = { tag: 'Page', id: 'empty', properties: {}, childItems: [] };
  const populated = {
    tag: 'Page', id: 'populated', properties: {},
    childItems: [{ tag: 'InputField', id: 'field', properties: {} }]
  };
  assert.deepEqual(T.renderablePages({ childItems: [empty, populated] }), [populated]);
});

test('a flattened root Page dissolves its leading caption into the Form cadence', () => {
  const form = { tag: 'Form' };
  const flattened = { tag: 'Pages', properties: { PagesRepresentation: 'None' } };
  const tabbed = { tag: 'Pages', properties: { PagesRepresentation: 'TabsOnTop' } };
  const collapsible = {
    tag: 'UsualGroup', properties: { Behavior: 'Collapsible', Title: 'Section' }
  };
  const hiddenTitle = {
    tag: 'UsualGroup', properties: { Behavior: 'Collapsible', Title: 'Section', ShowTitle: 'false' }
  };

  assert.equal(T.isRootFlattenedPage(flattened, form), true);
  assert.equal(T.isRootFlattenedPage(tabbed, form), false);
  assert.equal(T.isRootFlattenedPage(flattened, { tag: 'UsualGroup' }), false);
  assert.equal(T.isFlattenedPageLeadingCaptionItem(collapsible), true);
  assert.equal(T.isFlattenedPageLeadingCaptionItem(hiddenTitle), false);
});

test('inactive pages do not stretch the visible compact page', () => {
  const pages = {
    tag: 'Pages', id: 'unique-pages-with-inactive-sheet',
    properties: { PagesRepresentation: 'None' },
    childItems: [
      { tag: 'Page', id: 'compact-page', properties: {}, childItems: [
        { tag: 'InputField', properties: { DataPath: 'Order', TitleLocation: 'None' } }
      ] },
      { tag: 'Page', id: 'sheet-page', properties: {}, childItems: [
        { tag: 'SpreadSheetDocumentField', properties: {} }
      ] }
    ]
  };
  assert.equal(T.wantsVStretch(pages, 'Pages'), false);
});

test('field groups pack in a horizontal parent unless ChildItemsWidth is set', () => {
  const parent = T.layoutMeta({ tag: 'UsualGroup', properties: { Group: 'Horizontal' } });
  const withField = {
    tag: 'UsualGroup',
    properties: {},
    childItems: [{ tag: 'InputField', properties: {} }]
  };
  const decor = {
    tag: 'UsualGroup',
    properties: {},
    childItems: [{ tag: 'LabelDecoration', properties: { Title: 'x' } }]
  };
  assert.equal(T.groupHasFields(withField), true);
  assert.equal(T.groupHasFields(decor), false);
  assert.equal(T.wantsHStretch(withField, 'UsualGroup', parent), false);
  assert.equal(T.wantsHStretch(decor, 'UsualGroup', parent), false);
});

test('zero-width unlimited fields stretch through wrapper groups', () => {
  const parent = T.layoutMeta({ tag: 'UsualGroup', properties: { Group: 'Vertical' } });
  const field = {
    tag: 'InputField',
    properties: {
      AutoMaxWidth: 'false',
      MaxWidth: '0',
      Width: '0',
      TitleLocation: 'Left'
    }
  };
  const inner = {
    tag: 'UsualGroup',
    properties: { Group: 'Horizontal' },
    childItems: [field]
  };
  const outer = {
    tag: 'UsualGroup',
    properties: { Group: 'Vertical' },
    childItems: [inner]
  };

  assert.equal(T.wantsHStretch(field, 'InputField', T.layoutMeta(inner)), true);
  assert.equal(T.wantsHStretch(inner, 'UsualGroup', parent), true);
  assert.equal(T.wantsHStretch(outer, 'UsualGroup', parent), true);

  inner.properties.HorizontalStretch = 'false';
  assert.equal(T.wantsHStretch(inner, 'UsualGroup', parent), false,
    'an explicit false on a wrapper remains authoritative');
});

test('positive Width or MaxWidth keeps an AutoMaxWidth=false field bounded', () => {
  const parent = T.layoutMeta({ tag: 'UsualGroup', properties: { Group: 'Vertical' } });
  assert.equal(T.wantsHStretch({
    tag: 'InputField',
    properties: { AutoMaxWidth: 'false', Width: '12', MaxWidth: '0' }
  }, 'InputField', parent), false);
  assert.equal(T.wantsHStretch({
    tag: 'InputField',
    properties: { AutoMaxWidth: 'false', Width: '0', MaxWidth: '30' }
  }, 'InputField', parent), false);
  assert.equal(T.wantsHStretch({
    tag: 'InputField',
    properties: {
      HorizontalStretch: 'true', AutoMaxWidth: 'false', MaxWidth: '16'
    }
  }, 'InputField', parent), false,
    'explicit Stretch does not override a MaxWidth cap when Width is omitted');
  const single = T.layoutMeta({
    tag: 'UsualGroup', properties: { Group: 'Vertical' },
    childItems: [{ tag: 'InputField', properties: { Width: '8' } }]
  });
  assert.equal(T.wantsHStretch({
    tag: 'InputField', properties: { Width: '8' }
  }, 'InputField', single), true,
  'Width is a stretchable preference in a generated one-field column');
});

test('empty autofill-false command bar is skipped', () => {
  assert.equal(T.isEmptyCommandBar({ properties: { Autofill: 'false' }, childItems: [] }), true);
  assert.equal(T.isEmptyCommandBar({ properties: { Autofill: 'false' }, childItems: [{ tag: 'Button' }] }), false);
});

test('table hides an empty autofill-false command bar including its additions', () => {
  const hidden = {
    properties: {},
    autoCommandBar: { properties: { Autofill: 'false' }, childItems: [] },
    searchStringAddition: { tag: 'SearchStringAddition', properties: {} },
    viewStatusAddition: { tag: 'ViewStatusAddition', properties: {} }
  };
  assert.equal(T.tableCommandBarVisible(hidden), false);
  assert.equal(T.tableCommandBarVisible({ properties: {} }), true);
  assert.equal(T.tableCommandBarVisible({
    properties: {},
    autoCommandBar: { properties: { Autofill: 'false' }, childItems: [{ tag: 'Button' }] }
  }), true);
  assert.equal(T.tableCommandBarVisible({ properties: { CommandBarLocation: 'None' } }), false);
});

test('titleLocation and boolean helpers', () => {
  assert.equal(T.titleLocation({ properties: { TitleLocation: 'None' } }), 'none');
  assert.equal(T.titleLocation({ properties: {} }), 'left');
  const separated = T.layoutMeta({
    tag: 'UsualGroup',
    properties: { Group: 'Horizontal', Representation: 'NormalSeparation' }
  });
  assert.equal(T.titleLocation({ properties: {} }, separated), 'left');
  assert.equal(T.isFalse('false'), true);
  assert.equal(T.isTrue('true'), true);
});

test('DataPath fallback is humanized', () => {
  assert.equal(T.humanizeIdent('ХозяйственнаяОперация'), 'Хозяйственная операция');
  assert.equal(T.humanizeIdent('ВариантОформленияПродажи'), 'Вариант оформления продажи');
  assert.equal(T.humanizeIdent('СуммаБезНДС'), 'Сумма без НДС');
  assert.equal(T.humanizeIdent('КоличествоПоРНПТ'), 'Количество по РНПТ');
  assert.equal(T.titleOf({ properties: { DataPath: 'Объект.ХозяйственнаяОперация' } }), 'Хозяйственная операция');
  assert.equal(T.titleOf({ properties: { Title: 'Операция', DataPath: 'Объект.ХозяйственнаяОперация' } }), 'Операция');
});

test('hidden title is not shown on label fields', () => {
  const item = {
    tag: 'LabelField',
    name: 'СтрокаИсправление',
    properties: { DataPath: 'СтрокаИсправление', TitleLocation: 'None', AutoMaxWidth: 'false' }
  };
  assert.equal(T.displayLabel(item, null, 'LabelField'), '');
  const emptyPaint = { textContent: '', children: [] };
  const rootVertical = { tag: 'Form', orientation: 'vertical' };
  assert.equal(T.isPaintlessLabelField(item, 'none', emptyPaint, rootVertical), true);
  const typed = T.applyTypeDefaultsToItem({ ...item, properties: { ...item.properties } }, {});
  assert.equal(T.isPaintlessLabelField(typed, 'none', emptyPaint, rootVertical), true,
    'every runtime key written by type defaults stays derived, not authored');
  assert.equal(T.isPaintlessLabelField({
    ...item, runtime: { value: 'x' }
  }, 'none', emptyPaint, rootVertical), false);
  assert.equal(T.isPaintlessLabelField({
    ...item, properties: { ...item.properties, Height: '2' }
  }, 'none', emptyPaint, rootVertical), false);
  assert.equal(T.isPaintlessLabelField(item, 'left', emptyPaint, rootVertical), false);
  assert.equal(T.isPaintlessLabelField(item, 'none', { textContent: 'runtime', children: [] }, rootVertical), false);
  assert.equal(T.isPaintlessLabelField({
    ...item, properties: { ...item.properties, Hiperlink: 'true' }
  }, 'none', emptyPaint, rootVertical), false);
  assert.equal(T.isPaintlessLabelField(item, 'none', emptyPaint,
    { tag: 'UsualGroup', orientation: 'vertical' }), false);
  for (const authored of [
    { Width: '5' }, { MaxWidth: '5' }, { HorizontalStretch: 'true' }
  ]) assert.equal(T.isPaintlessLabelField({
    ...item, properties: { ...item.properties, ...authored }
  }, 'none', emptyPaint, rootVertical), false);
});

test('a label field keeps its title even when it handles URLProcessing', () => {
  const shown = {
    tag: 'LabelField',
    name: 'НадписьИзделие',
    properties: { DataPath: 'НадписьИзделие' },
    events: ['URLProcessing']
  };
  assert.equal(T.displayLabel(shown, null, 'LabelField'), 'Надпись изделие');
  const hidden = Object.assign({}, shown, {
    properties: { DataPath: 'НадписьИзделие', TitleLocation: 'None' }
  });
  assert.equal(T.displayLabel(hidden, null, 'LabelField'), '');
});

test('incomplete mark honours explicit form value and object metadata', () => {
  assert.equal(T.marksIncomplete({ properties: { AutoMarkIncomplete: 'true' } }), true);
  assert.equal(T.marksIncomplete({ properties: { AutoMarkIncomplete: 'false' } }), false);
  assert.equal(T.marksIncomplete({ properties: { DataPath: 'Объект.Партнер' } }), false);
  const objectMeta = T.parseObjectMeta(`<?xml version="1.0" encoding="UTF-8"?>
<MetaDataObject xmlns="http://v8.1c.ru/8.3/MDClasses">
  <Document><ChildObjects><Attribute><Properties>
    <Name>ДатаУвольнения</Name><FillChecking>ShowError</FillChecking>
  </Properties></Attribute></ChildObjects></Document>
</MetaDataObject>`);
  const ctx = {
    captionIndex: T.buildCaptionIndex({
      attributes: [{ name: 'Объект', properties: { MainAttribute: 'true' } }],
      objectMeta
    })
  };
  const date = { properties: { DataPath: 'Объект.ДатаУвольнения' } };
  assert.equal(T.marksIncomplete(date, ctx), true);
  assert.equal(T.marksIncomplete({
    properties: { DataPath: 'Объект.ДатаУвольнения', AutoMarkIncomplete: 'false' }
  }, ctx), false);
  const formCtx = {
    captionIndex: T.buildCaptionIndex({
      attributes: [{ name: 'ПолноеНаименование', properties: { FillCheck: 'ShowError' } }]
    })
  };
  assert.equal(T.marksIncomplete({ properties: { DataPath: 'ПолноеНаименование' } }, formCtx), true);
});

test('an object attribute does not mark a form attribute of the same name', () => {
  // List-form filters bound to form attributes «Сценарий»,
  // «Организация» were underlined because the document's own mandatory
  // attributes of those names leaked into the form's lookup.
  const objectMeta = T.parseObjectMeta(`<?xml version="1.0" encoding="UTF-8"?>
<MetaDataObject xmlns="http://v8.1c.ru/8.3/MDClasses">
  <Document><ChildObjects><Attribute><Properties>
    <Name>Сценарий</Name><FillChecking>ShowError</FillChecking>
  </Properties></Attribute></ChildObjects></Document>
</MetaDataObject>`);
  const ctx = {
    captionIndex: T.buildCaptionIndex({
      attributes: [{ name: 'Список', properties: { MainAttribute: 'true' } }, { name: 'Сценарий', properties: {} }],
      objectMeta
    })
  };
  assert.equal(T.marksIncomplete({ properties: { DataPath: 'Сценарий' } }, ctx), false);
  // Through «Объект» the object attribute still marks, main attribute or not.
  assert.equal(T.marksIncomplete({ properties: { DataPath: 'Объект.Сценарий' } }, ctx), true);
});

test('boolean tumbler labels come from EditFormat', () => {
  assert.deepEqual(Array.from(T.booleanTumblerOptions({
    properties: { EditFormat: "БЛ='Среднему заработку'; БИ='Денежному содержанию'" }
  })), ['Денежному содержанию', 'Среднему заработку']);
  assert.deepEqual(Array.from(T.booleanTumblerOptions({
    properties: { EditFormat: "БЛ='Гражданский персонал'; БИ=Военнослужащие" }
  })), ['Военнослужащие', 'Гражданский персонал']);
  assert.deepEqual(Array.from(T.booleanTumblerOptions({ properties: { EditFormat: '' } })), []);
});

test('managed field style resolves to the Taxi warning background', () => {
  const configured = {
    ФонУправляющегоПоля: '#FFE8B3',
    ЦветФонаУдачнойОтправки: '#D7F0C7',
    ЦветФонаОшибкиОтправки: '#FBD4D4'
  };
  assert.equal(T.styleItemColor('style:ФонУправляющегоПоля', configured), '#FFE8B3');
  assert.equal(T.styleItemColor('style:ЦветФонаУдачнойОтправки', configured), '#D7F0C7');
  assert.equal(T.styleItemColor('style:ЦветФонаОшибкиОтправки', configured), '#FBD4D4');
  assert.equal(T.styleItemColor('style:WebColor', { WebColor: 'web:DarkSlateGray' }), 'DarkSlateGray');
  assert.equal(T.styleItemColor('style:Alias', { Alias: 'style:TableHeaderBackColor' }), '#f5f5f5');
  assert.equal(T.styleItemColor('style:ЦветФонаУдачнойОтправки'), '');
  assert.equal(T.styleItemColor('style:TableHeaderBackColor'), '#f5f5f5');
  assert.equal(T.styleItemColor('style:SpecialTextColor'), '#ff0000');
  assert.equal(T.styleItemColor('style:AccentColor'), '#009646');
});

test('standard Document.Date keeps the native DateTime width floor', () => {
  const item = {
    properties: {
      DataPath: 'Объект.Date', Width: '14', MaxWidth: '12', HorizontalStretch: 'false'
    }
  };
  const ctx = { captionIndex: {
    mainNames: { Объект: true },
    types: { Объект: 'cfg:DocumentObject.ВводОстатков' },
    dateFraction: {}
  } };
  assert.equal(T.metaDateFraction(item, ctx), 'DateTime');
  const band = T.dimensionBands(item, 'InputField', { orientation: 'horizontal' }, ctx);
  assert.deepEqual(
    { min: band.horizontal.min, normal: band.horizontal.normal, max: band.horizontal.max },
    { min: 156, normal: 156, max: 156 }
  );
});

test('compact coloured decoration rows are semantic notification bands', () => {
  const band = {
    tag: 'UsualGroup',
    properties: { Group: 'AlwaysHorizontal', Representation: 'None', BackColor: 'style:Warning' },
    childItems: [
      { tag: 'LabelDecoration', properties: { Title: 'Срок заканчивается' } },
      { tag: 'LabelDecoration', properties: { Title: 'Подробнее', Hyperlink: 'true' } }
    ]
  };
  assert.equal(T.isCompactColorBand(band), true);
  assert.equal(T.isCompactColorBand({ ...band, properties: { ...band.properties, BackColor: '' } }), false);
  assert.equal(T.isCompactColorBand({ ...band, childItems: [
    { tag: 'PictureDecoration', properties: {} }, ...band.childItems
  ] }), false, 'a richer banner keeps its own intrinsic chrome');
});

test('a StyleItems chain that closes on itself yields no colour instead of overflowing', () => {
  /* A configuration may alias one style item to another for any number of
   * hops. Guarding only against the immediate caller let A -> B -> A recurse
   * until the stack gave out, which took the whole form preview down. */
  assert.equal(T.styleItemColor('style:A', { A: 'style:A' }), '');
  assert.equal(T.styleItemColor('style:A', { A: 'style:B', B: 'style:A' }), '');
  assert.equal(T.styleItemColor('style:A', { A: 'style:B', B: 'style:C', C: 'style:B' }), '');
  assert.equal(T.styleItemColor('style:A', { A: 'style:B', B: 'style:C', C: '#123456' }), '#123456');
});

test('a style reference resolves whatever case its prefix and name are written in', () => {
  assert.equal(T.styleItemColor('Style:Акцент', { Акцент: '#AABBCC' }), '#AABBCC');
  assert.equal(T.styleItemColor('STYLE:Акцент', { Акцент: '#AABBCC' }), '#AABBCC');
  assert.equal(T.styleItemColor('style:accent', { Accent: '#AABBCC' }), '#AABBCC');
  assert.equal(T.styleItemLookup({ Accent: '#AABBCC' }, 'ACCENT'), '#AABBCC');
  assert.equal(T.styleItemLookup({ Accent: '#AABBCC' }, 'Другой'), '');
  assert.equal(T.styleItemLookup(null, 'Accent'), '');
});

test('formatted=false title keeps literal angle brackets', () => {
  const parsed = FP.parse(`<?xml version="1.0" encoding="UTF-8"?>
<Form xmlns="http://v8.1c.ru/8.3/xcf/logform" xmlns:v8="http://v8.1c.ru/8.1/data/core">
  <ChildItems><LabelDecoration name="Этап" id="1"><Title formatted="false">
    <v8:item><v8:lang>ru</v8:lang><v8:content>&lt;Наименование этапа&gt;</v8:content></v8:item>
  </Title></LabelDecoration></ChildItems>
</Form>`);
  assert.equal(parsed.model.childItemsRoot[0].properties.Title, '<Наименование этапа>');
  assert.equal(parsed.model.childItemsRoot[0].properties.TitleFormatted, 'false');
});

test('input background color does not reset the incomplete dotted rule', () => {
  const css = fs.readFileSync(path.join(root, 'web', 'viewer.css'), 'utf8');
  const inputRule = css.match(/^\.fp-input\s*\{([^}]*)\}/m);
  assert.ok(inputRule, 'input rule');
  assert.match(inputRule[1], /background-color:\s*transparent/);
  assert.doesNotMatch(inputRule[1], /(?:^|;)\s*background:\s*transparent/);
});

test('a picture button without a picture falls back to text', () => {
  const ctx = { commandTitles: { ЗакрытьЗаказ: 'Закрыть заказ' }, commands: {} };
  const noPicture = {
    tag: 'Button',
    name: 'ЗакрытьЗаказ',
    properties: { Representation: 'PictureAndText', CommandName: 'Form.Command.ЗакрытьЗаказ' }
  };
  assert.equal(T.hasButtonIcon(noPicture, ctx), false);
  assert.equal(T.resolveButtonRep(noPicture, ctx), 'text');
  const withPicture = {
    tag: 'Button',
    name: 'СчитатьКарту',
    properties: { Representation: 'Picture', Picture: 'CommonPicture.СчитатьКартуЛояльности' }
  };
  assert.equal(T.hasButtonIcon(withPicture, ctx), true);
  assert.equal(T.resolveButtonRep(withPicture, ctx), 'picture');
  assert.equal(T.iconIdFromRef('CommonPicture.СчитатьКартуЛояльности'), 'credit-card');
});

test('Auto command-bar button ignores command picture representation, usual button adopts it', () => {
  const direct = {
    tag: 'Button',
    name: 'ПоискПоШтрихкоду',
    properties: {
      Title: 'Найти товар по штрихкоду',
      Picture: 'CommonPicture.НовыйПоШтрихкоду'
    }
  };
  assert.equal(T.resolveButtonRep(direct, { commands: {} }), 'picture');

  const inherited = {
    tag: 'Button',
    name: 'УказатьДокументыПоступления',
    properties: {
      Title: 'Указать документы поступления',
      CommandName: 'Form.Command.УказатьДокументыПоступления'
    }
  };
  const ctx = {
    commands: {
      УказатьДокументыПоступления: {
        tag: 'Command',
        name: 'УказатьДокументыПоступления',
        properties: { Picture: 'CommonPicture.ДетализацияПартий' }
      }
    }
  };
  assert.equal(T.resolveButtonRep(inherited, ctx), 'text');

  const usual = {
    tag: 'Button',
    name: 'ФактическийАдресРавенЮридическому',
    properties: {
      Type: 'UsualButton',
      CommandName: 'Form.Command.ФактическийАдресРавенЮридическому'
    }
  };
  const usualCtx = {
    commands: {
      ФактическийАдресРавенЮридическому: {
        tag: 'Command',
        name: 'ФактическийАдресРавенЮридическому',
        properties: { Picture: 'StdPicture.MoveUp', Representation: 'Picture' }
      }
    }
  };
  assert.equal(T.resolveButtonRep(usual, usualCtx), 'picture');
});

test('Auto CommandBarButton adopts its form Command picture or explicit representation (as in the reference)', () => {
  const button = (name, extra = {}) => ({
    tag: 'Button',
    name: `Товары${name}`,
    properties: { Type: 'CommandBarButton', CommandName: `Form.Command.${name}`, ...extra },
  });
  const ctx = {
    commands: {
      СкопироватьСтроки: { tag: 'Command', name: 'СкопироватьСтроки', properties: { Picture: 'CommonPicture.КопированиеСтрок' } },
      ЗагрузитьИзФайла: { tag: 'Command', name: 'ЗагрузитьИзФайла', properties: { Picture: 'CommonPicture.Загрузить', Representation: 'Text' } },
      Заполнить: { tag: 'Command', name: 'Заполнить', properties: {} },
    },
  };
  assert.equal(T.resolveButtonRep(button('СкопироватьСтроки'), ctx), 'picture');
  assert.equal(T.resolveButtonRep(button('СкопироватьСтроки', { Title: 'Скопировать' }), ctx), 'picture');
  assert.equal(T.resolveButtonRep(button('ЗагрузитьИзФайла'), ctx), 'text');
  assert.equal(T.resolveButtonRep(button('Заполнить'), ctx), 'text');
});

test('unmapped configuration pictures get a neutral placeholder', () => {
  assert.equal(T.iconIdFromRef('CommonPicture.ОтгрузкаЗапрещена'), 'ban');
  assert.equal(T.iconIdFromRef('CommonPicture.ПревышениеЗаказа'), 'alert-triangle');
  assert.equal(T.iconIdFromRef('CommonPicture.Предупреждение'), 'alert-triangle');
  assert.equal(T.iconIdFromRef('CommonPicture.ЧтоТоСовсемЧужое'), 'photo');
  /* «вес» on its own also matched Известное, Ведомость, Повесить … */
  assert.equal(T.iconIdFromRef('CommonPicture.НеизвестноеДействие'), 'photo');
  assert.equal(T.iconIdFromRef('CommonPicture.ВесыЭлектронные'), 'scale');
});

test('checkbox rows are skipped by label equalization', () => {
  const row = { classList: { contains: (c) => c === 'fp-check-row' } };
  assert.equal(T.fieldRowSkipped(row), true);
});

test('radio options come from ChoiceList, else the reference placeholders, never an invented boolean fallback', () => {
  const withList = {
    properties: { ChoiceListItems: ['Подразделение', 'Участок'], TitleLocation: 'None' }
  };
  assert.equal(Array.from(T.radioOptions(withList)).join('|'), 'Подразделение|Участок');
  // The reference designer: three «<Значение N>» without ColumnsCount (control showcase),
  // one per column with it (СервисДоставки, ColumnsCount 2).
  assert.equal(Array.from(T.radioOptions({ properties: {} })).join('|'), '<Значение 1>|<Значение 2>|<Значение 3>');
  assert.equal(Array.from(T.radioOptions({ properties: { ColumnsCount: '2' } })).join('|'), '<Значение 1>|<Значение 2>');
  assert.equal(T.displayLabel(withList, null, 'RadioButtonField'), '');
});

test('radio ColumnsCount selects a native column or explicit grid', () => {
  const column = T.radioOptionsLayout({ properties: { ColumnsCount: '1' } }, 3);
  assert.equal(column.className, 'fp-radio-stack fp-radio-column');
  assert.equal(column.columns, 1);
  const grid = T.radioOptionsLayout({ properties: { ColumnsCount: '3' } }, 5);
  assert.equal(grid.className, 'fp-radio-stack fp-radio-grid');
  assert.equal(grid.columns, 3);
  const shortAuto = T.radioOptionsLayout({ properties: {} }, 4);
  assert.equal(shortAuto.className, 'fp-radio-stack fp-radio-row');
  assert.equal(shortAuto.columns, 0);
  const longAuto = T.radioOptionsLayout({ properties: {} }, 5);
  assert.equal(longAuto.className, 'fp-radio-stack');
  assert.equal(longAuto.columns, 0);
});

test('unused Taxi scrollbar lanes stay transparent; thumbs paint only on overflow', () => {
  const css = fs.readFileSync(path.join(root, 'packages', '1c-preview-core', 'browser', 'viewer.css'), 'utf8');
  assert.match(css, /\.fp-mockup::-webkit-scrollbar-track-piece:vertical[\s\S]*?background:\s*transparent/);
  assert.match(css, /\.fp-mockup \.fp-table-mock::-webkit-scrollbar-thumb:vertical[\s\S]*?background:\s*transparent/);
  assert.match(css, /\.fp-mockup \.fp-table-mock\.fp-table-overflow-y::-webkit-scrollbar-thumb:vertical\s*\{[^}]*#9a9a9a/s);
  assert.match(css, /\.fp-mockup \.fp-table-mock\.fp-table-overflow-x::-webkit-scrollbar-thumb:horizontal\s*\{[^}]*#9a9a9a/s);
  assert.match(css, /\.fp-mockup \.fp-table-mock::-webkit-scrollbar-track-piece:vertical[\s\S]*?background:\s*transparent/);
  assert.match(css, /\.fp-table-mock\.fp-table-explicit-rows\s*\{[^}]*overflow-y:\s*auto[^}]*scrollbar-gutter:\s*stable/s);
  assert.match(css, /\.fp-body\.fp-mockup:not\(\.fp-vertical-scroll-needed\)::-webkit-scrollbar-thumb:vertical[\s\S]*?background:\s*transparent/);
  assert.match(css, /\.fp-radio-grid\s*\{[^}]*column-gap:\s*4px/s);
});

test('active Taxi scrollbar tracks paint the reference #d6d6d6; idle tracks stay transparent', () => {
  const css = fs.readFileSync(path.join(root, 'packages', '1c-preview-core', 'browser', 'viewer.css'), 'utf8');
  assert.match(css, /--fp-scrollbar-track:\s*#d6d6d6/);
  assert.match(css, /\.fp-body\.fp-mockup\.fp-vertical-scroll-needed::-webkit-scrollbar-track-piece:vertical\s*\{[^}]*#d6d6d6/s);
  assert.match(css, /\.fp-root-flattened-page\.fp-vstretch::-webkit-scrollbar-track-piece:vertical\s*\{[^}]*#d6d6d6/s);
  assert.match(css, /\.fp-table-mock\.fp-table-overflow-y::-webkit-scrollbar-track-piece:vertical\s*\{[^}]*#d6d6d6/s);
  assert.match(css, /\.fp-pages-active-panel::-webkit-scrollbar-track-piece:vertical\s*\{[^}]*#d6d6d6/s);
  assert.match(css, /\.fp-body\.fp-mockup::-webkit-scrollbar-track-piece:disabled\s*\{[^}]*transparent/);
});

test('empty choice presentations fall back to the serialized enum value names', () => {
  const parsed = FP.parse(`<?xml version="1.0" encoding="UTF-8"?>
<Form xmlns="http://v8.1c.ru/8.3/xcf/logform"
      xmlns:xr="http://v8.1c.ru/8.3/xcf/readable"
      xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <ChildItems><RadioButtonField name="ИсточникСреднего" id="1">
    <ChoiceList>
      <xr:Item><xr:Presentation/><xr:Value xsi:type="FormChoiceListDesTimeValue">
        <Presentation/><Value xsi:type="xr:DesignTimeRef">Enum.ИсточникиСреднегоДляПособий.EnumValue.УчетОрганизации</Value>
      </xr:Value></xr:Item>
      <xr:Item><xr:Presentation/><xr:Value xsi:type="FormChoiceListDesTimeValue">
        <Presentation/><Value xsi:type="xr:DesignTimeRef">Enum.ИсточникиСреднегоДляПособий.EnumValue.ВходящийЗапросФонда</Value>
      </xr:Value></xr:Item>
    </ChoiceList>
  </RadioButtonField></ChildItems>
</Form>`);
  const radio = parsed.model.childItemsRoot[0];
  assert.deepEqual(Array.from(radio.properties.ChoiceListItems), [
    'УчетОрганизации',
    'ВходящийЗапросФонда'
  ]);
  assert.deepEqual(Array.from(T.radioOptions(radio)), Array.from(radio.properties.ChoiceListItems));
});

test('empty decorations do not fall back to the element name', () => {
  const deco = { tag: 'LabelDecoration', name: 'Декорация_Разделитель_1', properties: {} };
  assert.equal(T.titleOf(deco), '');
  assert.equal(T.displayLabel(deco, null, 'LabelDecoration'), '');
});

test('explicit no-spacing vertical groups compact paintless decorations only', () => {
  const empty = { tag: 'LabelDecoration', properties: {} };
  assert.equal(T.emptyDecorationIsCompactInParent(empty, {
    orientation: 'vertical', verticalSpacing: 'none'
  }), true);
  assert.equal(T.emptyDecorationIsCompactInParent(empty, {
    orientation: 'vertical', verticalSpacing: ''
  }), false);
  assert.equal(T.emptyDecorationIsCompactInParent(empty, {
    orientation: 'horizontal', verticalSpacing: 'none'
  }), false);
  assert.equal(T.emptyDecorationIsCompactInParent({
    tag: 'LabelDecoration', properties: { Title: 'Spacer' }
  }, { orientation: 'vertical', verticalSpacing: 'none' }), false);
});

test('InCell column group uses child captions, not auto group title', () => {
  const table = {
    tag: 'Table',
    childItems: [{
      tag: 'ColumnGroup',
      name: 'ВыполнениеОперацийГруппаНоменклатура',
      properties: { Title: 'Группа номенклатура', Group: 'InCell' },
      childItems: [
        { tag: 'LabelField', name: 'Номенклатура', properties: { DataPath: 'ВыполнениеОпераций.Номенклатура' } },
        { tag: 'LabelField', name: 'Характеристика', properties: { DataPath: 'ВыполнениеОпераций.Характеристика' } }
      ]
    }]
  };
  const cols = T.tableColumns(table);
  assert.equal(cols.length, 1);
  assert.equal(T.isInCellGroup(cols[0]), true);
  assert.equal(T.columnCaption(cols[0]), 'Номенклатура, Характеристика');
});

test('Horizontal column group with ShowInHeader stays grouped', () => {
  const table = {
    tag: 'Table',
    childItems: [{
      tag: 'ColumnGroup',
      name: 'ГруппаКоличество',
      properties: { Title: 'Количество', Group: 'Horizontal', ShowInHeader: 'true' },
      childItems: [
        { tag: 'LabelField', properties: { Title: 'План' } },
        { tag: 'LabelField', properties: { Title: 'Готово' } }
      ]
    }]
  };
  const cols = T.tableColumns(table);
  assert.equal(cols.length, 1);
  assert.equal(T.columnCaption(cols[0]), 'Количество');
  assert.deepEqual(Array.from(T.tablePhysicalColumns(table), (col) => col.properties.Title), ['План', 'Готово']);
});

test('common picture resources are preserved in the form model and resolved case-insensitively', () => {
  const pictures = { RefreshCustom: { mime: 'image/png', data: 'iVBORw==' } };
  const parsed = FP.parse('<Form xmlns="http://v8.1c.ru/8.3/xcf/logform"/>', '', {}, '', {}, pictures);
  assert.equal(parsed.model.commonPictures, pictures);
  assert.equal(T.commonPictureResource('CommonPicture.refreshcustom', { commonPictures: pictures }), pictures.RefreshCustom);
  assert.equal(T.commonPictureResource('StdPicture.Refresh', { commonPictures: pictures }), null);
});

test('stored Picture.zip entry is decoded to a PNG data URL', async () => {
  const zipPreview = loadWebModules(root, ['xml-util.js', 'form-preview.js'], {
    CSS: { escape: String }, TextDecoder,
    atob: (value) => Buffer.from(value, 'base64').toString('binary'),
    btoa: (value) => Buffer.from(value, 'binary').toString('base64'),
  }).window.FormPreview._test;
  const name = Buffer.from('Picture.png');
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4);
  local.writeUInt32LE(png.length, 18); local.writeUInt32LE(png.length, 22);
  local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
  central.writeUInt32LE(png.length, 20); central.writeUInt32LE(png.length, 24);
  central.writeUInt16LE(name.length, 28); central.writeUInt32LE(0, 42);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + name.length, 12);
  end.writeUInt32LE(local.length + name.length + png.length, 16);
  const zip = Buffer.concat([local, name, png, central, name, end]);
  const url = await zipPreview.zipPictureDataUrl({ mime: 'application/zip', data: zip.toString('base64') });
  assert.equal(url, `data:image/png;base64,${png.toString('base64')}`);
});

test('Picture.zip selects the plain ldpi manifest variant and detects GIF or extensionless SVG', async () => {
  const zipPreview = loadWebModules(root, ['xml-util.js', 'form-preview.js'], {
    CSS: { escape: String }, TextDecoder,
    atob: (value) => Buffer.from(value, 'base64').toString('binary'),
    btoa: (value) => Buffer.from(value, 'binary').toString('base64'),
  }).window.FormPreview._test;
  function storedZip(files) {
    const locals = [], centrals = [];
    let offset = 0;
    for (const [fileName, data] of files) {
      const name = Buffer.from(fileName);
      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4);
      local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22);
      local.writeUInt16LE(name.length, 26);
      locals.push(local, name, data);
      const central = Buffer.alloc(46);
      central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
      central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24);
      central.writeUInt16LE(name.length, 28); central.writeUInt32LE(offset, 42);
      centrals.push(central, name);
      offset += local.length + name.length + data.length;
    }
    const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
    end.writeUInt32LE(centralSize, 12); end.writeUInt32LE(offset, 16);
    return Buffer.concat([...locals, ...centrals, end]);
  }
  const gif = Buffer.from('GIF89a', 'ascii');
  const manifest = Buffer.from('<Picture><PictureVariant name="b.gif" screenDensity="bldpi"/><PictureVariant name="l.gif" screenDensity="ldpi"/></Picture>');
  const gifZip = storedZip([['b.gif', Buffer.from('GIF87a')], ['l.gif', gif], ['manifest.xml', manifest]]);
  assert.equal(await zipPreview.zipPictureDataUrl({ mime: 'application/zip', data: gifZip.toString('base64') }),
    `data:image/gif;base64,${gif.toString('base64')}`);

  const modern = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);
  const legacy = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 2]);
  const modernManifest = Buffer.from('<Picture><PictureVariant name="100.png" screenDensity="ldpi"/><PictureVariant name="Picture.png" interfaceVariant="version8_2" screenDensity="ldpi"/></Picture>');
  const versionedZip = storedZip([['Picture.png', legacy], ['100.png', modern], ['manifest.xml', modernManifest]]);
  assert.equal(await zipPreview.zipPictureDataUrl({ mime: 'application/zip', data: versionedZip.toString('base64') }),
    `data:image/png;base64,${modern.toString('base64')}`);

  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>');
  const svgManifest = Buffer.from('<Picture><PictureVariant name="l" screenDensity="ldpi"/></Picture>');
  const svgZip = storedZip([['l', svg], ['manifest.xml', svgManifest]]);
  assert.equal(await zipPreview.zipPictureDataUrl({ mime: 'application/zip', data: svgZip.toString('base64') }),
    `data:image/svg+xml;base64,${svg.toString('base64')}`);
});

test('explicit generated group divider has vertical and horizontal CSS modes', () => {
  const css = fs.readFileSync(path.join(root, 'web', 'viewer.css'), 'utf8');
  assert.match(css, /\.fp-deco-sep-vertical\s*\{/);
  assert.match(css, /\.fp-deco-sep-horizontal\s*\{/);
  assert.match(css, /\.fp-auto-column-separators/);
});

test('hidden grouped headers keep their physical data columns', () => {
  const table = {
    tag: 'Table',
    childItems: [{
      tag: 'ColumnGroup',
      properties: { Title: 'Доход', Group: 'Horizontal', ShowInHeader: 'true' },
      childItems: [
        { tag: 'InputField', properties: { Title: 'Код', Width: '6', ShowInHeader: 'false' } },
        { tag: 'InputField', properties: { Title: 'Сумма', Width: '17', ShowInHeader: 'false' } }
      ]
    }]
  };
  assert.equal(T.headerKids(table.childItems[0]).length, 0);
  assert.deepEqual(Array.from(T.tablePhysicalColumns(table), (col) => col.properties.Width), ['6', '17']);
});

test('ColumnGroup without Group keeps its children stacked vertically', () => {
  const group = {
    tag: 'ColumnGroup',
    name: 'ТоварыГруппаОписание',
    properties: {},
    childItems: [
      { tag: 'InputField', name: 'ТоварыДополнительноеОписание', properties: {} },
      { tag: 'InputField', name: 'ТоварыСсылкаВИнтернете', properties: {} }
    ]
  };
  const cols = T.tableColumns({ tag: 'Table', childItems: [group] });
  assert.equal(T.isVerticalColumnGroup(group), true);
  assert.equal(cols.length, 1);
  assert.equal(cols[0], group);
  assert.equal(T.columnCaption(group), 'Товары дополнительное описание');
});

test('vertical ColumnGroup uses the first visible child header caption', () => {
  const group = {
    tag: 'ColumnGroup',
    name: 'ДатыНачисления',
    properties: { Title: 'Даты начисления' },
    childItems: [{
      tag: 'ColumnGroup',
      properties: { Group: 'Horizontal' },
      childItems: [
        { tag: 'InputField', properties: { Title: 'Период' } },
        { tag: 'InputField', properties: { Title: 'Дата окончания', ShowInHeader: 'false' } }
      ]
    }]
  };
  assert.equal(T.columnCaption(group), 'Период');
});

test('table std commands respect ChangeRowSet/ChangeRowOrder', () => {
  const locked = {
    properties: { ChangeRowSet: 'false', ChangeRowOrder: 'false' },
    autoCommandBar: { properties: {}, childItems: [] }
  };
  assert.equal(T.tableStdCommands(locked).length, 0);
  const noFill = {
    properties: {},
    autoCommandBar: { properties: { Autofill: 'false' }, childItems: [{ tag: 'Button' }] }
  };
  assert.equal(T.tableStdCommands(noFill).length, 0);
  const normal = { properties: {}, autoCommandBar: { properties: {}, childItems: [] } };
  assert.ok(T.tableStdCommands(normal).some((b) => b.properties.Title === 'Добавить'));
  assert.equal(T.tableStdCommands(normal).some((b) => b.properties.Title === 'Создать'), false);
  const list = { properties: { Representation: 'List' }, autoCommandBar: { properties: {}, childItems: [] } };
  const listCmds = T.tableStdCommands(list);
  assert.equal(listCmds.map((b) => b.properties.Title).join(','), 'Создать,Скопировать');
  assert.equal(T.resolveButtonRep(listCmds[0]), 'text');
  assert.equal(T.resolveButtonRep(listCmds[1]), 'picture');
  assert.equal(listCmds.some((b) => /вверх|вниз|Добавить/i.test(b.properties.Title || '')), false);
});

test('list table from DynamicList uses Create and Copy icon', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Form xmlns="http://v8.1c.ru/8.3/xcf/logform" xmlns:v8="http://v8.1c.ru/8.1/data/core" version="2.20">
  <ChildItems>
    <Table name="Список" id="1">
      <DataPath>Список</DataPath>
      <AutoCommandBar name="СписокКоманднаяПанель" id="-1"/>
      <ViewStatusAddition name="СписокСостояниеПросмотра" id="2">
        <AdditionSource>
          <Item>Список</Item>
          <Type>ViewStatusRepresentation</Type>
        </AdditionSource>
      </ViewStatusAddition>
    </Table>
  </ChildItems>
  <Attributes>
    <Attribute name="Список" id="1">
      <Type>
        <v8:Type>v8:DynamicList</v8:Type>
      </Type>
      <MainAttribute>true</MainAttribute>
    </Attribute>
  </Attributes>
</Form>`;
  const parsed = FP.parse(xml);
  assert.ok(!parsed.error, parsed.error);
  const table = parsed.model.childItemsRoot[0];
  assert.equal(T.tableIsList(table, parsed.model), true);
  const cmds = T.tableStdCommands(table, parsed.model);
  assert.equal(cmds[0].properties.Title, 'Создать');
  assert.equal(cmds[1].properties.Title, 'Скопировать');
  assert.equal(T.resolveButtonRep(cmds[1]), 'picture');
});

test('adopted document table uses Add/Move without inventing missing command metadata', () => {
  const table = {
    tag: 'Table',
    name: 'РасшифровкаПлатежа',
    properties: { Representation: 'List', DataPath: 'Объект.РасшифровкаПлатежа' },
    autoCommandBar: {
      properties: {},
      childItems: [
        { tag: 'Button', name: 'РасшифровкаПлатежаПодборПоОстаткам', properties: { CommandName: '0' } },
        { tag: 'Button', name: 'РасшифровкаПлатежаПодобратьПодарочныйСертификат', properties: { CommandName: '0' } },
        { tag: 'Button', name: 'РасшифровкаПлатежаПодобратьИзЗаявок', properties: { CommandName: '0' } },
        { tag: 'Button', name: 'ЗаполнитьОстаткамиНевыданныхСуммКонтрагенту', properties: { CommandName: '0' } },
        { tag: 'Button', name: 'ЗаполнитьОстаткамиНевыданныхСуммСотруднику', properties: { CommandName: '0' } }
      ]
    }
  };
  const model = {
    attributes: [{ name: 'Объект', properties: { MainAttribute: 'true' } }],
    objectMeta: { objectBelonging: 'Adopted' }
  };
  assert.equal(T.tableIsList(table, model), false);
  assert.deepEqual(Array.from(T.tableBarItems(table, model), (item) => T.titleOf(item)), [
    'Добавить', 'Переместить вверх', 'Переместить вниз',
    'Расшифровка платежа подбор по остаткам',
    'Расшифровка платежа подобрать подарочный сертификат',
    'Расшифровка платежа подобрать из заявок',
    'Заполнить остатками невыданных сумм контрагенту',
    'Заполнить остатками невыданных сумм сотруднику'
  ]);
});

test('extension buttons recover captions but keep Auto representation text', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Form xmlns="http://v8.1c.ru/8.3/xcf/logform" xmlns:v8="http://v8.1c.ru/8.1/data/core" xmlns:xr="http://v8.1c.ru/8.3/xcf/readable">
  <ChildItems><Table name="Товары" id="34"><DataPath>Объект.Товары</DataPath>
    <AutoCommandBar name="ТоварыКоманднаяПанель" id="36"><ChildItems>
      <Button name="ТоварыОбновитьОстатки" id="130"><CommandName>0</CommandName></Button>
    </ChildItems></AutoCommandBar>
  </Table></ChildItems>
  <Attributes><Attribute name="Объект"><MainAttribute>true</MainAttribute></Attribute></Attributes>
  <BaseForm><Commands><Command name="ОбновитьОстатки" id="1">
    <Title><v8:item><v8:lang>ru</v8:lang><v8:content>Остатки на складе</v8:content></v8:item></Title>
    <Picture><xr:Ref>CommonPicture.НавигацияОбновить</xr:Ref></Picture>
    <Representation>TextPicture</Representation>
  </Command></Commands></BaseForm>
</Form>`;
  const parsed = FP.parse(xml);
  assert.ok(!parsed.error, parsed.error);
  assert.equal(parsed.model.commands.length, 1);
  const button = parsed.model.childItemsRoot[0].autoCommandBar.childItems[0];
  assert.equal(button.properties.CommandName, 'Form.Command.ОбновитьОстатки');
  const ctx = {
    commands: { ОбновитьОстатки: parsed.model.commands[0] },
    commandTitles: { ОбновитьОстатки: 'Остатки на складе' }
  };
  assert.equal(T.titleOf(button, ctx), 'Остатки на складе');
  assert.equal(T.resolveButtonRep(button, ctx), 'text');
});

test('extension buttons recover inherited command metadata from the external cf form', () => {
  const extension = `<Form xmlns="http://v8.1c.ru/8.3/xcf/logform">
    <ChildItems><Table name="Товары" id="34"><AutoCommandBar><ChildItems>
      <Button name="ТоварыЗаполнитьЖелаемуюДатуПоставки" id="230"><CommandName>0</CommandName></Button>
    </ChildItems></AutoCommandBar></Table></ChildItems><BaseForm/></Form>`;
  const base = `<Form xmlns="http://v8.1c.ru/8.3/xcf/logform" xmlns:v8="http://v8.1c.ru/8.1/data/core" xmlns:xr="http://v8.1c.ru/8.3/xcf/readable">
    <Commands><Command name="ЗаполнитьЖелаемуюДатуПоставки">
      <Title><v8:item><v8:lang>ru</v8:lang><v8:content>Заполнить желаемую дату поставки</v8:content></v8:item></Title>
      <Picture><xr:Ref>CommonPicture.ТипДата</xr:Ref></Picture>
      <Representation>TextPicture</Representation>
    </Command></Commands></Form>`;
  const parsed = FP.parse(extension, '', {}, base);
  assert.ok(!parsed.error, parsed.error);
  const button = parsed.model.childItemsRoot[0].autoCommandBar.childItems[0];
  assert.equal(button.properties.CommandName, 'Form.Command.ЗаполнитьЖелаемуюДатуПоставки');
  assert.equal(parsed.model.commands[0].properties.Title, 'Заполнить желаемую дату поставки');
});

test('empty Create based on popup is filled from CommandInterface', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Form xmlns="http://v8.1c.ru/8.3/xcf/logform" xmlns:v8="http://v8.1c.ru/8.1/data/core" version="2.20">
  <ChildItems>
    <Table name="Список" id="1">
      <Representation>List</Representation>
      <DataPath>Список</DataPath>
      <AutoCommandBar name="СписокКоманднаяПанель" id="-1">
        <ChildItems>
          <Popup name="ПодменюСоздатьНаОсновании" id="2">
            <Title>
              <v8:item><v8:lang>ru</v8:lang><v8:content>Создать на основании</v8:content></v8:item>
            </Title>
            <Representation>Picture</Representation>
            <ChildItems>
              <ButtonGroup name="ПодменюСоздатьНаОснованииОбычное" id="3"/>
            </ChildItems>
          </Popup>
          <Popup name="ГруппаУстановитьСтатус" id="4">
            <Title>
              <v8:item><v8:lang>ru</v8:lang><v8:content>Установить статус</v8:content></v8:item>
            </Title>
            <ChildItems>
              <Button name="УстановитьСтатусДействует" id="5">
                <CommandName>Form.Command.УстановитьСтатусДействует</CommandName>
              </Button>
            </ChildItems>
          </Popup>
        </ChildItems>
      </AutoCommandBar>
    </Table>
  </ChildItems>
  <Attributes>
    <Attribute name="Список" id="1">
      <Type><v8:Type>v8:DynamicList</v8:Type></Type>
      <MainAttribute>true</MainAttribute>
    </Attribute>
  </Attributes>
  <Commands>
    <Command name="УстановитьСтатусДействует" id="1">
      <Title>
        <v8:item><v8:lang>ru</v8:lang><v8:content>Действует</v8:content></v8:item>
      </Title>
    </Command>
  </Commands>
  <CommandInterface>
    <CommandBar>
      <Item>
        <Command>Document.СчетНаОплатуКлиенту.StandardCommand.CreateBasedOn</Command>
        <CommandGroup>FormCommandBarCreateBasedOn</CommandGroup>
      </Item>
      <Item>
        <Command>CommonCommand.ИнтеграцияС1СДокументооборотСоздатьПисьмо</Command>
        <CommandGroup>FormCommandBarCreateBasedOn</CommandGroup>
        <DefaultVisible>false</DefaultVisible>
      </Item>
      <Item>
        <Command>CommonCommand.СозданиеСвязанныхОбъектов</Command>
        <CommandGroup>FormCommandBarCreateBasedOn</CommandGroup>
      </Item>
    </CommandBar>
  </CommandInterface>
</Form>`;
  const parsed = FP.parse(xml);
  assert.ok(!parsed.error, parsed.error);
  const table = parsed.model.childItemsRoot[0];
  const basedOn = table.autoCommandBar.childItems.find((it) => it.name === 'ПодменюСоздатьНаОсновании');
  const status = table.autoCommandBar.childItems.find((it) => it.name === 'ГруппаУстановитьСтатус');
  assert.equal(T.popupHasCommands(basedOn), true);
  assert.equal(T.popupHasCommands(status), true);
  assert.equal(T.resolveButtonRep(basedOn), 'text');
  const basedTitles = T.popupMenuEntries(basedOn).map((e) => e.properties.Title);
  assert.ok(basedTitles.some((t) => /Счет/i.test(t)), basedTitles.join(', '));
  assert.ok(basedTitles.some((t) => /Связанных/i.test(t)), basedTitles.join(', '));
  assert.equal(basedTitles.some((t) => /Документооборот/i.test(t)), false);
  const ctx = { commands: {}, commandTitles: { УстановитьСтатусДействует: 'Действует' } };
  parsed.model.commands.forEach((c) => { ctx.commands[c.name] = c; ctx.commandTitles[c.name] = T.titleOf(c); });
  assert.equal(T.titleOf(status.childItems[0], ctx), 'Действует');
  const bar = T.tableBarItems(table, parsed.model);
  assert.ok(bar.some((it) => it.name === 'ГруппаУстановитьСтатус'));
  assert.ok(bar.some((it) => it.name === 'ПодменюСоздатьНаОсновании' && T.popupHasCommands(it)));
});

test('outline highlight opens command-bar submenu and keeps the entry selected', () => {
  function classList(init) {
    const s = new Set(String(init || '').split(/\s+/).filter(Boolean));
    return {
      contains: (c) => s.has(c),
      add: (c) => { s.add(c); },
      remove: (c) => { s.delete(c); }
    };
  }
  const oldPopup = { classList: classList('fp-popup-open') };
  let entryScrolled = false;
  let entry;
  let wrap;
  const body = {
    appendChild: (node) => { node.parentNode = body; }
  };
  const root = {
    classList: classList(''),
    parentNode: null,
    ownerDocument: { body },
    querySelectorAll: (sel) => sel === '.fp-popup-open'
      ? [oldPopup, wrap].filter((node) => node && node.classList.contains('fp-popup-open'))
      : [],
    querySelector: (sel) => String(sel).startsWith('.fp-popup-entry') ? entry : null
  };
  const btn = {
    classList: classList('fp-button fp-popup'),
    getBoundingClientRect: () => ({ left: 10, right: 90, top: 10, bottom: 34, width: 80, height: 24 })
  };
  const menu = { classList: classList('fp-popup-menu'), style: {}, offsetWidth: 180, offsetHeight: 80, children: [] };
  wrap = {
    classList: classList('fp-control-wrap fp-popup-wrap'),
    parentNode: root,
    appendChild: (node) => { node.parentNode = wrap; },
    querySelector: (sel) => {
      if (String(sel).indexOf('fp-popup-menu') >= 0) return menu;
      if (String(sel).indexOf('fp-popup') >= 0 || String(sel).indexOf('fp-button') >= 0) return btn;
      return null;
    }
  };
  entry = {
    classList: classList('fp-popup-entry'),
    parentNode: menu,
    scrollIntoView: () => { entryScrolled = true; }
  };
  menu.parentNode = wrap;
  btn.parentNode = wrap;
  const container = {
    _fpCtx: { root, selectedId: '' },
    querySelector: (sel) => sel === '#fp-canvas' ? root : null
  };
  const selected = FP.highlight(container, '42');

  assert.equal(selected, entry);
  assert.equal(container._fpCtx.selectedId, '42');
  assert.equal(wrap.classList.contains('fp-popup-open'), true);
  assert.equal(oldPopup.classList.contains('fp-popup-open'), false);
  assert.equal(entry.classList.contains('selected'), true);
  assert.equal(entryScrolled, true);
  assert.equal(menu.parentNode, body);
  assert.equal(menu.style.position, 'fixed');
  assert.equal(menu.style.top, '34px');

  FP.dismiss(container);
  assert.equal(wrap.classList.contains('fp-popup-open'), false);
  assert.equal(menu.parentNode, wrap);
  assert.equal(menu.style.position, '');
});

test('empty command-bar popups are not treated as main-row items', () => {
  const empty = {
    tag: 'Popup',
    properties: { Title: 'Печать', Representation: 'Picture' },
    childItems: [{ tag: 'ButtonGroup', childItems: [] }]
  };
  assert.equal(T.popupHasCommands(empty), false);
  const filled = {
    tag: 'Popup',
    properties: { Title: 'Действие' },
    childItems: [{ tag: 'Button', properties: { CommandName: 'Form.Command.X' } }]
  };
  assert.equal(T.popupHasCommands(filled), true);
});

test('popup menu lists nested buttons and picture+text for Добавить', () => {
  const popup = {
    tag: 'Popup',
    name: 'ПодменюДобавить',
    properties: { Title: 'Добавить', Picture: 'StdPicture.CreateListItem' },
    childItems: [
      { tag: 'Button', name: 'ДобавитьИзФайлаНаДиске', properties: { Title: 'Файл с диска...' } },
      { tag: 'Button', name: 'ДобавитьФайлПоШаблону', properties: { Title: 'По шаблону файла...' } },
      {
        tag: 'ButtonGroup',
        childItems: [
          { tag: 'Button', name: 'Hidden', properties: { Visible: 'false', Title: 'Скрыто' } },
          { tag: 'Button', name: 'Dead', properties: { CommandName: '0' } }
        ]
      },
      { tag: 'Button', name: 'ДобавитьФайлСоСканера', properties: { Title: 'Со сканера...' } }
    ]
  };
  const entries = T.popupMenuEntries(popup);
  assert.equal(entries.length, 3);
  assert.equal(entries[0].name, 'ДобавитьИзФайлаНаДиске');
  assert.equal(entries[1].name, 'ДобавитьФайлПоШаблону');
  assert.equal(entries[2].name, 'ДобавитьФайлСоСканера');
  assert.equal(T.titleOf(entries[0]), 'Файл с диска...');
  assert.equal(T.resolveButtonRep(popup, {}), 'pictureandtext');
});

test('dead and extra command-bar buttons are not kept in the main row', () => {
  assert.equal(T.isDeadCommand({ tag: 'Button', properties: { CommandName: '0' } }), true);
  assert.equal(T.isDeadCommand({
    tag: 'Button',
    properties: { CommandName: '0', Title: 'Заполнить статью ДДС' }
  }), false, 'an explicitly titled inherited command remains visible');
  assert.equal(T.isDeadCommand({ tag: 'Button', properties: { CommandName: 'Form.Command.Create' } }), false);
  assert.equal(T.inAdditionalBar({ properties: { CommandName: 'Form.StandardCommand.CustomizeForm' } }), true);
  assert.equal(T.inAdditionalBar({
    properties: { LocationInCommandBar: 'InCommandBarAndInAdditionalSubmenu' }
  }), false);
  assert.equal(T.inAdditionalBar({
    properties: { LocationInCommandBar: 'InAdditionalSubmenu' }
  }), true);
  const group = {
    tag: 'ButtonGroup',
    childItems: [
      { tag: 'Button', properties: { CommandName: '0' } },
      { tag: 'Button', name: 'ФормаИзменитьФорму', properties: { CommandName: 'Form.StandardCommand.CustomizeForm' } }
    ]
  };
  assert.equal(T.hasMainBarChildren(group), false);
  const extra = [];
  T.collectAdditionalBarItems(group, extra);
  assert.equal(extra.length, 1);
  assert.equal(extra[0].name, 'ФормаИзменитьФорму');
  const emptyGlobal = { tag: 'ButtonGroup', properties: { CommandSource: 'FormCommandPanelGlobalCommands' }, childItems: [] };
  assert.equal(T.hasMainBarChildren(emptyGlobal), false);
});

test('search addition is hidden when location is None', () => {
  const table = { properties: { SearchStringLocation: 'None', ViewStatusLocation: 'None' } };
  assert.equal(T.additionHidden(table, 'SearchStringLocation'), true);
  assert.equal(T.additionHidden(table, 'ViewStatusLocation'), true);
  assert.equal(T.additionHidden({ properties: {} }, 'SearchStringLocation'), false);
});

test('visible table search addition consumes duplicate Find commands', () => {
  const command = (name, commandName) => ({ tag: 'Button', name, properties: { CommandName: commandName } });
  const table = {
    properties: { ChangeRowSet: 'false', ChangeRowOrder: 'false' },
    searchStringAddition: { tag: 'SearchStringAddition', properties: {} },
    autoCommandBar: {
      properties: {},
      childItems: [
        command('Find', 'Form.Item.Rows.StandardCommand.Find'),
        command('Cancel', 'Form.Item.Rows.StandardCommand.CancelSearch'),
        command('Print', 'Form.Command.PrintRows')
      ]
    }
  };
  assert.equal(Array.from(T.tableBarItems(table, {}), (item) => item.name).join(','), 'Print');

  table.properties.SearchStringLocation = 'None';
  assert.equal(Array.from(T.tableBarItems(table, {}), (item) => item.name).join(','), 'Find,Cancel,Print');
});

test('an authored common command button takes caption, picture and representation from its descriptor', () => {
  const button = {
    tag: 'Button', name: 'ОбщаяКомандаСкопироватьСервисДоставки',
    properties: { Type: 'CommandBarButton', CommandName: 'CommonCommand.СкопироватьСервисДоставки' }
  };
  const ctx = {
    commands: {},
    commandTitles: {},
    model: { commonCommands: { СкопироватьСервисДоставки: { name: 'СкопироватьСервисДоставки', properties: {
      Title: 'Скопировать сервис доставки', Picture: 'StdPicture.CloneListItem', Representation: 'Picture'
    } } } }
  };
  assert.equal(T.titleOf(button, ctx), 'Скопировать сервис доставки');
  assert.equal(T.resolveButtonRep(button, ctx), 'picture');
  /* A form command of the same short name must not borrow the descriptor. */
  const local = { tag: 'Button', name: 'Local', properties: {
    Type: 'CommandBarButton', CommandName: 'Form.Command.СкопироватьСервисДоставки' } };
  assert.equal(T.titleOf(local, ctx), 'Local');
});

test('explicit left command starts a primary contribution segment', () => {
  const button = (align = '') => ({ tag: 'Button', properties: align ? { GroupHorizontalAlign: align } : {} });
  assert.equal(T.commandBarLeadingContributionCount([button(), button('Left'), button(), button()]), 2);
  assert.equal(T.commandBarLeadingContributionCount([button(), button(), button()]), 0);
  assert.equal(T.commandBarLeadingContributionCount([button(), button('Right'), button('Left')]), 0);
  assert.equal(T.commandBarLeadingContributionCount([button()]), 0);
});

test('a left-aligned picture command exposes text in an adaptive primary segment', () => {
  assert.equal(T.adaptivePrimaryCommandText({
    tag: 'Button', properties: { GroupHorizontalAlign: 'Left', Representation: 'Picture', Title: 'Сохранить' }
  }), 'Сохранить');
  assert.equal(T.adaptivePrimaryCommandText({
    tag: 'Button', properties: { GroupHorizontalAlign: 'Right', Representation: 'Picture', Title: 'Сохранить' }
  }), '');
  assert.equal(T.adaptivePrimaryCommandText({
    tag: 'Button', properties: { GroupHorizontalAlign: 'Left', Representation: 'PictureAndText', Title: 'Сохранить' }
  }), '');
});

test('right command bars consume a trailing lane instead of growing content', () => {
  const classes = (values) => ({ contains: (name) => values.includes(name) });
  assert.equal(T.rightCommandBarLane({ properties: { Width: '54' } }, { classList: classes([]) }), 160);
  assert.equal(T.rightCommandBarLane({ properties: {} }, { classList: classes([]) }), 0);
  assert.equal(T.rightCommandBarLane({ properties: {} }, { classList: classes(['fp-hstretch']) }), -1);
  const meta = T.layoutMeta({ tag: 'CommandBar', properties: { HorizontalLocation: 'Right' }, childItems: [] });
  assert.equal(meta.flexJustifyContent, '');
  assert.equal(T.wantsHStretch({
    tag: 'CommandBar',
    properties: { HorizontalLocation: 'Right', Title: 'Кнопки далее' },
    childItems: [{ tag: 'Button', properties: { Title: 'Далее' } }]
  }, 'CommandBar', { orientation: 'horizontal', tag: 'Page' }, {}), false);
  const css = fs.readFileSync(path.join(root, 'packages', '1c-preview-core', 'browser', 'viewer.css'), 'utf8');
  assert.match(css, /fp-root-command-footer[\s\S]*fp-group-block > \.fp-children/,
    'wizard footer Pages=None stretch to the window so Right command bars can sit on the trailing edge');
});

test('wrapped left titles top-align the editor like a multiline field', () => {
  const css = fs.readFileSync(path.join(root, 'packages', '1c-preview-core', 'browser', 'viewer.css'), 'utf8');
  assert.match(css, /\.fp-field-row\.fp-title-wrap\s*\{[^}]*align-items:\s*flex-start/);
  assert.match(css, /\.fp-field-row\.fp-title-wrap\s*>\s*\.fp-input-wrap\s*\{[^}]*height:\s*var\(--fp-textbox-height\)/);
});

test('non-stretch command bar lane reserves all following horizontal siblings', () => {
  assert.equal(T.commandBarSiblingLaneBudget(990, 12, [340.46875, 53.84375], 8), 567);
  assert.equal(T.commandBarSiblingLaneBudget(500, 20, [], 8), 480);
  assert.equal(T.commandBarSiblingLaneBudget(100, 90, [40], 8), 0);
});

test('vertical white card stacks retain the native separator surface', () => {
  const card = () => ({ tag: 'UsualGroup', properties: { BackColor: '#FFFFFF' } });
  assert.equal(T.isNativeCardStack({
    properties: { Group: 'Vertical', VerticalSpacing: 'Half' }, childItems: [card(), card()]
  }), true);
  assert.equal(T.isNativeCardStack({
    properties: { Group: 'Vertical', VerticalSpacing: 'None' }, childItems: [card(), card()]
  }), false);
  const css = fs.readFileSync(path.join(root, 'packages', '1c-preview-core', 'browser', 'viewer.css'), 'utf8');
  assert.match(css, /fp-native-card-stack[\s\S]*fp-children-vertical[\s\S]*fp-item:not\(:first-child\)/,
    'only following direct cards receive the native content inset');
  assert.match(css, /fp-pages-panel-wrap:has\(> \.fp-pages-active-panel\.fp-recursive-auto-column-tree\)[\s\S]*padding-left: var\(--fp-page-padding-x\)/,
    'a recursive Page owns the native outer column inset');
  assert.match(css, /fp-recursive-auto-column-tree:has\(> \.fp-item\.fp-native-card-stack\)[\s\S]*column-gap: 4px/,
    'a recursive white-card Page owns its Half separator band');
});

test('field kinds come from metadata and explicit control properties, not names', () => {
  const ctx = { captionIndex: { types: {
    'Объект.ЛюбаяСтрока': 'xs:string',
    'Объект.ЛюбаяСсылка': 'cfg:CatalogRef.Контрагенты',
    'Объект.ЛюбоеЧисло': 'xs:decimal',
    'Объект.ЛюбаяДата': 'xs:dateTime'
  } } };
  assert.equal(T.fieldKind({ properties: { DataPath: 'Объект.ЛюбаяСтрока' } }, ctx), 'text');
  assert.equal(T.fieldKind({ properties: { DataPath: 'Объект.ЛюбаяСсылка' } }, ctx), 'ref');
  assert.equal(T.fieldKind({ properties: { DataPath: 'Объект.ЛюбоеЧисло' } }, ctx), 'number');
  assert.equal(T.fieldKind({ properties: { DataPath: 'Объект.ЛюбаяДата' } }, ctx), 'date');
  assert.equal(T.fieldKind({ properties: { DataPath: 'Объект.ПричинаЗадержки', ChoiceButton: 'false' } }), 'text');
});

test('input button chrome follows type and authored representation properties', () => {
  const ctx = { captionIndex: {
    types: {
      Объект: 'cfg:CatalogObject.ВидыНоменклатуры',
      'Объект.Тип': 'cfg:EnumRef.ТипНоменклатуры',
      'Объект.Дата': 'xs:dateTime',
    },
    mainNames: { Объект: true },
  } };
  const parent = { properties: { DataPath: 'Объект.Parent' } };
  assert.equal(T.metaType(parent, ctx), 'cfg:CatalogRef.ВидыНоменклатуры');
  assert.deepEqual(Array.from(T.inputButtonKinds(parent, ctx)), ['caret-down', 'open-1c'],
    'a standard catalog Parent gets dropdown choice plus object opening');
  assert.deepEqual(Array.from(T.inputButtonKinds({ properties: { DataPath: 'Объект.Тип' } }, ctx)),
    ['caret-down'], 'an enum/reference choice has no meaningless object-open button');
  assert.deepEqual(Array.from(T.inputButtonKinds({ properties: { ChoiceButton: 'true' } }, {})),
    ['dots'], 'an explicit standalone choice button stays inside the input');
  assert.deepEqual(Array.from(T.inputButtonKinds({
    properties: { ChoiceButton: 'true' },
    events: ['Clearing']
  }, {})), ['dots'], 'a Clearing handler does not invent a designer ClearButton');
  assert.deepEqual(Array.from(T.inputButtonKinds({ properties: { DataPath: 'Объект.Дата' } }, ctx)),
    ['dots'], 'a typed date without an authored calendar picture uses the reference choice button');
  assert.deepEqual(Array.from(T.inputButtonKinds({ properties: {
    DataPath: 'Объект.Дата', ChoiceButtonPicture: 'StdPicture.InputFieldCalendar',
  } }, ctx)), ['calendar'], 'an authored calendar picture keeps the calendar glyph');
  assert.deepEqual(Array.from(T.inputButtonKinds({ properties: {
    DropListButton: 'true', ChoiceButton: 'true',
    ChoiceButtonRepresentation: 'ShowInDropListAndInInputField',
  } }, {})), ['caret-down', 'dots']);
  assert.deepEqual(Array.from(T.inputButtonKinds({ properties: {
    ChoiceButton: 'true', CreateButton: 'true', ClearButton: 'true', SpinButton: 'true',
  } }, {})), ['dots', 'plus', 'x', 'spin']);
});

test('Reference type features resolve Auto input buttons and leave authored properties intact', () => {
  const features = (types, fraction, numberQ) =>
    JSON.parse(JSON.stringify(T.typeFeaturesOf(types, fraction, numberQ)));
  assert.deepEqual(features(['cfg:CatalogRef.Партнеры']),
    { selection: 'extended', clear: false, adjust: false, open: true });
  assert.deepEqual(features(['cfg:EnumRef.Статусы']),
    { selection: 'extended', clear: false, adjust: false, open: false });
  assert.deepEqual(features(['xs:decimal'], '', { digits: '15', fractionDigits: '2' }),
    { selection: 'dialog', clear: false, adjust: false, open: false });
  assert.deepEqual(features(['xs:decimal'], '', { digits: '10', fractionDigits: '0' }),
    { selection: 'none', clear: false, adjust: false, open: false });
  assert.deepEqual(features(['xs:boolean']),
    { selection: 'finiteSet', clear: false, adjust: false, open: false });
  assert.deepEqual(features(['xs:dateTime'], 'Time'),
    { selection: 'none', clear: false, adjust: false, open: false });

  const ctx = { captionIndex: { types: {
    'Объект.Сумма': 'xs:decimal',
    'Объект.Флаг': 'xs:boolean',
    'Объект.Время': 'xs:dateTime',
  }, numberQ: { 'Объект.Сумма': { digits: '10', fractionDigits: '2', allowedSign: 'Any' } },
    dateFraction: { 'Объект.Время': 'Time' } } };
  assert.deepEqual(Array.from(T.inputButtonKinds({ properties: { DataPath: 'Объект.Сумма' } }, ctx)),
    ['dots'], 'a decimal Auto ChoiceButton is the calculator dialog');
  assert.deepEqual(Array.from(T.inputButtonKinds({ properties: { DataPath: 'Объект.Флаг' } }, ctx)),
    ['caret-down'], 'Boolean InputField Auto DropList is FINITE_SET');
  assert.deepEqual(Array.from(T.inputButtonKinds({ properties: { DataPath: 'Объект.Время' } }, ctx)),
    [], 'Time-only Date has no Auto choice dialog');
  assert.deepEqual(Array.from(T.inputButtonKinds({
    properties: { DataPath: 'Объект.Сумма', ChoiceButton: 'false' },
  }, ctx)), [], 'an explicit ChoiceButton=false wins over type Auto');

  const parsed = FP.parse(`<Form xmlns="http://v8.1c.ru/8.3/xcf/logform" xmlns:v8="http://v8.1c.ru/8.1/data/core">
    <ChildItems><InputField name="Партнер" id="1"><DataPath>Объект.Партнер</DataPath></InputField></ChildItems>
    <Attributes><Attribute name="Объект"><MainAttribute>true</MainAttribute></Attribute>
      <Attribute name="Партнер"><Type><v8:Type>cfg:CatalogRef.Партнеры</v8:Type></Type></Attribute>
    </Attributes></Form>`);
  assert.ok(!parsed.error, parsed.error);
  const field = parsed.model.childItemsRoot[0];
  assert.equal(Object.prototype.hasOwnProperty.call(field.properties, 'ChoiceButton'), false);
  assert.equal(field.authoredProperties.ChoiceButton, undefined);
  assert.equal(field.runtime.defaultChars, 15);
  assert.equal(field.runtime.minChars, 6);
  assert.equal(field.runtime.maxChars, 40);
  assert.equal(T.defaultCharsOf(['xs:dateTime'], { dateFraction: 'DateTime' }), 17);
  assert.equal(T.defaultCharsOf(['xs:dateTime'], { dateFraction: 'Date' }), 9);
  assert.equal(T.defaultCharsOf(['xs:dateTime'], { dateFraction: 'Time' }), 8);
  /* The reference default width (without useStdFontForWidthCalculate): the
   * Taxi length*5.4|5.5/8 value is already in width units (native px =
   * width*10 + 11 + buttons*21). The digits+sign+separators count is not. */
  const num = (digits, fractionDigits, allowedSign) =>
    T.defaultCharsOf(['xs:decimal'], { numberQ: { digits: String(digits), fractionDigits: String(fractionDigits), allowedSign } });
  assert.equal(num(15, 2), 15);
  assert.equal(num(14, 2), 13);
  assert.equal(num(13, 2, 'Nonnegative'), 12);
  assert.equal(num(17, 3, 'Nonnegative'), 15);
  assert.equal(num(7, 2, 'Nonnegative'), 7);
  assert.equal(num(4, 3), 5);
  assert.equal(num(6, 4, 'Nonnegative'), 5);
  assert.equal(num(2, 0, 'Nonnegative'), 2);
  assert.equal(num(1, 0, 'Nonnegative'), 1);
  assert.equal(num(3, 0), 3);
  assert.equal(T.defaultCharsOf(['xs:boolean']), 10);
  assert.equal(T.defaultCharsOf(['v8:GeographicalSchema']), 20);
  assert.equal(T.tableColumnHeaderChars({
    properties: { DataPath: 'Объект.Сумма' },
  }, { captionIndex: { types: { 'Объект.Сумма': 'xs:decimal' },
    numberQ: { 'Объект.Сумма': { digits: '15', fractionDigits: '2' } } } }), 10);
  assert.equal(T.tableColumnHeaderChars({
    properties: { DataPath: 'Объект.Код' },
  }, { captionIndex: { types: { 'Объект.Код': 'xs:string' },
    stringLen: { 'Объект.Код': 50 } } }), 20);
  assert.equal(field.runtime.inputButtons.dropListButton, true);
  assert.equal(field.runtime.inputButtons.openButton, true);
  assert.equal(field.runtime.inputButtons.choiceButton, true);
  assert.equal(field.runtime.inputButtons.choiceButtonRepresentation, 'showInDropList');
  assert.deepEqual(JSON.parse(JSON.stringify(field.runtime.inputButtonKinds)),
    ['caret-down', 'open-1c']);
});

test('CatalogRef presentation length comes from catalog metadata in the dump tree', () => {
  const catalogXml = (name, extra) => `<?xml version="1.0" encoding="UTF-8"?>
<MetaDataObject xmlns="http://v8.1c.ru/8.3/MDClasses" xmlns:v8="http://v8.1c.ru/8.1/data/core">
  <Catalog><Properties><Name>${name}</Name>${extra}</Properties></Catalog>
</MetaDataObject>`;
  const formXml = (type) => `<Form xmlns="http://v8.1c.ru/8.3/xcf/logform" xmlns:v8="http://v8.1c.ru/8.1/data/core">
    <ChildItems><InputField name="Ссылка" id="1"><DataPath>Объект.Ссылка</DataPath></InputField></ChildItems>
    <Attributes><Attribute name="Объект"><MainAttribute>true</MainAttribute></Attribute>
      <Attribute name="Ссылка"><Type><v8:Type>${type}</v8:Type></Type></Attribute>
    </Attributes></Form>`;
  const chars = (xml, objectMeta, refMeta) => {
    const parsed = FP.parse(xml, objectMeta, {}, '', {}, {}, refMeta);
    assert.ok(!parsed.error, parsed.error);
    return parsed.model.childItemsRoot[0].runtime.defaultChars;
  };

  assert.equal(T.catalogPresentationLength(T.parseObjectMeta(
    catalogXml('Партнеры', '<DescriptionLength>10</DescriptionLength>'))), 10);
  assert.equal(T.catalogPresentationLength(T.parseObjectMeta(
    catalogXml('Партнеры', '<CodeType>Number</CodeType><CodeLength>4</CodeLength>'))), 4);
  assert.equal(T.catalogPresentationLength(T.parseObjectMeta(
    catalogXml('Партнеры', '<DescriptionLength>0</DescriptionLength>'))), 0);

  assert.equal(chars(formXml('cfg:CatalogRef.Партнеры'),
    catalogXml('Партнеры', '<DescriptionLength>10</DescriptionLength>')), 10,
    'owner catalog DescriptionLength is the presentation length');
  assert.equal(chars(formXml('cfg:CatalogRef.Партнеры'),
    catalogXml('Партнеры', '<DescriptionLength>25</DescriptionLength>')), 15,
    'presentation length is capped at the Taxi ref default of 15');
  assert.equal(chars(formXml('cfg:CatalogRef.Партнеры'),
    catalogXml('Партнеры', '<CodeType>Number</CodeType><CodeLength>4</CodeLength><DescriptionLength>25</DescriptionLength>')),
    4, 'non-string CodeType uses CodeLength');
  assert.equal(chars(formXml('cfg:CatalogRef.Items'),
    '<MetaDataObject xmlns="http://v8.1c.ru/8.3/MDClasses"><Document><Properties><Name>Order</Name></Properties></Document></MetaDataObject>',
    { Items: catalogXml('Items', '<DescriptionLength>10</DescriptionLength>') }),
    10, 'a foreign CatalogRef reads Catalogs/Name.xml from refMeta');
  assert.equal(chars(formXml('cfg:DocumentRef.Order')), 15,
    'DocumentRef without catalog metadata stays at 15');
});

test('a reference keeps its kind when the object it points at is named after a date or a number', () => {
  /* The type of a reference is spelled after the object it points at, so
   * `CatalogRef.PhoneNumber` and `CatalogRef.UpdateDate` used to come back as
   * a number and a date purely because of the catalog's name. */
  const ctx = { captionIndex: { types: {
    'Объект.Телефон': 'cfg:CatalogRef.PhoneNumber',
    'Объект.Обновление': 'cfg:CatalogRef.UpdateDate',
    'Объект.Документ': 'cfg:DocumentRef.IntegerOrder',
    'Объект.Срок': 'xs:dateTime',
    'Объект.Сумма': 'xs:decimal',
    'Объект.Текст': 'xs:string'
  } } };
  assert.equal(T.fieldKind({ properties: { DataPath: 'Объект.Телефон' } }, ctx), 'ref');
  assert.equal(T.fieldKind({ properties: { DataPath: 'Объект.Обновление' } }, ctx), 'ref');
  assert.equal(T.fieldKind({ properties: { DataPath: 'Объект.Документ' } }, ctx), 'ref');
  assert.equal(T.fieldKind({ properties: { DataPath: 'Объект.Срок' } }, ctx), 'date');
  assert.equal(T.fieldKind({ properties: { DataPath: 'Объект.Сумма' } }, ctx), 'number');
  assert.equal(T.fieldKind({ properties: { DataPath: 'Объект.Текст' } }, ctx), 'text');
});

test('view state is reset by the host opening a file, never by re-parsing one', () => {
  /* parse() runs again on every keystroke while a form is edited, so it is not
   * the place to clear folded groups and the selected tab. */
  assert.equal(typeof FP.resetViewState, 'function');
  assert.equal(FP.parse('<Form xmlns="http://v8.1c.ru/8.3/xcf/logform"/>').error, undefined);
  assert.equal(FP.resetViewState(), undefined);
});

test('calendar picture identifies a date field without guessing from its name', () => {
  const field = {
    tag: 'InputField',
    name: 'РасшифровкаБезРазбиенияДатаПогашения',
    properties: {
      ChoiceButton: 'true',
      ChoiceButtonPicture: 'StdPicture.InputFieldCalendar, true'
    }
  };
  assert.equal(T.hasCalendarChoicePicture(field), true);
  assert.equal(T.fieldKind(field), 'date');
  assert.equal(T.titleOf(field), 'Расшифровка без разбиения дата погашения');
});

test('date type resolves through indexed value paths and document standard attributes', () => {
  const indexed = {
    types: { 'Доверенность.Документ.Передов.СвПереДовер.СрокДейст': 'xs:dateTime' },
    mainNames: {},
  };
  assert.equal(T.metaType({ properties: {
    DataPath: 'Доверенность[0].Документ[0].Передов[0].СвПереДовер[0].СрокДейст',
  } }, { captionIndex: indexed }), 'xs:dateTime');

  const document = {
    types: { Объект: 'cfg:DocumentObject.ВводОстатковТоваров' },
    mainNames: { Объект: true },
  };
  assert.equal(T.metaType({ properties: { DataPath: 'Объект.Date' } },
    { captionIndex: document }), 'xs:dateTime');
  assert.equal(T.metaType({ properties: { DataPath: 'Объект.ДатаПоставки' } },
    { captionIndex: document }), '');
});

test('group title shows unless ShowTitle is false', () => {
  const hidden = {
    tag: 'UsualGroup',
    properties: { Title: 'Распоряжение', Representation: 'None', ShowTitle: 'false' }
  };
  assert.equal(T.showGroupTitle(hidden), false);
  const autoTitle = {
    tag: 'UsualGroup',
    properties: { Title: 'Контроль качества', Representation: 'None' }
  };
  assert.equal(T.showGroupTitle(autoTitle), true);
  const shown = {
    tag: 'UsualGroup',
    properties: { Title: 'Распоряжение', Representation: 'None', ShowTitle: 'true' }
  };
  assert.equal(T.showGroupTitle(shown), true);
});

test('PopUp group keeps title even without ShowTitle', () => {
  assert.equal(T.groupBehavior({ properties: { Behavior: 'PopUp' } }), 'popup');
  assert.equal(T.groupBehavior({ properties: { Поведение: 'Всплывающая' } }), 'popup');
  assert.equal(T.groupBehavior({ properties: { Behavior: 'Usual' } }), 'usual');
  const pop = {
    tag: 'UsualGroup',
    properties: { Title: 'Итого', Behavior: 'PopUp', Representation: 'None' }
  };
  assert.equal(T.isPopUpGroup(pop), true);
  assert.equal(T.showGroupTitle(pop), true);
  const parsed = FP.parse(`<?xml version="1.0" encoding="UTF-8"?>
<Form xmlns="http://v8.1c.ru/8.3/xcf/logform" xmlns:v8="http://v8.1c.ru/8.1/data/core">
  <ChildItems>
    <UsualGroup name="ГруппаМультивалютныеСуммы" id="1">
      <Title><v8:item><v8:lang>ru</v8:lang><v8:content>Итого</v8:content></v8:item></Title>
      <Behavior>PopUp</Behavior>
      <Representation>None</Representation>
      <ChildItems>
        <Table name="ТаблицаИтоговПоВалютам" id="2">
          <DataPath>ТаблицаИтоговПоВалютам</DataPath>
        </Table>
      </ChildItems>
    </UsualGroup>
  </ChildItems>
</Form>`);
  assert.ok(!parsed.error, parsed.error);
  const g = parsed.model.childItemsRoot[0];
  assert.equal(g.properties.Behavior, 'PopUp');
  assert.equal(T.groupBehavior(g), 'popup');
  assert.equal(T.showGroupTitle(g), true);
});

test('formatted 1C links keep visible text and mark only link fragments', () => {
  const src = 'См. также: <link Открыть>Список</> (2) <img 0:guid/>';
  const parts = Array.from(T.formattedTextParts(src), (part) => ({ text: part.text, link: part.link }));
  assert.deepEqual(parts, [
    { text: 'См. также: ', link: false },
    { text: 'Список', link: true },
    { text: ' (2) ', link: false }
  ]);
  assert.equal(T.plainFormattedText(src), 'См. также: Список (2) ');
  assert.equal(T.plainFormattedText('<link 2>Состав</><link 2> набора (1</><link 2>)</>'), 'Состав набора (1)');
  assert.equal(T.plainFormattedText('<link 2>С</><bgcolorstyle -1><link 2>егменты</></>'), 'Сегменты');
  assert.deepEqual(
    Array.from(T.formattedTextParts('<link < Очистить><b><< Очистить >></></>'), (part) => ({ text: part.text, link: part.link })),
    [{ text: '< Очистить >', link: true }]
  );
  assert.equal(T.plainFormattedText('Отбор: <<не установлен>>'), 'Отбор: <не установлен>');
});

test('formatted text keeps underline and colour; a style colour paints magenta as in the reference', () => {
  const parts = Array.from(T.formattedTextParts(
    '• Документ <u><colorstyle 0:757b547b-b79c-459a-a64a-eef19a09a38f>Кадровый перевод</></> и <color #00ff00>текст</>'));
  assert.deepEqual(parts.map((part) => [part.text, !!part.underline, part.color || '']), [
    ['• Документ ', false, ''],
    ['Кадровый перевод', true, '#ff00ff'],
    [' и ', false, ''],
    ['текст', false, '#00ff00']
  ]);
});

test('outline strips formatted-link markup from element titles', () => {
  const xml = `<Form xmlns="http://v8.1c.ru/8.3/xcf/logform" xmlns:v8="http://v8.1c.ru/8.1/data/core">
    <ChildItems><LabelDecoration name="Link" id="9"><Title formatted="true">
      <v8:item><v8:lang>ru</v8:lang><v8:content>&lt;link 1&gt;Список (2)&lt;/&gt;</v8:content></v8:item>
    </Title></LabelDecoration></ChildItems></Form>`;
  const parsed = FP.parse(xml);
  assert.ok(!parsed.error, parsed.error);
  const item = FP.outline(parsed.model, xml).find((entry) => entry.id === '9');
  assert.equal(item.title, 'Список (2)');
  assert.equal(item.title.includes('<link'), false);
});

test('configurator preview opens collapsible groups and spreadsheet fields stretch', () => {
  const expanded = { properties: { Behavior: 'Collapsible' } };
  const collapsed = { properties: { Behavior: 'Collapsible', Collapsed: 'true' } };
  assert.equal(T.groupBehavior(expanded), 'collapsible');
  assert.equal(T.initiallyCollapsed(expanded), false);
  assert.equal(T.initiallyCollapsed(collapsed), false);
  assert.equal(T.wantsHStretch({ properties: {} }, 'SpreadSheetDocumentField', null), true);
  assert.equal(T.wantsVStretch({ properties: {} }, 'SpreadSheetDocumentField'), true);
});

test('form preview CSS has no scroll container on ordinary horizontal groups', () => {
  const css = fs.readFileSync(path.join(root, 'web', 'viewer.css'), 'utf8');
  const rule = css.match(/\.fp-children\.fp-children-horizontal\s*\{([^}]*)\}/);
  assert.ok(rule, 'horizontal group rule');
  assert.match(rule[1], /overflow-x:\s*visible/);
  assert.doesNotMatch(rule[1], /overflow-x:\s*auto/);
  assert.match(css, /\.fp-body\.fp-mockup\s*\{[^}]*overflow:\s*auto/s);
  assert.match(css, /\.fp-pages-active-panel\s*\{[^}]*overflow-x:\s*hidden[^}]*overflow-y:\s*auto/s);
  assert.match(css, /\.fp-pages-active-panel\.fp-window-overflow\s*\{[^}]*overflow-x:\s*auto/s);
  assert.match(css, /\.fp-pages-active-panel:not\(\.fp-window-overflow\)::-[^{]*scrollbar:horizontal\s*\{[^}]*height:\s*0/s);
  assert.match(css, /\.fp-button\.fp-button-shape-none[^}]*\{[^}]*border:\s*0[^}]*background:\s*transparent/s);
  assert.match(css, /\.fp-item\.fp-container-vertical\.fp-empty-decoration-row\s*\{[^}]*height:\s*22px\s*!important/s);
  assert.match(css, /\.fp-item\.fp-container-horizontal\.fp-compact-decoration-value-row\s*\{[^}]*height:\s*22px\s*!important/s);
  assert.match(css, /\.fp-body\.fp-window-overflow[^}]*\{[^}]*min-width:\s*var\(--fp-content-width\)/s);
  assert.match(css, /\.fp-pages-active-panel\.fp-window-overflow[^}]*\{[^}]*min-width:\s*var\(--fp-content-width\)/s);
  assert.match(css, /\.fp-body\.fp-vertical-scroll-without-stretch[^}]*\{[^}]*flex:\s*0 0 auto/s);
  assert.match(css, /--fp-input-border:\s*#a0a0a0/);
  assert.match(css, /--fp-field-trailing-inset:\s*1px/);
  assert.match(css, /\.fp-children-horizontal \.fp-children\.fp-children-vertical\[data-fp-vertical-spacing-mode=""\]\s*\{[^}]*row-gap:\s*5px/s);
  assert.match(css, /\.fp-pages-active-panel\.fp-children-vertical\s*>\s*\.fp-item\.fp-container[\s\S]*row-gap:\s*5px/s,
    'page-direct titled stacks keep the 34px editor cadence');
  assert.match(css, /\.fp-color-surface \.fp-children\.fp-children-vertical\[data-fp-vertical-spacing-mode=""\]:not\(:has\(> \.fp-item:not\(\.fp-native-label-decoration\)\)\)\s*\{[^}]*gap:\s*0/s,
    'notification StaticText stacks do not inherit the nested 5px field cadence');
  assert.match(css, /\.fp-children\.fp-ciwidth-leftwidest\.fp-children-horizontal > \.fp-item\.fp-hstretch:first-child\s*\{[^}]*flex:\s*2 1 260px/s,
    'LeftWide surplus does not grow a Width+no-stretch leading column');
  assert.match(css, /\.fp-item\.fp-hstretch\[data-tag="InputField"\]:has\(\+ \.fp-item\[data-tag="Button"\]\)/);
  assert.match(css, /\.fp-pages-tab\s*\{[^}]*height:\s*27px/s);
  assert.match(css, /\.fp-pages-tab\[aria-selected='true'\]\s*\{[^}]*border-bottom:\s*none/s);
  assert.match(css, /\.fp-children-vertical > \.fp-item\.fp-control\[data-tag="InputField"\]:not\(\.fp-ordinary-row-control\)\s*\{[^}]*padding-top:\s*0/s);
  assert.match(css, /\.fp-children-horizontal\.fp-container-bare\s*>\s*\.fp-item\.fp-control\[data-tag="CheckBoxField"\]\s*\{[^}]*padding-top:\s*0/s);
  assert.match(css, /\.fp-body\.fp-vertical-scroll-needed\s*\{[^}]*overflow-y:\s*scroll[^}]*scrollbar-gutter:\s*stable/s);
  assert.match(css, /\.fp-body\.fp-mockup \.fp-collapse-arrow\s*\{[^}]*display:\s*none/s,
    'designer mockup must not paint the runtime collapse disclosure glyph');
  assert.match(css, /\.fp-item\.fp-pages-none:not\(\.fp-vstretch\):not\(\[data-fp-authored-width-present="1"\]\)[^}]*\{[^}]*flex:\s*0 0 auto/s);
  assert.doesNotMatch(css, /\.fp-item\.fp-pages-none\s*\{[^}]*flex:\s*0 0 auto/s);
  assert.match(css, /\.fp-item\.fp-pages-none\s*\{[^}]*padding-bottom:\s*0/s);
  assert.match(css, /\.fp-spreadsheet-viewport\s*\{[^}]*overflow:\s*auto/s);
  assert.match(css, /\.fp-collapsible-group\.fp-collapsed\s*>\s*\.fp-collapsible-body/);
  assert.match(css, /fp-native-label-decoration:has\(\+ \.fp-item\[data-tag="Table"\]\.fp-vstretch\)/);
  assert.match(css, /\.fp-item\.fp-bare\.fp-color-surface[^}]*\{[^}]*padding:\s*3px 5px/s);
  assert.match(css, /\.fp-item\.fp-bare\.fp-color-surface\.fp-color-surface-picture[^}]*padding-top:\s*5px/s);
  assert.match(css, /\.fp-body\.fp-window-overflow\s+\.fp-children-horizontal\s*>\s*\.fp-item\.fp-native-label-decoration \.fp-label-decoration\s*\{[^}]*white-space:\s*pre/s);
  assert.match(css, /\.fp-children-horizontal\.fp-section-nav\s*>\s*\.fp-item\.fp-pages-none \.fp-label-decoration[\s\S]*width:\s*min-content/s);
  assert.match(css, /\.fp-children-horizontal\.fp-section-nav\s*>\s*\.fp-item\.fp-pages-none \.fp-label-decoration[\s\S]*padding-left:\s*13px/s);
  assert.match(css, /\.fp-children-horizontal\.fp-section-nav[\s\S]*overflow-x:\s*clip/s);
  assert.match(css, /\.fp-body\.fp-window-overflow \.fp-section-nav \.fp-item\.fp-pages-none[\s\S]*white-space:\s*normal/s);
  assert.match(css, /\.fp-body\s*>\s*\.fp-item\.fp-root-band-overflow\s*\{[^}]*overflow:\s*visible/s);
  assert.match(css, /fp-children-horizontal:has\(> \.fp-item\[data-tag="InputField"\]\)[\s\S]*> \.fp-item\[data-tag="CommandBar"\]:not\(\.fp-bar-item\)\s*\{[^}]*border-top-width:\s*0/s);
  assert.match(css, /> \.fp-control-wrap > \.fp-commandbar\s*\{\s*margin-bottom:\s*0/s);
  const nativeDecorationRule = css.match(/\.fp-item\.fp-native-label-decoration\s*\{([^}]*)\}/);
  assert.ok(nativeDecorationRule, 'native LabelDecoration item rule');
  assert.match(nativeDecorationRule[1], /padding-top:\s*0/);
  assert.match(nativeDecorationRule[1], /padding-bottom:\s*0/);
  assert.match(nativeDecorationRule[1], /border-top-width:\s*0/);
  assert.match(nativeDecorationRule[1], /border-bottom-width:\s*0/);
  assert.match(css, /\.fp-item\.fp-native-label-decoration\s*>\s*\.fp-control-wrap\s*\{[^}]*min-height:\s*0/);
  const designerPopup = css.match(/\.fp-body\.fp-mockup \.fp-popup-group\.fp-popup-designer-inline > \.fp-popup-group-body\s*\{([^}]*)\}/);
  assert.ok(designerPopup, 'designer PopUp group body rule');
  assert.match(designerPopup[1], /display:\s*flex/);
  assert.match(designerPopup[1], /position:\s*static\s*!important/);
  assert.match(designerPopup[1], /border:\s*0/);
  assert.match(designerPopup[1], /box-shadow:\s*none/);
  assert.match(designerPopup[1], /padding:\s*0/);
  assert.match(designerPopup[1], /overflow:\s*visible/);
  assert.doesNotMatch(designerPopup[0], /\.fp-popup-menu/);
});

/* Generated forms build a field row as LabelDecoration + TitleLocation=None
 * control inside a United=false wrapper. United=false resolves the wrapper to
 * ThroughAlign=dontuse, which used to drop the row's caption before
 * firstFieldLabel ever saw it, so every row started at its own caption width
 * (editors at x=52..225 against the reference's single x=310 lane). */
function captionLedRow({ title = 'Номер:', titleLocation = 'fp-title-none', valueTag = 'InputField',
  horizontal = true } = {}) {
  const deco = {
    classList: { contains: () => false },
    dataset: { tag: 'LabelDecoration' },
    querySelector: (sel) => sel === '.fp-label' ? { textContent: title } : null,
  };
  const value = {
    classList: { contains: (name) => name === 'fp-control' },
    dataset: { tag: valueTag },
    querySelector: (sel) => sel === '.fp-field-row'
      ? { classList: { contains: (name) => name === titleLocation } } : null,
  };
  const inner = {
    classList: { contains: (name) => name === (horizontal ? 'fp-children-horizontal' : 'fp-children-vertical') },
    children: [deco, value],
  };
  return { inner, deco };
}

test('a caption-led United=false row still joins the surrounding label lane', () => {
  const { inner, deco } = captionLedRow();
  const item = {
    tag: 'UsualGroup',
    properties: { Group: 'AlwaysHorizontal', Representation: 'None', United: 'false' },
    childItems: [
      { tag: 'LabelDecoration', properties: { Title: 'Номер:' } },
      { tag: 'InputField', properties: { TitleLocation: 'None' } },
    ],
  };
  assert.equal(T.captionLedHorizontalRow(inner, item), true);
  /* The caption it contributes is the decoration's own label node. */
  assert.equal(deco.querySelector('.fp-label').textContent, 'Номер:');
});

test('an empty leading decoration stays a local indentation track', () => {
  const { inner } = captionLedRow({ title: '' });
  const item = {
    tag: 'UsualGroup',
    properties: { Group: 'AlwaysHorizontal', United: 'false' },
    childItems: [
      { tag: 'LabelDecoration', properties: {} },
      { tag: 'InputField', properties: { TitleLocation: 'None' } },
    ],
  };
  assert.equal(T.captionLedHorizontalRow(inner, item), false);
});

test('a caption-led row is only recognised in a horizontal wrapper', () => {
  const { inner } = captionLedRow({ horizontal: false });
  const item = {
    tag: 'UsualGroup',
    properties: { Group: 'Vertical', United: 'false' },
    childItems: [
      { tag: 'LabelDecoration', properties: { Title: 'Номер:' } },
      { tag: 'InputField', properties: { TitleLocation: 'None' } },
    ],
  };
  assert.equal(T.captionLedHorizontalRow(inner, item), false);
});

test('applyLabelWidth equalizes titles in one vertical group', () => {
  const labs = [
    { offsetWidth: 48, textContent: 'Автор:', style: {} },
    { offsetWidth: 136, textContent: 'Главный бухгалтер:', style: {} },
    { offsetWidth: 80, textContent: 'Руководитель:', style: {} }
  ];
  T.applyLabelWidth(labs);
  assert.equal(labs[0].style.minWidth, '136px');
  assert.equal(labs[1].style.minWidth, '136px');
  assert.equal(labs[2].style.minWidth, '136px');
});

test('applyLabelWidth pins a vertical-in-horizontal caption column', () => {
  const column = {};
  const owner = {
    classList: { contains: (name) => name === 'fp-container' },
    parentNode: {
      classList: { contains: (name) => name === 'fp-children-horizontal' },
      children: []
    }
  };
  column.closest = (sel) => sel === '.fp-item.fp-container' ? owner : null;
  const fieldItem = {
    classList: { contains: () => false },
    dataset: { fieldKind: 'text' },
    parentElement: {}
  };
  const makeLab = (text) => ({
    textContent: text,
    offsetWidth: text === 'Отчество:' ? 57 : 32,
    style: {},
    classList: { contains: () => false },
    closest: (sel) => {
      if (sel === '.fp-children-vertical') return column;
      if (sel === '.fp-item.fp-control') return fieldItem;
      if (sel === '.fp-field-row') {
        return {
          querySelector: () => ({ getBoundingClientRect: () => ({ width: 296 }) }),
          closest: () => fieldItem
        };
      }
      if (sel === '.fp-children-horizontal') return owner.parentNode;
      return null;
    }
  });
  const labs = [makeLab('Фамилия:'), makeLab('Имя:'), makeLab('Отчество:')];
  T.applyLabelWidth(labs);
  const track = labs[2].style.minWidth;
  assert.ok(parseInt(track, 10) >= 40, track);
  assert.equal(labs[0].style.minWidth, track);
  assert.equal(labs[1].style.minWidth, track);
  assert.equal(labs[0].style.flex, `0 0 ${track}`);
  assert.equal(labs[1].style.flex, `0 0 ${track}`);
  assert.equal(labs[0].style.width, undefined);
});

test('numeric result columns keep the 100px compressed title lane', () => {
  const column = {};
  const owner = {
    classList: { contains: (name) => name === 'fp-container' },
    parentNode: {
      classList: { contains: (name) => name === 'fp-children-horizontal' },
      children: []
    }
  };
  column.closest = (sel) => sel === '.fp-item.fp-container' ? owner : null;
  const fieldItem = {
    classList: { contains: () => false },
    dataset: { fieldKind: 'number' },
    parentElement: {}
  };
  const makeLab = (text, width) => ({
    textContent: text,
    offsetWidth: width,
    style: {},
    classList: { contains: () => false },
    closest: (sel) => {
      if (sel === '.fp-children-vertical') return column;
      if (sel === '.fp-item.fp-control') return fieldItem;
      if (sel === '.fp-field-row') {
        return {
          querySelector: () => ({ getBoundingClientRect: () => ({ width: 110 }) }),
          closest: () => fieldItem
        };
      }
      if (sel === '.fp-children-horizontal') return owner.parentNode;
      return null;
    }
  });
  const labs = [
    makeLab('Исчислено:', 72),
    makeLab('Зачтено ав. платежей:', 140),
    makeLab('Не удержано:', 88)
  ];
  T.applyLabelWidth(labs);
  assert.equal(labs[0].style.minWidth, '100px');
  assert.equal(labs[1].style.minWidth, '100px');
  assert.equal(labs[2].style.minWidth, '100px');
  assert.equal(labs[1].style.width, '100px');
  assert.equal(labs[1].style.whiteSpace, 'normal');
  assert.ok(!String(labs[1].style.flex || '').startsWith('0 0'), labs[1].style.flex);
});

test('a long caption in a horizontal-child column is not fixed at 152px', () => {
  const column = {};
  const owner = {
    classList: { contains: (name) => name === 'fp-container' },
    parentNode: {
      classList: { contains: (name) => name === 'fp-children-horizontal' },
      children: []
    }
  };
  column.closest = (sel) => sel === '.fp-item.fp-container' ? owner : null;
  const fieldItem = {
    classList: { contains: () => false },
    dataset: { fieldKind: 'text' },
    parentElement: {}
  };
  const makeLab = (text, width) => ({
    textContent: text,
    offsetWidth: width,
    style: {},
    classList: { contains: () => false },
    closest: (sel) => {
      if (sel === '.fp-children-vertical') return column;
      if (sel === '.fp-item.fp-control') return fieldItem;
      if (sel === '.fp-field-row') {
        return {
          querySelector: () => ({ getBoundingClientRect: () => ({ width: 280 }) }),
          closest: () => fieldItem
        };
      }
      if (sel === '.fp-children-horizontal') return owner.parentNode;
      return null;
    }
  });
  const labs = [
    makeLab('Тип номенклатуры:', 110),
    makeLab('Группа видов номенклатуры:', 170)
  ];
  T.applyLabelWidth(labs);
  assert.ok(!String(labs[0].style.flex || '').startsWith('0 0'), labs[0].style.flex);
  assert.ok(!String(labs[1].style.flex || '').startsWith('0 0'), labs[1].style.flex);
  assert.ok(!labs[0].style.width, labs[0].style.width);
  assert.ok(!labs[1].style.width, labs[1].style.width);
});

test('projected owner ThroughAlign still collects from a collapsible Auto group', () => {
  const nameLabel = { textContent: 'Наименование:' };
  const ownerScope = {
    dataset: { fpThroughAlign: 'dontuse', fpThroughAlignMode: 'auto' },
    children: [{
      classList: { contains: (name) => name === 'fp-control' },
      querySelector: (sel) => sel === '.fp-field-row' ? {
        classList: { contains: () => false },
        querySelector: (inner) => inner === '.fp-field-label' ? nameLabel : null
      } : null
    }]
  };
  const box = {
    parentElement: {
      closest: (sel) => sel === '.fp-children-vertical' ? ownerScope : null
    }
  };
  const autoLabels = T.projectedOwnerThroughAlignLabels(box);
  assert.equal(autoLabels.length, 1);
  assert.equal(String(autoLabels[0].textContent), 'Наименование:');
  ownerScope.dataset.fpThroughAlignMode = 'dontuse';
  assert.equal(T.projectedOwnerThroughAlignLabels(box).length, 0);
});

test('a lone wrapped caption keeps the longest-line ThroughAlign track', () => {
  const lab = { offsetWidth: 84, textContent: 'Сокр. юр.\nнаименование:', style: {} };
  T.applyLabelWidth([lab]);
  const width = parseInt(lab.style.minWidth, 10);
  assert.ok(width > 84 && width <= 160, lab.style.minWidth);
});

test('fitWrappedSideCaptions publishes a wrapped-caption track after strategy', () => {
  const label = {
    textContent: 'Сокр. юр.\nнаименование:',
    style: {},
    offsetWidth: 84,
    scrollWidth: 84
  };
  const row = { classList: { contains: (name) => name === 'fp-title-left' } };
  label.closest = (sel) => sel === '.fp-field-row' ? row : null;
  const root = { querySelectorAll: (sel) => sel.includes('fp-field-label') ? [label] : [] };
  assert.equal(T.fitWrappedSideCaptions(root), 1);
  const width = parseInt(label.style.minWidth, 10);
  assert.ok(width > 84 && width <= 160, label.style.minWidth);
});

test('ordinary wide desktop label columns keep the 280px content cap', () => {
  const labs = [
    { offsetWidth: 340, textContent: 'A very long generated title', style: {} },
    { offsetWidth: 80, textContent: 'Short:', style: {} }
  ];
  T.applyLabelWidth(labs);
  assert.equal(labs[0].style.minWidth, '280px');
  assert.equal(labs[1].style.minWidth, '280px');
});

test('external LabelDecoration title columns include the native 8px band', () => {
  const decoration = (width) => ({
    offsetWidth: width,
    textContent: 'External title',
    style: {},
    classList: { contains: (name) => name === 'fp-label-decoration' }
  });
  const labs = [decoration(120), decoration(80)];
  T.applyLabelWidth(labs);
  assert.equal(labs[0].style.minWidth, '128px');
  assert.equal(labs[1].style.minWidth, '128px');
});

test('authored caption newline measures the longest line, not their concatenation', () => {
  const twoLines = { offsetWidth: 0, scrollWidth: 0,
    textContent: 'Распределять затраты\nна изделия' };
  const oneLine = { offsetWidth: 0, scrollWidth: 0,
    textContent: 'Распределять затраты' };
  assert.equal(T.labelMetric(twoLines), T.labelMetric(oneLine));
});

test('wrapped caption ignores an unwrapped offsetWidth from a previous minWidth pass', () => {
  const wrapped = { offsetWidth: 180, scrollWidth: 180,
    textContent: 'Публичное\nнаименование:' };
  const longest = { offsetWidth: 0, scrollWidth: 0,
    textContent: 'наименование:' };
  assert.equal(T.labelMetric(wrapped), T.labelMetric(longest));
});

test('wrapped side captions use the 5px title gap, not pagePadding 10', () => {
  const label = { textContent: 'наименование:', offsetWidth: 0 };
  const track = T.wrappedSideCaptionTrackWidth(label);
  assert.equal(track, Math.round(T.labelMetric(label) + T.taxiLayoutMetrics.sideTitleGap));
  assert.equal(track, T.throughAlignTitleTrackWidth([T.labelMetric(label)])
    - (T.taxiLayoutMetrics.throughAlignTitleChrome - T.taxiLayoutMetrics.sideTitleGap));
});

test('Публичное and E-mail share the longest-line track of a lone Сокр caption', () => {
  const label = (text, width) => ({
    offsetWidth: width,
    textContent: text,
    style: {},
    classList: { contains: () => false },
    closest: () => null,
    dataset: {}
  });
  const pub = label('Публичное\nнаименование:', 180);
  const mail = label('E-mail:', 48);
  T.applyLabelWidth([pub, mail]);
  const abbr = label('Сокр. юр.\nнаименование:', 84);
  T.applyLabelWidth([abbr]);
  assert.equal(pub.style.minWidth, abbr.style.minWidth);
  assert.equal(mail.style.minWidth, abbr.style.minWidth);
  const track = parseInt(pub.style.minWidth, 10);
  assert.ok(track >= 40 && track <= 120, pub.style.minWidth);
});

test('object meta path works for config objects and external reports', () => {
  const cat = T.objectMetaCandidates(
    'E:\\cf\\Catalogs\\Partners\\Forms\\ItemForm\\Ext\\Form.xml'
  );
  assert.equal(cat[0], 'E:\\cf\\Catalogs\\Partners.xml');
  assert.equal(cat[1], 'E:\\cf\\Catalogs\\Partners\\Partners.xml');
  const ext = T.objectMetaCandidates(
    'C:/src/CostReport2025/Forms/ReportForm/Ext/Form.xml'
  );
  assert.equal(ext[0], 'C:\\src\\CostReport2025.xml');
  assert.equal(ext[1], 'C:\\src\\CostReport2025\\CostReport2025.xml');
  assert.equal(T.objectMetaCandidates('Form.xml').length, 0);
  assert.equal(T.objectMetaCandidates('E:\\cf\\Catalogs\\Partners.xml').length, 0);
});

test('form attribute titles fill in missing field titles', () => {
  const parsed = FP.parse(`<?xml version="1.0" encoding="UTF-8"?>
<Form xmlns="http://v8.1c.ru/8.3/xcf/logform" xmlns:v8="http://v8.1c.ru/8.1/data/core">
  <ChildItems>
    <InputField name="Номенклатура" id="1">
      <DataPath>Номенклатура</DataPath>
      <TitleLocation>Left</TitleLocation>
    </InputField>
    <InputField name="Количество" id="2">
      <DataPath>ДеревоРасчета.Количество</DataPath>
    </InputField>
  </ChildItems>
  <Attributes>
    <Attribute name="Отчет" id="1">
      <Type><v8:Type>cfg:ExternalReportObject.Cost</v8:Type></Type>
      <MainAttribute>true</MainAttribute>
    </Attribute>
    <Attribute name="Номенклатура" id="2">
      <Title><v8:item><v8:lang>ru</v8:lang><v8:content>Номенклатура</v8:content></v8:item></Title>
    </Attribute>
    <Attribute name="ДеревоРасчета" id="3">
      <Columns>
        <Column name="Количество" id="1">
          <Title><v8:item><v8:lang>ru</v8:lang><v8:content>Количество факт</v8:content></v8:item></Title>
          <Type>
            <v8:Type>xs:string</v8:Type>
            <v8:StringQualifiers><v8:Length>12</v8:Length></v8:StringQualifiers>
          </Type>
        </Column>
      </Columns>
    </Attribute>
  </Attributes>
</Form>`);
  assert.ok(!parsed.error, parsed.error);
  const idx = T.buildCaptionIndex(parsed.model);
  assert.equal(T.captionForPath('Номенклатура', idx), 'Номенклатура');
  assert.equal(T.captionForPath('ДеревоРасчета.Количество', idx), 'Количество факт');
  const field = parsed.model.childItemsRoot[0];
  const col = parsed.model.childItemsRoot[1];
  const ctx = { captionIndex: idx };
  assert.equal(T.titleOf(field, ctx), 'Номенклатура');
  assert.equal(T.titleOf(col, ctx), 'Количество факт');
  assert.equal(T.defaultFieldChars(col, ctx), 12);
});

test('object metadata synonyms beat humanized DataPath, form Title still wins', () => {
  const objectMeta = `<?xml version="1.0" encoding="UTF-8"?>
<MetaDataObject xmlns="http://v8.1c.ru/8.3/MDClasses" xmlns:v8="http://v8.1c.ru/8.1/data/core">
  <Catalog>
    <Properties>
      <Name>Контрагенты</Name>
      <Synonym><v8:item><v8:lang>ru</v8:lang><v8:content>Контрагенты</v8:content></v8:item></Synonym>
      <DescriptionLength>100</DescriptionLength>
    </Properties>
    <ChildObjects>
      <Attribute>
        <Properties>
          <Name>НаименованиеПолное</Name>
          <Synonym><v8:item><v8:lang>ru</v8:lang><v8:content>Сокращенное юр. наименование</v8:content></v8:item></Synonym>
          <Type>
            <v8:Type>xs:string</v8:Type>
            <v8:StringQualifiers><v8:Length>250</v8:Length></v8:StringQualifiers>
          </Type>
        </Properties>
      </Attribute>
      <Attribute>
        <Properties>
          <Name>ИНН</Name>
          <Synonym><v8:item><v8:lang>ru</v8:lang><v8:content>ИНН</v8:content></v8:item></Synonym>
        </Properties>
      </Attribute>
    </ChildObjects>
  </Catalog>
</MetaDataObject>`;
  const parsed = FP.parse(`<?xml version="1.0" encoding="UTF-8"?>
<Form xmlns="http://v8.1c.ru/8.3/xcf/logform" xmlns:v8="http://v8.1c.ru/8.1/data/core">
  <ChildItems>
    <InputField name="НаименованиеПолное" id="1">
      <DataPath>Объект.НаименованиеПолное</DataPath>
    </InputField>
    <InputField name="ИНН" id="2">
      <DataPath>Объект.ИНН</DataPath>
      <Title><v8:item><v8:lang>ru</v8:lang><v8:content>ИНН юрлица</v8:content></v8:item></Title>
    </InputField>
  </ChildItems>
  <Attributes>
    <Attribute name="Объект" id="1">
      <Type><v8:Type>cfg:CatalogObject.Контрагенты</v8:Type></Type>
      <MainAttribute>true</MainAttribute>
    </Attribute>
  </Attributes>
</Form>`, objectMeta);
  assert.ok(!parsed.error, parsed.error);
  assert.equal(parsed.model.objectMeta.captions['НаименованиеПолное'], 'Сокращенное юр. наименование');
  const ctx = { captionIndex: T.buildCaptionIndex(parsed.model) };
  assert.equal(T.titleOf(parsed.model.childItemsRoot[0], ctx), 'Сокращенное юр. наименование');
  assert.equal(T.titleOf(parsed.model.childItemsRoot[1], ctx), 'ИНН юрлица');
  assert.equal(T.titleOf(parsed.model.childItemsRoot[0], null), 'Наименование полное');
  assert.equal(T.defaultFieldChars(parsed.model.childItemsRoot[0], ctx), 40);
});

test('missing object metadata does not break form captions', () => {
  const parsed = FP.parse(fixture);
  assert.ok(!parsed.error, parsed.error);
  assert.equal(parsed.model.objectMeta, null);
  assert.equal(T.titleOf({ properties: { DataPath: 'Объект.ХозяйственнаяОперация' } }), 'Хозяйственная операция');
});

test('standard WriteAndClose is a default text button, not an icon', () => {
  const writeClose = {
    tag: 'Button',
    properties: {
      Type: 'CommandBarButton',
      DefaultButton: 'true',
      CommandName: 'Form.StandardCommand.WriteAndClose'
    }
  };
  const write = {
    tag: 'Button',
    properties: {
      Type: 'CommandBarButton',
      CommandName: 'Form.StandardCommand.Write'
    }
  };
  const pictured = {
    tag: 'Button',
    properties: { CommandName: 'Form.Command.X', Picture: 'StdPicture.Find' }
  };
  assert.equal(T.resolveButtonRep(writeClose), 'text');
  assert.equal(T.titleOf(writeClose), 'Записать и закрыть');
  assert.equal(T.resolveButtonRep(write), 'text');
  assert.equal(T.titleOf(write), 'Записать');
  assert.equal(T.resolveButtonRep(pictured), 'picture');
  assert.equal(T.resolveButtonRep({
    properties: { Representation: 'Picture', CommandName: 'Form.StandardCommand.Write' }
  }), 'picture');
});

test('platform pictures map to Tabler icon ids', () => {
  assert.equal(T.iconIdFromRef('StdPicture.Write'), 'save');
  assert.equal(T.iconIdFromRef('StdPicture.Post'), 'file-check');
  assert.equal(T.iconIdFromRef('StdPicture.DataHistory'), 'data-history');
  assert.equal(T.iconIdFromRef('StdPicture.History'), 'history');
  assert.equal(T.iconIdFromRef('StdPicture.Copy'), 'file-plus');
  assert.equal(T.iconIdFromRef('StdPicture.Print'), 'printer');
  assert.equal(T.iconIdFromRef('StdPicture.MoveUp'), 'arrow-up');
  assert.equal(T.iconIdFromRef('CommonPicture.ДлительнаяОперация24БЗК'), 'loader');
  assert.equal(T.iconIdFromRef('0:ef2701cf-e784-40f9-a8df-c67e4b76ac19'), '');
  assert.equal(T.iconIdFor({
    name: 'ОтобратьОтчетностьФНС',
    properties: {
      Title: 'Отобрать',
      Picture: '0:27c02a50-6aac-4621-9f72-9f5b70db8653',
      Representation: 'Picture'
    }
  }), 'filter');
  assert.equal(T.iconIdFor({
    name: 'Печать',
    properties: {
      Title: 'Печать',
      Picture: '0:4b0afd88-201c-4108-a6f9-0a8a238a1632',
      Representation: 'Picture'
    }
  }), 'printer');
  assert.equal(T.iconIdFor({
    properties: { CommandName: 'Form.StandardCommand.Write', Representation: 'Picture' }
  }), 'save');
  assert.equal(T.iconIdFor({
    properties: { CommandName: 'Form.StandardCommand.Post', Picture: 'StdPicture.Post' }
  }), 'file-check');
  assert.equal(T.iconIdFor({
    properties: { CommandName: 'Form.StandardCommand.Help' }
  }), 'help');
  assert.equal(T.iconFor('InputField').icon, 'forms');
  assert.equal(T.iconFor('Button').icon, 'click');
  assert.equal(T.iconFor('Table').icon, 'table');
});

test('unresolved picture decorations remain paintless instead of showing a fake photo glyph', () => {
  assert.equal(T.pictureDecorationIconId('CommonPicture.UnknownMetric'), '');
  assert.equal(T.pictureDecorationIconId('StdPicture.History'), 'history');
});

test('unlimited strings stay single-line unless text-area properties request otherwise', () => {
  const comment = {
    tag: 'InputField',
    properties: {
      DataPath: 'Объект.Комментарий',
      TitleLocation: 'None',
      AutoMaxWidth: 'false',
      Wrap: 'false'
    }
  };
  const objectMeta = T.parseObjectMeta(`<?xml version="1.0" encoding="UTF-8"?>
<MetaDataObject xmlns="http://v8.1c.ru/8.3/MDClasses" xmlns:v8="http://v8.1c.ru/8.1/data/core">
  <Catalog>
    <ChildObjects>
      <Attribute>
        <Properties>
          <Name>Комментарий</Name>
          <Type>
            <v8:Type>xs:string</v8:Type>
            <v8:StringQualifiers>
              <v8:Length>0</v8:Length>
              <v8:AllowedLength>Variable</v8:AllowedLength>
            </v8:StringQualifiers>
          </Type>
        </Properties>
      </Attribute>
    </ChildObjects>
  </Catalog>
</MetaDataObject>`);
  const ctx = {
    captionIndex: T.buildCaptionIndex({
      attributes: [{ name: 'Объект', properties: { MainAttribute: 'true' } }],
      objectMeta
    })
  };
  assert.equal(T.isUnlimitedString(comment, ctx), true);
  assert.equal(T.isMultilineField(comment, ctx), true);
  assert.equal(T.wantsHStretch(comment, 'InputField', null, ctx), true);
  assert.equal(T.wantsVStretch(comment, 'InputField', ctx), true);
  const ordinaryReference = {
    tag: 'InputField',
    properties: { DataPath: 'Объект.Партнер', TitleLocation: 'Left', Wrap: 'false' }
  };
  assert.equal(T.isMultilineField(ordinaryReference, ctx), false,
    'Wrap=false on an ordinary field does not turn it into a text area');
  assert.equal(T.wantsHStretch(ordinaryReference, 'InputField', null, ctx), false);
  assert.equal(T.wantsVStretch(ordinaryReference, 'InputField', ctx), false);
  const compact = {
    tag: 'InputField',
    properties: { DataPath: 'Объект.Комментарий', TitleLocation: 'Left', VerticalStretch: 'false' }
  };
  assert.equal(T.wantsVStretch(compact, 'InputField', ctx), false);
  const ordinaryUnlimited = {
    tag: 'InputField',
    properties: { DataPath: 'Объект.НомерЗаказа', TitleLocation: 'None' }
  };
  assert.equal(T.isMultilineField(ordinaryUnlimited, {
    captionIndex: { stringLen: { 'номерзаказа': 0 }, mainNames: { 'объект': true } }
  }), false, 'an unlimited string is not multiline without the MultiLine property');
  const listChoice = {
    tag: 'InputField',
    properties: {
      DataPath: 'ОформлениеПоступления',
      TitleLocation: 'Left',
      ListChoiceMode: 'true',
      AutoMaxWidth: 'false',
      MaxWidth: '30'
    }
  };
  const listCtx = {
    captionIndex: T.buildCaptionIndex({
      attributes: [{
        name: 'ОформлениеПоступления',
        properties: {},
        stringLen: -1
      }]
    })
  };
  assert.equal(T.isUnlimitedString(listChoice, listCtx), true);
  assert.equal(T.isMultilineField(listChoice, listCtx), false);
  assert.equal(T.wantsVStretch(listChoice, 'InputField', listCtx), false);
  assert.equal(T.fieldKind(listChoice), 'list');
});

test('HorizontalStretch does not grow vertically in a page', () => {
  const group = { properties: { HorizontalStretch: 'true' } };
  assert.equal(T.wantsHStretch(group, 'UsualGroup', null), true);
  assert.equal(T.wantsVStretch(group, 'UsualGroup'), false);
});

test('multiline Height is kept even if VerticalStretch is true', () => {
  const field = {
    tag: 'InputField',
    properties: {
      DataPath: 'Объект.ДополнительнаяИнформация',
      TitleLocation: 'Left',
      Height: '3',
      VerticalStretch: 'true',
      MultiLine: 'true'
    }
  };
  assert.equal(T.isMultilineField(field), true);
  assert.equal(T.fieldHeight(field), 3);
  assert.equal(T.wantsVStretch(field, 'InputField'), false);
});

test('multiline MaxHeight caps the field without stretching its parent', () => {
  const field = {
    tag: 'InputField',
    properties: {
      MultiLine: 'true',
      AutoMaxHeight: 'false',
      MaxHeight: '5'
    }
  };
  const group = {
    tag: 'UsualGroup', properties: { Group: 'Horizontal' }, childItems: [field]
  };

  assert.equal(T.isMultilineField(field), true);
  assert.equal(T.wantsVStretch(field, 'InputField'), false);
  assert.equal(T.wantsVStretch(group, 'UsualGroup'), false);
});

test('catalog AutoCommandBar autofills WriteAndClose and Write', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Form xmlns="http://v8.1c.ru/8.3/xcf/logform" xmlns:v8="http://v8.1c.ru/8.1/data/core" version="2.20">
  <AutoCommandBar name="ФормаКоманднаяПанель" id="-1">
    <ChildItems>
      <Popup name="ПодменюПечать" id="1">
        <Title><v8:item><v8:lang>ru</v8:lang><v8:content>Печать</v8:content></v8:item></Title>
      </Popup>
    </ChildItems>
  </AutoCommandBar>
  <ChildItems>
    <InputField name="Код" id="2">
      <DataPath>Объект.Code</DataPath>
    </InputField>
  </ChildItems>
  <Attributes>
    <Attribute name="Объект" id="1">
      <Type><v8:Type>cfg:CatalogObject.Контрагенты</v8:Type></Type>
      <MainAttribute>true</MainAttribute>
    </Attribute>
  </Attributes>
</Form>`;
  const parsed = FP.parse(xml);
  assert.ok(!parsed.error, parsed.error);
  assert.equal(T.formObjectKind(parsed.model), 'catalog');
  const bar = T.formCommandBar(parsed.model);
  const keys = (bar.childItems || []).map((it) => T.stdCommandKey(it));
  assert.equal(keys[0], 'writeandclose');
  assert.equal(keys[1], 'write');
  const writeClose = bar.childItems[0];
  assert.equal(T.resolveButtonRep(writeClose), 'text');
  assert.equal(T.titleOf(writeClose), 'Записать и закрыть');
  assert.equal(T.isTrue(writeClose.properties.DefaultButton), true);
  assert.equal(T.resolveButtonRep(bar.childItems[1]), 'text');
  assert.equal(bar.childItems.find((item) => item.name === '_stdHelp').properties.CommandName,
    'Form.StandardCommand.Help');
});

test('standard help button follows the owner object help content, not its kind', () => {
  const form = `<?xml version="1.0" encoding="UTF-8"?>
<Form xmlns="http://v8.1c.ru/8.3/xcf/logform" version="2.20"><AutoCommandBar name="ФормаКоманднаяПанель" id="-1"/></Form>`;
  const meta = (tag, help) => `<?xml version="1.0" encoding="UTF-8"?>
<MetaDataObject xmlns="http://v8.1c.ru/8.3/MDClasses"><${tag}><Properties><Name>X</Name></Properties></${tag}></MetaDataObject>${help ? '\n<!--fp-object-help-->' : ''}`;
  const helpNames = (objectMeta) => (T.formCommandBar(FP.parse(form, objectMeta).model).childItems || [])
    .filter((item) => item.name === '_stdHelp').length;
  assert.equal(helpNames(meta('Report', true)), 1, 'a report with Ext/Help.xml paints «?»');
  assert.equal(helpNames(meta('Document', false)), 0, 'a document without help paints none');
  assert.equal(helpNames(meta('Catalog', false)), 0, 'the object help wins over the catalog default');
});

test('document AutoCommandBar renders the primary persistence trio as text', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Form xmlns="http://v8.1c.ru/8.3/xcf/logform" xmlns:v8="http://v8.1c.ru/8.1/data/core" version="2.20">
  <AutoCommandBar name="ФормаКоманднаяПанель" id="-1"/>
  <ChildItems>
    <InputField name="Номер" id="2">
      <DataPath>Объект.Number</DataPath>
    </InputField>
  </ChildItems>
  <Attributes>
    <Attribute name="Объект" id="1">
      <Type><v8:Type>cfg:DocumentObject.ЗаказКлиента</v8:Type></Type>
      <MainAttribute>true</MainAttribute>
    </Attribute>
  </Attributes>
</Form>`;
  const parsed = FP.parse(xml);
  assert.ok(!parsed.error, parsed.error);
  assert.equal(T.formObjectKind(parsed.model), 'document');
  const bar = T.formCommandBar(parsed.model);
  const items = bar.childItems || [];
  assert.equal(items.length, 3);
  assert.equal(T.stdCommandKey(items[0]), 'postandclose');
  assert.equal(T.titleOf(items[0]), 'Провести и закрыть');
  assert.equal(T.resolveButtonRep(items[0]), 'text');
  assert.equal(T.isTrue(items[0].properties.DefaultButton), true);
  assert.equal(T.stdCommandKey(items[1]), 'write');
  assert.equal(T.resolveButtonRep(items[1]), 'text');
  assert.equal(T.iconIdFor(items[1]), 'save');
  assert.equal(T.stdCommandKey(items[2]), 'post');
  assert.equal(T.resolveButtonRep(items[2]), 'text');
  assert.equal(T.iconIdFor(items[2]), 'file-check');
});

test('document root bar overrides authored Picture for persistence roles only', () => {
  const xml = `<Form xmlns="http://v8.1c.ru/8.3/xcf/logform" xmlns:v8="http://v8.1c.ru/8.1/data/core">
    <AutoCommandBar name="Root"><Autofill>false</Autofill><ChildItems>
      <Button name="ФормаЗаписать" id="1"><Representation>Picture</Representation><CommandName>Form.StandardCommand.Write</CommandName></Button>
      <Button name="Other" id="2"><Representation>Picture</Representation><CommandName>Form.Command.Other</CommandName><Picture><Ref>StdPicture.Print</Ref></Picture></Button>
    </ChildItems></AutoCommandBar>
    <Attributes><Attribute name="Объект"><Type><v8:Type>cfg:DocumentObject.Заказ</v8:Type></Type><MainAttribute>true</MainAttribute></Attribute></Attributes>
  </Form>`;
  const bar = T.formCommandBar(FP.parse(xml).model);
  assert.equal(T.resolveButtonRep(bar.childItems[0]), 'text');
  assert.equal(T.resolveButtonRep(bar.childItems[1]), 'picture');
});

test('generated change-history common command renders alone with the data-history glyph', () => {
  /* The reference catalog item form
   * shows no separate "Изменить" pencil on the object-form root bar: only the
   * generated "История изменений" common command appears, using the platform
   * pencil+clock glyph. Object forms must not synthesize a Change button that
   * Form.xml/CommandInterface never authored. */
  const xml = `<Form xmlns="http://v8.1c.ru/8.3/xcf/logform" xmlns:v8="http://v8.1c.ru/8.1/data/core">
    <AutoCommandBar name="Root"/>
    <Attributes><Attribute name="Объект"><Type><v8:Type>cfg:CatalogObject.Номенклатура</v8:Type></Type><MainAttribute>true</MainAttribute></Attribute></Attributes>
  </Form>`;
  const history = `<MetaDataObject xmlns="http://v8.1c.ru/8.3/MDClasses"><CommonCommand><Properties>
    <Name>ИсторияИзменений</Name><Synonym>История изменений</Synonym><Group>FormCommandBarImportant</Group><Representation>Picture</Representation><GlobalApplicable>true</GlobalApplicable><Picture><Ref>StdPicture.DataHistory</Ref></Picture>
  </Properties></CommonCommand></MetaDataObject>`;
  const parsed = FP.parse(xml, '', {}, '', { '@global:ИсторияИзменений': history });
  const bar = T.formCommandBar(parsed.model);
  const generated = bar.childItems.filter((item) => /^_(?:stdChange|global_)/.test(item.name || ''));
  assert.deepEqual(Array.from(generated, (item) => T.titleOf(item)), ['История изменений']);
  assert.equal(T.iconIdFor(generated[0]), 'data-history');
});

test('document root commands do not paint the table CreateListItem glyph', () => {
  const xml = `<Form xmlns="http://v8.1c.ru/8.3/xcf/logform" xmlns:v8="http://v8.1c.ru/8.1/data/core">
    <AutoCommandBar name="Root"><Autofill>false</Autofill><ChildItems>
      <Button name="Redirect" id="1"><Representation>PictureAndText</Representation><CommandName>Form.Command.Redirect</CommandName><Picture><xr:Ref xmlns:xr="http://v8.1c.ru/8.3/xcf/readable">StdPicture.CreateListItem</xr:Ref></Picture></Button>
      <Button name="Print" id="2"><Representation>Picture</Representation><CommandName>Form.Command.Print</CommandName><Picture><xr:Ref xmlns:xr="http://v8.1c.ru/8.3/xcf/readable">StdPicture.Print</xr:Ref></Picture></Button>
    </ChildItems></AutoCommandBar>
    <Commands>
      <Command name="Redirect"><Title><v8:item><v8:lang>ru</v8:lang><v8:content>Переадресовка</v8:content></v8:item></Title></Command>
      <Command name="Print"><Title><v8:item><v8:lang>ru</v8:lang><v8:content>Печать</v8:content></v8:item></Title></Command>
    </Commands>
    <Attributes><Attribute name="Объект"><Type><v8:Type>cfg:DocumentObject.Заказ</v8:Type></Type><MainAttribute>true</MainAttribute></Attribute></Attributes>
  </Form>`;
  const bar = T.formCommandBar(FP.parse(xml).model);
  assert.equal(T.resolveButtonRep(bar.childItems[0]), 'text');
  assert.equal(bar.childItems[0].rootTableGlyphText, true);
  assert.equal(T.resolveButtonRep(bar.childItems[1]), 'picture');
});

test('extension placeholders do not suppress document standard commands', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Form xmlns="http://v8.1c.ru/8.3/xcf/logform" xmlns:v8="http://v8.1c.ru/8.1/data/core">
  <CommandSet>
    <ExcludedCommand>Post</ExcludedCommand>
    <ExcludedCommand>PostAndClose</ExcludedCommand>
    <ExcludedCommand>Write</ExcludedCommand>
  </CommandSet>
  <AutoCommandBar name="ФормаКоманднаяПанель" id="-1"><ChildItems>
    <Button name="ФормаПровестиИЗакрыть" id="1"><CommandName>0</CommandName></Button>
    <Button name="ФормаЗаписать" id="2"><CommandName>0</CommandName></Button>
    <Button name="ФормаПровести" id="3"><CommandName>0</CommandName></Button>
  </ChildItems></AutoCommandBar>
  <Attributes><Attribute name="Объект" id="100"><Type><v8:Type>cfg:DocumentObject.Заявка</v8:Type></Type><MainAttribute>true</MainAttribute></Attribute></Attributes>
</Form>`;
  const objectMeta = `<?xml version="1.0" encoding="UTF-8"?>
<MetaDataObject xmlns="http://v8.1c.ru/8.3/MDClasses">
  <Document><Properties><ObjectBelonging>Adopted</ObjectBelonging><Name>Заявка</Name></Properties></Document>
</MetaDataObject>`;
  const parsed = FP.parse(xml, objectMeta);
  assert.equal(T.formObjectKind(parsed.model), 'document');
  assert.equal(parsed.model.objectMeta.objectBelonging, 'Adopted');
  const bar = T.formCommandBar(parsed.model);
  assert.deepEqual(Array.from(bar.childItems.slice(0, 3), (it) => it.name),
    ['_stdPostAndClose', '_stdWrite', '_stdPost']);
  assert.deepEqual(Array.from(bar.childItems.slice(0, 3), (it) => T.titleOf(it)),
    ['Провести и закрыть', 'Записать', 'Провести']);
  assert.equal(bar.childItems.slice(3).every((it) => T.isDeadCommand(it)), true);
});

test('ordinary excluded document commands stay excluded', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Form xmlns="http://v8.1c.ru/8.3/xcf/logform" xmlns:v8="http://v8.1c.ru/8.1/data/core">
  <CommandSet><ExcludedCommand>Post</ExcludedCommand></CommandSet>
  <Attributes><Attribute name="Объект"><Type><v8:Type>cfg:DocumentObject.Заявка</v8:Type></Type><MainAttribute>true</MainAttribute></Attribute></Attributes>
</Form>`;
  const bar = T.formCommandBar(FP.parse(xml).model);
  assert.deepEqual(Array.from(bar.childItems, (it) => it.name), ['_stdPostAndClose', '_stdWrite']);
});

test('Autofill false does not inject standard form commands', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Form xmlns="http://v8.1c.ru/8.3/xcf/logform" xmlns:v8="http://v8.1c.ru/8.1/data/core" version="2.20">
  <AutoCommandBar name="ФормаКоманднаяПанель" id="-1">
    <Autofill>false</Autofill>
    <ChildItems>
      <Button name="ФормаЗаписатьИЗакрыть" id="1">
        <DefaultButton>true</DefaultButton>
        <CommandName>Form.StandardCommand.WriteAndClose</CommandName>
      </Button>
    </ChildItems>
  </AutoCommandBar>
  <Attributes>
    <Attribute name="Объект" id="1">
      <Type><v8:Type>cfg:CatalogObject.Контрагенты</v8:Type></Type>
      <MainAttribute>true</MainAttribute>
    </Attribute>
  </Attributes>
</Form>`;
  const parsed = FP.parse(xml);
  assert.equal(T.formStdCommandButtons(parsed.model).length, 0);
  const bar = T.formCommandBar(parsed.model);
  assert.equal((bar.childItems || []).length, 1);
});

test('form outline marks groups as collapsible and hides nested children', () => {
  const parsed = FP.parse(fixture);
  const items = FP.outline(parsed.model, fixture);
  const sh = items.find((x) => x.name === 'ГруппаШапка');
  assert.ok(sh, 'ГруппаШапка');
  assert.equal(sh.hasChildren, true);
  const shIdx = items.indexOf(sh);
  const child = items[shIdx + 1];
  assert.ok(child && child.depth > sh.depth);
  const collapsed = {};
  collapsed[sh.id] = true;
  assert.equal(FP.outlineHidden(items, shIdx, collapsed), false);
  assert.equal(FP.outlineHidden(items, shIdx + 1, collapsed), true);
  const pages = items.find((x) => x.name === 'Страницы');
  assert.ok(pages && pages.hasChildren);
  collapsed[pages.id] = true;
  const pIdx = items.indexOf(pages);
  assert.equal(FP.outlineHidden(items, pIdx + 1, collapsed), true);
  assert.equal(FP.outlineExpandTo(items, items[pIdx + 1].id, collapsed), true);
  assert.equal(collapsed[pages.id], undefined);
});

test('collapsing one group does not hide a sibling group', () => {
  const items = [
    { type: 'form', id: 'A', depth: 0 },
    { type: 'form', id: 'A1', depth: 1 },
    { type: 'form', id: 'B', depth: 0 },
    { type: 'form', id: 'B1', depth: 1 }
  ];
  FP.outlineHasChildren(items);
  assert.equal(items[0].hasChildren, true);
  assert.equal(items[2].hasChildren, true);
  const collapsed = { A: true };
  assert.equal(FP.outlineHidden(items, 1, collapsed), true);
  assert.equal(FP.outlineHidden(items, 2, collapsed), false);
  assert.equal(FP.outlineHidden(items, 3, collapsed), false);
});

/* --- Element properties that shape the look: fonts, form root, tables --- */

test('Font and TitleFont are read from attributes, not from text', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Form xmlns="http://v8.1c.ru/8.3/xcf/logform" xmlns:v8="http://v8.1c.ru/8.1/data/core">
  <ChildItems>
    <LabelDecoration name="Итого">
      <Title><v8:item><v8:lang>ru</v8:lang><v8:content>Итого</v8:content></v8:item></Title>
      <Font faceName="Arial" height="12" bold="true" italic="false" underline="false" kind="Absolute" scale="100"/>
    </LabelDecoration>
    <InputField name="Сумма">
      <TitleFont ref="style:ВажнаяНадписьШрифт" kind="StyleItem"/>
    </InputField>
  </ChildItems>
</Form>`;
  const parsed = FP.parse(xml);
  const [label, input] = parsed.model.childItemsRoot;
  assert.equal(label.properties.FontSpec.bold, true);
  assert.equal(label.properties.FontSpec.height, 12);
  const css = { ...T.fontCss(label.properties.FontSpec) };
  assert.equal(css.fontWeight, '700');
  assert.equal(css.fontSize, '16px');
  /* A StyleItem font carries no values, so only what the style name states wins. */
  const titleCss = { ...T.fontCss(input.properties.TitleFontSpec) };
  assert.equal(titleCss.fontWeight, '700');
  assert.equal(titleCss.fontSize, undefined);
  assert.equal(T.fontCss({ ref: 'style:ExtraLargeTextFont' }).fontSize, '24px');
  assert.equal(T.fontCss({ ref: 'style:LargeTextFont' }).fontSize, '18px');
});

test('a font with no traits at all is dropped', () => {
  const xml = `<?xml version="1.0"?><Form xmlns="http://v8.1c.ru/8.3/xcf/logform"><ChildItems>
    <LabelDecoration name="X"><Font kind="Absolute"/></LabelDecoration></ChildItems></Form>`;
  const parsed = FP.parse(xml);
  assert.equal(parsed.model.childItemsRoot[0].properties.FontSpec, undefined);
});

test('the Form root keeps its own properties', () => {
  const xml = `<?xml version="1.0"?>
<Form xmlns="http://v8.1c.ru/8.3/xcf/logform" xmlns:v8="http://v8.1c.ru/8.1/data/core">
  <Title><v8:item><v8:lang>ru</v8:lang><v8:content>Договор</v8:content></v8:item></Title>
  <CommandBarLocation>Bottom</CommandBarLocation>
  <Width>45</Width>
  <ChildItems><InputField name="Номер"><DataPath>Объект.Номер</DataPath></InputField></ChildItems>
  <AutoCommandBar name="ФормаКоманднаяПанель"><Autofill>false</Autofill>
    <ChildItems><Button name="B"><Title><v8:item><v8:lang>ru</v8:lang><v8:content>Ок</v8:content></v8:item></Title></Button></ChildItems>
  </AutoCommandBar>
</Form>`;
  const parsed = FP.parse(xml);
  assert.equal(parsed.model.properties.Title, 'Договор');
  assert.equal(parsed.model.properties.Width, '45');
  assert.equal(T.commandBarLocation(parsed.model), 'bottom');
  const items = T.displayItems(parsed.model);
  /* Bottom moves the bar behind the children instead of ahead of them. */
  assert.equal(items[items.length - 1].tag, 'AutoCommandBar');
  assert.equal(items[0].tag, 'InputField');
});

test('CommandBarLocation=None drops the form command bar entirely', () => {
  const xml = `<?xml version="1.0"?>
<Form xmlns="http://v8.1c.ru/8.3/xcf/logform" xmlns:v8="http://v8.1c.ru/8.1/data/core">
  <CommandBarLocation>None</CommandBarLocation>
  <ChildItems><InputField name="Номер"/></ChildItems>
  <AutoCommandBar name="ФормаКоманднаяПанель">
    <ChildItems><Button name="B"><Title><v8:item><v8:lang>ru</v8:lang><v8:content>Ок</v8:content></v8:item></Title></Button></ChildItems>
  </AutoCommandBar>
</Form>`;
  const parsed = FP.parse(xml);
  const items = T.displayItems(parsed.model);
  assert.equal(items.length, 1);
  assert.equal(items[0].tag, 'InputField');
});

test('a missing CommandBarLocation still puts the bar on top', () => {
  const xml = `<?xml version="1.0"?>
<Form xmlns="http://v8.1c.ru/8.3/xcf/logform" xmlns:v8="http://v8.1c.ru/8.1/data/core">
  <ChildItems><InputField name="Номер"/></ChildItems>
  <AutoCommandBar name="ФормаКоманднаяПанель">
    <ChildItems><Button name="B"><Title><v8:item><v8:lang>ru</v8:lang><v8:content>Ок</v8:content></v8:item></Title></Button></ChildItems>
  </AutoCommandBar>
</Form>`;
  const parsed = FP.parse(xml);
  assert.equal(T.commandBarLocation(parsed.model), 'auto');
  assert.equal(T.displayItems(parsed.model)[0].tag, 'AutoCommandBar');
});

test('ExtendedTooltip is kept beside the item, not among its children', () => {
  const xml = `<?xml version="1.0"?>
<Form xmlns="http://v8.1c.ru/8.3/xcf/logform" xmlns:v8="http://v8.1c.ru/8.1/data/core"><ChildItems>
  <InputField name="Склад">
    <ToolTipRepresentation>ShowBottom</ToolTipRepresentation>
    <ExtendedTooltip name="СкладРасширеннаяПодсказка">
      <Title><v8:item><v8:lang>ru</v8:lang><v8:content>Склад отгрузки</v8:content></v8:item></Title>
    </ExtendedTooltip>
  </InputField>
</ChildItems></Form>`;
  const parsed = FP.parse(xml);
  const field = parsed.model.childItemsRoot[0];
  assert.equal((field.childItems || []).length, 0);
  assert.equal(T.tooltipText(field), 'Склад отгрузки');
  assert.equal(T.tooltipRepresentation(field), 'bottom');
});

test('ToolTipRepresentation defaults to a hover title', () => {
  assert.equal(T.tooltipRepresentation({ properties: {} }), 'auto');
  assert.equal(T.tooltipRepresentation({ properties: { ToolTipRepresentation: 'None' } }), 'none');
  assert.equal(T.tooltipRepresentation({ properties: { ToolTipRepresentation: 'Button' } }), 'button');
});

test('table lines, alternation and tree view are read as written', () => {
  const table = {
    tag: 'Table', name: 'Товары',
    properties: {
      Header: 'false', VerticalLines: 'false', UseAlternationRowColor: 'true',
      HeightInTableRows: '5', CommandBarLocation: 'None', Representation: 'Tree',
      InitialTreeView: 'ExpandTopLevel'
    }
  };
  assert.equal(T.isFalse(table.properties.Header), true);
  assert.equal(T.commandBarLocation(table), 'none');
  assert.equal(T.tableIsTree(table), true);
  assert.equal(T.treeExpanded(table), true);
  assert.equal(T.treeExpanded({ properties: { InitialTreeView: 'NoExpand' } }), false);
});

test('tumbler checkbox and radio types are recognised, plain ones are not', () => {
  assert.equal(T.isTumbler('Tumbler'), true);
  assert.equal(T.isTumbler('Switcher'), true);
  assert.equal(T.isTumbler('Auto'), false);
  assert.equal(T.isTumbler('CheckBox'), false);
  assert.equal(T.isTumbler(''), false);
});

test('only absolute colours become CSS; style names keep their keyword path', () => {
  assert.equal(T.absoluteColor('#FFEECC'), '#FFEECC');
  assert.equal(T.absoluteColor('255,128,0'), 'rgb(255,128,0)');
  assert.equal(T.absoluteColor('web:FireBrick'), 'FireBrick');
  assert.equal(T.absoluteColor('style:ПоясняющийТекст'), '');
  assert.equal(T.styleItemColor('style:ДобавленныйРеквизитФон', { ДобавленныйРеквизитФон: '#CCFFCC' }), '#CCFFCC');
  assert.equal(T.buttonColorGradient('#FF6600'),
    'linear-gradient(180deg, rgb(255,122,34) 0%, rgb(255,102,0) 46%, rgb(242,97,0) 100%)');
});

test('only CommandBarHyperlink strips compact as a 27px Taxi row', () => {
  assert.equal(T.commandBarHasOnlyHyperlinks({
    childItems: [
      { tag: 'Button', properties: { Type: 'CommandBarHyperlink' } },
      { tag: 'Button', properties: { Type: 'CommandBarHyperlink' } }
    ]
  }), true);
  assert.equal(T.commandBarHasOnlyHyperlinks({
    childItems: [
      { tag: 'Button', properties: { Type: 'CommandBarButton' } },
      { tag: 'Button', properties: { Type: 'CommandBarHyperlink' } }
    ]
  }), false);
});

test('a wide Pages strip clips extra tabs instead of crushing them below the 11-tab the reference floor', () => {
  assert.equal(T.WIDE_PAGE_TAB_MIN_PX, 92);
  assert.equal(T.MIN_PAGE_TAB_PX, 46);
  /* 9 tabs on a 950px strip match Партнеры.ПомощникНового (~106px). */
  assert.equal(T.fitPageTabWidth(950, 9), 106);
  /* 11 tabs on a 947px strip would equal-slice to 87px; the live reference floor
   * is 92px, so the 11th tab is clipped rather than shrinking the rest. */
  assert.equal(T.fitPageTabWidth(947, 11), 92);
  /* 16 tabs on a form-width strip stay at the 92px reference floor (ПроверкаКонтрагента). */
  assert.equal(T.fitPageTabWidth(960, 16), 92);
  /* A nested 300px strip with five tabs still uses equal-slice, not the wide floor. */
  assert.equal(T.fitPageTabWidth(300, 5), 60);
  /* Emergency 46px floor remains for a genuinely narrow overflowing strip. */
  assert.equal(T.fitPageTabWidth(80, 3), 46);

  function tabNode() {
    const width = { value: '' };
    const maxWidth = { value: '' };
    return {
      classList: { contains: (name) => name === 'fp-pages-tab' },
      getBoundingClientRect() { return { width: 48, height: 28, left: 0, right: 48, top: 0, bottom: 28 }; },
      style: {
        removeProperty(name) {
          if (name === 'width') width.value = '';
          if (name === 'max-width') maxWidth.value = '';
        },
        set width(value) { width.value = value; },
        get width() { return width.value; },
        set maxWidth(value) { maxWidth.value = value; },
        get maxWidth() { return maxWidth.value; }
      }
    };
  }
  const tabs = Array.from({ length: 16 }, tabNode);
  const list = {
    classList: { contains: (name) => name === 'fp-pages-tablist' },
    clientWidth: 960,
    scrollWidth: 1600,
    children: tabs
  };
  const body = {
    querySelectorAll(selector) {
      return selector === '.fp-pages-tablist' ? [list] : [];
    }
  };
  T.fitPageTabs(body);
  assert.ok(tabs.every((tab) => tab.style.width === '92px' && tab.style.maxWidth === ''),
    tabs.map((tab) => `${tab.style.width}/${tab.style.maxWidth}`).join(','));

  const fittingTabs = Array.from({ length: 14 }, tabNode);
  const fittingList = {
    classList: { contains: (name) => name === 'fp-pages-tablist' },
    clientWidth: 950,
    scrollWidth: 950,
    offsetWidth: 950,
    children: fittingTabs
  };
  T.fitPageTabs({
    querySelectorAll(selector) {
      return selector === '.fp-pages-tablist' ? [fittingList] : [];
    }
  });
  assert.ok(fittingTabs.every((tab) => tab.style.width === ''),
    'compact captions that fit the strip keep their intrinsic width');
});

test('heights are counted in rows, widths in characters', () => {
  assert.equal(T.charHeight('2'), 36);
  assert.equal(T.charHeight(''), 0);
  assert.equal(T.charHeight('0'), 0);
});

test('PictureSize is normalised to the modes 1C offers', () => {
  assert.equal(T.normPictureSize('Proportionally'), 'proportionally');
  assert.equal(T.normPictureSize('Stretch'), 'stretch');
  assert.equal(T.normPictureSize('AutoSize'), 'autosize');
  assert.equal(T.normPictureSize('ByFontSize'), 'byfontsize');
  assert.equal(T.normPictureSize(''), '');
});

test('collectFieldLabels does not reach into a Pages item\'s active-page panel', () => {
  /* Regression for the "Статус"/"переход права" header row widening when the
   * user switches tabs: a Pages item's own subtree reuses the .fp-children
   * class on the active page's panel, deep inside .fp-pages-outer. Before the
   * fix, box.querySelector('.fp-children') reached straight through the Pages
   * item to that panel and pulled the active page's own field labels into the
   * root-level label-width pass - so the header's label width shifted with
   * whichever tab happened to be open. */
  function fakeNode(classes) {
    const set = new Set(String(classes || '').split(/\s+/).filter(Boolean));
    const n = {
      classList: { contains: (c) => set.has(c) },
      dataset: {},
      children: [],
      textContent: '',
      querySelector(sel) {
        const cls = String(sel).replace(/^\./, '');
        const stack = this.children.slice();
        while (stack.length) {
          const cur = stack.shift();
          if (cur.classList && cur.classList.contains(cls)) return cur;
          if (cur.children && cur.children.length) stack.push(...cur.children);
        }
        return null;
      }
    };
    return n;
  }
  function fieldControl(labelText) {
    const control = fakeNode('fp-item fp-control');
    const row = fakeNode('fp-field-row');
    const label = fakeNode('fp-field-label');
    label.textContent = labelText;
    row.children = [label];
    control.children = [row];
    return control;
  }

  const statusRow = fakeNode('fp-children fp-children-horizontal');
  statusRow.children = [fieldControl('Статус:')];
  const statusGroup = fakeNode('fp-item fp-container');
  statusGroup.children = [statusRow];

  const activePagePanel = fakeNode('fp-children fp-children-vertical');
  activePagePanel.children = [fieldControl('Адрес доставки для печати:')];
  const panelWrap = fakeNode('fp-pages-panel-wrap');
  panelWrap.children = [activePagePanel];
  const pagesOuter = fakeNode('fp-pages-outer');
  pagesOuter.children = [fakeNode('fp-pages-tablist'), panelWrap];
  const pagesItem = fakeNode('fp-item fp-container');
  pagesItem.dataset.tag = 'Pages';
  pagesItem.children = [pagesOuter];

  const root = fakeNode('');
  root.children = [statusGroup, pagesItem];

  const labels = T.collectFieldLabels(root, true);

  assert.equal(labels.length, 1, 'only the header row\'s first label should be collected');
  assert.equal(labels[0].textContent, 'Статус:');
  assert.ok(!labels.some((l) => l.textContent === 'Адрес доставки для печати:'),
    'the active page\'s own field labels must not leak into the header row\'s width pass');
});

test('a compact Width+no-stretch field beside a titled stretch sibling keeps local captions', () => {
  const monthOrg = {
    tag: 'UsualGroup',
    childItems: [
      { tag: 'InputField', properties: { Width: '13', HorizontalStretch: 'false', Title: 'Месяц' } },
      { tag: 'InputField', properties: { Title: 'Организация' } },
    ],
  };
  assert.equal(T.compactTitledHorizontalPairKeepsLocalCaptions(monthOrg), true);
  const innKpp = {
    tag: 'UsualGroup',
    childItems: [
      { tag: 'InputField', properties: { Width: '15', AutoMaxWidth: 'false', MaxWidth: '17', Title: 'ИНН' } },
      { tag: 'InputField', properties: { Width: '14', AutoMaxWidth: 'false', Title: 'КПП' } },
    ],
  };
  assert.equal(T.compactTitledHorizontalPairKeepsLocalCaptions(innKpp), false,
    'INN/KPP both have Width; the leading caption still joins ThroughAlign');
});

test('compact titled horizontal pair publishes Taxi chrome on each local caption', () => {
  const orgLabel = { textContent: 'Организация:', style: {}, offsetWidth: 90 };
  const monthLabel = { textContent: 'Месяц:', style: {}, offsetWidth: 42 };
  const orgEditor = { style: {} };
  const row = (label) => ({
    classList: { contains: (name) => name === 'fp-field-row' || name === 'fp-title-left' },
    querySelector: (sel) => sel && String(sel).indexOf('fp-input-wrap') >= 0 ? orgEditor : label,
  });
  const field = (label, editor) => ({
    classList: { contains: (name) => name === 'fp-control' },
    querySelector: (sel) => {
      if (sel && String(sel).indexOf('fp-input-wrap') >= 0) return editor || null;
      return row(label);
    },
  });
  const box = { children: [field(monthLabel, null), field(orgLabel, orgEditor)] };
  const item = {
    tag: 'UsualGroup',
    childItems: [
      { tag: 'InputField', properties: { Width: '13', HorizontalStretch: 'false', Title: 'Месяц' } },
      { tag: 'InputField', properties: { Title: 'Организация' } },
    ],
  };
  assert.equal(T.fitCompactTitledHorizontalPairCaptions(box, item), 3);
  const orgTrack = parseFloat(orgLabel.style.minWidth);
  const monthTrack = parseFloat(monthLabel.style.minWidth);
  assert.equal(orgLabel.style.maxWidth, orgLabel.style.minWidth);
  assert.equal(orgLabel.style.flex, '0 0 ' + orgLabel.style.minWidth);
  assert.ok(orgTrack > monthTrack, monthTrack + ' vs ' + orgTrack);
  assert.ok(orgTrack >= monthTrack + T.taxiLayoutMetrics.throughAlignTitleChrome);
  assert.equal(orgEditor.style.width, '270px');
  assert.equal(orgEditor.style.flex, '0 0 270px');
});

test('flattened PagesRepresentation=None captions join the surrounding field-label column', () => {
  function fakeNode(classes, tag = '') {
    const set = new Set(String(classes || '').split(/\s+/).filter(Boolean));
    const n = {
      classList: { contains: (c) => set.has(c) },
      dataset: tag ? { tag } : {},
      children: [],
      textContent: '',
      querySelector(sel) {
        const cls = String(sel).replace(/^\./, '');
        const stack = this.children.slice();
        while (stack.length) {
          const cur = stack.shift();
          if (cur.classList && cur.classList.contains(cls)) return cur;
          if (cur.children && cur.children.length) stack.push(...cur.children);
        }
        return null;
      }
    };
    return n;
  }
  function fieldControl(labelText) {
    const control = fakeNode('fp-item fp-control', 'InputField');
    const row = fakeNode('fp-field-row');
    const label = fakeNode('fp-field-label');
    label.textContent = labelText;
    row.children = [label];
    control.children = [row];
    return control;
  }

  const publicInner = fakeNode('fp-children fp-children-vertical');
  publicInner.children = [fieldControl('Публичное наименование:')];
  const pagesItem = fakeNode('fp-item fp-container fp-pages-none');
  pagesItem.dataset.tag = 'Pages';
  pagesItem.children = [publicInner];

  const abbr = fieldControl('Сокр. юр. наименование:');
  abbr._fpItem = { tag: 'InputField', properties: {} };
  const fill = fakeNode('fp-item fp-control', 'Button');
  fill._fpItem = { tag: 'Button', properties: { AutoMaxWidth: 'false', MaxWidth: '3' } };
  const abbrRow = fakeNode('fp-children fp-children-horizontal fp-container-bare');
  abbrRow.children = [abbr, fill];
  const abbrGroup = fakeNode('fp-item fp-container');
  abbrGroup.children = [abbrRow];

  const root = fakeNode('');
  root.children = [abbrGroup, pagesItem];
  const labels = T.collectFieldLabels(root, true);
  assert.deepEqual(Array.from(labels, (label) => label.textContent),
    ['Сокр. юр. наименование:', 'Публичное наименование:']);
});

test('NormalSeparation captions stay out of the surrounding ThroughAlign column', () => {
  function fakeNode(classes, tag = '') {
    const set = new Set(String(classes || '').split(/\s+/).filter(Boolean));
    const n = {
      classList: { contains: (c) => set.has(c) },
      dataset: tag ? { tag } : {},
      children: [],
      textContent: '',
      querySelector(sel) {
        const cls = String(sel).replace(/^\./, '');
        const stack = this.children.slice();
        while (stack.length) {
          const cur = stack.shift();
          if (cur.classList && cur.classList.contains(cls)) return cur;
          if (cur.children && cur.children.length) stack.push(...cur.children);
        }
        return null;
      }
    };
    return n;
  }
  function fieldControl(labelText) {
    const control = fakeNode('fp-item fp-control', 'InputField');
    const row = fakeNode('fp-field-row');
    const label = fakeNode('fp-field-label');
    label.textContent = labelText;
    row.children = [label];
    control.children = [row];
    return control;
  }

  const legalInner = fakeNode('fp-children fp-children-vertical');
  legalInner.dataset.fpThroughAlign = 'dontuse';
  legalInner.dataset.fpThroughAlignMode = 'auto';
  legalInner.children = [fieldControl('Код по ОКПО:')];
  const legalGroup = fakeNode('fp-item fp-container', 'UsualGroup');
  legalGroup.children = [legalInner];

  const publicInner = fakeNode('fp-children fp-children-vertical');
  publicInner.dataset.fpThroughAlign = 'use';
  publicInner.dataset.fpThroughAlignMode = 'auto';
  publicInner.children = [fieldControl('Публичное наименование:')];
  const publicGroup = fakeNode('fp-item fp-container', 'UsualGroup');
  publicGroup.children = [publicInner];

  const root = fakeNode('fp-children fp-children-vertical');
  root.children = [legalGroup, publicGroup];
  const labels = T.collectFieldLabels(root, true);
  assert.deepEqual(Array.from(labels, (label) => label.textContent),
    ['Публичное наименование:']);
});

test('an authored-width field with a trailing button stays a local action row', () => {
  function fakeNode(classes, tag = '') {
    const set = new Set(String(classes || '').split(/\s+/).filter(Boolean));
    const n = {
      classList: { contains: (c) => set.has(c) },
      dataset: tag ? { tag } : {},
      children: [],
      textContent: '',
      querySelector(sel) {
        const cls = String(sel).replace(/^\./, '');
        const stack = this.children.slice();
        while (stack.length) {
          const cur = stack.shift();
          if (cur.classList && cur.classList.contains(cls)) return cur;
          if (cur.children && cur.children.length) stack.push(...cur.children);
        }
        return null;
      }
    };
    return n;
  }
  const inn = fakeNode('fp-item fp-control', 'InputField');
  inn._fpItem = { tag: 'InputField', properties: { Width: '15', AutoMaxWidth: 'false' } };
  const row = fakeNode('fp-field-row');
  const label = fakeNode('fp-field-label');
  label.textContent = 'ИНН:';
  row.children = [label];
  inn.children = [row];
  const fill = fakeNode('fp-item fp-control', 'Button');
  fill._fpItem = { tag: 'Button', properties: { AutoMaxWidth: 'false', MaxWidth: '3' } };
  const innRow = fakeNode('fp-children fp-children-horizontal fp-container-bare');
  innRow.children = [inn, fill];
  const group = fakeNode('fp-item fp-container');
  group.children = [innRow];
  const root = fakeNode('');
  root.children = [group];
  assert.equal(T.collectFieldLabels(root, true).length, 0);
});

test('a titled Pages=None sibling keeps the leading caption off the outer column', () => {
  function fakeNode(classes, tag = '') {
    const set = new Set(String(classes || '').split(/\s+/).filter(Boolean));
    const n = {
      classList: { contains: (c) => set.has(c) },
      dataset: tag ? { tag } : {},
      children: [],
      textContent: '',
      querySelector(sel) {
        const wanted = String(sel).trim().split(/\s+/).map((part) => part.replace(/^\./, ''));
        const stack = this.children.slice();
        while (stack.length) {
          const cur = stack.shift();
          if (cur.classList && wanted.every((cls) => cur.classList.contains(cls))) return cur;
          if (cur.children && cur.children.length) stack.push(...cur.children);
        }
        return null;
      }
    };
    return n;
  }
  function fieldControl(labelText) {
    const control = fakeNode('fp-item fp-control', 'InputField');
    control.style = {};
    const row = fakeNode('fp-field-row');
    const label = fakeNode('fp-field-label');
    label.textContent = labelText;
    label.style = {};
    row.children = [label];
    control.children = [row];
    return control;
  }

  const okpo = fieldControl('Код по ОКПО:');
  const ogrnInner = fakeNode('fp-children fp-children-vertical');
  ogrnInner.children = [fieldControl('ОГРН:')];
  const pages = fakeNode('fp-item fp-container fp-pages-none', 'Pages');
  pages.children = [ogrnInner];
  const row = fakeNode('fp-children fp-children-horizontal fp-container-bare');
  row.children = [okpo, pages];
  const group = fakeNode('fp-item fp-container');
  group.children = [row];
  const abbr = fieldControl('Сокр. юр. наименование:');
  const abbrRow = fakeNode('fp-children fp-children-horizontal fp-container-bare');
  abbrRow.children = [abbr];
  const abbrGroup = fakeNode('fp-item fp-container');
  abbrGroup.children = [abbrRow];
  const root = fakeNode('fp-children fp-children-vertical');
  root.children = [group, abbrGroup];
  assert.deepEqual(Array.from(T.collectFieldLabels(root, true), (label) => label.textContent),
    ['Сокр. юр. наименование:']);
  const okpoLabel = okpo.querySelector('.fp-field-label');
  assert.equal(T.fitLeadingCaptionBeforeTitledPagesNone(row), 1);
  const local = parseInt(okpoLabel.style.minWidth, 10);
  assert.ok(local >= 40 && local <= 140, okpoLabel.style.minWidth);
  assert.equal(okpo.style.marginRight, '5px');
  assert.deepEqual(Array.from(T.collectFieldLabels(root, true), (label) => label.textContent),
    ['Сокр. юр. наименование:']);
});

test('CommandInterface expands referenced common commands with metadata pictures', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Form xmlns="http://v8.1c.ru/8.3/xcf/logform" xmlns:v8="http://v8.1c.ru/8.1/data/core">
  <AutoCommandBar name="ФормаКоманднаяПанель" id="-1"><Autofill>false</Autofill><ChildItems>
    <ButtonGroup name="ФормаГлобальныеКоманды" id="10"><CommandSource>Form</CommandSource></ButtonGroup>
  </ChildItems></AutoCommandBar>
  <CommandInterface><CommandBar>
    <Item><Command>CommonCommand.ПротоколОбмена</Command><DefaultVisible>false</DefaultVisible></Item>
    <Item><Command>CommonCommand.Навигация</Command></Item>
    <Item><Command>CommonCommand.ПротоколОбмена</Command></Item>
  </CommandBar></CommandInterface>
</Form>`;
  const commonCommands = {
    '@global:ПротоколОбмена': `<?xml version="1.0"?><MetaDataObject xmlns="http://v8.1c.ru/8.3/MDClasses" xmlns:v8="http://v8.1c.ru/8.1/data/core" xmlns:xr="http://v8.1c.ru/8.3/xcf/readable"><CommonCommand><Properties>
      <Name>ПротоколОбмена</Name><Synonym><v8:item><v8:lang>ru</v8:lang><v8:content>Протокол обмена</v8:content></v8:item></Synonym>
      <Group>FormCommandBarImportant</Group><Representation>PictureAndText</Representation>
      <Picture><xr:Ref>CommonPicture.ПротоколОбмена</xr:Ref></Picture>
    </Properties></CommonCommand></MetaDataObject>`,
    Навигация: `<?xml version="1.0"?><MetaDataObject xmlns="http://v8.1c.ru/8.3/MDClasses"><CommonCommand><Properties>
      <Name>Навигация</Name><Synonym>Навигация</Synonym><Group>NavigationPanelOrdinary</Group>
    </Properties></CommonCommand></MetaDataObject>`,
  };
  const parsed = FP.parse(xml, '', {}, '', commonCommands);
  assert.ok(!parsed.error, parsed.error);
  const insertion = parsed.model.autoCommandBar.childItems[0];
  assert.equal(insertion.childItems.length, 1, JSON.stringify({
    interface: parsed.model.commandInterface,
    common: parsed.model.commonCommands,
  }));
  const command = insertion.childItems[0];
  assert.equal(command.properties.CommandName, 'CommonCommand.ПротоколОбмена');
  assert.equal(T.titleOf(command), 'Протокол обмена');
  assert.equal(T.resolveButtonRep(command), 'pictureandtext');
  assert.equal(command.properties.Picture, 'CommonPicture.ПротоколОбмена');
});

test('CommandInterface does not make an inapplicable common command visible', () => {
  const xml = `<Form xmlns="http://v8.1c.ru/8.3/xcf/logform"><AutoCommandBar name="ФормаКоманднаяПанель" id="-1">
    <Autofill>false</Autofill><ChildItems><ButtonGroup name="ФормаГлобальныеКоманды" id="10"><CommandSource>Form</CommandSource></ButtonGroup></ChildItems>
  </AutoCommandBar><CommandInterface><CommandBar><Item><Command>CommonCommand.ВыгрузитьДанныеВФайл</Command><Index>3</Index></Item></CommandBar></CommandInterface></Form>`;
  const commonCommands = {
    ВыгрузитьДанныеВФайл: `<MetaDataObject xmlns="http://v8.1c.ru/8.3/MDClasses"><CommonCommand><Properties>
      <Name>ВыгрузитьДанныеВФайл</Name><Synonym>Выгрузить реквизиты в файл</Synonym><Group>FormCommandBarImportant</Group>
      <CommandParameterType>cfg:DefinedType.Организация</CommandParameterType>
    </Properties></CommonCommand></MetaDataObject>`,
  };
  const parsed = FP.parse(xml, '', {}, '', commonCommands);
  assert.ok(!parsed.error, parsed.error);
  assert.equal(parsed.model.autoCommandBar.childItems[0].childItems.length, 0);
});

test('global CreateBasedOn commands keep the standard UndoPosting icon metadata', () => {
  const xml = `<Form xmlns="http://v8.1c.ru/8.3/xcf/logform"><AutoCommandBar name="ФормаКоманднаяПанель" id="-1">
    <Autofill>false</Autofill><ChildItems>
      <Button name="ОтменаПроведения" id="1"><CommandName>Form.StandardCommand.UndoPosting</CommandName></Button>
      <ButtonGroup name="КомандыФормы" id="2"><CommandSource>Form</CommandSource></ButtonGroup>
    </ChildItems></AutoCommandBar></Form>`;
  const common = (name, title) => `<MetaDataObject xmlns="http://v8.1c.ru/8.3/MDClasses" xmlns:v8="http://v8.1c.ru/8.1/data/core"><CommonCommand><Properties>
    <Name>${name}</Name><Synonym><v8:item><v8:lang>ru</v8:lang><v8:content>${title}</v8:content></v8:item></Synonym>
    <Group>FormCommandBarCreateBasedOn</Group><Representation>PictureAndText</Representation>
  </Properties></CommonCommand></MetaDataObject>`;
  const parsed = FP.parse(xml, '', {}, '', {
    '@global:CreateLetter': common('CreateLetter', 'Создать письмо'),
    '@global:CreateProcess': common('CreateProcess', 'Создать процесс'),
  });
  assert.ok(!parsed.error, parsed.error);
  const group = parsed.model.autoCommandBar.childItems[1];
  assert.equal(group.childItems.length, 1);
  const popup = group.childItems[0];
  assert.equal(popup.tag, 'Popup');
  assert.equal(popup.properties.Title, 'Создать на основании');
  assert.deepEqual(Array.from(popup.childItems, (item) => item.properties.Title),
    ['Создать письмо', 'Создать процесс']);
  assert.equal(T.resolveButtonRep(parsed.model.autoCommandBar.childItems[0], {}), 'picture');
});

test('global form commands use the reference group rank and Russian title order', () => {
  const xml = `<Form><AutoCommandBar><ChildItems><ButtonGroup><CommandSource>Form</CommandSource></ButtonGroup></ChildItems></AutoCommandBar></Form>`;
  const common = (name, title, group) => `<MetaDataObject xmlns="http://v8.1c.ru/8.3/MDClasses" xmlns:v8="http://v8.1c.ru/8.1/data/core"><CommonCommand><Properties>
    <Name>${name}</Name><Synonym><v8:item><v8:lang>ru</v8:lang><v8:content>${title}</v8:content></v8:item></Synonym>
    <Group>${group}</Group><Representation>PictureAndText</Representation>
  </Properties></CommonCommand></MetaDataObject>`;
  const parameterizedCommand = (name, title, parameterType) => `<MetaDataObject xmlns="http://v8.1c.ru/8.3/MDClasses" xmlns:v8="http://v8.1c.ru/8.1/data/core"><Command><Properties>
    <Name>${name}</Name><Synonym><v8:item><v8:lang>ru</v8:lang><v8:content>${title}</v8:content></v8:item></Synonym>
    <Group>FormCommandBarImportant</Group><CommandParameterType>${parameterType}</CommandParameterType><Representation>Picture</Representation>
  </Properties></Command></MetaDataObject>`;
  const externalCommand = `<MetaDataObject xmlns="http://v8.1c.ru/8.3/MDClasses" xmlns:v8="http://v8.1c.ru/8.1/data/core"><Command><Properties>
    <Name>Pay</Name><Synonym><v8:item><v8:lang>ru</v8:lang><v8:content>Выплатить</v8:content></v8:item></Synonym>
    <Group>FormCommandBarImportant</Group><CommandParameterType><v8:TypeSet>cfg:DefinedType.PayrollDocument</v8:TypeSet></CommandParameterType><Representation>PictureAndText</Representation>
  </Properties></Command></MetaDataObject>`;
  const objectMeta = `<MetaDataObject xmlns="http://v8.1c.ru/8.3/MDClasses"><Document><Properties><Name>Order</Name></Properties></Document></MetaDataObject>`;
  const parsed = FP.parse(xml, objectMeta, {}, '', {
    '@global:Protocol': common('Protocol', 'Протокол обмена', 'FormCommandBarImportant'),
    '@global:History': common('History', 'История изменений', 'FormCommandBar'),
    '@global:Details': common('Details', 'Дополнительные сведения', 'FormCommandBar'),
    '@global:Attached': common('Attached', 'Присоединенные файлы', 'FormCommandBar'),
    '@global-fqn:DataProcessor.Accounting.Command.International': parameterizedCommand('International', 'Проводки международного учета', '<v8:Type>cfg:DocumentRef.Order</v8:Type>'),
    '@global-fqn:DataProcessor.Payroll.Command.Pay': externalCommand,
  });
  assert.ok(!parsed.error, parsed.error);
  const generated = parsed.model.autoCommandBar.childItems[0].childItems;
  assert.deepEqual(Array.from(generated, (item) => item.properties.Title), [
    'Дополнительные сведения',
    'История изменений',
    'Присоединенные файлы',
    'Проводки международного учета',
    'Протокол обмена',
    'Выплатить',
  ]);
});

test('authored CreateBasedOn is reused after generated leaves instead of duplicated', () => {
  const xml = `<Form><AutoCommandBar><ChildItems>
    <Button name="Write"><CommandName>Form.StandardCommand.Write</CommandName></Button>
    <Popup name="ПодменюСоздатьНаОсновании"><Title>Создать на основании</Title><ChildItems>
      <Button name="Authored"><CommandName>Document.Order.StandardCommand.CreateBasedOn</CommandName></Button>
    </ChildItems></Popup>
    <ButtonGroup name="ФормаГлобальныеКоманды"><CommandSource>Form</CommandSource></ButtonGroup>
  </ChildItems></AutoCommandBar></Form>`;
  const common = (name, title, group) => `<MetaDataObject xmlns="http://v8.1c.ru/8.3/MDClasses"><CommonCommand><Properties>
    <Name>${name}</Name><Synonym>${title}</Synonym><Group>${group}</Group>
  </Properties></CommonCommand></MetaDataObject>`;
  const parsed = FP.parse(xml, '', {}, '', {
    '@global:Details': common('Details', 'Дополнительные сведения', 'FormCommandBarImportant'),
    '@global:CreateRelated': common('CreateRelated', 'Создать связанный объект', 'FormCommandBarCreateBasedOn'),
  });
  assert.ok(!parsed.error, parsed.error);
  const bar = parsed.model.autoCommandBar;
  const popups = [];
  const collectPopups = (item) => {
    if (T.isCreateBasedOnPopup(item)) popups.push(item);
    for (const child of item.childItems || []) collectPopups(child);
  };
  collectPopups(bar);
  assert.equal(popups.length, 1);
  assert.equal(popups[0].properties.Representation, 'Text');
  const generatedGroup = bar.childItems.find((item) => item.name === 'ФормаГлобальныеКоманды');
  assert.deepEqual(Array.from(generatedGroup.childItems, (item) => item.properties.Title), [
    'Дополнительные сведения',
    'Создать на основании',
  ]);
  assert.deepEqual(Array.from(T.popupMenuEntries(popups[0]), (item) => item.properties.CommandName), [
    'Document.Order.StandardCommand.CreateBasedOn',
    'CommonCommand.CreateRelated',
  ]);
});

test('CommandInterface and global applicability form one sorted deduplicated leaf segment', () => {
  const xml = `<Form><AutoCommandBar><ChildItems><ButtonGroup><CommandSource>Form</CommandSource></ButtonGroup></ChildItems></AutoCommandBar>
    <CommandInterface><CommandBar>
      <Item><Command>CommonCommand.State</Command><DefaultVisible>false</DefaultVisible></Item>
      <Item><Command>CommonCommand.Ship</Command><DefaultVisible>false</DefaultVisible></Item>
      <Item><Command>CommonCommand.DoNotSupply</Command><DefaultVisible>false</DefaultVisible></Item>
      <Item><Command>CommonCommand.History</Command></Item>
    </CommandBar></CommandInterface></Form>`;
  const common = (name, title) => `<MetaDataObject xmlns="http://v8.1c.ru/8.3/MDClasses"><CommonCommand><Properties>
    <Name>${name}</Name><Synonym>${title}</Synonym><Group>FormCommandBarImportant</Group>
  </Properties></CommonCommand></MetaDataObject>`;
  const parsed = FP.parse(xml, '', {}, '', {
    '@global:History': common('History', 'История изменений'),
    '@global:Details': common('Details', 'Дополнительные сведения'),
    '@global:State': common('State', 'Состояние обеспечения'),
    '@global:Ship': common('Ship', 'Отгрузить'),
    '@global:DoNotSupply': common('DoNotSupply', 'Не обеспечивать'),
  });
  assert.ok(!parsed.error, parsed.error);
  const generated = parsed.model.autoCommandBar.childItems[0].childItems;
  assert.deepEqual(Array.from(generated, (item) => item.properties.Title), [
    'Дополнительные сведения',
    'История изменений',
    'Не обеспечивать',
    'Отгрузить',
    'Состояние обеспечения',
  ]);
  assert.equal(generated.filter((item) => item.properties.CommandName === 'CommonCommand.History').length, 1);
});

test('global reusable command groups follow CreateBasedOn like the reference platform segments', () => {
  const xml = `<Form><AutoCommandBar><ChildItems><ButtonGroup><CommandSource>Form</CommandSource></ButtonGroup></ChildItems></AutoCommandBar></Form>`;
  const command = (name, title, group) => `<MetaDataObject xmlns="http://v8.1c.ru/8.3/MDClasses" xmlns:v8="http://v8.1c.ru/8.1/data/core"><CommonCommand><Properties>
    <Name>${name}</Name><Synonym><v8:item><v8:lang>ru</v8:lang><v8:content>${title}</v8:content></v8:item></Synonym><Group>${group}</Group>
  </Properties></CommonCommand></MetaDataObject>`;
  const group = `<MetaDataObject xmlns="http://v8.1c.ru/8.3/MDClasses"><CommandGroup><Properties><Name>Organizer</Name><Synonym>Органайзер</Synonym><Category>FormCommandBar</Category></Properties></CommandGroup></MetaDataObject>`;
  const parsed = FP.parse(xml, '', {}, '', {
    '@global:Details': command('Details', 'Дополнительные сведения', 'FormCommandBar'),
    '@global:CreateLetter': command('CreateLetter', 'Создать письмо', 'FormCommandBarCreateBasedOn'),
    '@global:OrganizerAction': command('OrganizerAction', 'Задача', 'CommandGroup.Organizer'),
    '@group:Organizer': group,
  });
  assert.ok(!parsed.error, parsed.error);
  const generated = parsed.model.autoCommandBar.childItems[0].childItems;
  assert.deepEqual(Array.from(generated, (item) => item.properties.Title), [
    'Дополнительные сведения',
    'Создать на основании',
    'Органайзер',
  ]);
});

test('implicit global contribution precedes authored root form commands', () => {
  const xml = `<Form><AutoCommandBar><ChildItems>
    <Button name="Verify"><CommandName>Form.Command.Verify</CommandName></Button>
  </ChildItems></AutoCommandBar><Commands><Command name="Verify"><Title>Проверить</Title></Command></Commands></Form>`;
  const command = (name, title, group) => `<MetaDataObject xmlns="http://v8.1c.ru/8.3/MDClasses"><CommonCommand><Properties>
    <Name>${name}</Name><Synonym>${title}</Synonym><Group>${group}</Group>
  </Properties></CommonCommand></MetaDataObject>`;
  const group = `<MetaDataObject xmlns="http://v8.1c.ru/8.3/MDClasses"><CommandGroup><Properties>
    <Name>Organizer</Name><Synonym>Органайзер</Synonym><Category>FormCommandBar</Category>
  </Properties></CommandGroup></MetaDataObject>`;
  const parsed = FP.parse(xml, '', {}, '', {
    '@global:Details': command('Details', 'Дополнительные сведения', 'FormCommandBar'),
    '@global:CreateLetter': command('CreateLetter', 'Создать письмо', 'FormCommandBarCreateBasedOn'),
    '@global:OrganizerAction': command('OrganizerAction', 'Задача', 'CommandGroup.Organizer'),
    '@group:Organizer': group,
  });
  assert.ok(!parsed.error, parsed.error);
  assert.deepEqual(Array.from(parsed.model.autoCommandBar.childItems, (item) => item.name), [
    '_global_Details', '_global_create_based_on', '_global_group_Organizer', 'Verify',
  ]);
});

test('metadata-object commands use their full FQN and authored presentation', () => {
  const xml = `<Form><AutoCommandBar><ChildItems><ButtonGroup><CommandSource>Form</CommandSource></ButtonGroup></ChildItems></AutoCommandBar></Form>`;
  const command = `<MetaDataObject xmlns:v8="http://v8.1c.ru/8.1/data/core"><Command><Properties>
    <Name>CreatePayment</Name><Synonym><v8:item><v8:lang>ru</v8:lang><v8:content>Выплатить</v8:content></v8:item></Synonym>
    <Group>FormCommandBarImportant</Group><Representation>PictureAndText</Representation>
  </Properties></Command></MetaDataObject>`;
  const parsed = FP.parse(xml, '', {}, '', {
    '@global-fqn:DataProcessor.Payroll.Command.CreatePayment': command,
  }).model;
  const button = parsed.autoCommandBar.childItems[0].childItems.find((item) => item.name.includes('CreatePayment'));
  assert.equal(button.properties.Title, 'Выплатить');
  assert.equal(button.properties.Representation, 'pictureandtext');
  assert.equal(button.properties.CommandName, 'DataProcessor.Payroll.Command.CreatePayment');
});

test('table height modes reproduce the native form-row, table-row and content bands', () => {
  const table = (properties) => ({ tag: 'Table', properties });
  assert.equal(T.tableAuthoredHeightPx(table({ Height: '4' })), 123);
  assert.equal(T.tableAuthoredHeightPx(table({ Height: '8' })), 243);
  assert.equal(T.tableAuthoredHeightPx(table({ Height: '10' })), 303);
  assert.equal(T.tableAuthoredHeightPx(table({ Height: '8', MaxHeight: '4' })), 243);
  assert.equal(T.tableAuthoredHeightPx(table({ Height: '8', MaxHeight: '4', AutoMaxHeight: 'false' })), 123);
  assert.equal(T.tableAuthoredHeightPx(table({})), 243);
  assert.equal(T.tableAuthoredHeightPx(table({ Height: '8', HeightControlVariant: 'UseHeightInTableRows' })), 273);
  assert.equal(T.tableAuthoredHeightPx(table({ HeightControlVariant: 'InTableRows', MaxRowsCount: '4' })), 153);
  assert.equal(T.tableAuthoredHeightPx(table({ Height: '8', HeightControlVariant: 'UseContentHeight' })), 123);
  assert.equal(T.tableAuthoredHeightPx(table({ HeightControlVariant: 'ByContent' })), 123);
  assert.equal(T.tableAuthoredHeightPx(table({ HeightInTableRows: '2' })), 93);
  assert.equal(T.tableAuthoredHeightPx(table({ HeightInTableRows: '5' })), 183);
  assert.equal(T.tableHeightMetrics(table({ HeightControlVariant: 'ByContent' })).stretch, false);
});

test('authored table minimum follows the native Height mapping, independently of its name', () => {
  const samples = JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/table-height-ladder.json'), 'utf8')).heights;
  for (const { height, minimum } of samples) {
    const item = { tag: 'Table', name: 'UnrelatedName', properties: { Height: String(height) } };
    assert.equal(T.tableCalibratedMinimumHeightPx(item), minimum);
  }
  assert.equal(T.tableCalibratedMinimumHeightPx({ tag: 'Table', properties: {
    Height: '8', MaxHeight: '4', AutoMaxHeight: 'false' } }), 94);
  assert.equal(T.tableCalibratedMinimumHeightPx({ tag: 'Table', properties: { Height: '8', Header: 'false' } }), 93);
});

test('table minimum covers row modes, stacked headers, footer and explicit fonts', () => {
  const minimum = (properties, childItems = []) => T.tableCalibratedMinimumHeightPx({ tag: 'Table', properties, childItems });
  assert.equal(minimum({ HeightInTableRows: '2' }), 63);
  assert.equal(minimum({ HeightInTableRows: '5' }), 125);
  assert.equal(minimum({ HeightControlVariant: 'InTableRows', MaxRowsCount: '4' }), 125);
  assert.equal(minimum({ HeightControlVariant: 'ByContent' }), 123);
  assert.equal(minimum({ Height: '4', HeaderHeight: '2' }), 63);
  assert.equal(T.tableAuthoredHeightPx({ tag: 'Table', properties: { Height: '4', HeaderHeight: '2' } }), 124);
  assert.equal(minimum({ Height: '4', Footer: 'true', FooterHeight: '2' }), 32);
  assert.equal(T.tableAuthoredHeightPx({ tag: 'Table', properties: { Height: '4', Footer: 'true', FooterHeight: '2' } }), 126);
  const bodyFont = [{ tag: 'InputField', properties: { FontSpec: { height: 14 } } }];
  const headerFont = [{ tag: 'InputField', properties: { TitleFontSpec: { height: 14 } } }];
  assert.equal(T.tableAuthoredHeightPx({ tag: 'Table', properties: { Height: '4' }, childItems: bodyFont }), 153);
  assert.equal(minimum({ Height: '4' }, bodyFont), 123);
  assert.equal(T.tableAuthoredHeightPx({ tag: 'Table', properties: { Height: '4' }, childItems: headerFont }), 133);
  assert.equal(minimum({ Height: '4' }, headerFont), 104);
  const grouped = [{ tag: 'ColumnGroup', properties: { Group: 'Horizontal', ShowInHeader: 'true' },
    childItems: [{ tag: 'InputField', properties: {} }, { tag: 'InputField', properties: {} }] }];
  assert.equal(T.tableHeightMetrics({ tag: 'Table', properties: { Height: '4' }, childItems: grouped }).headerRows, 2);
});

test('page disclosure sections qualify only their preceding authored table subtree for chrome cadence', () => {
  const pictureLabelRow = () => ({ tag: 'UsualGroup', properties: { Group: 'AlwaysHorizontal' }, childItems: [
    { tag: 'PictureDecoration', properties: {} }, { tag: 'LabelField', properties: {} },
  ] });
  const tableHost = { tag: 'UsualGroup', properties: { Group: 'Vertical' }, childItems: [
    { tag: 'Table', properties: { HeightInTableRows: '4' } },
  ] };
  const page = { tag: 'Page', properties: {}, childItems: [
    tableHost, pictureLabelRow(), { tag: 'UsualGroup', properties: { Group: 'Vertical' }, childItems: [] },
    pictureLabelRow(), { tag: 'LabelDecoration', properties: {} },
  ] };
  assert.equal(T.isPictureLabelDisclosureRow(page.childItems[1]), true);
  assert.equal(T.containsAuthoredHeightTable(tableHost), true);
  assert.equal(T.pageTableChromeCadenceChildren(page)[0], tableHost);
  page.childItems[3].childItems.reverse();
  assert.equal(T.pageTableChromeCadenceChildren(page).length, 0,
    'an arbitrary picture/label group must not activate the table cadence');
});

test('vertical authored-width pressure is detected before flex compression', () => {
  function fakeNode(classes) {
    const set = new Set(classes.split(/\s+/).filter(Boolean));
    return {
      classList: { contains: (name) => set.has(name) },
      dataset: {},
      parentNode: null,
      clientWidth: 0,
      querySelectorAll: () => []
    };
  }
  const parent = fakeNode('fp-body');
  parent.clientWidth = 400;
  const field = fakeNode('fp-item fp-hstretch');
  field.dataset.fpAuthoredNormalWidth = '410';
  field.dataset.tag = 'InputField';
  field.parentNode = parent;
  const body = fakeNode('fp-body');
  body.querySelectorAll = () => [field];
  let pressure = T.verticalFieldPriorityPressure(body);
  assert.equal(pressure.smartCompressToMinWidth, true);
  assert.equal(pressure.compressWidth, false);
  parent.clientWidth = 480;
  pressure = T.verticalFieldPriorityPressure(body);
  assert.equal(pressure.smartCompressToMinWidth, false);
  assert.equal(pressure.compressWidth, false);
});

test('a multi-control action row does not join its surrounding field-label column', () => {
  function fakeNode(classes) {
    const set = new Set(String(classes || '').split(/\s+/).filter(Boolean));
    return {
      classList: { contains: (c) => set.has(c) }, dataset: {}, children: [], textContent: '',
      querySelector(sel) {
        const cls = String(sel).replace(/^\./, '');
        const stack = this.children.slice();
        while (stack.length) {
          const cur = stack.shift();
          if (cur.classList && cur.classList.contains(cls)) return cur;
          if (cur.children && cur.children.length) stack.push(...cur.children);
        }
        return null;
      }
    };
  }
  function field(labelText) {
    const item = fakeNode('fp-item fp-control');
    const row = fakeNode('fp-field-row');
    const label = fakeNode('fp-field-label');
    label.textContent = labelText;
    row.children = [label];
    item.children = [row];
    return item;
  }
  const actionRow = fakeNode('fp-children fp-children-horizontal');
  actionRow.children = [field('Статус:'), fakeNode('fp-item fp-control')];
  const group = fakeNode('fp-item fp-container');
  group.children = [actionRow];
  const root = fakeNode('');
  root.children = [group];

  assert.equal(T.collectFieldLabels(root, true).length, 0);
});

test('compound field rows join the surrounding field-label column', () => {
  function fakeNode(classes, tag = '') {
    const set = new Set(String(classes || '').split(/\s+/).filter(Boolean));
    return {
      classList: { contains: (c) => set.has(c) }, dataset: tag ? { tag } : {}, children: [], textContent: '',
      querySelector(sel) {
        const cls = String(sel).replace(/^\./, '');
        const stack = this.children.slice();
        while (stack.length) {
          const cur = stack.shift();
          if (cur.classList && cur.classList.contains(cls)) return cur;
          if (cur.children && cur.children.length) stack.push(...cur.children);
        }
        return null;
      }
    };
  }
  function field(labelText) {
    const item = fakeNode('fp-item fp-control', 'InputField');
    const row = fakeNode('fp-field-row');
    const label = fakeNode('fp-field-label');
    label.textContent = labelText;
    row.children = [label];
    item.children = [row];
    return item;
  }
  const numberDateRow = fakeNode('fp-children fp-children-horizontal fp-container-bare');
  numberDateRow.children = [field('Номер:'), field('от:')];
  const group = fakeNode('fp-item fp-container', 'UsualGroup');
  group.children = [numberDateRow];
  const root = fakeNode('');
  root.children = [group];

  assert.deepEqual(Array.from(T.collectFieldLabels(root, true), (label) => label.textContent), ['Номер:']);
});

test('a compound field row with a trailing action still joins the label column', () => {
  function fakeNode(classes) {
    const set = new Set(String(classes || '').split(/\s+/).filter(Boolean));
    return {
      classList: { contains: (c) => set.has(c) }, dataset: {}, children: [], textContent: '',
      querySelector(sel) {
        const cls = String(sel).replace(/^\./, '');
        const stack = this.children.slice();
        while (stack.length) {
          const cur = stack.shift();
          if (cur.classList && cur.classList.contains(cls)) return cur;
          if (cur.children && cur.children.length) stack.push(...cur.children);
        }
        return null;
      }
    };
  }
  function field(labelText = '') {
    const item = fakeNode('fp-item fp-control');
    const row = fakeNode('fp-field-row');
    if (labelText) {
      const label = fakeNode('fp-field-label');
      label.textContent = labelText;
      row.children = [label];
    }
    item.children = [row];
    return item;
  }
  const totalsRow = fakeNode('fp-children fp-children-horizontal fp-container-bare');
  totalsRow.children = [field('Выполнено:'), field(), fakeNode('fp-item fp-control')];
  const group = fakeNode('fp-item fp-container');
  group.children = [totalsRow];
  const root = fakeNode('');
  root.children = [group];

  assert.deepEqual(Array.from(T.collectFieldLabels(root, true), (label) => label.textContent), ['Выполнено:']);
});

test('a field with a trailing picture affordance joins the label column', () => {
  function fakeNode(classes, tag = '') {
    const set = new Set(String(classes || '').split(/\s+/).filter(Boolean));
    return {
      classList: { contains: (c) => set.has(c) }, dataset: tag ? { tag } : {}, children: [], textContent: '',
      querySelector(sel) {
        const cls = String(sel).replace(/^\./, '');
        const stack = this.children.slice();
        while (stack.length) {
          const cur = stack.shift();
          if (cur.classList && cur.classList.contains(cls)) return cur;
          if (cur.children && cur.children.length) stack.push(...cur.children);
        }
        return null;
      }
    };
  }
  const field = fakeNode('fp-item fp-control', 'InputField');
  const row = fakeNode('fp-field-row');
  const label = fakeNode('fp-field-label');
  label.textContent = 'Телефон:';
  row.children = [label];
  field.children = [row];
  const phoneRow = fakeNode('fp-children fp-children-horizontal fp-container-bare');
  phoneRow.children = [field, fakeNode('fp-item fp-control', 'PictureDecoration')];
  const group = fakeNode('fp-item fp-container', 'UsualGroup');
  group.children = [phoneRow];
  const root = fakeNode('');
  root.children = [group];

  assert.deepEqual(Array.from(T.collectFieldLabels(root, true), (item) => item.textContent), ['Телефон:']);
});

test('a highlighted field block keeps its label column local', () => {
  const label = { textContent: 'Запланировано:' };
  const row = {
    classList: { contains: (c) => c === 'fp-field-row' },
    querySelector: (sel) => sel === '.fp-field-label' ? label : null,
  };
  const control = {
    classList: { contains: (c) => c === 'fp-control' },
    dataset: {}, children: [row], querySelector: (sel) => sel === '.fp-field-row' ? row : null,
  };
  const inner = {
    classList: { contains: (c) => c === 'fp-children-vertical' },
    children: [control], querySelector: () => null,
  };
  const card = {
    classList: { contains: (c) => c === 'fp-container' || c === 'fp-tooltip-bg' },
    dataset: {}, children: [inner], querySelector: (sel) => sel === '.fp-children' ? inner : null,
  };
  const root = { children: [card] };

  assert.equal(T.collectFieldLabels(root, true).length, 0);
});

test('a column containing an explicitly fixed-width field preserves that basis', () => {
  const fixed = { tag: 'InputField', properties: { Width: '11', HorizontalStretch: 'false' } };
  const column = { tag: 'UsualGroup', properties: { Group: 'Vertical' }, childItems: [fixed] };
  const fluid = { tag: 'UsualGroup', properties: { Group: 'Vertical' }, childItems: [
    { tag: 'InputField', properties: { MaxWidth: '31' } }
  ] };
  assert.equal(T.hasFixedHorizontalSize(column), true);
  assert.equal(T.hasFixedHorizontalSize(fluid), false);
});

test('explanatory decoration before a button group is not a field-column label', () => {
  function fakeNode(classes, tag = '') {
    const set = new Set(String(classes || '').split(/\s+/).filter(Boolean));
    return {
      classList: { contains: (c) => set.has(c) },
      dataset: tag ? { tag } : {},
      children: [],
      textContent: '',
      querySelector(sel) {
        const cls = String(sel).replace(/^\./, '');
        const stack = this.children.slice();
        while (stack.length) {
          const cur = stack.shift();
          if (cur.classList && cur.classList.contains(cls)) return cur;
          if (cur.children && cur.children.length) stack.push(...cur.children);
        }
        return null;
      }
    };
  }
  function decoration(text) {
    const item = fakeNode('fp-item fp-control', 'LabelDecoration');
    const label = fakeNode('fp-label fp-label-decoration');
    label.textContent = text;
    item.children = [label];
    return item;
  }
  function field(titleClass, labelText = '') {
    const item = fakeNode('fp-item fp-control', 'InputField');
    const row = fakeNode(`fp-field-row ${titleClass}`);
    if (labelText) {
      const label = fakeNode('fp-field-label');
      label.textContent = labelText;
      row.children = [label];
    }
    item.children = [row];
    return item;
  }

  const dateRow = fakeNode('fp-children fp-children-horizontal');
  dateRow.children = [field('fp-title-left', 'Дата:')];
  const dateGroup = fakeNode('fp-item fp-container');
  dateGroup.children = [dateRow];

  const warningRow = fakeNode('fp-children fp-children-horizontal');
  warningRow.children = [
    fakeNode('fp-item fp-control', 'PictureDecoration'),
    decoration('Требуется доначисление или перерасчет зарплаты'),
    fakeNode('fp-item fp-container', 'UsualGroup')
  ];
  const warningGroup = fakeNode('fp-item fp-container');
  warningGroup.children = [warningRow];

  const explicitRow = fakeNode('fp-children fp-children-horizontal');
  explicitRow.children = [decoration('Организация:'), field('fp-title-none')];
  const explicitGroup = fakeNode('fp-item fp-container');
  explicitGroup.children = [explicitRow];

  const root = fakeNode('');
  root.children = [dateGroup, warningGroup, explicitGroup];
  const labels = Array.from(T.collectFieldLabels(root, true), (label) => label.textContent);

  assert.deepEqual(labels, ['Дата:', 'Организация:']);
  assert.ok(!labels.some((label) => label.includes('перерасчет')),
    'an explanatory warning followed by a group is not a field title');
});

test('a form without the platform command bar opens on the native top inset', () => {
  /* The reference starts the platform AutoCommandBar on the window chrome line, so the
   * body spends no top inset on it. A form that publishes no such bar opens
   * its first ordinary row on the native inset instead: bar-less
   * documents (including one whose posting bar is an
   * authored body row) put that row at y=35, not on the chrome line. */
  assert.equal(T.bodyOwnsContentTopInset('AutoCommandBar'), false);
  assert.equal(T.bodyOwnsContentTopInset('UsualGroup'), true);
  assert.equal(T.bodyOwnsContentTopInset('CommandBar'), true);
  assert.equal(T.bodyOwnsContentTopInset(''), true);
  assert.equal(T.bodyOwnsContentTopInset(undefined), true);
});

test('a ReadOnly editor paints no interactive chrome', () => {
  /* The reference paints a ReadOnly editor as a plain box: totals rows
   * carry no choice affordance, while the
   * same authored ChoiceButton on a writable field still paints one. */
  const readOnly = { tag: 'InputField', properties: { ReadOnly: 'true', ChoiceButton: 'true' }, childItems: [] };
  const writable = { tag: 'InputField', properties: { ChoiceButton: 'true' }, childItems: [] };
  /* vm realm Array: compare through JSON, deepEqual rejects arrays from another realm. */
  const kinds = (item) => JSON.parse(JSON.stringify(T.inputButtonKinds(item, {})));
  assert.deepEqual(kinds(writable), ['dots']);
  assert.deepEqual(kinds(readOnly), []);
});

test('an item picture file resolves by its owner name through the shared picture map', () => {
  const xml = `<Form xmlns="http://v8.1c.ru/8.3/xcf/logform" xmlns:xr="http://v8.1c.ru/8.3/xcf/readable">
    <AutoCommandBar name="Bar" id="-1"><ChildItems>
      <Button name="Filter" id="1"><Type>CommandBarButton</Type><Representation>PictureAndText</Representation>
        <Picture><xr:Abs>Picture.bmp</xr:Abs><xr:LoadTransparent>false</xr:LoadTransparent></Picture></Button>
    </ChildItems></AutoCommandBar></Form>`;
  const parsed = FP.parse(xml);
  assert.ok(!parsed.error, parsed.error);
  const button = parsed.model.autoCommandBar.childItems[0];
  assert.equal(T.pictureRef(button), '@item:Filter/Picture.bmp');
  const ctx = { commonPictures: { '@item:Filter/Picture.bmp': { mime: 'image/bmp', data: 'Qk0=' } } };
  assert.equal(T.commonPictureResource(T.pictureRef(button), ctx).mime, 'image/bmp');
  assert.equal(T.commonPictureResource('@item:Other/Picture.bmp', ctx), null);
});

test('command TextPicture and hyperlink Picture representations reach the button', () => {
  const ctx = {
    commands: {
      Exchange: { tag: 'Command', name: 'Exchange', properties: { Representation: 'TextPicture', Picture: 'CommonPicture.Exchange' } },
      Post: { tag: 'Command', name: 'Post', properties: { Representation: 'TextPicture', Picture: 'StdPicture.Post' } },
      Settings: { tag: 'Command', name: 'Settings', properties: { Representation: 'Picture', Picture: 'StdPicture.Setting' } }
    }
  };
  const bar = (name) => ({ tag: 'Button', name, properties: { Type: 'CommandBarButton', CommandName: `Form.Command.${name}` } });
  assert.equal(T.resolveButtonRep(bar('Exchange'), ctx), 'pictureandtext');
  /* Taxi keeps posting commands textual («Провести»). */
  assert.equal(T.resolveButtonRep(bar('Post'), ctx), 'text');
  const link = { tag: 'Button', name: 'Settings', properties: { Type: 'Hyperlink', CommandName: 'Form.Command.Settings' } };
  assert.equal(T.resolveButtonRep(link, ctx), 'picture');
  assert.equal(T.iconIdFromRef('StdPicture.Setting'), 'settings');
});

test('a hyperlink showing only a command StdPicture paints nothing without an authored size', () => {
  const xml = `<Form xmlns="http://v8.1c.ru/8.3/xcf/logform" xmlns:xr="http://v8.1c.ru/8.3/xcf/readable"><ChildItems>
    <Button name="Details" id="1"><Type>Hyperlink</Type><CommandName>Form.Command.Details</CommandName></Button>
    <Button name="Sized" id="2"><Type>Hyperlink</Type><Height>1</Height><CommandName>Form.Command.Details</CommandName></Button>
    <Button name="Common" id="3"><Type>Hyperlink</Type><CommandName>Form.Command.Refill</CommandName></Button>
  </ChildItems><Commands>
    <Command name="Details" id="1"><Picture><xr:Ref>StdPicture.Change</xr:Ref></Picture><Representation>Picture</Representation></Command>
    <Command name="Refill" id="2"><Picture><xr:Ref>CommonPicture.Refill</xr:Ref></Picture><Representation>Picture</Representation></Command>
  </Commands></Form>`;
  const parsed = FP.parse(xml);
  assert.ok(!parsed.error, parsed.error);
  const [details, sized, common] = parsed.model.childItemsRoot;
  /* The first picture is absent in the reference; «Настройки»
   * (Height=1) and a CommonPicture hyperlink are painted. */
  assert.equal(details._fpUnpaintedPicture, true);
  assert.equal(details.properties.Visible, undefined);
  assert.equal(sized._fpUnpaintedPicture, undefined);
  assert.equal(common._fpUnpaintedPicture, undefined);
});

test('a table search command outside its own bar stays unresolved and textual', () => {
  const xml = `<Form xmlns="http://v8.1c.ru/8.3/xcf/logform"><ChildItems>
    <CommandBar name="Commands" id="1"><ChildItems>
      <Button name="ListFindButton" id="2"><Type>CommandBarButton</Type>
        <CommandName>Form.Item.List.StandardCommand.Find</CommandName></Button>
    </ChildItems></CommandBar>
    <Table name="List" id="3"><AutoCommandBar name="ListBar" id="4"><ChildItems>
      <Button name="ListOwnFind" id="5"><Type>CommandBarButton</Type>
        <CommandName>Form.Item.List.StandardCommand.Find</CommandName></Button>
    </ChildItems></AutoCommandBar></Table>
  </ChildItems></Form>`;
  const parsed = FP.parse(xml);
  assert.ok(!parsed.error, parsed.error);
  const foreign = parsed.model.childItemsRoot[0].childItems[0];
  const own = parsed.model.childItemsRoot[1].autoCommandBar.childItems[0];
  assert.equal(T.titleOf(foreign, {}), 'ListFindButton');
  assert.equal(T.resolveButtonRep(foreign, { commands: {} }), 'text');
  /* The reference input: repres="Text", «Найти...». */
  assert.equal(T.titleOf(own, {}), 'Найти...');
  assert.equal(T.resolveButtonRep(own, { commands: {} }), 'text');
});

test('an adopted extension form inherits omitted item properties and attributes from the configuration form', () => {
  const ns = 'xmlns="http://v8.1c.ru/8.3/xcf/logform" xmlns:v8="http://v8.1c.ru/8.1/data/core" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"';
  const extension = `<Form ${ns} version="2.20"><ChildItems>
    <InputField name="Владелец" id="3"><EditMode>EnterOnInput</EditMode></InputField>
    <InputField name="Комментарий" id="4"><Width>40</Width></InputField>
    <InputField name="Код" id="5"/>
  </ChildItems><Attributes/>
  <BaseForm version="2.20"><ChildItems>
    <InputField name="Владелец" id="3"><EditMode>EnterOnInput</EditMode></InputField>
    <InputField name="Комментарий" id="4"><Width>20</Width></InputField>
    <InputField name="Код" id="5"><Visible>false</Visible></InputField>
  </ChildItems><Attributes/></BaseForm></Form>`;
  const configuration = `<Form ${ns} version="2.20"><ChildItems>
    <InputField name="Владелец" id="3"><DataPath>Объект.Owner</DataPath><EditMode>EnterOnInput</EditMode></InputField>
    <InputField name="Комментарий" id="4"><DataPath>Объект.Комментарий</DataPath><Width>30</Width></InputField>
    <InputField name="Код" id="5"><DataPath>Объект.Code</DataPath><Visible>false</Visible></InputField>
  </ChildItems><Attributes>
    <Attribute name="Объект" id="1"><Type><v8:Type>cfg:CatalogObject.Контрагенты</v8:Type></Type><MainAttribute>true</MainAttribute></Attribute>
  </Attributes></Form>`;
  const { model } = FP.parse(extension, '', {}, configuration);
  const [owner, comment, code] = model.childItemsRoot;
  assert.equal(owner.properties.DataPath, 'Объект.Owner');
  // The extension changed Width against its snapshot: its own value wins.
  assert.equal(comment.properties.Width, '40');
  assert.equal(comment.properties.DataPath, 'Объект.Комментарий');
  // Visible was in the snapshot and the extension dropped it: the extension reset it.
  assert.equal(code.properties.Visible, undefined);
  assert.equal(code.properties.DataPath, 'Объект.Code');
  assert.equal(model.adoptedForm, true);
  assert.equal(model.attributes.length, 0);
  assert.equal(T.formObjectKind ? T.formObjectKind(model) : 'catalog', 'catalog');
});

test('platform library pictures resolve to shipped std-pictures files', async () => {
  const { readdirSync } = await import('node:fs');
  const dir = new URL('../packages/1c-preview-core/browser/std-pictures/', import.meta.url);
  const files = new Set(readdirSync(dir));
  const file = (ref) => T.stdPictureUrl(ref).replace(/^std-pictures\//, '');
  assert.equal(file('StdPicture.Write'), 'Zapisat.png');
  assert.equal(file('StdPicture.DataSearch'), 'PoiskDannykh.svg');
  assert.equal(file('БиблиотекаКартинок.ПереместитьВправо'), 'PeremestitVpravo.png');
  for (const name of files) assert.match(name, /^[!-~]+$/, 'ASCII file name (VS Code Marketplace): ' + name);
  assert.equal(T.stdPictureUrl('StdPicture.NoSuchPictureAnywhere'), '');
  assert.equal(T.stdPictureUrl('CommonPicture.Записать'), '');
  for (const ref of ['Print', 'MoveLeft', 'Replace', 'WriteAndClose', 'Post', 'MarkToDelete', 'Information', 'Change', 'InputFieldOpen', 'CloneListItem'])
    assert.ok(files.has(file('StdPicture.' + ref)), ref);
});

test('hidden columns and column groups do not own table header rows', () => {
  const ns = 'xmlns="http://v8.1c.ru/8.3/xcf/logform"';
  const xml = `<Form ${ns} version="2.20"><ChildItems><Table name="Журнал" id="1"><ChildItems>
    <LabelField name="Дата" id="2"><DataPath>Журнал.Дата</DataPath></LabelField>
    <LabelField name="Сеанс" id="8"><DataPath>Журнал.Сеанс</DataPath><Visible>false</Visible></LabelField>
    <ColumnGroup name="ГруппаСобытие" id="3"><ChildItems>
      <LabelField name="Событие" id="4"><DataPath>Журнал.Событие</DataPath></LabelField>
      <LabelField name="Комментарий" id="5"><DataPath>Журнал.Комментарий</DataPath><Visible>false</Visible></LabelField>
    </ChildItems></ColumnGroup>
    <ColumnGroup name="ГруппаСервер" id="6"><Visible>false</Visible><ChildItems>
      <LabelField name="Сервер" id="7"><DataPath>Журнал.Сервер</DataPath></LabelField>
    </ChildItems></ColumnGroup>
  </ChildItems></Table></ChildItems></Form>`;
  const table = FP.parse(xml).model.childItemsRoot[0];
  const columns = T.tableColumns(table);
  assert.deepEqual(Array.from(columns, (c) => c.name), ['Дата', 'ГруппаСобытие']);
  assert.deepEqual(Array.from(T.headerKids(columns[1]), (c) => c.name), ['Событие']);
});

test('ShowAuto tooltips are shown below the item and value tables use row-set commands', () => {
  assert.equal(T.tooltipRepresentation({ properties: { ToolTipRepresentation: 'ShowAuto' } }), 'bottom');
  assert.equal(T.tooltipRepresentation({ properties: { ToolTipRepresentation: 'Auto' } }), 'auto');
  const ns = 'xmlns="http://v8.1c.ru/8.3/xcf/logform" xmlns:v8="http://v8.1c.ru/8.1/data/core"';
  const xml = `<Form ${ns} version="2.20"><ChildItems>
    <Table name="Аналитика" id="1"><Representation>List</Representation><DataPath>Аналитика</DataPath></Table>
  </ChildItems><Attributes>
    <Attribute name="Аналитика" id="1"><Type><v8:Type>v8:ValueTable</v8:Type></Type></Attribute>
  </Attributes></Form>`;
  const { model } = FP.parse(xml);
  assert.equal(T.tableIsList(model.childItemsRoot[0], model), false);
});

test('an adopted extension form resolves its command bar and a changed data field kind from the configuration', () => {
  const ns = 'xmlns="http://v8.1c.ru/8.3/xcf/logform"';
  const extension = `<Form ${ns} version="2.20">
    <AutoCommandBar name="ФормаКоманднаяПанель" id="-1"><ChildItems>
      <Button name="ФормаПровестиИЗакрыть" id="2"><Type>CommandBarButton</Type><CommandName>0</CommandName></Button>
    </ChildItems></AutoCommandBar>
    <ChildItems><InputField name="ДокументОснование" id="19"/></ChildItems><Attributes/>
    <BaseForm version="2.20">
      <AutoCommandBar name="ФормаКоманднаяПанель" id="-1"><ChildItems>
        <Button name="ФормаПровестиИЗакрыть" id="2"><Type>CommandBarButton</Type><CommandName>0</CommandName></Button>
      </ChildItems></AutoCommandBar>
      <ChildItems><LabelField name="ДокументОснование" id="19"/></ChildItems><Attributes/>
    </BaseForm></Form>`;
  const configuration = `<Form ${ns} version="2.20">
    <AutoCommandBar name="ФормаКоманднаяПанель" id="-1"><ChildItems>
      <Button name="ФормаПровестиИЗакрыть" id="2"><Type>CommandBarButton</Type><CommandName>Form.Command.ПровестиИЗакрыть</CommandName></Button>
    </ChildItems></AutoCommandBar>
    <ChildItems><LabelField name="ДокументОснование" id="19"><DataPath>Объект.ДокументОснование</DataPath></LabelField></ChildItems></Form>`;
  const { model } = FP.parse(extension, '', {}, configuration);
  assert.equal(model.childItemsRoot[0].tag, 'InputField');
  assert.equal(model.childItemsRoot[0].properties.DataPath, 'Объект.ДокументОснование');
  assert.equal(model.autoCommandBar.childItems[0].properties.CommandName, 'Form.Command.ПровестиИЗакрыть');
});
