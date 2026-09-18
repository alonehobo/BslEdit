import assert from 'node:assert/strict';
import test from 'node:test';
import { FIXED_PAIR_ROUNDING, layoutFixedPair } from '../layout/fixed-pair-layout.mjs';

const authored = (source) => ({ kind: 'authored', source });
const modelDerived = (source) => ({ kind: 'model-derived', source });
const modelDefault = (source) => ({ kind: 'model-default', source });

function band(intrinsic, minimum, preferred, maximum = preferred) {
  return {
    intrinsic, minimum, preferred, maximum,
    provenance: modelDerived('frozen calibration size evidence + authored FormModel'),
  };
}

function child(id, order, width, height, extra = {}) {
  return {
    id,
    order,
    provenance: authored(`Form.xml#${id}`),
    generated: false,
    ownerDrawn: false,
    ownerKind: 'legacy-paint',
    widthDependent: false,
    responsive: false,
    size: { width, height },
    stretch: { horizontal: false, vertical: false },
    compress: { horizontal: false, vertical: false },
    baseline: null,
    ...extra,
  };
}

function input(axis, contentRect, children, owner = {}) {
  return {
    viewport: { width: 1024, height: 768 },
    profile: { id: 'taxi-96', hash: 'profile-sha256' },
    owner: {
      id: 'ordinary-pair',
      provenance: authored('Form.xml#ordinary-pair'),
      sourceTag: 'UsualGroup',
      behavior: 'Usual',
      representation: 'None',
      showTitle: false,
      united: true,
      ownerKind: 'authored',
      axis,
      axisProvenance: 'authored-explicit',
      spacing: { value: axis === 'horizontal' ? 10 : 9, provenance: modelDefault('Taxi.Single') },
      responsive: false,
      widthDependent: false,
      throughAlign: false,
      projectedSubgrid: false,
      crossAlign: 'start',
      chrome: false,
      background: false,
      contentRect,
      ...owner,
    },
    children,
  };
}

test('calibration horizontal pair grows only the authored stretch track', () => {
  const children = [
    child('period', 0, band(122, 122, 122, 250), band(25, 25, 25), {
      stretch: { horizontal: true, vertical: false },
    }),
    child('delegation', 1, band(122, 122, 146), band(25, 25, 25), {
      compress: { horizontal: true, vertical: false },
    }),
  ];

  const narrow = layoutFixedPair(input('horizontal', { x: 20, y: 30, width: 254, height: 25 }, children));
  assert.equal(narrow.status, 'supported');
  assert.deepEqual(narrow.children.map(({ allocated }) => allocated.local), [
    { x: 0, y: 0, width: 122, height: 25 },
    { x: 132, y: 0, width: 122, height: 25 },
  ]);

  const medium = layoutFixedPair(input('horizontal', { x: 20, y: 30, width: 379, height: 25 }, children));
  assert.deepEqual(medium.children.map(({ allocated }) => allocated.absolute), [
    { x: 20, y: 30, width: 223, height: 25 },
    { x: 253, y: 30, width: 146, height: 25 },
  ]);

  const wide = layoutFixedPair(input('horizontal', { x: 20, y: 30, width: 406, height: 25 }, children));
  assert.deepEqual(wide.children.map(({ allocated }) => allocated.local.width), [250, 146]);
  assert.equal(wide.allocation.main.free, 0);
});

test('calibration fixed pair compresses proportionally to independent size ranges', () => {
  const result = layoutFixedPair(input('horizontal', { x: 0, y: 0, width: 293, height: 25 }, [
    child('number', 0, band(111, 111, 214), band(25, 25, 25), {
      compress: { horizontal: true, vertical: false },
    }),
    child('date', 1, band(172, 172, 193), band(25, 25, 25), {
      compress: { horizontal: true, vertical: false },
    }),
  ]));

  assert.equal(result.status, 'supported');
  assert.deepEqual(result.children.map(({ allocated }) => allocated.local.width), [111, 172]);
  assert.equal(result.children[1].allocated.local.x, 121);
});

test('calibration vertical pair preserves 17 + 9 + 25 cadence', () => {
  const result = layoutFixedPair(input('vertical', { x: 7, y: 11, width: 180, height: 51 }, [
    child('check', 0, band(80, 80, 80), band(17, 17, 17)),
    child('field', 1, band(180, 180, 180), band(25, 25, 25)),
  ]));

  assert.equal(result.status, 'supported');
  assert.deepEqual(result.children.map(({ allocated }) => allocated.local), [
    { x: 0, y: 0, width: 80, height: 17 },
    { x: 0, y: 26, width: 180, height: 25 },
  ]);
});

test('fractional surplus uses one stable authored-order rounding point', () => {
  const stretch = { horizontal: true, vertical: false };
  const result = layoutFixedPair(input('horizontal', { x: 0, y: 0, width: 31, height: 10 }, [
    child('first', 0, band(10, 10, 10, 20), band(10, 10, 10), { stretch }),
    child('second', 1, band(10, 10, 10, 20), band(10, 10, 10), { stretch }),
  ]));

  assert.deepEqual(result.children.map(({ allocated }) => allocated.local.width), [11, 10]);
  assert.equal(result.rounding, FIXED_PAIR_ROUNDING);
});

test('an interaction minimum may exceed intrinsic content without losing provenance', () => {
  const result = layoutFixedPair(input('horizontal', { x: 0, y: 0, width: 100, height: 17 }, [
    child('short-control', 0, band(12, 40, 40), band(17, 17, 17)),
    child('second-control', 1, band(50, 50, 50), band(17, 17, 17)),
  ]));
  assert.equal(result.status, 'supported');
  assert.deepEqual(result.children.map(({ allocated }) => allocated.local.width), [40, 50]);
});

test('text intrinsic size is supplied by an injected metric and rounded outward', () => {
  const width = band({ kind: 'text', text: 'Период', styleKey: 'Taxi.Label', chrome: 5 }, 20, 80, 80);
  const source = input('horizontal', { x: 0, y: 0, width: 150, height: 17 }, [
    child('label', 0, width, band(17, 17, 17)),
    child('value', 1, band(60, 60, 60), band(17, 17, 17)),
  ]);
  source.textMetrics = { id: 'taxi-font-96', hash: 'font-sha256' };
  const requests = [];
  const result = layoutFixedPair(source, { measureText(request) { requests.push(request); return 42.25; } });

  assert.equal(result.status, 'supported');
  assert.equal(result.children[0].sizeBands.width.intrinsic, 48);
  assert.deepEqual(requests, [{
    text: 'Период', styleKey: 'Taxi.Label', metricsId: 'taxi-font-96', metricsHash: 'font-sha256',
  }]);
});

test('missing text metric produces explicit whole-owner legacy fallback', () => {
  const result = layoutFixedPair(input('horizontal', { x: 0, y: 0, width: 150, height: 17 }, [
    child('label', 0, band({ kind: 'text', text: 'Период', styleKey: 'Taxi.Label' }, 20, 80), band(17, 17, 17)),
    child('value', 1, band(60, 60, 60), band(17, 17, 17)),
  ]));
  assert.deepEqual({ status: result.status, owner: result.geometryOwner, reason: result.fallbackReason }, {
    status: 'unsupported', owner: 'legacy', reason: 'missing-text-metrics',
  });
});

test('boundary counterexamples never enter shared allocation', () => {
  const normalChildren = [
    child('a', 0, band(40, 40, 40), band(17, 17, 17)),
    child('b', 1, band(40, 40, 40), band(17, 17, 17)),
  ];
  const cases = [
    [input('horizontal', { x: 0, y: 0, width: 90, height: 17 }, normalChildren, { responsive: true }), 'responsive-group'],
    [input('horizontal', { x: 0, y: 0, width: 90, height: 17 }, normalChildren, { united: false }), 'unsupported-owner-kind'],
    [input('horizontal', { x: 0, y: 0, width: 90, height: 17 }, normalChildren, { crossAlign: 'center' }), 'cross-alignment'],
    [input('horizontal', { x: 0, y: 0, width: 90, height: 17 }, normalChildren, {
      spacing: { value: 6, provenance: authored('Form.xml#spacing') },
    }), 'non-default-spacing'],
  ];
  for (const [source, reason] of cases) {
    const result = layoutFixedPair(source);
    assert.equal(result.status, 'unsupported');
    assert.equal(result.geometryOwner, 'legacy');
    assert.equal(result.fallbackReason, reason);
    assert.equal('children' in result, false, 'fallback must not partially allocate children');
  }
});

test('missing authored size provenance is unknown instead of guessed', () => {
  const unknown = band(40, 40, 40);
  delete unknown.provenance;
  const result = layoutFixedPair(input('horizontal', { x: 0, y: 0, width: 90, height: 17 }, [
    child('unknown', 0, unknown, band(17, 17, 17)),
    child('known', 1, band(40, 40, 40), band(17, 17, 17)),
  ]));
  assert.equal(result.status, 'unsupported');
  assert.equal(result.fallbackReason, 'unknown-size-band');
  assert.equal(result.childId, 'unknown');
});
