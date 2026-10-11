import { AppConfig, BrowserRuntimeConfig, ParityMode } from "../config/index";
import { WorkerClient } from "../utils/worker";
import type { FrameMetadata } from "../wasm/interfaces/snows-qr-data-transport-protocol";
import { BrowserRuntimeApi, type RenderQrOptions, type RuntimeApi } from "./browserRuntimeApi";
import { DataApi, type DecodedResult } from "./dataApi";

/**
 * トランスポートプロトコル状態型
 */
export type TransportState = "Idle" | "WaitingForFirst" | "FirstEstablished" | "Receiving" | "WaitingMissingFrames" | "OverallCrcVerification" | "Completed" | "Error";

/**
 * 警告コード型
 */
export type WarningCode = "FRAME_CHANGED" | "FRAME_REPLACED" | "POST_FIRST_FRAMES_DISCARDED" | "UNKNOWN_VERSION_CONTINUED";

/**
 * エラーコード型
 */
export type ErrorCode = "INVALID_VERSION" | "UNDEFINED_DATA_TYPE" | "INVALID_TOTAL_QR_COUNT" | "SYNTAX_ERROR" | "ASCII_OUT_OF_RANGE" | "STRING_DECODE_FAILED" | "MAX_CRC_ERRORS_EXCEEDED" | "OVERALL_CRC_MISMATCH";

/**
 * 警告イベント構造体
 */
export interface TransportWarning {
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
export interface TransportError {
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
export interface SendOptions {
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
export interface ReceiveOptions {
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
export interface SendProgressEvent {
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
export interface FrameProcessedEvent {
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
export class TransportApi {
	/**
	 * トランスポート状態
	 */
	private state: TransportState = "Idle";

	/**
	 * アプリケーション設定
	 */
	private config: AppConfig;

	/**
	 * ランタイムAPIインスタンス
	 */
	private runtime?: RuntimeApi;

	/**
	 * 警告コールバック配列
	 */
	private warningCallbacks: ((warning: TransportWarning) => void)[] = [];

	/**
	 * エラーコールバック配列
	 */
	private errorCallbacks: ((error: TransportError) => void)[] = [];

	/**
	 * 完了コールバック配列
	 */
	private completeCallbacks: ((result: DecodedResult) => void)[] = [];

	/**
	 * フレーム処理完了コールバック配列
	 */
	private frameProcessedCallbacks: ((event: FrameProcessedEvent) => void)[] = [];

	/**
	 * 送信進捗コールバック配列
	 */
	private sendProgressCallbacks: ((event: SendProgressEvent) => void)[] = [];

	/**
	 * 送信ループタイマー
	 */
	private sendTimer: ReturnType<typeof setInterval> | null = null;

	/**
	 * 送信用ワイヤーフレーム配列
	 */
	private sendWireFrames: Uint8Array[] = [];

	/**
	 * 送信中フレームインデックス
	 */
	private sendFrameIndex = 0;

	/**
	 * 送信描画先キャンバス参照
	 */
	private sendCanvasTarget?: HTMLCanvasElement | string;

	/**
	 * First QR受信前の保留フレーム配列
	 */
	private pendingPreFirstFrames: Uint8Array[] = [];

	/**
	 * 受信・保持済みフレームマップ (フレーム番号 -> ワイヤーフレーム)
	 */
	private storedFrames: Map<number, Uint8Array> = new Map();

	/**
	 * 既知の総QRフレーム数
	 */
	private knownTotalQrCount?: number;

	/**
	 * 既知のFirstフレームCRC
	 */
	private knownFirstFrameCrc?: number;

	/**
	 * 連続CRCエラーカウント
	 */
	private consecutiveCrcErrors = 0;

	/**
	 * 受信開始時刻 (performance.now)
	 */
	private receiveStartTime: number | null = null;

	/**
	 * 受信済み総ペイロードビット数
	 */
	private totalReceivedPayloadBits = 0;

	/**
	 * 直前フレームでのQR検出フラグ
	 */
	private lastQrDetected = false;

	/**
	 * Workerクライアントインスタンス
	 */
	private workerClient: WorkerClient | null = null;

	/**
	 * TransportApiのインスタンスを生成
	 *
	 * @param config - アプリケーション設定
	 * @param runtime - ランタイムAPI
	 */
	constructor(config?: AppConfig, runtime?: RuntimeApi) {
		this.config = config ? config.clone() : new AppConfig();
		this.setRuntime(runtime);
	}

	/**
	 * ランタイムAPIを設定
	 *
	 * @param runtime - ランタイムAPI
	 */
	public setRuntime(runtime?: RuntimeApi): void {
		this.runtime = runtime;
		if (this.runtime && this.runtime instanceof BrowserRuntimeApi) {
			if (this.runtime.initialOptions) {
				// runtime側のinitialOptionsをトランスポート設定に優先適用
				this.runtime.config = new BrowserRuntimeConfig({
					...this.config.browserRuntime,
					...this.runtime.initialOptions,
				});
			} else {
				this.runtime.config = this.config.browserRuntime;
			}
		}
	}

	/**
	 * 設定オブジェクトを取得
	 *
	 * @returns 設定オブジェクト
	 */
	public getConfig(): AppConfig {
		return this.config;
	}

	/**
	 * 現在のトランスポート状態を取得
	 *
	 * @returns トランスポート状態
	 */
	public getState(): TransportState {
		return this.state;
	}

	/**
	 * 警告イベントリスナーを登録
	 *
	 * @param callback - 警告コールバック
	 */
	public onWarning(callback: (warning: TransportWarning) => void): void {
		this.warningCallbacks.push(callback);
	}

	/**
	 * エラーイベントリスナーを登録
	 *
	 * @param callback - エラーコールバック
	 */
	public onError(callback: (error: TransportError) => void): void {
		this.errorCallbacks.push(callback);
	}

	/**
	 * 完了イベントリスナーを登録
	 *
	 * @param callback - 完了コールバック
	 */
	public onComplete(callback: (result: DecodedResult) => void): void {
		this.completeCallbacks.push(callback);
	}

	/**
	 * 送信進捗イベントリスナーを登録
	 *
	 * @param callback - 送信進捗コールバック
	 */
	public onSendProgress(callback: (event: SendProgressEvent) => void): void {
		this.sendProgressCallbacks.push(callback);
	}

	/**
	 * フレーム処理完了イベントリスナーを登録
	 *
	 * @param callback - フレーム処理完了コールバック
	 */
	public onFrameProcessed(callback: (event: FrameProcessedEvent) => void): void {
		this.frameProcessedCallbacks.push(callback);
		// 購読開始時に初期ステータスを発行
		callback(this.buildFrameProcessedEvent());
	}

	/**
	 * フレーム処理完了イベントオブジェクトを構築
	 *
	 * @returns フレーム処理完了イベント
	 */
	private buildFrameProcessedEvent(): FrameProcessedEvent {
		let bps = 0;
		if (this.receiveStartTime !== null) {
			const elapsedSec = (performance.now() - this.receiveStartTime) / 1000;
			if (elapsedSec > 0) {
				bps = Math.round(this.totalReceivedPayloadBits / elapsedSec);
			}
		}
		return {
			validCount: this.storedFrames.size,
			pendingCount: this.pendingPreFirstFrames.length,
			totalCount: this.knownTotalQrCount ?? -1,
			isQrDetected: this.lastQrDetected,
			bps,
		};
	}

	/**
	 * フレーム処理完了イベントを発行
	 */
	private emitFrameProcessed(): void {
		const event = this.buildFrameProcessedEvent();
		for (const cb of this.frameProcessedCallbacks) {
			cb(event);
		}
	}

	/**
	 * 送信進捗イベントを発行
	 */
	private emitSendProgress(): void {
		if (this.sendWireFrames.length === 0) return;
		const event: SendProgressEvent = {
			index: this.sendFrameIndex + 1, // 外部利用者向けに1始まりのインデックス
			maxIndex: this.sendWireFrames.length,
		};
		for (const cb of this.sendProgressCallbacks) {
			cb(event);
		}
	}

	/**
	 * 警告イベントを発行
	 *
	 * @param warning - 警告構造体
	 */
	private emitWarning(warning: TransportWarning): void {
		for (const cb of this.warningCallbacks) {
			cb(warning);
		}
	}

	/**
	 * エラーイベントを発行
	 *
	 * @param error - エラー構造体
	 */
	private emitError(error: TransportError): void {
		if (error.critical) {
			this.state = "Error";
			this.resetReceiverState();
			this.resetSenderState();
		}
		for (const cb of this.errorCallbacks) {
			cb(error);
		}
	}

	/**
	 * 完了イベントを発行
	 *
	 * @param result - デコード結果
	 */
	private emitComplete(result: DecodedResult): void {
		this.state = "Completed";
		if (this.runtime) {
			this.runtime.stopCamera();
		}
		for (const cb of this.completeCallbacks) {
			cb(result);
		}
	}

	/**
	 * WorkerClientを取得または生成
	 *
	 * @returns WorkerClientインスタンス
	 */
	private getOrCreateWorkerClient(): WorkerClient {
		if (!this.workerClient || this.workerClient.isDisposed) {
			this.workerClient = new WorkerClient({
				enabled: this.config.transport.useWorker,
				fallback: true,
				workerUrl: this.config.transport.workerUrl,
				createWorker: this.config.transport.createWorker,
				workerType: this.config.transport.workerType,
				timeout: this.config.transport.timeout,
			});
		}
		return this.workerClient;
	}

	/**
	 * Workerを使用すべきかを判定
	 *
	 * @returns Workerを使用する場合はtrue
	 */
	private shouldUseWorker(): boolean {
		if (!this.config.transport.useWorker) return false;
		return this.getOrCreateWorkerClient().isWorkerAvailable;
	}

	/**
	 * データ送信を開始
	 *
	 * @param data - 送信するデータ (Uint8Array または string)
	 * @param options - 送信オプション
	 */
	public async startSend(data: Uint8Array | string, options?: SendOptions): Promise<void> {
		// 仕様書v8 Section 31, 75.1, 79: 送信動作中の重複呼び出しは無視
		if (this.sendTimer !== null) {
			return;
		}

		if (options) {
			if (options.qrVersion !== undefined) {
				this.config.data.qrVersion = options.qrVersion;
			}
			if (options.ecLevel !== undefined) {
				this.config.data.ecLevel = options.ecLevel;
			}
			if (options.intervalMs !== undefined) {
				this.config.transport.intervalMs = options.intervalMs;
			}
			if (options.parityMode !== undefined) {
				this.config.data.parityMode = options.parityMode;
			}
			if (options.canvas !== undefined) {
				this.sendCanvasTarget = options.canvas;
			}
		}

		let encodedResult;
		try {
			const maxFrameBits = this.config.data.maxFrameBits;
			const payloadOptions = {
				maxFrameBits,
				qrVersion: this.config.data.qrVersion,
				ecLevel: this.config.data.ecLevel,
				parityMode: this.config.data.parityMode,
			};
			if (this.shouldUseWorker()) {
				const worker = this.getOrCreateWorkerClient();
				if (typeof data === "string") {
					encodedResult = await worker.request("encodeText", { text: data, ...payloadOptions });
				} else {
					encodedResult = await worker.request("encodeBytes", { data, ...payloadOptions });
				}
			} else {
				if (typeof data === "string") {
					encodedResult = DataApi.encodeText(data, this.config.data.qrVersion, this.config.data.ecLevel, this.config.data.parityMode);
				} else {
					encodedResult = DataApi.encodeBytes(data, this.config.data.qrVersion, this.config.data.ecLevel, this.config.data.parityMode);
				}
			}
		} catch (err) {
			const errMsg = err instanceof Error ? err.message : String(err);
			this.emitError({
				code: errMsg.includes("ASCII") ? "ASCII_OUT_OF_RANGE" : "SYNTAX_ERROR",
				message: `Encoding error: ${errMsg}`,
				critical: true,
				details: err,
			});
			return;
		}

		this.sendWireFrames = encodedResult.frames.map((f: { wireBytes: Uint8Array | number[] | ArrayBuffer }) => (f.wireBytes instanceof Uint8Array ? f.wireBytes : new Uint8Array(f.wireBytes as ArrayLike<number>)));
		if (this.sendWireFrames.length === 0) {
			this.emitError({
				code: "SYNTAX_ERROR",
				message: "No frames generated from payload",
				critical: true,
			});
			return;
		}

		this.sendFrameIndex = 0;
		const interval = this.config.transport.intervalMs;

		const renderCurrentFrame = () => {
			const currentFrame = this.getCurrentSendFrame();
			if (currentFrame && this.runtime) {
				try {
					const matrix = DataApi.generateQrMatrix(currentFrame, this.config.data.qrVersion, this.config.data.ecLevel);
					this.runtime.renderQrModuleMatrix(matrix, {
						canvas: this.sendCanvasTarget,
						width: options?.renderOptions?.width ?? this.config.browserRuntime.qrWidth ?? this.config.browserRuntime.canvasWidth,
						height: options?.renderOptions?.height ?? this.config.browserRuntime.qrHeight ?? this.config.browserRuntime.canvasHeight,
						...options?.renderOptions,
					});
				} catch {
					// ヘッド環境での描画エラーは無視
				}
			}
		};

		renderCurrentFrame();
		this.emitSendProgress();

		this.sendTimer = setInterval(() => {
			if (this.sendWireFrames.length === 0) return;
			this.sendFrameIndex = (this.sendFrameIndex + 1) % this.sendWireFrames.length;
			renderCurrentFrame();
			this.emitSendProgress();
		}, interval);
	}

	/**
	 * 現在送信中のフレームバイト列を取得
	 *
	 * @returns 送信中フレームバイト列、送信中でない場合はnull
	 */
	public getCurrentSendFrame(): Uint8Array | null {
		if (this.sendWireFrames.length === 0) return null;
		return this.sendWireFrames[this.sendFrameIndex];
	}

	/**
	 * データ送信を停止
	 */
	public stopSend(): void {
		this.resetSenderState();
	}

	/**
	 * 送信内部状態をリセット
	 */
	private resetSenderState(): void {
		if (this.sendTimer !== null) {
			clearInterval(this.sendTimer);
			this.sendTimer = null;
		}
		if (this.runtime) {
			this.runtime.clearCanvas(this.sendCanvasTarget);
		}
		this.sendWireFrames = [];
		this.sendFrameIndex = 0;
		this.sendCanvasTarget = undefined;
		if (this.workerClient) {
			this.workerClient.dispose();
			this.workerClient = null;
		}
	}

	/**
	 * データ受信を開始
	 *
	 * @param options - 受信オプション
	 */
	public async startReceive(options?: ReceiveOptions): Promise<void> {
		// 仕様書v8 Section 75.1, 79: 受信処理中の重複呼び出しは無視
		if (this.state !== "Idle" && this.state !== "Completed" && this.state !== "Error") {
			return;
		}

		if (options) {
			if (options.maxConsecutiveCrcErrors !== undefined) {
				this.config.transport.maxConsecutiveCrcErrors = options.maxConsecutiveCrcErrors;
			}
			if (options.maxPendingFramesBeforeFirst !== undefined) {
				this.config.transport.maxPendingFramesBeforeFirst = options.maxPendingFramesBeforeFirst;
			}
			if (options.useWorker !== undefined) {
				this.config.transport.useWorker = options.useWorker;
			}
		}

		this.resetReceiverState();
		this.receiveStartTime = performance.now();
		this.state = "WaitingForFirst";
		this.emitFrameProcessed();
	}

	/**
	 * データ受信を停止
	 */
	public stopReceive(): void {
		if (this.runtime) {
			this.runtime.stopCamera();
		}
		this.resetReceiverState();
		this.state = "Idle";
	}

	/**
	 * 受信内部状態をリセット
	 */
	private resetReceiverState(): void {
		this.pendingPreFirstFrames = [];
		this.storedFrames.clear();
		this.knownTotalQrCount = undefined;
		this.knownFirstFrameCrc = undefined;
		this.consecutiveCrcErrors = 0;
		this.receiveStartTime = null;
		this.totalReceivedPayloadBits = 0;
		this.lastQrDetected = false;
		if (this.workerClient) {
			this.workerClient.dispose();
			this.workerClient = null;
		}
		this.emitFrameProcessed();
	}

	/**
	 * First QR受信前の保留キュー長を取得
	 *
	 * @returns 保留フレーム数
	 */
	public getPendingPreFirstQueueLength(): number {
		return this.pendingPreFirstFrames.length;
	}

	/**
	 * QRコード画像をワイヤーバイト列にデコード
	 *
	 * @param rgbaPixels - RGBAピクセルバイト配列
	 * @param width - 画像幅
	 * @param height - 画像高さ
	 * @returns デコードされたワイヤーバイト列
	 */
	private decodeQrImageInternal(rgbaPixels: Uint8Array, width: number, height: number): Promise<Uint8Array> | Uint8Array {
		if (this.shouldUseWorker()) {
			const worker = this.getOrCreateWorkerClient();
			return worker.decodeQrImage(rgbaPixels, width, height);
		}
		return DataApi.decodeQrImage(rgbaPixels, width, height);
	}

	/**
	 * 画像フレーム（RGBAピクセルバッファ）を処理
	 *
	 * @param rgbaPixels - RGBAピクセルバイト配列
	 * @param width - 画像幅
	 * @param height - 画像高さ
	 */
	public async processImageFrame(rgbaPixels: Uint8Array, width: number, height: number): Promise<void> {
		if (this.state === "Idle" || this.state === "Completed" || this.state === "Error") {
			this.lastQrDetected = false;
			return;
		}

		if (!rgbaPixels || rgbaPixels.length === 0 || width <= 0 || height <= 0) {
			this.lastQrDetected = false;
			this.emitFrameProcessed();
			return;
		}

		try {
			const decodedWire = await this.decodeQrImageInternal(rgbaPixels, width, height);
			if (decodedWire && decodedWire.length > 0) {
				await this.processFrame(decodedWire);
			} else {
				await this.processFrame(null);
			}
		} catch {
			await this.processFrame(null);
		}
	}

	/**
	 * 生ワイヤーフレーム配列を解析
	 *
	 * @param wireBytes - ワイヤーフレームバイト配列
	 * @returns 解析結果フレームメタデータ
	 */
	private parseFrameInternal(wireBytes: Uint8Array): Promise<FrameMetadata> | FrameMetadata {
		if (this.shouldUseWorker()) {
			const worker = this.getOrCreateWorkerClient();
			return worker.request("parseFrame", {
				wireBytes,
				knownTotalQrCount: this.knownTotalQrCount,
				knownFirstFrameCrc: this.knownFirstFrameCrc,
				knownParityMode: this.config.data.parityMode,
			});
		}
		return DataApi.parseFrame(wireBytes, this.knownTotalQrCount, this.knownFirstFrameCrc, this.config.data.parityMode);
	}

	/**
	 * 受信した1ワイヤーフレームを処理
	 *
	 * @param wireBytes - ワイヤーフレームバイト配列
	 */
	public processFrame(wireBytes?: Uint8Array | null): void | Promise<void> {
		if (this.state === "Idle" || this.state === "Completed" || this.state === "Error") {
			this.lastQrDetected = false;
			return;
		}

		if (!wireBytes || wireBytes.length === 0) {
			this.lastQrDetected = false;
			this.emitFrameProcessed();
			return;
		}

		this.lastQrDetected = true;

		// 仕様書v8 Section 11 & 32: スタートビットはFirst QRで1, Non-Firstで0
		const isStartBitSet = (wireBytes[0] & 0x80) !== 0;

		if (this.state === "WaitingForFirst") {
			if (!isStartBitSet) {
				// 仕様書v8 Section 32, 33, 34: First QR到着前のNon-firstフレームはパースやCRCエラーカウントを発生させずに保留キューに追加
				if (this.pendingPreFirstFrames.length < this.config.transport.maxPendingFramesBeforeFirst) {
					const isDuplicate = this.pendingPreFirstFrames.some((b) => b.length === wireBytes.length && b.every((val, idx) => val === wireBytes[idx]));
					if (!isDuplicate) {
						this.pendingPreFirstFrames.push(wireBytes);
					}
				}
				this.emitFrameProcessed();
				return;
			}
		}

		const handleParsedMetadata = (metadata: FrameMetadata): void | Promise<void> => {
			// 仕様書v8 Section 41: 範囲外のフレーム番号は無視
			if (this.knownTotalQrCount !== undefined && metadata.frameNumber >= this.knownTotalQrCount) {
				return;
			}

			// バージョン0チェックはFirst QRでのみ適用（Non-FirstフレームにはVersionフィールドがないため）
			if (metadata.isFirst) {
				if (metadata.version === 0) {
					this.emitError({
						code: "INVALID_VERSION",
						message: "Library Format Version 0 is invalid",
						critical: true,
					});
					return;
				}
				if (metadata.version > 1) {
					this.emitWarning({
						code: "UNKNOWN_VERSION_CONTINUED",
						message: `Unknown library format version ${metadata.version}, continuing processing`,
						details: { version: metadata.version },
					});
				}
			}

			if (this.state === "WaitingForFirst") {
				if (metadata.isFirst) {
					if (metadata.crcValid) {
						return this.establishFirstQr(wireBytes, metadata);
					} else {
						// 破損したFirst QR -> CRCエラーをカウント
						this.handleCrcError();
					}
				}
				return;
			}

			return this.processPostFirstFrame(wireBytes, metadata);
		};

		let isAsync = false;
		try {
			const parsed = this.parseFrameInternal(wireBytes);
			if (parsed instanceof Promise) {
				isAsync = true;
				return parsed
					.then((metadata) => handleParsedMetadata(metadata))
					.catch((err) => {
						this.emitError({
							code: "SYNTAX_ERROR",
							message: `Syntax error during frame parsing: ${String(err)}`,
							critical: false,
						});
					})
					.finally(() => {
						this.emitFrameProcessed();
					});
			} else {
				const res = handleParsedMetadata(parsed);
				if (res instanceof Promise) {
					isAsync = true;
					return res
						.catch((err) => {
							this.emitError({
								code: "SYNTAX_ERROR",
								message: `Syntax error during frame parsing: ${String(err)}`,
								critical: false,
							});
						})
						.finally(() => {
							this.emitFrameProcessed();
						});
				}
			}
		} catch (err) {
			this.emitError({
				code: "SYNTAX_ERROR",
				message: `Syntax error during frame parsing: ${String(err)}`,
				critical: false,
			});
		} finally {
			if (!isAsync) {
				this.emitFrameProcessed();
			}
		}
	}

	/**
	 * First QR受信による通信確立処理
	 *
	 * @param wireBytes - ワイヤーフレームバイト配列
	 * @param metadata - フレームメタデータ
	 */
	private establishFirstQr(wireBytes: Uint8Array, metadata: FrameMetadata): void | Promise<void> {
		this.knownTotalQrCount = metadata.totalQrCount;
		this.knownFirstFrameCrc = metadata.frameCrc;
		this.storedFrames.set(0, wireBytes);
		this.totalReceivedPayloadBits += metadata.payloadBitLen;
		this.state = metadata.totalQrCount === 1 ? "OverallCrcVerification" : "FirstEstablished";

		if (metadata.totalQrCount === 1) {
			this.checkCompletion();
		} else {
			return this.processPendingQueue();
		}
	}

	/**
	 * 上書きされた保留フレームをクリア
	 *
	 * @param frameNumber - フレーム番号
	 */
	private removeSupersededPendingFrames(frameNumber: number): void | Promise<void> {
		if (this.pendingPreFirstFrames.length === 0) return;
		if (this.shouldUseWorker()) {
			return (async () => {
				const nextPending: Uint8Array[] = [];
				for (const wire of this.pendingPreFirstFrames) {
					try {
						const meta = await this.parseFrameInternal(wire);
						if (meta.frameNumber !== frameNumber) {
							nextPending.push(wire);
						}
					} catch {
						// 無効な保留フレームは無視
					}
				}
				this.pendingPreFirstFrames = nextPending;
			})();
		} else {
			this.pendingPreFirstFrames = this.pendingPreFirstFrames.filter((wire) => {
				try {
					const meta = this.parseFrameInternal(wire) as FrameMetadata;
					return meta.frameNumber !== frameNumber;
				} catch {
					return false;
				}
			});
		}
	}

	/**
	 * First QR確立後の後続フレームを処理
	 *
	 * @param wireBytes - ワイヤーフレームバイト配列
	 * @param metadata - フレームメタデータ
	 */
	private processPostFirstFrame(wireBytes: Uint8Array, metadata: FrameMetadata): void | Promise<void> {
		if (!metadata.crcValid) {
			this.handleCrcError();
			return;
		}

		// CRC正常時は連続エラーカウントをリセット
		this.consecutiveCrcErrors = 0;

		const continueProcessing = (): void | Promise<void> => {
			const existingWire = this.storedFrames.get(metadata.frameNumber);
			if (existingWire) {
				const checkExistingAndProceed = (existingMeta?: FrameMetadata): void => {
					// 仕様書v8 Section 38, 39, 60: First QR(Frame 0)が異なるFirst CRCで届いた場合、基準を更新し後続フレームを破棄
					if (metadata.frameNumber === 0 && metadata.frameCrc !== this.knownFirstFrameCrc) {
						for (const key of Array.from(this.storedFrames.keys())) {
							if (key !== 0) {
								this.storedFrames.delete(key);
							}
						}
						this.knownFirstFrameCrc = metadata.frameCrc;
						this.knownTotalQrCount = metadata.totalQrCount;
						this.storedFrames.set(0, wireBytes);

						this.emitWarning({
							code: "POST_FIRST_FRAMES_DISCARDED",
							message: "First Frame CRC changed. Discarded subsequent stored frames.",
						});
						this.checkCompletion();
						return;
					}

					if (existingMeta && existingMeta.payloadBitLen === metadata.payloadBitLen) {
						// フレーム番号とペイロード長が同一の場合はスキップ
						return;
					}

					this.storedFrames.set(metadata.frameNumber, wireBytes);
					this.emitWarning({
						code: "FRAME_CHANGED",
						message: `Frame ${metadata.frameNumber} payload length changed`,
					});
					this.emitWarning({
						code: "FRAME_REPLACED",
						message: `Frame ${metadata.frameNumber} replaced with updated payload`,
					});
					this.checkCompletion();
				};

				let parsedExisting: Promise<FrameMetadata> | FrameMetadata;
				try {
					parsedExisting = this.parseFrameInternal(existingWire);
				} catch {
					checkExistingAndProceed(undefined);
					return;
				}

				if (parsedExisting instanceof Promise) {
					return parsedExisting.then((meta) => checkExistingAndProceed(meta)).catch(() => checkExistingAndProceed(undefined));
				} else {
					checkExistingAndProceed(parsedExisting);
					return;
				}
			}

			// 新規フレーム到着（CRC正常）
			this.storedFrames.set(metadata.frameNumber, wireBytes);
			this.totalReceivedPayloadBits += metadata.payloadBitLen;

			if (this.state === "FirstEstablished" || this.state === "Receiving" || this.state === "WaitingMissingFrames") {
				this.state = "Receiving";
			}

			this.checkCompletion();
		};

		// 仕様書v8 Section 35: 到着したフレーム番号に対応する保留キュー項目を削除
		const res = this.removeSupersededPendingFrames(metadata.frameNumber);
		if (res instanceof Promise) {
			return res.then(continueProcessing);
		} else {
			return continueProcessing();
		}
	}

	/**
	 * CRCエラー発生時の内部カウント処理
	 */
	private handleCrcError(): void {
		this.consecutiveCrcErrors += 1;
		const maxErrors = this.config.transport.maxConsecutiveCrcErrors;

		this.emitError({
			code: "SYNTAX_ERROR",
			message: `Frame CRC check failed (Consecutive errors: ${this.consecutiveCrcErrors})`,
			critical: false,
		});

		if (maxErrors > 0 && this.consecutiveCrcErrors >= maxErrors) {
			this.emitError({
				code: "MAX_CRC_ERRORS_EXCEEDED",
				message: `Consecutive CRC errors exceeded threshold (${maxErrors})`,
				critical: true,
			});
		}
	}

	/**
	 * First QR受信前の保留キューを一括処理
	 */
	private processPendingQueue(): void | Promise<void> {
		if (this.pendingPreFirstFrames.length === 0) return;
		const queue = [...this.pendingPreFirstFrames];
		this.pendingPreFirstFrames = [];

		if (this.shouldUseWorker()) {
			return (async () => {
				for (const wireBytes of queue) {
					try {
						const metadata = await this.parseFrameInternal(wireBytes);
						if (this.storedFrames.has(metadata.frameNumber)) {
							continue;
						}
						await this.processPostFirstFrame(wireBytes, metadata);
					} catch {
						// 無効な保留フレームは無視
					}
				}
			})();
		} else {
			for (const wireBytes of queue) {
				try {
					const metadata = this.parseFrameInternal(wireBytes) as FrameMetadata;
					if (this.storedFrames.has(metadata.frameNumber)) {
						continue;
					}
					this.processPostFirstFrame(wireBytes, metadata);
				} catch {
					// 無効な保留フレームは無視
				}
			}
		}
	}

	/**
	 * 受信完了判定および全フレーム復元・検証処理
	 */
	private checkCompletion(): void {
		if (this.knownTotalQrCount === undefined) return;

		if (this.storedFrames.size < this.knownTotalQrCount) {
			this.state = "WaitingMissingFrames";
			return;
		}

		for (let i = 0; i < this.knownTotalQrCount; i++) {
			if (!this.storedFrames.has(i)) {
				this.state = "WaitingMissingFrames";
				return;
			}
		}

		this.state = "OverallCrcVerification";

		const orderedFrames: Uint8Array[] = [];
		for (let i = 0; i < this.knownTotalQrCount; i++) {
			orderedFrames.push(this.storedFrames.get(i)!);
		}

		if (this.shouldUseWorker()) {
			const worker = this.getOrCreateWorkerClient();
			worker
				.request("decodeFrames", { wireFrames: orderedFrames })
				.then((decoded) => {
					this.emitComplete(decoded);
				})
				.catch((err) => {
					this.emitError({
						code: "OVERALL_CRC_MISMATCH",
						message: `Overall CRC verification failed: ${String(err)}`,
						critical: true,
						details: err,
					});
				});
		} else {
			try {
				const decoded = DataApi.decodeFrames(orderedFrames);
				this.emitComplete(decoded);
			} catch (err) {
				this.emitError({
					code: "OVERALL_CRC_MISMATCH",
					message: `Overall CRC verification failed: ${String(err)}`,
					critical: true,
					details: err,
				});
			}
		}
	}
}
