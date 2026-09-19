export type Band = {
	id: string;
	name: string;
	/** 中心波長 [nm] */
	center: number;
	/** 帯域幅 [nm] */
	width: number;
	/** 空間分解能 [m] */
	res: number;
	use: string;
};

/** Sentinel-2 MSI のバンド構成（S2A の値） */
export const bands: Band[] = [
	{ id: 'B1', name: 'Coastal aerosol', center: 443, width: 21, res: 60, use: 'エアロゾル補正・沿岸水質' },
	{ id: 'B2', name: 'Blue', center: 492, width: 66, res: 10, use: 'トゥルーカラー・水域' },
	{ id: 'B3', name: 'Green', center: 560, width: 36, res: 10, use: 'トゥルーカラー・植生活性' },
	{ id: 'B4', name: 'Red', center: 665, width: 31, res: 10, use: 'クロロフィル吸収・NDVI' },
	{ id: 'B5', name: 'Red Edge 1', center: 704, width: 15, res: 20, use: '植生ストレス' },
	{ id: 'B6', name: 'Red Edge 2', center: 740, width: 15, res: 20, use: '植生ストレス' },
	{ id: 'B7', name: 'Red Edge 3', center: 783, width: 20, res: 20, use: '植生ストレス' },
	{ id: 'B8', name: 'NIR', center: 833, width: 106, res: 10, use: '植生バイオマス・NDVI' },
	{ id: 'B8A', name: 'Narrow NIR', center: 865, width: 21, res: 20, use: '植生・水蒸気補正の基準' },
	{ id: 'B9', name: 'Water vapour', center: 945, width: 20, res: 60, use: '大気補正' },
	{ id: 'B10', name: 'SWIR Cirrus', center: 1374, width: 31, res: 60, use: '巻雲検出（L2A には無い）' },
	{ id: 'B11', name: 'SWIR 1', center: 1614, width: 91, res: 20, use: '土壌・植生水分・雪' },
	{ id: 'B12', name: 'SWIR 2', center: 2202, width: 175, res: 20, use: '火災跡・地質・都市' }
];

/** 指標計算やシーン合成に使うバンド（B1, B9, B10 は大気補正用なので除外） */
export const sceneBands = ['B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8', 'B8A', 'B11', 'B12'] as const;
export type SceneBand = (typeof sceneBands)[number];

export type LandCover = {
	id: string;
	name: string;
	color: string;
	/** 地表反射率 (0-1)。sceneBands の順 */
	refl: Record<SceneBand, number>;
};

const r = (v: number[]): Record<SceneBand, number> =>
	Object.fromEntries(sceneBands.map((b, i) => [b, v[i]])) as Record<SceneBand, number>;

/** 代表的な地物の反射スペクトル（教材用の概略値） */
export const landCovers: LandCover[] = [
	{ id: 'veg', name: '健全な植生', color: '#50fa7b', refl: r([0.04, 0.08, 0.05, 0.12, 0.3, 0.38, 0.42, 0.45, 0.2, 0.1]) },
	{ id: 'dry', name: '乾燥した植生 / 枯草', color: '#c9d56a', refl: r([0.08, 0.12, 0.14, 0.18, 0.24, 0.26, 0.28, 0.29, 0.32, 0.22]) },
	{ id: 'water', name: '水域', color: '#5aa9ff', refl: r([0.06, 0.05, 0.03, 0.02, 0.012, 0.01, 0.01, 0.008, 0.005, 0.003]) },
	{ id: 'soil', name: '裸地 / 土壌', color: '#b08d57', refl: r([0.12, 0.16, 0.22, 0.26, 0.3, 0.32, 0.34, 0.36, 0.4, 0.35]) },
	{ id: 'urban', name: '都市 / 建物', color: '#c8c8d0', refl: r([0.15, 0.17, 0.2, 0.22, 0.24, 0.25, 0.27, 0.28, 0.3, 0.28]) },
	{ id: 'snow', name: '雪 / 氷', color: '#f0f6ff', refl: r([0.9, 0.88, 0.85, 0.8, 0.75, 0.7, 0.65, 0.6, 0.1, 0.05]) },
	{ id: 'burn', name: '焼失跡', color: '#8a4b2a', refl: r([0.05, 0.06, 0.08, 0.09, 0.1, 0.11, 0.12, 0.13, 0.28, 0.32]) }
];

export type IndexDef = {
	id: string;
	name: string;
	a: SceneBand;
	b: SceneBand;
	desc: string;
};

/** 正規化差分指標 (A - B) / (A + B) */
export const indices: IndexDef[] = [
	{ id: 'NDVI', name: 'NDVI 植生', a: 'B8', b: 'B4', desc: 'NIR で強く反射・赤で吸収する植生を強調。> 0.3 で植生、> 0.6 で密な植生。' },
	{ id: 'NDWI', name: 'NDWI 水域 (McFeeters)', a: 'B3', b: 'B8', desc: '水は緑で少し反射し NIR をほぼ吸収。> 0 で水域。' },
	{ id: 'NDMI', name: 'NDMI 植生水分', a: 'B8', b: 'B11', desc: 'SWIR1 は葉の水分に吸収される。乾燥ストレスの検出。' },
	{ id: 'NBR', name: 'NBR 焼失', a: 'B8', b: 'B12', desc: '焼失跡は NIR が落ちて SWIR2 が上がる。火災前後の差分 dNBR で被害度を分類。' },
	{ id: 'NDBI', name: 'NDBI 都市', a: 'B11', b: 'B8', desc: '建物は SWIR1 > NIR。植生と逆符号になる。' },
	{ id: 'NDSI', name: 'NDSI 雪', a: 'B3', b: 'B11', desc: '雪は可視で非常に明るく SWIR で暗い。> 0.4 で雪。雲との分離にも使う。' }
];

export function normDiff(a: number, b: number): number {
	const d = a + b;
	return d === 0 ? 0 : (a - b) / d;
}

/** 合成シーンのクラスマップを生成 (size x size, landCovers のインデックス) */
export function makeScene(size: number): Uint8Array {
	const map = new Uint8Array(size * size);
	const idx = (id: string) => landCovers.findIndex((c) => c.id === id);
	const VEG = idx('veg'), DRY = idx('dry'), WATER = idx('water'), SOIL = idx('soil'), URBAN = idx('urban'), SNOW = idx('snow'), BURN = idx('burn');

	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			const u = x / size;
			const v = y / size;
			let c = VEG;
			// 左上の山地：植生 → 上部は雪
			if (u < 0.45 && v < 0.4) {
				const peak = Math.hypot(u - 0.2, v - 0.15);
				c = peak < 0.08 ? SNOW : VEG;
			}
			// 農地（右上）：畝のパターンで健全 / 乾燥を交互に
			if (u >= 0.45 && v < 0.45) {
				const cell = Math.floor((u - 0.45) * 12) + Math.floor(v * 10);
				c = cell % 3 === 0 ? DRY : cell % 3 === 1 ? VEG : SOIL;
			}
			// 都市（右下）
			if (u >= 0.55 && v >= 0.55) {
				const g = (Math.floor(u * size / 4) + Math.floor(v * size / 4)) % 5;
				c = g === 0 ? VEG : URBAN;
			}
			// 焼失跡（左下）
			if (Math.hypot(u - 0.2, v - 0.75) < 0.13) c = BURN;
			// 川：斜めに走る蛇行
			const river = 0.5 + 0.06 * Math.sin(v * 9);
			if (Math.abs(u - river) < 0.025 + 0.01 * Math.sin(v * 20)) c = WATER;
			// 湖
			if (Math.hypot(u - 0.82, v - 0.3) < 0.07) c = WATER;
			map[y * size + x] = c;
		}
	}
	return map;
}

/** 決定的な擬似乱数（シーンにテクスチャを付けるため） */
export function noise(i: number): number {
	const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
	return x - Math.floor(x);
}

/** 反射率 → 8bit 表示値。gain で明るさ調整 */
export function toByte(refl: number, gain: number): number {
	return Math.max(0, Math.min(255, Math.round(refl * gain * 255)));
}

/** -1..1 の指標値をカラーマップ (RdYlGn 風) に */
export function indexColor(v: number): [number, number, number] {
	const t = (Math.max(-1, Math.min(1, v)) + 1) / 2; // 0..1
	if (t < 0.5) {
		const k = t / 0.5;
		return [Math.round(165 + (255 - 165) * k), Math.round(0 + 255 * k), Math.round(38 + (191 - 38) * k)];
	}
	const k = (t - 0.5) / 0.5;
	return [Math.round(255 - (255 - 0) * k), Math.round(255 - (255 - 104) * k), Math.round(191 - (191 - 55) * k)];
}

export const composites: { name: string; r: SceneBand; g: SceneBand; b: SceneBand; desc: string }[] = [
	{ name: 'トゥルーカラー', r: 'B4', g: 'B3', b: 'B2', desc: '人間の目に近い。植生は暗めの緑、水は暗い。' },
	{ name: 'フォールスカラー (NIR)', r: 'B8', g: 'B4', b: 'B3', desc: '植生が鮮やかな赤に。植生の活性度・水域境界が明瞭。' },
	{ name: 'SWIR 合成', r: 'B12', g: 'B8A', b: 'B4', desc: '焼失跡が赤紫、植生が緑、都市が明るいマゼンタ。雲と雪の区別にも。' },
	{ name: '農業', r: 'B11', g: 'B8', b: 'B2', desc: '健全な作物が鮮やかな緑、乾燥／裸地がマゼンタ寄り。' },
	{ name: '地質', r: 'B12', g: 'B11', b: 'B2', desc: '岩石・土壌の違いを強調。植生は緑〜青緑。' }
];
