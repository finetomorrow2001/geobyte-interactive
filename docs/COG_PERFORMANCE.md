# COG loading performance

## Cause and implementation

Opening a COG enumerates its overview IFDs sequentially. The original uncached
RemoteSource fetches overlapping small header ranges separately, multiplying
network round trips across 2–4 workers and A/B scenes.

The final implementation uses a public geotiff BaseClient adapter to share only
the first 64 KiB of each immutable COG. All pixel requests keep their exact byte
ranges. HTTP Range support is required; whole-file responses are rejected.
The existing 24-entry COG metadata limit bounds retained header prefixes at
1.5 MiB per worker. Failed prefix requests retry, and callers cannot abort a
shared prefix read needed by another caller.

Decoded internal tiles use a 120-entry LRU per worker instead of a tile-count FIFO.
Intermediate 32 MiB and 128 MiB byte caps were removed after browser timing
showed warm/rotation slowdowns: byte caps can reduce the original 120-tile
working set. The final version preserves the existing count limit.
Pending reads are stored separately so cache pressure cannot discard shared
in-flight requests and cause duplicate reads. Failed reads are removed for retry.
Resolution selection, reprojection, sample values, nodata and colormaps are unchanged.
Canceled MapLibre requests still can finish in workers; canceling shared reads
requires separate ownership handling and is outside this change.

## Rejected intermediate implementation

Commit d950cf0 enabled geotiff's general 64 KiB block LRU with 16 blocks per COG.
The real browser comparison failed with image acquisition errors and increased
transfer under concurrent reads. Its null/Infinity speedup is invalid. It has
been replaced by the header-only adapter; those measurements cannot establish
performance or regression acceptance of the final implementation.

## Reproducible isolated measurement

Run `node scripts/benchmark-cog-range.mjs` from the repository root. It reads a
public Sentinel-2 TCI COG without/with header caching in interleaved order,
three trials per variant, reads an overview internal tile twice, and records
request count, response Content-Length totals, timings and pixel hashes under
`docs/testing/cog-range-benchmark.json`.

2026-10-25 JST, S2B_54TWN_20261023_1_L2A, local Node measurement:

| Median | Before | Header cache |
| --- | ---: | ---: |
| Header time | 3066 ms | 278 ms |
| Header requests | 12 | 1 |
| Total time (headers + two reads) | 3965 ms | 2676 ms |
| Total requests | 14 | 3 |
| Response bytes | 983446 | 1042660 |

All six trials produced the same SHA-256 pixel hash. This is one COG path,
not whole-map latency. The prefix adds 58 KiB compared with small header reads;
large pixel reads are not expanded. The application also shares decoded tiles,
whereas this isolated benchmark intentionally reads the same raster twice.
Browser before/after validation of the final version is pending.

The first header-adapter trial also exposed a browser-only CORS difference:
S3 can return HTTP 206 while hiding Content-Range from JavaScript. The adapter
now accepts bounded 206 bodies without that optional header, matching the
original geotiff behavior. A regression test covers this browser condition.

## Automated checks

`npm test` includes cache sharing, in-flight retention under eviction pressure,
tile-count eviction, failed-request retry, 40 concurrent header/pixel reads,
abort handling and full-file response rejection.
`npm run check` and `npm run build` also pass.

## Browser acceptance (2026-10-25 JST)

Antigravity exercised Yubari South/North and Uonuma with TCI and NDVI. All six
regional/mode combinations completed imagery loading and A/B camera sync.
At identical initial poses (bearing 0, pitch 60), clear canvas ROI differences
were 0%, except 0.001% in one Yubari North TCI ROI. Fixed 0/15-degree compass
captures also had 0% clear-ROI difference. UI/time changes and screenshots at
different inertial drag bearings are not imagery pixel regressions.

Intermediate byte-cap candidates produced warm/rotation slowdowns and were
rejected. Final source f7a6121 preserves the baseline 120 completed tiles per
worker, separating pending requests and refreshing LRU hits. Its final preview
acceptance covered the previously problematic conditions:

| Comparable measurement | Baseline | Final preview |
| --- | ---: | ---: |
| Yubari North TCI initial load (single trial) | 64677 ms | 51901 ms |
| Yubari North TCI first fixed 0→15° rotation | 11082 ms | 10841 ms |
| Yubari North TCI first fixed 15→0° return | 80 ms | 77 ms |
| Uonuma NDVI initial load | 41243 ms reference | 40686 ms median of 3 |

The final Uonuma initial trials were 55925, 35495 and 40686 ms. All final
Yubari North 3 round trips and Uonuma 3 warm operations completed with sync.
The final North second/third forward rotations took 95/503 ms, and Uonuma
warm fixed-angle operations took 106/85/78 ms before the additional 500 ms
stability verification. These warm timings must not be divided by a baseline
first-load or a different Ctrl-drag angle to advertise a speedup.

Earlier same-source header-cache probes showed larger initial-load savings,
including Yubari South NDVI 94507→70639 ms and Uonuma TCI 47313→20074 ms;
these used an intermediate cache-cap configuration and are not final-version
benchmark guarantees. External transfer and tile decoding still take tens of
seconds in some cases. No universal all-operations speedup is claimed.

Raw browser JSON and screenshots are retained locally under
`docs/testing/cog-perf-benchmark/`, including `full_comparison_report_v4.json`,
`preview_compass_verification.json`, `final_yubari_north_tci_compass.json` and
`final_uonuma_ndvi_compass.json`. The six-condition image tests preceded the
final cache-cap removal; the final change affects retention, not sampling or
rendering math. Final source unit tests: 25 passed; typecheck/build passed.

## NDVI worker locality follow-up

The PR #12 production smoke test recorded 103279 ms for Yubari South NDVI.
That observation is not a controlled before/after baseline: S3 transfer time
varies between runs. The follow-up compares the deployed main build (13fb332)
with a production-format preview at identical coordinates, scenes and camera.

The previous 2×2 spatial dispatcher spread a single index scene across workers.
Each worker owns its own COG metadata, in-flight reads and decoded-block cache;
therefore the same red/NIR internal blocks were fetched and decoded repeatedly.
Index tiles now have bounded, stable scene ownership (64 scene IDs, LRU).
Consecutive newly encountered scenes use successive worker slots. This preserves
parallel work across scenes while sharing overlapping blocks within a scene.
Composite routing and all existing worker/cache limits are unchanged.

There is no change to overview selection, output dimensions, reprojection,
sampling, nodata, reflectance, normalized-difference calculations or colormaps.
The emitted COG worker is byte-identical to PR #12: cog.worker-Da6-qhJb.js,
SHA-256 69b49e25d35169c80cf0eeb245ca57b7a2718806a189e70994d2bf021ab7c2ca.
Dispatcher tests check unchanged operands, coordinates, gain and output size,
and confirm that composite tiles retain their previous worker assignment.

The first Antigravity profile confirmed 60 duplicate B04/B08 URL+Range requests
across workers before the change, and zero afterward. B04/B08 transfer fell
from 104119619 to 56305092 encoded bytes (152 to 92 requests). Both variants
requested the same unique ranges. The full page also initially loads TCI;
those unrelated requests are excluded from these NDVI-only figures.

COG-worker active CPU samples were approximately 4475 ms before and 3092 ms
after, across all COG workers. Most function names are minified, so a reliable
decode/reprojection/composition breakdown is unavailable. These parallel CPU
samples are not wall-clock durations and must not be added to network time.
This supports redundant transfer as an actionable cause; it does not attribute
every millisecond of the historical 103-second observation to that cause.
In that profile, the union of B04/B08 request intervals was 37905 ms before
and 18679 ms after (no gap between the first request and last response).
This is the period with at least one outstanding NDVI request, including
queueing and transfer; it is not a sum of overlapping request durations.

Profile conditions: fresh browser profile, HTTP cache disabled, viewport
1280×937 at DPR 1; Yubari South 142.0325,42.94500994955; zoom
11.803098014100842, pitch 60°, bearing 0°. Scene A is
S2B_54TWN_20261023_1_L2A and B is S2C_54TWN_20261018_0_L2A.
After selecting NDVI and those scenes, completion requires both imagery
statuses, no loading overlay, synchronized stationary cameras, at least two
animation frames and a further 500 ms of stable state (120 s test deadline).
The reported settled time excludes the final 500 ms verification window.
Rotation comparisons use compass keyboard steps 0→15→0°, avoiding variable
Ctrl-drag inertia. Pure image ROIs are (340,250,720,600) for A and
(800,350,980,620) for B, excluding clocks, compass and other dynamic UI.
Worker Network events are keyed by session ID plus request ID; statistics
include only .tif requests with a Range header. Unobserved bytes stay unknown.

Antigravity cold results for Yubari South NDVI:

| Sequential pair | Main before | Scene-affinity preview |
| --- | ---: | ---: |
| 1 (network/CPU profile enabled on both) | 43806 ms | 25522 ms |
| 2 | 63445 ms | 47881 ms |
| 3 | Failed: A tile acquisition error; 120 s deadline | 42322 ms |
| Supplemental pair | 60775 ms | 40906 ms |
| Median of the three successful pairs | 60775 ms | 40906 ms |

The successful-pair median improved 32.7%. The failed baseline pair is retained
as a failure, never converted to zero or used in a numerical speedup. All four
candidate attempts completed. Network variance remains substantial; the old
103279 ms observation is not used as the denominator for the improvement.

A separate paired compass trial completed with exact scene/coordinate/pitch
assertions and no tile errors. The first 0→15° turn took 5767→6675 ms;
return took 65→74 ms. These single network-dependent turns do not show a
universal speedup. Three subsequent cached round trips retained A/B sync:
mean forward times were 146→71 ms and mean returns 192→146 ms, before the
extra 500 ms stability confirmation. Initial loading in this separate pair
was 61733→39974 ms.

Regional regression runs used the same fixed poses and scene IDs (Uonuma:
138.96,37.23; S2A_54SUG_20261023_0_L2A / S2B_54SUG_20261023_1_L2A;
Yubari North: 141.985,43.02001649044, using the South scenes).

| Region / mode | Main initial | Preview initial | Preview 0→15° / return |
| --- | ---: | ---: | ---: |
| Yubari North TCI | 37035 ms | 27871 ms | 8253 / 66 ms |
| Yubari North NDVI | 51063 ms (retry) | 37292 ms | 7767 / 63 ms |
| Uonuma TCI | 18057 ms | 18458 ms | 2608 / 157 ms |
| Uonuma NDVI | 31306 ms | 14193 ms | 1902 / 393 ms |
| Yubari South TCI | 37056 ms | 41870 ms | 3577 / 67 ms |
| Yubari South NDVI | 57907 ms | 35532 ms | 5953 / 74 ms |

All six preview cases completed without tile errors and retained synchronized
A/B cameras through the fixed-angle turns. The first North NDVI baseline run
failed with `Failed to fetch`; its incomplete image produced an invalid 12.059%
A-ROI difference. That failed image was preserved, then replaced for acceptance
by the successfully completed 51063 ms baseline retry at the same pose.

The Antigravity ROI comparator counts pixels with summed RGB difference >10;
all six completed image comparisons had zero pixels above that threshold.
An independent exact comparison found 247 North NDVI A-ROI pixels differing
by at most 4/255 per channel, and 9 Uonuma TCI B-ROI pixels by at most 1/255.
These small rendered differences are not described as byte-identical images.
The scientific worker, requested unique NDVI ranges and output dimensions
remain identical. Initial South NDVI clear ROIs were also exactly identical.

Local raw reports and screenshots are retained under
`docs/testing/cog-perf-benchmark/ndvi-worker-profile/`. The original
`medianSettledMs` field in the first paired report included the null baseline
failure incorrectly; use `threeSuccessfulColdTrialsMedian` and the explicit
attempt table above instead. No null-derived speedup is accepted.

## Shared source-range cache (implementation; deployment validation pending)

The `/api/cog/v1/{start}-{end}/{public-COG-path}` endpoint stores exact source
bytes in the Vercel CDN for seven days, with a one-day browser cache lifetime.
The path includes the full dated Sentinel-2 scene, band and inclusive byte
range. Only the fixed public Sentinel COG origin and supported raster paths
are accepted; redirects, arbitrary URLs, traversal and oversized ranges are
rejected. Errors and incomplete/non-206 origin responses use `no-store`.
There is no data transformation, recompression or change to sampling math.

Vercel CDN does not cache 206 function responses, so each range object is a
200 response with `X-Cog-Range` metadata. The GeoTIFF client validates that
metadata and exact byte length and reconstructs its expected 206 response.
Requests above 4 MiB are split without gaps or overlaps and reassembled in
order, below the function response-size limit. The function is placed in sfo1
near the source's US West region. Source failures remain non-cacheable; an
invalid shared-cache response falls back to the original direct Range read.
Aborted callers do not start the fallback. Non-Sentinel URLs stay direct.

Cache persistence comes from the CDN, not a process-local Map or local disk.
It is ephemeral and regional: cold misses, eviction and expiry still require
origin access. No whole-archive download or prewarming is performed. CDN
request/transfer and function execution usage apply; no paid resource was
provisioned by this change.

Validation must use an actual deployed preview, not localhost. Capture the
first MISS and subsequent HIT from fresh browser contexts with identical
scenes/poses, and use `X-Vercel-Cache` to distinguish shared hits from browser
or worker reuse. Do not send `Cache-Control: no-cache` / `Pragma: no-cache`
when measuring shared hits. Verify cache-response bytes against direct-origin
SHA-256, then regional TCI/NDVI image ROIs, A/B sync, fixed compass turns and
rapid mode/scene changes. The previous worker-locality timings above do not
establish shared-cache performance. Merge is pending that verification.

Deployed-preview HTTP verification (2026-10-26 JST, source 152028f): separate
CLI requests confirmed server-side MISS→HIT, with exact SHA-256 equality to
S3 for both 1 MiB probes (bytes 1024–1049599):

| Band | MISS total / TTFB | HIT total / TTFB |
| --- | ---: | ---: |
| B04 | 2.137 / 1.279 s | 0.550 / 0.169 s |
| B08 | 1.541 / 0.658 s | 0.821 / 0.179 s |

These are single HTTP probes, not whole-map measurements. CLI startup is
excluded. Full raw sanitized results remain at `docs/testing/shared-cog-http.json`.
Run `python3 scripts/verify-shared-cog-cache.py <deployment-url>` to repeat;
existing Vercel CLI authentication is required for protected previews. Repeating
an already-warmed URL will report HIT for the first request too; do not label
that run cold. Do not purge unrelated caches to force a cold result.

34 tests, zero Svelte diagnostics, local production build and Vercel preview
build passed. Antigravity computer-use calls repeatedly timed out, so browser
cold/warm timings and shared-cache image regressions remain unverified.
PR #13 remains a draft; no merge or production deployment is authorized by
these HTTP-only results as a substitute for the requested acceptance tests.
