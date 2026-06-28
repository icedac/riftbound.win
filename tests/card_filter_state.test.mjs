import test from "node:test";
import assert from "node:assert/strict";
import { resolveInitialCardFilters } from "../public/card-filter-state.js";

const cards = [
  { id: "OGN-066-P", name: "Ahri Promo", banned: false, card_type: "Unit", set_name: "Origins", rarity: "Rare", colors: ["Calm"], tags: ["Ahri"] },
  { id: "UNL-131", name: "Abandon", banned: false, card_type: "Spell", set_name: "Unleashed", rarity: "Uncommon", colors: ["Chaos"], tags: [] },
  { id: "BAD-001", name: "Banned Card", banned: true, card_type: "Spell", set_name: "Origins", rarity: "Common", colors: ["Fury"], tags: [] },
];

test("stale zero-result URL searches are cleared on initial card page load", () => {
  const result = resolveInitialCardFilters(cards, { search: "definitely-no-such-card", hideBanned: true });

  assert.equal(result.filters.search, "");
  assert.equal(result.clearedInitialSearch, true);
  assert.deepEqual(result.filtered.map((card) => card.id), ["OGN-066-P", "UNL-131"]);
});

test("valid URL searches are kept on initial card page load", () => {
  const result = resolveInitialCardFilters(cards, { search: "OGN-066-P", hideBanned: true });

  assert.equal(result.filters.search, "ogn-066-p");
  assert.equal(result.clearedInitialSearch, false);
  assert.deepEqual(result.filtered.map((card) => card.id), ["OGN-066-P"]);
});

test("zero-result initial filter state is cleared on initial card page load", () => {
  const result = resolveInitialCardFilters(cards, {
    search: "abandon",
    color: "Calm",
    hideBanned: true,
  });

  assert.equal(result.filters.search, "");
  assert.equal(result.filters.color, "");
  assert.equal(result.clearedInitialSearch, true);
  assert.deepEqual(result.filtered.map((card) => card.id), ["OGN-066-P", "UNL-131"]);
});
