# Playground Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first playable Riftbound.kr playground where a signed-in user creates a table from a saved deck and a second signed-in user joins with their own deck.

**Architecture:** Add saved deck persistence first, then lobby/table HTTP APIs, then a static playground UI, then realtime table coordination. Keep card catalog data static and store only deck snapshots, table rows, and event logs in D1/local SQLite.

**Tech Stack:** Rust local API, Cloudflare Pages Functions, D1, future Durable Objects + WebSocket, static HTML/CSS/JS, existing deck-utils validation.

---

### Task 1: Saved Deck Storage

**Files:**
- Modify: `src/local_api.rs`
- Modify: `public/_worker.js`
- Modify: `public/decks.js`
- Test: `tests/local_api.rs`
- Test: `tests/worker_schema.test.mjs`
- Test: `tests/deck_utils.test.mjs`

- [ ] **Step 1: Write the failing local API test**

Add a test that posts a valid deck, lists saved decks for the current user, and verifies the stored deck JSON is returned unchanged.

Run:

```bash
cargo test --test local_api local_saved_deck_roundtrip
```

Expected: FAIL because saved deck routes do not exist.

- [ ] **Step 2: Implement saved deck schema and local routes**

Add `saved_decks` with `id`, `user_id`, `name`, `format`, `deck_json`, `created_at`, and `updated_at`. Add local routes for list, create, update, and delete.

- [ ] **Step 3: Mirror saved deck routes in Worker**

Add the same schema migration and route behavior in `public/_worker.js`.

- [ ] **Step 4: Wire deck editor save/load**

Add save/load controls that call the saved deck API and reuse existing deck validation before save.

- [ ] **Step 5: Verify**

Run:

```bash
cargo test
node --test tests/*.mjs
```

Expected: all tests pass.

### Task 2: Lobby HTTP API

**Files:**
- Modify: `src/local_api.rs`
- Modify: `public/_worker.js`
- Test: `tests/local_api.rs`
- Test: `tests/worker_schema.test.mjs`

- [ ] **Step 1: Write the failing table creation test**

Create a saved deck, call `POST /api/playground/tables`, and assert a waiting table row is returned.

Run:

```bash
cargo test --test local_api local_playground_table_create
```

Expected: FAIL because table routes do not exist.

- [ ] **Step 2: Add table schema**

Create `playground_tables`, `playground_seats`, and `playground_events` in local SQLite and D1 migrations.

- [ ] **Step 3: Add create/list/join endpoints**

Implement:

- `GET /api/playground/tables`
- `POST /api/playground/tables`
- `POST /api/playground/tables/:id/join`

- [ ] **Step 4: Verify**

Run:

```bash
cargo test
node --test tests/*.mjs
```

Expected: all tests pass.

### Task 3: Playground Static UI

**Files:**
- Create: `public/playground/index.html`
- Create: `public/playground.js`
- Modify: `public/styles.css`
- Modify: `public/index.html`
- Test: `tests/html_assets.test.mjs`

- [ ] **Step 1: Write failing HTML asset test**

Assert `/playground/` exists, loads cache-busted scripts, links from the main nav, and contains lobby/deck-selection/table surfaces.

Run:

```bash
node --test tests/html_assets.test.mjs
```

Expected: FAIL because the page does not exist.

- [ ] **Step 2: Add playground page**

Create a work-focused lobby UI with table list, create-table action, deck picker, and table placeholder.

- [ ] **Step 3: Connect to lobby API**

Load waiting tables, create a table from a saved deck, and join a waiting table with a selected saved deck.

- [ ] **Step 4: Verify**

Run:

```bash
node --test tests/*.mjs
```

Expected: all JS tests pass.

### Task 4: Realtime Table Prototype

**Files:**
- Modify: `public/_worker.js`
- Create: `docs/architecture/playground-realtime.md`
- Test: `tests/worker_schema.test.mjs`

- [ ] **Step 1: Write failing protocol test**

Test that table events are append-only, sequence numbers increase, and invalid client-authored snapshots are rejected.

Run:

```bash
node --test tests/worker_schema.test.mjs
```

Expected: FAIL because table event routes do not exist.

- [ ] **Step 2: Add event protocol routes**

Implement HTTP event append/list routes as a local fallback before Durable Objects are introduced.

- [ ] **Step 3: Document Durable Object upgrade**

Write the exact Durable Object migration path, including WebSocket event names and D1 snapshot persistence.

- [ ] **Step 4: Verify**

Run:

```bash
node --test tests/*.mjs
```

Expected: all JS tests pass.

### Task 5: Production Verification

**Files:**
- Modify only if verification finds defects.

- [ ] **Step 1: Run broad checks**

Run:

```bash
node --test tests/*.mjs
cargo test
python3 -m unittest tests.prepare_cloudflare_pages_backend_test
```

Expected: all checks pass.

- [ ] **Step 2: Deploy**

Push `main` and wait for the Cloudflare Pages workflow to finish successfully.

- [ ] **Step 3: Browser smoke test**

Verify:

- `https://riftbound.win/playground/`
- `https://riftbound.kr/playground/`
- create table
- join table
- table status changes from waiting to active

Expected: two signed-in sessions can reach the same table with locked deck snapshots.
