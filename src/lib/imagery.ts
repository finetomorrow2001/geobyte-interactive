import type { Job, TileJob, PointJob } from './cog.worker';
import type { LText } from './i18n/lang.svelte';

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
	name: LText;
	assets: string[];
	/** DN の表示レンジ上限（0..max を 0..255 に）。visual は 8bit なので不要 */
	rescaleMax?: number;
	desc: LText;
};

/** Earth Search sentinel-2-l2a のアセット名でのバンド合成 */
export const composites: Composite[] = [
	{
		id: 'tci',
		name: { ja: 'トゥルーカラー (TCI)', en: 'True color (TCI)' },
		assets: ['visual'],
		desc: { ja: 'ESA が生成した 8bit の真色画像。1 ファイル 3 バンドなので最も速い。', en: '8-bit true-color image produced by ESA. Three bands in one file, so it is the fastest.' }
	},
	{
		id: 'rgb',
		name: { ja: 'トゥルーカラー (自前)', en: 'True color (custom)' },
		assets: ['red', 'green', 'blue'],
		rescaleMax: 3000,
		desc: { ja: 'B4/B3/B2 を自分でストレッチ。ゲインを変えて暗部を持ち上げられる。', en: 'B4/B3/B2 stretched by us. Change the gain to lift the shadows.' }
	},
	{
		id: 'fc',
		name: { ja: 'フォールスカラー (NIR)', en: 'False color (NIR)' },
		assets: ['nir', 'red', 'green'],
		rescaleMax: 4000,
		desc: { ja: 'B8/B4/B3。植生が赤く、水が黒く出る。', en: 'B8/B4/B3. Vegetation appears red, water black.' }
	},
	{
		id: 'swir',
		name: { ja: 'SWIR 合成', en: 'SWIR composite' },
		assets: ['swir22', 'nir08', 'red'],
		rescaleMax: 4000,
		desc: { ja: 'B12/B8A/B4。焼失跡・裸地が赤紫、植生が緑。雲は白、雪は青。', en: 'B12/B8A/B4. Burn scars and bare soil magenta, vegetation green. Clouds white, snow blue.' }
	},
	{
		id: 'agri',
		name: { ja: '農業', en: 'Agriculture' },
		assets: ['swir16', 'nir', 'blue'],
		rescaleMax: 4000,
		desc: { ja: 'B11/B8/B2。作物の活性が鮮やかな緑。', en: 'B11/B8/B2. Crop vigour shows as vivid green.' }
	},
	{
		id: 'urban',
		name: { ja: '都市', en: 'Urban' },
		assets: ['swir22', 'swir16', 'red'],
		rescaleMax: 4000,
		desc: { ja: 'B12/B11/B4。建物・裸地が明るく、植生は暗い緑。', en: 'B12/B11/B4. Buildings and bare soil bright, vegetation dark green.' }
	}
];

export type IndexDef = {
	id: string;
	name: LText;
	/** (b1 - b2) / (b1 + b2) */
	b1: string;
	b2: string;
	colormap: string;
	desc: LText;
};

export const indices: IndexDef[] = [
	{
		id: 'ndvi',
		name: { ja: 'NDVI 植生', en: 'NDVI vegetation' },
		b1: 'nir',
		b2: 'red',
		colormap: 'rdylgn',
		desc: { ja: '緑 = 密な植生、黄 = 裸地・都市・雲、赤 = 水・雲影。', en: 'Green = dense vegetation, yellow = bare soil / urban / cloud, red = water / cloud shadow.' }
	},
	{
		id: 'ndwi',
		name: { ja: 'NDWI 水域', en: 'NDWI water' },
		b1: 'green',
		b2: 'nir',
		colormap: 'blues',
		desc: { ja: '濃い青 = 水。0 以上を水域とみなすのが目安。', en: 'Dark blue = water. Values above 0 are a rule-of-thumb water mask.' }
	},
	{
		id: 'ndmi',
		name: { ja: 'NDMI 植生水分', en: 'NDMI moisture' },
		b1: 'nir08',
		b2: 'swir16',
		colormap: 'brbg',
		desc: { ja: '青緑 = 水分が多い植生、茶 = 乾燥。', en: 'Teal = moist vegetation, brown = dry.' }
	},
	{
		id: 'nbr',
		name: { ja: 'NBR 焼失', en: 'NBR burn' },
		b1: 'nir',
		b2: 'swir22',
		colormap: 'rdylgn',
		desc: { ja: '火災前後で差分 (dNBR) を取ると被害域が出る。', en: 'Difference the pre- and post-fire scenes (dNBR) to map the burned area.' }
	},
	{
		id: 'ndsi',
		name: { ja: 'NDSI 雪', en: 'NDSI snow' },
		b1: 'green',
		b2: 'swir16',
		colormap: 'blues',
		desc: { ja: '0.4 以上で雪。雲は SWIR でも明るいので分離できる。', en: 'Above 0.4 is snow. Clouds stay bright in SWIR, so they separate.' }
	},
	{
		id: 'ndbi',
		name: { ja: 'NDBI 都市', en: 'NDBI built-up' },
		b1: 'swir16',
		b2: 'nir',
		colormap: 'magma',
		desc: { ja: '明るい = 建物・裸地。NDVI とほぼ逆符号。', en: 'Bright = buildings / bare soil. Roughly the opposite sign of NDVI.' }
	}
];

export type Place = { id: string; name: LText; center: [number, number]; zoom: number; hint: LText };

export const places: Place[] = [
	{ id: 'tokyo', name: { ja: '東京', en: 'Tokyo' }, center: [35.68, 139.75], zoom: 11, hint: { ja: '都市 vs 皇居・多摩の緑', en: 'City vs. the greenery of the Imperial Palace and Tama' } },
	{ id: 'fuji', name: { ja: '富士山', en: 'Mt. Fuji' }, center: [35.36, 138.73], zoom: 11, hint: { ja: '雪と雲を NDSI / SWIR で見分ける', en: 'Separate snow from cloud with NDSI / SWIR' } },
	{ id: 'biwa', name: { ja: '琵琶湖', en: 'Lake Biwa' }, center: [35.25, 136.05], zoom: 10, hint: { ja: 'NDWI で水域抽出', en: 'Extract water with NDWI' } },
	{ id: 'tokachi', name: { ja: '十勝平野', en: 'Tokachi Plain' }, center: [42.9, 143.2], zoom: 10, hint: { ja: '農地のパターン、季節変化', en: 'Field patterns and seasonal change' } },
	{ id: 'aso', name: { ja: '阿蘇', en: 'Aso' }, center: [32.88, 131.1], zoom: 11, hint: { ja: 'カルデラの草原・火山地形', en: 'Caldera grassland and volcanic terrain' } },
	{ id: 'ishigaki', name: { ja: '石垣島', en: 'Ishigaki Island' }, center: [24.4, 124.2], zoom: 11, hint: { ja: 'サンゴ礁・浅海の色', en: 'Coral reefs and shallow-water colour' } }
];

export type RenderMode = { kind: 'composite'; id: string } | { kind: 'index'; id: string };

/** 描画に使うアセット名の一覧 */
export function assetsFor(mode: RenderMode): string[] {
	if (mode.kind === 'composite') return composites.find((c) => c.id === mode.id)!.assets;
	const ix = indices.find((i) => i.id === mode.id)!;
	return [ix.b1, ix.b2];
}

const epsgOf = (item: StacItem) => item.properties['proj:epsg'] ?? 32654;

// ---- Worker プール ----
// 取得・デコード・再投影・合成はすべて Worker 内で行い、メインスレッドは描画だけ。
// 隣接する地図タイルは同じ COG 内部タイルを共有するので、2×2 ブロック単位で同じ Worker に割り当てて
// Worker ごとのキャッシュが効くようにする。
type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };
let workers: Worker[] | null = null;
const pending = new Map<number, Pending>();
let nextId = 1;
const workerRequests: number[] = [];

/** 全 Worker が発行した COG への HTTP リクエスト数の合計 */
export const cogRequestCount = () => workerRequests.reduce((a, b) => a + b, 0);

function getWorkers(): Worker[] {
	if (workers) return workers;
	const n = Math.max(2, Math.min(4, (navigator.hardwareConcurrency || 4) - 1));
	workers = Array.from({ length: n }, (_, i) => {
		const w = new Worker(new URL('./cog.worker.ts', import.meta.url), { type: 'module' });
		w.onmessage = (e: MessageEvent<{ id: number; rgba?: Uint8ClampedArray; values?: (number | null)[]; error?: string; requests: number }>) => {
			workerRequests[i] = e.data.requests;
			const p = pending.get(e.data.id);
			if (!p) return;
			pending.delete(e.data.id);
			if (e.data.error) p.reject(new Error(e.data.error));
			else p.resolve(e.data.rgba ?? e.data.values);
		};
		return w;
	});
	return workers;
}

function submit<T>(job: Omit<Job, 'id'>, slot: number): Promise<T> {
	const ws = getWorkers();
	const id = nextId++;
	return new Promise<T>((resolve, reject) => {
		pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
		ws[slot % ws.length].postMessage({ ...job, id });
	});
}

/**
 * Web メルカトルタイル 1 枚を描く（Worker 内で COG から必要なウィンドウだけ Range Request で読む）。
 * 戻り値は size*size の RGBA。
 */
export async function renderTile(item: StacItem, mode: RenderMode, gain: number, z: number, x: number, y: number, size = 256): Promise<Uint8ClampedArray<ArrayBuffer>> {
	const epsg = epsgOf(item);
	const slot = ((x >> 1) * 31 + (y >> 1)) >>> 0;
	let job: Omit<TileJob, 'id'>;
	if (mode.kind === 'composite') {
		const c = composites.find((v) => v.id === mode.id)!;
		job = { kind: 'tile', epsg, z, x, y, size, gain, mode: 'composite', hrefs: c.assets.map((a) => item.assets[a].href), rescaleMax: c.rescaleMax };
	} else {
		const ix = indices.find((v) => v.id === mode.id)!;
		job = { kind: 'tile', epsg, z, x, y, size, gain, mode: 'index', hrefs: [item.assets[ix.b1].href, item.assets[ix.b2].href], cmap: ix.colormap };
	}
	return submit<Uint8ClampedArray<ArrayBuffer>>(job, slot);
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

/** 1 地点の各アセット DN を、COG からフル解像度で直接読む（Worker 経由） */
export async function pointValues(item: StacItem, lon: number, lat: number, assets: string[]): Promise<Record<string, number | null>> {
	const job: Omit<PointJob, 'id'> = { kind: 'point', epsg: epsgOf(item), lon, lat, hrefs: assets.map((a) => item.assets[a].href) };
	// 地点クエリは 1 つの Worker に集約してヘッダのキャッシュを共有
	const vals = await submit<(number | null)[]>(job, 0);
	return Object.fromEntries(assets.map((a, i) => [a, vals[i]]));
}

export const normDiff = (a: number | null, b: number | null) =>
	a === null || b === null || a + b === 0 ? null : (a - b) / (a + b);

export const fmtDate = (iso: string) => iso.slice(0, 10);
