<script lang="ts">
	import { landCovers, makeScene, noise, toByte } from '$lib/spectral';
	import { missions } from '$lib/missions';

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
	const typeColor: Record<string, string> = { 光学: '#50fa7b', SAR: '#ffb86c', 静止: '#8be9fd' };
</script>

<svelte:head>
	<title>分解能のトレードオフ — Satellite Data Lab</title>
</svelte:head>

<h1>03 分解能のトレードオフ</h1>
<p class="muted">
	「分解能」は 1 つではありません。<strong>空間</strong>（何 m を 1 画素で見るか）、<strong>時間</strong>（何日ごとに撮れるか）、
	<strong>スペクトル</strong>（何バンドをどの幅で）、<strong>放射</strong>（明るさを何段階で）。
	どれかを上げると別のどれかが下がります。データ量と物理（光子の数）が制約だからです。
</p>

<h2>空間分解能 × 放射分解能を体感する</h2>
<div class="grid cols-2">
	<div class="panel">
		<canvas bind:this={canvas} style="width: 100%; aspect-ratio: 1"></canvas>
		<p class="muted" style="font-size: 0.8rem">2.4 km × 2.4 km の合成シーン（トゥルーカラー）。</p>
	</div>
	<div class="panel">
		<div class="control">
			<label for="gsd">空間分解能 GSD</label>
			<output>{gsd} m</output>
			<input id="gsd" type="range" min="10" max="300" step="10" bind:value={gsd} />
		</div>
		<div class="control">
			<label for="bits">放射分解能（ビット深度）</label>
			<output>{bits} bit = {levels.toLocaleString()} 段階</output>
			<input id="bits" type="range" min="1" max="12" step="1" bind:value={bits} />
		</div>
		<div class="control">
			<label for="gain">表示ゲイン</label>
			<output>×{gain.toFixed(1)}</output>
			<input id="gain" type="range" min="1" max="8" step="0.1" bind:value={gain} />
		</div>
		<div class="grid cols-2" style="margin-top: 1rem">
			<div class="stat">
				<span class="label">画像サイズ</span>
				<span class="value">{outSize}<span class="unit">× {outSize} px</span></span>
			</div>
			<div class="stat">
				<span class="label">1 km² あたり画素数</span>
				<span class="value">{Math.round(pixelsPerKm2).toLocaleString()}</span>
			</div>
			<div class="stat">
				<span class="label">10 m 比のデータ量</span>
				<span class="value">{(((BASE_GSD / gsd) ** 2) * 100).toFixed(1)}<span class="unit">%</span></span>
			</div>
			<div class="stat">
				<span class="label">反射率の刻み</span>
				<span class="value">{(1 / (levels - 1)).toFixed(levels > 1000 ? 5 : 3)}</span>
			</div>
		</div>
		<div class="note" style="margin-top: 1rem">
			<strong>観察ポイント：</strong> GSD を 30 m（Landsat）にすると川がまだ見えるが、100 m を超えると畝のパターンが溶ける。
			ビット深度を 4〜5 bit まで落とすと、水域や暗い植生が階調飛び（バンディング）を起こす。
			多くの光学衛星が 12 bit なのは、暗い水面と明るい雪を 1 枚で飽和なく収めるため。
		</div>
	</div>
</div>

<h2>GSD とスワスは反比例する</h2>
<div class="panel">
	<svg viewBox="0 0 800 290" width="100%" aria-label="GSD vs スワス">
		{#each [0.1, 1, 10, 100, 1000] as v (v)}
			<line x1={logx(v)} y1={PY0} x2={logx(v)} y2={PY1} stroke="#1c2950" />
			<text x={logx(v)} y={PY1 + 16} fill="#98a6cc" font-size="10" text-anchor="middle">{v} m</text>
		{/each}
		{#each [10, 100, 1000, 10000] as v (v)}
			<line x1={PX0} y1={logy(v)} x2={PX1} y2={logy(v)} stroke="#1c2950" />
			<text x={PX0 - 8} y={logy(v) + 4} fill="#98a6cc" font-size="10" text-anchor="end">{v.toLocaleString()} km</text>
		{/each}
		<text x={(PX0 + PX1) / 2} y={PY1 + 34} fill="#98a6cc" font-size="11" text-anchor="middle">空間分解能 GSD（対数）</text>
		<text x={14} y={(PY0 + PY1) / 2} fill="#98a6cc" font-size="11" text-anchor="middle" transform="rotate(-90 14 {(PY0 + PY1) / 2})">観測幅（対数）</text>
		{#each missions as m (m.name)}
			<circle cx={logx(m.gsd)} cy={logy(m.swath)} r={m.revisit <= 1 ? 7 : m.revisit <= 6 ? 5.5 : 4} fill={typeColor[m.type]} fill-opacity="0.85" />
			<text x={logx(m.gsd) + 9} y={logy(m.swath) + 4 + (m.labelDy ?? 0)} fill="#e6ecff" font-size="10">{m.name}</text>
		{/each}
	</svg>
	<p class="muted" style="font-size: 0.85rem">
		色：<span style="color:#50fa7b">● 光学</span> <span style="color:#ffb86c">● SAR</span> <span style="color:#8be9fd">● 静止</span>。
		点の大きさは再訪頻度（大きい = 毎日）。右上（広くて粗い）から左下（狭くて細かい）に並ぶのが分かります。
		左下の高分解能衛星は「毎日」再訪を謳いますが、それはポインティングして狭い範囲を撮る前提です。
	</p>
</div>

<h2>主要ミッション比較</h2>
<div class="panel tight" style="overflow-x: auto">
	<table>
		<thead>
			<tr><th>ミッション</th><th>種別</th><th class="num">GSD [m]</th><th class="num">スワス [km]</th><th class="num">再訪</th><th>バンド</th><th class="num">bit</th><th>入手</th></tr>
		</thead>
		<tbody>
			{#each missions as m (m.name)}
				<tr>
					<td>{m.name}</td>
					<td><span class="tag" style:border-color={typeColor[m.type]} style:color={typeColor[m.type]}>{m.type}</span></td>
					<td class="num">{m.gsd}</td>
					<td class="num">{m.swath.toLocaleString()}</td>
					<td class="num">{m.revisit < 1 ? `${Math.round(m.revisit * 1440)} 分` : `${m.revisit} 日`}</td>
					<td>{m.bands}</td>
					<td class="num">{m.bits}</td>
					<td class="muted">{m.access}</td>
				</tr>
			{/each}
		</tbody>
	</table>
</div>

<h2>実務での選び方</h2>
<div class="grid cols-3">
	<div class="panel tight">
		<h3>広域モニタリング</h3>
		<p style="font-size: 0.9rem">森林・農地・水域の変化を国〜大陸規模で追うなら Sentinel-2 / Landsat。無償で長期アーカイブ（Landsat は 1972 年から）があり、時系列解析に向く。</p>
	</div>
	<div class="panel tight">
		<h3>災害・即応</h3>
		<p style="font-size: 0.9rem">雲や夜間を問わない SAR（Sentinel-1、ALOS-2、ICEYE）。洪水域抽出や地盤変動（InSAR）に強い。ただし解釈は光学より難しい。</p>
	</div>
	<div class="panel tight">
		<h3>個別物体・インフラ</h3>
		<p style="font-size: 0.9rem">車両・建物単位なら 0.3〜0.5 m の商用衛星。高価で範囲が狭いため、無償データで「どこを」絞ってから注文するのが定石。</p>
	</div>
</div>
