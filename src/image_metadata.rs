use anyhow::{Context, Result, anyhow};
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ImageOrientation {
    Portrait,
    Landscape,
    Square,
}

impl ImageOrientation {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Portrait => "portrait",
            Self::Landscape => "landscape",
            Self::Square => "square",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct ImageDimensions {
    pub width: u32,
    pub height: u32,
    pub orientation: ImageOrientation,
}

impl ImageDimensions {
    fn new(width: u32, height: u32) -> Self {
        let orientation = match width.cmp(&height) {
            std::cmp::Ordering::Less => ImageOrientation::Portrait,
            std::cmp::Ordering::Greater => ImageOrientation::Landscape,
            std::cmp::Ordering::Equal => ImageOrientation::Square,
        };
        Self {
            width,
            height,
            orientation,
        }
    }
}

pub async fn read_webp_dimensions(path: &Path) -> Result<ImageDimensions> {
    let bytes = tokio::fs::read(path)
        .await
        .with_context(|| format!("failed to read image {}", path.display()))?;
    parse_webp_dimensions(&bytes).with_context(|| format!("failed to parse {}", path.display()))
}

pub fn parse_webp_dimensions(bytes: &[u8]) -> Result<ImageDimensions> {
    if bytes.len() < 20 || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WEBP" {
        return Err(anyhow!("not a RIFF WEBP image"));
    }

    let mut offset = 12usize;
    while offset + 8 <= bytes.len() {
        let chunk = &bytes[offset..offset + 4];
        let chunk_size = read_u32_le(bytes, offset + 4)? as usize;
        let data_start = offset + 8;
        let data_end = data_start.saturating_add(chunk_size);
        if data_end > bytes.len() {
            return Err(anyhow!("WEBP chunk exceeds file length"));
        }

        match chunk {
            b"VP8X" => return parse_vp8x(&bytes[data_start..data_end]),
            b"VP8L" => return parse_vp8l(&bytes[data_start..data_end]),
            b"VP8 " => return parse_vp8(&bytes[data_start..data_end]),
            _ => {
                offset = data_end + (chunk_size % 2);
            }
        }
    }

    Err(anyhow!("no supported WEBP dimension chunk found"))
}

fn parse_vp8x(data: &[u8]) -> Result<ImageDimensions> {
    if data.len() < 10 {
        return Err(anyhow!("VP8X chunk too small"));
    }
    let width = read_u24_le(data, 4)? + 1;
    let height = read_u24_le(data, 7)? + 1;
    Ok(ImageDimensions::new(width, height))
}

fn parse_vp8l(data: &[u8]) -> Result<ImageDimensions> {
    if data.len() < 5 || data[0] != 0x2f {
        return Err(anyhow!("invalid VP8L header"));
    }
    let bits = u32::from_le_bytes([data[1], data[2], data[3], data[4]]);
    let width = (bits & 0x3fff) + 1;
    let height = ((bits >> 14) & 0x3fff) + 1;
    Ok(ImageDimensions::new(width, height))
}

fn parse_vp8(data: &[u8]) -> Result<ImageDimensions> {
    if data.len() < 10 {
        return Err(anyhow!("VP8 chunk too small"));
    }
    let start = data
        .windows(3)
        .position(|window| window == [0x9d, 0x01, 0x2a])
        .ok_or_else(|| anyhow!("VP8 start code not found"))?;
    if start + 7 > data.len() {
        return Err(anyhow!("VP8 frame header too small"));
    }
    let width = u16::from_le_bytes([data[start + 3], data[start + 4]]) as u32 & 0x3fff;
    let height = u16::from_le_bytes([data[start + 5], data[start + 6]]) as u32 & 0x3fff;
    Ok(ImageDimensions::new(width, height))
}

fn read_u24_le(bytes: &[u8], offset: usize) -> Result<u32> {
    if offset + 3 > bytes.len() {
        return Err(anyhow!("not enough bytes for u24"));
    }
    Ok(bytes[offset] as u32
        | ((bytes[offset + 1] as u32) << 8)
        | ((bytes[offset + 2] as u32) << 16))
}

fn read_u32_le(bytes: &[u8], offset: usize) -> Result<u32> {
    if offset + 4 > bytes.len() {
        return Err(anyhow!("not enough bytes for u32"));
    }
    Ok(u32::from_le_bytes([
        bytes[offset],
        bytes[offset + 1],
        bytes[offset + 2],
        bytes[offset + 3],
    ]))
}
