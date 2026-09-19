import { sampleTile, samplePoint, colormap } from '$lib/cog';

export const STAC_API = 'https://earth-search.aws.element84.com/v1';
export const COLLECTION = 'sentinel-2-l2a';

export type StacItem = {
	id: string;
	bbox: [number, number, number, number];
	geometry: { type: string; coordinates: number[][][] };
	properties: Record<string, unknown> & { datetime: string; 'eo:cloud_cover'?: number; 'proj:epsg'?: number };
	assets: Record<string, { href: string }>;
};

export const itemUrl = (id: string) => `${STAC_API}/collections/${COLLECTION}/items/${id}`;

export type Composite = {
	id: string;
	name: string;
	assets: string[];
	/** DN の表示レンジ上限（0..max を 0..255 に）。visual は 8bit なので不要 */
	rescaleMax?: number;
	desc: string;
};

/** Earth Search sentinel-2-l2a のアセット名でのバンド合成 */
export const composites: Composite[] = [
	{ id: 'tci', name: 'トゥルーカラー (TCI)', assets: ['visual'], desc: 'ESA が生成した 8bit の真色画像。1 ファイル 3 バンドなので最も速い。' },
	{ id: 'rgb', name: 'トゥルーカラー (自前)', assets: ['red', 'green', 'blue'], rescaleMax: 3000, desc: 'B4/B3/B2 を自分でストレッチ。ゲインを変えて暗部を持ち上げられる。' },
	{ id: 'fc', name: 'フォールスカラー (NIR)', assets: ['nir', 'red', 'green'], rescaleMax: 4000, desc: 'B8/B4/B3。植生が赤く、水が黒く出る。' },
	{ id: 'swir', name: 'SWIR 合成', assets: ['swir22', 'nir08', 'red'], rescaleMax: 4000, desc: 'B12/B8A/B4。焼失跡・裸地が赤紫、植生が緑。雲は白、雪は青。' },
	{ id: 'agri', name: '農業', assets: ['swir16', 'nir', 'blue'], rescaleMax: 4000, desc: 'B11/B8/B2。作物の活性が鮮やかな緑。' },
	{ id: 'urban', name: '都市', assets: ['swir22', 'swir16', 'red'], rescaleMax: 4000, desc: 'B12/B11/B4。建物・裸地が明るく、植生は暗い緑。' }
];

export type IndexDef = {
	id: string;
	name: string;
	/** (b1 - b2) / (b1 + b2) */
	b1: string;
	b2: string;
	colormap: string;
	desc: string;
};

export const indices: IndexDef[] = [
	{ id: 'ndvi', name: 'NDVI 植生', b1: 'nir', b2: 'red', colormap: 'rdylgn', desc: '緑 = 密な植生、黄 = 裸地・都市・雲、赤 = 水・雲影。' },
	{ id: 'ndwi', name: 'NDWI 水域', b1: 'green', b2: 'nir', colormap: 'blues', desc: '濃い青 = 水。0 以上を水域とみなすのが目安。' },
	{ id: 'ndmi', name: 'NDMI 植生水分', b1: 'nir08', b2: 'swir16', colormap: 'brbg', desc: '青緑 = 水分が多い植生、茶 = 乾燥。' },
	{ id: 'nbr', name: 'NBR 焼失', b1: 'nir', b2: 'swir22', colormap: 'rdylgn', desc: '火災前後で差分 (dNBR) を取ると被害域が出る。' },
	{ id: 'ndsi', name: 'NDSI 雪', b1: 'green', b2: 'swir16', colormap: 'blues', desc: '0.4 以上で雪。雲は SWIR でも明るいので分離できる。' },
	{ id: 'ndbi', name: 'NDBI 都市', b1: 'swir16', b2: 'nir', colormap: 'magma', desc: '明るい = 建物・裸地。NDVI とほぼ逆符号。' }
];

export type Place = { name: string; center: [number, number]; zoom: number; hint: string };

export const places: Place[] = [
	{ name: '東京', center: [35.68, 139.75], zoom: 11, hint: '都市 vs 皇居・多摩の緑' },
	{ name: '富士山', center: [35.36, 138.73], zoom: 11, hint: '雪と雲を NDSI / SWIR で見分ける' },
	{ name: '琵琶湖', center: [35.25, 136.05], zoom: 10, hint: 'NDWI で水域抽出' },
	{ name: '十勝平野', center: [42.9, 143.2], zoom: 10, hint: '農地のパターン、季節変化' },
	{ name: '阿蘇', center: [32.88, 131.1], zoom: 11, hint: 'カルデラの草原・火山地形' },
	{ name: '石垣島', center: [24.4, 124.2], zoom: 11, hint: 'サンゴ礁・浅海の色' }
];

export type RenderMode = { kind: 'composite'; id: string } | { kind: 'index'; id: string };

/** 描画に使うアセット名の一覧 */
export function assetsFor(mode: RenderMode): string[] {
	if (mode.kind === 'composite') return composites.find((c) => c.id === mode.id)!.assets;
	const ix = indices.find((i) => i.id === mode.id)!;
	return [ix.b1, ix.b2];
}

const epsgOf = (item: StacItem) => item.properties['proj:epsg'] ?? 32654;

/**
 * Web メルカトルタイル 1 枚を描く。COG から必要なウィンドウだけ Range Request で読む。
 * 戻り値は size*size の RGBA。
 */
export async function renderTile(item: StacItem, mode: RenderMode, gain: number, z: number, x: number, y: number, size = 256): Promise<Uint8ClampedArray<ArrayBuffer>> {
	const epsg = epsgOf(item);
	const rgba = new Uint8ClampedArray(new ArrayBuffer(size * size * 4));

	if (mode.kind === 'composite') {
		const c = composites.find((v) => v.id === mode.id)!;
		const tiles = await Promise.all(c.assets.map((a) => sampleTile(item.assets[a].href, epsg, z, x, y, size)));
		// visual は 1 ファイル 3 バンド、それ以外は 3 ファイル × 1 バンド
		const chans = c.assets.length === 1 ? tiles[0].bands.slice(0, 3) : tiles.map((t) => t.bands[0]);
		const scale = c.rescaleMax ? 255 / (c.rescaleMax / gain) : gain;
		for (let k = 0; k < size * size; k++) {
			const r = chans[0][k], g = chans[1][k], b = chans[2][k];
			if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) continue;
			rgba[k * 4] = r * scale;
			rgba[k * 4 + 1] = g * scale;
			rgba[k * 4 + 2] = b * scale;
			rgba[k * 4 + 3] = 255;
		}
	} else {
		const ix = indices.find((v) => v.id === mode.id)!;
		const [t1, t2] = await Promise.all([
			sampleTile(item.assets[ix.b1].href, epsg, z, x, y, size),
			sampleTile(item.assets[ix.b2].href, epsg, z, x, y, size)
		]);
		const a = t1.bands[0], b = t2.bands[0];
		for (let k = 0; k < size * size; k++) {
			const va = a[k], vb = b[k];
			if (Number.isNaN(va) || Number.isNaN(vb) || va + vb === 0) continue;
			const v = (va - vb) / (va + vb);
			const [r, g, bl] = colormap(ix.colormap, (v + 1) / 2);
			rgba[k * 4] = r;
			rgba[k * 4 + 1] = g;
			rgba[k * 4 + 2] = bl;
			rgba[k * 4 + 3] = 255;
		}
	}
	return rgba;
}

export async function searchItems(
	bbox: [number, number, number, number],
	days: number,
	maxCloud: number,
	limit = 24
): Promise<StacItem[]> {
	const to = new Date();
	const from = new Date(to.getTime() - days * 86400000);
	const res = await fetch(`${STAC_API}/search`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			collections: [COLLECTION],
			bbox,
			datetime: `${from.toISOString()}/${to.toISOString()}`,
			query: { 'eo:cloud_cover': { lt: maxCloud } },
			sortby: [{ field: 'properties.datetime', direction: 'desc' }],
			limit
		})
	});
	if (!res.ok) throw new Error(`STAC ${res.status}`);
	return (await res.json()).features as StacItem[];
}

export async function fetchItem(id: string): Promise<StacItem> {
	const res = await fetch(itemUrl(id));
	if (!res.ok) throw new Error(`Item ${id}: ${res.status}`);
	return (await res.json()) as StacItem;
}

/** 1 地点の各アセット DN を、COG からフル解像度で直接読む */
export async function pointValues(item: StacItem, lon: number, lat: number, assets: string[]): Promise<Record<string, number | null>> {
	const epsg = epsgOf(item);
	const vals = await Promise.all(
		assets.map(async (a) => {
			try {
				const v = await samplePoint(item.assets[a].href, epsg, lon, lat);
				return v && v[0] !== 0 ? v[0] : null;
			} catch {
				return null;
			}
		})
	);
	return Object.fromEntries(assets.map((a, i) => [a, vals[i]]));
}

export const normDiff = (a: number | null, b: number | null) =>
	a === null || b === null || a + b === 0 ? null : (a - b) / (a + b);

export const fmtDate = (iso: string) => iso.slice(0, 10);
