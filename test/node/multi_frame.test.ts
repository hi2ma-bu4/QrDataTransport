import assert from "node:assert/strict";
import test from "node:test";

import { protocol } from "../..//dist/index.js";

test("multi-frame splitting and reassembly for Uint8Array", () => {
	// 32 bytes (256 bits) with small maxFrameBits = 64 forces multiple frames
	const data = new Uint8Array(32);
	for (let i = 0; i < 32; i++) data[i] = i * 7;

	const encodeRes = protocol.encodeBytes(data, 64);
	assert.ok(encodeRes.frames.length > 1);

	// Verify metadata for each frame
	let firstCrc: number | undefined;
	const totalCount = encodeRes.frames.length;

	encodeRes.frames.forEach((frame, idx) => {
		const meta = protocol.parseFrame(frame.wireBytes, idx > 0 ? totalCount : undefined, idx > 0 ? firstCrc : undefined);

		assert.strictEqual(meta.frameNumber, idx);
		assert.strictEqual(meta.totalQrCount, totalCount);
		assert.strictEqual(meta.crcValid, true);

		if (idx === 0) {
			assert.strictEqual(meta.isFirst, true);
			firstCrc = meta.frameCrc;
		} else {
			assert.strictEqual(meta.isFirst, false);
		}
	});

	// Decode all wire frames together
	const wireFrames = encodeRes.frames.map((f) => f.wireBytes);
	const decoded = protocol.decodeFrames(wireFrames);

	assert.strictEqual(decoded.tag, "bytes");
	if (decoded.tag === "bytes") {
		assert.deepStrictEqual(Array.from(decoded.val), Array.from(data));
	}
});

test("multi-frame splitting and reassembly for long UTF-8 text", () => {
	const longText = "QrDataTransport 仕様書v8に従って、多重フレーム分割処理のテストを行います。".repeat(5);

	const encodeRes = protocol.encodeText(longText, 120);
	assert.ok(encodeRes.frames.length > 1);

	const wireFrames = encodeRes.frames.map((f) => f.wireBytes);
	const decoded = protocol.decodeFrames(wireFrames);

	assert.strictEqual(decoded.tag, "text");
	if (decoded.tag === "text") {
		assert.strictEqual(decoded.val, longText);
	}
});
