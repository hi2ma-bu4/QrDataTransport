import { strict as assert } from "node:assert";
import { test } from "node:test";
import { AppConfig, BrowserRuntimeConfig, DataConfig, TransportConfig } from "../../src/config/index.js";
import { calculateMaxFrameBits } from "../../src/utils/qrCapacity";

test("TransportConfig default values", () => {
	const config = new TransportConfig();
	assert.equal(config.maxConsecutiveCrcErrors, 16);
	assert.equal(config.maxPendingFramesBeforeFirst, 256);
	assert.equal(config.useWorker, true);
	assert.equal(config.intervalMs, 100);
});

test("TransportConfig validation and boundary checks", () => {
	assert.throws(() => new TransportConfig({ maxConsecutiveCrcErrors: -1 }), /maxConsecutiveCrcErrors/);
	assert.doesNotThrow(() => new TransportConfig({ maxConsecutiveCrcErrors: 0 }));

	assert.throws(() => new TransportConfig({ maxPendingFramesBeforeFirst: -5 }), /maxPendingFramesBeforeFirst/);
	assert.doesNotThrow(() => new TransportConfig({ maxPendingFramesBeforeFirst: 0 }));
});

test("DataConfig default values and boundary checks", () => {
	const config = new DataConfig();
	assert.equal(config.qrVersion, 5);
	assert.equal(config.ecLevel, "m");
	assert.equal(config.maxFrameBits, calculateMaxFrameBits(5, "m"));

	assert.throws(() => new DataConfig({ qrVersion: 0 }), /qrVersion/);
	assert.throws(() => new DataConfig({ qrVersion: 41 }), /qrVersion/);
	assert.doesNotThrow(() => new DataConfig({ qrVersion: 1 }));
	assert.doesNotThrow(() => new DataConfig({ qrVersion: 40 }));

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	assert.throws(() => new DataConfig({ ecLevel: "x" as any }), /ecLevel/);
});

test("BrowserRuntimeConfig default values and camera options", () => {
	const config = new BrowserRuntimeConfig();
	assert.equal(config.renderFps, 10);
	assert.equal(config.cameraFps, 30);
	assert.equal(config.decodeFrequency, 10);
	assert.equal(config.qrWidth, 300);
	assert.equal(config.qrHeight, 300);
	assert.equal(config.facingMode, "environment");
	assert.equal(config.deviceId, undefined);

	const customConfig = new BrowserRuntimeConfig({
		facingMode: "user",
		deviceId: "cam-123",
	});
	assert.equal(customConfig.facingMode, "user");
	assert.equal(customConfig.deviceId, "cam-123");
});

test("AppConfig independence and clone", () => {
	const config1 = new AppConfig({ transport: { maxConsecutiveCrcErrors: 5 } });
	const config2 = new AppConfig({ transport: { maxConsecutiveCrcErrors: 20 } });

	assert.equal(config1.transport.maxConsecutiveCrcErrors, 5);
	assert.equal(config2.transport.maxConsecutiveCrcErrors, 20);

	const cloned = config1.clone();
	cloned.transport.maxConsecutiveCrcErrors = 99;
	assert.equal(config1.transport.maxConsecutiveCrcErrors, 5);
	assert.equal(cloned.transport.maxConsecutiveCrcErrors, 99);
});
