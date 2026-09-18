/* Resolved view of assets.manifest.json. Host builds import this instead of
 * listing asset names of their own, so adding a renderer is one edit. */
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const manifest = createRequire(import.meta.url)('./assets.manifest.json');

export const coreDir = path.dirname(fileURLToPath(import.meta.url));
export const browserDir = path.join(coreDir, 'browser');
export const nodeDir = path.join(coreDir, 'node');

/** Shared browser modules, in load order. An optional one (see
 * `optionalScripts` in the manifest) is generated locally and simply left out
 * of every host when it is not there. */
export const scripts = (() => {
  const names = [...manifest.scripts];
  for (const entry of manifest.optionalScripts || []) {
    if (!existsSync(path.join(coreDir, 'browser', entry.name))) continue;
    const at = entry.before ? names.indexOf(entry.before) : -1;
    if (at < 0) names.push(entry.name);
    else names.splice(at, 0, entry.name);
  }
  return names;
})();
/** Shared stylesheets. */
export const styles = [...manifest.styles];
/** Platform PNG icons used where the exported platform artwork is an exact match. */
export const platformIcons = [...manifest.platformIcons];
/** Platform picture library (БиблиотекаКартинок), shipped as a folder; entries
 * are paths relative to the browser dir, e.g. std-pictures/Записать.png. */
export const stdPictures = readdirSync(path.join(browserDir, manifest.stdPictures))
  .sort().map((name) => `${manifest.stdPictures}/${name}`);
/** Inline SVG icon sprite, shared by every host shell. */
export const sprite = manifest.sprite;
/** Shared Node-side modules, copied into hosts that run outside the browser. */
export const nodeFiles = [...manifest.node];

/** Everything a browser host has to ship, in load order. */
export const browserAssets = [...scripts, ...styles];

export function browserPath(name) {
  return path.join(browserDir, name);
}

export function nodePath(name) {
  return path.join(nodeDir, name);
}

/** `<script>` tags for the shared modules, in load order. `urlFor` lets a host
 * rewrite the href — VS Code needs webview URIs, the others use plain names. */
export function scriptTags(urlFor = (name) => name, attributes = '') {
  const extra = attributes ? `${attributes} ` : '';
  return scripts.map((name) => `<script ${extra}src="${urlFor(name)}"></script>`).join('\n');
}

/** `<link>` tags for the shared stylesheets. */
export function styleTags(urlFor = (name) => name) {
  return styles.map((name) => `<link rel="stylesheet" href="${urlFor(name)}">`).join('\n');
}

export async function readSprite() {
  const { readFile } = await import('node:fs/promises');
  return readFile(path.join(browserDir, sprite), 'utf8');
}
