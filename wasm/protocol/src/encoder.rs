use crate::bit_stream::{BitReader, BitStreamError, BitWriter};
use crate::frame::{
    DataType, DecodeContext, Frame, FrameError, ParityMode, calculate_overall_crc, decode_frame,
    encode_frame, xor_payloads,
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

/// Helper function to calculate parity frame count for a given intermediate data frame count and parity mode.
pub fn calculate_parity_count(n_inter: usize, parity_mode: ParityMode) -> usize {
    if parity_mode == ParityMode::None || n_inter == 0 {
        return 0;
    }
    let m = parity_mode.group_size(); // 8, 16, 32
    let max_data_per_group = m - 1; // 7, 15, 31
    let full_groups = n_inter / max_data_per_group;
    let rem = n_inter % max_data_per_group;
    if rem > 1 {
        full_groups + 1
    } else {
        full_groups
    }
}

/// Encodes input data (Uint8Array or String) into a set of Frames and their wire format byte vectors.
pub fn encode_data(
    data: InputData,
    max_frame_bits: usize,
    parity_mode: ParityMode,
) -> Result<EncodeOutput, EncoderError> {
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
            // Start + Version + StoredTotalQRCount + FrameNumber + ParityMode + DataType
            1 + 4 + 16 + frame_bits + 3 + 2 + varint_bit_len(payload_bit_len)
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

    // 2. Determine minimum Total QR Count N and intermediate count n_inter
    let mut selected_config: Option<(u32, usize)> = None; // (total_qr_count, n_inter)

    // Check single frame (N=1)
    let single_cap = max_payload_for_frame(1, 0);
    if single_cap >= total_payload_bits {
        selected_config = Some((1, 0));
    } else {
        for n_inter in 0..=65536 {
            let n_parity = calculate_parity_count(n_inter, parity_mode);
            let n_total = 1 + n_inter + n_parity + 1; // First + Intermediate + Parity + Final

            if n_total > 65536 {
                break;
            }

            let n_total_u32 = n_total as u32;
            let first_cap = max_payload_for_frame(n_total_u32, 0);
            let final_cap = max_payload_for_frame(n_total_u32, n_total_u32 - 1);

            let inter_cap = if n_inter > 0 {
                max_payload_for_frame(n_total_u32, 1)
            } else {
                0
            };

            let total_data_cap = first_cap
                .saturating_add(final_cap)
                .saturating_add(inter_cap.saturating_mul(n_inter));

            if total_data_cap >= total_payload_bits {
                selected_config = Some((n_total_u32, n_inter));
                break;
            }
        }
    }

    let (total_qr_count, n_inter) = selected_config.ok_or(EncoderError::ExceedsMaxFrames {
        total_qr_count: 65537,
    })?;

    // 3. Split payload bitstream into data payload chunks.
    let mut payload_reader =
        BitReader::new_with_bit_len(payload_writer.as_bytes(), total_payload_bits)?;

    let mut data_payload_chunks: Vec<Vec<u8>> = Vec::new();
    let mut data_payload_lens: Vec<usize> = Vec::new();

    if total_qr_count == 1 {
        let cap = max_payload_for_frame(1, 0);
        let chunk_bits = std::cmp::min(cap, payload_reader.remaining_bits());
        let mut chunk_writer = BitWriter::with_capacity_bits(chunk_bits);
        for _ in 0..chunk_bits {
            chunk_writer.write_bit(payload_reader.read_bit()?);
        }
        data_payload_chunks.push(chunk_writer.into_bytes());
        data_payload_lens.push(chunk_bits);
    } else {
        let total_data_frames = 1 + n_inter + 1; // First + Intermediates + Final
        for data_idx in 0..total_data_frames {
            let logical_fn = if data_idx == 0 {
                0
            } else if data_idx == total_data_frames - 1 {
                total_qr_count - 1
            } else {
                1
            };

            let frame_cap = max_payload_for_frame(total_qr_count, logical_fn);
            let remaining = payload_reader.remaining_bits();
            let chunk_bits = std::cmp::min(frame_cap, remaining);

            let mut chunk_writer = BitWriter::with_capacity_bits(chunk_bits);
            for _ in 0..chunk_bits {
                chunk_writer.write_bit(payload_reader.read_bit()?);
            }

            data_payload_chunks.push(chunk_writer.into_bytes());
            data_payload_lens.push(chunk_bits);
        }
    }

    // 4. Construct logical frames array
    let mut logical_frames: Vec<Frame> = Vec::with_capacity(total_qr_count as usize);

    if total_qr_count == 1 {
        logical_frames.push(Frame::First {
            version: CURRENT_VERSION,
            total_qr_count: 1,
            frame_number: 0,
            parity_mode,
            data_type,
            payload_bytes: data_payload_chunks[0].clone(),
            payload_bit_len: data_payload_lens[0],
            frame_crc: 0,
            overall_crc: None,
        });
    } else {
        // Frame 0 (First)
        logical_frames.push(Frame::First {
            version: CURRENT_VERSION,
            total_qr_count,
            frame_number: 0,
            parity_mode,
            data_type,
            payload_bytes: data_payload_chunks[0].clone(),
            payload_bit_len: data_payload_lens[0],
            frame_crc: 0,
            overall_crc: None,
        });

        // Intermediate & Parity frames
        let mut data_chunk_idx = 1;

        if parity_mode == ParityMode::None || n_inter == 0 {
            for fn_idx in 1..(total_qr_count - 1) {
                logical_frames.push(Frame::NonFirst {
                    total_qr_count,
                    frame_number: fn_idx,
                    is_parity: false,
                    payload_bytes: data_payload_chunks[data_chunk_idx].clone(),
                    payload_bit_len: data_payload_lens[data_chunk_idx],
                    frame_crc: 0,
                    overall_crc: None,
                });
                data_chunk_idx += 1;
            }
        } else {
            let m = parity_mode.group_size(); // 8, 16, 32
            let max_data_per_group = m - 1; // 7, 15, 31

            let mut current_fn = 1u32;
            let mut remaining_inter_data = n_inter;

            while remaining_inter_data > 0 {
                let group_data_count = std::cmp::min(remaining_inter_data, max_data_per_group);
                let mut group_payloads: Vec<(&[u8], usize)> = Vec::new();

                for _ in 0..group_data_count {
                    let p_bytes = &data_payload_chunks[data_chunk_idx];
                    let p_len = data_payload_lens[data_chunk_idx];
                    group_payloads.push((p_bytes, p_len));

                    logical_frames.push(Frame::NonFirst {
                        total_qr_count,
                        frame_number: current_fn,
                        is_parity: false,
                        payload_bytes: p_bytes.clone(),
                        payload_bit_len: p_len,
                        frame_crc: 0,
                        overall_crc: None,
                    });

                    current_fn += 1;
                    data_chunk_idx += 1;
                }

                remaining_inter_data -= group_data_count;

                // Add Parity Frame if group has > 1 data frames
                if group_data_count > 1 {
                    let (parity_bytes, parity_bit_len) = xor_payloads(&group_payloads);
                    logical_frames.push(Frame::NonFirst {
                        total_qr_count,
                        frame_number: current_fn,
                        is_parity: true,
                        payload_bytes: parity_bytes,
                        payload_bit_len: parity_bit_len,
                        frame_crc: 0,
                        overall_crc: None,
                    });
                    current_fn += 1;
                }
            }
        }

        // Final Frame
        let last_data_idx = data_payload_chunks.len() - 1;
        logical_frames.push(Frame::NonFirst {
            total_qr_count,
            frame_number: total_qr_count - 1,
            is_parity: false,
            payload_bytes: data_payload_chunks[last_data_idx].clone(),
            payload_bit_len: data_payload_lens[last_data_idx],
            frame_crc: 0,
            overall_crc: None,
        });
    }

    // 5. Calculate Overall CRC over all DATA frames and assign to Final Frame
    let ov_crc = calculate_overall_crc(&logical_frames)?;
    let final_idx = (total_qr_count - 1) as usize;
    match &mut logical_frames[final_idx] {
        Frame::First { overall_crc, .. } => *overall_crc = Some(ov_crc),
        Frame::NonFirst { overall_crc, .. } => *overall_crc = Some(ov_crc),
    }

    // 6. Encode logical frames to wire bytes and extract actual Frame CRCs
    let mut logical_wire_bytes: Vec<Vec<u8>> = Vec::with_capacity(total_qr_count as usize);
    let mut logical_decoded_frames: Vec<Frame> = Vec::with_capacity(total_qr_count as usize);

    // Frame 0
    let wire_0 = encode_frame(&logical_frames[0], None)?;
    let decoded_0 = decode_frame(&wire_0, None)?;
    let first_frame_crc = decoded_0.frame_crc();

    logical_wire_bytes.push(wire_0);
    logical_decoded_frames.push(decoded_0);

    // Frames 1..N-1
    for i in 1..(total_qr_count as usize) {
        let wire_i = encode_frame(&logical_frames[i], Some(first_frame_crc))?;
        let ctx = DecodeContext {
            total_qr_count: Some(total_qr_count),
            first_frame_crc: Some(first_frame_crc),
            parity_mode: Some(parity_mode),
        };
        let decoded_i = decode_frame(&wire_i, Some(&ctx))?;

        logical_wire_bytes.push(wire_i);
        logical_decoded_frames.push(decoded_i);
    }

    // 7. Interleaving (Dispersal) for Parity Modes 8, 16, 32
    if parity_mode == ParityMode::None || total_qr_count <= 2 {
        Ok(EncodeOutput {
            frames: logical_decoded_frames,
            wire_bytes: logical_wire_bytes,
        })
    } else {
        // Group intermediate frames (indices 1..total_qr_count-2) into parity groups
        let m = parity_mode.group_size(); // 8, 16, 32
        let max_data_per_group = m - 1; // 7, 15, 31
        let inter_and_parity_end = (total_qr_count - 2) as usize;

        let mut groups: Vec<Vec<usize>> = Vec::new();
        let mut idx = 1usize;

        while idx <= inter_and_parity_end {
            let remaining_slots = (inter_and_parity_end - idx) + 1;
            if remaining_slots <= 1 {
                // 1 frame left in last group
                groups.push(vec![idx]);
                break;
            }

            let group_data_slots = std::cmp::min(max_data_per_group, remaining_slots - 1);
            let has_parity =
                group_data_slots > 1 && (idx + group_data_slots <= inter_and_parity_end);

            let mut group = Vec::new();
            let total_group_frames = if has_parity {
                group_data_slots + 1
            } else {
                group_data_slots
            };
            for _ in 0..total_group_frames {
                group.push(idx);
                idx += 1;
            }
            groups.push(group);
        }

        // Interleave round-robin across groups
        let mut interleaved_indices: Vec<usize> = Vec::with_capacity(total_qr_count as usize);
        interleaved_indices.push(0); // First QR

        let max_group_len = groups.iter().map(|g| g.len()).max().unwrap_or(0);
        for col in 0..max_group_len {
            for group in &groups {
                if col < group.len() {
                    interleaved_indices.push(group[col]);
                }
            }
        }

        interleaved_indices.push((total_qr_count - 1) as usize); // Final QR

        let mut emitted_frames = Vec::with_capacity(total_qr_count as usize);
        let mut emitted_wire = Vec::with_capacity(total_qr_count as usize);

        for &orig_idx in &interleaved_indices {
            emitted_frames.push(logical_decoded_frames[orig_idx].clone());
            emitted_wire.push(logical_wire_bytes[orig_idx].clone());
        }

        Ok(EncodeOutput {
            frames: emitted_frames,
            wire_bytes: emitted_wire,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::frame::verify_overall_crc;

    #[test]
    fn test_zero_max_payload_bits_error() {
        let res = encode_data(InputData::Uint8Array(b"test"), 0, ParityMode::None);
        assert_eq!(res.unwrap_err(), EncoderError::ZeroMaxPayloadBits);
    }

    #[test]
    fn test_exceeds_max_frames_error() {
        let data = vec![0u8; 65537];
        let res = encode_data(InputData::Uint8Array(&data), 8, ParityMode::None);
        assert_eq!(
            res.unwrap_err(),
            EncoderError::ExceedsMaxFrames {
                total_qr_count: 65537
            }
        );
    }

    #[test]
    fn test_uint8array_empty() {
        let output = encode_data(InputData::Uint8Array(&[]), 100, ParityMode::None).unwrap();
        assert_eq!(output.frames.len(), 1);
        assert_eq!(output.wire_bytes.len(), 1);

        let frame = &output.frames[0];
        assert_eq!(frame.total_qr_count(), 1);
        assert_eq!(frame.frame_number(), 0);
        assert_eq!(frame.payload_bit_len(), 0);
        assert_eq!(frame.payload_bytes(), &[]);
        assert!(verify_overall_crc(&output.frames).unwrap());

        let decoded = decode_frame(&output.wire_bytes[0], None).unwrap();
        assert_eq!(decoded, *frame);
    }

    #[test]
    fn test_uint8array_single_byte() {
        let data = [0x80];
        let output = encode_data(InputData::Uint8Array(&data), 100, ParityMode::None).unwrap();
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
        let output = encode_data(InputData::Uint8Array(&data), 64, ParityMode::None).unwrap();
        assert_eq!(output.frames.len(), 3);

        assert_eq!(output.frames[0].payload_bit_len(), 13);
        assert_eq!(output.frames[1].payload_bit_len(), 19);
        assert_eq!(output.frames[2].payload_bit_len(), 0);

        assert!(verify_overall_crc(&output.frames).unwrap());

        let decoded_0 = decode_frame(&output.wire_bytes[0], None).unwrap();
        assert_eq!(decoded_0, output.frames[0]);
        let first_crc = decoded_0.frame_crc();

        for i in 1..3 {
            let ctx = DecodeContext {
                total_qr_count: Some(3),
                first_frame_crc: Some(first_crc),
                parity_mode: Some(ParityMode::None),
            };
            let decoded_i = decode_frame(&output.wire_bytes[i], Some(&ctx)).unwrap();
            assert_eq!(decoded_i, output.frames[i]);
        }
    }

    #[test]
    fn test_string_empty() {
        let output = encode_data(InputData::String(""), 100, ParityMode::None).unwrap();
        assert_eq!(output.frames.len(), 1);

        let frame = &output.frames[0];
        assert_eq!(frame.payload_bit_len(), 1);
        assert_eq!(frame.payload_bytes(), &[0x00]);
        assert!(verify_overall_crc(&output.frames).unwrap());

        let mut reader = BitReader::new_with_bit_len(frame.payload_bytes(), 1).unwrap();
        assert_eq!(reader.read_bit().unwrap(), false);

        let decoded = decode_frame(&output.wire_bytes[0], None).unwrap();
        assert_eq!(decoded, *frame);
    }

    #[test]
    fn test_string_ascii_only() {
        let output = encode_data(InputData::String("ABC"), 120, ParityMode::None).unwrap();
        assert_eq!(output.frames.len(), 1);

        let frame = &output.frames[0];
        assert_eq!(frame.payload_bit_len(), 22);

        let mut reader =
            BitReader::new_with_bit_len(frame.payload_bytes(), frame.payload_bit_len()).unwrap();
        assert_eq!(reader.read_bit().unwrap(), false);
        assert_eq!(reader.read_bits(7).unwrap(), b'A' as u64);
        assert_eq!(reader.read_bits(7).unwrap(), b'B' as u64);
        assert_eq!(reader.read_bits(7).unwrap(), b'C' as u64);
        assert_eq!(reader.remaining_bits(), 0);

        assert!(verify_overall_crc(&output.frames).unwrap());
    }

    #[test]
    fn test_string_utf8_japanese() {
        let s = "あ";
        let output = encode_data(InputData::String(s), 120, ParityMode::None).unwrap();
        assert_eq!(output.frames.len(), 1);

        let frame = &output.frames[0];
        assert_eq!(frame.payload_bit_len(), 25);

        let mut reader =
            BitReader::new_with_bit_len(frame.payload_bytes(), frame.payload_bit_len()).unwrap();
        assert_eq!(reader.read_bit().unwrap(), true);
        assert_eq!(reader.read_bits(8).unwrap(), 0xE3);
        assert_eq!(reader.read_bits(8).unwrap(), 0x81);
        assert_eq!(reader.read_bits(8).unwrap(), 0x82);

        assert!(verify_overall_crc(&output.frames).unwrap());
    }

    #[test]
    fn test_string_mixed_ascii_and_non_ascii() {
        let s = "Aあ";
        let output = encode_data(InputData::String(s), 120, ParityMode::None).unwrap();
        assert_eq!(output.frames.len(), 1);

        let frame = &output.frames[0];
        assert_eq!(frame.payload_bit_len(), 33);

        let mut reader =
            BitReader::new_with_bit_len(frame.payload_bytes(), frame.payload_bit_len()).unwrap();
        assert_eq!(reader.read_bit().unwrap(), true);
        assert_eq!(reader.read_bits(8).unwrap(), 0x41);
        assert_eq!(reader.read_bits(8).unwrap(), 0xE3);
        assert_eq!(reader.read_bits(8).unwrap(), 0x81);
        assert_eq!(reader.read_bits(8).unwrap(), 0x82);

        assert!(verify_overall_crc(&output.frames).unwrap());
    }

    #[test]
    fn test_string_mode_bit_only_once_in_frame_0() {
        let s = "Hello World";
        let output = encode_data(InputData::String(s), 80, ParityMode::None).unwrap();
        assert_eq!(output.frames.len(), 3);

        let mut r0 = BitReader::new_with_bit_len(
            output.frames[0].payload_bytes(),
            output.frames[0].payload_bit_len(),
        )
        .unwrap();
        assert_eq!(r0.read_bit().unwrap(), false);

        assert_eq!(output.frames[0].payload_bit_len(), 29);
        assert_eq!(output.frames[1].payload_bit_len(), 49);
        assert_eq!(output.frames[2].payload_bit_len(), 0);

        let concat_writer = crate::frame::concat_data_payload_bits(&output.frames).unwrap();
        assert_eq!(concat_writer.bit_len(), 78);

        let mut full_reader =
            BitReader::new_with_bit_len(concat_writer.as_bytes(), concat_writer.bit_len()).unwrap();
        assert_eq!(full_reader.read_bit().unwrap(), false);
        for &b in s.as_bytes() {
            assert_eq!(full_reader.read_bits(7).unwrap(), b as u64);
        }
        assert_eq!(full_reader.remaining_bits(), 0);

        assert!(verify_overall_crc(&output.frames).unwrap());
    }

    #[test]
    fn test_frame_splitting_boundaries() {
        let data = [0xAA; 10]; // 80 bits

        let out_exact = encode_data(InputData::Uint8Array(&data), 80, ParityMode::None).unwrap();
        assert_eq!(out_exact.frames.len(), 3);
        assert_eq!(out_exact.frames[0].payload_bit_len(), 29);
        assert_eq!(out_exact.frames[1].payload_bit_len(), 51);
        assert_eq!(out_exact.frames[2].payload_bit_len(), 0);
        assert!(verify_overall_crc(&out_exact.frames).unwrap());

        let out_sub = encode_data(InputData::Uint8Array(&data), 72, ParityMode::None).unwrap();
        assert_eq!(out_sub.frames.len(), 3);
        assert_eq!(out_sub.frames[0].payload_bit_len(), 21);
        assert_eq!(out_sub.frames[1].payload_bit_len(), 46);
        assert_eq!(out_sub.frames[2].payload_bit_len(), 13);
        assert!(verify_overall_crc(&out_sub.frames).unwrap());

        let out_plus = encode_data(InputData::Uint8Array(&data), 96, ParityMode::None).unwrap();
        assert_eq!(out_plus.frames.len(), 2);
        assert_eq!(out_plus.frames[0].payload_bit_len(), 46);
        assert_eq!(out_plus.frames[1].payload_bit_len(), 34);
        assert!(verify_overall_crc(&out_plus.frames).unwrap());
    }

    #[test]
    fn test_final_frame_ending_mid_byte() {
        let data = [0xFF, 0xF0, 0xA0];
        let output = encode_data(InputData::Uint8Array(&data), 64, ParityMode::None).unwrap();

        assert_eq!(output.frames.len(), 3);
        assert_eq!(output.frames[0].payload_bit_len(), 13);
        assert_eq!(output.frames[1].payload_bit_len(), 11);
        assert_eq!(output.frames[2].payload_bit_len(), 0);
        assert!(verify_overall_crc(&output.frames).unwrap());

        let concat_writer = crate::frame::concat_data_payload_bits(&output.frames).unwrap();
        assert_eq!(concat_writer.bit_len(), 24);
        assert_eq!(concat_writer.as_bytes(), &data);
    }

    #[test]
    fn test_roundtrip_all_wire_bytes() {
        let text = "Hello QR Data Transport Protocol!";
        let output = encode_data(InputData::String(text), 50, ParityMode::None).unwrap();

        assert_eq!(output.frames.len(), output.wire_bytes.len());

        let decoded_0 = decode_frame(&output.wire_bytes[0], None).unwrap();
        assert_eq!(decoded_0, output.frames[0]);
        let first_crc = decoded_0.frame_crc();

        let mut decoded_frames = vec![decoded_0];

        for i in 1..output.frames.len() {
            let ctx = DecodeContext {
                total_qr_count: Some(output.frames.len() as u32),
                first_frame_crc: Some(first_crc),
                parity_mode: Some(ParityMode::None),
            };
            let decoded_i = decode_frame(&output.wire_bytes[i], Some(&ctx)).unwrap();
            assert_eq!(decoded_i, output.frames[i]);
            decoded_frames.push(decoded_i);
        }

        assert!(verify_overall_crc(&decoded_frames).unwrap());
    }

    #[test]
    fn test_parity_mode_8_interleaving_structure() {
        let data = vec![0xAB; 100];
        let output = encode_data(InputData::Uint8Array(&data), 120, ParityMode::Group8).unwrap();

        assert!(output.frames.len() > 3);
        assert_eq!(output.frames[0].frame_number(), 0);
        assert_eq!(
            output.frames.last().unwrap().frame_number(),
            output.frames.len() as u32 - 1
        );

        assert!(verify_overall_crc(&output.frames).unwrap());
    }
}
