/**
 * ブラウザから COG（Cloud Optimized GeoTIFF）を直接読むための薄いラッパー。
 * geotiff.js が HTTP Range Request で必要なタイルだけ取得する。
 * Sentinel-2 L2A（UTM 投影）を Web メルカトルのタイルに再投影して描く。
 */
import { fromUrl, Pool, type GeoTIFF, type GeoTIFFImage } from 'geotiff';

/** Web Worker でデフレート展開を並列化（ブラウザのみ） */
const pool = typeof Worker !== 'undefined' ? new Pool() : undefined;

// ---- UTM 順投影（WGS84） ----
const A = 6378137;
const F = 1 / 298.257223563;
const K0 = 0.9996;
const E2 = F * (2 - F);
const EP2 = E2 / (1 - E2);

/** 経緯度 → UTM (E, N) [m]。EPSG:326xx (北) / 327xx (南) */
export function lonLatToUtm(lon: number, lat: number, epsg: number): [number, number] {
	const north = epsg < 32700;
	const zone = epsg - (north ? 32600 : 32700);
	const lon0 = ((zone - 1) * 6 - 180 + 3) * (Math.PI / 180);
	const φ = lat * (Math.PI / 180);
	const λ = lon * (Math.PI / 180) - lon0;
	const sinφ = Math.sin(φ), cosφ = Math.cos(φ), tanφ = Math.tan(φ);
	const N = A / Math.sqrt(1 - E2 * sinφ * sinφ);
	const T = tanφ * tanφ;
	const C = EP2 * cosφ * cosφ;
	const Aa = λ * cosφ;
	const M =
		A *
		((1 - E2 / 4 - (3 * E2 * E2) / 64 - (5 * E2 ** 3) / 256) * φ -
			((3 * E2) / 8 + (3 * E2 * E2) / 32 + (45 * E2 ** 3) / 1024) * Math.sin(2 * φ) +
			((15 * E2 * E2) / 256 + (45 * E2 ** 3) / 1024) * Math.sin(4 * φ) -
			((35 * E2 ** 3) / 3072) * Math.sin(6 * φ));
	const x =
		K0 * N * (Aa + ((1 - T + C) * Aa ** 3) / 6 + ((5 - 18 * T + T * T + 72 * C - 58 * EP2) * Aa ** 5) / 120) + 500000;
	let y =
		K0 *
		(M +
			N * tanφ * ((Aa * Aa) / 2 + ((5 - T + 9 * C + 4 * C * C) * Aa ** 4) / 24 + ((61 - 58 * T + T * T + 600 * C - 330 * EP2) * Aa ** 6) / 720));
	if (!north) y += 10000000;
	return [x, y];
}

// ---- Web メルカトルタイル ----
export function tileToLonLat(x: number, y: number, z: number): [number, number] {
	const n = 2 ** z;
	const lon = (x / n) * 360 - 180;
	const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
	return [lon, lat];
}

/** タイル内の各ピクセルの経緯度を一括計算（メルカトルは行ごとに緯度一定） */
function tilePixelLonLat(x: number, y: number, z: number, size: number): { lons: Float64Array; lats: Float64Array } {
	const n = 2 ** z;
	const lons = new Float64Array(size);
	const lats = new Float64Array(size);
	for (let i = 0; i < size; i++) {
		lons[i] = ((x + (i + 0.5) / size) / n) * 360 - 180;
		lats[i] = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + (i + 0.5) / size)) / n))) * 180) / Math.PI;
	}
	return { lons, lats };
}

// ---- COG ----
type CogInfo = {
	tiff: GeoTIFF;
	images: GeoTIFFImage[]; // 0 = フル解像度、以降オーバービュー
	originX: number;
	originY: number;
	resX: number; // フル解像度の m/px
	resY: number;
	width: number;
	height: number;
	bands: number;
	nodata: number | null;
};

const cache = new Map<string, Promise<CogInfo>>();

/** ブラウザが発行した COG への HTTP リクエスト数（Performance API で観測） */
export function cogRequestCount(): number {
	if (typeof performance === 'undefined') return 0;
	return performance.getEntriesByType('resource').filter((e) => e.name.includes('sentinel-cogs')).length;
}

export function openCog(href: string): Promise<CogInfo> {
	let p = cache.get(href);
	if (!p) {
		p = (async () => {
			const tiff = await fromUrl(href, { allowFullFile: false });
			const count = await tiff.getImageCount();
			const images: GeoTIFFImage[] = [];
			for (let i = 0; i < count; i++) images.push(await tiff.getImage(i));
			const base = images[0];
			const [ox, oy] = base.getOrigin();
			const [rx, ry] = base.getResolution();
			const nd = base.getGDALNoData();
			return {
				tiff,
				images,
				originX: ox,
				originY: oy,
				resX: rx,
				resY: Math.abs(ry),
				width: base.getWidth(),
				height: base.getHeight(),
				bands: base.getSamplesPerPixel(),
				nodata: nd
			};
		})();
		cache.set(href, p);
		p.catch(() => cache.delete(href));
	}
	return p;
}

/** 目標分解能 [m/px] に対して、それ以下で最も粗いオーバービューを選ぶ（多少の粗さは許容して転送量を抑える） */
function pickLevel(cog: CogInfo, targetRes: number): { level: number; img: GeoTIFFImage; scale: number } {
	let best = 0;
	for (let i = 0; i < cog.images.length; i++) {
		const scale = cog.width / cog.images[i].getWidth();
		if (cog.resX * scale <= targetRes * 1.4) best = i;
		else break;
	}
	const img = cog.images[best];
	return { level: best, img, scale: cog.width / img.getWidth() };
}

// ---- デコード済み内部タイルのキャッシュ ----
// COG の内部タイル（512 or 1024 px）単位で読む＆デコードし、隣接する地図タイルが再利用する。
type Decoded = { data: ArrayLike<number>[]; w: number; h: number; x0: number; y0: number };
const tileCache = new Map<string, Promise<Decoded>>();
const TILE_CACHE_MAX = 400;

function getInternalTile(cog: CogInfo, href: string, level: number, tx: number, ty: number): Promise<Decoded> {
	const key = `${href}|${level}|${tx}|${ty}`;
	let p = tileCache.get(key);
	if (p) return p;
	const img = cog.images[level];
	const tw = img.getTileWidth();
	const th = img.getTileHeight();
	const x0 = tx * tw, y0 = ty * th;
	const x1 = Math.min(x0 + tw, img.getWidth());
	const y1 = Math.min(y0 + th, img.getHeight());
	p = img
		.readRasters({ window: [x0, y0, x1, y1], interleave: false, pool })
		.then((r) => ({ data: r as unknown as ArrayLike<number>[], w: x1 - x0, h: y1 - y0, x0, y0 }));
	if (tileCache.size >= TILE_CACHE_MAX) tileCache.delete(tileCache.keys().next().value!);
	tileCache.set(key, p);
	p.catch(() => tileCache.delete(key));
	return p;
}

export type TileSamples = {
	/** バンドごとの値。size*size、タイル外・nodata は NaN */
	bands: Float32Array[];
};

/**
 * 1 つの COG から、Web メルカトルタイル (z/x/y) の各ピクセル値をサンプリングする。
 * 出力ピクセル → 経緯度 → UTM → 画像ピクセル（最近傍）の逆マッピング。
 */
export async function sampleTile(href: string, epsg: number, z: number, x: number, y: number, size = 256): Promise<TileSamples> {
	const cog = await openCog(href);
	const { lons, lats } = tilePixelLonLat(x, y, z, size);

	// タイル中央の地上分解能からオーバービューを選択
	const midLat = lats[size >> 1];
	const groundRes = (156543.03392 * Math.cos((midLat * Math.PI) / 180)) / 2 ** z;
	const { level, img, scale } = pickLevel(cog, groundRes);
	const resX = cog.resX * scale;
	const resY = cog.resY * scale;
	const W = img.getWidth();
	const H = img.getHeight();
	const tw = img.getTileWidth();
	const th = img.getTileHeight();

	// 各出力ピクセルの画像座標を計算し、必要な内部タイルの範囲を求める
	const px = new Int32Array(size * size);
	const py = new Int32Array(size * size);
	let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
	for (let j = 0; j < size; j++) {
		for (let i = 0; i < size; i++) {
			const [E, N] = lonLatToUtm(lons[i], lats[j], epsg);
			const cx = Math.floor((E - cog.originX) / resX);
			const cy = Math.floor((cog.originY - N) / resY);
			const k = j * size + i;
			if (cx < 0 || cy < 0 || cx >= W || cy >= H) {
				px[k] = -1;
				py[k] = -1;
				continue;
			}
			px[k] = cx;
			py[k] = cy;
			if (cx < minX) minX = cx;
			if (cx > maxX) maxX = cx;
			if (cy < minY) minY = cy;
			if (cy > maxY) maxY = cy;
		}
	}

	const out = Array.from({ length: cog.bands }, () => new Float32Array(size * size).fill(NaN));
	if (!Number.isFinite(minX)) return { bands: out };

	// 必要な内部タイルを（キャッシュ経由で）並列取得
	const tx0 = Math.floor(minX / tw), tx1 = Math.floor(maxX / tw);
	const ty0 = Math.floor(minY / th), ty1 = Math.floor(maxY / th);
	const tiles = new Map<string, Decoded>();
	const jobs: Promise<void>[] = [];
	for (let ty = ty0; ty <= ty1; ty++)
		for (let tx = tx0; tx <= tx1; tx++)
			jobs.push(getInternalTile(cog, href, level, tx, ty).then((d) => void tiles.set(`${tx}|${ty}`, d)));
	await Promise.all(jobs);

	const nodata = cog.nodata;
	for (let k = 0; k < size * size; k++) {
		if (px[k] < 0) continue;
		const t = tiles.get(`${Math.floor(px[k] / tw)}|${Math.floor(py[k] / th)}`)!;
		const idx = (py[k] - t.y0) * t.w + (px[k] - t.x0);
		for (let b = 0; b < cog.bands; b++) {
			const v = t.data[b][idx];
			out[b][k] = nodata !== null && v === nodata ? NaN : v;
		}
	}
	return { bands: out };
}

/** 1 地点のフル解像度ピクセル値を読む */
export async function samplePoint(href: string, epsg: number, lon: number, lat: number): Promise<number[] | null> {
	const cog = await openCog(href);
	const [E, N] = lonLatToUtm(lon, lat, epsg);
	const cx = Math.floor((E - cog.originX) / cog.resX);
	const cy = Math.floor((cog.originY - N) / cog.resY);
	if (cx < 0 || cy < 0 || cx >= cog.width || cy >= cog.height) return null;
	const rasters = (await cog.images[0].readRasters({ window: [cx, cy, cx + 1, cy + 1], interleave: false, pool })) as unknown as ArrayLike<number>[];
	return rasters.map((r) => r[0]);
}

// ---- カラーマップ ----
type Stop = [number, number, number, number]; // t, r, g, b
const colormaps: Record<string, Stop[]> = {
	rdylgn: [
		[0, 165, 0, 38],
		[0.25, 244, 109, 67],
		[0.5, 255, 255, 191],
		[0.75, 102, 189, 99],
		[1, 0, 104, 55]
	],
	blues: [
		[0, 247, 251, 255],
		[0.5, 107, 174, 214],
		[1, 8, 48, 107]
	],
	brbg: [
		[0, 84, 48, 5],
		[0.25, 191, 129, 45],
		[0.5, 245, 245, 245],
		[0.75, 90, 180, 172],
		[1, 0, 60, 48]
	],
	magma: [
		[0, 0, 0, 4],
		[0.25, 81, 18, 124],
		[0.5, 183, 55, 121],
		[0.75, 252, 137, 97],
		[1, 252, 253, 191]
	]
};

/** 0..1 → RGB */
export function colormap(name: string, t: number): [number, number, number] {
	const stops = colormaps[name] ?? colormaps.rdylgn;
	const c = Math.max(0, Math.min(1, t));
	for (let i = 1; i < stops.length; i++) {
		if (c <= stops[i][0]) {
			const [t0, r0, g0, b0] = stops[i - 1];
			const [t1, r1, g1, b1] = stops[i];
			const k = (c - t0) / (t1 - t0);
			return [r0 + (r1 - r0) * k, g0 + (g1 - g0) * k, b0 + (b1 - b0) * k];
		}
	}
	const last = stops[stops.length - 1];
	return [last[1], last[2], last[3]];
}
