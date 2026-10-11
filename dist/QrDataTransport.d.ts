/** @module Interface snows:qr-data-transport/protocol **/
declare function encodeBytes(data: Uint8Array, maxFrameBits: number, parityMode: number): EncodeResult;
declare function encodeText(text: string, maxFrameBits: number, parityMode: number): EncodeResult;
declare function parseFrame(wireBytes: Uint8Array, knownTotalQrCount: number | undefined, knownFirstFrameCrc: number | undefined, knownParityMode: number | undefined): FrameMetadata;
declare function decodeFrames(wireFrames: Array<Uint8Array>): DecodedPayload;
declare function generateQrMatrix(wireBytes: Uint8Array, qrVersion: number, ecLevel: QrEcLevel): QrModuleMatrix;
declare function decodeQrImage(rgbaPixels: Uint8Array, width: number, height: number): Uint8Array;
/**
 * # Variants
 * 
 * ## `"uint8array"`
 * 
 * ## `"bytes-string"`
 */
type DataType = 'uint8array' | 'bytes-string';
/**
 * # Variants
 * 
 * ## `"ascii"`
 * 
 * ## `"utf8"`
 */
type StringMode = 'ascii' | 'utf8';
/**
 * # Variants
 * 
 * ## `"l"`
 * 
 * ## `"m"`
 * 
 * ## `"q"`
 * 
 * ## `"h"`
 */
type QrEcLevel = 'l' | 'm' | 'q' | 'h';
interface FrameMetadata {
  isFirst: boolean,
  isParity: boolean,
  version: number,
  totalQrCount: number,
  frameNumber: number,
  parityMode?: number,
  dataType?: DataType,
  payloadBitLen: number,
  frameCrc: number,
  overallCrc?: number,
  crcValid: boolean,
}
type DecodedPayload = DecodedPayloadBytes | DecodedPayloadText;
interface DecodedPayloadBytes {
  tag: 'bytes',
  val: Uint8Array,
}
interface DecodedPayloadText {
  tag: 'text',
  val: string,
}
interface EncodedFrameOutput {
  wireBytes: Uint8Array,
  frameNumber: number,
  totalQrCount: number,
}
interface EncodeResult {
  frames: Array<EncodedFrameOutput>,
}
interface QrModuleMatrix {
  width: number,
  height: number,
  modules: Uint8Array,
}

type snowsQrDataTransportProtocol_d_DataType = DataType;
type snowsQrDataTransportProtocol_d_DecodedPayload = DecodedPayload;
type snowsQrDataTransportProtocol_d_DecodedPayloadBytes = DecodedPayloadBytes;
type snowsQrDataTransportProtocol_d_DecodedPayloadText = DecodedPayloadText;
type snowsQrDataTransportProtocol_d_EncodeResult = EncodeResult;
type snowsQrDataTransportProtocol_d_EncodedFrameOutput = EncodedFrameOutput;
type snowsQrDataTransportProtocol_d_FrameMetadata = FrameMetadata;
type snowsQrDataTransportProtocol_d_QrEcLevel = QrEcLevel;
type snowsQrDataTransportProtocol_d_QrModuleMatrix = QrModuleMatrix;
type snowsQrDataTransportProtocol_d_StringMode = StringMode;
declare const snowsQrDataTransportProtocol_d_decodeFrames: typeof decodeFrames;
declare const snowsQrDataTransportProtocol_d_decodeQrImage: typeof decodeQrImage;
declare const snowsQrDataTransportProtocol_d_encodeBytes: typeof encodeBytes;
declare const snowsQrDataTransportProtocol_d_encodeText: typeof encodeText;
declare const snowsQrDataTransportProtocol_d_generateQrMatrix: typeof generateQrMatrix;
declare const snowsQrDataTransportProtocol_d_parseFrame: typeof parseFrame;
declare namespace snowsQrDataTransportProtocol_d {
  export { snowsQrDataTransportProtocol_d_decodeFrames as decodeFrames, snowsQrDataTransportProtocol_d_decodeQrImage as decodeQrImage, snowsQrDataTransportProtocol_d_encodeBytes as encodeBytes, snowsQrDataTransportProtocol_d_encodeText as encodeText, snowsQrDataTransportProtocol_d_generateQrMatrix as generateQrMatrix, snowsQrDataTransportProtocol_d_parseFrame as parseFrame };
  export type { snowsQrDataTransportProtocol_d_DataType as DataType, snowsQrDataTransportProtocol_d_DecodedPayload as DecodedPayload, snowsQrDataTransportProtocol_d_DecodedPayloadBytes as DecodedPayloadBytes, snowsQrDataTransportProtocol_d_DecodedPayloadText as DecodedPayloadText, snowsQrDataTransportProtocol_d_EncodeResult as EncodeResult, snowsQrDataTransportProtocol_d_EncodedFrameOutput as EncodedFrameOutput, snowsQrDataTransportProtocol_d_FrameMetadata as FrameMetadata, snowsQrDataTransportProtocol_d_QrEcLevel as QrEcLevel, snowsQrDataTransportProtocol_d_QrModuleMatrix as QrModuleMatrix, snowsQrDataTransportProtocol_d_StringMode as StringMode };
}

/**
 * Workerリクエスト種別
 */
type WorkerRequestType = "parseFrame" | "decodeFrames" | "encodeBytes" | "encodeText" | "decodeQrImage" | "__QRDT_WORKER_PING__" | "__QRDT_WORKER_READY__";
/**
 * Workerリクエストメッセージ
 */
interface WorkerRequestMessage {
    /**
     * リクエストID
     */
    id: string;
    /**
     * リクエスト種別
     */
    type: WorkerRequestType;
    /**
     * ペイロードデータ
     */
    payload: any;
}
/**
 * Workerレスポンスメッセージ
 */
interface WorkerResponseMessage {
    /**
     * リクエストID
     */
    id: string;
    /**
     * レスポンス種別
     */
    type: string;
    /**
     * 成功フラグ
     */
    success: boolean;
    /**
     * 実行結果データ
     */
    result?: any;
    /**
     * エラーメッセージ
     */
    error?: string;
}
/**
 * Workerモード
 */
type WorkerMode = "auto" | "module" | "classic";
/**
 * Workerライクインターフェース
 */
type WorkerLike = {
    postMessage(message: any, transfer?: Transferable[]): void;
    terminate(): unknown;
    addEventListener?: (type: string, listener: (event: any) => void) => void;
    removeEventListener?: (type: string, listener: (event: any) => void) => void;
    on?: (type: string, listener: (...args: any[]) => void) => unknown;
    off?: (type: string, listener: (...args: any[]) => void) => unknown;
};
/**
 * WorkerClient設定オプション
 */
interface WorkerClientOptions {
    /**
     * Workerを使用するかどうか（既定値: false）
     */
    enabled?: boolean;
    /**
     * Worker失敗時に直接実行へフォールバックするかどうか（既定値: true）
     */
    fallback?: boolean;
    /**
     * WorkerのURL（Node.js環境では原則指定が必要）
     */
    workerUrl?: string | URL;
    /**
     * カスタムWorker生成関数
     */
    createWorker?: () => WorkerLike | Promise<WorkerLike>;
    /**
     * ブラウザWorkerの形式（既定値: 'auto'）
     */
    workerType?: WorkerMode;
    /**
     * Worker応答タイムアウト時間（ミリ秒、既定値: 30000ms）
     */
    timeout?: number;
    /**
     * ライブラリファイル名（既定値: 'QrDataTransport'）
     */
    libraryFileName?: string;
}
/**
 * Web Worker通信クライアントクラス
 */
declare class WorkerClient {
    /**
     * 保持するWorkerインスタンス
     */
    private worker;
    /**
     * 登録されたイベントリスナー群
     */
    private listeners;
    /**
     * Worker生成Promise
     */
    private creating;
    /**
     * 破棄済みフラグ
     */
    private disposed;
    /**
     * 失敗フラグ
     */
    private failed;
    /**
     * シーケンス番号
     */
    private sequence;
    /**
     * Worker準備完了リゾルバ
     */
    private workerReadyResolver;
    /**
     * 準備確認中のWorkerインスタンス
     */
    private workerReadyWorker;
    /**
     * 保留中のタスクマップ
     */
    private readonly pending;
    /**
     * 有効化フラグ
     */
    private readonly enabled;
    /**
     * フォールバック許可フラグ
     */
    private readonly fallback;
    /**
     * タイムアウト時間（ミリ秒）
     */
    private readonly timeout;
    /**
     * クライアント設定オプション
     */
    private readonly options;
    /**
     * WorkerClientのインスタンスを生成
     *
     * @param options - WorkerClient設定オプション
     */
    constructor(options?: WorkerClientOptions);
    /**
     * 破棄済みかどうかを取得
     *
     * @returns 破棄済みの場合はtrue
     */
    get isDisposed(): boolean;
    /**
     * Workerが利用可能かどうかを取得
     *
     * @returns 利用可能な場合はtrue
     */
    get isWorkerAvailable(): boolean;
    /**
     * ユニークなリクエストIDを生成
     *
     * @returns リクエストID文字列
     */
    private nextId;
    /**
     * Workerインスタンスを取得または生成
     *
     * @returns WorkerLikeインスタンス
     */
    private getWorker;
    /**
     * Workerイベントリスナーを設定
     *
     * @param worker - 対象のWorkerインスタンス
     */
    private attachListeners;
    /**
     * Workerの準備完了メッセージを待機
     *
     * @param worker - 対象のWorkerインスタンス
     */
    private waitForWorkerReady;
    /**
     * Workerイベントリスナーを解除
     *
     * @param worker - 対象のWorkerインスタンス
     */
    private detachListeners;
    /**
     * 失敗タスクのフォールバック処理を実行
     *
     * @param id - タスクID
     * @param task - 保留中タスク
     */
    private settleFallback;
    /**
     * Worker障害発生時の状態切り替え処理
     *
     * @param error - 発生したエラー
     */
    private failWorker;
    /**
     * Workerリクエストを送信
     *
     * @param type - リクエスト種別
     * @param payload - ペイロードデータ
     * @param transfer - 転送可能オブジェクト配列
     * @param fallbackPayload - フォールバック時ペイロード
     * @returns 処理結果プロミス
     */
    request(type: WorkerRequestType, payload: any, transfer?: Transferable[], fallbackPayload?: any): Promise<any>;
    /**
     * メインスレッド同期フォールバックの実行
     *
     * @param type - リクエスト種別
     * @param payload - ペイロードデータ
     * @returns 実行結果プロミス
     */
    private executeFallback;
    /**
     * QRコード画像ピクセルをWorker経由でデコード
     *
     * @param rgbaPixels - RGBAピクセルバイト配列
     * @param width - 画像幅
     * @param height - 画像高さ
     * @returns デコードされたワイヤーフレームバイト列
     */
    decodeQrImage(rgbaPixels: Uint8Array, width: number, height: number): Promise<Uint8Array>;
    /**
     * WorkerClientリソースを破棄
     */
    dispose(): void;
}
/**
 * Workerリクエストメッセージを処理
 *
 * @param msg - Workerリクエストメッセージ
 * @returns 処理レスポンスメッセージ
 */
declare function handleWorkerMessage(msg: WorkerRequestMessage): Promise<WorkerResponseMessage>;
/**
 * Worker環境での自己メッセージリスナーをセットアップ
 *
 * ブラウザ Worker / Node.js worker_threads でのみ受信ハンドラーを登録します。
 * メインスレッドでは何も登録しません。
 */
declare function setupWorkerSelfListener(): Promise<void>;

/**
 * パリティモード列挙型
 *
 * QRコード送信用パリティインターリーブ設定
 */
declare enum ParityMode {
    /**
     * パリティなし (0)
     */
    None = 0,
    /**
     * グループサイズ 8 (パリティフレーム自動追加)
     */
    Group8 = 8,
    /**
     * グループサイズ 16 (パリティフレーム自動追加)
     */
    Group16 = 16,
    /**
     * グループサイズ 32 (パリティフレーム自動追加)
     */
    Group32 = 32
}
/**
 * トランスポート設定オプション
 */
interface TransportConfigOptions {
    /**
     * 許容する連続CRCエラーの最大回数 (0指定で無制限)
     */
    maxConsecutiveCrcErrors?: number;
    /**
     * First QR受信前に保持する保留フレームの最大数
     */
    maxPendingFramesBeforeFirst?: number;
    /**
     * Web Workerを使用するかどうか
     */
    useWorker?: boolean;
    /**
     * 送信時のフレーム描画間隔（ミリ秒）
     */
    intervalMs?: number;
    /**
     * WorkerのスクリプトURL
     */
    workerUrl?: string | URL;
    /**
     * カスタムWorker生成関数
     */
    createWorker?: WorkerClientOptions["createWorker"];
    /**
     * Workerの実行タイプ
     */
    workerType?: WorkerClientOptions["workerType"];
    /**
     * Workerリクエストのタイムアウト時間（ミリ秒）
     */
    timeout?: number;
}
/**
 * トランスポート層設定クラス
 */
declare class TransportConfig {
    /**
     * 許容する連続CRCエラーの最大回数
     *
     * 0は無制限を意味し、負の値は無効。デフォルト値は16。
     */
    maxConsecutiveCrcErrors: number;
    /**
     * First QR受信前に保持する保留フレームの最大数
     *
     * デフォルト値は256。
     */
    maxPendingFramesBeforeFirst: number;
    /**
     * Web Workerを使用するかどうか
     *
     * デフォルト値はtrue。
     */
    useWorker: boolean;
    /**
     * 送信時のフレーム描画間隔（ミリ秒）
     *
     * デフォルト値は100ms。
     */
    intervalMs: number;
    /**
     * WorkerのスクリプトURL
     */
    workerUrl?: string | URL;
    /**
     * カスタムWorker生成関数
     */
    createWorker?: WorkerClientOptions["createWorker"];
    /**
     * Workerの実行タイプ
     */
    workerType?: WorkerClientOptions["workerType"];
    /**
     * Workerリクエストのタイムアウト時間（ミリ秒）
     */
    timeout?: number;
    /**
     * TransportConfigのインスタンスを生成
     *
     * @param options - 設定オプション
     */
    constructor(options?: TransportConfigOptions);
    /**
     * 設定オブジェクトを複製
     *
     * @returns 複製されたTransportConfigインスタンス
     */
    clone(): TransportConfig;
}
/**
 * データエンコード設定オプション
 */
interface DataConfigOptions {
    /**
     * QRコードバージョン (1 ~ 40)
     */
    qrVersion?: number;
    /**
     * QRコード誤り訂正レベル ('l', 'm', 'q', 'h')
     */
    ecLevel?: QrEcLevel;
    /**
     * パリティモード (0, 8, 16, 32)
     */
    parityMode?: ParityMode | 0 | 8 | 16 | 32;
}
/**
 * データエンコード設定クラス
 */
declare class DataConfig {
    /**
     * QRコードバージョン (1 ~ 40)
     *
     * デフォルト値は5。
     */
    qrVersion: number;
    /**
     * QRコード誤り訂正レベル ('l', 'm', 'q', 'h')
     *
     * デフォルト値は'm'。
     */
    ecLevel: QrEcLevel;
    /**
     * パリティモード (0, 8, 16, 32)
     *
     * デフォルト値はParityMode.None (0)。
     */
    parityMode: ParityMode;
    /**
     * DataConfigのインスタンスを生成
     *
     * @param options - 設定オプション
     */
    constructor(options?: DataConfigOptions);
    /**
     * 1フレームあたりの最大ビット数を取得
     *
     * qrVersionとecLevelから自動算出されるワイヤーフレームの最大ビット数。
     *
     * @returns 最大ビット数
     */
    get maxFrameBits(): number;
    /**
     * 設定オブジェクトを複製
     *
     * @returns 複製されたDataConfigインスタンス
     */
    clone(): DataConfig;
}
/**
 * ブラウザランタイム設定オプション
 */
interface BrowserRuntimeConfigOptions {
    /**
     * 描画フレームレート (fps)
     */
    renderFps?: number;
    /**
     * カメラフレームレート (fps)
     */
    cameraFps?: number;
    /**
     * QRコード描画幅 (ピクセル)
     */
    qrWidth?: number;
    /**
     * QRコード描画高さ (ピクセル)
     */
    qrHeight?: number;
    /**
     * カメラ幅 (ピクセル)
     */
    cameraWidth?: number;
    /**
     * カメラ高さ (ピクセル)
     */
    cameraHeight?: number;
    /**
     * カメラの向き ("environment" | "user" | string)
     */
    facingMode?: "environment" | "user" | string;
    /**
     * カメラのデバイスID
     */
    deviceId?: string;
}
/**
 * ブラウザランタイム設定クラス
 */
declare class BrowserRuntimeConfig {
    /**
     * 描画フレームレート (fps)
     */
    renderFps: number;
    /**
     * カメラフレームレート (fps)
     */
    cameraFps: number;
    /**
     * QRコード描画幅 (ピクセル)
     */
    qrWidth: number;
    /**
     * QRコード描画高さ (ピクセル)
     */
    qrHeight: number;
    /**
     * カメラ幅 (ピクセル)
     */
    cameraWidth: number | undefined;
    /**
     * カメラ高さ (ピクセル)
     */
    cameraHeight: number | undefined;
    /**
     * カメラの向き ("environment" | "user" | string)
     */
    facingMode: "environment" | "user" | string;
    /**
     * カメラのデバイスID
     */
    deviceId?: string;
    /**
     * BrowserRuntimeConfigのインスタンスを生成
     *
     * @param options - 設定オプション
     */
    constructor(options?: BrowserRuntimeConfigOptions);
    /**
     * 設定オブジェクトを複製
     *
     * @returns 複製されたBrowserRuntimeConfigインスタンス
     */
    clone(): BrowserRuntimeConfig;
}
/**
 * 統合アプリケーション設定オプション
 */
interface UnifiedConfigOptions {
    /**
     * トランスポート設定オプション
     */
    transport?: TransportConfigOptions;
    /**
     * データエンコード設定オプション
     */
    data?: DataConfigOptions;
    /**
     * ブラウザランタイム設定オプション
     */
    browserRuntime?: BrowserRuntimeConfigOptions;
}
/**
 * 統合アプリケーション設定クラス
 */
declare class AppConfig {
    /**
     * トランスポート設定
     */
    transport: TransportConfig;
    /**
     * データエンコード設定
     */
    data: DataConfig;
    /**
     * ブラウザランタイム設定
     */
    browserRuntime: BrowserRuntimeConfig;
    /**
     * AppConfigのインスタンスを生成
     *
     * @param options - 統合設定オプション
     */
    constructor(options?: UnifiedConfigOptions);
    /**
     * 設定オブジェクトを複製
     *
     * @returns 複製されたAppConfigインスタンス
     */
    clone(): AppConfig;
}

/**
 * QRコード描画オプション
 */
interface RenderQrOptions {
    /**
     * 描画先のキャンバス要素またはID/セレクター
     */
    canvas?: HTMLCanvasElement | string;
    /**
     * キャンバス描画幅 (ピクセル)
     */
    width?: number;
    /**
     * キャンバス描画高さ (ピクセル)
     */
    height?: number;
    /**
     * QR暗モジュールの描画色
     */
    darkColor?: string;
    /**
     * QR明モジュールの描画色
     */
    lightColor?: string;
}
/**
 * カメラ起動オプション
 */
interface CameraOptions {
    /**
     * 使用するカメラのデバイスID
     */
    deviceId?: string;
    /**
     * カメラの向き ("environment" | "user" | string)
     */
    facingMode?: "environment" | "user" | string;
    /**
     * キャプチャフレームレート (fps)
     */
    fps?: number;
    /**
     * キャプチャ推奨幅 (ピクセル)
     */
    width?: number;
    /**
     * キャプチャ推奨高さ (ピクセル)
     */
    height?: number;
    /**
     * 手動パラメータ制御を有効化するかどうか
     */
    isManual?: boolean;
    /**
     * プレビュー表示用キャンバス要素またはID/セレクター
     */
    previewCanvas?: HTMLCanvasElement | string;
    /**
     * プレビューキャンバス上のオーバーレイ描画用コールバック
     */
    drawOverlay?: (ctx: CanvasRenderingContext2D, width: number, height: number) => void;
}
/**
 * QRモジュール行列データ構造体
 */
interface QrModuleMatrixData {
    /**
     * 行列の幅
     */
    width: number;
    /**
     * 行列の高さ
     */
    height: number;
    /**
     * モジュールデータ配列 (1: 暗, 0: 明)
     */
    modules: Uint8Array;
}
/**
 * 画面描画およびカメラ操作用ランタイムAPIインターフェース
 *
 * TransportApiが特定の環境に依存しないようにするための抽象化インターフェース。
 */
interface RuntimeApi {
    /**
     * QRモジュール行列をキャンバスに描画
     *
     * @param matrix - 描画対象のQRモジュール行列
     * @param options - 描画オプション
     */
    renderQrModuleMatrix(matrix: QrModuleMatrixData, options?: RenderQrOptions): void;
    /**
     * キャンバス描画をクリア
     *
     * @param canvas - クリア対象のキャンバス要素またはID/セレクター
     */
    clearCanvas(canvas?: HTMLCanvasElement | string): void;
    /**
     * カメラを起動しフレームのキャプチャを開始
     *
     * @param onFrame - フレーム取得時のコールバック
     * @param options - カメラ起動オプション
     */
    startCamera(onFrame: (rgbaPixels: Uint8Array, width: number, height: number) => void, options?: CameraOptions): Promise<void>;
    /**
     * カメラを停止
     */
    stopCamera(): void;
    /**
     * Web Workerがサポートされているかを判定
     *
     * @returns サポートされている場合はtrue
     */
    isWorkerSupported(): boolean;
    /**
     * 利用可能なビデオ入力デバイス一覧を取得
     *
     * @returns デバイス情報の配列
     */
    getAvailableVideoDevices?(): Promise<MediaDeviceInfo[]>;
}
/**
 * ブラウザ環境用ランタイムAPI実装クラス
 */
declare class BrowserRuntimeApi implements RuntimeApi {
    /**
     * パックファイルヘッダーサイズ（バイト）
     */
    static readonly HEADER_SIZE = 2;
    /**
     * パックファイルの最大ファイル名長（バイト）
     */
    static readonly MAX_FILENAME_LENGTH = 65535;
    /**
     * ブラウザランタイム設定
     */
    config: BrowserRuntimeConfig;
    /**
     * 初期設定オプション
     */
    readonly initialOptions?: BrowserRuntimeConfigOptions;
    /**
     * カメラメディアストリーム
     */
    private cameraStream;
    /**
     * カメラ映像動作用HTMLVideoElement
     */
    private cameraVideo;
    /**
     * カメラキャプチャループのアニメーションID
     */
    private cameraAnimationId;
    /**
     * BrowserRuntimeApiのインスタンスを生成
     *
     * @param config - ランタイム設定または設定オプション
     */
    constructor(config?: BrowserRuntimeConfig | BrowserRuntimeConfigOptions);
    /**
     * ファイルをUint8Arrayにパッキング
     *
     * ファイル名とファイル内容を単一のUint8Array構造に結合します。
     *
     * @param file - パッキング対象のFileオブジェクト
     * @returns パッキングされたUint8Array
     */
    static packFileToUint8Array(file: File): Promise<Uint8Array>;
    /**
     * パッキングされたUint8Arrayからファイル名とデータを解凍
     *
     * @param packed - パッキングされたUint8Array
     * @returns 解凍されたファイル名とデータ
     */
    static unpackUint8ArrayToFile(packed: Uint8Array): {
        name: string;
        data: Uint8Array;
    };
    /**
     * キャンバス要素を解決
     *
     * 引数のキャンバス参照またはセレクターからHTMLCanvasElementを取得します。
     *
     * @param canvasTarget - キャンバス要素またはID/セレクター
     * @returns 解決されたHTMLCanvasElement、取得できない場合はnull
     */
    private resolveCanvas;
    /**
     * QRモジュール行列をキャンバスに描画
     *
     * @param matrix - 描画対象のQRモジュール行列
     * @param options - 描画オプション
     */
    renderQrModuleMatrix(matrix: QrModuleMatrixData, options?: RenderQrOptions): void;
    /**
     * キャンバス描画をクリア
     *
     * @param canvasTarget - クリア対象のキャンバス要素またはID/セレクター
     */
    clearCanvas(canvasTarget?: HTMLCanvasElement | string): void;
    /**
     * 利用可能なビデオ入力デバイス一覧を取得
     *
     * @returns デバイス情報の配列
     */
    getAvailableVideoDevices(): Promise<MediaDeviceInfo[]>;
    /**
     * カメラを起動しフレームのキャプチャを開始
     *
     * @param onFrame - フレーム取得時のコールバック
     * @param options - カメラ起動オプション
     */
    startCamera(onFrame: (rgbaPixels: Uint8Array, width: number, height: number) => void, options?: CameraOptions): Promise<void>;
    /**
     * カメラを停止
     */
    stopCamera(): void;
    /**
     * Web Workerがサポートされているかを判定
     *
     * @returns サポートされている場合はtrue
     */
    isWorkerSupported(): boolean;
}

/**
 * デコード結果
 */
interface DecodedResult {
    /**
     * データ型 ("Uint8Array" または "string")
     */
    type: "Uint8Array" | "string";
    /**
     * デコードされたデータ
     */
    data: Uint8Array | string;
}
/**
 * データ変換APIクラス
 */
declare class DataApi {
    /**
     * 生バイト列をワイヤーフレームにエンコード
     *
     * WASMプロトコルコアを使用して生バイト列をエンコードします。
     * qrVersionが40以下の場合は、qrVersionとecLevelからmaxFrameBitsを自動計算します。
     *
     * @param data - エンコード対象の生バイト列
     * @param qrVersion - QRコードバージョン（デフォルト: 5）
     * @param ecLevel - 誤り訂正レベル（デフォルト: 'm'）
     * @param parityMode - パリティモード（デフォルト: 0）
     * @returns エンコード結果
     */
    static encodeBytes(data: Uint8Array, qrVersion?: number, ecLevel?: QrEcLevel, parityMode?: number): EncodeResult;
    /**
     * テキストをワイヤーフレームにエンコード
     *
     * WASMプロトコルコアを使用してテキストをエンコードします。
     * qrVersionが40以下の場合は、qrVersionとecLevelからmaxFrameBitsを自動計算します。
     *
     * @param text - エンコード対象のテキスト
     * @param qrVersion - QRコードバージョン（デフォルト: 5）
     * @param ecLevel - 誤り訂正レベル（デフォルト: 'm'）
     * @param parityMode - パリティモード（デフォルト: 0）
     * @returns エンコード結果
     */
    static encodeText(text: string, qrVersion?: number, ecLevel?: QrEcLevel, parityMode?: number): EncodeResult;
    /**
     * 単一ワイヤーフレームを解析しCRCを検証
     *
     * @param wireBytes - 解析対象のフレームバイト列
     * @param knownTotalQrCount - 既知の総QRフレーム数（オプション）
     * @param knownFirstFrameCrc - 既知のFirstフレームCRC（オプション）
     * @param knownParityMode - 既知のパリティモード（オプション）
     * @returns フレームメタデータ
     */
    static parseFrame(wireBytes: Uint8Array, knownTotalQrCount?: number, knownFirstFrameCrc?: number, knownParityMode?: number): FrameMetadata;
    /**
     * ワイヤーフレーム群を復元してペイロードをデコード
     *
     * 仕様書v8に準拠して { type: "Uint8Array" | "string", data: Uint8Array | string } を返します。
     *
     * @param wireFrames - 受信したワイヤーフレーム配列
     * @returns デコード結果
     */
    static decodeFrames(wireFrames: Uint8Array[]): DecodedResult;
    /**
     * QRコードモジュール行列を生成
     *
     * WASM経由でqrcodegenを使用し、2値のQRモジュール行列を生成します。
     *
     * @param wireBytes - ワイヤーフレームバイト列
     * @param qrVersion - QRコードバージョン
     * @param ecLevel - 誤り訂正レベル
     * @returns QRコードモジュール行列
     */
    static generateQrMatrix(wireBytes: Uint8Array, qrVersion: number, ecLevel: QrEcLevel): QrModuleMatrix;
    /**
     * QRコード画像ピクセルをデコード
     *
     * WASM経由でrxingを使用し、RGBAピクセル配列からワイヤーフレームバイト列をデコードします。
     *
     * @param rgbaPixels - RGBAピクセルバイト配列
     * @param width - 画像の幅
     * @param height - 画像の高さ
     * @returns デコードされたワイヤーフレームバイト列
     */
    static decodeQrImage(rgbaPixels: Uint8Array, width: number, height: number): Uint8Array;
}

/**
 * トランスポートプロトコル状態型
 */
type TransportState = "Idle" | "WaitingForFirst" | "FirstEstablished" | "Receiving" | "WaitingMissingFrames" | "OverallCrcVerification" | "Completed" | "Error";
/**
 * 警告コード型
 */
type WarningCode = "FRAME_CHANGED" | "FRAME_REPLACED" | "POST_FIRST_FRAMES_DISCARDED" | "UNKNOWN_VERSION_CONTINUED";
/**
 * エラーコード型
 */
type ErrorCode = "INVALID_VERSION" | "UNDEFINED_DATA_TYPE" | "INVALID_TOTAL_QR_COUNT" | "SYNTAX_ERROR" | "ASCII_OUT_OF_RANGE" | "STRING_DECODE_FAILED" | "MAX_CRC_ERRORS_EXCEEDED" | "OVERALL_CRC_MISMATCH";
/**
 * 警告イベント構造体
 */
interface TransportWarning {
    /**
     * 警告コード
     */
    code: WarningCode;
    /**
     * 警告メッセージ
     */
    message: string;
    /**
     * 詳細情報
     */
    details?: unknown;
}
/**
 * エラーイベント構造体
 */
interface TransportError {
    /**
     * エラーコード
     */
    code: ErrorCode;
    /**
     * エラーメッセージ
     */
    message: string;
    /**
     * 致命的エラーフラグ
     */
    critical: boolean;
    /**
     * 詳細情報
     */
    details?: unknown;
}
/**
 * 送信起動オプション
 */
interface SendOptions {
    /**
     * QRコードバージョン
     */
    qrVersion?: number;
    /**
     * 誤り訂正レベル ('l', 'm', 'q', 'h')
     */
    ecLevel?: "l" | "m" | "q" | "h";
    /**
     * フレーム送信間隔（ミリ秒）
     */
    intervalMs?: number;
    /**
     * パリティモード
     */
    parityMode?: ParityMode | 0 | 8 | 16 | 32;
    /**
     * 描画先キャンバス
     */
    canvas?: HTMLCanvasElement | string;
    /**
     * 描画オプション
     */
    renderOptions?: RenderQrOptions;
}
/**
 * 受信起動オプション
 */
interface ReceiveOptions {
    /**
     * 許容連続CRCエラー最大数
     */
    maxConsecutiveCrcErrors?: number;
    /**
     * First QR受信前保持フレーム最大数
     */
    maxPendingFramesBeforeFirst?: number;
    /**
     * Worker使用フラグ
     */
    useWorker?: boolean;
}
/**
 * 送信進捗イベント
 */
interface SendProgressEvent {
    /**
     * 現在のフレームインデックス (1-based)
     */
    index: number;
    /**
     * 全フレーム数
     */
    maxIndex: number;
}
/**
 * フレーム処理完了イベント
 */
interface FrameProcessedEvent {
    /**
     * 有効受信フレーム数
     */
    validCount: number;
    /**
     * 保留フレーム数
     */
    pendingCount: number;
    /**
     * 総フレーム数 (-1は不明)
     */
    totalCount: number;
    /**
     * QRコード検出フラグ
     */
    isQrDetected: boolean;
    /**
     * 転送レート (bps)
     */
    bps: number;
}
/**
 * 送受信トランスポート制御APIクラス
 */
declare class TransportApi {
    /**
     * トランスポート状態
     */
    private state;
    /**
     * アプリケーション設定
     */
    private config;
    /**
     * ランタイムAPIインスタンス
     */
    private runtime?;
    /**
     * 警告コールバック配列
     */
    private warningCallbacks;
    /**
     * エラーコールバック配列
     */
    private errorCallbacks;
    /**
     * 完了コールバック配列
     */
    private completeCallbacks;
    /**
     * フレーム処理完了コールバック配列
     */
    private frameProcessedCallbacks;
    /**
     * 送信進捗コールバック配列
     */
    private sendProgressCallbacks;
    /**
     * 送信ループタイマー
     */
    private sendTimer;
    /**
     * 送信用ワイヤーフレーム配列
     */
    private sendWireFrames;
    /**
     * 送信中フレームインデックス
     */
    private sendFrameIndex;
    /**
     * 送信描画先キャンバス参照
     */
    private sendCanvasTarget?;
    /**
     * First QR受信前の保留フレーム配列
     */
    private pendingPreFirstFrames;
    /**
     * 受信・保持済みフレームマップ (フレーム番号 -> ワイヤーフレーム)
     */
    private storedFrames;
    /**
     * 既知の総QRフレーム数
     */
    private knownTotalQrCount?;
    /**
     * 既知のFirstフレームCRC
     */
    private knownFirstFrameCrc?;
    /**
     * 連続CRCエラーカウント
     */
    private consecutiveCrcErrors;
    /**
     * 受信開始時刻 (performance.now)
     */
    private receiveStartTime;
    /**
     * 受信済み総ペイロードビット数
     */
    private totalReceivedPayloadBits;
    /**
     * 直前フレームでのQR検出フラグ
     */
    private lastQrDetected;
    /**
     * Workerクライアントインスタンス
     */
    private workerClient;
    /**
     * TransportApiのインスタンスを生成
     *
     * @param config - アプリケーション設定
     * @param runtime - ランタイムAPI
     */
    constructor(config?: AppConfig, runtime?: RuntimeApi);
    /**
     * ランタイムAPIを設定
     *
     * @param runtime - ランタイムAPI
     */
    setRuntime(runtime?: RuntimeApi): void;
    /**
     * 設定オブジェクトを取得
     *
     * @returns 設定オブジェクト
     */
    getConfig(): AppConfig;
    /**
     * 現在のトランスポート状態を取得
     *
     * @returns トランスポート状態
     */
    getState(): TransportState;
    /**
     * 警告イベントリスナーを登録
     *
     * @param callback - 警告コールバック
     */
    onWarning(callback: (warning: TransportWarning) => void): void;
    /**
     * エラーイベントリスナーを登録
     *
     * @param callback - エラーコールバック
     */
    onError(callback: (error: TransportError) => void): void;
    /**
     * 完了イベントリスナーを登録
     *
     * @param callback - 完了コールバック
     */
    onComplete(callback: (result: DecodedResult) => void): void;
    /**
     * 送信進捗イベントリスナーを登録
     *
     * @param callback - 送信進捗コールバック
     */
    onSendProgress(callback: (event: SendProgressEvent) => void): void;
    /**
     * フレーム処理完了イベントリスナーを登録
     *
     * @param callback - フレーム処理完了コールバック
     */
    onFrameProcessed(callback: (event: FrameProcessedEvent) => void): void;
    /**
     * フレーム処理完了イベントオブジェクトを構築
     *
     * @returns フレーム処理完了イベント
     */
    private buildFrameProcessedEvent;
    /**
     * フレーム処理完了イベントを発行
     */
    private emitFrameProcessed;
    /**
     * 送信進捗イベントを発行
     */
    private emitSendProgress;
    /**
     * 警告イベントを発行
     *
     * @param warning - 警告構造体
     */
    private emitWarning;
    /**
     * エラーイベントを発行
     *
     * @param error - エラー構造体
     */
    private emitError;
    /**
     * 完了イベントを発行
     *
     * @param result - デコード結果
     */
    private emitComplete;
    /**
     * WorkerClientを取得または生成
     *
     * @returns WorkerClientインスタンス
     */
    private getOrCreateWorkerClient;
    /**
     * Workerを使用すべきかを判定
     *
     * @returns Workerを使用する場合はtrue
     */
    private shouldUseWorker;
    /**
     * データ送信を開始
     *
     * @param data - 送信するデータ (Uint8Array または string)
     * @param options - 送信オプション
     */
    startSend(data: Uint8Array | string, options?: SendOptions): Promise<void>;
    /**
     * 現在送信中のフレームバイト列を取得
     *
     * @returns 送信中フレームバイト列、送信中でない場合はnull
     */
    getCurrentSendFrame(): Uint8Array | null;
    /**
     * データ送信を停止
     */
    stopSend(): void;
    /**
     * 送信内部状態をリセット
     */
    private resetSenderState;
    /**
     * データ受信を開始
     *
     * @param options - 受信オプション
     */
    startReceive(options?: ReceiveOptions): Promise<void>;
    /**
     * データ受信を停止
     */
    stopReceive(): void;
    /**
     * 受信内部状態をリセット
     */
    private resetReceiverState;
    /**
     * First QR受信前の保留キュー長を取得
     *
     * @returns 保留フレーム数
     */
    getPendingPreFirstQueueLength(): number;
    /**
     * QRコード画像をワイヤーバイト列にデコード
     *
     * @param rgbaPixels - RGBAピクセルバイト配列
     * @param width - 画像幅
     * @param height - 画像高さ
     * @returns デコードされたワイヤーバイト列
     */
    private decodeQrImageInternal;
    /**
     * 画像フレーム（RGBAピクセルバッファ）を処理
     *
     * @param rgbaPixels - RGBAピクセルバイト配列
     * @param width - 画像幅
     * @param height - 画像高さ
     */
    processImageFrame(rgbaPixels: Uint8Array, width: number, height: number): Promise<void>;
    /**
     * 生ワイヤーフレーム配列を解析
     *
     * @param wireBytes - ワイヤーフレームバイト配列
     * @returns 解析結果フレームメタデータ
     */
    private parseFrameInternal;
    /**
     * 受信した1ワイヤーフレームを処理
     *
     * @param wireBytes - ワイヤーフレームバイト配列
     */
    processFrame(wireBytes?: Uint8Array | null): void | Promise<void>;
    /**
     * First QR受信による通信確立処理
     *
     * @param wireBytes - ワイヤーフレームバイト配列
     * @param metadata - フレームメタデータ
     */
    private establishFirstQr;
    /**
     * 上書きされた保留フレームをクリア
     *
     * @param frameNumber - フレーム番号
     */
    private removeSupersededPendingFrames;
    /**
     * First QR確立後の後続フレームを処理
     *
     * @param wireBytes - ワイヤーフレームバイト配列
     * @param metadata - フレームメタデータ
     */
    private processPostFirstFrame;
    /**
     * CRCエラー発生時の内部カウント処理
     */
    private handleCrcError;
    /**
     * First QR受信前の保留キューを一括処理
     */
    private processPendingQueue;
    /**
     * 受信完了判定および全フレーム復元・検証処理
     */
    private checkCompletion;
}

/**
 * バージョン定義
 */
/**
 * ライブラリのバージョン文字列
 */
declare const VERSION: string;

export { AppConfig, BrowserRuntimeApi, BrowserRuntimeConfig, DataApi, DataConfig, ParityMode, TransportApi, TransportConfig, WorkerClient, handleWorkerMessage, snowsQrDataTransportProtocol_d as protocol, setupWorkerSelfListener, VERSION as version };
export type { CameraOptions, DecodedResult, ErrorCode, ReceiveOptions, RenderQrOptions, RuntimeApi, SendOptions, TransportError, TransportState, TransportWarning, WarningCode, WorkerClientOptions };
