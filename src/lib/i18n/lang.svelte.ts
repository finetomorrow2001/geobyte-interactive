/**
 * 言語切替（JA / EN）。
 * - `i18n.lang` を読む式は自動で再評価される（Svelte 5 runes）
 * - 辞書はページ単位（src/lib/i18n/<page>.ts）。日本語側は専門用語に英語を併記する方針
 */
import { browser } from '$app/environment';

export type Lang = 'ja' | 'en';
export const LANGS: Lang[] = ['ja', 'en'];
const KEY = 'sdl-lang';

function initial(): Lang {
	if (!browser) return 'ja';
	const saved = localStorage.getItem(KEY);
	if (saved === 'ja' || saved === 'en') return saved;
	return navigator.language.startsWith('ja') ? 'ja' : 'en';
}

export const i18n = $state<{ lang: Lang }>({ lang: initial() });

export function setLang(l: Lang) {
	i18n.lang = l;
	if (browser) {
		localStorage.setItem(KEY, l);
		document.documentElement.lang = l;
	}
}

/** 辞書の値: 文字列か、引数を受けて文字列を返す関数 */
export type Entry = string | ((...args: never[]) => string);
export type Dict<K extends string = string> = Record<K, Entry>;
export type Bilingual<K extends string = string> = { ja: Dict<K>; en: Dict<K> };

/**
 * ページ辞書から翻訳関数を作る。テンプレート内で `{t('key')}` のように呼ぶ。
 * 関数エントリは `{t('count', n)}` のように引数を渡す。
 */
export function makeT<K extends string>(dict: Bilingual<K>) {
	return (key: K, ...args: unknown[]): string => {
		const e = (dict[i18n.lang] as Dict<K>)[key] ?? dict.ja[key];
		if (e === undefined) return key;
		return typeof e === 'function' ? (e as (...a: unknown[]) => string)(...args) : e;
	};
}

/** { ja, en } のテキストを現在の言語で返す */
export type LText = { ja: string; en: string };
export const L = (x: LText) => x[i18n.lang];

/** 日本語モードでは「日本語 (English)」、英語モードでは英語だけ */
export const term = (ja: string, en: string) => (i18n.lang === 'ja' ? `${ja} (${en})` : en);

/** ロケール付き数値フォーマット */
export const nf = (v: number, opts?: Intl.NumberFormatOptions) => v.toLocaleString(i18n.lang === 'ja' ? 'ja-JP' : 'en-US', opts);
