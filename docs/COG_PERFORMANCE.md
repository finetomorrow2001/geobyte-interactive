# COG Range loading performance

## Cause and change

The installed geotiff RemoteSource only enables its BlockedSource when blockSize
is supplied. Previously openCog supplied only allowFullFile:false, leaving each
IFD/header and overlapping pixel read to issue separate Range requests. Opening
each file also enumerates its overview IFDs sequentially. A/B maps and multiple
workers multiply those network round trips.

openCog now supplies 64 KiB blocks with 16 cached blocks per COG (1 MiB).
The existing 24-entry COG metadata limit and 2–4 worker limit remain in place.
Decoded internal tiles use a 32 MiB LRU per worker instead of a tile-count FIFO.
Pending reads are stored separately so cache pressure cannot discard shared
in-flight requests and cause duplicate reads. Failed reads are removed for retry.
Resolution selection, reprojection, sample values, nodata and colormaps are unchanged.
Canceled MapLibre requests still can finish in workers; cancellation of shared
Range reads requires separate ownership handling and is outside this change.

## Reproducible isolated measurement

Run `node scripts/benchmark-cog-range.mjs` from the repository root. It reads a
public Sentinel-2 TCI COG with buffering disabled/enabled in interleaved order,
three trials per variant, reads an overview internal tile twice, and records
request count, response Content-Length totals, timings and pixel hashes under
`docs/testing/cog-range-benchmark.json`.

2026-10-25 JST, S2B_54TWN_20261023_1_L2A, local Node measurement:

| Median | Before | After |
| --- | ---: | ---: |
| Header time | 2143 ms | 211 ms |
| Header requests | 12 | 1 |
| Total time (headers + two reads) | 3046 ms | 605 ms |
| Total requests | 14 | 2 |
| Response bytes | 983446 | 589824 |

All six trials produced the same SHA-256 pixel hash. This measures one COG path,
not whole-map latency. Header bytes increase from 6322 to 65536 because of the
bounded block read; shared repeated reads reduce total transfer in this sample.
Browser before/after validation in Yubari South/North and Uonuma is pending.

## Automated checks

`npm test` includes cache sharing, in-flight retention under eviction pressure,
byte-budget eviction, failed-request retry, and bounded Range options.
`npm run check` and `npm run build` also pass.
