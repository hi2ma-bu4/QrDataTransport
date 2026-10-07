/** @module Interface snows:qr-data-transport/protocol **/
declare function encodeBytes(data: Uint8Array, maxFrameBits: number): EncodeResult;
declare function encodeText(text: string, maxFrameBits: number): EncodeResult;
declare function parseFrame(wireBytes: Uint8Array, knownTotalQrCount: number | undefined, knownFirstFrameCrc: number | undefined): FrameMetadata;
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
  version: number,
  totalQrCount: number,
  frameNumber: number,
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

interface RenderQrOptions {
    canvas?: HTMLCanvasElement | string;
    width?: number;
    height?: number;
}
interface CameraOptions {
    deviceId?: string;
    fps?: number;
    width?: number;
    height?: number;
}
interface QrModuleMatrixData {
    width: number;
    height: number;
    modules: Uint8Array;
}
/**
 * Runtime API interface for display rendering and camera operations.
 * Allows TransportApi to remain runtime-agnostic.
 */
interface RuntimeApi {
    renderQrModuleMatrix(matrix: QrModuleMatrixData, options?: RenderQrOptions): void;
    clearCanvas(canvas?: HTMLCanvasElement | string): void;
    startCamera(onFrame: (rgbaPixels: Uint8Array, width: number, height: number) => void, options?: CameraOptions): Promise<void>;
    stopCamera(): void;
    isWorkerSupported(): boolean;
}
declare class BrowserRuntimeApi implements RuntimeApi {
    private cameraStream;
    private cameraVideo;
    private cameraAnimationId;
    private resolveCanvas;
    renderQrModuleMatrix(matrix: QrModuleMatrixData, options?: RenderQrOptions): void;
    clearCanvas(canvasTarget?: HTMLCanvasElement | string): void;
    startCamera(onFrame: (rgbaPixels: Uint8Array, width: number, height: number) => void, options?: CameraOptions): Promise<void>;
    stopCamera(): void;
    isWorkerSupported(): boolean;
}

interface DecodedResult {
    type: "Uint8Array" | "string";
    data: Uint8Array | string;
}
declare class DataApi {
    /**
     * Encodes raw bytes into wire frames using WASM protocol core.
     * Automatically calculates maxFrameBits from qrVersion and ecLevel if qrVersion <= 40.
     */
    static encodeBytes(data: Uint8Array, qrVersion?: number, ecLevel?: QrEcLevel): EncodeResult;
    /**
     * Encodes text into wire frames using WASM protocol core.
     * Automatically calculates maxFrameBits from qrVersion and ecLevel if qrVersion <= 40.
     */
    static encodeText(text: string, qrVersion?: number, ecLevel?: QrEcLevel): EncodeResult;
    /**
     * Parses a single wire frame and verifies its CRC.
     */
    static parseFrame(wireBytes: Uint8Array, knownTotalQrCount?: number, knownFirstFrameCrc?: number): FrameMetadata;
    /**
     * Decodes a complete list of wire frames and returns the payload along with its type.
     * Returns { type: "Uint8Array" | "string", data: Uint8Array | string } according to Spec v8.
     */
    static decodeFrames(wireFrames: Uint8Array[]): DecodedResult;
    /**
     * Generates a binary QR module matrix using qrcodegen via WASM.
     */
    static generateQrMatrix(wireBytes: Uint8Array, qrVersion: number, ecLevel: QrEcLevel): QrModuleMatrix;
    /**
     * Decodes QR code image pixels (RGBA) to wire bytes using rxing via WASM.
     */
    static decodeQrImage(rgbaPixels: Uint8Array, width: number, height: number): Uint8Array;
}

interface TransportConfigOptions {
    maxConsecutiveCrcErrors?: number;
    maxPendingFramesBeforeFirst?: number;
    useWorker?: boolean;
    intervalMs?: number;
}
declare class TransportConfig {
    /**
     * Maximum consecutive CRC errors before declaring a critical error.
     * Default: 16.
     * 0 means unlimited (disabled threshold).
     * Values < 0 are invalid.
     */
    maxConsecutiveCrcErrors: number;
    /**
     * Maximum number of pending frame byte arrays saved before receiving First QR.
     * Default: 32.
     */
    maxPendingFramesBeforeFirst: number;
    /**
     * Whether to use a Worker thread if available.
     * Default: true.
     */
    useWorker: boolean;
    /**
     * Frame transmission interval in milliseconds for send mode.
     * Default: 100ms.
     */
    intervalMs: number;
    constructor(options?: TransportConfigOptions);
    clone(): TransportConfig;
}
interface DataConfigOptions {
    qrVersion?: number;
    ecLevel?: QrEcLevel;
}
declare class DataConfig {
    /**
     * QR Code Version (1 ~ 40).
     * Default: 5.
     */
    qrVersion: number;
    /**
     * QR Code Error Correction Level ('l', 'm', 'q', 'h').
     * Default: 'm'.
     */
    ecLevel: QrEcLevel;
    constructor(options?: DataConfigOptions);
    /**
     * Maximum total bits per wire frame calculated automatically from qrVersion and ecLevel.
     */
    get maxFrameBits(): number;
    clone(): DataConfig;
}
interface BrowserRuntimeConfigOptions {
    renderFps?: number;
    cameraFps?: number;
    decodeFrequency?: number;
    qrWidth?: number;
    qrHeight?: number;
    canvasWidth?: number;
    canvasHeight?: number;
}
declare class BrowserRuntimeConfig {
    renderFps: number;
    cameraFps: number;
    decodeFrequency: number;
    qrWidth: number;
    qrHeight: number;
    canvasWidth: number;
    canvasHeight: number;
    constructor(options?: BrowserRuntimeConfigOptions);
    clone(): BrowserRuntimeConfig;
}
interface UnifiedConfigOptions {
    transport?: TransportConfigOptions;
    data?: DataConfigOptions;
    browserRuntime?: BrowserRuntimeConfigOptions;
}
declare class AppConfig {
    transport: TransportConfig;
    data: DataConfig;
    browserRuntime: BrowserRuntimeConfig;
    constructor(options?: UnifiedConfigOptions);
    clone(): AppConfig;
}

type TransportState = "Idle" | "WaitingForFirst" | "FirstEstablished" | "Receiving" | "WaitingMissingFrames" | "OverallCrcVerification" | "Completed" | "Error";
type WarningCode = "FRAME_CHANGED" | "FRAME_REPLACED" | "POST_FIRST_FRAMES_DISCARDED" | "UNKNOWN_VERSION_CONTINUED";
type ErrorCode = "INVALID_VERSION" | "UNDEFINED_DATA_TYPE" | "INVALID_TOTAL_QR_COUNT" | "SYNTAX_ERROR" | "ASCII_OUT_OF_RANGE" | "STRING_DECODE_FAILED" | "MAX_CRC_ERRORS_EXCEEDED" | "OVERALL_CRC_MISMATCH";
interface TransportWarning {
    code: WarningCode;
    message: string;
    details?: unknown;
}
interface TransportError {
    code: ErrorCode;
    message: string;
    critical: boolean;
    details?: unknown;
}
interface SendOptions {
    qrVersion?: number;
    ecLevel?: "l" | "m" | "q" | "h";
    intervalMs?: number;
    canvas?: HTMLCanvasElement | string;
    renderOptions?: RenderQrOptions;
}
interface ReceiveOptions {
    maxConsecutiveCrcErrors?: number;
    maxPendingFramesBeforeFirst?: number;
    useWorker?: boolean;
}
declare class TransportApi {
    private state;
    private config;
    private runtime?;
    private warningCallbacks;
    private errorCallbacks;
    private completeCallbacks;
    private sendTimer;
    private sendWireFrames;
    private sendFrameIndex;
    private sendCanvasTarget?;
    private pendingPreFirstFrames;
    private storedFrames;
    private knownTotalQrCount?;
    private knownFirstFrameCrc?;
    private consecutiveCrcErrors;
    constructor(config?: AppConfig, runtime?: RuntimeApi);
    setRuntime(runtime?: RuntimeApi): void;
    getConfig(): AppConfig;
    getState(): TransportState;
    onWarning(callback: (warning: TransportWarning) => void): void;
    onError(callback: (error: TransportError) => void): void;
    onComplete(callback: (result: DecodedResult) => void): void;
    private emitWarning;
    private emitError;
    private emitComplete;
    startSend(data: Uint8Array | string, options?: SendOptions): Promise<void>;
    getCurrentSendFrame(): Uint8Array | null;
    stopSend(): void;
    private resetSenderState;
    startReceive(options?: ReceiveOptions): Promise<void>;
    stopReceive(): void;
    private resetReceiverState;
    getPendingPreFirstQueueLength(): number;
    /**
     * Process an incoming raw wire frame array.
     */
    processFrame(wireBytes: Uint8Array): void;
    private establishFirstQr;
    private removeSupersededPendingFrames;
    private processPostFirstFrame;
    private handleCrcError;
    private processPendingQueue;
    private checkCompletion;
}

/**
 * Worker helper utilities and self-worker message handler.
 * Supports Node.js worker_threads, Browser Web Workers, Module Worker, and Blob Worker fallback.
 */
interface WorkerRequestMessage {
    id: string;
    type: "parseFrame" | "decodeFrames" | "encodeBytes" | "encodeText";
    payload: any;
}
interface WorkerResponseMessage {
    id: string;
    type: string;
    success: boolean;
    result?: any;
    error?: string;
}
declare function isWorkerContext(): boolean;
declare function handleWorkerMessage(msg: WorkerRequestMessage): Promise<WorkerResponseMessage>;
declare function setupWorkerSelfListener(): void;

export { AppConfig, BrowserRuntimeApi, BrowserRuntimeConfig, DataApi, DataConfig, TransportApi, TransportConfig, handleWorkerMessage, isWorkerContext, snowsQrDataTransportProtocol_d as protocol, setupWorkerSelfListener };
export type { CameraOptions, DecodedResult, ErrorCode, ReceiveOptions, RenderQrOptions, RuntimeApi, SendOptions, TransportError, TransportState, TransportWarning, WarningCode };
