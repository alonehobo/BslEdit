import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { StaticAssetServer } from './static-server.js';
import type { BrowserPreviewState, LoadedDocument, ViewerOptions } from './types.js';

type JsonObject = Record<string, unknown>;

interface ViewerApi {
  ready: boolean;
  load(input: { path: string; content: string; baseForm: string; objectMeta: string; interfaceMode?: string; refMeta?: Record<string, string>; commonCommands?: Record<string, string>; commonPictures?: LoadedDocument['commonPictures']; styleItems?: Record<string, string>; basePath?: string; baseRevision?: string; baseContent?: string; baseDescription?: string }): BrowserPreviewState;
  state(): BrowserPreviewState;
  inspect(options: { query?: string; visibleOnly?: boolean }): JsonObject[];
  selectElement(id: string): JsonObject;
  switchTab(pageId: string, pagesId?: string): BrowserPreviewState;
  scroll(options: JsonObject): JsonObject;
  reflow(): BrowserPreviewState;
  elementSelector(id: string): string;
  capture(scope: CaptureScope, elementId: string): Promise<{ data: string; mimeType: string }>;
}

declare global {
  interface Window {
    AgentViewer: ViewerApi;
  }
}

export type CaptureScope = 'viewport' | 'document' | 'element';
export interface CaptureViewport { width: number; height: number }

/* The Windows host renders in the system Edge; other platforms fall back to
 * playwright's own Chromium download (`npx playwright-core install
 * chromium-headless-shell`). ONE_C_FORM_VIEWER_CHROMIUM points at a custom
 * browser executable on any platform. */
function browserLaunchOptions(): { channel?: string; executablePath?: string } {
  if (process.env.ONE_C_FORM_VIEWER_CHROMIUM) {
    return { executablePath: process.env.ONE_C_FORM_VIEWER_CHROMIUM };
  }
  if (process.platform === 'win32') return { channel: 'msedge' };
  return {};
}

async function launchBrowser(headless: boolean): Promise<Browser> {
  try {
    return await chromium.launch({
      ...browserLaunchOptions(),
      headless,
      /* Playwright hides scrollbars in headless mode, while WebView2 hosts
       * and headed Edge paint them. Keep captures faithful to the host. */
      ignoreDefaultArgs: ['--hide-scrollbars'],
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(process.platform === 'win32'
      ? `Microsoft Edge could not be started. Install Edge or set ONE_C_FORM_VIEWER_CHROMIUM to another Chromium browser. ${detail}`
      : `Chromium could not be started. Install it with "npx playwright-core install chromium-headless-shell" or set ONE_C_FORM_VIEWER_CHROMIUM. ${detail}`);
  }
}

/* One browser process for several sessions, each in its own context — the
 * MCP server keeps a preview per open file, and a browser per preview cost
 * a whole Chromium each. Launched on first use and again after it died. */
export class SharedBrowser {
  private launching: Promise<Browser> | null = null;

  constructor(private readonly headless: boolean) {}

  async acquire(): Promise<Browser> {
    if (this.launching) {
      const current = await this.launching.catch(() => null);
      if (current?.isConnected()) return current;
    }
    const launching = launchBrowser(this.headless);
    this.launching = launching;
    launching.catch(() => {
      if (this.launching === launching) this.launching = null;
    });
    return launching;
  }

  async close(): Promise<void> {
    const launching = this.launching;
    this.launching = null;
    const browser = launching ? await launching.catch(() => null) : null;
    if (browser) await browser.close().catch(() => undefined);
  }
}

export class BrowserSession {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private readonly assets: StaticAssetServer;

  constructor(private readonly options: ViewerOptions, private readonly shared?: SharedBrowser) {
    this.assets = new StaticAssetServer(options.assetsDir);
  }

  private async ensurePage(): Promise<Page> {
    if (this.page && !this.page.isClosed()) return this.page;
    await this.assets.start();
    let browser: Browser;
    try {
      browser = this.shared ? await this.shared.acquire() : await launchBrowser(this.options.headless);
    } catch (error) {
      await this.assets.close();
      throw error;
    }
    /* Everything past a successful launch has to clean up after itself. Leaving
     * a launched browser behind on a failed newContext/goto left an orphan Edge
     * process running and the next call simply launched another one. A shared
     * browser stays up for the other sessions; only this context goes. */
    let context: BrowserContext | null = null;
    try {
      /* Compare identity before clearing: a late 'disconnected' from a replaced
       * browser must not wipe the handles of its successor. */
      browser.once('disconnected', () => {
        if (this.browser !== browser) return;
        this.browser = null;
        this.context = null;
        this.page = null;
      });
      context = await browser.newContext({ viewport: this.options.viewport });
      const page = await context.newPage();
      /* internalPreview (the MCP server) runs the page the way the native
       * server's hidden renderer does — internal + bare, captures framed on
       * the form host with no viewer chrome. The default stays the plain page
       * the e2e suite and the other hosts drive. */
      const startUrl = this.assets.url();
      await page.goto(this.options.internalPreview ? `${this.assets.internalUrl()}&bare=1` : startUrl, { waitUntil: 'load' });
      await page.waitForFunction(() => window.AgentViewer?.ready === true);
      this.browser = browser;
      this.context = context;
      this.page = page;
      return page;
    } catch (error) {
      if (this.shared) await context?.close().catch(() => undefined);
      else await browser.close().catch(() => undefined);
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
      interfaceMode: document.interfaceMode || 'Any',
      configInterfaceMode: document.configInterfaceMode || '',
      refMeta: document.refMeta || {},
      commonCommands: document.commonCommands || {},
      commonPictures: document.commonPictures || {},
      styleItems: document.styleItems || {},
      ...(document.basePath ? {
        basePath: document.basePath,
        baseRevision: document.baseRevision || '',
        baseContent: document.baseContent || '',
        baseDescription: document.baseDescription || '',
      } : {}),
    });
    await page.waitForTimeout(25);
    return state;
  }

  async state(): Promise<BrowserPreviewState> {
    return this.requirePage().evaluate(() => window.AgentViewer.state());
  }

  /** Apply a new host viewport and synchronously finish the renderer layout
   * that belongs to it before returning. */
  async resize(viewport: CaptureViewport): Promise<BrowserPreviewState> {
    const page = this.requirePage();
    await page.setViewportSize(viewport);
    return page.evaluate(() => window.AgentViewer.reflow());
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
    /* internalPreview: captures go through the page itself
     * (AgentViewer.capture). Its SVG foreignObject rasterisation is what the
     * native server returns — framed on the form host, no viewer chrome, and a
     * document capture re-lays scrollable areas at their full size. */
    if (this.options.internalPreview) {
      if (scope === 'element' && !elementId) throw new Error('element_id is required when scope is element.');
      const result = await page.evaluate(
        ({ scope: captureScope, id }) => window.AgentViewer.capture(captureScope, id),
        { scope, id: elementId || '' },
      );
      return Buffer.from(result.data, 'base64');
    }
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
    if (viewport) await this.resize(viewport);
    try {
      const image = await this.capturePng(page, scope, elementId);
      const state = await page.evaluate(() => window.AgentViewer.state());
      return { image, state };
    } finally {
      if (previous) await this.resize(previous);
    }
  }

  async close(): Promise<void> {
    const browser = this.browser;
    const context = this.context;
    this.page = null;
    this.context = null;
    this.browser = null;
    this.assets.clearDocument();
    try {
      if (this.shared) await context?.close();
      else if (browser) await browser.close();
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
