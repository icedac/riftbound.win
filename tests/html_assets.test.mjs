import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const pages = [
  "public/index.html",
  "public/cards/index.html",
  "public/decks/index.html",
  "public/community/index.html",
  "public/profile/index.html",
];

test("HTML pages load cache-busted stylesheet URLs", async () => {
  for (const path of pages) {
    const html = await readFile(new URL(`../${path}`, import.meta.url), "utf8");

    assert.match(html, /href="\/styles\.css\?v=[^"]+"/, path);
    assert.doesNotMatch(html, /href="\/styles\.css"/, path);
  }
});

test("public pages default to Riftbound.kr and expose runtime brand targets", async () => {
  for (const path of pages) {
    const html = await readFile(new URL(`../${path}`, import.meta.url), "utf8");

    assert.match(html, /Riftbound\.kr/, path);
    assert.match(html, /data-brand/, path);
  }
});

test("public pages load the runtime brand module", async () => {
  for (const path of pages) {
    const html = await readFile(new URL(`../${path}`, import.meta.url), "utf8");

    assert.match(html, /src="\/brand\.js\?v=[^"]+"\s+type="module"/, path);
  }
});

test("cards page cache-busts its application script", async () => {
  const html = await readFile(new URL("../public/cards/index.html", import.meta.url), "utf8");

  assert.match(html, /src="\/app\.js\?v=[^"]+"/);
  assert.doesNotMatch(html, /src="\/app\.js"/);
});

test("cards app cache-busts its module imports", async () => {
  const source = await readFile(new URL("../public/app.js", import.meta.url), "utf8");

  for (const modulePath of ["/foil.js", "/card-filter-state.js", "/paging.js", "/card-grid-repair.js"]) {
    assert.match(source, new RegExp(`from "${modulePath.replace(".", "\\.")}\\?v=[^"]+"`), modulePath);
    assert.doesNotMatch(source, new RegExp(`from "${modulePath.replace(".", "\\.")}"`), modulePath);
  }
});

test("cards app schedules an initial grid repair pass", async () => {
  const source = await readFile(new URL("../public/app.js", import.meta.url), "utf8");

  assert.match(source, /scheduleInitialGridRepair\(\)/);
  assert.match(source, /shouldRepairInitialCardGrid/);
});

test("cards app recovers browser-restored zero-result filter state", async () => {
  const source = await readFile(new URL("../public/app.js", import.meta.url), "utf8");

  assert.match(source, /resolveRestoredCardFilters/);
  assert.match(source, /shouldRecoverRenderedCardGrid/);
  assert.match(source, /recoverRestoredCardState/);
  assert.match(source, /addEventListener\("pageshow"/);
  assert.match(source, /addEventListener\("focus"/);
});

test("cards app disables stale browser scroll restoration on catalog boot", async () => {
  const source = await readFile(new URL("../public/app.js", import.meta.url), "utf8");

  assert.match(source, /disableStaleScrollRestoration\(\)/);
  assert.match(source, /history\.scrollRestoration = "manual"/);
  assert.match(source, /scrollTo\(0, 0\)/);
});

test("cards app eager-loads first visible card images", async () => {
  const source = await readFile(new URL("../public/app.js", import.meta.url), "utf8");

  assert.match(source, /EAGER_IMAGE_COUNT/);
  assert.match(source, /image\.loading = index < EAGER_IMAGE_COUNT \? "eager" : "lazy"/);
  assert.match(source, /image\.fetchPriority = index < EAGER_IMAGE_COUNT \? "high" : "auto"/);
});

test("foil helper imports are cache-busted wherever foil rendering is used", async () => {
  for (const path of ["../public/app.js", "../public/decks.js", "../public/landing.js"]) {
    const source = await readFile(new URL(path, import.meta.url), "utf8");

    assert.match(source, /from "\/foil\.js\?v=[^"]+"/, path);
    assert.doesNotMatch(source, /from "\/foil\.js"/, path);
  }
});

test("deck editor cache-busts deck utility imports", async () => {
  const source = await readFile(new URL("../public/decks.js", import.meta.url), "utf8");

  assert.match(source, /from "\/deck-utils\.js\?v=[^"]+"/);
  assert.doesNotMatch(source, /from "\/deck-utils\.js"/);
});

test("community app cache-busts media helper import", async () => {
  const source = await readFile(new URL("../public/community.js", import.meta.url), "utf8");

  assert.match(source, /from "\/community-media\.js\?v=[^"]+"/);
  assert.doesNotMatch(source, /from "\/community-media\.js"/);
});

test("auth and profile apps cache-bust auth state helper imports", async () => {
  for (const path of ["../public/auth.js", "../public/profile.js"]) {
    const source = await readFile(new URL(path, import.meta.url), "utf8");

    assert.match(source, /from "\/auth-state\.js\?v=[^"]+"/, path);
    assert.doesNotMatch(source, /from "\/auth-state\.js"/, path);
  }
});

test("public page scripts are cache-busted", async () => {
  for (const path of pages) {
    const html = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
    const scripts = [...html.matchAll(/<script\s+src="([^"]+)"\s+type="module"><\/script>/g)].map((match) => match[1]);

    assert.notEqual(scripts.length, 0, `${path} should load module scripts`);
    for (const src of scripts) {
      assert.match(src, /\?v=[^"]+$/, `${path} ${src}`);
    }
  }
});
