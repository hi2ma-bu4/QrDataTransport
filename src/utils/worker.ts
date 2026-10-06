/**
 * Worker helper utilities and self-worker message handler.
 * Supports both Node.js worker_threads and Browser Web Workers.
 */

export interface WorkerRequestMessage {
	id: string;
	type: string;
	payload: unknown;
}

export interface WorkerResponseMessage {
	id: string;
	type: string;
	success: boolean;
	result?: unknown;
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

export function setupWorkerSelfListener(handler: (msg: WorkerRequestMessage) => Promise<WorkerResponseMessage> | WorkerResponseMessage): void {
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
						const res = await handler(msg);
						workerThreads.parentPort.postMessage(res);
					});
					return;
				}
			}
		} catch {
			// Fallback to Web Worker self
		}
	}

	if (typeof self !== "undefined") {
		self.addEventListener("message", async (event: MessageEvent<WorkerRequestMessage>) => {
			const res = await handler(event.data);
			self.postMessage(res);
		});
	}
}
