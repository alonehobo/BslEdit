import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BrowserSession } from '../src/browser-session.js';
import { FileLoader } from '../src/files.js';

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const builtAssetsDir = path.join(packageDir, 'build', 'web');
const maxBytes = 64 * 1024 * 1024;
let assetsDir = builtAssetsDir;
let isolatedAssetsRoot = '';

test.before(async () => {
  isolatedAssetsRoot = await fs.mkdtemp(path.join(os.tmpdir(), '1c-table-width-assets-'));
  assetsDir = path.join(isolatedAssetsRoot, 'web');
  await fs.cp(builtAssetsDir, assetsDir, { recursive: true });
});

test.after(async () => {
  if (isolatedAssetsRoot) await fs.rm(isolatedAssetsRoot, { recursive: true, force: true });
});

function options(root: string, width: number) {
  return {
    roots: [root], allowAnyPath: false, viewport: { width, height: 620 },
    headless: true, maxBytes, assetsDir,
  };
}

function fixedTablesForm() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Form xmlns="http://v8.1c.ru/8.3/xcf/logform"><Group>Vertical</Group><ChildItems>
  <Table name="DefaultFixed" id="1"><HorizontalStretch>false</HorizontalStretch><Height>2</Height><CommandBarLocation>None</CommandBarLocation><ChildItems><InputField name="A" id="2"><Width>10</Width></InputField></ChildItems></Table>
  <Table name="Width20Fixed" id="3"><Width>20</Width><MaxWidth>30</MaxWidth><HorizontalStretch>false</HorizontalStretch><Height>2</Height><CommandBarLocation>None</CommandBarLocation><ChildItems><InputField name="B" id="4"><Width>10</Width></InputField></ChildItems></Table>
  <Table name="Width60Vertical" id="5"><Width>60</Width><HorizontalStretch>false</HorizontalStretch><VerticalStretch>true</VerticalStretch><Height>2</Height><CommandBarLocation>None</CommandBarLocation><ChildItems><InputField name="C" id="6"><Width>10</Width></InputField></ChildItems></Table>
  <Table name="Width20Stretch" id="7"><Width>20</Width><HorizontalStretch>true</HorizontalStretch><Height>2</Height><CommandBarLocation>None</CommandBarLocation><ChildItems><InputField name="D" id="8"><Width>10</Width></InputField></ChildItems></Table>
</ChildItems></Form>`;
}

function fixedTableChromeAndNestingForm() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Form xmlns="http://v8.1c.ru/8.3/xcf/logform"><Group>Vertical</Group><ChildItems>
  <Table name="ChromeFixed" id="10"><Width>40</Width><HorizontalStretch>false</HorizontalStretch><Height>2</Height>
    <AutoCommandBar name="ChromeBar" id="11"><Autofill>false</Autofill><ChildItems>
      <Button name="CreateDocument" id="12"><Representation>Text</Representation></Button>
      <Button name="FillFromSelection" id="13"><Representation>Text</Representation></Button>
      <Button name="RecalculateAmounts" id="14"><Representation>Text</Representation></Button>
    </ChildItems></AutoCommandBar>
    <SearchStringAddition name="ChromeSearch" id="15"/>
    <ViewStatusAddition name="ChromeStatus" id="16"/>
    <ChildItems><InputField name="ChromeColumn" id="17"><Width>10</Width></InputField></ChildItems>
  </Table>
  <UsualGroup name="HorizontalHost" id="20"><Group>Horizontal</Group><ChildItems>
    <Table name="HorizontalFixed" id="21"><Width>60</Width><HorizontalStretch>false</HorizontalStretch><Height>2</Height><CommandBarLocation>None</CommandBarLocation><ChildItems><InputField name="H" id="22"/></ChildItems></Table>
    <LabelDecoration name="AfterTable" id="23"/>
  </ChildItems></UsualGroup>
  <Pages name="PagesHost" id="30"><ChildItems><Page name="MainPage" id="31"><ChildItems>
    <Table name="PageFixed" id="32"><Width>60</Width><HorizontalStretch>false</HorizontalStretch><Height>2</Height><CommandBarLocation>None</CommandBarLocation><ChildItems><InputField name="P" id="33"/></ChildItems></Table>
  </ChildItems></Page></ChildItems></Pages>
</ChildItems></Form>`;
}

test('HorizontalStretch=false keeps the reference table width across responsive resize', async (t) => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), '1c-table-fixed-width-'));
  const formPath = path.join(tempRoot, 'Form.xml');
  await fs.writeFile(formPath, fixedTablesForm());
  const loader = await FileLoader.create([tempRoot], maxBytes);
  const browser = new BrowserSession(options(tempRoot, 900));
  t.after(async () => {
    await browser.close();
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  await browser.open(await loader.load(formPath));
  const page = (browser as unknown as { page: import('playwright-core').Page }).page;
  const widths = async () => page.locator('.fp-body').evaluate((body) => {
    const style = getComputedStyle(body);
    return {
      available: body.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
      defaultFixed: (body.querySelector('[data-id="1"]') as HTMLElement).getBoundingClientRect().width,
      width20: (body.querySelector('[data-id="3"]') as HTMLElement).getBoundingClientRect().width,
      width60: (body.querySelector('[data-id="5"]') as HTMLElement).getBoundingClientRect().width,
      stretch: (body.querySelector('[data-id="7"]') as HTMLElement).getBoundingClientRect().width,
    };
  });

  const wide = await widths();
  assert.deepEqual({ defaultFixed: wide.defaultFixed, width20: wide.width20, width60: wide.width60 },
    { defaultFixed: 400, width20: 200, width60: 600 });
  assert.equal(wide.stretch, wide.available);

  await page.setViewportSize({ width: 520, height: 620 });
  const narrow = await widths();
  assert.equal(narrow.defaultFixed, 400);
  assert.equal(narrow.width20, 200);
  assert.equal(narrow.width60, 600);
  assert.equal(narrow.stretch, narrow.available);

  await page.setViewportSize({ width: 900, height: 620 });
  assert.deepEqual(await widths(), wide);
});

test('fixed grid and wider chrome keep the nearest nested scrollports reversible', async (t) => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), '1c-table-fixed-chrome-'));
  const formPath = path.join(tempRoot, 'Form.xml');
  await fs.writeFile(formPath, fixedTableChromeAndNestingForm());
  const loader = await FileLoader.create([tempRoot], maxBytes);
  const browser = new BrowserSession(options(tempRoot, 900));
  t.after(async () => {
    await browser.close();
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  await browser.open(await loader.load(formPath));
  const page = (browser as unknown as { page: import('playwright-core').Page }).page;
  const geometry = async () => page.locator('.fp-body').evaluate((body) => {
    const chrome = body.querySelector('[data-id="10"]') as HTMLElement;
    const widget = chrome.querySelector('.fp-table-widget') as HTMLElement;
    const grid = chrome.querySelector('.fp-table-mock') as HTMLElement;
    const horizontal = body.querySelector('[data-id="21"]') as HTMLElement;
    const pageTable = body.querySelector('[data-id="32"]') as HTMLElement;
    const pageScroll = pageTable.closest('.fp-pages-active-panel') as HTMLElement;
    return {
      chrome: chrome.getBoundingClientRect().width,
      widget: widget.getBoundingClientRect().width,
      grid: grid.getBoundingClientRect().width,
      horizontal: horizontal.getBoundingClientRect().width,
      pageTable: pageTable.getBoundingClientRect().width,
      bodyClient: (body as HTMLElement).clientWidth,
      bodyScroll: (body as HTMLElement).scrollWidth,
      pageClient: pageScroll.clientWidth,
      pageScroll: pageScroll.scrollWidth,
      gridOwnsHorizontalScroll: grid.scrollWidth > grid.clientWidth + 1,
    };
  });

  const wide = await geometry();
  assert.equal(wide.grid, 400);
  assert.equal(wide.chrome, wide.widget);
  assert.ok(wide.widget > wide.grid, JSON.stringify(wide));
  assert.equal(wide.horizontal, 600);
  assert.equal(wide.pageTable, 600);

  await page.setViewportSize({ width: 420, height: 620 });
  const narrow = await geometry();
  assert.equal(narrow.grid, 400);
  assert.equal(narrow.widget, wide.widget);
  assert.equal(narrow.horizontal, 600);
  assert.equal(narrow.pageTable, 600);
  assert.ok(narrow.bodyScroll > narrow.bodyClient, JSON.stringify(narrow));
  assert.ok(narrow.pageScroll > narrow.pageClient, JSON.stringify(narrow));
  assert.equal(narrow.gridOwnsHorizontalScroll, false);

  await page.setViewportSize({ width: 900, height: 620 });
  const restored = await geometry();
  assert.equal(restored.widget, wide.widget);
  assert.equal(restored.grid, wide.grid);
  assert.equal(restored.horizontal, wide.horizontal);
  assert.equal(restored.pageTable, wide.pageTable);
});
