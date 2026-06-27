# Riftbound Card Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Rust-based local Riftbound card sync and browsing site with SQLite storage, downloaded images, filters, and a static export suitable for Cloudflare Pages.

**Architecture:** The Rust binary has `sync` and `serve` commands. `sync` fetches DotGG indexed JSON, stores normalized cards plus raw JSON in SQLite, downloads images under `public/images/cards`, and exports `public/cards.json`. `serve` hosts the static `public/` directory locally, so the same frontend can be deployed to Cloudflare Pages as static assets.

**Tech Stack:** Rust 2024, `reqwest`, `rusqlite`, `axum`, static HTML/CSS/JS, SQLite, Cloudflare Pages deployment configuration.

---

### Task 1: Decode DotGG Indexed Cards

**Files:**
- Create: `src/lib.rs`
- Create: `src/card.rs`
- Test: `tests/card_decode.rs`

- [x] **Step 1: Write failing tests**

Run: `cargo test --test card_decode`
Expected: fail because the crate/modules do not exist.

- [ ] **Step 2: Implement card decoding**

Create `Card`, `IndexedPayload`, `decode_indexed_cards`, and `local_image_path`. Convert `<br />` to newlines and preserve raw fields for later export.

- [ ] **Step 3: Run tests**

Run: `cargo test --test card_decode`
Expected: pass.

### Task 2: Store and Export Cards

**Files:**
- Create: `src/storage.rs`
- Test: unit tests in `src/storage.rs`

- [ ] **Step 1: Write SQLite round-trip test**

Use an in-memory SQLite DB to verify a decoded card can be upserted and exported.

- [ ] **Step 2: Implement schema and upsert**

Create a `cards` table with searchable columns and `raw_json`.

- [ ] **Step 3: Run tests**

Run: `cargo test`
Expected: pass.

### Task 3: Sync Images and Static JSON

**Files:**
- Create: `src/syncer.rs`
- Modify: `src/main.rs`

- [ ] **Step 1: Implement sync command**

Fetch the provided API URL, decode cards, persist SQLite, download front/back images, and write `public/cards.json`.

- [ ] **Step 2: Run sync**

Run: `cargo run -- sync`
Expected: 1,147 cards stored and images downloaded.

### Task 4: Build Local and Cloudflare Pages-Ready Viewer

**Files:**
- Create: `public/index.html`
- Create: `public/styles.css`
- Create: `public/app.js`
- Create: `.github/workflows/deploy-cloudflare-pages.yml`
- Create: `wrangler.toml`
- Modify: `src/main.rs`

- [ ] **Step 1: Build client-side filters**

Load `/cards.json`, render cards, and filter by search, color, type, set, rarity, cost, and tags.

- [ ] **Step 2: Serve locally**

Run: `cargo run -- serve --port 5173`
Expected: local URL serves the full card browser.

### Task 5: Verify

**Files:**
- Modify only if verification finds a defect.

- [ ] **Step 1: Run automated checks**

Run: `cargo test`
Run: `cargo run -- sync`

- [ ] **Step 2: Smoke test local site**

Open `http://127.0.0.1:5173`, confirm card count, filters, and local images render.
