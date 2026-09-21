import type { LText } from './i18n/lang.svelte';

export type Module = {
	path: string;
	title: LText;
	summary: LText;
	keywords: string[];
};

export const modules: Module[] = [
	{
		path: '/orbits',
		title: { ja: '軌道と再訪周期', en: 'Orbits & Revisit' },
		summary: {
			ja: '高度・観測幅 (swath) から周期・再訪日数・太陽同期軌道の傾斜角を計算。なぜ地球観測衛星は高度 500〜800 km に集まるのかを体感する。',
			en: 'Compute period, revisit time and sun-synchronous inclination from altitude and swath. Feel why Earth-observation satellites cluster at 500–800 km.'
		},
		keywords: ['LEO', 'SSO', 'GEO', 'Kepler', 'Swath']
	},
	{
		path: '/spectral',
		title: { ja: 'スペクトルと指標', en: 'Spectra & Indices' },
		summary: {
			ja: 'Sentinel-2 のバンド構成と地物ごとの反射スペクトル。NDVI などの正規化指標を自分で組み立て、合成シーンでバンド合成を試す。',
			en: 'Sentinel-2 bands and reflectance spectra of land covers. Build normalized indices like NDVI yourself and try band composites on a synthetic scene.'
		},
		keywords: ['Sentinel-2', 'NDVI', 'NDWI', 'NBR', 'False Color']
	},
	{
		path: '/resolution',
		title: { ja: '分解能のトレードオフ', en: 'Resolution Trade-offs' },
		summary: {
			ja: '空間・時間・スペクトル・放射分解能の 4 軸。GSD とビット深度をスライダーで変えて画像がどう劣化するかを確認する。',
			en: 'Four axes: spatial, temporal, spectral and radiometric resolution. Slide GSD and bit depth to see how an image degrades.'
		},
		keywords: ['GSD', 'Bit depth', 'Swath', 'Missions']
	},
	{
		path: '/stac',
		title: { ja: 'STAC でデータ取得', en: 'Finding Data with STAC' },
		summary: {
			ja: 'STAC API のクエリをフォームで組み立て、Earth Search（AWS）に実際にリクエストを送ってシーン一覧とサムネイルを取得する。',
			en: 'Build a STAC API query in a form and send it to Earth Search (AWS) to fetch real scene lists and thumbnails.'
		},
		keywords: ['STAC', 'Earth Search', 'pystac-client', 'COG']
	},
	{
		path: '/formats',
		title: { ja: 'データ形式と処理レベル', en: 'Formats & Processing Levels' },
		summary: {
			ja: 'COG のタイル／オーバービューと HTTP Range Request、Zarr のチャンク、L0〜L2 と ARD の違いを図で理解する。',
			en: 'COG tiles/overviews and HTTP range requests, Zarr chunks, and the difference between L0–L2 and ARD, explained with diagrams.'
		},
		keywords: ['COG', 'Zarr', 'L1C/L2A', 'ARD', 'SAR']
	},
	{
		path: '/imagery',
		title: { ja: '実画像を見る', en: 'Real Imagery' },
		summary: {
			ja: 'Sentinel-2 の実データを、ブラウザが COG を直接読んで 3D 地図上にレンダリング。バンド合成・NDVI 等の指標・2 時期のスワイプ比較・クリック地点の DN と時系列、実 TLE による衛星のリアルタイム軌道と次回撮影の予測。',
			en: 'Real Sentinel-2 data rendered on a 3D map by reading COGs directly in the browser. Composites, NDVI and other indices, two-date swipe comparison, per-pixel DN and time series, plus live satellite orbits from real TLEs and next-acquisition prediction.'
		},
		keywords: ['MapLibre GL', 'geotiff.js', 'COG', 'NDVI', '3D', 'TLE']
	}
];
