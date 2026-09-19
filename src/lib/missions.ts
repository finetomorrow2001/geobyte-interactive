export type Mission = {
	name: string;
	type: '光学' | 'SAR' | '静止';
	/** 代表的な空間分解能 [m] */
	gsd: number;
	/** 観測幅 [km] */
	swath: number;
	/** 再訪 [日]（コンステレーション込み） */
	revisit: number;
	bands: string;
	bits: number;
	access: string;
	/** 散布図でラベルが重なる場合の縦オフセット [px] */
	labelDy?: number;
};

export const missions: Mission[] = [
	{ name: 'ひまわり 9 号', type: '静止', gsd: 1000, swath: 12000, revisit: 1 / 144, bands: '16 バンド', bits: 11, access: '無償（気象庁・NICT）' },
	{ name: 'MODIS (Terra/Aqua)', type: '光学', gsd: 250, swath: 2330, revisit: 1, bands: '36 バンド', bits: 12, access: '無償（NASA）' },
	{ name: 'Sentinel-3 OLCI', type: '光学', gsd: 300, swath: 1270, revisit: 2, bands: '21 バンド', bits: 12, access: '無償（ESA）' },
	{ name: 'Landsat 8/9', type: '光学', gsd: 30, swath: 185, revisit: 8, bands: '11 バンド', bits: 12, access: '無償（USGS）' },
	{ name: 'Sentinel-2 A/B/C', type: '光学', gsd: 10, swath: 290, revisit: 5, bands: '13 バンド', bits: 12, access: '無償（ESA）', labelDy: -6 },
	{ name: 'Sentinel-1 A/C', type: 'SAR', gsd: 10, swath: 250, revisit: 6, bands: 'C バンド VV/VH', bits: 16, access: '無償（ESA）', labelDy: 10 },
	{ name: 'ALOS-2 PALSAR-2', type: 'SAR', gsd: 3, swath: 50, revisit: 14, bands: 'L バンド', bits: 16, access: '有償／研究無償（JAXA）' },
	{ name: 'PlanetScope', type: '光学', gsd: 3, swath: 25, revisit: 1, bands: '8 バンド', bits: 12, access: '有償（Planet）' },
	{ name: 'WorldView-3', type: '光学', gsd: 0.31, swath: 13, revisit: 1, bands: 'Pan + 8 MS + 8 SWIR', bits: 11, access: '有償（Maxar）', labelDy: -6 },
	{ name: 'Pléiades Neo', type: '光学', gsd: 0.3, swath: 14, revisit: 1, bands: 'Pan + 6 MS', bits: 12, access: '有償（Airbus）', labelDy: 10 },
	{ name: 'ICEYE', type: 'SAR', gsd: 0.25, swath: 5, revisit: 1, bands: 'X バンド', bits: 16, access: '有償（ICEYE）' }
];
