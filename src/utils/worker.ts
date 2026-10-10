import { DataApi } from "../api/dataApi";

export type WorkerRequestType = "parseFrame" | "decodeFrames" | "encodeBytes" | "encodeText" | "decodeQrImage";

export interface WorkerRequestMessage {
	id: string;
	type: WorkerRequestType;
	payload: any;
}

export interface WorkerResponseMessage {
	id: string;
	type: string;
	success: boolean;
	result?: any;
	error?: string;
}

type WorkerMode = "auto" | "module" | "classic";

type WorkerLike = {
	postMessage(message: any, transfer?: Transferable[]): void;
	terminate(): unknown;
	addEventListener?: (type: string, listener: (event: any) => void) => void;
	removeEventListener?: (type: string, listener: (event: any) => void) => void;
	on?: (type: string, listener: (...args: any[]) => void) => unknown;
	off?: (type: string, listener: (...args: any[]) => void) => unknown;
};

export interface WorkerClientOptions {
	/** Worker を使用するか。既定値 false */
	enabled?: boolean;

	/** Worker の生成・実行に失敗した場合、直接実行へフォールバックするか。既定値 true */
	fallback?: boolean;

	/** Worker の URL。Node.js では原則として指定が必要 */
	workerUrl?: string | URL;

	/** Worker を独自に生成する場合の関数 */
	createWorker?: () => WorkerLike | Promise<WorkerLike>;

	/** ブラウザ Worker の形式。auto は読み込み元の script 要素から推定 */
	workerType?: WorkerMode;

	/** Worker の応答タイムアウト。0 以下なら無効。既定値 30000ms */
	timeout?: number;

	/** URL 検索に使うライブラリのファイル名。既定値 QrDataTransport */
	libraryFileName?: string;
}

type PendingTask = {
	type: WorkerRequestType;
	payload: any;
	resolve: (value: any) => void;
	reject: (error: Error) => void;
	timer?: ReturnType<typeof setTimeout>;
	settled: boolean;
};

type WorkerListeners = {
	message: (event: any) => void;
	error: (event: any) => void;
	messageerror: (event: any) => void;
	exit: (code: number) => void;
};

const DEFAULT_TIMEOUT = 30_000;

/**
 * 通常の script として読み込まれた場合、実行中に currentScript の URL を保存する。
 * ESM の場合は currentScript が null なので、document.scripts から検索する。
 */
const INITIAL_SCRIPT_INFO = (() => {
	if (typeof document === "undefined") {
		return undefined;
	}

	const current = document.currentScript;

	if (current instanceof HTMLScriptElement && current.src) {
		return {
			url: current.src,
			type: current.type === "module" ? ("module" as const) : ("classic" as const),
		};
	}

	return undefined;
})();

function isNodeEnvironment(): boolean {
	const g = globalThis as typeof globalThis & {
		process?: { versions?: { node?: string } };
	};

	return typeof g.process?.versions?.node === "string";
}

function toError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error));
}

function resolveBrowserWorkerInfo(options: WorkerClientOptions): { url: string | URL; type: "module" | "classic" } {
	let url = options.workerUrl ?? INITIAL_SCRIPT_INFO?.url;
	let detectedType = INITIAL_SCRIPT_INFO?.type;

	if (!url && typeof document !== "undefined") {
		const scripts = document.scripts;
		const fileName = options.libraryFileName ?? "QrDataTransport";
		const escapedName = fileName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		const pattern = new RegExp(`(?:^|/)${escapedName}(?:\\.min)?\\.(?:js|mjs)(?:[?#].*)?$`, "i");

		for (let i = scripts.length - 1; i >= 0; i--) {
			const script = scripts[i];
			if (!script.src || !pattern.test(script.src)) continue;

			url = script.src;
			detectedType = script.type === "module" || /\.mjs(?:[?#]|$)/i.test(script.src) ? "module" : "classic";
			break;
		}
	}

	if (!url) {
		throw new Error("Worker URL を解決できません。workerUrl または createWorker を指定してください。");
	}

	const requestedType = options.workerType ?? "auto";
	const type = requestedType === "auto" ? (detectedType ?? "module") : requestedType;

	return { url, type };
}

async function createDefaultWorker(options: WorkerClientOptions): Promise<WorkerLike> {
	if (isNodeEnvironment()) {
		if (!options.workerUrl) {
			throw new Error("Node.js Worker では workerUrl または createWorker が必要です。");
		}

		// 変数による dynamic import にして、ブラウザ向けバンドルへ
		// Node.js 専用モジュールを静的に取り込ませない。
		const specifier = "node:worker_threads";
		const nodeModule = (await import(specifier)) as {
			Worker: new (url: string | URL) => WorkerLike;
		};

		return new nodeModule.Worker(options.workerUrl);
	}

	if (typeof globalThis.Worker !== "function") {
		throw new Error("この環境ではブラウザ Worker を利用できません。");
	}

	const info = resolveBrowserWorkerInfo(options);

	return new globalThis.Worker(info.url, {
		type: info.type,
	});
}

function getResponseData(event: any): WorkerResponseMessage {
	return (event && typeof event === "object" && "data" in event ? event.data : event) as WorkerResponseMessage;
}

export class WorkerClient {
	private worker: WorkerLike | null = null;
	private listeners: WorkerListeners | null = null;
	private creating: Promise<WorkerLike> | null = null;
	private disposed = false;
	private failed = false;
	private sequence = 0;

	private readonly pending = new Map<string, PendingTask>();
	private readonly enabled: boolean;
	private readonly fallback: boolean;
	private readonly timeout: number;
	private readonly options: WorkerClientOptions;

	constructor(options: WorkerClientOptions = {}) {
		this.options = options;
		this.enabled = options.enabled === true;
		this.fallback = options.fallback !== false;
		this.timeout = options.timeout ?? DEFAULT_TIMEOUT;
	}

	get isDisposed(): boolean {
		return this.disposed;
	}

	get isWorkerAvailable(): boolean {
		return this.enabled && !this.disposed && !this.failed;
	}

	private nextId(): string {
		return `qr-${Date.now()}-${++this.sequence}`;
	}

	private async getWorker(): Promise<WorkerLike> {
		if (this.disposed) {
			throw new Error("WorkerClient has been disposed.");
		}

		if (this.failed) {
			throw new Error("Worker is unavailable.");
		}

		if (this.worker) return this.worker;
		if (this.creating) return this.creating;

		this.creating = (async () => {
			const worker = this.options.createWorker ? await this.options.createWorker() : await createDefaultWorker(this.options);

			if (this.disposed) {
				try {
					worker.terminate();
				} catch {
					// 終了済み Worker は無視
				}
				throw new Error("WorkerClient has been disposed.");
			}

			this.worker = worker;
			this.attachListeners(worker);

			return worker;
		})().finally(() => {
			this.creating = null;
		});

		return this.creating;
	}

	private attachListeners(worker: WorkerLike): void {
		const listeners: WorkerListeners = {
			message: (event: any) => {
				const response = getResponseData(event);

				if (!response || typeof response.id !== "string") return;

				const task = this.pending.get(response.id);
				if (!task || task.settled) return;

				this.pending.delete(response.id);
				task.settled = true;

				if (task.timer) clearTimeout(task.timer);

				if (response.success) {
					task.resolve(response.result);
				} else {
					// DataApi が正常にエラーを返した場合は Worker 自体を壊さない。
					task.reject(new Error(response.error || "Worker task failed."));
				}
			},

			error: (event: any) => {
				this.failWorker(new Error(event?.message || "Worker encountered an error."));
			},

			messageerror: () => {
				this.failWorker(new Error("Worker message deserialization failed."));
			},

			exit: (code: number) => {
				if (!this.disposed) {
					this.failWorker(new Error(`Worker exited unexpectedly with code ${code}.`));
				}
			},
		};

		this.listeners = listeners;

		if (worker.addEventListener) {
			worker.addEventListener("message", listeners.message);
			worker.addEventListener("error", listeners.error);
			worker.addEventListener("messageerror", listeners.messageerror);
		} else if (worker.on) {
			worker.on("message", listeners.message);
			worker.on("error", listeners.error);
			worker.on("messageerror", listeners.messageerror);
			worker.on("exit", listeners.exit);
		} else {
			throw new Error("Worker does not support message event listeners.");
		}
	}

	private detachListeners(worker: WorkerLike): void {
		const listeners = this.listeners;
		if (!listeners) return;

		if (worker.removeEventListener) {
			worker.removeEventListener("message", listeners.message);
			worker.removeEventListener("error", listeners.error);
			worker.removeEventListener("messageerror", listeners.messageerror);
		} else if (worker.off) {
			worker.off("message", listeners.message);
			worker.off("error", listeners.error);
			worker.off("messageerror", listeners.messageerror);
			worker.off("exit", listeners.exit);
		}

		this.listeners = null;
	}

	private settleFallback(id: string, task: PendingTask): void {
		if (task.settled) return;

		task.settled = true;
		this.pending.delete(id);

		if (task.timer) clearTimeout(task.timer);

		if (!this.fallback) {
			task.reject(new Error("Worker failed and fallback is disabled."));
			return;
		}

		void this.executeFallback(task.type, task.payload).then(task.resolve, (error: unknown) => task.reject(toError(error)));
	}

	private failWorker(error: Error): void {
		if (this.failed || this.disposed) return;

		this.failed = true;

		const worker = this.worker;
		this.worker = null;

		if (worker) {
			this.detachListeners(worker);
			try {
				worker.terminate();
			} catch {
				// 終了済み Worker は無視
			}
		}

		// 先にスナップショットを作り、各タスクを独立して処理する。
		const tasks = Array.from(this.pending.entries());

		for (const [id, task] of tasks) {
			if (task.settled) continue;
			this.settleFallback(id, task);
		}

		// error は障害発生の記録用。fallback 有効時は各タスクを再実行する。
		void error;
	}

	async request(type: WorkerRequestType, payload: any, transfer: Transferable[] = [], fallbackPayload: any = payload): Promise<any> {
		if (this.disposed) {
			throw new Error("WorkerClient has been disposed.");
		}

		if (!this.enabled || this.failed) {
			if (!this.fallback) {
				throw new Error("Worker is disabled or unavailable.");
			}

			return this.executeFallback(type, fallbackPayload);
		}

		let worker: WorkerLike;

		try {
			worker = await this.getWorker();
		} catch (error) {
			if (!this.fallback) throw error;
			return this.executeFallback(type, fallbackPayload);
		}

		if (this.disposed) {
			throw new Error("WorkerClient has been disposed.");
		}

		if (this.failed) {
			if (!this.fallback) {
				throw new Error("Worker is unavailable.");
			}
			return this.executeFallback(type, fallbackPayload);
		}

		const id = this.nextId();

		return new Promise((resolve, reject) => {
			const task: PendingTask = {
				type,
				payload: fallbackPayload,
				resolve,
				reject,
				settled: false,
			};

			if (this.timeout > 0) {
				task.timer = setTimeout(() => {
					this.failWorker(new Error(`Worker request timed out: ${type}`));
				}, this.timeout);
			}

			this.pending.set(id, task);

			try {
				worker.postMessage({ id, type, payload } satisfies WorkerRequestMessage, transfer);
			} catch (error) {
				// 同期的な postMessage エラーも Worker 障害として処理する。
				this.failWorker(toError(error));
			}
		});
	}

	private async executeFallback(type: WorkerRequestType, payload: any): Promise<any> {
		if (this.disposed) {
			throw new Error("WorkerClient has been disposed.");
		}

		const response = await handleWorkerMessage({
			id: this.nextId(),
			type,
			payload,
		});

		if (!response.success) {
			throw new Error(response.error || "Worker fallback failed.");
		}

		return response.result;
	}

	async decodeQrImage(rgbaPixels: Uint8Array, width: number, height: number): Promise<Uint8Array> {
		if (!this.enabled || this.failed) {
			const result = await this.request("decodeQrImage", {
				rgbaPixels,
				width,
				height,
			});

			return result instanceof Uint8Array ? result : new Uint8Array(result);
		}

		// 送信元の元データを保持しつつ、専用バッファだけを転送する。
		const fallbackPayload = {
			rgbaPixels,
			width,
			height,
		};

		const transferBuffer = rgbaPixels.slice().buffer;

		const result = await this.request(
			"decodeQrImage",
			{
				rgbaPixels: transferBuffer,
				width,
				height,
			},
			[transferBuffer],
			fallbackPayload,
		);

		return result instanceof Uint8Array ? result : new Uint8Array(result);
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;

		const worker = this.worker;
		this.worker = null;

		if (worker) {
			this.detachListeners(worker);

			try {
				worker.terminate();
			} catch {
				// 終了済み Worker は無視
			}
		}

		const error = new Error("WorkerClient has been disposed.");

		for (const [id, task] of this.pending) {
			this.pending.delete(id);

			if (task.settled) continue;
			task.settled = true;

			if (task.timer) clearTimeout(task.timer);
			task.reject(error);
		}
	}
}

export async function handleWorkerMessage(msg: WorkerRequestMessage): Promise<WorkerResponseMessage> {
	try {
		let result: any;

		switch (msg.type) {
			case "parseFrame": {
				const { wireBytes, knownTotalQrCount, knownFirstFrameCrc } = msg.payload;

				result = DataApi.parseFrame(wireBytes instanceof Uint8Array ? wireBytes : new Uint8Array(wireBytes), knownTotalQrCount, knownFirstFrameCrc);
				break;
			}

			case "decodeFrames": {
				const frames = msg.payload.wireFrames.map((frame: number[] | Uint8Array | ArrayBuffer) => {
					if (frame instanceof Uint8Array) return frame;
					return new Uint8Array(frame);
				});

				result = DataApi.decodeFrames(frames);
				break;
			}

			case "encodeBytes": {
				const { data, maxFrameBits, qrVersion, ecLevel, parityMode } = msg.payload;

				result = DataApi.encodeBytes(
					data instanceof Uint8Array ? data : new Uint8Array(data),
					qrVersion ?? maxFrameBits,
					ecLevel,
					parityMode
				);
				break;
			}

			case "encodeText": {
				const { text, maxFrameBits, qrVersion, ecLevel, parityMode } = msg.payload;
				result = DataApi.encodeText(text, qrVersion ?? maxFrameBits, ecLevel, parityMode);
				break;
			}

			case "decodeQrImage": {
				const { rgbaPixels, width, height } = msg.payload;

				result = DataApi.decodeQrImage(rgbaPixels instanceof Uint8Array ? rgbaPixels : new Uint8Array(rgbaPixels), width, height);
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
	} catch (error) {
		return {
			id: msg.id,
			type: msg.type,
			success: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

let workerListenerSetup = false;

/**
 * ブラウザ Worker / Node.js worker_threads でのみ受信ハンドラーを登録する。
 * メインスレッドでは何も登録しない。
 */
export async function setupWorkerSelfListener(): Promise<void> {
	if (workerListenerSetup) return;

	if (typeof self !== "undefined" && typeof window === "undefined") {
		workerListenerSetup = true;

		self.addEventListener("message", async (event: MessageEvent<WorkerRequestMessage>) => {
			const response = await handleWorkerMessage(event.data);
			self.postMessage(response);
		});

		return;
	}

	if (isNodeEnvironment()) {
		const specifier = "node:worker_threads";
		const nodeModule = (await import(specifier)) as {
			isMainThread: boolean;
			parentPort: {
				on(event: "message", listener: (message: WorkerRequestMessage) => void): void;
				postMessage(message: unknown): void;
			} | null;
		};

		if (nodeModule.isMainThread || !nodeModule.parentPort) return;

		workerListenerSetup = true;

		nodeModule.parentPort.on("message", async (message) => {
			const response = await handleWorkerMessage(message);
			nodeModule.parentPort?.postMessage(response);
		});
	}
}

/**
 * Worker 内でライブラリが読み込まれた場合に受信処理を登録する。
 * メインスレッドではリスナーを登録しない。
 */
void setupWorkerSelfListener();
