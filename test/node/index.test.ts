// このファイルは仮実装の動作確認用のため使用後は削除してください。

import assert from "node:assert/strict";
import test from "node:test";

import { input, output } from "../../dist/index.js";

test("protocol.decode", () => {
	assert.deepStrictEqual(Array.from(input), [0x01, 0x02, 0x7f, 0x80, 0xff]);

	assert.deepStrictEqual(Array.from(output), [0x01, 0x02, 0x7f, 0x80, 0xff]);

	assert.notStrictEqual(input, output);
});
