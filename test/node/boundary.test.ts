import assert from "node:assert/strict";
import test from "node:test";

import { DataApi } from "../../dist/QrDataTransport.js";

test("boundary check: maxFrameBits = 0 should return error", () => {
	const data = new Uint8Array([1, 2, 3]);
	assert.throws(() => {
		DataApi.encodeBytes(data, 0);
	});
});

test("boundary check: empty Uint8Array encoding and decoding", () => {
	const emptyData = new Uint8Array([]);
	const encodeRes = DataApi.encodeBytes(emptyData, 100);
	assert.strictEqual(encodeRes.frames.length, 1);

	const wireFrames = encodeRes.frames.map((f) => f.wireBytes);
	const decoded = DataApi.decodeFrames(wireFrames);

	assert.strictEqual(decoded.type, "Uint8Array");
	assert.deepStrictEqual(Array.from(decoded.data as Uint8Array), []);
});

test("boundary check: empty string encoding and decoding", () => {
	const emptyText = "";
	const encodeRes = DataApi.encodeText(emptyText, 100);
	assert.strictEqual(encodeRes.frames.length, 1);

	const wireFrames = encodeRes.frames.map((f) => f.wireBytes);
	const decoded = DataApi.decodeFrames(wireFrames);

	assert.strictEqual(decoded.type, "string");
	assert.strictEqual(decoded.data, "");
});

test("boundary check: ASCII boundary character values (0x00 and 0x7F)", () => {
	const text = "\x00\x7F";
	const encodeRes = DataApi.encodeText(text, 100);

	const meta = DataApi.parseFrame(encodeRes.frames[0].wireBytes, undefined, undefined);
	assert.strictEqual(meta.isFirst, true);
	assert.strictEqual(meta.dataType, "bytes-string");

	const wireFrames = encodeRes.frames.map((f) => f.wireBytes);
	const decoded = DataApi.decodeFrames(wireFrames);

	assert.strictEqual(decoded.type, "string");
	assert.strictEqual(decoded.data, text);
});
