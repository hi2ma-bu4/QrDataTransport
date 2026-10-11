use thiserror::Error;

use crate::bit_stream::{BitReader, BitStreamError, BitWriter};

/// 可変長整数 (Varint) エラー列挙型
#[derive(Debug, Error, PartialEq, Eq)]
pub enum VarintError {
    /// ビットストリームエラー
    #[error("Bit stream error: {0}")]
    BitStream(#[from] BitStreamError),

    /// 冗長エンコードエラー
    #[error("Redundant varint encoding for value {value} using {groups} groups")]
    RedundantEncoding {
        /// エンコード値
        value: u64,
        /// グループ数
        groups: usize,
    },

    /// 値のオーバーフローエラー
    #[error("Varint value overflow: exceeds 64-bit integer range")]
    ValueOverflow,
}

/// 可変長整数を書き込み
///
/// 7ビット可変長エンコーディング構造 (1継続ビット + 6データビット) をビットストリームに書き込みます。
///
/// # Arguments
/// * `writer` - 出力先のBitWriter
/// * `value` - 書き込む64ビット無符号整数
///
/// # Returns
/// * 成功時は `Ok(())`
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

/// 可変長整数を読み込み
///
/// ビットストリームから可変長整数を読み込み復元します。冗長エンコーディングやオーバーフローを判定します。
///
/// # Arguments
/// * `reader` - 読み込み元のBitReader
///
/// # Returns
/// * 復元された64ビット無符号整数
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

        // 第11グループで63ビットを超えるビットが設定されている場合のオーバーフロー検証
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

        // 仕様書 Section 10.4:
        // [1][000000] [0][100000]
        let mut reader = BitReader::new_with_bit_len(writer.as_bytes(), 14).unwrap();
        // 第1グループ読み込み
        assert_eq!(reader.read_bit().unwrap(), true); // Continuation = 1
        assert_eq!(reader.read_bits(6).unwrap(), 0b000000); // Data 6-bit LSB-first = 0

        // 第2グループ読み込み
        assert_eq!(reader.read_bit().unwrap(), false); // Continuation = 0
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
        let mut writer = BitWriter::new();
        for _ in 0..10 {
            writer.write_bit(true);
            writer.write_bits(0, 6).unwrap();
        }
        writer.write_bit(false);
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
        let mut writer = BitWriter::new();
        writer.write_bit(true);
        writer.write_bits(0, 3).unwrap();

        let mut reader = BitReader::new_with_bit_len(writer.as_bytes(), 4).unwrap();
        let result = read_varint(&mut reader);
        assert!(matches!(
            result,
            Err(VarintError::BitStream(BitStreamError::UnexpectedEof { .. }))
        ));
    }
}
