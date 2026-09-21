<script lang="ts">
	import { landCovers, makeScene, noise, toByte } from '$lib/spectral';
	import { missions, type MissionType } from '$lib/missions';
	import { makeT, L } from '$lib/i18n/lang.svelte';
	import { resolution } from '$lib/i18n/resolution';

	const t = makeT(resolution);

	// ベースシーン：240 px = 2.4 km（1 px = 10 m）
	const BASE = 240;
	const BASE_GSD = 10;
	const scene = makeScene(BASE);

	let gsd = $state(10);
	let bits = $state(12);
	let gain = $state(3);
	let canvas: HTMLCanvasElement | undefined = $state();

	const block = $derived(Math.max(1, Math.round(gsd / BASE_GSD)));
	const outSize = $derived(Math.floor(BASE / block));
	const levels = $derived(2 ** bits);
	const pixelsPerKm2 = $derived((1000 / gsd) ** 2);

	// 真色（B4, B3, B2）の反射率を事前計算
	const trueColor = (() => {
		const arr = new Float32Array(BASE * BASE * 3);
		for (let i = 0; i < BASE * BASE; i++) {
			const c = landCovers[scene[i]];
			const n = 1 + (noise(i) - 0.5) * 0.16;
			arr[i * 3] = c.refl.B4 * n;
			arr[i * 3 + 1] = c.refl.B3 * n;
			arr[i * 3 + 2] = c.refl.B2 * n;
		}
		return arr;
	})();

	$effect(() => {
		if (!canvas) return;
		const ctx = canvas.getContext('2d')!;
		canvas.width = outSize;
		canvas.height = outSize;
		const img = ctx.createImageData(outSize, outSize);
		const inv = block * block;
		for (let oy = 0; oy < outSize; oy++) {
			for (let ox = 0; ox < outSize; ox++) {
				// ブロック平均（センサーの IFOV が地表を積分するのに相当）
				let r = 0, g = 0, b = 0;
				for (let dy = 0; dy < block; dy++) {
					for (let dx = 0; dx < block; dx++) {
						const i = ((oy * block + dy) * BASE + ox * block + dx) * 3;
						r += trueColor[i];
						g += trueColor[i + 1];
						b += trueColor[i + 2];
					}
				}
				r /= inv; g /= inv; b /= inv;
				// 放射分解能：反射率 0〜1 を levels 段階に量子化
				const q = (v: number) => Math.round(v * (levels - 1)) / (levels - 1);
				const o = (oy * outSize + ox) * 4;
				img.data[o] = toByte(q(r), gain);
				img.data[o + 1] = toByte(q(g), gain);
				img.data[o + 2] = toByte(q(b), gain);
				img.data[o + 3] = 255;
			}
		}
		ctx.putImageData(img, 0, 0);
	});

	// ---- GSD vs スワス 散布図 ----
	const PX0 = 70, PX1 = 760, PY0 = 20, PY1 = 250;
	const logx = (v: number) => PX0 + ((Math.log10(v) - Math.log10(0.1)) / (Math.log10(3000) - Math.log10(0.1))) * (PX1 - PX0);
	const logy = (v: number) => PY1 - ((Math.log10(v) - Math.log10(3)) / (Math.log10(20000) - Math.log10(3))) * (PY1 - PY0);
	const typeColor: Record<MissionType, string> = { optical: '#50fa7b', sar: '#ffb86c', geo: '#8be9fd' };
	const typeKey = { optical: 'typeOptical', sar: 'typeSar', geo: 'typeGeo' } as const;
</script>

<svelte:head>
	<title>{t('title')}</title>
</svelte:head>

<h1>{t('h1')}</h1>
<p class="muted">
	{@html t('lead')}
</p>

<h2>{t('demoH2')}</h2>
<div class="grid cols-2">
	<div class="panel">
		<canvas bind:this={canvas} style="width: 100%; aspect-ratio: 1"></canvas>
		<p class="muted" style="font-size: 0.8rem">{t('demoCaption')}</p>
	</div>
	<div class="panel">
		<div class="control">
			<label for="gsd">{t('gsdLabel')}</label>
			<output>{t('gsdValue', gsd)}</output>
			<input id="gsd" type="range" min="10" max="300" step="10" bind:value={gsd} />
		</div>
		<div class="control">
			<label for="bits">{t('bitsLabel')}</label>
			<output>{t('bitsValue', bits, levels.toLocaleString())}</output>
			<input id="bits" type="range" min="1" max="12" step="1" bind:value={bits} />
		</div>
		<div class="control">
			<label for="gain">{t('gainLabel')}</label>
			<output>{t('gainValue', gain.toFixed(1))}</output>
			<input id="gain" type="range" min="1" max="8" step="0.1" bind:value={gain} />
		</div>
		<div class="grid cols-2" style="margin-top: 1rem">
			<div class="stat">
				<span class="label">{t('statSize')}</span>
				<span class="value">{outSize}<span class="unit">{t('statSizeUnit', outSize)}</span></span>
			</div>
			<div class="stat">
				<span class="label">{t('statPxPerKm2')}</span>
				<span class="value">{Math.round(pixelsPerKm2).toLocaleString()}</span>
			</div>
			<div class="stat">
				<span class="label">{t('statDataVol')}</span>
				<span class="value">{(((BASE_GSD / gsd) ** 2) * 100).toFixed(1)}<span class="unit">%</span></span>
			</div>
			<div class="stat">
				<span class="label">{t('statStep')}</span>
				<span class="value">{(1 / (levels - 1)).toFixed(levels > 1000 ? 5 : 3)}</span>
			</div>
		</div>
		<div class="note" style="margin-top: 1rem">
			{@html t('demoNote')}
		</div>
	</div>
</div>

<h2>{t('swathH2')}</h2>
<div class="panel">
	<svg viewBox="0 0 800 290" width="100%" aria-label={t('swathAria')}>
		{#each [0.1, 1, 10, 100, 1000] as v (v)}
			<line x1={logx(v)} y1={PY0} x2={logx(v)} y2={PY1} stroke="#1c2950" />
			<text x={logx(v)} y={PY1 + 16} fill="#98a6cc" font-size="10" text-anchor="middle">{t('axisM', v)}</text>
		{/each}
		{#each [10, 100, 1000, 10000] as v (v)}
			<line x1={PX0} y1={logy(v)} x2={PX1} y2={logy(v)} stroke="#1c2950" />
			<text x={PX0 - 8} y={logy(v) + 4} fill="#98a6cc" font-size="10" text-anchor="end">{t('axisKm', v.toLocaleString())}</text>
		{/each}
		<text x={(PX0 + PX1) / 2} y={PY1 + 34} fill="#98a6cc" font-size="11" text-anchor="middle">{t('axisX')}</text>
		<text x={14} y={(PY0 + PY1) / 2} fill="#98a6cc" font-size="11" text-anchor="middle" transform="rotate(-90 14 {(PY0 + PY1) / 2})">{t('axisY')}</text>
		{#each missions as m (m.name.en)}
			<circle cx={logx(m.gsd)} cy={logy(m.swath)} r={m.revisit <= 1 ? 7 : m.revisit <= 6 ? 5.5 : 4} fill={typeColor[m.type]} fill-opacity="0.85" />
			<text x={logx(m.gsd) + 9} y={logy(m.swath) + 4 + (m.labelDy ?? 0)} fill="#e6ecff" font-size="10">{L(m.name)}</text>
		{/each}
	</svg>
	<p class="muted" style="font-size: 0.85rem">
		{t('legendColor')}<span style="color:#50fa7b">● {t('typeOptical')}</span> <span style="color:#ffb86c">● {t('typeSar')}</span> <span style="color:#8be9fd">● {t('typeGeo')}</span>{t('legendEnd')}
		{t('legendNote')}
	</p>
</div>

<h2>{t('tableH2')}</h2>
<div class="panel tight" style="overflow-x: auto">
	<table>
		<thead>
			<tr><th>{t('thMission')}</th><th>{t('thType')}</th><th class="num">{t('thGsd')}</th><th class="num">{t('thSwath')}</th><th class="num">{t('thRevisit')}</th><th>{t('thBands')}</th><th class="num">{t('thBits')}</th><th>{t('thAccess')}</th></tr>
		</thead>
		<tbody>
			{#each missions as m (m.name.en)}
				<tr>
					<td>{L(m.name)}</td>
					<td><span class="tag" style:border-color={typeColor[m.type]} style:color={typeColor[m.type]}>{t(typeKey[m.type])}</span></td>
					<td class="num">{m.gsd}</td>
					<td class="num">{m.swath.toLocaleString()}</td>
					<td class="num">{m.revisit < 1 ? t('revisitMin', Math.round(m.revisit * 1440)) : t('revisitDay', m.revisit)}</td>
					<td>{L(m.bands)}</td>
					<td class="num">{m.bits}</td>
					<td class="muted">{L(m.access)}</td>
				</tr>
			{/each}
		</tbody>
	</table>
</div>

<h2>{t('useH2')}</h2>
<div class="grid cols-3">
	<div class="panel tight">
		<h3>{t('useWideH3')}</h3>
		<p style="font-size: 0.9rem">{t('useWide')}</p>
	</div>
	<div class="panel tight">
		<h3>{t('useDisasterH3')}</h3>
		<p style="font-size: 0.9rem">{t('useDisaster')}</p>
	</div>
	<div class="panel tight">
		<h3>{t('useObjectH3')}</h3>
		<p style="font-size: 0.9rem">{t('useObject')}</p>
	</div>
</div>
