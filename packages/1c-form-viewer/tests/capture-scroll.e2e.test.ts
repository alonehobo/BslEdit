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

function wideTableForm(): string {
  const columns = Array.from({ length: 20 }, (_, index) =>
    `<InputField name="Column${index}" id="${200 + index}"><Title><item><lang>en</lang><content>Column ${index}</content></item></Title><Width>18</Width></InputField>`,
  ).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<Form xmlns="http://v8.1c.ru/8.3/xcf/logform">
  <ChildItems><Table name="WideTable" id="130"><ChildItems>${columns}</ChildItems></Table></ChildItems>
</Form>`;
}

function longForm(): string {
  const fields = Array.from({ length: 70 }, (_, index) =>
    `<InputField name="Field${index}" id="${500 + index}"><Title><item><lang>en</lang><content>Field ${index}</content></item></Title></InputField>`,
  ).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<Form xmlns="http://v8.1c.ru/8.3/xcf/logform"><ChildItems>${fields}</ChildItems></Form>`;
}

test('AgentViewer capture preserves a table horizontal scroll position', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), '1c-capture-scroll-'));
  const assetsRoot = await fs.mkdtemp(path.join(os.tmpdir(), '1c-capture-scroll-assets-'));
  const assetsDir = path.join(assetsRoot, 'web');
  const formPath = path.join(root, 'Form.xml');
  await fs.cp(builtAssetsDir, assetsDir, { recursive: true });
  await fs.writeFile(formPath, wideTableForm());

  const loader = await FileLoader.create([root], maxBytes);
  const browser = new BrowserSession({
    roots: [root], allowAnyPath: false, viewport: { width: 640, height: 360 },
    headless: true, maxBytes, assetsDir,
  });
  t.after(async () => {
    await browser.close();
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(assetsRoot, { recursive: true, force: true });
  });

  await browser.open(await loader.load(formPath));
  const page = (browser as unknown as { page: import('playwright-core').Page }).page;
  const result = await page.evaluate(async () => {
    const viewer = window.AgentViewer as typeof window.AgentViewer & {
      capture(scope: 'viewport' | 'element', elementId?: string): Promise<{ data: string }>;
    };
    const owner = document.querySelector<HTMLElement>('[data-id="130"]')!;
    const table = owner.querySelector<HTMLElement>('.fp-table-mock')!;
    const cells = table.querySelectorAll<HTMLElement>('th, td');
    cells.forEach((cell, index) => { cell.style.background = index % 20 < 5 ? 'rgb(220, 20, 60)' : 'rgb(30, 90, 220)'; });
    const ownerRect = owner.getBoundingClientRect();
    const tableRect = table.getBoundingClientRect();
    const bodyCellRect = table.querySelector('tbody td')!.getBoundingClientRect();
    const viewportPoint = {
      x: Math.round(tableRect.left + Math.min(80, tableRect.width / 2)),
      y: Math.round(bodyCellRect.top + bodyCellRect.height / 2),
    };
    const elementPoint = {
      x: Math.round(viewportPoint.x - ownerRect.left),
      y: Math.round(viewportPoint.y - ownerRect.top),
    };
    const beforeElement = await viewer.capture('element', '130');
    const beforeViewport = await viewer.capture('viewport');
    const scroll = viewer.scroll({ target: 'table', elementId: '130', x: 900 }) as {
      after: { x: number; maxX: number };
    };
    const afterElement = await viewer.capture('element', '130');
    const afterViewport = await viewer.capture('viewport');
    const trackLength = table.clientWidth - 2;
    const thumbLength = Math.min(trackLength, Math.max(20, Math.round(trackLength * table.clientWidth / table.scrollWidth)));
    const thumbOffset = Math.round((trackLength - thumbLength) * scroll.after.x / scroll.after.maxX);
    const scrollbarY = Math.round(tableRect.bottom - ownerRect.top - 6);
    const scrollbarTrackX = Math.round(tableRect.left - ownerRect.left + 4);
    const scrollbarThumbX = Math.round(tableRect.left - ownerRect.left + 1 + thumbOffset + thumbLength / 2);
    const images = [beforeElement.data, afterElement.data, beforeViewport.data, afterViewport.data].map((data) => {
      const image = new Image();
      image.src = `data:image/png;base64,${data}`;
      return image;
    });
    await Promise.all(images.map((image) => image.decode()));
    const canvases = images.map((image) => {
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      canvas.getContext('2d')!.drawImage(image, 0, 0);
      return canvas.getContext('2d')!;
    });
    return {
      scroll: scroll.after,
      elementChanged: beforeElement.data !== afterElement.data,
      viewportChanged: beforeViewport.data !== afterViewport.data,
      beforeElementPixel: Array.from(canvases[0].getImageData(elementPoint.x, elementPoint.y, 1, 1).data),
      afterElementPixel: Array.from(canvases[1].getImageData(elementPoint.x, elementPoint.y, 1, 1).data),
      beforeViewportPixel: Array.from(canvases[2].getImageData(viewportPoint.x, viewportPoint.y, 1, 1).data),
      afterViewportPixel: Array.from(canvases[3].getImageData(viewportPoint.x, viewportPoint.y, 1, 1).data),
      scrollbarTrackPixel: Array.from(canvases[1].getImageData(scrollbarTrackX, scrollbarY, 1, 1).data),
      scrollbarThumbPixel: Array.from(canvases[1].getImageData(scrollbarThumbX, scrollbarY, 1, 1).data),
    };
  });

  assert.ok(result.scroll.maxX > 900, JSON.stringify(result));
  assert.equal(result.scroll.x, 900);
  assert.equal(result.elementChanged, true, 'element capture must show the scrolled columns');
  assert.equal(result.viewportChanged, true, 'viewport capture must show the scrolled columns');
  assert.ok(result.beforeElementPixel[0] > result.beforeElementPixel[2], JSON.stringify(result));
  assert.ok(result.afterElementPixel[2] > result.afterElementPixel[0], JSON.stringify(result));
  assert.ok(result.beforeViewportPixel[0] > result.beforeViewportPixel[2], JSON.stringify(result));
  assert.ok(result.afterViewportPixel[2] > result.afterViewportPixel[0], JSON.stringify(result));
  assert.ok(result.scrollbarTrackPixel[0] > result.scrollbarThumbPixel[0], JSON.stringify(result));
});

test('production AgentViewer reload preserves document scroll and document capture expands it', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), '1c-native-ui-reload-'));
  const assetsRoot = await fs.mkdtemp(path.join(os.tmpdir(), '1c-native-ui-reload-assets-'));
  const assetsDir = path.join(assetsRoot, 'web');
  const formPath = path.join(root, 'Form.xml');
  await fs.cp(builtAssetsDir, assetsDir, { recursive: true });
  await fs.writeFile(formPath, longForm());

  const loader = await FileLoader.create([root], maxBytes);
  const input = await loader.load(formPath);
  const browser = new BrowserSession({
    roots: [root], allowAnyPath: false, viewport: { width: 640, height: 360 },
    headless: true, maxBytes, assetsDir,
  });
  t.after(async () => {
    await browser.close();
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(assetsRoot, { recursive: true, force: true });
  });

  await browser.open(input);
  const page = (browser as unknown as { page: import('playwright-core').Page }).page;
  const result = await page.evaluate(async (reloadInput) => {
    const viewer = window.AgentViewer as typeof window.AgentViewer & {
      load(input: unknown): { scrolls: Array<{ target: string; y: number; maxY: number }> };
      capture(scope: 'document'): Promise<{ data: string }>;
    };
    const body = document.querySelector<HTMLElement>('.fp-body')!;
    body.scrollTop = 500;
    const state = viewer.load(reloadInput);
    const image = await viewer.capture('document');
    return { scroll: state.scrolls.find((area) => area.target === 'document'), image: image.data };
  }, { path: input.resolvedPath, content: input.content, objectMeta: input.objectMeta, styleItems: input.styleItems || {} });

  assert.ok(result.scroll && result.scroll.maxY > 500, JSON.stringify(result.scroll));
  assert.equal(result.scroll.y, 500);
  const png = Buffer.from(result.image, 'base64');
  assert.equal(png.readUInt32BE(16), 640);
  assert.ok(png.readUInt32BE(20) > 360, `document PNG height is ${png.readUInt32BE(20)}`);
});
