<script lang="ts">
	/**
	 * 地図の向きに追従するコンパス。クリックで北を上に戻す。
	 * 撮影時の太陽方位（☀）と衛星の進行方向（▲）も同じ盤面に重ねる。
	 */
	import { makeT } from '$lib/i18n/lang.svelte';
	import { imagery as dict } from '$lib/i18n/imagery';

	const t = makeT(dict);
	let {
		bearing = 0,
		pitch = 0,
		sunAzimuth = null,
		sunElevation = null,
		trackHeading = null,
		onreset
	}: {
		bearing?: number;
		pitch?: number;
		sunAzimuth?: number | null;
		sunElevation?: number | null;
		trackHeading?: number | null;
		onreset?: () => void;
	} = $props();

	const R = 44;
	const pol = (deg: number, r: number): [number, number] => {
		const a = ((deg - 90) * Math.PI) / 180;
		return [50 + r * Math.cos(a), 50 + r * Math.sin(a)];
	};
	const ticks = Array.from({ length: 24 }, (_, i) => i * 15);
	const sunPt = $derived(sunAzimuth === null ? null : pol(sunAzimuth, 33));
	const fmtDeg = (d: number) => `${Math.round(((d % 360) + 360) % 360)}°`;
	const title = $derived(
		[
			t('compassBearing', fmtDeg(bearing)),
			pitch > 0.5 ? t('compassPitch', Math.round(pitch)) : null,
			sunAzimuth !== null ? `${t('compassSun', fmtDeg(sunAzimuth))}${sunElevation !== null ? t('compassSunEl', Math.round(sunElevation)) : ''}` : null,
			trackHeading !== null ? t('compassTrack', fmtDeg(trackHeading)) : null
		]
			.filter(Boolean)
			.join('\n')
	);
</script>

<button class="compass" onclick={onreset} {title} aria-label={t('compassAria')}>
	<svg viewBox="0 0 100 100" width="92" height="92">
		<circle cx="50" cy="50" r="48" class="face" />
		<g style:transform="rotate({-bearing}deg)" style:transform-origin="50px 50px">
			{#each ticks as t (t)}
				{@const [x1, y1] = pol(t, R)}
				{@const [x2, y2] = pol(t, t % 90 === 0 ? R - 7 : R - 3)}
				<line {x1} {y1} {x2} {y2} class:major={t % 90 === 0} />
			{/each}
			<!-- 方位文字。N は赤 -->
			<text x="50" y="21" class="n">N</text>
			<text x="82" y="53.5">E</text>
			<text x="50" y="86">S</text>
			<text x="18" y="53.5">W</text>
			<!-- 衛星の進行方向 -->
			{#if trackHeading !== null}
				<g style:transform="rotate({trackHeading}deg)" style:transform-origin="50px 50px">
					<line x1="50" y1="50" x2="50" y2="18" class="track" />
					<path d="M50 12 L46 20 L54 20 Z" class="track-head" />
				</g>
			{/if}
			<!-- 太陽方位 -->
			{#if sunPt}
				<line x1="50" y1="50" x2={sunPt[0]} y2={sunPt[1]} class="sun-line" />
				<circle cx={sunPt[0]} cy={sunPt[1]} r="4.5" class="sun" />
			{/if}
			<circle cx="50" cy="50" r="2" class="hub" />
		</g>
		{#if pitch > 0.5}
			<text x="50" y="62" class="pitch">{Math.round(pitch)}°</text>
		{/if}
	</svg>
</button>

<style>
	.compass {
		padding: 0;
		background: none;
		border: none;
		cursor: pointer;
		line-height: 0;
		filter: drop-shadow(0 2px 6px rgba(0, 0, 0, 0.5));
	}
	.compass:hover .face {
		fill: rgba(28, 41, 80, 0.92);
	}
	.face {
		fill: rgba(11, 16, 32, 0.88);
		stroke: var(--border);
		stroke-width: 1.5;
		transition: fill 0.15s;
	}
	line {
		stroke: #3d508a;
		stroke-width: 1;
	}
	line.major {
		stroke: var(--muted);
		stroke-width: 1.5;
	}
	text {
		fill: var(--muted);
		font-size: 11px;
		font-weight: 600;
		text-anchor: middle;
		font-family: var(--mono);
	}
	text.n {
		fill: var(--red);
		font-size: 13px;
	}
	text.pitch {
		font-size: 9px;
		fill: var(--accent-2);
		font-weight: 400;
	}
	.track {
		stroke: var(--green);
		stroke-width: 2;
		stroke-dasharray: 3 2;
	}
	.track-head {
		fill: var(--green);
	}
	.sun-line {
		stroke: #f1fa8c;
		stroke-width: 1.2;
		opacity: 0.6;
	}
	.sun {
		fill: #f1fa8c;
		stroke: #b8a800;
		stroke-width: 1;
	}
	.hub {
		fill: var(--text);
	}
</style>
