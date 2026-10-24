<script lang="ts">
	import { onDestroy } from 'svelte';
	import { i18n, makeT } from '$lib/i18n/lang.svelte';
	import { findLocations, parseCoordinates, type CoordinateOrder, type LocationResult } from '$lib/location';
	const t = makeT({
		ja: {
			label: '場所を検索', placeholder: '富士山、信濃川、新宿区、住所、郵便番号、35.68, 139.75',
			help: '山・川・地域・市町村・住所・郵便番号を世界中から検索。地名に都道府県や国を添えると絞り込めます。',
			order: '座標の入力順', latlon: '緯度, 経度', lonlat: '経度, 緯度', submit: '検索', busy: '検索中…',
			none: '場所が見つかりません。地域・国を添えるか、座標で指定してください。',
			coordinates: '座標を確認してください。緯度は ±85.0511°、経度は ±180°。例: lat=35.68, lon=139.75',
			service: '場所検索サービスに接続できません。再試行するか座標を入力してください。', rate: '少し待ってから検索してください。',
			selected: '表示する場所', attribution: '場所検索: Photon / © OpenStreetMap contributors',
			privacy: '地名・住所・郵便番号は Photon に送信されます。座標入力はブラウザ内で処理します。'
		},
		en: {
			label: 'Find a location', placeholder: 'Mt. Fuji, Shinano River, a city, address, postal code, or 35.68, 139.75',
			help: 'Search worldwide for mountains, rivers, areas, towns, cities, addresses or postal codes. Add a region or country to narrow the results.',
			order: 'Coordinate order', latlon: 'Latitude, longitude', lonlat: 'Longitude, latitude', submit: 'Search', busy: 'Searching…',
			none: 'No location found. Add a region or country, or enter coordinates.',
			coordinates: 'Check coordinates: latitude ±85.0511°, longitude ±180°. Example: lat=35.68, lon=139.75',
			service: 'Location search is unavailable. Try again or enter coordinates.', rate: 'Please wait a moment before searching again.',
			selected: 'Location to display', attribution: 'Place search: Photon / © OpenStreetMap contributors',
			privacy: 'Names, addresses and postal codes are sent to Photon. Coordinates are processed in your browser.'
		}
	});
	let { onselect, ready = true, selected = $bindable<LocationResult | null>(null) }: { onselect: (place: LocationResult) => void; ready?: boolean; selected?: LocationResult | null } = $props();
	let query = $state(''), order = $state<CoordinateOrder>('latlon');
	let results = $state<LocationResult[]>([]);
	let busy = $state(false), error = $state(''), searched = $state(false);
	let controller: AbortController | undefined;
	onDestroy(() => controller?.abort());
	function choose(place: LocationResult) { selected = place; results = []; onselect(place); }
	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (!query.trim() || !ready) return;
		controller?.abort();
		const current = controller = new AbortController();
		results = []; selected = null; error = ''; busy = true; searched = false;
		try {
			const coordinate = parseCoordinates(query, order);
			if (coordinate) { choose(coordinate); return; }
			const found = await findLocations(query, i18n.lang, AbortSignal.any([current.signal, AbortSignal.timeout(15000)]));
			if (controller !== current) return;
			results = found; searched = true;
		} catch (e) {
			if (current.signal.aborted || controller !== current) return;
			const code = e instanceof Error ? e.message : '';
			error = code === 'coordinates' || code === 'rate' ? code : 'service';
		} finally { if (controller === current) busy = false; }
	}
</script>

<section class="panel location-search" aria-label={t('label')}>
	<form onsubmit={submit}>
		<label for="location-query"><strong>{t('label')}</strong></label>
		<div class="row">
			<input id="location-query" type="search" bind:value={query} placeholder={t('placeholder')} maxlength="250" required autocomplete="off" />
			<button disabled={busy || !ready || !query.trim()}>{busy ? t('busy') : t('submit')}</button>
		</div>
		<div class="coordinate-order"><label for="coordinate-order">{t('order')}</label> <select id="coordinate-order" bind:value={order}><option value="latlon">{t('latlon')}</option><option value="lonlat">{t('lonlat')}</option></select></div>
	</form>
	<p class="muted">{t('help')}</p>
	<div aria-live="polite">
		{#if error}<p class="note warn">{t(error as 'coordinates' | 'rate' | 'service')}</p>{/if}
		{#if searched && !results.length && !selected}<p>{t('none')}</p>{/if}
		{#if selected}<p><strong>{t('selected')}:</strong> {selected.name} · {selected.lat.toFixed(5)}, {selected.lon.toFixed(5)}</p>{/if}
	</div>
	{#if results.length}
		<ul>{#each results as result (result.id)}<li><button type="button" class="ghost result" onclick={() => choose(result)}><strong>{result.name}</strong><span>{result.detail}</span><span class="coords">{result.lat.toFixed(5)}, {result.lon.toFixed(5)}</span></button></li>{/each}</ul>
	{/if}
	<small class="muted"><a href="https://photon.komoot.io" target="_blank" rel="noreferrer">{t('attribution')}</a> · {t('privacy')}</small>
</section>

<style>
	.location-search { margin: 1rem 0; }
	.row { display: flex; gap: 0.5rem; margin: 0.4rem 0; }
	.row input { flex: 1; min-width: 0; }
	.coordinate-order { display: flex; align-items: center; gap: 0.5rem; font-size: 0.8rem; flex-wrap: wrap; }
	p { font-size: 0.85rem; }
	ul { list-style: none; padding: 0; margin: 0.5rem 0; display: grid; gap: 0.3rem; }
	.result { display: flex; flex-direction: column; align-items: flex-start; text-align: left; width: 100%; gap: 0.1rem; white-space: normal; overflow-wrap: anywhere; }
	.result span { font-size: 0.8rem; color: var(--muted); }
	.coords { font-family: var(--mono); }
	small { display: block; font-size: 0.7rem; }
</style>
