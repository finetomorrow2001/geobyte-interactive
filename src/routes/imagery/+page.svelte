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
		normDiff,
		fmtDate,
		cogRequestCount,
		type StacItem,
		type RenderMode
	} from '$lib/imagery';
	import { makeT, L } from '$lib/i18n/lang.svelte';
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
		clearTimeout(passDebounce);
		clearTimeout(switchedTimer);
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
			updateTracks(displayTime());
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
			if (!items.length) error = t('searchNoScenes');
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

	function selectA(item: StacItem, fromSync = false) {
		if (itemA?.id === item.id) return;
		itemA = item;
		if (fromSync) {
			switched = { date: fmtDate(item.properties.datetime), sat: satLabel(item).split(' ')[0] };
			clearTimeout(switchedTimer);
			switchedTimer = setTimeout(() => (switched = null), 2500);
		}
		forMaps((m) => setFootprint(m, item));
		refreshLayers();
		if (point) queryPoint(point.lat, point.lon);
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
	<title>{t('title')}</title>
</svelte:head>

<h1>{t('h1')}</h1>
<p class="muted">
	{t('lead1')}<strong>{t('leadStrong')}</strong>{t('lead2')}
</p>

<details class="panel tight howto" open>
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
</div>

<svelte:document onfullscreenchange={onFullscreenChange} />

<div class="mapwrap" class:fullscreen bind:this={mapWrapEl}>
	<div bind:this={mapElA} class="map"></div>
	<!-- 比較用の 2 枚目。B 選択時だけ生成され、右側 (swipe% 以降) のみ表示 -->
	<div bind:this={mapElB} class="map mapB" class:hidden={!itemB} style:clip-path="inset(0 0 0 {swipe}%)"></div>

	<div class="map-ui">
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
			<Compass {bearing} {pitch} sunAzimuth={sunAz} sunElevation={sunEl} {trackHeading} onreset={resetNorth} />
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

	{#if tilesLoading || loading}
		<div class="loading">{loading ? t('mapLoadingStac') : t('mapLoadingTiles')}</div>
	{/if}
	{#if itemA}
		{#if switched}
			<div class="switched">{t('mapTimeSwitched', switched.date, switched.sat)}</div>
		{/if}
		<div class="legend" class:flash={!!switched}>
			<div><strong>A</strong> {fmtDate(itemA.properties.datetime)} <span class="muted">{satLabel(itemA)} · {t('mapLegendCloud', cloud(itemA)?.toFixed(0))}</span></div>
			{#if itemB}
				<div><strong>B</strong> {fmtDate(itemB.properties.datetime)} <span class="muted">{satLabel(itemB)} · {t('mapLegendCloud', cloud(itemB)?.toFixed(0))}</span> <span class="muted">{t('mapLegendRight')}</span></div>
			{/if}
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
						<tr><td><code>{a}</code></td><td class="num">{pointA?.[a] ?? '—'}</td>{#if itemB}<td class="num">{pointB?.[a] ?? '—'}</td>{/if}</tr>
					{/each}
				</tbody>
			</table>
			<table style="margin-top: 0.6rem">
				<thead><tr><th>{t('pointThIndex')}</th><th class="num">A</th>{#if itemB}<th class="num">B</th><th class="num">B − A</th>{/if}</tr></thead>
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
			<p class="muted" style="font-size: 0.78rem">{t('pointNote')}</p>
		{/if}
	</div>

	<div class="panel">
		<h3>{t('seriesTitle')}</h3>
		<div style="display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap">
			<select bind:value={seriesIndex}>
				{#each indices as ix (ix.id)}<option value={ix.id}>{L(ix.name)}</option>{/each}
			</select>
			<button onclick={buildSeries} disabled={!point || seriesLoading || !items.length}>{seriesLoading ? t('seriesBusy') : t('seriesBtn', Math.min(20, items.length))}</button>
		</div>
		{#if series.length}
			<svg viewBox="0 0 800 180" width="100%" style="margin-top: 0.6rem" aria-label={t('seriesAria')}>
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
							<title>{t('seriesPointTitle', fmtDate(s.item.properties.datetime), s.v.toFixed(3), cloud(s.item)?.toFixed(0))}</title>
						</circle>
					{/if}
					{#if i % Math.ceil(series.length / 6) === 0 || i === series.length - 1}
						<text x={sx(i, series.length)} y={CY1 + 22} fill="#98a6cc" font-size="10" text-anchor="middle">{fmtDate(s.item.properties.datetime).slice(5)}</text>
					{/if}
				{/each}
			</svg>
			<p class="muted" style="font-size: 0.78rem">{@html t('seriesNote')}</p>
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
