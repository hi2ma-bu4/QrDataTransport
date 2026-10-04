// このファイルは仮実装の動作確認用のため使用後は削除してください。

import assert from "node:assert/strict";
import test from "node:test";

import { protocol } from "../../src/wasm/protocol.js";

test("protocol.decode", () => {
	const input = new Uint8Array([0x01, 0x02, 0x7f, 0x80, 0xff]);

	const output = protocol.decode(input);

	assert.deepStrictEqual(Array.from(output), Array.from(input));

	assert.notStrictEqual(input, output);
});
