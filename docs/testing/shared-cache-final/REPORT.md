# PR #13 shared COG range cache — independent acceptance (Claude, 2026-11-02)

Branch `perf/ndvi-worker-locality` @ 64f8312, preview
`geobyte-interactive-gztc6lf7m-…vercel.app`. Read-only: no source edits, commits,
permission/protection changes or cache purges.

## Verdict
- **HTTP layer: PASS** (6/6 never-requested ranges MISS→HIT→HIT, byte-exact vs S3).
- **Browser acceptance: NOT RUN — blocked.** The preview is behind Vercel
  Deployment Protection. The built-in browser redirects to `vercel.com/login`;
  Claude must not enter credentials, and creating a protection-bypass link/secret
  would be a permission change outside this task. Whole-map load times, image
  ROIs, A/B sync, compass 0→15→0, Ctrl-drag, rapid switching and production
  comparison therefore remain **unverified**. No speedup claim for the map is made.

## Source review (read-only)
- `cog-range.ts`: strict allowlist regex (fixed S3 origin, dated S2 scene, band,
  inclusive range ≤ 4 MiB), `redirect:'error'`, 25 s timeout, requires 206 with
  exact `Content-Range` and length; errors are `no-store`. 200 + `X-Cog-Range`,
  browser 1 d / CDN 7 d. No transformation.
- `cog.ts fetchCogRange`: splits > 4 MiB into contiguous chunks, validates each
  `X-Cog-Range` and length, checks a consistent total, rebuilds a 206; any failure
  falls back to the direct Range read; abort is rethrown before fallback. Only S3
  Sentinel URLs with `bytes=a-b` use the cache.
- Observations (not blockers): (1) a fallback after a partial chunk failure re-reads
  the whole range directly (correct, just extra bytes); (2) CDN hit rate depends on
  clients requesting identical ranges — true for geotiff block reads of the same
  tile layout, but a different tile/zoom can produce different ranges; (3) the
  header prefix `0-65535` is the most reusable key.

## HTTP measurements (`http-probes.json`)
Method: `vercel curl` with existing CLI auth (no `Cache-Control`/`Pragma` request
headers), 1 MiB ranges at offsets never requested before, 3 sequential requests
each; reference SHA-256 from a direct S3 Range read. Client in Japan.

| Region / band | 1st (cache) total / TTFB | 2nd | 3rd | bytes = S3 |
|---|---|---|---|---|
| Yubari 54TWN B04 | MISS 0.801 / 0.469 s | HIT 0.177 / 0.103 | HIT 0.209 / 0.118 | yes ×3 |
| Yubari B08 | MISS 1.181 / 0.484 | HIT 0.404 / 0.108 | HIT 0.188 / 0.092 | yes ×3 |
| Yubari TCI | MISS 1.108 / 0.456 | HIT 0.216 / 0.108 | HIT 0.219 / 0.117 | yes ×3 |
| Uonuma 54SUG B04 | MISS 1.294 / 0.504 | HIT 0.189 / 0.103 | HIT 0.192 / 0.106 | yes ×3 |
| Uonuma B08 | MISS 1.110 / 0.554 | HIT 0.223 / 0.099 | HIT 0.329 / 0.239 | yes ×3 |
| Uonuma TCI | MISS 1.205 / 0.533 | HIT 0.222 / 0.111 | HIT 0.192 / 0.089 | yes ×3 |

Medians: MISS 1.15 s total; HIT 0.21 s total. Direct S3 1 MiB from the same
client, 3 runs: 1.44 / 1.40 / 1.30 s total (TTFB 0.68 / 0.51 / 0.52 s). So a cold
MISS is not slower than direct S3 here and a HIT is ~5–6× faster **per 1 MiB
request**. n is small (6 ranges, one client, one time window); variance is
visible (HIT 0.18–0.40 s). Yubari "South/North" were one scene/tile (54TWN) at the
HTTP level; ranges are not tied to map poses.

Endpoint rejection checks (all `Cache-Control: no-store`): >4 MiB → 400,
`..` traversal → 400, end<start → 400, unknown band → 400, nonexistent scene →
502. All carried `x-vercel-cache: MISS` (not cached).

## Needed to finish browser acceptance
The owner signs in to Vercel in the browser pane (or provides an approved
share link). Then: fresh contexts with disk cache disabled, same scenes/poses
for Yubari S/N and Uonuma, TCI/NDVI A/B, compass 0→15→0, Ctrl-drag, both-camera
sync, rapid switches, and `X-Vercel-Cache` per request from the network log.
