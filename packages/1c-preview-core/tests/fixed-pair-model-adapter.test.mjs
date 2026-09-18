import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  FIXED_PAIR_SHADOW_SCHEMA,
  adaptFormModelFixedPairs,
  installFixedPairLayoutShadow,
  runFixedPairLayoutShadow,
} from '../layout/fixed-pair-model-adapter.mjs';

const profile = { id: 'taxi-96', hash: 'frozen-taxi-profile-sha256' };
const viewport = { width: 1024, height: 768 };

function field(id, width, extra = {}) {
  return {
    tag: 'LabelField', id,
    properties: {
      Width: String(width), HorizontalStretch: 'False', VerticalStretch: 'False',
      ...extra,
    },
  };
}

function pair(id = 'ordinary-pair', extra = {}, children = [field('number', 10), field('date', 16)]) {
  return {
    tag: 'UsualGroup', id,
    properties: {
      Behavior: 'Usual', Representation: 'None', ShowTitle: 'False', United: 'True',
      Group: 'Horizontal', HorizontalSpacing: 'Single', ThroughAlign: 'DontUse',
      ...extra,
    },
    childItems: children,
  };
}

const adaptation = (model, extra = {}) => adaptFormModelFixedPairs(model, {
  viewport, profile,
  contentRectFor: () => ({ x: 20, y: 30, width: 290, height: 25 }),
  ...extra,
});

test('calibration-style authored pair becomes an independent fixed-pair size contract', () => {
  // Same semantic class as calibration form-02 GroupOwnGoodsNumberDate; the
  // classifier deliberately does not inspect that name or any form id.
  const [entry] = adaptation(pair('random-owner-id'));
  assert.equal(entry.status, 'candidate');
  assert.equal(entry.input.owner.axis, 'horizontal');
  assert.equal(entry.input.owner.spacing.value, 10);
  assert.deepEqual(entry.input.children.map((child) => child.size.width.preferred), [110, 170]);
  assert.match(entry.input.children[0].size.width.provenance.source, /FormModel:number\.Width/);
  assert.equal(JSON.stringify(entry.input).includes('offsetWidth'), false);

  const report = runFixedPairLayoutShadow(pair('random-owner-id'), {
    viewport, profile,
    contentRectFor: () => ({ x: 20, y: 30, width: 290, height: 25 }),
    observedBounds: [
      { id: 'random-owner-id', bounds: { x: 20, y: 30, width: 290, height: 25 } },
      { id: 'number', bounds: { x: 20, y: 30, width: 110, height: 25 } },
      { id: 'date', bounds: { x: 140, y: 30, width: 170, height: 25 } },
    ],
  });
  assert.equal(report.schema, FIXED_PAIR_SHADOW_SCHEMA);
  assert.equal(report.supportedOwnerCount, 1);
  assert.equal(report.entries[0].firstDivergence, null);
  assert.equal(report.geometryOwner, 'legacy');
  assert.equal(report.mutatesDom, false);
});

test('calibration boundary classes produce explicit whole-owner fallback', () => {
  const cases = [
    [pair('hifp', { Group: 'HorizontalIfPossible' }), 'responsive-group'],
    [pair('detached', { United: 'False' }), 'unsupported-owner-kind'],
    [pair('through', { ThroughAlign: 'Use' }), 'projected-subgrid'],
    [pair('chrome', { Representation: 'StrongSeparation' }), 'owner-chrome'],
    [pair('table-owner', {}, [{ tag: 'Table', id: 'table', properties: {} }, field('date', 16)]), 'owner-drawn-child'],
    [pair('bar-owner', {}, [{ tag: 'CommandBar', id: 'bar', properties: {} }, field('date', 16)]), 'owner-drawn-child'],
  ];
  for (const [model, reason] of cases) {
    const [entry] = adaptation(model);
    assert.equal(entry.status, 'unsupported');
    assert.equal(entry.fallbackReason, reason);
    const report = runFixedPairLayoutShadow(model, { viewport, profile });
    assert.equal(report.entries[0].geometryOwner, 'legacy');
    assert.equal(report.entries[0].sharedOwnerRect, null);
    assert.deepEqual(report.entries[0].children, []);
  }

  const nested = { tag: 'Form', childItems: [{ tag: 'Pages', childItems: [pair('inside-page')] }] };
  const [entry] = adaptation(nested);
  assert.equal(entry.fallbackReason, 'projected-subgrid');
});

test('missing independent sizes and metrics never borrow observed child bounds', () => {
  const unknown = pair('unknown-size', {}, [
    { tag: 'LabelDecoration', id: 'caption', properties: { Title: 'Номер' } },
    field('date', 16),
  ]);
  const report = runFixedPairLayoutShadow(unknown, {
    viewport, profile,
    contentRectFor: () => ({ x: 0, y: 0, width: 200, height: 25 }),
    observedBounds: [{ id: 'caption', bounds: { x: 0, y: 0, width: 20, height: 17 } }],
  });
  assert.equal(report.entries[0].fallbackReason, 'unknown-size-band');
  assert.equal(report.entries[0].inputCoverage, 'unknown');
  assert.equal(report.entries[0].sharedOwnerRect, null);
});

test('unknown visual profile does not reuse taxi metrics', () => {
  const [entry] = adaptation(pair(), { profile: { id: 'unknown-profile', hash: 'other-hash' } });
  assert.equal(entry.status, 'unsupported');
  assert.equal(entry.fallbackReason, 'unknown-profile');
});

test('explicit shadow hook only reads DOM geometry and leaves legacy as sole owner', () => {
  const target = {};
  assert.equal(installFixedPairLayoutShadow(target, { enabled: false }), null);
  assert.equal(target.FixedPairLayoutShadow, undefined);

  const writes = [];
  const childBox = { getBoundingClientRect: () => ({ left: 20, top: 30, width: 290, height: 25 }) };
  const nodes = [
    fakeElement('ordinary-pair', { left: 20, top: 30, width: 290, height: 25 }, childBox, writes),
    fakeElement('number', { left: 20, top: 30, width: 110, height: 25 }, null, writes),
    fakeElement('date', { left: 140, top: 30, width: 170, height: 25 }, null, writes),
  ];
  const body = {
    clientWidth: 1024, clientHeight: 768,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1024, height: 768 }),
    querySelectorAll: (selector) => selector === '[data-id]' ? nodes : [],
  };
  const hook = installFixedPairLayoutShadow(target, { enabled: true, profile });
  const report = hook.run({ model: pair(), body });
  assert.equal(target.__TC_BSL_FIXED_PAIR_SHADOW__, true);
  assert.equal(report.mode, 'shadow-only');
  assert.equal(report.geometryOwner, 'legacy');
  assert.equal(report.entries[0].classifier, 'supported');
  assert.deepEqual(writes, []);
});

test('renderer hook is guarded by the explicit shadow flag', async () => {
  const source = await readFile(new URL('../browser/form-preview.js', import.meta.url), 'utf8');
  assert.match(source, /__TC_BSL_FIXED_PAIR_SHADOW__\s*===\s*true/);
  assert.match(source, /FixedPairLayoutShadow\.run/);
  assert.doesNotMatch(source, /FixedPairLayoutShadow\.run\([\s\S]*?\.style\s*=/);
});

function fakeElement(id, rect, childBox, writes) {
  return {
    getAttribute(name) { return name === 'data-id' ? id : null; },
    getBoundingClientRect() { return rect; },
    querySelector(selector) { return selector === '.fp-children' ? childBox : null; },
    setAttribute(...args) { writes.push(['setAttribute', ...args]); },
    style: new Proxy({}, { set(object, key, value) { writes.push(['style', key, value]); object[key] = value; return true; } }),
  };
}
