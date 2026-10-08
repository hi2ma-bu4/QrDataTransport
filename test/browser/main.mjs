import { BrowserRuntimeApi, DataApi, TransportApi } from "../../dist/QrDataTransport.js";

const inputTypeSelect = document.getElementById("input-type");
const qrVersionInput = document.getElementById("qr-version");
const ecLevelSelect = document.getElementById("ec-level");
const calcMaxFrameBitsSpan = document.getElementById("calc-max-frame-bits");
const intervalMsInput = document.getElementById("interval-ms");
const maxCrcErrorsInput = document.getElementById("max-crc-errors");
const cameraFacingSelect = document.getElementById("camera-facing");
const cameraDeviceSelect = document.getElementById("camera-device");

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
const progressDisplay = document.getElementById("progress-display");

const tabSender = document.getElementById("tab-sender");
const tabReceiver = document.getElementById("tab-receiver");
const panelSender = document.getElementById("panel-sender");
const panelReceiver = document.getElementById("panel-receiver");

const runtime = new BrowserRuntimeApi();
const transport = new TransportApi(undefined, runtime);

// Tab Switching
tabSender.addEventListener("click", () => {
	tabSender.classList.add("active");
	tabReceiver.classList.remove("active");
	panelSender.classList.add("active");
	panelReceiver.classList.remove("active");
});

tabReceiver.addEventListener("click", () => {
	tabReceiver.classList.add("active");
	tabSender.classList.remove("active");
	panelReceiver.classList.add("active");
	panelSender.classList.remove("active");
});

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

transport.onFrameProcessed((evt) => {
	if (progressDisplay) {
		const totalStr = evt.totalCount === -1 ? "N" : evt.totalCount;
		const pendingStr = evt.pendingCount <= 0 ? "" : `(${evt.pendingCount})`;
		progressDisplay.textContent = `(${evt.validCount}${pendingStr}/${totalStr})`;
	}
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

async function populateCameraDevices() {
	if (!runtime.getAvailableVideoDevices) return;
	try {
		const devices = await runtime.getAvailableVideoDevices();
		if (cameraDeviceSelect) {
			cameraDeviceSelect.innerHTML = '<option value="">デフォルト (Facing Mode 優先)</option>';
			devices.forEach((dev, idx) => {
				const opt = document.createElement("option");
				opt.value = dev.deviceId;
				opt.textContent = dev.label || `カメラ ${idx + 1} (${dev.deviceId.slice(0, 8)}...)`;
				cameraDeviceSelect.appendChild(opt);
			});
		}
	} catch {
		// Device enumeration optional
	}
}

populateCameraDevices();

btnStartReceive.addEventListener("click", async () => {
	try {
		const maxConsecutiveCrcErrors = Number(maxCrcErrorsInput.value);
		await transport.startReceive({ maxConsecutiveCrcErrors });

		const facingMode = cameraFacingSelect ? cameraFacingSelect.value : "environment";
		const deviceId = cameraDeviceSelect && cameraDeviceSelect.value ? cameraDeviceSelect.value : undefined;

		await runtime.startCamera(
			(rgbaPixels, width, height) => {
				try {
					const wireBytes = DataApi.decodeQrImage(rgbaPixels, width, height);
					if (wireBytes && wireBytes.length > 0) {
						transport.processFrame(wireBytes);
					}
				} catch {
					// Ignore frames where QR code is not found or decode fails
				}
			},
			{
				previewCanvas: "camera-canvas",
				facingMode,
				deviceId,
			},
		);

		log(`Started receiver and camera feed (facingMode: ${facingMode}${deviceId ? `, deviceId: ${deviceId}` : ""}).`);
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
