/**
 * COG の取得・デコード・再投影・合成をメインスレッドから切り離す Worker。
 * メッセージ: { id, kind: 'tile', ... } → { id, rgba } / { id, kind: 'point', ... } → { id, values }
 */
import { sampleTile, samplePoint, colormap } from './cog';

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
};
export type PointJob = { id: number; kind: 'point'; epsg: number; lon: number; lat: number; hrefs: string[] };
export type Job = TileJob | PointJob;

async function renderTile(job: TileJob): Promise<Uint8ClampedArray<ArrayBuffer>> {
	const { epsg, z, x, y, size, gain } = job;
	const rgba = new Uint8ClampedArray(new ArrayBuffer(size * size * 4));
	const tiles = await Promise.all(job.hrefs.map((h) => sampleTile(h, epsg, z, x, y, size)));

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
		for (let k = 0; k < size * size; k++) {
			const va = a[k], vb = b[k];
			if (va !== va || vb !== vb || va + vb === 0) continue;
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
