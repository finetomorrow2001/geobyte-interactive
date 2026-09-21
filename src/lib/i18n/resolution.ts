import type { Bilingual } from './lang.svelte';

export const resolution = {
	ja: {
		title: '分解能のトレードオフ — Satellite Data Lab',
		h1: '03 分解能のトレードオフ',
		lead: '「分解能 (resolution)」は 1 つではありません。<strong>空間</strong>（何 m を 1 画素で見るか）、<strong>時間</strong>（何日ごとに撮れるか）、<strong>スペクトル</strong>（何バンドをどの幅で）、<strong>放射</strong>（明るさを何段階で）。どれかを上げると別のどれかが下がります。データ量と物理（光子の数）が制約だからです。',

		// ---- 空間 × 放射 デモ ----
		demoH2: '空間分解能 × 放射分解能を体感する',
		demoCaption: '2.4 km × 2.4 km の合成シーン（トゥルーカラー）。',
		gsdLabel: '空間分解能 GSD (ground sample distance)',
		gsdValue: (m: number) => `${m} m`,
		bitsLabel: '放射分解能（ビット深度, bit depth）',
		bitsValue: (bits: number, levels: string) => `${bits} bit = ${levels} 段階`,
		gainLabel: '表示ゲイン',
		gainValue: (g: string) => `×${g}`,
		statSize: '画像サイズ',
		statSizeUnit: (n: number) => `× ${n} px`,
		statPxPerKm2: '1 km² あたり画素数',
		statDataVol: '10 m 比のデータ量',
		statStep: '反射率の刻み',
		demoNote:
			'<strong>観察ポイント：</strong> GSD を 30 m（Landsat）にすると川がまだ見えるが、100 m を超えると畝のパターンが溶ける。ビット深度を 4〜5 bit まで落とすと、水域や暗い植生が階調飛び（バンディング, banding）を起こす。多くの光学衛星が 12 bit なのは、暗い水面と明るい雪を 1 枚で飽和なく収めるため。',

		// ---- GSD vs スワス ----
		swathH2: 'GSD とスワス (swath) は反比例する',
		swathAria: 'GSD vs スワス',
		axisM: (v: number) => `${v} m`,
		axisKm: (v: string) => `${v} km`,
		axisX: '空間分解能 GSD（対数）',
		axisY: '観測幅（対数）',
		legendColor: '色：',
		typeOptical: '光学',
		typeSar: 'SAR',
		typeGeo: '静止',
		legendEnd: '。',
		legendNote:
			'点の大きさは再訪頻度（大きい = 毎日）。右上（広くて粗い）から左下（狭くて細かい）に並ぶのが分かります。左下の高分解能衛星は「毎日」再訪を謳いますが、それはポインティングして狭い範囲を撮る前提です。',

		// ---- ミッション比較表 ----
		tableH2: '主要ミッション比較',
		thMission: 'ミッション',
		thType: '種別',
		thGsd: 'GSD [m]',
		thSwath: 'スワス [km]',
		thRevisit: '再訪',
		thBands: 'バンド',
		thBits: 'bit',
		thAccess: '入手',
		revisitMin: (n: number) => `${n} 分`,
		revisitDay: (n: number) => `${n} 日`,

		// ---- 実務での選び方 ----
		useH2: '実務での選び方',
		useWideH3: '広域モニタリング',
		useWide: '森林・農地・水域の変化を国〜大陸規模で追うなら Sentinel-2 / Landsat。無償で長期アーカイブ（Landsat は 1972 年から）があり、時系列解析に向く。',
		useDisasterH3: '災害・即応',
		useDisaster: '雲や夜間を問わない SAR（Sentinel-1、ALOS-2、ICEYE）。洪水域抽出や地盤変動（InSAR）に強い。ただし解釈は光学より難しい。',
		useObjectH3: '個別物体・インフラ',
		useObject: '車両・建物単位なら 0.3〜0.5 m の商用衛星。高価で範囲が狭いため、無償データで「どこを」絞ってから注文するのが定石。'
	},
	en: {
		title: 'Resolution Trade-offs — Satellite Data Lab',
		h1: '03 Resolution Trade-offs',
		lead: 'There is no single “resolution”. <strong>Spatial</strong> (how many metres one pixel covers), <strong>temporal</strong> (how often you can image a spot), <strong>spectral</strong> (how many bands, how narrow) and <strong>radiometric</strong> (how many brightness levels). Raising one lowers another, because data volume and physics (photon count) are the constraints.',

		// ---- Spatial × radiometric demo ----
		demoH2: 'Feel spatial × radiometric resolution',
		demoCaption: 'Synthetic 2.4 km × 2.4 km scene (true colour).',
		gsdLabel: 'Spatial resolution (GSD)',
		gsdValue: (m: number) => `${m} m`,
		bitsLabel: 'Radiometric resolution (bit depth)',
		bitsValue: (bits: number, levels: string) => `${bits} bit = ${levels} levels`,
		gainLabel: 'Display gain',
		gainValue: (g: string) => `×${g}`,
		statSize: 'Image size',
		statSizeUnit: (n: number) => `× ${n} px`,
		statPxPerKm2: 'Pixels per km²',
		statDataVol: 'Data volume vs 10 m',
		statStep: 'Reflectance step',
		demoNote:
			'<strong>What to look for:</strong> at 30 m GSD (Landsat) the river is still visible; above 100 m the furrow pattern dissolves. Drop the bit depth to 4–5 bit and water and dark vegetation show banding. Most optical satellites use 12 bit so that dark water and bright snow fit in one image without saturating.',

		// ---- GSD vs swath ----
		swathH2: 'GSD and swath are inversely related',
		swathAria: 'GSD vs swath',
		axisM: (v: number) => `${v} m`,
		axisKm: (v: string) => `${v} km`,
		axisX: 'Spatial resolution GSD (log)',
		axisY: 'Swath width (log)',
		legendColor: 'Colour: ',
		typeOptical: 'Optical',
		typeSar: 'SAR',
		typeGeo: 'GEO',
		legendEnd: '.',
		legendNote:
			'Marker size is revisit frequency (large = daily). Missions line up from top-right (wide and coarse) to bottom-left (narrow and fine). The high-resolution satellites at bottom-left advertise “daily” revisit, but that assumes pointing the sensor at a small area.',

		// ---- Mission table ----
		tableH2: 'Major missions compared',
		thMission: 'Mission',
		thType: 'Type',
		thGsd: 'GSD [m]',
		thSwath: 'Swath [km]',
		thRevisit: 'Revisit',
		thBands: 'Bands',
		thBits: 'bit',
		thAccess: 'Access',
		revisitMin: (n: number) => `${n} min`,
		revisitDay: (n: number) => `${n} d`,

		// ---- Choosing in practice ----
		useH2: 'Choosing in practice',
		useWideH3: 'Wide-area monitoring',
		useWide: 'To track forest, cropland or water change at national to continental scale, use Sentinel-2 / Landsat. Free, with long archives (Landsat since 1972), well suited to time-series analysis.',
		useDisasterH3: 'Disasters and rapid response',
		useDisaster: 'SAR (Sentinel-1, ALOS-2, ICEYE) works through cloud and at night. Strong for flood-extent mapping and ground deformation (InSAR), but harder to interpret than optical.',
		useObjectH3: 'Individual objects and infrastructure',
		useObject: 'For vehicles or single buildings you need 0.3–0.5 m commercial satellites. They are expensive and narrow, so the usual approach is to narrow down “where” with free data first, then order.'
	}
} satisfies Bilingual;
