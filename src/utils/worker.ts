import { DataApi } from "../api/dataApi";

/**
 * Worker helper utilities and self-worker message handler.
 * Supports Node.js worker_threads, Browser Web Workers, Module Worker, and Blob Worker fallback.
 */

export interface WorkerRequestMessage {
	id: string;
	type: "parseFrame" | "decodeFrames" | "encodeBytes" | "encodeText" | "decodeQrImage";
	payload: any;
}

export interface WorkerResponseMessage {
	id: string;
	type: string;
	success: boolean;
	result?: any;
	error?: string;
}

export function isWorkerContext(): boolean {
	if (typeof self !== "undefined" && typeof window === "undefined") {
		return true;
	}
	const g = globalThis as { process?: { versions?: { node?: string } } };
	if (g.process && g.process.versions && g.process.versions.node) {
		try {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const req = (globalThis as any).require;
			if (typeof req === "function") {
				const workerThreads = req("node:worker_threads");
				return !workerThreads.isMainThread;
			}
		} catch {
			return false;
		}
	}
	return false;
}

export async function handleWorkerMessage(msg: WorkerRequestMessage): Promise<WorkerResponseMessage> {
	try {
		let result: any;
		switch (msg.type) {
			case "parseFrame": {
				const { wireBytes, knownTotalQrCount, knownFirstFrameCrc } = msg.payload;
				result = DataApi.parseFrame(new Uint8Array(wireBytes), knownTotalQrCount, knownFirstFrameCrc);
				break;
			}
			case "decodeFrames": {
				const frames = (msg.payload.wireFrames as number[][]).map((f) => new Uint8Array(f));
				result = DataApi.decodeFrames(frames);
				break;
			}
			case "encodeBytes": {
				const { data, maxFrameBits } = msg.payload;
				result = DataApi.encodeBytes(new Uint8Array(data), maxFrameBits);
				break;
			}
			case "encodeText": {
				const { text, maxFrameBits } = msg.payload;
				result = DataApi.encodeText(text, maxFrameBits);
				break;
			}
			case "decodeQrImage": {
				const { rgbaPixels, width, height } = msg.payload;
				const pixels = new Uint8Array(rgbaPixels);
				const wireBytes = DataApi.decodeQrImage(pixels, width, height);
				result = Array.from(wireBytes);
				break;
			}
			default:
				throw new Error(`Unknown worker request type: ${msg.type}`);
		}
		return {
			id: msg.id,
			type: msg.type,
			success: true,
			result,
		};
	} catch (err) {
		return {
			id: msg.id,
			type: msg.type,
			success: false,
			error: err instanceof Error ? err.message : String(err),
		};
	}
}

export function setupWorkerSelfListener(): void {
	if (!isWorkerContext()) {
		return;
	}

	const g = globalThis as { process?: { versions?: { node?: string } } };
	if (g.process && g.process.versions && g.process.versions.node) {
		try {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const req = (globalThis as any).require;
			if (typeof req === "function") {
				const workerThreads = req("node:worker_threads");
				if (workerThreads.parentPort) {
					workerThreads.parentPort.on("message", async (msg: WorkerRequestMessage) => {
						const res = await handleWorkerMessage(msg);
						workerThreads.parentPort.postMessage(res);
					});
					return;
				}
			}
		} catch {
			// Fallback
		}
	}

	if (typeof self !== "undefined") {
		self.addEventListener("message", async (event: MessageEvent<WorkerRequestMessage>) => {
			const res = await handleWorkerMessage(event.data);
			self.postMessage(res);
		});
	}
}

/**
 * Helper to execute decodeQrImage on a Worker instance offloading image decoding from the main thread.
 */
export function decodeQrImageInWorker(worker: Worker | { postMessage: (msg: any) => void; addEventListener?: (type: string, listener: (evt: any) => void) => void; on?: (type: string, listener: (msg: any) => void) => void }, rgbaPixels: Uint8Array, width: number, height: number): Promise<Uint8Array> {
	return new Promise((resolve, reject) => {
		const id = `qr-decode-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

		const listener = (data: WorkerResponseMessage) => {
			if (data && data.id === id) {
				cleanup();
				if (data.success) {
					resolve(new Uint8Array(data.result));
				} else {
					reject(new Error(data.error || "Worker decodeQrImage failed"));
				}
			}
		};

		const handleEvent = (event: MessageEvent<WorkerResponseMessage> | WorkerResponseMessage) => {
			const data = (event && typeof event === "object" && "data" in event ? (event as MessageEvent).data : event) as WorkerResponseMessage;
			listener(data);
		};

		const cleanup = () => {
			if ("removeEventListener" in worker && typeof worker.removeEventListener === "function") {
				worker.removeEventListener("message", handleEvent as any);
			} else if ("off" in (worker as any) && typeof (worker as any).off === "function") {
				(worker as any).off("message", handleEvent);
			}
		};

		if ("addEventListener" in worker && typeof worker.addEventListener === "function") {
			worker.addEventListener("message", handleEvent as any);
		} else if ("on" in (worker as any) && typeof (worker as any).on === "function") {
			(worker as any).on("message", handleEvent);
		}

		const message: WorkerRequestMessage = {
			id,
			type: "decodeQrImage",
			payload: {
				rgbaPixels: Array.from(rgbaPixels),
				width,
				height,
			},
		};

		worker.postMessage(message);
	});
}

// Auto setup listener if executing inside worker thread context
setupWorkerSelfListener();
