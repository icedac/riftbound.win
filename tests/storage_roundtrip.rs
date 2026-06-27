use riftbound_sim::card::decode_indexed_cards;
use riftbound_sim::storage::{init_db, load_cards, upsert_cards};
use rusqlite::Connection;

#[test]
fn stores_and_loads_cards_from_sqlite() {
    let payload = r#"{
        "names": ["id", "slug", "name", "effect", "color", "cost", "type", "set_name", "rarity", "image"],
        "data": [
            ["B-002", "b-002-beta", "Beta", "", ["Order"], "2", "Unit", "Origins", "Rare", "https://static.dotgg.gg/riftbound/cards/B-002.webp"],
            ["A-001", "a-001-alpha", "Alpha", "Ready.", ["Calm"], "1", "Spell", "Unleashed", "Common", "https://static.dotgg.gg/riftbound/cards/A-001.webp"]
        ]
    }"#;
    let cards = decode_indexed_cards(payload).expect("decode fixture");
    let mut conn = Connection::open_in_memory().expect("open db");

    init_db(&conn).expect("init db");
    upsert_cards(&mut conn, &cards).expect("upsert cards");
    let loaded = load_cards(&conn).expect("load cards");

    assert_eq!(loaded.len(), 2);
    assert_eq!(loaded[0].id, "A-001");
    assert_eq!(loaded[1].id, "B-002");
    assert_eq!(loaded[0].colors, vec!["Calm"]);
    assert_eq!(
        loaded[0].local_image.as_deref(),
        Some("/images/cards/A-001.webp")
    );
}
