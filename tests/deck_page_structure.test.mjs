import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../public/decks/index.html", import.meta.url), "utf8");
const css = await readFile(new URL("../public/styles.css", import.meta.url), "utf8");
const js = await readFile(new URL("../public/decks.js", import.meta.url), "utf8");

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

test("deck editor exposes saved deck controls backed by the API", () => {
  assert.match(html, /id="deckName"/);
  assert.match(html, /id="saveDeck"/);
  assert.match(html, /id="savedDecks"/);
  assert.match(html, /id="loadSavedDeck"/);
  assert.match(js, /\/api\/saved-decks/);
  assert.match(js, /saveCurrentDeck/);
  assert.match(js, /loadSelectedDeck/);
});

test("deck editor keeps deck list, card picker, and inspector in a first-viewport workspace", () => {
  const workspaceBlock = css.match(/\.deck-workspace\s*\{[\s\S]*?\n\}/)?.[0] ?? "";
  const boardBlock = css.match(/\.deck-board\s*\{[\s\S]*?\n\}/)?.[0] ?? "";
  const toolsBlock = css.match(/\.deck-tools\s*\{[\s\S]*?\n\}/)?.[0] ?? "";

  assert.match(workspaceBlock, /grid-template-columns:\s*minmax\(390px,\s*0\.95fr\)\s+minmax\(420px,\s*1fr\)\s+minmax\(360px,\s*430px\)/);
  assert.doesNotMatch(boardBlock, /grid-column:\s*1\s*\/\s*-1/);
  assert.match(toolsBlock, /grid-template-columns:\s*1fr/);
});

test("deck editor renders separate rune channel labels", () => {
  assert.match(js, /splitRuneChannels/);
  assert.match(js, /Rune channel 1/);
  assert.match(js, /Rune channel 2/);
  assert.match(js, /compactSection\("Rune channel 1"/);
  assert.match(js, /compactSection\("Rune channel 2"/);
  assert.doesNotMatch(js, /Channel 2 runes/);
});
