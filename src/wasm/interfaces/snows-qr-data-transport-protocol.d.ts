/** @module Interface snows:qr-data-transport/protocol **/
export function encodeBytes(data: Uint8Array, maxFrameBits: number, parityMode: number): EncodeResult;
export function encodeText(text: string, maxFrameBits: number, parityMode: number): EncodeResult;
export function parseFrame(wireBytes: Uint8Array, knownTotalQrCount: number | undefined, knownFirstFrameCrc: number | undefined, knownParityMode: number | undefined): FrameMetadata;
export function decodeFrames(wireFrames: Array<Uint8Array>): DecodedPayload;
export function generateQrMatrix(wireBytes: Uint8Array, qrVersion: number, ecLevel: QrEcLevel): QrModuleMatrix;
export function decodeQrImage(rgbaPixels: Uint8Array, width: number, height: number): Uint8Array;
/**
 * # Variants
 * 
 * ## `"uint8array"`
 * 
 * ## `"bytes-string"`
 */
export type DataType = 'uint8array' | 'bytes-string';
/**
 * # Variants
 * 
 * ## `"ascii"`
 * 
 * ## `"utf8"`
 */
export type StringMode = 'ascii' | 'utf8';
/**
 * # Variants
 * 
 * ## `"l"`
 * 
 * ## `"m"`
 * 
 * ## `"q"`
 * 
 * ## `"h"`
 */
export type QrEcLevel = 'l' | 'm' | 'q' | 'h';
export interface FrameMetadata {
  isFirst: boolean,
  isParity: boolean,
  version: number,
  totalQrCount: number,
  frameNumber: number,
  parityMode?: number,
  dataType?: DataType,
  payloadBitLen: number,
  frameCrc: number,
  overallCrc?: number,
  crcValid: boolean,
}
export type DecodedPayload = DecodedPayloadBytes | DecodedPayloadText;
export interface DecodedPayloadBytes {
  tag: 'bytes',
  val: Uint8Array,
}
export interface DecodedPayloadText {
  tag: 'text',
  val: string,
}
export interface EncodedFrameOutput {
  wireBytes: Uint8Array,
  frameNumber: number,
  totalQrCount: number,
}
export interface EncodeResult {
  frames: Array<EncodedFrameOutput>,
}
export interface QrModuleMatrix {
  width: number,
  height: number,
  modules: Uint8Array,
}
