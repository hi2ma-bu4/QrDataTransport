import assert from "node:assert/strict";
import test from "node:test";

import { DataApi } from "../../dist/QrDataTransport.js";

test("DataApi memory sharing test with non-zero byteOffset TypedArray view", () => {
	const parentBuffer = new Uint8Array([0, 0, 10, 20, 30, 40, 0, 0]);
	// Subarray with offset = 2, length = 4
	const sliceView = parentBuffer.subarray(2, 6);

	const encodeRes = DataApi.encodeBytes(sliceView, 200);
	assert.ok(encodeRes.frames.length > 0);

	const decoded = DataApi.decodeFrames(encodeRes.frames.map((f) => f.wireBytes));
	assert.strictEqual(decoded.type, "Uint8Array");
	assert.deepStrictEqual(Array.from(decoded.data as Uint8Array), [10, 20, 30, 40]);
});

test("DataApi.parseFrame metadata inspection", () => {
	const data = new Uint8Array([100, 200, 250]);
	const encodeRes = DataApi.encodeBytes(data, 200);

	const meta = DataApi.parseFrame(encodeRes.frames[0].wireBytes);
	assert.strictEqual(meta.isFirst, true);
	assert.strictEqual(meta.version, 1);
	assert.strictEqual(meta.totalQrCount, 1);
	assert.strictEqual(meta.frameNumber, 0);
	assert.strictEqual(meta.dataType, "uint8array");
	assert.strictEqual(meta.crcValid, true);
});

test("DataApi returns discriminated type object for String vs Uint8Array", () => {
	const strRes = DataApi.encodeText("DataApi Test", 200);
	const strDecoded = DataApi.decodeFrames(strRes.frames.map((f) => f.wireBytes));
	assert.strictEqual(strDecoded.type, "string");
	assert.strictEqual(typeof strDecoded.data, "string");
	assert.strictEqual(strDecoded.data, "DataApi Test");

	const bytesRes = DataApi.encodeBytes(new Uint8Array([1, 2, 3]), 200);
	const bytesDecoded = DataApi.decodeFrames(bytesRes.frames.map((f) => f.wireBytes));
	assert.strictEqual(bytesDecoded.type, "Uint8Array");
	assert.ok(bytesDecoded.data instanceof Uint8Array);
	assert.deepStrictEqual(Array.from(bytesDecoded.data), [1, 2, 3]);
});
