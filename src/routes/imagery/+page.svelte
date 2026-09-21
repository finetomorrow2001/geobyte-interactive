<script lang="ts">
	import { onMount, onDestroy, untrack } from 'svelte';
	import { page } from '$app/state';
	import 'maplibre-gl/dist/maplibre-gl.css';
	import type * as ML from 'maplibre-gl';
	// MapLibre の Worker は Vite に別エントリとしてバンドルさせ、URL を明示的に渡す
	import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
	import type * as GeoJSON from 'geojson';
	import Compass from '$lib/Compass.svelte';
	import { installCogProtocol, registerCogLayer, unregisterCogLayer, setTileListener } from '$lib/cog-protocol';
	import {
		SATS,
		HALF_SWATH_KM,
		loadTles,
		subPoint,
		groundTrack,
		splitAntimeridian,
		swathPolygon,
		predictPasses,
		relativeOrbit,
		fmtJst,
		type TleSet,
		type Pass,
		type SatId,
		type SubPoint
	} from '$lib/s2orbit';
	import {
		composites,
		indices,
		places,
		assetsFor,
		searchItems,
		fetchItem,
		pointValues,
		normDiff,
		fmtDate,
		cogRequestCount,
		type StacItem,
		type RenderMode
	} from '$lib/imagery';

	type MLMap = ML.Map;
	let ml: typeof ML;
	let mapA: MLMap;
	let mapB: MLMap | null = null;
	let mapBReady: Promise<MLMap> | null = null;
	let mapElA: HTMLDivElement;
	let mapElB: HTMLDivElement;
	const cogKeys: { a?: string; b?: string } = {};
	let syncing = false;

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
	let is3D = $state(false);
	let bearing = $state(0);
	let pitch = $state(0);
	let tilesLoading = $state(false);
	let requests = $state(0);

	const currentAssets = $derived(itemA ? assetsFor(mode).map((a) => ({ a, href: itemA!.assets[a].href })) : []);
	const modeDesc = $derived(
		mode.kind === 'composite' ? composites.find((c) => c.id === mode.id)?.desc : indices.find((i) => i.id === mode.id)?.desc
	);
	const num = (v: unknown) => (typeof v === 'number' ? v : null);
	const sunAz = $derived(itemA ? num(itemA.properties['view:sun_azimuth']) : null);
	const sunEl = $derived(itemA ? num(itemA.properties['view:sun_elevation']) : null);
	const satLabel = (it: StacItem) => {
		const s = SATS.find((s) => s.id === it.properties.platform);
		const r = relativeOrbit(it.properties['s2:product_uri']);
		return `${s ? s.name.replace('Sentinel-', 'S') : String(it.properties.platform ?? '')}${r ? ` R${String(r).padStart(3, '0')}` : ''}`;
	};

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

	// ---- 軌道 ----
	let tleSet = $state<TleSet | null>(null);
	let showOrbit = $state(true);
	let satNow = $state<Partial<Record<SatId, SubPoint>>>({});
	let passes = $state<Pass[]>([]);
	let passTarget = $state<{ lat: number; lon: number } | null>(null);
	let selectedPass = $state<Pass | null>(null);
	const satMarkers = new Map<MLMap, Partial<Record<SatId, ML.Marker>>>();
	let tickTimer: ReturnType<typeof setInterval> | undefined;
	let trackTimer: ReturnType<typeof setInterval> | undefined;
	let passDebounce: ReturnType<typeof setTimeout> | undefined;
	/** 観測幅に入る昼側（下降）パスだけが撮影対象 */
	const imagingPasses = $derived(passes.filter((p) => p.descending && p.inSwath));
	const trackHeading = $derived(imagingPasses[0]?.heading ?? null);

	const TERRARIUM = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';

	function baseStyle(): ML.StyleSpecification {
		return {
			version: 8,
			sources: {
				osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, maxzoom: 19, attribution: '© OpenStreetMap' },
				footprint: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
				point: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
				'orbit-track': { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
				'orbit-swath': { type: 'geojson', data: { type: 'FeatureCollection', features: [] } }
			},
			layers: [
				{ id: 'bg', type: 'background', paint: { 'background-color': '#0a0f1e' } },
				// 衛星写真（Esri）のソース／レイヤーはここでは作らない。切り替えた時に初めて追加する
				{ id: 'osm', type: 'raster', source: 'osm' },
				// COG レイヤーはこの下（'footprint' の直前）に挿入される
				{ id: 'footprint', type: 'line', source: 'footprint', paint: { 'line-color': '#8be9fd', 'line-width': 1.5, 'line-dasharray': [3, 3] } },
				{ id: 'orbit-swath', type: 'fill', source: 'orbit-swath', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.12 } },
				{ id: 'orbit-swath-line', type: 'line', source: 'orbit-swath', paint: { 'line-color': ['get', 'color'], 'line-width': 1, 'line-opacity': 0.6 } },
				{ id: 'orbit-track', type: 'line', source: 'orbit-track', paint: { 'line-color': ['get', 'color'], 'line-width': ['get', 'width'], 'line-opacity': 0.85 } },
				{ id: 'point', type: 'circle', source: 'point', paint: { 'circle-radius': 6, 'circle-color': 'rgba(255,184,108,0.3)', 'circle-stroke-color': '#ffb86c', 'circle-stroke-width': 2 } }
			]
		};
	}

	function createMap(el: HTMLDivElement, center: ML.LngLatLike, zoom: number): Promise<MLMap> {
		const map = new ml.Map({
			container: el,
			style: baseStyle(),
			center,
			zoom,
			minZoom: 3,
			maxPitch: 70,
			attributionControl: { compact: true }
		});
		return new Promise((resolve) => map.once('load', () => resolve(map)));
	}

	const forMaps = (fn: (m: MLMap) => void) => {
		if (mapA) fn(mapA);
		if (mapB) fn(mapB);
	};

	onMount(async () => {
		ml = await import('maplibre-gl');
		ml.setWorkerUrl(maplibreWorkerUrl);
		installCogProtocol(ml);
		setTileListener(() => (requests = cogRequestCount()));

		const p0 = places[0];
		mapA = await createMap(mapElA, [p0.center[1], p0.center[0]], p0.zoom);
		mapA.addControl(new ml.NavigationControl({ showCompass: false }), 'top-left');
		mapA.on('click', (e) => queryPoint(e.lngLat.lat, e.lngLat.lng));
		mapA.on('rotate', () => (bearing = mapA.getBearing()));
		mapA.on('pitch', () => (pitch = mapA.getPitch()));
		mapA.on('move', () => mapB && sync(mapA, mapB));
		mapA.on('moveend', schedulePasses);
		const upd = () => (tilesLoading = !mapA.areTilesLoaded());
		mapA.on('dataloading', upd);
		mapA.on('data', upd);
		mapA.on('idle', upd);
		initOverlays(mapA);

		// TLE はマップと並行して取得
		loadTles().then((t) => {
			tleSet = t;
			startOrbit();
			schedulePasses();
		});

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

	onDestroy(() => {
		clearInterval(tickTimer);
		clearInterval(trackTimer);
		clearTimeout(passDebounce);
		setTileListener(null);
	});

	/** 2 枚の地図のカメラを同期（比較モード） */
	function sync(from: MLMap, to: MLMap) {
		if (syncing) return;
		syncing = true;
		to.jumpTo({ center: from.getCenter(), zoom: from.getZoom(), bearing: from.getBearing(), pitch: from.getPitch() });
		syncing = false;
	}

	/** 新しく作った地図に、現在の表示状態（ベースマップ・3D・フットプリント・地点・軌道）を適用 */
	function initOverlays(map: MLMap) {
		applyBasemap(map, basemap);
		apply3D(map, is3D, false);
		if (itemA) setFootprint(map, itemA);
		if (point) setPointData(map, point);
		if (tleSet) {
			ensureSatMarkers(map);
			updateTracks();
		}
		applyOrbitVisibility(map, showOrbit);
	}

	// ---- ベースマップ（衛星写真は初めて選ばれた時だけ読み込む） ----
	function applyBasemap(map: MLMap, b: 'osm' | 'esri') {
		if (b === 'esri' && !map.getSource('esri')) {
			map.addSource('esri', {
				type: 'raster',
				tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
				tileSize: 256,
				maxzoom: 18,
				attribution: 'Esri World Imagery'
			});
			map.addLayer({ id: 'esri', type: 'raster', source: 'esri' }, 'osm');
		}
		map.setLayoutProperty('osm', 'visibility', b === 'osm' ? 'visible' : 'none');
		if (map.getLayer('esri')) map.setLayoutProperty('esri', 'visibility', b === 'esri' ? 'visible' : 'none');
	}
	$effect(() => {
		const b = basemap;
		untrack(() => forMaps((m) => applyBasemap(m, b)));
	});

	// ---- 3D（標高タイルも 3D にした時だけ読み込む） ----
	function apply3D(map: MLMap, on: boolean, animate = true) {
		if (on) {
			if (!map.getSource('dem')) {
				map.addSource('dem', { type: 'raster-dem', tiles: [TERRARIUM], encoding: 'terrarium', tileSize: 256, maxzoom: 15, attribution: 'Terrain: AWS Terrain Tiles (Mapzen)' });
				// 平坦な地図に陰影を付けて起伏を読めるようにする（COG レイヤーの下）
				map.addLayer({ id: 'hillshade', type: 'hillshade', source: 'dem', paint: { 'hillshade-exaggeration': 0.35, 'hillshade-shadow-color': '#000' } }, 'footprint');
				// COG レイヤーが既にあれば hillshade はその下へ
				for (const id of ['cog-a', 'cog-b']) if (map.getLayer(id)) map.moveLayer('hillshade', id);
			}
			map.setLayoutProperty('hillshade', 'visibility', 'visible');
			map.setTerrain({ source: 'dem', exaggeration: 1.3 });
			if (animate && map.getPitch() < 30) map.easeTo({ pitch: 60, duration: 700 });
		} else {
			map.setTerrain(null);
			if (map.getLayer('hillshade')) map.setLayoutProperty('hillshade', 'visibility', 'none');
			if (animate) map.easeTo({ pitch: 0, duration: 700 });
		}
	}
	$effect(() => {
		const on = is3D;
		untrack(() => {
			if (mapA) apply3D(mapA, on);
			// B は A に同期して傾くので、地形だけ切り替える
			if (mapB) apply3D(mapB, on, false);
		});
	});

	function resetNorth() {
		mapA.easeTo({ bearing: 0, duration: 500 });
	}

	// ---- COG レイヤー ----
	function setCog(map: MLMap, slot: 'a' | 'b', item: StacItem | null) {
		const id = `cog-${slot}`;
		if (map.getLayer(id)) map.removeLayer(id);
		if (map.getSource(id)) map.removeSource(id);
		if (cogKeys[slot]) unregisterCogLayer(cogKeys[slot]!);
		delete cogKeys[slot];
		if (!item) return;
		const m = $state.snapshot(mode);
		const reg = registerCogLayer(item, m, gain);
		cogKeys[slot] = reg.key;
		map.addSource(id, {
			type: 'raster',
			tiles: [reg.tiles],
			tileSize: 256,
			minzoom: 8,
			// 10 m 画素は z14〜15 で等倍。これ以上は MapLibre 側で拡大表示（COG を読み直さない）
			maxzoom: 15,
			bounds: item.bbox,
			attribution: 'Sentinel-2 L2A © ESA / Earth Search (AWS)'
		});
		map.addLayer(
			{
				id,
				type: 'raster',
				source: id,
				paint: { 'raster-opacity': opacity, 'raster-fade-duration': 0, 'raster-resampling': m.kind === 'index' ? 'nearest' : 'linear' }
			},
			'footprint'
		);
	}

	function setFootprint(map: MLMap, item: StacItem) {
		(map.getSource('footprint') as ML.GeoJSONSource).setData({ type: 'Feature', geometry: item.geometry as GeoJSON.Geometry, properties: {} });
	}

	async function ensureMapB(): Promise<MLMap> {
		if (mapB) return mapB;
		if (!mapBReady) {
			mapBReady = createMap(mapElB, mapA.getCenter(), mapA.getZoom()).then((m) => {
				m.jumpTo({ bearing: mapA.getBearing(), pitch: mapA.getPitch() });
				m.on('click', (e) => queryPoint(e.lngLat.lat, e.lngLat.lng));
				m.on('move', () => sync(m, mapA));
				mapB = m;
				initOverlays(m);
				return m;
			});
		}
		return mapBReady;
	}

	function destroyMapB() {
		if (cogKeys.b) unregisterCogLayer(cogKeys.b);
		delete cogKeys.b;
		satMarkers.delete(mapB!);
		mapB?.remove();
		mapB = null;
		mapBReady = null;
	}

	async function refreshLayers() {
		setCog(mapA, 'a', itemA);
		if (itemB) {
			const b = await ensureMapB();
			setCog(b, 'b', itemB);
		} else if (mapB) {
			destroyMapB();
		}
	}

	// ---- 検索・選択 ----
	async function search() {
		loading = true;
		error = '';
		try {
			// 地図中心の小さな箱で検索すると、中心を覆うタイルだけが返る
			const c = mapA.getCenter();
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
		mapA.jumpTo({ center: [p.center[1], p.center[0]], zoom: p.zoom });
		itemB = null;
		search();
	}

	function selectA(item: StacItem) {
		itemA = item;
		forMaps((m) => setFootprint(m, item));
		refreshLayers();
		if (point) queryPoint(point.lat, point.lon);
	}

	function selectB(item: StacItem | null) {
		itemB = item?.id === itemB?.id ? null : item;
		refreshLayers();
		if (point) queryPoint(point.lat, point.lon);
	}

	// mode / gain 変更でレイヤーを作り直す。依存を mode / gain だけに限定する（untrack しないと自分自身を再トリガーする）
	$effect(() => {
		void mode.kind;
		void mode.id;
		void gain;
		untrack(() => {
			if (mapA && itemA) refreshLayers();
		});
	});
	$effect(() => {
		const o = opacity;
		untrack(() =>
			forMaps((m) => {
				for (const id of ['cog-a', 'cog-b']) if (m.getLayer(id)) m.setPaintProperty(id, 'raster-opacity', o);
			})
		);
	});

	// ---- 地点 ----
	function setPointData(map: MLMap, p: { lat: number; lon: number }) {
		(map.getSource('point') as ML.GeoJSONSource).setData({ type: 'Feature', geometry: { type: 'Point', coordinates: [p.lon, p.lat] }, properties: {} });
	}

	async function queryPoint(lat: number, lon: number) {
		point = { lat, lon };
		forMaps((m) => setPointData(m, { lat, lon }));
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

	// ---- 軌道 ----
	function ensureSatMarkers(map: MLMap) {
		if (satMarkers.has(map)) return;
		const rec: Partial<Record<SatId, ML.Marker>> = {};
		for (const s of SATS) {
			const el = document.createElement('div');
			el.className = 'sat-marker';
			el.style.setProperty('--c', s.color);
			el.innerHTML = `<span class="dot"></span><span class="lbl">${s.name.replace('Sentinel-', 'S')}</span>`;
			rec[s.id] = new ml.Marker({ element: el, anchor: 'left', offset: [-6, 0] }).setLngLat([0, 0]).addTo(map);
		}
		satMarkers.set(map, rec);
	}

	function startOrbit() {
		forMaps(ensureSatMarkers);
		tick();
		updateTracks();
		clearInterval(tickTimer);
		clearInterval(trackTimer);
		tickTimer = setInterval(tick, 1000);
		trackTimer = setInterval(updateTracks, 60000);
	}

	/** 現在位置を 1 秒ごとに更新 */
	function tick() {
		if (!tleSet) return;
		const now = new Date();
		const next: Partial<Record<SatId, SubPoint>> = {};
		for (const t of tleSet.tles) {
			const p = subPoint(t, now);
			if (!p) continue;
			next[t.id] = p;
			for (const rec of satMarkers.values()) rec[t.id]?.setLngLat([p.lon, p.lat]);
		}
		satNow = next;
	}

	/** これから 1 周（約 100 分）の地上軌跡 + 選択パスの観測幅 */
	function updateTracks() {
		if (!tleSet) return;
		const now = new Date();
		const features: GeoJSON.Feature[] = [];
		for (const t of tleSet.tles) {
			const color = SATS.find((s) => s.id === t.id)!.color;
			const segs = splitAntimeridian(groundTrack(t, now, 101, 30));
			features.push({ type: 'Feature', geometry: { type: 'MultiLineString', coordinates: segs }, properties: { color, width: 1.5 } });
		}
		const swath: GeoJSON.Feature[] = [];
		if (selectedPass) {
			const t = tleSet.tles.find((x) => x.id === selectedPass!.sat)!;
			const color = SATS.find((s) => s.id === t.id)!.color;
			const pts = groundTrack(t, new Date(selectedPass.time.getTime() - 5 * 60000), 10, 15);
			swath.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [swathPolygon(pts)] }, properties: { color } });
			features.push({ type: 'Feature', geometry: { type: 'MultiLineString', coordinates: splitAntimeridian(pts) }, properties: { color, width: 3 } });
		}
		forMaps((m) => {
			(m.getSource('orbit-track') as ML.GeoJSONSource).setData({ type: 'FeatureCollection', features });
			(m.getSource('orbit-swath') as ML.GeoJSONSource).setData({ type: 'FeatureCollection', features: swath });
		});
	}

	function applyOrbitVisibility(map: MLMap, on: boolean) {
		for (const id of ['orbit-track', 'orbit-swath', 'orbit-swath-line']) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
		const rec = satMarkers.get(map);
		if (rec) for (const mk of Object.values(rec)) mk.getElement().style.display = on ? '' : 'none';
	}
	$effect(() => {
		const on = showOrbit;
		untrack(() => forMaps((m) => applyOrbitVisibility(m, on)));
	});

	function schedulePasses() {
		clearTimeout(passDebounce);
		passDebounce = setTimeout(computePasses, 600);
	}

	/** 地図中心の上空を今後 10 日に通るパス */
	function computePasses() {
		if (!tleSet || !mapA) return;
		const c = mapA.getCenter();
		passTarget = { lat: c.lat, lon: c.lng };
		passes = predictPasses(tleSet.tles, c.lat, c.lng, new Date(), 10);
		// 選択中のパスが消えたら解除
		if (selectedPass && !passes.find((p) => p.sat === selectedPass!.sat && Math.abs(p.time.getTime() - selectedPass!.time.getTime()) < 120000)) {
			selectedPass = null;
			updateTracks();
		}
	}

	function selectPass(p: Pass) {
		selectedPass = selectedPass === p ? null : p;
		updateTracks();
	}

	/** 同じ衛星がちょうど 10 日周期（±3 分）前にこの場所を撮ったシーン → 同じ相対軌道 */
	function matchScene(p: Pass): StacItem | undefined {
		const D = 10 * 86400000;
		return items.find((it) => {
			if (it.properties.platform !== p.sat) return false;
			const r = (p.time.getTime() - Date.parse(it.properties.datetime)) % D;
			return Math.min(r, D - r) < 3 * 60000;
		});
	}

	const tleAgeH = $derived(tleSet ? (Date.now() - Math.max(...tleSet.tles.map((t) => t.epoch.getTime()))) / 3600000 : 0);
	const satMeta = (id: SatId) => SATS.find((s) => s.id === id)!;

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
		<li><strong>3D で見る</strong> — 地図右上の「3D」で標高データを重ねて傾けます。右ドラッグ（または Ctrl+ドラッグ）で回転・傾き、コンパスをクリックすると北が上に戻ります。コンパスには <span style="color: #f1fa8c">☀ 撮影時の太陽方位</span>と<span style="color: var(--green)">▲ 衛星の進行方向</span>も出ます。雲の影は ☀ の反対側に落ちます。</li>
		<li><strong>クリックで値を見る</strong> — 地図上の任意の点をクリック → 右下に 7 バンドの DN と 6 指標の値。森・水・建物・雲・雲影をクリックして NDVI がどう変わるか確かめてください。</li>
		<li><strong>2 時期を比べる</strong> — サムネイル右上の「B」で比較レイヤーを設定 → 地図中央の橙スライダーを左右にドラッグ。左が A、右が B。値パネルには B − A の差分も出ます。</li>
		<li><strong>次の撮影を予測する</strong> — 「衛星軌道」パネルに、実際の TLE から計算した Sentinel-2A/2B/2C の現在位置と、地図中心が次に撮影される日時が出ます。検索結果のシーン日付と見比べてください。</li>
	</ol>
	<p class="muted" style="font-size: 0.85rem; margin: 0.3rem 0 0">
		おすすめの体験：<strong>富士山</strong>で 3D + 「NDSI 雪」と「SWIR 合成」（雪と雲の区別）／<strong>琵琶湖</strong>で「NDWI 水域」／<strong>十勝平野</strong>で「農業」合成と 2 時期比較（作物の生育差）／<strong>東京</strong>で皇居・代々木公園と市街地の NDVI 差。
	</p>
</details>

<div class="btn-row">
	{#each places as p (p.name)}
		<button class="ghost" onclick={() => goto(p)} title={p.hint}>{p.name}</button>
	{/each}
</div>

<div class="mapwrap">
	<div bind:this={mapElA} class="map"></div>
	<!-- 比較用の 2 枚目。B 選択時だけ生成され、右側 (swipe% 以降) のみ表示 -->
	<div bind:this={mapElB} class="map mapB" class:hidden={!itemB} style:clip-path="inset(0 0 0 {swipe}%)"></div>

	<div class="map-ui">
		<div class="seg" role="group" aria-label="ベースマップ">
			<button class:active={basemap === 'osm'} onclick={() => (basemap = 'osm')}>地図</button>
			<button class:active={basemap === 'esri'} onclick={() => (basemap = 'esri')} title="Esri World Imagery。選んだ時に初めて読み込みます">衛星写真</button>
		</div>
		<div class="seg" role="group" aria-label="2D / 3D">
			<button class:active={!is3D} onclick={() => (is3D = false)}>2D</button>
			<button class:active={is3D} onclick={() => (is3D = true)} title="標高タイルを重ねて傾けます">3D</button>
		</div>
		<Compass {bearing} {pitch} sunAzimuth={sunAz} sunElevation={sunEl} {trackHeading} onreset={resetNorth} />
		<button class="seg-toggle" class:active={showOrbit} onclick={() => (showOrbit = !showOrbit)} title="Sentinel-2 の現在位置と地上軌跡（実 TLE）">🛰 軌道</button>
	</div>

	{#if tilesLoading || loading}
		<div class="loading">{loading ? 'STAC 検索中…' : 'タイル読込中…'}</div>
	{/if}
	{#if itemA}
		<div class="legend">
			<div><strong>A</strong> {fmtDate(itemA.properties.datetime)} <span class="muted">{satLabel(itemA)} · 雲 {cloud(itemA)?.toFixed(0)}%</span></div>
			{#if itemB}
				<div><strong>B</strong> {fmtDate(itemB.properties.datetime)} <span class="muted">{satLabel(itemB)} · 雲 {cloud(itemB)?.toFixed(0)}%</span> <span class="muted">（右側）</span></div>
			{/if}
		</div>
	{/if}
	{#if itemB}
		<input class="swipe" type="range" min="0" max="100" step="0.5" bind:value={swipe} aria-label="比較スワイプ" />
	{/if}
</div>
<p class="muted" style="font-size: 0.78rem; margin-top: -0.6rem">
	右ドラッグ / Ctrl+ドラッグで回転・傾き。「衛星写真」ベースマップと 3D の標高タイルは、選んだ時に初めて読み込みます。
</p>

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
							<div class="muted">☁ {cloud(it)?.toFixed(0)}% · {satLabel(it).split(' ')[0]}</div>
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
		<h3>衛星軌道 <span class="muted" style="font-weight: 400; font-size: 0.8rem">— 実 TLE から SGP4 で計算</span></h3>
		{#if !tleSet}
			<p class="muted" style="font-size: 0.9rem">TLE 取得中…</p>
		{:else}
			<p class="muted" style="font-size: 0.78rem; margin: 0 0 0.5rem">
				TLE: {tleSet.source === 'bundled' ? '同梱スナップショット（CelesTrak に届かず）' : `CelesTrak${tleSet.source === 'cache' ? '（キャッシュ）' : ''}`}
				· 元期から {tleAgeH < 48 ? `${tleAgeH.toFixed(0)} 時間` : `${(tleAgeH / 24).toFixed(0)} 日`}
			</p>
			<table style="font-size: 0.85rem">
				<thead><tr><th>衛星</th><th class="num">緯度</th><th class="num">経度</th><th class="num">高度</th></tr></thead>
				<tbody>
					{#each SATS as s (s.id)}
						{@const p = satNow[s.id]}
						<tr>
							<td><span class="swatch" style:background={s.color}></span>{s.name} <span class="muted" style="font-size: 0.75rem">{s.launched}〜</span></td>
							<td class="num">{p ? p.lat.toFixed(2) + '°' : '—'}</td>
							<td class="num">{p ? p.lon.toFixed(2) + '°' : '—'}</td>
							<td class="num">{p ? p.alt.toFixed(0) + ' km' : '—'}</td>
						</tr>
					{/each}
				</tbody>
			</table>
			<p class="muted" style="font-size: 0.78rem">
				地図の線はこれから 1 周（約 100 分）の地上軌跡。3 機とも高度約 790 km・傾斜角 98.6° の太陽同期軌道で、下降側（北→南）を地方時 10:30 頃に通ります。
			</p>
		{/if}
	</div>

	<div class="panel">
		<h3>
			次にここが撮影されるのは
			{#if passTarget}<span class="muted" style="font-weight: 400; font-size: 0.75rem; font-family: var(--mono)">（{passTarget.lat.toFixed(2)}, {passTarget.lon.toFixed(2)}）</span>{/if}
		</h3>
		{#if !tleSet}
			<p class="muted" style="font-size: 0.9rem">TLE 取得中…</p>
		{:else if !imagingPasses.length}
			<p class="muted" style="font-size: 0.9rem">今後 10 日間にこの地点を観測幅（±{HALF_SWATH_KM} km）に収める昼側パスがありません。</p>
		{:else}
			<table style="font-size: 0.85rem">
				<thead><tr><th>日時 (JST)</th><th>衛星</th><th class="num">横ずれ</th><th class="num">太陽高度</th><th>10 日前</th></tr></thead>
				<tbody>
					{#each imagingPasses as p (p.sat + p.time.getTime())}
						{@const m = matchScene(p)}
						<tr class="pass" class:sel={selectedPass === p} onclick={() => selectPass(p)} title="クリックで観測幅を地図に表示">
							<td style="font-family: var(--mono)">{fmtJst(p.time)}</td>
							<td><span class="swatch" style:background={satMeta(p.sat).color}></span>{satMeta(p.sat).name.replace('Sentinel-', 'S')}</td>
							<td class="num" title="直下点からの横方向距離。負 = 進行方向左（東）側">{p.crossTrackKm.toFixed(0)} km</td>
							<td class="num">{p.sunElevation.toFixed(0)}°</td>
							<td class="muted" style="font-size: 0.78rem">{m ? `✓ ${fmtDate(m.properties.datetime)} ${satLabel(m).split(' ')[1] ?? ''}` : ''}</td>
						</tr>
					{/each}
				</tbody>
			</table>
			<p class="muted" style="font-size: 0.78rem">
				地図中心を観測幅に収める下降（昼側）パスを、地図を動かすごとに再計算。「10 日前」に ✓ があれば、同じ衛星が同じ相対軌道（R 番号）でちょうど 10 日前に撮ったシーンが検索結果にあります——
				Sentinel-2 の 10 日回帰が実データで確かめられます。行をクリックすると、その時の観測幅（幅 290 km）を地図に描きます。
				陸域は系統的に撮影されますが、実際にシーンが公開されるかは取得計画と処理状況によります。
			</p>
		{/if}
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

{#if itemA}
	<div class="panel">
		<h3>シーン A の取得メタデータ <span class="muted" style="font-weight: 400; font-size: 0.8rem">— STAC properties から</span></h3>
		<div class="grid cols-3">
			<div class="stat"><span class="label">衛星 / 相対軌道</span><span class="value" style="font-size: 1.1rem">{satLabel(itemA)}</span></div>
			<div class="stat"><span class="label">撮影時刻 (JST)</span><span class="value" style="font-size: 1.1rem">{fmtJst(new Date(itemA.properties.datetime))}</span></div>
			<div class="stat"><span class="label">MGRS タイル</span><span class="value" style="font-size: 1.1rem">{String(itemA.properties['grid:code'] ?? '').replace('MGRS-', '')}</span></div>
			<div class="stat"><span class="label">太陽方位 / 高度</span><span class="value" style="font-size: 1.1rem">{fmt(sunAz, 1)}° / {fmt(sunEl, 1)}°</span></div>
			<div class="stat"><span class="label">視線方位 / 入射角</span><span class="value" style="font-size: 1.1rem">{fmt(num(itemA.properties['view:azimuth']), 1)}° / {fmt(num(itemA.properties['view:incidence_angle']), 1)}°</span></div>
			<div class="stat"><span class="label">軌道</span><span class="value" style="font-size: 1.1rem">{String(itemA.properties['sat:orbit_state'] ?? 'descending')}</span></div>
		</div>
		<p class="muted" style="font-size: 0.8rem">
			太陽方位はコンパスの ☀。雲の影はその反対方向（{sunAz !== null ? `${Math.round((sunAz + 180) % 360)}°` : '—'}）に落ちるので、NDVI で赤く出た塊が影か水かの判断に使えます。
			入射角が小さいのは MSI がほぼ直下視だから。軌跡の真下から東西に離れたタイルほど入射角が大きく（観測幅の端で約 12°）、視線方位は衛星のいる側を向きます。
			「相対軌道 R###」は 10 日周期で繰り返す 143 本の軌跡の番号で、同じ R 番号のシーン同士は同じ角度で撮られています。
		</p>
	</div>
{/if}
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
		height: 560px;
		border-radius: 12px;
		border: 1px solid var(--border);
		overflow: hidden;
		background: #0a0f1e;
	}
	.map {
		position: absolute;
		inset: 0;
	}
	.mapB.hidden {
		visibility: hidden;
	}
	.map-ui {
		position: absolute;
		top: 10px;
		right: 10px;
		z-index: 5;
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 0.45rem;
	}
	.seg {
		display: inline-flex;
		background: rgba(11, 16, 32, 0.88);
		border: 1px solid var(--border);
		border-radius: 8px;
		overflow: hidden;
		box-shadow: 0 2px 6px rgba(0, 0, 0, 0.4);
	}
	.seg button,
	.seg-toggle {
		background: transparent;
		color: var(--muted);
		border: none;
		border-radius: 0;
		padding: 0.3rem 0.7rem;
		font-size: 0.8rem;
		font-weight: 600;
	}
	.seg button + button {
		border-left: 1px solid var(--border);
	}
	.seg button.active {
		background: var(--panel-2);
		color: var(--text);
	}
	.seg-toggle {
		background: rgba(11, 16, 32, 0.88);
		border: 1px solid var(--border);
		border-radius: 8px;
		box-shadow: 0 2px 6px rgba(0, 0, 0, 0.4);
	}
	.seg-toggle.active {
		color: var(--text);
		border-color: var(--accent);
	}
	.loading {
		position: absolute;
		top: 10px;
		left: 50%;
		transform: translateX(-50%);
		z-index: 5;
		background: rgba(11, 16, 32, 0.85);
		border: 1px solid var(--border);
		border-radius: 6px;
		padding: 0.25rem 0.7rem;
		font-size: 0.8rem;
		color: var(--accent-2);
	}
	.legend {
		position: absolute;
		bottom: 28px;
		left: 10px;
		z-index: 5;
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
		z-index: 6;
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
	.swatch {
		display: inline-block;
		width: 9px;
		height: 9px;
		border-radius: 50%;
		margin-right: 0.35rem;
		vertical-align: middle;
	}
	tr.pass {
		cursor: pointer;
	}
	tr.pass:hover td {
		background: var(--panel-2);
	}
	tr.pass.sel td {
		background: var(--panel-2);
		color: var(--accent-2);
	}
	/* MapLibre のコントロールをダークテーマに */
	:global(.maplibregl-ctrl-group) {
		background: rgba(11, 16, 32, 0.88) !important;
		border: 1px solid var(--border);
		box-shadow: 0 2px 6px rgba(0, 0, 0, 0.4) !important;
	}
	:global(.maplibregl-ctrl-group button + button) {
		border-top-color: var(--border) !important;
	}
	:global(.maplibregl-ctrl button .maplibregl-ctrl-icon) {
		filter: invert(0.85);
	}
	:global(.maplibregl-ctrl-attrib) {
		background: rgba(11, 16, 32, 0.8) !important;
		color: var(--muted) !important;
		font-size: 0.65rem;
	}
	:global(.maplibregl-ctrl-attrib a) {
		color: var(--accent) !important;
	}
	:global(.maplibregl-ctrl-attrib-button) {
		filter: invert(0.85);
	}
	/* 衛星の現在位置マーカー */
	:global(.sat-marker) {
		display: flex;
		align-items: center;
		gap: 4px;
		pointer-events: none;
		font-family: var(--mono);
		font-size: 0.7rem;
		font-weight: 700;
		color: var(--c);
		text-shadow: 0 0 3px #000, 0 0 3px #000;
	}
	:global(.sat-marker .dot) {
		width: 12px;
		height: 12px;
		border-radius: 50%;
		background: var(--c);
		box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.25), 0 0 10px var(--c);
	}
</style>
