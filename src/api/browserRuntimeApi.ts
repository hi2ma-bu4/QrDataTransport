import { BrowserRuntimeConfig, type BrowserRuntimeConfigOptions } from "../config/index";

/**
 * QRコード描画オプション
 */
export interface RenderQrOptions {
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
export interface CameraOptions {
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
export interface QrModuleMatrixData {
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
export interface RuntimeApi {
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
export class BrowserRuntimeApi implements RuntimeApi {
	/**
	 * パックファイルヘッダーサイズ（バイト）
	 */
	static readonly HEADER_SIZE = 2;

	/**
	 * パックファイルの最大ファイル名長（バイト）
	 */
	static readonly MAX_FILENAME_LENGTH = 0xffff;

	/**
	 * ブラウザランタイム設定
	 */
	public config: BrowserRuntimeConfig;

	/**
	 * 初期設定オプション
	 */
	public readonly initialOptions?: BrowserRuntimeConfigOptions;

	/**
	 * カメラメディアストリーム
	 */
	private cameraStream: MediaStream | null = null;

	/**
	 * カメラ映像動作用HTMLVideoElement
	 */
	private cameraVideo: HTMLVideoElement | null = null;

	/**
	 * カメラキャプチャループのアニメーションID
	 */
	private cameraAnimationId: number | null = null;

	/**
	 * BrowserRuntimeApiのインスタンスを生成
	 *
	 * @param config - ランタイム設定または設定オプション
	 */
	constructor(config?: BrowserRuntimeConfig | BrowserRuntimeConfigOptions) {
		if (config instanceof BrowserRuntimeConfig) {
			this.config = config;
		} else {
			this.initialOptions = config;
			this.config = new BrowserRuntimeConfig(config);
		}
	}

	/**
	 * ファイルをUint8Arrayにパッキング
	 *
	 * ファイル名とファイル内容を単一のUint8Array構造に結合します。
	 *
	 * @param file - パッキング対象のFileオブジェクト
	 * @returns パッキングされたUint8Array
	 */
	static async packFileToUint8Array(file: File): Promise<Uint8Array> {
		const filenameEncoder = new TextEncoder();
		const filename = filenameEncoder.encode(file.name);

		if (filename.length > this.MAX_FILENAME_LENGTH) {
			throw new RangeError(`The filename exceeds ${this.MAX_FILENAME_LENGTH} bytes.`);
		}

		const fileData = new Uint8Array(await file.arrayBuffer());
		const result = new Uint8Array(this.HEADER_SIZE + filename.length + fileData.length);
		new DataView(result.buffer).setUint16(0, filename.length, false);
		result.set(filename, this.HEADER_SIZE);
		result.set(fileData, this.HEADER_SIZE + filename.length);

		return result;
	}

	/**
	 * パッキングされたUint8Arrayからファイル名とデータを解凍
	 *
	 * @param packed - パッキングされたUint8Array
	 * @returns 解凍されたファイル名とデータ
	 */
	static unpackUint8ArrayToFile(packed: Uint8Array): { name: string; data: Uint8Array } {
		if (packed.length < this.HEADER_SIZE) {
			throw new RangeError("Data is too short to contain a valid header.");
		}

		const filenameLength = new DataView(packed.buffer, packed.byteOffset, this.HEADER_SIZE).getUint16(0, false);

		if (filenameLength > packed.length - this.HEADER_SIZE) {
			throw new RangeError("Filename length exceeds the available data.");
		}

		const filenameEnd = this.HEADER_SIZE + filenameLength;

		const filenameDecoder = new TextDecoder("utf-8", { fatal: true });
		const name = filenameDecoder.decode(packed.subarray(this.HEADER_SIZE, filenameEnd));

		const data = packed.subarray(filenameEnd);

		return { name, data };
	}

	/**
	 * キャンバス要素を解決
	 *
	 * 引数のキャンバス参照またはセレクターからHTMLCanvasElementを取得します。
	 *
	 * @param canvasTarget - キャンバス要素またはID/セレクター
	 * @returns 解決されたHTMLCanvasElement、取得できない場合はnull
	 */
	private resolveCanvas(canvasTarget?: HTMLCanvasElement | string): HTMLCanvasElement | null {
		if (typeof document === "undefined") {
			return null;
		}
		if (!canvasTarget) {
			return document.querySelector("canvas");
		}
		if (typeof canvasTarget === "string") {
			const el = document.getElementById(canvasTarget);
			if (el && el instanceof HTMLCanvasElement) {
				return el;
			}
			return document.querySelector<HTMLCanvasElement>(canvasTarget);
		}
		if (canvasTarget instanceof HTMLCanvasElement) {
			return canvasTarget;
		}
		return null;
	}

	/**
	 * QRモジュール行列をキャンバスに描画
	 *
	 * @param matrix - 描画対象のQRモジュール行列
	 * @param options - 描画オプション
	 */
	public renderQrModuleMatrix(matrix: QrModuleMatrixData, options?: RenderQrOptions): void {
		const canvas = this.resolveCanvas(options?.canvas);
		if (!canvas) {
			return;
		}

		const ctx = canvas.getContext("2d");
		if (!ctx) {
			return;
		}

		const canvasWidth = options?.width ?? this.config.qrWidth ?? canvas.width ?? 300;
		const canvasHeight = options?.height ?? this.config.qrHeight ?? canvas.height ?? 300;
		canvas.width = canvasWidth;
		canvas.height = canvasHeight;

		const { width, height, modules } = matrix;
		if (width <= 0 || height <= 0 || modules.length < width * height) {
			return;
		}

		const darkColor = options?.darkColor ?? "#000000";
		const lightColor = options?.lightColor ?? "#FFFFFF";

		ctx.fillStyle = lightColor;
		ctx.fillRect(0, 0, canvasWidth, canvasHeight);

		// ドット描画を鮮明にするため画像スムージングを無効化
		ctx.imageSmoothingEnabled = false;
		if ("mozImageSmoothingEnabled" in ctx) (ctx as unknown as { mozImageSmoothingEnabled: boolean }).mozImageSmoothingEnabled = false;
		if ("webkitImageSmoothingEnabled" in ctx) (ctx as unknown as { webkitImageSmoothingEnabled: boolean }).webkitImageSmoothingEnabled = false;

		ctx.fillStyle = darkColor;
		for (let y = 0; y < height; y++) {
			const startY = Math.round((y * canvasHeight) / height);
			const endY = Math.round(((y + 1) * canvasHeight) / height);
			const h = endY - startY;

			for (let x = 0; x < width; x++) {
				if (modules[y * width + x] === 1) {
					const startX = Math.round((x * canvasWidth) / width);
					const endX = Math.round(((x + 1) * canvasWidth) / width);
					const w = endX - startX;
					ctx.fillRect(startX, startY, w, h);
				}
			}
		}
	}

	/**
	 * キャンバス描画をクリア
	 *
	 * @param canvasTarget - クリア対象のキャンバス要素またはID/セレクター
	 */
	public clearCanvas(canvasTarget?: HTMLCanvasElement | string): void {
		const canvas = this.resolveCanvas(canvasTarget);
		if (!canvas) {
			return;
		}
		const ctx = canvas.getContext("2d");
		if (ctx) {
			ctx.clearRect(0, 0, canvas.width, canvas.height);
		}
	}

	/**
	 * 利用可能なビデオ入力デバイス一覧を取得
	 *
	 * @returns デバイス情報の配列
	 */
	public async getAvailableVideoDevices(): Promise<MediaDeviceInfo[]> {
		if (typeof navigator === "undefined" || !navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
			return [];
		}
		const devices = await navigator.mediaDevices.enumerateDevices();
		return devices.filter((device) => device.kind === "videoinput");
	}

	/**
	 * カメラを起動しフレームのキャプチャを開始
	 *
	 * @param onFrame - フレーム取得時のコールバック
	 * @param options - カメラ起動オプション
	 */
	public async startCamera(onFrame: (rgbaPixels: Uint8Array, width: number, height: number) => void, options?: CameraOptions): Promise<void> {
		if (typeof navigator === "undefined" || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
			throw new Error("Camera API (navigator.mediaDevices.getUserMedia) is not available in this environment");
		}

		this.stopCamera();

		const facingMode = options?.facingMode ?? this.config.facingMode;
		const deviceId = options?.deviceId ?? this.config.deviceId;
		const reqWidth = options?.width ?? this.config.cameraWidth;
		const reqHeight = options?.height ?? this.config.cameraHeight;

		const videoConstraints: MediaTrackConstraints = {
			width: reqWidth ? { ideal: reqWidth } : undefined,
			height: reqHeight ? { ideal: reqHeight } : undefined,
		};

		if (deviceId) {
			videoConstraints.deviceId = { exact: deviceId };
		} else if (facingMode) {
			videoConstraints.facingMode = { ideal: facingMode };
		}

		const constraints: MediaStreamConstraints = {
			video: videoConstraints,
		};

		this.cameraStream = await navigator.mediaDevices.getUserMedia(constraints);

		if (options?.isManual ?? true) {
			const track = this.cameraStream.getVideoTracks()[0];

			if (track) {
				try {
					await track.applyConstraints({
						focusMode: { ideal: "manual" },
						exposureMode: { ideal: "manual" },
						whiteBalanceMode: { ideal: "manual" },
					} as MediaTrackConstraints);
				} catch {
					// 手動制御に失敗してもカメラ映像の取得を継続
				}
			}
		}

		this.cameraVideo = document.createElement("video");
		this.cameraVideo.srcObject = this.cameraStream;
		this.cameraVideo.setAttribute("playsinline", "true");
		await this.cameraVideo.play();

		const canvas = document.createElement("canvas");
		const ctx = canvas.getContext("2d", { willReadFrequently: true });

		const fps = options?.fps && options.fps > 0 ? options.fps : this.config.cameraFps > 0 ? this.config.cameraFps : 60;
		const intervalMs = 1000 / fps;
		let lastFrameTime = 0;

		const captureLoop = (now: number) => {
			if (!this.cameraVideo || !this.cameraStream) {
				return;
			}

			if (now - lastFrameTime >= intervalMs) {
				lastFrameTime = now;
				const vWidth = this.cameraVideo.videoWidth;
				const vHeight = this.cameraVideo.videoHeight;

				if (vWidth > 0 && vHeight > 0 && ctx) {
					canvas.width = vWidth;
					canvas.height = vHeight;
					ctx.drawImage(this.cameraVideo, 0, 0, vWidth, vHeight);

					const imgData = ctx.getImageData(0, 0, vWidth, vHeight);

					// previewCanvasが指定されている場合、プレビュー描画およびオーバーレイ描画を実行
					if (options?.previewCanvas) {
						const pCanvas = this.resolveCanvas(options.previewCanvas);
						if (pCanvas) {
							const pCtx = pCanvas.getContext("2d");
							if (pCtx) {
								if (pCanvas.width !== vWidth) pCanvas.width = vWidth;
								if (pCanvas.height !== vHeight) pCanvas.height = vHeight;
								pCtx.drawImage(this.cameraVideo, 0, 0, vWidth, vHeight);
								if (options.drawOverlay) {
									options.drawOverlay(pCtx, vWidth, vHeight);
								}
							}
						}
					}

					onFrame(new Uint8Array(imgData.data.buffer, imgData.data.byteOffset, imgData.data.byteLength), vWidth, vHeight);
				}
			}

			this.cameraAnimationId = requestAnimationFrame(captureLoop);
		};

		this.cameraAnimationId = requestAnimationFrame(captureLoop);
	}

	/**
	 * カメラを停止
	 */
	public stopCamera(): void {
		if (this.cameraAnimationId !== null && typeof cancelAnimationFrame !== "undefined") {
			cancelAnimationFrame(this.cameraAnimationId);
			this.cameraAnimationId = null;
		}

		if (this.cameraStream) {
			for (const track of this.cameraStream.getTracks()) {
				track.stop();
			}
			this.cameraStream = null;
		}

		if (this.cameraVideo) {
			this.cameraVideo.pause();
			this.cameraVideo.srcObject = null;
			this.cameraVideo = null;
		}
	}

	/**
	 * Web Workerがサポートされているかを判定
	 *
	 * @returns サポートされている場合はtrue
	 */
	public isWorkerSupported(): boolean {
		return typeof Worker !== "undefined";
	}
}
