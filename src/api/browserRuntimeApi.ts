export interface RenderQrOptions {
	canvas?: HTMLCanvasElement | string;
	width?: number;
	height?: number;
	darkColor?: string;
	lightColor?: string;
}

export interface CameraOptions {
	deviceId?: string;
	facingMode?: "environment" | "user" | string;
	fps?: number;
	width?: number;
	height?: number;
	previewCanvas?: HTMLCanvasElement | string;
	drawOverlay?: (ctx: CanvasRenderingContext2D, width: number, height: number) => void;
}

export interface QrModuleMatrixData {
	width: number;
	height: number;
	modules: Uint8Array;
}

/**
 * Runtime API interface for display rendering and camera operations.
 * Allows TransportApi to remain runtime-agnostic.
 */
export interface RuntimeApi {
	renderQrModuleMatrix(matrix: QrModuleMatrixData, options?: RenderQrOptions): void;
	clearCanvas(canvas?: HTMLCanvasElement | string): void;
	startCamera(onFrame: (rgbaPixels: Uint8Array, width: number, height: number) => void, options?: CameraOptions): Promise<void>;
	stopCamera(): void;
	isWorkerSupported(): boolean;
	getAvailableVideoDevices?(): Promise<MediaDeviceInfo[]>;
}

export class BrowserRuntimeApi implements RuntimeApi {
	private cameraStream: MediaStream | null = null;
	private cameraVideo: HTMLVideoElement | null = null;
	private cameraAnimationId: number | null = null;

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

	public renderQrModuleMatrix(matrix: QrModuleMatrixData, options?: RenderQrOptions): void {
		const canvas = this.resolveCanvas(options?.canvas);
		if (!canvas) {
			return;
		}

		const ctx = canvas.getContext("2d");
		if (!ctx) {
			return;
		}

		const canvasWidth = options?.width ?? canvas.width ?? 300;
		const canvasHeight = options?.height ?? canvas.height ?? 300;
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

		const moduleWidth = canvasWidth / width;
		const moduleHeight = canvasHeight / height;

		ctx.fillStyle = darkColor;
		for (let y = 0; y < height; y++) {
			for (let x = 0; x < width; x++) {
				if (modules[y * width + x] === 1) {
					ctx.fillRect(x * moduleWidth, y * moduleHeight, moduleWidth, moduleHeight);
				}
			}
		}
	}

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

	public async getAvailableVideoDevices(): Promise<MediaDeviceInfo[]> {
		if (typeof navigator === "undefined" || !navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
			return [];
		}
		const devices = await navigator.mediaDevices.enumerateDevices();
		return devices.filter((device) => device.kind === "videoinput");
	}

	public async startCamera(onFrame: (rgbaPixels: Uint8Array, width: number, height: number) => void, options?: CameraOptions): Promise<void> {
		if (typeof navigator === "undefined" || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
			throw new Error("Camera API (navigator.mediaDevices.getUserMedia) is not available in this environment");
		}

		this.stopCamera();

		const facingMode = options?.facingMode ?? "environment";
		const videoConstraints: MediaTrackConstraints = {
			width: options?.width ? { ideal: options.width } : undefined,
			height: options?.height ? { ideal: options.height } : undefined,
		};

		if (options?.deviceId) {
			videoConstraints.deviceId = { exact: options.deviceId };
		} else if (facingMode) {
			videoConstraints.facingMode = { ideal: facingMode };
		}

		const constraints: MediaStreamConstraints = {
			video: videoConstraints,
		};

		this.cameraStream = await navigator.mediaDevices.getUserMedia(constraints);
		this.cameraVideo = document.createElement("video");
		this.cameraVideo.srcObject = this.cameraStream;
		this.cameraVideo.setAttribute("playsinline", "true");
		await this.cameraVideo.play();

		const offscreenCanvas = document.createElement("canvas");
		const offscreenCtx = offscreenCanvas.getContext("2d", { willReadFrequently: true });

		const fps = options?.fps && options.fps > 0 ? options.fps : 30;
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

				if (vWidth > 0 && vHeight > 0 && offscreenCtx) {
					offscreenCanvas.width = vWidth;
					offscreenCanvas.height = vHeight;
					offscreenCtx.drawImage(this.cameraVideo, 0, 0, vWidth, vHeight);

					const imgData = offscreenCtx.getImageData(0, 0, vWidth, vHeight);

					// Render raw video preview and optional custom overlay if previewCanvas is provided
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

	public isWorkerSupported(): boolean {
		return typeof Worker !== "undefined";
	}
}
