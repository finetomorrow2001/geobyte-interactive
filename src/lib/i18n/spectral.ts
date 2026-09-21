import type { Bilingual } from './lang.svelte';

export const spectral = {
	ja: {
		title: 'スペクトルと指標 — Satellite Data Lab',
		h1: '02 スペクトルと指標',
		lead: '光学衛星は「波長ごとの反射率 (reflectance)」を測っています。地物によってスペクトルの形が違うので、うまくバンドを組み合わせれば植生・水・焼失跡などを 1 本の数値で切り出せます。',

		// ---- Sentinel-2 バンド表 ----
		bandsH2: 'Sentinel-2 MSI のバンド (band)',
		bandsThBand: 'バンド',
		bandsThName: '名称',
		bandsThCenter: '中心 [nm]',
		bandsThWidth: '幅 [nm]',
		bandsThRes: '分解能 [m]',
		bandsThUse: '主な用途',
		bandsNote:
			'薄い行は大気補正 (atmospheric correction) 用で、L2A 製品の解析では通常使いません。分解能が 10/20/60 m と混在している点に注意（解析時にリサンプリングが必要）。',

		// ---- 反射スペクトル ----
		specH2: '地物ごとの反射スペクトル (reflectance spectrum)',
		specAria: '反射スペクトル',
		specYAxis: '縦軸: 地表反射率',
		specNoteStrong: '読み方：',
		specNote:
			'健全な植生は赤（B4）で吸収し NIR（B8）で急上昇する「レッドエッジ (red edge)」を持つ。水は NIR 以降ほぼゼロ。雪は可視で極めて明るく SWIR で暗い。焼失跡は NIR が落ちて SWIR2 が上がる。指標はこの「差」を取り出す仕組みです。',

		// ---- 指標ビルダー ----
		idxH2: '正規化差分指標 (normalized difference index) を自分で組む',
		idxUnnamed: '名前のない組み合わせです。下の表で、どの地物を分離できそうか確認してみてください。',
		idxThCover: '地物',
		idxThValue: '指標値',

		// ---- 合成シーン ----
		sceneH2: '合成シーンでバンド合成 (band composite)・指標を見る',
		sceneLegend: '左上：山地（山頂に雪）／右上：農地（健全・乾燥・裸地）／左下：焼失跡／右下：都市／中央：川、右：湖',
		sceneRgb: 'RGB 合成',
		sceneIndex: (a: string, b: string) => `指標 (${a} − ${b})`,
		sceneGain: '表示ゲイン（コントラストストレッチ）',
		sceneIndexNote:
			'赤 (−1) → 黄 (0) → 緑 (+1) のカラーマップ。上の指標ビルダーでバンドを変えると連動します。NDVI なら植生が緑・水が赤、NDWI なら逆になることを確認してください。',
		sceneMemoStrong: '実務メモ：',
		sceneMemo:
			'反射率は 0〜1 ですが、地表の多くは 0.3 以下なので、そのまま 8bit にすると真っ暗になります。上のゲインは最も単純なストレッチ (stretch) で、実際は 2〜98 パーセンタイルなどで線形ストレッチします。また Sentinel-2 L2A の DN は <code>反射率 = (DN − 1000) / 10000</code>（2022 年 1 月の Baseline 04.00 以降のオフセット）で換算します。'
	},
	en: {
		title: 'Spectra & Indices — Satellite Data Lab',
		h1: '02 Spectra & Indices',
		lead: 'Optical satellites measure reflectance per wavelength. Each land cover has a different spectral shape, so with the right band combination you can pull out vegetation, water, burn scars and more as a single number.',

		// ---- Sentinel-2 band table ----
		bandsH2: 'Sentinel-2 MSI bands',
		bandsThBand: 'Band',
		bandsThName: 'Name',
		bandsThCenter: 'Centre [nm]',
		bandsThWidth: 'Width [nm]',
		bandsThRes: 'Resolution [m]',
		bandsThUse: 'Main use',
		bandsNote:
			'Faded rows are for atmospheric correction and are normally not used when analysing L2A products. Note the mixed 10/20/60 m resolutions (resampling is needed for analysis).',

		// ---- Reflectance spectra ----
		specH2: 'Reflectance spectra by land cover',
		specAria: 'Reflectance spectra',
		specYAxis: 'Y axis: surface reflectance',
		specNoteStrong: 'How to read it:',
		specNote:
			'Healthy vegetation absorbs in red (B4) and jumps in NIR (B8) — the “red edge”. Water is near zero from NIR onwards. Snow is extremely bright in the visible and dark in SWIR. Burn scars lose NIR and gain SWIR2. Indices are a way to extract these differences.',

		// ---- Index builder ----
		idxH2: 'Build your own normalized difference index',
		idxUnnamed: 'This combination has no name. Check the table to see which land covers it might separate.',
		idxThCover: 'Land cover',
		idxThValue: 'Index',

		// ---- Synthetic scene ----
		sceneH2: 'Band composites and indices on a synthetic scene',
		sceneLegend:
			'Top left: mountains (snow on the peak) / top right: farmland (healthy, dry, bare) / bottom left: burn scar / bottom right: city / centre: river, right: lake',
		sceneRgb: 'RGB composite',
		sceneIndex: (a: string, b: string) => `Index (${a} − ${b})`,
		sceneGain: 'Display gain (contrast stretch)',
		sceneIndexNote:
			'Colour map: red (−1) → yellow (0) → green (+1). It follows the bands chosen in the index builder above. Check that NDVI shows vegetation green and water red, and NDWI the reverse.',
		sceneMemoStrong: 'In practice:',
		sceneMemo:
			'Reflectance is 0–1, but most land surfaces are below 0.3, so mapping straight to 8 bit gives a nearly black image. The gain above is the simplest stretch; in practice you apply a linear stretch between e.g. the 2nd and 98th percentiles. Sentinel-2 L2A DNs are converted with <code>reflectance = (DN − 1000) / 10000</code> (the offset applies since processing baseline 04.00, January 2022).'
	}
} satisfies Bilingual;
