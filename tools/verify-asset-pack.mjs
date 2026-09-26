#!/usr/bin/env node
/* Checks that a pack built by tools/pack-assets.mjs holds the named files.
 * The release script uses it to refuse a BSLEdit.exe whose embedded interface
 * is missing Monaco: the binary would start and then render nothing.
 *
 * Usage: node tools/verify-asset-pack.mjs <pack> <name> [<name> ...] */
import { readAssetPack } from './pack-assets.mjs';

const [pack, ...names] = process.argv.slice(2);
if (!pack || !names.length) {
  console.error('usage: node tools/verify-asset-pack.mjs <pack> <name> [<name> ...]');
  process.exit(2);
}

let entries;
try {
  entries = readAssetPack(pack);
} catch (error) {
  console.error(`${pack}: ${error.message}`);
  process.exit(1);
}

const missing = names.filter((name) => !entries.has(name));
if (missing.length) {
  console.error(`${pack} is missing: ${missing.join(', ')}`);
  process.exit(1);
}
console.log(`${pack}: ${entries.size} files, all required entries present`);
