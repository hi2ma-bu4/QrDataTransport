import { DataApi } from "../api/dataApi";

/**
 * Workerリクエスト種別
 */
export type WorkerRequestType = "parseFrame" | "decodeFrames" | "encodeBytes" | "encodeText" | "decodeQrImage" | "__QRDT_WORKER_PING__" | "__QRDT_WORKER_READY__";

/**
 * Workerリクエストメッセージ
 */
export interface WorkerRequestMessage {
	/**
	 * リクエストID
	 */
	id: string;

	/**
	 * リクエスト種別
	 */
	type: WorkerRequestType;

	/**
	 * ペイロードデータ
	 */
	payload: any;
}

/**
 * Workerレスポンスメッセージ
 */
export interface WorkerResponseMessage {
	/**
	 * リクエストID
	 */
	id: string;

	/**
	 * レスポンス種別
	 */
	type: string;

	/**
	 * 成功フラグ
	 */
	success: boolean;

	/**
	 * 実行結果データ
	 */
	result?: any;

	/**
	 * エラーメッセージ
	 */
	error?: string;
}

/**
 * Workerモード
 */
type WorkerMode = "auto" | "module" | "classic";

/**
 * Workerライクインターフェース
 */
type WorkerLike = {
	postMessage(message: any, transfer?: Transferable[]): void;
	terminate(): unknown;
	addEventListener?: (type: string, listener: (event: any) => void) => void;
	removeEventListener?: (type: string, listener: (event: any) => void) => void;
	on?: (type: string, listener: (...args: any[]) => void) => unknown;
	off?: (type: string, listener: (...args: any[]) => void) => unknown;
};

/**
 * WorkerClient設定オプション
 */
export interface WorkerClientOptions {
	/**
	 * Workerを使用するかどうか（既定値: false）
	 */
	enabled?: boolean;

	/**
	 * Worker失敗時に直接実行へフォールバックするかどうか（既定値: true）
	 */
	fallback?: boolean;

	/**
	 * WorkerのURL（Node.js環境では原則指定が必要）
	 */
	workerUrl?: string | URL;

	/**
	 * カスタムWorker生成関数
	 */
	createWorker?: () => WorkerLike | Promise<WorkerLike>;

	/**
	 * ブラウザWorkerの形式（既定値: 'auto'）
	 */
	workerType?: WorkerMode;

	/**
	 * Worker応答タイムアウト時間（ミリ秒、既定値: 30000ms）
	 */
	timeout?: number;

	/**
	 * ライブラリファイル名（既定値: 'QrDataTransport'）
	 */
	libraryFileName?: string;
}

/**
 * 保留中のタスク定義
 */
type PendingTask = {
	type: WorkerRequestType;
	payload: any;
	resolve: (value: any) => void;
	reject: (error: Error) => void;
	timer?: ReturnType<typeof setTimeout>;
	settled: boolean;
};

/**
 * Workerイベントリスナー集合
 */
type WorkerListeners = {
	message: (event: any) => void;
	error: (event: any) => void;
	messageerror: (event: any) => void;
	exit: (code: number) => void;
};

/**
 * デフォルトタイムアウト（ミリ秒）
 */
const DEFAULT_TIMEOUT = 30_000;

/**
 * 初期スクリプトURL情報の取得
 *
 * 通常のscriptタグで読み込まれた場合のsrcを保持します。
 */
const INITIAL_SCRIPT_INFO = (() => {
	if (typeof document === "undefined") {
		return undefined;
	}

	const current = document.currentScript;

	if (current instanceof HTMLScriptElement && current.src) {
		return current.src;
	}

	return undefined;
})();

/**
 * Node.js環境であるかを判定
 *
 * @returns Node.js環境の場合はtrue
 */
function isNodeEnvironment(): boolean {
	const g = globalThis as typeof globalThis & {
		process?: { versions?: { node?: string } };
	};

	return typeof g.process?.versions?.node === "string";
}

/**
 * 任意の例外値をErrorオブジェクトに変換
 *
 * @param error - 変換対象のエラーオブジェクトまたは値
 * @returns Errorインスタンス
 */
function toError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error));
}

/**
 * ブラウザ環境用Worker情報を解決
 *
 * @param options - WorkerClient設定オプション
 * @returns URLとWorker形式
 */
function resolveBrowserWorkerInfo(options: WorkerClientOptions): { url: string | URL; type: "module" | "classic" } {
	let url = options.workerUrl ?? INITIAL_SCRIPT_INFO;

	if (!url && typeof import.meta !== "undefined" && import.meta.url) {
		url = import.meta.url;
	}

	if (!url && typeof document !== "undefined" && document.currentScript instanceof HTMLScriptElement && document.currentScript.src) {
		url = document.currentScript.src;
	}

	if (!url && typeof document !== "undefined") {
		const scripts = document.scripts;
		const fileName = options.libraryFileName ?? "QrDataTransport";
		const escapedName = fileName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		const pattern = new RegExp(`(?:^|/)${escapedName}(?:\\.min)?\\.m?js(?:[?#].*)?$`, "i");

		for (let i = scripts.length - 1; i >= 0; i--) {
			const script = scripts[i];
			if (!script.src || !pattern.test(script.src)) continue;

			url = script.src;
			break;
		}
	}

	if (!url) {
		throw new Error("Worker URL を解決できません。workerUrl または createWorker を指定してください。");
	}

	const requestedType = options.workerType ?? "auto";
	const type = requestedType === "auto" ? "module" : requestedType;

	return { url, type };
}

/**
 * デフォルトWorkerインスタンスを生成
 *
 * @param options - WorkerClient設定オプション
 * @returns 生成されたWorkerLikeインスタンス
 */
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

/**
 * イベントオブジェクトからレスポンスデータを取得
 *
 * @param event - メッセージイベント
 * @returns レスポンスメッセージ
 */
function getResponseData(event: any): WorkerResponseMessage {
	return (event && typeof event === "object" && "data" in event ? event.data : event) as WorkerResponseMessage;
}

/**
 * Workerがサポートされているかを判定
 *
 * @param options - WorkerClient設定オプション
 * @returns サポートされている場合はtrue
 */
export function isWorkerSupported(options: WorkerClientOptions = {}): boolean {
	if (options.createWorker) return true;
	if (isNodeEnvironment()) {
		return Boolean(options.workerUrl);
	}
	return typeof globalThis.Worker === "function";
}

/**
 * Web Worker通信クライアントクラス
 */
export class WorkerClient {
	/**
	 * 保持するWorkerインスタンス
	 */
	private worker: WorkerLike | null = null;

	/**
	 * 登録されたイベントリスナー群
	 */
	private listeners: WorkerListeners | null = null;

	/**
	 * Worker生成Promise
	 */
	private creating: Promise<WorkerLike> | null = null;

	/**
	 * 破棄済みフラグ
	 */
	private disposed = false;

	/**
	 * 失敗フラグ
	 */
	private failed = false;

	/**
	 * シーケンス番号
	 */
	private sequence = 0;

	/**
	 * Worker準備完了リゾルバ
	 */
	private workerReadyResolver: (() => void) | null = null;

	/**
	 * 準備確認中のWorkerインスタンス
	 */
	private workerReadyWorker: WorkerLike | null = null;

	/**
	 * 保留中のタスクマップ
	 */
	private readonly pending = new Map<string, PendingTask>();

	/**
	 * 有効化フラグ
	 */
	private readonly enabled: boolean;

	/**
	 * フォールバック許可フラグ
	 */
	private readonly fallback: boolean;

	/**
	 * タイムアウト時間（ミリ秒）
	 */
	private readonly timeout: number;

	/**
	 * クライアント設定オプション
	 */
	private readonly options: WorkerClientOptions;

	/**
	 * WorkerClientのインスタンスを生成
	 *
	 * @param options - WorkerClient設定オプション
	 */
	constructor(options: WorkerClientOptions = {}) {
		this.options = options;
		this.enabled = !!options.enabled && isWorkerSupported(options);
		this.fallback = !!options.fallback;
		this.timeout = options.timeout ?? DEFAULT_TIMEOUT;
	}

	/**
	 * 破棄済みかどうかを取得
	 *
	 * @returns 破棄済みの場合はtrue
	 */
	get isDisposed(): boolean {
		return this.disposed;
	}

	/**
	 * Workerが利用可能かどうかを取得
	 *
	 * @returns 利用可能な場合はtrue
	 */
	get isWorkerAvailable(): boolean {
		return this.enabled && !this.disposed && !this.failed;
	}

	/**
	 * ユニークなリクエストIDを生成
	 *
	 * @returns リクエストID文字列
	 */
	private nextId(): string {
		return `qr-${Date.now()}-${++this.sequence}`;
	}

	/**
	 * Workerインスタンスを取得または生成
	 *
	 * @returns WorkerLikeインスタンス
	 */
	private async getWorker(): Promise<WorkerLike> {
		if (this.disposed) {
			throw new Error("WorkerClient has been disposed.");
		}

		if (this.failed) {
			throw new Error("Worker is unavailable.");
		}

		if (this.creating) return this.creating;
		if (this.worker) return this.worker;

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

			try {
				await this.waitForWorkerReady(worker);
			} catch (error) {
				this.failWorker(toError(error));
				throw error;
			}

			return worker;
		})().finally(() => {
			this.creating = null;
		});

		return this.creating;
	}

	/**
	 * Workerイベントリスナーを設定
	 *
	 * @param worker - 対象のWorkerインスタンス
	 */
	private attachListeners(worker: WorkerLike): void {
		const listeners: WorkerListeners = {
			message: (event: any) => {
				if (event?.data?.type === "__QRDT_WORKER_READY__") {
					if (this.workerReadyWorker === worker) {
						this.workerReadyResolver?.();
					}
					return;
				}

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

	/**
	 * Workerの準備完了メッセージを待機
	 *
	 * @param worker - 対象のWorkerインスタンス
	 */
	private async waitForWorkerReady(worker: WorkerLike): Promise<void> {
		if (!worker.postMessage) {
			throw new Error("Worker does not support postMessage.");
		}

		this.workerReadyWorker = worker;

		try {
			await new Promise<void>((resolve, reject) => {
				let settled = false;
				let retryTimer: ReturnType<typeof setTimeout> | undefined;
				let timeoutTimer: ReturnType<typeof setTimeout> | undefined;

				const cleanup = () => {
					if (retryTimer !== undefined) clearTimeout(retryTimer);
					if (timeoutTimer !== undefined) clearTimeout(timeoutTimer);
					if (this.workerReadyResolver === onReady) {
						this.workerReadyResolver = null;
					}
				};

				const finish = () => {
					if (settled) return;
					settled = true;
					cleanup();
					resolve();
				};

				const onReady = () => finish();
				this.workerReadyResolver = onReady;

				const ping = () => {
					if (settled) return;

					try {
						worker.postMessage({ type: "__QRDT_WORKER_PING__" });
					} catch (error) {
						settled = true;
						cleanup();
						reject(toError(error));
						return;
					}

					retryTimer = setTimeout(ping, 100);
				};

				timeoutTimer = setTimeout(
					() => {
						if (settled) return;
						settled = true;
						cleanup();
						reject(new Error("Worker initialization timed out."));
					},
					this.timeout > 0 ? this.timeout : 10000,
				);

				ping();
			});
		} finally {
			if (this.workerReadyWorker === worker) {
				this.workerReadyWorker = null;
			}
		}
	}

	/**
	 * Workerイベントリスナーを解除
	 *
	 * @param worker - 対象のWorkerインスタンス
	 */
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

	/**
	 * 失敗タスクのフォールバック処理を実行
	 *
	 * @param id - タスクID
	 * @param task - 保留中タスク
	 */
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

	/**
	 * Worker障害発生時の状態切り替え処理
	 *
	 * @param error - 発生したエラー
	 */
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
	}

	/**
	 * Workerリクエストを送信
	 *
	 * @param type - リクエスト種別
	 * @param payload - ペイロードデータ
	 * @param transfer - 転送可能オブジェクト配列
	 * @param fallbackPayload - フォールバック時ペイロード
	 * @returns 処理結果プロミス
	 */
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

	/**
	 * メインスレッド同期フォールバックの実行
	 *
	 * @param type - リクエスト種別
	 * @param payload - ペイロードデータ
	 * @returns 実行結果プロミス
	 */
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

	/**
	 * QRコード画像ピクセルをWorker経由でデコード
	 *
	 * @param rgbaPixels - RGBAピクセルバイト配列
	 * @param width - 画像幅
	 * @param height - 画像高さ
	 * @returns デコードされたワイヤーフレームバイト列
	 */
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

	/**
	 * WorkerClientリソースを破棄
	 */
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

/**
 * Workerリクエストメッセージを処理
 *
 * @param msg - Workerリクエストメッセージ
 * @returns 処理レスポンスメッセージ
 */
export async function handleWorkerMessage(msg: WorkerRequestMessage): Promise<WorkerResponseMessage> {
	try {
		let result: any;

		switch (msg.type) {
			case "parseFrame": {
				const { wireBytes, knownTotalQrCount, knownFirstFrameCrc, knownParityMode } = msg.payload;

				result = DataApi.parseFrame(wireBytes instanceof Uint8Array ? wireBytes : new Uint8Array(wireBytes), knownTotalQrCount, knownFirstFrameCrc, knownParityMode);
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

				result = DataApi.encodeBytes(data instanceof Uint8Array ? data : new Uint8Array(data), qrVersion ?? maxFrameBits, ecLevel, parityMode);
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

/**
 * 自身がWorkerスレッドであるかのリスナー初期化フラグ
 */
let workerListenerSetup = false;

/**
 * Worker環境での自己メッセージリスナーをセットアップ
 *
 * ブラウザ Worker / Node.js worker_threads でのみ受信ハンドラーを登録します。
 * メインスレッドでは何も登録しません。
 */
export async function setupWorkerSelfListener(): Promise<void> {
	if (workerListenerSetup) return;

	if (typeof self !== "undefined" && typeof window === "undefined") {
		workerListenerSetup = true;

		self.addEventListener("message", async (event: MessageEvent<WorkerRequestMessage>) => {
			// Client からの起動確認
			if (event.data.type === "__QRDT_WORKER_PING__") {
				self.postMessage({ type: "__QRDT_WORKER_READY__" });
				return;
			}

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
			// Client からの起動確認
			if ((message as { type?: string }).type === "__QRDT_WORKER_PING__") {
				nodeModule.parentPort?.postMessage({
					type: "__QRDT_WORKER_READY__",
				});
				return;
			}

			const response = await handleWorkerMessage(message);
			nodeModule.parentPort?.postMessage(response);
		});

		return;
	}
}

/**
 * Worker 内でライブラリが読み込まれた場合に受信処理を自動登録
 */
void setupWorkerSelfListener();
