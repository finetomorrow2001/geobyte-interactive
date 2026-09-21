import type { Bilingual } from './lang.svelte';

export const stac = {
	ja: {
		title: 'STAC でデータ取得 — Satellite Data Lab',
		h1: '04 STAC でデータ取得',
		lead1:
			'<strong>STAC（SpatioTemporal Asset Catalog）</strong>は、衛星シーンを「いつ・どこ・どのファイル」で統一的に記述する JSON 仕様です。提供元が違っても同じクエリで検索でき、結果の <code>assets</code> に COG の URL が入っています。',
		lead2a: 'ここでは AWS 上の公開カタログ ',
		lead2b: ' に実際にクエリを送ります。',

		// collections / places
		colS2L2A: 'Sentinel-2 L2A（地表反射率）',
		colS2C1: 'Sentinel-2 Collection 1 L2A',
		colLandsat: 'Landsat Collection 2 Level-2',
		colS1GRD: 'Sentinel-1 GRD（SAR）',
		colDEM: 'Copernicus DEM 30 m',
		placeTokyo: '東京',
		placeOsaka: '大阪',
		placeSapporo: '札幌',
		placeFukuoka: '福岡',
		placeFuji: '富士山',

		// query panel
		queryTitle: 'クエリを組む',
		queryCollection: 'コレクション (collection)',
		queryBbox: '範囲 (bbox)',
		bboxW: '西経度',
		bboxS: '南緯度',
		bboxE: '東経度',
		bboxN: '北緯度',
		dateFrom: '開始日',
		dateTo: '終了日',
		cloudMax: '雲量上限 (cloud cover) ',
		limitLabel: '取得件数 (limit)',
		searching: '検索中…',
		searchBtn: 'Earth Search に問い合わせる',

		// JSON panel
		jsonTitle: (api: string) => `送信される JSON（POST ${api}/search）`,
		jsonNote:
			'<code>datetime</code> は RFC 3339 の区間、<code>query</code> はプロパティへのフィルタ（新しい API では CQL2 の <code>filter</code> も使えます）。ページングは応答の <code>links[rel=next]</code> を辿ります。',

		// results
		errorLabel: 'エラー：',
		resultsTitle: '結果',
		resultsSummary: (matched: string, shown: number, ms: number) => `— 該当 ${matched} 件中 ${shown} 件を表示（${ms} ms）`,
		noResults: '条件に合うシーンがありません。雲量上限を上げるか期間を広げてください。SAR や DEM は雲量フィルタがないため通常ヒットします。',
		cloudPct: (v: string) => `雲 ${v}%`,
		assetsTitle: (id: string, n: number) => `${id} の assets（${n} 個）`,
		viewOnMap: '🗺 このシーンを地図で見る →',
		assetsNote: 'STAC Item の本体。1 シーン = 複数ファイル（バンドごとの COG、メタデータ、サムネイル）で構成されています。',
		showProps: 'properties を表示',

		// code
		codeTitle: '同じクエリをコードで',
		pyComment1: '# COG を必要な範囲だけ読む（rasterio + ウィンドウ読み）',
		pyComment2: '# HTTP Range Request で該当タイルだけ取得される',

		// structure
		structTitle: 'STAC の構造',
		structure: `Catalog（入口。/ で GET）
 └─ Collection（ミッション・製品単位。/collections/sentinel-2-l2a）
     ├─ 共通メタデータ: 期間・範囲・ライセンス・バンド定義 (eo:bands)・summaries
     └─ Item（1 シーン = GeoJSON Feature。/collections/{id}/items/{item_id}）
         ├─ geometry / bbox        : 撮像範囲
         ├─ properties.datetime    : 撮像時刻（UTC）
         ├─ properties.eo:cloud_cover, proj:epsg, view:sun_elevation, ... : 拡張で定義
         └─ assets                 : { "red": {href: "s3://.../B04.tif", type: "image/tiff; ...cloud-optimized"}, ... }

/search (POST)  … Item を横断検索。bbox / datetime / collections / query / filter(CQL2) / sortby / limit`,
		tips:
			'<strong>実務のコツ：</strong> ① <code>numberMatched</code> を見て件数感を掴んでから <code>limit</code> を上げる。② 同じ日付に複数タイル（MGRS グリッド）が返るので、<code>grid:code</code> か <code>proj:epsg</code> でグルーピングする。③ assets の href は <code>s3://</code> のこともあり、その場合 <code>alternate</code> の HTTPS URL や requester-pays 設定を確認する。④ 主要な公開 STAC：Earth Search（AWS）、Microsoft Planetary Computer、Copernicus Data Space、USGS Landsat Look、JAXA の G-Portal（一部）。'
	},
	en: {
		title: 'Fetching data with STAC — Satellite Data Lab',
		h1: '04 Fetching data with STAC',
		lead1:
			'<strong>STAC (SpatioTemporal Asset Catalog)</strong> is a JSON spec that describes satellite scenes uniformly by when, where and which files. The same query works across providers, and the <code>assets</code> in each result hold the COG URLs.',
		lead2a: 'Here we send real queries to ',
		lead2b: ', a public catalog on AWS.',

		// collections / places
		colS2L2A: 'Sentinel-2 L2A (surface reflectance)',
		colS2C1: 'Sentinel-2 Collection 1 L2A',
		colLandsat: 'Landsat Collection 2 Level-2',
		colS1GRD: 'Sentinel-1 GRD (SAR)',
		colDEM: 'Copernicus DEM 30 m',
		placeTokyo: 'Tokyo',
		placeOsaka: 'Osaka',
		placeSapporo: 'Sapporo',
		placeFukuoka: 'Fukuoka',
		placeFuji: 'Mt. Fuji',

		// query panel
		queryTitle: 'Build the query',
		queryCollection: 'Collection',
		queryBbox: 'Extent (bbox)',
		bboxW: 'West lon',
		bboxS: 'South lat',
		bboxE: 'East lon',
		bboxN: 'North lat',
		dateFrom: 'Start date',
		dateTo: 'End date',
		cloudMax: 'Max cloud cover ',
		limitLabel: 'Max items (limit)',
		searching: 'Searching…',
		searchBtn: 'Query Earth Search',

		// JSON panel
		jsonTitle: (api: string) => `Request JSON (POST ${api}/search)`,
		jsonNote:
			'<code>datetime</code> is an RFC 3339 interval; <code>query</code> filters on properties (newer APIs also accept a CQL2 <code>filter</code>). To page through results, follow <code>links[rel=next]</code> in the response.',

		// results
		errorLabel: 'Error:',
		resultsTitle: 'Results',
		resultsSummary: (matched: string, shown: number, ms: number) => `— showing ${shown} of ${matched} matched (${ms} ms)`,
		noResults: 'No scenes match. Raise the cloud cover limit or widen the date range. SAR and DEM collections have no cloud filter and usually return results.',
		cloudPct: (v: string) => `cloud ${v}%`,
		assetsTitle: (id: string, n: number) => `Assets of ${id} (${n})`,
		viewOnMap: '🗺 View this scene on the map →',
		assetsNote: 'The body of a STAC Item. One scene = many files (a COG per band, metadata, thumbnail).',
		showProps: 'Show properties',

		// code
		codeTitle: 'The same query in code',
		pyComment1: '# Read only the needed window of the COG (rasterio + windowed read)',
		pyComment2: '# Only the relevant tiles are fetched via HTTP Range Requests',

		// structure
		structTitle: 'STAC structure',
		structure: `Catalog (entry point; GET /)
 └─ Collection (one per mission/product; /collections/sentinel-2-l2a)
     ├─ shared metadata: temporal/spatial extent, license, band definitions (eo:bands), summaries
     └─ Item (one scene = GeoJSON Feature; /collections/{id}/items/{item_id})
         ├─ geometry / bbox        : footprint
         ├─ properties.datetime    : acquisition time (UTC)
         ├─ properties.eo:cloud_cover, proj:epsg, view:sun_elevation, ... : defined by extensions
         └─ assets                 : { "red": {href: "s3://.../B04.tif", type: "image/tiff; ...cloud-optimized"}, ... }

/search (POST)  … search Items across collections: bbox / datetime / collections / query / filter(CQL2) / sortby / limit`,
		tips:
			'<strong>Practical tips:</strong> 1. Check <code>numberMatched</code> to gauge the result size before raising <code>limit</code>. 2. Several tiles (MGRS grid) come back for the same date, so group by <code>grid:code</code> or <code>proj:epsg</code>. 3. Asset hrefs may be <code>s3://</code>; then look for an HTTPS URL under <code>alternate</code> or check requester-pays settings. 4. Major public STACs: Earth Search (AWS), Microsoft Planetary Computer, Copernicus Data Space, USGS Landsat Look, JAXA G-Portal (partial).'
	}
} satisfies Bilingual;
