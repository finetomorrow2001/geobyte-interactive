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

Decoded internal tiles use a 120-entry LRU with a 128 MiB cap per worker instead of a tile-count FIFO.
The initial 32 MiB cap was rejected after warm browser latency regressed;
retaining the original tile working-set size avoids unnecessary evictions.
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
byte-budget eviction, failed-request retry, 40 concurrent header/pixel reads,
abort handling and full-file response rejection.
`npm run check` and `npm run build` also pass.
