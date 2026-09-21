import type { LText } from './i18n/lang.svelte';

/** センサー種別（内部 ID）。表示名は i18n/resolution.ts の typeOptical / typeSar / typeGeo */
export type MissionType = 'optical' | 'sar' | 'geo';

export type Mission = {
	name: LText;
	type: MissionType;
	/** 代表的な空間分解能 [m] */
	gsd: number;
	/** 観測幅 [km] */
	swath: number;
	/** 再訪 [日]（コンステレーション込み） */
	revisit: number;
	bands: LText;
	bits: number;
	access: LText;
	/** 散布図でラベルが重なる場合の縦オフセット [px] */
	labelDy?: number;
};

export const missions: Mission[] = [
	{ name: { ja: 'ひまわり 9 号', en: 'Himawari-9' }, type: 'geo', gsd: 1000, swath: 12000, revisit: 1 / 144, bands: { ja: '16 バンド', en: '16 bands' }, bits: 11, access: { ja: '無償（気象庁・NICT）', en: 'Free (JMA / NICT)' } },
	{ name: { ja: 'MODIS (Terra/Aqua)', en: 'MODIS (Terra/Aqua)' }, type: 'optical', gsd: 250, swath: 2330, revisit: 1, bands: { ja: '36 バンド', en: '36 bands' }, bits: 12, access: { ja: '無償（NASA）', en: 'Free (NASA)' } },
	{ name: { ja: 'Sentinel-3 OLCI', en: 'Sentinel-3 OLCI' }, type: 'optical', gsd: 300, swath: 1270, revisit: 2, bands: { ja: '21 バンド', en: '21 bands' }, bits: 12, access: { ja: '無償（ESA）', en: 'Free (ESA)' } },
	{ name: { ja: 'Landsat 8/9', en: 'Landsat 8/9' }, type: 'optical', gsd: 30, swath: 185, revisit: 8, bands: { ja: '11 バンド', en: '11 bands' }, bits: 12, access: { ja: '無償（USGS）', en: 'Free (USGS)' } },
	{ name: { ja: 'Sentinel-2 A/B/C', en: 'Sentinel-2 A/B/C' }, type: 'optical', gsd: 10, swath: 290, revisit: 5, bands: { ja: '13 バンド', en: '13 bands' }, bits: 12, access: { ja: '無償（ESA）', en: 'Free (ESA)' }, labelDy: -6 },
	{ name: { ja: 'Sentinel-1 A/C', en: 'Sentinel-1 A/C' }, type: 'sar', gsd: 10, swath: 250, revisit: 6, bands: { ja: 'C バンド VV/VH', en: 'C-band VV/VH' }, bits: 16, access: { ja: '無償（ESA）', en: 'Free (ESA)' }, labelDy: 10 },
	{ name: { ja: 'ALOS-2 PALSAR-2', en: 'ALOS-2 PALSAR-2' }, type: 'sar', gsd: 3, swath: 50, revisit: 14, bands: { ja: 'L バンド', en: 'L-band' }, bits: 16, access: { ja: '有償／研究無償（JAXA）', en: 'Commercial / free for research (JAXA)' } },
	{ name: { ja: 'PlanetScope', en: 'PlanetScope' }, type: 'optical', gsd: 3, swath: 25, revisit: 1, bands: { ja: '8 バンド', en: '8 bands' }, bits: 12, access: { ja: '有償（Planet）', en: 'Commercial (Planet)' } },
	{ name: { ja: 'WorldView-3', en: 'WorldView-3' }, type: 'optical', gsd: 0.31, swath: 13, revisit: 1, bands: { ja: 'Pan + 8 MS + 8 SWIR', en: 'Pan + 8 MS + 8 SWIR' }, bits: 11, access: { ja: '有償（Maxar）', en: 'Commercial (Maxar)' }, labelDy: -6 },
	{ name: { ja: 'Pléiades Neo', en: 'Pléiades Neo' }, type: 'optical', gsd: 0.3, swath: 14, revisit: 1, bands: { ja: 'Pan + 6 MS', en: 'Pan + 6 MS' }, bits: 12, access: { ja: '有償（Airbus）', en: 'Commercial (Airbus)' }, labelDy: 10 },
	{ name: { ja: 'ICEYE', en: 'ICEYE' }, type: 'sar', gsd: 0.25, swath: 5, revisit: 1, bands: { ja: 'X バンド', en: 'X-band' }, bits: 16, access: { ja: '有償（ICEYE）', en: 'Commercial (ICEYE)' } }
];
