# Riftbound Agent Guide

This repository is a Rust + SQLite card sync tool, local API server, and Cloudflare Pages site for Riftbound.kr.

## Start Here

- Read `README.md` for the short local/deploy overview.
- Read `rules/project-governance.md` before changing architecture, data ownership, or public behavior.
- Read `rules/deployment.md` before touching Cloudflare Pages, OAuth, D1, R2, or GitHub Actions.
- Read `rules/packaging.md` before changing sync/export/package shape.
- Read `docs/prd/playground.md` before implementing multiplayer playground work.

## Required Checks

Run focused checks for the files you changed, then run the broad checks before committing:

```bash
node --test tests/*.mjs
cargo test
python3 -m unittest tests.prepare_cloudflare_pages_backend_test
```

For UI changes, also verify the relevant page in a real browser. Cards work is not complete until `/cards/` visibly renders cards and console logs are clean. Foil or rendering-performance work also needs `python3 scripts/check_frontend_perf.py <url> --budget-ms 12000 --min-fps 45` evidence for the affected page.

## Development Commands

```bash
cargo run -- sync
cargo run -- serve --port 5173
```

Open `http://127.0.0.1:5173/`.

## Deployment Commands

Production deploys from the `main` branch through `.github/workflows/deploy-cloudflare-pages.yml`. The workflow deploys `public/` to Cloudflare Pages with `wrangler pages deploy`.

Required GitHub Actions secrets:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`

Production OAuth also needs:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `NAVER_CLIENT_ID`
- `NAVER_CLIENT_SECRET`

## Guardrails

- Do not commit generated local runtime state from `data/riftbound-local.sqlite` or `public/user-media/`.
- Do not revert user changes you did not make.
- Keep public assets cache-busted when changing module behavior.
- Keep API shape compatible between `src/local_api.rs` and `public/_worker.js`.
- Prefer small, testable files over adding more responsibilities to already large frontend modules.
- Document operational decisions in `rules/` when they affect future maintainers.
