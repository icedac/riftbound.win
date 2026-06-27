use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Card {
    pub id: String,
    pub slug: String,
    pub name: String,
    pub effect_html: Option<String>,
    pub effect_text: String,
    pub flavor: Option<String>,
    pub colors: Vec<String>,
    pub cost: Option<String>,
    pub card_type: Option<String>,
    pub supertype: Option<String>,
    pub might: Option<String>,
    pub tags: Vec<String>,
    pub set_name: Option<String>,
    pub rarity: Option<String>,
    pub cycle: Option<String>,
    pub image_url: Option<String>,
    pub local_image: Option<String>,
    pub image_width: Option<u32>,
    pub image_height: Option<u32>,
    pub image_orientation: Option<String>,
    pub image_back_url: Option<String>,
    pub local_image_back: Option<String>,
    pub image_back_width: Option<u32>,
    pub image_back_height: Option<u32>,
    pub image_back_orientation: Option<String>,
    pub has_back: bool,
    pub has_normal: bool,
    pub has_foil: bool,
    pub banned: bool,
    pub promo: bool,
    pub price: Option<String>,
    pub foil_price: Option<String>,
    pub cardmarket_url: Option<String>,
    pub raw: Value,
}

#[derive(Debug, Deserialize)]
struct IndexedPayload {
    names: Vec<String>,
    data: Vec<Vec<Value>>,
}

pub fn decode_indexed_cards(payload: &str) -> Result<Vec<Card>> {
    let payload: IndexedPayload =
        serde_json::from_str(payload).context("failed to parse indexed card payload")?;
    let index = payload
        .names
        .iter()
        .enumerate()
        .map(|(idx, name)| (name.as_str(), idx))
        .collect::<HashMap<_, _>>();

    payload
        .data
        .into_iter()
        .map(|row| decode_row(&index, row))
        .collect()
}

pub fn local_image_path(url: &str) -> Option<String> {
    let without_query = url.split('?').next().unwrap_or_default();
    let filename = without_query.rsplit('/').next().unwrap_or_default();
    if filename.trim().is_empty() {
        None
    } else {
        Some(format!("/images/cards/{filename}"))
    }
}

pub fn local_image_file_name(url: &str) -> Option<String> {
    local_image_path(url).and_then(|path| path.rsplit('/').next().map(str::to_string))
}

fn decode_row(index: &HashMap<&str, usize>, row: Vec<Value>) -> Result<Card> {
    let raw = row_to_object(index, &row);
    let id = string_field(index, &row, "id").context("card row is missing id")?;
    let slug = string_field(index, &row, "slug").unwrap_or_else(|| id.to_lowercase());
    let name = string_field(index, &row, "name").unwrap_or_else(|| id.clone());
    let effect_html = string_field(index, &row, "effect");
    let effect_text = effect_html
        .as_deref()
        .map(htmlish_to_text)
        .unwrap_or_default();
    let image_url = string_field(index, &row, "image");
    let image_back_url = string_field(index, &row, "image_back");

    Ok(Card {
        id,
        slug,
        name,
        effect_html,
        effect_text,
        flavor: string_field(index, &row, "flavor"),
        colors: array_string_field(index, &row, "color"),
        cost: string_field(index, &row, "cost"),
        card_type: string_field(index, &row, "type"),
        supertype: string_field(index, &row, "supertype"),
        might: string_field(index, &row, "might"),
        tags: array_string_field(index, &row, "tags"),
        set_name: string_field(index, &row, "set_name"),
        rarity: string_field(index, &row, "rarity"),
        cycle: string_field(index, &row, "cycle"),
        local_image: image_url.as_deref().and_then(local_image_path),
        image_url,
        image_width: None,
        image_height: None,
        image_orientation: None,
        local_image_back: image_back_url.as_deref().and_then(local_image_path),
        image_back_url,
        image_back_width: None,
        image_back_height: None,
        image_back_orientation: None,
        has_back: bool_field(index, &row, "hasback"),
        has_normal: bool_field(index, &row, "hasNormal"),
        has_foil: bool_field(index, &row, "hasFoil"),
        banned: bool_field(index, &row, "banned"),
        promo: bool_field(index, &row, "promo"),
        price: string_field(index, &row, "price"),
        foil_price: string_field(index, &row, "foilPrice"),
        cardmarket_url: string_field(index, &row, "cmurl"),
        raw,
    })
}

fn row_to_object(index: &HashMap<&str, usize>, row: &[Value]) -> Value {
    let mut object = serde_json::Map::new();
    for (name, idx) in index {
        object.insert(
            (*name).to_string(),
            row.get(*idx).cloned().unwrap_or(Value::Null),
        );
    }
    Value::Object(object)
}

fn value_field<'a>(
    index: &HashMap<&str, usize>,
    row: &'a [Value],
    name: &str,
) -> Option<&'a Value> {
    index.get(name).and_then(|idx| row.get(*idx))
}

fn string_field(index: &HashMap<&str, usize>, row: &[Value], name: &str) -> Option<String> {
    match value_field(index, row, name) {
        Some(Value::String(value)) if !value.trim().is_empty() => Some(value.to_string()),
        Some(Value::Number(value)) => Some(value.to_string()),
        _ => None,
    }
}

fn array_string_field(index: &HashMap<&str, usize>, row: &[Value], name: &str) -> Vec<String> {
    match value_field(index, row, name) {
        Some(Value::Array(values)) => values
            .iter()
            .filter_map(|value| value.as_str())
            .filter(|value| !value.trim().is_empty())
            .map(str::to_string)
            .collect(),
        Some(Value::String(value)) if !value.trim().is_empty() => vec![value.to_string()],
        _ => Vec::new(),
    }
}

fn bool_field(index: &HashMap<&str, usize>, row: &[Value], name: &str) -> bool {
    match value_field(index, row, name) {
        Some(Value::Bool(value)) => *value,
        Some(Value::Number(value)) => value.as_i64().unwrap_or_default() != 0,
        Some(Value::String(value)) => matches!(value.as_str(), "1" | "true" | "TRUE" | "yes"),
        _ => false,
    }
}

fn htmlish_to_text(value: &str) -> String {
    value
        .replace("<br />", "\n")
        .replace("<br/>", "\n")
        .replace("<br>", "\n")
        .replace("&quot;", "\"")
        .replace("&amp;", "&")
        .replace("&apos;", "'")
}
