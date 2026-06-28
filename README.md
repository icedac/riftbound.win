# Riftbound Sim

Rust tools for syncing Riftbound card data into SQLite, downloading card images locally, and browsing the full catalog through a Cloudflare Pages-ready static site.

## Local Use

```bash
cargo run -- sync
cargo run -- serve --port 5173
```

Open `http://127.0.0.1:5173` after the server starts.

The local Rust server serves the same `/api/*` shape as the Cloudflare Pages
Worker. Google and Naver buttons use local dev sign-in flows on localhost, so
you can test account linking, profile edits, avatar upload, community posting,
and pasted image/video uploads without provider secrets. Runtime API state is
stored in `data/riftbound-local.sqlite`, and uploads are written under
`public/user-media/`; both are ignored by Git.

Local pages:

- `/` foil-heavy landing page
- `/cards/` full card catalog and filters
- `/decks/` deck builder with `3x OGN-111` style import/export
- `/community/` BBS for `free`, `deck`, and `notice`
- `/profile/` member profile and linked-login page

The sync command writes:

- `data/riftbound.sqlite` for card metadata and raw DotGG JSON
- `public/cards.json` for the browser UI
- `public/images/cards/*.webp` for local card images

## Cloudflare Pages

The app is static at deployment time. Run `cargo run -- sync` before deploying so `public/cards.json` and `public/images/cards` are populated.

The `main` branch deploys through `.github/workflows/deploy-cloudflare-pages.yml`. The GitHub repository needs these Actions secrets:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`

The workflow deploys `public/` to the `riftbound-win` Cloudflare Pages project and attaches `riftbound.win` and `riftbound.kr` as custom domains. It also attempts `randomgame.kr` as an optional Pages domain.

The Pages deployment includes `public/_worker.js` for community uploads, profiles, and OAuth login. `scripts/prepare_cloudflare_pages_backend.py` runs in CI before deploy and:

- creates or reuses the D1 database `riftbound-win`
- creates or reuses the R2 bucket `riftbound-win-media`
- injects `DB` and `MEDIA` bindings into `wrangler.toml` for that deploy
- uploads OAuth secrets to the Pages project when these GitHub secrets are set:
  - `GOOGLE_CLIENT_ID`
  - `GOOGLE_CLIENT_SECRET`
  - `NAVER_CLIENT_ID`
  - `NAVER_CLIENT_SECRET`

OAuth callback URLs to register with providers:

- `https://riftbound.win/api/auth/google/callback`
- `https://riftbound.kr/api/auth/google/callback`
- `https://riftbound.win/api/auth/naver/callback`
- `https://riftbound.kr/api/auth/naver/callback`

The `DB` binding is enough for posts, profile edits, linked account state, and
small pasted media/avatar fallback storage. R2 `MEDIA` is still the intended
store for larger images and videos; without it, production media uploads are
limited to small inline D1 objects. The local Rust server does not need those
Cloudflare bindings.

## Project Maintenance

Operational rules and planning docs live in:

- `AGENTS.md` for agent-facing repo rules
- `rules/project-governance.md` for ownership boundaries and source-of-truth rules
- `rules/deployment.md` for Cloudflare Pages, D1, R2, OAuth, and GitHub Actions
- `rules/packaging.md` for sync/export/package contracts
- `docs/operations/maintenance.md` for routine maintenance
- `docs/prd/playground.md` for the Cockatrice-style playground PRD
- `docs/superpowers/plans/2026-06-28-playground.md` for the implementation plan

## Deck Rules

The deck editor validates Constructed deck size from Riftbound Tournament Rules 402.1: exactly 40 Main Deck cards including chosen champion, 1 Legend, 12 runes, and 3 battlefields with unique names.

## Future Network Play

Cockatrice keeps card data, client, server, and protocol concerns separated. This project follows that direction at the boundary level:

- `card` decodes external card data into stable local card IDs.
- `storage` owns catalog persistence.
- `syncer` owns catalog refresh and asset export.
- Future `game`, `protocol`, and `server` modules can build multiplayer simulation on top of the same SQLite catalog and image assets without coupling to the static browser UI.
