import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../public/decks/index.html", import.meta.url), "utf8");

test("deck editor exposes a top rules strip and grouped deck list regions", () => {
  assert.match(html, /id="deckRules"/);
  assert.match(html, /id="deckListTop"/);
  assert.match(html, /data-deck-group="cards"/);
  assert.match(html, /data-deck-group="runes"/);
});

test("deck editor includes dedicated card detail and test draw surfaces", () => {
  assert.match(html, /class="card-inspector"/);
  assert.match(html, /id="cardPreview"/);
  assert.match(html, /id="drawTest"/);
  assert.match(html, /id="drawOutput"/);
});
