use riftbound_sim::card::decode_indexed_cards;
use riftbound_sim::syncer::{image_targets, image_url_candidates};

#[test]
fn image_targets_include_front_and_back_once() {
    let payload = r#"{
        "names": ["id", "slug", "name", "image", "image_back"],
        "data": [
            ["A-001", "a-001-alpha", "Alpha", "https://static.dotgg.gg/riftbound/cards/A-001.webp", "https://static.dotgg.gg/riftbound/cards/A-001-back.webp"],
            ["A-001B", "a-001b-alpha", "Alpha Alt", "https://static.dotgg.gg/riftbound/cards/A-001.webp", null]
        ]
    }"#;
    let cards = decode_indexed_cards(payload).expect("decode fixture");

    let targets = image_targets(&cards);

    assert_eq!(targets.len(), 2);
    assert_eq!(
        targets[0].url,
        "https://static.dotgg.gg/riftbound/cards/A-001-back.webp"
    );
    assert_eq!(targets[0].relative_path, "images/cards/A-001-back.webp");
    assert_eq!(
        targets[1].url,
        "https://static.dotgg.gg/riftbound/cards/A-001.webp"
    );
    assert_eq!(targets[1].relative_path, "images/cards/A-001.webp");
}

#[test]
fn image_url_candidates_include_dotgg_promo_alias() {
    let candidates =
        image_url_candidates("https://static.dotgg.gg/riftbound/cards/OGN-193a-P.webp");

    assert_eq!(
        candidates,
        vec![
            "https://static.dotgg.gg/riftbound/cards/OGN-193a-P.webp",
            "https://static.dotgg.gg/riftbound/cards/OGN-193-P.webp",
        ]
    );
}
