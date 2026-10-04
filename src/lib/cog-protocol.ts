/**
 * MapLibre のカスタムプロトコル `cog://` — タイル要求を Worker の COG レンダラへ橋渡しする。
 * URL: cog://<key>/{z}/{x}/{y}  key は registerCogLayer() が返す番号。
 */
import type * as ML from 'maplibre-gl';
import { renderTile, type StacItem, type RenderMode } from './imagery';

export type TileProgress = { pending: number; completed: number; empty: number; failed: number };
type Entry = { item: StacItem; mode: RenderMode; gain: number; progress: TileProgress; onProgress?: (progress: TileProgress) => void };
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
		e.progress.pending++;
		const publish = () => { if (registry.get(m[1]) === e) e.onProgress?.({ ...e.progress }); };
		publish();
		try {
			const rgba = await renderTile(e.item, e.mode, e.gain, +m[2], +m[3], +m[4], 256);
			onTile?.();
			if (abortController.signal.aborted) throw new DOMException('aborted', 'AbortError');
			const data = await createImageBitmap(new ImageData(rgba, 256, 256));
			if (abortController.signal.aborted || registry.get(m[1]) !== e) {
				data.close();
				throw new DOMException('aborted', 'AbortError');
			}
			e.progress.completed++;
			let visible = false;
			for (let i = 3; i < rgba.length; i += 4) if (rgba[i]) { visible = true; break; }
			if (!visible) e.progress.empty++;
			return { data };
		} catch (error) {
			if (!abortController.signal.aborted && !(error instanceof DOMException && error.name === 'AbortError')) e.progress.failed++;
			throw error;
		} finally {
			e.progress.pending--;
			publish();
		}
	});
}

/** レイヤー定義を登録し、MapLibre の raster source に渡す tiles テンプレートを返す */
export function registerCogLayer(item: StacItem, mode: RenderMode, gain: number, onProgress?: (progress: TileProgress) => void): { key: string; tiles: string } {
	const key = String(nextKey++);
	registry.set(key, { item, mode: structuredClone(mode), gain, onProgress, progress: { pending: 0, completed: 0, empty: 0, failed: 0 } });
	return { key, tiles: `cog://${key}/{z}/{x}/{y}` };
}

export function unregisterCogLayer(key: string) {
	registry.delete(key);
}
