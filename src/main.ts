import { protocol } from "./wasm/protocol.js";

const input = new Uint8Array([0x01, 0x02, 0x7f, 0x80, 0xff]);

const output = protocol.decode(input);

export { input, output };
