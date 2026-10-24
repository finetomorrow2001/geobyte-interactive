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
