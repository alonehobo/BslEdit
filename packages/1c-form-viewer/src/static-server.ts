import { createServer, type Server } from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import type { LoadedDocument } from './types.js';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  // std-pictures/*.svg: an <img> does not sniff SVG (StdPicture.DialogExclamation).
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

type PreviewDocument = Pick<LoadedDocument, 'resolvedPath' | 'content' | 'baseForm' | 'objectMeta' | 'refMeta' | 'commonCommands' | 'commonPictures' | 'styleItems'>;

export class StaticAssetServer {
  private server: Server | null = null;
  private readonly token = randomBytes(24).toString('hex');
  private port = 0;
  private current: PreviewDocument | null = null;
  private revision = 0;
  private reloader: (() => Promise<PreviewDocument>) | null = null;

  constructor(private readonly assetsDir: string) {}

  async start(): Promise<string> {
    if (this.server) return this.url();
    const root = await fs.realpath(this.assetsDir);
    this.server = createServer(async (request, response) => {
      try {
        /* The socket is bound to loopback, but a name that resolves to 127.0.0.1
         * still reaches it, so a page on an attacker-controlled domain could aim
         * requests here. The unguessable token already denies it anything useful;
         * pinning Host closes the door before the token is even consulted. */
        if (!this.isLoopbackHost(request.headers.host)) {
          response.writeHead(403).end();
          return;
        }
        const requestUrl = new URL(request.url || '/', 'http://127.0.0.1');
        const prefix = `/${this.token}/`;
        if (!requestUrl.pathname.startsWith(prefix)) {
          response.writeHead(404).end();
          return;
        }
        const relative = decodeURIComponent(requestUrl.pathname.slice(prefix.length)) || 'index.html';
        if (relative === 'state-meta.json') {
          response.writeHead(200, {
            'Content-Type': MIME['.json'],
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
          });
          response.end(JSON.stringify({ revision: this.revision, available: !!this.current }));
          return;
        }
        /* The page's refresh button: re-read the open file from disk so an
         * agent's edit shows without reopening the preview. */
        if (relative === 'reload' && request.method === 'POST') {
          if (!this.reloader) {
            response.writeHead(404).end();
            return;
          }
          try {
            this.setDocument(await this.reloader());
          } catch (error) {
            response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
            response.end(error instanceof Error ? error.message : String(error));
            return;
          }
          response.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
          response.end(JSON.stringify({ revision: this.revision, available: !!this.current }));
          return;
        }
        if (relative === 'state.json') {
          if (!this.current) {
            response.writeHead(404).end();
            return;
          }
          response.writeHead(200, {
            'Content-Type': MIME['.json'],
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
          });
          response.end(JSON.stringify({
            revision: this.revision,
            path: this.current.resolvedPath,
            content: this.current.content,
            baseForm: this.current.baseForm,
            objectMeta: this.current.objectMeta,
            refMeta: this.current.refMeta || {},
            commonCommands: this.current.commonCommands || {},
            commonPictures: this.current.commonPictures || {},
            styleItems: this.current.styleItems || {},
          }));
          return;
        }
        /* Resolve symlinks before the containment check: `root` is already a
         * realpath, so comparing a merely-resolved path would let a link
         * inside the assets directory serve a file outside it. */
        const candidate = await fs.realpath(path.resolve(root, relative));
        if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) {
          response.writeHead(403).end();
          return;
        }
        const body = await fs.readFile(candidate);
        response.writeHead(200, {
          'Content-Type': MIME[path.extname(candidate).toLowerCase()] || 'application/octet-stream',
          'Cache-Control': 'no-store',
          'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; object-src 'none'; base-uri 'none'",
          'X-Content-Type-Options': 'nosniff',
        });
        response.end(body);
      } catch {
        response.writeHead(404).end();
      }
    });
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(0, '127.0.0.1', () => resolve());
    });
    const address = this.server.address();
    if (!address || typeof address === 'string') throw new Error('Failed to bind local preview server');
    this.port = address.port;
    return this.url();
  }

  private isLoopbackHost(host: string | undefined): boolean {
    if (!host) return false;
    const hostname = host.startsWith('[')
      ? host.slice(0, host.indexOf(']') + 1)
      : host.split(':')[0];
    return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]';
  }

  url(): string {
    if (!this.port) throw new Error('Preview server is not running');
    return `http://127.0.0.1:${this.port}/${this.token}/index.html`;
  }

  internalUrl(): string {
    const url = new URL(this.url());
    url.searchParams.set('internal', '1');
    return url.toString();
  }

  setDocument(document: PreviewDocument): void {
    this.current = { ...document };
    this.revision += 1;
  }

  setReloader(reloader: (() => Promise<PreviewDocument>) | null): void {
    this.reloader = reloader;
  }

  clearDocument(): void {
    this.reloader = null;
    this.current = null;
    this.revision += 1;
  }

  async close(): Promise<void> {
    const current = this.server;
    this.server = null;
    this.port = 0;
    this.clearDocument();
    if (!current) return;
    await new Promise<void>((resolve) => current.close(() => resolve()));
  }
}
