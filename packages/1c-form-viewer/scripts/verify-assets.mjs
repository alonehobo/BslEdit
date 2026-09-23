/* Release gate for the native MCP server: build/web must be exactly the shared
 * core plus this package's agent shell, byte for byte, and must never pick up
 * an editor, a binary or a test fixture on the way. */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { browserAssets, browserPath, platformIcons, readSprite, stdPictures } from '1c-preview-core/manifest.mjs';

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const targetWeb = path.join(packageDir, 'build', 'web');
const expected = [...browserAssets, ...platformIcons, ...stdPictures, 'agent-viewer.css', 'agent-viewer.js', 'neat-annotations.css', 'index.html'].sort();

for (const name of browserAssets) {
  const [source, built] = await Promise.all([
    readFile(browserPath(name)),
    readFile(path.join(targetWeb, name)),
  ]);
  if (!source.equals(built)) throw new Error(`Built asset differs from the shared core: ${name}`);
}
for (const name of [...platformIcons, ...stdPictures]) {
  const [source, built] = await Promise.all([
    readFile(browserPath(name)),
    readFile(path.join(targetWeb, name)),
  ]);
  if (!source.equals(built)) throw new Error(`Built asset differs from the shared core: ${name}`);
}

const actual = (await readdir(targetWeb, { withFileTypes: true, recursive: true })).filter((entry) => entry.isFile())
  .map((entry) => path.relative(targetWeb, path.join(entry.parentPath, entry.name)).split(path.sep).join('/')).sort();
if (JSON.stringify(actual) !== JSON.stringify(expected)) {
  throw new Error(`Unexpected build/web contents: ${actual.join(', ')}`);
}

const generatedHtml = await readFile(path.join(targetWeb, 'index.html'), 'utf8');
if (!generatedHtml.includes((await readSprite()).trim())) {
  throw new Error('Generated index.html does not contain the shared icon sprite');
}
for (const name of browserAssets) {
  if (!generatedHtml.includes(`"${name}"`)) throw new Error(`Generated index.html does not load ${name}`);
}

const forbidden = /(?:monaco|\.exe\b|\.wlx\d*\b|testdata|fixtures)/i;
const walk = async (directory) => {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (forbidden.test(path.relative(packageDir, absolute))) {
      throw new Error(`Forbidden package artifact: ${absolute}`);
    }
    if (entry.isDirectory()) await walk(absolute);
  }
};
await walk(path.join(packageDir, 'build'));
