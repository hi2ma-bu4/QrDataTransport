import { strict as assert } from "node:assert";
import { test } from "node:test";

import { DataApi, DataConfig } from "../../dist/QrDataTransport.js";
import { calculateMaxFrameBits } from "../../src/utils/qrCapacity";

test("calculateMaxFrameBits calculates correct capacities for QR Versions and EC Levels", () => {
	// Version 1-L: 152 bits
	assert.equal(calculateMaxFrameBits(1, "l"), 152);
	// Version 1-M: 128 bits
	assert.equal(calculateMaxFrameBits(1, "m"), 128);
	// Version 5-M: 688 bits
	assert.equal(calculateMaxFrameBits(5, "m"), 688);
	// Version 40-L: 23648 bits
	assert.equal(calculateMaxFrameBits(40, "l"), 23648);
});

test("calculateMaxFrameBits validates qrVersion boundary", () => {
	assert.throws(() => calculateMaxFrameBits(0, "m"), /qrVersion/);
	assert.throws(() => calculateMaxFrameBits(41, "m"), /qrVersion/);
});

test("DataConfig automatically calculates maxFrameBits from qrVersion and ecLevel", () => {
	const configV1 = new DataConfig({ qrVersion: 1, ecLevel: "l" });
	assert.equal(configV1.maxFrameBits, 152);

	const configV5 = new DataConfig({ qrVersion: 5, ecLevel: "m" });
	assert.equal(configV5.maxFrameBits, 688);
});

test("DataApi.encodeBytes and DataApi.encodeText auto-calculate maxFrameBits from qrVersion and ecLevel", () => {
	const text = "Auto calculated max frame bits test";
	const resV1 = DataApi.encodeText(text, 1, "l");
	const resV5 = DataApi.encodeText(text, 5, "m");

	// Higher QR version (Version 5) holds more data per frame, requiring fewer total frames for the same payload
	assert.ok(resV5.frames.length <= resV1.frames.length);
});
