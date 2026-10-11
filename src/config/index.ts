import { calculateMaxFrameBits } from "../utils/qrCapacity";
import type { WorkerClientOptions } from "../utils/worker";
import type { QrEcLevel } from "../wasm/interfaces/snows-qr-data-transport-protocol";

/**
 * パリティモード列挙型
 *
 * QRコード送信用パリティインターリーブ設定
 */
export enum ParityMode {
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
	Group32 = 32,
}

/**
 * トランスポート設定オプション
 */
export interface TransportConfigOptions {
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
export class TransportConfig {
	/**
	 * 許容する連続CRCエラーの最大回数
	 *
	 * 0は無制限を意味し、負の値は無効。デフォルト値は16。
	 */
	public maxConsecutiveCrcErrors: number;

	/**
	 * First QR受信前に保持する保留フレームの最大数
	 *
	 * デフォルト値は256。
	 */
	public maxPendingFramesBeforeFirst: number;

	/**
	 * Web Workerを使用するかどうか
	 *
	 * デフォルト値はtrue。
	 */
	public useWorker: boolean;

	/**
	 * 送信時のフレーム描画間隔（ミリ秒）
	 *
	 * デフォルト値は100ms。
	 */
	public intervalMs: number;

	/**
	 * WorkerのスクリプトURL
	 */
	public workerUrl?: string | URL;

	/**
	 * カスタムWorker生成関数
	 */
	public createWorker?: WorkerClientOptions["createWorker"];

	/**
	 * Workerの実行タイプ
	 */
	public workerType?: WorkerClientOptions["workerType"];

	/**
	 * Workerリクエストのタイムアウト時間（ミリ秒）
	 */
	public timeout?: number;

	/**
	 * TransportConfigのインスタンスを生成
	 *
	 * @param options - 設定オプション
	 */
	constructor(options?: TransportConfigOptions) {
		const crcMax = options?.maxConsecutiveCrcErrors ?? 16;
		if (crcMax < 0) {
			throw new Error("maxConsecutiveCrcErrors must be non-negative");
		}
		this.maxConsecutiveCrcErrors = crcMax;

		const pendingMax = options?.maxPendingFramesBeforeFirst ?? 256;
		if (pendingMax < 0) {
			throw new Error("maxPendingFramesBeforeFirst must be non-negative");
		}
		this.maxPendingFramesBeforeFirst = pendingMax;

		this.useWorker = options?.useWorker ?? true;
		this.intervalMs = options?.intervalMs ?? 100;

		this.workerUrl = options?.workerUrl;
		this.createWorker = options?.createWorker;
		this.workerType = options?.workerType;
		this.timeout = options?.timeout;
	}

	/**
	 * 設定オブジェクトを複製
	 *
	 * @returns 複製されたTransportConfigインスタンス
	 */
	public clone(): TransportConfig {
		return new TransportConfig({
			maxConsecutiveCrcErrors: this.maxConsecutiveCrcErrors,
			maxPendingFramesBeforeFirst: this.maxPendingFramesBeforeFirst,
			useWorker: this.useWorker,
			intervalMs: this.intervalMs,
			workerUrl: this.workerUrl,
			createWorker: this.createWorker,
			workerType: this.workerType,
			timeout: this.timeout,
		});
	}
}

/**
 * データエンコード設定オプション
 */
export interface DataConfigOptions {
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
export class DataConfig {
	/**
	 * QRコードバージョン (1 ~ 40)
	 *
	 * デフォルト値は5。
	 */
	public qrVersion: number;

	/**
	 * QRコード誤り訂正レベル ('l', 'm', 'q', 'h')
	 *
	 * デフォルト値は'm'。
	 */
	public ecLevel: QrEcLevel;

	/**
	 * パリティモード (0, 8, 16, 32)
	 *
	 * デフォルト値はParityMode.None (0)。
	 */
	public parityMode: ParityMode;

	/**
	 * DataConfigのインスタンスを生成
	 *
	 * @param options - 設定オプション
	 */
	constructor(options?: DataConfigOptions) {
		const ver = options?.qrVersion ?? 5;
		if (ver < 1 || ver > 40) {
			throw new Error("qrVersion must be between 1 and 40");
		}
		this.qrVersion = ver;

		const ec = options?.ecLevel ?? "m";
		if (!["l", "m", "q", "h"].includes(ec)) {
			throw new Error("ecLevel must be one of 'l', 'm', 'q', 'h'");
		}
		this.ecLevel = ec;

		const pm = options?.parityMode ?? ParityMode.None;
		if (![0, 8, 16, 32].includes(pm)) {
			throw new Error("parityMode must be 0, 8, 16, or 32");
		}
		this.parityMode = pm as ParityMode;
	}

	/**
	 * 1フレームあたりの最大ビット数を取得
	 *
	 * qrVersionとecLevelから自動算出されるワイヤーフレームの最大ビット数。
	 *
	 * @returns 最大ビット数
	 */
	public get maxFrameBits(): number {
		return calculateMaxFrameBits(this.qrVersion, this.ecLevel);
	}

	/**
	 * 設定オブジェクトを複製
	 *
	 * @returns 複製されたDataConfigインスタンス
	 */
	public clone(): DataConfig {
		return new DataConfig({
			qrVersion: this.qrVersion,
			ecLevel: this.ecLevel,
			parityMode: this.parityMode,
		});
	}
}

/**
 * ブラウザランタイム設定オプション
 */
export interface BrowserRuntimeConfigOptions {
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
	 * キャンバス幅 (ピクセル)
	 */
	canvasWidth?: number;

	/**
	 * キャンバス高さ (ピクセル)
	 */
	canvasHeight?: number;

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
export class BrowserRuntimeConfig {
	/**
	 * 描画フレームレート (fps)
	 */
	public renderFps: number;

	/**
	 * カメラフレームレート (fps)
	 */
	public cameraFps: number;

	/**
	 * QRコード描画幅 (ピクセル)
	 */
	public qrWidth: number;

	/**
	 * QRコード描画高さ (ピクセル)
	 */
	public qrHeight: number;

	/**
	 * キャンバス幅 (ピクセル)
	 */
	public canvasWidth: number;

	/**
	 * キャンバス高さ (ピクセル)
	 */
	public canvasHeight: number;

	/**
	 * カメラの向き ("environment" | "user" | string)
	 */
	public facingMode: "environment" | "user" | string;

	/**
	 * カメラのデバイスID
	 */
	public deviceId?: string;

	/**
	 * BrowserRuntimeConfigのインスタンスを生成
	 *
	 * @param options - 設定オプション
	 */
	constructor(options?: BrowserRuntimeConfigOptions) {
		this.renderFps = options?.renderFps ?? 60;
		this.cameraFps = options?.cameraFps ?? 60;
		this.qrWidth = options?.qrWidth ?? 300;
		this.qrHeight = options?.qrHeight ?? 300;
		this.canvasWidth = options?.canvasWidth ?? 300;
		this.canvasHeight = options?.canvasHeight ?? 300;
		this.facingMode = options?.facingMode ?? "environment";
		this.deviceId = options?.deviceId;
	}

	/**
	 * 設定オブジェクトを複製
	 *
	 * @returns 複製されたBrowserRuntimeConfigインスタンス
	 */
	public clone(): BrowserRuntimeConfig {
		return new BrowserRuntimeConfig({
			renderFps: this.renderFps,
			cameraFps: this.cameraFps,
			qrWidth: this.qrWidth,
			qrHeight: this.qrHeight,
			canvasWidth: this.canvasWidth,
			canvasHeight: this.canvasHeight,
			facingMode: this.facingMode,
			deviceId: this.deviceId,
		});
	}
}

/**
 * 統合アプリケーション設定オプション
 */
export interface UnifiedConfigOptions {
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
export class AppConfig {
	/**
	 * トランスポート設定
	 */
	public transport: TransportConfig;

	/**
	 * データエンコード設定
	 */
	public data: DataConfig;

	/**
	 * ブラウザランタイム設定
	 */
	public browserRuntime: BrowserRuntimeConfig;

	/**
	 * AppConfigのインスタンスを生成
	 *
	 * @param options - 統合設定オプション
	 */
	constructor(options?: UnifiedConfigOptions) {
		this.transport = new TransportConfig(options?.transport);
		this.data = new DataConfig(options?.data);
		this.browserRuntime = new BrowserRuntimeConfig(options?.browserRuntime);
	}

	/**
	 * 設定オブジェクトを複製
	 *
	 * @returns 複製されたAppConfigインスタンス
	 */
	public clone(): AppConfig {
		return new AppConfig({
			transport: this.transport.clone(),
			data: this.data.clone(),
			browserRuntime: this.browserRuntime.clone(),
		});
	}
}
