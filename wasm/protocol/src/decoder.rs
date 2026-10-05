use crate::bit_stream::{BitReader, BitStreamError};
use crate::frame::{DataType, Frame, FrameError, concat_payload_bits, verify_overall_crc};
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

/// Decodes a complete set of Frames into original Uint8Array or String data.
///
/// 1. Verifies overall CRC using `verify_overall_crc`.
/// 2. Concatenates payload bitstream across all frames in order using `concat_payload_bits`.
/// 3. Inspects `DataType` from `Frame::First`.
/// 4. Decodes payload according to data type and string mode bit.
pub fn decode_data(frames: &[Frame]) -> Result<DecodedData, DecoderError> {
    // 1. Verify Overall CRC
    let crc_valid = verify_overall_crc(frames)?;
    if !crc_valid {
        return Err(DecoderError::OverallCrcMismatch);
    }

    // 2. Identify DataType from First Frame
    let first_frame = frames
        .iter()
        .find(|f| matches!(f, Frame::First { .. }))
        .ok_or(DecoderError::MissingFirstFrame)?;

    let data_type = match first_frame {
        Frame::First { data_type, .. } => *data_type,
        _ => unreachable!(),
    };

    // 3. Concatenate all frame payloads into total bitstream
    let concat_writer = concat_payload_bits(frames)?;
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
        let output = encode_data(InputData::Uint8Array(&[]), 100).unwrap();
        let decoded = decode_data(&output.frames).unwrap();
        assert_eq!(decoded, DecodedData::Uint8Array(vec![]));
    }

    #[test]
    fn test_uint8array_normal_byte_sequence() {
        let bytes = vec![0x12, 0x34, 0x56, 0x78, 0x9A, 0xBC, 0xDE, 0xF0];
        let output = encode_data(InputData::Uint8Array(&bytes), 100).unwrap();
        let decoded = decode_data(&output.frames).unwrap();
        assert_eq!(decoded, DecodedData::Uint8Array(bytes));
    }

    #[test]
    fn test_uint8array_split_across_multiple_frames_non_byte_boundary() {
        let bytes = vec![0xAB, 0xCD, 0xEF, 0x01]; // 32 bits
        // Split with max_payload_bits = 9 -> N = ceil(32/9) = 4 frames (9, 9, 9, 5 bits)
        let output = encode_data(InputData::Uint8Array(&bytes), 9).unwrap();
        assert_eq!(output.frames.len(), 4);

        let decoded = decode_data(&output.frames).unwrap();
        assert_eq!(decoded, DecodedData::Uint8Array(bytes));
    }

    #[test]
    fn test_ascii_empty_string() {
        let output = encode_data(InputData::String(""), 100).unwrap();
        let decoded = decode_data(&output.frames).unwrap();
        assert_eq!(decoded, DecodedData::String("".to_string()));
    }

    #[test]
    fn test_ascii_string() {
        let s = "Hello, World!";
        let output = encode_data(InputData::String(s), 100).unwrap();
        let decoded = decode_data(&output.frames).unwrap();
        assert_eq!(decoded, DecodedData::String(s.to_string()));
    }

    #[test]
    fn test_ascii_boundary_values() {
        let s = "\x00\x7F";
        let output = encode_data(InputData::String(s), 100).unwrap();
        let decoded = decode_data(&output.frames).unwrap();
        assert_eq!(decoded, DecodedData::String(s.to_string()));
    }

    #[test]
    fn test_utf8_japanese() {
        let s = "日本語のテストデータです。";
        let output = encode_data(InputData::String(s), 100).unwrap();
        let decoded = decode_data(&output.frames).unwrap();
        assert_eq!(decoded, DecodedData::String(s.to_string()));
    }

    #[test]
    fn test_utf8_mixed_ascii_and_non_ascii() {
        let s = "Hello世界123！";
        let output = encode_data(InputData::String(s), 100).unwrap();
        let decoded = decode_data(&output.frames).unwrap();
        assert_eq!(decoded, DecodedData::String(s.to_string()));
    }

    #[test]
    fn test_string_mode_bit_only_once_in_frame_0_multi_frame() {
        // ASCII string: Mode = 0 + 7 bits per character.
        // max_payload_bits = 20 forces the payload to span multiple frames.
        let s = "Protocol Core Receiver Decoder Test";
        let output = encode_data(InputData::String(s), 20).unwrap();

        assert!(output.frames.len() > 1);

        // Frame 0 must begin with the single String Mode bit.
        let mut frame0_reader = BitReader::new_with_bit_len(
            output.frames[0].payload_bytes(),
            output.frames[0].payload_bit_len(),
        )
        .unwrap();
        assert_eq!(frame0_reader.read_bit().unwrap(), false);

        // Frame 0 contains the mode bit plus the first part of the string data.
        assert_eq!(output.frames[0].payload_bit_len(), 20);

        // Frame 1 must continue the string bitstream directly.
        // Its first bit is string data, not another String Mode bit.
        let mut frame1_reader = BitReader::new_with_bit_len(
            output.frames[1].payload_bytes(),
            output.frames[1].payload_bit_len(),
        )
        .unwrap();

        let concat_writer = crate::frame::concat_payload_bits(&output.frames).unwrap();

        // The reconstructed payload must contain exactly one Mode bit
        // followed by the 7-bit ASCII data for every character.
        assert_eq!(concat_writer.bit_len(), 1 + s.len() * 7);

        let mut full_reader =
            BitReader::new_with_bit_len(concat_writer.as_bytes(), concat_writer.bit_len()).unwrap();

        // The only String Mode bit is the first bit of the complete Payload.
        assert_eq!(full_reader.read_bit().unwrap(), false);

        // The remaining bits must decode directly into the original ASCII data.
        for &byte in s.as_bytes() {
            assert_eq!(full_reader.read_bits(7).unwrap(), byte as u64);
        }

        assert_eq!(full_reader.remaining_bits(), 0);

        // The second frame's first bit must correspond to the continued
        // string data rather than a second Mode bit.
        //
        // "P" = 0b1010000. After the first frame consumes
        // the Mode bit + 19 data bits, frame 1 starts in the middle
        // of the third ASCII character.
        let mut expected_reader =
            BitReader::new_with_bit_len(concat_writer.as_bytes(), concat_writer.bit_len()).unwrap();

        expected_reader.read_bit().unwrap();
        for _ in 0..19 {
            expected_reader.read_bit().unwrap();
        }

        assert_eq!(
            frame1_reader.read_bit().unwrap(),
            expected_reader.read_bit().unwrap()
        );

        // Finally verify that the Decoder correctly reconstructs the String.
        let decoded = decode_data(&output.frames).unwrap();
        assert_eq!(decoded, DecodedData::String(s.to_string()));
    }

    #[test]
    fn test_uint8array_bit_length_mismatch_error() {
        // Create manual frame set with 5-bit payload for Uint8Array
        let mut frames = vec![Frame::First {
            version: 1,
            total_qr_count: 1,
            frame_number: 0,
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
        // Mode 0 (1 bit) + 10 bits remaining data (10 % 7 != 0) -> Total 11 bits
        let mut frames = vec![Frame::First {
            version: 1,
            total_qr_count: 1,
            frame_number: 0,
            data_type: DataType::String,
            payload_bytes: vec![0b01010101, 0b01000000], // top bit 0 (ASCII) + 10 bits data
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
        // Mode 1 (1 bit) + 7 bits remaining data (7 % 8 != 0) -> Total 8 bits
        let mut frames = vec![Frame::First {
            version: 1,
            total_qr_count: 1,
            frame_number: 0,
            data_type: DataType::String,
            payload_bytes: vec![0b11010101], // top bit 1 (UTF-8) + 7 bits data
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
        // Mode 1 (1 bit) + invalid UTF-8 byte 0xFF (8 bits) -> Total 9 bits
        let mut frames = vec![Frame::First {
            version: 1,
            total_qr_count: 1,
            frame_number: 0,
            data_type: DataType::String,
            payload_bytes: vec![0b11111111, 0b10000000], // Mode bit 1 + 0xFF = 1 11111111
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
        let output = encode_data(InputData::String("Testing CRC mismatch"), 100).unwrap();
        let mut corrupted_frames = output.frames.clone();

        // Corrupt overall_crc in final frame
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
            let output = encode_data(input, 30).unwrap();
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
