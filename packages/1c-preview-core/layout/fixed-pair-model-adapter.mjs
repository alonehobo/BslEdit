import { FIXED_PAIR_SCOPE_VERSION, layoutFixedPair } from './fixed-pair-layout.mjs';

export const FIXED_PAIR_SHADOW_SCHEMA = 'tc-bsl-viewer/fixed-pair-shadow@1';

const GROUP_TAGS = new Set(['UsualGroup', 'Group']);
const FORBIDDEN_TAGS = new Set(['Pages', 'Page', 'Table', 'CommandBar', 'AutoCommandBar', 'ButtonGroup']);
const ADDITION_TAG = /(?:Addition|ExtTooltip|ContextMenu)$/i;
const FIELD_TAGS = new Set(['InputField', 'LabelField', 'ValueList']);
const PROFILE = Object.freeze({ fieldCharPx: 10, fieldChromePx: 10, rowPx: 25, compressedFieldMinPx: 71 });

const authored = (source) => Object.freeze({ kind: 'authored', source });
const authoredDefault = (source) => Object.freeze({ kind: 'authored-default', source });
const modelDefault = (source) => Object.freeze({ kind: 'model-default', source });
const modelDerived = (source) => Object.freeze({ kind: 'model-derived', source });

/**
 * Adapt authored FormPreview model nodes to the frozen fixed-pair contract.
 * No DOM value is read here. The only geometry supplied by the caller is the
 * final owner content rect allocated by the legacy parent boundary.
 */
export function adaptFormModelFixedPairs(formModel, options = {}) {
  const viewport = normalizeViewport(options.viewport);
  const profile = normalizeIdentity(options.profile);
  const textMetrics = options.textMetrics == null ? null : normalizeIdentity(options.textMetrics);
  const resolveChildContract = options.resolveChildContract || resolveFixedControlSizeFromModel;
  const contentRectFor = typeof options.contentRectFor === 'function' ? options.contentRectFor : () => null;
  const entries = [];

  walk(formModel, [], (owner, ancestors) => {
    if (!GROUP_TAGS.has(owner?.tag)) return;
    const ownerId = itemId(owner);
    const classified = classifyOwner(owner, ancestors);
    if (classified.reason) {
      entries.push(unsupported(ownerId, classified.reason));
      return;
    }
    const children = visibleChildren(owner);
    const adaptedChildren = [];
    for (let order = 0; order < children.length; order++) {
      const child = children[order];
      const contract = resolveChildContract(child, Object.freeze({
        owner, axis: classified.axis, profile, textMetrics, order,
      }));
      if (!contract || contract.status === 'unsupported') {
        entries.push(unsupported(ownerId, contract?.reason || 'unknown-size-band', { childId: itemId(child) }));
        return;
      }
      adaptedChildren.push({
        id: itemId(child), order,
        provenance: authored(sourcePath(child, 'node')),
        generated: false, ownerDrawn: false, ownerKind: 'legacy-paint',
        widthDependent: contract.widthDependent === true,
        responsive: contract.responsive === true,
        size: contract.size,
        stretch: contract.stretch,
        compress: contract.compress,
        growWeight: contract.growWeight,
        shrinkWeight: contract.shrinkWeight,
        baseline: contract.baseline ?? null,
      });
    }
    const contentRect = normalizeRect(contentRectFor(owner, { ownerId, ancestors }));
    entries.push(Object.freeze({
      status: 'candidate', ownerId,
      input: Object.freeze({
        viewport, profile, textMetrics,
        owner: Object.freeze({
          id: ownerId,
          provenance: authored(sourcePath(owner, 'node')),
          sourceTag: owner.tag,
          behavior: 'Usual', representation: 'None', showTitle: false, united: true,
          ownerKind: 'authored', axis: classified.axis,
          axisProvenance: classified.axisProvenance,
          spacing: Object.freeze({ value: classified.axis === 'horizontal' ? 10 : 9, provenance: classified.spacingProvenance }),
          responsive: false, widthDependent: false, throughAlign: false,
          projectedSubgrid: false, crossAlign: 'start', chrome: false, background: false,
          contentRect,
        }),
        children: Object.freeze(adaptedChildren),
      }),
    }));
  });
  return Object.freeze(entries);
}

/** A deliberately narrow independent size provider for the pilot. */
export function resolveFixedControlSizeFromModel(item, context = {}) {
  const tag = String(item?.tag || '');
  if (context.profile?.id !== 'taxi-96' || !context.profile?.hash) {
    return { status: 'unsupported', reason: 'unknown-profile' };
  }
  if (!FIELD_TAGS.has(tag)) return { status: 'unsupported', reason: 'unknown-size-band' };
  const widthChars = positiveInt(readProp(item, ['Width', 'Ширина']));
  if (!widthChars) return { status: 'unsupported', reason: 'unknown-size-band' };
  if (tag === 'InputField' && hasEditorChrome(item)) return { status: 'unsupported', reason: 'owner-drawn-child' };
  const heightRows = positiveInt(readProp(item, ['Height', 'Высота']));
  const preferredWidth = widthChars * PROFILE.fieldCharPx + PROFILE.fieldChromePx;
  const preferredHeight = heightRows ? heightRows * 30 - 5 : PROFILE.rowPx;
  const h = explicitBoolean(item, ['HorizontalStretch', 'ГоризонтальноеРастягивание']);
  const v = explicitBoolean(item, ['VerticalStretch', 'ВертикальноеРастягивание']);
  if (h == null || v == null) return { status: 'unsupported', reason: 'unknown-size-band' };
  const band = (intrinsic, minimum, preferred, maximum, source) => Object.freeze({
    intrinsic, minimum, preferred, maximum,
    provenance: modelDerived(source),
  });
  return Object.freeze({
    status: 'supported',
    size: Object.freeze({
      width: band(preferredWidth, h ? Math.min(preferredWidth, PROFILE.compressedFieldMinPx) : preferredWidth,
        preferredWidth, h ? null : preferredWidth, `${sourcePath(item, 'Width')} + taxi-96 field metric`),
      height: band(preferredHeight, v ? PROFILE.rowPx : preferredHeight,
        preferredHeight, v ? null : preferredHeight, heightRows
          ? `${sourcePath(item, 'Height')} + taxi-96 row metric`
          : 'taxi-96 authored/model default field height'),
    }),
    stretch: Object.freeze({ horizontal: h, vertical: v }),
    compress: Object.freeze({ horizontal: h, vertical: v }),
    baseline: null,
  });
}

/** Run the pilot beside the renderer. Observations are comparison-only. */
export function runFixedPairLayoutShadow(formModel, options = {}) {
  const observed = normalizeObserved(options.observedBounds);
  const entries = adaptFormModelFixedPairs(formModel, options).map((entry) => {
    if (entry.status !== 'candidate') return reportFallback(entry, observed, options);
    const result = layoutFixedPair(entry.input, { measureText: options.measureText });
    if (result.status !== 'supported') return reportFallback(result, observed, options);
    const ownerLegacy = observed.get(entry.ownerId) || null;
    const children = result.children.map((child) => {
      const legacyRect = observed.get(child.id) || null;
      const sharedRect = child.allocated.absolute;
      return Object.freeze({ id: child.id, legacyRect, sharedRect, delta: legacyRect ? delta(legacyRect, sharedRect) : null });
    });
    return Object.freeze({
      scopeVersion: FIXED_PAIR_SCOPE_VERSION, ownerId: entry.ownerId,
      classifier: 'supported', inputCoverage: 'known', geometryOwner: 'legacy',
      legacyOwnerRect: ownerLegacy, sharedOwnerRect: result.ownerRect.absolute,
      children: Object.freeze(children),
      firstDivergence: firstDivergence(children, options.tolerancePx ?? 1),
      fallbackReason: null,
      profileHash: entry.input.profile.hash,
      textMetricsHash: entry.input.textMetrics?.hash ?? null,
    });
  });
  return Object.freeze({
    schema: FIXED_PAIR_SHADOW_SCHEMA,
    mode: 'shadow-only', mutatesDom: false, geometryOwner: 'legacy',
    ownerCount: entries.length,
    supportedOwnerCount: entries.filter((entry) => entry.classifier === 'supported').length,
    entries: Object.freeze(entries),
  });
}

/** Install only when the caller explicitly enables this dev/test shadow. */
export function installFixedPairLayoutShadow(target = globalThis, options = {}) {
  if (options.enabled !== true) return null;
  const hook = Object.freeze({
    run({ model, body }) {
      const snapshot = observeBody(body);
      const report = runFixedPairLayoutShadow(model, {
        ...options,
        viewport: options.viewport || snapshot.viewport,
        observedBounds: snapshot.bounds,
        contentRectFor(owner) { return snapshot.contentRects.get(itemId(owner)) || null; },
      });
      target.__tcBslViewerFixedPairShadowReport = report;
      return report;
    },
  });
  target.__TC_BSL_FIXED_PAIR_SHADOW__ = true;
  target.FixedPairLayoutShadow = hook;
  return hook;
}

function classifyOwner(owner, ancestors) {
  if (ancestors.some((item) => FORBIDDEN_TAGS.has(item?.tag))) return { reason: 'projected-subgrid' };
  if (ancestors.some((item) => isFalse(readProp(item, ['United', 'Объединять'])))) return { reason: 'projected-subgrid' };
  if (!isUsual(readProp(owner, ['Behavior', 'Поведение']))) return { reason: 'unsupported-owner-kind' };
  if (!isNone(readProp(owner, ['Representation', 'Отображение']))) return { reason: 'owner-chrome' };
  if (!isFalse(readProp(owner, ['ShowTitle', 'ПоказыватьЗаголовок']))) return { reason: 'owner-chrome' };
  if (isFalse(readProp(owner, ['United', 'Объединять']))) return { reason: 'unsupported-owner-kind' };
  if (usesThroughAlign(readProp(owner, ['ThroughAlign', 'СквозноеВыравнивание']))) return { reason: 'projected-subgrid' };
  if (hasOwnerChrome(owner)) return { reason: 'owner-chrome' };
  const rawAxis = normalized(readProp(owner, ['Group', 'GroupOrientation', 'Orientation', 'Layout', 'Группировка', 'Ориентация']));
  if (rawAxis.includes('horizontalifpossible') || rawAxis.includes('screensensitive')) return { reason: 'responsive-group' };
  const axis = rawAxis === 'vertical' || rawAxis.includes('вертик') ? 'vertical'
    : (rawAxis === 'horizontal' || rawAxis === 'alwayshorizontal' || rawAxis.includes('горизонт')) ? 'horizontal' : null;
  if (!axis) return { reason: 'unsupported-axis' };
  const spacingRaw = readProp(owner, axis === 'horizontal'
    ? ['HorizontalSpacing', 'ГоризонтальныйИнтервал'] : ['VerticalSpacing', 'ВертикальныйИнтервал']);
  if (spacingRaw && !isSingle(spacingRaw)) return { reason: 'non-default-spacing' };
  const cross = readProp(owner, axis === 'horizontal'
    ? ['VerticalAlign', 'ВертикальноеВыравнивание'] : ['HorizontalAlign', 'ГоризонтальноеВыравнивание']);
  if (cross && !isStart(cross)) return { reason: 'cross-alignment' };
  const children = visibleChildren(owner);
  if (children.length !== 2) return { reason: 'unsupported-child-count' };
  if (children.some((child) => FORBIDDEN_TAGS.has(child.tag) || ADDITION_TAG.test(child.tag || ''))) {
    return { reason: 'owner-drawn-child' };
  }
  return {
    axis,
    axisProvenance: rawAxis ? 'authored-explicit' : 'model-default',
    spacingProvenance: spacingRaw ? authoredDefault(sourcePath(owner, axis === 'horizontal' ? 'HorizontalSpacing' : 'VerticalSpacing'))
      : modelDefault(`Taxi.Single ${axis} cadence`),
  };
}

function reportFallback(entry, observed, options) {
  return Object.freeze({
    scopeVersion: FIXED_PAIR_SCOPE_VERSION, ownerId: entry.ownerId ?? null,
    classifier: 'unsupported', inputCoverage: 'unknown', geometryOwner: 'legacy',
    legacyOwnerRect: observed?.get(String(entry.ownerId ?? '')) || null,
    sharedOwnerRect: null, children: Object.freeze([]),
    firstDivergence: null, fallbackReason: entry.fallbackReason || entry.reason || 'unsupported',
    profileHash: options?.profile?.hash ?? null,
    textMetricsHash: options?.textMetrics?.hash ?? null,
  });
}

function unsupported(ownerId, reason, details = {}) {
  return Object.freeze({ status: 'unsupported', ownerId, fallbackReason: reason, ...details });
}

function observeBody(body) {
  if (!body || typeof body.getBoundingClientRect !== 'function' || typeof body.querySelectorAll !== 'function') {
    return { viewport: { width: 1, height: 1 }, bounds: [], contentRects: new Map() };
  }
  const root = body.getBoundingClientRect();
  const bounds = [];
  const contentRects = new Map();
  for (const element of body.querySelectorAll('[data-id]')) {
    const id = element.getAttribute('data-id');
    if (!id || typeof element.getBoundingClientRect !== 'function') continue;
    const rect = relativeRect(element.getBoundingClientRect(), root);
    bounds.push({ id, bounds: rect });
    const content = typeof element.querySelector === 'function' ? element.querySelector('.fp-children') : null;
    if (content && typeof content.getBoundingClientRect === 'function') contentRects.set(id, relativeRect(content.getBoundingClientRect(), root));
  }
  return {
    viewport: { width: Math.max(1, Math.round(body.clientWidth || root.width)), height: Math.max(1, Math.round(body.clientHeight || root.height)) },
    bounds, contentRects,
  };
}

function walk(node, ancestors, visit) {
  if (!node || typeof node !== 'object') return;
  visit(node, ancestors);
  for (const child of node.childItems || []) walk(child, [...ancestors, node], visit);
}

function visibleChildren(owner) {
  return (owner?.childItems || []).filter((child) => child && !isFalse(readProp(child, ['Visible', 'visible'])) && !ADDITION_TAG.test(child.tag || ''));
}

function hasEditorChrome(item) {
  return ['ChoiceButton', 'DropListButton', 'ClearButton', 'CreateButton', 'OpenButton', 'SpinButton', 'CalendarButton']
    .some((name) => !isFalse(readProp(item, [name])) && readProp(item, [name]) !== '');
}

function hasOwnerChrome(item) {
  return Boolean(readProp(item, ['BackColor', 'ЦветФона', 'BorderColor', 'BorderStyle', 'Picture', 'Картинка']));
}

function normalizeObserved(values) {
  return new Map((values || []).map((entry) => [String(entry.id), normalizeRect(entry.bounds)]).filter((entry) => entry[1]));
}

function delta(actual, expected) {
  return Object.freeze(Object.fromEntries(['x', 'y', 'width', 'height'].map((key) => [key, actual[key] - expected[key]])));
}

function firstDivergence(children, tolerance) {
  for (const child of children) if (child.delta) for (const axis of ['x', 'y', 'width', 'height']) {
    if (Math.abs(child.delta[axis]) > tolerance) return Object.freeze({ id: child.id, property: axis, delta: child.delta[axis] });
  }
  return null;
}

function relativeRect(rect, root) {
  return normalizeRect({ x: Math.round(rect.left - root.left), y: Math.round(rect.top - root.top), width: Math.round(rect.width), height: Math.round(rect.height) });
}

function normalizeRect(value) {
  if (!value || !['x', 'y', 'width', 'height'].every((key) => Number.isInteger(value[key]) && value[key] >= 0)) return null;
  return Object.freeze({ x: value.x, y: value.y, width: value.width, height: value.height });
}

function normalizeViewport(value) {
  if (!value || !Number.isInteger(value.width) || value.width <= 0 || !Number.isInteger(value.height) || value.height <= 0) return null;
  return Object.freeze({ width: value.width, height: value.height });
}

function normalizeIdentity(value) {
  if (!value || typeof value.id !== 'string' || !value.id || typeof value.hash !== 'string' || !value.hash) return null;
  return Object.freeze({ id: value.id, hash: value.hash });
}

function properties(item) {
  const result = new Map();
  for (const [key, value] of Object.entries(item?.properties || {})) result.set(normalized(key), String(value).trim());
  return result;
}

function readProp(item, aliases) {
  const map = properties(item);
  for (const alias of aliases) if (map.has(normalized(alias)) && map.get(normalized(alias))) return map.get(normalized(alias));
  return '';
}

function explicitBoolean(item, aliases) {
  const value = readProp(item, aliases);
  if (!value) return null;
  if (isFalse(value)) return false;
  const key = normalized(value);
  return key === 'true' || key === '1' || key === 'yes' || key === 'да' ? true : null;
}

function itemId(item) { return String(item?.id ?? item?.name ?? ''); }
function sourcePath(item, property) { return `FormModel:${itemId(item)}.${property}`; }
function positiveInt(value) { const number = Number.parseInt(value, 10); return number > 0 ? number : 0; }
function normalized(value) { return String(value || '').toLowerCase().replace(/[^a-z0-9а-яё]/gi, ''); }
function isFalse(value) { return ['false', '0', 'нет', 'no'].includes(normalized(value)); }
function isUsual(value) { const key = normalized(value); return !key || key === 'usual' || key === 'обычное'; }
function isNone(value) { const key = normalized(value); return !key || key === 'none' || key === 'нет'; }
function isSingle(value) { const key = normalized(value); return key === 'single' || key === 'одинарный'; }
function isStart(value) { const key = normalized(value); return !key || ['left', 'top', 'start', 'лево', 'верх'].includes(key); }
function usesThroughAlign(value) { const key = normalized(value); return key && !['dontuse', 'none', 'неиспользовать'].includes(key); }
