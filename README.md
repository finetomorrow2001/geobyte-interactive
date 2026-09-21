# Satellite Data Lab

エンジニア・実務者向けの「衛星データ利用」インタラクティブ教材。SvelteKit 製、Vercel にデプロイ。日本語 / English 切替対応。

- 本番: https://geobyte-interactive.vercel.app
- 仕様書: [docs/SPEC.md](docs/SPEC.md) ／ 開発ガイド: [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)

## モジュール

| # | ページ | 内容 |
|---|--------|------|
| 01 | `/orbits` | 高度・観測幅 (swath) から周期・再訪日数・太陽同期軌道の傾斜角を計算。軌道アニメーション |
| 02 | `/spectral` | Sentinel-2 バンド、地物の反射スペクトル、正規化指標ビルダー、合成シーンでバンド合成 |
| 03 | `/resolution` | GSD／ビット深度スライダーで画像劣化を体感。GSD × スワス散布図、ミッション比較 |
| 04 | `/stac` | STAC クエリビルダー。Earth Search（AWS）に実クエリを送りサムネイル表示。curl / Python コード生成 |
| 05 | `/formats` | COG のタイルと Range Request、Zarr のチャンク設計、処理レベル（L0〜L2A/ARD）、光学 vs SAR |
| 06 | `/imagery` | Sentinel-2 実画像を **MapLibre GL の 3D 地図**上でその場レンダリング。ブラウザが geotiff.js で COG を直接 Range Request し、再投影・バンド合成・指標計算を Web Worker で実行。2 時期比較（A ◀▶ B）、地点の DN と時系列。**実 TLE から SGP4 で計算した Sentinel-2A/2B/2C のリアルタイム位置・軌道直下・観測幅 290 km**、時刻スクラブ（画像は撮影時刻に同期）、次にその場所が撮影される日時の予測（STAC の 10 日回帰と照合） |

## 特徴

- **サーバーレス・鍵不要** — 公開データ（STAC・COG・TLE・地図タイル）にブラウザから直接アクセス。バックエンドも API キーも無い。
- **遅延読み込み** — 衛星写真ベースマップ・3D 標高・COG は、ユーザーが選ぶまで取得しない。
- **実データで検証** — TLE から予測した通過時刻が STAC の実撮影時刻と 0.2 秒で一致することを確認済み（2026-09-20）。

## 開発

```sh
npm install
npm run dev        # http://localhost:5173
npm run check      # 型チェック
npm run build      # Vercel 向けビルド（@sveltejs/adapter-vercel）
```

`main` への push で Vercel が自動デプロイします。文字列を追加するときは日英の辞書（`src/lib/i18n/`）に両方入れてください。詳細は [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)。

## 外部依存（すべてブラウザから直接）

| サービス | 用途 | 読込タイミング |
| --- | --- | --- |
| Earth Search STAC v1 (`earth-search.aws.element84.com`) | 04・06 のシーン検索 | 検索時 |
| Sentinel-2 COG (`sentinel-cogs.s3.us-west-2.amazonaws.com`) | 06 の画像（Range Request） | シーン選択時、表示中タイルのみ |
| OpenStreetMap タイル | 06 ベースマップ | 常時 |
| Esri World Imagery | 06 衛星写真ベースマップ | 「衛星写真」選択時のみ |
| AWS Terrain Tiles (terrarium) | 06 の 3D 標高 | 「3D」選択時のみ |
| CelesTrak (`celestrak.org`) | 06 の Sentinel-2 TLE | ページ表示時（6 時間キャッシュ、失敗時は同梱スナップショット） |

## 主な技術

SvelteKit 2 / Svelte 5 (runes) / TypeScript · MapLibre GL JS v6 · geotiff.js · satellite.js 6.x (SGP4)
