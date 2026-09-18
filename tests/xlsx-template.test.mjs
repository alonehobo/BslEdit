import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { loadWebModules } from './helpers/dom.mjs';
import { loadXlsxTemplate } from '../tools/xlsx-to-template.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const XT = loadXlsxTemplate();
const TP = loadWebModules(root, ['xml-util.js', 'template-preview.js']).window.TemplatePreview;

/* Minimal ZIP writer: fixtures are built from XML strings, so no binary
 * workbooks live in the repository. Entries alternate deflated and stored. */
function crc32(buf) {
  let crc = 0xffffffff;
  for (const b of buf) {
    let c = (crc ^ b) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  Object.entries(files).forEach(([name, text], i) => {
    const raw = Buffer.isBuffer(text) ? text : Buffer.from(text, 'utf8');
    const deflate = i % 2 === 0;
    const data = deflate ? zlib.deflateRawSync(raw) : raw;
    const nameBuf = Buffer.from(name, 'utf8');
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(0x800, 6);
    head.writeUInt16LE(deflate ? 8 : 0, 8);
    head.writeUInt32LE(crc32(raw), 14);
    head.writeUInt32LE(data.length, 18);
    head.writeUInt32LE(raw.length, 22);
    head.writeUInt16LE(nameBuf.length, 26);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(0x800, 8);
    cen.writeUInt16LE(deflate ? 8 : 0, 10);
    cen.writeUInt32LE(crc32(raw), 16);
    cen.writeUInt32LE(data.length, 20);
    cen.writeUInt32LE(raw.length, 24);
    cen.writeUInt16LE(nameBuf.length, 28);
    cen.writeUInt32LE(offset, 42);
    locals.push(head, nameBuf, data);
    centrals.push(cen, nameBuf);
    offset += head.length + nameBuf.length + data.length;
  });
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(centrals.length / 2, 8);
  end.writeUInt16LE(centrals.length / 2, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, cd, end]));
}

const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

function workbook({ sheet, strings = [], definedNames = '', extra = {} }) {
  return zip({
    ...extra,
    '[Content_Types].xml': '<Types/>',
    'xl/workbook.xml': `<?xml version="1.0"?>\n<workbook ${NS}>\n\t<sheets>\n\t\t<sheet name="Лист1" sheetId="1" r:id="rId1"/>\n\t</sheets>\n\t${definedNames}\n</workbook>`,
    'xl/_rels/workbook.xml.rels': `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/>
      <Relationship Id="rId2" Type="${REL}/styles" Target="styles.xml"/>
      <Relationship Id="rId3" Type="${REL}/sharedStrings" Target="sharedStrings.xml"/>
    </Relationships>`,
    'xl/styles.xml': `<styleSheet ${NS}>
      <fonts count="2">
        <font><sz val="11"/><name val="Calibri"/></font>
        <font><b/><sz val="14"/><color rgb="FFFF0000"/><name val="Arial"/></font>
      </fonts>
      <fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>
        <fill><patternFill patternType="solid"><fgColor rgb="FFFFFF00"/></patternFill></fill></fills>
      <borders count="2"><border><left/><right/><top/><bottom/></border>
        <border><left style="thin"><color rgb="FFC8C0AD"/></left><right style="medium"/><top style="dashed"/><bottom style="double"/></border></borders>
      <cellXfs count="3">
        <xf fontId="0" fillId="0" borderId="0"/>
        <xf fontId="1" fillId="2" borderId="1"><alignment horizontal="center" vertical="center" wrapText="1" textRotation="90"/></xf>
        <xf fontId="0" fillId="0" borderId="0" numFmtId="14"/>
      </cellXfs>
    </styleSheet>`,
    'xl/sharedStrings.xml': `<sst ${NS}>\n${strings.map((s) => `\t<si>\n\t\t<t xml:space="preserve">${s}</t>\n\t</si>`).join('\n')}\n</sst>`,
    'xl/worksheets/sheet1.xml': `<worksheet ${NS}>${sheet}</worksheet>`
  });
}

function parseTemplate(xml) {
  const parsed = TP.parse(xml);
  assert.equal(parsed.error, undefined, parsed.error);
  return parsed.model;
}

const fmtOf = (m, idx) => m.formats[idx - 1] || {};
/* Objects built inside the VM sandbox have foreign prototypes. */
const plain = (v) => JSON.parse(JSON.stringify(v));

test('converts text, styles, sizes and merges into a template the preview parses', async () => {
  const bytes = workbook({
    strings: ['Заголовок &amp; план', 'Итого'],
    sheet: `<sheetFormatPr defaultRowHeight="15"/>
      <cols><col min="1" max="2" width="10.5" customWidth="1"/><col min="3" max="3" width="25.832" customWidth="1" hidden="1"/></cols>
      <sheetData>
        <row r="1" ht="30" customHeight="1"><c r="A1" s="1" t="s"><v>0</v></c><c r="B1" s="1"/></row>
        <row r="3"><c r="B3"><v>12.5</v></c><c r="C3" s="1" t="s"><v>1</v></c></row>
        <row r="4"><c r="A4" s="2"><v>46287</v></c><c r="B4" s="1" t="inlineStr"><is><t>встроенная</t></is></c><c r="C4"><f>A4+1</f><v>7</v></c></row>
      </sheetData>
      <mergeCells count="1"><mergeCell ref="A1:B1"/><mergeCell ref="B3:C4"/></mergeCells>`
  });
  const { xml, summary } = await XT.convert(bytes);
  assert.equal(summary.rows, 4);
  assert.equal(summary.columns, 3);
  assert.equal(summary.merges, 2);
  assert.ok(summary.warnings.some((w) => w.includes('Формулы (1)')));

  const m = parseTemplate(xml);
  const set = m.columnSetById[''];
  assert.equal(set.size, 3);
  const colFmt = (i) => fmtOf(m, set.formatIndex[i]);
  assert.equal(colFmt(0).width, '72', '10.5 Excel chars → 72 units, as the platform import does');
  assert.equal(colFmt(2).width, '0', 'hidden column');

  assert.equal(fmtOf(m, m.rows[0].formatIndex).height, '120', '30 pt → 120 units of 1/288 inch');
  const title = m.rows[0].cells[0];
  assert.equal(title.text, 'Заголовок & план', 'no pretty-printing whitespace leaks into the text');
  const tf = fmtOf(m, title.formatIndex);
  assert.equal(m.fonts[+tf.font].faceName, 'Arial');
  assert.equal(m.fonts[+tf.font].height, 14);
  assert.equal(m.fonts[+tf.font].bold, true);
  assert.equal(tf.textColor, '#FF0000');
  assert.equal(tf.backColor, '#FFFF00');
  assert.equal(tf.horizontalAlignment, 'Center');
  assert.equal(tf.verticalAlignment, 'Center');
  assert.equal(tf.textPlacement, 'Wrap');
  assert.equal(tf.textOrientation, '900');
  assert.equal(tf.bordersColor, '#C8C0AD', 'the borderColor tag reaches the renderer');
  assert.deepEqual(plain(m.lines[+tf.leftBorder]), { width: 1, gap: false, style: 'Solid' });
  assert.deepEqual(plain(m.lines[+tf.rightBorder]), { width: 2, gap: false, style: 'Solid' });
  assert.equal(m.lines[+tf.topBorder].style, 'Dashed');
  assert.equal(m.lines[+tf.bottomBorder].style, 'Double');

  assert.deepEqual(plain(m.merges.map(({ r, c, h, w }) => ({ r, c, h, w }))), [{ r: 0, c: 0, h: 0, w: 1 }, { r: 2, c: 1, h: 1, w: 1 }]);
  assert.equal(m.rows[1].empty, true);
  const b3 = fmtOf(m, m.rows[2].cells[0].formatIndex);
  assert.equal(m.lines[+b3.bottomBorder].style, 'Double', 'a merge takes its bottom border from the last row (B4)');
  assert.equal(m.lines[+b3.rightBorder].width, 2, 'and its right border from the last column (C3)');
  assert.equal(b3.leftBorder, undefined, 'but keeps the left border of its own cell');
  assert.equal(fmtOf(m, m.defaultFormatIndex).width, '58', 'default column: 8.43 chars');
  assert.deepEqual(plain(m.rows[2].cells.map((c) => [c.col, c.text])), [[1, '12,5'], [2, 'Итого']], 'cells keep their columns');
  assert.deepEqual(plain(m.rows[3].cells.map((c) => c.text)), ['22.09.2026', 'встроенная', '7']);
});

test('defined names become areas and [Имя] becomes parameters or templates', async () => {
  const bytes = workbook({
    strings: ['[Номер]', 'Счёт № [Номер] от [Дата]'],
    definedNames: `<definedNames>
      <definedName name="Шапка">Лист1!$1:$2</definedName>
      <definedName name="Колонка">'Лист1'!$B:$C</definedName>
      <definedName name="Блок">Лист1!$A$3:$B$4</definedName>
      <definedName name="_xlnm.Print_Area" localSheetId="0">Лист1!$A$1:$C$4</definedName>
      <definedName name="Битое">Лист1!#REF!</definedName>
    </definedNames>`,
    sheet: `<sheetData>
      <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>
      <row r="4"><c r="C4"><v>1</v></c></row>
    </sheetData>`
  });
  const { xml, summary } = await XT.convert(bytes);
  assert.deepEqual(plain(summary.parameters), ['Номер']);
  assert.equal(summary.templateCells, 1);
  assert.ok(summary.warnings.some((w) => w.includes('Битое')));

  const m = parseTemplate(xml);
  const areas = m.namedItems.map(({ name, type, beginRow, endRow, beginColumn, endColumn }) => ({ name, type, beginRow, endRow, beginColumn, endColumn }));
  assert.deepEqual(plain(areas), [
    { name: 'Шапка', type: 'Rows', beginRow: 0, endRow: 1, beginColumn: -1, endColumn: -1 },
    { name: 'Колонка', type: 'Columns', beginRow: -1, endRow: -1, beginColumn: 1, endColumn: 2 },
    { name: 'Блок', type: 'Rectangle', beginRow: 2, endRow: 3, beginColumn: 0, endColumn: 1 }
  ]);
  const [param, tmpl] = m.rows[0].cells;
  assert.equal(param.parameter, 'Номер');
  assert.equal(param.text, '');
  assert.equal(fmtOf(m, param.formatIndex).fillType, 'Parameter');
  assert.equal(tmpl.text, 'Счёт № [Номер] от [Дата]');
  assert.equal(fmtOf(m, tmpl.formatIndex).fillType, 'Template');
});

test('column and row styles become layer formats; footers keep text and page fields', async () => {
  const bytes = workbook({
    sheet: `<cols><col min="1" max="1" width="10.5" style="1"/></cols>
      <sheetData>
        <row r="1" s="2" customFormat="1"><c r="B1"><v>1</v></c></row>
      </sheetData>
      <headerFooter><oddFooter>&amp;L&amp;"Times New Roman,Bold"&amp;10Подпись:&#10;Директор&amp;RСтр. &amp;P из &amp;N</oddFooter></headerFooter>`
  });
  const { xml } = await XT.convert(bytes);
  const m = parseTemplate(xml);
  const colFmt = fmtOf(m, m.columnSetById[''].formatIndex[0]);
  assert.equal(colFmt.width, '72');
  assert.equal(colFmt.horizontalAlignment, 'Center', 'the column carries its Excel style');
  assert.equal(colFmt.verticalAlignment, 'Center');
  const rowFmt = fmtOf(m, m.rows[0].formatIndex);
  assert.equal(rowFmt.font != null, true, 'the row carries its Excel style');
  assert.equal(rowFmt.verticalAlignment, undefined, 'a layer does not pin the implicit bottom alignment');

  assert.match(xml, /<leftFooter>\s*<f>(\d+)<\/f>\s*<tl>\s*<v8:item>\s*<v8:lang>ru<\/v8:lang>\s*<v8:content>Подпись:\nДиректор<\/v8:content>/);
  assert.match(xml, /<centerFooter>\s*<f>\d+<\/f>\s*<tl\/>\s*<\/centerFooter>/);
  assert.match(xml, /<v8:content>Стр\. \[&amp;НомерСтраницы\] из \[&amp;СтраницВсего\]<\/v8:content>/);
  const footFont = m.fonts[+fmtOf(m, +/<leftFooter>\s*<f>(\d+)/.exec(xml)[1]).font];
  assert.equal(footFont.faceName, 'Times New Roman');
  assert.equal(footFont.bold, true);
  assert.ok(xml.indexOf('</rightFooter>') < xml.indexOf('<templateMode>'), 'footers precede templateMode, as Designer writes them');
});

test('picks a sheet by name and rejects files that are not workbooks', async () => {
  const bytes = workbook({ sheet: '<sheetData/>' });
  await assert.rejects(XT.convert(bytes, { sheet: 'Нет такого' }), /Листы: Лист1/);
  await assert.rejects(XT.convert(new Uint8Array([1, 2, 3])), /не похож на xlsx/);
  const { summary } = await XT.convert(Buffer.from(bytes).toString('base64'), { sheet: 'Лист1' });
  assert.equal(summary.sheet, 'Лист1');
});

test('Excel number and date formats become 1C format strings', () => {
  const f = (id, codes = {}) => XT._test.oneCFormat({ numFmts: codes }, id);
  assert.equal(f(0), '');
  assert.equal(f(2), 'ЧДЦ=2; ЧГ=0');
  assert.equal(f(4), 'ЧДЦ=2');
  assert.equal(f(3), 'ЧДЦ=0');
  assert.equal(f(14), 'ДФ=dd.MM.yyyy');
  assert.equal(f(22), "ДФ='dd.MM.yyyy H:mm'");
  assert.equal(f(20), 'ДФ=H:mm', 'm after h is minutes');
  assert.equal(f(164, { 164: '#,##0.000"р."' }), 'ЧДЦ=3');
  assert.equal(f(165, { 165: 'dd/mm/yy' }), 'ДФ=dd/MM/yy');
  assert.equal(f(166, { 166: '0%' }), '', 'percent is left to the author');
  assert.equal(f(167, { 167: '@' }), '');
});

test('page setup, margins and the print area come over from the workbook', async () => {
  const bytes = workbook({
    definedNames: `<definedNames><definedName name="_xlnm.Print_Area" localSheetId="0">Лист1!$A$1:$C$4</definedName>
      <definedName name="_xlnm.Print_Titles" localSheetId="0">Лист1!$1:$1</definedName></definedNames>`,
    sheet: `<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>
      <sheetData><row r="1"><c r="A1"><v>1</v></c></row></sheetData>
      <pageMargins left="0.984" right="0.3937" top="0.3937" bottom="1.3386" header="0" footer="0.3937"/>
      <pageSetup paperSize="9" orientation="landscape" scale="85"/>`
  });
  const { xml, summary } = await XT.convert(bytes);
  assert.match(xml, /<printSettings>\n\t\t<pageOrientation>Landscape<\/pageOrientation>\n\t\t<scale>85<\/scale>\n\t\t<topMargin>1000<\/topMargin>\n\t\t<leftMargin>2499<\/leftMargin>/);
  assert.match(xml, /<fitToPage>true<\/fitToPage>\n\t\t<paper>9<\/paper>/);
  assert.match(xml, /<printArea>\n\t\t<type>Rectangle<\/type>\n\t\t<beginRow>0<\/beginRow>\n\t\t<endRow>3<\/endRow>\n\t\t<beginColumn>0<\/beginColumn>\n\t\t<endColumn>2<\/endColumn>\n\t<\/printArea>/);
  assert.ok(xml.indexOf('</printArea>') < xml.indexOf('<line ') || xml.indexOf('<line ') < 0);
  assert.ok(summary.warnings.some((w) => w.includes('Print_Titles')));
  assert.deepEqual(plain(summary.areas), [], 'print names are not areas');
});

test('cell-anchored pictures become drawings with their image data', async () => {
  /* A 1×1 PNG. */
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
  const D = 'http://schemas.openxmlformats.org/drawingml/2006';
  const bytes = workbook({
    sheet: `<sheetData><row r="1"><c r="A1"><v>1</v></c></row></sheetData><drawing r:id="rId1"/>`,
    extra: {
      'xl/worksheets/_rels/sheet1.xml.rels': `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/drawing" Target="../drawings/drawing1.xml"/></Relationships>`,
      'xl/drawings/drawing1.xml': `<xdr:wsDr xmlns:xdr="${D}/spreadsheetDrawing" xmlns:a="${D}/main" xmlns:r="${REL}">
        <xdr:twoCellAnchor>
          <xdr:from><xdr:col>1</xdr:col><xdr:colOff>317500</xdr:colOff><xdr:row>2</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>
          <xdr:to><xdr:col>3</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>5</xdr:row><xdr:rowOff>63500</xdr:rowOff></xdr:to>
          <xdr:pic><xdr:nvPicPr><xdr:cNvPr id="2" name="Логотип"/></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rId1"/></xdr:blipFill></xdr:pic>
        </xdr:twoCellAnchor>
        <xdr:absoluteAnchor><xdr:sp/></xdr:absoluteAnchor>
      </xdr:wsDr>`,
      'xl/drawings/_rels/drawing1.xml.rels': `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/image" Target="../media/image1.png"/></Relationships>`,
      'xl/media/image1.png': png
    }
  });
  const { xml, summary } = await XT.convert(bytes);
  assert.equal(summary.pictures, 1);
  assert.ok(summary.warnings.some((w) => w.includes('без привязки к ячейкам не переносятся (1)')), JSON.stringify(summary));
  const m = parseTemplate(xml);
  assert.equal(m.height, 6, 'the document grows to hold the picture');
  const d = m.drawings[0];
  assert.deepEqual(plain([d.beginRow, d.beginRowOffset, d.endRow, d.endRowOffset, d.beginColumn, d.beginColumnOffset, d.endColumn, d.endColumnOffset]),
    [2, 0, 5, 20, 1, 100, 3, 0], 'EMU offsets become 1/288 inch');
  assert.equal(d.pictureIndex, 1);
  assert.equal(d.pictureSize, 'Stretch', 'no aspect lock: the picture fills its anchor');
  assert.equal(m.pictures[0].data, png.toString('base64'));
  assert.equal(TP._test.pictureDataUrl(m, d.pictureIndex), 'data:image/png;base64,' + png.toString('base64'));
  assert.match(xml, /SpreadsheetDocumentDrawingLineType">None/);
  const fmt = m.formats[d.formatIndex - 1];
  assert.equal(m.lines[+fmt.drawingBorder].style, 'None');
});

test('cached numbers read as the sheet shows them, and sheet-wide column styles do not widen the document', async () => {
  const n = (num, id, codes = {}) => XT._test.displayNumber(num, { numFmts: codes }, id);
  const nb = String.fromCharCode(160);
  assert.equal(n(134933.32999999999, 0), '134933,33');
  assert.equal(n(0.1 + 0.2, 0), '0,3');
  assert.equal(n(134933.32999999999, 4), `134${nb}933,33`);
  assert.equal(n(12, 43, { 43: '_-* #,##0.00_-;\-* #,##0.00_-;_-* "-"??_-;_-@_-' }), '12,00');
  assert.equal(n(-5.5, 1), '-6');
  assert.equal(n(0.256, 164, { 164: '0.0%' }), '25,6%');

  const bytes = workbook({
    sheet: `<cols><col min="1" max="2" width="12" customWidth="1"/><col min="3" max="16384" width="9" style="1"/></cols>
      <sheetData><row r="1"><c r="B1"><v>1</v></c></row></sheetData>`
  });
  const { summary } = await XT.convert(bytes);
  assert.equal(summary.columns, 2);
});
