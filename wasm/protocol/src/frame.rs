use crate::bit_stream::{BitReader, BitStreamError, BitWriter};
use crate::crc::crc16;
use crate::varint::{VarintError, read_varint, write_varint};
use thiserror::Error;

/// パリティモード列挙型 (3ビット)
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum ParityMode {
    /// なし
    None = 0,
    /// グループ 8
    Group8 = 8,
    /// グループ 16
    Group16 = 16,
    /// グループ 32
    Group32 = 32,
}

impl ParityMode {
    /// u8値からParityModeを生成
    ///
    /// # Arguments
    /// * `value` - 対象のu8値
    ///
    /// # Returns
    /// * 成功時は `Ok(ParityMode)`
    pub fn from_u8(value: u8) -> Result<Self, FrameError> {
        match value {
            0 => Ok(ParityMode::None),
            1 | 8 => Ok(ParityMode::Group8),
            2 | 16 => Ok(ParityMode::Group16),
            3 | 32 => Ok(ParityMode::Group32),
            other => Err(FrameError::InvalidParityMode(other)),
        }
    }

    /// ワイヤービット表現に変換
    ///
    /// # Returns
    /// * 3ビットのワイヤー値
    pub fn to_wire_bits(self) -> u8 {
        match self {
            ParityMode::None => 0b000,
            ParityMode::Group8 => 0b001,
            ParityMode::Group16 => 0b010,
            ParityMode::Group32 => 0b011,
        }
    }

    /// グループサイズを取得
    ///
    /// # Returns
    /// * グループサイズ数値
    pub fn group_size(self) -> usize {
        match self {
            ParityMode::None => 0,
            ParityMode::Group8 => 8,
            ParityMode::Group16 => 16,
            ParityMode::Group32 => 32,
        }
    }
}

/// データ型列挙型 (2ビット)
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum DataType {
    /// バイト配列
    Uint8Array = 0b00,
    /// 文字列
    String = 0b01,
}

impl DataType {
    /// u8値からDataTypeを生成
    ///
    /// # Arguments
    /// * `value` - 対象のu8値
    ///
    /// # Returns
    /// * 成功時は `Ok(DataType)`
    pub fn from_u8(value: u8) -> Result<Self, FrameError> {
        match value {
            0b00 => Ok(DataType::Uint8Array),
            0b01 => Ok(DataType::String),
            other => Err(FrameError::InvalidDataType(other)),
        }
    }
}

/// フレーム処理エラー列挙型
#[derive(Debug, Error, PartialEq, Eq)]
pub enum FrameError {
    /// ビットストリームエラー
    #[error("BitStream error: {0}")]
    BitStream(#[from] BitStreamError),

    /// Varintエラー
    #[error("Varint error: {0}")]
    Varint(#[from] VarintError),

    /// 無効なライブラリフォーマットバージョン
    #[error("Invalid Library Format Version: {0}")]
    InvalidVersion(u8),

    /// 無効なパリティモード
    #[error("Invalid Parity Mode: {0:#05b}")]
    InvalidParityMode(u8),

    /// 無効なデータ型
    #[error("Invalid Data Type: {0}")]
    InvalidDataType(u8),

    /// 無効なフレーム番号
    #[error("Invalid Frame Number {frame_number} for Total QR Count {total_qr_count}")]
    InvalidFrameNumber {
        /// フレーム番号
        frame_number: u32,
        /// 総QR数
        total_qr_count: u32,
    },

    /// 無効な総QR数
    #[error("Invalid Total QR Count: {0}")]
    InvalidTotalQrCount(u32),

    /// 0でないパディングビットを検出
    #[error("Non-zero padding bit detected")]
    InvalidPadding,

    /// フレームCRCの不一致
    #[error(
        "Frame CRC mismatch: wire CRC = {wire_crc:#06x}, calculated CRC = {calculated_crc:#06x}"
    )]
    FrameCrcMismatch {
        /// ワイヤーCRC
        wire_crc: u16,
        /// 計算CRC
        calculated_crc: u16,
    },

    /// DecodeContext不足エラー
    #[error("Missing DecodeContext for Non-First Frame decoding")]
    MissingContext,

    /// 全体CRC不足エラー
    #[error("Missing Overall CRC for Final Frame encoding")]
    MissingOverallCrc,

    /// 無効なペイロード長
    #[error(
        "Invalid Payload Length: specified bit len {specified} exceeds byte buffer bits {buffer_bits}"
    )]
    InvalidPayloadLength {
        /// 指定ビット長
        specified: usize,
        /// バッファビット長
        buffer_bits: usize,
    },

    /// 空のフレーム集合エラー
    #[error("Frame set is empty")]
    EmptyFrames,

    /// 不完全なフレーム集合エラー
    #[error("Incomplete frame set: expected {expected} frames, got {actual}")]
    IncompleteFrameSet {
        /// 期待フレーム数
        expected: u32,
        /// 実際フレーム数
        actual: usize,
    },

    /// 重複フレーム番号エラー
    #[error("Duplicate frame number {0}")]
    DuplicateFrameNumber(u32),

    /// 不足フレーム番号エラー
    #[error("Missing frame number {0}")]
    MissingFrameNumber(u32),

    /// 総QR数の不一致エラー
    #[error("Mismatched Total QR Count in frame set: expected {expected}, got {actual}")]
    MismatchedTotalQrCount {
        /// 期待総QR数
        expected: u32,
        /// 実際総QR数
        actual: u32,
    },
}

/// Non-First Frameデコード用コンテキスト構造体
#[derive(Debug, Clone, Copy, Default)]
pub struct DecodeContext {
    /// 既知の総QR数
    pub total_qr_count: Option<u32>,
    /// 既知のFirstフレームCRC
    pub first_frame_crc: Option<u16>,
    /// 既知のパリティモード
    pub parity_mode: Option<ParityMode>,
}

/// フレームヘッダーメタデータ構造体
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FrameMetadata {
    /// スタートビット
    pub start_bit: bool,
    /// First QRフラグ
    pub is_first: bool,
    /// パリティフレームフラグ
    pub is_parity: bool,
    /// ライブラリフォーマットバージョン
    pub version: Option<u8>,
    /// 総QR数
    pub total_qr_count: Option<u32>,
    /// フレーム番号
    pub frame_number: u32,
    /// パリティモード
    pub parity_mode: Option<ParityMode>,
    /// データ型
    pub data_type: Option<DataType>,
    /// ペイロードビット長
    pub payload_bit_len: usize,
    /// ヘッダービット長
    pub header_bit_len: usize,
}

impl FrameMetadata {
    /// 最終フレームかどうかを判定
    ///
    /// # Returns
    /// * 最終フレームの場合はtrue
    pub fn is_final(&self) -> bool {
        if let Some(total) = self.total_qr_count {
            self.frame_number == total.saturating_sub(1)
        } else {
            false
        }
    }
}

/// 対象フレーム番号がパリティフレームかどうかを判定
///
/// # Arguments
/// * `frame_number` - フレーム番号
/// * `total_qr_count` - 総QR数
/// * `parity_mode` - パリティモード
///
/// # Returns
/// * パリティフレームの場合はtrue
pub fn is_parity_frame_number(
    frame_number: u32,
    total_qr_count: u32,
    parity_mode: ParityMode,
) -> bool {
    if parity_mode == ParityMode::None || frame_number == 0 || frame_number >= total_qr_count - 1 {
        return false;
    }

    let m = parity_mode.group_size() as u32;
    let g = (frame_number - 1) / m + 1;
    let s_g = (g - 1) * m + 1;

    let total_inter_and_parity = total_qr_count.saturating_sub(2);
    let end_index = total_inter_and_parity;

    if s_g + m - 1 <= end_index {
        let p_g = g * m;
        frame_number == p_g
    } else {
        let k = (total_qr_count - 1) - s_g;
        if k > 1 {
            frame_number == end_index
        } else {
            false
        }
    }
}

/// 生ビットストリームからヘッダーメタデータを解析
///
/// # Arguments
/// * `data` - バイトスライス
/// * `known_total_qr_count` - 既知の総QR数
/// * `known_parity_mode` - 既知のパリティモード
///
/// # Returns
/// * 解析されたFrameMetadata
pub fn parse_frame_metadata(
    data: &[u8],
    known_total_qr_count: Option<u32>,
    known_parity_mode: Option<ParityMode>,
) -> Result<FrameMetadata, FrameError> {
    let mut reader = BitReader::new(data);

    let start_bit = reader.read_bit()?;

    if start_bit {
        let version = reader.read_bits(4)? as u8;
        if version == 0 {
            return Err(FrameError::InvalidVersion(0));
        }

        let stored_total_qr_count = reader.read_bits(16)? as u16;
        let total_qr_count = stored_total_qr_count as u32 + 1;

        let frame_bits = calculate_frame_bits(total_qr_count);
        let frame_number = reader.read_bits(frame_bits)? as u32;

        let parity_mode_raw = reader.read_bits(3)? as u8;
        let parity_mode = ParityMode::from_u8(parity_mode_raw)?;

        let data_type_raw = reader.read_bits(2)? as u8;
        let data_type = DataType::from_u8(data_type_raw)?;

        let payload_bit_len = read_varint(&mut reader)? as usize;
        let header_bit_len = reader.bit_pos();

        let is_first = start_bit && frame_number == 0;

        Ok(FrameMetadata {
            start_bit: true,
            is_first,
            is_parity: false,
            version: Some(version),
            total_qr_count: Some(total_qr_count),
            frame_number,
            parity_mode: Some(parity_mode),
            data_type: Some(data_type),
            payload_bit_len,
            header_bit_len,
        })
    } else {
        let total_qr_count = known_total_qr_count.ok_or(FrameError::MissingContext)?;

        if total_qr_count < 1 || total_qr_count > 65536 {
            return Err(FrameError::InvalidTotalQrCount(total_qr_count));
        }

        let frame_bits = calculate_frame_bits(total_qr_count);
        let frame_number = reader.read_bits(frame_bits)? as u32;

        let mode = known_parity_mode.unwrap_or(ParityMode::None);
        let is_parity = is_parity_frame_number(frame_number, total_qr_count, mode);

        let payload_bit_len = read_varint(&mut reader)? as usize;
        let header_bit_len = reader.bit_pos();

        Ok(FrameMetadata {
            start_bit: false,
            is_first: false,
            is_parity,
            version: None,
            total_qr_count: Some(total_qr_count),
            frame_number,
            parity_mode: known_parity_mode,
            data_type: None,
            payload_bit_len,
            header_bit_len,
        })
    }
}

/// フレーム抽象構造表現
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Frame {
    /// First QRフレーム
    First {
        /// バージョン
        version: u8,
        /// 総QR数
        total_qr_count: u32,
        /// フレーム番号
        frame_number: u32,
        /// パリティモード
        parity_mode: ParityMode,
        /// データ型
        data_type: DataType,
        /// ペイロードバイト配列
        payload_bytes: Vec<u8>,
        /// ペイロードビット長
        payload_bit_len: usize,
        /// フレームCRC
        frame_crc: u16,
        /// 全体CRC
        overall_crc: Option<u32>,
    },
    /// Non-First QRフレーム
    NonFirst {
        /// 総QR数
        total_qr_count: u32,
        /// フレーム番号
        frame_number: u32,
        /// パリティフレームフラグ
        is_parity: bool,
        /// ペイロードバイト配列
        payload_bytes: Vec<u8>,
        /// ペイロードビット長
        payload_bit_len: usize,
        /// フレームCRC
        frame_crc: u16,
        /// 全体CRC
        overall_crc: Option<u32>,
    },
}

impl Frame {
    /// 総QR数を取得
    ///
    /// # Returns
    /// * 総QR数
    pub fn total_qr_count(&self) -> u32 {
        match self {
            Frame::First { total_qr_count, .. } => *total_qr_count,
            Frame::NonFirst { total_qr_count, .. } => *total_qr_count,
        }
    }

    /// フレーム番号を取得
    ///
    /// # Returns
    /// * フレーム番号
    pub fn frame_number(&self) -> u32 {
        match self {
            Frame::First { frame_number, .. } => *frame_number,
            Frame::NonFirst { frame_number, .. } => *frame_number,
        }
    }

    /// フレームCRCを取得
    ///
    /// # Returns
    /// * 16ビットフレームCRC
    pub fn frame_crc(&self) -> u16 {
        match self {
            Frame::First { frame_crc, .. } => *frame_crc,
            Frame::NonFirst { frame_crc, .. } => *frame_crc,
        }
    }

    /// 全体CRCを取得
    ///
    /// # Returns
    /// * オプションの32ビット全体CRC
    pub fn overall_crc(&self) -> Option<u32> {
        match self {
            Frame::First { overall_crc, .. } => *overall_crc,
            Frame::NonFirst { overall_crc, .. } => *overall_crc,
        }
    }

    /// パリティモードを取得
    ///
    /// # Returns
    /// * オプションのParityMode
    pub fn parity_mode(&self) -> Option<ParityMode> {
        match self {
            Frame::First { parity_mode, .. } => Some(*parity_mode),
            Frame::NonFirst { .. } => None,
        }
    }

    /// パリティフレームかどうかを取得
    ///
    /// # Returns
    /// * パリティフレームの場合はtrue
    pub fn is_parity(&self) -> bool {
        match self {
            Frame::First { .. } => false,
            Frame::NonFirst { is_parity, .. } => *is_parity,
        }
    }

    /// 最終フレームかどうかを取得
    ///
    /// # Returns
    /// * 最終フレームの場合はtrue
    pub fn is_final(&self) -> bool {
        self.frame_number() == self.total_qr_count() - 1
    }

    /// ペイロードバイト参照を取得
    ///
    /// # Returns
    /// * ペイロードバイトスライス
    pub fn payload_bytes(&self) -> &[u8] {
        match self {
            Frame::First { payload_bytes, .. } => payload_bytes,
            Frame::NonFirst { payload_bytes, .. } => payload_bytes,
        }
    }

    /// ペイロードビット長を取得
    ///
    /// # Returns
    /// * ペイロードビット長
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

/// 総QR数からFrameBits長を算出
///
/// 仕様書 Section 13 & 77: FrameBits = max(1, ceil(log2(N)))
///
/// # Arguments
/// * `total_qr_count` - 総QR数
///
/// # Returns
/// * FrameBits長
pub fn calculate_frame_bits(total_qr_count: u32) -> usize {
    if total_qr_count <= 1 {
        1
    } else {
        32 - (total_qr_count - 1).leading_zeros() as usize
    }
}

/// フレーム構造体をワイヤーバイト列にエンコード
///
/// # Arguments
/// * `frame` - 対象フレーム
/// * `first_frame_crc_opt` - FirstフレームCRC (Non-Firstエンコード時に必要)
///
/// # Returns
/// * エンコードされたワイヤーバイト配列
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
            parity_mode,
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

            writer.write_bit(true);
            writer.write_bits(*version as u64, 4)?;

            let stored_total_qr_count = (total_qr_count - 1) as u16;
            writer.write_bits(stored_total_qr_count as u64, 16)?;
            writer.write_bits(frame_number as u64, frame_bits)?;
            writer.write_bits(parity_mode.to_wire_bits() as u64, 3)?;
            writer.write_bits(*data_type as u64, 2)?;
            write_varint(&mut writer, payload_bit_len as u64)?;
            writer.write_bytes(payload_bytes, payload_bit_len)?;

            let rem = writer.bit_len() % 8;
            if rem > 0 {
                let padding_bits = 8 - rem;
                for _ in 0..padding_bits {
                    writer.write_bit(false);
                }
            }

            let calculated_crc = crc16(writer.as_bytes());
            writer.write_bits(calculated_crc as u64, 16)?;

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

            writer.write_bit(false);
            writer.write_bits(frame_number as u64, frame_bits)?;
            write_varint(&mut writer, payload_bit_len as u64)?;
            writer.write_bytes(payload_bytes, payload_bit_len)?;

            let rem = writer.bit_len() % 8;
            if rem > 0 {
                let padding_bits = 8 - rem;
                for _ in 0..padding_bits {
                    writer.write_bit(false);
                }
            }

            let mut crc_input = Vec::from(writer.as_bytes());
            crc_input.extend_from_slice(&first_crc.to_be_bytes());
            let calculated_crc = crc16(&crc_input);

            writer.write_bits(calculated_crc as u64, 16)?;

            if frame.is_final() {
                let ov_crc = overall_crc.ok_or(FrameError::MissingOverallCrc)?;
                writer.write_bits(ov_crc as u64, 32)?;
            }
        }
    }

    Ok(writer.into_bytes())
}

/// ワイヤーバイト列からFrameを復元・デコード
///
/// # Arguments
/// * `data` - ワイヤーバイト配列
/// * `context` - デコードコンテキスト
///
/// # Returns
/// * デコードされたFrame構造体
pub fn decode_frame(data: &[u8], context: Option<&DecodeContext>) -> Result<Frame, FrameError> {
    let known_total = context.and_then(|c| c.total_qr_count);
    let known_mode = context.and_then(|c| c.parity_mode);
    let meta = parse_frame_metadata(data, known_total, known_mode)?;

    let mut reader = BitReader::new(data);
    for _ in 0..meta.header_bit_len {
        reader.read_bit()?;
    }

    if meta.start_bit {
        let version = meta.version.unwrap();
        let total_qr_count = meta.total_qr_count.unwrap();
        let frame_number = meta.frame_number;
        let parity_mode = meta.parity_mode.unwrap();
        let data_type = meta.data_type.unwrap();
        let payload_bit_len = meta.payload_bit_len;

        if frame_number != 0 {
            return Err(FrameError::InvalidFrameNumber {
                frame_number,
                total_qr_count,
            });
        }

        let is_final = frame_number == total_qr_count - 1;

        let header_bit_len = meta.header_bit_len;
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

        let mut payload_writer = BitWriter::with_capacity_bits(payload_bit_len);
        for _ in 0..payload_bit_len {
            let bit = reader.read_bit()?;
            payload_writer.write_bit(bit);
        }
        let payload_bytes = payload_writer.into_bytes();

        for _ in 0..padding_bits {
            let p = reader.read_bit()?;
            if p {
                return Err(FrameError::InvalidPadding);
            }
        }

        let frame_data_byte_len = reader.bit_pos() / 8;

        let wire_crc = reader.read_bits(16)? as u16;

        let overall_crc = if is_final {
            Some(reader.read_bits(32)? as u32)
        } else {
            None
        };

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
            parity_mode,
            data_type,
            payload_bytes,
            payload_bit_len,
            frame_crc: wire_crc,
            overall_crc,
        })
    } else {
        let ctx = context.ok_or(FrameError::MissingContext)?;
        let total_qr_count = meta.total_qr_count.unwrap();
        let first_frame_crc = ctx.first_frame_crc.ok_or(FrameError::MissingContext)?;

        let frame_number = meta.frame_number;
        let payload_bit_len = meta.payload_bit_len;

        if frame_number == 0 || frame_number >= total_qr_count {
            return Err(FrameError::InvalidFrameNumber {
                frame_number,
                total_qr_count,
            });
        }

        let is_final = frame_number == total_qr_count - 1;

        let header_bit_len = meta.header_bit_len;
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

        let mut payload_writer = BitWriter::with_capacity_bits(payload_bit_len);
        for _ in 0..payload_bit_len {
            let bit = reader.read_bit()?;
            payload_writer.write_bit(bit);
        }
        let payload_bytes = payload_writer.into_bytes();

        for _ in 0..padding_bits {
            let p = reader.read_bit()?;
            if p {
                return Err(FrameError::InvalidPadding);
            }
        }

        let frame_data_byte_len = reader.bit_pos() / 8;

        let wire_crc = reader.read_bits(16)? as u16;

        let overall_crc = if is_final {
            Some(reader.read_bits(32)? as u32)
        } else {
            None
        };

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
            is_parity: meta.is_parity,
            payload_bytes,
            payload_bit_len,
            frame_crc: wire_crc,
            overall_crc,
        })
    }
}

/// 複数のペイロード間のXOR演算を計算
///
/// # Arguments
/// * `payloads` - ペイロードバイト列とビット長のタプルスライス
///
/// # Returns
/// * XOR結果のバイトベクターと最大ビット長
pub fn xor_payloads(payloads: &[(&[u8], usize)]) -> (Vec<u8>, usize) {
    if payloads.is_empty() {
        return (vec![], 0);
    }
    let max_bit_len = payloads.iter().map(|(_, len)| *len).max().unwrap_or(0);
    let max_byte_len = (max_bit_len + 7) / 8;
    let mut result = vec![0u8; max_byte_len];

    for (bytes, bit_len) in payloads {
        let effective_bytes = std::cmp::min(bytes.len(), (bit_len + 7) / 8);
        for i in 0..max_byte_len {
            let b = if i < effective_bytes { bytes[i] } else { 0 };
            result[i] ^= b;
        }
    }

    let rem = max_bit_len % 8;
    if rem > 0 && !result.is_empty() {
        let mask = (0xFF00 >> rem) as u8;
        let last_idx = result.len() - 1;
        result[last_idx] &= mask;
    }

    (result, max_bit_len)
}

/// データフレームのペイロードビット列を結合
///
/// # Arguments
/// * `frames` - 完全なフレームリスト
///
/// # Returns
/// * 結合されたビットストリームWriter
pub fn concat_data_payload_bits(frames: &[Frame]) -> Result<BitWriter, FrameError> {
    if frames.is_empty() {
        return Err(FrameError::EmptyFrames);
    }

    let first_frame = frames
        .iter()
        .find(|f| matches!(f, Frame::First { .. }))
        .ok_or(FrameError::MissingFrameNumber(0))?;

    let expected_total = first_frame.total_qr_count();
    let parity_mode = first_frame.parity_mode().unwrap_or(ParityMode::None);

    for f in frames {
        if f.total_qr_count() != expected_total {
            return Err(FrameError::MismatchedTotalQrCount {
                expected: expected_total,
                actual: f.total_qr_count(),
            });
        }
    }

    let data_frames: Vec<&Frame> = frames.iter().filter(|f| !f.is_parity()).collect();
    if data_frames.is_empty() {
        return Err(FrameError::EmptyFrames);
    }

    let mut seen = std::collections::HashSet::new();
    for f in &data_frames {
        if !seen.insert(f.frame_number()) {
            return Err(FrameError::DuplicateFrameNumber(f.frame_number()));
        }
    }

    let frame_map: std::collections::HashMap<u32, &Frame> =
        data_frames.iter().map(|f| (f.frame_number(), *f)).collect();

    let mut sorted_frames = Vec::new();

    for fn_idx in 0..expected_total {
        if !is_parity_frame_number(fn_idx, expected_total, parity_mode) {
            let df = frame_map
                .get(&fn_idx)
                .ok_or(FrameError::MissingFrameNumber(fn_idx))?;
            sorted_frames.push(*df);
        }
    }

    let total_bit_len: usize = sorted_frames.iter().map(|f| f.payload_bit_len()).sum();
    let mut writer = BitWriter::with_capacity_bits(total_bit_len);

    for frame in sorted_frames {
        let p_len = frame.payload_bit_len();
        let p_bytes = frame.payload_bytes();
        if p_len > p_bytes.len() * 8 {
            return Err(FrameError::InvalidPayloadLength {
                specified: p_len,
                buffer_bits: p_bytes.len() * 8,
            });
        }
        writer.write_bytes(p_bytes, p_len)?;
    }

    Ok(writer)
}

/// フレーム集合全体のChecksum (CRC32) を計算
///
/// # Arguments
/// * `frames` - フレームリスト
///
/// # Returns
/// * 32ビットChecksum
pub fn calculate_overall_crc(frames: &[Frame]) -> Result<u32, FrameError> {
    let writer = concat_data_payload_bits(frames)?;
    Ok(crate::crc::crc32_bits(writer.as_bytes(), writer.bit_len()))
}

/// 全体CRC検証
///
/// # Arguments
/// * `frames` - フレームリスト
///
/// # Returns
/// * 検証一致時はtrue
pub fn verify_overall_crc(frames: &[Frame]) -> Result<bool, FrameError> {
    let calculated = calculate_overall_crc(frames)?;

    let final_frame =
        frames
            .iter()
            .find(|f| f.is_final())
            .ok_or(FrameError::MissingFrameNumber(
                frames[0].total_qr_count() - 1,
            ))?;

    let wire_overall_crc = final_frame
        .overall_crc()
        .ok_or(FrameError::MissingOverallCrc)?;

    Ok(calculated == wire_overall_crc)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_frame_metadata_first_and_non_first() {
        let frame0 = Frame::First {
            version: 1,
            total_qr_count: 3,
            frame_number: 0,
            parity_mode: ParityMode::None,
            data_type: DataType::Uint8Array,
            payload_bytes: vec![0x12, 0x34],
            payload_bit_len: 16,
            frame_crc: 0,
            overall_crc: None,
        };
        let encoded0 = encode_frame(&frame0, None).unwrap();

        let meta0 = parse_frame_metadata(&encoded0, None, None).unwrap();
        assert_eq!(meta0.start_bit, true);
        assert_eq!(meta0.is_first, true);
        assert_eq!(meta0.version, Some(1));
        assert_eq!(meta0.total_qr_count, Some(3));
        assert_eq!(meta0.frame_number, 0);
        assert_eq!(meta0.data_type, Some(DataType::Uint8Array));
        assert_eq!(meta0.payload_bit_len, 16);
        assert_eq!(meta0.is_final(), false);

        let decoded0 = decode_frame(&encoded0, None).unwrap();
        let first_crc = decoded0.frame_crc();

        let frame2 = Frame::NonFirst {
            total_qr_count: 3,
            frame_number: 2,
            is_parity: false,
            payload_bytes: vec![0xAB],
            payload_bit_len: 8,
            frame_crc: 0,
            overall_crc: Some(0x12345678),
        };
        let encoded2 = encode_frame(&frame2, Some(first_crc)).unwrap();

        let meta2 = parse_frame_metadata(&encoded2, Some(3), None).unwrap();
        assert_eq!(meta2.start_bit, false);
        assert_eq!(meta2.is_first, false);
        assert_eq!(meta2.version, None);
        assert_eq!(meta2.total_qr_count, Some(3));
        assert_eq!(meta2.frame_number, 2);
        assert_eq!(meta2.data_type, None);
        assert_eq!(meta2.payload_bit_len, 8);
        assert_eq!(meta2.is_final(), true);
    }

    #[test]
    fn test_parse_frame_metadata_missing_known_total_count() {
        let frame1 = Frame::NonFirst {
            total_qr_count: 2,
            frame_number: 1,
            is_parity: false,
            payload_bytes: vec![0x00],
            payload_bit_len: 8,
            frame_crc: 0,
            overall_crc: Some(0),
        };
        let encoded1 = encode_frame(&frame1, Some(0x1234)).unwrap();

        let err = parse_frame_metadata(&encoded1, None, None).unwrap_err();
        assert_eq!(err, FrameError::MissingContext);
    }

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

            let is_final_0 = total_qr_count == 1;
            let frame0 = Frame::First {
                version: 1,
                total_qr_count,
                frame_number: 0,
                parity_mode: ParityMode::None,
                data_type: DataType::Uint8Array,
                payload_bytes: vec![0x12],
                payload_bit_len: 8,
                frame_crc: 0,
                overall_crc: if is_final_0 { Some(0x11223344) } else { None },
            };

            let encoded0 = encode_frame(&frame0, None).unwrap();

            let mut reader = BitReader::new(&encoded0);
            assert_eq!(reader.read_bit().unwrap(), true);
            assert_eq!(reader.read_bits(4).unwrap(), 1);
            assert_eq!(reader.read_bits(16).unwrap(), expected_stored as u64);
            assert_eq!(reader.read_bits(expected_frame_bits).unwrap(), 0);

            let decoded0 = decode_frame(&encoded0, None).unwrap();
            assert_eq!(decoded0.total_qr_count(), total_qr_count);
            assert_eq!(decoded0.frame_number(), 0);
            let first_crc = decoded0.frame_crc();

            let last_frame_num = total_qr_count - 1;
            if last_frame_num > 0 {
                let frame_last = Frame::NonFirst {
                    total_qr_count,
                    frame_number: last_frame_num,
                    is_parity: false,
                    payload_bytes: vec![0x34],
                    payload_bit_len: 8,
                    frame_crc: 0,
                    overall_crc: Some(0x99887766),
                };
                assert!(frame_last.is_final());

                let encoded_last = encode_frame(&frame_last, Some(first_crc)).unwrap();

                let mut reader_last = BitReader::new(&encoded_last);
                assert_eq!(reader_last.read_bit().unwrap(), false);
                assert_eq!(
                    reader_last.read_bits(expected_frame_bits).unwrap(),
                    last_frame_num as u64
                );

                let ctx = DecodeContext {
                    total_qr_count: Some(total_qr_count),
                    first_frame_crc: Some(first_crc),
                    parity_mode: Some(ParityMode::None),
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
            parity_mode: ParityMode::None,
            data_type: DataType::Uint8Array,
            payload_bytes: vec![],
            payload_bit_len: 0,
            frame_crc: 0,
            overall_crc: None,
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
            parity_mode: ParityMode::None,
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
            is_parity: false,
            payload_bytes: vec![0xBB],
            payload_bit_len: 8,
            frame_crc: 0,
            overall_crc: Some(0x12345678),
        };

        let mut encoded1 = encode_frame(&frame1, Some(first_crc)).unwrap();

        encoded1[3] ^= 0xFF;

        let ctx = DecodeContext {
            total_qr_count: Some(total_qr_count),
            first_frame_crc: Some(first_crc),
            parity_mode: Some(ParityMode::None),
        };
        let err1 = decode_frame(&encoded1, Some(&ctx)).unwrap_err();
        assert!(matches!(err1, FrameError::FrameCrcMismatch { .. }));

        let re_encoded1 = encode_frame(&frame1, Some(first_crc)).unwrap();
        let wrong_ctx = DecodeContext {
            total_qr_count: Some(total_qr_count),
            first_frame_crc: Some(first_crc ^ 0xFFFF),
            parity_mode: Some(ParityMode::None),
        };
        let err2 = decode_frame(&re_encoded1, Some(&wrong_ctx)).unwrap_err();
        assert!(matches!(err2, FrameError::FrameCrcMismatch { .. }));
    }

    #[test]
    fn test_13bit_unaligned_payload_explicit_validation() {
        let source_payload = vec![0b11010010, 0b11011111];
        let bit_len = 13;

        let frame = Frame::First {
            version: 1,
            total_qr_count: 2,
            frame_number: 0,
            parity_mode: ParityMode::None,
            data_type: DataType::Uint8Array,
            payload_bytes: source_payload,
            payload_bit_len: bit_len,
            frame_crc: 0,
            overall_crc: None,
        };

        let encoded = encode_frame(&frame, None).unwrap();
        let decoded = decode_frame(&encoded, None).unwrap();

        assert_eq!(decoded.payload_bit_len(), 13);
        let decoded_payload = decoded.payload_bytes();
        assert_eq!(decoded_payload[0], 0b11010010);
        assert_eq!(decoded_payload[1], 0b11011000);

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
            parity_mode: ParityMode::None,
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
            parity_mode: ParityMode::None,
            data_type: DataType::Uint8Array,
            payload_bytes: vec![0xC0],
            payload_bit_len: 2,
            frame_crc: 0,
            overall_crc: Some(0),
        };

        let mut encoded = encode_frame(&frame2, None).unwrap();
        encoded[4] |= 0x08;

        let res = decode_frame(&encoded, None);
        assert_eq!(res.unwrap_err(), FrameError::InvalidPadding);
    }

    #[test]
    fn test_frame_crc_mismatch() {
        let frame = Frame::First {
            version: 1,
            total_qr_count: 1,
            frame_number: 0,
            parity_mode: ParityMode::None,
            data_type: DataType::Uint8Array,
            payload_bytes: vec![0x12, 0x34],
            payload_bit_len: 16,
            frame_crc: 0,
            overall_crc: Some(0),
        };

        let mut encoded = encode_frame(&frame, None).unwrap();
        encoded[5] ^= 0xFF;

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
            frame_number: 3,
            is_parity: false,
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
            is_parity: false,
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
            parity_mode: ParityMode::None,
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
            parity_mode: ParityMode::None,
            data_type: DataType::Uint8Array,
            payload_bytes: vec![0x12],
            payload_bit_len: 8,
            frame_crc: 0,
            overall_crc: Some(0x12345678),
        };

        let mut encoded = encode_frame(&frame, None).unwrap();
        encoded.extend_from_slice(&[0xFF, 0xEE, 0xDD]);

        let decoded = decode_frame(&encoded, None).unwrap();
        assert_eq!(decoded.payload_bytes(), &[0x12]);
        assert_eq!(decoded.overall_crc(), Some(0x12345678));
    }

    #[test]
    fn test_overall_crc_single_frame() {
        let payload = b"Hello, World!";
        let expected_crc = crate::crc::crc32(payload);

        let frame = Frame::First {
            version: 1,
            total_qr_count: 1,
            frame_number: 0,
            parity_mode: ParityMode::None,
            data_type: DataType::Uint8Array,
            payload_bytes: payload.to_vec(),
            payload_bit_len: payload.len() * 8,
            frame_crc: 0x1234,
            overall_crc: Some(expected_crc),
        };

        let calculated = calculate_overall_crc(&[frame.clone()]).unwrap();
        assert_eq!(calculated, expected_crc);

        let verified = verify_overall_crc(&[frame]).unwrap();
        assert!(verified);
    }

    #[test]
    fn test_overall_crc_multiple_frames() {
        let p0 = b"Hello, ";
        let p1 = b"World";
        let p2 = b"!";

        let combined = b"Hello, World!";
        let expected_crc = crate::crc::crc32(combined);

        let frame0 = Frame::First {
            version: 1,
            total_qr_count: 3,
            frame_number: 0,
            parity_mode: ParityMode::None,
            data_type: DataType::Uint8Array,
            payload_bytes: p0.to_vec(),
            payload_bit_len: p0.len() * 8,
            frame_crc: 0x1111,
            overall_crc: None,
        };

        let frame1 = Frame::NonFirst {
            total_qr_count: 3,
            frame_number: 1,
            is_parity: false,
            payload_bytes: p1.to_vec(),
            payload_bit_len: p1.len() * 8,
            frame_crc: 0x2222,
            overall_crc: None,
        };

        let frame2 = Frame::NonFirst {
            total_qr_count: 3,
            frame_number: 2,
            is_parity: false,
            payload_bytes: p2.to_vec(),
            payload_bit_len: p2.len() * 8,
            frame_crc: 0x3333,
            overall_crc: Some(expected_crc),
        };

        let frames = vec![frame0, frame1, frame2];
        let calculated = calculate_overall_crc(&frames).unwrap();
        assert_eq!(calculated, expected_crc);

        let verified = verify_overall_crc(&frames).unwrap();
        assert!(verified);
    }

    #[test]
    fn test_overall_crc_unaligned_frame_boundaries_13_plus_11() {
        let total_payload = [0xD2, 0xAF, 0x55];
        let expected_crc = crate::crc::crc32(&total_payload);

        let frame0_payload = vec![0xD2, 0xA8];
        let frame1_payload = vec![0xEA, 0xA0];

        let frame0 = Frame::First {
            version: 1,
            total_qr_count: 2,
            frame_number: 0,
            parity_mode: ParityMode::None,
            data_type: DataType::Uint8Array,
            payload_bytes: frame0_payload,
            payload_bit_len: 13,
            frame_crc: 0x1000,
            overall_crc: None,
        };

        let frame1 = Frame::NonFirst {
            total_qr_count: 2,
            frame_number: 1,
            is_parity: false,
            payload_bytes: frame1_payload,
            payload_bit_len: 11,
            frame_crc: 0x2000,
            overall_crc: Some(expected_crc),
        };

        let frames = vec![frame0, frame1];
        let concatenated = concat_data_payload_bits(&frames).unwrap();
        assert_eq!(concatenated.bit_len(), 24);
        assert_eq!(concatenated.as_bytes(), &total_payload);

        let calculated = calculate_overall_crc(&frames).unwrap();
        assert_eq!(calculated, expected_crc);
        assert!(verify_overall_crc(&frames).unwrap());
    }

    #[test]
    fn test_overall_crc_individual_zero_bit_payload() {
        let p0 = b"Hello";
        let p2 = b"World";

        let combined = b"HelloWorld";
        let expected_crc = crate::crc::crc32(combined);

        let frame0 = Frame::First {
            version: 1,
            total_qr_count: 3,
            frame_number: 0,
            parity_mode: ParityMode::None,
            data_type: DataType::Uint8Array,
            payload_bytes: p0.to_vec(),
            payload_bit_len: p0.len() * 8,
            frame_crc: 0x1111,
            overall_crc: None,
        };

        let frame1 = Frame::NonFirst {
            total_qr_count: 3,
            frame_number: 1,
            is_parity: false,
            payload_bytes: vec![],
            payload_bit_len: 0,
            frame_crc: 0x2222,
            overall_crc: None,
        };

        let frame2 = Frame::NonFirst {
            total_qr_count: 3,
            frame_number: 2,
            is_parity: false,
            payload_bytes: p2.to_vec(),
            payload_bit_len: p2.len() * 8,
            frame_crc: 0x3333,
            overall_crc: Some(expected_crc),
        };

        let frames = vec![frame0, frame1, frame2];
        let calculated = calculate_overall_crc(&frames).unwrap();
        assert_eq!(calculated, expected_crc);
        assert!(verify_overall_crc(&frames).unwrap());
    }

    #[test]
    fn test_overall_crc_total_payload_zero_bits() {
        let expected_crc = crate::crc::crc32_bits(&[], 0);

        let frame0 = Frame::First {
            version: 1,
            total_qr_count: 2,
            frame_number: 0,
            parity_mode: ParityMode::None,
            data_type: DataType::Uint8Array,
            payload_bytes: vec![],
            payload_bit_len: 0,
            frame_crc: 0x1111,
            overall_crc: None,
        };

        let frame1 = Frame::NonFirst {
            total_qr_count: 2,
            frame_number: 1,
            is_parity: false,
            payload_bytes: vec![],
            payload_bit_len: 0,
            frame_crc: 0x2222,
            overall_crc: Some(expected_crc),
        };

        let frames = vec![frame0, frame1];
        let calculated = calculate_overall_crc(&frames).unwrap();
        assert_eq!(calculated, 0x00000000);
        assert!(verify_overall_crc(&frames).unwrap());
    }

    #[test]
    fn test_overall_crc_out_of_order_input() {
        let combined = b"SortedBits";
        let expected_crc = crate::crc::crc32(combined);

        let frame0 = Frame::First {
            version: 1,
            total_qr_count: 3,
            frame_number: 0,
            parity_mode: ParityMode::None,
            data_type: DataType::Uint8Array,
            payload_bytes: b"Sor".to_vec(),
            payload_bit_len: 24,
            frame_crc: 0x1000,
            overall_crc: None,
        };

        let frame1 = Frame::NonFirst {
            total_qr_count: 3,
            frame_number: 1,
            is_parity: false,
            payload_bytes: b"ted".to_vec(),
            payload_bit_len: 24,
            frame_crc: 0x2000,
            overall_crc: None,
        };

        let frame2 = Frame::NonFirst {
            total_qr_count: 3,
            frame_number: 2,
            is_parity: false,
            payload_bytes: b"Bits".to_vec(),
            payload_bit_len: 32,
            frame_crc: 0x3000,
            overall_crc: Some(expected_crc),
        };

        let out_of_order = vec![frame2.clone(), frame0.clone(), frame1.clone()];
        let in_order = vec![frame0, frame1, frame2];

        assert_eq!(
            calculate_overall_crc(&out_of_order).unwrap(),
            calculate_overall_crc(&in_order).unwrap()
        );
        assert!(verify_overall_crc(&out_of_order).unwrap());
    }

    #[test]
    fn test_overall_crc_ignore_trailing_unused_bits_in_payload() {
        let expected_crc = crate::crc::crc32(&[0xD5]);

        let frame0 = Frame::First {
            version: 1,
            total_qr_count: 2,
            frame_number: 0,
            parity_mode: ParityMode::None,
            data_type: DataType::Uint8Array,
            payload_bytes: vec![0b11010111],
            payload_bit_len: 5,
            frame_crc: 0x1000,
            overall_crc: None,
        };

        let frame1 = Frame::NonFirst {
            total_qr_count: 2,
            frame_number: 1,
            is_parity: false,
            payload_bytes: vec![0b10111111],
            payload_bit_len: 3,
            frame_crc: 0x2000,
            overall_crc: Some(expected_crc),
        };

        let frames = vec![frame0, frame1];
        let concatenated = concat_data_payload_bits(&frames).unwrap();
        assert_eq!(concatenated.bit_len(), 8);
        assert_eq!(concatenated.as_bytes(), &[0xD5]);

        let calculated = calculate_overall_crc(&frames).unwrap();
        assert_eq!(calculated, expected_crc);
        assert!(verify_overall_crc(&frames).unwrap());
    }

    #[test]
    fn test_overall_crc_boundary_invariance() {
        let full_stream = [0b10101010, 0b11110000, 0b11001100, 0b00110011, 0b10100000];
        let expected_crc = crate::crc::crc32_bits(&full_stream, 35);

        let way_a = vec![
            Frame::First {
                version: 1,
                total_qr_count: 2,
                frame_number: 0,
                parity_mode: ParityMode::None,
                data_type: DataType::Uint8Array,
                payload_bytes: vec![0xAA, 0xF0],
                payload_bit_len: 15,
                frame_crc: 0x1000,
                overall_crc: None,
            },
            Frame::NonFirst {
                total_qr_count: 2,
                frame_number: 1,
                is_parity: false,
                payload_bytes: vec![0x66, 0x19, 0xD0],
                payload_bit_len: 20,
                frame_crc: 0x2000,
                overall_crc: Some(expected_crc),
            },
        ];

        let way_b = vec![
            Frame::First {
                version: 1,
                total_qr_count: 2,
                frame_number: 0,
                parity_mode: ParityMode::None,
                data_type: DataType::Uint8Array,
                payload_bytes: vec![0xAA, 0xF0, 0xCC],
                payload_bit_len: 24,
                frame_crc: 0x1000,
                overall_crc: None,
            },
            Frame::NonFirst {
                total_qr_count: 2,
                frame_number: 1,
                is_parity: false,
                payload_bytes: vec![0x33, 0xA0],
                payload_bit_len: 11,
                frame_crc: 0x2000,
                overall_crc: Some(expected_crc),
            },
        ];

        let crc_a = calculate_overall_crc(&way_a).unwrap();
        let crc_b = calculate_overall_crc(&way_b).unwrap();

        assert_eq!(crc_a, expected_crc);
        assert_eq!(crc_b, expected_crc);
        assert_eq!(crc_a, crc_b);
    }

    #[test]
    fn test_verify_overall_crc_match_and_mismatch() {
        let payload = b"Overall CRC Validation Test";
        let correct_crc = crate::crc::crc32(payload);

        let frame0 = Frame::First {
            version: 1,
            total_qr_count: 2,
            frame_number: 0,
            parity_mode: ParityMode::None,
            data_type: DataType::Uint8Array,
            payload_bytes: payload[..10].to_vec(),
            payload_bit_len: 80,
            frame_crc: 0x1000,
            overall_crc: None,
        };

        let frame1_match = Frame::NonFirst {
            total_qr_count: 2,
            frame_number: 1,
            is_parity: false,
            payload_bytes: payload[10..].to_vec(),
            payload_bit_len: (payload.len() - 10) * 8,
            frame_crc: 0x2000,
            overall_crc: Some(correct_crc),
        };

        assert_eq!(
            verify_overall_crc(&[frame0.clone(), frame1_match]),
            Ok(true)
        );

        let frame1_mismatch = Frame::NonFirst {
            total_qr_count: 2,
            frame_number: 1,
            is_parity: false,
            payload_bytes: payload[10..].to_vec(),
            payload_bit_len: (payload.len() - 10) * 8,
            frame_crc: 0x2000,
            overall_crc: Some(correct_crc ^ 0xFFFFFFFF),
        };

        assert_eq!(verify_overall_crc(&[frame0, frame1_mismatch]), Ok(false));
    }

    #[test]
    fn test_overall_crc_invalid_frame_sets() {
        assert_eq!(calculate_overall_crc(&[]), Err(FrameError::EmptyFrames));

        let f0 = Frame::First {
            version: 1,
            total_qr_count: 3,
            frame_number: 0,
            parity_mode: ParityMode::None,
            data_type: DataType::Uint8Array,
            payload_bytes: vec![0x01],
            payload_bit_len: 8,
            frame_crc: 0x1000,
            overall_crc: None,
        };
        let f2 = Frame::NonFirst {
            total_qr_count: 3,
            frame_number: 2,
            is_parity: false,
            payload_bytes: vec![0x02],
            payload_bit_len: 8,
            frame_crc: 0x3000,
            overall_crc: Some(0x12345678),
        };
        assert_eq!(
            calculate_overall_crc(&[f0.clone(), f2.clone()]),
            Err(FrameError::MissingFrameNumber(1))
        );

        let f0_dup = f0.clone();
        let f1 = Frame::NonFirst {
            total_qr_count: 3,
            frame_number: 1,
            is_parity: false,
            payload_bytes: vec![0x03],
            payload_bit_len: 8,
            frame_crc: 0x2000,
            overall_crc: None,
        };
        assert_eq!(
            calculate_overall_crc(&[f0.clone(), f0_dup, f1.clone()]),
            Err(FrameError::DuplicateFrameNumber(0))
        );

        let f1_wrong_total = Frame::NonFirst {
            total_qr_count: 2,
            frame_number: 1,
            is_parity: false,
            payload_bytes: vec![0x03],
            payload_bit_len: 8,
            frame_crc: 0x2000,
            overall_crc: None,
        };
        assert_eq!(
            calculate_overall_crc(&[f0, f1_wrong_total, f2]),
            Err(FrameError::MismatchedTotalQrCount {
                expected: 3,
                actual: 2,
            })
        );
    }
}
