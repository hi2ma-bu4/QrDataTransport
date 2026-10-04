#[allow(warnings)]
mod bindings;

use bindings::exports::snows::qr_data_transport::protocol::Guest;

struct Component;

impl Guest for Component {
    /// [仮定義] これは型定義サンプルです。実際のデータ構造に合わせて変更してください。そのまま使用してはいけません。
    fn decode(data: Vec<u8>) -> Vec<u8> {
        data
    }
}

bindings::export!(Component with_types_in bindings);
