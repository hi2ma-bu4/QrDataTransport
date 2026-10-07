import { DataApi } from "../api/dataApi";

/**
 * Worker helper utilities and self-worker message handler.
 * Supports Node.js worker_threads, Browser Web Workers, Module Worker, and Blob Worker fallback.
 */

export interface WorkerRequestMessage {
	id: string;
	type: "parseFrame" | "decodeFrames" | "encodeBytes" | "encodeText";
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

// Auto setup listener if executing inside worker thread context
setupWorkerSelfListener();
