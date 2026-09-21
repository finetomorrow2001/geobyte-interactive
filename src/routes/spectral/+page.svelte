<script lang="ts">
	import {
		bands,
		sceneBands,
		landCovers,
		indices,
		normDiff,
		makeScene,
		noise,
		toByte,
		indexColor,
		composites,
		type SceneBand
	} from '$lib/spectral';
	import { makeT, L } from '$lib/i18n/lang.svelte';
	import { spectral } from '$lib/i18n/spectral';

	const t = makeT(spectral);

	// ---- スペクトル曲線 ----
	let visible = $state<Record<string, boolean>>(Object.fromEntries(landCovers.map((c) => [c.id, true])));
	const plotBands = bands.filter((b) => (sceneBands as readonly string[]).includes(b.id));
	const X0 = 60, X1 = 760, Y0 = 20, Y1 = 260;
	const wl2x = (wl: number) => X0 + ((wl - 400) / (2300 - 400)) * (X1 - X0);
	const r2y = (r: number) => Y1 - r * (Y1 - Y0);

	// ---- 指標ビルダー ----
	let bandA = $state<SceneBand>('B8');
	let bandB = $state<SceneBand>('B4');
	const matchedIndex = $derived(indices.find((i) => i.a === bandA && i.b === bandB));
	const indexValues = $derived(landCovers.map((c) => ({ c, v: normDiff(c.refl[bandA], c.refl[bandB]) })));

	// ---- 合成シーン ----
	const SIZE = 120;
	const scene = makeScene(SIZE);
	let mode = $state<'rgb' | 'index'>('rgb');
	let compR = $state<SceneBand>('B4');
	let compG = $state<SceneBand>('B3');
	let compB = $state<SceneBand>('B2');
	let gain = $state(3);
	let canvas: HTMLCanvasElement | undefined = $state();

	function applyComposite(c: (typeof composites)[number]) {
		mode = 'rgb';
		compR = c.r;
		compG = c.g;
		compB = c.b;
	}

	$effect(() => {
		if (!canvas) return;
		const ctx = canvas.getContext('2d')!;
		const img = ctx.createImageData(SIZE, SIZE);
		for (let i = 0; i < SIZE * SIZE; i++) {
			const cover = landCovers[scene[i]];
			// テクスチャ用の微小ノイズ（±8%）
			const n = 1 + (noise(i) - 0.5) * 0.16;
			let rgb: [number, number, number];
			if (mode === 'rgb') {
				rgb = [
					toByte(cover.refl[compR] * n, gain),
					toByte(cover.refl[compG] * n, gain),
					toByte(cover.refl[compB] * n, gain)
				];
			} else {
				rgb = indexColor(normDiff(cover.refl[bandA] * n, cover.refl[bandB] * (2 - n)));
			}
			img.data[i * 4] = rgb[0];
			img.data[i * 4 + 1] = rgb[1];
			img.data[i * 4 + 2] = rgb[2];
			img.data[i * 4 + 3] = 255;
		}
		ctx.putImageData(img, 0, 0);
	});
</script>

<svelte:head>
	<title>{t('title')}</title>
</svelte:head>

<h1>{t('h1')}</h1>
<p class="muted">{t('lead')}</p>

<h2>{t('bandsH2')}</h2>
<div class="panel tight" style="overflow-x: auto">
	<table>
		<thead>
			<tr><th>{t('bandsThBand')}</th><th>{t('bandsThName')}</th><th class="num">{t('bandsThCenter')}</th><th class="num">{t('bandsThWidth')}</th><th class="num">{t('bandsThRes')}</th><th>{t('bandsThUse')}</th></tr>
		</thead>
		<tbody>
			{#each bands as b (b.id)}
				<tr style:opacity={(sceneBands as readonly string[]).includes(b.id) ? 1 : 0.5}>
					<td><code>{b.id}</code></td>
					<td>{b.name}</td>
					<td class="num">{b.center}</td>
					<td class="num">{b.width}</td>
					<td class="num">{b.res}</td>
					<td class="muted">{L(b.use)}</td>
				</tr>
			{/each}
		</tbody>
	</table>
	<p class="muted" style="font-size: 0.8rem">{t('bandsNote')}</p>
</div>

<h2>{t('specH2')}</h2>
<div class="panel">
	<div class="btn-row">
		{#each landCovers as c (c.id)}
			<button class="ghost" class:active={visible[c.id]} onclick={() => (visible[c.id] = !visible[c.id])}>
				<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:{c.color};margin-right:6px"></span>{L(c.name)}
			</button>
		{/each}
	</div>
	<svg viewBox="0 0 800 300" width="100%" aria-label={t('specAria')}>
		<!-- バンド帯 -->
		{#each plotBands as b (b.id)}
			<rect x={wl2x(b.center - b.width / 2)} y={Y0} width={Math.max(2, wl2x(b.center + b.width / 2) - wl2x(b.center - b.width / 2))} height={Y1 - Y0} fill="rgba(90,169,255,0.10)" />
			<text x={wl2x(b.center)} y={Y1 + (b.id === 'B8A' ? 44 : 32)} fill="#98a6cc" font-size="10" text-anchor="middle" font-family="var(--mono)">{b.id}</text>
		{/each}
		<!-- 軸 -->
		<line x1={X0} y1={Y1} x2={X1} y2={Y1} stroke="#2a3a66" />
		<line x1={X0} y1={Y0} x2={X0} y2={Y1} stroke="#2a3a66" />
		{#each [0, 0.25, 0.5, 0.75, 1] as t (t)}
			<text x={X0 - 8} y={r2y(t) + 4} fill="#98a6cc" font-size="10" text-anchor="end">{t.toFixed(2)}</text>
			<line x1={X0} y1={r2y(t)} x2={X1} y2={r2y(t)} stroke="#1c2950" stroke-dasharray="2 4" />
		{/each}
		{#each [500, 1000, 1500, 2000] as wl (wl)}
			<text x={wl2x(wl)} y={Y1 + 16} fill="#98a6cc" font-size="10" text-anchor="middle">{wl} nm</text>
		{/each}
		<!-- 曲線 -->
		{#each landCovers as c (c.id)}
			{#if visible[c.id]}
				<polyline
					points={plotBands.map((b) => `${wl2x(b.center)},${r2y(c.refl[b.id as SceneBand])}`).join(' ')}
					fill="none"
					stroke={c.color}
					stroke-width="2.2"
				/>
				{#each plotBands as b (b.id)}
					<circle cx={wl2x(b.center)} cy={r2y(c.refl[b.id as SceneBand])} r="3" fill={c.color} />
				{/each}
			{/if}
		{/each}
		<text x={X1} y={Y0 - 6} fill="#98a6cc" font-size="10" text-anchor="end">{t('specYAxis')}</text>
	</svg>
	<div class="note">
		<strong>{t('specNoteStrong')}</strong> {t('specNote')}
	</div>
</div>

<h2>{t('idxH2')}</h2>
<div class="grid cols-2">
	<div class="panel">
		<p style="font-family: var(--mono); font-size: 1.1rem; text-align: center; margin: 0.5rem 0 1rem">
			({bandA} − {bandB}) / ({bandA} + {bandB})
		</p>
		<div style="display: flex; gap: 1rem; justify-content: center; align-items: center">
			<label>A <select bind:value={bandA}>{#each sceneBands as b (b)}<option value={b}>{b}</option>{/each}</select></label>
			<label>B <select bind:value={bandB}>{#each sceneBands as b (b)}<option value={b}>{b}</option>{/each}</select></label>
		</div>
		<div class="btn-row" style="justify-content: center; margin-top: 0.8rem">
			{#each indices as ix (ix.id)}
				<button class="ghost" class:active={matchedIndex?.id === ix.id} onclick={() => { bandA = ix.a; bandB = ix.b; }}>{ix.id}</button>
			{/each}
		</div>
		{#if matchedIndex}
			<p style="margin-top: 0.8rem"><strong style="color: var(--accent-2)">{L(matchedIndex.name)}</strong><br /><span class="muted" style="font-size: 0.9rem">{L(matchedIndex.desc)}</span></p>
		{:else}
			<p class="muted" style="margin-top: 0.8rem; font-size: 0.9rem">{t('idxUnnamed')}</p>
		{/if}
	</div>
	<div class="panel tight">
		<table>
			<thead><tr><th>{t('idxThCover')}</th><th class="num">{bandA}</th><th class="num">{bandB}</th><th class="num">{t('idxThValue')}</th><th></th></tr></thead>
			<tbody>
				{#each indexValues as { c, v } (c.id)}
					<tr>
						<td><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:{c.color};margin-right:6px"></span>{L(c.name)}</td>
						<td class="num">{c.refl[bandA].toFixed(3)}</td>
						<td class="num">{c.refl[bandB].toFixed(3)}</td>
						<td class="num" style:color={v > 0.2 ? 'var(--green)' : v < -0.2 ? 'var(--red)' : 'var(--text)'}>{v >= 0 ? '+' : ''}{v.toFixed(2)}</td>
						<td style="width: 120px">
							<div style="position: relative; height: 8px; background: #0a0f1e; border-radius: 4px">
								<div style="position: absolute; left: 50%; top: -2px; width: 1px; height: 12px; background: #2a3a66"></div>
								<div style="position: absolute; top: 0; height: 8px; border-radius: 4px; background: rgb({indexColor(v).join(',')}); left: {v < 0 ? 50 + v * 50 : 50}%; width: {Math.abs(v) * 50}%"></div>
							</div>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</div>

<h2>{t('sceneH2')}</h2>
<div class="grid cols-2">
	<div class="panel">
		<canvas bind:this={canvas} width={SIZE} height={SIZE} style="width: 100%; aspect-ratio: 1"></canvas>
		<p class="muted" style="font-size: 0.8rem">{t('sceneLegend')}</p>
	</div>
	<div class="panel">
		<div class="btn-row">
			<button class="ghost" class:active={mode === 'rgb'} onclick={() => (mode = 'rgb')}>{t('sceneRgb')}</button>
			<button class="ghost" class:active={mode === 'index'} onclick={() => (mode = 'index')}>{t('sceneIndex', bandA, bandB)}</button>
		</div>
		{#if mode === 'rgb'}
			<div class="btn-row">
				{#each composites as c (c.name.ja)}
					<button class="ghost" class:active={compR === c.r && compG === c.g && compB === c.b} onclick={() => applyComposite(c)} title={L(c.desc)}>{L(c.name)}</button>
				{/each}
			</div>
			<div style="display: flex; gap: 1rem; margin: 0.6rem 0">
				<label style="color: var(--red)">R <select bind:value={compR}>{#each sceneBands as b (b)}<option value={b}>{b}</option>{/each}</select></label>
				<label style="color: var(--green)">G <select bind:value={compG}>{#each sceneBands as b (b)}<option value={b}>{b}</option>{/each}</select></label>
				<label style="color: var(--accent)">B <select bind:value={compB}>{#each sceneBands as b (b)}<option value={b}>{b}</option>{/each}</select></label>
			</div>
			<div class="control">
				<label for="gain">{t('sceneGain')}</label>
				<output>×{gain.toFixed(1)}</output>
				<input id="gain" type="range" min="1" max="8" step="0.1" bind:value={gain} />
			</div>
			{#each composites as c (c.name.ja)}
				{#if compR === c.r && compG === c.g && compB === c.b}
					<p class="muted" style="font-size: 0.9rem">{L(c.desc)}</p>
				{/if}
			{/each}
		{:else}
			<p class="muted" style="font-size: 0.9rem">{t('sceneIndexNote')}</p>
		{/if}
		<div class="note" style="margin-top: 1rem">
			<strong>{t('sceneMemoStrong')}</strong> {@html t('sceneMemo')}
		</div>
	</div>
</div>
