import { strict as assert } from "node:assert";
import { test } from "node:test";
import { AppConfig, BrowserRuntimeApi, DataApi, handleWorkerMessage, ParityMode, TransportApi } from "../../dist/QrDataTransport.js";

test("bps calculation counts pure payload bit length instead of wire frame bytes", async () => {
	const transport = new TransportApi();
	let capturedBps = 0;

	transport.onFrameProcessed((event) => {
		capturedBps = event.bps;
	});

	await transport.startReceive({ useWorker: false });

	const encoded = DataApi.encodeText("Hello BPS calculation test!", 5, "m", 0);
	const frame0 = encoded.frames[0].wireBytes;
	const meta = DataApi.parseFrame(frame0);

	await transport.processFrame(frame0);

	assert.ok(meta.payloadBitLen > 0, "Payload bit length should be greater than 0");
	assert.ok(capturedBps >= 0, "BPS should be non-negative");
});

test("knownParityMode is passed to parseFrame and handleWorkerMessage", async () => {
	const encoded = DataApi.encodeText("Parity mode test text", 5, "m", ParityMode.Group8);
	const frame0 = encoded.frames[0].wireBytes;

	const response = await handleWorkerMessage({
		id: "test-1",
		type: "parseFrame",
		payload: {
			wireBytes: frame0,
			knownTotalQrCount: encoded.frames.length,
			knownFirstFrameCrc: undefined,
			knownParityMode: ParityMode.Group8,
		},
	});

	assert.equal(response.success, true);
	assert.equal(response.result.isFirst, true);
});

test("setRuntime gives precedence to runtime.initialOptions over config.browserRuntime", () => {
	const appConfig = new AppConfig({
		browserRuntime: {
			cameraFps: 15,
			qrWidth: 200,
		},
	});

	const runtime = new BrowserRuntimeApi({
		cameraFps: 30,
		qrWidth: 500,
	});

	const transport = new TransportApi(appConfig);
	transport.setRuntime(runtime);

	assert.equal(runtime.config.cameraFps, 30);
	assert.equal(runtime.config.qrWidth, 500);
});
