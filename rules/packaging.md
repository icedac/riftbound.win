# Packaging Rules

## Current Package Shape

This project is one Rust package plus static browser assets:

- Rust package: `riftbound-sim`
- CLI commands: `cargo run -- sync`, `cargo run -- serve --port 5173`
- SQLite card DB: `data/riftbound.sqlite`
- Browser catalog artifact: `public/cards.json`
- Browser image artifacts: `public/images/cards/*.webp`
- Deploy package: `public/`

## Sync Package Contract

`cargo run -- sync` must produce a deployable catalog package:

- Decoded card metadata stored in SQLite.
- `public/cards.json` written with browser-safe fields.
- Front and back card images downloaded under `public/images/cards/`.
- Stable local image paths preserved across syncs.

Do not change the sync output shape without updating:

- `README.md`
- `rules/project-governance.md`
- browser tests under `tests/*.mjs`
- Rust storage/sync tests under `tests/*.rs`

## Static Site Package Contract

The deployable package is `public/`, including:

- HTML entry points for home, cards, decks, community, and profile.
- Static JS/CSS modules with cache-busted URLs.
- `public/_worker.js` for Cloudflare Pages Functions API routes.
- `public/cards.json` and card images from the latest sync.

Cloudflare Pages should not need a Rust runtime at request time.

The production package is uploaded with `wrangler pages deploy public` from GitHub Actions.

For manual release, archival, or handoff packages, run:

```bash
python3 scripts/package_static_site.py --public-dir public --output-dir dist --name riftbound-static
```

The package command creates:

- `dist/riftbound-static-<timestamp>.tar.gz`
- `dist/riftbound-static-manifest.json`

The archive contains `manifest.json` and the full `public/` tree. The manifest
records required entrypoints, `_worker.js` presence, `cards.json` card count,
card image count, and SHA-256 for every packaged file. Treat this manifest as
the handoff contract for manual deploys and static package audits.

## Future Package Split

When playground multiplayer starts, split by runtime boundary instead of by technology fashion:

- `card-catalog`: Rust card sync/storage/export modules.
- `web-static`: static HTML/CSS/JS and card/deck/community/profile UI.
- `worker-api`: Cloudflare Pages Functions or Workers API code.
- `playground-realtime`: WebSocket session service, likely Durable Objects.
- `shared-protocol`: JSON message schemas for deck selection, lobby, game state, and table events.

Keep the current single Cargo package until a split removes real coupling.

## Primary References

- Cargo package layout: https://doc.rust-lang.org/cargo/guide/project-layout.html
- Cargo workspaces: https://doc.rust-lang.org/cargo/reference/workspaces.html
- Cloudflare Pages direct upload with CI: https://developers.cloudflare.com/pages/how-to/use-direct-upload-with-continuous-integration/
