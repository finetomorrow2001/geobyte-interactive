const ORIGIN = 'https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/';
export const MAX_RANGE_BYTES = 4 * 1024 * 1024;

/** A cache object is an exact byte range of an allowlisted public COG, not a raster transform. */
export async function serveCogRange(key: string, fetcher: typeof fetch = fetch): Promise<Response> {
	const match = key.match(/^(0|[1-9]\d*)-(0|[1-9]\d*)\/(\d{1,2}\/[A-Z]\/[A-Z]{2}\/20\d{2}\/(?:[1-9]|1[0-2])\/S2[ABC]_[A-Z0-9]+_\d{8}_\d+_L2A\/(?:B(?:0[1-9]|1[0-2]|8A)|TCI|SCL)\.tif)$/);
	const fail = (status: number, message: string) => new Response(message, { status, headers: { 'Cache-Control': 'no-store' } });
	if (!match) return fail(400, 'Invalid public COG range');
	const start = Number(match[1]), end = Number(match[2]);
	if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end < start || end - start + 1 > MAX_RANGE_BYTES) return fail(400, 'Invalid range length');
	try {
		const upstream = await fetcher(ORIGIN + match[3], {
			headers: { Range: `bytes=${start}-${end}` }, redirect: 'error', signal: AbortSignal.timeout(25000)
		});
		const range = upstream.headers.get('content-range');
		const parts = range?.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
		if (upstream.status !== 206 || !parts || Number(parts[1]) !== start || Number(parts[2]) !== end || Number(parts[3]) <= end) {
			await upstream.body?.cancel();
			return fail(502, 'Origin returned an invalid partial response');
		}
		const data = await upstream.arrayBuffer();
		if (data.byteLength !== end - start + 1) return fail(502, 'Origin returned truncated data');
		// Vercel caches 200 responses, not 206. The URL identifies this exact range.
		// The client reconstructs the 206 metadata without changing any bytes.
		return new Response(data, { headers: {
			'Content-Type': 'application/octet-stream', 'Content-Length': String(data.byteLength),
			'X-Cog-Range': range!, 'X-Content-Type-Options': 'nosniff',
			'Cache-Control': 'public, max-age=86400',
			'Vercel-CDN-Cache-Control': 'public, max-age=604800'
		} });
	} catch {
		return fail(502, 'COG origin unavailable');
	}
}
