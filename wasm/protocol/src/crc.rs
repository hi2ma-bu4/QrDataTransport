use crc::{Algorithm, CRC_32_ISO_HDLC, Crc};

/// CRC-16/CCITT-FALSE アルゴリズム定義
pub const CRC_16_CCITT_FALSE: Algorithm<u16> = Algorithm {
    width: 16,
    poly: 0x1021,
    init: 0xFFFF,
    refin: false,
    refout: false,
    xorout: 0x0000,
    check: 0x29B1,
    residue: 0x0000,
};

/// CRC16計算インスタンス
pub const CRC16: Crc<u16> = Crc::<u16>::new(&CRC_16_CCITT_FALSE);

/// CRC32計算インスタンス
pub const CRC32: Crc<u32> = Crc::<u32>::new(&CRC_32_ISO_HDLC);

/// ビット列からCRC計算用バイト配列を生成
///
/// 仕様書 Section 25 に従い、bit_len が8の倍数でない場合、最後のバイトの余剰ビットを0でパディング（マスク）します。
///
/// # Arguments
/// * `bytes` - ソースバイトスライス
/// * `bit_len` - ビット長
///
/// # Returns
/// * CRC計算用のパディング済みバイトベクター
pub fn bitstream_to_crc_bytes(bytes: &[u8], bit_len: usize) -> Vec<u8> {
    if bit_len == 0 {
        return Vec::new();
    }
    let full_bytes = bit_len / 8;
    let rem_bits = bit_len % 8;

    let total_bytes = full_bytes + if rem_bits > 0 { 1 } else { 0 };
    let mut result = Vec::with_capacity(total_bytes);

    if full_bytes > 0 {
        let max_full = full_bytes.min(bytes.len());
        result.extend_from_slice(&bytes[..max_full]);
    }

    if rem_bits > 0 && full_bytes < bytes.len() {
        let mask = !((1u8 << (8 - rem_bits)) - 1);
        let last_byte = bytes[full_bytes] & mask;
        result.push(last_byte);
    }

    result
}

/// ビット列に対するCRC16 checksumを算出
///
/// # Arguments
/// * `data` - データバイトスライス
/// * `bit_len` - 対象のビット長
///
/// # Returns
/// * 16ビットCRC値
pub fn crc16_bits(data: &[u8], bit_len: usize) -> u16 {
    let crc_bytes = bitstream_to_crc_bytes(data, bit_len);
    CRC16.checksum(&crc_bytes)
}

/// 完全なバイト列に対するCRC16 checksumを算出
///
/// # Arguments
/// * `data` - データバイトスライス
///
/// # Returns
/// * 16ビットCRC値
pub fn crc16(data: &[u8]) -> u16 {
    CRC16.checksum(data)
}

/// ビット列に対するCRC32 checksumを算出
///
/// 入力が0ビットの場合は 0x00000000 を返します。
///
/// # Arguments
/// * `data` - データバイトスライス
/// * `bit_len` - 対象のビット長
///
/// # Returns
/// * 32ビットCRC値
pub fn crc32_bits(data: &[u8], bit_len: usize) -> u32 {
    let crc_bytes = bitstream_to_crc_bytes(data, bit_len);
    CRC32.checksum(&crc_bytes)
}

/// 完全なバイト列に対するCRC32 checksumを算出
///
/// # Arguments
/// * `data` - データバイトスライス
///
/// # Returns
/// * 32ビットCRC値
pub fn crc32(data: &[u8]) -> u32 {
    CRC32.checksum(data)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_crc16_check_value() {
        let data = b"123456789";
        let val = crc16(data);
        assert_eq!(val, 0x29B1);
    }

    #[test]
    fn test_crc32_check_value() {
        let data = b"123456789";
        let val = crc32(data);
        assert_eq!(val, 0xCBF43926);
    }

    #[test]
    fn test_crc32_empty_input() {
        let val = crc32_bits(&[], 0);
        assert_eq!(val, 0x00000000);
    }

    #[test]
    fn test_crc_non_byte_aligned_bits() {
        let raw_bytes = [0b11001100, 0b10101111];
        let crc_bytes = bitstream_to_crc_bytes(&raw_bytes, 13);
        assert_eq!(crc_bytes.len(), 2);
        assert_eq!(crc_bytes[0], 0b11001100);
        assert_eq!(crc_bytes[1], 0b10101000);

        let c16 = crc16_bits(&raw_bytes, 13);
        let expected16 = crc16(&crc_bytes);
        assert_eq!(c16, expected16);

        let c32 = crc32_bits(&raw_bytes, 13);
        let expected32 = crc32(&crc_bytes);
        assert_eq!(c32, expected32);
    }
}
