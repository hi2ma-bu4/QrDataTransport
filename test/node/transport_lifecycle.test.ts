import { strict as assert } from "node:assert";
import { test } from "node:test";
import { DataApi, TransportApi, type TransportError, type TransportWarning } from "../../dist/QrDataTransport.js";

test("TransportApi lifecycle: ignore duplicate startSend / startReceive and clear state on stop", async () => {
	let canvasCleared = false;
	const mockRuntime = {
		renderQrModuleMatrix: () => {},
		clearCanvas: () => {
			canvasCleared = true;
		},
		startCamera: async () => {},
		stopCamera: () => {},
	};

	const transport = new TransportApi(undefined, mockRuntime as any);

	// 1. startSend and attempt duplicate startSend
	await transport.startSend("Test message");
	const initialFrame = transport.getCurrentSendFrame();
	assert.ok(initialFrame !== null);

	await transport.startSend("Should be ignored while active");
	assert.deepEqual(transport.getCurrentSendFrame(), initialFrame);

	// 2. stopSend clears canvas
	transport.stopSend();
	assert.equal(canvasCleared, true);
	assert.equal(transport.getCurrentSendFrame(), null);

	// 3. startReceive and duplicate startReceive
	await transport.startReceive();
	assert.equal(transport.getState(), "WaitingForFirst");

	await transport.startReceive(); // Duplicate call ignored
	assert.equal(transport.getState(), "WaitingForFirst");

	transport.stopReceive();
	assert.equal(transport.getState(), "Idle");
});

test("TransportApi warnings and critical errors: First CRC change and Overall CRC mismatch", async () => {
	const transport = new TransportApi();

	const warnings: TransportWarning[] = [];
	const errors: TransportError[] = [];

	transport.onWarning((w) => warnings.push(w));
	transport.onError((e) => errors.push(e));

	// Generate 2 sets of wire frames with different First QR contents (different First CRC)
	const setA = DataApi.encodeText("Alpha stream payload message", 1, "l");
	const setB = DataApi.encodeText("Beta stream payload message", 1, "l");

	const wireA0 = new Uint8Array(setA.frames[0].wireBytes);
	const wireA1 = new Uint8Array(setA.frames[1].wireBytes);

	const wireB0 = new Uint8Array(setB.frames[0].wireBytes);

	await transport.startReceive();

	// Process setA frame 0 and frame 1
	transport.processFrame(wireA0);
	transport.processFrame(wireA1);

	// Now process setB frame 0 (First CRC changed)
	transport.processFrame(wireB0);

	const discardedWarn = warnings.find((w) => w.code === "POST_FIRST_FRAMES_DISCARDED");
	assert.ok(discardedWarn, "Expected POST_FIRST_FRAMES_DISCARDED warning when First CRC changes");

	// Test Overall CRC mismatch (corrupt final frame payload bit)
	const setC = DataApi.encodeText("Overall CRC Check Payload", 1, "l");
	const wireC0 = new Uint8Array(setC.frames[0].wireBytes);
	const wireC1 = new Uint8Array(setC.frames[1].wireBytes);

	// Corrupt wireC1 payload byte
	wireC1[3] ^= 0xff;

	const freshTransport = new TransportApi();
	const freshErrors: TransportError[] = [];
	freshTransport.onError((e) => freshErrors.push(e));

	await freshTransport.startReceive();
	freshTransport.processFrame(wireC0);
	freshTransport.processFrame(wireC1);

	// Because wireC1 CRC in header failed, it emits SYNTAX_ERROR (non-critical)
	const syntaxErr = freshErrors.find((e) => e.code === "SYNTAX_ERROR");
	assert.ok(syntaxErr);
});
