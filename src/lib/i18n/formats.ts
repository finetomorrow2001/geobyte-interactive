import type { Bilingual } from './lang.svelte';

export const formats = {
	ja: {
		title: 'データ形式と処理レベル — Satellite Data Lab',
		h1: '05 データ形式と処理レベル',
		lead: '衛星データは 1 シーンで数百 MB〜数 GB。「全部ダウンロードしてから開く」は破綻します。クラウド時代の形式（COG、Zarr）は <strong>必要な部分だけ HTTP で取りに行ける</strong>ように設計されています。',

		// ---- COG ----
		cogH2: 'COG（Cloud Optimized GeoTIFF）：タイルを Range Request で読む',
		cogFull: 'フル解像度',
		cogOverview: (scale: number) => `Overview ×${scale}`,
		cogHint: 'タイルをクリックして「読みたい範囲」を選択してください（10 m バンド 1 枚を想定）。',
		cogTileAria: (i: number) => `タイル ${i}`,
		cogStatTotal: 'ファイル全体',
		cogStatFetched: '取得バイト数',
		cogStatRequests: 'リクエスト数',
		cogStatSaving: '転送削減率',
		cogReqH3: '発行される HTTP リクエスト',
		cogReqHeaderComment: '# ヘッダ + IFD（タイルの offset/bytecount 表）',
		cogReqPlaceholder: '# ← タイルを選ぶと、その分の Range リクエストが並びます',
		cogReqTileComment: (level: number, i: number) => `# level ${level} tile ${i}`,
		cogNoteStrong: '仕組み：',
		cogNote1:
			'COG は「タイル分割 + オーバービュー (overview) 内蔵 + IFD をファイル先頭に配置」した GeoTIFF。クライアント（GDAL / rasterio / titiler）はまず先頭 16 KB を読んでタイルの位置表を得て、必要なタイルだけ Range で取ります。隣接タイルは 1 リクエストに結合されます。通常の GeoTIFF（ストリップ、オーバービュー無し）でサムネイルを作るには',
		cogNoteAll: (mb: string) => `${mb} 全部`,
		cogNote2: 'を読む必要がありました。',

		// ---- Zarr ----
		zarrH2: 'Zarr：多次元キューブのチャンク設計',
		zarrIntro1: '1 年分・2048×2048 画素・int16 のデータキューブ',
		zarrIntro2: 'を Zarr に保存するとき、チャンク (chunk) 形状をどう切るかで',
		zarrIntroStrong: 'どのアクセスパターンが速いか',
		zarrIntro3: 'が決まります。',
		zarrPresetSpatial: '空間優先 (1, 1024, 1024)',
		zarrPresetBalanced: 'バランス (30, 256, 256)',
		zarrPresetTemporal: '時系列優先 (365, 64, 64)',
		zarrStatChunkSize: 'チャンクサイズ',
		zarrStatChunks: 'チャンク数',
		zarrThQuery: 'クエリ',
		zarrThChunks: '読むチャンク',
		zarrThBytes: '転送量',
		zarrThEff: '有効率',
		zarrQTimeseries: '1 画素の 365 日時系列',
		zarrQFullDay: '1 日の全域 (2048²)',
		zarrQSmallRegion: '30 日 × 256² の小領域',
		zarrNoteStrong: '結論：',
		zarrNote:
			'万能なチャンクは無い。地図タイル配信なら空間優先、地点の時系列解析（NDVI の季節変化など）なら時間優先。両方必要なら 2 コピー持つか、バランス型（1 チャンク数 MB）で妥協する。Zarr は各チャンクが独立オブジェクト（S3 のキー）なので、チャンク数が数百万になるとリスト操作やメタデータ取得がボトルネックになる点にも注意（Zarr v3 のシャーディング (sharding) で緩和）。',

		// ---- 処理レベル ----
		lvH2: '処理レベル (processing level)：何が補正済みか',
		lvThLevel: 'レベル',
		lvThContent: '内容',
		lvThUnit: '単位・値',
		lvThS2: 'Sentinel-2 の例',
		lvThRole: '実務での位置づけ',
		lv0Content: '生テレメトリ（ダウンリンクされたビット列）',
		lv0Unit: 'DN（センサーカウント）',
		lv0S2: '非公開',
		lv0Role: '扱わない',
		lv1abContent: '放射量校正・幾何情報付与（未投影）',
		lv1abUnit: '放射輝度 W/m²/sr/µm',
		lv1abS2: 'L1B（限定公開）',
		lv1abRole: 'センサー研究者向け',
		lv1cContent: '地図投影済み、<strong>大気上端（TOA）反射率</strong>',
		lv1cUnit: '反射率 0〜1（大気込み）',
		lv1cS2: 'L1C（UTM/MGRS タイル）',
		lv1cRole: '雲マスク・自前大気補正をしたい場合',
		lv2aContent: '大気補正済み、<strong>地表（BOA）反射率</strong> + シーン分類（雲・影・雪）',
		lv2aUnit: '反射率 0〜1（地表）',
		lv2aS2: 'L2A（Sen2Cor）、SCL バンド',
		lv2aRole: '<strong>解析の標準スタート地点</strong>',
		lv3Content: '時間合成・モザイク（雲なし月次合成など）',
		lv3Unit: '反射率 / 指標',
		lv3S2: '—（各社・各機関が生成）',
		lv3Role: '広域モニタリングの入力',
		ardContent: '解析準備済みデータ (Analysis Ready Data)：L2 を共通グリッド・共通メタデータで整えたもの（CEOS 定義）',
		ardUnit: '—',
		ardS2: 'Landsat C2 L2、HLS（Landsat+S2 調和）',
		ardRole: 'ミッションをまたぐ時系列に',

		// ---- 光学と SAR ----
		osH2: '光学と SAR：データの意味が違う',
		optH3: '光学（Sentinel-2 / Landsat）',
		opt1: '太陽光の反射 → 昼のみ、雲があると見えない',
		opt2: '値の意味が直感的（色・明るさ）。反射率は物理量',
		opt3: '雲マスク (cloud mask)（SCL / QA バンド）を必ず適用する',
		opt4: '日本の梅雨期は数か月晴天シーンが無いこともある → 時間合成が必須',
		sarH3: 'SAR（Sentinel-1 / ALOS-2）',
		sar1: '自ら電波を出して後方散乱 (backscatter) を測る → 昼夜・雲を問わない',
		sar2: '値は後方散乱係数 σ⁰ [dB]。粗さ・誘電率・幾何で決まり、直感とは違う',
		sar3: 'GRD（振幅のみ）と SLC（位相あり。InSAR 用）で製品が分かれる',
		sar4: '前処理（軌道補正・熱雑音除去・地形補正・スペックル (speckle) 低減）が重い → 処理済み（RTC）製品を探す',

		// ---- Python ----
		pyH2: '実務での読み方（Python）',
		pyCode: `# 環境変数で GDAL の HTTP 読みを最適化（COG を触る前に）
import os
os.environ.update({
    "GDAL_DISABLE_READDIR_ON_OPEN": "EMPTY_DIR",   # 同じディレクトリの一覧取得を抑止
    "CPL_VSIL_CURL_ALLOWED_EXTENSIONS": ".tif,.TIF",
    "GDAL_HTTP_MERGE_CONSECUTIVE_RANGES": "YES",   # 隣接タイルを 1 リクエストに
    "AWS_NO_SIGN_REQUEST": "YES",                  # 公開バケット
})

import rioxarray, xarray as xr
red = rioxarray.open_rasterio(red_href, chunks={"x": 1024, "y": 1024}, overview_level=None)
nir = rioxarray.open_rasterio(nir_href, chunks={"x": 1024, "y": 1024})
scl = rioxarray.open_rasterio(scl_href).rio.reproject_match(red)     # 20 m → 10 m に揃える

# DN → 反射率（Baseline 04.00 以降のオフセットに注意）
red_r = (red - 1000) / 10000
nir_r = (nir - 1000) / 10000
ndvi = (nir_r - red_r) / (nir_r + red_r)
ndvi = ndvi.where(scl.isin([4, 5, 6, 7, 11]))    # 植生・裸地・水・未分類・雪 のみ残す（雲 8,9,10 と影 3 を除外）

# 多シーンを時間軸で束ねて Zarr に（odc-stac / stackstac）
import odc.stac
ds = odc.stac.load(items, bands=["red", "nir", "scl"], chunks={"time": 1, "x": 2048, "y": 2048}, resolution=10)
ds.to_zarr("s3://my-bucket/s2_tokyo_2026.zarr", mode="w")`
	},
	en: {
		title: 'Data formats and processing levels — Satellite Data Lab',
		h1: '05 Data formats and processing levels',
		lead: 'A single satellite scene is hundreds of MB to several GB. “Download everything, then open it” does not scale. Cloud-native formats (COG, Zarr) are designed so that you <strong>fetch only the parts you need over HTTP</strong>.',

		// ---- COG ----
		cogH2: 'COG (Cloud Optimized GeoTIFF): reading tiles with Range requests',
		cogFull: 'Full resolution',
		cogOverview: (scale: number) => `Overview ×${scale}`,
		cogHint: 'Click tiles to select the area you want to read (assumes one 10 m band).',
		cogTileAria: (i: number) => `tile ${i}`,
		cogStatTotal: 'Whole file',
		cogStatFetched: 'Bytes fetched',
		cogStatRequests: 'Requests',
		cogStatSaving: 'Transfer saved',
		cogReqH3: 'HTTP requests issued',
		cogReqHeaderComment: '# header + IFD (tile offset/bytecount table)',
		cogReqPlaceholder: '# ← select tiles and their Range requests will appear here',
		cogReqTileComment: (level: number, i: number) => `# level ${level} tile ${i}`,
		cogNoteStrong: 'How it works:',
		cogNote1:
			'A COG is a GeoTIFF that is tiled, has built-in overviews, and stores the IFD at the start of the file. A client (GDAL / rasterio / titiler) first reads the leading 16 KB to get the tile offset table, then fetches only the tiles it needs with Range requests. Adjacent tiles are merged into one request. To build a thumbnail from a plain GeoTIFF (strips, no overviews) you had to read ',
		cogNoteAll: (mb: string) => `the entire ${mb}`,
		cogNote2: '.',

		// ---- Zarr ----
		zarrH2: 'Zarr: chunk design for multidimensional cubes',
		zarrIntro1: 'When you store a one-year, 2048×2048-pixel int16 data cube',
		zarrIntro2: 'in Zarr, the chunk shape decides',
		zarrIntroStrong: 'which access pattern is fast',
		zarrIntro3: '.',
		zarrPresetSpatial: 'Spatial-first (1, 1024, 1024)',
		zarrPresetBalanced: 'Balanced (30, 256, 256)',
		zarrPresetTemporal: 'Time-series-first (365, 64, 64)',
		zarrStatChunkSize: 'Chunk size',
		zarrStatChunks: 'Chunks',
		zarrThQuery: 'Query',
		zarrThChunks: 'Chunks read',
		zarrThBytes: 'Transferred',
		zarrThEff: 'Useful ratio',
		zarrQTimeseries: '365-day series of 1 pixel',
		zarrQFullDay: 'Full extent (2048²) for 1 day',
		zarrQSmallRegion: '30 days × 256² region',
		zarrNoteStrong: 'Takeaway:',
		zarrNote:
			'There is no universal chunk shape. Spatial-first for map-tile serving; time-first for per-point time-series analysis (e.g. seasonal NDVI). If you need both, keep two copies or compromise with a balanced layout (a few MB per chunk). Because every Zarr chunk is an independent object (an S3 key), millions of chunks make listing and metadata access the bottleneck (mitigated by sharding in Zarr v3).',

		// ---- Processing levels ----
		lvH2: 'Processing levels: what has been corrected',
		lvThLevel: 'Level',
		lvThContent: 'Content',
		lvThUnit: 'Unit / values',
		lvThS2: 'Sentinel-2 example',
		lvThRole: 'Role in practice',
		lv0Content: 'Raw telemetry (downlinked bit stream)',
		lv0Unit: 'DN (sensor counts)',
		lv0S2: 'Not public',
		lv0Role: 'Not used',
		lv1abContent: 'Radiometric calibration, geometry attached (not projected)',
		lv1abUnit: 'Radiance W/m²/sr/µm',
		lv1abS2: 'L1B (limited release)',
		lv1abRole: 'For sensor researchers',
		lv1cContent: 'Map-projected, <strong>top-of-atmosphere (TOA) reflectance</strong>',
		lv1cUnit: 'Reflectance 0–1 (incl. atmosphere)',
		lv1cS2: 'L1C (UTM/MGRS tiles)',
		lv1cRole: 'When you want your own cloud mask or atmospheric correction',
		lv2aContent: 'Atmospherically corrected, <strong>surface (BOA) reflectance</strong> + scene classification (cloud, shadow, snow)',
		lv2aUnit: 'Reflectance 0–1 (surface)',
		lv2aS2: 'L2A (Sen2Cor), SCL band',
		lv2aRole: '<strong>Standard starting point for analysis</strong>',
		lv3Content: 'Temporal composites and mosaics (e.g. cloud-free monthly composite)',
		lv3Unit: 'Reflectance / indices',
		lv3S2: '— (produced by vendors and agencies)',
		lv3Role: 'Input for wide-area monitoring',
		ardContent: 'Analysis Ready Data: L2 harmonised onto a common grid with common metadata (CEOS definition)',
		ardUnit: '—',
		ardS2: 'Landsat C2 L2, HLS (harmonised Landsat + S2)',
		ardRole: 'For time series across missions',

		// ---- Optical vs SAR ----
		osH2: 'Optical vs SAR: the data mean different things',
		optH3: 'Optical (Sentinel-2 / Landsat)',
		opt1: 'Reflected sunlight → daytime only, blocked by cloud',
		opt2: 'Values are intuitive (colour, brightness); reflectance is a physical quantity',
		opt3: 'Always apply the cloud mask (SCL / QA band)',
		opt4: 'Japan’s rainy season can leave months without a clear scene → temporal compositing is essential',
		sarH3: 'SAR (Sentinel-1 / ALOS-2)',
		sar1: 'Emits its own microwaves and measures backscatter → works day or night, through cloud',
		sar2: 'Values are backscatter coefficient σ⁰ [dB], driven by roughness, dielectric constant and geometry — not intuitive',
		sar3: 'Products split into GRD (amplitude only) and SLC (with phase, for InSAR)',
		sar4: 'Heavy preprocessing (orbit correction, thermal-noise removal, terrain correction, speckle filtering) → look for processed (RTC) products',

		// ---- Python ----
		pyH2: 'Reading in practice (Python)',
		pyCode: `# Tune GDAL's HTTP reads via environment variables (before touching a COG)
import os
os.environ.update({
    "GDAL_DISABLE_READDIR_ON_OPEN": "EMPTY_DIR",   # don't list the containing directory
    "CPL_VSIL_CURL_ALLOWED_EXTENSIONS": ".tif,.TIF",
    "GDAL_HTTP_MERGE_CONSECUTIVE_RANGES": "YES",   # merge adjacent tiles into one request
    "AWS_NO_SIGN_REQUEST": "YES",                  # public bucket
})

import rioxarray, xarray as xr
red = rioxarray.open_rasterio(red_href, chunks={"x": 1024, "y": 1024}, overview_level=None)
nir = rioxarray.open_rasterio(nir_href, chunks={"x": 1024, "y": 1024})
scl = rioxarray.open_rasterio(scl_href).rio.reproject_match(red)     # align 20 m → 10 m

# DN → reflectance (mind the offset since Baseline 04.00)
red_r = (red - 1000) / 10000
nir_r = (nir - 1000) / 10000
ndvi = (nir_r - red_r) / (nir_r + red_r)
ndvi = ndvi.where(scl.isin([4, 5, 6, 7, 11]))    # keep vegetation, bare, water, unclassified, snow (drop cloud 8,9,10 and shadow 3)

# Stack many scenes along time into Zarr (odc-stac / stackstac)
import odc.stac
ds = odc.stac.load(items, bands=["red", "nir", "scl"], chunks={"time": 1, "x": 2048, "y": 2048}, resolution=10)
ds.to_zarr("s3://my-bucket/s2_tokyo_2026.zarr", mode="w")`
	}
} satisfies Bilingual;
