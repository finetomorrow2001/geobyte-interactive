/**
 * Sentinel-2 L2A の SCL（Scene Classification Layer, 20 m）による無効画素の定義と集計。
 * 点・時系列・指数画像・地域集計の判定をここに一本化する（Worker / ページ / 調査スクリプトで共有）。
 *
 * 除外（無効）クラス: 0 欠測, 1 飽和/欠陥, 3 雲影, 8 雲(中確率), 9 雲(高確率), 10 巻雲, 11 雪/氷
 * 有効のまま扱うクラス: 2 暗域(地形影を含む), 4 植生, 5 裸地, 6 水, 7 未分類
 *   - 2 と 7 は集計では別枠で数えるが除外しない（地形影や未分類まで外すと山地の画素を大きく失うため）。
 *
 * SCL は分類値なので補間せず最近傍で対応付ける。オーバービューも最近傍で作られている
 * （Earth Search の SCL.tif で、各オーバービュー画素が元の 2×2 の 1 つと一致することを確認）。
 */
export const SCL_NODATA = 0;
export const SCL_INVALID_CLASSES = [0, 1, 3, 8, 9, 10, 11] as const;

/** クラス値 → 無効なら 1 の早見表。範囲外（255）も無効扱い */
export const SCL_INVALID_LUT: Uint8Array = (() => {
	const lut = new Uint8Array(256).fill(1);
	for (const c of [2, 4, 5, 6, 7]) lut[c] = 0;
	return lut;
})();

export const isSclInvalid = (v: number | null | undefined): boolean => v === null || v === undefined || !(v >= 0) || v > 255 || SCL_INVALID_LUT[v] === 1;

export type SclReason = 'nodata' | 'saturated' | 'shadow' | 'cloud' | 'cirrus' | 'snow';
/** 無効な SCL 値の理由。有効なら null。null/undefined（取得できない・欠測）は 'nodata' */
export function sclReason(v: number | null | undefined): SclReason | null {
	if (v === null || v === undefined || v === 0) return 'nodata';
	switch (v) {
		case 1: return 'saturated';
		case 3: return 'shadow';
		case 8: case 9: return 'cloud';
		case 10: return 'cirrus';
		case 11: return 'snow';
		default: return isSclInvalid(v) ? 'nodata' : null;
	}
}

/**
 * 地域集計。分母 = 格子点の総数（total）。画像範囲外（255）と SCL=0 も分母に含め、欠測として数える。
 * cloud = クラス 8 + 9。valid = 無効クラス以外（2, 4, 5, 6, 7）。
 */
export type SclSummary = {
	total: number;
	valid: number;
	outside: number;
	nodata: number;
	saturated: number;
	shadow: number;
	cloud: number;
	cirrus: number;
	snow: number;
	/** 有効のうち、参考として別枠で数える暗域(2)・未分類(7) */
	dark: number;
	unclassified: number;
};

export function summarizeScl(values: ArrayLike<number>): SclSummary {
	const s: SclSummary = { total: values.length, valid: 0, outside: 0, nodata: 0, saturated: 0, shadow: 0, cloud: 0, cirrus: 0, snow: 0, dark: 0, unclassified: 0 };
	for (let i = 0; i < values.length; i++) {
		const v = values[i];
		if (v === 255) s.outside++;
		else if (v === 0) s.nodata++;
		else if (v === 1) s.saturated++;
		else if (v === 3) s.shadow++;
		else if (v === 8 || v === 9) s.cloud++;
		else if (v === 10) s.cirrus++;
		else if (v === 11) s.snow++;
		else {
			s.valid++;
			if (v === 2) s.dark++;
			else if (v === 7) s.unclassified++;
		}
	}
	return s;
}

/** 無効画素の割合（0..1）。画像範囲外・欠測も含む */
export const invalidShare = (s: SclSummary): number => (s.total ? (s.total - s.valid) / s.total : 1);
