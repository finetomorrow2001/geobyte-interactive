<script lang="ts">
	import { onMount, onDestroy, untrack } from 'svelte';
	import { page } from '$app/state';
	import 'maplibre-gl/dist/maplibre-gl.css';
	import type * as ML from 'maplibre-gl';
	// MapLibre の Worker は Vite に別エントリとしてバンドルさせ、URL を明示的に渡す
	import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
	import type * as GeoJSON from 'geojson';
	import Compass from '$lib/Compass.svelte';
	import { searchAnnual, manualSelect, reselectByRegion, inFootprint, type AnnualScene } from '$lib/annual';
	import { sclReason, invalidShare, SCL_INVALID_CLASSES, type SclSummary, type SclReason } from '$lib/scl';
	import { installCogProtocol, registerCogLayer, unregisterCogLayer, setTileListener, type TileProgress } from '$lib/cog-protocol';
	import {
		SATS,
		HALF_SWATH_KM,
		loadTles,
		subPoint,
		groundTrack,
		unwrapLons,
		swathPolygon,
		scanLine,
		imagingSegments,
		bearingDeg,
		distanceKm,
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
		indexFromDn,
		offsetKnown,
		regionStats,
		fmtDate,
		cogRequestCount,
		type StacItem,
		type RenderMode
	} from '$lib/imagery';
	import { makeT, L, i18n } from '$lib/i18n/lang.svelte';
	import { imagery as dict } from '$lib/i18n/imagery';

	const t = makeT(dict);

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
	// 年次比較: 季節窓ごとに各年の最良シーンを 1 つずつ保持（searchYearly）。時系列グラフの対象にもなる
	let yearly = $state<AnnualScene[]>([]);
	let monthDay = $state('10-02');
	let dateTolerance = $state(14);
	let allowMissing = $state(false);
	let yearlyCloud = $state(30);
	let selectedArea = $state('');
	let annualQuery = $state('');
	let searchVersion = 0;
	let annualVersion = 0;
	let pointVersion = 0;
	let seriesVersion = 0;
	let layerVersion = 0;
	let mapBGeneration = 0;
	// タイル読込状態: B 側の読込中表示と、A/B 各レイヤーのタイル取得失敗数
	let tilesLoadingB = $state(false);
	// 表示範囲のうち、A/B のシーン輪郭に入っている割合（7×7 の格子で判定）。外れていれば「画像範囲外」を示す
	let cover = $state({ a: 1, b: 1 });
	function coverOf(item: StacItem | null, m: MLMap | null): number {
		if (!item || !m) return 1;
		const bd = m.getBounds();
		let inside = 0;
		const N = 7;
		for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
			const lon = bd.getWest() + ((i + 0.5) / N) * (bd.getEast() - bd.getWest());
			const lat = bd.getSouth() + ((j + 0.5) / N) * (bd.getNorth() - bd.getSouth());
			if (inFootprint(item, lon, lat)) inside++;
		}
		return inside / (N * N);
	}
	function updateCover() {
		cover = { a: coverOf(itemA, mapA ?? null), b: coverOf(itemB, mapA ?? null) };
	}
	const blankProgress = (): TileProgress => ({ pending: 0, completed: 0, empty: 0, failed: 0 });
	let tileProgress = $state({ a: blankProgress(), b: blankProgress() });
	let imageZoom = $state({ a: 0, b: 0 });
	let imageOutside = $state({ a: false, b: false });
	let imageLoaded = $state({ a: false, b: false });
	function updateImageLoaded(map: MLMap, slot: 'a' | 'b') {
		imageZoom[slot] = map.getZoom();
		const item = slot === 'a' ? itemA : itemB;
		const bounds = map.getBounds();
		imageOutside[slot] = !!item && (bounds.getEast() < item.bbox[0] || bounds.getWest() > item.bbox[2] || bounds.getNorth() < item.bbox[1] || bounds.getSouth() > item.bbox[3]);
		imageLoaded[slot] = !!map.getSource(`cog-${slot}`) && map.isSourceLoaded(`cog-${slot}`);
	}
	let tileErr = $state({ a: 0, b: 0 });
	let tileMsg = $state({ a: '', b: '' });
	const onTileError = (slot: 'a' | 'b') => (e: unknown) => {
		const ev = e as { sourceId?: string; error?: Error };
		if (ev.sourceId !== `cog-${slot}`) return;
		tileErr[slot]++;
		tileMsg[slot] = ev.error?.message ?? '';
	};
	const reasonText = (r: string) => t(`reason_${r}` as Parameters<typeof t>[0]);
	let annualSnapshot = $state<object | null>(null);
	// Public locality overview boxes only; no application boundaries or private map data.
	const studyAreas = [
		{ id: 'south', name: { ja: '夕張・南側', en: 'Yubari – South' }, detail: { ja: '紅葉山・沼ノ沢周辺', en: 'Around Momijiyama & Numanosawa' }, bbox: [141.975, 42.91, 142.09, 42.98] as [number,number,number,number] },
		{ id: 'north', name: { ja: '夕張・北側', en: 'Yubari – North' }, detail: { ja: '南清水沢・鹿の谷周辺', en: 'Around Minami-Shimizusawa & Shikanotani' }, bbox: [141.915, 42.975, 142.055, 43.065] as [number,number,number,number] }
	];
	// 年カードの地域内 SCL 集計（シーン ID → 集計）。分母・除外クラスは scl.ts を参照
	let regionStat = $state<Record<string, SclSummary>>({});
	let regionErr = $state<Record<string, string>>({});
	let regionBusy = $state(false);
	let annualBbox = $state<[number, number, number, number] | null>(null);
	let maxInvalidPct = $state(20);
	const REGION_GRID = 150;
	let yearlyYears = $state(8);
	let yearlyLoading = $state(false);

	// ---- 表示 ----
	let itemA = $state<StacItem | null>(null);
	let itemB = $state<StacItem | null>(null);
	let mode = $state<RenderMode>({ kind: 'composite', id: 'tci' });
	let gain = $state(1);
	let opacity = $state(1);
	let swipe = $state(50);
	let basemap = $state<'osm' | 'esri'>('osm');
	let is3D = $state(false);
	/** 地図の全画面表示（Fullscreen API。使えない環境では CSS でビューポート全体に固定） */
	let fullscreen = $state(false);
	let mapWrapEl: HTMLDivElement;
	let bearing = $state(0);
	let pitch = $state(0);
	let tilesLoading = $state(false);
	let requests = $state(0);

	const currentAssets = $derived(itemA ? assetsFor(mode).map((a) => ({ a, href: itemA!.assets[a].href })) : []);
	const modeDesc = $derived(
		mode.kind === 'composite' ? composites.find((c) => c.id === mode.id)?.desc : indices.find((i) => i.id === mode.id)?.desc
	);
	const modeDescText = $derived(modeDesc ? L(modeDesc) : '');
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
	/** 1 地点の読み取り結果。scl: undefined = SCL アセットなし（マスクできない）、null = 欠測/取得不可 */
	type PointRead = { item: StacItem; vals: Record<string, number | null>; scl: number | null | undefined };
	let pointA = $state<PointRead | null>(null);
	let pointB = $state<PointRead | null>(null);
	let pointLoading = $state(false);
	const pointAssets = ['blue', 'green', 'red', 'nir', 'nir08', 'swir16', 'swir22'];

	// ---- 時系列 ----
	let series = $state<{ item: StacItem; v: number | null; reason: SclReason | null }[]>([]);
	let seriesLoading = $state(false);
	let seriesIndex = $state('ndvi');
	/** 時系列グラフの対象: 検索結果（最新）か年次比較のシーン */
	let seriesSource = $state<'items' | 'yearly'>('items');

	$effect(() => {
		const selected = mode.kind === 'index' ? mode.id : null;
		untrack(() => { if (selected && selected !== seriesIndex) { seriesIndex = selected; if (point && series.length) buildSeries(); } });
	});

	// ---- 軌道 ----
	let tleSet = $state<TleSet | null>(null);
	let showOrbit = $state(true);
	let satNow = $state<Partial<Record<SatId, SubPoint>>>({});
	let passes = $state<Pass[]>([]);
	let passTarget = $state<{ lat: number; lon: number } | null>(null);
	let selectedPass = $state<Pass | null>(null);
	const satMarkers = new Map<MLMap, Partial<Record<SatId, ML.Marker>>>();
	let tickTimer: ReturnType<typeof setInterval> | undefined;
	let passDebounce: ReturnType<typeof setTimeout> | undefined;
	/** 表示時刻 = 現在 + オフセット [分]。0 = LIVE */
	let timeOffsetMin = $state(0);
	/** 60 倍速再生（1 秒ごとに +1 分） */
	let playing = $state(false);
	/** 表示時刻の直前に撮影されたシーンへ画像 A を自動で切り替える */
	let syncScene = $state(true);
	/** 同期で画像が切り替わった直後の通知（凡例を点滅） */
	let switched = $state<{ date: string; sat: string } | null>(null);
	let switchedTimer: ReturnType<typeof setTimeout> | undefined;
	/** スライダーの範囲 [分]: 過去側は検索期間（シーンの撮影時刻が必ず入る）、未来側は +10 日（パス予測と同じ） */
	const rangeMin = $derived(-days * 1440);
	const RANGE_MAX = 10 * 1440;
	const offToPct = (off: number) => ((off - rangeMin) / (RANGE_MAX - rangeMin)) * 100;
	let shownTime = $state(new Date());
	const displayTime = () => new Date(Date.now() + timeOffsetMin * 60000);
	const fmtOffset = (m: number) => {
		if (m === 0) return 'LIVE';
		const a = Math.abs(m), sign = m < 0 ? '−' : '+';
		if (a >= 1440) return `${sign}${Math.floor(a / 1440)}d ${Math.floor((a % 1440) / 60)}h`;
		return `${sign}${a >= 60 ? `${Math.floor(a / 60)}h` : ''}${String(a % 60).padStart(a >= 60 ? 2 : 1, '0')}m`;
	};
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
				'orbit-swath': { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
				'orbit-scan': { type: 'geojson', data: { type: 'FeatureCollection', features: [] } }
			},
			layers: [
				{ id: 'bg', type: 'background', paint: { 'background-color': '#0a0f1e' } },
				// 衛星写真（Esri）のソース／レイヤーはここでは作らない。切り替えた時に初めて追加する
				{ id: 'osm', type: 'raster', source: 'osm' },
				// COG レイヤーはこの下（'footprint' の直前）に挿入される
				{ id: 'footprint', type: 'line', source: 'footprint', paint: { 'line-color': '#8be9fd', 'line-width': 1.5, 'line-dasharray': [3, 3] } },
				{ id: 'orbit-swath', type: 'fill', source: 'orbit-swath', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.12 } },
				{ id: 'orbit-swath-line', type: 'line', source: 'orbit-swath', paint: { 'line-color': ['get', 'color'], 'line-width': 1, 'line-opacity': 0.6 } },
				{ id: 'orbit-track', type: 'line', source: 'orbit-track', paint: { 'line-color': ['get', 'color'], 'line-width': ['get', 'width'], 'line-opacity': 0.85, 'line-dasharray': ['case', ['get', 'imaging'], ['literal', [1, 0]], ['literal', [2, 3]]] } },
				// 観測幅と同色だと埋もれるので、衛星色の縁取り + 白の芯線で描く
				{ id: 'orbit-scan-casing', type: 'line', source: 'orbit-scan', paint: { 'line-color': ['get', 'color'], 'line-width': 6, 'line-opacity': 0.9 } },
				{ id: 'orbit-scan', type: 'line', source: 'orbit-scan', paint: { 'line-color': '#ffffff', 'line-width': 2.5 } },
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
			dragRotate: true,
			pitchWithRotate: true,
			touchZoomRotate: true,
			touchPitch: true,
			attributionControl: { compact: true }
		});
		// Shift + ホイール／トラックパッドスクロールはズームせず方位を変更する。
		const rotateWheel = (event: WheelEvent) => {
			if (!event.shiftKey || event.ctrlKey) return;
			event.preventDefault(); event.stopImmediatePropagation();
			const delta = event.deltaX || event.deltaY;
			const pixels = delta * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? el.clientWidth : 1);
			map.jumpTo({ bearing: map.getBearing() + Math.max(-30, Math.min(30, pixels * 0.2)) });
		};
		map.getCanvas().addEventListener('wheel', rotateWheel, { passive: false, capture: true });
		map.once('remove', () => map.getCanvas().removeEventListener('wheel', rotateWheel, true));
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
		locationControl = new ml.GeolocateControl({ positionOptions: { enableHighAccuracy: true, timeout: 30000 }, trackUserLocation: true, showAccuracyCircle: true });
		mapA.addControl(locationControl, 'top-left');
		locationControl.on('geolocate', () => { locationBusy = false; locationMessage = t('locationFound'); });
		locationControl.on('error', () => { locationBusy = false; locationMessage = t('locationError'); });
		mapA.on('moveend', updateBasemapDate);
		mapA.addControl(new ml.NavigationControl({ showCompass: false }), 'top-left');
		mapA.on('click', (e) => queryPoint(e.lngLat.lat, e.lngLat.lng));
		mapA.on('rotate', () => (bearing = mapA.getBearing()));
		mapA.on('pitch', () => (pitch = mapA.getPitch()));
		mapA.on('move', () => mapB && sync(mapA, mapB));
		mapA.on('moveend', schedulePasses);
		mapA.on('moveend', updateCover);
		const upd = () => { tilesLoading = !mapA.areTilesLoaded(); updateImageLoaded(mapA, 'a'); };
		mapA.on('dataloading', upd);
		mapA.on('data', upd);
		mapA.on('idle', upd);
		mapA.on('moveend', upd);
		mapA.on('error', onTileError('a'));
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
		clearTimeout(passDebounce);
		clearTimeout(switchedTimer);
		setTileListener(null);
		metadataAbort?.abort();
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
			updateTracks(displayTime());
		}
		applyOrbitVisibility(map, showOrbit);
	}

	let locationBusy = $state(false);
	let locationMessage = $state('');
	let locationControl: ML.GeolocateControl | null = null;
	let basemapDate = $state('');
	let metadataVersion = 0;
	let metadataAbort: AbortController | null = null;
	async function updateBasemapDate() {
		const version = ++metadataVersion;
		metadataAbort?.abort();
		basemapDate = '';
		if (!mapA || basemap !== 'esri') return;
		const controller = new AbortController(); metadataAbort = controller;
		basemapDate = t('baseDateBusy');
		const c = mapA.getCenter(), b = mapA.getBounds(), canvas = mapA.getCanvas();
		const params = new URLSearchParams({ f: 'json', geometry: `${c.lng},${c.lat}`, geometryType: 'esriGeometryPoint', sr: '4326', layers: 'visible:4', mapExtent: `${b.getWest()},${b.getSouth()},${b.getEast()},${b.getNorth()}`, imageDisplay: `${canvas.clientWidth},${canvas.clientHeight},96`, tolerance: '0', returnGeometry: 'false' });
		try {
			const response = await fetch(`https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/identify?${params}`, { signal: controller.signal });
			if (!response.ok) throw new Error('Metadata request failed');
			const data = await response.json();
			const zoom = Math.min(18, Math.floor(mapA.getZoom()));
			const rows = (data.results ?? []).filter((r: { attributes: Record<string, string> }) => zoom >= Number(r.attributes.FROM_CACHE_LEVEL) && zoom <= Number(r.attributes.TO_CACHE_LEVEL));
			const dates = [...new Set<string>(rows.map((r: { attributes: Record<string, string> }) => r.attributes['DATE (YYYYMMDD)']).filter((d: string) => /^\d{8}$/.test(d)))].map(d => `${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}`);
			if (version === metadataVersion) basemapDate = dates.length ? t('baseDate', dates.join(' / ')) : t('baseDateUnknown');
		} catch { if (version === metadataVersion) basemapDate = t('baseDateUnknown'); }
	}
	function locate() {
		if (!locationControl) return;
		locationBusy = true; locationMessage = '';
		locationControl.trigger();
	}
	function rotateMap(degrees: number) { if (mapA) mapA.jumpTo({ bearing: degrees }); }
	function graphAnimation() {
		animationPlaying = false;
		seriesSource = animationSource === 'annual' ? 'yearly' : 'items';
		if (mode.kind === 'index') seriesIndex = mode.id;
		if (!point && mapA) { const c = mapA.getCenter(); queryPoint(c.lat, c.lng); }
		buildSeries();
		document.getElementById('series-chart')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
		untrack(() => updateBasemapDate());
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

	/** 比較境界のつまみをドラッグ（ポインタキャプチャで地図のドラッグを奪わせない） */
	function startSwipe(e: PointerEvent) {
		e.preventDefault();
		e.stopPropagation();
		const el = e.currentTarget as HTMLElement;
		el.setPointerCapture(e.pointerId);
		const move = (ev: PointerEvent) => {
			const r = mapWrapEl.getBoundingClientRect();
			swipe = Math.max(0, Math.min(100, ((ev.clientX - r.left) / r.width) * 100));
		};
		const up = () => {
			el.removeEventListener('pointermove', move);
			el.removeEventListener('pointerup', up);
			el.removeEventListener('pointercancel', up);
		};
		el.addEventListener('pointermove', move);
		el.addEventListener('pointerup', up);
		el.addEventListener('pointercancel', up);
	}

	async function toggleFullscreen() {
		if (document.fullscreenEnabled) {
			if (document.fullscreenElement === mapWrapEl) await document.exitFullscreen();
			else await mapWrapEl.requestFullscreen().catch(() => (fullscreen = !fullscreen));
		} else {
			fullscreen = !fullscreen;
		}
	}
	function onFullscreenChange() {
		fullscreen = document.fullscreenElement === mapWrapEl;
	}
	// コンテナのサイズが変わったら MapLibre に知らせる
	$effect(() => {
		void fullscreen;
		untrack(() => {
			requestAnimationFrame(() => forMaps((m) => m.resize()));
			setTimeout(() => forMaps((m) => m.resize()), 350);
		});
	});

	// ---- COG レイヤー ----
	function setCog(map: MLMap, slot: 'a' | 'b', item: StacItem | null) {
		const id = `cog-${slot}`;
		if (map.getLayer(id)) map.removeLayer(id);
		if (map.getSource(id)) map.removeSource(id);
		if (cogKeys[slot]) unregisterCogLayer(cogKeys[slot]!);
		delete cogKeys[slot];
		tileProgress[slot] = blankProgress();
		imageLoaded[slot] = false;
		tileErr[slot] = 0;
		tileMsg[slot] = '';
		if (!item) return;
		const m = $state.snapshot(mode);
		const reg = registerCogLayer(item, m, gain, (progress) => { tileProgress[slot] = progress; });
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
			const generation = mapBGeneration;
			mapBReady = createMap(mapElB, mapA.getCenter(), mapA.getZoom()).then((m) => {
				if (generation !== mapBGeneration) { m.remove(); throw new Error('Comparison map superseded'); }
				m.jumpTo({ bearing: mapA.getBearing(), pitch: mapA.getPitch() });
				m.on('click', (e) => queryPoint(e.lngLat.lat, e.lngLat.lng));
				m.on('move', () => sync(m, mapA));
				const updB = () => { tilesLoadingB = !m.areTilesLoaded(); updateImageLoaded(m, 'b'); };
				m.on('dataloading', updB);
				m.on('data', updB);
				m.on('idle', updB);
				m.on('moveend', updB);
				m.on('error', onTileError('b'));
				mapB = m;
				initOverlays(m);
				return m;
			});
		}
		return mapBReady;
	}

	function destroyMapB() {
		++mapBGeneration;
		tilesLoadingB = false;
		tileErr.b = 0;
		tileMsg.b = '';
		if (cogKeys.b) unregisterCogLayer(cogKeys.b);
		delete cogKeys.b;
		satMarkers.delete(mapB!);
		mapB?.remove();
		mapB = null;
		mapBReady = null;
	}

	async function refreshLayers() {
		++layerVersion;
		updateCover();
		setCog(mapA, 'a', itemA);
		if (itemB) {
			const version = ++layerVersion;
			try {
				const b = await ensureMapB();
				if (version !== layerVersion || !itemB) return;
				setCog(b, 'b', itemB);
			} catch (e) { if (version === layerVersion) error = String(e); }
		} else if (mapB) {
			destroyMapB();
		}
	}

	// ---- 検索・選択 ----
	async function search() {
		animationPlaying = false;
		if (!mapA) return;
		const version = ++searchVersion;
		loading = true;
		error = '';
		try {
			// 地図中心の小さな箱で検索すると、中心を覆うタイルだけが返る
			const c = mapA.getCenter();
			const d = 0.02;
			const found = await searchItems([c.lng - d, c.lat - d, c.lng + d, c.lat + d], days, maxCloud);
			if (version !== searchVersion) return;
			items = found;
			if (seriesSource === 'items' && series.length && point) buildSeries();
			if (items.length && !items.find((i) => i.id === itemA?.id)) selectA(items[0]);
			if (!items.length) error = t('searchNoScenes');
		} catch (e) {
			if (version !== searchVersion) return;
			error = e instanceof Error ? e.message : String(e);
		} finally {
			if (version === searchVersion) loading = false;
		}
	}

	/** 地図中心で年次シーンを検索し、最も古い年のシーンを A にする */
	async function searchYear() {
		animationPlaying = false;
		if (!mapA) return;
		const version = ++annualVersion;
		++searchVersion;
		loading = false;
		++pointVersion; ++seriesVersion; pointLoading = false; seriesLoading = false;
		const hadSeries = series.length > 0;
		regionStat = {}; regionErr = {}; regionBusy = false;
		yearly = []; annualSnapshot = null; pointA = null; pointB = null; selectB(null); itemA = null; setCog(mapA, 'a', null); series = [];
		yearlyLoading = true;
		error = '';
		try {
			const c = mapA.getCenter();
			const d = 0.02;
			const area = studyAreas.find(a => a.id === selectedArea);
			const bbox = area?.bbox ?? [c.lng-d,c.lat-d,c.lng+d,c.lat+d] as [number,number,number,number];
			const description = t('annualQueryText', area ? t('annualQueryArea', L(area.name), L(area.detail)) : t('annualQueryCenter'), monthDay, dateTolerance, yearlyCloud, allowMissing);
			const options = {monthDay,years:yearlyYears,maxCloud:yearlyCloud,tolerance:dateTolerance,allowMissing};
			const found = await searchAnnual(bbox, options);
			if (version !== annualVersion) return;
			annualBbox = bbox; yearly = found; annualQuery = description; annualSnapshot = {area: area ? {id:area.id,name:area.name,detail:area.detail,bbox} : {bbox}, options, scope: t('annualScope'), quality: t('annualQuality')}; seriesSource = 'yearly';
			const first = yearly.find((y) => y.item)?.item;
			if (first) selectA(first);
			if (hadSeries && point) buildSeries();
			loadRegionStats(yearly.flatMap((y) => (y.item ? [y.item] : [])), version);
			if (!first) error = t('searchNoScenes');
		} catch (e) {
			if (version !== annualVersion) return;
			error = e instanceof Error ? e.message : String(e);
		} finally {
			if (version === annualVersion) yearlyLoading = false;
		}
	}

	function goto(p: (typeof places)[number]) {
		if (!mapA) return;
		resetStudy(); selectedArea = '';
		mapA.jumpTo({ center: [p.center[1], p.center[0]], zoom: p.zoom });
		itemB = null;
		search();
	}
	/** 地域内集計を並列数を制限して取得。検索が変わったら捨てる（annualVersion で判定） */
	async function loadRegionStats(list: StacItem[], version: number, concurrency = 4) {
		// $state のプロキシは postMessage で複製できないので素の配列にする
		const bbox = annualBbox ? ([...annualBbox] as [number, number, number, number]) : null;
		if (!bbox) return;
		const queue = list.filter((i) => !regionStat[i.id] && i.assets.scl);
		for (const i of list) if (!i.assets.scl) regionErr[i.id] = t('regionNoScl');
		const worker = async () => {
			for (let it = queue.shift(); it; it = queue.shift()) {
				try {
					const st = await regionStats(it, bbox, REGION_GRID);
					if (version === annualVersion) regionStat[it.id] = st;
				} catch (e) {
					if (version === annualVersion) regionErr[it.id] = e instanceof Error ? e.message : String(e);
				}
			}
		};
		await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
	}

	/** 採用中のシーンが閾値を超える年だけ候補を集計し、基準日に最も近い閾値以下の候補へ差し替える */
	async function reselectByRegionClick() {
		if (regionBusy || !yearly.length) return;
		const version = annualVersion;
		regionBusy = true;
		try {
			const max = Math.max(0, Math.min(100, maxInvalidPct)) / 100;
			const over = yearly.filter((y) => y.item && regionStat[y.item.id] && invalidShare(regionStat[y.item.id]) > max);
			await loadRegionStats(over.flatMap((y) => y.alternatives ?? []), version);
			if (version !== annualVersion) return;
			const hadSeries = series.length > 0;
			const before = new Map(yearly.map((y) => [y.year, y.item]));
			yearly = yearly.map((y) => reselectByRegion(y, regionStat, max));
			for (const y of yearly) {
				const prev = before.get(y.year);
				if (!y.item || !prev || prev.id === y.item.id) continue;
				if (itemB?.id === prev.id) selectB(y.item);
				if (itemA?.id === prev.id) selectA(y.item);
			}
			++seriesVersion; seriesLoading = false; series = [];
			if (hadSeries && point && seriesSource === 'yearly') buildSeries();
		} finally {
			if (version === annualVersion) regionBusy = false;
		}
	}
	const pct = (n: number, total: number, d = 1) => ((100 * n) / (total || 1)).toFixed(d);

	function resetStudy() {
		animationPlaying = false;
		++annualVersion; ++searchVersion; ++pointVersion; ++seriesVersion; ++layerVersion;
		pointLoading = false; seriesLoading = false; annualSnapshot = null;
		yearlyLoading = false; loading = false; yearly = []; annualQuery = ''; items = []; series = [];
		regionStat = {}; regionErr = {}; regionBusy = false; annualBbox = null;
		point = null; pointA = null; pointB = null; itemA = null; itemB = null;
		error = '';
		if (mapA) setCog(mapA, 'a', null);
		destroyMapB();
		forMaps(m => (m.getSource('point') as ML.GeoJSONSource)?.setData({type:'FeatureCollection',features:[]}));
		forMaps(m => (m.getSource('footprint') as ML.GeoJSONSource)?.setData({type:'FeatureCollection',features:[]}));
	}
	function chooseArea(id: string) {
		if (!mapA) return;
		const area = studyAreas.find(a => a.id === id); if (!area) return;
		resetStudy(); selectedArea = id;
		const b = area.bbox;
		mapA.fitBounds([[b[0],b[1]],[b[2],b[3]]],{padding:36,duration:0});
	}
	function changeAnnualCandidate(year: number, id: string) {
		const row = yearly.find(y => y.year === year);
		const item = row?.alternatives?.find(i => i.id === id);
		if (!row || !item) return;
		const previous = row.item?.id;
		const hadSeries = series.length > 0;
		yearly = yearly.map(y => y.year === year ? manualSelect(y, item) : y);
		loadRegionStats([item], annualVersion);
		++seriesVersion; seriesLoading = false; series = [];
		if (itemB?.id === previous) selectB(item);
		selectA(item);
		// 年のシーンが入れ替わったので、時系列は新しいシーン集合で再計算する
		if (hadSeries && point && seriesSource === 'yearly') buildSeries();
	}

	function exportAnnual() {
		const blob = new Blob([JSON.stringify({...annualSnapshot,query:annualQuery,exportedAt:new Date().toISOString(),regionStats:{definition:t('regionDef', REGION_GRID),grid:REGION_GRID,invalidClasses:[...SCL_INVALID_CLASSES],byScene:regionStat},rows:yearly},null,2)],{type:'application/json'});
		const url = URL.createObjectURL(blob), a=document.createElement('a'); a.href=url;a.download=`${selectedArea || 'map'}-annual-scenes.json`;a.click();URL.revokeObjectURL(url);
	}

	let animationPlaying = $state(false);
	let animationSeconds = $state(2);
	let animationSource = $state<'annual' | 'search'>('annual');
	let animationLoop = $state(true);
	const animationFrames = $derived((animationSource === 'annual' ? yearly.flatMap(row => row.item ? [row.item] : []) : [...items]).sort((a, b) => Date.parse(a.properties.datetime) - Date.parse(b.properties.datetime)));
	const animationIndex = $derived(animationFrames.findIndex(frame => frame.id === itemA?.id));
	function showAnimationFrame(index: number) {
		const frame = animationFrames[index];
		if (!frame) return;
		playing = false;
		syncScene = false;
		if (itemB) selectB(null);
		selectA(frame, false, true);
	}
	function toggleAnimation() {
		if (animationPlaying) { animationPlaying = false; return; }
		if (animationFrames.length < 2) return;
		showAnimationFrame(animationIndex < 0 || animationIndex === animationFrames.length - 1 ? 0 : animationIndex);
		animationPlaying = true;
	}
	$effect(() => {
		if (!animationPlaying) return;
		if (animationFrames.length < 2 || animationIndex < 0 || tileProgress.a.failed || tileErr.a) {
			animationPlaying = false;
			return;
		}
		// 軌道などの GeoJSON 更新は再生タイマーをリセットしない。A の実画像だけを待つ。
		if (!imageLoaded.a || tileProgress.a.pending) return;
		// ソースのロード完了だけでは描画成功とは限らない（中止・空タイル）。
		if (tileProgress.a.completed === 0 || tileProgress.a.completed === tileProgress.a.empty) {
			animationPlaying = false;
			return;
		}
		const current = animationIndex;
		const seconds = animationSeconds;
		const loop = animationLoop;
		const count = animationFrames.length;
		const timer = setTimeout(() => {
			if (current + 1 >= count && !loop) { animationPlaying = false; return; }
			untrack(() => showAnimationFrame((current + 1) % count));
		}, seconds * 1000);
		return () => clearTimeout(timer);
	});

	function selectA(item: StacItem, fromSync = false, fromAnimation = false) {
		if (!fromAnimation) animationPlaying = false;
		if (itemA?.id === item.id) return;
		itemA = item;
		if (fromSync) {
			switched = { date: fmtDate(item.properties.datetime), sat: satLabel(item).split(' ')[0] };
			clearTimeout(switchedTimer);
			switchedTimer = setTimeout(() => (switched = null), 2500);
		}
		forMaps((m) => setFootprint(m, item));
		refreshLayers();
		if (point) refreshPoint();
		// スクラブ中に手で選んだら、表示時刻もそのシーンの撮影時刻へ（衛星が真上に来る）
		if (!fromSync && syncScene && timeOffsetMin !== 0) {
			selectedPass = null;
			// 切り上げ: 分単位に丸めても撮影時刻より前にならないように
			timeOffsetMin = Math.ceil((Date.parse(item.properties.datetime) - Date.now()) / 60000);
			tick();
		}
	}

	/** 表示時刻の直前に撮影されたシーン（無ければ最古）。分単位の丸め誤差を吸収するため 1 分の許容 */
	function sceneAt(t: Date): StacItem | undefined {
		let best: StacItem | undefined;
		let oldest: StacItem | undefined;
		const limit = t.getTime() + 60000;
		for (const it of items) {
			const d = Date.parse(it.properties.datetime);
			if (!oldest || d < Date.parse(oldest.properties.datetime)) oldest = it;
			if (d <= limit && (!best || d > Date.parse(best.properties.datetime))) best = it;
		}
		return best ?? oldest;
	}

	function selectB(item: StacItem | null) {
		animationPlaying = false;
		itemB = item?.id === itemB?.id ? null : item;
		refreshLayers();
		if (point) refreshPoint();
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

	/** 地図クリック: 地点を変えるので時系列は破棄し、計算済みだった場合は新しい地点で再計算する */
	function queryPoint(lat: number, lon: number) {
		const hadSeries = series.length > 0;
		++seriesVersion; seriesLoading = false; series = [];
		point = { lat, lon };
		forMaps((m) => setPointData(m, { lat, lon }));
		refreshPoint();
		if (hadSeries) buildSeries();
	}

	/** 指定バンド + SCL を 1 地点で読む。SCL アセットが無いシーンは scl: undefined（マスク不可） */
	async function readPoint(item: StacItem, lon: number, lat: number, assets: string[]): Promise<PointRead> {
		const hasScl = !!item.assets.scl;
		const vals = await pointValues(item, lon, lat, hasScl ? [...assets, 'scl'] : assets);
		return { item, vals, scl: hasScl ? vals.scl : undefined };
	}
	const maskOf = (r: PointRead | null): SclReason | null => (r && r.scl !== undefined ? sclReason(r.scl) : null);
	const maskText = (r: SclReason) => t(`mask_${r}` as Parameters<typeof t>[0]);

	/** 同じ地点の A/B 値を取り直す（A/B の切替では時系列は消さない） */
	async function refreshPoint() {
		if (!point) return;
		const { lat, lon } = point;
		const version = ++pointVersion;
		pointA = null; pointB = null;
		const sceneA = itemA, sceneB = itemB;
		if (!sceneA) { pointLoading = false; return; }
		pointLoading = true;
		try {
			const [a, b] = await Promise.all([readPoint(sceneA, lon, lat, pointAssets), sceneB ? readPoint(sceneB, lon, lat, pointAssets) : Promise.resolve(null)]);
			if (version !== pointVersion) return;
			pointA = a; pointB = b;
		} catch (e) { if (version === pointVersion) error = String(e); }
		finally { if (version === pointVersion) pointLoading = false; }
	}

	async function buildSeries() {
		const src = seriesSource === 'yearly' ? yearly.flatMap((y) => (y.item ? [y.item] : [])) : items;
		if (!point || !src.length) return;
		const version = ++seriesVersion, location = {...point};
		seriesLoading = true; series = [];
		const ix = indices.find((i) => i.id === seriesIndex)!;
		const list = [...src].sort((a, b) => a.properties.datetime.localeCompare(b.properties.datetime)).slice(-20);
		try {
			const results = await Promise.all(list.map(async (item) => {
				const r = await readPoint(item, location.lon, location.lat, [ix.b1, ix.b2]);
				const reason = maskOf(r);
				// 無効画素は 0 にせず欠測（null）。点・時系列・指数画像で同じ SCL 判定を使う
				return { item, v: reason ? null : indexFromDn(item, r.vals[ix.b1], r.vals[ix.b2]), reason };
			}));
			if (version === seriesVersion) series = results;
		} catch (e) { if (version === seriesVersion) error = String(e); }
		finally { if (version === seriesVersion) seriesLoading = false; }
	}

	$effect(() => {
		const selected = mode.kind === 'index' ? mode.id : null;
		untrack(() => { if (selected && selected !== seriesIndex) { seriesIndex = selected; if (point && series.length) buildSeries(); } });
	});

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
		clearInterval(tickTimer);
		tickTimer = setInterval(tick, 1000);
	}

	/** 1 秒ごと: 表示時刻を進め、位置マーカー・軌跡・観測幅を更新 */
	function tick() {
		if (!tleSet) return;
		if (playing) timeOffsetMin += 1;
		const t = displayTime();
		shownTime = t;
		const next: Partial<Record<SatId, SubPoint>> = {};
		for (const tle of tleSet.tles) {
			const p = subPoint(tle, t);
			if (!p) continue;
			next[tle.id] = p;
			for (const rec of satMarkers.values()) rec[tle.id]?.setLngLat([p.lon, p.lat]);
		}
		satNow = next;
		updateTracks(t);
		// LIVE 以外では、表示時刻に対応するシーンへ画像を合わせる
		if (syncScene && timeOffsetMin !== 0 && items.length) {
			const it = sceneAt(t);
			if (it && it.id !== itemA?.id) selectA(it, true);
		}
	}

	/** 表示時刻に地図中心へ最も近い衛星（時刻バーの読み出し用） */
	const nearestSat = $derived.by(() => {
		if (!passTarget) return null;
		let best: { id: SatId; km: number } | null = null;
		for (const s of SATS) {
			const p = satNow[s.id];
			if (!p) continue;
			const km = distanceKm(passTarget.lat, passTarget.lon, p.lat, p.lon);
			if (!best || km < best.km) best = { id: s.id, km };
		}
		return best;
	});

	/** 表示時刻から見た画像 A の古さと、次に画像が変わる撮影 */
	const imageAge = $derived.by(() => {
		if (!itemA || timeOffsetMin === 0) return null;
		const acq = Date.parse(itemA.properties.datetime);
		const ageMin = Math.max(0, Math.round((shownTime.getTime() - acq) / 60000));
		let next: StacItem | undefined;
		for (const it of items) {
			const d = Date.parse(it.properties.datetime);
			if (d > shownTime.getTime() + 60000 && (!next || d < Date.parse(next.properties.datetime))) next = it;
		}
		return { age: fmtOffset(ageMin).replace(/^[+−]/, ''), next };
	});

	/** スライダー上の目盛り: 過去のシーン撮影時刻と未来の予測パス */
	const timeTicks = $derived.by(() => {
		const now = Date.now();
		const out: { off: number; color: string; title: string; kind: 'scene' | 'pass' }[] = [];
		for (const it of items) {
			const off = (Date.parse(it.properties.datetime) - now) / 60000;
			if (off < rangeMin || off > 0) continue;
			const sat = SATS.find((x) => x.id === it.properties.platform);
			out.push({ off, color: sat?.color ?? '#fff', kind: 'scene', title: t('mapTimeTickScene', fmtDate(it.properties.datetime), satLabel(it).split(' ')[0]) });
		}
		for (const p of imagingPasses) {
			const off = (p.time.getTime() - now) / 60000;
			if (off > RANGE_MAX) continue;
			out.push({ off, color: satMeta(p.sat).color, kind: 'pass', title: t('mapTimeTickPass', fmtJst(p.time), satMeta(p.sat).name.replace('Sentinel-', 'S')) });
		}
		return out;
	});

	/**
	 * 表示時刻の前後 50 分の地上軌跡（撮影中は実線、それ以外は点線）、
	 * 撮影区間の観測幅（幅 290 km）、いまセンサーが見ている 1 ライン、選択パスの強調。
	 */
	function updateTracks(t: Date) {
		if (!tleSet) return;
		const lines: GeoJSON.Feature[] = [];
		const swath: GeoJSON.Feature[] = [];
		const scan: GeoJSON.Feature[] = [];
		for (const tle of tleSet.tles) {
			const color = SATS.find((s) => s.id === tle.id)!.color;
			const pts = unwrapLons(groundTrack(tle, new Date(t.getTime() - 50 * 60000), 100, 30));
			lines.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: pts.map((p) => [p.lon, p.lat]) }, properties: { color, width: 1.2, imaging: false } });
			for (const seg of imagingSegments(pts)) {
				lines.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: seg.map((p) => [p.lon, p.lat]) }, properties: { color, width: 2, imaging: true } });
				swath.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [swathPolygon(seg)] }, properties: { color } });
			}
			// 現在の観測ライン（進行方向は 10 秒後の位置から）
			const p0 = subPoint(tle, t), p1 = subPoint(tle, new Date(t.getTime() + 10000));
			if (p0 && p1) {
				const h = bearingDeg(p0.lat, p0.lon, p1.lat, p1.lon);
				scan.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: scanLine(p0, h) }, properties: { color } });
			}
		}
		if (selectedPass) {
			const tle = tleSet.tles.find((x) => x.id === selectedPass!.sat)!;
			const color = SATS.find((s) => s.id === tle.id)!.color;
			const pts = unwrapLons(groundTrack(tle, new Date(selectedPass.time.getTime() - 5 * 60000), 10, 15));
			swath.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [swathPolygon(pts)] }, properties: { color } });
			lines.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: pts.map((p) => [p.lon, p.lat]) }, properties: { color, width: 3.5, imaging: true } });
		}
		forMaps((m) => {
			(m.getSource('orbit-track') as ML.GeoJSONSource).setData({ type: 'FeatureCollection', features: lines });
			(m.getSource('orbit-swath') as ML.GeoJSONSource).setData({ type: 'FeatureCollection', features: swath });
			(m.getSource('orbit-scan') as ML.GeoJSONSource).setData({ type: 'FeatureCollection', features: scan });
		});
	}

	/** パス行クリック: 表示時刻をそのパスの瞬間へ飛ばす（もう一度で解除） */
	function selectPass(p: Pass) {
		if (selectedPass === p) {
			selectedPass = null;
		} else {
			selectedPass = p;
			playing = false;
			timeOffsetMin = Math.round((p.time.getTime() - Date.now()) / 60000);
		}
		tick();
	}

	/** スライダーは ±10 日だが、パス行からのジャンプはその外でもよい */
	function setOffset(m: number) {
		timeOffsetMin = m;
		if (m === 0) playing = false;
		tick();
	}

	function applyOrbitVisibility(map: MLMap, on: boolean) {
		for (const id of ['orbit-track', 'orbit-swath', 'orbit-swath-line', 'orbit-scan-casing', 'orbit-scan']) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
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
			tick();
		}
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

	const indexAt = (r: PointRead | null, ix: (typeof indices)[number]) => (r && !maskOf(r) ? indexFromDn(r.item, r.vals[ix.b1], r.vals[ix.b2]) : null);
	const sclText = (r: PointRead | null) => {
		if (!r || r.scl === undefined) return '—';
		if (r.scl === null) return `0 ${t('mask_nodata')}`;
		const m = sclReason(r.scl);
		return `${r.scl} ${m ? maskText(m) : t(`sclClass_${r.scl}` as Parameters<typeof t>[0])}`;
	};
	const fmt = (v: number | null, d = 2) => (v === null ? '—' : v.toFixed(d));
	const cloud = (it: StacItem) => it.properties['eo:cloud_cover'];

	// 時系列チャート
	const CX0 = 40, CX1 = 780, CY0 = 10, CY1 = 150;
	const sx = (i: number, n: number) => {
		if (n <= 1) return (CX0 + CX1) / 2;
		const first = Date.parse(series[0].item.properties.datetime), last = Date.parse(series[n - 1].item.properties.datetime);
		return last === first ? (CX0 + CX1) / 2 : CX0 + (Date.parse(series[i].item.properties.datetime) - first) / (last - first) * (CX1 - CX0);
	};
	const seriesSegments = $derived.by(() => {
		const segments: string[] = []; let current: string[] = [];
		series.forEach((row, i) => {
			if (i > 0 && seriesSource === 'yearly' && new Date(row.item.properties.datetime).getUTCFullYear() - new Date(series[i - 1].item.properties.datetime).getUTCFullYear() > 1) { if (current.length) segments.push(current.join(' ')); current = []; }
			if (row.v === null) { if (current.length) segments.push(current.join(' ')); current = []; } else current.push(`${sx(i, series.length)},${sy(row.v)}`); });
		if (current.length) segments.push(current.join(' ')); return segments;
	});
	// 年次比較は差が小さいので、値の範囲に合わせて縦軸を拡大する（検索結果モードは -1〜1 固定）
	const yRange = $derived.by((): [number, number] => {
		const vs = series.flatMap((x) => (x.v === null ? [] : [x.v]));
		if (seriesSource !== 'yearly' || vs.length < 2) return [-1, 1];
		const lo = Math.min(...vs), hi = Math.max(...vs);
		const pad = Math.max((hi - lo) * 0.2, 0.02);
		return [Math.max(-1, lo - pad), Math.min(1, hi + pad)];
	});
	const yTicks = $derived(Array.from({ length: 5 }, (_, i) => yRange[0] + ((yRange[1] - yRange[0]) * i) / 4));
	const sy = (v: number) => CY1 - ((v - yRange[0]) / (yRange[1] - yRange[0])) * (CY1 - CY0);
</script>

<svelte:head>
	<title>{t('title')}</title>
</svelte:head>

<h1>{t('h1')}</h1>
<p class="muted">
	{t('lead1')}<strong>{t('leadStrong')}</strong>{t('lead2')}
</p>

<section class="panel study-panel" aria-label={t('studyAria')}>
	<h2>{t('studyTitle')}</h2>
	<p>{t('studySteps')}</p>
	<div class="btn-row">
		<a href="#annual-controls">{t('studyGoto')}</a>
	</div>
	<p class="muted">{t('studyNote')}</p>
	{#if selectedArea}<p aria-live="polite">{t('studyTarget', L(studyAreas.find(a => a.id === selectedArea)!.detail))}</p>{/if}
</section>

<details class="panel tight howto">
	<summary><strong>{t('howtoTitle')}</strong>{t('howtoToggle')}</summary>
	<ol>
		<li>{@html t('howto1')}</li>
		<li>{@html t('howto2')}</li>
		<li>{@html t('howto3')}</li>
		<li>{@html t('howto4')}</li>
		<li>{@html t('howto5')}</li>
		<li>{@html t('howto6')}</li>
		<li>{@html t('howto7')}</li>
		<li>{@html t('howto8')}</li>
	</ol>
	<p class="muted" style="font-size: 0.85rem; margin: 0.3rem 0 0">
		{@html t('howtoTips')}
	</p>
</details>

<div class="btn-row">
	{#each places as p (p.id)}
		<button class="ghost" onclick={() => goto(p)} title={L(p.hint)}>{L(p.name)}</button>
	{/each}
	<!-- 夕張の南北: 地域を選択して概略範囲へ移動（年次比較はこの範囲を対象にする） -->
	{#each studyAreas as area (area.id)}
		<button class="ghost" class:active={selectedArea === area.id} aria-pressed={selectedArea === area.id} onclick={() => chooseArea(area.id)} title={L(area.detail)}>{L(area.name)}</button>
	{/each}
</div>

<svelte:document onfullscreenchange={onFullscreenChange} />

<div class="mapwrap" class:fullscreen bind:this={mapWrapEl}>
	<div bind:this={mapElA} class="map"></div>
	<!-- 比較用の 2 枚目。B 選択時だけ生成され、右側 (swipe% 以降) のみ表示 -->
	<div bind:this={mapElB} class="map mapB" class:hidden={!itemB} style:clip-path="inset(0 0 0 {swipe}%)"></div>

	<div class="map-ui">
		<button onclick={locate} disabled={locationBusy}>{locationBusy ? t('locationBusy') : t('locationBtn')}</button>
		{#if locationMessage}<span role="status">{locationMessage}</span>{/if}
		<div class="seg" role="group" aria-label={t('mapBasemapGroup')}>
			<button class:active={basemap === 'osm'} onclick={() => (basemap = 'osm')}>{t('mapBasemapOsm')}</button>
			<button class:active={basemap === 'esri'} onclick={() => (basemap = 'esri')} title={t('mapBasemapEsriTitle')}>{t('mapBasemapEsri')}</button>
		</div>
		<div class="seg" role="group" aria-label="2D / 3D">
			<button class:active={!is3D} onclick={() => (is3D = false)}>2D</button>
			<button class:active={is3D} onclick={() => (is3D = true)} title={t('map3dTitle')}>3D</button>
			<button class="fs" class:active={fullscreen} onclick={toggleFullscreen} title={fullscreen ? t('mapFsExitTitle') : t('mapFsEnterTitle')} aria-label={fullscreen ? t('mapFsExit') : t('mapFsEnter')}>
				{#if fullscreen}
					<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2v4H2M10 2v4h4M6 14v-4H2M10 14v-4h4" /></svg>
					<span class="fs-label">{t('mapFsExitBtn')} (Esc)</span>
				{:else}
					<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4" /></svg>
				{/if}
			</button>
		</div>
		<div class="compass-box">
			<Compass {bearing} {pitch} sunAzimuth={sunAz} sunElevation={sunEl} {trackHeading} onreset={resetNorth} onrotate={rotateMap} />
			<div class="compass-key"><span style="color: #f1fa8c">●</span> {t('mapKeySun')} <span style="color: var(--green)">▲</span> {t('mapKeyTrack')}</div>
		</div>
		<button class="seg-toggle" class:active={showOrbit} onclick={() => (showOrbit = !showOrbit)} title={t('mapOrbitTitle')}>{t('mapOrbitBtn', showOrbit)}</button>
		{#if showOrbit && tleSet}
			<div class="timebar">
				<div class="t"><span class="mono">{fmtJst(shownTime)}</span> <span class="off" class:live={timeOffsetMin === 0}>{fmtOffset(timeOffsetMin)}</span></div>
				<div class="row">
					<button onclick={() => setOffset(timeOffsetMin - 1440)} title={t('mapTimeBack1d')}>−1d</button>
					<button onclick={() => setOffset(timeOffsetMin - 60)} title={t('mapTimeBack1h')}>−1h</button>
					<button class:active={playing} onclick={() => { playing = !playing; }} title={t('mapTimePlay')}>{playing ? '❚❚' : '▶'}</button>
					<button onclick={() => setOffset(timeOffsetMin + 60)} title={t('mapTimeFwd1h')}>+1h</button>
					<button onclick={() => setOffset(timeOffsetMin + 1440)} title={t('mapTimeFwd1d')}>+1d</button>
					<button class="live" disabled={timeOffsetMin === 0 && !playing} onclick={() => setOffset(0)}>LIVE</button>
				</div>
				<div class="slider">
					<input type="range" min={rangeMin} max={RANGE_MAX} step="10" value={timeOffsetMin} oninput={(e) => setOffset(+e.currentTarget.value)} aria-label={t('mapTimeOffsetAria', days)} />
					<div class="ticks">
						<!-- 現在 (LIVE) の位置 -->
						<span class="now" style:left="{offToPct(0)}%"></span>
						{#each timeTicks as tk (tk.kind + tk.off)}
							<button class="tick" class:pass={tk.kind === 'pass'} style:left="{offToPct(tk.off)}%" style:--c={tk.color} title={tk.title} onclick={() => setOffset(Math.ceil(tk.off))} aria-label={tk.title}></button>
						{/each}
					</div>
				</div>
				<label class="sync" title={t('mapTimeSyncTitle')}><input type="checkbox" bind:checked={syncScene} /> {t('mapTimeSync')}</label>
				{#if nearestSat}
					<div class="nearest"><span class="swatch" style:background={satMeta(nearestSat.id).color}></span>{t('mapTimeNearest', satMeta(nearestSat.id).name.replace('Sentinel-', 'S'), Math.round(nearestSat.km).toLocaleString())}</div>
				{/if}
				{#if imageAge && itemA}
					<div class="imgage">
						<div>{t('mapTimeImage', fmtDate(itemA.properties.datetime), imageAge.age)}</div>
						<div class="muted">{imageAge.next ? t('mapTimeNextScene', fmtDate(imageAge.next.properties.datetime), satLabel(imageAge.next).split(' ')[0]) : t('mapTimeNoNext')}</div>
					</div>
				{/if}
				<div class="key">
					<span><i class="k-swath"></i>{t('mapKeySwath')}</span>
					<span><i class="k-scan"></i>{t('mapKeyScan')}</span>
					<span><i class="k-dash"></i>{t('mapKeyDash')}</span>
				</div>
			</div>
		{/if}
	</div>

	{#if itemB && tilesLoadingB}
		<div class="loading loadingB" style:left="calc({swipe}% + 12px)">{t('mapLoadingB')}</div>
	{/if}
	<div class="tile-status" role="status" aria-live="polite">
		<div>{t('mapRotateHelp')}</div>
		{#if basemap === 'esri'}<div>{basemapDate}</div>{/if}
		{#each ['a', 'b'] as key}
			{@const slot = key as 'a' | 'b'}
			{@const item = slot === 'a' ? itemA : itemB}
			{#if item}
				{@const progress = tileProgress[slot]}
				<div><strong>{slot.toUpperCase()} · {fmtDate(item.properties.datetime)} · {mode.id}</strong><br />
					{#if progress.failed || tileErr[slot]}{t('tileStatusFailed')}
					{:else if imageOutside[slot]}{t('tileStatusOutside')}
					{:else if imageZoom[slot] < 8}{t('tileStatusZoom')}
					{:else if progress.pending || !imageLoaded[slot]}{t('tileStatusBusy', progress.pending)}
					{:else}{t('tileStatusDone')}{/if}
					 · {t('tileStatusCounts', progress.completed, progress.empty)}
				</div>
			{:else if slot === 'a'}<div>{t('tileStatusUnselected')}</div>{/if}
		{/each}
	</div>
	{#if tileErr.a || tileErr.b}
		<div class="tile-error" role="alert">{#if tileErr.a}<div>{t('mapErrorA', tileErr.a)}{tileMsg.a ? ` — ${tileMsg.a.slice(0, 120)}` : ''}</div>{/if}{#if tileErr.b}<div>{t('mapErrorB', tileErr.b)}{tileMsg.b ? ` — ${tileMsg.b.slice(0, 120)}` : ''}</div>{/if}</div>
	{/if}
	{#if tilesLoading || loading}
		<div class="loading">{loading ? t('mapLoadingStac') : t('mapLoadingTiles')}</div>
	{/if}
	{#if itemA}
		{#if switched}
			<div class="switched">{t('mapTimeSwitched', switched.date, switched.sat)}</div>
		{/if}
		<div class="legend" class:flash={!!switched}>
			<div><strong>A</strong> {fmtDate(itemA.properties.datetime)} <span class="muted">{satLabel(itemA)} · {t('mapLegendCloud', cloud(itemA)?.toFixed(0))}</span>{#if cover.a < 0.98} <span class="warn">{cover.a < 0.02 ? t('coverNone') : t('coverPartial', (cover.a * 100).toFixed(0))}</span>{/if}</div>
			{#if itemB}
				<div><strong>B</strong> {fmtDate(itemB.properties.datetime)} <span class="muted">{satLabel(itemB)} · {t('mapLegendCloud', cloud(itemB)?.toFixed(0))}</span> <span class="muted">{t('mapLegendRight')}</span>{#if cover.b < 0.98} <span class="warn">{cover.b < 0.02 ? t('coverNone') : t('coverPartial', (cover.b * 100).toFixed(0))}</span>{/if}</div>
			{/if}
			{#if mode.kind === 'index'}<div class="muted">{t('maskNote')}</div>{/if}
			{#if (!offsetKnown(itemA)) || (itemB && !offsetKnown(itemB))}<div class="warn">{t('offsetUnknown')}（{[!offsetKnown(itemA) ? 'A' : '', itemB && !offsetKnown(itemB) ? 'B' : ''].filter(Boolean).join('・')}）</div>{/if}
		</div>
	{/if}
	{#if itemB}
		<!-- 比較の境界線。地図全幅のスライダーだと右上の UI に重なるので、境界線 + 中央のつまみだけにする -->
		<div class="divider" style:left="{swipe}%">
			<div class="line"></div>
			<button
				class="handle"
				onpointerdown={startSwipe}
				onkeydown={(e) => { if (e.key === 'ArrowLeft') swipe = Math.max(0, swipe - 1); else if (e.key === 'ArrowRight') swipe = Math.min(100, swipe + 1); }}
				aria-label={t('mapSwipeAria')}
				role="slider"
				aria-valuemin="0"
				aria-valuemax="100"
				aria-valuenow={Math.round(swipe)}
				title={t('mapSwipeAria')}
			>
				<span class="ab">A</span><span class="arrows">◀ ▶</span><span class="ab">B</span>
			</button>
		</div>
	{/if}
</div>
<p class="muted" style="font-size: 0.78rem; margin-top: -0.6rem">
	{t('mapHint')}
</p>

{#if error}
	<div class="note warn">{error}</div>
{/if}

<section class="panel" aria-label={t('animationTitle')}>
	<h2>{t('animationTitle')}</h2>
	<button onclick={graphAnimation} disabled={!animationFrames.length || seriesLoading}>{t('animationGraph')}</button>
	<p class="muted">{t('graphHelp')}</p>
	<p class="muted">{t('animationHelp')}</p>
	<div class="btn-row">
		<label>{t('animationSource')} <select bind:value={animationSource} onchange={() => animationPlaying = false}><option value="annual">{t('annualTitle')}</option><option value="search">{t('searchTitle')}</option></select></label>
		<button onclick={toggleAnimation} disabled={animationFrames.length < 2}>{animationPlaying ? t('animationPause') : t('animationPlay')}</button>
		<label>{t('animationSpeed')} <select bind:value={animationSeconds}>{#each [1, 2, 3, 5] as seconds}<option value={seconds}>{seconds} s</option>{/each}</select></label>
		<label><input type="checkbox" bind:checked={animationLoop} /> {t('animationLoop')}</label>
	</div>
	{#if animationFrames.length}
		<label for="animation-frame">{t('animationFrame')} {animationIndex >= 0 ? `${animationIndex + 1} / ${animationFrames.length} · ${fmtDate(animationFrames[animationIndex].properties.datetime)}` : '—'}</label>
		<input id="animation-frame" type="range" min="0" max={animationFrames.length - 1} step="1" value={Math.max(0, animationIndex)} oninput={(e) => { animationPlaying = false; showAnimationFrame(+e.currentTarget.value); }} />
	{:else}<p>{t('animationEmpty')}</p>{/if}
</section>

<div class="grid cols-2">
	<div class="panel">
		<h3>{t('modeTitle')}</h3>
		<div class="btn-row">
			{#each composites as c (c.id)}
				<button class="ghost" class:active={mode.kind === 'composite' && mode.id === c.id} onclick={() => (mode = { kind: 'composite', id: c.id })}>{L(c.name)}</button>
			{/each}
		</div>
		<div class="btn-row">
			{#each indices as ix (ix.id)}
				<button class="ghost" class:active={mode.kind === 'index' && mode.id === ix.id} onclick={() => (mode = { kind: 'index', id: ix.id })}>{L(ix.name)}</button>
			{/each}
		</div>
		<p class="muted" style="font-size: 0.85rem">{modeDescText}</p>
		{#if mode.kind === 'composite' && composites.find((c) => c.id === mode.id)?.rescaleMax}
			<div class="control">
				<label for="gain">{t('modeGain')}</label>
				<output>×{gain.toFixed(1)}</output>
				<input id="gain" type="range" min="0.5" max="3" step="0.1" bind:value={gain} />
			</div>
		{/if}
		<div class="control">
			<label for="op">{t('modeOpacity')}</label>
			<output>{Math.round(opacity * 100)}%</output>
			<input id="op" type="range" min="0" max="1" step="0.05" bind:value={opacity} />
		</div>
		<div class="grid cols-2" style="margin-top: 0.6rem">
			<div class="stat"><span class="label">{t('modeCogLabel')}</span><span class="value">{currentAssets.length}<span class="unit">{t('modeCogUnit')}</span></span></div>
			<div class="stat"><span class="label">{t('modeRequests')}</span><span class="value">{requests.toLocaleString()}</span></div>
		</div>
		<details>
			<summary class="muted" style="cursor: pointer; font-size: 0.85rem">{t('modeCogUrls')}</summary>
			<pre style="font-size: 0.72rem; white-space: pre-wrap; word-break: break-all"><code>{currentAssets.length ? currentAssets.map((c) => `${c.a.padEnd(7)} ${c.href}`).join('\n') : t('modeNoScene')}</code></pre>
		</details>
	</div>

	<div class="panel">
		<h3>{t('searchTitle')} <span class="muted" style="font-weight: 400; font-size: 0.8rem">{t('searchSub')}</span></h3>
		<div class="control">
			<label for="days">{t('searchDays')}</label>
			<output>{t('searchDaysOut', days)}</output>
			<input id="days" type="range" min="14" max="730" step="7" bind:value={days} />
		</div>
		<div class="control">
			<label for="cc">{t('searchCloud')}</label>
			<output>&lt; {maxCloud}%</output>
			<input id="cc" type="range" min="0" max="100" step="5" bind:value={maxCloud} />
		</div>
		<button onclick={search} disabled={loading}>{loading ? t('searchBtnBusy') : t('searchBtn')}</button>
		<p class="muted" style="font-size: 0.8rem; margin-top: 0.6rem">
			{t('searchCount', items.length)}<strong>A</strong>{t('searchCountRest')}
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
	<div class="panel" id="annual-controls">
		<h3>{t('annualTitle')}</h3>
		<p class="muted">{t('annualIntro')}</p>
		<div class="control">
			<label for="annual-day">{t('annualDay')}</label>
			<input id="annual-day" type="text" pattern="[0-9]{2}-[0-9]{2}" bind:value={monthDay} placeholder="10-02" />
		</div>
		<div class="control">
			<label for="annual-cloud">{t('annualCloud')}</label>
			<input id="annual-cloud" type="number" min="0" max="100" bind:value={yearlyCloud} />
		</div>
		<div class="control">
			<label for="annual-tolerance">{t('annualTol')}</label>
			<select id="annual-tolerance" bind:value={dateTolerance}>{#each [0, 7, 14, 30] as n (n)}<option value={n}>{t('annualTolOpt', n)}</option>{/each}</select>
		</div>
		<label><input type="checkbox" bind:checked={allowMissing} /> {t('annualAllow')}</label>
		<div class="control">
			<label for="yy">{t('yearlyYears')}</label>
			<output>{yearlyYears}</output>
			<input id="yy" type="range" min="2" max="9" step="1" bind:value={yearlyYears} />
		</div>
		<button onclick={searchYear} disabled={yearlyLoading}>{yearlyLoading ? t('searchBtnBusy') : t('yearlyBtn')}</button>
		<p class="muted" style="font-size: 0.8rem; margin-top: 0.6rem">{t('annualHelp')}</p>
		{#if yearly.length}
			<p aria-live="polite">{annualQuery}</p>
			<div class="control">
				<label for="region-max">{t('regionMaxLabel')}</label>
				<input id="region-max" type="number" min="0" max="100" bind:value={maxInvalidPct} />
			</div>
			<button class="ghost" onclick={reselectByRegionClick} disabled={regionBusy}>{regionBusy ? t('regionBtnBusy') : t('regionBtn')}</button>
			<p class="muted" style="font-size: 0.78rem">{t('regionHelp')}</p>
			<p class="muted" style="font-size: 0.78rem">{t('regionDef', REGION_GRID)}</p>
			<button class="ghost" onclick={exportAnnual}>{t('annualExport')}</button>
			<div class="strip">
				{#each yearly as y (y.year)}
					{#if y.item}
						{@const it = y.item}
						<div class="scene" class:a={itemA?.id === it.id} class:b={itemB?.id === it.id}>
							<button class="thumb" onclick={() => selectA(it)} title={it.id}>
								{#if it.assets.thumbnail}<img src={it.assets.thumbnail.href} alt="" loading="lazy" />{/if}
								<div class="cap">
									<div>{t('annualCardYear', y.year, fmtDate(it.properties.datetime))}</div>
									<div>{t('annualCardBase', y.target, y.candidates)}</div>
									<div>{reasonText(y.reason)} {y.offset ? `(${y.offset > 0 ? '+' : ''}${y.offset}${i18n.lang === 'ja' ? '日' : ' d'})` : ''}</div>
									<div class="muted">☁ {cloud(it)?.toFixed(0)}% · {satLabel(it).split(' ')[0]}</div>
									{#if !offsetKnown(it)}<div class="adj">{t('offsetUnknown')}</div>{/if}
									{#if y.adjustedFrom}<div class="adj">{t('regionAdjFrom', y.adjustedFrom.date, (y.adjustedFrom.invalid * 100).toFixed(1))}</div>{/if}
									{#if y.regionNote}<div class="adj">{t('regionNoAlt')}</div>{/if}
									{#if regionStat[it.id]}
										{@const st = regionStat[it.id]}
										<div class="region" title={t('regionDef', REGION_GRID)}>{t('regionLine', pct(st.valid, st.total), pct(st.cloud, st.total), pct(st.shadow, st.total), pct(st.cirrus, st.total), pct(st.snow, st.total), pct(st.nodata + st.saturated + st.outside, st.total))}</div>
									{:else if regionErr[it.id]}
										<div class="region err">{t('regionError', regionErr[it.id])}</div>
									{:else if annualBbox}
										<div class="region muted">{t('regionLoading')}</div>
									{/if}
								</div>
							</button>
							{#if (y.alternatives?.length ?? 0) > 1}
								<select aria-label={t('annualAltAria', y.year)} value={it.id} onchange={(e) => changeAnnualCandidate(y.year,e.currentTarget.value)}>
									{#each y.alternatives ?? [] as alt (alt.id)}<option value={alt.id}>{fmtDate(alt.properties.datetime)} · {t('mapLegendCloud', cloud(alt)?.toFixed(0))}{regionStat[alt.id] ? ` · ${pct(regionStat[alt.id].valid, regionStat[alt.id].total, 0)}%` : ''} · {alt.id.split('_')[1]}</option>{/each}
								</select>
							{/if}
							<button class="bbtn" class:active={itemB?.id === it.id} onclick={() => selectB(it)}>B</button>
						</div>
					{:else}
						<div class="scene"><div class="cap muted" style="padding: 0.5rem">{y.target}: {reasonText(y.reason)}</div></div>
					{/if}
				{/each}
			</div>
		{/if}
	</div>
</div>

<div class="grid cols-2">
	<div class="panel">
		<h3>{t('orbitTitle')} <span class="muted" style="font-weight: 400; font-size: 0.8rem">{t('orbitSub')}</span></h3>
		{#if !tleSet}
			<p class="muted" style="font-size: 0.9rem">{t('orbitTleLoading')}</p>
		{:else}
			<p class="muted" style="font-size: 0.78rem; margin: 0 0 0.5rem">
				TLE: {tleSet.source === 'bundled' ? t('orbitTleBundled') : `CelesTrak${tleSet.source === 'cache' ? t('orbitTleCache') : ''}`}
				· {tleAgeH < 48 ? t('orbitTleAgeH', tleAgeH.toFixed(0)) : t('orbitTleAgeD', (tleAgeH / 24).toFixed(0))}
			</p>
			<table style="font-size: 0.85rem">
				<thead><tr><th>{t('orbitThSat')}</th><th class="num">{t('orbitThLat')}</th><th class="num">{t('orbitThLon')}</th><th class="num">{t('orbitThAlt')}</th></tr></thead>
				<tbody>
					{#each SATS as s (s.id)}
						{@const p = satNow[s.id]}
						<tr>
							<td><span class="swatch" style:background={s.color}></span>{s.name} <span class="muted" style="font-size: 0.75rem">{t('orbitLaunched', s.launched)}</span></td>
							<td class="num">{p ? p.lat.toFixed(2) + '°' : '—'}</td>
							<td class="num">{p ? p.lon.toFixed(2) + '°' : '—'}</td>
							<td class="num">{p ? p.alt.toFixed(0) + ' km' : '—'}</td>
						</tr>
					{/each}
				</tbody>
			</table>
			<p class="muted" style="font-size: 0.78rem">
				{t('orbitNote')}
			</p>
		{/if}
	</div>

	<div class="panel">
		<h3>
			{t('passTitle')}
			{#if passTarget}<span class="muted" style="font-weight: 400; font-size: 0.75rem; font-family: var(--mono)">({passTarget.lat.toFixed(2)}, {passTarget.lon.toFixed(2)})</span>{/if}
		</h3>
		{#if !tleSet}
			<p class="muted" style="font-size: 0.9rem">{t('orbitTleLoading')}</p>
		{:else if !imagingPasses.length}
			<p class="muted" style="font-size: 0.9rem">{t('passNone', HALF_SWATH_KM)}</p>
		{:else}
			<table style="font-size: 0.85rem">
				<thead><tr><th>{t('passThTime')}</th><th>{t('passThSat')}</th><th class="num">{t('passThCross')}</th><th class="num">{t('passThSun')}</th><th>{t('passThPrev')}</th></tr></thead>
				<tbody>
					{#each imagingPasses as p (p.sat + p.time.getTime())}
						{@const m = matchScene(p)}
						<tr class="pass" class:sel={selectedPass === p} onclick={() => selectPass(p)} title={t('passRowTitle')}>
							<td style="font-family: var(--mono)">{fmtJst(p.time)}</td>
							<td><span class="swatch" style:background={satMeta(p.sat).color}></span>{satMeta(p.sat).name.replace('Sentinel-', 'S')}</td>
							<td class="num" title={t('passCrossTitle')}>{p.crossTrackKm.toFixed(0)} km</td>
							<td class="num">{p.sunElevation.toFixed(0)}°</td>
							<td class="muted" style="font-size: 0.78rem">{m ? `✓ ${fmtDate(m.properties.datetime)} ${satLabel(m).split(' ')[1] ?? ''}` : ''}</td>
						</tr>
					{/each}
				</tbody>
			</table>
			<p class="muted" style="font-size: 0.78rem">
				{t('passNote')}
			</p>
		{/if}
	</div>
</div>

<div class="grid cols-2">
	<div class="panel">
		<h3>{t('pointTitle')} {#if pointLoading}<span class="muted" style="font-size: 0.8rem">{t('pointLoading')}</span>{/if}</h3>
		{#if !point}
			<p class="muted" style="font-size: 0.9rem">{t('pointEmpty')}</p>
		{:else}
			<p class="muted" style="font-size: 0.8rem; font-family: var(--mono)">{point.lat.toFixed(5)}, {point.lon.toFixed(5)}</p>
			<table>
				<thead><tr><th>{t('pointThAsset')}</th><th class="num">A (DN)</th>{#if itemB}<th class="num">B (DN)</th>{/if}</tr></thead>
				<tbody>
					{#each pointAssets as a (a)}
						<tr><td><code>{a}</code></td><td class="num">{pointA?.vals[a] ?? '—'}</td>{#if itemB}<td class="num">{pointB?.vals[a] ?? '—'}</td>{/if}</tr>
					{/each}
					<tr><td>{t('pointSclRow')}</td><td class="num">{sclText(pointA)}</td>{#if itemB}<td class="num">{sclText(pointB)}</td>{/if}</tr>
				</tbody>
			</table>
			{#if (pointA && !offsetKnown(pointA.item)) || (pointB && !offsetKnown(pointB.item))}<p class="muted" style="font-size: 0.78rem; color: #ffb86c">{t('offsetUnknownNote', [pointA && !offsetKnown(pointA.item) ? 'A' : '', itemB && pointB && !offsetKnown(pointB.item) ? 'B' : ''].filter(Boolean).join('・'))}</p>{/if}
			{#if maskOf(pointA)}<p class="muted" style="font-size: 0.78rem; color: #ffb86c">{t('pointMaskedNote', 'A', maskText(maskOf(pointA)!))}</p>{/if}
			{#if itemB && maskOf(pointB)}<p class="muted" style="font-size: 0.78rem; color: #ffb86c">{t('pointMaskedNote', 'B', maskText(maskOf(pointB)!))}</p>{/if}
			<table style="margin-top: 0.6rem">
				<thead><tr><th>{t('pointThIndex')}</th><th class="num">A</th>{#if itemB}<th class="num">B</th><th class="num">B − A</th>{/if}</tr></thead>
				<tbody>
					{#each indices as ix (ix.id)}
						{@const va = indexAt(pointA, ix)}
						{@const vb = indexAt(pointB, ix)}
						<tr>
							<td>{ix.id.toUpperCase()}</td>
							<td class="num" title={maskOf(pointA) ? maskText(maskOf(pointA)!) : undefined}>{maskOf(pointA) ? t('pointMissing') : fmt(va)}</td>
							{#if itemB}
								<td class="num" title={maskOf(pointB) ? maskText(maskOf(pointB)!) : undefined}>{maskOf(pointB) ? t('pointMissing') : fmt(vb)}</td>
								<td class="num" style:color={va !== null && vb !== null ? (vb - va > 0.05 ? 'var(--green)' : vb - va < -0.05 ? 'var(--red)' : 'var(--text)') : undefined}>{va !== null && vb !== null ? (vb - va >= 0 ? '+' : '') + (vb - va).toFixed(2) : '—'}</td>
							{/if}
						</tr>
					{/each}
				</tbody>
			</table>
			<p class="muted" style="font-size: 0.78rem">{t('pointNote')}</p>
		{/if}
	</div>

	<div class="panel">
		<h3 id="series-chart">{t('seriesTitle')}</h3>
		{#if point}<p>{point.lat.toFixed(5)}, {point.lon.toFixed(5)} · {L(indices.find(ix => ix.id === seriesIndex)!.name)}</p>{/if}
		<p class="muted">{t('seriesRefNote')}</p>
		<div style="display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap">
			<select bind:value={seriesIndex} onchange={() => series.length && buildSeries()}>
				{#each indices as ix (ix.id)}<option value={ix.id}>{L(ix.name)}</option>{/each}
			</select>
			<select bind:value={seriesSource} onchange={() => series.length && buildSeries()} aria-label={t('seriesSourceAria')}>
				<option value="items">{t('seriesSrcItems')}</option>
				<option value="yearly">{t('seriesSrcYearly')}</option>
			</select>
			<button onclick={buildSeries} disabled={!point || seriesLoading || !(seriesSource === 'yearly' ? yearly.some((y) => y.item) : items.length)}>{seriesLoading ? t('seriesBusy') : t('seriesBtn', Math.min(20, seriesSource === 'yearly' ? yearly.filter((y) => y.item).length : items.length))}</button>
		</div>
		{#if series.length}
			<svg viewBox="0 0 800 180" width="100%" style="margin-top: 0.6rem" aria-label={t('seriesAria')}>
				{#each yTicks as t (t)}
					<line x1={CX0} y1={sy(t)} x2={CX1} y2={sy(t)} stroke="#1c2950" />
					<text x={CX0 - 6} y={sy(t) + 4} fill="#98a6cc" font-size="10" text-anchor="end">{+t.toFixed(2)}</text>
				{/each}
				{#each seriesSegments as segment}<polyline points={segment} fill="none" stroke="#50fa7b" stroke-width="2" />{/each}
				{#if series.some(row => row.item.id === itemA?.id)}{@const selected = series.findIndex(row => row.item.id === itemA?.id)}<line x1={sx(selected, series.length)} x2={sx(selected, series.length)} y1={CY0} y2={CY1} stroke="#f1fa8c" stroke-dasharray="4 3" />{/if}
				{#each series as s, i (s.item.id)}
					{#if s.reason}
						<circle cx={sx(i, series.length)} cy={CY1} r="4" fill="none" stroke="#8b93a7" stroke-width="1.5">
							<title>{t('seriesMaskedTitle', fmtDate(s.item.properties.datetime), maskText(s.reason))}</title>
						</circle>
					{:else if s.v !== null}
						<circle cx={sx(i, series.length)} cy={sy(s.v)} r="4" fill={cloud(s.item)! > 20 ? '#ffb86c' : '#50fa7b'} stroke={offsetKnown(s.item) ? 'none' : '#ff5555'} stroke-width="2">
							<title>{t('seriesPointTitle', fmtDate(s.item.properties.datetime), s.v.toFixed(3), cloud(s.item)?.toFixed(0))}{offsetKnown(s.item) ? '' : ' · ' + t('offsetUnknown')}</title>
						</circle>
					{/if}
					{#if i % Math.ceil(series.length / 6) === 0 || i === series.length - 1}
						<text x={sx(i, series.length)} y={CY1 + 22} fill="#98a6cc" font-size="10" text-anchor="middle">{seriesSource === 'yearly' ? fmtDate(s.item.properties.datetime).slice(0, 7) : fmtDate(s.item.properties.datetime)}</text>
					{/if}
				{/each}
			</svg>
			<p class="muted" style="font-size: 0.78rem">{@html t('seriesNote')} {#if series.some((x) => x.reason)}{t('seriesMaskedLegend')}{/if} {#if series.some((x) => !offsetKnown(x.item))}{t('offsetUnknownSeries')}{/if}</p>
		{:else}
			<p class="muted" style="font-size: 0.9rem">{t('seriesEmpty')}</p>
		{/if}
	</div>
</div>

{#if itemA}
	<div class="panel">
		<h3>{t('metaTitle')} <span class="muted" style="font-weight: 400; font-size: 0.8rem">{t('metaSub')}</span></h3>
		<div class="grid cols-3">
			<div class="stat"><span class="label">{t('metaSat')}</span><span class="value" style="font-size: 1.1rem">{satLabel(itemA)}</span></div>
			<div class="stat"><span class="label">{t('metaTime')}</span><span class="value" style="font-size: 1.1rem">{fmtJst(new Date(itemA.properties.datetime))}</span></div>
			<div class="stat"><span class="label">{t('metaMgrs')}</span><span class="value" style="font-size: 1.1rem">{String(itemA.properties['grid:code'] ?? '').replace('MGRS-', '')}</span></div>
			<div class="stat"><span class="label">{t('metaSun')}</span><span class="value" style="font-size: 1.1rem">{fmt(sunAz, 1)}° / {fmt(sunEl, 1)}°</span></div>
			<div class="stat"><span class="label">{t('metaView')}</span><span class="value" style="font-size: 1.1rem">{fmt(num(itemA.properties['view:azimuth']), 1)}° / {fmt(num(itemA.properties['view:incidence_angle']), 1)}°</span></div>
			<div class="stat"><span class="label">{t('metaOrbit')}</span><span class="value" style="font-size: 1.1rem">{String(itemA.properties['sat:orbit_state'] ?? 'descending')}</span></div>
		</div>
		<p class="muted" style="font-size: 0.8rem">
			{t('metaNote1', sunAz !== null ? `${Math.round((sunAz + 180) % 360)}°` : '—')}
			{t('metaNote2')}
		</p>
	</div>
{/if}
<h2>{t('explainH2')}</h2>
<div class="grid cols-2">
	<div class="panel">
		<h3>{t('explainNdviTitle')}</h3>
		<table>
			<thead><tr><th>{t('explainThSite')}</th><th class="num">NIR (B8)</th><th class="num">Red (B4)</th><th class="num">NDVI</th></tr></thead>
			<tbody>
				<tr><td>{t('explainSiteForest')}</td><td class="num">2465</td><td class="num">323</td><td class="num" style="color: var(--green)">+0.77</td></tr>
				<tr><td>{t('explainSiteUrban')}</td><td class="num">1500</td><td class="num">1296</td><td class="num">+0.07</td></tr>
			</tbody>
		</table>
		<p style="font-size: 0.9rem">
			{t('explainNdviText1')}
			{@html t('explainNdviText2')}
		</p>
		<table style="font-size: 0.85rem">
			<thead><tr><th>NDVI</th><th>{t('explainThTypical')}</th></tr></thead>
			<tbody>
				<tr><td class="num" style="color: var(--red)">&lt; 0</td><td>{t('explainRange1')}</td></tr>
				<tr><td class="num">0〜0.2</td><td>{@html t('explainRange2')}</td></tr>
				<tr><td class="num">0.2〜0.5</td><td>{t('explainRange3')}</td></tr>
				<tr><td class="num" style="color: var(--green)">&gt; 0.6</td><td>{t('explainRange4')}</td></tr>
			</tbody>
		</table>
	</div>
	<div class="panel">
		<h3>{t('explainCaveatsTitle')}</h3>
		<ul style="font-size: 0.9rem; padding-left: 1.2rem; margin: 0.3rem 0">
			<li>{@html t('explainCaveat1')}</li>
			<li>{@html t('explainCaveat2')}</li>
			<li>{@html t('explainCaveat3')}</li>
			<li>{@html t('explainCaveat4')}</li>
			<li>{@html t('explainCaveat5')}</li>
		</ul>
	</div>
</div>

<div class="grid cols-2">
	<div class="panel">
		<h3>{t('explainCompTitle')}</h3>
		<table style="font-size: 0.85rem">
			<tbody>
				<tr><td><strong>{t('explainCompTci')}</strong></td><td>{t('explainCompTciDesc')}</td></tr>
				<tr><td><strong>{t('explainCompFc')}</strong></td><td>{t('explainCompFcDesc')}</td></tr>
				<tr><td><strong>{t('explainCompSwir')}</strong></td><td>{t('explainCompSwirDesc')}</td></tr>
				<tr><td><strong>{t('explainCompAgri')}</strong></td><td>{t('explainCompAgriDesc')}</td></tr>
				<tr><td><strong>{t('explainCompUrban')}</strong></td><td>{t('explainCompUrbanDesc')}</td></tr>
			</tbody>
		</table>
	</div>
	<div class="panel">
		<h3>{t('explainUseTitle')}</h3>
		<ul style="font-size: 0.9rem; padding-left: 1.2rem; margin: 0.3rem 0">
			<li>{@html t('explainUse1')}</li>
			<li>{@html t('explainUse2')}</li>
			<li>{@html t('explainUse3')}</li>
			<li>{@html t('explainUse4')}</li>
		</ul>
		<p class="muted" style="font-size: 0.85rem">
			{t('explainUseNote')}
		</p>
	</div>
</div>

<div class="note">
	<strong>{t('noteTitle')}</strong> {@html t('noteBody')}
</div>

<style>
	#annual-controls { grid-column: 1 / -1; min-width: 0; scroll-margin-top: 1rem; }
	#annual-controls .control { max-width: 640px; }
	#annual-controls .scene { width: 190px; }
	#annual-controls .scene select { width: 100%; font-size: 0.75rem; }

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
	/* Fullscreen API が使えない環境向けのフォールバック（実際の全画面時は :fullscreen が効く） */
	.mapwrap.fullscreen {
		position: fixed;
		inset: 0;
		z-index: 10000;
		height: 100vh;
		height: 100dvh;
		margin: 0;
		border-radius: 0;
		border: none;
	}
	.mapwrap:fullscreen {
		border-radius: 0;
		border: none;
	}
	.map {
		position: absolute;
		inset: 0;
	}
	.seg button.fs {
		display: inline-flex;
		align-items: center;
		padding: 0.3rem 0.55rem;
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
	.compass-box {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.1rem;
	}
	.compass-key {
		font-size: 0.62rem;
		color: var(--muted);
		background: rgba(11, 16, 32, 0.8);
		border-radius: 4px;
		padding: 0.05rem 0.35rem;
		white-space: nowrap;
	}
	.timebar {
		width: 230px;
		background: rgba(11, 16, 32, 0.88);
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 0.4rem 0.5rem;
		box-shadow: 0 2px 6px rgba(0, 0, 0, 0.4);
		font-size: 0.72rem;
	}
	.timebar .t {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		margin-bottom: 0.3rem;
	}
	.timebar .mono {
		font-family: var(--mono);
		font-size: 0.8rem;
	}
	.timebar .off {
		font-family: var(--mono);
		color: var(--orange);
	}
	.timebar .off.live {
		color: var(--green);
	}
	.timebar .row {
		display: flex;
		gap: 2px;
	}
	.timebar .row button {
		flex: 1;
		padding: 0.15rem 0;
		font-size: 0.68rem;
		font-weight: 600;
		background: var(--panel);
		color: var(--muted);
		border: 1px solid var(--border);
		border-radius: 4px;
	}
	.timebar .row button.active {
		color: var(--text);
		border-color: var(--accent);
	}
	.timebar .row button.live:not(:disabled) {
		color: var(--green);
	}
	.timebar .slider {
		position: relative;
		margin: 0.35rem 0 0.2rem;
	}
	.timebar input[type='range'] {
		width: 100%;
		margin: 0;
		accent-color: var(--accent);
		display: block;
	}
	/* スライダー下の目盛り: シーン撮影時刻（過去）と予測パス（未来） */
	.timebar .ticks {
		position: relative;
		height: 8px;
		margin: 1px 7px 0;
	}
	.timebar .tick {
		position: absolute;
		top: 0;
		width: 3px;
		height: 8px;
		padding: 0;
		margin-left: -1.5px;
		border: none;
		border-radius: 1px;
		background: var(--c);
		cursor: pointer;
	}
	.timebar .now {
		position: absolute;
		top: -1px;
		width: 1px;
		height: 10px;
		margin-left: -0.5px;
		background: var(--green);
		opacity: 0.8;
	}
	.timebar .tick.pass {
		height: 6px;
		opacity: 0.6;
	}
	.timebar .tick:hover {
		height: 10px;
		opacity: 1;
	}
	.timebar .sync {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		margin: 0.3rem 0 0.15rem;
		color: var(--text);
		cursor: pointer;
	}
	.timebar .sync input {
		margin: 0;
		accent-color: var(--accent);
	}
	.timebar .nearest {
		color: var(--muted);
		font-size: 0.66rem;
		margin-bottom: 0.25rem;
	}
	.timebar .nearest .swatch {
		width: 7px;
		height: 7px;
	}
	.timebar .imgage {
		font-size: 0.66rem;
		line-height: 1.4;
		color: var(--accent-2);
		border-top: 1px solid var(--border);
		padding-top: 0.25rem;
		margin-bottom: 0.3rem;
	}
	.switched {
		position: absolute;
		left: 50%;
		top: 46%;
		transform: translate(-50%, -50%);
		z-index: 6;
		background: rgba(11, 16, 32, 0.9);
		border: 1px solid var(--accent-2);
		color: var(--accent-2);
		border-radius: 8px;
		padding: 0.4rem 0.9rem;
		font-size: 0.85rem;
		font-weight: 600;
		pointer-events: none;
		animation: fadeout 2.5s forwards;
	}
	.legend.flash {
		animation: flash 0.6s 3;
	}
	@keyframes flash {
		50% {
			border-color: var(--accent-2);
			box-shadow: 0 0 0 2px rgba(139, 233, 253, 0.5);
		}
	}
	@keyframes fadeout {
		0%, 70% {
			opacity: 1;
		}
		100% {
			opacity: 0;
		}
	}
	.seg button.fs .fs-label {
		margin-left: 0.35rem;
		font-size: 0.75rem;
	}
	.seg button.fs.active {
		color: var(--orange);
	}
	.timebar .key {
		display: flex;
		flex-direction: column;
		gap: 1px;
		color: var(--muted);
		font-size: 0.64rem;
	}
	.timebar .key i {
		display: inline-block;
		width: 14px;
		height: 6px;
		margin-right: 0.35rem;
		vertical-align: middle;
	}
	.k-swath {
		background: rgba(139, 233, 253, 0.25);
		border: 1px solid var(--accent-2);
	}
	.k-scan {
		height: 3px !important;
		background: #fff;
		box-shadow: 0 0 0 1.5px var(--accent-2);
	}
	.k-dash {
		height: 0 !important;
		border-top: 1.5px dashed var(--accent-2);
	}
	.tile-status { position: absolute; bottom: 12px; left: 12px; z-index: 5; max-width: calc(100% - 24px); background: rgba(11, 16, 32, 0.9); padding: 0.4rem 0.6rem; border-radius: 6px; font-size: 0.75rem; pointer-events: none; }
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
	.warn { color: #ffb86c; }
	.region { font-size: 0.7rem; line-height: 1.3; margin-top: 0.15rem; white-space: normal; }
	.region.err { color: #ffb4b4; }
	.adj { font-size: 0.7rem; color: #ffb86c; white-space: normal; }
	.loadingB {
		/* 境界線の右（B 側）に置く。中央の「タイル読込中…」とは段をずらして重ならないようにする */
		transform: none;
		top: 44px;
	}
	.tile-error {
		position: absolute;
		top: 10px;
		left: 10px;
		z-index: 8;
		background: rgba(60, 12, 20, 0.9);
		border: 1px solid var(--red);
		border-radius: 6px;
		padding: 0.25rem 0.7rem;
		font-size: 0.8rem;
		color: #ffb4b4;
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
	.divider {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 0;
		z-index: 7;
		pointer-events: none;
	}
	.divider .line {
		position: absolute;
		top: 0;
		bottom: 0;
		left: -1px;
		width: 2px;
		background: var(--orange);
		box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.4);
	}
	.divider .handle {
		position: absolute;
		top: 50%;
		left: 0;
		transform: translate(-50%, -50%);
		pointer-events: auto;
		touch-action: none;
		cursor: ew-resize;
		display: flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0.25rem 0.55rem;
		border-radius: 999px;
		background: var(--orange);
		color: #071022;
		border: 2px solid #071022;
		font-size: 0.72rem;
		font-weight: 700;
		line-height: 1;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.5);
		user-select: none;
	}
	.divider .handle:focus-visible {
		outline: 2px solid var(--accent-2);
		outline-offset: 2px;
	}
	.divider .arrows {
		letter-spacing: -1px;
	}
	.divider .ab {
		font-family: var(--mono);
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
