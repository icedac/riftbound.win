# Deployment Rules

## Deployment Shape

Production deploys the `public/` directory to Cloudflare Pages. The GitHub Actions workflow is `.github/workflows/deploy-cloudflare-pages.yml`, and the Pages project name is `riftbound-win`.

The workflow:

1. Checks out the repository.
2. Runs `scripts/prepare_cloudflare_pages_backend.py`.
3. Runs `wrangler pages deploy public --project-name riftbound-win --branch main --commit-dirty=true`.
4. Attaches Pages custom domains.
5. Points `riftbound.kr` DNS at `riftbound-win.pages.dev`.

## Required Secrets

Always confirm these before diagnosing deploy failures:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`

OAuth production readiness requires:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `NAVER_CLIENT_ID`
- `NAVER_CLIENT_SECRET`

## Cloudflare Bindings

`scripts/prepare_cloudflare_pages_backend.py` writes deploy-time bindings into `wrangler.toml`.

- `DB`: D1 database for users, posts, linked OAuth accounts, and small media fallback.
- `MEDIA`: R2 bucket for pasted images, videos, and profile avatars.

If R2 setup fails, production can still use D1 inline fallback for small media, but larger video/image uploads remain limited until R2 permissions are fixed.

## OAuth Callback URLs

Register all production domains that should support login:

- `https://riftbound.win/api/auth/google/callback`
- `https://riftbound.kr/api/auth/google/callback`
- `https://riftbound.win/api/auth/naver/callback`
- `https://riftbound.kr/api/auth/naver/callback`

## Verification After Deploy

Use these live checks:

```bash
curl -fsSL https://riftbound.win/cards/ | grep 'app.js?v='
curl -fsSL https://riftbound.kr/cards/ | grep 'app.js?v='
curl -fsSL https://riftbound.win/api/me
curl -fsSL https://riftbound.kr/api/me
```

Then use a browser to confirm:

- `/cards/` renders visible cards without pressing Reset.
- `/decks/` opens and test draw surfaces render.
- `/community/` loads boards and post form.
- `/profile/` shows OAuth/provider readiness.

## Primary References

- Cloudflare Pages Functions bindings: https://developers.cloudflare.com/pages/functions/bindings/
- Wrangler Pages deploy command: https://developers.cloudflare.com/workers/wrangler/commands/#pages-deploy
- GitHub Actions workflow syntax: https://docs.github.com/en/actions/writing-workflows/workflow-syntax-for-github-actions
