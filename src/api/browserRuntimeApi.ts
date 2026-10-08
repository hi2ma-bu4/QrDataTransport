export interface RenderQrOptions {
	canvas?: HTMLCanvasElement | string;
	width?: number;
	height?: number;
}

export interface CameraOptions {
	deviceId?: string;
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

		ctx.fillStyle = "#FFFFFF";
		ctx.fillRect(0, 0, canvasWidth, canvasHeight);

		const moduleWidth = canvasWidth / width;
		const moduleHeight = canvasHeight / height;

		ctx.fillStyle = "#000000";
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

	public async startCamera(onFrame: (rgbaPixels: Uint8Array, width: number, height: number) => void, options?: CameraOptions): Promise<void> {
		if (typeof navigator === "undefined" || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
			throw new Error("Camera API (navigator.mediaDevices.getUserMedia) is not available in this environment");
		}

		this.stopCamera();

		const constraints: MediaStreamConstraints = {
			video: {
				deviceId: options?.deviceId ? { exact: options.deviceId } : undefined,
				width: options?.width ? { ideal: options.width } : undefined,
				height: options?.height ? { ideal: options.height } : undefined,
			},
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

					// Render video preview and overlay if previewCanvas is provided
					if (options?.previewCanvas) {
						const pCanvas = this.resolveCanvas(options.previewCanvas);
						if (pCanvas) {
							const pCtx = pCanvas.getContext("2d");
							if (pCtx) {
								if (pCanvas.width !== vWidth) pCanvas.width = vWidth;
								if (pCanvas.height !== vHeight) pCanvas.height = vHeight;
								pCtx.drawImage(this.cameraVideo, 0, 0, vWidth, vHeight);
								this.drawDefaultScanOverlay(pCtx, vWidth, vHeight);
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

	private drawDefaultScanOverlay(ctx: CanvasRenderingContext2D, width: number, height: number): void {
		const size = Math.min(width, height) * 0.65;
		const x = (width - size) / 2;
		const y = (height - size) / 2;

		ctx.save();
		// Semi-transparent backdrop outside scan window
		ctx.fillStyle = "rgba(0, 0, 0, 0.35)";
		ctx.fillRect(0, 0, width, height);
		ctx.clearRect(x, y, size, size);

		// Re-draw clean image area inside box
		if (this.cameraVideo) {
			ctx.drawImage(this.cameraVideo, x, y, size, size, x, y, size, size);
		}

		// Outer guide stroke
		ctx.strokeStyle = "#10b981";
		ctx.lineWidth = 2;
		ctx.strokeRect(x, y, size, size);

		// Corner markers
		const lineLen = Math.min(size * 0.15, 24);
		ctx.strokeStyle = "#34d399";
		ctx.lineWidth = 4;

		// Top-left
		ctx.beginPath();
		ctx.moveTo(x, y + lineLen);
		ctx.lineTo(x, y);
		ctx.lineTo(x + lineLen, y);
		ctx.stroke();

		// Top-right
		ctx.beginPath();
		ctx.moveTo(x + size - lineLen, y);
		ctx.lineTo(x + size, y);
		ctx.lineTo(x + size, y + lineLen);
		ctx.stroke();

		// Bottom-left
		ctx.beginPath();
		ctx.moveTo(x, y + size - lineLen);
		ctx.lineTo(x, y + size);
		ctx.lineTo(x + lineLen, y + size);
		ctx.stroke();

		// Bottom-right
		ctx.beginPath();
		ctx.moveTo(x + size - lineLen, y + size);
		ctx.lineTo(x + size, y + size);
		ctx.lineTo(x + size, y + size - lineLen);
		ctx.stroke();

		ctx.restore();
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
