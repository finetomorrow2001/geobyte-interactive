# Farm / natural-area study verification

2026-11-02. Base: main 13fb332. Implementation: /field, native full-resolution
COG samples, per-scene projection/reflectance validation, same-location deltas.

Automated: `npm test` 32/32; `npm run check` 0 errors / 0 warnings;
`npm run build` successful. CSV regression preserves negative NDWI/BSI values
as numbers and neutralizes formula-like untrusted strings separately.

## Independent Claude Code Desktop browser QA

Four review rounds; Claude did not edit application code. Technical results:

- Brackenridge, three dates in Sep–Oct 2025: 2112/2112 valid locations per date;
  NDVI medians .642 / .620 / .567. Pair 09-02 → 10-12: median -.042, mean -.046.
- Texas image overlay and existing A/B viewer align with river/road landmarks.
  No fallback to Japan's UTM zone. Each scene uses its actual projection.
- Multipart + hole: 1150 locations. Independent count discrepancy explained by
  excluding points exactly on a hole boundary; this rule is now stated JA/EN.
- Uonuma 09-06 / 09-26 / 10-23: 2162/2304 / 0/2304 / 2304/2304 valid.
  Cloud-only scene and zero-valid pair are missing, never numerical zero.
- Range switch clears stale search/results. Cancellation stops the worker.
- File import strips properties, accepts valid Polygon/MultiPolygon; two-click
  rectangle applies correctly. Actual x/y grid spacing is visible.
- Time axis uses acquisition dates. Median + spatial IQR (not confidence interval),
  auto y range. Differential color reference is explicitly ±.1 without truncating
  saved measurements. Small changes remain visible.
- Final live CSV export: three real Brackenridge scenes, negative NDWI median
  approximately -.5659 remains numeric in median/mean/q1/q3; no apostrophes.
  Quality share/acceptance are exported; insufficient-quality scene stats blank.
- English hole-boundary legend and document language verified after final fix.

## Real-data smoke, separate from browser QA

`scripts/verify-field-data.mjs` reproduces HTTP STAC + native COG sampling.
`FIELD_DATA_SMOKE.json` contains public reference coordinates and sample arrays:

| Area / scene | UTM | Valid / total | NDVI median |
|---|---:|---:|---:|
| Austin 2025-10-30 | 14N | 576/576 | .634558 |
| Austin 2025-10-27 | 14N | 420/576 | .461798 |
| Uonuma 2025-10-23 | 54N | 576/576 | .515372 |
| Uonuma 2025-09-06 | 54N | 541/576 | .530146 |

Uncached source analysis took about 34–41 seconds per scene in the Node run;
independent browser QA observed about 20 seconds per scene. These are observed
runs, not a benchmark or promised loading time.

## Remaining limits

No independent real-device mobile sign-off. A responsive chart keeps text sizes
and reduces date labels at narrow widths, but this needs device review. Live 15N
and pre-2022 offset browser comparisons remain untested; pure unit coverage exists.
The inherited initial language hydration flash remains possible. Duplicate STAC
items are not grouped; IDs and acquisition times remain visible.

No owner-approved Austin farm boundary, field damage labels, drone acquisition,
causal damage validation, QHC production integration, or production deployment was
performed. Study presets are approximate public-location examples, not property
boundaries, damage sites, or access permission.
