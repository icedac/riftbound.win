# Riftbound Sim

Rust tools for syncing Riftbound card data into SQLite, downloading card images locally, and browsing the full catalog through a Cloudflare Pages-ready static site.

## Local Use

```bash
cargo run -- sync
cargo run -- serve --port 5173
```

Open `http://127.0.0.1:5173` after the server starts.

Local pages:

- `/` foil-heavy landing page
- `/cards/` full card catalog and filters
- `/decks/` deck builder with `3x OGN-111` style import/export
- `/community/` temporary local BBS for `free`, `deck`, and `notice`

The sync command writes:

- `data/riftbound.sqlite` for card metadata and raw DotGG JSON
- `public/cards.json` for the browser UI
- `public/images/cards/*.webp` for local card images

## Cloudflare Pages

The app is static at deployment time. Run `cargo run -- sync` before deploying so `public/cards.json` and `public/images/cards` are populated.

The `main` branch deploys through `.github/workflows/deploy-cloudflare-pages.yml`. The GitHub repository needs these Actions secrets:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`

The workflow deploys `public/` to the `riftbound-win` Cloudflare Pages project and attaches `riftbound.win` as the custom domain. It also attempts `randomgame.kr` as an optional Pages domain; that domain must be registered and configured before it can resolve publicly.

## Future Network Play

Cockatrice keeps card data, client, server, and protocol concerns separated. This project follows that direction at the boundary level:

- `card` decodes external card data into stable local card IDs.
- `storage` owns catalog persistence.
- `syncer` owns catalog refresh and asset export.
- Future `game`, `protocol`, and `server` modules can build multiplayer simulation on top of the same SQLite catalog and image assets without coupling to the static browser UI.
