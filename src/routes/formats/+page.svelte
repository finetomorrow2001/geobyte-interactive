<script lang="ts">
	import { noise } from '$lib/spectral';

	// ---- COG シミュレータ ----
	// 10980 x 10980 px の Sentinel-2 バンド（10 m）を想定し、512 px タイル、オーバービュー 4 段
	const FULL = 10980;
	const TILE = 512;
	const levels = [0, 1, 2, 3, 4].map((lv) => {
		const size = Math.ceil(FULL / 2 ** lv);
		const n = Math.ceil(size / TILE);
		return { lv, size, n, scale: 2 ** lv };
	});
	const HEADER = 16 * 1024;
	// タイルのバイトサイズ（LZW/Deflate で 16bit → 平均 300 KB 程度、ばらつきあり）
	const tileBytes = (lv: number, i: number) => Math.round(220_000 + noise(lv * 100_003 + i) * 180_000);
	// GDAL の COG 配置：ヘッダ → 小さいオーバービューから順に → フル解像度
	const layout = (() => {
		let offset = HEADER;
		const map = new Map<string, { start: number; end: number }>();
		for (const l of [...levels].reverse()) {
			for (let i = 0; i < l.n * l.n; i++) {
				const b = tileBytes(l.lv, i);
				map.set(`${l.lv}:${i}`, { start: offset, end: offset + b - 1 });
				offset += b;
			}
		}
		return { map, total: offset };
	})();

	let level = $state(0);
	let selected = $state<Set<number>>(new Set());
	const cur = $derived(levels[level]);
	const gridPx = $derived(Math.min(360, cur.n * 40));

	function toggle(i: number) {
		const s = new Set(selected);
		if (s.has(i)) s.delete(i);
		else s.add(i);
		selected = s;
	}
	function setLevel(lv: number) {
		level = lv;
		selected = new Set();
	}
	const ranges = $derived(
		[...selected]
			.sort((a, b) => a - b)
			.map((i) => ({ i, ...layout.map.get(`${level}:${i}`)! }))
	);
	const fetched = $derived(HEADER + ranges.reduce((s, r) => s + (r.end - r.start + 1), 0));
	const fmtMB = (b: number) => (b / 1024 / 1024).toFixed(2) + ' MB';

	// ---- Zarr チャンクシミュレータ ----
	const cube = { t: 365, y: 2048, x: 2048 };
	const chunkPresets = [
		{ name: '空間優先 (1, 1024, 1024)', t: 1, y: 1024, x: 1024 },
		{ name: 'バランス (30, 256, 256)', t: 30, y: 256, x: 256 },
		{ name: '時系列優先 (365, 64, 64)', t: 365, y: 64, x: 64 }
	];
	let chunkIdx = $state(1);
	const chunk = $derived(chunkPresets[chunkIdx]);
	const chunkBytes = $derived(chunk.t * chunk.y * chunk.x * 2);
	const nChunks = $derived(Math.ceil(cube.t / chunk.t) * Math.ceil(cube.y / chunk.y) * Math.ceil(cube.x / chunk.x));
	// クエリ A: 1 地点の 1 年時系列 / クエリ B: 1 日の全域 / クエリ C: 1 か月 × 256x256
	const q = $derived([
		{ name: '1 画素の 365 日時系列', chunks: Math.ceil(cube.t / chunk.t), useful: 365 * 2 },
		{ name: '1 日の全域 (2048²)', chunks: Math.ceil(cube.y / chunk.y) * Math.ceil(cube.x / chunk.x), useful: 2048 * 2048 * 2 },
		{ name: '30 日 × 256² の小領域', chunks: Math.ceil(30 / chunk.t + (30 % chunk.t ? 0 : 0)) * Math.ceil(256 / chunk.y) * Math.ceil(256 / chunk.x), useful: 30 * 256 * 256 * 2 }
	]);
</script>

<svelte:head>
	<title>データ形式と処理レベル — Satellite Data Lab</title>
</svelte:head>

<h1>05 データ形式と処理レベル</h1>
<p class="muted">
	衛星データは 1 シーンで数百 MB〜数 GB。「全部ダウンロードしてから開く」は破綻します。
	クラウド時代の形式（COG、Zarr）は <strong>必要な部分だけ HTTP で取りに行ける</strong>ように設計されています。
</p>

<h2>COG（Cloud Optimized GeoTIFF）：タイルを Range Request で読む</h2>
<div class="grid cols-2">
	<div class="panel">
		<div class="btn-row">
			{#each levels as l (l.lv)}
				<button class="ghost" class:active={level === l.lv} onclick={() => setLevel(l.lv)}>
					{l.lv === 0 ? 'フル解像度' : `Overview ×${l.scale}`} <span class="muted" style="font-size: 0.75rem">{l.size}px / {l.n}×{l.n}</span>
				</button>
			{/each}
		</div>
		<p class="muted" style="font-size: 0.85rem">タイルをクリックして「読みたい範囲」を選択してください（10 m バンド 1 枚を想定）。</p>
		<div class="tilegrid" style="grid-template-columns: repeat({cur.n}, 1fr); width: {gridPx}px; height: {gridPx}px">
			{#each Array.from({ length: cur.n * cur.n }) as _, i (i)}
				<button class="tile" class:sel={selected.has(i)} onclick={() => toggle(i)} aria-label="tile {i}"></button>
			{/each}
		</div>
	</div>
	<div class="panel">
		<div class="grid cols-2">
			<div class="stat"><span class="label">ファイル全体</span><span class="value">{fmtMB(layout.total)}</span></div>
			<div class="stat"><span class="label">取得バイト数</span><span class="value" style="color: var(--green)">{fmtMB(fetched)}</span></div>
			<div class="stat"><span class="label">リクエスト数</span><span class="value">{1 + ranges.length}</span></div>
			<div class="stat"><span class="label">転送削減率</span><span class="value">{(100 - (fetched / layout.total) * 100).toFixed(1)}<span class="unit">%</span></span></div>
		</div>
		<h3 style="margin-top: 1rem">発行される HTTP リクエスト</h3>
		<pre style="max-height: 260px"><code>{`GET /B04.tif  HTTP/1.1
Range: bytes=0-${HEADER - 1}          # ヘッダ + IFD（タイルの offset/bytecount 表）
${ranges.length === 0 ? '\n# ← タイルを選ぶと、その分の Range リクエストが並びます' : ranges.map((r) => `\nGET /B04.tif  HTTP/1.1\nRange: bytes=${r.start}-${r.end}   # level ${level} tile ${r.i}`).join('')}`}</code></pre>
		<div class="note">
			<strong>仕組み：</strong> COG は「タイル分割 + オーバービュー内蔵 + IFD をファイル先頭に配置」した GeoTIFF。
			クライアント（GDAL / rasterio / titiler）はまず先頭 16 KB を読んでタイルの位置表を得て、必要なタイルだけ Range で取ります。
			隣接タイルは 1 リクエストに結合されます。通常の GeoTIFF（ストリップ、オーバービュー無し）でサムネイルを作るには
			<strong>{fmtMB(layout.total)} 全部</strong>を読む必要がありました。
		</div>
	</div>
</div>

<h2>Zarr：多次元キューブのチャンク設計</h2>
<div class="grid cols-2">
	<div class="panel">
		<p style="font-size: 0.9rem">
			1 年分・2048×2048 画素・int16 のデータキューブ <code>(time=365, y=2048, x=2048)</code> = {fmtMB(cube.t * cube.y * cube.x * 2)} を
			Zarr に保存するとき、チャンク形状をどう切るかで <strong>どのアクセスパターンが速いか</strong>が決まります。
		</p>
		<div class="btn-row" style="flex-direction: column; align-items: stretch">
			{#each chunkPresets as p, i (p.name)}
				<button class="ghost" class:active={chunkIdx === i} onclick={() => (chunkIdx = i)} style="text-align: left">{p.name}</button>
			{/each}
		</div>
		<div class="grid cols-2" style="margin-top: 0.8rem">
			<div class="stat"><span class="label">チャンクサイズ</span><span class="value">{fmtMB(chunkBytes)}</span></div>
			<div class="stat"><span class="label">チャンク数</span><span class="value">{nChunks.toLocaleString()}</span></div>
		</div>
	</div>
	<div class="panel tight">
		<table>
			<thead><tr><th>クエリ</th><th class="num">読むチャンク</th><th class="num">転送量</th><th class="num">有効率</th></tr></thead>
			<tbody>
				{#each q as row (row.name)}
					{@const bytes = row.chunks * chunkBytes}
					{@const eff = Math.min(100, (row.useful / bytes) * 100)}
					<tr>
						<td>{row.name}</td>
						<td class="num">{row.chunks.toLocaleString()}</td>
						<td class="num">{fmtMB(bytes)}</td>
						<td class="num" style:color={eff > 50 ? 'var(--green)' : eff > 5 ? 'var(--orange)' : 'var(--red)'}>{eff < 0.01 ? '<0.01' : eff.toFixed(eff < 1 ? 2 : 0)}%</td>
					</tr>
				{/each}
			</tbody>
		</table>
		<div class="note" style="margin-top: 0.8rem">
			<strong>結論：</strong> 万能なチャンクは無い。地図タイル配信なら空間優先、地点の時系列解析（NDVI の季節変化など）なら時間優先。
			両方必要なら 2 コピー持つか、バランス型（1 チャンク数 MB）で妥協する。Zarr は各チャンクが独立オブジェクト（S3 のキー）なので、
			チャンク数が数百万になるとリスト操作やメタデータ取得がボトルネックになる点にも注意（Zarr v3 のシャーディングで緩和）。
		</div>
	</div>
</div>

<h2>処理レベル：何が補正済みか</h2>
<div class="panel tight" style="overflow-x: auto">
	<table>
		<thead><tr><th>レベル</th><th>内容</th><th>単位・値</th><th>Sentinel-2 の例</th><th>実務での位置づけ</th></tr></thead>
		<tbody>
			<tr><td><code>L0</code></td><td>生テレメトリ（ダウンリンクされたビット列）</td><td>DN（センサーカウント）</td><td>非公開</td><td class="muted">扱わない</td></tr>
			<tr><td><code>L1A/B</code></td><td>放射量校正・幾何情報付与（未投影）</td><td>放射輝度 W/m²/sr/µm</td><td>L1B（限定公開）</td><td class="muted">センサー研究者向け</td></tr>
			<tr><td><code>L1C</code></td><td>地図投影済み、<strong>大気上端（TOA）反射率</strong></td><td>反射率 0〜1（大気込み）</td><td>L1C（UTM/MGRS タイル）</td><td>雲マスク・自前大気補正をしたい場合</td></tr>
			<tr><td><code>L2A</code></td><td>大気補正済み、<strong>地表（BOA）反射率</strong> + シーン分類（雲・影・雪）</td><td>反射率 0〜1（地表）</td><td>L2A（Sen2Cor）、SCL バンド</td><td><strong>解析の標準スタート地点</strong></td></tr>
			<tr><td><code>L3</code></td><td>時間合成・モザイク（雲なし月次合成など）</td><td>反射率 / 指標</td><td>—（各社・各機関が生成）</td><td>広域モニタリングの入力</td></tr>
			<tr><td><code>ARD</code></td><td>Analysis Ready Data：L2 を共通グリッド・共通メタデータで整えたもの（CEOS 定義）</td><td>—</td><td>Landsat C2 L2、HLS（Landsat+S2 調和）</td><td>ミッションをまたぐ時系列に</td></tr>
		</tbody>
	</table>
</div>

<h2>光学と SAR：データの意味が違う</h2>
<div class="grid cols-2">
	<div class="panel">
		<h3>光学（Sentinel-2 / Landsat）</h3>
		<ul style="font-size: 0.9rem; padding-left: 1.2rem; margin: 0.3rem 0">
			<li>太陽光の反射 → 昼のみ、雲があると見えない</li>
			<li>値の意味が直感的（色・明るさ）。反射率は物理量</li>
			<li>雲マスク（SCL / QA バンド）を必ず適用する</li>
			<li>日本の梅雨期は数か月晴天シーンが無いこともある → 時間合成が必須</li>
		</ul>
	</div>
	<div class="panel">
		<h3>SAR（Sentinel-1 / ALOS-2）</h3>
		<ul style="font-size: 0.9rem; padding-left: 1.2rem; margin: 0.3rem 0">
			<li>自ら電波を出して後方散乱を測る → 昼夜・雲を問わない</li>
			<li>値は後方散乱係数 σ⁰ [dB]。粗さ・誘電率・幾何で決まり、直感とは違う</li>
			<li>GRD（振幅のみ）と SLC（位相あり。InSAR 用）で製品が分かれる</li>
			<li>前処理（軌道補正・熱雑音除去・地形補正・スペックル低減）が重い → 処理済み（RTC）製品を探す</li>
		</ul>
	</div>
</div>

<h2>実務での読み方（Python）</h2>
<div class="panel">
	<pre><code>{`# 環境変数で GDAL の HTTP 読みを最適化（COG を触る前に）
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
ds.to_zarr("s3://my-bucket/s2_tokyo_2026.zarr", mode="w")`}</code></pre>
</div>

<style>
	.tilegrid {
		display: grid;
		gap: 2px;
		background: var(--border);
		padding: 2px;
		border-radius: 6px;
		margin: 0 auto;
	}
	.tile {
		background: #0a0f1e;
		border: none;
		border-radius: 2px;
		padding: 0;
		cursor: pointer;
		min-width: 0;
		min-height: 0;
	}
	.tile:hover {
		background: var(--panel-2);
	}
	.tile.sel {
		background: var(--green);
	}
</style>
