export const STAC_API = 'https://earth-search.aws.element84.com/v1';
export const TITILER = 'https://titiler.xyz';
export const COLLECTION = 'sentinel-2-l2a';

export type StacItem = {
	id: string;
	bbox: [number, number, number, number];
	geometry: { type: string; coordinates: number[][][] };
	properties: Record<string, unknown> & { datetime: string; 'eo:cloud_cover'?: number };
	assets: Record<string, { href: string }>;
};

export const itemUrl = (id: string) => `${STAC_API}/collections/${COLLECTION}/items/${id}`;

export type Composite = {
	id: string;
	name: string;
	assets: string[];
	/** DN の表示レンジ上限（rescale=0,max）。visual は 8bit なので不要 */
	rescaleMax?: number;
	desc: string;
};

/** Earth Search sentinel-2-l2a のアセット名でのバンド合成 */
export const composites: Composite[] = [
	{ id: 'tci', name: 'トゥルーカラー (TCI)', assets: ['visual'], desc: 'ESA が生成した 8bit の真色画像。1 ファイルで済むので最も速い。' },
	{ id: 'rgb', name: 'トゥルーカラー (自前)', assets: ['red', 'green', 'blue'], rescaleMax: 3000, desc: 'B4/B3/B2 を自分でストレッチ。ゲインを変えて暗部を持ち上げられる。' },
	{ id: 'fc', name: 'フォールスカラー (NIR)', assets: ['nir', 'red', 'green'], rescaleMax: 4000, desc: 'B8/B4/B3。植生が赤く、水が黒く出る。' },
	{ id: 'swir', name: 'SWIR 合成', assets: ['swir22', 'nir08', 'red'], rescaleMax: 4000, desc: 'B12/B8A/B4。焼失跡・裸地が赤紫、植生が緑。雲は白、雪は青。' },
	{ id: 'agri', name: '農業', assets: ['swir16', 'nir', 'blue'], rescaleMax: 4000, desc: 'B11/B8/B2。作物の活性が鮮やかな緑。' },
	{ id: 'urban', name: '都市', assets: ['swir22', 'swir16', 'red'], rescaleMax: 4000, desc: 'B12/B11/B4。建物・裸地が明るく、植生は暗い緑。' }
];

export type IndexDef = {
	id: string;
	name: string;
	/** normalizedIndex は (b1 - b2) / (b1 + b2) */
	b1: string;
	b2: string;
	colormap: string;
	desc: string;
};

export const indices: IndexDef[] = [
	{ id: 'ndvi', name: 'NDVI 植生', b1: 'nir', b2: 'red', colormap: 'rdylgn', desc: '緑 = 密な植生、黄 = 裸地・都市、赤 = 水・雲影。' },
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

/** titiler の STAC タイル URL テンプレートを組み立てる */
export function tileUrl(item: StacItem, mode: RenderMode, gain: number): string {
	const p = new URLSearchParams();
	p.set('url', itemUrl(item.id));
	if (mode.kind === 'composite') {
		const c = composites.find((x) => x.id === mode.id)!;
		for (const a of c.assets) p.append('assets', a);
		if (c.rescaleMax) p.set('rescale', `0,${Math.round(c.rescaleMax / gain)}`);
	} else {
		const ix = indices.find((x) => x.id === mode.id)!;
		p.append('assets', ix.b1);
		p.append('assets', ix.b2);
		p.set('algorithm', 'normalizedIndex');
		p.set('rescale', '-1,1');
		p.set('colormap_name', ix.colormap);
	}
	// {z}/{x}/{y} は URLSearchParams がエンコードしてしまうので後から連結する
	return `${TITILER}/stac/tiles/WebMercatorQuad/{z}/{x}/{y}.png?${p.toString()}`;
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

/** 1 地点の各アセット DN を取得 */
export async function pointValues(item: StacItem, lon: number, lat: number, assets: string[]): Promise<Record<string, number | null>> {
	const p = new URLSearchParams();
	p.set('url', itemUrl(item.id));
	for (const a of assets) p.append('assets', a);
	const res = await fetch(`${TITILER}/stac/point/${lon},${lat}?${p}`);
	if (!res.ok) return Object.fromEntries(assets.map((a) => [a, null]));
	const json = await res.json();
	const vals: (number | null)[] = json.values ?? [];
	return Object.fromEntries(assets.map((a, i) => [a, vals[i] ?? null]));
}

export const normDiff = (a: number | null, b: number | null) =>
	a === null || b === null || a + b === 0 ? null : (a - b) / (a + b);

export const fmtDate = (iso: string) => iso.slice(0, 10);
