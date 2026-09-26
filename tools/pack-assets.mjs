#!/usr/bin/env node
/* Packs a directory tree into the single blob that BSLView.wlx, BSLEdit.exe and
 * the native MCP server carry as an RCDATA resource. Each binary unpacks it
 * into a per-user cache on first run, so a release is the executable alone and
 * nothing has to be copied beside it.
 *
 * The layout is deliberately dull - the C++ side (embedded-assets.h) walks it
 * once at extraction time and never seeks:
 *
 *   0  "BSLASSET"              8 bytes
 *   8  uint32 formatVersion    1
 *  12  uint32 entryCount
 *  16  byte[32] contentHash    SHA-256 over every name and its bytes
 *  48  entries, each:
 *        uint32 nameBytes      UTF-8, '/' separators, no leading slash
 *        uint32 dataBytes
 *        uint64 dataOffset     from the start of the blob
 *        name, padded with zeros to a multiple of 4
 *      data, each run padded to a multiple of 4
 *
 * contentHash names the cache directory, so a rebuilt asset tree extracts
 * beside the old one instead of racing a running process for the same files.
 * Nothing is compressed: the blob is served straight out of the resource on
 * platforms that want it in memory, and the few megabytes saved are not worth
 * a decompressor in three binaries.
 *
 * Usage: node tools/pack-assets.mjs <sourceDirectory> <outputFile> */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const MAGIC = Buffer.from('BSLASSET', 'ascii');
const FORMAT_VERSION = 1;
const HEADER_BYTES = 48;

const pad4 = (value) => (value + 3) & ~3;

/* Sorted, so the same tree always packs to the same bytes and the same hash. */
function collect(root) {
  const files = [];
  const walk = (dir, prefix) => {
    for (const name of readdirSync(dir).sort()) {
      const full = path.join(dir, name);
      const relative = prefix ? `${prefix}/${name}` : name;
      if (statSync(full).isDirectory()) walk(full, relative);
      else files.push({ name: relative, full });
    }
  };
  walk(root, '');
  return files;
}

export function packAssets(sourceDirectory, outputFile) {
  const root = path.resolve(sourceDirectory);
  const files = collect(root);
  if (!files.length) throw new Error(`nothing to pack in ${root}`);

  const hash = createHash('sha256');
  const entries = files.map(({ name, full }) => {
    const nameBytes = Buffer.from(name, 'utf8');
    if (nameBytes.includes(0)) throw new Error(`asset name has a NUL byte: ${name}`);
    const data = readFileSync(full);
    hash.update(nameBytes);
    hash.update(Buffer.from([0]));
    hash.update(data);
    return { nameBytes, data };
  });

  let cursor = HEADER_BYTES;
  for (const entry of entries) cursor += 16 + pad4(entry.nameBytes.length);
  const dataStart = cursor;
  for (const entry of entries) {
    entry.offset = cursor;
    cursor += pad4(entry.data.length);
  }

  const blob = Buffer.alloc(cursor);
  MAGIC.copy(blob, 0);
  blob.writeUInt32LE(FORMAT_VERSION, 8);
  blob.writeUInt32LE(entries.length, 12);
  hash.digest().copy(blob, 16);

  let index = HEADER_BYTES;
  for (const entry of entries) {
    blob.writeUInt32LE(entry.nameBytes.length, index);
    blob.writeUInt32LE(entry.data.length, index + 4);
    blob.writeBigUInt64LE(BigInt(entry.offset), index + 8);
    entry.nameBytes.copy(blob, index + 16);
    index += 16 + pad4(entry.nameBytes.length);
  }
  if (index !== dataStart) throw new Error('asset index does not end where the data starts');
  for (const entry of entries) entry.data.copy(blob, entry.offset);

  mkdirSync(path.dirname(path.resolve(outputFile)), { recursive: true });
  writeFileSync(outputFile, blob);
  return { files: entries.length, bytes: blob.length, hash: blob.subarray(16, 48).toString('hex') };
}

/* The reader the build-parity check uses; kept next to the writer so the two
 * never drift. Returns a Map of name -> Buffer. */
export function readAssetPack(file) {
  const blob = Buffer.isBuffer(file) ? file : readFileSync(file);
  if (blob.length < HEADER_BYTES || !blob.subarray(0, 8).equals(MAGIC))
    throw new Error('not an asset pack');
  if (blob.readUInt32LE(8) !== FORMAT_VERSION)
    throw new Error(`asset pack format ${blob.readUInt32LE(8)} is not supported`);
  const count = blob.readUInt32LE(12);
  const entries = new Map();
  let index = HEADER_BYTES;
  for (let i = 0; i < count; i++) {
    if (index + 16 > blob.length) throw new Error('asset pack index is truncated');
    const nameBytes = blob.readUInt32LE(index);
    if (index + 16 + nameBytes > blob.length) throw new Error('asset pack index is truncated');
    const dataBytes = blob.readUInt32LE(index + 4);
    const offset = Number(blob.readBigUInt64LE(index + 8));
    const name = blob.toString('utf8', index + 16, index + 16 + nameBytes);
    if (offset + dataBytes > blob.length) throw new Error(`asset pack is truncated at ${name}`);
    entries.set(name, blob.subarray(offset, offset + dataBytes));
    index += 16 + pad4(nameBytes);
  }
  return entries;
}

/* Reads the pack out of a linked binary. RCDATA is stored verbatim, so the
 * blob sits in the image as it was written and the magic finds it; entry
 * offsets are relative to the pack, which is why the tail is sliced off at the
 * magic rather than parsed through the PE resource directory. */
export function readAssetPackFromBinary(file) {
  const image = Buffer.isBuffer(file) ? file : readFileSync(file);
  for (let at = image.indexOf(MAGIC); at >= 0; at = image.indexOf(MAGIC, at + 1)) {
    try {
      return readAssetPack(image.subarray(at));
    } catch {
      /* Some other run of those eight bytes; keep looking. */
    }
  }
  throw new Error('no asset pack in this binary');
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('pack-assets.mjs')) {
  const [source, output] = process.argv.slice(2);
  if (!source || !output) {
    console.error('usage: node tools/pack-assets.mjs <sourceDirectory> <outputFile>');
    process.exit(2);
  }
  const result = packAssets(source, output);
  console.log(`Packed ${result.files} files (${(result.bytes / 1048576).toFixed(1)} MB) into ${output}`);
  console.log(`Content hash ${result.hash.slice(0, 16)}`);
}
