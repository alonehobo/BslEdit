import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { StaticAssetServer } from './static-server.js';
import type { BrowserPreviewState, LoadedDocument, ViewerOptions } from './types.js';

type JsonObject = Record<string, unknown>;

interface ViewerApi {
  ready: boolean;
  load(input: { path: string; content: string; baseForm: string; objectMeta: string; refMeta?: Record<string, string>; commonCommands?: Record<string, string>; commonPictures?: LoadedDocument['commonPictures']; styleItems?: Record<string, string> }): BrowserPreviewState;
  state(): BrowserPreviewState;
  inspect(options: { query?: string; visibleOnly?: boolean }): JsonObject[];
  selectElement(id: string): JsonObject;
  switchTab(pageId: string, pagesId?: string): BrowserPreviewState;
  scroll(options: JsonObject): JsonObject;
  elementSelector(id: string): string;
}

declare global {
  interface Window {
    AgentViewer: ViewerApi;
  }
}

export type CaptureScope = 'viewport' | 'document' | 'element';
export interface CaptureViewport { width: number; height: number }

export class BrowserSession {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private readonly assets: StaticAssetServer;

  constructor(private readonly options: ViewerOptions) {
    this.assets = new StaticAssetServer(options.assetsDir);
  }

  private async ensurePage(): Promise<Page> {
    if (this.page && !this.page.isClosed()) return this.page;
    const url = await this.assets.start();
    let browser: Browser;
    try {
      browser = await chromium.launch({
        channel: 'msedge',
        headless: this.options.headless,
        /* Playwright hides scrollbars in headless mode, while WebView2 hosts
         * and headed Edge paint them. Keep captures faithful to the host. */
        ignoreDefaultArgs: ['--hide-scrollbars'],
      });
    } catch (error) {
      await this.assets.close();
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`Microsoft Edge could not be started. Install Edge or use a Windows host with Edge available. ${detail}`);
    }
    /* Everything past a successful launch has to clean up after itself. Leaving
     * a launched browser behind on a failed newContext/goto left an orphan Edge
     * process running and the next call simply launched another one. */
    try {
      /* Compare identity before clearing: a late 'disconnected' from a replaced
       * browser must not wipe the handles of its successor. */
      browser.once('disconnected', () => {
        if (this.browser !== browser) return;
        this.browser = null;
        this.context = null;
        this.page = null;
      });
      const context = await browser.newContext({ viewport: this.options.viewport });
      const page = await context.newPage();
      await page.goto(url, { waitUntil: 'load' });
      await page.waitForFunction(() => window.AgentViewer?.ready === true);
      this.browser = browser;
      this.context = context;
      this.page = page;
      return page;
    } catch (error) {
      await browser.close().catch(() => undefined);
      await this.assets.close();
      throw error;
    }
  }

  private requirePage(): Page {
    if (!this.page || this.page.isClosed()) {
      throw new Error('No preview is open. Call open_preview first.');
    }
    return this.page;
  }

  setReloader(reloader: (() => Promise<LoadedDocument>) | null): void {
    this.assets.setReloader(reloader);
  }

  async open(document: LoadedDocument): Promise<BrowserPreviewState> {
    const page = await this.ensurePage();
    this.assets.setDocument(document);
    const state = await page.evaluate((input) => window.AgentViewer.load(input), {
      path: document.resolvedPath,
      content: document.content,
      baseForm: document.baseForm,
      objectMeta: document.objectMeta,
      refMeta: document.refMeta || {},
      commonCommands: document.commonCommands || {},
      commonPictures: document.commonPictures || {},
      styleItems: document.styleItems || {},
    });
    await page.waitForTimeout(25);
    return state;
  }

  async state(): Promise<BrowserPreviewState> {
    return this.requirePage().evaluate(() => window.AgentViewer.state());
  }

  async inspect(query?: string, visibleOnly = false): Promise<JsonObject[]> {
    return this.requirePage().evaluate(
      (options) => window.AgentViewer.inspect(options),
      { query, visibleOnly },
    );
  }

  async switchTab(pageId: string, pagesId?: string): Promise<BrowserPreviewState> {
    const page = this.requirePage();
    const result = await page.evaluate(
      ({ targetPageId, ownerPagesId }) => window.AgentViewer.switchTab(targetPageId, ownerPagesId),
      { targetPageId: pageId, ownerPagesId: pagesId },
    );
    await page.waitForTimeout(25);
    return result;
  }

  async selectElement(elementId: string): Promise<JsonObject> {
    const page = this.requirePage();
    const result = await page.evaluate((id) => window.AgentViewer.selectElement(id), elementId);
    await page.waitForTimeout(25);
    return result;
  }

  async scroll(options: JsonObject): Promise<JsonObject> {
    const page = this.requirePage();
    const result = await page.evaluate((input) => window.AgentViewer.scroll(input), options);
    await page.waitForTimeout(25);
    return result;
  }

  private async capturePng(page: Page, scope: CaptureScope, elementId?: string): Promise<Buffer> {
    if (scope !== 'element') return page.screenshot({ type: 'png', fullPage: scope === 'document' });
    if (!elementId) throw new Error('element_id is required when scope is element.');
    const selector = await page.evaluate((id) => window.AgentViewer.elementSelector(id), elementId);
    return page.locator(selector).first().screenshot({ type: 'png' });
  }

  /* The picture and the state that describes it, taken together. Capturing is
   * not passive: an element capture scrolls that element into view and a
   * capture size reframes the page, so the state is read after the shot and
   * while its framing still applies. Reading it before the capture, or after
   * the viewport had been put back, described a frame the PNG never showed. */
  async capture(
    scope: CaptureScope,
    elementId?: string,
    viewport?: CaptureViewport,
  ): Promise<{ image: Buffer; state: BrowserPreviewState }> {
    const page = this.requirePage();
    /* A capture size belongs to that one picture. Leaving it applied silently
     * re-laid out every later inspect, scroll and capture in the session
     * against a window nobody asked for. */
    const previous = viewport ? page.viewportSize() : null;
    if (viewport) await page.setViewportSize(viewport);
    try {
      const image = await this.capturePng(page, scope, elementId);
      const state = await page.evaluate(() => window.AgentViewer.state());
      return { image, state };
    } finally {
      if (previous) await page.setViewportSize(previous);
    }
  }

  async close(): Promise<void> {
    const browser = this.browser;
    this.page = null;
    this.context = null;
    this.browser = null;
    this.assets.clearDocument();
    try {
      if (browser) await browser.close();
    } finally {
      /* The asset server holds a listening port. A browser that refuses to go
       * away must not leave it bound for the rest of the process. */
      await this.assets.close();
    }
  }

  previewUrl(): string {
    this.requirePage();
    return this.assets.internalUrl();
  }
}
