use thiserror::Error;

use crate::bit_stream::{BitReader, BitStreamError, BitWriter};

#[derive(Debug, Error, PartialEq, Eq)]
pub enum VarintError {
    #[error("Bit stream error: {0}")]
    BitStream(#[from] BitStreamError),

    #[error("Redundant varint encoding for value {value} using {groups} groups")]
    RedundantEncoding { value: u64, groups: usize },

    #[error("Varint value overflow: exceeds 64-bit integer range")]
    ValueOverflow,
}

pub fn write_varint(writer: &mut BitWriter, value: u64) -> Result<(), VarintError> {
    let mut num_groups = 1;
    let mut temp = value;
    while temp >= 64 {
        num_groups += 1;
        temp >>= 6;
    }

    for g in 0..num_groups {
        let is_not_last = g < num_groups - 1;
        writer.write_bit(is_not_last);

        let chunk = ((value >> (6 * g)) & 0x3F) as u8;
        for i in 0..6 {
            let bit = ((chunk >> i) & 1) != 0;
            writer.write_bit(bit);
        }
    }

    Ok(())
}

pub fn read_varint(reader: &mut BitReader) -> Result<u64, VarintError> {
    let mut val = 0u64;
    let mut g = 0usize;

    loop {
        if g >= 11 {
            return Err(VarintError::ValueOverflow);
        }

        let continuation = reader.read_bit()?;

        let mut chunk = 0u64;
        for i in 0..6 {
            let bit = reader.read_bit()?;
            if bit {
                chunk |= 1u64 << i;
            }
        }

        // Check for 64-bit overflow if 11th group adds bits beyond bit 63
        if g == 10 && chunk > 0x0F {
            return Err(VarintError::ValueOverflow);
        }

        let added = chunk
            .checked_shl((6 * g) as u32)
            .ok_or(VarintError::ValueOverflow)?;
        val = val.checked_add(added).ok_or(VarintError::ValueOverflow)?;

        if !continuation {
            if g > 0 && val < (1u64 << (6 * g)) {
                return Err(VarintError::RedundantEncoding {
                    value: val,
                    groups: g + 1,
                });
            }
            return Ok(val);
        }

        g += 1;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_varint_zero() {
        let mut writer = BitWriter::new();
        write_varint(&mut writer, 0).unwrap();
        assert_eq!(writer.bit_len(), 7);

        let mut reader = BitReader::new_with_bit_len(writer.as_bytes(), 7).unwrap();
        let val = read_varint(&mut reader).unwrap();
        assert_eq!(val, 0);
        assert_eq!(reader.remaining_bits(), 0);
    }

    #[test]
    fn test_varint_64_exact_bitpattern() {
        let mut writer = BitWriter::new();
        write_varint(&mut writer, 64).unwrap();
        assert_eq!(writer.bit_len(), 14);

        // Spec Section 10.4:
        // [1][000000] [0][100000]
        let mut reader = BitReader::new_with_bit_len(writer.as_bytes(), 14).unwrap();
        // Read 1st group
        assert_eq!(reader.read_bit().unwrap(), true); // Continuation = 1
        assert_eq!(reader.read_bits(6).unwrap(), 0b000000); // Data 6-bit LSB-first = 0

        // Read 2nd group
        assert_eq!(reader.read_bit().unwrap(), false); // Continuation = 0
        // 64's second chunk is 0b000001. In LSB-first order on bitstream: bit 0 (1), bit 1 (0), bit 2 (0), bit 3 (0), bit 4 (0), bit 5 (0) -> 0b100000
        assert_eq!(reader.read_bits(6).unwrap(), 0b100000);

        let mut reader2 = BitReader::new_with_bit_len(writer.as_bytes(), 14).unwrap();
        let val = read_varint(&mut reader2).unwrap();
        assert_eq!(val, 64);
    }

    #[test]
    fn test_varint_boundary_values() {
        let values = vec![0, 1, 63, 64, 65, 127, 128, 4095, 4096, u64::MAX];

        for &val in &values {
            let mut writer = BitWriter::new();
            write_varint(&mut writer, val).unwrap();

            let mut reader =
                BitReader::new_with_bit_len(writer.as_bytes(), writer.bit_len()).unwrap();
            let decoded = read_varint(&mut reader).unwrap();
            assert_eq!(decoded, val);
            assert_eq!(reader.remaining_bits(), 0);
        }
    }

    #[test]
    fn test_reject_redundant_varint() {
        // Construct redundant encoding for 0 using 2 groups:
        let mut writer = BitWriter::new();
        writer.write_bit(true); // continuation = 1
        writer.write_bits(0, 6).unwrap(); // data = 0
        writer.write_bit(false); // continuation = 0
        writer.write_bits(0, 6).unwrap(); // data = 0

        let mut reader = BitReader::new_with_bit_len(writer.as_bytes(), 14).unwrap();
        let result = read_varint(&mut reader);
        assert_eq!(
            result,
            Err(VarintError::RedundantEncoding {
                value: 0,
                groups: 2
            })
        );
    }

    #[test]
    fn test_reject_redundant_varint_63() {
        // Construct redundant encoding for 63 using 2 groups:
        let mut writer = BitWriter::new();
        writer.write_bit(true); // continuation = 1
        writer.write_bits(0x3F, 6).unwrap(); // data = 63
        writer.write_bit(false); // continuation = 0
        writer.write_bits(0, 6).unwrap(); // data = 0

        let mut reader = BitReader::new_with_bit_len(writer.as_bytes(), 14).unwrap();
        let result = read_varint(&mut reader);
        assert_eq!(
            result,
            Err(VarintError::RedundantEncoding {
                value: 63,
                groups: 2
            })
        );
    }

    #[test]
    fn test_11th_group_overflow() {
        // Construct 11 groups where 11th group has chunk = 16 (0b010000, 5 bits set), which exceeds 64-bit uint range
        let mut writer = BitWriter::new();
        for _ in 0..10 {
            writer.write_bit(true);
            writer.write_bits(0, 6).unwrap();
        }
        writer.write_bit(false);
        // LSB-first bits for chunk = 16 (0b010000 -> bit 4 = 1) -> written as 0, 0, 0, 0, 1, 0
        writer.write_bits(0b000010, 6).unwrap();

        let mut reader = BitReader::new_with_bit_len(writer.as_bytes(), writer.bit_len()).unwrap();
        let result = read_varint(&mut reader);
        assert_eq!(result, Err(VarintError::ValueOverflow));
    }

    #[test]
    fn test_continuation_beyond_11_groups() {
        let mut writer = BitWriter::new();
        for _ in 0..11 {
            writer.write_bit(true); // continuation = 1
            writer.write_bits(0, 6).unwrap();
        }
        writer.write_bit(false);
        writer.write_bits(0, 6).unwrap();

        let mut reader = BitReader::new_with_bit_len(writer.as_bytes(), writer.bit_len()).unwrap();
        let result = read_varint(&mut reader);
        assert_eq!(result, Err(VarintError::ValueOverflow));
    }

    #[test]
    fn test_varint_truncated_stream_eof() {
        // Stream truncated in middle of group
        let mut writer = BitWriter::new();
        writer.write_bit(true);
        writer.write_bits(0, 3).unwrap(); // only 3 bits of 6-bit data

        let mut reader = BitReader::new_with_bit_len(writer.as_bytes(), 4).unwrap();
        let result = read_varint(&mut reader);
        assert!(matches!(
            result,
            Err(VarintError::BitStream(BitStreamError::UnexpectedEof { .. }))
        ));
    }
}
