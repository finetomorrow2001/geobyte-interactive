<script lang="ts">
	import { makeT } from '$lib/i18n/lang.svelte';
	import { stac } from '$lib/i18n/stac';

	const t = makeT(stac);
	type Key = keyof typeof stac.ja;

	const API = 'https://earth-search.aws.element84.com/v1';

	const collections: { id: string; name: Key; optical: boolean }[] = [
		{ id: 'sentinel-2-l2a', name: 'colS2L2A', optical: true },
		{ id: 'sentinel-2-c1-l2a', name: 'colS2C1', optical: true },
		{ id: 'landsat-c2-l2', name: 'colLandsat', optical: true },
		{ id: 'sentinel-1-grd', name: 'colS1GRD', optical: false },
		{ id: 'cop-dem-glo-30', name: 'colDEM', optical: false }
	];

	const places: { name: Key; bbox: number[] }[] = [
		{ name: 'placeTokyo', bbox: [139.6, 35.55, 139.85, 35.8] },
		{ name: 'placeOsaka', bbox: [135.35, 34.55, 135.65, 34.8] },
		{ name: 'placeSapporo', bbox: [141.2, 42.95, 141.5, 43.15] },
		{ name: 'placeFukuoka', bbox: [130.3, 33.5, 130.55, 33.7] },
		{ name: 'placeFuji', bbox: [138.65, 35.3, 138.8, 35.45] }
	];
	const bboxLabels: Key[] = ['bboxW', 'bboxS', 'bboxE', 'bboxN'];

	const today = new Date();
	const monthAgo = new Date(today.getTime() - 60 * 86400000);
	const iso = (d: Date) => d.toISOString().slice(0, 10);

	let collection = $state('sentinel-2-l2a');
	let bbox = $state<number[]>([...places[0].bbox]);
	let dateFrom = $state(iso(monthAgo));
	let dateTo = $state(iso(today));
	let maxCloud = $state(20);
	let limit = $state(12);

	const isOptical = $derived(collections.find((c) => c.id === collection)?.optical ?? false);

	const body = $derived.by(() => {
		const b: Record<string, unknown> = {
			collections: [collection],
			bbox: bbox.map((v) => Math.round(v * 1e4) / 1e4),
			datetime: `${dateFrom}T00:00:00Z/${dateTo}T23:59:59Z`,
			limit,
			sortby: [{ field: 'properties.datetime', direction: 'desc' }]
		};
		if (isOptical) b.query = { 'eo:cloud_cover': { lt: maxCloud } };
		return b;
	});
	const bodyJson = $derived(JSON.stringify(body, null, 2));

	type Item = {
		id: string;
		properties: Record<string, unknown>;
		assets: Record<string, { href: string; type?: string; title?: string; roles?: string[] }>;
	};
	let loading = $state(false);
	let error = $state('');
	let matched = $state<number | null>(null);
	let items = $state<Item[]>([]);
	let elapsed = $state(0);
	let openItem = $state<Item | null>(null);

	async function search() {
		loading = true;
		error = '';
		items = [];
		openItem = null;
		const t0 = performance.now();
		try {
			const res = await fetch(`${API}/search`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			});
			if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
			const json = await res.json();
			matched = json.numberMatched ?? json.context?.matched ?? null;
			items = json.features;
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			elapsed = Math.round(performance.now() - t0);
			loading = false;
		}
	}

	const curl = $derived(`curl -s -X POST ${API}/search \\
  -H 'Content-Type: application/json' \\
  -d '${JSON.stringify(body)}' | jq '.features[] | {id, dt: .properties.datetime, cc: .properties["eo:cloud_cover"]}'`);

	const python = $derived(`from pystac_client import Client

client = Client.open("${API}")
search = client.search(
    collections=[${JSON.stringify(collection)}],
    bbox=${JSON.stringify(body.bbox)},
    datetime="${dateFrom}/${dateTo}",${isOptical ? `\n    query={"eo:cloud_cover": {"lt": ${maxCloud}}},` : ''}
    sortby=[{"field": "properties.datetime", "direction": "desc"}],
    max_items=${limit},
)
items = list(search.items())
print(len(items), "items")

${t('pyComment1')}
import rasterio
from rasterio.windows import from_bounds

href = items[0].assets["${isOptical ? (collection.startsWith('landsat') ? 'red' : 'red') : 'vv'}"].href
with rasterio.open(href) as src:
    win = from_bounds(*rasterio.warp.transform_bounds("EPSG:4326", src.crs, *${JSON.stringify(body.bbox)}), src.transform)
    arr = src.read(1, window=win)   ${t('pyComment2')}`);

	const cloud = (it: Item) => it.properties['eo:cloud_cover'] as number | undefined;
	const thumb = (it: Item) => it.assets?.thumbnail?.href ?? it.assets?.rendered_preview?.href;
</script>

<svelte:head>
	<title>{t('title')}</title>
</svelte:head>

<h1>{t('h1')}</h1>
<p class="muted">
	{@html t('lead1')}
	{t('lead2a')}<a href={API} target="_blank" rel="noreferrer">Earth Search</a>{t('lead2b')}
</p>

<div class="grid cols-2">
	<div class="panel">
		<h3>{t('queryTitle')}</h3>
		<div style="display: grid; gap: 0.7rem; margin-top: 0.6rem">
			<label>{t('queryCollection')}
				<select bind:value={collection} style="width: 100%">
					{#each collections as c (c.id)}<option value={c.id}>{c.id} — {t(c.name)}</option>{/each}
				</select>
			</label>
			<div>
				<span class="muted" style="font-size: 0.9rem">{t('queryBbox')}</span>
				<div class="btn-row">
					{#each places as p (p.name)}
						<button class="ghost" class:active={bbox.join() === p.bbox.join()} onclick={() => (bbox = [...p.bbox])}>{t(p.name)}</button>
					{/each}
				</div>
				<div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.4rem">
					{#each bboxLabels as lbl, i (lbl)}
						<label style="font-size: 0.75rem" class="muted">{t(lbl)}<input type="number" step="0.01" bind:value={bbox[i]} style="width: 100%" /></label>
					{/each}
				</div>
			</div>
			<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.4rem">
				<label style="font-size: 0.85rem" class="muted">{t('dateFrom')}<input type="date" bind:value={dateFrom} style="width: 100%" /></label>
				<label style="font-size: 0.85rem" class="muted">{t('dateTo')}<input type="date" bind:value={dateTo} style="width: 100%" /></label>
			</div>
			{#if isOptical}
				<div class="control" style="margin: 0">
					<label for="cc">{t('cloudMax')}<code>eo:cloud_cover</code></label>
					<output>&lt; {maxCloud}%</output>
					<input id="cc" type="range" min="0" max="100" step="5" bind:value={maxCloud} />
				</div>
			{/if}
			<div class="control" style="margin: 0">
				<label for="lim">{t('limitLabel')}</label>
				<output>{limit}</output>
				<input id="lim" type="range" min="1" max="50" step="1" bind:value={limit} />
			</div>
			<button onclick={search} disabled={loading}>{loading ? t('searching') : t('searchBtn')}</button>
		</div>
	</div>
	<div class="panel">
		<h3>{t('jsonTitle', API)}</h3>
		<pre><code>{bodyJson}</code></pre>
		<p class="muted" style="font-size: 0.85rem">
			{@html t('jsonNote')}
		</p>
	</div>
</div>

{#if error}
	<div class="note warn"><strong>{t('errorLabel')}</strong> {error}</div>
{/if}

{#if matched !== null && !loading}
	<h2>{t('resultsTitle')} <small class="muted" style="font-size: 0.9rem; font-weight: 400">{t('resultsSummary', matched.toLocaleString(), items.length, elapsed)}</small></h2>
	{#if items.length === 0}
		<div class="note">{t('noResults')}</div>
	{/if}
	<div class="results">
		{#each items as it (it.id)}
			<button class="item" class:active={openItem?.id === it.id} onclick={() => (openItem = openItem?.id === it.id ? null : it)}>
				{#if thumb(it)}
					<img src={thumb(it)} alt="" loading="lazy" />
				{:else}
					<div class="noimg muted">no thumbnail</div>
				{/if}
				<div class="meta">
					<div class="id">{it.id}</div>
					<div class="muted" style="font-size: 0.75rem">
						{String(it.properties.datetime).slice(0, 16).replace('T', ' ')} UTC
						{#if cloud(it) !== undefined}
							· {t('cloudPct', cloud(it)!.toFixed(0))}
						{/if}
						{#if it.properties.platform}
							· {it.properties.platform}
						{/if}
					</div>
				</div>
			</button>
		{/each}
	</div>

	{#if openItem}
		<div class="panel">
			<div style="display: flex; justify-content: space-between; align-items: baseline; gap: 1rem; flex-wrap: wrap">
				<h3>{t('assetsTitle', openItem.id, Object.keys(openItem.assets).length)}</h3>
				{#if collection === 'sentinel-2-l2a'}
					<a href="/imagery?item={openItem.id}" style="font-size: 0.9rem">{t('viewOnMap')}</a>
				{/if}
			</div>
			<p class="muted" style="font-size: 0.85rem">{t('assetsNote')}</p>
			<div style="overflow-x: auto">
				<table>
					<thead><tr><th>key</th><th>title / roles</th><th>type</th><th>href</th></tr></thead>
					<tbody>
						{#each Object.entries(openItem.assets) as [k, a] (k)}
							<tr>
								<td><code>{k}</code></td>
								<td style="font-size: 0.8rem">{a.title ?? ''} <span class="muted">{a.roles?.join(', ') ?? ''}</span></td>
								<td style="font-size: 0.75rem" class="muted">{(a.type ?? '').replace('image/tiff; application=geotiff; profile=cloud-optimized', 'COG').replace('application/', '')}</td>
								<td style="font-size: 0.75rem; word-break: break-all"><a href={a.href} target="_blank" rel="noreferrer">{a.href.length > 80 ? a.href.slice(0, 40) + '…' + a.href.slice(-35) : a.href}</a></td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			<details style="margin-top: 0.8rem">
				<summary class="muted" style="cursor: pointer; font-size: 0.9rem">{t('showProps')}</summary>
				<pre><code>{JSON.stringify(openItem.properties, null, 2)}</code></pre>
			</details>
		</div>
	{/if}
{/if}

<h2>{t('codeTitle')}</h2>
<div class="grid cols-2">
	<div class="panel">
		<h3>curl + jq</h3>
		<pre><code>{curl}</code></pre>
	</div>
	<div class="panel">
		<h3>Python (pystac-client + rasterio)</h3>
		<pre><code>{python}</code></pre>
	</div>
</div>

<h2>{t('structTitle')}</h2>
<div class="panel">
	<pre><code>{t('structure')}</code></pre>
	<div class="note">
		{@html t('tips')}
	</div>
</div>

<style>
	.results {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
		gap: 0.7rem;
		margin: 0.8rem 0;
	}
	.item {
		background: var(--panel);
		border: 1px solid var(--border);
		border-radius: 10px;
		padding: 0;
		overflow: hidden;
		text-align: left;
		color: var(--text);
		font-weight: 400;
		cursor: pointer;
	}
	.item:hover,
	.item.active {
		border-color: var(--accent);
	}
	.item img,
	.item .noimg {
		width: 100%;
		aspect-ratio: 1;
		object-fit: cover;
		display: flex;
		align-items: center;
		justify-content: center;
		background: #0a0f1e;
		font-size: 0.8rem;
	}
	.meta {
		padding: 0.5rem 0.7rem;
	}
	.id {
		font-family: var(--mono);
		font-size: 0.72rem;
		word-break: break-all;
	}
</style>
