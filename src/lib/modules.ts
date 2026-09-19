export type Module = {
	path: string;
	title: string;
	summary: string;
	keywords: string[];
};

export const modules: Module[] = [
	{
		path: '/orbits',
		title: '軌道と再訪周期',
		summary:
			'高度・観測幅から周期・再訪日数・太陽同期軌道の傾斜角を計算。なぜ地球観測衛星は高度500〜800kmに集まるのかを体感する。',
		keywords: ['LEO', 'SSO', 'GEO', 'ケプラーの第3法則', 'スワス']
	},
	{
		path: '/spectral',
		title: 'スペクトルと指標',
		summary:
			'Sentinel-2 のバンド構成と地物ごとの反射スペクトル。NDVI などの正規化指標を自分で組み立て、合成シーンでバンド合成を試す。',
		keywords: ['Sentinel-2', 'NDVI', 'NDWI', 'NBR', 'False Color']
	},
	{
		path: '/resolution',
		title: '分解能のトレードオフ',
		summary:
			'空間・時間・スペクトル・放射分解能の 4 軸。GSD とビット深度をスライダーで変えて画像がどう劣化するかを確認する。',
		keywords: ['GSD', 'ビット深度', 'スワス', 'ミッション比較']
	},
	{
		path: '/stac',
		title: 'STAC でデータ取得',
		summary:
			'STAC API のクエリをフォームで組み立て、Earth Search（AWS）に実際にリクエストを送ってシーン一覧とサムネイルを取得する。',
		keywords: ['STAC', 'Earth Search', 'pystac-client', 'COG']
	},
	{
		path: '/formats',
		title: 'データ形式と処理レベル',
		summary:
			'COG のタイル／オーバービューと HTTP Range Request、Zarr のチャンク、L0〜L2 と ARD の違いを図で理解する。',
		keywords: ['COG', 'Zarr', 'L1C/L2A', 'ARD', 'SAR']
	},
	{
		path: '/imagery',
		title: '実画像を見る',
		summary:
			'Sentinel-2 の実データを、ブラウザが COG を直接読んで地図上にレンダリング。バンド合成・NDVI 等の指標・2 時期のスワイプ比較・クリック地点の DN と時系列。',
		keywords: ['Leaflet', 'geotiff.js', 'COG', 'NDVI', '時系列']
	}
];
