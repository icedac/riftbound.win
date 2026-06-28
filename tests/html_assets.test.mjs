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
