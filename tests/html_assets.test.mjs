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

test("public pages default to Riftbound.win and expose runtime brand targets", async () => {
  for (const path of pages) {
    const html = await readFile(new URL(`../${path}`, import.meta.url), "utf8");

    assert.match(html, /Riftbound\.win/, path);
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

  for (const modulePath of ["/foil.js", "/card-filter-state.js", "/paging.js"]) {
    assert.match(source, new RegExp(`from "${modulePath.replace(".", "\\.")}\\?v=[^"]+"`), modulePath);
    assert.doesNotMatch(source, new RegExp(`from "${modulePath.replace(".", "\\.")}"`), modulePath);
  }
});

test("foil helper imports are cache-busted wherever foil rendering is used", async () => {
  for (const path of ["../public/app.js", "../public/decks.js", "../public/landing.js"]) {
    const source = await readFile(new URL(path, import.meta.url), "utf8");

    assert.match(source, /from "\/foil\.js\?v=[^"]+"/, path);
    assert.doesNotMatch(source, /from "\/foil\.js"/, path);
  }
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
