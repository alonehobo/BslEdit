import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// Resolve the shared browser script from this checkout, including in isolated worktrees.
import '../../1c-preview-core/browser/form-context.js';
import type { LoadedDocument } from './types.js';

/* The 1C-specific rules — encodings, form descriptors, object metadata, common
 * commands and pictures — live in packages/1c-preview-core/browser/
 * form-context.js, the same module BSLEdit and the Total Commander viewer run
 * inside WebView2. What stays here is this server's own access policy:
 * allow-roots, realpath canonicalisation and the size limit. */

interface FormContextIo {
  exists(filePath: string): Promise<boolean>;
  readBytes(filePath: string, limit: number): Promise<Uint8Array | null>;
  existsMany?(paths: string[]): Promise<boolean[]>;
  readMany?(paths: string[], limit: number, filter: string): Promise<(Uint8Array | null)[]>;
  statMany?(paths: string[]): Promise<(string | null)[]>;
  cacheGet?(directory: string, key: string): Promise<string | null>;
  cachePut?(directory: string, key: string, text: string): Promise<void>;
  baseConfigurations?(extensionRoot: string): Promise<string[]>;
  extensionConfigurations?(configurationRoot: string): Promise<string[]>;
}

interface FormContextApi {
  SUPPORTED_EXTENSIONS: string[];
  decodeText(bytes: Uint8Array): { content: string; encoding: LoadedDocument['encoding'] };
  formLayoutFor(filePath: string): string;
  createResolver(io: FormContextIo, options: { maxBytes: number; cache: object }): {
    resolve(formPath: string, formXml: string): Promise<Pick<LoadedDocument,
      'baseForm' | 'objectMeta' | 'interfaceMode' | 'configInterfaceMode' | 'refMeta' | 'commonCommands' | 'commonPictures' | 'styleItems'>>;
  };
}

const FormContext = (globalThis as unknown as { FormContext: FormContextApi }).FormContext;

export function decodeText(bytes: Uint8Array): { content: string; encoding: LoadedDocument['encoding'] } {
  return FormContext.decodeText(bytes);
}

export class FileAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FileAccessError';
  }
}

/* The command catalog of a configuration outlives the server process here.
 * BSLEdit, the Total Commander viewer and the native server use the same
 * directory and entry names, so whichever host builds it warms the others.
 * ONE_C_FORM_VIEWER_CONTEXT_CACHE overrides it; "off" disables the store. */
export function contextCacheDirectory(): string | null {
  const override = process.env.ONE_C_FORM_VIEWER_CONTEXT_CACHE;
  if (override === 'off') return null;
  if (override) return override;
  const base = process.env.LOCALAPPDATA || path.join(os.homedir(), '.cache');
  return path.join(base, '1c-form-viewer', 'context-cache');
}

/* An entry is named by the FNV-1a 64 hash of the header "<directory>\n<key>\n",
 * the directory in comparison form (backslashes, no trailing separator, lower
 * case). The file starts with that header, so a collision reads as a miss. */
export function contextCacheEntry(directory: string, key: string): { name: string; header: string } {
  const normalized = directory.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
  const header = `${normalized}\n${key}\n`;
  let hash = 0xcbf29ce484222325n;
  for (const byte of Buffer.from(header, 'utf8')) hash = ((hash ^ BigInt(byte)) * 0x100000001b3n) & 0xffffffffffffffffn;
  const name = hash.toString(16).padStart(16, '0') + '.cache';
  return { name, header };
}

/* Configuration.xml of an extension names its purpose among the properties
 * that precede the object list; the head of the file is enough. null when the
 * directory has no Configuration.xml. */
async function isExtensionConfiguration(directory: string): Promise<boolean | null> {
  const handle = await fs.open(path.join(directory, 'Configuration.xml'), 'r').catch(() => null);
  if (!handle) return null;
  try {
    const buffer = Buffer.alloc(256 * 1024);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const head = buffer.subarray(0, bytesRead).toString('latin1').split('<ChildObjects>')[0];
    return head.includes('<ConfigurationExtensionPurpose>');
  } catch {
    return null;
  } finally {
    await handle.close();
  }
}

/* io.baseConfigurations and io.extensionConfigurations of form-context.js,
 * the twin of context_batch::FindConfigurations in native/context-batch.h:
 * from the root's parent upwards (three levels, never a volume root) each
 * level's subdirectories are searched two deep for a Configuration.xml of the
 * wanted kind — a plain configuration for an extension, an extension for a
 * configuration; a configuration directory is not entered. The nearest level
 * with a find answers. */
export async function findConfigurations(fromRoot: string, wantExtension: boolean): Promise<string[]> {
  const root = path.resolve(fromRoot);
  const found: string[] = [];
  let budget = 4096;
  async function scan(directory: string, depth: number): Promise<void> {
    const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
    const children = entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && entry.name.toLowerCase() !== 'node_modules')
      .map((entry) => path.join(directory, entry.name))
      .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    for (const child of children) {
      if (budget === 0) return;
      budget -= 1;
      if (normalizeForComparison(child) === normalizeForComparison(root)) continue;
      const extension = await isExtensionConfiguration(child);
      if (extension !== null) {
        if (extension === wantExtension) found.push(child);
        continue;
      }
      if (depth < 2) await scan(child, depth + 1);
    }
  }
  let level = root;
  for (let up = 0; up < 3 && found.length === 0 && budget > 0; up += 1) {
    const parent = path.dirname(level);
    if (parent === level || path.dirname(parent) === parent) break;
    level = parent;
    await scan(level, 1);
  }
  return found;
}

export function findBaseConfigurations(extensionRoot: string): Promise<string[]> {
  return findConfigurations(extensionRoot, false);
}

export function findExtensionConfigurations(configurationRoot: string): Promise<string[]> {
  return findConfigurations(configurationRoot, true);
}

function normalizeForComparison(value: string): string {
  const normalized = path.resolve(value).replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function isInside(root: string, candidate: string): boolean {
  const normalizedRoot = normalizeForComparison(root);
  const normalizedCandidate = normalizeForComparison(candidate);
  /* A volume root (D:\ or /) already ends in the separator. */
  const prefix = normalizedRoot.endsWith(path.sep) ? normalizedRoot : `${normalizedRoot}${path.sep}`;
  return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(prefix);
}

export class FileLoader {
  /* Configuration indexes, command catalogs and DefinedTypes are shared by
   * every form of one export; the resolver keeps them for this loader's life. */
  private readonly contextCache = {};

  private constructor(
    private readonly roots: string[],
    private readonly requestedRoots: string[],
    private readonly maxBytes: number,
    private readonly cwd: string,
    private readonly allowAnyPath: boolean,
  ) {}

  static async create(
    roots: string[],
    maxBytes: number,
    cwd = process.cwd(),
    allowAnyPath = false,
  ): Promise<FileLoader> {
    const canonicalRoots: string[] = [];
    const requestedRoots: string[] = [];
    for (const root of roots) {
      const requested = path.resolve(cwd, root);
      const canonical = await fs.realpath(requested).catch(() => {
        throw new FileAccessError(`Allowed root does not exist: ${root}`);
      });
      const stat = await fs.stat(canonical);
      if (!stat.isDirectory()) throw new FileAccessError(`Allowed root is not a directory: ${root}`);
      canonicalRoots.push(canonical);
      requestedRoots.push(requested);
    }
    return new FileLoader(canonicalRoots, requestedRoots, maxBytes, cwd, allowAnyPath);
  }

  allowedRoots(): string[] {
    return [...this.roots];
  }

  private assertAllowed(candidate: string): void {
    if (this.allowAnyPath) return;
    if (!this.roots.some((root) => isInside(root, candidate))) {
      throw new FileAccessError(`Path is outside the allowed roots: ${candidate}`);
    }
  }

  private assertRequestedAllowed(candidate: string): void {
    if (this.allowAnyPath) return;
    if (![...this.requestedRoots, ...this.roots].some((root) => isInside(root, candidate))) {
      throw new FileAccessError(`Path is outside the allowed roots: ${candidate}`);
    }
  }

  private directoryAllowed(directory: string): boolean {
    try {
      this.assertRequestedAllowed(path.resolve(directory));
      return true;
    } catch {
      return false;
    }
  }

  private async canonicalFile(inputPath: string): Promise<string> {
    const requested = path.resolve(this.cwd, inputPath);
    this.assertRequestedAllowed(requested);
    const canonical = await fs.realpath(requested).catch(() => {
      throw new FileAccessError(`File does not exist: ${inputPath}`);
    });
    this.assertAllowed(canonical);
    const stat = await fs.stat(canonical);
    if (!stat.isFile()) throw new FileAccessError(`Path is not a file: ${inputPath}`);
    return canonical;
  }

  private async maybeResolveFormDescriptor(canonicalPath: string): Promise<string> {
    const layout = FormContext.formLayoutFor(canonicalPath);
    if (!layout) return canonicalPath;
    try {
      return await this.canonicalFile(layout);
    } catch (error) {
      if (error instanceof FileAccessError && error.message.startsWith('File does not exist:')) return canonicalPath;
      throw error;
    }
  }

  private async readCanonical(filePath: string): Promise<{ content: string; encoding: LoadedDocument['encoding']; size: number }> {
    this.assertAllowed(filePath);
    const stat = await fs.stat(filePath);
    if (stat.size > this.maxBytes) {
      throw new FileAccessError(`File is ${stat.size} bytes; limit is ${this.maxBytes}: ${filePath}`);
    }
    const bytes = await fs.readFile(filePath);
    const decoded = decodeText(bytes);
    return { ...decoded, size: bytes.length };
  }

  /* The shared resolver sees exactly what this server may read: a denied,
   * missing or oversized file is simply absent. */
  private contextIo(): FormContextIo {
    return {
      exists: async (filePath) => {
        try {
          await this.canonicalFile(filePath);
          return true;
        } catch (error) {
          if (error instanceof FileAccessError) return false;
          throw error;
        }
      },
      readBytes: (filePath, limit) => this.contextRead(filePath, limit),
      existsMany: (paths) => Promise.all(paths.map(async (filePath) => (await this.contextStat(filePath)) !== null)),
      readMany: (paths, limit) => Promise.all(paths.map((filePath) => this.contextRead(filePath, limit))),
      statMany: (paths) => Promise.all(paths.map((filePath) => this.contextStat(filePath))),
      baseConfigurations: async (extensionRoot) => {
        if (!path.isAbsolute(extensionRoot) || !this.directoryAllowed(extensionRoot)) return [];
        return (await findBaseConfigurations(extensionRoot)).filter((directory) => this.directoryAllowed(directory));
      },
      extensionConfigurations: async (configurationRoot) => {
        if (!path.isAbsolute(configurationRoot) || !this.directoryAllowed(configurationRoot)) return [];
        return (await findExtensionConfigurations(configurationRoot))
          .filter((directory) => this.directoryAllowed(directory));
      },
      cacheGet: async (directory, key) => {
        const store = this.cacheFile(directory, key);
        if (!store) return null;
        const text = await fs.readFile(store.file, 'utf8').catch(() => null);
        return text !== null && text.startsWith(store.header) ? text.slice(store.header.length) : null;
      },
      cachePut: async (directory, key, text) => {
        const store = this.cacheFile(directory, key);
        if (!store) return;
        const temporary = `${store.file}.${process.pid}.${Date.now()}.tmp`;
        try {
          await fs.mkdir(path.dirname(store.file), { recursive: true });
          await fs.writeFile(temporary, store.header + text, 'utf8');
          await fs.rename(temporary, store.file);
        } catch {
          await fs.rm(temporary, { force: true }).catch(() => {});
        }
      },
    };
  }

  private async contextRead(filePath: string, limit: number): Promise<Uint8Array | null> {
    try {
      const canonical = await this.canonicalFile(filePath);
      const stat = await fs.stat(canonical);
      if (limit > 0 && stat.size > limit) return null;
      return new Uint8Array(await fs.readFile(canonical));
    } catch (error) {
      if (error instanceof FileAccessError) return null;
      throw error;
    }
  }

  private async contextStat(filePath: string): Promise<string | null> {
    try {
      const canonical = await this.canonicalFile(filePath);
      const stat = await fs.stat(canonical);
      return `${stat.size}:${Math.floor(stat.mtimeMs)}`;
    } catch (error) {
      if (error instanceof FileAccessError) return null;
      throw error;
    }
  }

  /* Only a directory this loader may read owns an entry. */
  private cacheFile(directory: string, key: string): { file: string; header: string } | null {
    const root = contextCacheDirectory();
    if (!root || !path.isAbsolute(directory)) return null;
    try {
      this.assertRequestedAllowed(path.resolve(directory));
    } catch {
      return null;
    }
    const entry = contextCacheEntry(path.resolve(directory), key);
    return { file: path.join(root, entry.name), header: entry.header };
  }

  async load(inputPath: string): Promise<LoadedDocument> {
    const requestedPath = path.resolve(this.cwd, inputPath);
    const initial = await this.canonicalFile(inputPath);
    const resolvedPath = await this.maybeResolveFormDescriptor(initial);
    const { content, encoding, size } = await this.readCanonical(resolvedPath);
    const extension = path.extname(resolvedPath).toLowerCase();
    if (!FormContext.SUPPORTED_EXTENSIONS.includes(extension)) {
      throw new FileAccessError(`Unsupported file extension: ${extension || '(none)'}`);
    }
    const context = await FormContext
      .createResolver(this.contextIo(), { maxBytes: this.maxBytes, cache: this.contextCache })
      .resolve(resolvedPath, content);
    return {
      requestedPath,
      resolvedPath,
      content,
      ...context,
      encoding,
      size,
      extension,
    };
  }
}
