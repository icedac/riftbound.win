import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const requiredDocs = [
  {
    path: "../AGENTS.md",
    patterns: [/cargo test/, /node --test tests\/\*\.mjs/, /Cloudflare Pages/, /rules\//],
  },
  {
    path: "../rules/project-governance.md",
    patterns: [/Riftbound\.kr/, /public\/_worker\.js/, /data\/riftbound\.sqlite/, /no-store/],
  },
  {
    path: "../rules/deployment.md",
    patterns: [/CLOUDFLARE_ACCOUNT_ID/, /CLOUDFLARE_API_TOKEN/, /GOOGLE_CLIENT_ID/, /R2 subscription/, /R2 write/],
  },
  {
    path: "../rules/packaging.md",
    patterns: [/cargo run -- sync/, /public\/cards\.json/, /wrangler pages deploy/, /SQLite/],
  },
  {
    path: "../docs/operations/maintenance.md",
    patterns: [/daily maintenance/i, /OAuth/, /D1/, /Cloudflare Pages/, /Add R2 subscription/],
  },
  {
    path: "../docs/prd/playground.md",
    patterns: [/Cockatrice/, /lobby/i, /deck selection/i, /Durable Objects/, /WebSocket/],
  },
  {
    path: "../docs/superpowers/plans/2026-06-28-playground.md",
    patterns: [/Playground Implementation Plan/, /Task 1/, /Task 2/, /cargo test/],
  },
];

test("project governance and playground planning docs are present", async () => {
  for (const doc of requiredDocs) {
    const content = await readFile(new URL(doc.path, import.meta.url), "utf8");
    for (const pattern of doc.patterns) {
      assert.match(content, pattern, `${doc.path} should mention ${pattern}`);
    }
  }
});
