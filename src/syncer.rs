use crate::card::{Card, decode_indexed_cards, local_image_file_name};
use crate::image_metadata::read_webp_dimensions;
use crate::storage::{init_db, upsert_cards};
use anyhow::{Context, Result, anyhow};
use futures::stream::{self, StreamExt};
use reqwest::Client;
use rusqlite::Connection;
use serde::Serialize;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::Mutex;

pub const DEFAULT_API_URL: &str =
    "https://api.dotgg.gg/cgfw/getcards?game=riftbound&mode=indexed&cache=17554";

#[derive(Debug, Clone)]
pub struct SyncOptions {
    pub api_url: String,
    pub db_path: PathBuf,
    pub public_dir: PathBuf,
    pub image_concurrency: usize,
}

impl Default for SyncOptions {
    fn default() -> Self {
        Self {
            api_url: DEFAULT_API_URL.to_string(),
            db_path: PathBuf::from("data/riftbound.sqlite"),
            public_dir: PathBuf::from("public"),
            image_concurrency: 16,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ImageTarget {
    pub url: String,
    pub relative_path: String,
}

#[derive(Debug, Default, Clone, Serialize)]
pub struct SyncSummary {
    pub cards: usize,
    pub image_targets: usize,
    pub images_downloaded: usize,
    pub images_cached: usize,
    pub images_failed: usize,
    pub database: String,
    pub public_dir: String,
}

#[derive(Debug, Default, Clone)]
struct ImageCounts {
    downloaded: usize,
    cached: usize,
    failed: Vec<String>,
}

pub async fn sync_cards(options: SyncOptions) -> Result<SyncSummary> {
    let client = Client::builder()
        .user_agent("riftbound-sim/0.1")
        .build()
        .context("failed to build HTTP client")?;

    let body = client
        .get(&options.api_url)
        .send()
        .await
        .context("failed to fetch DotGG card index")?
        .error_for_status()
        .context("DotGG card index returned an error status")?
        .text()
        .await
        .context("failed to read DotGG card index response")?;

    let mut cards = decode_indexed_cards(&body)?;
    if let Some(parent) = options.db_path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .with_context(|| format!("failed to create {}", parent.display()))?;
    }
    tokio::fs::create_dir_all(&options.public_dir)
        .await
        .with_context(|| format!("failed to create {}", options.public_dir.display()))?;

    let targets = image_targets(&cards);
    let counts = download_images(
        client,
        &options.public_dir,
        targets.clone(),
        options.image_concurrency.max(1),
    )
    .await;
    enrich_image_metadata(&mut cards, &options.public_dir).await?;

    let mut conn = Connection::open(&options.db_path)
        .with_context(|| format!("failed to open {}", options.db_path.display()))?;
    init_db(&conn)?;
    upsert_cards(&mut conn, &cards)?;
    export_cards_json(&options.public_dir, &cards).await?;

    Ok(SyncSummary {
        cards: cards.len(),
        image_targets: targets.len(),
        images_downloaded: counts.downloaded,
        images_cached: counts.cached,
        images_failed: counts.failed.len(),
        database: options.db_path.display().to_string(),
        public_dir: options.public_dir.display().to_string(),
    })
}

async fn enrich_image_metadata(cards: &mut [Card], public_dir: &Path) -> Result<()> {
    for card in cards {
        if let Some(local_image) = &card.local_image {
            if let Some(dimensions) = dimensions_for_local_path(public_dir, local_image).await? {
                card.image_width = Some(dimensions.width);
                card.image_height = Some(dimensions.height);
                card.image_orientation = Some(dimensions.orientation.as_str().to_string());
            }
        }
        if let Some(local_image_back) = &card.local_image_back {
            if let Some(dimensions) =
                dimensions_for_local_path(public_dir, local_image_back).await?
            {
                card.image_back_width = Some(dimensions.width);
                card.image_back_height = Some(dimensions.height);
                card.image_back_orientation = Some(dimensions.orientation.as_str().to_string());
            }
        }
    }
    Ok(())
}

async fn dimensions_for_local_path(
    public_dir: &Path,
    local_path: &str,
) -> Result<Option<crate::image_metadata::ImageDimensions>> {
    let relative_path = local_path.trim_start_matches('/');
    let path = public_dir.join(relative_path);
    if !path.exists() {
        return Ok(None);
    }
    read_webp_dimensions(&path).await.map(Some)
}

pub fn image_targets(cards: &[Card]) -> Vec<ImageTarget> {
    let mut targets = BTreeMap::new();
    for card in cards {
        for url in [&card.image_url, &card.image_back_url]
            .into_iter()
            .flatten()
        {
            if let Some(filename) = local_image_file_name(url) {
                targets.insert(
                    format!("images/cards/{filename}"),
                    ImageTarget {
                        url: url.to_string(),
                        relative_path: format!("images/cards/{filename}"),
                    },
                );
            }
        }
    }
    targets.into_values().collect()
}

pub fn image_url_candidates(url: &str) -> Vec<String> {
    let mut candidates = vec![url.to_string()];
    if let Some(alias) = dotgg_promo_alias(url) {
        if alias != url {
            candidates.push(alias);
        }
    }
    candidates
}

fn dotgg_promo_alias(url: &str) -> Option<String> {
    let slash_idx = url.rfind('/')?;
    let (prefix, filename) = url.split_at(slash_idx + 1);
    let stem = filename.strip_suffix("-P.webp")?;
    let last = stem.chars().last()?;
    if !last.is_ascii_lowercase() {
        return None;
    }

    let mut alias_stem = stem.to_string();
    alias_stem.pop();
    Some(format!("{prefix}{alias_stem}-P.webp"))
}

async fn export_cards_json(public_dir: &Path, cards: &[Card]) -> Result<()> {
    let mut exported = cards.to_vec();
    exported.sort_by(|a, b| {
        a.name
            .to_lowercase()
            .cmp(&b.name.to_lowercase())
            .then_with(|| a.id.cmp(&b.id))
    });
    let json = serde_json::to_string_pretty(&exported)?;
    tokio::fs::write(public_dir.join("cards.json"), json)
        .await
        .with_context(|| {
            format!(
                "failed to write {}",
                public_dir.join("cards.json").display()
            )
        })
}

async fn download_images(
    client: Client,
    public_dir: &Path,
    targets: Vec<ImageTarget>,
    concurrency: usize,
) -> ImageCounts {
    let counts = Arc::new(Mutex::new(ImageCounts::default()));
    let public_dir = public_dir.to_path_buf();

    stream::iter(targets)
        .for_each_concurrent(concurrency, |target| {
            let client = client.clone();
            let public_dir = public_dir.clone();
            let counts = Arc::clone(&counts);
            async move {
                match download_one_image(&client, &public_dir, &target).await {
                    Ok(ImageStatus::Downloaded) => {
                        counts.lock().await.downloaded += 1;
                    }
                    Ok(ImageStatus::Cached) => {
                        counts.lock().await.cached += 1;
                    }
                    Err(error) => {
                        counts
                            .lock()
                            .await
                            .failed
                            .push(format!("{}: {error:#}", target.url));
                    }
                }
            }
        })
        .await;

    match Arc::try_unwrap(counts) {
        Ok(counts) => counts.into_inner(),
        Err(counts) => counts.lock().await.clone(),
    }
}

enum ImageStatus {
    Downloaded,
    Cached,
}

async fn download_one_image(
    client: &Client,
    public_dir: &Path,
    target: &ImageTarget,
) -> Result<ImageStatus> {
    let path = public_dir.join(&target.relative_path);
    if path.exists() && path.metadata().map(|metadata| metadata.len()).unwrap_or(0) > 0 {
        return Ok(ImageStatus::Cached);
    }
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .with_context(|| format!("failed to create {}", parent.display()))?;
    }

    let mut errors = Vec::new();
    for url in image_url_candidates(&target.url) {
        let response = match client.get(&url).send().await {
            Ok(response) => response,
            Err(error) => {
                errors.push(format!("{url}: {error:#}"));
                continue;
            }
        };
        let response = match response.error_for_status() {
            Ok(response) => response,
            Err(error) => {
                errors.push(format!("{url}: {error:#}"));
                continue;
            }
        };
        let bytes = response
            .bytes()
            .await
            .with_context(|| format!("failed to read image body: {url}"))?;

        tokio::fs::write(&path, bytes)
            .await
            .with_context(|| format!("failed to write {}", path.display()))?;
        return Ok(ImageStatus::Downloaded);
    }

    Err(anyhow!(
        "failed to download any image candidate for {}: {}",
        target.url,
        errors.join("; ")
    ))
}
