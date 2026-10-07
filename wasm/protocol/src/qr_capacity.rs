#[derive(Debug, Clone, Copy)]
pub enum QrEcLevel {
    L,
    M,
    Q,
    H,
}

/// Returns the number of data bits available in a QR Code.
///
/// This matches qrcodegen 1.8.0's internal
/// `QrCode::get_num_data_codewords()` calculation.
pub fn max_frame_bits(qr_version: u8, ec_level: QrEcLevel) -> usize {
    assert!(
        (1..=40).contains(&qr_version),
        "QR version must be between 1 and 40"
    );

    let version = qr_version as usize;

    let mut raw_data_modules = (16 * version + 128) * version + 64;

    if version >= 2 {
        let num_align = version / 7 + 2;
        raw_data_modules -= (25 * num_align - 10) * num_align - 55;

        if version >= 7 {
            raw_data_modules -= 36;
        }
    }

    const ECC_CODEWORDS_PER_BLOCK: [[usize; 41]; 4] = [
        [
            0, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28,
            28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
        ],
        [
            0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26,
            28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28,
        ],
        [
            0, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28,
            30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
        ],
        [
            0, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30,
            24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
        ],
    ];

    const NUM_ERROR_CORRECTION_BLOCKS: [[usize; 41]; 4] = [
        [
            0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12,
            13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25,
        ],
        [
            0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20,
            21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49,
        ],
        [
            0, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27,
            29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68,
        ],
        [
            0, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30,
            32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81,
        ],
    ];

    let ec_index = match ec_level {
        QrEcLevel::L => 0,
        QrEcLevel::M => 1,
        QrEcLevel::Q => 2,
        QrEcLevel::H => 3,
    };

    let raw_codewords = raw_data_modules / 8;

    let data_codewords = raw_codewords
        - ECC_CODEWORDS_PER_BLOCK[ec_index][version]
            * NUM_ERROR_CORRECTION_BLOCKS[ec_index][version];

    data_codewords * 8
}
