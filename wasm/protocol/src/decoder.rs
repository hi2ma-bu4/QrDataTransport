use crate::bit_stream::{BitReader, BitStreamError};
use crate::frame::{
    DataType, Frame, FrameError, ParityMode, concat_data_payload_bits, verify_overall_crc,
    xor_payloads,
};
use thiserror::Error;

/// Errors that can occur during decoding in the Data API receiver.
#[derive(Debug, Error, PartialEq, Eq)]
pub enum DecoderError {
    #[error("Overall CRC mismatch")]
    OverallCrcMismatch,

    #[error("Uint8Array payload bit length is not a multiple of 8: {0}")]
    NonByteAlignedUint8Array(usize),

    #[error("ASCII string payload bit length is not a multiple of 7: {0}")]
    InvalidAsciiBitLength(usize),

    #[error("UTF-8 string payload bit length is not a multiple of 8: {0}")]
    InvalidUtf8BitLength(usize),

    #[error("Invalid UTF-8 sequence: {0}")]
    InvalidUtf8(#[from] std::string::FromUtf8Error),

    #[error("First frame is missing in frame set")]
    MissingFirstFrame,

    #[error("Frame error: {0}")]
    Frame(#[from] FrameError),

    #[error("BitStream error: {0}")]
    BitStream(#[from] BitStreamError),
}

/// Decoded result returned by the Data API receiver after restoring payload.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DecodedData {
    Uint8Array(Vec<u8>),
    String(String),
}

/// Decodes a complete or parity-restored set of Frames into original Uint8Array or String data.
pub fn decode_data(frames: &[Frame]) -> Result<DecodedData, DecoderError> {
    let first_frame = frames
        .iter()
        .find(|f| matches!(f, Frame::First { .. }))
        .ok_or(DecoderError::MissingFirstFrame)?;

    let (parity_mode, data_type, total_qr_count) = match first_frame {
        Frame::First {
            parity_mode,
            data_type,
            total_qr_count,
            ..
        } => (*parity_mode, *data_type, *total_qr_count),
        _ => unreachable!(),
    };

    let mut frame_map: std::collections::HashMap<u32, Frame> = std::collections::HashMap::new();
    for f in frames {
        frame_map.insert(f.frame_number(), f.clone());
    }

    // 1. Parity Restoration if parity_mode != None
    if parity_mode != ParityMode::None && total_qr_count > 2 {
        let m = parity_mode.group_size() as u32; // 8, 16, 32
        let inter_and_parity_end = total_qr_count - 2;

        let mut current_fn = 1u32;
        while current_fn <= inter_and_parity_end {
            let max_data_in_group = m - 1;
            let remaining_slots = (inter_and_parity_end - current_fn) + 1;

            if remaining_slots <= 1 {
                break;
            }

            let group_data_slots = std::cmp::min(max_data_in_group, remaining_slots - 1);
            let has_parity =
                group_data_slots > 1 && (current_fn + group_data_slots <= inter_and_parity_end);

            let data_fns: Vec<u32> = (current_fn..(current_fn + group_data_slots)).collect();
            let parity_fn = current_fn + group_data_slots;

            let missing_data_fns: Vec<u32> = data_fns
                .iter()
                .copied()
                .filter(|fn_idx| !frame_map.contains_key(fn_idx))
                .collect();

            if missing_data_fns.len() == 1 {
                let parity_frame_opt = if has_parity {
                    frame_map.get(&parity_fn)
                } else {
                    None
                };

                if let Some(parity_frame) = parity_frame_opt {
                    let missing_fn = missing_data_fns[0];

                    let mut xor_inputs: Vec<(&[u8], usize)> = Vec::new();
                    xor_inputs.push((parity_frame.payload_bytes(), parity_frame.payload_bit_len()));

                    for &dfn in &data_fns {
                        if dfn != missing_fn {
                            if let Some(df) = frame_map.get(&dfn) {
                                xor_inputs.push((df.payload_bytes(), df.payload_bit_len()));
                            }
                        }
                    }

                    let (recovered_bytes, recovered_bit_len) = xor_payloads(&xor_inputs);

                    let recovered_frame = Frame::NonFirst {
                        total_qr_count,
                        frame_number: missing_fn,
                        is_parity: false,
                        payload_bytes: recovered_bytes,
                        payload_bit_len: recovered_bit_len,
                        frame_crc: 0,
                        overall_crc: None,
                    };

                    frame_map.insert(missing_fn, recovered_frame);
                }
            }

            current_fn += if has_parity {
                group_data_slots + 1
            } else {
                group_data_slots
            };
        }
    }

    let all_frames: Vec<Frame> = frame_map.into_values().collect();

    // 2. Verify Overall CRC
    let crc_valid = verify_overall_crc(&all_frames)?;
    if !crc_valid {
        return Err(DecoderError::OverallCrcMismatch);
    }

    // 3. Concatenate all DATA frame payloads in order
    let concat_writer = concat_data_payload_bits(&all_frames)?;
    let total_bits = concat_writer.bit_len();
    let payload_bytes = concat_writer.as_bytes();
    let mut reader = BitReader::new_with_bit_len(payload_bytes, total_bits)?;

    // 4. Decode according to DataType
    match data_type {
        DataType::Uint8Array => {
            if total_bits % 8 != 0 {
                return Err(DecoderError::NonByteAlignedUint8Array(total_bits));
            }
            let num_bytes = total_bits / 8;
            let mut bytes = Vec::with_capacity(num_bytes);
            for _ in 0..num_bytes {
                bytes.push(reader.read_bits(8)? as u8);
            }
            Ok(DecodedData::Uint8Array(bytes))
        }
        DataType::String => {
            let string_mode_bit = reader.read_bit()?;
            let remaining_bits = reader.remaining_bits();

            if !string_mode_bit {
                // Mode 0: ASCII Mode
                if remaining_bits % 7 != 0 {
                    return Err(DecoderError::InvalidAsciiBitLength(remaining_bits));
                }
                let num_chars = remaining_bits / 7;
                let mut ascii_bytes = Vec::with_capacity(num_chars);
                for _ in 0..num_chars {
                    let val = reader.read_bits(7)? as u8;
                    ascii_bytes.push(val);
                }
                let s = String::from_utf8(ascii_bytes)?;
                Ok(DecodedData::String(s))
            } else {
                // Mode 1: UTF-8 Mode
                if remaining_bits % 8 != 0 {
                    return Err(DecoderError::InvalidUtf8BitLength(remaining_bits));
                }
                let num_bytes = remaining_bits / 8;
                let mut utf8_bytes = Vec::with_capacity(num_bytes);
                for _ in 0..num_bytes {
                    utf8_bytes.push(reader.read_bits(8)? as u8);
                }
                let s = String::from_utf8(utf8_bytes)?;
                Ok(DecodedData::String(s))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::encoder::{InputData, encode_data};
    use crate::frame::calculate_overall_crc;

    #[test]
    fn test_uint8array_empty_payload() {
        let output = encode_data(InputData::Uint8Array(&[]), 100, ParityMode::None).unwrap();
        let decoded = decode_data(&output.frames).unwrap();
        assert_eq!(decoded, DecodedData::Uint8Array(vec![]));
    }

    #[test]
    fn test_uint8array_normal_byte_sequence() {
        let bytes = vec![0x12, 0x34, 0x56, 0x78, 0x9A, 0xBC, 0xDE, 0xF0];
        let output = encode_data(InputData::Uint8Array(&bytes), 100, ParityMode::None).unwrap();
        let decoded = decode_data(&output.frames).unwrap();
        assert_eq!(decoded, DecodedData::Uint8Array(bytes));
    }

    #[test]
    fn test_uint8array_split_across_multiple_frames_non_byte_boundary() {
        let bytes = vec![0xAB, 0xCD, 0xEF, 0x01];
        let output = encode_data(InputData::Uint8Array(&bytes), 64, ParityMode::None).unwrap();
        assert!(output.frames.len() > 1);

        let decoded = decode_data(&output.frames).unwrap();
        assert_eq!(decoded, DecodedData::Uint8Array(bytes));
    }

    #[test]
    fn test_parity_recovery_single_missing_data_frame() {
        let data = vec![0x42; 80];
        let output = encode_data(InputData::Uint8Array(&data), 120, ParityMode::Group8).unwrap();

        let missing_frames: Vec<Frame> = output
            .frames
            .iter()
            .cloned()
            .filter(|f| f.frame_number() != 2)
            .collect();

        let decoded = decode_data(&missing_frames).unwrap();
        assert_eq!(decoded, DecodedData::Uint8Array(data));
    }

    #[test]
    fn test_ascii_empty_string() {
        let output = encode_data(InputData::String(""), 100, ParityMode::None).unwrap();
        let decoded = decode_data(&output.frames).unwrap();
        assert_eq!(decoded, DecodedData::String("".to_string()));
    }

    #[test]
    fn test_ascii_string() {
        let s = "Hello, World!";
        let output = encode_data(InputData::String(s), 100, ParityMode::None).unwrap();
        let decoded = decode_data(&output.frames).unwrap();
        assert_eq!(decoded, DecodedData::String(s.to_string()));
    }

    #[test]
    fn test_ascii_boundary_values() {
        let s = "\x00\x7F";
        let output = encode_data(InputData::String(s), 100, ParityMode::None).unwrap();
        let decoded = decode_data(&output.frames).unwrap();
        assert_eq!(decoded, DecodedData::String(s.to_string()));
    }

    #[test]
    fn test_utf8_japanese() {
        let s = "日本語のテストデータです。";
        let output = encode_data(InputData::String(s), 100, ParityMode::None).unwrap();
        let decoded = decode_data(&output.frames).unwrap();
        assert_eq!(decoded, DecodedData::String(s.to_string()));
    }

    #[test]
    fn test_utf8_mixed_ascii_and_non_ascii() {
        let s = "Hello世界123！";
        let output = encode_data(InputData::String(s), 100, ParityMode::None).unwrap();
        let decoded = decode_data(&output.frames).unwrap();
        assert_eq!(decoded, DecodedData::String(s.to_string()));
    }

    #[test]
    fn test_string_mode_bit_only_once_in_frame_0_multi_frame() {
        let s = "Protocol Core Receiver Decoder Test";
        let output = encode_data(InputData::String(s), 80, ParityMode::None).unwrap();

        assert!(output.frames.len() > 1);

        let mut frame0_reader = BitReader::new_with_bit_len(
            output.frames[0].payload_bytes(),
            output.frames[0].payload_bit_len(),
        )
        .unwrap();
        assert_eq!(frame0_reader.read_bit().unwrap(), false);

        let decoded = decode_data(&output.frames).unwrap();
        assert_eq!(decoded, DecodedData::String(s.to_string()));
    }

    #[test]
    fn test_uint8array_bit_length_mismatch_error() {
        let mut frames = vec![Frame::First {
            version: 1,
            total_qr_count: 1,
            frame_number: 0,
            parity_mode: ParityMode::None,
            data_type: DataType::Uint8Array,
            payload_bytes: vec![0b11010000],
            payload_bit_len: 5,
            frame_crc: 0,
            overall_crc: None,
        }];
        let ov_crc = calculate_overall_crc(&frames).unwrap();
        if let Frame::First { overall_crc, .. } = &mut frames[0] {
            *overall_crc = Some(ov_crc);
        }

        let err = decode_data(&frames).unwrap_err();
        assert_eq!(err, DecoderError::NonByteAlignedUint8Array(5));
    }

    #[test]
    fn test_ascii_bit_length_mismatch_error() {
        let mut frames = vec![Frame::First {
            version: 1,
            total_qr_count: 1,
            frame_number: 0,
            parity_mode: ParityMode::None,
            data_type: DataType::String,
            payload_bytes: vec![0b01010101, 0b01000000],
            payload_bit_len: 11,
            frame_crc: 0,
            overall_crc: None,
        }];
        let ov_crc = calculate_overall_crc(&frames).unwrap();
        if let Frame::First { overall_crc, .. } = &mut frames[0] {
            *overall_crc = Some(ov_crc);
        }

        let err = decode_data(&frames).unwrap_err();
        assert_eq!(err, DecoderError::InvalidAsciiBitLength(10));
    }

    #[test]
    fn test_utf8_bit_length_mismatch_error() {
        let mut frames = vec![Frame::First {
            version: 1,
            total_qr_count: 1,
            frame_number: 0,
            parity_mode: ParityMode::None,
            data_type: DataType::String,
            payload_bytes: vec![0b11010101],
            payload_bit_len: 8,
            frame_crc: 0,
            overall_crc: None,
        }];
        let ov_crc = calculate_overall_crc(&frames).unwrap();
        if let Frame::First { overall_crc, .. } = &mut frames[0] {
            *overall_crc = Some(ov_crc);
        }

        let err = decode_data(&frames).unwrap_err();
        assert_eq!(err, DecoderError::InvalidUtf8BitLength(7));
    }

    #[test]
    fn test_invalid_utf8_error() {
        let mut frames = vec![Frame::First {
            version: 1,
            total_qr_count: 1,
            frame_number: 0,
            parity_mode: ParityMode::None,
            data_type: DataType::String,
            payload_bytes: vec![0b11111111, 0b10000000],
            payload_bit_len: 9,
            frame_crc: 0,
            overall_crc: None,
        }];
        let ov_crc = calculate_overall_crc(&frames).unwrap();
        if let Frame::First { overall_crc, .. } = &mut frames[0] {
            *overall_crc = Some(ov_crc);
        }

        let err = decode_data(&frames).unwrap_err();
        assert!(matches!(err, DecoderError::InvalidUtf8(_)));
    }

    #[test]
    fn test_overall_crc_mismatch_rejection() {
        let output = encode_data(
            InputData::String("Testing CRC mismatch"),
            100,
            ParityMode::None,
        )
        .unwrap();
        let mut corrupted_frames = output.frames.clone();

        if let Some(final_frame) = corrupted_frames.last_mut() {
            match final_frame {
                Frame::First { overall_crc, .. } => {
                    *overall_crc = Some(overall_crc.unwrap() ^ 0xFFFFFFFF);
                }
                Frame::NonFirst { overall_crc, .. } => {
                    *overall_crc = Some(overall_crc.unwrap() ^ 0xFFFFFFFF);
                }
            }
        }

        let err = decode_data(&corrupted_frames).unwrap_err();
        assert_eq!(err, DecoderError::OverallCrcMismatch);
    }

    #[test]
    fn test_encode_data_to_decode_data_roundtrip() {
        let test_cases = vec![
            InputData::Uint8Array(b""),
            InputData::Uint8Array(b"Binary Data Roundtrip"),
            InputData::String(""),
            InputData::String("ASCII String Roundtrip"),
            InputData::String("UTF-8 日本語 Roundtrip 🚀"),
        ];

        for input in test_cases {
            let output = encode_data(input, 100, ParityMode::None).unwrap();
            let decoded = decode_data(&output.frames).unwrap();

            match (input, decoded) {
                (InputData::Uint8Array(expected), DecodedData::Uint8Array(actual)) => {
                    assert_eq!(expected, actual.as_slice());
                }
                (InputData::String(expected), DecodedData::String(actual)) => {
                    assert_eq!(expected, actual.as_str());
                }
                _ => panic!("Decoded data type mismatch"),
            }
        }
    }
}
