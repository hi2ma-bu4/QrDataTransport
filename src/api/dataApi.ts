import type { EncodeResult, FrameMetadata, QrEcLevel, QrModuleMatrix } from "../wasm/interfaces/snows-qr-data-transport-protocol.js";
import { protocol } from "../wasm/protocol.js";

export interface DecodedResult {
	type: "Uint8Array" | "string";
	data: Uint8Array | string;
}

function ensureSharedUint8Array(arr: Uint8Array): Uint8Array {
	if (!arr) {
		return new Uint8Array(0);
	}
	// Avoid copying if it's already a Uint8Array view matching the buffer exactly
	if (arr.byteOffset === 0 && arr.byteLength === arr.buffer.byteLength) {
		return arr;
	}
	// Create a typed array view over the buffer directly without copy (.slice)
	return new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
}

export class DataApi {
	/**
	 * Encodes raw bytes into wire frames using WASM protocol core.
	 */
	static encodeBytes(data: Uint8Array, maxFrameBits: number): EncodeResult {
		const bytes = ensureSharedUint8Array(data);
		return protocol.encodeBytes(bytes, maxFrameBits);
	}

	/**
	 * Encodes text into wire frames using WASM protocol core.
	 */
	static encodeText(text: string, maxFrameBits: number): EncodeResult {
		return protocol.encodeText(text, maxFrameBits);
	}

	/**
	 * Parses a single wire frame and verifies its CRC.
	 */
	static parseFrame(wireBytes: Uint8Array, knownTotalQrCount?: number, knownFirstFrameCrc?: number): FrameMetadata {
		const bytes = ensureSharedUint8Array(wireBytes);
		return protocol.parseFrame(bytes, knownTotalQrCount, knownFirstFrameCrc);
	}

	/**
	 * Decodes a complete list of wire frames and returns the payload along with its type.
	 * Returns { type: "Uint8Array" | "string", data: Uint8Array | string } according to Spec v8.
	 */
	static decodeFrames(wireFrames: Uint8Array[]): DecodedResult {
		const sharedFrames = wireFrames.map(ensureSharedUint8Array);
		const decoded = protocol.decodeFrames(sharedFrames);

		if (decoded.tag === "bytes") {
			return {
				type: "Uint8Array",
				data: decoded.val,
			};
		}
		if (decoded.tag === "text") {
			return {
				type: "string",
				data: decoded.val,
			};
		}

		throw new Error("Unknown decoded payload tag");
	}

	/**
	 * Generates a binary QR module matrix using qrcodegen via WASM.
	 */
	static generateQrMatrix(wireBytes: Uint8Array, qrVersion: number, ecLevel: QrEcLevel): QrModuleMatrix {
		const bytes = ensureSharedUint8Array(wireBytes);
		return protocol.generateQrMatrix(bytes, qrVersion, ecLevel);
	}

	/**
	 * Decodes QR code image pixels (RGBA) to wire bytes using rxing via WASM.
	 */
	static decodeQrImage(rgbaPixels: Uint8Array, width: number, height: number): Uint8Array {
		const pixels = ensureSharedUint8Array(rgbaPixels);
		return protocol.decodeQrImage(pixels, width, height);
	}
}
