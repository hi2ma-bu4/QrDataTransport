import { BrowserRuntimeApi, DataApi, TransportApi } from "../../dist/QrDataTransport.js";

const inputTypeSelect = document.getElementById("input-type");
const qrVersionInput = document.getElementById("qr-version");
const ecLevelSelect = document.getElementById("ec-level");
const calcMaxFrameBitsSpan = document.getElementById("calc-max-frame-bits");
const intervalMsInput = document.getElementById("interval-ms");
const maxCrcErrorsInput = document.getElementById("max-crc-errors");
const cameraFacingSelect = document.getElementById("camera-facing");
const cameraDeviceSelect = document.getElementById("camera-device");

const settingsSender = document.getElementById("settings-sender");
const settingsReceiver = document.getElementById("settings-receiver");

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
const sendProgressDisplay = document.getElementById("send-progress-display");

const receivedDataContainer = document.getElementById("received-data-container");
const receivedTextarea = document.getElementById("received-text");
const downloadFileBtn = document.getElementById("download-file-btn");

const tabSender = document.getElementById("tab-sender");
const tabReceiver = document.getElementById("tab-receiver");
const panelSender = document.getElementById("panel-sender");
const panelReceiver = document.getElementById("panel-receiver");

const runtime = new BrowserRuntimeApi();
const transport = new TransportApi(undefined, runtime);

let latestFrameEvent = {
	validCount: 0,
	pendingCount: 0,
	totalCount: -1,
	isQrDetected: false,
	bps: 0,
};

// Tab Switching & Settings Visibility Control
tabSender.addEventListener("click", () => {
	tabSender.classList.add("active");
	tabReceiver.classList.remove("active");
	panelSender.classList.add("active");
	panelReceiver.classList.remove("active");
	if (settingsSender) settingsSender.style.display = "grid";
	if (settingsReceiver) settingsReceiver.style.display = "none";
});

tabReceiver.addEventListener("click", () => {
	tabReceiver.classList.add("active");
	tabSender.classList.remove("active");
	panelReceiver.classList.add("active");
	panelSender.classList.remove("active");
	if (settingsSender) settingsSender.style.display = "none";
	if (settingsReceiver) settingsReceiver.style.display = "grid";
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
	log(`[COMPLETE] Communication finished. Received ${res.type} data.`);

	if (receivedDataContainer) {
		receivedDataContainer.style.display = "block";
	}

	if (res.type === "string") {
		if (receivedTextarea) {
			receivedTextarea.value = res.data;
			receivedTextarea.style.display = "block";
		}
		if (downloadFileBtn) {
			downloadFileBtn.style.display = "none";
		}
	} else {
		if (receivedTextarea) {
			receivedTextarea.style.display = "none";
		}
		if (downloadFileBtn) {
			const blob = new Blob([res.data], { type: "application/octet-stream" });
			downloadFileBtn.href = URL.createObjectURL(blob);
			downloadFileBtn.download = `received_file_${Date.now()}.bin`;
			downloadFileBtn.style.display = "inline-block";
		}
	}
});

transport.onSendProgress((evt) => {
	if (sendProgressDisplay) {
		sendProgressDisplay.textContent = `(${evt.index}/${evt.maxIndex})`;
	}
});

transport.onFrameProcessed((evt) => {
	latestFrameEvent = evt;
});

/**
 * Draw custom camera scan overlay with real-time HUD and green/red border indicator.
 */
function drawCameraOverlay(ctx, width, height) {
	const isDetected = latestFrameEvent.isQrDetected;
	const borderColor = isDetected ? "#10b981" : "#ef4444"; // Green when detected, Red otherwise
	const cornerColor = isDetected ? "#34d399" : "#f87171";

	const size = Math.min(width, height) * 0.65;
	const x = (width - size) / 2;
	const y = (height - size) / 2;

	ctx.save();

	// Outer frame border
	ctx.strokeStyle = borderColor;
	ctx.lineWidth = 3;
	ctx.strokeRect(x, y, size, size);

	// Corner markers
	const lineLen = Math.min(size * 0.15, 24);
	ctx.strokeStyle = cornerColor;
	ctx.lineWidth = 5;

	// Top-left
	ctx.beginPath();
	ctx.moveTo(x, y + lineLen);
	ctx.lineTo(x, y);
	ctx.lineTo(x + lineLen, y);
	ctx.stroke();

	// Top-right
	ctx.beginPath();
	ctx.moveTo(x + size - lineLen, y);
	ctx.lineTo(x + size, y);
	ctx.lineTo(x + size, y + lineLen);
	ctx.stroke();

	// Bottom-left
	ctx.beginPath();
	ctx.moveTo(x, y + size - lineLen);
	ctx.lineTo(x, y + size);
	ctx.lineTo(x + lineLen, y + size);
	ctx.stroke();

	// Bottom-right
	ctx.beginPath();
	ctx.moveTo(x + size - lineLen, y + size);
	ctx.lineTo(x + size, y + size);
	ctx.lineTo(x + size, y + size - lineLen);
	ctx.stroke();

	// Top-Right HUD Badge on Canvas (Progress, bps, State)
	const totalStr = latestFrameEvent.totalCount === -1 ? "N" : latestFrameEvent.totalCount;
	const pendingStr = latestFrameEvent.pendingCount <= 0 ? "" : `(${latestFrameEvent.pendingCount})`;
	const progressText = `Progress: ${latestFrameEvent.validCount}${pendingStr}/${totalStr}`;
	const bpsText = `Speed: ${latestFrameEvent.bps} bps`;
	const stateText = `State: ${transport.getState()}`;

	const badgeWidth = 170;
	const badgeHeight = 62;
	const badgeX = width - badgeWidth - 10;
	const badgeY = 10;

	ctx.fillStyle = "rgba(15, 23, 42, 0.85)";
	ctx.beginPath();
	ctx.roundRect ? ctx.roundRect(badgeX, badgeY, badgeWidth, badgeHeight, 6) : ctx.rect(badgeX, badgeY, badgeWidth, badgeHeight);
	ctx.fill();

	ctx.fillStyle = "#f8fafc";
	ctx.font = "bold 12px sans-serif";
	ctx.fillText(progressText, badgeX + 8, badgeY + 18);

	ctx.fillStyle = "#38bdf8";
	ctx.fillText(bpsText, badgeX + 8, badgeY + 36);

	ctx.fillStyle = "#cbd5e1";
	ctx.font = "11px sans-serif";
	ctx.fillText(stateText, badgeX + 8, badgeY + 52);

	ctx.restore();
}

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
	if (sendProgressDisplay) {
		sendProgressDisplay.textContent = "(-/-)";
	}
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
		if (receivedDataContainer) {
			receivedDataContainer.style.display = "none";
		}

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
					} else {
						transport.processFrame(null);
					}
				} catch {
					transport.processFrame(null);
				}
			},
			{
				previewCanvas: "camera-canvas",
				facingMode,
				deviceId,
				drawOverlay: drawCameraOverlay,
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
