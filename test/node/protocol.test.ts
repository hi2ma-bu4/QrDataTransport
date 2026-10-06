import assert from "node:assert/strict";
import test from "node:test";

import { DataApi } from "../../dist/QrDataTransport.js";

test("DataApi.encodeBytes and DataApi.decodeFrames roundtrip", () => {
	const data = new Uint8Array([1, 2, 3, 4, 5, 255, 0, 128]);

	const encodeRes = DataApi.encodeBytes(data, 100);
	assert.ok(encodeRes.frames.length > 0);

	const wireFrames = encodeRes.frames.map((f) => f.wireBytes);
	const decoded = DataApi.decodeFrames(wireFrames);

	assert.strictEqual(decoded.type, "Uint8Array");
	assert.deepStrictEqual(Array.from(decoded.data as Uint8Array), Array.from(data));
});

test("DataApi.encodeText ASCII roundtrip", () => {
	const text = "Hello, QrDataTransport!";

	const encodeRes = DataApi.encodeText(text, 300);
	assert.strictEqual(encodeRes.frames.length, 1);

	const wireFrames = encodeRes.frames.map((f) => f.wireBytes);
	const decoded = DataApi.decodeFrames(wireFrames);

	assert.strictEqual(decoded.type, "string");
	assert.strictEqual(decoded.data, text);
});

test("DataApi.encodeText UTF-8 Japanese roundtrip", () => {
	const text = "こんにちは、QRコード通信テストです！🚀";

	const encodeRes = DataApi.encodeText(text, 120);
	assert.ok(encodeRes.frames.length >= 1);

	const wireFrames = encodeRes.frames.map((f) => f.wireBytes);
	const decoded = DataApi.decodeFrames(wireFrames);

	assert.strictEqual(decoded.type, "string");
	assert.strictEqual(decoded.data, text);
});
