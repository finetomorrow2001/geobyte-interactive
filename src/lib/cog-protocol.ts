/**
 * MapLibre のカスタムプロトコル `cog://` — タイル要求を Worker の COG レンダラへ橋渡しする。
 * URL: cog://<key>/{z}/{x}/{y}  key は registerCogLayer() が返す番号。
 */
import type * as ML from 'maplibre-gl';
import { renderTile, type StacItem, type RenderMode } from './imagery';

type Entry = { item: StacItem; mode: RenderMode; gain: number };
const registry = new Map<string, Entry>();
let nextKey = 1;
let onTile: (() => void) | null = null;
let installed = false;

/** タイル 1 枚描くごとに呼ばれるコールバック（Range Request 数の表示更新用） */
export function setTileListener(fn: (() => void) | null) {
	onTile = fn;
}

/** maplibre-gl は SSR で import できないので、動的 import したモジュールを受け取る */
export function installCogProtocol(ml: typeof ML) {
	if (installed) return;
	installed = true;
	ml.addProtocol('cog', async (params, abortController) => {
		const m = params.url.match(/^cog:\/\/(\d+)\/(\d+)\/(\d+)\/(\d+)$/);
		if (!m) throw new Error(`bad cog url: ${params.url}`);
		const e = registry.get(m[1]);
		if (!e) throw new Error('cog layer removed');
		const rgba = await renderTile(e.item, e.mode, e.gain, +m[2], +m[3], +m[4], 256);
		onTile?.();
		if (abortController.signal.aborted) throw new DOMException('aborted', 'AbortError');
		// addProtocol は ImageBitmap をそのまま返せる（PNG エンコード不要）
		const data = await createImageBitmap(new ImageData(rgba, 256, 256));
		return { data };
	});
}

/** レイヤー定義を登録し、MapLibre の raster source に渡す tiles テンプレートを返す */
export function registerCogLayer(item: StacItem, mode: RenderMode, gain: number): { key: string; tiles: string } {
	const key = String(nextKey++);
	registry.set(key, { item, mode: structuredClone(mode), gain });
	return { key, tiles: `cog://${key}/{z}/{x}/{y}` };
}

export function unregisterCogLayer(key: string) {
	registry.delete(key);
}
