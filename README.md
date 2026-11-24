# micro:bit Firmware Distributor

WebUSB を利用して、複数の BBC micro:bit（V1 / V2）へ `.hex` ファームウェア（Universal HEX 対応）を同時並行で書き込むためのブラウザツールです。

## 主な機能

- **マルチデバイス並列書き込み**: 接続された複数の micro:bit へ `Promise.allSettled` ベースで同時にフラッシュを実行。
- **Universal HEX / V1 / V2 自動対応**: `@microbit/microbit-connection` の `createUniversalHexFlashDataSource` を利用し、V1・V2 混在環境でも自動判別して書き込みます。
- **高速差分フラッシュ (Partial Flash)**: 対応ファームウェア時は変更差分のみを高速転送（非対応時は自動的にフル書き込みへフォールバック）。
- **2回目以降のワンクリック再接続**: 一度ブラウザでペアリングした micro:bit は「許可済みを一括接続」でまとめて再接続可能。
- **リアルタイム進捗 & 個別リトライ**: デバイスごとの進捗率・所要時間・エラー内容を表示し、失敗した端末だけを再試行できます。

## 動作要件

- **ブラウザ**: Google Chrome / Microsoft Edge（WebUSB API 対応ブラウザ）
- **ハードウェア**: 複数台同時接続時は **ACアダプタ付き（セルフパワー）USBハブ** の利用を強く推奨します。
- **micro:bit ファームウェア**: DAPLink v0247 以降（V1 の極初期モデルでは DAPLink 更新が必要な場合があります）。

## 開発・起動方法

```bash
npm install
npm run dev
```

本番ビルド:

```bash
npm run build
```
