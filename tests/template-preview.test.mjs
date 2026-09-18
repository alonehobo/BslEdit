import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWebModules } from './helpers/dom.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadTemplatePreview() {
  return loadWebModules(root, ['xml-util.js', 'template-preview.js']).window.TemplatePreview;
}

/* Render tests need a DOM stub too: `fakeNode` stands in for createElement. */
function loadRenderSandbox() {
  return loadWebModules(root, ['xml-util.js', 'template-preview.js'], {
    document: { createElement: fakeNode }
  });
}

const TP = loadTemplatePreview();
const T = TP._test;

const mini = `<?xml version="1.0" encoding="UTF-8"?>
<document xmlns="http://v8.1c.ru/8.2/data/spreadsheet" xmlns:v8="http://v8.1c.ru/8.1/data/core"
          xmlns:v8ui="http://v8.1c.ru/8.1/data/ui" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <columns>
    <size>3</size>
    <columnsItem>
      <index>0</index>
      <column><formatIndex>1</formatIndex></column>
    </columnsItem>
    <columnsItem>
      <index>1</index>
      <column><formatIndex>2</formatIndex></column>
    </columnsItem>
  </columns>
  <rowsItem>
    <index>0</index>
    <row>
      <c>
        <c>
          <f>3</f>
          <tl>
            <v8:item>
              <v8:lang>ru</v8:lang>
              <v8:content>Заголовок</v8:content>
            </v8:item>
          </tl>
        </c>
      </c>
      <c>
        <c>
          <f>4</f>
          <parameter>Номер</parameter>
        </c>
      </c>
    </row>
  </rowsItem>
  <templateMode>true</templateMode>
  <height>2</height>
  <vgRows>2</vgRows>
  <merge>
    <r>0</r>
    <c>0</c>
    <w>1</w>
  </merge>
  <namedItem xsi:type="NamedItemCells">
    <name>Шапка</name>
    <area>
      <type>Rows</type>
      <beginRow>0</beginRow>
      <endRow>0</endRow>
      <beginColumn>-1</beginColumn>
      <endColumn>-1</endColumn>
    </area>
  </namedItem>
  <line width="1" gap="false">
    <v8ui:style xsi:type="v8ui:SpreadsheetDocumentCellLineType">Solid</v8ui:style>
  </line>
  <font faceName="Arial" height="8" bold="false" italic="false" underline="false" strikeout="false" kind="Absolute" scale="100"/>
  <format><width>40</width></format>
  <format><width>120</width></format>
  <format>
    <font>0</font>
    <horizontalAlignment>Left</horizontalAlignment>
  </format>
  <format>
    <fillType>Parameter</fillType>
  </format>
</document>`;

const formXml = `<?xml version="1.0"?><Form xmlns="http://v8.1c.ru/8.3/xcf/logform"><ChildItems><InputField name="A"/></ChildItems></Form>`;

test('detects spreadsheet Template.xml and rejects Form.xml', () => {
  assert.equal(TP.detect(mini), true);
  assert.equal(TP.detect(formXml), false);
  assert.equal(TP.detect('<?xml version="1.0"?><Catalog/>'), false);
});

test('parses rows, parameters and named areas', () => {
  const parsed = TP.parse(mini);
  assert.ok(parsed.model, parsed.error);
  const m = parsed.model;
  assert.equal(m.height, 2);
  assert.equal(m.templateMode, true);
  assert.equal(m.namedItems.length, 1);
  assert.equal(m.namedItems[0].name, 'Шапка');
  assert.equal(m.namedItems[0].beginRow, 0);
  const cell0 = T.cellAt(m.rows[0], 0);
  const cell1 = T.cellAt(m.rows[0], 1);
  assert.equal(cell0.text, 'Заголовок');
  assert.equal(cell1.parameter, 'Номер');
  const fmtP = T.formatByIndex(m.formats, 4);
  assert.equal(T.displayText(cell1, fmtP), '<Номер>');
  assert.equal(T.isParamCell(cell1, fmtP), true);
  assert.equal(T.displayText(cell0, T.formatByIndex(m.formats, 3)), 'Заголовок');
});

test('column widths come from format palette (eighths of a character)', () => {
  const parsed = TP.parse(mini);
  const set = T.columnSetOf(parsed.model, '');
  assert.equal(set.size, 3);
  assert.ok(Math.abs(set.widths[0] - T.widthToPx(40)) < 0.01);
  assert.ok(Math.abs(set.widths[1] - T.widthToPx(120)) < 0.01);
  assert.ok(Math.abs(set.widths[2] - T.widthToPx(T.DEFAULT_WIDTH_U)) < 0.01);
});

test('merge origin covers extra columns', () => {
  const parsed = TP.parse(mini);
  const spans = T.buildSpans(parsed.model, 0, 2, '');
  assert.equal(spans.origin[0][0].rowspan, 1);
  assert.equal(spans.origin[0][0].colspan, 2);
  assert.equal(spans.covered[0][1], true);
  assert.equal(spans.covered[0][0], false);
});

test('outline lists named areas', () => {
  const parsed = TP.parse(mini);
  const items = TP.outline(parsed.model, mini);
  assert.equal(items.length, 1);
  assert.equal(items[0].name, 'Шапка');
  assert.equal(items[0].tag, 'TemplateArea');
  assert.ok(items[0].line >= 1);
});

test('itemKey prefers area name', () => {
  assert.equal(TP.itemKey({ name: 'Строка', row: 17 }), 'Строка');
  assert.equal(TP.itemKey({ row: 1, col: 2 }), 'r1c2');
});

test('Template fillType shows [Param] as <Param>', () => {
  const fmt = { fillType: 'Template' };
  assert.equal(T.displayText({ text: 'Лист [НомерЛиста]', parameter: '' }, fmt), 'Лист <НомерЛиста>');
  assert.equal(T.displayText({ text: '[8]', parameter: '' }, { fillType: 'Text' }), '[8]');
});

test('row area rail has top and bottom edges, and grid has matching red lines', () => {
  const container = fakeNode('div');
  const sandbox = loadRenderSandbox();
  const parsed = sandbox.window.TemplatePreview.parse(mini);
  sandbox.window.TemplatePreview.render(parsed.model, container, {});
  const labels = walkMatch(container, '.tp-area-label');
  assert.equal(labels.length, 1);
  assert.equal(labels[0].textContent, 'Шапка');
  const lines = walkMatch(container, '.tp-row-area-line');
  assert.equal(lines.length, 2, 'start and end line for one area');
  const edges = lines.map((n) => n.getAttribute('data-edge')).sort();
  assert.deepEqual(edges, ['end', 'start']);
  assert.equal(hasAncestorClass(lines[0], 'tp-grid-wrap'), true);
});

test('render keeps automatic row height flexible and gives cells coordinate ids', () => {
  const xml = mini
    .replace('<row>', '<row><formatIndex>3</formatIndex>')
    .replace('<horizontalAlignment>Left</horizontalAlignment>',
      '<horizontalAlignment>Left</horizontalAlignment><height>-45</height><textPlacement>Wrap</textPlacement>');
  const container = fakeNode('div');
  const sandbox = loadRenderSandbox();
  const parsed = sandbox.window.TemplatePreview.parse(xml);
  sandbox.window.TemplatePreview.render(parsed.model, container, {});
  const cell = walkMatch(container, 'td[data-id="r0c0"]')[0];
  assert.ok(cell, 'coordinate data-id is present');
  const inner = cell.children.find((child) => child.className.includes('tp-cell'));
  assert.equal(inner.style.height, undefined);
  assert.match(inner.style.minHeight, /px$/);
  assert.equal(inner.style.maxHeight, '15px', 'a negative height caps the row');
  assert.equal(cell.style.overflow, 'hidden');
});

test('outline icons differ for row vs column areas', () => {
  const row = TP.outlineIcon({ areaType: 'Rows' });
  const col = TP.outlineIcon({ areaType: 'Columns' });
  assert.equal(row.cls, 'icon-tpl-row');
  assert.equal(col.cls, 'icon-tpl-col');
  assert.notEqual(row.ch, col.ch);
  assert.equal(TP.outlineIcon({ type: 'Columns' }).cls, 'icon-tpl-col');
});

test('centerInScroll puts the target in the middle of the viewport', () => {
  const sc = {
    scrollTop: 0,
    scrollLeft: 0,
    scrollHeight: 2000,
    scrollWidth: 2000,
    getBoundingClientRect() { return { top: 0, left: 0, height: 200, width: 400 }; }
  };
  const rowHit = {
    getBoundingClientRect() { return { top: 500, left: 10, height: 40, width: 380 }; }
  };
  T.centerInScroll(sc, rowHit, 'v');
  assert.equal(sc.scrollTop, 420);
  assert.equal(sc.scrollLeft, 0);
  const colHit = {
    getBoundingClientRect() { return { top: 0, left: 800, height: 200, width: 40 }; }
  };
  T.centerInScroll(sc, colHit, 'h');
  assert.equal(sc.scrollLeft, 620);
});

function fakeNode(tag) {
  const node = {
    tagName: String(tag).toUpperCase(),
    className: '',
    children: [],
    parentNode: null,
    attributes: {},
    style: {},
    hidden: false,
    _text: '',
    classList: {
      add(c) {
        const parts = node.className.split(/\s+/).filter(Boolean);
        if (!parts.includes(c)) parts.push(c);
        node.className = parts.join(' ');
      },
      remove(c) {
        node.className = node.className.split(/\s+/).filter((x) => x && x !== c).join(' ');
      }
    },
    setAttribute(k, v) { node.attributes[k] = String(v); },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(node.attributes, k) ? node.attributes[k] : null; },
    appendChild(child) {
      child.parentNode = node;
      node.children.push(child);
      return child;
    },
    addEventListener() {},
    getBoundingClientRect() { return { top: 0, left: 0, height: 0, width: 0 }; },
    querySelector(sel) { return node.querySelectorAll(sel)[0] || null; },
    querySelectorAll(sel) { return walkMatch(node, sel); },
    closest(sel) {
      let cur = node;
      while (cur) {
        if (matchSel(cur, sel)) return cur;
        cur = cur.parentNode;
      }
      return null;
    }
  };
  Object.defineProperty(node, 'textContent', {
    get() { return node._text || node.children.map((c) => c.textContent).join(''); },
    set(v) { node._text = String(v); node.children = []; }
  });
  Object.defineProperty(node, 'innerHTML', {
    get() { return ''; },
    set() { node.children = []; node._text = ''; }
  });
  return node;
}

function matchSel(node, sel) {
  const m = String(sel).trim().match(/^([a-zA-Z][\w-]*)?(?:\.([\w-]+))?(?:\[([^=\]]+)="([^"]*)"\])?$/);
  if (!m) return false;
  if (m[1] && node.tagName !== m[1].toUpperCase()) return false;
  if (m[2] && !node.className.split(/\s+/).includes(m[2])) return false;
  if (m[3] && node.getAttribute(m[3]) !== m[4]) return false;
  return true;
}

function walkMatch(root, sel) {
  const out = [];
  function walk(n) {
    for (const c of n.children) {
      if (matchSel(c, sel)) out.push(c);
      walk(c);
    }
  }
  walk(root);
  return out;
}

function hasAncestorClass(node, cls) {
  let cur = node;
  while (cur) {
    if (cur.className && cur.className.split(/\s+/).includes(cls)) return true;
    cur = cur.parentNode;
  }
  return false;
}

test('row numbers live in a left gutter, not on the grid', () => {
  const container = fakeNode('div');
  const sandbox = loadRenderSandbox();
  const parsed = sandbox.window.TemplatePreview.parse(mini);
  sandbox.window.TemplatePreview.render(parsed.model, container, {});
  const rowhead = container.querySelector('.tp-rowhead');
  const wrap = container.querySelector('.tp-grid-wrap');
  const left = container.querySelector('.tp-left');
  const right = container.querySelector('.tp-right');
  assert.ok(rowhead, 'rowhead');
  assert.ok(wrap, 'grid wrap');
  assert.ok(left, 'left pane');
  assert.ok(right, 'right pane');
  assert.equal(hasAncestorClass(rowhead, 'tp-left'), true);
  assert.equal(hasAncestorClass(wrap, 'tp-right'), true);
  assert.equal(hasAncestorClass(rowhead, 'tp-grid-wrap'), false);
  assert.equal(left.querySelector('.tp-rowhead') != null, true);
  assert.equal(right.querySelector('.tp-rowhead') != null, false);
  assert.equal(container.querySelectorAll('.tp-colhead-bar').length, 1);
});

const updPath = path.join(root, 'testdata', 'Template.xml');

test('UPD Template.xml: areas, barcode drawing, parameter cells', () => {
  const xml = fs.readFileSync(updPath, 'utf8');
  assert.equal(TP.detect(xml), true);
  const parsed = TP.parse(xml);
  assert.ok(parsed.model, parsed.error);
  const m = parsed.model;
  assert.ok(m.height >= 50);
  const names = m.namedItems.filter((x) => x.kind === 'cells').map((x) => x.name);
  for (const need of ['Шапка', 'ЗаголовокТаблицы', 'Строка', 'Итого', 'Подвал', 'ПодвалНакладной', 'НумерацияЛистов']) {
    assert.ok(names.includes(need), 'missing area ' + need);
  }
  const sh = m.namedItems.find((x) => x.name === 'Шапка');
  assert.equal(sh.beginRow, 1);
  assert.equal(sh.endRow, 10);
  const barcode = m.namedItems.find((x) => x.name === 'КартинкаШтрихкода');
  assert.equal(barcode.kind, 'drawing');
  const draw = m.drawings.find((d) => d.id === barcode.drawingID);
  assert.ok(draw);
  assert.equal(draw.beginRow, 1);
  assert.ok(m.pictures.some((p) => p.data && p.data.indexOf('iVBORw') === 0));
  const barcodeUrl = T.pictureDataUrl(m, draw.pictureIndex);
  assert.ok(barcodeUrl.indexOf('data:image/png;base64,iVBORw') === 0);

  const row1 = m.rows[1];
  const texts = {};
  for (const c of row1.cells) {
    const fmt = T.formatByIndex(m.formats, c.formatIndex);
    texts[c.col] = T.displayText(c, fmt);
  }
  const joined = Object.values(texts).join(' | ');
  assert.match(joined, /Счет-фактура/);
  assert.match(joined, /<Номер>/);
  assert.match(joined, /<Дата>/);

  const groups = T.groupsOf(m);
  assert.ok(groups.length >= 3);
  const area = T.areaForRow(m, 17);
  assert.equal(area && area.name, 'Строка');
  const sheetCell = T.cellAt(m.rows[49], 2);
  const sheetFmt = T.formatByIndex(m.formats, sheetCell && sheetCell.formatIndex);
  assert.equal(T.displayText(sheetCell, sheetFmt), 'Лист <НомерЛиста>');

  const rowAreas = [];
  T.eachRowArea(m, (it) => rowAreas.push(it.name));
  assert.ok(rowAreas.includes('Шапка'));
  assert.ok(rowAreas.includes('Подвал'));
  assert.equal(rowAreas.includes('ОбластьЗапись'), false);

  const container = fakeNode('div');
  const sandbox = loadRenderSandbox();
  sandbox.window.TemplatePreview.render(parsed.model, container, {});
  const hlines = walkMatch(container, '.tp-row-area-line');
  assert.equal(hlines.length, rowAreas.length * 2);
  const labels = walkMatch(container, '.tp-area-label').map((n) => n.textContent);
  assert.ok(labels.includes('ПодвалНакладной'));
  const set = T.viewColumnSet(m);
  assert.ok(set.size >= 19);
  const gStroka = T.groupsOf(m).find((g) => g.start <= 17 && 17 < g.end);
  const header = m.namedItems.find((x) => x.name === 'ЗаголовокТаблицы');
  assert.ok(gStroka);
  assert.equal(gStroka.columnsID, header.columnsID);
  assert.ok(gStroka.start <= header.beginRow);
  assert.ok(gStroka.end > header.endRow);
  const gItogo = T.groupsOf(m).find((g) => g.start <= 19 && 19 < g.end);
  const spansItogo = T.buildSpans(m, gItogo.start, gItogo.end, gItogo.columnsID);
  const itogoOrigin = spansItogo.origin[19 - gItogo.start][2];
  assert.ok(itogoOrigin, 'Итого «Всего к оплате» must be a merged origin');
  assert.equal(itogoOrigin.colspan, 6);
  const tableSet = T.columnSetOf(m, gItogo.columnsID);
  assert.ok(T.colSpanWidth(tableSet, 2, 6) > T.colSpanWidth(tableSet, 2, 1) * 3);
});

test('UPD MXL Итого «Всего к оплате» spans the same columns as Template.xml', () => {
  const sandbox = loadWebModules(root, ['xml-util.js', 'mxl-preview.js', 'template-preview.js'], {
    document: { createElement: fakeNode }
  });
  const parsed = sandbox.window.MxlPreview.parse(fs.readFileSync(path.join(root, 'testdata', 'upd.mxl'), 'utf8'));
  assert.equal(parsed.error, undefined, parsed.error);
  const m = parsed.model;
  const gItogo = T.groupsOf(m).find((g) => g.start <= 19 && 19 < g.end);
  assert.ok(gItogo);
  const cell = T.cellAt(m.rows[19], 2);
  assert.ok(String(cell && cell.text).includes('Всего к оплате'));
  const spans = T.buildSpans(m, gItogo.start, gItogo.end, gItogo.columnsID);
  const origin = spans.origin[19 - gItogo.start][2];
  assert.ok(origin, 'MXL column merge r=-1 must make Итого a 6-col origin');
  assert.equal(origin.colspan, 6);

  const container = fakeNode('div');
  sandbox.window.TemplatePreview.render(m, container, {});
  const totalTd = walkMatch(container, 'td').find((td) =>
    td.getAttribute('data-row') === '19' && td.getAttribute('data-col') === '2'
  );
  assert.ok(totalTd, 'rendered Всего к оплате cell');
  assert.equal(totalTd.colSpan, 6);
  assert.equal(totalTd.textContent, 'Всего к оплате (9)');
  const expectedWidth = String(Math.round(T.colSpanWidth(T.columnSetOf(m, gItogo.columnsID), 2, 6) * 10) / 10) + 'px';
  assert.equal(totalTd.style.minWidth, expectedWidth);
});

test('pictureDataUrl maps 1-based drawing pictureIndex onto 0-based pictures', () => {
  const xmlStyle = {
    pictures: [
      { index: 0, data: '', mime: 'image/png' },
      { index: 1, data: 'iVBORw0KGgoAAAANSUhE', mime: 'image/png' }
    ]
  };
  assert.ok(T.pictureDataUrl(xmlStyle, 2).includes('iVBORw0KGgoAAAANSUhE'));
  assert.equal(T.pictureDataUrl(xmlStyle, 1), '');
});

const colsMini = `<?xml version="1.0" encoding="UTF-8"?>
<document xmlns="http://v8.1c.ru/8.2/data/spreadsheet" xmlns:v8="http://v8.1c.ru/8.1/data/core"
          xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <columns>
    <size>8</size>
    <columnsItem>
      <index>0</index>
      <column><formatIndex>1</formatIndex></column>
    </columnsItem>
  </columns>
  <rowsItem>
    <index>0</index>
    <row>
      <c>
        <c>
          <f>2</f>
          <tl>
            <v8:item>
              <v8:lang>ru</v8:lang>
              <v8:content>ДлиннаяПодписьКоторойНетМеста</v8:content>
            </v8:item>
          </tl>
        </c>
      </c>
      <c>
        <i>4</i>
        <c>
          <f>3</f>
          <parameter>СуммаДохода</parameter>
        </c>
      </c>
    </row>
  </rowsItem>
  <templateMode>true</templateMode>
  <height>1</height>
  <namedItem xsi:type="NamedItemCells">
    <name>Вычеты1</name>
    <area>
      <type>Columns</type>
      <beginRow>-1</beginRow>
      <endRow>-1</endRow>
      <beginColumn>0</beginColumn>
      <endColumn>3</endColumn>
    </area>
  </namedItem>
  <namedItem xsi:type="NamedItemCells">
    <name>Вычеты2</name>
    <area>
      <type>Columns</type>
      <beginRow>-1</beginRow>
      <endRow>-1</endRow>
      <beginColumn>4</beginColumn>
      <endColumn>7</endColumn>
    </area>
  </namedItem>
  <namedItem xsi:type="NamedItemCells">
    <name>ЛеваяЧасть</name>
    <area>
      <type>Columns</type>
      <beginRow>-1</beginRow>
      <endRow>-1</endRow>
      <beginColumn>0</beginColumn>
      <endColumn>7</endColumn>
    </area>
  </namedItem>
  <namedItem xsi:type="NamedItemCells">
    <name>Шапка</name>
    <area>
      <type>Rows</type>
      <beginRow>0</beginRow>
      <endRow>0</endRow>
      <beginColumn>-1</beginColumn>
      <endColumn>-1</endColumn>
    </area>
  </namedItem>
  <format><width>24</width></format>
  <format>
    <width>24</width>
    <textPlacement>Auto</textPlacement>
  </format>
  <format>
    <fillType>Parameter</fillType>
    <textPlacement>Auto</textPlacement>
  </format>
</document>`;

test('parses nested vertical (Columns) areas', () => {
  const parsed = TP.parse(colsMini);
  assert.ok(parsed.model, parsed.error);
  const cols = T.columnAreaItems(parsed.model);
  assert.equal(cols.length, 3);
  const packed = T.columnAreaLevels(cols);
  const byName = Object.fromEntries(packed.items.map((x) => [x.item.name, x.level]));
  assert.equal(byName['ЛеваяЧасть'], 0);
  assert.equal(byName['Вычеты1'], 1);
  assert.equal(byName['Вычеты2'], 1);
  const b = T.colAreaBounds(cols.find((x) => x.name === 'Вычеты1'), 8);
  assert.equal(b.begin, 0);
  assert.equal(b.end, 3);
  assert.equal(T.placementOf({ textPlacement: 'Auto' }), 'auto');
  assert.equal(T.placementOf({ textPlacement: 'Wrap' }), 'wrap');
  assert.equal(T.placementOf({}), 'auto');
});

test('outline lists column areas before row areas', () => {
  const parsed = TP.parse(colsMini);
  const items = TP.outline(parsed.model, colsMini);
  const names = items.map((x) => x.name);
  assert.equal(names[0], 'Вычеты1');
  assert.ok(names.includes('ЛеваяЧасть'));
  assert.equal(names[names.length - 1], 'Шапка');
  assert.equal(items.find((x) => x.name === 'Вычеты1').areaType, 'Columns');
  assert.equal(items.find((x) => x.name === 'Шапка').areaType, 'Rows');
});

test('render draws a top rail for vertical areas and Auto overflow', () => {
  const container = fakeNode('div');
  const sandbox = loadRenderSandbox();
  const parsed = sandbox.window.TemplatePreview.parse(colsMini);
  sandbox.window.TemplatePreview.render(parsed.model, container, {});
  const rail = container.querySelector('.tp-col-areas');
  assert.ok(rail, 'column area rail');
  const labels = walkMatch(container, '.tp-col-area-label').map((n) => n.textContent);
  assert.ok(labels.includes('ЛеваяЧасть'));
  assert.ok(labels.includes('Вычеты1'));
  assert.ok(labels.includes('Вычеты2'));
  assert.ok(container.querySelector('.tp-col-area-lines'));
  const autoCell = walkMatch(container, '.tp-place-auto');
  assert.ok(autoCell.length >= 1);
  assert.equal(autoCell[0].style.whiteSpace, 'nowrap');
  // Auto spills over the empty columns 1..3 and stops at the parameter in
  // column 4: the text box is wider than its own column but clipped there.
  const set = parsed.model.columnSets[0];
  const spill = set.widths[0] + set.widths[1] + set.widths[2] + set.widths[3];
  assert.equal(autoCell[0].style.overflow, 'hidden');
  assert.equal(autoCell[0].style.width, (Math.round(spill * 10) / 10) + 'px');
  assert.ok(spill > set.widths[0]);
  const hasText = walkMatch(container, '.tp-has-text');
  assert.ok(hasText.length >= 1);
});


const borderMini = `<?xml version="1.0" encoding="UTF-8"?>
<document xmlns="http://v8.1c.ru/8.2/data/spreadsheet" xmlns:v8="http://v8.1c.ru/8.1/data/core"
          xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <columns>
    <size>3</size>
    <columnsItem>
      <index>0</index>
      <column><formatIndex>1</formatIndex></column>
    </columnsItem>
    <columnsItem>
      <index>1</index>
      <column><formatIndex>2</formatIndex></column>
    </columnsItem>
    <columnsItem>
      <index>2</index>
      <column><formatIndex>1</formatIndex></column>
    </columnsItem>
  </columns>
  <rowsItem>
    <index>0</index>
    <row>
      <c>
        <c>
          <f>3</f>
          <tl>
            <v8:item>
              <v8:lang>ru</v8:lang>
              <v8:content>A</v8:content>
            </v8:item>
          </tl>
        </c>
      </c>
      <c>
        <c>
          <f>4</f>
        </c>
      </c>
      <c>
        <c>
          <f>5</f>
          <tl>
            <v8:item>
              <v8:lang>ru</v8:lang>
              <v8:content>B</v8:content>
            </v8:item>
          </tl>
        </c>
      </c>
    </row>
  </rowsItem>
  <height>1</height>
  <merge>
    <r>0</r>
    <c>0</c>
    <w>1</w>
  </merge>
  <line width="1" gap="false">Solid</line>
  <format><width>16</width></format>
  <format><width>80</width></format>
  <format>
    <leftBorder>0</leftBorder>
    <topBorder>0</topBorder>
  </format>
  <format>
    <rightBorder>0</rightBorder>
    <topBorder>0</topBorder>
  </format>
  <format>
    <border>0</border>
  </format>
</document>`;

test('merge origin right/bottom borders apply to the whole span', () => {
  const parsed = TP.parse(borderMini);
  const originAll = `<?xml version="1.0" encoding="UTF-8"?>
<document xmlns="http://v8.1c.ru/8.2/data/spreadsheet">
  <columns><size>2</size>
    <columnsItem><index>0</index><column><formatIndex>1</formatIndex></column></columnsItem>
    <columnsItem><index>1</index><column><formatIndex>1</formatIndex></column></columnsItem>
  </columns>
  <rowsItem>
    <index>0</index>
    <row>
      <c><c><f>2</f><tl><v8:item><v8:lang>ru</v8:lang><v8:content>X</v8:content></v8:item></tl></c></c>
      <c><c><f>1</f></c></c>
    </row>
  </rowsItem>
  <height>1</height>
  <merge><r>0</r><c>0</c><w>1</w></merge>
  <line width="1" gap="false">Solid</line>
  <format><width>24</width></format>
  <format>
    <leftBorder>0</leftBorder>
    <topBorder>0</topBorder>
    <rightBorder>0</rightBorder>
    <bottomBorder>0</bottomBorder>
  </format>
</document>`;
  const p2 = TP.parse(originAll);
  const br = T.spanBorders(p2.model, 0, 0, 1, 2);
  assert.match(br.left, /solid/);
  assert.match(br.right, /solid/);
  assert.match(br.top, /solid/);
  assert.match(br.bottom, /solid/);
  const edge = T.spanBorders(parsed.model, 0, 0, 1, 2);
  assert.match(edge.left, /solid/);
  assert.match(edge.right, /solid/);
});

test('column widths stay distinct after a merge (not equalized to default)', () => {
  const parsed = TP.parse(borderMini);
  const set = T.columnSetOf(parsed.model, '');
  assert.ok(Math.abs(set.widths[0] - T.widthToPx(16)) < 0.01);
  assert.ok(Math.abs(set.widths[1] - T.widthToPx(80)) < 0.01);
  assert.ok(set.widths[0] < set.widths[1] / 2);
  assert.ok(Math.abs(T.colSpanWidth(set, 0, 2) - (set.widths[0] + set.widths[1])) < 0.01);

  const container = fakeNode('div');
  const sandbox = loadRenderSandbox();
  sandbox.window.TemplatePreview.render(parsed.model, container, {});
  const td = walkMatch(container, 'td').find((n) => n.getAttribute('data-col') === '0');
  assert.ok(td, 'merged origin td');
  assert.equal(td.colSpan, 2);
  const expected = String(Math.round((set.widths[0] + set.widths[1]) * 10) / 10) + 'px';
  assert.equal(td.style.maxWidth, expected);
  assert.equal(td.style.minWidth, expected);
  assert.match(td.style.borderLeft, /solid/);
  assert.match(td.style.borderRight, /solid/);
});

test('a cell inherits the format of its row but never its width, height or fillType', () => {
  const model = {
    formats: [
      { font: '1', textColor: '#ff0000', height: '100', width: '40', fillType: 'Parameter' },
      { textColor: '#0000ff' }
    ],
    fonts: []
  };
  const row = { formatIndex: 1, cells: [] };
  const own = T.effectiveFormat(model, row, { formatIndex: 2 });
  assert.equal(own.font, '1', 'font comes from the row');
  assert.equal(own.textColor, '#0000ff', 'the cell wins where it says something');
  assert.equal(own.height, undefined, 'height belongs to the row');
  assert.equal(own.width, undefined, 'width belongs to the column');
  assert.equal(own.fillType, undefined, 'a row must not turn its cells into parameters');
  const bare = T.effectiveFormat(model, row, { formatIndex: 0 });
  assert.equal(bare.font, '1');
  assert.equal(bare.textColor, '#ff0000');
  assert.equal(T.effectiveFormat(model, { formatIndex: 0 }, { formatIndex: 2 }).textColor, '#0000ff');
});

test('fill patterns become a hatch over the background, colourless ones are skipped', () => {
  assert.equal(T.patternFill(null), null);
  assert.equal(T.patternFill({ pattern: '3' }), null, 'no colour means no pattern');
  assert.equal(T.patternFill({ pattern: '255', patternColor: '#ff0000' }), null);
  const solid = T.patternFill({ pattern: '0', patternColor: '#ff0000' });
  assert.equal(solid.color, '#ff0000');
  const hatch = T.patternFill({ pattern: '7', patternColor: '#00ff00' });
  assert.ok(hatch.image.startsWith('url("data:image/svg+xml'));
  assert.ok(hatch.image.includes(encodeURIComponent('#00ff00')));
  const other = T.patternFill({ pattern: '8', patternColor: '#00ff00' });
  assert.notEqual(other.image, hatch.image, 'each pattern draws its own tile');
  assert.equal(T.patternFill({ pattern: '18', patternColor: '#00ff00' }), null);
});

test('border colour comes from the format instead of always being black', () => {
  const model = { lines: [{ width: 1, style: 'Solid' }], formats: [], fonts: [] };
  assert.equal(T.sideBorder(model, { leftBorder: '0' }, 'left'), '1px solid #000');
  assert.equal(T.sideBorder(model, { leftBorder: '0', bordersColor: '#3366ff' }, 'left'),
    '1px solid #3366ff');
  assert.equal(T.borderCss({ width: 2, style: 'Dotted' }, '#112233'), '2px dotted #112233');
});

test('vertical alignment falls back to the default the model declares', () => {
  assert.equal(T.defaultVAlign({}), 'top');
  assert.equal(T.defaultVAlign({ defaults: { verticalAlignment: 'Bottom' } }), 'bottom');
  assert.equal(T.alignCss('', 'v', 'bottom'), 'bottom');
  assert.equal(T.alignCss('Top', 'v', 'bottom'), 'top', 'an explicit value still wins');
  assert.equal(T.alignCss('Center', 'v', 'bottom'), 'middle');
});

test('Block placement keeps a value that fits and hashes one that does not', () => {
  assert.equal(T.placementOf({ textPlacement: 'Block' }), 'block');
  assert.equal(T.placementOf({ textPlacement: 'Cut' }), 'cut');
  assert.equal(T.placementOf({ horizontalAlignment: 'Justify' }), 'wrap', 'justified text wraps');
  assert.equal(T.blockFit('ab', 200, 8), 'ab');
  assert.equal(T.blockFit('', 200, 8), '');
  assert.equal(T.blockFit('12345678901234567890', 20, 8), '####################');
});

test('spreadsheet units: widths in eighths of a character, heights in 1/288 inch', () => {
  assert.equal(T.widthToPx(72), 63);
  assert.equal(T.heightToPx(45), 15);
  assert.equal(T.fontLinePx({ height: 8 }), 15, 'an Arial 8 line is 15 px');
  assert.equal(T.fontLinePx({ height: 10 }), 17);
});

test('column width falls back column → column set → sheet default → 72; hidden is 0', () => {
  assert.equal(T.columnWidthPx({ width: '16' }, { width: '40' }, null), 14);
  assert.equal(T.columnWidthPx({}, { width: '40' }, { width: '8' }), 35);
  assert.equal(T.columnWidthPx(null, null, { width: '8' }), 7);
  assert.equal(T.columnWidthPx(null, null, null), 63);
  assert.equal(T.columnWidthPx({ width: '16', hidden: 'true' }, null, null), 0);
});

test('auto-width columns share the free width by weight, never below their own width', () => {
  const set = { size: 3, widths: [100, 10, 10], auto: { 1: { weight: 1 }, 2: { weight: 3 } } };
  assert.deepEqual([...T.distributeAutoWidths(set, 500).widths], [100, 100, 300]);
  assert.deepEqual([...T.distributeAutoWidths(set, 50).widths], [100, 10, 10]);
  assert.deepEqual(set.widths, [100, 10, 10], 'the parsed set is not mutated');
});

test('cell format layers: sheet default, column, row, cell', () => {
  const model = {
    formats: [{ font: '1', backColor: '#111' }, { backColor: '#222', width: '20' }, { textColor: '#333' }, { backColor: '#444' }],
    defaultFormatIndex: 1,
    columnSetById: { '': { size: 2, widths: [1, 1], formatIndex: { 1: 2 } } }
  };
  const row = { columnsID: '', formatIndex: 3 };
  const f0 = T.effectiveFormat(model, row, null, 0);
  assert.equal(f0.backColor, '#111');
  assert.equal(f0.textColor, '#333');
  const f1 = T.effectiveFormat(model, row, null, 1);
  assert.equal(f1.backColor, '#222');
  assert.equal(f1.width, undefined, 'a column width is not a cell property');
  assert.equal(T.effectiveFormat(model, row, { col: 1, formatIndex: 4 }).backColor, '#444');
});

test('row height: fixed when positive, content-sized otherwise, capped when negative', () => {
  const fonts = [{ faceName: 'Arial', height: 8 }, { faceName: 'Arial', height: 14 }];
  const model = {
    formats: [{ height: '90' }, { height: '-30' }, { font: '1' }],
    fonts,
    columnSetById: { '': { size: 1, widths: [63], formatIndex: {} } },
    merges: []
  };
  const fixed = T.rowHeight(model, { formatIndex: 1, cells: [] }, 0);
  assert.equal(fixed.px, 30);
  assert.equal(fixed.auto, false);
  const empty = T.rowHeight(model, { formatIndex: 0, cells: [] }, 0);
  assert.equal(empty.px, 15);
  assert.equal(empty.auto, true);
  const big = T.rowHeight(model, { formatIndex: 0, cells: [{ col: 0, formatIndex: 3, text: 'x' }] }, 0);
  assert.equal(big.px, 25);
  const capped = T.rowHeight(model, { formatIndex: 2, cells: [{ col: 0, formatIndex: 3, text: 'x' }] }, 0);
  assert.equal(capped.px, 10);
  assert.equal(capped.max, 10);
  model.merges = [{ r: 0, c: 0, h: 1, w: 0 }];
  assert.equal(T.rowHeight(model, { formatIndex: 0, cells: [{ col: 0, formatIndex: 3, text: 'x' }] }, 0).px, 15,
    'a vertically merged cell does not size the row');
});

test('text padding: margins, indent on the aligned side, three pixels of air as in the configurator', () => {
  assert.deepEqual({ ...T.textPadding({}, 'left') }, { left: 3, right: 3, top: 0, bottom: 0 });
  const p = T.textPadding({ indent: '2', leftMargin: '8', topMargin: '6' }, 'left');
  assert.equal(p.left, 3 + 7 + 14);
  assert.equal(p.top, 2);
  assert.equal(T.textPadding({ indent: '1' }, 'right').right, 10);
});

test('Auto spill stops at a filled neighbour and follows the alignment', () => {
  const set = { size: 5, widths: [10, 20, 20, 20, 20] };
  const row = { cells: [{ col: 2, formatIndex: 0, text: 'x' }, { col: 4, formatIndex: 0, text: 'y' }] };
  const model = { formats: [], fonts: [] };
  const spans = {
    covered: [[false, false, false, false, false]],
    origin: [[null, null, null, null, null]]
  };
  // column 0, left aligned: runs over the empty column 1 and stops at column 2
  const right = T.spillBox(model, row, set, spans, 0, 0, 1, 'left');
  assert.equal(right.left, 0);
  assert.equal(right.width, 30);
  // column 3, right aligned: grows leftwards only, up to the filled column 2
  const left = T.spillBox(model, row, set, spans, 0, 3, 1, 'right');
  assert.equal(left.left, 0);
  assert.equal(left.width, 20);
  // A centred value grows symmetrically so it stays over its own column: with
  // column 2 filled there is nothing to the right of column 1, so it does not
  // drift left either.
  const pinned = T.spillBox(model, row, set, spans, 0, 1, 1, 'center');
  assert.equal(pinned.left, 0);
  assert.equal(pinned.width, 20);
  const openBoth = { size: 5, widths: [20, 20, 20, 20, 20] };
  const edges = { cells: [{ col: 0, formatIndex: 0, text: 'a' }, { col: 4, formatIndex: 0, text: 'b' }] };
  const mid = T.spillBox(model, edges, openBoth, spans, 0, 2, 1, 'center');
  assert.equal(mid.left, -20);
  assert.equal(mid.width, 60);
});

test('drawings render their caption, keep their frame and skip unsupported kinds', () => {
  const container = fakeNode('div');
  const sandbox = loadRenderSandbox();
  const model = {
    height: 1,
    rows: [{ columnsID: '', formatIndex: 0, empty: false, cells: [] }],
    columnSets: [{ id: '', size: 2, widths: [40, 40], formatIndex: {} }],
    columnSetById: { '': { id: '', size: 2, widths: [40, 40], formatIndex: {} } },
    formats: [{ drawingBorder: '0', bordersColor: '#ff0000', textColor: '#00ff00' }],
    fonts: [],
    lines: [{ width: 1, style: 'Solid' }],
    pictures: [],
    merges: [],
    unmerges: [],
    namedItems: [],
    drawings: [
      { drawingType: 'Text', id: 0, text: 'Подпись', formatIndex: 1, beginRow: 0, endRow: 0, beginColumn: 0, endColumn: 1, beginRowOffset: 0, endRowOffset: 0, beginColumnOffset: 0, endColumnOffset: 0, pictureIndex: 0, zOrder: 0 },
      { drawingType: 'Other', id: 1, text: 'Диаграмма', formatIndex: 0, beginRow: 0, endRow: 0, beginColumn: 0, endColumn: 1, beginRowOffset: 0, endRowOffset: 0, beginColumnOffset: 0, endColumnOffset: 0, pictureIndex: 0, zOrder: 1 }
    ]
  };
  sandbox.window.TemplatePreview.render(model, container, {});
  const boxes = walkMatch(container, '.tp-drawing');
  assert.equal(boxes.length, 1, 'the Other object must not be drawn');
  assert.equal(boxes[0].style.border, '1px solid #ff0000');
  const caps = walkMatch(container, '.tp-drawing-text');
  assert.equal(caps.length, 1);
  assert.equal(caps[0].textContent, 'Подпись');
  assert.equal(caps[0].style.color, '#00ff00');
});

test('a shared grid edge is painted once, with the stronger of the two sides', () => {
  const xml = `<document xmlns="http://v8.1c.ru/8.2/data/spreadsheet" xmlns:v8ui="http://v8.1c.ru/8.1/data/ui" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <columns><size>2</size></columns>
  <rowsItem><index>0</index><row><c><c><f>1</f></c></c><c><c><f>2</f></c></c></row></rowsItem>
  <rowsItem><index>1</index><row><c><c><f>2</f></c></c><c><c><f>2</f></c></c></row></rowsItem>
  <line width="2" gap="false"><v8ui:style xsi:type="v8ui:SpreadsheetDocumentCellLineType">Solid</v8ui:style></line>
  <line width="1" gap="false"><v8ui:style xsi:type="v8ui:SpreadsheetDocumentCellLineType">Solid</v8ui:style></line>
  <format><leftBorder>1</leftBorder><topBorder>1</topBorder><rightBorder>1</rightBorder><bottomBorder>1</bottomBorder></format>
  <format><leftBorder>0</leftBorder><topBorder>0</topBorder><rightBorder>0</rightBorder><bottomBorder>0</bottomBorder></format>
</document>`;
  const m = TP.parse(xml).model;
  const set = T.columnSetOf ? T.columnSetOf(m, '') : m.columnSetById[''];
  const group = { start: 0, end: 2, columnsID: '' };
  const at = (y, c) => T.collapseBorders(m, group, set, y, c, 1, 1, T.spanBorders(m, y, c, 1, 1));
  const first = at(0, 0);
  assert.equal(first.left, '1px solid #000', 'the group edge keeps its own side');
  assert.equal(first.right, '2px solid #000', 'the neighbour’s stronger left side wins the shared edge');
  assert.equal(first.bottom, '2px solid #000');
  const second = at(0, 1);
  assert.equal(second.left, '', 'the left neighbour already painted this edge');
  assert.equal(at(1, 0).top, '', 'the row above already painted this edge');
});

test('a merged neighbour lends only its origin border to a shared edge', () => {
  /* Row 2 merges columns 1..3; its hidden cells carry a medium top from Excel,
   * the origin has none, so the row above must not get a thick bottom line. */
  const xml = `<document xmlns="http://v8.1c.ru/8.2/data/spreadsheet" xmlns:v8ui="http://v8.1c.ru/8.1/data/ui" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <columns><size>3</size></columns>
  <rowsItem><index>0</index><row><c><c><f>1</f></c></c><c><c><f>1</f></c></c><c><c><f>1</f></c></c></row></rowsItem>
  <rowsItem><index>1</index><row><c><c><f>1</f></c></c><c><c><f>2</f></c></c><c><c><f>2</f></c></c></row></rowsItem>
  <merge><r>1</r><c>0</c><w>2</w></merge>
  <line width="2" gap="false"><v8ui:style xsi:type="v8ui:SpreadsheetDocumentCellLineType">Solid</v8ui:style></line>
  <format><font>0</font></format>
  <format><topBorder>0</topBorder><leftBorder>0</leftBorder></format>
</document>`;
  const m = TP.parse(xml).model;
  const set = m.columnSetById[''];
  const group = { start: 0, end: 2, columnsID: '' };
  for (let c = 0; c < 3; c++) {
    const b = T.collapseBorders(m, group, set, 0, c, 1, 1, T.spanBorders(m, 0, c, 1, 1));
    assert.equal(b.bottom, '', `column ${c + 1}: no line from a hidden cell of the merge`);
  }
  const left = T.collapseBorders(m, group, set, 1, 0, 1, 1, T.spanBorders(m, 1, 0, 1, 1));
  assert.equal(left.right, '', 'an interior hidden cell does not draw the area edge either');
});

test('a line under part of a wide merged row stays over that part only', () => {
  /* Row 1 merges all three columns; below it a framed block covers column 3
   * only. The merged row cannot paint a partial bottom, so the block paints
   * its own top and the rest of the edge stays clear. */
  const xml = `<document xmlns="http://v8.1c.ru/8.2/data/spreadsheet" xmlns:v8ui="http://v8.1c.ru/8.1/data/ui" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <columns><size>3</size></columns>
  <rowsItem><index>0</index><row><c><c><f>1</f></c></c></row></rowsItem>
  <rowsItem><index>1</index><row><c><c><f>1</f></c></c><c><c><f>1</f></c></c><c><c><f>2</f></c></c></row></rowsItem>
  <merge><r>0</r><c>0</c><w>2</w></merge>
  <line width="2" gap="false"><v8ui:style xsi:type="v8ui:SpreadsheetDocumentCellLineType">Solid</v8ui:style></line>
  <format><font>0</font></format>
  <format><topBorder>0</topBorder><leftBorder>0</leftBorder></format>
</document>`;
  const m = TP.parse(xml).model;
  const set = m.columnSetById[''];
  const group = { start: 0, end: 2, columnsID: '' };
  const at = (y, c, h, w) => T.collapseBorders(m, group, set, y, c, h, w, T.spanBorders(m, y, c, h, w));
  assert.equal(at(0, 0, 1, 3).bottom, '', 'the merged row does not stretch the block line');
  assert.equal(at(1, 2, 1, 1).top, '2px solid #000', 'the block paints its own top');
  assert.equal(at(1, 1, 1, 1).right, '2px solid #000', 'its left side is uniform for the neighbour, which takes it');
  assert.equal(at(1, 2, 1, 1).left, '');
  assert.equal(at(1, 0, 1, 1).top, '');
});
