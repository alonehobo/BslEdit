#!/usr/bin/env node
/* CLI wrapper over packages/1c-preview-core/browser/xlsx-template.js.
 * Usage: node tools/xlsx-to-template.mjs <in.xlsx> <out/Template.xml> [--sheet name|number] [--overwrite]
 * Prints the JSON summary (sheet, size, areas, parameters, warnings). */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const modulePath = path.resolve(here, '../packages/1c-preview-core/browser/xlsx-template.js');

export function loadXlsxTemplate() {
  const sandbox = { globalThis: null, TextDecoder, DecompressionStream, Blob, Response, atob, btoa, Uint8Array, ArrayBuffer, Promise, JSON, Math, Date, String, Error, Object };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(modulePath, 'utf8'), sandbox, { filename: modulePath });
  return sandbox.XlsxTemplate;
}

async function main(argv) {
  const args = [];
  let sheet;
  let overwrite = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--sheet') sheet = /^\d+$/.test(argv[i + 1]) ? Number(argv[++i]) : argv[++i];
    else if (argv[i] === '--overwrite') overwrite = true;
    else args.push(argv[i]);
  }
  if (args.length < 2) {
    console.error('Usage: xlsx-to-template <in.xlsx> <out/Template.xml> [--sheet name|number] [--overwrite]');
    process.exit(2);
  }
  const [input, output] = args;
  if (fs.existsSync(output) && !overwrite) {
    console.error(`${output} already exists; pass --overwrite to replace it.`);
    process.exit(1);
  }
  const { xml, summary } = await loadXlsxTemplate().convert(fs.readFileSync(input), { sheet });
  fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
  fs.writeFileSync(output, xml, 'utf8');
  console.log(JSON.stringify(summary, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => { console.error(e.message); process.exit(1); });
}
