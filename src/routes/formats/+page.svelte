<script lang="ts">
	import { noise } from '$lib/spectral';
	import { makeT } from '$lib/i18n/lang.svelte';
	import { formats } from '$lib/i18n/formats';

	const t = makeT(formats);

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
		{ key: 'zarrPresetSpatial', t: 1, y: 1024, x: 1024 },
		{ key: 'zarrPresetBalanced', t: 30, y: 256, x: 256 },
		{ key: 'zarrPresetTemporal', t: 365, y: 64, x: 64 }
	] as const;
	let chunkIdx = $state(1);
	const chunk = $derived(chunkPresets[chunkIdx]);
	const chunkBytes = $derived(chunk.t * chunk.y * chunk.x * 2);
	const nChunks = $derived(Math.ceil(cube.t / chunk.t) * Math.ceil(cube.y / chunk.y) * Math.ceil(cube.x / chunk.x));
	// クエリ A: 1 地点の 1 年時系列 / クエリ B: 1 日の全域 / クエリ C: 1 か月 × 256x256
	const q = $derived([
		{ key: 'zarrQTimeseries' as const, chunks: Math.ceil(cube.t / chunk.t), useful: 365 * 2 },
		{ key: 'zarrQFullDay' as const, chunks: Math.ceil(cube.y / chunk.y) * Math.ceil(cube.x / chunk.x), useful: 2048 * 2048 * 2 },
		{ key: 'zarrQSmallRegion' as const, chunks: Math.ceil(30 / chunk.t + (30 % chunk.t ? 0 : 0)) * Math.ceil(256 / chunk.y) * Math.ceil(256 / chunk.x), useful: 30 * 256 * 256 * 2 }
	]);
</script>

<svelte:head>
	<title>{t('title')}</title>
</svelte:head>

<h1>{t('h1')}</h1>
<p class="muted">
	{@html t('lead')}
</p>

<h2>{t('cogH2')}</h2>
<div class="grid cols-2">
	<div class="panel">
		<div class="btn-row">
			{#each levels as l (l.lv)}
				<button class="ghost" class:active={level === l.lv} onclick={() => setLevel(l.lv)}>
					{l.lv === 0 ? t('cogFull') : t('cogOverview', l.scale)} <span class="muted" style="font-size: 0.75rem">{l.size}px / {l.n}×{l.n}</span>
				</button>
			{/each}
		</div>
		<p class="muted" style="font-size: 0.85rem">{t('cogHint')}</p>
		<div class="tilegrid" style="grid-template-columns: repeat({cur.n}, 1fr); width: {gridPx}px; height: {gridPx}px">
			{#each Array.from({ length: cur.n * cur.n }) as _, i (i)}
				<button class="tile" class:sel={selected.has(i)} onclick={() => toggle(i)} aria-label={t('cogTileAria', i)}></button>
			{/each}
		</div>
	</div>
	<div class="panel">
		<div class="grid cols-2">
			<div class="stat"><span class="label">{t('cogStatTotal')}</span><span class="value">{fmtMB(layout.total)}</span></div>
			<div class="stat"><span class="label">{t('cogStatFetched')}</span><span class="value" style="color: var(--green)">{fmtMB(fetched)}</span></div>
			<div class="stat"><span class="label">{t('cogStatRequests')}</span><span class="value">{1 + ranges.length}</span></div>
			<div class="stat"><span class="label">{t('cogStatSaving')}</span><span class="value">{(100 - (fetched / layout.total) * 100).toFixed(1)}<span class="unit">%</span></span></div>
		</div>
		<h3 style="margin-top: 1rem">{t('cogReqH3')}</h3>
		<pre style="max-height: 260px"><code>{`GET /B04.tif  HTTP/1.1
Range: bytes=0-${HEADER - 1}          ${t('cogReqHeaderComment')}
${ranges.length === 0 ? '\n' + t('cogReqPlaceholder') : ranges.map((r) => `\nGET /B04.tif  HTTP/1.1\nRange: bytes=${r.start}-${r.end}   ${t('cogReqTileComment', level, r.i)}`).join('')}`}</code></pre>
		<div class="note">
			<strong>{t('cogNoteStrong')}</strong>
			{t('cogNote1')}<strong>{t('cogNoteAll', fmtMB(layout.total))}</strong>{t('cogNote2')}
		</div>
	</div>
</div>

<h2>{t('zarrH2')}</h2>
<div class="grid cols-2">
	<div class="panel">
		<p style="font-size: 0.9rem">
			{t('zarrIntro1')} <code>(time=365, y=2048, x=2048)</code> = {fmtMB(cube.t * cube.y * cube.x * 2)}
			{t('zarrIntro2')} <strong>{t('zarrIntroStrong')}</strong>{t('zarrIntro3')}
		</p>
		<div class="btn-row" style="flex-direction: column; align-items: stretch">
			{#each chunkPresets as p, i (p.key)}
				<button class="ghost" class:active={chunkIdx === i} onclick={() => (chunkIdx = i)} style="text-align: left">{t(p.key)}</button>
			{/each}
		</div>
		<div class="grid cols-2" style="margin-top: 0.8rem">
			<div class="stat"><span class="label">{t('zarrStatChunkSize')}</span><span class="value">{fmtMB(chunkBytes)}</span></div>
			<div class="stat"><span class="label">{t('zarrStatChunks')}</span><span class="value">{nChunks.toLocaleString()}</span></div>
		</div>
	</div>
	<div class="panel tight">
		<table>
			<thead><tr><th>{t('zarrThQuery')}</th><th class="num">{t('zarrThChunks')}</th><th class="num">{t('zarrThBytes')}</th><th class="num">{t('zarrThEff')}</th></tr></thead>
			<tbody>
				{#each q as row (row.key)}
					{@const bytes = row.chunks * chunkBytes}
					{@const eff = Math.min(100, (row.useful / bytes) * 100)}
					<tr>
						<td>{t(row.key)}</td>
						<td class="num">{row.chunks.toLocaleString()}</td>
						<td class="num">{fmtMB(bytes)}</td>
						<td class="num" style:color={eff > 50 ? 'var(--green)' : eff > 5 ? 'var(--orange)' : 'var(--red)'}>{eff < 0.01 ? '<0.01' : eff.toFixed(eff < 1 ? 2 : 0)}%</td>
					</tr>
				{/each}
			</tbody>
		</table>
		<div class="note" style="margin-top: 0.8rem">
			<strong>{t('zarrNoteStrong')}</strong>
			{t('zarrNote')}
		</div>
	</div>
</div>

<h2>{t('lvH2')}</h2>
<div class="panel tight" style="overflow-x: auto">
	<table>
		<thead><tr><th>{t('lvThLevel')}</th><th>{t('lvThContent')}</th><th>{t('lvThUnit')}</th><th>{t('lvThS2')}</th><th>{t('lvThRole')}</th></tr></thead>
		<tbody>
			<tr><td><code>L0</code></td><td>{t('lv0Content')}</td><td>{t('lv0Unit')}</td><td>{t('lv0S2')}</td><td class="muted">{t('lv0Role')}</td></tr>
			<tr><td><code>L1A/B</code></td><td>{t('lv1abContent')}</td><td>{t('lv1abUnit')}</td><td>{t('lv1abS2')}</td><td class="muted">{t('lv1abRole')}</td></tr>
			<tr><td><code>L1C</code></td><td>{@html t('lv1cContent')}</td><td>{t('lv1cUnit')}</td><td>{t('lv1cS2')}</td><td>{t('lv1cRole')}</td></tr>
			<tr><td><code>L2A</code></td><td>{@html t('lv2aContent')}</td><td>{t('lv2aUnit')}</td><td>{t('lv2aS2')}</td><td>{@html t('lv2aRole')}</td></tr>
			<tr><td><code>L3</code></td><td>{t('lv3Content')}</td><td>{t('lv3Unit')}</td><td>{t('lv3S2')}</td><td>{t('lv3Role')}</td></tr>
			<tr><td><code>ARD</code></td><td>{t('ardContent')}</td><td>{t('ardUnit')}</td><td>{t('ardS2')}</td><td>{t('ardRole')}</td></tr>
		</tbody>
	</table>
</div>

<h2>{t('osH2')}</h2>
<div class="grid cols-2">
	<div class="panel">
		<h3>{t('optH3')}</h3>
		<ul style="font-size: 0.9rem; padding-left: 1.2rem; margin: 0.3rem 0">
			<li>{t('opt1')}</li>
			<li>{t('opt2')}</li>
			<li>{t('opt3')}</li>
			<li>{t('opt4')}</li>
		</ul>
	</div>
	<div class="panel">
		<h3>{t('sarH3')}</h3>
		<ul style="font-size: 0.9rem; padding-left: 1.2rem; margin: 0.3rem 0">
			<li>{t('sar1')}</li>
			<li>{t('sar2')}</li>
			<li>{t('sar3')}</li>
			<li>{t('sar4')}</li>
		</ul>
	</div>
</div>

<h2>{t('pyH2')}</h2>
<div class="panel">
	<pre><code>{t('pyCode')}</code></pre>
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
