// 本実装ができるまでの仮
import { protocol } from "../../src/wasm/protocol.js";
// import { protocol } from "../../dist/index.js";

const input = new Uint8Array([0x01, 0x02, 0x7f, 0x80, 0xff]);

try {
	const output = protocol.decode(input);

	const inputText = Array.from(input).join(", ");
	const outputText = Array.from(output).join(", ");

	if (inputText !== outputText) {
		throw new Error(`decode result mismatch: [${outputText}]`);
	}

	if (input === output) {
		throw new Error("decode returned the input object");
	}

	document.querySelector("#result").textContent = "PASS\n" + `input:  [${inputText}]\n` + `output: [${outputText}]`;

	console.log("PASS", {
		input,
		output,
		sameObject: input === output,
	});
} catch (error) {
	document.querySelector("#result").textContent = `FAIL\n${error instanceof Error ? error.stack : error}`;

	console.error(error);
}
