import { AppConfig } from "../config/index";
import type { FrameMetadata } from "../wasm/interfaces/snows-qr-data-transport-protocol";
import { DataApi, type DecodedResult } from "./dataApi";

export type TransportState = "Idle" | "WaitingForFirst" | "FirstEstablished" | "Receiving" | "WaitingMissingFrames" | "OverallCrcVerification" | "Completed" | "Error";

export type WarningCode = "FRAME_CHANGED" | "FRAME_REPLACED" | "POST_FIRST_FRAMES_DISCARDED" | "UNKNOWN_VERSION_CONTINUED";

export type ErrorCode = "INVALID_VERSION" | "UNDEFINED_DATA_TYPE" | "INVALID_TOTAL_QR_COUNT" | "SYNTAX_ERROR" | "ASCII_OUT_OF_RANGE" | "STRING_DECODE_FAILED" | "MAX_CRC_ERRORS_EXCEEDED" | "OVERALL_CRC_MISMATCH";

export interface TransportWarning {
	code: WarningCode;
	message: string;
	details?: unknown;
}

export interface TransportError {
	code: ErrorCode;
	message: string;
	critical: boolean;
	details?: unknown;
}

export interface SendOptions {
	maxFrameBits?: number;
	qrVersion?: number;
	ecLevel?: "l" | "m" | "q" | "h";
	intervalMs?: number;
}

export interface ReceiveOptions {
	maxConsecutiveCrcErrors?: number;
	maxPendingFramesBeforeFirst?: number;
	useWorker?: boolean;
}

export class TransportApi {
	private state: TransportState = "Idle";
	private config: AppConfig;

	// Callbacks
	private warningCallbacks: ((warning: TransportWarning) => void)[] = [];
	private errorCallbacks: ((error: TransportError) => void)[] = [];
	private completeCallbacks: ((result: DecodedResult) => void)[] = [];

	// Sender state
	private sendTimer: ReturnType<typeof setInterval> | null = null;
	private sendWireFrames: Uint8Array[] = [];
	private sendFrameIndex = 0;

	// Receiver state
	private pendingPreFirstFrames: Uint8Array[] = [];
	private storedFrames: Map<number, Uint8Array> = new Map();
	private knownTotalQrCount?: number;
	private knownFirstFrameCrc?: number;
	private consecutiveCrcErrors = 0;

	constructor(config?: AppConfig) {
		this.config = config ? config.clone() : new AppConfig();
	}

	public getConfig(): AppConfig {
		return this.config;
	}

	public getState(): TransportState {
		return this.state;
	}

	public onWarning(callback: (warning: TransportWarning) => void): void {
		this.warningCallbacks.push(callback);
	}

	public onError(callback: (error: TransportError) => void): void {
		this.errorCallbacks.push(callback);
	}

	public onComplete(callback: (result: DecodedResult) => void): void {
		this.completeCallbacks.push(callback);
	}

	private emitWarning(warning: TransportWarning): void {
		for (const cb of this.warningCallbacks) {
			cb(warning);
		}
	}

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

	private emitComplete(result: DecodedResult): void {
		this.state = "Completed";
		for (const cb of this.completeCallbacks) {
			cb(result);
		}
	}

	// ------------------------------------------------------------------
	// Sender Implementation
	// ------------------------------------------------------------------

	public async startSend(data: Uint8Array | string, options?: SendOptions): Promise<void> {
		if (this.sendTimer !== null) {
			return;
		}

		if (options) {
			if (options.maxFrameBits !== undefined) {
				this.config.data.maxFrameBits = options.maxFrameBits;
			}
			if (options.qrVersion !== undefined) {
				this.config.data.qrVersion = options.qrVersion;
			}
			if (options.ecLevel !== undefined) {
				this.config.data.ecLevel = options.ecLevel;
			}
			if (options.intervalMs !== undefined) {
				this.config.transport.intervalMs = options.intervalMs;
			}
		}

		let encodedResult;
		try {
			if (typeof data === "string") {
				encodedResult = DataApi.encodeText(data, this.config.data.maxFrameBits);
			} else {
				encodedResult = DataApi.encodeBytes(data, this.config.data.maxFrameBits);
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

		this.sendWireFrames = encodedResult.frames.map((f) => new Uint8Array(f.wireBytes));
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

		this.sendTimer = setInterval(() => {
			if (this.sendWireFrames.length === 0) return;
			this.sendFrameIndex = (this.sendFrameIndex + 1) % this.sendWireFrames.length;
		}, interval);
	}

	public getCurrentSendFrame(): Uint8Array | null {
		if (this.sendWireFrames.length === 0) return null;
		return this.sendWireFrames[this.sendFrameIndex];
	}

	public stopSend(): void {
		this.resetSenderState();
	}

	private resetSenderState(): void {
		if (this.sendTimer !== null) {
			clearInterval(this.sendTimer);
			this.sendTimer = null;
		}
		this.sendWireFrames = [];
		this.sendFrameIndex = 0;
	}

	// ------------------------------------------------------------------
	// Receiver Implementation
	// ------------------------------------------------------------------

	public async startReceive(options?: ReceiveOptions): Promise<void> {
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
		this.state = "WaitingForFirst";
	}

	public stopReceive(): void {
		this.resetReceiverState();
		this.state = "Idle";
	}

	private resetReceiverState(): void {
		this.pendingPreFirstFrames = [];
		this.storedFrames.clear();
		this.knownTotalQrCount = undefined;
		this.knownFirstFrameCrc = undefined;
		this.consecutiveCrcErrors = 0;
	}

	/**
	 * Process an incoming raw wire frame array.
	 */
	public processFrame(wireBytes: Uint8Array): void {
		if (this.state === "Idle" || this.state === "Completed" || this.state === "Error") {
			return;
		}

		let metadata: FrameMetadata;
		try {
			metadata = DataApi.parseFrame(wireBytes, this.knownTotalQrCount, this.knownFirstFrameCrc);
		} catch (err) {
			this.emitError({
				code: "SYNTAX_ERROR",
				message: `Syntax error during frame parsing: ${String(err)}`,
				critical: false,
			});
			return;
		}

		// Spec v8 Section 41: Out-of-range frame number -> ignore
		if (this.knownTotalQrCount !== undefined && metadata.frameNumber >= this.knownTotalQrCount) {
			return;
		}

		// Version 0 check applies only to First QR (since Non-First frames have no Version field)
		if (metadata.isFirst && metadata.version === 0) {
			this.emitError({
				code: "INVALID_VERSION",
				message: "Library Format Version 0 is invalid",
				critical: true,
			});
			return;
		}

		if (this.state === "WaitingForFirst") {
			if (metadata.isFirst) {
				if (metadata.crcValid) {
					this.establishFirstQr(wireBytes, metadata);
					this.processPendingQueue();
				} else {
					// Corrupted First QR -> count CRC error
					this.handleCrcError();
				}
			} else {
				// Non-first frame arriving before First QR -> queue for later (does NOT count for CRC error)
				if (this.pendingPreFirstFrames.length < this.config.transport.maxPendingFramesBeforeFirst) {
					const exists = this.pendingPreFirstFrames.some((b) => {
						try {
							const meta = DataApi.parseFrame(b);
							return meta.frameNumber === metadata.frameNumber;
						} catch {
							return false;
						}
					});
					if (!exists) {
						this.pendingPreFirstFrames.push(wireBytes);
					}
				}
			}
			return;
		}

		this.processPostFirstFrame(wireBytes, metadata);
	}

	private establishFirstQr(wireBytes: Uint8Array, metadata: FrameMetadata): void {
		this.knownTotalQrCount = metadata.totalQrCount;
		this.knownFirstFrameCrc = metadata.frameCrc;
		this.storedFrames.set(0, wireBytes);
		this.state = metadata.totalQrCount === 1 ? "OverallCrcVerification" : "FirstEstablished";

		if (metadata.totalQrCount === 1) {
			this.checkCompletion();
		}
	}

	private processPostFirstFrame(wireBytes: Uint8Array, metadata: FrameMetadata): void {
		if (!metadata.crcValid) {
			this.handleCrcError();
			return;
		}

		// CRC is VALID! Reset consecutive error count
		this.consecutiveCrcErrors = 0;

		const existingWire = this.storedFrames.get(metadata.frameNumber);
		if (existingWire) {
			let existingMeta: FrameMetadata | undefined;
			try {
				existingMeta = DataApi.parseFrame(existingWire, this.knownTotalQrCount, this.knownFirstFrameCrc);
			} catch {
				// ignore
			}

			if (existingMeta && existingMeta.payloadBitLen === metadata.payloadBitLen) {
				// Frame Number and Payload Length match existing -> Skip!
				return;
			}

			// Spec v8 Section 39 & 60: If First QR (Frame 0) modified, check First CRC change!
			if (metadata.frameNumber === 0) {
				if (metadata.frameCrc !== this.knownFirstFrameCrc) {
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
			}

			this.storedFrames.set(metadata.frameNumber, wireBytes);
			this.emitWarning({
				code: "FRAME_REPLACED",
				message: `Frame ${metadata.frameNumber} replaced with updated payload`,
			});
			this.checkCompletion();
			return;
		}

		// New Frame arrival (CRC valid)
		this.storedFrames.set(metadata.frameNumber, wireBytes);

		if (this.state === "FirstEstablished" || this.state === "Receiving" || this.state === "WaitingMissingFrames") {
			this.state = "Receiving";
		}

		this.checkCompletion();
	}

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

	private processPendingQueue(): void {
		const queue = [...this.pendingPreFirstFrames];
		this.pendingPreFirstFrames = [];

		for (const wireBytes of queue) {
			try {
				const metadata = DataApi.parseFrame(wireBytes, this.knownTotalQrCount, this.knownFirstFrameCrc);
				this.processPostFirstFrame(wireBytes, metadata);
			} catch {
				// ignore invalid pending frame
			}
		}
	}

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
