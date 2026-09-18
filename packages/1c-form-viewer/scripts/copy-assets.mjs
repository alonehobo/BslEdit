/* Fills build/web for the native executable from the shared core plus this
 * package's own agent shell.
 *
 * The asset list is not repeated here: it comes from
 * packages/1c-preview-core/assets.manifest.json, which is the only place a
 * renderer is ever named. The icon sprite comes from the core as a real SVG
 * file rather than being scraped out of the Total Commander plugin's markup. */
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  browserAssets,
  browserPath,
  platformIcons,
  stdPictures,
  readSprite,
  scriptTags,
  styleTags,
} from '1c-preview-core/manifest.mjs';

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceUi = path.join(packageDir, 'ui');
const targetWeb = path.join(packageDir, 'build', 'web');

await mkdir(targetWeb, { recursive: true });
for (const name of browserAssets) {
  await copyFile(browserPath(name), path.join(targetWeb, name));
}
for (const name of platformIcons) {
  await copyFile(browserPath(name), path.join(targetWeb, name));
}
await mkdir(path.join(targetWeb, 'std-pictures'), { recursive: true });
for (const name of stdPictures) {
  await copyFile(browserPath(name), path.join(targetWeb, name));
}
await copyFile(path.join(sourceUi, 'agent-viewer.js'), path.join(targetWeb, 'agent-viewer.js'));
await copyFile(path.join(sourceUi, 'agent-viewer.css'), path.join(targetWeb, 'agent-viewer.css'));

const template = await readFile(path.join(sourceUi, 'index.template.html'), 'utf8');
for (const placeholder of ['<!-- ICON_SPRITE -->', '<!-- CORE_STYLES -->', '<!-- CORE_SCRIPTS -->']) {
  if (!template.includes(placeholder)) throw new Error(`UI template has no ${placeholder} placeholder`);
}
const html = template
  .replace('<!-- ICON_SPRITE -->', (await readSprite()).trim())
  .replace('<!-- CORE_STYLES -->', styleTags())
  .replace('<!-- CORE_SCRIPTS -->', scriptTags());
await writeFile(path.join(targetWeb, 'index.html'), html, 'utf8');
