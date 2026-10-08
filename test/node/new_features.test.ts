import { strict as assert } from "node:assert";
import { test } from "node:test";
import { BrowserRuntimeApi, DataApi, TransportApi } from "../../dist/QrDataTransport.js";

test("BrowserRuntimeApi: RenderQrOptions darkColor and lightColor options", () => {
	const runtime = new BrowserRuntimeApi();
	assert.doesNotThrow(() => {
		runtime.renderQrModuleMatrix(
			{
				width: 3,
				height: 3,
				modules: new Uint8Array([1, 0, 1, 0, 1, 0, 1, 0, 1]),
			},
			{
				darkColor: "#10b981",
				lightColor: "#f8fafc",
			},
		);
	});
});

test("TransportApi Sender: onSendProgress emits 1-based index and maxIndex", async () => {
	const transport = new TransportApi();
	const progressEvents: { index: number; maxIndex: number }[] = [];

	transport.onSendProgress((evt) => {
		progressEvents.push(evt);
	});

	const payload = "Testing 1-based sender progress callback event";
	await transport.startSend(payload, { qrVersion: 1, ecLevel: "l", intervalMs: 50 });

	assert.ok(progressEvents.length >= 1, "Expected at least 1 send progress event");
	assert.equal(progressEvents[0].index, 1, "First frame index must be 1-based (index = 1)");
	assert.ok(progressEvents[0].maxIndex >= 1, "maxIndex should equal total frame count");

	transport.stopSend();
});

test("TransportApi Receiver: FrameProcessedEvent includes isQrDetected and bps fields", async () => {
	const transport = new TransportApi();
	const events: { validCount: number; isQrDetected: boolean; bps: number }[] = [];

	transport.onFrameProcessed((evt) => {
		events.push(evt);
	});

	await transport.startReceive();

	const encoded = DataApi.encodeText("Bps and QR detection test string", 100);
	const f0 = new Uint8Array(encoded.frames[0].wireBytes);

	// Process valid QR frame -> isQrDetected should be true
	transport.processFrame(f0);
	const eventWithQr = events[events.length - 1];
	assert.equal(eventWithQr.isQrDetected, true, "isQrDetected should be true when valid QR frame is processed");
	assert.ok(eventWithQr.bps >= 0, "bps should be a valid non-negative number");

	// Process empty/null frame -> isQrDetected should be false
	transport.processFrame(null);
	const eventNoQr = events[events.length - 1];
	assert.equal(eventNoQr.isQrDetected, false, "isQrDetected should be false when null/empty frame is processed");

	transport.stopReceive();
});

test("TransportApi Receiver: Real-time First QR processing continues when pre-first pending queue is full", async () => {
	// Set max pre-first pending queue limit to 2
	const transport = new TransportApi();

	const encoded = DataApi.encodeText("Full Queue Bug Fix Test Payload String", 100);
	assert.ok(encoded.frames.length >= 3, "Expected at least 3 frames");

	const f0 = new Uint8Array(encoded.frames[0].wireBytes);
	const f1 = new Uint8Array(encoded.frames[1].wireBytes);
	const f2 = new Uint8Array(encoded.frames[2].wireBytes);

	await transport.startReceive({ maxPendingFramesBeforeFirst: 2 });

	// Fill queue with 2 non-first frames
	transport.processFrame(f1);
	transport.processFrame(f2);
	assert.equal(transport.getPendingPreFirstQueueLength(), 2, "Pending queue should reach max capacity (2)");

	// Send another non-first frame while full -> should be dropped from queue without error
	const f1Copy = new Uint8Array(f1);
	transport.processFrame(f1Copy);
	assert.equal(transport.getPendingPreFirstQueueLength(), 2, "Pending queue length should remain capped at 2");

	// Send First QR (f0) while queue is full -> MUST still be evaluated and establish the session!
	transport.processFrame(f0);
	assert.notEqual(transport.getState(), "WaitingForFirst", "State should transition from WaitingForFirst to FirstEstablished/Receiving/OverallCrcVerification");
	assert.ok(transport.getPendingPreFirstQueueLength() === 0, "Pre-first queue should be drained upon establishing First QR");

	transport.stopReceive();
});
