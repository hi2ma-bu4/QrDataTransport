use crate::bit_stream::{BitReader, BitStreamError, BitWriter};
use crate::frame::{
    DataType, DecodeContext, Frame, FrameError, calculate_overall_crc, decode_frame, encode_frame,
};
use thiserror::Error;

/// Current Library Format Version used by the sender.
pub const CURRENT_VERSION: u8 = 1;

/// Input data type for the Sender API.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InputData<'a> {
    Uint8Array(&'a [u8]),
    String(&'a str),
}

/// Errors that can occur during encoding in the Data API sender.
#[derive(Debug, Error, PartialEq, Eq)]
pub enum EncoderError {
    #[error("max_payload_bits must be greater than 0")]
    ZeroMaxPayloadBits,

    #[error("Payload exceeds maximum supported frames (65536): {total_qr_count}")]
    ExceedsMaxFrames { total_qr_count: u32 },

    #[error("Frame error: {0}")]
    Frame(#[from] FrameError),

    #[error("BitStream error: {0}")]
    BitStream(#[from] BitStreamError),
}

/// Output returned by the Data API sender after encoding.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EncodeOutput {
    pub frames: Vec<Frame>,
    pub wire_bytes: Vec<Vec<u8>>,
}

/// Encodes input data (Uint8Array or String) into a set of Frames and their wire format byte vectors.
pub fn encode_data(data: InputData, max_frame_bits: usize) -> Result<EncodeOutput, EncoderError> {
    if max_frame_bits == 0 {
        return Err(EncoderError::ZeroMaxPayloadBits);
    }

    // 1. Build Payload bitstream
    let mut payload_writer = BitWriter::new();
    let data_type = match data {
        InputData::Uint8Array(bytes) => {
            payload_writer.write_bytes(bytes, bytes.len() * 8)?;
            DataType::Uint8Array
        }
        InputData::String(s) => {
            let is_ascii = s.bytes().all(|b| b <= 0x7F);
            if is_ascii {
                // ASCII Mode: [Mode = 0 (1 bit)][7-bit MSB-first per character]
                payload_writer.write_bit(false);
                for b in s.bytes() {
                    payload_writer.write_bits(b as u64, 7)?;
                }
            } else {
                // UTF-8 Mode: [Mode = 1 (1 bit)][8-bit MSB-first per byte]
                payload_writer.write_bit(true);
                for b in s.bytes() {
                    payload_writer.write_bits(b as u64, 8)?;
                }
            }
            DataType::String
        }
    };

    let total_payload_bits = payload_writer.bit_len();

    // Frame全体のbit数を計算する。
    //
    // Payload Lengthは6bit単位のVarintなので、payload bit長によって
    // Header長も変化する。PaddingはFrame CRC直前のbyte境界まで。
    let varint_bit_len = |value: usize| -> usize {
        let mut value = value as u64;
        let mut bits = 7;
        while value >= 64 {
            value >>= 6;
            bits += 7;
        }
        bits
    };

    let frame_bit_len = |total_qr_count: u32, frame_number: u32, payload_bit_len: usize| -> usize {
        let frame_bits = crate::frame::calculate_frame_bits(total_qr_count);

        let is_first = frame_number == 0;
        let is_final = frame_number == total_qr_count - 1;

        let header_bits = if is_first {
            // Start + Version + StoredTotalQRCount + FrameNumber + DataType
            1 + 4 + 16 + frame_bits + 2 + varint_bit_len(payload_bit_len)
        } else {
            // Start + FrameNumber
            1 + frame_bits + varint_bit_len(payload_bit_len)
        };

        let payload_end = header_bits + payload_bit_len;
        let padding_bits = (8 - (payload_end % 8)) % 8;

        header_bits
            + payload_bit_len
            + padding_bits
            + 16 // Frame CRC
            + if is_final { 32 } else { 0 } // Overall CRC
    };

    // 指定されたFrame全体のbit数に収まる最大Payload bit数を求める。
    //
    // Frame bit数はPayload bit数に対して単調非減少なので、
    // binary searchで正確に求められる。
    let max_payload_for_frame = |total_qr_count: u32, frame_number: u32| -> usize {
        let mut low = 0usize;
        let mut high = max_frame_bits;

        while low < high {
            let mid = low + (high - low + 1) / 2;

            if frame_bit_len(total_qr_count, frame_number, mid) <= max_frame_bits {
                low = mid;
            } else {
                high = mid - 1;
            }
        }

        low
    };

    // 2. Determine the minimum Total QR Count N.
    //
    // NによってFrameBitsが変化し、さらにFirst / Intermediate / Finalで
    // Frame構造が異なるため、Nを単純な二分探索にはしない。
    // 最大65536なので、候補を順番に確認すれば十分。
    let mut total_qr_count = None;

    for n in 1u32..=65536 {
        let first_capacity = max_payload_for_frame(n, 0);

        // N=1の場合、First FrameがそのままFinal Frame。
        if n == 1 {
            if first_capacity >= total_payload_bits {
                total_qr_count = Some(1);
                break;
            }
            continue;
        }

        let final_capacity = max_payload_for_frame(n, n - 1);

        // Intermediate FrameはFirst/Finalとは構造が異なる。
        let middle_capacity = if n > 2 {
            max_payload_for_frame(n, 1)
        } else {
            0
        };

        let total_capacity = first_capacity
            .saturating_add(final_capacity)
            .saturating_add(middle_capacity.saturating_mul((n - 2) as usize));

        if total_capacity >= total_payload_bits {
            total_qr_count = Some(n);
            break;
        }
    }

    let total_qr_count = total_qr_count.ok_or(EncoderError::ExceedsMaxFrames {
        total_qr_count: 65537,
    })?;

    // 3. Split payload bitstream into frame payload chunks.
    //
    // Frameごとの最大Payload容量は同じとは限らないため、
    // First → Intermediate → Finalの順に、そのFrameへ入る最大量を
    // 元のPayload bitstreamから順番に切り出す。
    let mut payload_reader =
        BitReader::new_with_bit_len(payload_writer.as_bytes(), total_payload_bits)?;

    let mut initial_frames = Vec::with_capacity(total_qr_count as usize);

    for frame_number in 0..total_qr_count {
        let frame_capacity = max_payload_for_frame(total_qr_count, frame_number);
        let remaining_bits = payload_reader.remaining_bits();
        let chunk_bits = std::cmp::min(frame_capacity, remaining_bits);

        let mut chunk_writer = BitWriter::with_capacity_bits(chunk_bits);
        for _ in 0..chunk_bits {
            let bit = payload_reader.read_bit()?;
            chunk_writer.write_bit(bit);
        }

        let payload_bytes = chunk_writer.into_bytes();
        let payload_bit_len = chunk_bits;

        if frame_number == 0 {
            initial_frames.push(Frame::First {
                version: CURRENT_VERSION,
                total_qr_count,
                frame_number: 0,
                data_type,
                payload_bytes,
                payload_bit_len,
                frame_crc: 0,
                overall_crc: None,
            });
        } else {
            initial_frames.push(Frame::NonFirst {
                total_qr_count,
                frame_number,
                payload_bytes,
                payload_bit_len,
                frame_crc: 0,
                overall_crc: None,
            });
        }
    }

    // 4. Compute Overall CRC across all frame payloads and assign to Final Frame
    let ov_crc = calculate_overall_crc(&initial_frames)?;
    let final_idx = (total_qr_count - 1) as usize;
    match &mut initial_frames[final_idx] {
        Frame::First { overall_crc, .. } => *overall_crc = Some(ov_crc),
        Frame::NonFirst { overall_crc, .. } => *overall_crc = Some(ov_crc),
    }

    // 5. Encode Frames to wire format and extract actual Frame CRCs
    let mut wire_bytes = Vec::with_capacity(total_qr_count as usize);
    let mut frames = Vec::with_capacity(total_qr_count as usize);

    // Frame 0
    let wire_0 = encode_frame(&initial_frames[0], None)?;
    let decoded_0 = decode_frame(&wire_0, None)?;
    let first_frame_crc = decoded_0.frame_crc();

    wire_bytes.push(wire_0);
    frames.push(decoded_0);

    // Frames 1..N-1
    for i in 1..(total_qr_count as usize) {
        let wire_i = encode_frame(&initial_frames[i], Some(first_frame_crc))?;
        let ctx = DecodeContext {
            total_qr_count: Some(total_qr_count),
            first_frame_crc: Some(first_frame_crc),
        };
        let decoded_i = decode_frame(&wire_i, Some(&ctx))?;

        wire_bytes.push(wire_i);
        frames.push(decoded_i);
    }

    Ok(EncodeOutput { frames, wire_bytes })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::frame::verify_overall_crc;

    #[test]
    fn test_zero_max_payload_bits_error() {
        let res = encode_data(InputData::Uint8Array(b"test"), 0);
        assert_eq!(res.unwrap_err(), EncoderError::ZeroMaxPayloadBits);
    }

    #[test]
    fn test_exceeds_max_frames_error() {
        // 65537 bytes = 524,296 bits. With max_payload_bits = 8, total_qr_count = 65537 > 65536
        let data = vec![0u8; 65537];
        let res = encode_data(InputData::Uint8Array(&data), 8);
        assert_eq!(
            res.unwrap_err(),
            EncoderError::ExceedsMaxFrames {
                total_qr_count: 65537
            }
        );
    }

    #[test]
    fn test_uint8array_empty() {
        let output = encode_data(InputData::Uint8Array(&[]), 100).unwrap();
        assert_eq!(output.frames.len(), 1);
        assert_eq!(output.wire_bytes.len(), 1);

        let frame = &output.frames[0];
        assert_eq!(frame.total_qr_count(), 1);
        assert_eq!(frame.frame_number(), 0);
        assert_eq!(frame.payload_bit_len(), 0);
        assert_eq!(frame.payload_bytes(), &[]);
        assert!(verify_overall_crc(&output.frames).unwrap());

        // Round-trip decode wire_bytes
        let decoded = decode_frame(&output.wire_bytes[0], None).unwrap();
        assert_eq!(decoded, *frame);
    }

    #[test]
    fn test_uint8array_single_byte() {
        let data = [0x80];
        let output = encode_data(InputData::Uint8Array(&data), 100).unwrap();
        assert_eq!(output.frames.len(), 1);

        let frame = &output.frames[0];
        assert_eq!(frame.payload_bit_len(), 8);
        assert_eq!(frame.payload_bytes(), &[0x80]);
        assert!(verify_overall_crc(&output.frames).unwrap());

        let decoded = decode_frame(&output.wire_bytes[0], None).unwrap();
        assert_eq!(decoded, *frame);
    }

    #[test]
    fn test_uint8array_multi_byte_and_bit_splitting() {
        let data = [0x12, 0x34, 0x56, 0x78]; // 32 bits
        // max_payload_bits = 10 -> N = ceil(32/10) = 4 frames
        // Frame 0: 10 bits -> 0x12, 0x34 (top 2 bits: 00) => 0b00010010_00xxxxxx (0x12, 0x34 top 2 bits: 00)
        // Frame 1: 10 bits
        // Frame 2: 10 bits
        // Frame 3: 2 bits
        let output = encode_data(InputData::Uint8Array(&data), 10).unwrap();
        assert_eq!(output.frames.len(), 4);

        assert_eq!(output.frames[0].payload_bit_len(), 10);
        assert_eq!(output.frames[1].payload_bit_len(), 10);
        assert_eq!(output.frames[2].payload_bit_len(), 10);
        assert_eq!(output.frames[3].payload_bit_len(), 2);

        assert!(verify_overall_crc(&output.frames).unwrap());

        // Decode round-trip
        let decoded_0 = decode_frame(&output.wire_bytes[0], None).unwrap();
        assert_eq!(decoded_0, output.frames[0]);
        let first_crc = decoded_0.frame_crc();

        for i in 1..4 {
            let ctx = DecodeContext {
                total_qr_count: Some(4),
                first_frame_crc: Some(first_crc),
            };
            let decoded_i = decode_frame(&output.wire_bytes[i], Some(&ctx)).unwrap();
            assert_eq!(decoded_i, output.frames[i]);
        }
    }

    #[test]
    fn test_string_empty() {
        let output = encode_data(InputData::String(""), 100).unwrap();
        assert_eq!(output.frames.len(), 1);

        let frame = &output.frames[0];
        assert_eq!(frame.payload_bit_len(), 1); // 1-bit ASCII mode bit (0)
        assert_eq!(frame.payload_bytes(), &[0x00]); // Top bit is 0, rest 0 padding in payload byte buffer
        assert!(verify_overall_crc(&output.frames).unwrap());

        // Check Mode bit = 0
        let mut reader = BitReader::new_with_bit_len(frame.payload_bytes(), 1).unwrap();
        assert_eq!(reader.read_bit().unwrap(), false);

        let decoded = decode_frame(&output.wire_bytes[0], None).unwrap();
        assert_eq!(decoded, *frame);
    }

    #[test]
    fn test_string_ascii_only() {
        // "ABC" -> Mode 0 (1b) + 'A' (7b: 1000001) + 'B' (7b: 1000010) + 'C' (7b: 1000011)
        // Total payload bit length = 1 + 21 = 22 bits
        let output = encode_data(InputData::String("ABC"), 100).unwrap();
        assert_eq!(output.frames.len(), 1);

        let frame = &output.frames[0];
        assert_eq!(frame.payload_bit_len(), 22);

        let mut reader =
            BitReader::new_with_bit_len(frame.payload_bytes(), frame.payload_bit_len()).unwrap();
        assert_eq!(reader.read_bit().unwrap(), false); // Mode = 0 (ASCII)
        assert_eq!(reader.read_bits(7).unwrap(), b'A' as u64);
        assert_eq!(reader.read_bits(7).unwrap(), b'B' as u64);
        assert_eq!(reader.read_bits(7).unwrap(), b'C' as u64);
        assert_eq!(reader.remaining_bits(), 0);

        assert!(verify_overall_crc(&output.frames).unwrap());
    }

    #[test]
    fn test_string_ascii_boundary_values() {
        // 0x00 and 0x7F
        let s = "\x00\x7F";
        let output = encode_data(InputData::String(s), 100).unwrap();
        assert_eq!(output.frames.len(), 1);

        let frame = &output.frames[0];
        assert_eq!(frame.payload_bit_len(), 1 + 14); // 15 bits

        let mut reader =
            BitReader::new_with_bit_len(frame.payload_bytes(), frame.payload_bit_len()).unwrap();
        assert_eq!(reader.read_bit().unwrap(), false); // Mode = 0
        assert_eq!(reader.read_bits(7).unwrap(), 0x00);
        assert_eq!(reader.read_bits(7).unwrap(), 0x7F);

        assert!(verify_overall_crc(&output.frames).unwrap());
    }

    #[test]
    fn test_string_utf8_japanese() {
        // "あ" = 0xE3, 0x81, 0x82 (3 bytes)
        // Non-ASCII detected -> Mode = 1 (UTF-8)
        // Total bits = 1 + (3 * 8) = 25 bits
        let s = "あ";
        let output = encode_data(InputData::String(s), 100).unwrap();
        assert_eq!(output.frames.len(), 1);

        let frame = &output.frames[0];
        assert_eq!(frame.payload_bit_len(), 25);

        let mut reader =
            BitReader::new_with_bit_len(frame.payload_bytes(), frame.payload_bit_len()).unwrap();
        assert_eq!(reader.read_bit().unwrap(), true); // Mode = 1 (UTF-8)
        assert_eq!(reader.read_bits(8).unwrap(), 0xE3);
        assert_eq!(reader.read_bits(8).unwrap(), 0x81);
        assert_eq!(reader.read_bits(8).unwrap(), 0x82);

        assert!(verify_overall_crc(&output.frames).unwrap());
    }

    #[test]
    fn test_string_mixed_ascii_and_non_ascii() {
        // "Aあ" -> 'A' is ASCII, 'あ' is non-ASCII -> UTF-8 Mode chosen
        // Bytes: 'A' (0x41), 'あ' (0xE3, 0x81, 0x82) -> 4 bytes total
        // Total bits = 1 + (4 * 8) = 33 bits
        let s = "Aあ";
        let output = encode_data(InputData::String(s), 100).unwrap();
        assert_eq!(output.frames.len(), 1);

        let frame = &output.frames[0];
        assert_eq!(frame.payload_bit_len(), 33);

        let mut reader =
            BitReader::new_with_bit_len(frame.payload_bytes(), frame.payload_bit_len()).unwrap();
        assert_eq!(reader.read_bit().unwrap(), true); // Mode = 1 (UTF-8)
        assert_eq!(reader.read_bits(8).unwrap(), 0x41);
        assert_eq!(reader.read_bits(8).unwrap(), 0xE3);
        assert_eq!(reader.read_bits(8).unwrap(), 0x81);
        assert_eq!(reader.read_bits(8).unwrap(), 0x82);

        assert!(verify_overall_crc(&output.frames).unwrap());
    }

    #[test]
    fn test_string_mode_bit_only_once_in_frame_0() {
        // "Hello World" -> 11 chars -> ASCII Mode: 1 + 11*7 = 78 bits
        // Split with max_payload_bits = 30 -> 3 frames: 30, 30, 18 bits
        let s = "Hello World";
        let output = encode_data(InputData::String(s), 30).unwrap();
        assert_eq!(output.frames.len(), 3);

        // Frame 0 payload starts with Mode bit (0)
        let mut r0 = BitReader::new_with_bit_len(
            output.frames[0].payload_bytes(),
            output.frames[0].payload_bit_len(),
        )
        .unwrap();
        assert_eq!(r0.read_bit().unwrap(), false); // Mode = 0

        // Frame 1 payload DOES NOT start with Mode bit, but continues string data bits
        // Frame 0 has Mode(1) + 29 bits of string data.
        // Frame 1 has next 30 bits of string data.
        assert_eq!(output.frames[1].payload_bit_len(), 30);
        assert_eq!(output.frames[2].payload_bit_len(), 18);

        // Reconstruct full bitstream from all frame payloads
        let concat_writer = crate::frame::concat_payload_bits(&output.frames).unwrap();
        assert_eq!(concat_writer.bit_len(), 78);

        let mut full_reader =
            BitReader::new_with_bit_len(concat_writer.as_bytes(), concat_writer.bit_len()).unwrap();
        assert_eq!(full_reader.read_bit().unwrap(), false); // Single mode bit at top
        for &b in s.as_bytes() {
            assert_eq!(full_reader.read_bits(7).unwrap(), b as u64);
        }
        assert_eq!(full_reader.remaining_bits(), 0);

        assert!(verify_overall_crc(&output.frames).unwrap());
    }

    #[test]
    fn test_frame_splitting_boundaries() {
        // Test exact boundary, boundary-1, boundary+1
        let data = [0xAA; 10]; // 80 bits

        // 1) Exact boundary: max_payload_bits = 40 -> 2 frames (40, 40)
        let out_exact = encode_data(InputData::Uint8Array(&data), 40).unwrap();
        assert_eq!(out_exact.frames.len(), 2);
        assert_eq!(out_exact.frames[0].payload_bit_len(), 40);
        assert_eq!(out_exact.frames[1].payload_bit_len(), 40);
        assert!(verify_overall_crc(&out_exact.frames).unwrap());

        // 2) Boundary-1: max_payload_bits = 39 -> 3 frames (39, 39, 2)
        let out_sub = encode_data(InputData::Uint8Array(&data), 39).unwrap();
        assert_eq!(out_sub.frames.len(), 3);
        assert_eq!(out_sub.frames[0].payload_bit_len(), 39);
        assert_eq!(out_sub.frames[1].payload_bit_len(), 39);
        assert_eq!(out_sub.frames[2].payload_bit_len(), 2);
        assert!(verify_overall_crc(&out_sub.frames).unwrap());

        // 3) Boundary+1: max_payload_bits = 41 -> 2 frames (41, 39)
        let out_plus = encode_data(InputData::Uint8Array(&data), 41).unwrap();
        assert_eq!(out_plus.frames.len(), 2);
        assert_eq!(out_plus.frames[0].payload_bit_len(), 41);
        assert_eq!(out_plus.frames[1].payload_bit_len(), 39);
        assert!(verify_overall_crc(&out_plus.frames).unwrap());
    }

    #[test]
    fn test_final_frame_ending_mid_byte() {
        // 16 bits total payload, split into 13 + 3 bits.
        let data = [0xFF, 0xF0];
        let output = encode_data(InputData::Uint8Array(&data), 13).unwrap();

        assert_eq!(output.frames.len(), 2);
        assert_eq!(output.frames[0].payload_bit_len(), 13);
        assert_eq!(output.frames[1].payload_bit_len(), 3);
        assert!(verify_overall_crc(&output.frames).unwrap());

        // Reconstruct the payload bitstream and verify that all 16 original bits
        // survive the non-byte-aligned split.
        let concat_writer = crate::frame::concat_payload_bits(&output.frames).unwrap();
        assert_eq!(concat_writer.bit_len(), 16);
        assert_eq!(concat_writer.as_bytes(), &data);
    }

    #[test]
    fn test_roundtrip_all_wire_bytes() {
        let text = "Hello QR Data Transport Protocol!";
        let output = encode_data(InputData::String(text), 50).unwrap();

        assert_eq!(output.frames.len(), output.wire_bytes.len());

        let decoded_0 = decode_frame(&output.wire_bytes[0], None).unwrap();
        assert_eq!(decoded_0, output.frames[0]);
        let first_crc = decoded_0.frame_crc();

        let mut decoded_frames = vec![decoded_0];

        for i in 1..output.frames.len() {
            let ctx = DecodeContext {
                total_qr_count: Some(output.frames.len() as u32),
                first_frame_crc: Some(first_crc),
            };
            let decoded_i = decode_frame(&output.wire_bytes[i], Some(&ctx)).unwrap();
            assert_eq!(decoded_i, output.frames[i]);
            decoded_frames.push(decoded_i);
        }

        assert!(verify_overall_crc(&decoded_frames).unwrap());
    }
}
