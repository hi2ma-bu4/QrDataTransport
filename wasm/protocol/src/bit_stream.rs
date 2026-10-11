use thiserror::Error;

/// ビットストリーム操作エラー列挙型
#[derive(Debug, Error, PartialEq, Eq)]
pub enum BitStreamError {
    /// データ読み込み時のUnexpectedEofエラー
    #[error("Attempted to read {requested} bits, but only {remaining} bits remain")]
    UnexpectedEof {
        /// 要求ビット数
        requested: usize,
        /// 残りビット数
        remaining: usize,
    },

    /// サポート範囲外のビット数指定エラー
    #[error("Bit count {0} exceeds maximum supported bit count (64)")]
    InvalidBitCount(usize),

    /// 値のオーバーフローエラー
    #[error("Value {value} exceeds maximum value for {num_bits} bits")]
    ValueOverflow {
        /// 設定値
        value: u64,
        /// ビット幅
        num_bits: usize,
    },

    /// 範囲外オフセット指定エラー
    #[error("Bit offset {offset} is out of bounds for data of bit length {bit_len}")]
    OutOfBounds {
        /// オフセット
        offset: usize,
        /// ビット長
        bit_len: usize,
    },
}

/// ビット単位書き込み用ライター構造体
#[derive(Debug, Clone, Default)]
pub struct BitWriter {
    /// 内部バッファ配列
    bytes: Vec<u8>,
    /// 書き込み済みビット長
    bit_len: usize,
}

impl BitWriter {
    /// BitWriterインスタンスを生成
    ///
    /// # Returns
    /// * 空のBitWriterインスタンス
    pub fn new() -> Self {
        Self {
            bytes: Vec::new(),
            bit_len: 0,
        }
    }

    /// 容量指定でBitWriterインスタンスを生成
    ///
    /// # Arguments
    /// * `capacity_bits` - 確保するビット容量
    ///
    /// # Returns
    /// * BitWriterインスタンス
    pub fn with_capacity_bits(capacity_bits: usize) -> Self {
        let capacity_bytes = (capacity_bits + 7) / 8;
        Self {
            bytes: Vec::with_capacity(capacity_bytes),
            bit_len: 0,
        }
    }

    /// 書き込み済みビット長を取得
    ///
    /// # Returns
    /// * 現在のビット長
    pub fn bit_len(&self) -> usize {
        self.bit_len
    }

    /// バイトスライスを取得
    ///
    /// # Returns
    /// * 内部バッファの参照
    pub fn as_bytes(&self) -> &[u8] {
        &self.bytes
    }

    /// 内部バッファの所有権を取得
    ///
    /// # Returns
    /// * 内部バッファのVec<u8>
    pub fn into_bytes(self) -> Vec<u8> {
        self.bytes
    }

    /// 1ビット書き込み
    ///
    /// # Arguments
    /// * `bit` - 書き込む真偽値
    pub fn write_bit(&mut self, bit: bool) {
        let byte_idx = self.bit_len / 8;
        let bit_offset = 7 - (self.bit_len % 8);

        if byte_idx >= self.bytes.len() {
            self.bytes.push(0);
        }

        if bit {
            self.bytes[byte_idx] |= 1 << bit_offset;
        } else {
            self.bytes[byte_idx] &= !(1 << bit_offset);
        }

        self.bit_len += 1;
    }

    /// 複数ビット書き込み
    ///
    /// # Arguments
    /// * `value` - 書き込む値
    /// * `num_bits` - ビット数 (1 ~ 64)
    ///
    /// # Returns
    /// * 成功時は `Ok(())`
    pub fn write_bits(&mut self, value: u64, num_bits: usize) -> Result<(), BitStreamError> {
        if num_bits > 64 {
            return Err(BitStreamError::InvalidBitCount(num_bits));
        }
        if num_bits < 64 && (value >> num_bits) != 0 {
            return Err(BitStreamError::ValueOverflow { value, num_bits });
        }

        for i in (0..num_bits).rev() {
            let bit = ((value >> i) & 1) != 0;
            self.write_bit(bit);
        }

        Ok(())
    }

    /// バイト配列の指定ビット数を書き込み
    ///
    /// # Arguments
    /// * `bytes` - ソースバイトスライス
    /// * `num_bits` - 書き込むビット数
    ///
    /// # Returns
    /// * 成功時は `Ok(())`
    pub fn write_bytes(&mut self, bytes: &[u8], num_bits: usize) -> Result<(), BitStreamError> {
        if num_bits > bytes.len() * 8 {
            return Err(BitStreamError::UnexpectedEof {
                requested: num_bits,
                remaining: bytes.len() * 8,
            });
        }

        let full_bytes = num_bits / 8;
        let rem_bits = num_bits % 8;

        for &b in &bytes[..full_bytes] {
            self.write_bits(b as u64, 8)?;
        }

        if rem_bits > 0 {
            let last_byte = bytes[full_bytes];
            let shift = 8 - rem_bits;
            let val = (last_byte >> shift) as u64;
            self.write_bits(val, rem_bits)?;
        }

        Ok(())
    }
}

/// ビット単位読み込み用リーダー構造体
#[derive(Debug, Clone, Copy)]
pub struct BitReader<'a> {
    /// ソースバイトデータスライス
    data: &'a [u8],
    /// 対象ビット長
    bit_len: usize,
    /// 現在の読み込みビット位置
    bit_pos: usize,
}

impl<'a> BitReader<'a> {
    /// BitReaderインスタンスを生成
    ///
    /// # Arguments
    /// * `data` - 読み込み元バイトデータスライス
    ///
    /// # Returns
    /// * BitReaderインスタンス
    pub fn new(data: &'a [u8]) -> Self {
        Self {
            data,
            bit_len: data.len() * 8,
            bit_pos: 0,
        }
    }

    /// ビット長指定でBitReaderインスタンスを生成
    ///
    /// # Arguments
    /// * `data` - 読み込み元バイトデータスライス
    /// * `bit_len` - 対象ビット長
    ///
    /// # Returns
    /// * BitReaderインスタンス
    pub fn new_with_bit_len(data: &'a [u8], bit_len: usize) -> Result<Self, BitStreamError> {
        if bit_len > data.len() * 8 {
            return Err(BitStreamError::OutOfBounds {
                offset: bit_len,
                bit_len: data.len() * 8,
            });
        }
        Ok(Self {
            data,
            bit_len,
            bit_pos: 0,
        })
    }

    /// 全体ビット長を取得
    ///
    /// # Returns
    /// * 全体ビット長
    pub fn bit_len(&self) -> usize {
        self.bit_len
    }

    /// 現在のビット位置を取得
    ///
    /// # Returns
    /// * ビット位置
    pub fn bit_pos(&self) -> usize {
        self.bit_pos
    }

    /// 未読み込みの残りビット数を取得
    ///
    /// # Returns
    /// * 残りビット数
    pub fn remaining_bits(&self) -> usize {
        self.bit_len.saturating_sub(self.bit_pos)
    }

    /// 1ビット読み込み
    ///
    /// # Returns
    /// * 読み込んだ真偽値
    pub fn read_bit(&mut self) -> Result<bool, BitStreamError> {
        if self.bit_pos >= self.bit_len {
            return Err(BitStreamError::UnexpectedEof {
                requested: 1,
                remaining: 0,
            });
        }

        let byte_idx = self.bit_pos / 8;
        let bit_offset = 7 - (self.bit_pos % 8);
        let bit = ((self.data[byte_idx] >> bit_offset) & 1) != 0;

        self.bit_pos += 1;
        Ok(bit)
    }

    /// 複数ビット読み込み
    ///
    /// # Arguments
    /// * `num_bits` - 読み込み対象ビット数 (1 ~ 64)
    ///
    /// # Returns
    /// * 読み込まれたu64値
    pub fn read_bits(&mut self, num_bits: usize) -> Result<u64, BitStreamError> {
        if num_bits > 64 {
            return Err(BitStreamError::InvalidBitCount(num_bits));
        }
        if self.remaining_bits() < num_bits {
            return Err(BitStreamError::UnexpectedEof {
                requested: num_bits,
                remaining: self.remaining_bits(),
            });
        }

        let mut val = 0u64;
        for _ in 0..num_bits {
            let bit = self.read_bit()?;
            val = (val << 1) | (bit as u64);
        }

        Ok(val)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_msb_first_byte_format() {
        let mut writer = BitWriter::new();
        writer.write_bits(0x96, 8).unwrap();
        assert_eq!(writer.as_bytes(), &[0x96]);

        let mut reader = BitReader::new(writer.as_bytes());
        assert_eq!(reader.read_bits(1).unwrap(), 1);
        assert_eq!(reader.read_bits(1).unwrap(), 0);
        assert_eq!(reader.read_bits(1).unwrap(), 0);
        assert_eq!(reader.read_bits(1).unwrap(), 1);
        assert_eq!(reader.read_bits(1).unwrap(), 0);
        assert_eq!(reader.read_bits(1).unwrap(), 1);
        assert_eq!(reader.read_bits(1).unwrap(), 1);
        assert_eq!(reader.read_bits(1).unwrap(), 0);
    }

    #[test]
    fn test_unaligned_field_boundaries_4_3_8() {
        let mut writer = BitWriter::new();
        writer.write_bits(10, 4).unwrap();
        writer.write_bits(5, 3).unwrap();
        writer.write_bits(204, 8).unwrap();

        assert_eq!(writer.bit_len(), 15);
        assert_eq!(writer.as_bytes(), &[0xAB, 0x98]);

        let mut reader = BitReader::new_with_bit_len(writer.as_bytes(), 15).unwrap();
        assert_eq!(reader.read_bits(4).unwrap(), 10);
        assert_eq!(reader.read_bits(3).unwrap(), 5);
        assert_eq!(reader.read_bits(8).unwrap(), 204);
        assert_eq!(reader.remaining_bits(), 0);
    }

    #[test]
    fn test_zero_bit_read_and_write() {
        let mut writer = BitWriter::new();
        writer.write_bits(0, 0).unwrap();
        assert_eq!(writer.bit_len(), 0);

        let err = writer.write_bits(5, 0).unwrap_err();
        assert_eq!(
            err,
            BitStreamError::ValueOverflow {
                value: 5,
                num_bits: 0
            }
        );

        let data = [0xFF];
        let mut reader = BitReader::new(&data);
        assert_eq!(reader.read_bits(0).unwrap(), 0);
        assert_eq!(reader.bit_pos(), 0);
    }

    #[test]
    fn test_64_bit_handling() {
        let mut writer = BitWriter::new();
        writer.write_bits(u64::MAX, 64).unwrap();
        assert_eq!(writer.bit_len(), 64);
        assert_eq!(writer.as_bytes(), &[0xFF; 8]);

        let mut reader = BitReader::new(writer.as_bytes());
        assert_eq!(reader.read_bits(64).unwrap(), u64::MAX);

        let mut writer2 = BitWriter::new();
        let val_bit63 = 1u64 << 63;
        writer2.write_bits(val_bit63, 64).unwrap();
        assert_eq!(
            writer2.as_bytes(),
            &[0x80, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]
        );

        let mut reader2 = BitReader::new(writer2.as_bytes());
        assert_eq!(reader2.read_bits(64).unwrap(), val_bit63);
    }

    #[test]
    fn test_exceed_64_bits_error() {
        let mut writer = BitWriter::new();
        let err = writer.write_bits(1, 65).unwrap_err();
        assert_eq!(err, BitStreamError::InvalidBitCount(65));

        let data = [0xFF; 9];
        let mut reader = BitReader::new(&data);
        let err_r = reader.read_bits(65).unwrap_err();
        assert_eq!(err_r, BitStreamError::InvalidBitCount(65));
    }

    #[test]
    fn test_value_overflow_error() {
        let mut writer = BitWriter::new();
        let err = writer.write_bits(16, 4).unwrap_err();
        assert_eq!(
            err,
            BitStreamError::ValueOverflow {
                value: 16,
                num_bits: 4
            }
        );
    }

    #[test]
    fn test_write_bytes_partial() {
        let mut writer = BitWriter::new();
        let source = [0b11010000, 0b10101111];
        writer.write_bytes(&source, 12).unwrap();
        assert_eq!(writer.bit_len(), 12);

        let mut reader = BitReader::new_with_bit_len(writer.as_bytes(), 12).unwrap();
        assert_eq!(reader.read_bits(8).unwrap(), 0b11010000);
        assert_eq!(reader.read_bits(4).unwrap(), 0b1010);
    }

    #[test]
    fn test_read_out_of_bounds_error() {
        let data = [0xAA];
        let mut reader = BitReader::new(&data);
        assert_eq!(reader.read_bits(4).unwrap(), 10);
        let err = reader.read_bits(8).unwrap_err();
        assert_eq!(
            err,
            BitStreamError::UnexpectedEof {
                requested: 8,
                remaining: 4
            }
        );
    }

    #[test]
    fn test_roundtrip() {
        let mut writer = BitWriter::new();
        writer.write_bits(0xF, 4).unwrap();
        writer.write_bits(0x0, 1).unwrap();
        writer.write_bits(0b101, 3).unwrap();
        writer.write_bits(0x123456789ABC, 48).unwrap();

        let mut reader = BitReader::new_with_bit_len(writer.as_bytes(), writer.bit_len()).unwrap();
        assert_eq!(reader.read_bits(4).unwrap(), 0xF);
        assert_eq!(reader.read_bits(1).unwrap(), 0);
        assert_eq!(reader.read_bits(3).unwrap(), 0b101);
        assert_eq!(reader.read_bits(48).unwrap(), 0x123456789ABC);
        assert_eq!(reader.remaining_bits(), 0);
    }
}
