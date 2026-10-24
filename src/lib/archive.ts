import { STAC_API, COLLECTION, type StacItem } from './imagery';

/** Collection metadata currently advertises this start; individual locations may begin later. */
export const ARCHIVE_START = '2015-06-27';
export const todayUtc = () => new Date().toISOString().slice(0, 10);
export type SceneRequest = { url: string; method: 'GET' | 'POST'; body?: Record<string, unknown> };
export type ScenePage = { items: StacItem[]; next: SceneRequest | null };

export function sceneRequest(bbox: [number, number, number, number], from: string, to: string, cloud: number, oldestFirst: boolean): SceneRequest {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from < ARCHIVE_START || from > to || to > todayUtc() || !Number.isFinite(cloud) || cloud < 0 || cloud > 100) throw new Error('dates');
	for (const value of [from, to]) if (!Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw new Error('dates');
	return { url: `${STAC_API}/search`, method: 'POST', body: {
		collections: [COLLECTION], bbox,
		datetime: `${from}T00:00:00Z/${to}T23:59:59.999Z`,
		query: { 'eo:cloud_cover': { lte: cloud } },
		sortby: [{ field: 'properties.datetime', direction: oldestFirst ? 'asc' : 'desc' }], limit: 100
	} };
}

/** Follow STAC links explicitly; each click fetches one page, with no silent cap on archive dates. */
export async function fetchScenePage(request: SceneRequest, signal: AbortSignal): Promise<ScenePage> {
	if (new URL(request.url).origin !== new URL(STAC_API).origin) throw new Error('Unexpected STAC pagination host');
	const response = await fetch(request.url, {
		method: request.method, signal,
		...(request.method === 'POST' ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request.body) } : {})
	});
	if (!response.ok) throw new Error(`STAC ${response.status}`);
	const data = await response.json();
	if (!Array.isArray(data.features)) throw new Error('Invalid STAC response');
	const link = data.links?.find((l: { rel: string }) => l.rel === 'next');
	let next: SceneRequest | null = null;
	if (link) {
		const url = new URL(link.href, request.url);
		if (url.origin !== new URL(STAC_API).origin) throw new Error('Unexpected STAC pagination host');
		if (link.method && !['GET', 'POST'].includes(link.method)) throw new Error('Unsupported STAC pagination method');
		next = { url: url.href, method: link.method ?? 'GET', ...(link.method === 'POST' ? { body: link.merge ? { ...request.body, ...link.body } : link.body } : {}) };
	}
	return { items: data.features, next };
}
