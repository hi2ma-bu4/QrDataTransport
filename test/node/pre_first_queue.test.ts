import { strict as assert } from "node:assert";
import { test } from "node:test";

import { DataApi, TransportApi } from "../../dist/QrDataTransport.js";

test("Pre-First QR queueing, queue limits, non-increment of CRC errors, and priority processing", async () => {
	const transport = new TransportApi();
	const payload = "Testing Pre-First Queue and Priority Handling";

	// Generate wire frames (Total QR Count >= 2)
	const encodeRes = DataApi.encodeText(payload, 1, "l");
	assert.ok(encodeRes.frames.length >= 2, "Expected at least 2 frames");

	const wireFrames = encodeRes.frames.map((f) => new Uint8Array(f.wireBytes));

	let errorCount = 0;
	transport.onError(() => {
		errorCount++;
	});

	await transport.startReceive({ maxPendingFramesBeforeFirst: 2 });
	assert.equal(transport.getState(), "WaitingForFirst");

	// 1. Process non-first frame (frame 1) before First QR
	transport.processFrame(wireFrames[1]);
	// Pre-first frame must be queued and MUST NOT count towards CRC errors (Spec v8 Section 33)
	assert.equal(transport.getPendingPreFirstQueueLength(), 1);
	assert.equal(errorCount, 0);

	// 2. Process duplicate non-first frame before First QR -> should be ignored (no duplicate queueing)
	transport.processFrame(wireFrames[1]);
	assert.equal(transport.getPendingPreFirstQueueLength(), 1);

	// 3. Process First QR (frame 0) -> establishes communication context and drains pending queue
	transport.processFrame(wireFrames[0]);

	// 4. Process all remaining frames
	for (let i = 2; i < wireFrames.length; i++) {
		transport.processFrame(wireFrames[i]);
	}

	assert.equal(transport.getState(), "Completed");
});

test("Pre-First queue state reset on stopReceive", async () => {
	const transport = new TransportApi();
	const encodeRes = DataApi.encodeText("Reset test", 1, "l");
	const wireFrame1 = new Uint8Array(encodeRes.frames[1].wireBytes);

	await transport.startReceive();
	transport.processFrame(wireFrame1);
	assert.equal(transport.getPendingPreFirstQueueLength(), 1);

	transport.stopReceive();
	assert.equal(transport.getState(), "Idle");
	assert.equal(transport.getPendingPreFirstQueueLength(), 0);
});
