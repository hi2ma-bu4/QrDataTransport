#[allow(warnings)]
mod bindings;

pub mod bit_stream;
pub mod crc;
pub mod decoder;
pub mod encoder;
pub mod frame;
pub mod varint;

use bindings::exports::snows::qr_data_transport::protocol::Guest;

struct Component;

impl Guest for Component {
    /// [仮定義] これは型定義サンプルです。実際のデータ構造に合わせて変更してください。そのまま使用してはいけません。
    fn decode(data: Vec<u8>) -> Vec<u8> {
        data
    }
}

bindings::export!(Component with_types_in bindings);
