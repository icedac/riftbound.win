# Maintenance Runbook

## Daily Maintenance

1. Check repository state:

   ```bash
   git status --short
   ```

2. Run the broad local checks:

   ```bash
   node --test tests/*.mjs
   cargo test
   python3 -m unittest tests.prepare_cloudflare_pages_backend_test
   ```

3. Check production cards:

   ```bash
   python3 scripts/check_frontend_perf.py https://riftbound.win/cards/ --budget-ms 12000 --min-fps 45 | grep 'Riftbound.win Cards'
   curl -fsSL https://riftbound.kr/cards/ | grep 'Riftbound.kr Cards'
   ```

4. In a browser, confirm `/cards/` renders cards without Reset.

5. Measure the foil-heavy frontend surfaces:

   ```bash
   python3 scripts/check_frontend_perf.py https://riftbound.win/ --budget-ms 12000 --min-fps 45
   python3 scripts/check_frontend_perf.py https://riftbound.win/cards/ --budget-ms 12000 --min-fps 45
   python3 scripts/check_frontend_perf.py https://riftbound.kr/cards/ --budget-ms 12000 --min-fps 45
   ```

   `status:["ok"]` means the stable sampled FPS met the threshold. Long startup
   stalls are reported separately as `stall_frames` and `max_frame_ms`.

## Card Data Refresh

Run:

```bash
cargo run -- sync
```

Expected artifacts:

- `data/riftbound.sqlite`
- `public/cards.json`
- `public/images/cards/*.webp`

After sync, run:

```bash
cargo test
node --test tests/*.mjs
```

Commit card data only when the sync result is intentional.

## OAuth Maintenance

Production `/api/me` reports provider readiness:

```bash
curl -fsSL https://riftbound.win/api/me
curl -fsSL https://riftbound.kr/api/me
```

If `auth.providers.google.configured` or `auth.providers.naver.configured` is false, set the missing GitHub Actions secrets and redeploy:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `NAVER_CLIENT_ID`
- `NAVER_CLIENT_SECRET`

## D1 And R2 Maintenance

D1 is required for profiles, linked auth, posts, and inline media fallback. R2 is required for production-sized pasted images, videos, and avatars.

If deploy logs say MEDIA binding is pending R2 setup:

1. Open Cloudflare dashboard > R2 Object Storage. If it shows "Get started with R2", the account still needs the "Add R2 subscription to my account" action before any R2 bucket or Pages binding can exist.
2. Confirm the GitHub secret `CLOUDFLARE_API_TOKEN` has R2 write permissions.
3. Re-run the Cloudflare Pages workflow.
4. Confirm `wrangler.toml` receives a `MEDIA` binding during CI and `/api/me` reports `"store":"r2"`.

## Release Checklist

- Tests pass locally.
- Optional package archive is generated when handing off a static release:

  ```bash
  python3 scripts/package_static_site.py --public-dir public --output-dir dist --name riftbound-static
  ```

- `git status --short` only shows intended files before commit.
- Commit message describes the user-visible or operational change.
- Push to `main`.
- Confirm GitHub Actions deployment succeeds.
- Browser-check affected production pages.

## Primary References

- Cloudflare D1 bindings in Pages Functions: https://developers.cloudflare.com/pages/functions/bindings/
- Cloudflare R2 bindings in Pages Functions: https://developers.cloudflare.com/pages/functions/bindings/
- GitHub Actions secrets: https://docs.github.com/en/actions/security-guides/using-secrets-in-github-actions
