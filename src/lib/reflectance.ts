/**
 * 反射率の扱い（二重補正の回避）。
 *
 * Sentinel-2 L2A は処理ベースライン 04.00 以降、DN に BOA_ADD_OFFSET = −1000 が付く
 * （反射率 = (DN − 1000) / 10000）。Earth Search はこれをシーンごとに揃えており、判断の根拠は STAC の
 *   - `earthsearch:boa_offset_applied`（true なら COG の DN にはすでに補正が入っている → 追加で引かない）
 *   - `s2:processing_baseline`（04.00 未満は元からオフセットなし）
 * 実測（夕張 2019〜2026 の 8 シーン、南側 NIR の最小 DN が 45〜243）でも、補正済みなら現れない
 * 1000 前後の「床」は見られなかった。なお `raster:bands[].offset = −0.1` は補正済みのシーンにも残るので、
 * ここでは使わない（使うと二重に引くことになる）。
 *
 * 補正が必要（boa_offset_applied が true でなく、ベースライン ≥ 04.00）と判断できる場合のみ 1000 を返す。
 */
/** known: false のときは補正状態を判断できていない（補正なしとして計算するが、確認済みの値とは区別して表示する） */
export type DnOffset = { offset: number; basis: string; known: boolean };

export function dnOffsetFor(props: Record<string, unknown>): DnOffset {
	if (props['earthsearch:boa_offset_applied'] === true) return { offset: 0, basis: 'earthsearch:boa_offset_applied=true（補正済み）', known: true };
	const pb = parseFloat(String(props['s2:processing_baseline'] ?? ''));
	if (Number.isFinite(pb) && pb < 4) return { offset: 0, basis: `s2:processing_baseline=${pb.toFixed(2)} < 04.00（オフセットなし）`, known: true };
	if (Number.isFinite(pb)) return { offset: 1000, basis: `s2:processing_baseline=${pb.toFixed(2)} ≥ 04.00 かつ未補正 → DN から 1000 を引く`, known: true };
	return { offset: 0, basis: '判断材料なし（補正なしとして扱う）', known: false };
}

/** DN → 反射率（0..1 目安）。offset は dnOffsetFor の値 */
export const toReflectance = (dn: number, offset: number): number => (dn - offset) / 10000;

/** 正規化差分 (b1 − b2) / (b1 + b2) を反射率で計算。分母が 0 以下なら null */
export function normDiffDn(a: number | null, b: number | null, offset: number): number | null {
	if (a === null || b === null) return null;
	const ra = toReflectance(a, offset), rb = toReflectance(b, offset);
	return ra + rb <= 0 ? null : (ra - rb) / (ra + rb);
}
