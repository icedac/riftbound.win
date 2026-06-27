use riftbound_sim::card::{decode_indexed_cards, local_image_path};

#[test]
fn decodes_dotgg_indexed_rows_into_named_cards() {
    let payload = r#"{
        "names": ["id", "slug", "name", "effect", "color", "type", "set_name", "rarity", "image", "image_back", "hasback", "hasNormal", "hasFoil"],
        "data": [[
            "UNL-131",
            "unl-131-abandon",
            "Abandon",
            "[Reaction]<br />Counter a spell.",
            ["Chaos"],
            "Spell",
            "Unleashed",
            "Uncommon",
            "https://static.dotgg.gg/riftbound/cards/UNL-131.webp",
            null,
            "0",
            "1",
            "0"
        ]]
    }"#;

    let cards = decode_indexed_cards(payload).expect("payload decodes");

    assert_eq!(cards.len(), 1);
    assert_eq!(cards[0].id, "UNL-131");
    assert_eq!(cards[0].name, "Abandon");
    assert_eq!(cards[0].effect_text, "[Reaction]\nCounter a spell.");
    assert_eq!(cards[0].colors, vec!["Chaos"]);
    assert_eq!(cards[0].card_type.as_deref(), Some("Spell"));
    assert_eq!(cards[0].set_name.as_deref(), Some("Unleashed"));
    assert_eq!(cards[0].rarity.as_deref(), Some("Uncommon"));
    assert_eq!(
        cards[0].image_url.as_deref(),
        Some("https://static.dotgg.gg/riftbound/cards/UNL-131.webp")
    );
    assert_eq!(
        cards[0].local_image.as_deref(),
        Some("/images/cards/UNL-131.webp")
    );
    assert_eq!(cards[0].local_image_back, None);
    assert!(cards[0].has_normal);
    assert!(!cards[0].has_foil);
}

#[test]
fn derives_stable_local_image_paths_from_urls() {
    assert_eq!(
        local_image_path("https://static.dotgg.gg/riftbound/cards/OGN-001-back.webp"),
        Some("/images/cards/OGN-001-back.webp".to_string())
    );
    assert_eq!(local_image_path(""), None);
    assert_eq!(local_image_path("https://example.com/cards/"), None);
}
