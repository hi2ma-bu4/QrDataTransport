import { strict as assert } from "node:assert";
import { test } from "node:test";
import { AppConfig, handleWorkerMessage, TransportApi } from "../../dist/QrDataTransport.js";

const createMockWorker = () => {
	const listeners = new Map<string, Array<(e: any) => void>>();
	return {
		addEventListener(event: string, fn: (e: any) => void) {
			if (!listeners.has(event)) listeners.set(event, []);
			listeners.get(event)!.push(fn);
		},
		removeEventListener(event: string, fn: (e: any) => void) {
			const list = listeners.get(event) || [];
			listeners.set(
				event,
				list.filter((l) => l !== fn),
			);
		},
		postMessage(data: any) {
			Promise.resolve().then(async () => {
				const response = await handleWorkerMessage(data);
				const list = listeners.get("message") || [];
				for (const fn of list) {
					fn({ data: response });
				}
			});
		},
		terminate() {},
	};
};

test("TransportApi with WorkerClient - send and receive flow async worker execution", async () => {
	const config = new AppConfig({
		transport: {
			useWorker: true,
			createWorker: createMockWorker,
			timeout: 5000,
		},
		data: {
			qrVersion: 5,
			ecLevel: "m",
		},
	});

	const transport = new TransportApi(config);

	let sendProgressEmitted = false;
	transport.onSendProgress((evt) => {
		assert.ok(evt.index >= 1);
		assert.ok(evt.maxIndex >= 1);
		sendProgressEmitted = true;
	});

	const payloadStr = "Testing TransportApi Worker Integration";
	await transport.startSend(payloadStr);

	assert.ok(sendProgressEmitted);
	const currentFrame = transport.getCurrentSendFrame();
	assert.ok(currentFrame instanceof Uint8Array);
	assert.ok(currentFrame!.length > 0);

	transport.stopSend();

	// Receive flow using worker
	const receiverConfig = new AppConfig({
		transport: {
			useWorker: true,
			createWorker: createMockWorker,
		},
	});
	const receiver = new TransportApi(receiverConfig);

	let completeResult: string | Uint8Array | null = null;
	receiver.onComplete((res) => {
		completeResult = res.data;
	});

	await receiver.startReceive();

	// Process frame generated from send
	const parsePromise = receiver.processFrame(currentFrame);
	if (parsePromise instanceof Promise) {
		await parsePromise;
	}

	assert.equal(completeResult, payloadStr);
	assert.equal(receiver.getState(), "Completed");

	receiver.stopReceive();
});

test("TransportApi with WorkerClient - Uint8Array binary data roundtrip", async () => {
	const transport = new TransportApi(
		new AppConfig({
			transport: {
				useWorker: true,
				createWorker: createMockWorker,
			},
		}),
	);

	const sampleBytes = new Uint8Array([10, 20, 30, 40, 50, 60, 70, 80]);
	await transport.startSend(sampleBytes);

	const frame = transport.getCurrentSendFrame();
	assert.ok(frame);
	transport.stopSend();

	const receiver = new TransportApi(
		new AppConfig({
			transport: {
				useWorker: true,
				createWorker: createMockWorker,
			},
		}),
	);

	let completedBytes: Uint8Array | null = null;
	receiver.onComplete((res) => {
		completedBytes = res.data as Uint8Array;
	});

	await receiver.startReceive();
	const p = receiver.processFrame(frame);
	if (p instanceof Promise) {
		await p;
	}

	assert.ok(completedBytes);
	assert.deepEqual(Array.from(completedBytes! as Uint8Array), Array.from(sampleBytes));
	receiver.stopReceive();
});

test("WorkerClient request error handling in TransportApi", async () => {
	const transport = new TransportApi(
		new AppConfig({
			transport: {
				useWorker: true,
				createWorker: createMockWorker,
			},
		}),
	);

	let errorOccurred = false;
	transport.onError((err) => {
		errorOccurred = true;
		assert.equal(err.code, "SYNTAX_ERROR");
	});

	await transport.startReceive();
	const invalidFrame = new Uint8Array([0xff, 0xff, 0xff, 0xff]);
	const p = transport.processFrame(invalidFrame);
	if (p instanceof Promise) {
		await p;
	}

	assert.ok(errorOccurred);
	transport.stopReceive();
});
