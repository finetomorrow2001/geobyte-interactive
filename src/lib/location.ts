/** Worldwide, user-submitted place lookup. Coordinates never leave the browser. */
export type LocationResult = { id: string; name: string; detail: string; lat: number; lon: number; addressMatch?: boolean; poiName?: string };
export type CoordinateOrder = 'latlon' | 'lonlat';
export const GEOCODER_URL = import.meta.env.VITE_GEOCODER_URL || 'https://photon.komoot.io/api/';

export function parseCoordinates(input: string, order: CoordinateOrder = 'latlon'): LocationResult | null {
	const text = input.normalize('NFKC').trim().replace(/[、，]/g, ',');
	const number = '([+-]?\\d+(?:\\.\\d+)?)';
	const labelled = new RegExp(`^(lat(?:itude)?|lon(?:gitude)?|lng|緯度|経度)\\s*[:=]?\\s*${number}\\s*[,; ]+\\s*(lat(?:itude)?|lon(?:gitude)?|lng|緯度|経度)\\s*[:=]?\\s*${number}$`, 'i');
	const match = text.match(labelled);
	let lat: number, lon: number;
	if (match) {
		const firstLat = /^(lat|緯度)/i.test(match[1]);
		const secondLat = /^(lat|緯度)/i.test(match[3]);
		if (firstLat === secondLat) throw new Error('coordinates');
		lat = Number(match[firstLat ? 2 : 4]); lon = Number(match[firstLat ? 4 : 2]);
	} else {
		const pair = text.match(new RegExp(`^${number}\\s*[,;\\s]\\s*${number}$`));
		if (!pair) {
			if (/^(lat(?:itude)?|lon(?:gitude)?|lng|緯度|経度)\s*[:=]/i.test(text) || /^[+\-\d.,;\s]+$/.test(text) && /[,;]/.test(text)) throw new Error('coordinates');
			return null;
		}
		lat = Number(pair[order === 'latlon' ? 1 : 2]); lon = Number(pair[order === 'latlon' ? 2 : 1]);
	}
	if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 85.05112878 || Math.abs(lon) > 180) throw new Error('coordinates');
	return { id: `coordinate:${lat},${lon}`, name: `${lat.toFixed(6)}, ${lon.toFixed(6)}`, detail: '', lat, lon };
}

/** Prefer the provider's address for address-like input; never invent an address from the query. */
export function locationLabel(properties: Record<string, unknown>, query: string): Pick<LocationResult, 'name' | 'detail' | 'addressMatch' | 'poiName'> {
	const text = (key: string) => typeof properties[key] === 'string' ? String(properties[key]).trim() : '';
	const normalized = query.normalize('NFKC').trim().replace(/^〒\s*/, '');
	const postalOnly = /^\d{3}-?\d{4}$/.test(normalized) || /^[A-Z]\d[A-Z] ?\d[A-Z]\d$/i.test(normalized) || /^[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}$/i.test(normalized);
	const addressQuery = !postalOnly && (
		/\d/.test(normalized) && /[\p{L}]/u.test(normalized) ||
		/[一二三四五六七八九十]+丁目|番地|通り|大字|小字/.test(normalized) ||
		/\b(street|st|road|rd|avenue|ave|lane|ln|boulevard|blvd|drive|dr|way|platz|strasse|straße|rue)\b/i.test(normalized)
	);
	const street = text('street'), house = text('housenumber'), poi = text('name');
	const address = text('countrycode').toUpperCase() === 'JP'
		? (street && house && /\d$/.test(street) && /^\d/.test(house) ? `${street}-${house}` : [street, house].filter(Boolean).join(' '))
		: [house, street].filter(Boolean).join(' ');
	const addressMatch = !!street && (addressQuery || !poi);
	const name = addressMatch ? address : poi || address || text('postcode') || text('city') || query;
	const parts = [addressMatch ? '' : address, text('locality'), text('district'), text('city'), text('state'), text('postcode'), text('country')];
	const detail = [...new Set(parts.filter(part => part && part !== name && !name.includes(part)))].join(', ');
	return { name, detail, addressMatch, poiName: addressMatch && poi && poi !== address ? poi : undefined };
}

const cache = new Map<string, LocationResult[]>();
let lastRequest = 0;
export async function findLocations(query: string, lang: 'ja' | 'en', signal: AbortSignal): Promise<LocationResult[]> {
	const key = `${lang}:${query.trim()}`;
	const cached = cache.get(key);
	if (cached) return cached;
	// No autocomplete or background lookup. At most one user-submitted request per second in this tab.
	if (Date.now() - lastRequest < 1100) throw new Error('rate');
	lastRequest = Date.now();
	const url = new URL(GEOCODER_URL);
	const normalized = query.trim().replace(/^〒\s*/, '');
	url.searchParams.set('q', /^\d{7}$/.test(normalized) ? `${normalized.slice(0, 3)}-${normalized.slice(3)}` : normalized);
	url.searchParams.set('limit', '8');
	// The public Photon instance supports default/de/en/fr; default retains local names (including Japanese).
	if (lang === 'en') url.searchParams.set('lang', 'en');
	const response = await fetch(url, { signal });
	if (!response.ok) throw new Error('service');
	const data = await response.json();
	const results: LocationResult[] = [];
	for (const [i, feature] of (data.features ?? []).entries()) {
		const p = feature.properties ?? {}, c = feature.geometry?.coordinates;
		if (!Array.isArray(c) || !Number.isFinite(c[0]) || !Number.isFinite(c[1]) || Math.abs(c[0]) > 180 || Math.abs(c[1]) > 85.05112878) continue;
		const label = locationLabel(p, query);
		results.push({ id: `${p.osm_type ?? ''}:${p.osm_id ?? i}`, ...label, lon: c[0], lat: c[1] });
	}
	if (cache.size >= 50) cache.delete(cache.keys().next().value!);
	const unique = [...new Map(results.map(result => [result.id, result])).values()];
	cache.set(key, unique);
	return unique;
}
