import assert from "node:assert/strict";
import test from "node:test";

import { DataApi } from "../../dist/QrDataTransport.js";

test("generateQrMatrix generates binary module matrix using qrcodegen", () => {
	const data = new Uint8Array([0x01, 0x02, 0x03]);
	const encodeRes = DataApi.encodeBytes(data, 100);
	const wire = encodeRes.frames[0].wireBytes;

	const qrMatrix = DataApi.generateQrMatrix(wire, 5, "m");

	assert.ok(qrMatrix.width > 0);
	assert.strictEqual(qrMatrix.width, qrMatrix.height);
	assert.strictEqual(qrMatrix.modules.length, qrMatrix.width * qrMatrix.height);

	// Ensure module values are strictly 0 or 1
	for (const mod of qrMatrix.modules) {
		assert.ok(mod === 0 || mod === 1);
	}
});

test("decodeQrImage rejects invalid RGBA pixel buffer size", () => {
	const invalidPixels = new Uint8Array([255, 255, 255]); // Less than width * height * 4
	assert.throws(() => {
		DataApi.decodeQrImage(invalidPixels, 10, 10);
	});
});
