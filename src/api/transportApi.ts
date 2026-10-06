export type TransportState = "Idle" | "WaitingForFirst" | "FirstEstablished" | "Receiving" | "WaitingMissingFrames" | "OverallCrcVerification" | "Completed" | "Error";

export interface SendOptions {
	maxFrameBits?: number;
	qrVersion?: number;
	ecLevel?: "l" | "m" | "q" | "h";
	intervalMs?: number;
}

export interface ReceiveOptions {
	maxConsecutiveCrcErrors?: number;
	maxPendingFramesBeforeFirst?: number;
}

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

export interface TransportApi {
	startSend(data: Uint8Array | string, options?: SendOptions): Promise<void>;
	stopSend(): void;
	startReceive(options?: ReceiveOptions): Promise<void>;
	stopReceive(): void;
	getState(): TransportState;
	onWarning(callback: (warning: TransportWarning) => void): void;
	onError(callback: (error: TransportError) => void): void;
	onComplete(callback: (result: { type: "Uint8Array" | "string"; data: Uint8Array | string }) => void): void;
}
