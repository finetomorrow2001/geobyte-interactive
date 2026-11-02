# Farm / natural-area study verification

2026-11-02. Base: main 13fb332. Implementation: /field, native full-resolution
COG samples, per-scene projection/reflectance validation, same-location deltas.

Automated: `npm test` 33/33; `npm run check` 0 errors / 0 warnings;
`npm run build` successful. CSV regression preserves negative NDWI/BSI values
as numbers and neutralizes formula-like untrusted strings separately.

## Independent Claude Code Desktop browser QA

Seven review rounds; Claude did not edit application code. Technical results:

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

## Additional acceptance, 2026-11-02

- Four real zone-15 scenes across 15RTQ/15RTP completed in Claude's browser,
  2256/2256 valid samples each. Same-date medians agree across overlapping tiles.
- Four Austin 2021 records exercised original baseline 03.01 (offset not applied)
  and reprocessed 05.00 (offset already applied). Both correctly use offset zero.
  Same-acquisition NDVI medians differ by .006 / .011; SCL masks can differ.
- `FIELD_REMAINING_SMOKE.json` retains the separate native-COG runs for 15N
  and 2021. `FIELD_INDEPENDENT_CHECK.json` compares proj4 2.22.0 coordinates,
  direct GeoTIFF windows and independent arithmetic against app indices: four
  public-scene sample checks, maximum index error zero. It shares the GeoTIFF
  decoder; it is not an independent decoder validation. Reproduce with
  `node scripts/verify-field-independent.mjs /path/to/proj4-2.22.0.cjs`.
- Identical acquisition timestamps are marked in the scene list, and a JA/EN
  warning explains reprocessing/tile differences must not be called time change.
  Results rows expose the full scene ID rather than only the timestamp.
- Fixed the min-content grid sizing that expanded the whole page to 795 px.
  With real analysis results: innerWidth/clientWidth/scrollWidth all equal
  375/375/375, 390/390/390, 768/768/768, and 1280/1280/1280. Wide tables scroll
  inside their wrappers. Chart/map/selection, geometry drawing and exports work.
  Shared-layout checks of home, spectral and imagery also have no page overflow.
- Cancel is a neutral status message, clears partial work and re-enables analysis.
  Final-build 375 px analysis and cancellation were independently rechecked.
- Saved JA/EN reloads showed no wrong-language frame; document language matches.
  /field renders client-side after selecting language. localStorage get/set
  failures are guarded; storage-disabled startup remains source-reviewed only.
- JSON exports retain explicitly labeled boundary/notes and scene provenance;
  CSV negatives remain numeric. No private test notes are committed here.

## Remaining limits

Mobile measurements are browser iframe emulation, not a phone, iOS Simulator,
mobile Safari, touch-input or safe-area sign-off. No independent storage-disabled
browser startup test. Duplicate records remain separate, explicitly labeled.

No owner-approved Austin farm boundary, field damage labels, drone acquisition,
causal damage validation or QHC production integration was performed. Study
presets are approximate public-location examples, not property boundaries,
damage sites or access permission. Production smoke is recorded separately
when the reviewed PR is merged and deployed.
