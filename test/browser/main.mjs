// 本実装ができるまでの仮
import { DataApi } from "../../dist/QrDataTransport.js";

const inputTypeElements = document.querySelectorAll('input[name="input-type"]');
const stringInputElement = document.querySelector("#string-input");
const fileInputElement = document.querySelector("#file-input");
const inputTextElement = document.querySelector("#input-text");
const inputFileElement = document.querySelector("#input-file");
const maxFrameBitsElement = document.querySelector("#max-frame-bits");
const testButton = document.querySelector("#test");
const resultElement = document.querySelector("#result");

for (const element of inputTypeElements) {
	element.addEventListener("change", updateInputVisibility);
}

testButton.addEventListener("click", async () => {
	try {
		const inputType = getInputType();
		const maxFrameBits = getMaxFrameBits();

		const input = await getInput(inputType);
		const encoded = encodeInput(inputType, input, maxFrameBits);
		const wireFrames = getWireFrames(encoded);

		if (wireFrames.length === 0) {
			throw new Error("encode returned no frames");
		}

		const decoded = DataApi.decodeFrames(wireFrames);

		if (inputType === "string") {
			verifyString(input, decoded);
			showStringResult(input, decoded.data, wireFrames.length);
		} else {
			verifyBytes(input, decoded);
			showFileResult(input.length, wireFrames.length);
		}

		console.log("PASS", {
			input,
			encoded,
			wireFrames,
			decoded,
		});
	} catch (error) {
		resultElement.textContent = `FAIL\n${error instanceof Error ? error.stack : String(error)}`;
		console.error(error);
	}
});

function getInputType() {
	const element = document.querySelector('input[name="input-type"]:checked');

	if (!element) {
		throw new Error("No input type selected");
	}

	return element.value;
}

function getMaxFrameBits() {
	const maxFrameBits = Number(maxFrameBitsElement.value);

	if (!Number.isInteger(maxFrameBits) || maxFrameBits <= 0) {
		throw new Error(`invalid max frame bits: ${maxFrameBitsElement.value}`);
	}

	return maxFrameBits;
}

async function getInput(inputType) {
	if (inputType === "string") {
		return inputTextElement.value;
	}

	if (inputType === "file") {
		const file = inputFileElement.files?.[0];

		if (!file) {
			throw new Error("No file selected");
		}

		return new Uint8Array(await file.arrayBuffer());
	}

	throw new Error(`Unknown input type: ${inputType}`);
}

function encodeInput(inputType, input, maxFrameBits) {
	if (inputType === "string") {
		return DataApi.encodeText(input, maxFrameBits);
	}

	if (inputType === "file") {
		return DataApi.encodeBytes(input, maxFrameBits);
	}

	throw new Error(`Unknown input type: ${inputType}`);
}

function getWireFrames(encoded) {
	const wireFrames = [];

	for (const frame of encoded.frames) {
		wireFrames.push(frame.wireBytes);
	}

	return wireFrames;
}

function verifyString(input, decoded) {
	if (decoded.type !== "string") {
		throw new Error(`decode result type mismatch: expected string, got ${decoded.type}`);
	}

	if (input !== decoded.data) {
		throw new Error(`decode result mismatch:\nexpected: ${input}\nactual:   ${decoded.data}`);
	}
}

function verifyBytes(input, decoded) {
	if (decoded.type !== "Uint8Array") {
		throw new Error(`decode result type mismatch: expected Uint8Array, got ${decoded.type}`);
	}

	const output = decoded.data;

	if (input.length !== output.length) {
		throw new Error(`decode result length mismatch: expected ${input.length}, got ${output.length}`);
	}

	for (let i = 0; i < input.length; i++) {
		if (input[i] !== output[i]) {
			throw new Error(`decode result mismatch at ${i}: expected ${input[i]}, got ${output[i]}`);
		}
	}
}

function showStringResult(input, output, frameCount) {
	resultElement.textContent = "PASS\n" + "type:   String\n" + `input:  ${input}\n` + `output: ${output}\n` + `frames: ${frameCount}`;
}

function showFileResult(byteLength, frameCount) {
	resultElement.textContent = "PASS\n" + "type:   File\n" + `size:   ${byteLength} bytes\n` + `frames: ${frameCount}`;
}

function updateInputVisibility() {
	const inputType = getInputType();

	stringInputElement.hidden = inputType !== "string";
	fileInputElement.hidden = inputType !== "file";
}

updateInputVisibility();
