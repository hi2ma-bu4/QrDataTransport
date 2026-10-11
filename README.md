# QrDataTransport

[![GitHub License](https://img.shields.io/github/license/hi2ma-bu4/QrDataTransport)](https://github.com/hi2ma-bu4/QrDataTransport/blob/main/LICENSE)
[![GitHub Release](https://img.shields.io/github/v/release/hi2ma-bu4/QrDataTransport)](https://github.com/hi2ma-bu4/QrDataTransport/releases)
[![GitHub Tag](https://img.shields.io/github/v/tag/hi2ma-bu4/QrDataTransport)](https://github.com/hi2ma-bu4/qrdatatransport/tags)
[![jsDelivr hits (GitHub)](https://img.shields.io/jsdelivr/gh/hy/hi2ma-bu4/QrDataTransport)](https://www.jsdelivr.com/package/gh/hi2ma-bu4/QrDataTransport)
[![GitHub repo size](https://img.shields.io/github/repo-size/hi2ma-bu4/QrDataTransport)](https://github.com/hi2ma-bu4/QrDataTransport)

QRコードを連続表示して、文字列やバイナリデータを高速送受信する JavaScript / TypeScript ライブラリです。WebAssembly (WASM) による高速なフレーム生成・解析・誤り訂正と、Web Worker によるマルチスレッド処理に対応しています。

*QRコードはデンソーウェーブの商標です。*

## 特徴

- **多様なデータ形式対応**：文字列（`string`）および任意のバイナリデータ（`Uint8Array`）の送受信
- **可変フレームサイズ自動制御**：QRコードのバージョン（1〜40）と誤り訂正レベル（L/M/Q/H）からフレームごとの純ペイロード容量を自動算出
- **強固なパリティ復元**：任意で設定可能なパリティフレーム（Group 8/16/32単位のXORパリティ）による欠損フレームの自動補完
- **二重のCRC保護**：個別のワイヤーフレーム単位での16-bit CRC検証に加え、全データ復元時の32-bit Overall CRC検証
- **ノンブロッキングUI**：Web Worker によるエンコード／デコード非同期オフロードと、非対応環境での自動フォールバック
- **完全なマルチプラットフォーム**：ブラウザ（Canvas描画・カメラ入力・リアルタイムプレビュー）および Node.js（画面・カメラ非依存のヘッドレス環境）の双方を完全サポート
- **簡易ファイルパッキング機能**：ファイル名を含むバイナリデータのパック／アンパック用ヘルパーを標準提供

## 動作環境

- JavaScript ES Modules (ESM) に対応した実行環境 (Node.js 18+ / モダンブラウザ)
- ブラウザカメラを使用する場合は `getUserMedia()` に対応した HTTPS セキュアコンテキスト（または `localhost`）

## 通信速度

- **理論上の最大通信速度**：`1,414 kbps` (約 176.84 KB/s)
  - **算出条件**：
    - `qrVersion`: 40
    - `ecLevel`: L
    - `intervalMs`: **16.6 ms** (約 60fps)
    - `parityMode`: **0**
    - `cameraFps`: 60

    ※1フレームを23,578bitとして計算

- **カメラ経由・パリティなし最速値（実測値）**：`1216 kbps` (152 KB/s)
  - **観測環境**：
    - `qrVersion`: 40
    - `ecLevel`: L
    - `intervalMs`: **16.6 ms** (約 60fps)
    - `parityMode`: **0**
    - `cameraFps`: 60

- **カメラ経由なしパリティあり最速値（実測値）**：`291 kbps` (約 36.37 KB/s)
  - **観測環境**：
    - `qrVersion`: 40
    - `ecLevel`: L
    - `intervalMs`: **80 ms** (約 12.5fps)
    - `parityMode`: **8**
    - `cameraFps`: 60

- **観測史上最速（実測値）**：`179 kbps` (22.38 KB/s)
  - **観測環境**：
    - `qrVersion`: 40
    - `ecLevel`: L
    - `intervalMs`: **80 ms** (約 12.5fps)
    - `parityMode`: **8**
    - `cameraFps`: 60

  > `カメラ経由なしパリティあり最速値`の 約 61.5% (約 38.5%低速)

## インストール

GitHub リポジトリから直接インストールします。

```sh
npm install github:hi2ma-bu4/QrDataTransport
```

## 使用例

### 1. QRコードを送信する（ブラウザ）

`TransportApi` の `startSend()` を呼び出すことで、指定された `intervalMs` ごとにQRコードフレームが自動で更新・描画されます。

HTML:

```html
<canvas id="qr-canvas"></canvas>
<button id="stop-send" type="button">送信停止</button>
```

JavaScript / TypeScript:

```js
import { BrowserRuntimeApi, TransportApi } from "qrdatatransport";

const runtime = new BrowserRuntimeApi();
const transport = new TransportApi(undefined, runtime);

// 進捗イベントのリスナー登録
transport.onSendProgress(({ index, maxIndex }) => {
  console.log(`送信中: ${index} / ${maxIndex} フレーム`);
});

transport.onError((error) => {
  console.error("送信エラー:", error.code, error.message);
});

// 送信開始
await transport.startSend("こんにちは、QrDataTransport!", {
  qrVersion: 5,
  ecLevel: "m",
  intervalMs: 100,
  parityMode: 0,
  canvas: "qr-canvas",
  renderOptions: {
    width: 300,
    height: 300,
    darkColor: "#000000",
    lightColor: "#ffffff",
  },
});

document.getElementById("stop-send").addEventListener("click", () => {
  transport.stopSend();
});
```

### 2. QRコードを受信する（ブラウザカメラ）

`startReceive()` で受信状態を開始し、`runtime.startCamera()` でカメラキャプチャを開始して `processImageFrame()` へピクセルデータを渡します。

HTML:

```html
<canvas id="camera-preview"></canvas>
```

JavaScript / TypeScript:

```js
import { BrowserRuntimeApi, TransportApi } from "qrdatatransport";

const runtime = new BrowserRuntimeApi();
const transport = new TransportApi(undefined, runtime);

// フレーム毎のリアルタイム処理進捗リスナー
transport.onFrameProcessed(({ validCount, pendingCount, totalCount, isQrDetected, bps }) => {
  console.log(`受信状況: ${validCount}/${totalCount} 検出:${isQrDetected} 速度:${bps} bps`);
});

// 受信完了イベントのリスナー
transport.onComplete((result) => {
  if (result.type === "string") {
    console.log("受信完了（文字列）:", result.data);
  } else {
    console.log("受信完了（バイナリ）:", result.data);
  }
});

transport.onWarning((warning) => {
  console.warn("警告:", warning.code, warning.message);
});

transport.onError((error) => {
  console.error("エラー:", error.code, error.message);
});

// 受信初期化
await transport.startReceive({
  maxConsecutiveCrcErrors: 16,
  useWorker: true,
});

// カメラ起動とフレーム処理ループ
await runtime.startCamera(
  (rgbaPixels, width, height) => {
    void transport.processImageFrame(rgbaPixels, width, height);
  },
  {
    previewCanvas: "camera-preview",
    facingMode: "environment",
    fps: 60,
  },
);

// 受信終了時
// transport.stopReceive();
```

### 3. ファイルを送受信する

`BrowserRuntimeApi.packFileToUint8Array()` はファイル名とファイル内容を `Uint8Array` にまとめます。送信側では、その戻り値を `startSend()` に渡します。

> [!TIP]
> これは、ファイル共有の独自実装を作成する手間を省きたい人用の簡易実装です。
>
> 実際に使用する際はご自身の環境で使用可能な圧縮ライブラリなどを使用する事を推奨します。

```js
// 送信側
const fileInput = document.querySelector('input[type="file"]');
const file = fileInput.files[0];
if (!file) throw new Error("ファイルを選択してください");

const packed = await BrowserRuntimeApi.packFileToUint8Array(file);
await transport.startSend(packed, {
  qrVersion: 10,
  ecLevel: "m",
  parityMode: 8,
  canvas: "qr-canvas",
});

// 受信側
transport.onComplete((result) => {
  if (result.type !== "Uint8Array") return;

  const { name, data } = BrowserRuntimeApi.unpackUint8ArrayToFile(result.data);
  const blob = new Blob([data], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
});
```

*※ファイルパッキングのバイナリフォーマット：2バイト（ビッグエンディアン）のファイル名長、UTF-8ファイル名、ファイル本体。ファイル名のUTF-8長は最大 65,535 バイトです。*

## Node.js での利用

Node.js 環境では、ブラウザ機能（DOM / Canvas / カメラ）に依存しない `DataApi` または `TransportApi` を利用できます。

```js
import { DataApi } from "qrdatatransport";

// 1. 文字列からワイヤーフレーム群へエンコード
const encoded = DataApi.encodeText("Hello Node.js Transport!", 5, "m", 0);
const wireFrames = encoded.frames.map((frame) => frame.wireBytes);

// 2. 受信したワイヤーフレーム群から復元
const decoded = DataApi.decodeFrames(wireFrames);
console.log(decoded.type); // "string"
console.log(decoded.data); // "Hello Node.js Transport!"
```

Worker 処理を Node.js で利用する場合は、`node:worker_threads` に対応した Worker スクリプト URL (`workerUrl`) またはカスタム生成関数 (`createWorker`) を設定します。

## 詳細 API リファレンス

### `TransportApi`

送受信プロトコルのステートマシン管理およびフレーム処理を制御します。

#### メソッド

- `constructor(config?: AppConfig, runtime?: RuntimeApi)`
  - 送受信の共通設定および表示・カメラ用ランタイムを渡してインスタンス化します。
- `setRuntime(runtime?: RuntimeApi): void`
  - 使用するランタイムAPIを設定・変更します。
- `startSend(data: Uint8Array | string, options?: SendOptions): Promise<void>`
  - 送信処理を開始し、タイマーでフレームを切り替え表示します。
- `stopSend(): void`
  - 送信を停止し、表示用キャンバスをクリアします。
- `getCurrentSendFrame(): Uint8Array | null`
  - 現在送信表示中のワイヤーフレームバイト配列を取得します。
- `startReceive(options?: ReceiveOptions): Promise<void>`
  - 受信状態を初期化（`WaitingForFirst`）します。
- `processImageFrame(rgbaPixels: Uint8Array, width: number, height: number): Promise<void>`
  - RGBAピクセル画像からQRコードを検出・デコードし、得られたワイヤーフレームを自動処理します。
- `processFrame(wireBytes?: Uint8Array | null): void | Promise<void>`
  - 生のワイヤーフレームバイト配列を直接処理します。
- `stopReceive(): void`
  - 受信処理を停止し、接続されているカメラを停止します。
- `getState(): TransportState`
  - 現在の状態（`"Idle"` | `"WaitingForFirst"` | `"FirstEstablished"` | `"Receiving"` | `"WaitingMissingFrames"` | `"OverallCrcVerification"` | `"Completed"` | `"Error"`）を取得します。
- `getConfig(): AppConfig`
  - 現在の設定オブジェクトを取得します。
- `getPendingPreFirstQueueLength(): number`
  - 先頭フレーム（First QR）受信前に一時保持されている先行フレームのキュー長を取得します。

#### イベント登録

- `onSendProgress(callback: (event: SendProgressEvent) => void)`: 1オリジンの送信フレームインデックス（`index`, `maxIndex`）を通知。
- `onFrameProcessed(callback: (event: FrameProcessedEvent) => void)`: フレーム処理毎のステータス情報（`validCount`, `pendingCount`, `totalCount`, `isQrDetected`, `bps`）を通知。
- `onComplete(callback: (result: DecodedResult) => void)`: 全フレームの受信とOverall CRC検証が成功した際のデータ（`type`, `data`）を通知。
- `onWarning(callback: (warning: TransportWarning) => void)`: パケット置換や First CRC 変更などの警告を通知。
- `onError(callback: (error: TransportError) => void)`: CRC不一致や上限到達などのエラーを通知。

### `BrowserRuntimeApi`

ブラウザ固有の Canvas 描画、`getUserMedia` カメラ制御、ファイルパッキングヘルパーを提供します。

#### メソッド

- `constructor(config?: BrowserRuntimeConfig | BrowserRuntimeConfigOptions)`
- `renderQrModuleMatrix(matrix: QrModuleMatrixData, options?: RenderQrOptions): void`
  - 2次元モジュール行列を指定キャンバスにレスポンシブ／アンチエイリアス無効でシャープに描画します。
- `clearCanvas(canvasTarget?: HTMLCanvasElement | string): void`
  - 指定キャンバスの描画内容をクリアします。
- `startCamera(onFrame: (rgbaPixels: Uint8Array, width: number, height: number) => void, options?: CameraOptions): Promise<void>`
  - カメラ入力を開始し、指定FPS間隔でキャプチャループを実行します。
- `stopCamera(): void`
  - カメラストリームとキャプチャループを停止します。
- `getAvailableVideoDevices(): Promise<MediaDeviceInfo[]>`
  - 利用可能なビデオ入力デバイス一覧を取得します。
- `isWorkerSupported(): boolean`
  - ブラウザ環境が Web Worker に対応しているか判定します。
- `static packFileToUint8Array(file: File): Promise<Uint8Array>`
  - ファイルオブジェクトをパッキングされた Uint8Array に変換します。
- `static unpackUint8ArrayToFile(packed: Uint8Array): { name: string; data: Uint8Array }`
  - パッキングされた Uint8Array からファイル名とデータを復元します。

### `DataApi`

プロトコルの基本変換を行うステートレスな低レベル API です。

- `static encodeText(text: string, qrVersion?: number, ecLevel?: QrEcLevel, parityMode?: number): EncodeResult`
- `static encodeBytes(data: Uint8Array, qrVersion?: number, ecLevel?: QrEcLevel, parityMode?: number): EncodeResult`
- `static parseFrame(wireBytes: Uint8Array, knownTotalQrCount?: number, knownFirstFrameCrc?: number, knownParityMode?: number): FrameMetadata`
- `static decodeFrames(wireFrames: Uint8Array[]): DecodedResult`
- `static generateQrMatrix(wireBytes: Uint8Array, qrVersion: number, ecLevel: QrEcLevel): QrModuleMatrix`
- `static decodeQrImage(rgbaPixels: Uint8Array, width: number, height: number): Uint8Array`

---

## 設定クラスとオプション

すべての設定は `AppConfig` または独立した設定クラスで個別に管理・カスタマイズできます。

```js
import { AppConfig } from "qrdatatransport";

const config = new AppConfig({
  transport: {
    maxConsecutiveCrcErrors: 16,
    maxPendingFramesBeforeFirst: 256,
    useWorker: true,
    intervalMs: 100,
    timeout: 30000,
  },
  data: {
    qrVersion: 5,
    ecLevel: "m",
    parityMode: 0,
  },
  browserRuntime: {
    cameraFps: 60,
    renderFps: 60,
    qrWidth: 300,
    qrHeight: 300,
    cameraWidth: undefined,
    cameraHeight: undefined,
    facingMode: "environment",
  },
});
```

### 項目一覧

| 設定グループ | プロパティ | 型 | 既定値 | 説明 |
| --- | --- | --- | --- | --- |
| **Transport** | `maxConsecutiveCrcErrors` | `number` | `16` | 連続CRCエラー許容上限（`0` で無制限） |
| | `maxPendingFramesBeforeFirst` | `number` | `256` | 先頭フレーム受信前の先行フレーム一時保持上限 |
| | `useWorker` | `boolean` | `true` | Web Worker によるバックグラウンド処理の利用 |
| | `intervalMs` | `number` | `100` | 送信時のフレーム表示切り替え間隔（ミリ秒） |
| | `workerUrl` | `string \| URL` | `undefined` | カスタム Worker スクリプトの URL |
| | `timeout` | `number` | `30000` | Worker タスク応答のタイムアウト（ミリ秒） |
| **Data** | `qrVersion` | `number` | `5` | QR Code バージョン（`1` 〜 `40`） |
| | `ecLevel` | `"l" \| "m" \| "q" \| "h"` | `"m"` | 誤り訂正レベル |
| | `parityMode` | `0 \| 8 \| 16 \| 32` | `0` | パリティフレーム挿入単位（`0` で無効） |
| **BrowserRuntime** | `cameraFps` | `number` | `60` | カメラキャプチャのターゲット FPS |
| | `renderFps` | `number` | `60` | QRレンダリングのターゲット FPS |
| | `qrWidth` / `qrHeight` | `number` | `300` | QR描画サイズのデフォルト寸法（ピクセル） |
| | `cameraWidth` / `cameraHeight` | `number` | `300` | カメラ描画のデフォルト寸法（ピクセル） |
| | `facingMode` | `string` | `"environment"` | カメラのデフォルト向き（`"environment"` / `"user"`） |
| | `deviceId` | `string` | `undefined` | 使用するカメラの固有デバイスID |

---

## 開発とテスト

本ライブラリのコアモジュールは Rust で記述され WebAssembly (WASM) へコンパイルされています。

### ビルド環境のセットアップ

1. Node.js (20+) および Rust ツールチェーンのインストール
2. Target および Cargo ツールの追加:
   ```sh
   rustup target add wasm32-wasip1
   cargo install cargo-component
   ```

### コマンド

```sh
# 依存関係のインストール
npm install

# WASMビルド、TypeScript型チェック、配布ファイルの生成
npm run build

# WASMユニットテストおよび Node.js テストの実行
npm test
```
