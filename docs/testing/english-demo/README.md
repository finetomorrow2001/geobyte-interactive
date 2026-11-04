# English demo entry (2026-11-04)

Existing JA/EN dictionaries and `sdl-lang` storage are reused. The single
“日本語 | English” control now sits below the brand, before primary navigation.
Native buttons support Tab/Enter/Space, `aria-pressed`, visible focus and a 44 px
minimum height. It is reachable at the top on narrow screens as well.

Open `/imagery?lang=en` or `/field?lang=en`. Explicit `ja`/`en` wins over saved
preference, then browser language. Opening an explicit language link intentionally
saves that preference for later visits; the buttons also update the URL, preserving
all scene IDs, bbox, other parameters and fragment. Main navigation carries lang.
Changing language does not rerun image calculations or replace selected scenes.

Public Yubari South example (approximate public display extent, not a property or
trap boundary):

`/imagery?lang=en&item=S2B_54TWN_20261023_1_L2A&compare=S2C_54TWN_20261018_0_L2A&bbox=141.99,42.91,142.075,42.98`

Wait for both A/B “Imagery updated for the visible area”; source retrieval may take
up to several minutes. Select True color (TCI), NDVI vegetation, NDWI water or
NDMI moisture. For an annual demo choose Yubari South/North after the map is ready,
set the baseline/cloud/substitution conditions explicitly, then Find yearly scenes.
Acquisition dates use UTC; orbit/display-clock and pass-table times use JST (UTC+9).
The moving satellite clock is distinct from the image's acquisition time.

NDWI uses B3/B8; NDMI uses B8A/B11. Existing computation is unchanged. Greenness
is not edible forage or animal detection. Vegetation moisture does not establish
soil moisture or hiding cover. Point chart text now accurately describes existing
SCL/offset processing while keeping its single-location/quality limitations.
Tile-update status and acquisition legend stack in one caption container so their
English labels do not obscure each other.

Validation: 44 Node tests, zero Svelte errors/warnings, production-format build.
Claude Code Sonnet / medium performed focused read-only code reviews. Real
browser evidence is recorded in the adjacent acceptance file. No config/model
settings were written. Existing untracked test evidence was preserved.

Limitations: `/imagery` and `/field` choose the browser language before rendering
(client-only WebGL tools). Existing SSR learning pages can briefly show Japanese
before hydration on a direct English load; no global rendering rewrite is included.
Native browser date-picker chrome follows the OS/browser language. Place names,
OSM map labels and returned source/diagnostic text are not machine-translated.
Narrow-width tests are desktop browser emulation, not a physical phone/touch test.
Only public Sentinel-2 imagery/presets are used; no private location data or slides
are edited. Scientific screening limits and existing privacy rules remain.

Raster-quality follow-up: index tile jobs now forward the scene SCL asset and
`dnOffsetFor` correction to the existing worker. Available SCL excludes classes
0, 1, 3, 8, 9, 10 and 11 with nearest-neighbour sampling. Missing SCL is explicitly
warned for each A/B scene; an available asset that fails to load fails the tile
rather than silently returning unmasked imagery. Correction metadata that is
unknown retains the existing warning and offset-zero fallback. Composite images
remain unmasked and unchanged. SCL is a classification product, not ground truth;
continue to inspect true colour and independent point/area quality. NDSI also
uses this screening policy, so snow-classified pixels are transparent; use true
colour/SWIR and SCL quality for snow inspection. No animal or damage inference.
