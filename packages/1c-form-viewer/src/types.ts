export type PreviewFormat = 'form' | 'template' | 'mxl';

export interface ViewerOptions {
  roots: string[];
  allowAnyPath: boolean;
  viewport: { width: number; height: number };
  headless: boolean;
  maxBytes: number;
  assetsDir: string;
  /* Run the preview page like the native server's hidden renderer (internal
   * bare mode, page-side captures framed on the form host). Off by default:
   * the e2e suite and the other hosts drive the plain page. */
  internalPreview?: boolean;
}

export interface LoadedDocument {
  requestedPath: string;
  resolvedPath: string;
  content: string;
  baseForm: string;
  objectMeta: string;
  interfaceMode?: string;
  configInterfaceMode?: string;
  refMeta?: Record<string, string>;
  commonCommands?: Record<string, string>;
  /* CommonPicture name -> bytes. A form item's own picture file uses the key
   * `@item:<item>/<file>` (form-context.js referencedItemPictures). */
  commonPictures?: Record<string, { mime: string; data: string }>;
  styleItems?: Record<string, string>;
  /* open_preview base_path / base_revision: the earlier version the page
   * compares against. For a git revision basePath is the file itself. */
  basePath?: string;
  baseRevision?: string;
  baseContent?: string;
  baseDescription?: string;
  encoding: 'utf8-bom' | 'utf8' | 'utf16le' | 'utf16be' | 'windows-1251';
  size: number;
  extension: string;
}

export type ScrollTarget = 'document' | 'active-page' | 'table' | 'spreadsheet';

export interface PreviewScrollArea {
  target: ScrollTarget;
  elementId: string;
  x: number;
  y: number;
  maxX: number;
  maxY: number;
  clientWidth: number;
  clientHeight: number;
}

export interface BrowserPreviewState {
  format: PreviewFormat;
  path: string;
  selectedId: string;
  summary: Record<string, unknown>;
  tabs: Array<Record<string, unknown>>;
  scrolls: PreviewScrollArea[];
}
