import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWebModules } from './helpers/dom.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sandbox = loadWebModules(root, ['xml-util.js', 'template-preview.js', 'template-markup.js']);
const TM = sandbox.window.TemplateMarkup;
const TP = sandbox.window.TemplatePreview;
const plain = (v) => JSON.parse(JSON.stringify(v));

/* 4 columns × 6 rows:
 *   row 1: «Шапка» merged over columns 1-4
 *   row 2: A2 «Товар», B2 [Сумма]
 *   rows 3-5: an empty range item
 *   row 6: A6 «Итого»
 * Areas: Шапка rows 1-1, Строка rows 2-2, Таблица rows 2-5, Колонки columns 2-3.
 * A picture spans rows 2-3, columns 2-3. */
const sample = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<document xmlns="http://v8.1c.ru/8.2/data/spreadsheet" xmlns:v8="http://v8.1c.ru/8.1/data/core" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">',
  '\t<languageSettings>',
  '\t\t<defaultLanguage>ru</defaultLanguage>',
  '\t</languageSettings>',
  '\t<columns>',
  '\t\t<size>4</size>',
  '\t\t<columnsItem>',
  '\t\t\t<index>1</index>',
  '\t\t\t<column>',
  '\t\t\t\t<formatIndex>2</formatIndex>',
  '\t\t\t</column>',
  '\t\t</columnsItem>',
  '\t\t<columnsItem>',
  '\t\t\t<index>3</index>',
  '\t\t\t<column>',
  '\t\t\t\t<formatIndex>2</formatIndex>',
  '\t\t\t</column>',
  '\t\t</columnsItem>',
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
  '\t\t\t\t\t\t\t<v8:content>Шапка</v8:content>',
  '\t\t\t\t\t\t</v8:item>',
  '\t\t\t\t\t</tl>',
  '\t\t\t\t</c>',
  '\t\t\t</c>',
  '\t\t</row>',
  '\t</rowsItem>',
  '\t<rowsItem>',
  '\t\t<index>1</index>',
  '\t\t<row>',
  '\t\t\t<c>',
  '\t\t\t\t<c>',
  '\t\t\t\t\t<f>1</f>',
  '\t\t\t\t\t<tl>',
  '\t\t\t\t\t\t<v8:item>',
  '\t\t\t\t\t\t\t<v8:lang>ru</v8:lang>',
  '\t\t\t\t\t\t\t<v8:content>Товар</v8:content>',
  '\t\t\t\t\t\t</v8:item>',
  '\t\t\t\t\t</tl>',
  '\t\t\t\t</c>',
  '\t\t\t</c>',
  '\t\t\t<c>',
  '\t\t\t\t<c>',
  '\t\t\t\t\t<f>3</f>',
  '\t\t\t\t\t<parameter>Сумма</parameter>',
  '\t\t\t\t</c>',
  '\t\t\t</c>',
  '\t\t</row>',
  '\t</rowsItem>',
  '\t<rowsItem>',
  '\t\t<index>2</index>',
  '\t\t<indexTo>4</indexTo>',
  '\t\t<row>',
  '\t\t\t<empty>true</empty>',
  '\t\t</row>',
  '\t</rowsItem>',
  '\t<rowsItem>',
  '\t\t<index>5</index>',
  '\t\t<row>',
  '\t\t\t<c>',
  '\t\t\t\t<c>',
  '\t\t\t\t\t<f>1</f>',
  '\t\t\t\t\t<tl>',
  '\t\t\t\t\t\t<v8:item>',
  '\t\t\t\t\t\t\t<v8:lang>ru</v8:lang>',
  '\t\t\t\t\t\t\t<v8:content>Итого</v8:content>',
  '\t\t\t\t\t\t</v8:item>',
  '\t\t\t\t\t</tl>',
  '\t\t\t\t</c>',
  '\t\t\t</c>',
  '\t\t</row>',
  '\t</rowsItem>',
  '\t<drawing>',
  '\t\t<drawingType>Picture</drawingType>',
  '\t\t<id>1</id>',
  '\t\t<beginRow>1</beginRow>',
  '\t\t<beginRowOffset>0</beginRowOffset>',
  '\t\t<endRow>2</endRow>',
  '\t\t<endRowOffset>0</endRowOffset>',
  '\t\t<beginColumn>1</beginColumn>',
  '\t\t<beginColumnOffset>0</beginColumnOffset>',
  '\t\t<endColumn>2</endColumn>',
  '\t\t<endColumnOffset>0</endColumnOffset>',
  '\t</drawing>',
  '\t<templateMode>true</templateMode>',
  '\t<height>6</height>',
  '\t<vgRows>6</vgRows>',
  '\t<merge>',
  '\t\t<r>0</r>',
  '\t\t<c>0</c>',
  '\t\t<w>3</w>',
  '\t</merge>',
  area('Шапка', 'Rows', 0, 0, -1, -1),
  area('Строка', 'Rows', 1, 1, -1, -1),
  area('Таблица', 'Rows', 1, 4, -1, -1),
  area('Колонки', 'Columns', -1, -1, 1, 2),
  '\t<font faceName="Arial" height="8" bold="false" italic="false" underline="false" strikeout="false" kind="Absolute" scale="100"/>',
  '\t<format>',
  '\t\t<font>0</font>',
  '\t</format>',
  '\t<format>',
  '\t\t<width>40</width>',
  '\t</format>',
  '\t<format>',
  '\t\t<font>0</font>',
  '\t\t<fillType>Parameter</fillType>',
  '\t</format>',
  '</document>'
].join('\n');

function area(name, type, br, er, bc, ec) {
  return [
    '\t<namedItem xsi:type="NamedItemCells">',
    `\t\t<name>${name}</name>`,
    '\t\t<area>',
    `\t\t\t<type>${type}</type>`,
    `\t\t\t<beginRow>${br}</beginRow>`,
    `\t\t\t<endRow>${er}</endRow>`,
    `\t\t\t<beginColumn>${bc}</beginColumn>`,
    `\t\t\t<endColumn>${ec}</endColumn>`,
    '\t\t</area>',
    '\t</namedItem>'
  ].join('\n');
}

function model(xml) {
  const parsed = TP.parse(xml);
  assert.equal(parsed.error, undefined, parsed.error);
  return parsed.model;
}
const areas = (m) => plain(m.namedItems.map((a) => [a.name, a.beginRow, a.endRow, a.beginColumn, a.endColumn]));
const texts = (m) => plain(m.rows.map((r) => r.cells.map((c) => [c.col, c.text || c.parameter])));

test('insert_rows pushes rows, merges, areas and drawings down and grows what it cuts through', () => {
  const { xml, result } = TM.insertRows(sample, { at: 3, count: 2 });
  assert.equal(result.rows, 8);
  const m = model(xml);
  assert.equal(m.height, 8);
  assert.deepEqual(texts(m)[1], [[0, 'Товар'], [1, 'Сумма']]);
  assert.deepEqual(texts(m)[7], [[0, 'Итого']]);
  assert.equal(m.rows[2].empty, true);
  assert.deepEqual(areas(m), [
    ['Шапка', 0, 0, -1, -1], ['Строка', 1, 1, -1, -1], ['Таблица', 1, 6, -1, -1], ['Колонки', -1, -1, 1, 2]
  ]);
  assert.deepEqual(plain([m.drawings[0].beginRow, m.drawings[0].endRow]), [1, 4], 'the picture crossing the insert stretches');
  assert.match(xml, /<index>4<\/index>\n\t\t<indexTo>6<\/indexTo>/, 'a range starting at the insert moves whole');
  const inside = TM.insertRows(sample, { at: 4 }).xml;
  assert.match(inside, /<index>2<\/index>\n\t\t<row>/, 'a range cut by the insert is split');
  assert.match(inside, /<index>4<\/index>\n\t\t<indexTo>5<\/indexTo>/);
  assert.equal(model(inside).rows[3].empty, true);
  assert.match(xml, /<vgRows>8<\/vgRows>/);
});

test('delete_rows removes rows and what lies entirely inside them, shrinking the rest', () => {
  const { xml, result } = TM.deleteRows(sample, { at: 2, count: 2 });
  assert.deepEqual(plain(result.removedAreas), ['Строка']);
  assert.equal(result.removedDrawings, 1);
  const m = model(xml);
  assert.equal(m.height, 4);
  assert.deepEqual(texts(m)[3], [[0, 'Итого']]);
  assert.deepEqual(areas(m), [['Шапка', 0, 0, -1, -1], ['Таблица', 1, 2, -1, -1], ['Колонки', -1, -1, 1, 2]]);
  assert.equal(m.drawings.length, 0);
  assert.throws(() => TM.deleteRows(sample, { at: 7 }), /удалять нечего/);
});

test('insert_columns and delete_columns shift cells, column formats, merges and areas', () => {
  let { xml } = TM.insertColumns(sample, { at: 2, count: 1 });
  let m = model(xml);
  const set = m.columnSetById[''];
  assert.equal(set.size, 5);
  assert.equal(m.formats[set.formatIndex[2] - 1].width, '40', 'column 2 moved to 3 with its width');
  assert.equal(set.formatIndex[1], undefined, 'the inserted column has no format');
  assert.deepEqual(texts(m)[1], [[0, 'Товар'], [2, 'Сумма']]);
  assert.deepEqual(plain(m.merges.map(({ r, c, h, w }) => [r, c, h, w])), [[0, 0, 0, 4]], 'the header merge grows over the new column');
  assert.deepEqual(areas(m)[3], ['Колонки', -1, -1, 2, 3]);
  assert.deepEqual(plain([m.drawings[0].beginColumn, m.drawings[0].endColumn]), [2, 3]);

  ({ xml } = TM.deleteColumns(xml, { at: 1, count: 2 }));
  m = model(xml);
  assert.equal(m.columnSetById[''].size, 3);
  assert.deepEqual(texts(m)[1], [[0, 'Сумма']], '«Товар» went with column 1');
  assert.deepEqual(plain(m.merges.map(({ r, c, h, w }) => [r, c, h, w])), [[0, 0, 0, 2]]);
  assert.match(xml, /<i>0<\/i>|<c>\n\t\t\t\t<c>\n\t\t\t\t\t<f>3<\/f>/, 'cell indexes are rewritten');
});

test('merge_cells adds and removes merges and refuses overlaps', () => {
  let { xml, result } = TM.mergeCells(sample, { row: 6, column: 1, columns: 3 });
  assert.deepEqual(plain(result.merged), { row: 6, column: 1, rows: 1, columns: 3 });
  let m = model(xml);
  assert.deepEqual(plain(m.merges.map(({ r, c, h, w }) => [r, c, h, w])), [[0, 0, 0, 3], [5, 0, 0, 2]]);
  assert.ok(xml.indexOf('<r>5</r>') < xml.indexOf('<namedItem'), 'merges stay before areas');
  assert.throws(() => TM.mergeCells(xml, { row: 6, column: 2, rows: 2 }), /Пересекается/);
  assert.throws(() => TM.mergeCells(xml, { row: 3, column: 1 }), /одной ячейки/);

  ({ xml, result } = TM.mergeCells(xml, { row: 1, column: 3, unmerge: true }));
  assert.deepEqual(plain(result.unmerged), { row: 1, column: 1, rows: 1, columns: 4 });
  m = model(xml);
  assert.deepEqual(plain(m.merges.map(({ r, c }) => [r, c])), [[5, 0]]);
  assert.throws(() => TM.mergeCells(xml, { row: 2, column: 2, unmerge: true }), /не входит/);
});

test('set_size changes widths and heights through shared, deduplicated formats', () => {
  let { xml } = TM.setSize(sample, { column: 1, toColumn: 2, width: 40 });
  let m = model(xml);
  const set = m.columnSetById[''];
  assert.equal(m.formats[set.formatIndex[0] - 1].width, '40');
  assert.equal(set.formatIndex[0], 2, 'an identical width format is reused');
  assert.equal(set.formatIndex[1], 2);
  assert.match(xml, /<size>4<\/size>\n\t\t<columnsItem>\n\t\t\t<index>0<\/index>/, 'the new column item goes before index 1');

  ({ xml } = TM.setSize(xml, { row: 4, height: 15 }));
  m = model(xml);
  assert.equal(m.formats[m.rows[3].formatIndex - 1].height, '60', '15 pt = 60 units');
  assert.equal(m.rows[2].empty, true, 'the rest of the range is untouched');

  ({ xml } = TM.setSize(xml, { row: 4, height: 0 }));
  m = model(xml);
  assert.equal(m.formats[m.rows[3].formatIndex - 1].height, undefined, 'height 0 goes back to auto');
  assert.throws(() => TM.setSize(sample, { column: 1 }), /width/);
  assert.throws(() => TM.setSize(sample, {}), /Укажите/);
});
