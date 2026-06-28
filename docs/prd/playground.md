# Playground PRD

## Summary

Build a Riftbound playground where a user creates a table with one of their saved decks, waits in a lobby, and another signed-in user joins by selecting their own deck. The first version should prove Cockatrice-style room and table flow for Riftbound without trying to simulate every advanced rule interaction on day one.

## Reference Model

Cockatrice separates card data, deck handling, client UI, server/lobby, and game protocol concerns. Riftbound.kr should follow that separation:

- Catalog data stays in the existing sync/static catalog boundary.
- Deck construction stays in the deck editor and saved deck storage.
- Lobby/table state lives in a realtime service.
- Gameplay messages use explicit protocol events.

Reference: https://github.com/Cockatrice/Cockatrice

## Goals

- Signed-in users can create a public table from a saved deck.
- Waiting tables appear in a lobby list.
- Another signed-in user can join by choosing one of their saved decks.
- Both players enter a table page with their chosen decks locked for that session.
- The table supports initial draw and public/private zones needed for a playable prototype.
- Disconnect/reconnect within a short window preserves table state.

## Non-Goals For V1

- Full rules automation for every Riftbound card.
- Spectator moderation tools.
- Ranked matchmaking.
- Mobile-perfect gameplay UI.
- Cross-region tournament operations.

## User Stories

- As a player, I can save a deck in the deck editor and use it to create a table.
- As a player, I can browse waiting tables and see host, deck champion/legend summary, and table status.
- As a joining player, I can select my deck before entering the table.
- As both players, we can see connection state, opening hand, rune draw, deck counts, and basic zones.
- As a reconnecting player, I can return to the same table if the session is still active.

## Product Requirements

### Lobby

- Route: `/playground/`
- Shows waiting, active, and recently completed tables.
- Create-table action requires signed-in profile.
- Table cards show host name, created time, status, player count, and deck summary.
- Join action opens deck selection for the joining player.

### Deck Selection

- Users can select only their own saved decks.
- Deck validation reuses existing constructed rules.
- Selected decks are copied into table state so later deck edits do not mutate an active table.

### Table

- Route: `/playground/tables/:tableId`
- Two player seats for V1.
- Zones: main deck, rune deck, hand, battlefield row, discard/trash, removed, revealed/public log.
- First action set: shuffle, draw opening hand, draw runes, move card between zones, reveal card, concede.
- Event log is append-only and visible to both players.

### Realtime

- Use WebSocket for table events.
- Use a single authoritative table actor per table. On Cloudflare this should be Durable Objects.
- Persist snapshots to D1 so tables can recover after actor eviction.

### Safety And Abuse

- Require auth for create/join.
- Rate-limit table creation per account.
- Store only card IDs and table actions, not duplicated image blobs.
- Do not allow arbitrary client-authored state replacement.

## Data Model Draft

- `saved_decks`: id, user_id, name, format, deck_json, created_at, updated_at.
- `playground_tables`: id, host_user_id, status, created_at, updated_at, active_snapshot_json.
- `playground_seats`: table_id, seat_index, user_id, deck_snapshot_json, joined_at.
- `playground_events`: id, table_id, sequence, user_id, event_type, event_json, created_at.

## Protocol Draft

Client to server:

- `table.create`
- `table.join`
- `deck.lock`
- `game.ready`
- `zone.move`
- `card.reveal`
- `turn.pass`
- `player.concede`

Server to client:

- `table.snapshot`
- `table.event`
- `table.error`
- `presence.update`
- `connection.resync`

## Technical Approach

Recommended V1 stack:

- Static page under `public/playground/index.html`.
- Browser module `public/playground.js`.
- HTTP endpoints in `public/_worker.js` for lobby and saved deck CRUD.
- Durable Objects for WebSocket table sessions.
- D1 for saved decks, table rows, seat rows, event log, and snapshots.

Cloudflare Durable Objects are a good fit because one table needs one authoritative realtime coordinator with WebSocket connections. D1 remains the durable query/storage layer for lobby lists and recovery snapshots.

## Acceptance Criteria

- Two signed-in local-dev users can create and join a table with distinct decks.
- The lobby updates table status from waiting to active.
- Both browser sessions receive the same table snapshot.
- Opening draw uses existing deck/rune split logic.
- A card movement by one player appears in the other player's event log.
- Reloading a table page resyncs from the latest snapshot.

## Primary References

- Cockatrice repository: https://github.com/Cockatrice/Cockatrice
- Cloudflare Durable Objects: https://developers.cloudflare.com/durable-objects/
- Cloudflare WebSockets with Durable Objects: https://developers.cloudflare.com/durable-objects/best-practices/websockets/
- Cloudflare Pages Functions bindings: https://developers.cloudflare.com/pages/functions/bindings/
