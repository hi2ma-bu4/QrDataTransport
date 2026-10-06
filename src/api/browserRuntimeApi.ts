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
}

export interface BrowserRuntimeApi {
	renderQrModuleMatrix(matrix: { width: number; height: number; modules: Uint8Array }, options?: RenderQrOptions): void;
	clearCanvas(canvas?: HTMLCanvasElement | string): void;
	startCamera(onFrame: (rgbaPixels: Uint8Array, width: number, height: number) => void, options?: CameraOptions): Promise<void>;
	stopCamera(): void;
	isWorkerSupported(): boolean;
}
