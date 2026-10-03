// 夕張の南北範囲について、年次比較の各シーンの地域内 SCL 集計を CLI で再現する。
// アプリ（Worker）と同じ実装 src/lib/cog.ts の sampleGrid と src/lib/scl.ts の summarizeScl を使う。
//   node --experimental-strip-types scripts/scl-region-stats.mjs [area=south|north|both] [YYYY-MM-DD ...] > out.json
// 日付を省略すると 2019〜2026 の基準日 10-02 前後の既定リスト。同じ日に複数シーンがあれば全て出力する。
// 範囲は公開地名を基にした概略 bbox（src/routes/imagery/+page.svelte の studyAreas と同じ値）。
import { sampleGrid } from '../src/lib/cog.ts';
import { summarizeScl, invalidShare, SCL_INVALID_CLASSES } from '../src/lib/scl.ts';
import { dnOffsetFor } from '../src/lib/reflectance.ts';

const AREAS = {
	south: [141.975, 42.91, 142.09, 42.98],
	north: [141.915, 42.975, 142.055, 43.065]
};
const GRID = 150;
const args = process.argv.slice(2);
const areaArg = args.find((a) => ['south', 'north', 'both'].includes(a)) ?? 'both';
const dates = args.filter((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));
if (!dates.length) dates.push('2019-09-30', '2020-09-29', '2021-10-09', '2022-10-09', '2023-09-24', '2024-09-28', '2025-10-03', '2026-09-23');
const areas = areaArg === 'both' ? ['south', 'north'] : [areaArg];

const out = {
	generatedAt: new Date().toISOString(),
	definition: {
		grid: `${GRID}x${GRID} cell centres over the lon/lat bbox, nearest neighbour on SCL (20 m, level 0)`,
		denominator: 'all grid points (including outside-image=255 and SCL 0)',
		invalidClasses: [...SCL_INVALID_CLASSES],
		cloud: 'classes 8 + 9',
		validKeepsDarkAndUnclassified: 'classes 2 and 7 stay valid'
	},
	bboxes: Object.fromEntries(areas.map((a) => [a, AREAS[a]])),
	scenes: []
};
for (const d of dates) {
	const r = await fetch('https://earth-search.aws.element84.com/v1/search', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ collections: ['sentinel-2-l2a'], bbox: [142.0, 42.95, 142.01, 42.96], datetime: `${d}T00:00:00Z/${d}T23:59:59Z`, limit: 20 })
	});
	for (const it of (await r.json()).features) {
		const row = {
			id: it.id,
			date: d,
			sceneCloudCover: it.properties['eo:cloud_cover'],
			processingBaseline: it.properties['s2:processing_baseline'],
			dnOffset: dnOffsetFor(it.properties),
			regions: {}
		};
		for (const a of areas) {
			const s = summarizeScl(await sampleGrid(it.assets.scl.href, it.properties['proj:epsg'], AREAS[a], GRID));
			row.regions[a] = { ...s, invalidPercent: +(100 * invalidShare(s)).toFixed(2) };
		}
		out.scenes.push(row);
	}
}
console.log(JSON.stringify(out, null, 1));
