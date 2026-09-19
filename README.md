# Satellite Data Lab

エンジニア・実務者向けの「衛星データ利用」インタラクティブ教材。SvelteKit 製、Vercel にデプロイ。

## モジュール

| # | ページ | 内容 |
|---|--------|------|
| 01 | `/orbits` | 高度・観測幅から周期・再訪日数・太陽同期軌道の傾斜角を計算。軌道アニメーション |
| 02 | `/spectral` | Sentinel-2 バンド、地物の反射スペクトル、正規化指標ビルダー、合成シーンでバンド合成 |
| 03 | `/resolution` | GSD／ビット深度スライダーで画像劣化を体感。GSD × スワス散布図、ミッション比較 |
| 04 | `/stac` | STAC クエリビルダー。Earth Search（AWS）に実クエリを送りサムネイル表示。curl / Python コード生成 |
| 05 | `/formats` | COG のタイルと Range Request、Zarr のチャンク設計、処理レベル（L0〜L2A/ARD）、光学 vs SAR |
| 06 | `/imagery` | Sentinel-2 実画像を Leaflet 地図上でその場レンダリング（titiler）。バンド合成・指標・2 時期スワイプ比較・地点の DN と時系列 |

## 開発

```sh
npm install
npm run dev        # http://localhost:5173
npm run check      # 型チェック
npm run build      # Vercel 向けビルド（@sveltejs/adapter-vercel）
```

## 外部依存

- 04 STAC / 06 実画像モジュールは、ブラウザから `https://earth-search.aws.element84.com/v1`（STAC 検索）に直接リクエストします（認証不要・CORS 許可済み）。
- 06 実画像モジュールは加えて `https://titiler.xyz`（公開デモの動的タイルサーバー）と OpenStreetMap / Esri World Imagery のタイルを使用します。titiler.xyz はデモ用インスタンスのため、可用性は保証されません。
- それ以外は完全にクライアントサイドで動作します。
