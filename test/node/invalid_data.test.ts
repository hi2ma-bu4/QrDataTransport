import assert from "node:assert/strict";
import test from "node:test";

import { DataApi } from "../../dist/QrDataTransport.js";

test("corrupted frame wire bytes should result in crcValid = false", () => {
	const data = new Uint8Array([10, 20, 30, 40, 50]);
	const encodeRes = DataApi.encodeBytes(data, 100);

	const originalWire = encodeRes.frames[0].wireBytes;
	const corruptedWire = new Uint8Array(originalWire);
	// Corrupt a byte in payload
	corruptedWire[corruptedWire.length - 2] ^= 0xff;

	const meta = DataApi.parseFrame(corruptedWire, undefined, undefined);
	assert.strictEqual(meta.crcValid, false);
});

test("corrupted overall CRC in final frame should reject decoding", () => {
	const data = new Uint8Array([1, 2, 3, 4, 5]);
	const encodeRes = DataApi.encodeBytes(data, 100);

	const wireFrames = encodeRes.frames.map((f) => new Uint8Array(f.wireBytes));

	// Corrupt the last byte (part of Overall CRC) in the final frame
	const lastFrame = wireFrames[wireFrames.length - 1];
	lastFrame[lastFrame.length - 1] ^= 0xff;

	assert.throws(() => {
		DataApi.decodeFrames(wireFrames);
	});
});

test("empty wire frames list should fail decoding", () => {
	assert.throws(() => {
		DataApi.decodeFrames([]);
	});
});

test("invalid frame version 0 should fail parsing", () => {
	// Version 0 in 4-bit header
	const invalidVersionWire = new Uint8Array([0x80, 0x00, 0x00, 0x00, 0x00]);
	assert.throws(() => {
		DataApi.parseFrame(invalidVersionWire, undefined, undefined);
	});
});
