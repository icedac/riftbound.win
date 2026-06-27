use crate::card::Card;
use anyhow::{Context, Result};
use rusqlite::{Connection, params};

pub fn init_db(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS cards (
            id TEXT PRIMARY KEY,
            slug TEXT NOT NULL,
            name TEXT NOT NULL,
            effect_text TEXT NOT NULL,
            colors_json TEXT NOT NULL,
            cost TEXT,
            card_type TEXT,
            supertype TEXT,
            might TEXT,
            tags_json TEXT NOT NULL,
            set_name TEXT,
            rarity TEXT,
            image_url TEXT,
            local_image TEXT,
            image_width INTEGER,
            image_height INTEGER,
            image_orientation TEXT,
            image_back_url TEXT,
            local_image_back TEXT,
            image_back_width INTEGER,
            image_back_height INTEGER,
            image_back_orientation TEXT,
            has_back INTEGER NOT NULL,
            has_normal INTEGER NOT NULL DEFAULT 0,
            has_foil INTEGER NOT NULL DEFAULT 0,
            banned INTEGER NOT NULL,
            promo INTEGER NOT NULL,
            raw_json TEXT NOT NULL,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_cards_name ON cards(name);
        CREATE INDEX IF NOT EXISTS idx_cards_type ON cards(card_type);
        CREATE INDEX IF NOT EXISTS idx_cards_set_name ON cards(set_name);
        CREATE INDEX IF NOT EXISTS idx_cards_rarity ON cards(rarity);
        "#,
    )
    .context("failed to initialize SQLite schema")?;

    ensure_column(conn, "image_width", "INTEGER")?;
    ensure_column(conn, "image_height", "INTEGER")?;
    ensure_column(conn, "image_orientation", "TEXT")?;
    ensure_column(conn, "image_back_width", "INTEGER")?;
    ensure_column(conn, "image_back_height", "INTEGER")?;
    ensure_column(conn, "image_back_orientation", "TEXT")?;
    ensure_column(conn, "has_normal", "INTEGER NOT NULL DEFAULT 0")?;
    ensure_column(conn, "has_foil", "INTEGER NOT NULL DEFAULT 0")?;
    Ok(())
}

pub fn upsert_cards(conn: &mut Connection, cards: &[Card]) -> Result<()> {
    let tx = conn
        .transaction()
        .context("failed to start card transaction")?;
    {
        let mut stmt = tx.prepare(
            r#"
            INSERT INTO cards (
                id, slug, name, effect_text, colors_json, cost, card_type, supertype,
                might, tags_json, set_name, rarity, image_url, local_image, image_width,
                image_height, image_orientation, image_back_url, local_image_back,
                image_back_width, image_back_height, image_back_orientation, has_back,
                has_normal, has_foil, banned, promo, raw_json, updated_at
            )
            VALUES (
                ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15,
                ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26, ?27, ?28,
                CURRENT_TIMESTAMP
            )
            ON CONFLICT(id) DO UPDATE SET
                slug = excluded.slug,
                name = excluded.name,
                effect_text = excluded.effect_text,
                colors_json = excluded.colors_json,
                cost = excluded.cost,
                card_type = excluded.card_type,
                supertype = excluded.supertype,
                might = excluded.might,
                tags_json = excluded.tags_json,
                set_name = excluded.set_name,
                rarity = excluded.rarity,
                image_url = excluded.image_url,
                local_image = excluded.local_image,
                image_width = excluded.image_width,
                image_height = excluded.image_height,
                image_orientation = excluded.image_orientation,
                image_back_url = excluded.image_back_url,
                local_image_back = excluded.local_image_back,
                image_back_width = excluded.image_back_width,
                image_back_height = excluded.image_back_height,
                image_back_orientation = excluded.image_back_orientation,
                has_back = excluded.has_back,
                has_normal = excluded.has_normal,
                has_foil = excluded.has_foil,
                banned = excluded.banned,
                promo = excluded.promo,
                raw_json = excluded.raw_json,
                updated_at = CURRENT_TIMESTAMP
            "#,
        )?;

        for card in cards {
            stmt.execute(params![
                card.id,
                card.slug,
                card.name,
                card.effect_text,
                serde_json::to_string(&card.colors)?,
                card.cost,
                card.card_type,
                card.supertype,
                card.might,
                serde_json::to_string(&card.tags)?,
                card.set_name,
                card.rarity,
                card.image_url,
                card.local_image,
                card.image_width,
                card.image_height,
                card.image_orientation,
                card.image_back_url,
                card.local_image_back,
                card.image_back_width,
                card.image_back_height,
                card.image_back_orientation,
                card.has_back as i64,
                card.has_normal as i64,
                card.has_foil as i64,
                card.banned as i64,
                card.promo as i64,
                serde_json::to_string(&card.raw)?,
            ])
            .with_context(|| format!("failed to upsert card {}", card.id))?;
        }
    }
    tx.commit().context("failed to commit card transaction")
}

pub fn load_cards(conn: &Connection) -> Result<Vec<Card>> {
    let mut stmt = conn.prepare(
        r#"
        SELECT
            id, slug, name, effect_text, colors_json, cost, card_type, supertype,
            might, tags_json, set_name, rarity, image_url, local_image, image_width,
            image_height, image_orientation, image_back_url, local_image_back,
            image_back_width, image_back_height, image_back_orientation, has_back,
            has_normal, has_foil, banned, promo, raw_json
        FROM cards
        ORDER BY name COLLATE NOCASE, id
        "#,
    )?;

    let rows = stmt.query_map([], |row| {
        let colors_json: String = row.get(4)?;
        let tags_json: String = row.get(9)?;
        let raw_json: String = row.get(27)?;
        Ok(Card {
            id: row.get(0)?,
            slug: row.get(1)?,
            name: row.get(2)?,
            effect_html: None,
            effect_text: row.get(3)?,
            flavor: None,
            colors: serde_json::from_str(&colors_json).unwrap_or_default(),
            cost: row.get(5)?,
            card_type: row.get(6)?,
            supertype: row.get(7)?,
            might: row.get(8)?,
            tags: serde_json::from_str(&tags_json).unwrap_or_default(),
            set_name: row.get(10)?,
            rarity: row.get(11)?,
            cycle: None,
            image_url: row.get(12)?,
            local_image: row.get(13)?,
            image_width: row.get(14)?,
            image_height: row.get(15)?,
            image_orientation: row.get(16)?,
            image_back_url: row.get(17)?,
            local_image_back: row.get(18)?,
            image_back_width: row.get(19)?,
            image_back_height: row.get(20)?,
            image_back_orientation: row.get(21)?,
            has_back: row.get::<_, i64>(22)? != 0,
            has_normal: row.get::<_, i64>(23)? != 0,
            has_foil: row.get::<_, i64>(24)? != 0,
            banned: row.get::<_, i64>(25)? != 0,
            promo: row.get::<_, i64>(26)? != 0,
            price: None,
            foil_price: None,
            cardmarket_url: None,
            raw: serde_json::from_str(&raw_json).unwrap_or_default(),
        })
    })?;

    rows.collect::<std::result::Result<Vec<_>, _>>()
        .context("failed to load cards from SQLite")
}

fn ensure_column(conn: &Connection, column: &str, definition: &str) -> Result<()> {
    let mut stmt = conn.prepare("PRAGMA table_info(cards)")?;
    let exists = stmt
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<std::result::Result<Vec<_>, _>>()?
        .iter()
        .any(|name| name == column);
    if !exists {
        conn.execute(
            &format!("ALTER TABLE cards ADD COLUMN {column} {definition}"),
            [],
        )?;
    }
    Ok(())
}
