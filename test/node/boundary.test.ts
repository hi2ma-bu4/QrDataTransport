import assert from "node:assert/strict";
import test from "node:test";

import { protocol } from "../../dist/index.js";

test("boundary check: maxFrameBits = 0 should return error", () => {
	const data = new Uint8Array([1, 2, 3]);
	assert.throws(() => {
		protocol.encodeBytes(data, 0);
	});
});

test("boundary check: empty Uint8Array encoding and decoding", () => {
	const emptyData = new Uint8Array([]);
	const encodeRes = protocol.encodeBytes(emptyData, 100);
	assert.strictEqual(encodeRes.frames.length, 1);

	const wireFrames = encodeRes.frames.map((f) => f.wireBytes);
	const decoded = protocol.decodeFrames(wireFrames);

	assert.strictEqual(decoded.tag, "bytes");
	if (decoded.tag === "bytes") {
		assert.deepStrictEqual(Array.from(decoded.val), []);
	}
});

test("boundary check: empty string encoding and decoding", () => {
	const emptyText = "";
	const encodeRes = protocol.encodeText(emptyText, 100);
	assert.strictEqual(encodeRes.frames.length, 1);

	const wireFrames = encodeRes.frames.map((f) => f.wireBytes);
	const decoded = protocol.decodeFrames(wireFrames);

	assert.strictEqual(decoded.tag, "text");
	if (decoded.tag === "text") {
		assert.strictEqual(decoded.val, "");
	}
});

test("boundary check: ASCII boundary character values (0x00 and 0x7F)", () => {
	const text = "\x00\x7F";
	const encodeRes = protocol.encodeText(text, 100);

	const meta = protocol.parseFrame(encodeRes.frames[0].wireBytes, undefined, undefined);
	assert.strictEqual(meta.isFirst, true);
	assert.strictEqual(meta.dataType, "bytes-string");

	const wireFrames = encodeRes.frames.map((f) => f.wireBytes);
	const decoded = protocol.decodeFrames(wireFrames);

	assert.strictEqual(decoded.tag, "text");
	if (decoded.tag === "text") {
		assert.strictEqual(decoded.val, text);
	}
});
