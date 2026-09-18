# Shared fixed-pair layout contract

`fixed-pair-layout.mjs` is the DOM-free kernel for the frozen
`ordinary-fixed-axis-pair@1` pilot. It is exported by `1c-preview-core`, but is
not wired into the renderer and does not change the production default.

## Input boundary

The legacy parent allocates the owner's final `contentRect`. The shared owner
then allocates the two direct child outer rects. Each child remains a legacy
paint owner *inside* that rect. CSS or JavaScript must not allocate those same
outer rects when the shared path is eventually enabled.

Every owner, child, spacing value and size band carries provenance. Accepted
provenance identifies authored data, an authored/model default, a model-derived
value, or injected text metrics. A post-layout DOM measurement is not a valid
input. Missing provenance makes the whole owner `unsupported`; the result does
not contain partially allocated children.

## Size and allocation

For each axis a child supplies:

- `intrinsic`: content plus its own layout chrome, before parent free space;
- `minimum`: smallest permitted allocation;
- `preferred`: desired allocation before surplus or deficit distribution;
- `maximum`: finite upper bound, or `null` for no upper bound;
- `stretch`: permission to receive parent surplus;
- `compress`: permission to give up space down to `minimum`.

The invariants are `minimum <= preferred <= maximum` and
`intrinsic <= preferred`. `minimum` may exceed `intrinsic` when the platform's
interaction floor is larger than the content. Growth uses equal weight unless
a positive `growWeight` is supplied. Compression defaults to the child's
available compression range, which makes a pair reach both known minima at the
same time; a positive `shrinkWeight` can override it.
Unallocated surplus is reported as `free`; an unsatisfied deficit is reported
as `overflow` rather than violating a size band.

The main-axis default cadence is frozen at 10 px horizontal and 9 px vertical.
Only `start` cross alignment belongs to this pilot. Coordinates are integer
pixels local to `contentRect`; absolute coordinates are a translation by the
parent-provided rect. Fractional distribution is rounded once by largest
remainder, then stable authored order. Text advances are injected by identity
and rounded outward once so intrinsic content is not clipped.

## Explicit fallback

Responsive axes, projected subgrids, non-default spacing, cross alignment,
owner-drawn/generated children, unknown bands, missing text metrics and missing
source provenance return `{ status: "unsupported", geometryOwner: "legacy" }`
with a stable `fallbackReason`. The classifier therefore cannot silently infer
size bands from rendered DOM or mix shared positions with legacy widths.

`fixed-pair-model-adapter.mjs` is the shadow-only authored-model boundary. Its
classifier rejects Page/projected owners, responsive groups, `United=false`,
tables, command bars and painted group chrome as a whole-owner fallback. The
default size provider intentionally supports only explicit-width fixed-axis
field controls with explicit stretch semantics; every other control remains
unknown until an independent size provider is proven. Observed browser rects
are used only to compare results and to receive the legacy parent's final
content rect. They never become child intrinsic/minimum/preferred inputs.

The browser hook is absent unless `installFixedPairLayoutShadow(...,
{ enabled: true })` is called. Reports always say `mode: "shadow-only"` and
`geometryOwner: "legacy"`; the adapter never writes styles or attributes.
