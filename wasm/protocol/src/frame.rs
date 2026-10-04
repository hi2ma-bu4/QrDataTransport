use crate::bit_stream::{BitReader, BitStreamError, BitWriter};
use crate::crc::crc16;
use crate::varint::{VarintError, read_varint, write_varint};
use thiserror::Error;

/// Data Type (2 bits) as specified in Spec Section 15
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum DataType {
    Uint8Array = 0b00,
    String = 0b01,
}

impl DataType {
    pub fn from_u8(value: u8) -> Result<Self, FrameError> {
        match value {
            0b00 => Ok(DataType::Uint8Array),
            0b01 => Ok(DataType::String),
            other => Err(FrameError::InvalidDataType(other)),
        }
    }
}

/// Errors that can occur during Frame encoding or decoding.
#[derive(Debug, Error, PartialEq, Eq)]
pub enum FrameError {
    #[error("BitStream error: {0}")]
    BitStream(#[from] BitStreamError),

    #[error("Varint error: {0}")]
    Varint(#[from] VarintError),

    #[error("Invalid Library Format Version: {0}")]
    InvalidVersion(u8),

    #[error("Invalid Data Type: {0}")]
    InvalidDataType(u8),

    #[error("Invalid Frame Number {frame_number} for Total QR Count {total_qr_count}")]
    InvalidFrameNumber {
        frame_number: u32,
        total_qr_count: u32,
    },

    #[error("Invalid Total QR Count: {0}")]
    InvalidTotalQrCount(u32),

    #[error("Non-zero padding bit detected")]
    InvalidPadding,

    #[error(
        "Frame CRC mismatch: wire CRC = {wire_crc:#06x}, calculated CRC = {calculated_crc:#06x}"
    )]
    FrameCrcMismatch { wire_crc: u16, calculated_crc: u16 },

    #[error("Missing DecodeContext for Non-First Frame decoding")]
    MissingContext,

    #[error("Missing Overall CRC for Final Frame encoding")]
    MissingOverallCrc,

    #[error(
        "Invalid Payload Length: specified bit len {specified} exceeds byte buffer bits {buffer_bits}"
    )]
    InvalidPayloadLength {
        specified: usize,
        buffer_bits: usize,
    },
}

/// Context passed when decoding a Non-First Frame.
#[derive(Debug, Clone, Copy, Default)]
pub struct DecodeContext {
    pub total_qr_count: Option<u32>,
    pub first_frame_crc: Option<u16>,
}

/// Representation of a parsed or constructed Frame.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Frame {
    First {
        version: u8,
        total_qr_count: u32,
        frame_number: u32,
        data_type: DataType,
        payload_bytes: Vec<u8>,
        payload_bit_len: usize,
        frame_crc: u16,
        overall_crc: Option<u32>,
    },
    NonFirst {
        total_qr_count: u32,
        frame_number: u32,
        payload_bytes: Vec<u8>,
        payload_bit_len: usize,
        frame_crc: u16,
        overall_crc: Option<u32>,
    },
}

impl Frame {
    pub fn total_qr_count(&self) -> u32 {
        match self {
            Frame::First { total_qr_count, .. } => *total_qr_count,
            Frame::NonFirst { total_qr_count, .. } => *total_qr_count,
        }
    }

    pub fn frame_number(&self) -> u32 {
        match self {
            Frame::First { frame_number, .. } => *frame_number,
            Frame::NonFirst { frame_number, .. } => *frame_number,
        }
    }

    pub fn frame_crc(&self) -> u16 {
        match self {
            Frame::First { frame_crc, .. } => *frame_crc,
            Frame::NonFirst { frame_crc, .. } => *frame_crc,
        }
    }

    pub fn overall_crc(&self) -> Option<u32> {
        match self {
            Frame::First { overall_crc, .. } => *overall_crc,
            Frame::NonFirst { overall_crc, .. } => *overall_crc,
        }
    }

    pub fn is_final(&self) -> bool {
        self.frame_number() == self.total_qr_count() - 1
    }

    pub fn payload_bytes(&self) -> &[u8] {
        match self {
            Frame::First { payload_bytes, .. } => payload_bytes,
            Frame::NonFirst { payload_bytes, .. } => payload_bytes,
        }
    }

    pub fn payload_bit_len(&self) -> usize {
        match self {
            Frame::First {
                payload_bit_len, ..
            } => *payload_bit_len,
            Frame::NonFirst {
                payload_bit_len, ..
            } => *payload_bit_len,
        }
    }
}

/// Calculates FrameBits from Total QR Count (N).
/// Spec Section 13 & 77: FrameBits = max(1, ceil(log2(N)))
pub fn calculate_frame_bits(total_qr_count: u32) -> usize {
    if total_qr_count <= 1 {
        1
    } else {
        32 - (total_qr_count - 1).leading_zeros() as usize
    }
}

/// Encodes a Frame into a bitstream byte vector.
///
/// For Non-First frames, `first_frame_crc` MUST be provided in `first_frame_crc_opt`.
pub fn encode_frame(
    frame: &Frame,
    first_frame_crc_opt: Option<u16>,
) -> Result<Vec<u8>, FrameError> {
    let total_qr_count = frame.total_qr_count();
    if total_qr_count < 1 || total_qr_count > 65536 {
        return Err(FrameError::InvalidTotalQrCount(total_qr_count));
    }

    let frame_bits = calculate_frame_bits(total_qr_count);
    let frame_number = frame.frame_number();

    if frame_number >= total_qr_count {
        return Err(FrameError::InvalidFrameNumber {
            frame_number,
            total_qr_count,
        });
    }

    let payload_bit_len = frame.payload_bit_len();
    let payload_bytes = frame.payload_bytes();
    if payload_bit_len > payload_bytes.len() * 8 {
        return Err(FrameError::InvalidPayloadLength {
            specified: payload_bit_len,
            buffer_bits: payload_bytes.len() * 8,
        });
    }

    let mut writer = BitWriter::new();

    match frame {
        Frame::First {
            version,
            data_type,
            overall_crc,
            ..
        } => {
            if *version == 0 {
                return Err(FrameError::InvalidVersion(0));
            }
            if frame_number != 0 {
                return Err(FrameError::InvalidFrameNumber {
                    frame_number,
                    total_qr_count,
                });
            }

            // 11. Start Bit = 1
            writer.write_bit(true);

            // 12. Library Format Version (4 bits)
            writer.write_bits(*version as u64, 4)?;

            // 13. StoredTotalQRCount (16 bits)
            let stored_total_qr_count = (total_qr_count - 1) as u16;
            writer.write_bits(stored_total_qr_count as u64, 16)?;

            // 14. Frame Number (FrameBits bits)
            writer.write_bits(frame_number as u64, frame_bits)?;

            // 15. Data Type (2 bits)
            writer.write_bits(*data_type as u64, 2)?;

            // 16. Payload Length (Varint)
            write_varint(&mut writer, payload_bit_len as u64)?;

            // 17. Payload
            writer.write_bytes(payload_bytes, payload_bit_len)?;

            // 18. Padding (0-bits to align to byte boundary)
            let rem = writer.bit_len() % 8;
            if rem > 0 {
                let padding_bits = 8 - rem;
                for _ in 0..padding_bits {
                    writer.write_bit(false);
                }
            }

            // 21. Frame CRC (16 bits) calculated over [Header][Payload][Padding]
            let calculated_crc = crc16(writer.as_bytes());
            writer.write_bits(calculated_crc as u64, 16)?;

            // 20 & 26. Overall Checksum if Final
            if frame.is_final() {
                let ov_crc = overall_crc.ok_or(FrameError::MissingOverallCrc)?;
                writer.write_bits(ov_crc as u64, 32)?;
            }
        }
        Frame::NonFirst { overall_crc, .. } => {
            if frame_number == 0 {
                return Err(FrameError::InvalidFrameNumber {
                    frame_number: 0,
                    total_qr_count,
                });
            }

            let first_crc = first_frame_crc_opt.ok_or(FrameError::MissingContext)?;

            // 11. Start Bit = 0
            writer.write_bit(false);

            // 14. Frame Number (FrameBits bits)
            writer.write_bits(frame_number as u64, frame_bits)?;

            // 16. Payload Length (Varint)
            write_varint(&mut writer, payload_bit_len as u64)?;

            // 17. Payload
            writer.write_bytes(payload_bytes, payload_bit_len)?;

            // 18. Padding (0-bits to align to byte boundary)
            let rem = writer.bit_len() % 8;
            if rem > 0 {
                let padding_bits = 8 - rem;
                for _ in 0..padding_bits {
                    writer.write_bit(false);
                }
            }

            // 23. Frame CRC for Non-First: [Current Frame Bytes] + [First Frame CRC 2 bytes]
            let mut crc_input = Vec::from(writer.as_bytes());
            crc_input.extend_from_slice(&first_crc.to_be_bytes());
            let calculated_crc = crc16(&crc_input);

            writer.write_bits(calculated_crc as u64, 16)?;

            // 20 & 26. Overall Checksum if Final
            if frame.is_final() {
                let ov_crc = overall_crc.ok_or(FrameError::MissingOverallCrc)?;
                writer.write_bits(ov_crc as u64, 32)?;
            }
        }
    }

    Ok(writer.into_bytes())
}

/// Decodes a Frame from a raw byte slice bitstream.
///
/// For Non-First frames (Start Bit = 0), `context` MUST provide `total_qr_count` and `first_frame_crc`.
pub fn decode_frame(data: &[u8], context: Option<&DecodeContext>) -> Result<Frame, FrameError> {
    let mut reader = BitReader::new(data);

    // 11. Start Bit
    let start_bit = reader.read_bit()?;

    if start_bit {
        // First QR
        // 12. Library Format Version (4 bits)
        let version = reader.read_bits(4)? as u8;
        if version == 0 {
            return Err(FrameError::InvalidVersion(0));
        }

        // 13. StoredTotalQRCount (16 bits)
        let stored_total_qr_count = reader.read_bits(16)? as u16;
        let total_qr_count = stored_total_qr_count as u32 + 1;

        // 14. Frame Number
        let frame_bits = calculate_frame_bits(total_qr_count);
        let frame_number = reader.read_bits(frame_bits)? as u32;

        if frame_number != 0 {
            return Err(FrameError::InvalidFrameNumber {
                frame_number,
                total_qr_count,
            });
        }

        // 15. Data Type (2 bits)
        let data_type_raw = reader.read_bits(2)? as u8;
        let data_type = DataType::from_u8(data_type_raw)?;

        // 16. Payload Length (Varint)
        let payload_bit_len = read_varint(&mut reader)? as usize;

        let is_final = frame_number == total_qr_count - 1;

        // Calculate required bit counts for payload, padding, frame CRC, and overall CRC
        let header_bit_len = reader.bit_pos();
        let rem = (header_bit_len + payload_bit_len) % 8;
        let padding_bits = if rem > 0 { 8 - rem } else { 0 };
        let frame_crc_bits = 16;
        let overall_crc_bits = if is_final { 32 } else { 0 };

        let total_required_bits =
            header_bit_len + payload_bit_len + padding_bits + frame_crc_bits + overall_crc_bits;

        if reader.bit_len() < total_required_bits {
            return Err(FrameError::BitStream(BitStreamError::UnexpectedEof {
                requested: total_required_bits - header_bit_len,
                remaining: reader.remaining_bits(),
            }));
        }

        // 17. Read Payload
        let mut payload_writer = BitWriter::with_capacity_bits(payload_bit_len);
        for _ in 0..payload_bit_len {
            let bit = reader.read_bit()?;
            payload_writer.write_bit(bit);
        }
        let payload_bytes = payload_writer.into_bytes();

        // 18. Read Padding and verify all 0
        for _ in 0..padding_bits {
            let p = reader.read_bit()?;
            if p {
                return Err(FrameError::InvalidPadding);
            }
        }

        let frame_data_byte_len = reader.bit_pos() / 8;

        // 20. Read Frame CRC (16 bits)
        let wire_crc = reader.read_bits(16)? as u16;

        // 26. Read Overall CRC if Final
        let overall_crc = if is_final {
            Some(reader.read_bits(32)? as u32)
        } else {
            None
        };

        // 21. Validate Frame CRC
        let calculated_crc = crc16(&data[..frame_data_byte_len]);
        if wire_crc != calculated_crc {
            return Err(FrameError::FrameCrcMismatch {
                wire_crc,
                calculated_crc,
            });
        }

        Ok(Frame::First {
            version,
            total_qr_count,
            frame_number,
            data_type,
            payload_bytes,
            payload_bit_len,
            frame_crc: wire_crc,
            overall_crc,
        })
    } else {
        // Non-First QR
        let ctx = context.ok_or(FrameError::MissingContext)?;
        let total_qr_count = ctx.total_qr_count.ok_or(FrameError::MissingContext)?;
        let first_frame_crc = ctx.first_frame_crc.ok_or(FrameError::MissingContext)?;

        if total_qr_count < 1 || total_qr_count > 65536 {
            return Err(FrameError::InvalidTotalQrCount(total_qr_count));
        }

        // 14. Frame Number
        let frame_bits = calculate_frame_bits(total_qr_count);
        let frame_number = reader.read_bits(frame_bits)? as u32;

        if frame_number == 0 || frame_number >= total_qr_count {
            return Err(FrameError::InvalidFrameNumber {
                frame_number,
                total_qr_count,
            });
        }

        // 16. Payload Length (Varint)
        let payload_bit_len = read_varint(&mut reader)? as usize;

        let is_final = frame_number == total_qr_count - 1;

        let header_bit_len = reader.bit_pos();
        let rem = (header_bit_len + payload_bit_len) % 8;
        let padding_bits = if rem > 0 { 8 - rem } else { 0 };
        let frame_crc_bits = 16;
        let overall_crc_bits = if is_final { 32 } else { 0 };

        let total_required_bits =
            header_bit_len + payload_bit_len + padding_bits + frame_crc_bits + overall_crc_bits;

        if reader.bit_len() < total_required_bits {
            return Err(FrameError::BitStream(BitStreamError::UnexpectedEof {
                requested: total_required_bits - header_bit_len,
                remaining: reader.remaining_bits(),
            }));
        }

        // 17. Read Payload
        let mut payload_writer = BitWriter::with_capacity_bits(payload_bit_len);
        for _ in 0..payload_bit_len {
            let bit = reader.read_bit()?;
            payload_writer.write_bit(bit);
        }
        let payload_bytes = payload_writer.into_bytes();

        // 18. Read Padding and verify all 0
        for _ in 0..padding_bits {
            let p = reader.read_bit()?;
            if p {
                return Err(FrameError::InvalidPadding);
            }
        }

        let frame_data_byte_len = reader.bit_pos() / 8;

        // 20. Read Frame CRC (16 bits)
        let wire_crc = reader.read_bits(16)? as u16;

        // 26. Read Overall CRC if Final
        let overall_crc = if is_final {
            Some(reader.read_bits(32)? as u32)
        } else {
            None
        };

        // 23. Validate Frame CRC for Non-First Frame
        let mut crc_input = Vec::from(&data[..frame_data_byte_len]);
        crc_input.extend_from_slice(&first_frame_crc.to_be_bytes());
        let calculated_crc = crc16(&crc_input);

        if wire_crc != calculated_crc {
            return Err(FrameError::FrameCrcMismatch {
                wire_crc,
                calculated_crc,
            });
        }

        Ok(Frame::NonFirst {
            total_qr_count,
            frame_number,
            payload_bytes,
            payload_bit_len,
            frame_crc: wire_crc,
            overall_crc,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_calculate_frame_bits() {
        assert_eq!(calculate_frame_bits(1), 1);
        assert_eq!(calculate_frame_bits(2), 1);
        assert_eq!(calculate_frame_bits(3), 2);
        assert_eq!(calculate_frame_bits(4), 2);
        assert_eq!(calculate_frame_bits(5), 3);
        assert_eq!(calculate_frame_bits(8), 3);
        assert_eq!(calculate_frame_bits(9), 4);
        assert_eq!(calculate_frame_bits(65536), 16);
    }

    #[test]
    fn test_total_qr_count_boundary_frames() {
        let counts = vec![1, 2, 3, 4, 5, 65536];

        for total_qr_count in counts {
            let expected_frame_bits = calculate_frame_bits(total_qr_count);
            let expected_stored = (total_qr_count - 1) as u16;

            // Test First frame (frame 0)
            let is_final_0 = total_qr_count == 1;
            let frame0 = Frame::First {
                version: 1,
                total_qr_count,
                frame_number: 0,
                data_type: DataType::Uint8Array,
                payload_bytes: vec![0x12],
                payload_bit_len: 8,
                frame_crc: 0,
                overall_crc: if is_final_0 { Some(0x11223344) } else { None },
            };

            let encoded0 = encode_frame(&frame0, None).unwrap();

            // Verify StoredTotalQRCount in wire stream
            let mut reader = BitReader::new(&encoded0);
            assert_eq!(reader.read_bit().unwrap(), true); // Start bit
            assert_eq!(reader.read_bits(4).unwrap(), 1); // Version
            assert_eq!(reader.read_bits(16).unwrap(), expected_stored as u64); // StoredTotalQRCount
            assert_eq!(reader.read_bits(expected_frame_bits).unwrap(), 0); // Frame Number 0

            let decoded0 = decode_frame(&encoded0, None).unwrap();
            assert_eq!(decoded0.total_qr_count(), total_qr_count);
            assert_eq!(decoded0.frame_number(), 0);
            let first_crc = decoded0.frame_crc();

            // Test Last frame (frame_number = total_qr_count - 1)
            let last_frame_num = total_qr_count - 1;
            if last_frame_num > 0 {
                let frame_last = Frame::NonFirst {
                    total_qr_count,
                    frame_number: last_frame_num,
                    payload_bytes: vec![0x34],
                    payload_bit_len: 8,
                    frame_crc: 0,
                    overall_crc: Some(0x99887766),
                };
                assert!(frame_last.is_final());

                let encoded_last = encode_frame(&frame_last, Some(first_crc)).unwrap();

                // Inspect Non-First wire format
                let mut reader_last = BitReader::new(&encoded_last);
                assert_eq!(reader_last.read_bit().unwrap(), false); // Start bit 0
                assert_eq!(
                    reader_last.read_bits(expected_frame_bits).unwrap(),
                    last_frame_num as u64
                );

                let ctx = DecodeContext {
                    total_qr_count: Some(total_qr_count),
                    first_frame_crc: Some(first_crc),
                };
                let decoded_last = decode_frame(&encoded_last, Some(&ctx)).unwrap();
                assert_eq!(decoded_last.frame_number(), last_frame_num);
                assert_eq!(decoded_last.overall_crc(), Some(0x99887766));
            }
        }
    }

    #[test]
    fn test_missing_overall_crc_error() {
        let frame = Frame::First {
            version: 1,
            total_qr_count: 1,
            frame_number: 0,
            data_type: DataType::Uint8Array,
            payload_bytes: vec![],
            payload_bit_len: 0,
            frame_crc: 0,
            overall_crc: None, // Missing overall CRC for final frame
        };

        assert_eq!(
            encode_frame(&frame, None).unwrap_err(),
            FrameError::MissingOverallCrc
        );
    }

    #[test]
    fn test_non_first_frame_crc_corruption_and_mismatch() {
        let total_qr_count = 2;
        let frame0 = Frame::First {
            version: 1,
            total_qr_count,
            frame_number: 0,
            data_type: DataType::Uint8Array,
            payload_bytes: vec![0xAA],
            payload_bit_len: 8,
            frame_crc: 0,
            overall_crc: None,
        };
        let encoded0 = encode_frame(&frame0, None).unwrap();
        let decoded0 = decode_frame(&encoded0, None).unwrap();
        let first_crc = decoded0.frame_crc();

        let frame1 = Frame::NonFirst {
            total_qr_count,
            frame_number: 1,
            payload_bytes: vec![0xBB],
            payload_bit_len: 8,
            frame_crc: 0,
            overall_crc: Some(0x12345678),
        };

        let mut encoded1 = encode_frame(&frame1, Some(first_crc)).unwrap();

        // 1) Test Corrupt byte containing frame CRC
        // Header (Start 1b + FrameNum 1b + Varint 7b) = 9b
        // Payload (8b) = 17b total
        // Padding (7b) = 24b = 3 bytes
        // Frame CRC is at bytes 3 and 4. Corrupt byte 3:
        encoded1[3] ^= 0xFF;

        let ctx = DecodeContext {
            total_qr_count: Some(total_qr_count),
            first_frame_crc: Some(first_crc),
        };
        let err1 = decode_frame(&encoded1, Some(&ctx)).unwrap_err();
        assert!(matches!(err1, FrameError::FrameCrcMismatch { .. }));

        // 2) Test Decoding with modified/wrong First QR CRC
        let re_encoded1 = encode_frame(&frame1, Some(first_crc)).unwrap();
        let wrong_ctx = DecodeContext {
            total_qr_count: Some(total_qr_count),
            first_frame_crc: Some(first_crc ^ 0xFFFF),
        };
        let err2 = decode_frame(&re_encoded1, Some(&wrong_ctx)).unwrap_err();
        assert!(matches!(err2, FrameError::FrameCrcMismatch { .. }));
    }

    #[test]
    fn test_13bit_unaligned_payload_explicit_validation() {
        // 13-bit Payload: 0b11010010_11011xxx
        // Top 8 bits: 0b11010010 (0xD2)
        // Next 5 bits: 0b11011
        // Lower 3 bits of byte 1 provided in source with noise 111 (0xD7)
        let source_payload = vec![0b11010010, 0b11011111];
        let bit_len = 13;

        let frame = Frame::First {
            version: 1,
            total_qr_count: 2,
            frame_number: 0,
            data_type: DataType::Uint8Array,
            payload_bytes: source_payload,
            payload_bit_len: bit_len,
            frame_crc: 0,
            overall_crc: None,
        };

        let encoded = encode_frame(&frame, None).unwrap();

        // Inspect bitstream padding & unused bits directly
        // Header bit length: Start(1) + Ver(4) + StoredCount(16) + FrameNum(1) + DataType(2) + Varint(7) = 31 bits
        // Payload bit length: 13 bits
        // Total before padding: 31 + 13 = 44 bits.
        // Remainder modulo 8: 44 % 8 = 4 bits.
        // Padding bits needed: 8 - 4 = 4 zero bits.
        // Total bits including padding = 48 bits (6 full bytes).
        // Check byte 5 (the last byte containing payload remainder + padding bits):
        // In byte 5: top 4 bits are payload remainder bits 0b1011, next 4 bits are 0 padding -> 0b10110000 (176 / 0xB0).
        assert_eq!(encoded[5], 0b10110000);

        let decoded = decode_frame(&encoded, None).unwrap();

        // Verify decoded properties
        assert_eq!(decoded.payload_bit_len(), 13);
        let decoded_payload = decoded.payload_bytes();
        assert_eq!(decoded_payload[0], 0b11010010);
        // Payload unused bits in decoded payload buffer should be 0
        assert_eq!(decoded_payload[1], 0b11011000);

        // Verify bit by bit reading
        let mut reader = BitReader::new_with_bit_len(decoded_payload, 13).unwrap();
        assert_eq!(reader.read_bits(8).unwrap(), 0b11010010);
        assert_eq!(reader.read_bits(5).unwrap(), 0b11011);
        assert_eq!(reader.remaining_bits(), 0);
    }

    #[test]
    fn test_reject_invalid_version_0() {
        let frame = Frame::First {
            version: 0,
            total_qr_count: 1,
            frame_number: 0,
            data_type: DataType::Uint8Array,
            payload_bytes: vec![],
            payload_bit_len: 0,
            frame_crc: 0,
            overall_crc: Some(0),
        };

        assert_eq!(
            encode_frame(&frame, None).unwrap_err(),
            FrameError::InvalidVersion(0)
        );
    }

    #[test]
    fn test_reject_invalid_padding() {
        let frame2 = Frame::First {
            version: 1,
            total_qr_count: 1,
            frame_number: 0,
            data_type: DataType::Uint8Array,
            payload_bytes: vec![0xC0],
            payload_bit_len: 2,
            frame_crc: 0,
            overall_crc: Some(0),
        };

        let mut encoded = encode_frame(&frame2, None).unwrap();
        // Set a padding bit to 1 in byte 4:
        encoded[4] |= 0x40; // set bit 6 of byte 4 to 1 (padding)

        let res = decode_frame(&encoded, None);
        assert_eq!(res.unwrap_err(), FrameError::InvalidPadding);
    }

    #[test]
    fn test_frame_crc_mismatch() {
        let frame = Frame::First {
            version: 1,
            total_qr_count: 1,
            frame_number: 0,
            data_type: DataType::Uint8Array,
            payload_bytes: vec![0x12, 0x34],
            payload_bit_len: 16,
            frame_crc: 0,
            overall_crc: Some(0),
        };

        let mut encoded = encode_frame(&frame, None).unwrap();
        // Corrupt byte 4 (which is fully payload bits, so padding remains valid)
        encoded[4] ^= 0xFF;

        let res = decode_frame(&encoded, None);
        assert!(matches!(
            res.unwrap_err(),
            FrameError::FrameCrcMismatch { .. }
        ));
    }

    #[test]
    fn test_out_of_range_frame_number() {
        let total_qr_count = 3;
        let frame = Frame::NonFirst {
            total_qr_count,
            frame_number: 3, // Out of range: 0, 1, 2 valid
            payload_bytes: vec![],
            payload_bit_len: 0,
            frame_crc: 0,
            overall_crc: None,
        };

        assert_eq!(
            encode_frame(&frame, Some(0x1234)).unwrap_err(),
            FrameError::InvalidFrameNumber {
                frame_number: 3,
                total_qr_count: 3,
            }
        );
    }

    #[test]
    fn test_missing_context_for_non_first() {
        let frame = Frame::NonFirst {
            total_qr_count: 2,
            frame_number: 1,
            payload_bytes: vec![],
            payload_bit_len: 0,
            frame_crc: 0,
            overall_crc: Some(0),
        };

        let encoded = encode_frame(&frame, Some(0x1234)).unwrap();
        let res = decode_frame(&encoded, None);
        assert_eq!(res.unwrap_err(), FrameError::MissingContext);
    }

    #[test]
    fn test_zero_payload_length() {
        let frame = Frame::First {
            version: 1,
            total_qr_count: 1,
            frame_number: 0,
            data_type: DataType::Uint8Array,
            payload_bytes: vec![],
            payload_bit_len: 0,
            frame_crc: 0,
            overall_crc: Some(0xDEADBEEF),
        };

        let encoded = encode_frame(&frame, None).unwrap();
        let decoded = decode_frame(&encoded, None).unwrap();

        assert_eq!(decoded.payload_bit_len(), 0);
        assert_eq!(decoded.payload_bytes(), &[]);
        assert_eq!(decoded.overall_crc(), Some(0xDEADBEEF));
    }

    #[test]
    fn test_trailing_bytes_in_stream_ignored() {
        let frame = Frame::First {
            version: 1,
            total_qr_count: 1,
            frame_number: 0,
            data_type: DataType::Uint8Array,
            payload_bytes: vec![0x12],
            payload_bit_len: 8,
            frame_crc: 0,
            overall_crc: Some(0x12345678),
        };

        let mut encoded = encode_frame(&frame, None).unwrap();
        // Append extra trailing garbage bytes
        encoded.extend_from_slice(&[0xFF, 0xEE, 0xDD]);

        let decoded = decode_frame(&encoded, None).unwrap();
        assert_eq!(decoded.payload_bytes(), &[0x12]);
        assert_eq!(decoded.overall_crc(), Some(0x12345678));
    }
}
