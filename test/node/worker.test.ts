import { strict as assert } from "node:assert";
import { test } from "node:test";
import { DataApi, decodeQrImageInWorker, handleWorkerMessage, isWorkerContext } from "../../dist/QrDataTransport.js";

test("Worker Context detection helper", () => {
	// In standard Node main thread
	assert.equal(typeof isWorkerContext(), "boolean");
});

test("handleWorkerMessage handles parseFrame", async () => {
	const enc = DataApi.encodeText("Worker Test Message", 1000);
	const wireBytes = Array.from(enc.frames[0].wireBytes);

	const response = await handleWorkerMessage({
		id: "msg-1",
		type: "parseFrame",
		payload: { wireBytes },
	});

	assert.equal(response.id, "msg-1");
	assert.equal(response.success, true);
	assert.equal(response.result.isFirst, true);
	assert.equal(response.result.crcValid, true);
});

test("handleWorkerMessage handles decodeFrames", async () => {
	const enc = DataApi.encodeText("Worker Decode Test", 1000);
	const wireFrames = enc.frames.map((f) => Array.from(f.wireBytes));

	const response = await handleWorkerMessage({
		id: "msg-2",
		type: "decodeFrames",
		payload: { wireFrames },
	});

	assert.equal(response.id, "msg-2");
	assert.equal(response.success, true);
	assert.equal(response.result.type, "string");
	assert.equal(response.result.data, "Worker Decode Test");
});

test("handleWorkerMessage handles error response", async () => {
	const response = await handleWorkerMessage({
		id: "msg-err",
		type: "parseFrame",
		payload: { wireBytes: [] },
	});

	assert.equal(response.id, "msg-err");
	assert.equal(response.success, false);
	assert.ok(typeof response.error === "string");
});

test("handleWorkerMessage handles decodeQrImage request and decodeQrImageInWorker helper", async () => {
	// Mock worker object to test decodeQrImageInWorker
	const mockListeners: ((msg: any) => void)[] = [];
	const mockWorker = {
		postMessage: async (msg: any) => {
			const res = await handleWorkerMessage(msg);
			for (const l of mockListeners) {
				l(res);
			}
		},
		on: (event: string, cb: (msg: any) => void) => {
			if (event === "message") mockListeners.push(cb);
		},
		off: (event: string, cb: (msg: any) => void) => {
			if (event === "message") {
				const idx = mockListeners.indexOf(cb);
				if (idx >= 0) mockListeners.splice(idx, 1);
			}
		},
	};

	// Decoding an invalid pixel buffer should reject gracefully
	const dummyPixels = new Uint8Array(10 * 10 * 4);
	await assert.rejects(async () => {
		await decodeQrImageInWorker(mockWorker as any, dummyPixels, 10, 10);
	});
});
