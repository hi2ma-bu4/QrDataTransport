# QrDataTransport

[![GitHub License](https://img.shields.io/github/license/hi2ma-bu4/QrDataTransport)](https://github.com/hi2ma-bu4/QrDataTransport/blob/main/LICENSE)
[![GitHub Release](https://img.shields.io/github/v/release/hi2ma-bu4/QrDataTransport)](https://github.com/hi2ma-bu4/QrDataTransport/releases)
[![GitHub Tag](https://img.shields.io/github/v/tag/hi2ma-bu4/QrDataTransport)](https://github.com/hi2ma-bu4/qrdatatransport/tags)
[![jsDelivr hits (GitHub)](https://img.shields.io/jsdelivr/gh/hy/hi2ma-bu4/QrDataTransport)](https://www.jsdelivr.com/package/gh/hi2ma-bu4/QrDataTransport)
[![GitHub repo size](https://img.shields.io/github/repo-size/hi2ma-bu4/QrDataTransport)](https://github.com/hi2ma-bu4/QrDataTransport)

QRコードを連続表示して、文字列やバイナリデータを送受信する JavaScript ライブラリです。QRフレームの生成・解析や送受信の状態管理に加え、ブラウザではQR描画・カメラ入力も扱えます。Node.js ではブラウザ機能に依存しないフレーム処理 API を利用できます。


*QRコードはデンソーウェーブの商標です。*

## 特徴

- 文字列（`string`）とバイナリ（`Uint8Array`）の送受信
- QR Code のバージョン（1〜40）と誤り訂正レベル（L/M/Q/H）の指定
- 任意で使用できるパリティフレーム（8・16・32単位）
- フレーム単位のCRC検証と、全フレーム受信後のCRC検証
- Worker による処理と、利用できない環境でのフォールバック
- Canvas へのQR描画、ブラウザカメラからの画像入力
- ファイル名を含むバイナリデータのパック／アンパック用ヘルパー

## 動作環境

- JavaScript ES Modules に対応した実行環境
- ブラウザ機能（カメラを利用する場合は `getUserMedia()` に対応したブラウザ）

カメラを利用するページは、通常 HTTPS または localhost などのセキュアコンテキストで開く必要があります。

## 通信速度

- **理論上の最大通信速度**：`算出中`


- **観測史上最速（実測値）**：`127kbps`

  観測環境:
  * qrVersion: 35
  * ecLevel: L
  * intervalMs: 70ms
  * parityMode: 8
  * cameraFps: 60

## インストール

GitHub リポジトリからインストールします。

```sh
npm install github:hi2ma-bu4/QrDataTransport
```

## Node.js での利用

Node.js では、ブラウザの Canvas やカメラに依存しない `DataApi` を利用して、ワイヤーフレームの生成・解析・復元を行えます。パッケージは ES Modules 形式です。

```js
import { DataApi } from "qrdatatransport";

// 文字列を QR フレームに分割
const encoded = DataApi.encodeText("こんにちは、Node.js!", 5, "m", 0);
const wireFrames = encoded.frames.map((frame) => frame.wireBytes);

// 受信したフレームからデータを復元
const decoded = DataApi.decodeFrames(wireFrames);
console.log(decoded.type); // "string"
console.log(decoded.data); // "こんにちは、Node.js!"
```

バイナリデータの場合は `DataApi.encodeBytes(bytes, qrVersion, ecLevel, parityMode)` を使用します。`DataApi.decodeFrames()` には、受信したワイヤーフレームを `Uint8Array[]` として渡してください。フレームの読み取り順や不足フレームの補完は、利用側で管理する必要があります。

`DataApi.generateQrMatrix()` はワイヤーフレームから QR モジュール行列を生成し、`DataApi.decodeQrImage()` は RGBA ピクセルデータからワイヤーデータを読み取ります。Node.js で画像ファイルの読み込み・QR画像の描画を行う場合は、画像や Canvas に対応する外部ライブラリを別途用意してください。

`TransportApi` も利用できます。ブラウザランタイムを渡さずに使用する場合、QR の Canvas 描画やカメラ起動は行われません。送信・受信処理を Worker で実行する場合は、Node.js の `worker_threads` に対応した Worker の URL（`workerUrl`）または独自の `createWorker` を設定してください。Worker を利用できない場合の直接実行へのフォールバックも設定できます。

## 使用例

### QRコードを送信する

HTML:

```html
<canvas id="qr-canvas"></canvas>
<button id="stop-send" type="button">送信停止</button>
```

JavaScript:

```js
import { BrowserRuntimeApi, TransportApi } from "qrdatatransport";

const runtime = new BrowserRuntimeApi();
const transport = new TransportApi(undefined, runtime);

transport.onSendProgress(({ index, maxIndex }) => {
  console.log(`フレーム ${index}/${maxIndex}`);
});

transport.onError((error) => {
  console.error(error.code, error.message);
});

await transport.startSend("こんにちは、QrDataTransport!", {
  qrVersion: 5,
  ecLevel: "m",
  intervalMs: 100,
  parityMode: 0,
  canvas: "qr-canvas",
  renderOptions: {
    width: 300,
    height: 300,
  },
});

document.getElementById("stop-send").addEventListener("click", () => {
  transport.stopSend();
});
```

`startSend()` には `string` または `Uint8Array` を渡せます。送信はフレームを繰り返し表示し、`stopSend()` で停止します。`intervalMs` はフレーム間隔をミリ秒で指定します。

### QRコードを受信する

`startReceive()` は受信状態を初期化しますが、カメラ自体は起動しません。カメラを別途起動し、取得した RGBA ピクセルデータを `processImageFrame()` に渡します。

HTML:

```html
<canvas id="camera-preview"></canvas>
```

JavaScript:

```js
import { BrowserRuntimeApi, TransportApi } from "qrdatatransport";

const runtime = new BrowserRuntimeApi();
const transport = new TransportApi(undefined, runtime);

transport.onComplete((result) => {
  if (result.type === "string") {
    console.log("受信した文字列:", result.data);
  } else {
    console.log("受信したバイナリ:", result.data);
  }
});

transport.onWarning((warning) => {
  console.warn(warning.code, warning.message);
});

transport.onError((error) => {
  console.error(error.code, error.message);
});

await transport.startReceive();

await runtime.startCamera(
  (rgbaPixels, width, height) => {
    void transport.processImageFrame(rgbaPixels, width, height);
  },
  {
    previewCanvas: "camera-preview",
    facingMode: "environment",
    fps: 30,
  },
);

// 受信を終了するとき
// transport.stopReceive();
```

別のQRスキャナーでワイヤーフレームを取得する場合は、`processFrame(wireBytes)` にフレームの `Uint8Array` を直接渡すこともできます。

### ファイルを送受信する

`BrowserRuntimeApi.packFileToUint8Array()` はファイル名とファイル内容を `Uint8Array` にまとめます。送信側では、その戻り値を `startSend()` に渡します。

> [!TIP]
> これは、ファイル共有の独自実装を作成する手前を省きたい人用の簡易実装です。
>
> 実際に使用する際はご自身の環境で使用可能な圧縮ライブラリなどを使用する事を推奨します。

```js
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
```

受信側では `onComplete()` の結果からファイル名とデータを復元できます。

```js
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

ファイル用ヘルパーのデータ形式は、ファイル名のUTF-8バイト長（2バイト・ビッグエンディアン）、UTF-8のファイル名、ファイル本体の順です。ファイル名のUTF-8表現は最大65,535バイトです。`Uint8Array` を直接使う場合、この形式を使う必要はありません。

## API

### `TransportApi`

送信・受信のフレーム管理を行います。

| メソッド | 説明 |
| --- | --- |
| `startSend(data, options?)` | 文字列またはバイナリデータの送信を開始します。 |
| `stopSend()` | 送信を停止します。 |
| `getCurrentSendFrame()` | 現在表示対象のワイヤーフレームを返します。 |
| `startReceive(options?)` | 受信処理を初期化します。カメラは起動しません。 |
| `processImageFrame(pixels, width, height)` | RGBA画像からQRコードを読み取り、フレームを処理します。 |
| `processFrame(wireBytes)` | ワイヤーフレームを直接処理します。 |
| `stopReceive()` | 受信を停止し、接続されたランタイムのカメラも停止します。 |
| `getState()` | 現在の送受信状態を返します。 |
| `getConfig()` | 設定オブジェクトを返します。 |

イベント登録メソッド:

- `onSendProgress(callback)` — 送信フレーム番号と総フレーム数
- `onFrameProcessed(callback)` — 受信フレーム数、保留数、QR検出状態、推定ビットレート
- `onComplete(callback)` — 全フレームの受信と全体CRC検証が完了したときの結果
- `onWarning(callback)` — 非致命的な警告
- `onError(callback)` — エラー情報（コード、メッセージ、`critical`）

### `BrowserRuntimeApi`

ブラウザ固有のQR描画、カメラ入力、ファイルヘルパーを提供します。

- `renderQrModuleMatrix()` — QRモジュール行列をCanvasに描画
- `startCamera()` / `stopCamera()` — カメラ入力の開始・停止
- `getAvailableVideoDevices()` — 利用可能なカメラデバイスを取得
- `packFileToUint8Array(file)` — ファイル名と内容をバイナリにパック
- `unpackUint8ArrayToFile(data)` — パックされたデータからファイル名と内容を復元

### `DataApi`

フレームを直接扱う低レベルAPIです。

```js
import { DataApi } from "qrdatatransport";

const encoded = DataApi.encodeText("Hello", 5, "m", 0);
// バイナリの場合: DataApi.encodeBytes(bytes, 5, "m", 0)
const wireFrames = encoded.frames.map((frame) => frame.wireBytes);
const decoded = DataApi.decodeFrames(wireFrames);
```

主なメソッド:

- `encodeText()` / `encodeBytes()` — 文字列／バイナリをワイヤーフレームに変換
- `decodeFrames()` — 順番に並んだワイヤーフレーム群をデコード
- `parseFrame()` — ワイヤーフレームを解析
- `generateQrMatrix()` — ワイヤーフレームからQRモジュール行列を生成
- `decodeQrImage()` — RGBA画像からQRコードのワイヤーデータを読み取り

## 設定

`AppConfig` でデフォルト設定を指定できます。

```js
import { AppConfig, BrowserRuntimeApi, TransportApi } from "qrdatatransport";

const config = new AppConfig({
  transport: {
    intervalMs: 100,
    useWorker: true,
    maxConsecutiveCrcErrors: 16,
    maxPendingFramesBeforeFirst: 256,
  },
  data: {
    qrVersion: 5,
    ecLevel: "m",
    parityMode: 0,
  },
  browserRuntime: {
    cameraFps: 30,
    renderFps: 10,
    decodeFrequency: 10,
    facingMode: "environment",
  },
});

const transport = new TransportApi(config, new BrowserRuntimeApi());
```

主な設定項目:

- `transport.useWorker` — Workerを利用するか（既定値 `true`）
- `transport.maxConsecutiveCrcErrors` — 連続CRCエラーの上限（既定値 `16`、`0` で上限なし）
- `transport.maxPendingFramesBeforeFirst` — 先頭フレーム受信前に一時保留するフレーム数の上限（既定値 `256`）
- `data.qrVersion` — QR Code バージョン（1〜40）
- `data.ecLevel` — 誤り訂正レベル（`"l"` / `"m"` / `"q"` / `"h"`）
- `data.parityMode` — パリティ設定（`0` / `8` / `16` / `32`）
- `browserRuntime.facingMode` — カメラの向きの指定（既定値 `"environment"`）

## 開発

ビルドには Node.js/npm に加え、Rustツールチェーン、`wasm32-wasip1` ターゲット、`cargo-component`、`jco` が必要です。

```sh
npm install
npm run build
npm test
```

- `npm run build` — Rust/WASMプロトコルコンポーネントのビルド、WASMの変換、TypeScriptの型チェック、配布用JavaScript・型定義ファイルの生成
- `npm test` — WASMおよびNode.jsのテストを実行
