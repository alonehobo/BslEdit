#!/usr/bin/env node
/* Checks that every shipped build renders from the same shared core:
 *
 *   web/                                   BSLView.wlx / BSLEdit.exe source tree
 *   packages/1c-form-viewer/build/web      native MCP build output
 *   releases/Last version/MCP/*.exe        installed stable MCP
 *   releases/Last version/*.vsix           VS Code extension (extension/mcp/*.exe)
 *
 * The shipped binaries carry the interface inside them (embedded-assets.h),
 * so the last two are read out of the executable itself rather than off a
 * directory beside it: a stale pack is exactly the drift this check exists
 * to catch, and nothing else proves what a released .exe would render.
 *
 * Each shared file (renderers, viewer.css, platform icons, std-pictures) must be
 * byte-identical to packages/1c-preview-core/browser. A host shell must not
 * restyle the preview either: a `.fp-`/`.tp-` selector in shell CSS makes the
 * same form look different in one host, so that is reported as a failure too.
 *
 * Usage: node tools/verify-build-parity.mjs [--vsix <path>] [--allow-missing] */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { browserPath, platformIcons, scripts, stdPictures, styles } from '../packages/1c-preview-core/manifest.mjs';
import { readAssetPackFromBinary } from './pack-assets.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const allowMissing = args.includes('--allow-missing');
const vsixArg = args.includes('--vsix') ? args[args.indexOf('--vsix') + 1] : null;

const shared = [...scripts, ...styles, ...platformIcons, ...stdPictures];
const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const expected = new Map(shared.map((name) => [name, sha(readFileSync(browserPath(name)))]));

const problems = [];
const notes = [];

/* Minimal ZIP central-directory reader: a VSIX is a plain zip. */
function readZip(file) {
  const buf = readFileSync(file);
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error(`not a zip: ${file}`);
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = new Map();
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    entries.set(name, () => {
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const data = buf.subarray(start, start + csize);
      return method === 8 ? zlib.inflateRawSync(data) : Buffer.from(data);
    });
  }
  return entries;
}

function checkTarget(label, read) {
  let bad = 0;
  for (const [name, hash] of expected) {
    const buf = read(name);
    if (!buf) { problems.push(`${label}: missing ${name}`); bad++; }
    else if (sha(buf) !== hash) { problems.push(`${label}: differs from core ${name}`); bad++; }
  }
  if (!bad) notes.push(`${label}: ${expected.size} shared files match core`);
}

function checkDir(label, dir) {
  if (!existsSync(dir)) {
    (allowMissing ? notes : problems).push(`${label}: not built (${path.relative(repo, dir)})`);
    return;
  }
  checkTarget(label, (name) => {
    const file = path.join(dir, name);
    return existsSync(file) ? readFileSync(file) : null;
  });
}

/* A binary that ships: what it renders is whatever its embedded pack holds. */
function checkBinary(label, read) {
  let pack;
  try {
    const image = read();
    if (!image) throw new Error('not built');
    pack = readAssetPackFromBinary(image);
  } catch (error) {
    (allowMissing || error.message === 'not built' ? notes : problems).push(`${label}: ${error.message}`);
    return;
  }
  checkTarget(label, (name) => pack.get(name) ?? null);
}

checkDir('BSLView/BSLEdit web', path.join(repo, 'web'));
checkDir('MCP build/web', path.join(repo, 'packages', '1c-form-viewer', 'build', 'web'));
for (const [label, file] of [
  ['BSLEdit.exe', path.join(repo, 'BSLEdit.exe')],
  ['BSLView.wlx64', path.join(repo, 'BSLView.wlx64')],
  ['BSLView.wlx', path.join(repo, 'BSLView.wlx')],
  ['Last version MCP', path.join(repo, 'releases', 'Last version', 'MCP', '1c-form-viewer.exe')],
]) {
  checkBinary(label, () => (existsSync(file) ? readFileSync(file) : null));
}

const latestDir = path.join(repo, 'releases', 'Last version');
const vsix = vsixArg || (existsSync(latestDir)
  ? readdirSync(latestDir).filter((n) => n.endsWith('.vsix')).map((n) => path.join(latestDir, n))[0]
  : null);
if (!vsix || !existsSync(vsix)) {
  (allowMissing ? notes : problems).push('VSIX: not built');
} else {
  const entries = readZip(vsix);
  const byName = new Map();
  for (const [name, get] of entries) {
    let decoded = name;
    try { decoded = decodeURIComponent(name); } catch { /* keep raw */ }
    byName.set(decoded, get);
  }
  checkBinary(`VSIX ${path.basename(vsix)}`, () => {
    const get = byName.get('extension/mcp/1c-form-viewer.exe');
    return get ? get() : null;
  });
}

/* Shell stylesheets that sit next to the shared viewer.css in one host only. */
const shellCss = [
  path.join(repo, 'web', 'form-workbench.css'),
  path.join(repo, 'web', 'epf-unpack.css'),
  path.join(repo, 'packages', '1c-form-viewer', 'ui', 'agent-viewer.css'),
];
for (const file of shellCss) {
  if (!existsSync(file)) continue;
  readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, i) => {
    if (/(^|[\s,>+~(])\.(fp|tp)-[\w-]+/.test(line.replace(/\/\*.*?\*\//g, '')))
      problems.push(`shell CSS restyles the preview: ${path.relative(repo, file)}:${i + 1}: ${line.trim()}`);
  });
}

for (const note of notes) process.stdout.write(`  ok   ${note}\n`);
if (problems.length) {
  process.stderr.write(`build parity: ${problems.length} problem(s)\n`);
  /* Per build, a few files and a count: a stale build differs everywhere. */
  const seen = new Map();
  for (const problem of problems) {
    const label = problem.slice(0, problem.indexOf(':'));
    const n = (seen.get(label) || 0) + 1;
    seen.set(label, n);
    if (n <= 5 || label.startsWith('shell CSS')) process.stderr.write(`  FAIL ${problem}\n`);
  }
  for (const [label, n] of seen)
    if (n > 5 && !label.startsWith('shell CSS')) process.stderr.write(`  FAIL ${label}: ${n} file(s) in total\n`);
  process.exitCode = 1;
} else {
  process.stdout.write('build parity: all builds share one preview core\n');
}
