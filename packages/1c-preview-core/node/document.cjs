/* Filesystem-shaped knowledge about 1C exports, shared by every Node-side host:
 * the MCP server, the VS Code extension and anything else that has to turn a
 * path on disk into something the browser renderers can parse.
 *
 * Deliberately free of `fs`: these are pure byte and path functions, so each
 * host keeps its own access policy (MCP allow-roots, VS Code workspace URIs)
 * and only the 1C-specific rules live here.
 *
 * Plain CommonJS because a VS Code extension host still loads CommonJS; the
 * TypeScript side gets its types from document.d.cts next to this file. */
'use strict';

const path = require('node:path');

/* An object descriptor always carries this marker; a form or template file
 * never does. Used to tell "the owning object's metadata" from "some other
 * XML that happens to sit next to the form". */
const OBJECT_META_MARKER = 'MetaDataObject';

/* 1C writes exports in whichever encoding the configuration was saved with.
 * BOMs are authoritative; without one, valid UTF-8 is UTF-8 and everything
 * else is Windows-1251, which is what the 1C designer produces on Russian
 * locales. */
function decodeText(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { content: new TextDecoder('utf-8').decode(bytes.subarray(3)), encoding: 'utf8-bom' };
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { content: new TextDecoder('utf-16le').decode(bytes.subarray(2)), encoding: 'utf16le' };
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    const body = bytes.subarray(2);
    const swapped = new Uint8Array(body.length - (body.length % 2));
    for (let i = 0; i < swapped.length; i += 2) {
      swapped[i] = body[i + 1];
      swapped[i + 1] = body[i];
    }
    return { content: new TextDecoder('utf-16le').decode(swapped), encoding: 'utf16be' };
  }
  try {
    return { content: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf8' };
  } catch {
    return { content: new TextDecoder('windows-1251').decode(bytes), encoding: 'windows-1251' };
  }
}

/* `Forms/ФормаСписка.xml` is the form's descriptor, not its layout; the layout
 * the renderers want is `Forms/ФормаСписка/Ext/Form.xml`. Returns that layout
 * path for a descriptor, or '' for anything else. The caller decides whether
 * the file actually exists — a descriptor without a layout stays as it is. */
function formLayoutFor(filePath) {
  if (path.extname(filePath).toLowerCase() !== '.xml') return '';
  const directory = path.dirname(filePath);
  if (path.basename(directory).toLowerCase() !== 'forms') return '';
  const name = path.basename(filePath, path.extname(filePath));
  if (!name) return '';
  return path.join(directory, name, 'Ext', 'Form.xml');
}

/* FormPreview draws attributes and commands that live on the owning object,
 * not in the form, so the host offers the object descriptor alongside the
 * form. Only `<Object>/Forms/<Form>/Ext/Form.xml` has one; the candidates are
 * the two places 1C puts it, most likely first. */
function objectMetaCandidates(formPath) {
  if (path.basename(formPath).toLowerCase() !== 'form.xml') return [];
  const extDir = path.dirname(formPath);
  if (path.basename(extDir).toLowerCase() !== 'ext') return [];
  const formsDir = path.dirname(path.dirname(extDir));
  if (path.basename(formsDir).toLowerCase() !== 'forms') return [];
  const objectDir = path.dirname(formsDir);
  const objectName = path.basename(objectDir);
  if (!objectName) return [];
  return [
    path.join(path.dirname(objectDir), `${objectName}.xml`),
    path.join(objectDir, `${objectName}.xml`),
  ];
}

/* An extension dump keeps inherited command metadata in the corresponding
 * base configuration form. Map
 *   <root>/cfe/<extension>/<object path>/Forms/<form>/Ext/Form.xml
 * to
 *   <root>/cf/<object path>/Forms/<form>/Ext/Form.xml.
 * The caller still owns access checks and decides whether the candidate
 * exists. Ordinary cf forms and unrelated paths have no candidate. */
function baseFormCandidate(formPath) {
  const resolved = path.resolve(formPath);
  const parts = resolved.split(path.sep);
  const cfe = parts.findIndex((part) => part.toLowerCase() === 'cfe');
  if (cfe < 0 || cfe + 2 >= parts.length) return '';
  const next = parts.slice();
  next.splice(cfe, 2, 'cf');
  return next.join(path.sep);
}

/* Common commands are configuration objects of their own. A form only keeps
 * `CommonCommand.Name` references in CommandInterface, so the host has to
 * offer those descriptors to the browser parser just as it already offers
 * the owning object descriptor. */
function referencedCommonCommands(xml) {
  const out = [];
  const seen = new Set();
  const re = /CommonCommand\.([^\s<>,"']+)/giu;
  let match;
  while ((match = re.exec(String(xml || '')))) {
    const name = match[1];
    if (!name || /[\\/:*?"<>|]/u.test(name)) continue;
    const key = name.toLowerCase();
    if (!seen.has(key)) { seen.add(key); out.push(name); }
  }
  return out;
}

function commonCommandCandidates(formPath, name) {
  if (!name || /[\\/:*?"<>|]/u.test(name)) return [];
  const out = [];
  const seen = new Set();
  function appendFrom(sourcePath) {
    let directory = path.dirname(sourcePath);
    while (directory && directory !== path.dirname(directory)) {
      const candidate = path.join(directory, 'CommonCommands', `${name}.xml`);
      const key = process.platform === 'win32' ? candidate.toLowerCase() : candidate;
      if (!seen.has(key)) { seen.add(key); out.push(candidate); }
      directory = path.dirname(directory);
    }
  }
  appendFrom(formPath);
  const base = baseFormCandidate(formPath);
  if (base) appendFrom(base);
  return out;
}

/* CommonPicture references use the same dotted form as commands, but their
 * bytes live below CommonPictures/<name>/Ext/Picture.  Picture.xml names the
 * actual PNG or the scalable ZIP bundle through xr:Abs. */
function referencedCommonPictures(xml) {
  const out = [];
  const seen = new Set();
  const re = /CommonPicture\.([^\s<>,"']+)/giu;
  let match;
  while ((match = re.exec(String(xml || '')))) {
    const name = match[1];
    if (!name || /[\\/:*?"<>|]/u.test(name)) continue;
    const key = name.toLowerCase();
    if (!seen.has(key)) { seen.add(key); out.push(name); }
  }
  return out;
}

function commonPictureDescriptorCandidates(formPath, name) {
  if (!name || /[\\/:*?"<>|]/u.test(name)) return [];
  const out = [];
  const seen = new Set();
  function appendFrom(sourcePath) {
    let directory = path.dirname(sourcePath);
    while (directory && directory !== path.dirname(directory)) {
      const candidate = path.join(directory, 'CommonPictures', name, 'Ext', 'Picture.xml');
      const key = process.platform === 'win32' ? candidate.toLowerCase() : candidate;
      if (!seen.has(key)) { seen.add(key); out.push(candidate); }
      directory = path.dirname(directory);
    }
  }
  appendFrom(formPath);
  const base = baseFormCandidate(formPath);
  if (base) appendFrom(base);
  return out;
}

function pictureResourceName(xml) {
  const match = String(xml || '').match(/<(?:xr:)?Abs>([^<]+)<\/(?:xr:)?Abs>/iu);
  const name = match ? match[1].trim() : '';
  return name && !/[\\/:*?"<>|]/u.test(name) && /\.(?:png|zip|svg|bmp|gif|jpe?g)$/iu.test(name) ? name : '';
}

/* Real configurations write the prefix in either case, and the renderer
 * resolves `style:` case-insensitively. Collecting only the lowercase spelling
 * meant a `Style:Имя` reference never got its StyleItems file loaded and lost
 * its colour without a word. Names are deduplicated by case too, so the two
 * spellings of one item do not each cost a filesystem lookup. */
function referencedStyleItems(xml) {
  const out = [];
  const seen = new Set();
  const re = /\bstyle:([^\s<>,"']+)/giu;
  let match;
  while ((match = re.exec(String(xml || '')))) {
    const name = match[1];
    const key = name.toLowerCase();
    if (!seen.has(key)) { seen.add(key); out.push(name); }
  }
  return out;
}

function styleItemCandidates(formPath, name) {
  if (!name || /[\\/:*?"<>|]/u.test(name)) return [];
  const out = [];
  let directory = path.dirname(formPath);
  while (directory && directory !== path.dirname(directory)) {
    out.push(path.join(directory, 'StyleItems', `${name}.xml`));
    directory = path.dirname(directory);
  }
  return out;
}

function styleItemValue(xml) {
  const match = String(xml || '').match(/<Value\b[^>]*>([^<]*)<\/Value>/u);
  return match ? match[1].trim() : '';
}

/* The extensions any host is willing to open. */
const SUPPORTED_EXTENSIONS = ['.xml', '.mxl'];

function isSupportedExtension(filePath) {
  return SUPPORTED_EXTENSIONS.includes(path.extname(filePath).toLowerCase());
}

module.exports = {
  OBJECT_META_MARKER,
  SUPPORTED_EXTENSIONS,
  decodeText,
  formLayoutFor,
  baseFormCandidate,
  referencedCommonCommands,
  commonCommandCandidates,
  referencedCommonPictures,
  commonPictureDescriptorCandidates,
  pictureResourceName,
  objectMetaCandidates,
  referencedStyleItems,
  styleItemCandidates,
  styleItemValue,
  isSupportedExtension,
};
