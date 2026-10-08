import { strict as assert } from "node:assert";
import { test } from "node:test";
import { AppConfig, DataApi, TransportApi, type TransportError, type TransportWarning } from "../../dist/QrDataTransport.js";

test("TransportApi Sender: startSend creates wire frames and loops infinitely", async () => {
	const transport = new TransportApi(new AppConfig({ data: { maxFrameBits: 120 }, transport: { intervalMs: 20 } }));

	let completedResult = false;
	transport.onComplete(() => {
		completedResult = true;
	});

	await transport.startSend("Hello Transport API World!");
	const currentFrame1 = transport.getCurrentSendFrame();
	assert.ok(currentFrame1 instanceof Uint8Array);
	assert.ok(currentFrame1!.length > 0);

	// Duplicate startSend call must be ignored per Spec v8
	await transport.startSend("Should be ignored");
	assert.equal(completedResult, false);

	transport.stopSend();
	assert.equal(transport.getCurrentSendFrame(), null);
});

test("TransportApi Receiver: single frame transmission (Total QR Count = 1)", async () => {
	const transport = new TransportApi();

	let completedResult: any = null;
	transport.onComplete((res) => {
		completedResult = res;
	});

	await transport.startReceive();
	assert.equal(transport.getState(), "WaitingForFirst");

	// Encode 1-frame message with large maxFrameBits
	const encoded = DataApi.encodeText("Short", 1000);
	assert.equal(encoded.frames.length, 1);

	const wireBytes = new Uint8Array(encoded.frames[0].wireBytes);
	transport.processFrame(wireBytes);

	assert.equal(transport.getState(), "Completed");
	assert.notEqual(completedResult, null);
	assert.equal(completedResult.type, "string");
	assert.equal(completedResult.data, "Short");
});

test("TransportApi Receiver: multi-frame transmission and missing frame wait", async () => {
	const transport = new TransportApi();

	let completedResult: any = null;
	transport.onComplete((res) => {
		completedResult = res;
	});

	await transport.startReceive();

	// Split payload into 3 frames with maxFrameBits = 100
	const text = "Multi-frame transport transmission test string payload";
	const encoded = DataApi.encodeText(text, 100);
	assert.ok(encoded.frames.length >= 3);

	const f0 = new Uint8Array(encoded.frames[0].wireBytes);
	const f1 = new Uint8Array(encoded.frames[1].wireBytes);
	const f2 = new Uint8Array(encoded.frames[2].wireBytes);

	// Send Frame 0 (First)
	transport.processFrame(f0);

	// Send Frame 2 (Intermediate/Final) -> missing Frame 1
	transport.processFrame(f2);
	assert.equal(transport.getState(), "WaitingMissingFrames");
	assert.equal(completedResult, null);

	// Send Frame 1 -> completes transfer
	transport.processFrame(f1);

	if (encoded.frames.length === 3) {
		assert.equal(transport.getState(), "Completed");
		assert.notEqual(completedResult, null);
		assert.equal(completedResult.data, text);
	}
});

test("TransportApi Receiver: pre-first queueing and queue limit", async () => {
	const config = new AppConfig({ transport: { maxPendingFramesBeforeFirst: 2 } });
	const transport = new TransportApi(config);

	await transport.startReceive();

	const encoded = DataApi.encodeText("Queueing Test Payload Message", 100);
	assert.ok(encoded.frames.length >= 3);

	const f0 = new Uint8Array(encoded.frames[0].wireBytes);
	const f1 = new Uint8Array(encoded.frames[1].wireBytes);
	const f2 = new Uint8Array(encoded.frames[2].wireBytes);

	// Send non-first frames first
	transport.processFrame(f1);
	transport.processFrame(f2);
	assert.equal(transport.getState(), "WaitingForFirst");

	// Now send First frame (f0) -> should establish and process pending frames f1 and f2
	let completedResult: any = null;
	transport.onComplete((res) => {
		completedResult = res;
	});

	transport.processFrame(f0);

	if (encoded.frames.length === 3) {
		assert.equal(transport.getState(), "Completed");
		assert.notEqual(completedResult, null);
		assert.equal(completedResult.data, "Queueing Test Payload Message");
	}
});

test("TransportApi Receiver: duplicate frame skip does not increment CRC error counter", async () => {
	const transport = new TransportApi();

	let errorsCount = 0;
	transport.onError(() => {
		errorsCount++;
	});

	await transport.startReceive();

	const encoded = DataApi.encodeBytes(new Uint8Array([1, 2, 3, 4, 5]), 1000);
	const f0 = new Uint8Array(encoded.frames[0].wireBytes);

	transport.processFrame(f0);
	assert.equal(errorsCount, 0);

	// Re-send same frame f0 -> Skip!
	transport.processFrame(f0);
	assert.equal(errorsCount, 0);
});

test("TransportApi Receiver: CRC error boundary and threshold (maxConsecutiveCrcErrors = 3)", async () => {
	const transport = new TransportApi(new AppConfig({ transport: { maxConsecutiveCrcErrors: 3 } }));

	const errors: TransportError[] = [];
	transport.onError((err) => {
		errors.push(err);
	});

	await transport.startReceive();

	const encoded = DataApi.encodeText("CRC error boundary test text payload", 100);
	const f0 = new Uint8Array(encoded.frames[0].wireBytes);
	transport.processFrame(f0); // First Established

	const corruptF1 = new Uint8Array(encoded.frames[1].wireBytes);
	corruptF1[corruptF1.length - 1] ^= 0xff; // Corrupt CRC

	// 1st error -> non-critical
	transport.processFrame(corruptF1);
	assert.equal(errors.length, 1);
	assert.equal(errors[0].critical, false);

	// 2nd error -> non-critical
	transport.processFrame(corruptF1);
	assert.equal(errors.length, 2);

	// 3rd error -> CRITICAL error threshold reached!
	transport.processFrame(corruptF1);
	assert.equal(transport.getState(), "Error");
	const criticalErr = errors.find((e) => e.critical);
	assert.ok(criticalErr);
	assert.equal(criticalErr?.code, "MAX_CRC_ERRORS_EXCEEDED");
});

test("TransportApi Receiver: unlimited CRC error threshold (maxConsecutiveCrcErrors = 0)", async () => {
	const transport = new TransportApi(new AppConfig({ transport: { maxConsecutiveCrcErrors: 0 } }));

	const errors: TransportError[] = [];
	transport.onError((err) => {
		errors.push(err);
	});

	await transport.startReceive();

	const encoded = DataApi.encodeText("CRC error boundary test text payload", 100);
	const f0 = new Uint8Array(encoded.frames[0].wireBytes);
	transport.processFrame(f0);

	const corruptF1 = new Uint8Array(encoded.frames[1].wireBytes);
	corruptF1[corruptF1.length - 1] ^= 0xff;

	// Send 20 corrupt frames -> should never exceed threshold or declare critical error
	for (let i = 0; i < 20; i++) {
		transport.processFrame(corruptF1);
	}

	assert.notEqual(transport.getState(), "Error");
	assert.equal(
		errors.some((e) => e.critical),
		false,
	);
});

test("TransportApi Receiver: First CRC change discards subsequent frames with warning", async () => {
	const transport = new TransportApi();

	const warnings: TransportWarning[] = [];
	transport.onWarning((w) => warnings.push(w));

	await transport.startReceive();

	const enc1 = DataApi.encodeText("First Session Message Data", 100);
	const enc1_f0 = new Uint8Array(enc1.frames[0].wireBytes);
	const enc1_f1 = new Uint8Array(enc1.frames[1].wireBytes);

	transport.processFrame(enc1_f0);
	transport.processFrame(enc1_f1);

	// Send a new First Frame from a completely different message with different payload length or bytes
	const enc2 = DataApi.encodeText("Different Second Session Message Data with longer payload", 100);
	const enc2_f0 = new Uint8Array(enc2.frames[0].wireBytes);

	transport.processFrame(enc2_f0);

	const discardedWarn = warnings.find((w) => w.code === "POST_FIRST_FRAMES_DISCARDED");
	assert.ok(discardedWarn);
});

test("TransportApi Receiver: Out-of-range frame numbers are ignored", async () => {
	const transport = new TransportApi();

	await transport.startReceive();

	const enc = DataApi.encodeText("Single frame", 1000); // 1 frame total
	const f0 = new Uint8Array(enc.frames[0].wireBytes);
	transport.processFrame(f0); // Total QR Count = 1

	// Attempt to process a frame with out of range metadata
	const multiEnc = DataApi.encodeText("Multi frame text string data", 100);
	const f5 = new Uint8Array(multiEnc.frames[multiEnc.frames.length - 1].wireBytes);

	let errorFired = false;
	transport.onError(() => {
		errorFired = true;
	});

	transport.processFrame(f5);
	assert.equal(errorFired, false);
});

test("TransportApi Receiver: onFrameProcessed emits progress events with (validCount, pendingCount, totalCount)", async () => {
	const transport = new TransportApi();

	const progressEvents: { validCount: number; pendingCount: number; totalCount: number }[] = [];
	transport.onFrameProcessed((evt) => {
		progressEvents.push(evt);
	});

	// Subscribing immediately emits initial state
	assert.equal(progressEvents.length, 1);
	assert.deepEqual(progressEvents[0], { validCount: 0, pendingCount: 0, totalCount: -1 });

	await transport.startReceive();

	const text = "Testing progress tracking event callback for QR transport";
	const encoded = DataApi.encodeText(text, 100);
	assert.ok(encoded.frames.length >= 3);

	const f0 = new Uint8Array(encoded.frames[0].wireBytes);
	const f1 = new Uint8Array(encoded.frames[1].wireBytes);

	// Process non-first frame before First QR -> pending count increases, totalCount remains -1
	transport.processFrame(f1);
	const lastEventAfterF1 = progressEvents[progressEvents.length - 1];
	assert.equal(lastEventAfterF1.validCount, 0);
	assert.equal(lastEventAfterF1.pendingCount, 1);
	assert.equal(lastEventAfterF1.totalCount, -1);

	// Process First QR -> establishes communication, moves pending frames to valid stored frames, sets totalCount
	transport.processFrame(f0);
	const lastEventAfterF0 = progressEvents[progressEvents.length - 1];
	assert.equal(lastEventAfterF0.validCount, 2); // f0 + f1 (drained from queue)
	assert.equal(lastEventAfterF0.pendingCount, 0);
	assert.equal(lastEventAfterF0.totalCount, encoded.frames.length);

	// Stop receive -> resets state to (0, 0, -1)
	transport.stopReceive();
	const lastEventAfterStop = progressEvents[progressEvents.length - 1];
	assert.deepEqual(lastEventAfterStop, { validCount: 0, pendingCount: 0, totalCount: -1 });
});
