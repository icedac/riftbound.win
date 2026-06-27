use riftbound_sim::image_metadata::{ImageOrientation, parse_webp_dimensions};

#[test]
fn parses_vp8x_webp_dimensions_and_orientation() {
    let mut bytes = Vec::new();
    bytes.extend_from_slice(b"RIFF");
    bytes.extend_from_slice(&22u32.to_le_bytes());
    bytes.extend_from_slice(b"WEBP");
    bytes.extend_from_slice(b"VP8X");
    bytes.extend_from_slice(&10u32.to_le_bytes());
    bytes.extend_from_slice(&[0, 0, 0, 0]);
    bytes.extend_from_slice(&(1039u32 - 1).to_le_bytes()[0..3]);
    bytes.extend_from_slice(&(744u32 - 1).to_le_bytes()[0..3]);

    let dimensions = parse_webp_dimensions(&bytes).expect("valid vp8x webp");

    assert_eq!(dimensions.width, 1039);
    assert_eq!(dimensions.height, 744);
    assert_eq!(dimensions.orientation, ImageOrientation::Landscape);
}

#[test]
fn parses_vp8l_webp_dimensions_and_orientation() {
    let width_minus_one = 744u32 - 1;
    let height_minus_one = 1039u32 - 1;
    let bits = width_minus_one | (height_minus_one << 14);
    let mut bytes = Vec::new();
    bytes.extend_from_slice(b"RIFF");
    bytes.extend_from_slice(&17u32.to_le_bytes());
    bytes.extend_from_slice(b"WEBP");
    bytes.extend_from_slice(b"VP8L");
    bytes.extend_from_slice(&5u32.to_le_bytes());
    bytes.push(0x2f);
    bytes.extend_from_slice(&bits.to_le_bytes());

    let dimensions = parse_webp_dimensions(&bytes).expect("valid vp8l webp");

    assert_eq!(dimensions.width, 744);
    assert_eq!(dimensions.height, 1039);
    assert_eq!(dimensions.orientation, ImageOrientation::Portrait);
}
