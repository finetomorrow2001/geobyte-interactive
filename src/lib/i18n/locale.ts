/** Explicit demo links win over saved preference; ignore unsupported locales. */
export type Lang = 'ja' | 'en';
export const localeParam = (value: string | null): Lang | null => value === 'ja' || value === 'en' ? value : null;
export function resolveLanguage(query: string | null, saved: string | null, browserLanguage: string): Lang {
 return localeParam(query) ?? localeParam(saved) ?? (browserLanguage.startsWith('ja') ? 'ja' : 'en');
}
/** Keep scene IDs, boundaries, other query parameters and the fragment intact. */
export function languageUrl(href: string, lang: Lang): string {
 const url = new URL(href, 'https://satellite.invalid');
 url.searchParams.set('lang', lang);
 return url.pathname + url.search + url.hash;
}
