import assert from "node:assert/strict";
import test from "node:test";

import { protocol } from "../..//dist/index.js";

test("protocol.encodeBytes and protocol.decodeFrames roundtrip", () => {
	const data = new Uint8Array([1, 2, 3, 4, 5, 255, 0, 128]);

	const encodeRes = protocol.encodeBytes(data, 100);
	assert.ok(encodeRes.frames.length > 0);

	const wireFrames = encodeRes.frames.map((f) => f.wireBytes);
	const decoded = protocol.decodeFrames(wireFrames);

	assert.strictEqual(decoded.tag, "bytes");
	if (decoded.tag === "bytes") {
		assert.deepStrictEqual(Array.from(decoded.val), Array.from(data));
	}
});

test("protocol.encodeText ASCII roundtrip", () => {
	const text = "Hello, QrDataTransport!";

	const encodeRes = protocol.encodeText(text, 300);
	assert.strictEqual(encodeRes.frames.length, 1);

	const wireFrames = encodeRes.frames.map((f) => f.wireBytes);
	const decoded = protocol.decodeFrames(wireFrames);

	assert.strictEqual(decoded.tag, "text");
	if (decoded.tag === "text") {
		assert.strictEqual(decoded.val, text);
	}
});

test("protocol.encodeText UTF-8 Japanese roundtrip", () => {
	const text = "こんにちは、QRコード通信テストです！🚀";

	const encodeRes = protocol.encodeText(text, 120);
	assert.ok(encodeRes.frames.length >= 1);

	const wireFrames = encodeRes.frames.map((f) => f.wireBytes);
	const decoded = protocol.decodeFrames(wireFrames);

	assert.strictEqual(decoded.tag, "text");
	if (decoded.tag === "text") {
		assert.strictEqual(decoded.val, text);
	}
});
