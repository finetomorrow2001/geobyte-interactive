# 開発ガイド

仕様は [SPEC.md](SPEC.md)。ここでは「どう動かし、どう変更し、どう確かめるか」をまとめる。

## 1. セットアップ

```sh
npm install
npm run dev -- --port 5173   # http://localhost:5173
npm run check                # svelte-kit sync + svelte-check（型）
npm run build                # 本番ビルド（adapter-vercel）
npx vite preview --port 4173 # 本番ビルドの動作確認
```

- Node 24 / npm。依存の注意点は §5。
- デプロイは `main` への push → Vercel 自動。ローカルの `vercel --prod` は権限で拒否されるので使わない。

## 2. コードの地図

| パス | 役割 |
| --- | --- |
| `src/routes/+layout.svelte` | サイドバー（モジュール一覧 + 言語トグル） |
| `src/routes/<module>/+page.svelte` | 各モジュール。ロジック・マークアップ・CSS を 1 ファイルに |
| `src/lib/modules.ts` | モジュール一覧（タイトル・概要は `LText`） |
| `src/lib/i18n/lang.svelte.ts` | 言語ストア `i18n.lang`、`makeT()`、`L()`、`term()`、`nf()` |
| `src/lib/i18n/<page>.ts` | ページ辞書 `{ ja, en }` |
| `src/lib/orbit.ts` / `spectral.ts` / `missions.ts` | 01–03 のデータと計算 |
| `src/lib/imagery.ts` | 06: STAC 検索、合成・指標・場所の定義、COG Worker プール |
| `src/lib/cog.ts` / `cog.worker.ts` | 06: COG 読み取り（geotiff.js）、UTM→WebMercator、合成 |
| `src/lib/cog-protocol.ts` | 06: MapLibre カスタムプロトコル `cog://` |
| `src/lib/s2orbit.ts` | 06: TLE 取得、SGP4、地上軌跡、観測幅、パス予測、太陽位置 |
| `src/lib/Compass.svelte` | 06: コンパス |
| `vite.config.ts` | `optimizeDeps.exclude: ['maplibre-gl']` |

## 3. 変更のしかた

### 3.1 文字列を追加・変更する（必須手順）

すべての表示文字列は辞書経由。**日本語と英語を同時に追加**する。

```ts
// src/lib/i18n/imagery.ts
ja: { mapFoo: '観測幅 (swath) を表示', mapCount: (n: number) => `${n} 件` },
en: { mapFoo: 'Show swath',            mapCount: (n: number) => `${n} items` },
```

```svelte
{t('mapFoo')}  {t('mapCount', items.length)}
{@html t('noteBody')}   <!-- <strong>/<code> を含む文だけ。<a> や変数は入れない -->
```

- 日本語側の方針: 各パネルで初出の専門用語に英語を括弧で添える（「観測幅 (swath)」）。全部の名詞には付けない。
- データ配列の表示フィールドは `LText = { ja, en }` にして `L(x)` で描く（`imagery.ts` の `places` など）。
- 残存チェック: `grep -nP '[\p{Hiragana}\p{Katakana}\p{Han}]' src/routes/<page>/+page.svelte` でコメント以外に日本語が無いこと。

### 3.2 新しいページを足す

1. `src/routes/<name>/+page.svelte` を作り、`src/lib/i18n/<name>.ts` に辞書を用意。
2. `src/lib/modules.ts` に `{ path, title: {ja,en}, summary: {ja,en}, keywords }` を追加（ナビとトップに自動で出る）。
3. 構成は他ページに合わせる: `h1` → 導入 → `使い方 <details>` → インタラクティブ領域 → 解説 → 「ここで起きていること」。

### 3.3 06 実画像を触るときの約束

- Svelte の `$effect` 内で state を読み書きする関数を呼ぶときは `untrack()` で依存を限定する（過去に無限ループを起こした）。
- MapLibre のレイヤー順は `bg → [esri] → osm → [hillshade] → cog-a/b → footprint → orbit-* → point`。COG レイヤーは `'footprint'` の前に挿入する。
- 外部リソースは選ばれるまで読まない（Esri・DEM・COG）。新しいソースを足すときも同じ方針で。
- 地図全幅に広がる操作要素を置かない（右上 `.map-ui` と重なる）。
- 軌道関連の計算は `s2orbit.ts` に置き、DOM 非依存を保つ（Node で検証できる）。

## 4. 検証

### 4.1 軌道計算（Node、ブラウザ不要）

```sh
mkdir -p .tmp && cat > .tmp/t.mts <<'EOF'
import { twoline2satrec } from 'satellite.js';
import * as o from '../src/lib/s2orbit.ts';
const L = ['1 40697U ...', '2 40697 ...'];            // 最新 TLE を貼る
const tle: any = { id: 'sentinel-2a', line1: L[0], line2: L[1], epoch: new Date(), rec: twoline2satrec(L[0], L[1]) };
const passes = o.predictPasses([tle], 35.64, 139.40, new Date(), 10);
console.log(passes.filter(p => p.descending && p.inSwath).map(p => [p.time.toISOString(), p.crossTrackKm.toFixed(0)]));
EOF
node --experimental-strip-types .tmp/t.mts; rm -rf .tmp
```

期待値: STAC の `datetime` と数秒以内で一致（2026-09-20 の実測は 0.2 秒差）。`sunPosition()` も STAC の `view:sun_azimuth / sun_elevation` と 0.1° 以内。

### 4.2 ブラウザ

手で確認する順番:

1. `/imagery` を開く → OSM だけ読まれ、`arcgisonline` / `elevation-tiles-prod` へのリクエストが **無い**（DevTools Network）。
2. 「衛星写真」→ Esri タイル、「3D」→ terrarium タイルが初めて読まれる。
3. 「🛰 軌道」の時刻バー: 目盛りクリック → 画像 A が切り替わりトーストが出る。+1h では画像は変わらず「表示中の画像 … 前の静止画」の値だけ進む。
4. サムネイル「B」→ 橙の境界線と「A ◀ ▶ B」つまみ。ドラッグで境界が動き、右上 UI と重ならない。
5. 言語トグル → 全ページで日本語が残らない（下のスニペット）。

ブラウザコンソールで残存日本語を数える:

```js
const jp=/[぀-ヿ一-鿿]/, w=document.createTreeWalker(document.querySelector('main'),NodeFilter.SHOW_TEXT), out=[]; let n;
while((n=w.nextNode())){const s=n.textContent.trim(); if(s&&jp.test(s)) out.push(s.slice(0,60));} out
```

### 4.3 ハマりどころ（検証時）

- **非表示タブでは MapLibre が初期化されない**（`requestAnimationFrame` が止まるため）。自動化で叩くときはタブを前面にするか、`window.requestAnimationFrame = cb => setTimeout(() => cb(performance.now()), 16)` を先に流してからクライアントサイド遷移で再マウントする。
- Chrome 拡張のスクリーンショットが使えない環境では、macOS の `screencapture -x /tmp/s.png` + `sips -c 高さ 幅 --cropOffset y x` で切り出す（ターミナルに画面収録権限が必要）。
- 本番ビルドの確認は `vite preview`。dev サーバーと Worker の扱いが異なるので、MapLibre / COG Worker 周りを触ったら必ずビルドも通す。

## 5. 依存関係の注意

| パッケージ | 注意 |
| --- | --- |
| `maplibre-gl` v6 | Worker が別ファイル。`import url from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'` → `setWorkerUrl(url)`。`optimizeDeps.exclude` 必須。SSR 不可のため `onMount` で動的 import |
| `satellite.js` | **6.x 固定**。7.x は WASM/pthreads ビルドが `node:worker_threads` を含み `vite build` が失敗する |
| `geotiff` v3 | Worker 内で使用。`fetch` をラップして Range Request 数を数えている（`cog.worker.ts`） |
| `@types/geojson` | ページで `GeoJSON.Feature` 型を使うため devDependency |

## 6. 外部サービスと CORS

| サービス | 用途 | CORS | 備考 |
| --- | --- | --- | --- |
| Earth Search STAC v1 | シーン検索 / Item 取得 | ○ | 認証不要 |
| `sentinel-cogs` S3 | COG（Range Request） | ○ | `206 Partial Content` |
| OpenStreetMap tiles | ベースマップ | ○ | 利用ポリシーに従い常識的な量で |
| Esri World Imagery | 衛星写真ベースマップ | ○ | 選択時のみ |
| AWS Terrain Tiles (terrarium) | 3D 標高 | ○ | 選択時のみ、キー不要 |
| CelesTrak `gp.php` | TLE | ○ | 同じデータの再取得は 2 時間以上空ける（6 時間キャッシュ + 同梱スナップショット） |
