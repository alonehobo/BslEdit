import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWebModules } from './helpers/dom.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sandbox = loadWebModules(root, ['xml-util.js', 'template-preview.js', 'template-markup.js']);
const TM = sandbox.window.TemplateMarkup;
const TP = sandbox.window.TemplatePreview;
const plain = (v) => JSON.parse(JSON.stringify(v));

const sample = fs.readFileSync(path.join(root, 'testdata', 'Template.xml'), 'utf8');

/* Rows 1..3, a range row 4..6 and a sparse row with an <i> jump. */
const mini = [
  '\uFEFF<?xml version="1.0" encoding="UTF-8"?>',
  '<document xmlns="http://v8.1c.ru/8.2/data/spreadsheet" xmlns:v8="http://v8.1c.ru/8.1/data/core" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">',
  '\t<languageSettings>',
  '\t\t<currentLanguage>ru</currentLanguage>',
  '\t\t<defaultLanguage>ru</defaultLanguage>',
  '\t</languageSettings>',
  '\t<columns>',
  '\t\t<size>4</size>',
  '\t</columns>',
  '\t<rowsItem>',
  '\t\t<index>0</index>',
  '\t\t<row>',
  '\t\t\t<c>',
  '\t\t\t\t<c>',
  '\t\t\t\t\t<f>1</f>',
  '\t\t\t\t\t<tl>',
  '\t\t\t\t\t\t<v8:item>',
  '\t\t\t\t\t\t\t<v8:lang>ru</v8:lang>',
  '\t\t\t\t\t\t\t<v8:content>Номер</v8:content>',
  '\t\t\t\t\t\t</v8:item>',
  '\t\t\t\t\t</tl>',
  '\t\t\t\t</c>',
  '\t\t\t</c>',
  '\t\t\t<c>',
  '\t\t\t\t<i>3</i>',
  '\t\t\t\t<c>',
  '\t\t\t\t\t<f>1</f>',
  '\t\t\t\t</c>',
  '\t\t\t</c>',
  '\t\t</row>',
  '\t</rowsItem>',
  '\t<rowsItem>',
  '\t\t<index>3</index>',
  '\t\t<indexTo>5</indexTo>',
  '\t\t<row>',
  '\t\t\t<empty>true</empty>',
  '\t\t</row>',
  '\t</rowsItem>',
  '\t<templateMode>true</templateMode>',
  '\t<height>6</height>',
  '\t<vgRows>6</vgRows>',
  '\t<merge>',
  '\t\t<r>0</r>',
  '\t\t<c>1</c>',
  '\t\t<w>1</w>',
  '\t</merge>',
  '\t<font faceName="Arial" height="8" bold="false" italic="false" underline="false" strikeout="false" kind="Absolute" scale="100"/>',
  '\t<format>',
  '\t\t<font>0</font>',
  '\t\t<horizontalAlignment>Center</horizontalAlignment>',
  '\t\t<textPlacement>Wrap</textPlacement>',
  '\t</format>',
  '</document>'
].join('\r\n');

function model(xml) {
  const parsed = TP.parse(xml);
  assert.equal(parsed.error, undefined, parsed.error);
  return parsed.model;
}

test('an untouched template serializes back byte for byte', () => {
  for (const xml of [sample, mini]) {
    assert.equal(TM._test.toXml(TM._test.parse(xml), xml), xml);
  }
});

test('lists areas, parameters and template cells with 1-based positions', () => {
  const listed = plain(TM.listMarkup(sample));
  assert.equal(listed.rows, 60);
  assert.deepEqual(listed.areas.find((a) => a.name === 'Итого'), { name: 'Итого', type: 'Rows', beginRow: 20, endRow: 20, parameters: ['ИтогоСтоимость', 'ИтогоСуммаНДС', 'ИтогоВсего'] });
  assert.deepEqual(listed.areas.find((a) => a.name === 'КартинкаШтрихкода'), { name: 'КартинкаШтрихкода', type: 'Drawing' });
  assert.ok(listed.parameters.some((p) => p.name === 'Номер' && p.row === 2));
  assert.ok(listed.templates.length >= 1);
});

test('set_area adds, replaces and removes named areas of every kind', () => {
  let { xml, result } = TM.setArea(mini, { name: 'Шапка', beginRow: 1, endRow: 2 });
  assert.deepEqual(plain(result), { area: { name: 'Шапка', type: 'Rows', beginRow: 1, endRow: 2 }, replaced: false });
  ({ xml } = TM.setArea(xml, { name: 'Колонки', beginColumn: 2, endColumn: 3 }));
  ({ xml, result } = TM.setArea(xml, { name: 'Шапка', beginRow: 1, endRow: 1, beginColumn: 1, endColumn: 4 }));
  assert.equal(result.replaced, true);
  assert.ok(xml.indexOf('</merge>') < xml.indexOf('<namedItem'), 'areas follow merges, as Designer writes them');
  assert.ok(xml.indexOf('</namedItem>') < xml.indexOf('<font '));

  const areas = plain(model(xml).namedItems.map(({ name, type, beginRow, endRow, beginColumn, endColumn }) => ({ name, type, beginRow, endRow, beginColumn, endColumn })));
  assert.deepEqual(areas, [
    { name: 'Колонки', type: 'Columns', beginRow: -1, endRow: -1, beginColumn: 1, endColumn: 2 },
    { name: 'Шапка', type: 'Rectangle', beginRow: 0, endRow: 0, beginColumn: 0, endColumn: 3 }
  ]);

  ({ xml } = TM.setArea(xml, { name: 'Колонки', remove: true }));
  assert.deepEqual(plain(TM.listMarkup(xml).areas.map((a) => a.name)), ['Шапка']);
  assert.throws(() => TM.setArea(xml, { name: 'Нет', remove: true }), /нет области/);
  assert.throws(() => TM.setArea(xml, { name: '1Плохое', beginRow: 1 }), /идентификатором/);
  assert.throws(() => TM.setArea(xml, { name: 'Пусто' }), /Укажите строки/);
  assert.throws(() => TM.setArea(xml, { name: 'Наоборот', beginRow: 3, endRow: 1 }), /меньше/);
  assert.match(xml, /\r\n\t<namedItem xsi:type="NamedItemCells">\r\n/, 'CRLF structure is kept');
});

test('set_parameter turns a text cell into a parameter and keeps its look', () => {
  const { xml, result } = TM.setParameter(mini, { row: 1, column: 1, name: 'НомерДокумента' });
  assert.equal(result.fillType, 'Parameter');
  assert.equal(result.previous.text, 'Номер');
  const m = model(xml);
  const cell = m.rows[0].cells[0];
  assert.equal(cell.parameter, 'НомерДокумента');
  assert.equal(cell.text, '');
  const fmt = m.formats[cell.formatIndex - 1];
  assert.equal(fmt.fillType, 'Parameter');
  assert.equal(fmt.horizontalAlignment, 'Center', 'the copied format keeps the original look');
  assert.equal(m.formats[0].fillType, undefined, 'the shared original format is left alone');
  assert.match(xml, /<textPlacement>Wrap<\/textPlacement>\r\n\t\t<fillType>Parameter<\/fillType>/, 'fillType goes after textPlacement');

  const again = TM.setParameter(xml, { row: 1, column: 1, name: 'Другой' }).xml;
  assert.equal((again.match(/<format>/g) || []).length, 2, 'an identical parameter format is reused');
});

test('set_parameter fills missing cells, split range rows and keeps column indexes', () => {
  let { xml } = TM.setParameter(mini, { row: 1, column: 3, template: 'от [Дата]' });
  let m = model(xml);
  assert.deepEqual(plain(m.rows[0].cells.map((c) => [c.col, c.text, c.parameter])), [[0, 'Номер', ''], [2, 'от [Дата]', ''], [3, '', '']]);
  assert.equal(m.formats[m.rows[0].cells[1].formatIndex - 1].fillType, 'Template');

  ({ xml } = TM.setParameter(xml, { row: 5, column: 2, name: 'Сумма' }));
  m = model(xml);
  assert.equal(m.rows[4].cells[0].col, 1);
  assert.equal(m.rows[4].cells[0].parameter, 'Сумма');
  assert.equal(m.rows[3].empty, true);
  assert.equal(m.rows[5].empty, true, 'the rest of the range stays empty');
  assert.match(xml, /<index>3<\/index>\r\n\t\t<row>/);
  assert.match(xml, /<index>5<\/index>\r\n\t\t<row>/);

  ({ xml } = TM.setParameter(xml, { row: 8, column: 6, name: 'Дальше' }));
  m = model(xml);
  assert.equal(m.height, 8, 'height grows to the new row');
  assert.equal(m.rows[7].cells[0].col, 5);
  assert.match(xml, /<size>6<\/size>/, 'the column count grows too');

  ({ xml } = TM.setParameter(xml, { row: 1, column: 3, text: 'просто текст' }));
  m = model(xml);
  assert.equal(m.rows[0].cells[1].text, 'просто текст');
  assert.equal(m.formats[m.rows[0].cells[1].formatIndex - 1].fillType, undefined);
});

test('set_parameter validates its arguments', () => {
  assert.throws(() => TM.setParameter(mini, { row: 1, column: 1 }), /Передайте одно из/);
  assert.throws(() => TM.setParameter(mini, { row: 1, column: 1, name: 'А', text: 'Б' }), /Передайте одно из/);
  assert.throws(() => TM.setParameter(mini, { row: 0, column: 1, name: 'А' }), /row/);
  assert.throws(() => TM.setParameter(mini, { row: 1, column: 1, template: 'без параметров' }), /нет ни одного/);
  assert.throws(() => TM.setParameter('<root/>', { row: 1, column: 1, name: 'А' }), /не табличный документ/);
});

test('list_markup groups parameters by area, with drill-down, template names and intersections', () => {
  const listed = plain(TM.listMarkup(sample));
  const names = listed.areas.map((a) => a.name);
  assert.ok(names.indexOf('Шапка') < names.indexOf('Строка') && names.indexOf('Строка') < names.indexOf('Подвал'), 'areas go top to bottom');
  const header = listed.areas.find((a) => a.name === 'Шапка');
  assert.ok(header.parameters.includes('ПредставлениеПоставщика'));
  const supplier = listed.parameters.find((p) => p.name === 'ПредставлениеПоставщика');
  assert.equal(supplier.detail, 'Поставщик');
  assert.deepEqual(supplier.areas, ['Шапка']);
  const sheet = listed.templates.find((t) => t.text === 'Лист [НомерЛиста]');
  assert.deepEqual(sheet.names, ['НомерЛиста']);
  assert.ok(listed.areas.find((a) => a.name === 'НумерацияЛистов').parameters.includes('НомерЛиста'), 'template names count as area parameters');
  assert.ok(Array.isArray(listed.columnSets) && listed.columnSets.length > 1);

  let xml = TM.setArea(mini, { name: 'Строки', beginRow: 1, endRow: 2 }).xml;
  xml = TM.setArea(xml, { name: 'Колонки', beginColumn: 1, endColumn: 2 }).xml;
  assert.deepEqual(plain(TM.listMarkup(xml).intersections), ['Строки|Колонки']);
});

test('validate_template accepts real templates and reports broken references', () => {
  const real = TM.validateTemplate(sample);
  assert.equal(real.ok, true, real.errors.join('\n'));
  assert.equal(TM.validateTemplate(mini).ok, true);

  const broken = mini
    .replace('<f>1</f>', '<f>7</f>')
    .replace('<font>0</font>', '<font>3</font>')
    .replace('<w>1</w>', '<w>9</w>')
    .replace('<height>6</height>', '<height>2</height>');
  const withArea = TM.setArea(mini, { name: 'Шапка', beginRow: 1 }).xml.replace('<endRow>0</endRow>', '<endRow>40</endRow>');
  const report = plain(TM.validateTemplate(broken));
  assert.equal(report.ok, false);
  const text = report.errors.join('\n');
  assert.match(text, /Ячейка 1:1: формат 7 не существует/);
  assert.match(text, /шрифт 3 не существует/);
  assert.match(text, /Объединение 1:2: выходит за набор колонок/);
  assert.match(text, /Строка 4: за пределами высоты документа/);
  assert.match(plain(TM.validateTemplate(withArea)).errors.join('\n'), /Область «Шапка»: неверные строки/);
});

test('set_parameter sets and clears a drill-down parameter with or without the content', () => {
  let { xml, result } = TM.setParameter(mini, { row: 1, column: 1, name: 'Контрагент', detail: 'Ссылка' });
  assert.equal(result.detail, 'Ссылка');
  let m = model(xml);
  assert.equal(m.rows[0].cells[0].detailParameter, 'Ссылка');
  assert.match(xml, /<parameter>Контрагент<\/parameter>\r\n\t\t\t\t\t<detailParameter>Ссылка<\/detailParameter>/, 'detailParameter follows parameter');

  ({ xml } = TM.setParameter(xml, { row: 1, column: 1, detail: 'Договор' }));
  m = model(xml);
  assert.equal(m.rows[0].cells[0].parameter, 'Контрагент', 'detail alone keeps the parameter');
  assert.equal(m.rows[0].cells[0].detailParameter, 'Договор');

  ({ xml } = TM.setParameter(xml, { row: 1, column: 1, detail: '' }));
  assert.doesNotMatch(xml, /detailParameter/);
  assert.throws(() => TM.setParameter(mini, { row: 1, column: 1, detail: '1x' }), /расшифровки/);
});

test('set_format styles a range through shared fonts, lines and formats', () => {
  let { xml, result } = TM.setFormat(mini, {
    row: 1, column: 1, toColumn: 2,
    font: { bold: true, size: 10 }, horizontalAlignment: 'right', border: { style: 'Solid', width: 2 },
    backColor: '#ffeecc', format: 'ЧДЦ=2', protection: true, indent: 1
  });
  assert.equal(result.cells, 2);
  let m = model(xml);
  const a = m.formats[m.rows[0].cells[0].formatIndex - 1];
  const b = m.formats[m.rows[0].cells[1].formatIndex - 1];
  assert.deepEqual(plain(m.fonts[+a.font]), plain({ ...m.fonts[0], height: 10, bold: true }), 'the font keeps its face and changes size and weight');
  assert.equal(a.horizontalAlignment, 'Right');
  assert.equal(a.textPlacement, 'Wrap', 'untouched properties stay');
  assert.deepEqual(plain(m.lines[+a.leftBorder]), { width: 2, gap: false, style: 'Solid' });
  assert.equal(a.backColor, '#FFEECC');
  assert.equal(a.numberFormat, 'ЧДЦ=2');
  assert.equal(a.protection, 'true');
  assert.equal(b.backColor, '#FFEECC', 'a missing cell in the range is created');
  assert.match(xml, /<textPlacement>Wrap<\/textPlacement>\r\n\t\t<protection>true<\/protection>\r\n\t\t<format>\r\n\t\t\t<v8:item>/, 'properties go in Designer order');
  assert.match(xml, /xmlns:v8ui="http:\/\/v8\.1c\.ru\/8\.1\/data\/ui"/, 'the line namespace is declared when missing');

  const again = TM.setFormat(xml, { row: 1, column: 2, font: { bold: true, size: 10 } }).xml;
  assert.equal((again.match(/<font faceName/g) || []).length, 2, 'an equal font is reused');
  assert.equal((again.match(/<line /g) || []).length, 1, 'no new line');

  ({ xml } = TM.setFormat(xml, { row: 1, column: 1, backColor: null, border: 'None' }));
  m = model(xml);
  const cleared = m.formats[m.rows[0].cells[0].formatIndex - 1];
  assert.equal(cleared.backColor, undefined);
  assert.equal(m.lines[+cleared.topBorder].style, 'None');

  assert.throws(() => TM.setFormat(mini, { row: 1, column: 1 }), /ни одного свойства/);
  assert.throws(() => TM.setFormat(mini, { row: 1, column: 1, horizontalAlignment: 'middle' }), /Left, Center/);
  assert.throws(() => TM.setFormat(mini, { row: 1, column: 1, textColor: 'red' }), /#RRGGBB/);
  assert.throws(() => TM.setFormat(mini, { row: 1, column: 1, border: 'Wavy' }), /Стиль линии/);
});

test('set_print_settings writes settings in Designer order and manages the print area', () => {
  let { xml, result } = TM.setPrintSettings(mini, { orientation: 'landscape', fitToPage: true, topMargin: 10, leftMargin: 25.5, printArea: { beginRow: 1, endRow: 2 } });
  assert.deepEqual(plain(result.printSettings), { pageOrientation: 'Landscape', topMargin: '1000', leftMargin: '2550', fitToPage: 'true' });
  assert.deepEqual(plain(result.printArea), { beginRow: 1, endRow: 2 });
  assert.match(xml, /<\/merge>\r\n\t<printSettings>\r\n\t\t<pageOrientation>Landscape<\/pageOrientation>\r\n\t\t<topMargin>1000<\/topMargin>\r\n\t\t<leftMargin>2550<\/leftMargin>\r\n\t\t<fitToPage>true<\/fitToPage>\r\n\t<\/printSettings>\r\n\t<printArea>/);
  assert.ok(xml.indexOf('</printArea>') < xml.indexOf('<font '), 'print area goes before fonts');

  ({ xml, result } = TM.setPrintSettings(xml, { scale: 80, printArea: null }));
  assert.equal(result.printSettings.scale, '80');
  assert.match(xml, /<pageOrientation>Landscape<\/pageOrientation>\r\n\t\t<scale>80<\/scale>/, 'scale slots in after orientation');
  assert.doesNotMatch(xml, /printArea/);
  const listed = plain(TM.listMarkup(xml));
  assert.equal(listed.print.settings.scale, '80');
  assert.equal(TM.validateTemplate(xml).ok, true);
  assert.throws(() => TM.setPrintSettings(mini, {}), /ни одного параметра/);
  assert.throws(() => TM.setPrintSettings(mini, { scale: 5 }), /scale/);
  assert.throws(() => TM.setPrintSettings(mini, { orientation: 'up' }), /Portrait, Landscape/);
});

test('set_header_footer fills slots, keeps the rest and goes before templateMode', () => {
  let { xml } = TM.setHeaderFooter(mini, { kind: 'footer', right: 'Стр. [&НомерСтраницы]', font: { size: 7, italic: true } });
  assert.match(xml, /<\/rowsItem>\r\n\t<leftFooter>\r\n\t\t<f>\d+<\/f>\r\n\t\t<tl\/>\r\n\t<\/leftFooter>\r\n\t<centerFooter>/);
  assert.ok(xml.indexOf('</rightFooter>') < xml.indexOf('<templateMode>'));
  ({ xml } = TM.setHeaderFooter(xml, { kind: 'header', center: 'АКТ' }));
  assert.ok(xml.indexOf('</rightHeader>') < xml.indexOf('<leftFooter>'), 'headers precede footers');
  ({ xml } = TM.setHeaderFooter(xml, { kind: 'footer', left: 'Подпись' }));
  const listed = plain(TM.listMarkup(xml));
  assert.deepEqual(listed.print.footer, { left: 'Подпись', right: 'Стр. [&НомерСтраницы]' });
  assert.deepEqual(listed.print.header, { center: 'АКТ' });
  const m = model(xml);
  ({ xml } = TM.setHeaderFooter(xml, { kind: 'header', remove: true }));
  assert.doesNotMatch(xml, /Header>/);
  assert.equal(TM.validateTemplate(xml).ok, true);
  assert.ok(m);
});
