<script lang="ts">
	import { orbitStats, fmtDuration, presets, RE } from '$lib/orbit';

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
	<title>軌道と再訪周期 — Satellite Data Lab</title>
</svelte:head>

<h1>01 軌道と再訪周期</h1>
<p class="muted">
	「いつ、どこを、どのくらいの頻度で撮れるか」は軌道で決まります。高度と観測幅（スワス）を変えて、
	周期・再訪日数・太陽同期軌道の傾斜角がどう変わるか確認してください。
</p>

<div class="btn-row">
	{#each presets as p (p.name)}
		<button class="ghost" class:active={altitude === p.alt} onclick={() => applyPreset(p)} title={p.note}>
			{p.name}
		</button>
	{/each}
</div>

<div class="grid cols-2">
	<div class="panel">
		<div class="control">
			<label for="alt">高度</label>
			<output>{altitude.toLocaleString()} km</output>
			<input id="alt" type="range" min={Math.log10(200)} max={Math.log10(36000)} step="any" bind:value={altLog} />
		</div>
		<div class="control">
			<label for="swath">観測幅（スワス）</label>
			<output>{swath.toLocaleString()} km</output>
			<input id="swath" type="range" min="5" max="3000" step="5" bind:value={swath} />
		</div>
		<div class="control">
			<label for="sats">同一軌道面の衛星機数</label>
			<output>{satellites} 機</output>
			<input id="sats" type="range" min="1" max="12" step="1" bind:value={satellites} />
		</div>
		<canvas bind:this={canvas} width="360" height="360" style="margin: 0.8rem auto 0"></canvas>
		<p class="muted" style="font-size: 0.8rem; text-align: center">
			緑の扇形 = 観測幅。実時間の 1500 倍速。
		</p>
	</div>

	<div class="panel">
		<div class="grid cols-2">
			<div class="stat">
				<span class="label">周期</span>
				<span class="value">{fmtDuration(stats.period)}</span>
			</div>
			<div class="stat">
				<span class="label">1 日の周回数</span>
				<span class="value">{stats.orbitsPerDay.toFixed(2)}<span class="unit">周</span></span>
			</div>
			<div class="stat">
				<span class="label">軌道速度</span>
				<span class="value">{stats.velocity.toFixed(2)}<span class="unit">km/s</span></span>
			</div>
			<div class="stat">
				<span class="label">地表投影速度</span>
				<span class="value">{stats.groundSpeed.toFixed(2)}<span class="unit">km/s</span></span>
			</div>
			<div class="stat">
				<span class="label">赤道での軌跡間隔</span>
				<span class="value">{Math.round(stats.trackSpacing).toLocaleString()}<span class="unit">km</span></span>
			</div>
			<div class="stat">
				<span class="label">再訪日数（概算）</span>
				<span class="value" style:color={effectiveRevisit <= 5 ? 'var(--green)' : effectiveRevisit <= 16 ? 'var(--orange)' : 'var(--red)'}>
					{effectiveRevisit}<span class="unit">日</span>
				</span>
			</div>
			<div class="stat">
				<span class="label">太陽同期の傾斜角</span>
				<span class="value">
					{#if stats.ssoInclination !== null}
						{stats.ssoInclination.toFixed(1)}<span class="unit">°</span>
					{:else}
						<span style="color: var(--red); font-size: 1rem">実現不可</span>
					{/if}
				</span>
			</div>
			<div class="stat">
				<span class="label">地平線までの距離</span>
				<span class="value">{Math.round(stats.horizonDistance).toLocaleString()}<span class="unit">km</span></span>
			</div>
		</div>

		<h3 style="margin-top: 1.2rem">赤道 1 周（{Math.round(2 * Math.PI * RE).toLocaleString()} km）の 1 日カバー率</h3>
		<svg viewBox="0 0 1000 40" width="100%" height="40" aria-label="赤道カバー率">
			<rect x="0" y="10" width="1000" height="20" fill="#0a0f1e" stroke="#2a3a66" />
			{#each Array.from({ length: Math.min(200, Math.ceil(stats.orbitsPerDay) * satellites) }) as _, i (i)}
				{@const spacing = stats.trackSpacing / satellites}
				{@const x = ((i * spacing) / (2 * Math.PI * RE)) * 1000}
				{@const w = Math.max(1, (swath / (2 * Math.PI * RE)) * 1000)}
				<rect {x} y="10" width={Math.min(w, 1000 - x)} height="20" fill="rgba(80,250,123,0.6)" />
			{/each}
		</svg>
		<p class="muted" style="font-size: 0.85rem">
			カバー率 {(coverageFraction * 100).toFixed(0)}% → 全域を埋めるには約 {effectiveRevisit} 日。
			{#if swath >= stats.trackSpacing / satellites}
				<strong style="color: var(--green)">毎日全球をカバー</strong>（MODIS や静止衛星のパターン）。
			{/if}
		</p>
	</div>
</div>

<h2>なぜ地球観測衛星は高度 500〜800 km に集まるのか</h2>
<div class="grid cols-3">
	<div class="panel tight">
		<h3>低すぎる（&lt; 400 km）</h3>
		<p style="font-size: 0.9rem">
			大気抵抗で軌道が急速に減衰し、頻繁な軌道維持が必要。ISS（420 km）は定期的にリブーストしている。
			分解能は稼げるが、観測幅は狭くなる。
		</p>
	</div>
	<div class="panel tight">
		<h3>ちょうど良い（500〜800 km）</h3>
		<p style="font-size: 0.9rem">
			太陽同期軌道（傾斜角 ≈ 97〜99°）が組め、毎日同じ地方時に撮像できる → 影・照明条件が揃い、時系列比較がしやすい。
			10〜30 m の分解能と数百 km のスワスを両立。
		</p>
	</div>
	<div class="panel tight">
		<h3>静止軌道（35,786 km）</h3>
		<p style="font-size: 0.9rem">
			周期が 1 恒星日に一致し、地表から見て止まる。10 分ごとの全球観測（ひまわり）が可能だが、
			距離が遠いため分解能は 0.5〜2 km。高緯度は斜めからしか見えない。
		</p>
	</div>
</div>

<h2>計算の中身</h2>
<div class="panel">
	<pre><code>{`# ケプラーの第3法則: 周期は軌道半径の 3/2 乗に比例
T = 2π · sqrt(a³ / μ)             μ = 3.986e14 m³/s²,  a = R_E + h

# 1 日の周回数と、赤道上での隣接軌跡の間隔
N = 86400 / T
Δ = 2π R_E / N                    # 1 周ごとに地球が自転した分だけ軌跡が西へずれる

# 単一衛星・直下視のみでの再訪日数（概算。実際は軌道の繰り返しサイクル設計で決まる）
revisit ≈ ceil(Δ / swath)

# 太陽同期条件: J2 摂動による昇交点の歳差が 1 年で 360° になる傾斜角 i
dΩ/dt = -(3/2) · J2 · (R_E/a)² · n · cos(i) = 2π / (365.2422 日)
cos(i) = -(2π/year) / ((3/2) · J2 · (R_E/a)² · n)        # h ≈ 800 km で i ≈ 98.6°`}</code></pre>
	<div class="note">
		<strong>実務での注意：</strong> ここでの再訪日数は「直下視のみ・1 軌道面」の下限値です。
		Sentinel-2 の「5 日」は 2 機構成・290 km スワス・10 日の繰り返しサイクルから来ており、
		中緯度では軌跡の重なりで実質 2〜3 日になります。逆にポインティング可能な商用衛星（WorldView 等）は
		同じ軌道でも斜め視で「毎日撮れる」と謳いますが、入射角が変わるため時系列解析には注意が必要です。
	</div>
</div>
