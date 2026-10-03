/**
 * COG の取得・デコード・再投影・合成をメインスレッドから切り離す Worker。
 * メッセージ: { id, kind: 'tile', ... } → { id, rgba } / { id, kind: 'point', ... } → { id, values }
 */
import { sampleTile, samplePoint, sampleGrid, colormap } from './cog';
import { SCL_INVALID_LUT, summarizeScl, type SclSummary } from './scl';

// この Worker が発行した HTTP リクエスト数（教材用の表示に使う）
let requests = 0;
const origFetch = self.fetch.bind(self);
self.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
	requests++;
	return origFetch(input, init);
}) as typeof fetch;

export type TileJob = {
	id: number;
	kind: 'tile';
	epsg: number;
	z: number;
	x: number;
	y: number;
	size: number;
	/** composite: hrefs 1（3バンド）or 3（各1バンド）, index: hrefs 2 */
	mode: 'composite' | 'index';
	hrefs: string[];
	/** composite のみ。undefined なら 8bit そのまま × gain */
	rescaleMax?: number;
	gain: number;
	/** index のみ */
	cmap?: string;
	/** index のみ。SCL の COG。指定すると雲・雲影・巻雲・雪・欠測の画素を透過（欠測扱い）にする */
	sclHref?: string;
	/** index のみ。DN から引くオフセット（reflectance.ts の dnOffsetFor）。補正済みなら 0 */
	dnOffset?: number;
};
export type PointJob = { id: number; kind: 'point'; epsg: number; lon: number; lat: number; hrefs: string[] };
/** 地域内の SCL 集計（bbox を n×n 格子で最近傍サンプリング） */
export type StatsJob = { id: number; kind: 'stats'; epsg: number; href: string; bbox: [number, number, number, number]; n: number };
export type Job = TileJob | PointJob | StatsJob;

async function renderTile(job: TileJob): Promise<Uint8ClampedArray<ArrayBuffer>> {
	const { epsg, z, x, y, size, gain } = job;
	const rgba = new Uint8ClampedArray(new ArrayBuffer(size * size * 4));
	const [tiles, scl] = await Promise.all([
		Promise.all(job.hrefs.map((h) => sampleTile(h, epsg, z, x, y, size))),
		// 指数画像だけ SCL を読む（真色・合成は雲を見せるためマスクしない）。SCL の 20 m は最近傍で対応付ける
		job.mode === 'index' && job.sclHref ? sampleTile(job.sclHref, epsg, z, x, y, size) : Promise.resolve(null)
	]);

	if (job.mode === 'composite') {
		const chans = job.hrefs.length === 1 ? tiles[0].bands.slice(0, 3) : tiles.map((t) => t.bands[0]);
		const scale = job.rescaleMax ? 255 / (job.rescaleMax / gain) : gain;
		for (let k = 0; k < size * size; k++) {
			const r = chans[0][k], g = chans[1][k], b = chans[2][k];
			if (r !== r || g !== g || b !== b) continue; // NaN チェック
			rgba[k * 4] = r * scale;
			rgba[k * 4 + 1] = g * scale;
			rgba[k * 4 + 2] = b * scale;
			rgba[k * 4 + 3] = 255;
		}
	} else {
		const a = tiles[0].bands[0], b = tiles[1].bands[0];
		// カラーマップは 256 段階に事前計算
		const lut = new Uint8ClampedArray(256 * 3);
		for (let i = 0; i < 256; i++) {
			const [r, g, bl] = colormap(job.cmap ?? 'rdylgn', i / 255);
			lut[i * 3] = r;
			lut[i * 3 + 1] = g;
			lut[i * 3 + 2] = bl;
		}
		const off = job.dnOffset ?? 0;
		const sc = scl?.bands[0];
		for (let k = 0; k < size * size; k++) {
			// 無効画素は 0 ではなく透過（欠測）。SCL が NaN（範囲外・nodata）も無効
			if (sc) {
				const c = sc[k];
				if (c !== c || SCL_INVALID_LUT[c] === 1) continue;
			}
			const va = a[k] - off, vb = b[k] - off;
			if (va !== va || vb !== vb || va + vb <= 0) continue;
			const v = (va - vb) / (va + vb);
			const i = Math.max(0, Math.min(255, Math.round(((v + 1) / 2) * 255))) * 3;
			rgba[k * 4] = lut[i];
			rgba[k * 4 + 1] = lut[i + 1];
			rgba[k * 4 + 2] = lut[i + 2];
			rgba[k * 4 + 3] = 255;
		}
	}
	return rgba;
}

self.onmessage = async (e: MessageEvent<Job>) => {
	const job = e.data;
	try {
		if (job.kind === 'tile') {
			const rgba = await renderTile(job);
			(self as unknown as Worker).postMessage({ id: job.id, rgba, requests }, [rgba.buffer]);
		} else if (job.kind === 'stats') {
			const grid = await sampleGrid(job.href, job.epsg, job.bbox, job.n);
			const stats: SclSummary = summarizeScl(grid);
			(self as unknown as Worker).postMessage({ id: job.id, stats, requests });
		} else {
			const values = await Promise.all(
				job.hrefs.map(async (h) => {
					try {
						const v = await samplePoint(h, job.epsg, job.lon, job.lat);
						return v && v[0] !== 0 ? v[0] : null;
					} catch {
						return null;
					}
				})
			);
			(self as unknown as Worker).postMessage({ id: job.id, values, requests });
		}
	} catch (err) {
		(self as unknown as Worker).postMessage({ id: job.id, error: err instanceof Error ? err.message : String(err), requests });
	}
};
