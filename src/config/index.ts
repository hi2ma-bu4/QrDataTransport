import { calculateMaxFrameBits } from "../utils/qrCapacity";
import type { WorkerClientOptions } from "../utils/worker";
import type { QrEcLevel } from "../wasm/interfaces/snows-qr-data-transport-protocol";

export enum ParityMode {
	None = 0,
	Group8 = 8,
	Group16 = 16,
	Group32 = 32,
}

export interface TransportConfigOptions {
	maxConsecutiveCrcErrors?: number;
	maxPendingFramesBeforeFirst?: number;
	useWorker?: boolean;
	intervalMs?: number;
	workerUrl?: string | URL;
	createWorker?: WorkerClientOptions["createWorker"];
	workerType?: WorkerClientOptions["workerType"];
	timeout?: number;
}

export class TransportConfig {
	/**
	 * Maximum consecutive CRC errors before declaring a critical error.
	 * Default: 16.
	 * 0 means unlimited (disabled threshold).
	 * Values < 0 are invalid.
	 */
	public maxConsecutiveCrcErrors: number;

	/**
	 * Maximum number of pending frame byte arrays saved before receiving First QR.
	 * Default: 256.
	 */
	public maxPendingFramesBeforeFirst: number;

	/**
	 * Whether to use a Worker thread if available.
	 * Default: true.
	 */
	public useWorker: boolean;

	/**
	 * Frame transmission interval in milliseconds for send mode.
	 * Default: 100ms.
	 */
	public intervalMs: number;

	/** Worker configuration options */
	public workerUrl?: string | URL;
	public createWorker?: WorkerClientOptions["createWorker"];
	public workerType?: WorkerClientOptions["workerType"];
	public timeout?: number;

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

export interface DataConfigOptions {
	qrVersion?: number;
	ecLevel?: QrEcLevel;
	parityMode?: ParityMode | 0 | 8 | 16 | 32;
}

export class DataConfig {
	/**
	 * QR Code Version (1 ~ 40).
	 * Default: 5.
	 */
	public qrVersion: number;

	/**
	 * QR Code Error Correction Level ('l', 'm', 'q', 'h').
	 * Default: 'm'.
	 */
	public ecLevel: QrEcLevel;

	/**
	 * Parity Mode (0, 8, 16, 32).
	 * Default: ParityMode.None (0).
	 */
	public parityMode: ParityMode;

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
	 * Maximum total bits per wire frame calculated automatically from qrVersion and ecLevel.
	 */
	public get maxFrameBits(): number {
		return calculateMaxFrameBits(this.qrVersion, this.ecLevel);
	}

	public clone(): DataConfig {
		return new DataConfig({
			qrVersion: this.qrVersion,
			ecLevel: this.ecLevel,
			parityMode: this.parityMode,
		});
	}
}

export interface BrowserRuntimeConfigOptions {
	renderFps?: number;
	cameraFps?: number;
	decodeFrequency?: number;
	qrWidth?: number;
	qrHeight?: number;
	canvasWidth?: number;
	canvasHeight?: number;
	facingMode?: "environment" | "user" | string;
	deviceId?: string;
}

export class BrowserRuntimeConfig {
	public renderFps: number;
	public cameraFps: number;
	public decodeFrequency: number;
	public qrWidth: number;
	public qrHeight: number;
	public canvasWidth: number;
	public canvasHeight: number;
	public facingMode: "environment" | "user" | string;
	public deviceId?: string;

	constructor(options?: BrowserRuntimeConfigOptions) {
		this.renderFps = options?.renderFps ?? 10;
		this.cameraFps = options?.cameraFps ?? 30;
		this.decodeFrequency = options?.decodeFrequency ?? 10;
		this.qrWidth = options?.qrWidth ?? 300;
		this.qrHeight = options?.qrHeight ?? 300;
		this.canvasWidth = options?.canvasWidth ?? 300;
		this.canvasHeight = options?.canvasHeight ?? 300;
		this.facingMode = options?.facingMode ?? "environment";
		this.deviceId = options?.deviceId;
	}

	public clone(): BrowserRuntimeConfig {
		return new BrowserRuntimeConfig({
			renderFps: this.renderFps,
			cameraFps: this.cameraFps,
			decodeFrequency: this.decodeFrequency,
			qrWidth: this.qrWidth,
			qrHeight: this.qrHeight,
			canvasWidth: this.canvasWidth,
			canvasHeight: this.canvasHeight,
			facingMode: this.facingMode,
			deviceId: this.deviceId,
		});
	}
}

export interface UnifiedConfigOptions {
	transport?: TransportConfigOptions;
	data?: DataConfigOptions;
	browserRuntime?: BrowserRuntimeConfigOptions;
}

export class AppConfig {
	public transport: TransportConfig;
	public data: DataConfig;
	public browserRuntime: BrowserRuntimeConfig;

	constructor(options?: UnifiedConfigOptions) {
		this.transport = new TransportConfig(options?.transport);
		this.data = new DataConfig(options?.data);
		this.browserRuntime = new BrowserRuntimeConfig(options?.browserRuntime);
	}

	public clone(): AppConfig {
		return new AppConfig({
			transport: this.transport.clone(),
			data: this.data.clone(),
			browserRuntime: this.browserRuntime.clone(),
		});
	}
}
