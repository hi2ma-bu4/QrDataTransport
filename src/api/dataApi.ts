import { calculateMaxFrameBits } from "../utils/qrCapacity";
import type { EncodeResult, FrameMetadata, QrEcLevel, QrModuleMatrix } from "../wasm/interfaces/snows-qr-data-transport-protocol";
import { protocol } from "../wasm/protocol";

/**
 * デコード結果
 */
export interface DecodedResult {
	/**
	 * データ型 ("Uint8Array" または "string")
	 */
	type: "Uint8Array" | "string";

	/**
	 * デコードされたデータ
	 */
	data: Uint8Array | string;
}

/**
 * Uint8Arrayのバッファ共有を保証
 *
 * 必要に応じてTypedArrayビューを作成し、複製（copy）を回避します。
 *
 * @param arr - 対象のUint8Array
 * @returns バッファ共有されたUint8Array
 */
function ensureSharedUint8Array(arr: Uint8Array): Uint8Array {
	if (!arr) {
		return new Uint8Array(0);
	}
	// バッファ全体と一致するUint8Arrayビューの場合はそのまま返す
	if (arr.byteOffset === 0 && arr.byteLength === arr.buffer.byteLength) {
		return arr;
	}
	// コピーせずに直接バッファのビューを作成する
	return new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
}

/**
 * データ変換APIクラス
 */
export class DataApi {
	/**
	 * 生バイト列をワイヤーフレームにエンコード
	 *
	 * WASMプロトコルコアを使用して生バイト列をエンコードします。
	 * qrVersionが40以下の場合は、qrVersionとecLevelからmaxFrameBitsを自動計算します。
	 *
	 * @param data - エンコード対象の生バイト列
	 * @param qrVersion - QRコードバージョン（デフォルト: 5）
	 * @param ecLevel - 誤り訂正レベル（デフォルト: 'm'）
	 * @param parityMode - パリティモード（デフォルト: 0）
	 * @returns エンコード結果
	 */
	static encodeBytes(data: Uint8Array, qrVersion: number = 5, ecLevel: QrEcLevel = "m", parityMode: number = 0): EncodeResult {
		const bytes = ensureSharedUint8Array(data);
		const maxFrameBits = qrVersion > 40 ? qrVersion : calculateMaxFrameBits(qrVersion, ecLevel);
		return protocol.encodeBytes(bytes, maxFrameBits, parityMode);
	}

	/**
	 * テキストをワイヤーフレームにエンコード
	 *
	 * WASMプロトコルコアを使用してテキストをエンコードします。
	 * qrVersionが40以下の場合は、qrVersionとecLevelからmaxFrameBitsを自動計算します。
	 *
	 * @param text - エンコード対象のテキスト
	 * @param qrVersion - QRコードバージョン（デフォルト: 5）
	 * @param ecLevel - 誤り訂正レベル（デフォルト: 'm'）
	 * @param parityMode - パリティモード（デフォルト: 0）
	 * @returns エンコード結果
	 */
	static encodeText(text: string, qrVersion: number = 5, ecLevel: QrEcLevel = "m", parityMode: number = 0): EncodeResult {
		const maxFrameBits = qrVersion > 40 ? qrVersion : calculateMaxFrameBits(qrVersion, ecLevel);
		return protocol.encodeText(text, maxFrameBits, parityMode);
	}

	/**
	 * 単一ワイヤーフレームを解析しCRCを検証
	 *
	 * @param wireBytes - 解析対象のフレームバイト列
	 * @param knownTotalQrCount - 既知の総QRフレーム数（オプション）
	 * @param knownFirstFrameCrc - 既知のFirstフレームCRC（オプション）
	 * @param knownParityMode - 既知のパリティモード（オプション）
	 * @returns フレームメタデータ
	 */
	static parseFrame(wireBytes: Uint8Array, knownTotalQrCount?: number, knownFirstFrameCrc?: number, knownParityMode?: number): FrameMetadata {
		const bytes = ensureSharedUint8Array(wireBytes);
		return protocol.parseFrame(bytes, knownTotalQrCount, knownFirstFrameCrc, knownParityMode);
	}

	/**
	 * ワイヤーフレーム群を復元してペイロードをデコード
	 *
	 * 仕様書v8に準拠して { type: "Uint8Array" | "string", data: Uint8Array | string } を返します。
	 *
	 * @param wireFrames - 受信したワイヤーフレーム配列
	 * @returns デコード結果
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
	 * QRコードモジュール行列を生成
	 *
	 * WASM経由でqrcodegenを使用し、2値のQRモジュール行列を生成します。
	 *
	 * @param wireBytes - ワイヤーフレームバイト列
	 * @param qrVersion - QRコードバージョン
	 * @param ecLevel - 誤り訂正レベル
	 * @returns QRコードモジュール行列
	 */
	static generateQrMatrix(wireBytes: Uint8Array, qrVersion: number, ecLevel: QrEcLevel): QrModuleMatrix {
		const bytes = ensureSharedUint8Array(wireBytes);
		return protocol.generateQrMatrix(bytes, qrVersion, ecLevel);
	}

	/**
	 * QRコード画像ピクセルをデコード
	 *
	 * WASM経由でrxingを使用し、RGBAピクセル配列からワイヤーフレームバイト列をデコードします。
	 *
	 * @param rgbaPixels - RGBAピクセルバイト配列
	 * @param width - 画像の幅
	 * @param height - 画像の高さ
	 * @returns デコードされたワイヤーフレームバイト列
	 */
	static decodeQrImage(rgbaPixels: Uint8Array, width: number, height: number): Uint8Array {
		const pixels = ensureSharedUint8Array(rgbaPixels);
		return protocol.decodeQrImage(pixels, width, height);
	}
}
