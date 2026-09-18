import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWebModules } from './helpers/dom.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sandbox = loadWebModules(root, ['form-validate.js']);
const FV = sandbox.window.FormValidate;
const plain = (v) => JSON.parse(JSON.stringify(v));
const validate = (xml, options) => plain(FV.validateForm(xml, options));
const codes = (list) => list.map((e) => e.code);

const NS = 'xmlns="http://v8.1c.ru/8.3/xcf/logform" xmlns:v8="http://v8.1c.ru/8.1/data/core" ' +
  'xmlns:cfg="http://v8.1c.ru/8.1/data/enterprise/current-config" xmlns:xs="http://www.w3.org/2001/XMLSchema" ' +
  'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"';

/* A small form as Designer writes it; parts are replaced per test. */
function form({ head = '', items = '', attributes = '', commands = '', version = '2.20', ns = NS,
  acb = '<AutoCommandBar name="ФормаКоманднаяПанель" id="-1"/>' } = {}) {
  return '﻿<?xml version="1.0" encoding="UTF-8"?>\n' +
    `<Form ${ns} version="${version}">${head}${acb}` +
    `<ChildItems>${items}</ChildItems>` +
    `<Attributes>${attributes}</Attributes>` +
    `<Commands>${commands}</Commands></Form>`;
}
const field = (name, id, extra = '') =>
  `<InputField name="${name}" id="${id}">${extra}<ContextMenu name="${name}КМ" id="${id}01"/>` +
  `<ExtendedTooltip name="${name}РП" id="${id}02"/></InputField>`;
const attribute = (name, id, extra = '') =>
  `<Attribute name="${name}" id="${id}"><Type><v8:Type>xs:string</v8:Type></Type>${extra}</Attribute>`;

test('a complete form passes with a summary', () => {
  const r = validate(form({
    head: '<Title><v8:item><v8:lang>ru</v8:lang><v8:content>Форма</v8:content></v8:item></Title>' +
      '<Events><Event name="OnOpen">ПриОткрытии</Event></Events>',
    items: field('Имя', 1, '<DataPath>Объект.Имя</DataPath>') +
      '<Button name="Кнопка" id="2"><CommandName>Form.Command.Выполнить</CommandName><ExtendedTooltip name="КнопкаРП" id="3"/></Button>',
    attributes: attribute('Объект', 1, '<MainAttribute>true</MainAttribute>'),
    commands: '<Command name="Выполнить" id="1"><Action>Выполнить</Action></Command>'
  }), { formatVersion: '2.20', context: 'config' });
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, []);
  assert.equal(r.ok, true);
  assert.deepEqual(r.summary, { elements: 2, attributes: 1, commands: 1 });
});

test('the sample fixture form is valid', () => {
  const r = validate(fs.readFileSync(path.join(root, 'tests', 'fixtures', 'form-validate', 'Form.xml'), 'utf8'));
  assert.deepEqual(r.errors, []);
  assert.equal(r.ok, true);
});

test('malformed XML is one xml error', () => {
  const r = validate('<Form><ChildItems></Form>');
  assert.equal(r.ok, false);
  assert.deepEqual(codes(r.errors), ['xml']);
  assert.match(r.errors[0].message, /Некорректный XML/);
});

test('check 1: root element and version', () => {
  assert.deepEqual(codes(validate('<document/>').errors), ['root']);
  assert.deepEqual(codes(validate(form({ version: 'x' })).errors), ['formVersion']);
  assert.deepEqual(codes(validate(form({ version: '2.9' })).warnings), ['formVersion']);
});

test('check 2: AutoCommandBar present, id -1', () => {
  assert.deepEqual(codes(validate(form({ acb: '' })).errors), ['autoCommandBar']);
  assert.deepEqual(codes(validate(form({ acb: '<AutoCommandBar name="П" id="abc"/>' })).errors), ['autoCommandBar']);
  const r = validate(form({ acb: '<AutoCommandBar name="П" id="5"/>' }));
  assert.equal(r.ok, true);
  assert.deepEqual(codes(r.warnings), ['autoCommandBar']);
});

test('check 3: duplicate ids and names in each pool', () => {
  assert.deepEqual(codes(validate(form({ items: field('А', 1) + field('Б', 1) })).errors), ['duplicateElementId']);
  const nested = '<UsualGroup name="Г" id="5"><ExtendedTooltip name="ГРП" id="6"/><ChildItems>' + field('А', 2) + '</ChildItems></UsualGroup>';
  const r = validate(form({ items: field('А', 1) + nested }));
  assert.deepEqual(codes(r.errors), ['duplicateElementName']);
  assert.equal(r.errors[0].element, 'А');
  assert.deepEqual(codes(validate(form({ attributes: attribute('А', 1) + attribute('Б', 1) })).errors), ['duplicateAttributeId']);
  assert.deepEqual(codes(validate(form({ attributes: attribute('А', 1) + attribute('А', 2) })).errors), ['duplicateAttributeName']);
  const cols = '<Columns><Column name="К" id="1"/><Column name="К" id="1"/></Columns>';
  assert.deepEqual(codes(validate(form({ attributes: attribute('Т', 1, cols) })).errors), ['duplicateColumnId', 'duplicateColumnName']);
  const cmd = (n, id) => `<Command name="${n}" id="${id}"><Action>${n}</Action></Command>`;
  assert.deepEqual(codes(validate(form({ commands: cmd('А', 1) + cmd('Б', 1) })).errors), ['duplicateCommandId']);
  assert.deepEqual(codes(validate(form({ commands: cmd('А', 1) + cmd('А', 2) })).errors), ['duplicateCommandName']);
  const params = '<Parameters><Parameter name="П"/><Parameter name="П"/></Parameters>';
  assert.deepEqual(codes(validate(form({ head: params })).errors), ['duplicateParameterName']);
});

test('check 4: missing companions are warnings', () => {
  const r = validate(form({ items: '<InputField name="Поле" id="1"><ContextMenu name="ПолеКМ" id="2"/></InputField>' }));
  assert.equal(r.ok, true);
  assert.deepEqual(codes(r.warnings), ['companion']);
  assert.match(r.warnings[0].message, /ExtendedTooltip/);
});

test('check 5: data paths start at an attribute, Items.* resolves through tables', () => {
  const r = validate(form({ items: field('Поле', 1, '<DataPath>Нет.Поле</DataPath>') }));
  assert.deepEqual(codes(r.errors), ['dataPath']);
  assert.match(r.errors[0].message, /нет реквизита "Нет"/);
  const table = '<Table name="Таблица" id="2"><DataPath>Объект.Товары</DataPath><ContextMenu name="ТК" id="3"/>' +
    '<AutoCommandBar name="ТП" id="4"/><SearchStringAddition name="ТС" id="5"/><ViewStatusAddition name="ТВ" id="6"/>' +
    '<SearchControlAddition name="ТУ" id="7"/></Table>';
  const ok = validate(form({
    items: table + field('Поле', 8, '<DataPath>Items.Таблица.CurrentData.Цена</DataPath>'),
    attributes: attribute('Объект', 1)
  }));
  assert.deepEqual(ok.errors, []);
  assert.deepEqual(codes(validate(form({ items: field('Поле', 8, '<DataPath>Items.Нет.CurrentData.Цена</DataPath>') })).errors), ['dataPath']);
  assert.deepEqual(codes(validate(form({ items: field('Поле', 8, '<DataPath>Items.Нет.Цена</DataPath>') })).warnings), ['dataPath']);
  assert.deepEqual(validate(form({ items: field('Поле', 8, '<DataPath>1000003</DataPath>') })).errors, []);
});

test('check 6: button command must exist', () => {
  const button = '<Button name="К" id="1"><CommandName>Form.Command.Нет</CommandName><ExtendedTooltip name="КРП" id="2"/></Button>';
  assert.deepEqual(codes(validate(form({ items: button })).errors), ['commandName']);
  const std = '<Button name="К" id="1"><CommandName>Form.StandardCommand.Close</CommandName><ExtendedTooltip name="КРП" id="2"/></Button>';
  assert.deepEqual(validate(form({ items: std })).errors, []);
});

test('check 7: events need handler names', () => {
  assert.deepEqual(codes(validate(form({ head: '<Events><Event name="OnOpen"/></Events>' })).errors), ['eventHandler']);
  const r = validate(form({ items: field('Поле', 1, '<Events><Event name="OnChange"> </Event></Events>') }));
  assert.deepEqual(codes(r.errors), ['eventHandler']);
  assert.equal(r.errors[0].element, 'Поле');
});

test('check 8: command without action is a warning', () => {
  const r = validate(form({ commands: '<Command name="К" id="1"/>' }));
  assert.equal(r.ok, true);
  assert.deepEqual(codes(r.warnings), ['commandAction']);
});

test('check 9: at most one main attribute', () => {
  const main = '<MainAttribute>true</MainAttribute>';
  assert.deepEqual(codes(validate(form({ attributes: attribute('А', 1, main) + attribute('Б', 2, main) })).errors), ['mainAttribute']);
});

test('check 10: plain-text title is a warning', () => {
  const r = validate(form({ head: '<Title>Форма</Title>' }));
  assert.equal(r.ok, true);
  assert.deepEqual(codes(r.warnings), ['title']);
});

test('check 11 is replaced by an info for extension forms', () => {
  const r = validate(form({ head: '<BaseForm version="2.20"/>', items: field('Поле', 1, '<DataPath>Нет.Поле</DataPath>') }));
  assert.deepEqual(codes(r.info), ['extensionForm']);
  assert.deepEqual(r.errors, []);
  const callType = '<Events><Event name="OnOpen" callType="After">А</Event></Events>';
  assert.deepEqual(codes(validate(form({ head: callType })).warnings), ['callType']);
});

test('check 12: type values', () => {
  const typed = (t) => form({ attributes: `<Attribute name="А" id="1"><Type><v8:Type>${t}</v8:Type></Type></Attribute>` });
  assert.deepEqual(codes(validate(typed('FormDataStructure')).errors), ['type']);
  assert.deepEqual(codes(validate(typed('cfg:CatalogRefs.X')).warnings), ['type']);
  assert.deepEqual(codes(validate(typed('String')).warnings), ['type']);
  assert.deepEqual(codes(validate(typed('cfg:ExternalDataProcessorObject.X'), { context: 'config' }).errors), ['type']);
  assert.deepEqual(validate(typed('cfg:ExternalDataProcessorObject.X'), { context: 'external' }).errors, []);
});

test('check 13: namespace prefixes are declared in scope', () => {
  const noCfg = NS.replace(/ xmlns:cfg="[^"]*"/, '');
  const typed = '<Attribute name="А" id="1"><Type><v8:Type>cfg:CatalogRef.X</v8:Type></Type></Attribute>';
  assert.deepEqual(codes(validate(form({ ns: noCfg, attributes: typed })).errors), ['namespacePrefix']);
  const local = '<Attribute name="А" id="1"><Type xmlns:cfg="http://v8.1c.ru/8.1/data/enterprise/current-config">' +
    '<v8:Type>cfg:CatalogRef.X</v8:Type></Type></Attribute>';
  assert.deepEqual(validate(form({ ns: noCfg, attributes: local })).errors, []);
  const xsi = '<Attribute name="А" id="1"><Settings xsi:type="dcsset:Settings"/></Attribute>';
  assert.deepEqual(codes(validate(form({ attributes: xsi })).errors), ['namespacePrefix']);
});

test('check 14: form version matches the dump version', () => {
  assert.deepEqual(codes(validate(form({ version: '2.21' }), { formatVersion: '2.20' }).errors), ['formatVersion']);
  assert.deepEqual(validate(form({ version: '2.21' })).errors, []);
});
