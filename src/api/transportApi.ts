import { AppConfig, ParityMode } from "../config/index";
import type { FrameMetadata } from "../wasm/interfaces/snows-qr-data-transport-protocol";
import type { RenderQrOptions, RuntimeApi } from "./browserRuntimeApi";
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
	qrVersion?: number;
	ecLevel?: "l" | "m" | "q" | "h";
	intervalMs?: number;
	parityMode?: ParityMode | 0 | 8 | 16 | 32;
	canvas?: HTMLCanvasElement | string;
	renderOptions?: RenderQrOptions;
}

export interface ReceiveOptions {
	maxConsecutiveCrcErrors?: number;
	maxPendingFramesBeforeFirst?: number;
	useWorker?: boolean;
}

export interface SendProgressEvent {
	index: number;
	maxIndex: number;
}

export interface FrameProcessedEvent {
	validCount: number;
	pendingCount: number;
	totalCount: number;
	isQrDetected: boolean;
	bps: number;
}

export class TransportApi {
	private state: TransportState = "Idle";
	private config: AppConfig;
	private runtime?: RuntimeApi;

	// Callbacks
	private warningCallbacks: ((warning: TransportWarning) => void)[] = [];
	private errorCallbacks: ((error: TransportError) => void)[] = [];
	private completeCallbacks: ((result: DecodedResult) => void)[] = [];
	private frameProcessedCallbacks: ((event: FrameProcessedEvent) => void)[] = [];
	private sendProgressCallbacks: ((event: SendProgressEvent) => void)[] = [];

	// Sender state
	private sendTimer: ReturnType<typeof setInterval> | null = null;
	private sendWireFrames: Uint8Array[] = [];
	private sendFrameIndex = 0;
	private sendCanvasTarget?: HTMLCanvasElement | string;

	// Receiver state
	private pendingPreFirstFrames: Uint8Array[] = [];
	private storedFrames: Map<number, Uint8Array> = new Map();
	private knownTotalQrCount?: number;
	private knownFirstFrameCrc?: number;
	private consecutiveCrcErrors = 0;
	private receiveStartTime: number | null = null;
	private totalReceivedWireBits = 0;
	private lastQrDetected = false;

	constructor(config?: AppConfig, runtime?: RuntimeApi) {
		this.config = config ? config.clone() : new AppConfig();
		this.runtime = runtime;
	}

	public setRuntime(runtime?: RuntimeApi): void {
		this.runtime = runtime;
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

	public onSendProgress(callback: (event: SendProgressEvent) => void): void {
		this.sendProgressCallbacks.push(callback);
	}

	public onFrameProcessed(callback: (event: FrameProcessedEvent) => void): void {
		this.frameProcessedCallbacks.push(callback);
		// Emit initial status when subscribing
		callback(this.buildFrameProcessedEvent());
	}

	private buildFrameProcessedEvent(): FrameProcessedEvent {
		let bps = 0;
		if (this.receiveStartTime !== null) {
			const elapsedSec = (performance.now() - this.receiveStartTime) / 1000;
			if (elapsedSec > 0) {
				bps = Math.round(this.totalReceivedWireBits / elapsedSec);
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

	private emitFrameProcessed(): void {
		const event = this.buildFrameProcessedEvent();
		for (const cb of this.frameProcessedCallbacks) {
			cb(event);
		}
	}

	private emitSendProgress(): void {
		if (this.sendWireFrames.length === 0) return;
		const event: SendProgressEvent = {
			index: this.sendFrameIndex + 1, // 1-based indexing for external users
			maxIndex: this.sendWireFrames.length,
		};
		for (const cb of this.sendProgressCallbacks) {
			cb(event);
		}
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
		if (this.runtime) {
			this.runtime.stopCamera();
		}
		for (const cb of this.completeCallbacks) {
			cb(result);
		}
	}

	// ------------------------------------------------------------------
	// Sender Implementation
	// ------------------------------------------------------------------

	public async startSend(data: Uint8Array | string, options?: SendOptions): Promise<void> {
		// Spec v8 Section 31, 75.1, 79: Ignore duplicate startSend calls while transmission is active
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
			if (typeof data === "string") {
				encodedResult = DataApi.encodeText(data, this.config.data.qrVersion, this.config.data.ecLevel, this.config.data.parityMode);
			} else {
				encodedResult = DataApi.encodeBytes(data, this.config.data.qrVersion, this.config.data.ecLevel, this.config.data.parityMode);
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

		const renderCurrentFrame = () => {
			const currentFrame = this.getCurrentSendFrame();
			if (currentFrame && this.runtime) {
				try {
					const matrix = DataApi.generateQrMatrix(currentFrame, this.config.data.qrVersion, this.config.data.ecLevel);
					this.runtime.renderQrModuleMatrix(matrix, {
						canvas: this.sendCanvasTarget,
						width: this.config.browserRuntime.canvasWidth,
						height: this.config.browserRuntime.canvasHeight,
						...options?.renderOptions,
					});
				} catch {
					// Ignore render errors in headless environments
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
		if (this.runtime) {
			this.runtime.clearCanvas(this.sendCanvasTarget);
		}
		this.sendWireFrames = [];
		this.sendFrameIndex = 0;
		this.sendCanvasTarget = undefined;
	}

	// ------------------------------------------------------------------
	// Receiver Implementation
	// ------------------------------------------------------------------

	public async startReceive(options?: ReceiveOptions): Promise<void> {
		// Spec v8 Section 75.1, 79: Ignore duplicate startReceive calls when already receiving
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

	public stopReceive(): void {
		if (this.runtime) {
			this.runtime.stopCamera();
		}
		this.resetReceiverState();
		this.state = "Idle";
	}

	private resetReceiverState(): void {
		this.pendingPreFirstFrames = [];
		this.storedFrames.clear();
		this.knownTotalQrCount = undefined;
		this.knownFirstFrameCrc = undefined;
		this.consecutiveCrcErrors = 0;
		this.receiveStartTime = null;
		this.totalReceivedWireBits = 0;
		this.lastQrDetected = false;
		this.emitFrameProcessed();
	}

	public getPendingPreFirstQueueLength(): number {
		return this.pendingPreFirstFrames.length;
	}

	/**
	 * Process an incoming raw wire frame array.
	 */
	public processFrame(wireBytes?: Uint8Array | null): void {
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

		try {
			// Spec v8 Section 11 & 32: Start bit is 1 for First QR, 0 for Non-First
			const isStartBitSet = (wireBytes[0] & 0x80) !== 0;

			if (this.state === "WaitingForFirst") {
				if (!isStartBitSet) {
					// Spec v8 Section 32, 33, 34: Non-first frame arriving before First QR -> queue temporarily without parsing or CRC error
					if (this.pendingPreFirstFrames.length < this.config.transport.maxPendingFramesBeforeFirst) {
						const isDuplicate = this.pendingPreFirstFrames.some((b) => b.length === wireBytes.length && b.every((val, idx) => val === wireBytes[idx]));
						if (!isDuplicate) {
							this.pendingPreFirstFrames.push(wireBytes);
						}
					}
					// Even if queue is full, real-time camera decoding and checking for First QR continues!
					return;
				}
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
						this.establishFirstQr(wireBytes, metadata);
						this.processPendingQueue();
					} else {
						// Corrupted First QR -> count CRC error
						this.handleCrcError();
					}
				}
				return;
			}

			this.processPostFirstFrame(wireBytes, metadata);
		} finally {
			this.emitFrameProcessed();
		}
	}

	private establishFirstQr(wireBytes: Uint8Array, metadata: FrameMetadata): void {
		this.knownTotalQrCount = metadata.totalQrCount;
		this.knownFirstFrameCrc = metadata.frameCrc;
		this.storedFrames.set(0, wireBytes);
		this.totalReceivedWireBits += wireBytes.length * 8;
		this.state = metadata.totalQrCount === 1 ? "OverallCrcVerification" : "FirstEstablished";

		if (metadata.totalQrCount === 1) {
			this.checkCompletion();
		}
	}

	private removeSupersededPendingFrames(frameNumber: number): void {
		if (this.pendingPreFirstFrames.length === 0) return;
		this.pendingPreFirstFrames = this.pendingPreFirstFrames.filter((wire) => {
			try {
				const meta = DataApi.parseFrame(wire, this.knownTotalQrCount, this.knownFirstFrameCrc);
				return meta.frameNumber !== frameNumber;
			} catch {
				return false;
			}
		});
	}

	private processPostFirstFrame(wireBytes: Uint8Array, metadata: FrameMetadata): void {
		if (!metadata.crcValid) {
			this.handleCrcError();
			return;
		}

		// CRC is VALID! Reset consecutive error count
		this.consecutiveCrcErrors = 0;

		// Spec v8 Section 35: Remove superseded pre-first queued items for this frame number
		this.removeSupersededPendingFrames(metadata.frameNumber);

		const existingWire = this.storedFrames.get(metadata.frameNumber);
		if (existingWire) {
			let existingMeta: FrameMetadata | undefined;
			try {
				existingMeta = DataApi.parseFrame(existingWire, this.knownTotalQrCount, this.knownFirstFrameCrc);
			} catch {
				// ignore
			}

			// Spec v8 Section 38, 39, 60: If First QR (Frame 0) arrives with a different First CRC, update communication reference and discard subsequent frames!
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
				// Frame Number and Payload Length match existing -> Skip!
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
			return;
		}

		// New Frame arrival (CRC valid)
		this.storedFrames.set(metadata.frameNumber, wireBytes);
		this.totalReceivedWireBits += wireBytes.length * 8;

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
		if (this.pendingPreFirstFrames.length === 0) return;
		const queue = [...this.pendingPreFirstFrames];
		this.pendingPreFirstFrames = [];

		for (const wireBytes of queue) {
			try {
				const metadata = DataApi.parseFrame(wireBytes, this.knownTotalQrCount, this.knownFirstFrameCrc);
				if (this.storedFrames.has(metadata.frameNumber)) {
					continue;
				}
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
