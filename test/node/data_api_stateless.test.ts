import { strict as assert } from "node:assert";
import { test } from "node:test";

import { DataApi } from "../../dist/QrDataTransport.js";

test("DataApi is completely stateless across multiple interleaved operations", () => {
	const textPayload1 = "First Payload for Stateless Test";
	const textPayload2 = "Second Payload for Stateless Test";
	const bytesPayload = new Uint8Array([1, 2, 3, 4, 5, 10, 20, 30, 255]);

	// 1. Encode text 1
	const res1 = DataApi.encodeText(textPayload1, 5, "m");

	// 2. Encode bytes
	const resBytes = DataApi.encodeBytes(bytesPayload, 5, "m");

	// 3. Encode text 2
	const res2 = DataApi.encodeText(textPayload2, 5, "m");

	// 4. Decode text 2 first
	const decoded2 = DataApi.decodeFrames(res2.frames.map((f) => new Uint8Array(f.wireBytes)));
	assert.equal(decoded2.type, "string");
	assert.equal(decoded2.data, textPayload2);

	// 5. Decode text 1
	const decoded1 = DataApi.decodeFrames(res1.frames.map((f) => new Uint8Array(f.wireBytes)));
	assert.equal(decoded1.type, "string");
	assert.equal(decoded1.data, textPayload1);

	// 6. Decode bytes
	const decodedBytes = DataApi.decodeFrames(resBytes.frames.map((f) => new Uint8Array(f.wireBytes)));
	assert.equal(decodedBytes.type, "Uint8Array");
	assert.deepEqual(decodedBytes.data, bytesPayload);
});

test("DataApi handles memory-sharing views without modifying source buffer offset or byteLength", () => {
	const buffer = new ArrayBuffer(100);
	const view = new Uint8Array(buffer, 20, 10);
	view.set([10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);

	const encoded = DataApi.encodeBytes(view, 5, "m");
	const decoded = DataApi.decodeFrames(encoded.frames.map((f) => new Uint8Array(f.wireBytes)));

	assert.equal(decoded.type, "Uint8Array");
	assert.deepEqual(decoded.data, view);
});
