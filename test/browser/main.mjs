import { BrowserRuntimeApi, TransportApi } from "../../dist/QrDataTransport.js";

const inputTypeSelect = document.getElementById("input-type");
const qrVersionInput = document.getElementById("qr-version");
const ecLevelSelect = document.getElementById("ec-level");
const calcMaxFrameBitsSpan = document.getElementById("calc-max-frame-bits");
const intervalMsInput = document.getElementById("interval-ms");
const maxCrcErrorsInput = document.getElementById("max-crc-errors");

const stringInputContainer = document.getElementById("string-input-container");
const fileInputContainer = document.getElementById("file-input-container");
const inputTextarea = document.getElementById("input-text");
const inputFile = document.getElementById("input-file");

const btnStartSend = document.getElementById("btn-start-send");
const btnStopSend = document.getElementById("btn-stop-send");
const btnStartReceive = document.getElementById("btn-start-receive");
const btnStopReceive = document.getElementById("btn-stop-receive");
const btnSimulateLoopback = document.getElementById("btn-simulate-loopback");

const statusState = document.getElementById("status-state");
const logOutput = document.getElementById("log-output");

const runtime = new BrowserRuntimeApi();
const transport = new TransportApi(undefined, runtime);

function updateCalculatedCapacity() {
	const ver = Number(qrVersionInput.value);
	const ec = ecLevelSelect.value;
	try {
		const config = transport.getConfig();
		config.data.qrVersion = ver;
		config.data.ecLevel = ec;
		calcMaxFrameBitsSpan.textContent = `${config.data.maxFrameBits} bits`;
	} catch {
		calcMaxFrameBitsSpan.textContent = "Error";
	}
}

qrVersionInput.addEventListener("input", updateCalculatedCapacity);
ecLevelSelect.addEventListener("change", updateCalculatedCapacity);

inputTypeSelect.addEventListener("change", () => {
	if (inputTypeSelect.value === "string") {
		stringInputContainer.style.display = "block";
		fileInputContainer.style.display = "none";
	} else {
		stringInputContainer.style.display = "none";
		fileInputContainer.style.display = "block";
	}
});

function log(msg) {
	const timestamp = new Date().toISOString().split("T")[1].slice(0, 8);
	logOutput.textContent = `[${timestamp}] ${msg}\n` + logOutput.textContent;
	statusState.textContent = transport.getState();
}

transport.onWarning((warn) => {
	log(`[WARNING] Code: ${warn.code} - ${warn.message}`);
});

transport.onError((err) => {
	log(`[ERROR] Code: ${err.code} - ${err.message} (Critical: ${err.critical})`);
});

transport.onComplete((res) => {
	log(`[COMPLETE] Received Data (${res.type}): ${typeof res.data === "string" ? res.data : `Uint8Array(${res.data.length} bytes)`}`);
});

btnStartSend.addEventListener("click", async () => {
	try {
		const inputType = inputTypeSelect.value;
		const qrVersion = Number(qrVersionInput.value);
		const ecLevel = ecLevelSelect.value;
		const intervalMs = Number(intervalMsInput.value);

		let payload;
		if (inputType === "string") {
			payload = inputTextarea.value;
		} else {
			const file = inputFile.files?.[0];
			if (!file) {
				alert("Please select a file first");
				return;
			}
			payload = new Uint8Array(await file.arrayBuffer());
		}

		await transport.startSend(payload, {
			qrVersion,
			ecLevel,
			intervalMs,
			canvas: "qr-canvas",
		});

		log(`Started sending payload (${inputType}).`);
	} catch (err) {
		log(`Failed to start sender: ${String(err)}`);
	}
});

btnStopSend.addEventListener("click", () => {
	transport.stopSend();
	log("Stopped sender.");
});

btnStartReceive.addEventListener("click", async () => {
	try {
		const maxConsecutiveCrcErrors = Number(maxCrcErrorsInput.value);
		await transport.startReceive({ maxConsecutiveCrcErrors });

		await runtime.startCamera((rgbaPixels, width, height) => {
			// Dynamic frame decode processing loop using WASM
			try {
				const wireBytes = transport.getConfig() ? null : null; // Camera decode hook placeholder
			} catch {
				// ignore invalid camera frame decode
			}
		});

		log("Started receiver and camera feed.");
	} catch (err) {
		log(`Failed to start receiver: ${String(err)}`);
	}
});

btnStopReceive.addEventListener("click", () => {
	transport.stopReceive();
	log("Stopped receiver.");
});

btnSimulateLoopback.addEventListener("click", async () => {
	try {
		const currentFrame = transport.getCurrentSendFrame();
		if (!currentFrame) {
			log("No current frame available from Sender. Please click 'Start Sender' first.");
			return;
		}

		if (transport.getState() === "Idle" || transport.getState() === "Completed" || transport.getState() === "Error") {
			await transport.startReceive({
				maxConsecutiveCrcErrors: Number(maxCrcErrorsInput.value),
			});
		}

		log(`Processing simulated wire frame (Length: ${currentFrame.length} bytes)...`);
		transport.processFrame(currentFrame);
	} catch (err) {
		log(`Loopback error: ${String(err)}`);
	}
});

updateCalculatedCapacity();
