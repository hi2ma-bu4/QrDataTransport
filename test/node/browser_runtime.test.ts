import assert from "node:assert";
import { test } from "node:test";
import { BrowserRuntimeApi } from "../../dist/QrDataTransport.js";

test("BrowserRuntimeApi instantiation and features", () => {
	const runtime = new BrowserRuntimeApi();

	// In Node environment, Worker is defined
	assert.strictEqual(typeof runtime.isWorkerSupported(), "boolean");

	// Headless calls should not throw errors
	runtime.renderQrModuleMatrix({
		width: 3,
		height: 3,
		modules: new Uint8Array([1, 0, 1, 0, 1, 0, 1, 0, 1]),
	});

	runtime.clearCanvas();
	runtime.stopCamera();
});

test("BrowserRuntimeApi camera start throws in node environment without navigator.mediaDevices", async () => {
	const runtime = new BrowserRuntimeApi();
	await assert.rejects(async () => {
		await runtime.startCamera(() => {});
	}, /Camera API/);
});
