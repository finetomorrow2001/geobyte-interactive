<script lang="ts">
	import { orbitStats, fmtDuration, presets, RE } from '$lib/orbit';
	import { makeT, L } from '$lib/i18n/lang.svelte';
	import { orbits } from '$lib/i18n/orbits';

	const t = makeT(orbits);

	// 高度スライダーは対数スケール（200 km 〜 36,000 km を均等に扱うため）
	let altLog = $state(Math.log10(786));
	let swath = $state(290);
	let satellites = $state(1);

	const altitude = $derived(Math.round(10 ** altLog));
	const stats = $derived(orbitStats(altitude, swath));
	const effectiveRevisit = $derived(Math.max(1, Math.ceil(stats.trackSpacing / swath / satellites)));
	const coverageFraction = $derived(Math.min(1, (swath * satellites) / stats.trackSpacing));

	function applyPreset(p: (typeof presets)[number]) {
		altLog = Math.log10(p.alt);
		swath = Math.min(p.swath, 3000);
	}

	// ---- 軌道アニメーション ----
	let canvas: HTMLCanvasElement | undefined = $state();
	let angle = 0;
	let last = 0;

	$effect(() => {
		if (!canvas) return;
		const ctx = canvas.getContext('2d')!;
		let raf = 0;
		const draw = (t: number) => {
			const dt = last ? (t - last) / 1000 : 0;
			last = t;
			// 実時間の 1500 倍速。LEO で 1 周 4 秒程度
			angle += ((2 * Math.PI) / stats.period) * dt * 1500;

			const W = canvas!.width;
			const H = canvas!.height;
			const cx = W / 2;
			const cy = H / 2;
			const scale = (Math.min(W, H) / 2 - 16) / stats.a;
			const rE = RE * scale;
			const rO = stats.a * scale;

			ctx.clearRect(0, 0, W, H);

			// 観測幅（地心から見た半角）
			const halfAng = swath / 2 / RE;
			ctx.beginPath();
			ctx.moveTo(cx + rO * Math.cos(angle), cy + rO * Math.sin(angle));
			ctx.arc(cx, cy, rE, angle - halfAng, angle + halfAng);
			ctx.closePath();
			ctx.fillStyle = 'rgba(80, 250, 123, 0.25)';
			ctx.fill();

			// 地球
			ctx.beginPath();
			ctx.arc(cx, cy, rE, 0, Math.PI * 2);
			ctx.fillStyle = '#1f4fa0';
			ctx.fill();
			ctx.strokeStyle = '#8be9fd';
			ctx.lineWidth = 1;
			ctx.stroke();

			// 軌道
			ctx.beginPath();
			ctx.arc(cx, cy, rO, 0, Math.PI * 2);
			ctx.strokeStyle = 'rgba(152,166,204,0.6)';
			ctx.setLineDash([4, 4]);
			ctx.stroke();
			ctx.setLineDash([]);

			// 衛星
			const sx = cx + rO * Math.cos(angle);
			const sy = cy + rO * Math.sin(angle);
			ctx.beginPath();
			ctx.arc(sx, sy, 5, 0, Math.PI * 2);
			ctx.fillStyle = '#ffb86c';
			ctx.fill();

			raf = requestAnimationFrame(draw);
		};
		raf = requestAnimationFrame(draw);
		return () => cancelAnimationFrame(raf);
	});
</script>

<svelte:head>
	<title>{t('title')}</title>
</svelte:head>

<h1>{t('h1')}</h1>
<p class="muted">{t('lead')}</p>

<div class="btn-row">
	{#each presets as p (p.name.en)}
		<button class="ghost" class:active={altitude === p.alt} onclick={() => applyPreset(p)} title={L(p.note)}>
			{L(p.name)}
		</button>
	{/each}
</div>

<div class="grid cols-2">
	<div class="panel">
		<div class="control">
			<label for="alt">{t('altLabel')}</label>
			<output>{altitude.toLocaleString()} km</output>
			<input id="alt" type="range" min={Math.log10(200)} max={Math.log10(36000)} step="any" bind:value={altLog} />
		</div>
		<div class="control">
			<label for="swath">{t('swathLabel')}</label>
			<output>{swath.toLocaleString()} km</output>
			<input id="swath" type="range" min="5" max="3000" step="5" bind:value={swath} />
		</div>
		<div class="control">
			<label for="sats">{t('satsLabel')}</label>
			<output>{t('satsUnit', satellites)}</output>
			<input id="sats" type="range" min="1" max="12" step="1" bind:value={satellites} />
		</div>
		<canvas bind:this={canvas} width="360" height="360" style="margin: 0.8rem auto 0"></canvas>
		<p class="muted" style="font-size: 0.8rem; text-align: center">{t('canvasNote')}</p>
	</div>

	<div class="panel">
		<div class="grid cols-2">
			<div class="stat">
				<span class="label">{t('statPeriod')}</span>
				<span class="value">{fmtDuration(stats.period)}</span>
			</div>
			<div class="stat">
				<span class="label">{t('statOrbitsPerDay')}</span>
				<span class="value">{stats.orbitsPerDay.toFixed(2)}<span class="unit">{t('unitOrbits')}</span></span>
			</div>
			<div class="stat">
				<span class="label">{t('statVelocity')}</span>
				<span class="value">{stats.velocity.toFixed(2)}<span class="unit">km/s</span></span>
			</div>
			<div class="stat">
				<span class="label">{t('statGroundSpeed')}</span>
				<span class="value">{stats.groundSpeed.toFixed(2)}<span class="unit">km/s</span></span>
			</div>
			<div class="stat">
				<span class="label">{t('statTrackSpacing')}</span>
				<span class="value">{Math.round(stats.trackSpacing).toLocaleString()}<span class="unit">km</span></span>
			</div>
			<div class="stat">
				<span class="label">{t('statRevisit')}</span>
				<span class="value" style:color={effectiveRevisit <= 5 ? 'var(--green)' : effectiveRevisit <= 16 ? 'var(--orange)' : 'var(--red)'}>
					{effectiveRevisit}<span class="unit">{t('unitDays')}</span>
				</span>
			</div>
			<div class="stat">
				<span class="label">{t('statSso')}</span>
				<span class="value">
					{#if stats.ssoInclination !== null}
						{stats.ssoInclination.toFixed(1)}<span class="unit">°</span>
					{:else}
						<span style="color: var(--red); font-size: 1rem">{t('ssoImpossible')}</span>
					{/if}
				</span>
			</div>
			<div class="stat">
				<span class="label">{t('statHorizon')}</span>
				<span class="value">{Math.round(stats.horizonDistance).toLocaleString()}<span class="unit">km</span></span>
			</div>
		</div>

		<h3 style="margin-top: 1.2rem">{t('coverageTitle', Math.round(2 * Math.PI * RE).toLocaleString())}</h3>
		<svg viewBox="0 0 1000 40" width="100%" height="40" aria-label={t('coverageAria')}>
			<rect x="0" y="10" width="1000" height="20" fill="#0a0f1e" stroke="#2a3a66" />
			{#each Array.from({ length: Math.min(200, Math.ceil(stats.orbitsPerDay) * satellites) }) as _, i (i)}
				{@const spacing = stats.trackSpacing / satellites}
				{@const x = ((i * spacing) / (2 * Math.PI * RE)) * 1000}
				{@const w = Math.max(1, (swath / (2 * Math.PI * RE)) * 1000)}
				<rect {x} y="10" width={Math.min(w, 1000 - x)} height="20" fill="rgba(80,250,123,0.6)" />
			{/each}
		</svg>
		<p class="muted" style="font-size: 0.85rem">
			{t('coverageText', (coverageFraction * 100).toFixed(0), effectiveRevisit)}
			{#if swath >= stats.trackSpacing / satellites}
				<strong style="color: var(--green)">{t('coverageDaily')}</strong>{t('coverageDailyRest')}
			{/if}
		</p>
	</div>
</div>

<h2>{t('whyTitle')}</h2>
<div class="grid cols-3">
	<div class="panel tight">
		<h3>{t('whyLowH')}</h3>
		<p style="font-size: 0.9rem">{t('whyLowP')}</p>
	</div>
	<div class="panel tight">
		<h3>{t('whyGoodH')}</h3>
		<p style="font-size: 0.9rem">{t('whyGoodP')}</p>
	</div>
	<div class="panel tight">
		<h3>{t('whyGeoH')}</h3>
		<p style="font-size: 0.9rem">{t('whyGeoP')}</p>
	</div>
</div>

<h2>{t('calcTitle')}</h2>
<div class="panel">
	<pre><code>{t('calcCode')}</code></pre>
	<div class="note">
		<strong>{t('noteStrong')}</strong>{t('noteBody')}
	</div>
</div>
