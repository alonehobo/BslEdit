import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BrowserSession } from '../src/browser-session.js';
import { FileLoader } from '../src/files.js';

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const maxBytes = 64 * 1024 * 1024;
const form = `<?xml version="1.0" encoding="UTF-8"?>
<Form xmlns="http://v8.1c.ru/8.3/xcf/logform"><ChildItems>
<Pages name="Разделы" id="100"><ChildItems>
<Page name="Первая" id="101"><ChildItems><LabelDecoration name="Цель" id="103"/></ChildItems></Page>
<Page name="Вторая" id="102"><ChildItems><LabelDecoration name="Другое" id="104"/></ChildItems></Page>
</ChildItems></Pages></ChildItems></Form>`;

test('Node preview navigates without requesting annotations', async (t) => {
  const { browser, page } = await openForm(t);
  const annotationRequests: string[] = [];
  page.on('request', (request: any) => {
    if (new URL(request.url()).pathname.endsWith('/annotations')) annotationRequests.push(request.url());
  });
  await page.goto(browser.previewUrl(), { waitUntil: 'load' });
  await page.waitForFunction(() => !document.getElementById('preview')?.hasAttribute('hidden'));
  await page.locator('.fp-pages-tab').nth(1).click();
  assert.equal(await page.locator('.fp-pages-tab').nth(1).getAttribute('aria-selected'), 'true');
  assert.equal(await page.locator('#preview [data-id="104"]').count(), 1);
  assert.equal(await page.locator('#annotation-toggle').isVisible(), false);
  assert.deepEqual(annotationRequests, []);
});

test('annotations follow user and agent tab switches without changing the form DOM', async (t) => {
  const { browser, page } = await openForm(t);
  const annotations = [
    { id: 'a1', elementId: '103', elementName: 'Цель', text: 'Первый' },
    { id: 'a2', elementId: '103', elementName: 'Цель', text: 'Второй' },
  ];
  await page.route('**/state.json', async (route: any) => {
    const response = await route.fetch();
    const state = await response.json();
    await route.fulfill({ response, json: { ...state, annotations } });
  });
  await page.goto(browser.previewUrl(), { waitUntil: 'load' });
  await page.waitForFunction(() => document.querySelectorAll('.annotation-anchor').length === 2);
  const markers = page.locator('.annotation-anchor');
  assert.equal(await page.locator('#annotation-toggle').isVisible(), true);
  assert.deepEqual(await markers.evaluateAll((nodes: Element[]) => nodes.map((node) => node.getAttribute('data-note'))), ['Первый', 'Второй']);
  assert.equal(await page.locator('#preview .annotation-anchor').count(), 0);
  await page.locator('.fp-pages-tab').nth(1).click();
  await page.waitForFunction(() => Array.from(document.querySelectorAll('.annotation-anchor')).every((marker) => (marker as HTMLElement).hidden));
  assert.deepEqual(await markerState(page), [true, true]);
  await page.locator('.fp-pages-tab').nth(0).click();
  await page.waitForFunction(() => Array.from(document.querySelectorAll('.annotation-anchor')).every((marker) => !(marker as HTMLElement).hidden));
  assert.deepEqual(await markerState(page), [false, false]);
  await page.evaluate(() => window.AgentViewer.switchTab('102', '100'));
  assert.deepEqual(await markerState(page), [true, true]);
  await page.evaluate(() => window.AgentViewer.switchTab('101', '100'));
  assert.deepEqual(await markerState(page), [false, false]);
  assert.equal(await page.locator('#preview .annotation-anchor').count(), 0);
});

test('annotation on an initially inactive tab appears when the tab first opens', async (t) => {
  const { browser, page } = await openForm(t);
  await page.route('**/state.json', async (route: any) => {
    const response = await route.fetch();
    const state = await response.json();
    await route.fulfill({ response, json: { ...state, annotations: [
      { id: 'a1', elementId: '104', elementName: 'Другое', text: 'Скрытая вкладка' },
    ] } });
  });
  await page.goto(browser.previewUrl(), { waitUntil: 'load' });
  await page.waitForFunction(() => document.querySelectorAll('.annotation-anchor').length === 1);
  assert.deepEqual(await markerState(page), [true]);
  await page.evaluate(() => window.AgentViewer.selectElement('104'));
  await page.waitForFunction(() => !(document.querySelector('.annotation-anchor') as HTMLElement).hidden);
  assert.deepEqual(await markerState(page), [false]);
});

test('late completion of an older revision does not restore its annotations', async (t) => {
  const { browser, page, reload } = await openForm(t);
  await page.goto(browser.previewUrl(), { waitUntil: 'load' });
  const initial = await (await page.request.get(new URL('state.json', browser.previewUrl()).href)).json();
  const oldRevision = initial.revision + 1;
  await page.evaluate((revision: number) => {
    const load = window.AgentViewer.load;
    window.AgentViewer.load = function (input: any) {
      const result = load(input);
      if (input.revision !== revision) return result;
      return new Promise((resolve) => {
        (window as any).releaseOldRevision = () => resolve(result);
      });
    };
  }, oldRevision);
  await page.route('**/state.json', async (route: any) => {
    const response = await route.fetch();
    const state = await response.json();
    await route.fulfill({ response, json: { ...state, annotations: [{
      id: state.revision === oldRevision ? 'old' : 'new',
      elementId: '103', elementName: 'Цель', text: state.revision === oldRevision ? 'Старая' : 'Новая',
    }] } });
  });
  await reload();
  await page.waitForFunction(() => typeof (window as any).releaseOldRevision === 'function');
  await reload();
  await page.waitForFunction(() => document.querySelector('.annotation-anchor')?.getAttribute('data-note') === 'Новая');
  assert.equal(await page.evaluate(() => document.querySelector('.annotation-anchor')?.getAttribute('data-note')), 'Новая');
  assert.equal(await page.evaluate(() => typeof (window as any).releaseOldRevision), 'function');
  const afterLateCompletion = await page.evaluate(async () => {
    (window as any).releaseOldRevision();
    await new Promise((resolve) => setTimeout(resolve, 0));
    return document.querySelector('.annotation-anchor')?.getAttribute('data-note');
  });
  assert.equal(afterLateCompletion, 'Новая');
});

async function openForm(t: { after: (cleanup: () => Promise<void>) => void }) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), '1c-annotations-'));
  const formPath = path.join(root, 'Form.xml');
  await fs.writeFile(formPath, form);
  const browser = new BrowserSession({ roots: [root], allowAnyPath: false,
    viewport: { width: 640, height: 480 }, headless: true, maxBytes,
    assetsDir: path.join(packageDir, 'build', 'web') });
  t.after(async () => {
    await browser.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  const loader = await FileLoader.create([root], maxBytes);
  await browser.open(await loader.load(formPath));
  const page = await (browser as unknown as { context: { newPage: () => Promise<any> } }).context.newPage();
  return { browser, page, reload: async () => browser.open(await loader.load(formPath)) };
}

async function markerState(page: any): Promise<boolean[]> {
  return page.locator('.annotation-anchor').evaluateAll((markers: HTMLElement[]) => markers.map((marker) => marker.hidden));
}
