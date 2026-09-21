import type { Bilingual } from './lang.svelte';

export const home = {
	ja: {
		title: 'Satellite Data Lab — 衛星データ利用 入門',
		h1: '衛星データ利用を、手を動かして理解する',
		lead: '衛星データを実務で扱うエンジニア向けのインタラクティブ教材です。数式やパラメータを直接いじりながら、「なぜそうなっているのか」を軌道・センサー・データ形式・取得 API の順に追っていきます。',
		note: '全モジュールはブラウザ内で完結します。',
		noteStrong: 'STAC・実画像モジュール',
		noteRest: 'は、AWS 上の公開 STAC API（Earth Search）と公開 COG に実リクエストを送ります（認証不要）。',
		modules: 'モジュール',
		overview: '衛星データ利用の全体像',
		flow: `  [軌道・センサー]        [処理・配布]                [利用者]
   衛星が観測 ──▶ L0 → L1 → L2 (ARD) ──▶ COG / Zarr ──▶ STAC で検索 ──▶ 解析・可視化
   ↑ 01 軌道          ↑ 05 処理レベル      ↑ 05 形式       ↑ 04 STAC       ↑ 02 指標 / 03 分解能 / 06 実画像
   ↑ 02 バンド`,
		flowNote: '左から右へがデータの流れ。実務では右端（STAC で探して COG を読む）から入ることが多いですが、左側を知らないと「なぜこの日付にシーンがないのか」「なぜこの指標が効くのか」が説明できません。'
	},
	en: {
		title: 'Satellite Data Lab — Satellite data for engineers',
		h1: 'Learn satellite data by touching it',
		lead: 'An interactive course for engineers who work with satellite data. Turn the knobs on the equations and parameters and follow the “why” from orbits to sensors, data formats and discovery APIs.',
		note: 'Every module runs entirely in your browser. ',
		noteStrong: 'The STAC and Real Imagery modules',
		noteRest: ' send real requests to the public STAC API on AWS (Earth Search) and to public COGs (no authentication).',
		modules: 'Modules',
		overview: 'The big picture',
		flow: `  [Orbit / sensor]         [Processing / distribution]        [User]
   Satellite observes ──▶ L0 → L1 → L2 (ARD) ──▶ COG / Zarr ──▶ Search via STAC ──▶ Analyse / visualise
   ↑ 01 Orbits          ↑ 05 Levels          ↑ 05 Formats     ↑ 04 STAC          ↑ 02 Indices / 03 Resolution / 06 Imagery
   ↑ 02 Bands`,
		flowNote: 'Data flows left to right. In practice you often start at the right end (find with STAC, read the COG), but without the left side you cannot explain why a date has no scene or why an index works.'
	}
} satisfies Bilingual;
