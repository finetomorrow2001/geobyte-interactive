import type { Bilingual } from './lang.svelte';

export const orbits = {
	ja: {
		title: '軌道と再訪周期 — Satellite Data Lab',
		h1: '01 軌道と再訪周期',
		lead: '「いつ、どこを、どのくらいの頻度で撮れるか」は軌道で決まります。高度と観測幅 (swath) を変えて、周期・再訪 (revisit) 日数・太陽同期軌道 (sun-synchronous orbit) の傾斜角がどう変わるか確認してください。',

		// 操作パネル
		altLabel: '高度',
		swathLabel: '観測幅（スワス）',
		satsLabel: '同一軌道面の衛星機数',
		satsUnit: (n: number) => `${n} 機`,
		canvasNote: '緑の扇形 = 観測幅。実時間の 1500 倍速。',

		// 統計
		statPeriod: '周期 (period)',
		statOrbitsPerDay: '1 日の周回数',
		unitOrbits: '周',
		statVelocity: '軌道速度',
		statGroundSpeed: '地表投影速度 (ground speed)',
		statTrackSpacing: '赤道での軌跡間隔',
		statRevisit: '再訪日数（概算）',
		unitDays: '日',
		statSso: '太陽同期の傾斜角',
		ssoImpossible: '実現不可',
		statHorizon: '地平線までの距離',

		// カバー率
		coverageTitle: (km: string) => `赤道 1 周（${km} km）の 1 日カバー率`,
		coverageAria: '赤道カバー率',
		coverageText: (pct: string, days: number) => `カバー率 ${pct}% → 全域を埋めるには約 ${days} 日。`,
		coverageDaily: '毎日全球をカバー',
		coverageDailyRest: '（MODIS や静止衛星のパターン）。',

		// なぜ 500〜800 km か
		whyTitle: 'なぜ地球観測衛星は高度 500〜800 km に集まるのか',
		whyLowH: '低すぎる（< 400 km）',
		whyLowP: '大気抵抗 (atmospheric drag) で軌道が急速に減衰し、頻繁な軌道維持が必要。ISS（420 km）は定期的にリブーストしている。分解能は稼げるが、観測幅は狭くなる。',
		whyGoodH: 'ちょうど良い（500〜800 km）',
		whyGoodP: '太陽同期軌道（傾斜角 ≈ 97〜99°）が組め、毎日同じ地方時 (local time) に撮像できる → 影・照明条件が揃い、時系列比較がしやすい。10〜30 m の分解能と数百 km のスワスを両立。',
		whyGeoH: '静止軌道 (GEO)（35,786 km）',
		whyGeoP: '周期が 1 恒星日 (sidereal day) に一致し、地表から見て止まる。10 分ごとの全球観測（ひまわり）が可能だが、距離が遠いため分解能は 0.5〜2 km。高緯度は斜めからしか見えない。',

		// 計算の中身
		calcTitle: '計算の中身',
		calcCode: `# ケプラーの第3法則: 周期は軌道半径の 3/2 乗に比例
T = 2π · sqrt(a³ / μ)             μ = 3.986e14 m³/s²,  a = R_E + h

# 1 日の周回数と、赤道上での隣接軌跡の間隔
N = 86400 / T
Δ = 2π R_E / N                    # 1 周ごとに地球が自転した分だけ軌跡が西へずれる

# 単一衛星・直下視のみでの再訪日数（概算。実際は軌道の繰り返しサイクル設計で決まる）
revisit ≈ ceil(Δ / swath)

# 太陽同期条件: J2 摂動による昇交点の歳差が 1 年で 360° になる傾斜角 i
dΩ/dt = -(3/2) · J2 · (R_E/a)² · n · cos(i) = 2π / (365.2422 日)
cos(i) = -(2π/year) / ((3/2) · J2 · (R_E/a)² · n)        # h ≈ 800 km で i ≈ 98.6°`,
		noteStrong: '実務での注意：',
		noteBody: ' ここでの再訪日数は「直下視 (nadir) のみ・1 軌道面」の下限値です。Sentinel-2 の「5 日」は 2 機構成・290 km スワス・10 日の繰り返しサイクル (repeat cycle) から来ており、中緯度では軌跡の重なりで実質 2〜3 日になります。逆にポインティング可能な商用衛星（WorldView 等）は同じ軌道でも斜め視で「毎日撮れる」と謳いますが、入射角が変わるため時系列解析には注意が必要です。'
	},
	en: {
		title: 'Orbits & Revisit — Satellite Data Lab',
		h1: '01 Orbits & Revisit',
		lead: 'When, where and how often you can image is set by the orbit. Change altitude and swath and watch how period, revisit time and the sun-synchronous inclination respond.',

		// Controls
		altLabel: 'Altitude',
		swathLabel: 'Swath width',
		satsLabel: 'Satellites in the same orbital plane',
		satsUnit: (n: number) => `${n} sat${n === 1 ? '' : 's'}`,
		canvasNote: 'Green sector = swath. 1500× real time.',

		// Stats
		statPeriod: 'Period',
		statOrbitsPerDay: 'Orbits per day',
		unitOrbits: 'rev',
		statVelocity: 'Orbital velocity',
		statGroundSpeed: 'Ground speed',
		statTrackSpacing: 'Track spacing at equator',
		statRevisit: 'Revisit (approx.)',
		unitDays: 'd',
		statSso: 'Sun-synchronous inclination',
		ssoImpossible: 'Not possible',
		statHorizon: 'Distance to horizon',

		// Coverage
		coverageTitle: (km: string) => `Daily coverage of the equator (${km} km)`,
		coverageAria: 'Equator coverage',
		coverageText: (pct: string, days: number) => `Coverage ${pct}% → about ${days} day${days === 1 ? '' : 's'} to fill the whole circle.`,
		coverageDaily: 'Global coverage every day',
		coverageDailyRest: ' (the MODIS / geostationary pattern).',

		// Why 500–800 km
		whyTitle: 'Why Earth-observation satellites cluster at 500–800 km',
		whyLowH: 'Too low (< 400 km)',
		whyLowP: 'Atmospheric drag decays the orbit quickly, so frequent station-keeping is needed. The ISS (420 km) re-boosts regularly. You gain resolution but lose swath.',
		whyGoodH: 'Just right (500–800 km)',
		whyGoodP: 'A sun-synchronous orbit (inclination ≈ 97–99°) is possible, so every pass images at the same local time → consistent shadows and illumination, easier time-series comparison. Combines 10–30 m resolution with swaths of several hundred km.',
		whyGeoH: 'Geostationary (35,786 km)',
		whyGeoP: 'The period matches one sidereal day, so the satellite appears fixed from the ground. Full-disk imaging every 10 minutes (Himawari) is possible, but the distance limits resolution to 0.5–2 km, and high latitudes are only seen obliquely.',

		// Under the hood
		calcTitle: 'Under the hood',
		calcCode: `# Kepler's third law: period scales with the 3/2 power of the orbital radius
T = 2π · sqrt(a³ / μ)             μ = 3.986e14 m³/s²,  a = R_E + h

# Orbits per day and spacing between adjacent ground tracks at the equator
N = 86400 / T
Δ = 2π R_E / N                    # each orbit the track shifts west by the Earth's rotation

# Revisit for a single satellite, nadir only (approx.; real missions are set by the repeat-cycle design)
revisit ≈ ceil(Δ / swath)

# Sun-synchronous condition: inclination i where J2 nodal precession is 360° per year
dΩ/dt = -(3/2) · J2 · (R_E/a)² · n · cos(i) = 2π / (365.2422 days)
cos(i) = -(2π/year) / ((3/2) · J2 · (R_E/a)² · n)        # h ≈ 800 km gives i ≈ 98.6°`,
		noteStrong: 'In practice:',
		noteBody: ' the revisit shown here is a lower bound for nadir-only imaging from a single orbital plane. Sentinel-2’s “5 days” comes from two satellites, a 290 km swath and a 10-day repeat cycle; at mid-latitudes overlapping tracks bring it down to 2–3 days in practice. Conversely, pointable commercial satellites (WorldView etc.) advertise “daily” imaging from the same kind of orbit by looking off-nadir, but the changing incidence angle needs care in time-series analysis.'
	}
} satisfies Bilingual;
