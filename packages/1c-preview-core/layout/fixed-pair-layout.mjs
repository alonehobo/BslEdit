/**
 * DOM-free layout contract for the first shared-layout pilot.
 *
 * The caller must normalize authored/model data before calling this module.
 * In particular, post-layout browser measurements are not valid provenance.
 * Unsupported input returns an explicit whole-owner legacy fallback; shared and
 * legacy allocation are never mixed inside one owner.
 */

export const FIXED_PAIR_SCOPE_VERSION = 'ordinary-fixed-axis-pair@1';
export const FIXED_PAIR_ROUNDING = 'largest-remainder-then-authored-order@1';

const AXES = Object.freeze(['horizontal', 'vertical']);
const DIMENSION = Object.freeze({ horizontal: 'width', vertical: 'height' });
const POSITION = Object.freeze({ horizontal: 'x', vertical: 'y' });
const DEFAULT_GAP = Object.freeze({ horizontal: 10, vertical: 9 });
const SUPPORTED_SOURCE_KINDS = new Set([
  'authored', 'authored-default', 'model-derived', 'model-default', 'text-metrics',
]);

/**
 * @param {object} input normalized pilot IR, sourced from authored/model data
 * @param {object} [dependencies]
 * @param {(request: object) => number} [dependencies.measureText] injected text metric
 */
export function layoutFixedPair(input, dependencies = {}) {
  const ownerId = typeof input?.owner?.id === 'string' ? input.owner.id : null;
  const fallback = (reason, details = {}) => Object.freeze({
    schema: FIXED_PAIR_SCOPE_VERSION,
    status: 'unsupported',
    ownerId,
    geometryOwner: 'legacy',
    fallbackReason: reason,
    ...details,
  });

  if (!input || typeof input !== 'object') return fallback('invalid-input');
  const owner = input.owner;
  if (!owner || typeof owner !== 'object') return fallback('unsupported-owner-kind');
  if (!validProvenance(owner.provenance)) return fallback('missing-owner-provenance');
  if (!['UsualGroup', 'Group'].includes(owner.sourceTag)
      || owner.behavior !== 'Usual'
      || owner.representation !== 'None'
      || owner.showTitle !== false
      || owner.united !== true
      || owner.ownerKind !== 'authored') return fallback('unsupported-owner-kind');
  if (!AXES.includes(owner.axis)) return fallback('unsupported-axis');
  if (!['authored-explicit', 'model-default'].includes(owner.axisProvenance)) {
    return fallback('missing-axis-provenance');
  }
  if (owner.responsive === true || owner.widthDependent === true) return fallback('responsive-group');
  if (owner.throughAlign === true || owner.projectedSubgrid === true) return fallback('projected-subgrid');
  if (owner.crossAlign !== 'start') return fallback('cross-alignment');
  if (owner.chrome === true || owner.background === true) return fallback('owner-chrome');
  if (!owner.spacing || !validProvenance(owner.spacing.provenance)) {
    return fallback('missing-spacing-provenance');
  }
  if (owner.spacing.value !== DEFAULT_GAP[owner.axis]
      || !['model-default', 'authored-default'].includes(owner.spacing.provenance.kind)) {
    return fallback('non-default-spacing');
  }

  const contentRect = normalizeRect(owner.contentRect);
  if (!contentRect) return fallback('unknown-owner-content-rect');
  if (!input.viewport || !positiveInteger(input.viewport.width)
      || !positiveInteger(input.viewport.height)) return fallback('unknown-viewport');
  if (!validIdentity(input.profile)) return fallback('unknown-profile');

  const children = Array.isArray(input.children) ? [...input.children] : [];
  if (children.length !== 2) return fallback('unsupported-child-count');
  children.sort((left, right) => left.order - right.order);
  if (children.some((child, index) => child.order !== index)) return fallback('unstable-authored-order');

  const normalizedChildren = [];
  for (const child of children) {
    if (!validProvenance(child.provenance)) return fallback('missing-child-provenance', { childId: child.id ?? null });
    if (child.generated === true || child.ownerDrawn === true || child.ownerKind !== 'legacy-paint') {
      return fallback('owner-drawn-child', { childId: child.id ?? null });
    }
    if (child.widthDependent === true || child.responsive === true) {
      return fallback('width-dependent-child', { childId: child.id ?? null });
    }
    if (!validOptionalWeight(child.growWeight?.horizontal)
        || !validOptionalWeight(child.growWeight?.vertical)
        || !validOptionalWeight(child.shrinkWeight?.horizontal)
        || !validOptionalWeight(child.shrinkWeight?.vertical)) {
      return fallback('invalid-allocation-weight', { childId: child.id ?? null });
    }
    if (child.baseline != null && !nonNegativeInteger(child.baseline)) {
      return fallback('unknown-baseline', { childId: child.id ?? null });
    }
    const size = {};
    for (const dimension of ['width', 'height']) {
      const resolved = resolveSizeBand(child.size?.[dimension], dependencies, input.textMetrics);
      if (resolved.reason) return fallback(resolved.reason, { childId: child.id ?? null, dimension });
      size[dimension] = resolved.band;
    }
    normalizedChildren.push({ ...child, size });
  }

  const mainDimension = DIMENSION[owner.axis];
  const crossAxis = owner.axis === 'horizontal' ? 'vertical' : 'horizontal';
  const crossDimension = DIMENSION[crossAxis];
  const mainAvailable = Math.max(0, contentRect[mainDimension] - owner.spacing.value);
  const main = allocateIntegerAxis(normalizedChildren.map((child) => track(child, owner.axis)), mainAvailable);
  const cross = normalizedChildren.map((child) => allocateSingleTrack(track(child, crossAxis), contentRect[crossDimension]));

  let cursor = 0;
  const resultChildren = normalizedChildren.map((child, index) => {
    const local = owner.axis === 'horizontal'
      ? { x: cursor, y: 0, width: main.sizes[index], height: cross[index].size }
      : { x: 0, y: cursor, width: cross[index].size, height: main.sizes[index] };
    cursor += main.sizes[index] + owner.spacing.value;
    const absolute = {
      x: contentRect.x + local.x,
      y: contentRect.y + local.y,
      width: local.width,
      height: local.height,
    };
    return Object.freeze({
      id: child.id,
      order: child.order,
      sizeBands: Object.freeze(child.size),
      allocated: Object.freeze({ local: Object.freeze(local), absolute: Object.freeze(absolute) }),
      baseline: child.baseline == null ? null : child.baseline,
      geometryOwner: 'shared-outer-rect/legacy-paint',
    });
  });

  return Object.freeze({
    schema: FIXED_PAIR_SCOPE_VERSION,
    status: 'supported',
    ownerId,
    geometryOwner: 'shared',
    coordinateSpace: 'owner-content-local-integer-pixels',
    rounding: FIXED_PAIR_ROUNDING,
    viewport: Object.freeze({ ...input.viewport }),
    profile: Object.freeze({ ...input.profile }),
    textMetrics: input.textMetrics ? Object.freeze({ ...input.textMetrics }) : null,
    ownerRect: Object.freeze({ local: Object.freeze({ x: 0, y: 0, width: contentRect.width, height: contentRect.height }), absolute: Object.freeze(contentRect) }),
    axis: owner.axis,
    gap: owner.spacing.value,
    allocation: Object.freeze({
      main: Object.freeze({
        available: contentRect[mainDimension],
        trackAvailable: mainAvailable,
        used: main.used + owner.spacing.value,
        free: Math.max(0, contentRect[mainDimension] - main.used - owner.spacing.value),
        overflow: Math.max(0, main.used + owner.spacing.value - contentRect[mainDimension]),
      }),
      cross: Object.freeze(cross.map(({ free, overflow }) => Object.freeze({ free, overflow }))),
    }),
    children: Object.freeze(resultChildren),
    inputCoverage: 'known',
  });
}

function resolveSizeBand(value, dependencies, textMetricsIdentity) {
  if (!value || typeof value !== 'object' || !validProvenance(value.provenance)) {
    return { reason: 'unknown-size-band' };
  }
  const intrinsicResult = resolveIntrinsic(value.intrinsic, dependencies, textMetricsIdentity);
  if (intrinsicResult.reason) return intrinsicResult;
  const minimum = value.minimum;
  const preferred = value.preferred;
  const maximum = value.maximum === null ? Infinity : value.maximum;
  if (![minimum, preferred].every(nonNegativeInteger)
      || !(maximum === Infinity || nonNegativeInteger(maximum))) return { reason: 'unknown-size-band' };
  if (minimum > preferred || intrinsicResult.value > preferred || preferred > maximum) {
    return { reason: 'inconsistent-size-band' };
  }
  return {
    band: Object.freeze({
      intrinsic: intrinsicResult.value,
      minimum,
      preferred,
      maximum: maximum === Infinity ? null : maximum,
      provenance: Object.freeze({ ...value.provenance }),
    }),
  };
}

function resolveIntrinsic(value, dependencies, textMetricsIdentity) {
  if (nonNegativeInteger(value)) return { value };
  if (!value || value.kind !== 'text' || typeof value.text !== 'string'
      || typeof value.styleKey !== 'string' || !nonNegativeInteger(value.chrome ?? 0)) {
    return { reason: 'unknown-size-band' };
  }
  if (!validIdentity(textMetricsIdentity) || typeof dependencies.measureText !== 'function') {
    return { reason: 'missing-text-metrics' };
  }
  const measured = dependencies.measureText(Object.freeze({
    text: value.text,
    styleKey: value.styleKey,
    metricsId: textMetricsIdentity.id,
    metricsHash: textMetricsIdentity.hash,
  }));
  if (!Number.isFinite(measured) || measured < 0) return { reason: 'invalid-text-metrics' };
  // Intrinsic content must not clip: fractional advance is rounded outward once.
  return { value: Math.ceil(measured + (value.chrome ?? 0)) };
}

function track(child, axis) {
  const band = child.size[DIMENSION[axis]];
  return {
    minimum: band.minimum,
    preferred: band.preferred,
    maximum: band.maximum === null ? Infinity : band.maximum,
    stretch: child.stretch?.[axis] === true,
    compress: child.compress?.[axis] === true,
    growWeight: child.growWeight?.[axis] ?? 1,
    shrinkWeight: child.shrinkWeight?.[axis] ?? Math.max(1, band.preferred - band.minimum),
  };
}

function allocateSingleTrack(value, available) {
  const allocation = allocateIntegerAxis([value], available);
  return { size: allocation.sizes[0], free: allocation.free, overflow: allocation.overflow };
}

function allocateIntegerAxis(tracks, available) {
  const sizes = tracks.map((value) => value.preferred);
  let delta = available - sum(sizes);
  if (delta > 0) delta -= distribute(tracks, sizes, delta, 1);
  if (delta < 0) delta += distribute(tracks, sizes, -delta, -1);
  const used = sum(sizes);
  return Object.freeze({
    sizes: Object.freeze(sizes),
    used,
    free: Math.max(0, available - used),
    overflow: Math.max(0, used - available),
  });
}

function distribute(tracks, sizes, requested, direction) {
  let remaining = requested;
  let active = tracks.map((value, index) => ({ value, index })).filter(({ value }) => (
    direction > 0 ? value.stretch : value.compress
  ));
  while (remaining > 0 && active.length) {
    const weights = active.map(({ value }) => direction > 0 ? value.growWeight : value.shrinkWeight);
    if (weights.some((weight) => !Number.isFinite(weight) || weight <= 0)) break;
    const totalWeight = sum(weights);
    const grants = active.map((item, position) => {
      const limit = direction > 0
        ? item.value.maximum - sizes[item.index]
        : sizes[item.index] - item.value.minimum;
      const exact = remaining * weights[position] / totalWeight;
      return { ...item, exact, limit, pixels: Math.min(limit, Math.floor(exact)) };
    });
    let granted = sum(grants.map(({ pixels }) => pixels));
    grants.sort((left, right) =>
      (right.exact - Math.floor(right.exact)) - (left.exact - Math.floor(left.exact))
      || left.index - right.index);
    for (const grant of grants) {
      if (granted >= remaining) break;
      if (grant.limit > grant.pixels) { grant.pixels++; granted++; }
    }
    if (!granted) break;
    for (const grant of grants) sizes[grant.index] += direction * grant.pixels;
    remaining -= granted;
    active = active.filter(({ value, index }) => direction > 0
      ? sizes[index] < value.maximum
      : sizes[index] > value.minimum);
  }
  return requested - remaining;
}

function normalizeRect(value) {
  if (!value || !['x', 'y', 'width', 'height'].every((key) => nonNegativeInteger(value[key]))) return null;
  return { x: value.x, y: value.y, width: value.width, height: value.height };
}

function validProvenance(value) {
  return Boolean(value && SUPPORTED_SOURCE_KINDS.has(value.kind)
    && typeof value.source === 'string' && value.source.length > 0
    && value.kind !== 'post-layout-dom');
}

function validIdentity(value) {
  return Boolean(value && typeof value.id === 'string' && value.id
    && typeof value.hash === 'string' && value.hash);
}

const positiveInteger = (value) => Number.isInteger(value) && value > 0;
const nonNegativeInteger = (value) => Number.isInteger(value) && value >= 0;
const validOptionalWeight = (value) => value == null || (Number.isFinite(value) && value > 0);
const sum = (values) => values.reduce((total, value) => total + value, 0);
