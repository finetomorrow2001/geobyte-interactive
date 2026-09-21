/**
 * Sentinel-2 の実軌道（TLE）を SGP4 で伝播し、地上軌跡・現在位置・次回パスを求める。
 * TLE は CelesTrak から取得（CORS 可）。取得できないときは同梱スナップショットを使う。
 */
import { twoline2satrec, propagate, gstime, eciToGeodetic, degreesLat, degreesLong, type SatRec } from 'satellite.js';

export type SatId = 'sentinel-2a' | 'sentinel-2b' | 'sentinel-2c';

export const SATS: { id: SatId; name: string; norad: number; color: string; launched: string }[] = [
	{ id: 'sentinel-2a', name: 'Sentinel-2A', norad: 40697, color: '#8be9fd', launched: '2015-06' },
	{ id: 'sentinel-2b', name: 'Sentinel-2B', norad: 42063, color: '#50fa7b', launched: '2017-03' },
	{ id: 'sentinel-2c', name: 'Sentinel-2C', norad: 60989, color: '#ffb86c', launched: '2024-09' }
];

/** MSI の観測幅 [km]（直下から片側） */
export const HALF_SWATH_KM = 145;
export const RE_KM = 6371.0088;

/** CelesTrak が落ちているとき用のスナップショット（取得日 2026-09-20） */
const BUNDLED: Record<SatId, [string, string]> = {
	'sentinel-2a': [
		'1 40697U 15028A   26263.59927622  .00000189  00000+0  88691-4 0  9996',
		'2 40697  98.5664 337.0618 0001130  82.3351 277.7960 14.30817414587372'
	],
	'sentinel-2b': [
		'1 42063U 17013A   26263.59211295  .00000276  00000+0  12211-3 0  9994',
		'2 42063  98.5709 336.9934 0001197  85.8635 274.2685 14.30816269498280'
	],
	'sentinel-2c': [
		'1 60989U 24157A   26263.48723347  .00000039  00000+0  31511-4 0  9994',
		'2 60989  98.5719 336.8948 0001363  85.4822 274.6516 14.30814517106615'
	]
};

export type Tle = { id: SatId; line1: string; line2: string; epoch: Date; rec: SatRec };
export type TleSet = { tles: Tle[]; source: 'celestrak' | 'bundled' | 'cache'; fetchedAt: Date };

/** TLE の epoch（YYDDD.DDDD）を Date に */
function tleEpoch(line1: string): Date {
	const yy = Number(line1.slice(18, 20));
	const doy = Number(line1.slice(20, 32));
	const year = yy < 57 ? 2000 + yy : 1900 + yy;
	return new Date(Date.UTC(year, 0, 1) + (doy - 1) * 86400000);
}

function build(id: SatId, line1: string, line2: string): Tle {
	return { id, line1, line2, epoch: tleEpoch(line1), rec: twoline2satrec(line1, line2) };
}

const CACHE_KEY = 's2-tle-v1';
const CACHE_TTL = 6 * 3600 * 1000; // CelesTrak は同じデータを 2 時間以内に再取得しないことを求めている

export async function loadTles(): Promise<TleSet> {
	// 1. localStorage キャッシュ
	try {
		const raw = localStorage.getItem(CACHE_KEY);
		if (raw) {
			const c = JSON.parse(raw) as { at: number; lines: Record<SatId, [string, string]> };
			if (Date.now() - c.at < CACHE_TTL) {
				return { tles: SATS.map((s) => build(s.id, ...c.lines[s.id])), source: 'cache', fetchedAt: new Date(c.at) };
			}
		}
	} catch {
		/* ignore */
	}
	// 2. CelesTrak（名前検索で 3 機まとめて）
	try {
		const res = await fetch('https://celestrak.org/NORAD/elements/gp.php?NAME=SENTINEL-2&FORMAT=tle', { signal: AbortSignal.timeout(8000) });
		if (!res.ok) throw new Error(`CelesTrak ${res.status}`);
		const lines = (await res.text()).split('\n').map((l) => l.trimEnd()).filter(Boolean);
		const found: Partial<Record<SatId, [string, string]>> = {};
		for (let i = 0; i + 2 < lines.length; i += 3) {
			const norad = Number(lines[i + 1].slice(2, 7));
			const s = SATS.find((x) => x.norad === norad);
			if (s) found[s.id] = [lines[i + 1], lines[i + 2]];
		}
		if (SATS.every((s) => found[s.id])) {
			const at = Date.now();
			try {
				localStorage.setItem(CACHE_KEY, JSON.stringify({ at, lines: found }));
			} catch {
				/* ignore */
			}
			return { tles: SATS.map((s) => build(s.id, ...found[s.id]!)), source: 'celestrak', fetchedAt: new Date(at) };
		}
		throw new Error('TLE が揃わない');
	} catch {
		// 3. 同梱
		return { tles: SATS.map((s) => build(s.id, ...BUNDLED[s.id])), source: 'bundled', fetchedAt: tleEpoch(BUNDLED['sentinel-2a'][0]) };
	}
}

export type SubPoint = { t: number; lat: number; lon: number; alt: number };

/** 衛星直下点（経緯度・高度 km） */
export function subPoint(tle: Tle, date: Date): SubPoint | null {
	const pv = propagate(tle.rec, date);
	if (!pv) return null;
	const g = eciToGeodetic(pv.position, gstime(date));
	return { t: date.getTime(), lat: degreesLat(g.latitude), lon: degreesLong(g.longitude), alt: g.height };
}

/** from から minutes 分の直下点列（stepSec 刻み） */
export function groundTrack(tle: Tle, from: Date, minutes: number, stepSec = 30): SubPoint[] {
	const pts: SubPoint[] = [];
	const n = Math.ceil((minutes * 60) / stepSec);
	for (let i = 0; i <= n; i++) {
		const p = subPoint(tle, new Date(from.getTime() + i * stepSec * 1000));
		if (p) pts.push(p);
	}
	return pts;
}

/** 経度 ±180° をまたぐ所で分割し、GeoJSON MultiLineString 用の座標列にする */
export function splitAntimeridian(pts: SubPoint[]): [number, number][][] {
	const segs: [number, number][][] = [];
	let cur: [number, number][] = [];
	for (let i = 0; i < pts.length; i++) {
		if (i > 0 && Math.abs(pts[i].lon - pts[i - 1].lon) > 180) {
			segs.push(cur);
			cur = [];
		}
		cur.push([pts[i].lon, pts[i].lat]);
	}
	if (cur.length > 1) segs.push(cur);
	return segs.filter((s) => s.length > 1);
}

// ---- 球面幾何 ----
const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

/** 2 点間の大圏距離 [km] */
export function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
	const φ1 = lat1 * D2R, φ2 = lat2 * D2R, dλ = (lon2 - lon1) * D2R;
	const a = Math.sin((φ2 - φ1) / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2;
	return 2 * RE_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** 1 → 2 の初期方位角 [deg, 0..360] */
export function bearingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
	const φ1 = lat1 * D2R, φ2 = lat2 * D2R, dλ = (lon2 - lon1) * D2R;
	const y = Math.sin(dλ) * Math.cos(φ2);
	const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(dλ);
	return ((Math.atan2(y, x) * R2D) % 360 + 360) % 360;
}

/** 始点から方位 brg に距離 d [km] 進んだ点 */
export function destination(lat: number, lon: number, brg: number, dKm: number): [number, number] {
	const φ1 = lat * D2R, λ1 = lon * D2R, θ = brg * D2R, δ = dKm / RE_KM;
	const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
	const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));
	return [(((λ2 * R2D + 540) % 360) - 180), φ2 * R2D];
}

/** 直下点列の両側 ±half km を結んだ観測幅ポリゴン（経度分割なしの短い区間向け） */
export function swathPolygon(pts: SubPoint[], halfKm = HALF_SWATH_KM): [number, number][] {
	if (pts.length < 2) return [];
	const left: [number, number][] = [];
	const right: [number, number][] = [];
	for (let i = 0; i < pts.length; i++) {
		const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
		const h = bearingDeg(a.lat, a.lon, b.lat, b.lon);
		left.push(destination(pts[i].lat, pts[i].lon, h - 90, halfKm));
		right.push(destination(pts[i].lat, pts[i].lon, h + 90, halfKm));
	}
	return [...left, ...right.reverse(), left[0]];
}

// ---- パス予測 ----
export type Pass = {
	sat: SatId;
	/** 最接近（直下点列が目標の真横を通る）時刻 */
	time: Date;
	/** 目標の横方向オフセット [km]。正 = 目標が進行方向右側（下降軌道では概ね西側） */
	crossTrackKm: number;
	/** 進行方向 [deg] */
	heading: number;
	descending: boolean;
	/** 目標地点での太陽高度・方位 [deg] */
	sunElevation: number;
	sunAzimuth: number;
	/** 観測幅に入っているか（|crossTrack| < 145 km） */
	inSwath: boolean;
};

let trackCache: { key: string; from: number; step: number; tracks: Map<SatId, SubPoint[]> } | null = null;

/** 全機の直下点列を数日分まとめて計算（目標地点に依存しないのでキャッシュ） */
function cachedTracks(tles: Tle[], from: Date, days: number, stepSec: number): Map<SatId, SubPoint[]> {
	const key = tles.map((t) => t.line1).join('|') + days + stepSec;
	// 10 分以内に同じ TLE で計算済みなら再利用
	if (trackCache && trackCache.key === key && from.getTime() - trackCache.from < 600000) return trackCache.tracks;
	const tracks = new Map<SatId, SubPoint[]>();
	for (const t of tles) tracks.set(t.id, groundTrack(t, from, days * 1440, stepSec));
	trackCache = { key, from: from.getTime(), step: stepSec, tracks };
	return tracks;
}

/**
 * 目標地点の上空を通る（横方向 maxKm 以内）パスを列挙する。
 * 直下点列の各区間を大圏とみなし、目標の横方向距離・沿線距離から最接近時刻を補間する。
 */
export function predictPasses(tles: Tle[], lat: number, lon: number, from = new Date(), days = 10, maxKm = 400): Pass[] {
	const step = 60;
	const tracks = cachedTracks(tles, from, days, step);
	const out: Pass[] = [];
	for (const [sat, pts] of tracks) {
		for (let i = 0; i + 1 < pts.length; i++) {
			const a = pts[i], b = pts[i + 1];
			const d12 = distanceKm(a.lat, a.lon, b.lat, b.lon);
			if (d12 > 1000) continue; // 経度飛び等の異常区間
			const d13 = distanceKm(a.lat, a.lon, lat, lon);
			if (d13 > d12 + maxKm) continue;
			const θ12 = bearingDeg(a.lat, a.lon, b.lat, b.lon) * D2R;
			const θ13 = bearingDeg(a.lat, a.lon, lat, lon) * D2R;
			if (Math.cos(θ13 - θ12) < 0) continue; // 目標が区間の始点より後ろ（acos は符号を失うので別途判定）
			const δ13 = d13 / RE_KM;
			const xt = Math.asin(Math.sin(δ13) * Math.sin(θ13 - θ12)) * RE_KM; // 左負・右正
			const at = Math.acos(Math.min(1, Math.max(-1, Math.cos(δ13) / Math.cos(xt / RE_KM)))) * RE_KM;
			if (at < 0 || at > d12 || Math.abs(xt) > maxKm) continue;
			const time = new Date(a.t + (at / d12) * step * 1000);
			const sun = sunPosition(time, lat, lon);
			out.push({
				sat,
				time,
				crossTrackKm: xt,
				heading: θ12 * R2D,
				descending: b.lat < a.lat,
				sunElevation: sun.elevation,
				sunAzimuth: sun.azimuth,
				inSwath: Math.abs(xt) < HALF_SWATH_KM
			});
		}
	}
	return out.sort((p, q) => p.time.getTime() - q.time.getTime());
}

/** 太陽の方位・高度（NOAA の簡易式、精度 ~0.1°） */
export function sunPosition(date: Date, lat: number, lon: number): { azimuth: number; elevation: number } {
	const jd = date.getTime() / 86400000 + 2440587.5;
	const T = (jd - 2451545) / 36525;
	const L0 = (280.46646 + T * (36000.76983 + 0.0003032 * T)) % 360;
	const M = (357.52911 + T * (35999.05029 - 0.0001537 * T)) * D2R;
	const C = (1.914602 - T * (0.004817 + 0.000014 * T)) * Math.sin(M) + (0.019993 - 0.000101 * T) * Math.sin(2 * M) + 0.000289 * Math.sin(3 * M);
	const λ = (L0 + C - 0.00569 - 0.00478 * Math.sin((125.04 - 1934.136 * T) * D2R)) * D2R;
	const ε = (23.439291 - 0.0130042 * T + 0.00256 * Math.cos((125.04 - 1934.136 * T) * D2R)) * D2R;
	const decl = Math.asin(Math.sin(ε) * Math.sin(λ));
	const ra = Math.atan2(Math.cos(ε) * Math.sin(λ), Math.cos(λ));
	const gmst = (280.46061837 + 360.98564736629 * (jd - 2451545)) % 360;
	const H = ((gmst + lon) * D2R - ra) ;
	const φ = lat * D2R;
	const elevation = Math.asin(Math.sin(φ) * Math.sin(decl) + Math.cos(φ) * Math.cos(decl) * Math.cos(H));
	const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(φ) - Math.tan(decl) * Math.cos(φ));
	return { azimuth: ((az * R2D + 180) % 360 + 360) % 360, elevation: elevation * R2D };
}

/** Sentinel-2 の product_uri（…_R074_T54SUE_…）から相対軌道番号を取る */
export function relativeOrbit(productUri: unknown): number | null {
	const m = typeof productUri === 'string' ? productUri.match(/_R(\d{3})_/) : null;
	return m ? Number(m[1]) : null;
}

export const fmtJst = (d: Date, withDate = true) =>
	d.toLocaleString('ja-JP', {
		timeZone: 'Asia/Tokyo',
		...(withDate ? { month: '2-digit', day: '2-digit' } : {}),
		hour: '2-digit',
		minute: '2-digit',
		hour12: false
	});
