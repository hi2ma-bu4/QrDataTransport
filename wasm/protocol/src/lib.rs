#[allow(warnings)]
mod bindings;

pub mod bit_stream;
pub mod crc;
pub mod decoder;
pub mod encoder;
pub mod frame;
pub mod varint;

use bindings::exports::snows::qr_data_transport::protocol::{
    DataType, DecodedPayload, EncodeResult, EncodedFrameOutput, FrameMetadata, Guest, QrEcLevel,
    QrModuleMatrix,
};
use decoder::{DecodedData, decode_data};
use encoder::{InputData, encode_data};
use frame::{DecodeContext, ParityMode, decode_frame, parse_frame_metadata};
use qrcodegen::{QrCode, QrCodeEcc, QrSegment, Version};
use rxing::{BinaryBitmap, MultiFormatReader, RGBLuminanceSource, Reader};

struct Component;

/// Helper function to encode `InputData` into `EncodeResult`.
fn encode_input(
    input: InputData,
    max_frame_bits: u32,
    parity_mode_raw: u8,
) -> Result<EncodeResult, String> {
    let parity_mode = ParityMode::from_u8(parity_mode_raw).map_err(|e| e.to_string())?;

    let output =
        encode_data(input, max_frame_bits as usize, parity_mode).map_err(|e| e.to_string())?;

    let total_qr_count = output.frames.len() as u32;
    let frames = output
        .wire_bytes
        .into_iter()
        .enumerate()
        .map(|(idx, wire)| EncodedFrameOutput {
            wire_bytes: wire,
            frame_number: idx as u32,
            total_qr_count,
        })
        .collect();

    Ok(EncodeResult { frames })
}

impl Guest for Component {
    fn encode_bytes(
        data: Vec<u8>,
        max_frame_bits: u32,
        parity_mode: u8,
    ) -> Result<EncodeResult, String> {
        encode_input(InputData::Uint8Array(&data), max_frame_bits, parity_mode)
    }

    fn encode_text(
        text: String,
        max_frame_bits: u32,
        parity_mode: u8,
    ) -> Result<EncodeResult, String> {
        encode_input(InputData::String(&text), max_frame_bits, parity_mode)
    }

    fn parse_frame(
        wire_bytes: Vec<u8>,
        known_total_qr_count: Option<u32>,
        known_first_frame_crc: Option<u16>,
        known_parity_mode: Option<u8>,
    ) -> Result<FrameMetadata, String> {
        let parsed_parity_mode = match known_parity_mode {
            Some(pm) => Some(ParityMode::from_u8(pm).map_err(|e| e.to_string())?),
            None => None,
        };

        // Parse metadata
        let raw_meta = parse_frame_metadata(&wire_bytes, known_total_qr_count, parsed_parity_mode)
            .map_err(|e| e.to_string())?;

        // Perform full frame decoding to verify frame CRC
        let ctx = if known_total_qr_count.is_some() || known_first_frame_crc.is_some() {
            Some(DecodeContext {
                total_qr_count: known_total_qr_count,
                first_frame_crc: known_first_frame_crc,
                parity_mode: parsed_parity_mode.or(raw_meta.parity_mode),
            })
        } else {
            None
        };

        let decoded_res = decode_frame(&wire_bytes, ctx.as_ref());
        let crc_valid = decoded_res.is_ok();

        let (frame_crc, overall_crc) = match decoded_res {
            Ok(ref f) => (f.frame_crc(), f.overall_crc()),
            Err(_) => (0, None),
        };

        let data_type = raw_meta.data_type.map(|dt| match dt {
            frame::DataType::Uint8Array => DataType::Uint8array,
            frame::DataType::String => DataType::BytesString,
        });

        let pm_u8 = raw_meta.parity_mode.map(|m| m.to_wire_bits());

        Ok(FrameMetadata {
            is_first: raw_meta.is_first,
            is_parity: raw_meta.is_parity,
            version: raw_meta.version.unwrap_or(0),
            total_qr_count: raw_meta.total_qr_count.unwrap_or(0),
            frame_number: raw_meta.frame_number,
            parity_mode: pm_u8,
            data_type,
            payload_bit_len: raw_meta.payload_bit_len as u32,
            frame_crc,
            overall_crc,
            crc_valid,
        })
    }

    fn decode_frames(wire_frames: Vec<Vec<u8>>) -> Result<DecodedPayload, String> {
        if wire_frames.is_empty() {
            return Err("wire_frames cannot be empty".to_string());
        }

        // Decode first frame to establish communication context
        let first_frame = decode_frame(&wire_frames[0], None).map_err(|e| e.to_string())?;
        let first_frame_crc = first_frame.frame_crc();
        let total_qr_count = first_frame.total_qr_count();
        let parity_mode = first_frame.parity_mode();

        if first_frame.frame_number() != 0 {
            return Err("First frame must have frame_number 0".to_string());
        }

        let mut parsed_frames = Vec::with_capacity(wire_frames.len());
        parsed_frames.push(first_frame);

        for (idx, wire) in wire_frames[1..].iter().enumerate() {
            let ctx = DecodeContext {
                total_qr_count: Some(total_qr_count),
                first_frame_crc: Some(first_frame_crc),
                parity_mode,
            };
            let frame = decode_frame(wire, Some(&ctx)).map_err(|e| e.to_string())?;

            if frame.total_qr_count() != total_qr_count {
                return Err(format!(
                    "Mismatched total_qr_count in frame {}: expected {}, got {}",
                    idx + 1,
                    total_qr_count,
                    frame.total_qr_count()
                ));
            }

            parsed_frames.push(frame);
        }

        let decoded = decode_data(&parsed_frames).map_err(|e| e.to_string())?;

        match decoded {
            DecodedData::Uint8Array(bytes) => Ok(DecodedPayload::Bytes(bytes)),
            DecodedData::String(text) => Ok(DecodedPayload::Text(text)),
        }
    }

    fn generate_qr_matrix(
        wire_bytes: Vec<u8>,
        qr_version: u8,
        ec_level: QrEcLevel,
    ) -> Result<QrModuleMatrix, String> {
        let ecl = match ec_level {
            QrEcLevel::L => QrCodeEcc::Low,
            QrEcLevel::M => QrCodeEcc::Medium,
            QrEcLevel::Q => QrCodeEcc::Quartile,
            QrEcLevel::H => QrCodeEcc::High,
        };

        let seg = QrSegment::make_bytes(&wire_bytes);
        let segs = [seg];

        let qr = if (1..=40).contains(&qr_version) {
            let ver = Version::new(qr_version);
            QrCode::encode_segments_advanced(&segs, ecl, ver, ver, None, false)
        } else {
            let min_ver = Version::new(1);
            let max_ver = Version::new(40);
            QrCode::encode_segments_advanced(&segs, ecl, min_ver, max_ver, None, false)
        }
        .map_err(|e| e.to_string())?;

        let size = qr.size() as usize;

        let mut modules = Vec::with_capacity(size * size);
        for y in 0..size as i32 {
            for x in 0..size as i32 {
                modules.push(if qr.get_module(x, y) { 1 } else { 0 });
            }
        }

        Ok(QrModuleMatrix {
            width: size as u32,
            height: size as u32,
            modules,
        })
    }

    fn decode_qr_image(rgba_pixels: Vec<u8>, width: u32, height: u32) -> Result<Vec<u8>, String> {
        let expected_len = (width as usize)
            .checked_mul(height as usize)
            .and_then(|wh| wh.checked_mul(4))
            .ok_or("Image dimensions too large")?;

        if rgba_pixels.len() != expected_len {
            return Err("Invalid RGBA pixel array length".to_string());
        }

        let num_pixels = (width as usize) * (height as usize);
        let mut pixels = Vec::with_capacity(num_pixels);

        for chunk in rgba_pixels.chunks_exact(4) {
            let r = chunk[0] as u32;
            let g = chunk[1] as u32;
            let b = chunk[2] as u32;
            let a = chunk[3] as u32;
            let argb = (a << 24) | (r << 16) | (g << 8) | b;
            pixels.push(argb);
        }

        let source = RGBLuminanceSource::new_with_width_height_pixels(
            width as usize,
            height as usize,
            &pixels,
        )
        .map_err(|e| e.to_string())?;

        let binarizer = rxing::common::HybridBinarizer::new(source);
        let mut bitmap = BinaryBitmap::new(binarizer);

        let mut reader = MultiFormatReader::default();
        let result = reader.decode(&mut bitmap).map_err(|e| e.to_string())?;

        Ok(result.getRawBytes().to_vec())
    }
}

bindings::export!(Component with_types_in bindings);
