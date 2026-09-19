<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import 'leaflet/dist/leaflet.css';
	import type * as Leaflet from 'leaflet';
	import {
		composites,
		indices,
		places,
		renderTile,
		assetsFor,
		searchItems,
		fetchItem,
		pointValues,
		normDiff,
		fmtDate,
		type StacItem,
		type RenderMode
	} from '$lib/imagery';
	import { cogRequestCount } from '$lib/cog';

	let L: typeof Leaflet;
	let map: Leaflet.Map;
	let mapEl: HTMLDivElement;
	let layerA: Leaflet.GridLayer | null = null;
	let layerB: Leaflet.GridLayer | null = null;
	let CogLayer: new (opts: Leaflet.GridLayerOptions & { item: StacItem; mode: RenderMode; gain: number }) => Leaflet.GridLayer;
	let footprint: Leaflet.GeoJSON | null = null;
	let marker: Leaflet.CircleMarker | null = null;
	let comparePane: HTMLElement;
	let basemaps: Record<string, Leaflet.TileLayer>;

	// ---- 検索 ----
	let days = $state(90);
	let maxCloud = $state(30);
	let loading = $state(false);
	let error = $state('');
	let items = $state<StacItem[]>([]);

	// ---- 表示 ----
	let itemA = $state<StacItem | null>(null);
	let itemB = $state<StacItem | null>(null);
	let mode = $state<RenderMode>({ kind: 'composite', id: 'tci' });
	let gain = $state(1);
	let opacity = $state(1);
	let swipe = $state(50);
	let basemap = $state<'osm' | 'esri'>('osm');
	let tilesLoading = $state(0);
	let requests = $state(0);

	const currentAssets = $derived(itemA ? assetsFor(mode).map((a) => ({ a, href: itemA!.assets[a].href })) : []);
	const modeDesc = $derived(
		mode.kind === 'composite' ? composites.find((c) => c.id === mode.id)?.desc : indices.find((i) => i.id === mode.id)?.desc
	);

	// ---- 地点クエリ ----
	let point = $state<{ lat: number; lon: number } | null>(null);
	let pointA = $state<Record<string, number | null> | null>(null);
	let pointB = $state<Record<string, number | null> | null>(null);
	let pointLoading = $state(false);
	const pointAssets = ['blue', 'green', 'red', 'nir', 'nir08', 'swir16', 'swir22'];

	// ---- 時系列 ----
	let series = $state<{ item: StacItem; v: number | null }[]>([]);
	let seriesLoading = $state(false);
	let seriesIndex = $state('ndvi');

	onMount(async () => {
		L = await import('leaflet');
		// Range Request 数を数えるために Performance API のバッファを広げる（既定 250 件）
		performance.setResourceTimingBufferSize(20000);
		// COG をブラウザで直接読んで描く GridLayer
		CogLayer = L.GridLayer.extend({
			createTile(this: Leaflet.GridLayer & { options: { item: StacItem; mode: RenderMode; gain: number } }, coords: Leaflet.Coords, done: Leaflet.DoneCallback) {
				const tile = document.createElement('canvas');
				tile.width = tile.height = 256;
				renderTile(this.options.item, this.options.mode, this.options.gain, coords.z, coords.x, coords.y, 256)
					.then((rgba) => {
						tile.getContext('2d')!.putImageData(new ImageData(rgba, 256, 256), 0, 0);
						done(undefined, tile);
					})
					.catch((e) => done(e, tile));
				return tile;
			}
		}) as unknown as typeof CogLayer;
		map = L.map(mapEl, { center: places[0].center, zoom: places[0].zoom, zoomControl: true });
		basemaps = {
			osm: L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }),
			esri: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 18, attribution: 'Esri World Imagery' })
		};
		basemaps.osm.addTo(map);
		comparePane = map.createPane('compare');
		comparePane.style.zIndex = '250';
		map.on('click', (e: Leaflet.LeafletMouseEvent) => queryPoint(e.latlng.lat, e.latlng.lng));
		map.on('move zoom resize', applySwipe);

		const preset = page.url.searchParams.get('item');
		if (preset) {
			try {
				const it = await fetchItem(preset);
				items = [it];
				selectA(it);
			} catch (e) {
				error = e instanceof Error ? e.message : String(e);
			}
		} else {
			search();
		}
	});

	$effect(() => {
		if (!map) return;
		for (const [k, l] of Object.entries(basemaps)) {
			if (k === basemap) l.addTo(map);
			else map.removeLayer(l);
		}
	});

	function bboxOfMap(): [number, number, number, number] {
		const b = map.getBounds();
		return [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
	}

	async function search() {
		loading = true;
		error = '';
		try {
			// 地図中心の小さな箱で検索すると、中心を覆うタイルだけが返る
			const c = map.getCenter();
			const d = 0.02;
			items = await searchItems([c.lng - d, c.lat - d, c.lng + d, c.lat + d], days, maxCloud);
			if (items.length && !items.find((i) => i.id === itemA?.id)) selectA(items[0]);
			if (!items.length) error = '条件に合うシーンがありません。期間を伸ばすか雲量上限を上げてください。';
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			loading = false;
		}
	}

	function goto(p: (typeof places)[number]) {
		map.setView(p.center, p.zoom);
		itemB = null;
		search();
	}

	function makeLayer(item: StacItem, pane?: string) {
		const layer = new CogLayer({
			item,
			mode: $state.snapshot(mode),
			gain,
			tileSize: 256,
			maxZoom: 18,
			minZoom: 8,
			opacity,
			// pane: undefined を渡すと Leaflet の既定 'tilePane' が上書きされて落ちる
			...(pane ? { pane } : {}),
			bounds: L.latLngBounds([item.bbox[1], item.bbox[0]], [item.bbox[3], item.bbox[2]]),
			attribution: 'Sentinel-2 L2A © ESA / Earth Search (AWS)'
		});
		layer.on('loading', () => tilesLoading++);
		layer.on('tileload', () => (requests = cogRequestCount()));
		layer.on('load', () => {
			tilesLoading = Math.max(0, tilesLoading - 1);
			requests = cogRequestCount();
		});
		return layer;
	}

	function selectA(item: StacItem) {
		itemA = item;
		footprint?.remove();
		footprint = L.geoJSON(item.geometry as GeoJSON.Geometry, {
			style: { color: '#8be9fd', weight: 1.5, fill: false, dashArray: '4 4' }
		}).addTo(map);
		refreshLayers();
		if (point) queryPoint(point.lat, point.lon);
	}

	function selectB(item: StacItem | null) {
		itemB = item?.id === itemB?.id ? null : item;
		refreshLayers();
		if (point) queryPoint(point.lat, point.lon);
	}

	function refreshLayers() {
		layerA?.remove();
		layerB?.remove();
		layerA = layerB = null;
		tilesLoading = 0;
		if (itemA) layerA = makeLayer(itemA).addTo(map);
		if (itemB) layerB = makeLayer(itemB, 'compare').addTo(map);
		applySwipe();
	}

	/** レイヤー B のコンテナを、画面右側（swipe% から右）だけ表示するようにクリップ */
	function applySwipe() {
		const el = layerB?.getContainer();
		if (!el) return;
		// Leaflet のレイヤーコンテナはサイズ 0 の absolute 要素なので、
		// レイヤー座標系でのピクセル矩形を clip: rect() で指定する（leaflet-side-by-side と同じ手法）
		const size = map.getSize();
		const nw = map.containerPointToLayerPoint([0, 0]);
		const se = map.containerPointToLayerPoint(size);
		const x = nw.x + (size.x * swipe) / 100;
		el.style.clip = `rect(${nw.y}px, ${se.x}px, ${se.y}px, ${x}px)`;
	}

	// mode / gain 変更でタイル URL を差し替え
	$effect(() => {
		void mode;
		void gain;
		if (map && itemA) refreshLayers();
	});
	$effect(() => {
		layerA?.setOpacity(opacity);
		layerB?.setOpacity(opacity);
	});
	$effect(() => {
		void swipe;
		applySwipe();
	});

	async function queryPoint(lat: number, lon: number) {
		point = { lat, lon };
		marker?.remove();
		marker = L.circleMarker([lat, lon], { radius: 6, color: '#ffb86c', weight: 2, fillOpacity: 0.3 }).addTo(map);
		if (!itemA) return;
		pointLoading = true;
		const [a, b] = await Promise.all([
			pointValues(itemA, lon, lat, pointAssets),
			itemB ? pointValues(itemB, lon, lat, pointAssets) : Promise.resolve(null)
		]);
		pointA = a;
		pointB = b;
		pointLoading = false;
	}

	async function buildSeries() {
		if (!point || !items.length) return;
		seriesLoading = true;
		const ix = indices.find((i) => i.id === seriesIndex)!;
		const list = [...items].sort((a, b) => a.properties.datetime.localeCompare(b.properties.datetime)).slice(-20);
		const results = await Promise.all(
			list.map(async (item) => {
				const v = await pointValues(item, point!.lon, point!.lat, [ix.b1, ix.b2]);
				return { item, v: normDiff(v[ix.b1], v[ix.b2]) };
			})
		);
		series = results;
		seriesLoading = false;
	}

	const indexAt = (vals: Record<string, number | null> | null, ix: (typeof indices)[number]) =>
		vals ? normDiff(vals[ix.b1], vals[ix.b2]) : null;
	const fmt = (v: number | null, d = 2) => (v === null ? '—' : v.toFixed(d));
	const cloud = (it: StacItem) => it.properties['eo:cloud_cover'];

	// 時系列チャート
	const CX0 = 40, CX1 = 780, CY0 = 10, CY1 = 150;
	const sx = (i: number, n: number) => (n <= 1 ? (CX0 + CX1) / 2 : CX0 + (i / (n - 1)) * (CX1 - CX0));
	const sy = (v: number) => CY1 - ((v + 1) / 2) * (CY1 - CY0);
</script>

<svelte:head>
	<title>実画像を見る — Satellite Data Lab</title>
</svelte:head>

<h1>06 実画像を見る</h1>
<p class="muted">
	Sentinel-2 の実データを地図上でその場レンダリングします。サーバーはありません——
	<strong>ブラウザが COG に直接 HTTP Range Request を発行</strong>し、表示中のタイルに必要な部分だけを読んで、
	UTM → Web メルカトルの再投影・バンド合成・NDVI 計算をすべてクライアントで行っています。
	地図をクリックすると、その地点の各バンド DN と指標値を取得します。
</p>

<details class="panel tight howto" open>
	<summary><strong>使い方</strong>（クリックで開閉）</summary>
	<ol>
		<li><strong>場所を選ぶ</strong> — 下のボタン（東京・富士山…）か、地図をドラッグして「現在の地図中心で再検索」。地図中心を含む Sentinel-2 シーンが最新順に並びます。</li>
		<li><strong>シーンを選ぶ</strong> — サムネイルをクリックすると <strong>A</strong>（表示レイヤー）に。雲の少ない日付を選ぶのがコツです（☁ は シーン全体の雲量）。</li>
		<li><strong>表示モードを切り替える</strong> — 「トゥルーカラー」で地形を掴んでから「フォールスカラー」「NDVI」に切り替え、同じ場所の見え方の違いを比べてください。初回はタイル取得に数秒かかります（COG を直接読んでいるため）。2 回目以降はキャッシュで即時です。</li>
		<li><strong>クリックで値を見る</strong> — 地図上の任意の点をクリック → 右下に 7 バンドの DN と 6 指標の値。森・水・建物・雲・雲影をクリックして NDVI がどう変わるか確かめてください。</li>
		<li><strong>2 時期を比べる</strong> — サムネイル右上の「B」で比較レイヤーを設定 → 地図中央の橙スライダーを左右にドラッグ。左が A、右が B。値パネルには B − A の差分も出ます。</li>
		<li><strong>時系列を描く</strong> — 地点をクリックした状態で指標を選び「N シーンで計算」。同じ画素の値を全シーンから読み、季節変化や雲の影響をプロットします。</li>
	</ol>
	<p class="muted" style="font-size: 0.85rem; margin: 0.3rem 0 0">
		おすすめの体験：<strong>富士山</strong>で「NDSI 雪」と「SWIR 合成」（雪と雲の区別）／<strong>琵琶湖</strong>で「NDWI 水域」／<strong>十勝平野</strong>で「農業」合成と 2 時期比較（作物の生育差）／<strong>東京</strong>で皇居・代々木公園と市街地の NDVI 差。
	</p>
</details>

<div class="btn-row">
	{#each places as p (p.name)}
		<button class="ghost" onclick={() => goto(p)} title={p.hint}>{p.name}</button>
	{/each}
	<span style="flex: 1"></span>
	<button class="ghost" class:active={basemap === 'osm'} onclick={() => (basemap = 'osm')}>地図</button>
	<button class="ghost" class:active={basemap === 'esri'} onclick={() => (basemap = 'esri')}>航空写真</button>
</div>

<div class="mapwrap">
	<div bind:this={mapEl} class="map"></div>
	{#if tilesLoading > 0 || loading}
		<div class="loading">{loading ? 'STAC 検索中…' : 'タイル読込中…'}</div>
	{/if}
	{#if itemA}
		<div class="legend">
			<div><strong>A</strong> {fmtDate(itemA.properties.datetime)} <span class="muted">雲 {cloud(itemA)?.toFixed(0)}%</span></div>
			{#if itemB}
				<div><strong>B</strong> {fmtDate(itemB.properties.datetime)} <span class="muted">雲 {cloud(itemB)?.toFixed(0)}%</span> <span class="muted">（右側）</span></div>
			{/if}
		</div>
	{/if}
	{#if itemB}
		<input class="swipe" type="range" min="0" max="100" step="0.5" bind:value={swipe} aria-label="比較スワイプ" />
	{/if}
</div>

{#if error}
	<div class="note warn">{error}</div>
{/if}

<div class="grid cols-2">
	<div class="panel">
		<h3>表示モード</h3>
		<div class="btn-row">
			{#each composites as c (c.id)}
				<button class="ghost" class:active={mode.kind === 'composite' && mode.id === c.id} onclick={() => (mode = { kind: 'composite', id: c.id })}>{c.name}</button>
			{/each}
		</div>
		<div class="btn-row">
			{#each indices as ix (ix.id)}
				<button class="ghost" class:active={mode.kind === 'index' && mode.id === ix.id} onclick={() => (mode = { kind: 'index', id: ix.id })}>{ix.name}</button>
			{/each}
		</div>
		<p class="muted" style="font-size: 0.85rem">{modeDesc}</p>
		{#if mode.kind === 'composite' && composites.find((c) => c.id === mode.id)?.rescaleMax}
			<div class="control">
				<label for="gain">ゲイン（rescale 上限を 1/gain に）</label>
				<output>×{gain.toFixed(1)}</output>
				<input id="gain" type="range" min="0.5" max="3" step="0.1" bind:value={gain} />
			</div>
		{/if}
		<div class="control">
			<label for="op">不透明度</label>
			<output>{Math.round(opacity * 100)}%</output>
			<input id="op" type="range" min="0" max="1" step="0.05" bind:value={opacity} />
		</div>
		<div class="grid cols-2" style="margin-top: 0.6rem">
			<div class="stat"><span class="label">読んでいる COG</span><span class="value">{currentAssets.length}<span class="unit">ファイル</span></span></div>
			<div class="stat"><span class="label">発行した Range Request</span><span class="value">{requests.toLocaleString()}</span></div>
		</div>
		<details>
			<summary class="muted" style="cursor: pointer; font-size: 0.85rem">読んでいる COG の URL</summary>
			<pre style="font-size: 0.72rem; white-space: pre-wrap; word-break: break-all"><code>{currentAssets.length ? currentAssets.map((c) => `${c.a.padEnd(7)} ${c.href}`).join('\n') : '（シーン未選択）'}</code></pre>
		</details>
	</div>

	<div class="panel">
		<h3>シーン検索 <span class="muted" style="font-weight: 400; font-size: 0.8rem">— 地図中心を含む Sentinel-2 L2A</span></h3>
		<div class="control">
			<label for="days">過去 N 日</label>
			<output>{days} 日</output>
			<input id="days" type="range" min="14" max="730" step="7" bind:value={days} />
		</div>
		<div class="control">
			<label for="cc">雲量上限</label>
			<output>&lt; {maxCloud}%</output>
			<input id="cc" type="range" min="0" max="100" step="5" bind:value={maxCloud} />
		</div>
		<button onclick={search} disabled={loading}>{loading ? '検索中…' : '現在の地図中心で再検索'}</button>
		<p class="muted" style="font-size: 0.8rem; margin-top: 0.6rem">
			{items.length} シーン。クリックで <strong>A</strong>（表示）、右の「B」で比較レイヤー（スワイプ）に設定。
		</p>
		<div class="strip">
			{#each items as it (it.id)}
				<div class="scene" class:a={itemA?.id === it.id} class:b={itemB?.id === it.id}>
					<button class="thumb" onclick={() => selectA(it)} title={it.id}>
						{#if it.assets.thumbnail}
							<img src={it.assets.thumbnail.href} alt="" loading="lazy" />
						{/if}
						<div class="cap">
							<div>{fmtDate(it.properties.datetime)}</div>
							<div class="muted">☁ {cloud(it)?.toFixed(0)}%</div>
						</div>
					</button>
					<button class="bbtn" class:active={itemB?.id === it.id} onclick={() => selectB(it)}>B</button>
				</div>
			{/each}
		</div>
	</div>
</div>

<div class="grid cols-2">
	<div class="panel">
		<h3>クリック地点の値 {#if pointLoading}<span class="muted" style="font-size: 0.8rem">取得中…</span>{/if}</h3>
		{#if !point}
			<p class="muted" style="font-size: 0.9rem">地図をクリックしてください。</p>
		{:else}
			<p class="muted" style="font-size: 0.8rem; font-family: var(--mono)">{point.lat.toFixed(5)}, {point.lon.toFixed(5)}</p>
			<table>
				<thead><tr><th>アセット</th><th class="num">A (DN)</th>{#if itemB}<th class="num">B (DN)</th>{/if}</tr></thead>
				<tbody>
					{#each pointAssets as a (a)}
						<tr><td><code>{a}</code></td><td class="num">{pointA?.[a] ?? '—'}</td>{#if itemB}<td class="num">{pointB?.[a] ?? '—'}</td>{/if}</tr>
					{/each}
				</tbody>
			</table>
			<table style="margin-top: 0.6rem">
				<thead><tr><th>指標</th><th class="num">A</th>{#if itemB}<th class="num">B</th><th class="num">B − A</th>{/if}</tr></thead>
				<tbody>
					{#each indices as ix (ix.id)}
						{@const va = indexAt(pointA, ix)}
						{@const vb = indexAt(pointB, ix)}
						<tr>
							<td>{ix.id.toUpperCase()}</td>
							<td class="num">{fmt(va)}</td>
							{#if itemB}
								<td class="num">{fmt(vb)}</td>
								<td class="num" style:color={va !== null && vb !== null ? (vb - va > 0.05 ? 'var(--green)' : vb - va < -0.05 ? 'var(--red)' : 'var(--text)') : undefined}>{va !== null && vb !== null ? (vb - va >= 0 ? '+' : '') + (vb - va).toFixed(2) : '—'}</td>
							{/if}
						</tr>
					{/each}
				</tbody>
			</table>
			<p class="muted" style="font-size: 0.78rem">DN は反射率 × 10000（Earth Search はオフセット補正済み）。10 m と 20 m のバンドが混在するため、境界部では画素の代表範囲が異なる点に注意。</p>
		{/if}
	</div>

	<div class="panel">
		<h3>クリック地点の時系列</h3>
		<div style="display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap">
			<select bind:value={seriesIndex}>
				{#each indices as ix (ix.id)}<option value={ix.id}>{ix.name}</option>{/each}
			</select>
			<button onclick={buildSeries} disabled={!point || seriesLoading || !items.length}>{seriesLoading ? '計算中…' : `${Math.min(20, items.length)} シーンで計算`}</button>
		</div>
		{#if series.length}
			<svg viewBox="0 0 800 180" width="100%" style="margin-top: 0.6rem" aria-label="時系列">
				{#each [-1, -0.5, 0, 0.5, 1] as t (t)}
					<line x1={CX0} y1={sy(t)} x2={CX1} y2={sy(t)} stroke="#1c2950" />
					<text x={CX0 - 6} y={sy(t) + 4} fill="#98a6cc" font-size="10" text-anchor="end">{t}</text>
				{/each}
				<polyline
					points={series.filter((s) => s.v !== null).map((s) => `${sx(series.indexOf(s), series.length)},${sy(s.v!)}`).join(' ')}
					fill="none" stroke="#50fa7b" stroke-width="2"
				/>
				{#each series as s, i (s.item.id)}
					{#if s.v !== null}
						<circle cx={sx(i, series.length)} cy={sy(s.v)} r="4" fill={cloud(s.item)! > 20 ? '#ffb86c' : '#50fa7b'}>
							<title>{fmtDate(s.item.properties.datetime)}: {s.v.toFixed(3)} (雲 {cloud(s.item)?.toFixed(0)}%)</title>
						</circle>
					{/if}
					{#if i % Math.ceil(series.length / 6) === 0 || i === series.length - 1}
						<text x={sx(i, series.length)} y={CY1 + 22} fill="#98a6cc" font-size="10" text-anchor="middle">{fmtDate(s.item.properties.datetime).slice(5)}</text>
					{/if}
				{/each}
			</svg>
			<p class="muted" style="font-size: 0.78rem">橙の点はシーン全体の雲量 &gt; 20%。地点が雲に覆われていると値が急落するので、実務では SCL バンドで雲画素を除外してから合成します。</p>
		{:else}
			<p class="muted" style="font-size: 0.9rem">地点をクリック → 指標を選んで「計算」。検索結果の各シーンの COG から、該当 1 画素を含む内部タイルだけを並列で読みます。</p>
		{/if}
	</div>
</div>

<h2>解説：実画像の読み方</h2>
<div class="grid cols-2">
	<div class="panel">
		<h3>NDVI の値と地物（東京 2026-08-24 の実測）</h3>
		<table>
			<thead><tr><th>地点</th><th class="num">NIR (B8)</th><th class="num">Red (B4)</th><th class="num">NDVI</th></tr></thead>
			<tbody>
				<tr><td>皇居の森</td><td class="num">2465</td><td class="num">323</td><td class="num" style="color: var(--green)">+0.77</td></tr>
				<tr><td>市街地（住宅・道路）</td><td class="num">1500</td><td class="num">1296</td><td class="num">+0.07</td></tr>
			</tbody>
		</table>
		<p style="font-size: 0.9rem">
			DN は反射率 × 10000。森は赤をわずか 3% しか返さず NIR を 25% 返す——この段差（レッドエッジ）は葉の細胞構造とクロロフィルに由来し、植生にしかありません。
			<code>(NIR − Red) / (NIR + Red)</code> と<strong>和で割る</strong>ことで太陽高度や斜面向きによる明るさの差が打ち消され、日付・場所をまたいで比較できる値になります。
		</p>
		<table style="font-size: 0.85rem">
			<thead><tr><th>NDVI</th><th>典型的な地物</th></tr></thead>
			<tbody>
				<tr><td class="num" style="color: var(--red)">&lt; 0</td><td>水、雪、雲の影</td></tr>
				<tr><td class="num">0〜0.2</td><td>裸地、都市、岩、<strong>雲</strong>（NIR も Red も高いため 0 付近）</td></tr>
				<tr><td class="num">0.2〜0.5</td><td>草地、疎な植生、生育初期の作物</td></tr>
				<tr><td class="num" style="color: var(--green)">&gt; 0.6</td><td>森林、成熟した作物（0.8〜0.9 で飽和し密度差は見えなくなる）</td></tr>
			</tbody>
		</table>
	</div>
	<div class="panel">
		<h3>NDVI 画像で気をつけること</h3>
		<ul style="font-size: 0.9rem; padding-left: 1.2rem; margin: 0.3rem 0">
			<li><strong>雲は市街地と同じ黄色</strong>に見える。NDVI だけでは区別できないので、実務では SCL（シーン分類）バンドで雲・影の画素を除外してから使う。</li>
			<li><strong>雲の影は水と同じ赤</strong>に見える。トゥルーカラーで雲の位置を確認し、その南〜東側（太陽の反対）の赤い塊は影と読む。</li>
			<li><strong>ミクセル</strong>：10 m 画素に街路樹と道路が混ざると 0.2〜0.3 の中間値が出る。都市の緑被率を見るなら閾値ではなく連続値で扱う。</li>
			<li><strong>季節性</strong>：水田は田植え直後に負（水面）→ 夏に 0.8 → 収穫で急落。1 枚の値ではなく時系列の形で作物を判別する。</li>
			<li><strong>飽和</strong>：密な森林は NDVI 0.85 あたりで頭打ち。バイオマスの差を見るなら EVI や NDRE（レッドエッジ B5/B6）を使う。</li>
		</ul>
	</div>
</div>

<div class="grid cols-2">
	<div class="panel">
		<h3>合成モードの使い分け</h3>
		<table style="font-size: 0.85rem">
			<tbody>
				<tr><td><strong>トゥルーカラー</strong></td><td>まず地形・雲を把握する。植生は暗い緑で差が見づらい。</td></tr>
				<tr><td><strong>フォールスカラー</strong></td><td>植生の活性を「赤の濃さ」で見る。水は黒く、境界が明瞭。</td></tr>
				<tr><td><strong>SWIR 合成</strong></td><td>雲（白）と雪（青）を分ける。焼失跡・裸地が赤紫。</td></tr>
				<tr><td><strong>農業</strong></td><td>作物の生育差が緑の濃淡に。畝や区画ごとの違いを見る。</td></tr>
				<tr><td><strong>都市</strong></td><td>建物・舗装が明るく、植生が暗い。都市域の抽出に。</td></tr>
			</tbody>
		</table>
	</div>
	<div class="panel">
		<h3>2 時期比較と時系列の使い道</h3>
		<ul style="font-size: 0.9rem; padding-left: 1.2rem; margin: 0.3rem 0">
			<li><strong>災害</strong>：洪水前後の NDWI、山火事前後の NBR（差分 dNBR で被害度）。</li>
			<li><strong>農業</strong>：田植え〜収穫の NDVI 波形で作付け作物を推定。区画ごとの生育ムラ。</li>
			<li><strong>都市開発</strong>：数年離れた 2 シーンの NDBI／NDVI 差で造成地を抽出。</li>
			<li><strong>雪・水資源</strong>：NDSI の時系列で融雪時期、NDWI で湖面の季節変動。</li>
		</ul>
		<p class="muted" style="font-size: 0.85rem">
			時系列チャートの橙の点はシーン全体の雲量が 20% 超。値が突然落ちていたら、その地点が雲か影に覆われている可能性が高い。
		</p>
	</div>
</div>

<div class="note">
	<strong>ここで起きていること：</strong> ① ブラウザが Earth Search（STAC）でシーンを検索 → ② 選んだ Item の assets から COG の URL を取得 →
	③ <code>geotiff.js</code> が COG のヘッダ（IFD）を読み、表示ズームに合うオーバービューを選ぶ → ④ 地図タイルごとに、必要な UTM 範囲の内部タイルだけを Range Request で取得 →
	⑤ 各画素を経緯度 → UTM に投影して最近傍サンプリング、合成／指標計算して Canvas に描く。
	サーバーもダウンロードも無し。05 で見た COG のタイル構造が、そのままブラウザ上の地図の速さに繋がっています。
	開発者ツールの Network タブで <code>sentinel-cogs.s3</code> へのリクエストを見ると、<code>Range: bytes=…</code> ヘッダと <code>206 Partial Content</code> が確認できます。
</div>

<style>
	.howto summary {
		cursor: pointer;
		font-size: 0.95rem;
	}
	.howto ol {
		padding-left: 1.3rem;
		margin: 0.5rem 0;
		font-size: 0.9rem;
	}
	.howto li {
		margin: 0.25rem 0;
	}
	.mapwrap {
		position: relative;
		margin: 0.5rem 0 1rem;
	}
	.map {
		height: 540px;
		border-radius: 12px;
		border: 1px solid var(--border);
		background: #0a0f1e;
	}
	.loading {
		position: absolute;
		top: 10px;
		right: 10px;
		z-index: 1000;
		background: rgba(11, 16, 32, 0.85);
		border: 1px solid var(--border);
		border-radius: 6px;
		padding: 0.25rem 0.7rem;
		font-size: 0.8rem;
		color: var(--accent-2);
	}
	.legend {
		position: absolute;
		bottom: 24px;
		left: 10px;
		z-index: 1000;
		background: rgba(11, 16, 32, 0.85);
		border: 1px solid var(--border);
		border-radius: 6px;
		padding: 0.35rem 0.7rem;
		font-size: 0.8rem;
		font-family: var(--mono);
	}
	.swipe {
		position: absolute;
		left: 0;
		right: 0;
		top: 50%;
		z-index: 1000;
		width: 100%;
		margin: 0;
		accent-color: var(--orange);
		pointer-events: auto;
	}
	.strip {
		display: flex;
		gap: 0.5rem;
		overflow-x: auto;
		padding-bottom: 0.4rem;
	}
	.scene {
		position: relative;
		flex: 0 0 110px;
		border: 2px solid var(--border);
		border-radius: 8px;
		overflow: hidden;
	}
	.scene.a {
		border-color: var(--accent-2);
	}
	.scene.b {
		border-color: var(--orange);
	}
	.thumb {
		display: block;
		width: 100%;
		padding: 0;
		background: #0a0f1e;
		color: var(--text);
		font-weight: 400;
		text-align: left;
		border-radius: 0;
	}
	.thumb img {
		width: 100%;
		aspect-ratio: 1;
		object-fit: cover;
		display: block;
	}
	.cap {
		padding: 0.25rem 0.4rem;
		font-size: 0.72rem;
		font-family: var(--mono);
		line-height: 1.3;
	}
	.bbtn {
		position: absolute;
		top: 4px;
		right: 4px;
		padding: 0.05rem 0.45rem;
		font-size: 0.72rem;
		background: rgba(11, 16, 32, 0.8);
		color: var(--muted);
		border: 1px solid var(--border);
	}
	.bbtn.active {
		background: var(--orange);
		color: #071022;
		border-color: var(--orange);
	}
	:global(.leaflet-container) {
		font-family: inherit;
	}
	:global(.leaflet-control-attribution) {
		background: rgba(11, 16, 32, 0.8) !important;
		color: var(--muted) !important;
		font-size: 0.65rem;
	}
	:global(.leaflet-control-attribution a) {
		color: var(--accent) !important;
	}
</style>
