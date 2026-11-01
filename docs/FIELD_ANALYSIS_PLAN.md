# Austin farm and natural-area analysis — 2026-11-01

Status: implementation and independent Claude Code Desktop review in progress.
Owner: Codex (code); Claude Code Desktop (design/science review and independent tests).
Isolated worktree: satellite-field-lab, feat/austin-field-analysis, origin/main 13fb332.
Existing cache PR #13 and untracked evidence are preserved in the original checkout.

## Scope and stages
1. Verify QHC/A2 context and primary public sources; distinguish prospects, public
   study locations and actual reported damage. Never disclose real trap locations.
2. Add a farm/natural-area workspace at /field: user-supplied WGS84 Polygon or
   MultiPolygon (holes retained), bounded AOI, outline on map, local-only notes.
3. Search real Sentinel-2 scenes by AOI bounding box and date; explicitly page
   results and record selected scenes. Provide 3-date-or-more area time series,
   two-date per-location differences and quality/coverage statistics.
4. Sample the same deterministic grid within the polygon at each date using
   full-resolution nearest source values, correct UTM metadata, BOA correction,
   SCL masking, NDVI / NDMI / NDWI / BSI. Null is missing, never zero damage.
   Pair changes use only locations valid at both dates. A grid is a sample, not
   exact damaged hectares or a count of independent satellite pixels.
5. Add linked imagery navigation so the existing A/B, 3D and time-series viewer
   can inspect the selected AOI globally, including Texas UTM zone 14N.
6. Verify geometry/masks/quality/offsets/date pairing, Uonuma regression, actual
   Texas STAC/raster access, bilingual UI and production build. Claude independently
   reviews code/tests; findings must be resolved or explicitly documented.

## Interpretation and privacy
Sentinel-2 cannot identify individual pigs or prove their causal responsibility.
Vegetation loss, moisture or bare-soil changes can also reflect harvesting,
drought, flooding, fire or clouds. Pair with field reports, photographs, dates,
management records and higher-resolution drone imagery. No automated hog
probability, damage cost or exact damaged area is claimed.
Imported boundaries and observations are not saved to a server. STAC receives
AOI bounding boxes only when the user requests search; COG sources receive the
necessary byte requests only during analysis. Export JSON/CSV on user action.
No QHC production DB edits, contacts/messages, deployments or cache-PR merge.

## Public reference locations and evidence
UT Austin field-station network: https://fieldstations.utexas.edu/field-stations
Brackenridge Field Laboratory includes prairie, riparian and woodland habitats;
UT Stengl Lost Pines is in Bastrop County, east of Austin. These are study
locations, not confirmed feral-hog-damage farms or permission to enter.
Austin Water conservation: https://www.austintexas.gov/water/wildland-conservation
Texas research: https://lair.etamu.edu/etd/1093/ (2023 UAV/ground-truth study).
Boundary presets are explicitly approximate demonstration rectangles; a real
farm requires an owner-approved boundary and independently confirmed observations.

## Implemented sampling choices / review resolutions
- `proj:code` takes precedence over `proj:epsg`; unknown or non-UTM metadata fails
  closed. Each scene uses its own zone (14N, 15N, 54N regression tests).
- Fixed regular longitude/latitude AOI grid, with approximate local spacing ≥20m,
  at most 96 rows/columns. This is a sampling design, not equal-area integration.
  No damaged hectares or independent-pixel sample counts are reported. A future
  area estimator would require a projected lattice and edge/fractional coverage.
- Native 10/20m nearest source samples preserve DN precision. A sample is valid
  only with all five bands and a valid SCL; dark SCL=2 is counted separately.
  Scenes with unknown BOA correction are rejected. No thin-cloud dilation is
  implemented; boundary, cloud and geolocation limitations are explicit in UI.
- Pair minimum 30 valid locations and ≥50% AOI coverage. Median, mean and IQR of
  paired differences; variable per-date validity disclosed in the time series.
  Chart x axis is acquisition time, without interpolation or clipping values.
- Geometry rejected when self-crossing, with touching/overlapping holes/shells,
  too-small sampled extent, >1000 vertices, or >20km in either dimension.
- On cancellation workers are terminated and pending jobs rejected; new search,
  AOI or grid invalidates old analysis. No implicit persistence of private AOIs.

## Validation completed (2026-11-02)
- 32 native Node tests pass; Svelte check: 0 errors / 0 warnings; production build passes.
- Live Earth Search + native COG smoke: Austin 14N and Uonuma 54N, two scenes
  each; source/sample results are in FIELD_DATA_SMOKE.json. This is not browser QA.
- Independent Claude Desktop browser rounds 2–4: Texas image alignment, AOI
  holes/multipart, three-date graph, common-valid differences, Uonuma cloud-only
  missing scene, cancellation/range invalidation, JA/EN, file import, rectangle,
  and CSV. Final fixes preserve negative numeric CSV cells and document hole edges
  in English. `<html lang>` follows the active language.
- Limits: mobile-device layout not independently signed off; 15N and offset paths
  have unit coverage but not a separate live browser scene. No animal detection,
  causal model, exact damage area, or production deployment is claimed.
