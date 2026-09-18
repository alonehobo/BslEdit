import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWebModules } from './helpers/dom.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sandbox = loadWebModules(root, ['sarif-rules-ru.js', 'sarif-preview.js']);
const S = sandbox.SarifPreview;
const sample = fs.readFileSync(path.join(root, 'testdata', 'sample.sarif'), 'utf8');

test('detect recognizes SARIF without claiming ordinary JSON', () => {
  assert.equal(S.detect(sample), true);
  assert.equal(S.detect('{"version":"2.0","runs":[]}'), false);
  assert.equal(S.detect('{"hello":"world"}'), false);
});

test('URI normalization covers long paths, UNC, file URI and UTF-8 Cyrillic', () => {
  const T = S._test;
  assert.equal(T.normalizeUri('//?/C:/Src/./A/../M.bsl'), 'C:\\Src\\M.bsl');
  assert.equal(T.normalizeUri('\\\\?\\UNC\\server\\share\\M.bsl'), '\\\\server\\share\\M.bsl');
  assert.equal(T.normalizeUri('file:///C:/Src/M.bsl'), 'C:\\Src\\M.bsl');
  assert.equal(T.normalizeUri('file:///C:/%D0%A2%D0%B5%D1%81%D1%82/M.bsl'), 'C:\\Тест\\M.bsl');
});

test('parse normalizes diagnostics, bases, default level and suppressions', () => {
  const parsed = S.parse(sample);
  assert.ok(parsed.model);
  assert.equal(parsed.model.diagnostics.length, 3, 'ParseError is omitted');
  assert.equal(parsed.model.diagnostics[0].path, 'C:\\Проект\\cf\\CommonModules\\Test\\Ext\\Module.bsl');
  assert.equal(parsed.model.diagnostics[1].level, 'warning');
  assert.equal(parsed.model.counts.total, 3);
  assert.equal(parsed.model.counts.error, 1);
  assert.equal(parsed.model.counts.warning, 1);
  assert.equal(parsed.model.counts.suppressed, 1);
  assert.equal(parsed.model.rules.R2.shortDescription, '');
});

test('BSL paths produce object and module labels', () => {
  const p = S._test.parseBslModulePath;
  assert.deepEqual({ ...p('cf/CommonModules/Сервис/Ext/Module.bsl') }, { object:'CommonModules.Сервис', module:'Модуль' });
  assert.deepEqual({ ...p('cf/Catalogs/Товары/Forms/ФормаЭлемента/Ext/Form/Module.bsl') }, { object:'Catalogs.Товары', module:'Форма: ФормаЭлемента' });
  assert.deepEqual({ ...p('cf/Documents/Продажа/Commands/Печать/Ext/CommandModule.bsl') }, { object:'Documents.Продажа', module:'Команда: Печать' });
  assert.deepEqual({ ...p('outside/foo.bsl') }, { object:'outside', module:'foo.bsl' });
});

test('both groupings and five-line decoration boundary are stable', () => {
  const model = S.parse(sample).model;
  assert.ok(S._test.buildTree(model.diagnostics, 'object').children.has('CommonModules.Test'));
  assert.ok(S._test.buildTree(model.diagnostics, 'rule').children.has('Неизвестная диагностика (R1)'));
  assert.equal(S._test.isShortDiagnosticRange({ line:1, endLine:5 }), true);
  assert.equal(S._test.isShortDiagnosticRange({ line:1, endLine:6 }), false);
});

test('expand-to stops at the named level and diagnostics open only at depth four', () => {
  const open = S._test.defaultGroupOpen;
  assert.deepEqual([open(0, 1), open(1, 1), open(2, 1)], [false, false, false], 'До объектов');
  assert.deepEqual([open(0, 2), open(1, 2), open(2, 2)], [true, false, false], 'До модулей');
  assert.deepEqual([open(0, 3), open(1, 3), open(2, 3)], [true, true, false], 'До правил');
  assert.deepEqual([open(0, 4), open(1, 4), open(2, 4)], [true, true, true], 'До диагностик');
  assert.deepEqual([open(0, 3, 'rule'), open(1, 3, 'rule')], [false, false], 'До правил, группировка по правилам');
  assert.deepEqual([open(0, 4, 'rule'), open(1, 4, 'rule')], [true, true], 'До диагностик, группировка по правилам');
});

test('Russian rule catalog is primary and technical ids stay in parentheses', () => {
  assert.ok(Object.keys(sandbox.SarifRuleTitlesRu).length >= 210);
  assert.equal(S._test.ruleLabel('LineLength', null), 'Ограничение на длину строки (LineLength)');
  assert.equal(S._test.ruleLabel('UnresolvedMethodCall', null), 'Не удалось разрешить вызов метода (UnresolvedMethodCall)');
  assert.equal(S._test.ruleLabel('FutureRule', { name:'English title', shortDescription:'English title' }),
    'Неизвестная диагностика (FutureRule)');
  assert.equal(S._test.ruleLabel('LocalRule', { shortDescription:'Локальное правило' }),
    'Локальное правило (LocalRule)');
  assert.equal(S._test.levelLabel('warning'), 'Предупреждение');
});

test('editor selection can reveal a diagnostic hidden by folding or render budget', () => {
  const d = { id:'diag-900', object:'Catalogs.Products', module:'Object module', ruleId:'R1', ruleTitle:'Правило (R1)', path:'Catalogs/Products/Ext/ObjectModule.bsl' };
  assert.deepEqual([...S._test.diagnosticGroupKeys(d, 'object')], [
    'root|Catalogs.Products',
    'root|Catalogs.Products|Object module',
    'root|Catalogs.Products|Object module|Правило (R1)',
  ]);
  assert.deepEqual([...S._test.diagnosticGroupKeys(d, 'rule')], [
    'root|Правило (R1)',
    'root|Правило (R1)|Catalogs/Products/Ext/ObjectModule.bsl',
  ]);
  assert.equal(S._test.shouldRenderDiagnostic(600, 600, d, 'diag-900'), true);
  assert.equal(S._test.shouldRenderDiagnostic(600, 600, d, 'another'), false);
});

test('EOL detection distinguishes CRLF, LF and mixed', () => {
  assert.equal(S._test.detectEol('a\r\nb\r\n'), 'Crlf');
  assert.equal(S._test.detectEol('a\nb\n'), 'Lf');
  assert.equal(S._test.detectEol('a\r\nb\n'), 'Mixed');
});

test('diagnostic cards keep the message separate from secondary metadata', () => {
  S.resetViewState();
  const select = { value:'1', onchange:null };
  const container = {
    className:'', innerHTML:'', onclick:null, onkeydown:null,
    querySelector(selector) { return selector === '[data-expand]' ? select : null; },
    querySelectorAll() { return []; },
  };
  S.render(S.parse(sample).model, container, {});
  select.value = '4';
  select.onchange();
  assert.match(container.innerHTML, /<span class="sf-message">[^<]+<\/span><span class="sf-card-meta">/,
    'the readable message comes before a dedicated metadata row');
  assert.doesNotMatch(container.innerHTML, /sf-card-top|sf-rule/,
    'the card must not repeat the rule title already shown by its parent group');
});

test('rule groups use the same severity classes as diagnostic labels', () => {
  const model = S.parse(sample).model;
  const render = () => {
    const select = { value:'1', onchange:null };
    const container = {
      className:'', innerHTML:'', onclick:null, onkeydown:null,
      querySelector(selector) { return selector === '[data-expand]' ? select : null; },
      querySelectorAll() { return []; },
    };
    S.render(model, container, {});
    select.value = '3';
    select.onchange();
    return container.innerHTML;
  };

  S.resetViewState();
  assert.match(render(), /sf-group-head sf-error[^>]+>[\s\S]*?Неизвестная диагностика \(R1\)/);
  assert.match(render(), /sf-group-head sf-warning[^>]+>[\s\S]*?Неизвестная диагностика \(R2\)/);

  const groupButton = {
    closest() { return this; },
    hasAttribute(name) { return name === 'data-group'; },
    getAttribute(name) { return name === 'data-group' ? 'rule' : null; },
  };
  const switchContainer = {
    className:'', innerHTML:'', onclick:null, onkeydown:null,
    querySelector() { return { value:'3', onchange:null }; },
    querySelectorAll() { return []; },
  };
  S.render(model, switchContainer, {});
  switchContainer.onclick({ target:groupButton });
  assert.match(switchContainer.innerHTML, /sf-group-head sf-error[^>]+>[\s\S]*?Неизвестная диагностика \(R1\)/,
    'top-level rule groups are colored when grouping by rule');
});
