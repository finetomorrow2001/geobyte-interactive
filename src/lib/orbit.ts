import { i18n, type LText } from './i18n/lang.svelte';

/** 地球重力定数 [m^3/s^2] */
export const MU = 3.986004418e14;
/** 地球赤道半径 [km] */
export const RE = 6378.137;
/** J2 帯状調和係数（扁平による摂動） */
export const J2 = 1.08262668e-3;
/** 太陽日 [s] */
export const DAY = 86400;
/** 恒星日 [s] */
export const SIDEREAL_DAY = 86164.0905;
/** 1 年 [s] */
export const YEAR = 365.2422 * DAY;

export type OrbitStats = {
	/** 軌道半径 [km] */
	a: number;
	/** 周期 [s] */
	period: number;
	/** 1 日あたりの周回数 */
	orbitsPerDay: number;
	/** 軌道速度 [km/s] */
	velocity: number;
	/** 地表投影速度 [km/s] */
	groundSpeed: number;
	/** 赤道上での隣接軌道の地上軌跡間隔 [km] */
	trackSpacing: number;
	/** 単一衛星・直下視のみでの再訪日数（概算） */
	revisitDays: number;
	/** 太陽同期軌道になる傾斜角 [deg]。実現不可なら null */
	ssoInclination: number | null;
	/** 直下から見える地平線までの距離 = 最大観測幅の半分 [km] */
	horizonDistance: number;
};

export function orbitStats(altitudeKm: number, swathKm: number): OrbitStats {
	const a = RE + altitudeKm;
	const aM = a * 1000;
	const period = 2 * Math.PI * Math.sqrt(aM ** 3 / MU);
	const orbitsPerDay = DAY / period;
	const velocity = Math.sqrt(MU / aM) / 1000;
	const groundSpeed = velocity * (RE / a);
	const trackSpacing = (2 * Math.PI * RE) / orbitsPerDay;
	const revisitDays = Math.max(1, Math.ceil(trackSpacing / swathKm));

	// 太陽同期条件: 昇交点の歳差速度 = 2π / 1年
	// dΩ/dt = -(3/2) J2 (RE/a)^2 n cos(i)
	const n = (2 * Math.PI) / period;
	const cosI = -(2 * Math.PI / YEAR) / (1.5 * J2 * (RE / a) ** 2 * n);
	const ssoInclination = Math.abs(cosI) <= 1 ? (Math.acos(cosI) * 180) / Math.PI : null;

	const horizonDistance = RE * Math.acos(RE / a);

	return {
		a,
		period,
		orbitsPerDay,
		velocity,
		groundSpeed,
		trackSpacing,
		revisitDays,
		ssoInclination,
		horizonDistance
	};
}

/** 周期を現在の言語で整形（3 時間未満は「分 秒」、それ以上は「時間」） */
export function fmtDuration(sec: number): string {
	const ja = i18n.lang === 'ja';
	if (sec < 3600 * 3) {
		const m = Math.floor(sec / 60);
		const s = String(Math.round(sec - m * 60)).padStart(2, '0');
		return ja ? `${m} 分 ${s} 秒` : `${m} min ${s} s`;
	}
	const h = sec / 3600;
	return ja ? `${h.toFixed(2)} 時間` : `${h.toFixed(2)} h`;
}

export type Preset = {
	name: LText;
	alt: number;
	swath: number;
	note: LText;
};

export const presets: Preset[] = [
	{
		name: { ja: 'ISS', en: 'ISS' },
		alt: 420,
		swath: 100,
		note: { ja: '有人・斜め軌道（傾斜角 51.6°）', en: 'Crewed, inclined orbit (51.6°)' }
	},
	{
		name: { ja: 'PlanetScope', en: 'PlanetScope' },
		alt: 475,
		swath: 25,
		note: { ja: '数百機のコンステレーションで毎日撮像', en: 'Daily imaging from a constellation of hundreds' }
	},
	{
		name: { ja: 'Sentinel-1', en: 'Sentinel-1' },
		alt: 693,
		swath: 250,
		note: { ja: 'C バンド SAR、IW モード', en: 'C-band SAR, IW mode' }
	},
	{
		name: { ja: 'Landsat 8/9', en: 'Landsat 8/9' },
		alt: 705,
		swath: 185,
		note: { ja: '2 機で 8 日再訪', en: '8-day revisit with two satellites' }
	},
	{
		name: { ja: 'Sentinel-2', en: 'Sentinel-2' },
		alt: 786,
		swath: 290,
		note: { ja: '2 機で赤道 5 日再訪', en: '5-day revisit at the equator with two satellites' }
	},
	{
		name: { ja: 'MODIS (Terra)', en: 'MODIS (Terra)' },
		alt: 705,
		swath: 2330,
		note: { ja: '広域を毎日、低分解能', en: 'Wide area daily, low resolution' }
	},
	{
		name: { ja: 'ひまわり (GEO)', en: 'Himawari (GEO)' },
		alt: 35786,
		swath: 12000,
		note: { ja: '静止軌道、常時観測', en: 'Geostationary, continuous observation' }
	}
];
