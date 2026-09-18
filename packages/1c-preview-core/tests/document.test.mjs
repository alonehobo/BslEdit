import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  decodeText,
  baseFormCandidate,
  commonCommandCandidates,
  commonPictureDescriptorCandidates,
  formLayoutFor,
  isSupportedExtension,
  objectMetaCandidates,
  referencedCommonCommands,
  referencedCommonPictures,
  pictureResourceName,
  referencedStyleItems,
  styleItemCandidates,
  styleItemValue,
  SUPPORTED_EXTENSIONS,
} from '../node/document.cjs';

const cfg = path.join('C:', 'cfg', 'Catalogs', 'Товары');

test('BOMs decide the encoding', () => {
  assert.deepEqual(decodeText(Uint8Array.from([0xef, 0xbb, 0xbf, 0x41])), { content: 'A', encoding: 'utf8-bom' });
  assert.deepEqual(decodeText(Uint8Array.from([0xff, 0xfe, 0x10, 0x04])), { content: 'А', encoding: 'utf16le' });
  assert.deepEqual(decodeText(Uint8Array.from([0xfe, 0xff, 0x04, 0x10])), { content: 'А', encoding: 'utf16be' });
});

test('without a BOM, valid UTF-8 is UTF-8 and the rest is Windows-1251', () => {
  assert.deepEqual(decodeText(new TextEncoder().encode('<x>Привет</x>')), {
    content: '<x>Привет</x>',
    encoding: 'utf8',
  });
  const cp1251 = Uint8Array.from([0x3c, 0x78, 0x3e, 0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2, 0x3c, 0x2f, 0x78, 0x3e]);
  assert.deepEqual(decodeText(cp1251), { content: '<x>Привет</x>', encoding: 'windows-1251' });
});

/* An odd trailing byte must not throw: exports get truncated in the wild. */
test('a truncated UTF-16BE payload still decodes', () => {
  const { encoding } = decodeText(Uint8Array.from([0xfe, 0xff, 0x04, 0x10, 0x04]));
  assert.equal(encoding, 'utf16be');
});

test('a form descriptor resolves to its layout, and nothing else does', () => {
  assert.equal(
    formLayoutFor(path.join(cfg, 'Forms', 'ФормаСписка.xml')),
    path.join(cfg, 'Forms', 'ФормаСписка', 'Ext', 'Form.xml'),
  );
  assert.equal(formLayoutFor(path.join(cfg, 'Forms', 'ФормаСписка', 'Ext', 'Form.xml')), '');
  assert.equal(formLayoutFor(path.join(cfg, 'Товары.xml')), '');
  assert.equal(formLayoutFor(path.join(cfg, 'Templates', 'Печать.xml')), '');
  assert.equal(formLayoutFor(path.join(cfg, 'Forms', 'Отчёт.mxl')), '');
});

test('object metadata is looked for in the two places 1C writes it', () => {
  assert.deepEqual(objectMetaCandidates(path.join(cfg, 'Forms', 'Ф', 'Ext', 'Form.xml')), [
    path.join(path.dirname(cfg), 'Товары.xml'),
    path.join(cfg, 'Товары.xml'),
  ]);
});

test('an extension form resolves to the corresponding base configuration form', () => {
  const extension = path.join('C:', 'src', 'cfe', 'MyExtension', 'Documents', 'Order',
    'Forms', 'DocumentForm', 'Ext', 'Form.xml');
  assert.equal(baseFormCandidate(extension), path.join('C:', 'src', 'cf', 'Documents', 'Order',
    'Forms', 'DocumentForm', 'Ext', 'Form.xml'));
  assert.equal(baseFormCandidate(path.join('C:', 'src', 'cf', 'Documents', 'Order', 'Form.xml')), '');
});

test('common command references resolve to configuration descriptors', () => {
  const form = path.join(cfg, 'Forms', 'Ф', 'Ext', 'Form.xml');
  assert.deepEqual(referencedCommonCommands(`
    <Command>CommonCommand.ПротоколОбмена</Command>
    <CommandName>CommonCommand.ПротоколОбмена</CommandName>
    <Command>CommonCommand.ДополнительныеСведения</Command>`),
  ['ПротоколОбмена', 'ДополнительныеСведения']);
  assert.ok(commonCommandCandidates(form, 'ПротоколОбмена')
    .some((candidate) => candidate.endsWith(path.join('CommonCommands', 'ПротоколОбмена.xml'))));
  const extension = path.join('C:', 'src', 'cfe', 'Extension', 'Documents', 'Order',
    'Forms', 'Card', 'Ext', 'Form.xml');
  assert.ok(commonCommandCandidates(extension, 'ПротоколОбмена')
    .includes(path.join('C:', 'src', 'cf', 'CommonCommands', 'ПротоколОбмена.xml')));
  assert.deepEqual(commonCommandCandidates(form, '../escape'), []);
});

test('common picture references resolve to safe external resources', () => {
  const form = path.join(cfg, 'Forms', 'Ф', 'Ext', 'Form.xml');
  assert.deepEqual(referencedCommonPictures(`
    <Picture><xr:Ref>CommonPicture.НавигацияОбновить</xr:Ref></Picture>
    <Picture>CommonPicture.НавигацияОбновить</Picture>
    <Picture>StdPicture.Refresh</Picture>`), ['НавигацияОбновить']);
  assert.ok(commonPictureDescriptorCandidates(form, 'НавигацияОбновить')
    .some((candidate) => candidate.endsWith(path.join('CommonPictures', 'НавигацияОбновить', 'Ext', 'Picture.xml'))));
  assert.equal(pictureResourceName('<Picture><xr:Abs>Picture.zip</xr:Abs></Picture>'), 'Picture.zip');
  assert.equal(pictureResourceName('<Picture><xr:Abs>Picture.png</xr:Abs></Picture>'), 'Picture.png');
  assert.equal(pictureResourceName('<Picture><xr:Abs>Picture.svg</xr:Abs></Picture>'), 'Picture.svg');
  assert.equal(pictureResourceName('<Picture><xr:Abs>Picture.txt</xr:Abs></Picture>'), '');
  assert.equal(pictureResourceName('<Picture><xr:Abs>../escape.png</xr:Abs></Picture>'), '');
  assert.deepEqual(commonPictureDescriptorCandidates(form, '../escape'), []);
});

test('only a real form layout has object metadata', () => {
  assert.deepEqual(objectMetaCandidates(path.join(cfg, 'Forms', 'ФормаСписка.xml')), []);
  assert.deepEqual(objectMetaCandidates(path.join(cfg, 'Ext', 'Form.xml')), []);
  assert.deepEqual(objectMetaCandidates(path.join(cfg, 'Товары.xml')), []);
});

test('configuration style references resolve to StyleItems metadata', () => {
  assert.deepEqual(referencedStyleItems('<BackColor>style:Accent</BackColor><TextColor>style:Accent</TextColor>'), ['Accent']);
  assert.ok(styleItemCandidates(path.join(cfg, 'Forms', 'Ф', 'Ext', 'Form.xml'), 'Accent')
    .some((candidate) => candidate.endsWith(path.join('StyleItems', 'Accent.xml'))));
  assert.equal(styleItemValue('<Value xsi:type="v8ui:Color">#AABBCC</Value>'), '#AABBCC');
  assert.deepEqual(styleItemCandidates('x', '../escape'), []);
});

test('style references are collected whatever case the prefix is written in', () => {
  /* The renderer resolves `style:` case-insensitively. Collecting only the
   * lowercase spelling left `Style:Имя` without its StyleItems file, and the
   * colour went missing with no error anywhere. */
  assert.deepEqual(referencedStyleItems('<BackColor>Style:Акцент</BackColor>'), ['Акцент']);
  assert.deepEqual(referencedStyleItems('<BackColor>STYLE:Акцент</BackColor>'), ['Акцент']);
  assert.deepEqual(referencedStyleItems('<A>style:Accent</A><B>Style:accent</B>'), ['Accent']);
  /* `style:` has to start a name, not end one. */
  assert.deepEqual(referencedStyleItems('<A>somestyle:Accent</A>'), []);
});

test('the supported extensions are the ones every host offers', () => {
  assert.deepEqual(SUPPORTED_EXTENSIONS, ['.xml', '.mxl']);
  assert.ok(isSupportedExtension('a/b/Form.XML'));
  assert.ok(isSupportedExtension('a/b/Печать.mxl'));
  assert.ok(!isSupportedExtension('a/b/Module.bsl'));
  assert.ok(!isSupportedExtension('a/b/README'));
});
