import { strict as assert } from "node:assert";
import { test } from "node:test";
import { DataApi, DataConfig } from "../../dist/QrDataTransport.js";
import { calculateMaxFrameBits } from "../../src/utils/qrCapacity";

test("calculateMaxFrameBits calculates correct capacities for QR Versions and EC Levels (subtracting segment header overhead)", () => {
	// Version 1-L: 152 - 12 = 140 bits
	assert.equal(calculateMaxFrameBits(1, "l"), 140);
	// Version 1-M: 128 - 12 = 116 bits
	assert.equal(calculateMaxFrameBits(1, "m"), 116);
	// Version 5-M: 688 - 12 = 676 bits
	assert.equal(calculateMaxFrameBits(5, "m"), 676);
	// Version 40-L: 23648 - 20 = 23628 bits
	assert.equal(calculateMaxFrameBits(40, "l"), 23628);
});

test("calculateMaxFrameBits validates qrVersion boundary", () => {
	assert.throws(() => calculateMaxFrameBits(0, "m"), /qrVersion/);
	assert.throws(() => calculateMaxFrameBits(41, "m"), /qrVersion/);
});

test("DataConfig automatically calculates maxFrameBits from qrVersion and ecLevel", () => {
	const configV1 = new DataConfig({ qrVersion: 1, ecLevel: "l" });
	assert.equal(configV1.maxFrameBits, 140);

	const configV5 = new DataConfig({ qrVersion: 5, ecLevel: "m" });
	assert.equal(configV5.maxFrameBits, 676);
});

test("DataApi.encodeBytes and DataApi.encodeText auto-calculate maxFrameBits from qrVersion and ecLevel and generate valid QR matrix", () => {
	const text = "Auto calculated max frame bits test that generates valid QR matrix for all wire frames";
	const resV5 = DataApi.encodeText(text, 5, "m");

	assert.ok(resV5.frames.length > 1, "Expected multiple frames");

	for (const frame of resV5.frames) {
		const wire = new Uint8Array(frame.wireBytes);
		const matrix = DataApi.generateQrMatrix(wire, 5, "m");
		assert.ok(matrix.width > 0);
		assert.ok(matrix.height > 0);
		assert.equal(matrix.modules.length, matrix.width * matrix.height);
	}
});
