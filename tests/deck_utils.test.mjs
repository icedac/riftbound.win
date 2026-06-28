import test from "node:test";
import assert from "node:assert/strict";

import {
  buildDeckSections,
  createCardIndex,
  drawTestHand,
  exportDeckList,
  sectionForCard,
  normalizeCardId,
  parseDeckList,
  splitRuneChannels,
  summarizeDeck,
  validateRiftboundDeck,
} from "../public/deck-utils.js";

const cards = [
  { id: "OGN-111", name: "Heimerdinger - Inventor", colors: ["Mind"], card_type: "Unit", cost: "3" },
  { id: "OGN-066", name: "Ahri - Alluring", colors: ["Mind"], card_type: "Unit", supertype: "Champion", cost: "2" },
  { id: "OGN-001", name: "Blazing Scorcher", colors: ["Fury"], card_type: "Unit", cost: "1" },
  { id: "SFD-001", name: "Against the Odds", colors: ["Fury"], card_type: "Spell", cost: "2" },
  { id: "UNL-236-STAR", name: "Kha'Zix - Voidreaver", colors: ["Body", "Chaos"], card_type: "Legend" },
  { id: "OGN-126", name: "Body Rune", colors: ["Body"], card_type: "Rune" },
  { id: "OGN-042", name: "Calm Rune", colors: ["Calm"], card_type: "Rune" },
  { id: "UNL-205", name: "Abandoned Hall", colors: ["Colorless"], card_type: "Battlefield" },
  { id: "UNL-206", name: "Altar of Blood", colors: ["Colorless"], card_type: "Battlefield" },
  { id: "OGN-275", name: "Altar to Unity", colors: ["Colorless"], card_type: "Battlefield" },
  ...Array.from({ length: 14 }, (_, idx) => ({
    id: `TST-${String(idx + 1).padStart(3, "0")}`,
    name: `Test Main ${idx + 1}`,
    colors: ["Fury"],
    card_type: idx % 2 === 0 ? "Unit" : "Spell",
    cost: String((idx % 5) + 1),
  })),
];

test("normalizes common Riftbound card id input", () => {
  assert.equal(normalizeCardId(" ogn-111 "), "OGN-111");
  assert.equal(normalizeCardId("unl-236-star"), "UNL-236-STAR");
});

test("parses loose deck list quantity formats and aggregates duplicate ids", () => {
  const result = parseDeckList(
    `
      3x OGN-111 Heimerdinger - Inventor
      OGN-001 x2
      1 SFD-001
      ogn-111
      # comment
    `,
    cards
  );

  assert.deepEqual(
    result.entries.map((entry) => [entry.id, entry.quantity]),
    [
      ["OGN-111", 4],
      ["OGN-001", 2],
      ["SFD-001", 1],
    ]
  );
  assert.equal(result.warnings.length, 0);
});

test("reports unknown or unparseable import lines without dropping valid cards", () => {
  const result = parseDeckList("2x OGN-111\nx nope\n3x BAD-999", cards);

  assert.deepEqual(result.entries.map((entry) => [entry.id, entry.quantity]), [["OGN-111", 2]]);
  assert.equal(result.warnings.length, 2);
  assert.match(result.warnings[0], /line 2/i);
  assert.match(result.warnings[1], /BAD-999/);
});

test("exports deck lists with ids and card names", () => {
  const index = createCardIndex(cards);
  const text = exportDeckList(
    [
      { id: "OGN-111", quantity: 3 },
      { id: "UNL-236-STAR", quantity: 1 },
    ],
    index
  );

  assert.equal(text, "3x OGN-111 Heimerdinger - Inventor\n1x UNL-236-STAR Kha'Zix - Voidreaver");
});

test("summarizes deck counts by color, type, and cost", () => {
  const index = createCardIndex(cards);
  const summary = summarizeDeck(
    [
      { id: "OGN-111", quantity: 3 },
      { id: "OGN-001", quantity: 2 },
      { id: "SFD-001", quantity: 1 },
      { id: "UNL-236-STAR", quantity: 1 },
    ],
    index
  );

  assert.equal(summary.total, 7);
  assert.equal(summary.colors.Mind, 3);
  assert.equal(summary.colors.Fury, 3);
  assert.equal(summary.colors.Body, 1);
  assert.equal(summary.types.Unit, 5);
  assert.equal(summary.types.Legend, 1);
  assert.equal(summary.costs["3"], 3);
  assert.equal(summary.costs["No cost"], 1);
});

test("classifies cards into Riftbound deck sections", () => {
  const index = createCardIndex(cards);

  assert.equal(sectionForCard(index.byId.get("OGN-111")), "main");
  assert.equal(sectionForCard(index.byId.get("OGN-066")), "champions");
  assert.equal(sectionForCard(index.byId.get("OGN-126")), "runes");
  assert.equal(sectionForCard(index.byId.get("UNL-236-STAR")), "legends");
  assert.equal(sectionForCard(index.byId.get("UNL-205")), "battlefields");
});

test("builds sectioned deck state from flat import entries", () => {
  const index = createCardIndex(cards);
  const sections = buildDeckSections(
    [
      { id: "OGN-111", quantity: 3 },
      { id: "OGN-066", quantity: 1 },
      { id: "OGN-126", quantity: 2 },
      { id: "OGN-042", quantity: 2 },
      { id: "UNL-236-STAR", quantity: 1 },
      { id: "UNL-205", quantity: 1 },
    ],
    index
  );

  assert.deepEqual(sections.main.map((entry) => [entry.id, entry.quantity]), [["OGN-111", 3]]);
  assert.deepEqual(sections.champions.map((entry) => [entry.id, entry.quantity]), [["OGN-066", 1]]);
  assert.deepEqual(sections.runes.map((entry) => [entry.id, entry.quantity]), [
    ["OGN-126", 2],
    ["OGN-042", 2],
  ]);
  assert.deepEqual(sections.legends.map((entry) => [entry.id, entry.quantity]), [["UNL-236-STAR", 1]]);
  assert.deepEqual(sections.battlefields.map((entry) => [entry.id, entry.quantity]), [["UNL-205", 1]]);
});

test("validates Riftbound constructed deck counts", () => {
  const index = createCardIndex(cards);
  const sections = buildDeckSections(
    [
      ...cards
        .filter((card) => card.id.startsWith("TST-"))
        .slice(0, 13)
        .map((card) => ({ id: card.id, quantity: 3 })),
      { id: "OGN-066", quantity: 1 },
      { id: "OGN-126", quantity: 10 },
      { id: "OGN-042", quantity: 2 },
      { id: "UNL-236-STAR", quantity: 1 },
      { id: "UNL-205", quantity: 1 },
      { id: "UNL-206", quantity: 1 },
      { id: "OGN-275", quantity: 1 },
    ],
    index
  );

  const validation = validateRiftboundDeck(sections);

  assert.equal(validation.counts.main, 40);
  assert.equal(validation.counts.champions, 1);
  assert.equal(validation.counts.runes, 12);
  assert.equal(validation.counts.legends, 1);
  assert.equal(validation.counts.battlefields, 3);
  assert.deepEqual(validation.errors, []);
});

test("allows main decks above the 40 card minimum from the core rules", () => {
  const index = createCardIndex(cards);
  const sections = buildDeckSections(
    [
      ...cards
        .filter((card) => card.id.startsWith("TST-"))
        .map((card, idx) => ({ id: card.id, quantity: idx === 13 ? 1 : 3 })),
      { id: "OGN-066", quantity: 1 },
      { id: "OGN-126", quantity: 10 },
      { id: "OGN-042", quantity: 2 },
      { id: "UNL-236-STAR", quantity: 1 },
      { id: "UNL-205", quantity: 1 },
      { id: "UNL-206", quantity: 1 },
      { id: "OGN-275", quantity: 1 },
    ],
    index
  );

  const validation = validateRiftboundDeck(sections);

  assert.equal(validation.counts.main, 41);
  assert.equal(validation.counts.champions, 1);
  assert(!validation.errors.some((message) => /main deck/i.test(message)));
});

test("requires exactly one champion while counting it toward the main deck", () => {
  const index = createCardIndex(cards);
  const sections = buildDeckSections(
    [
      ...cards
        .filter((card) => card.id.startsWith("TST-"))
        .map((card, idx) => ({ id: card.id, quantity: idx === 13 ? 1 : 3 })),
      { id: "OGN-126", quantity: 10 },
      { id: "OGN-042", quantity: 2 },
      { id: "UNL-236-STAR", quantity: 1 },
      { id: "UNL-205", quantity: 1 },
      { id: "UNL-206", quantity: 1 },
      { id: "OGN-275", quantity: 1 },
    ],
    index
  );

  const validation = validateRiftboundDeck(sections);

  assert.equal(validation.counts.main, 40);
  assert.equal(validation.counts.champions, 0);
  assert(validation.errors.some((message) => /champion/i.test(message)));
});

test("validates the three-copy limit for main deck cards but not rune quantities", () => {
  const index = createCardIndex(cards);
  const sections = buildDeckSections(
    [
      { id: "OGN-111", quantity: 4 },
      { id: "OGN-066", quantity: 1 },
      { id: "OGN-126", quantity: 10 },
      { id: "OGN-042", quantity: 2 },
      { id: "UNL-236-STAR", quantity: 1 },
      { id: "UNL-205", quantity: 1 },
      { id: "UNL-206", quantity: 1 },
      { id: "OGN-275", quantity: 1 },
    ],
    index
  );

  const validation = validateRiftboundDeck(sections);

  assert(validation.errors.some((message) => message.includes("OGN-111") && message.includes("3")));
  assert(!validation.errors.some((message) => message.includes("OGN-126")));
});

test("validates main deck copy limits by card name across print variants", () => {
  const index = createCardIndex([
    ...cards,
    { id: "OGN-111a", name: "Heimerdinger - Inventor", colors: ["Mind"], card_type: "Unit", cost: "3" },
  ]);
  const sections = buildDeckSections(
    [
      { id: "OGN-111", quantity: 3 },
      { id: "OGN-111a", quantity: 1 },
      { id: "OGN-066", quantity: 1 },
      { id: "OGN-126", quantity: 10 },
      { id: "OGN-042", quantity: 2 },
      { id: "UNL-236-STAR", quantity: 1 },
      { id: "UNL-205", quantity: 1 },
      { id: "UNL-206", quantity: 1 },
      { id: "OGN-275", quantity: 1 },
    ],
    index
  );

  const validation = validateRiftboundDeck(sections);

  assert(validation.errors.some((message) => message.includes("Heimerdinger - Inventor") && message.includes("3")));
});

test("draws deterministic test hand from main deck and two runes from rune deck", () => {
  const index = createCardIndex(cards);
  const sections = buildDeckSections(
    [
      { id: "OGN-111", quantity: 5 },
      { id: "SFD-001", quantity: 5 },
      { id: "OGN-126", quantity: 3 },
      { id: "OGN-042", quantity: 3 },
    ],
    index
  );

  const draw = drawTestHand(sections, index, { seed: 7, handSize: 4, runeChannels: 2 });
  const repeat = drawTestHand(sections, index, { seed: 7, handSize: 4, runeChannels: 2 });

  assert.equal(draw.hand.length, 4);
  assert.equal(draw.runes.length, 2);
  assert(draw.hand.every((entry) => sectionForCard(entry.card) === "main"));
  assert(draw.runes.every((entry) => sectionForCard(entry.card) === "runes"));
  assert.deepEqual(
    repeat.hand.map((entry) => entry.id),
    draw.hand.map((entry) => entry.id)
  );
  assert.deepEqual(
    repeat.runes.map((entry) => entry.id),
    draw.runes.map((entry) => entry.id)
  );
});

test("draws separate rune channel groups for the deck editor", () => {
  const index = createCardIndex(cards);
  const sections = buildDeckSections(
    [
      { id: "OGN-111", quantity: 5 },
      { id: "SFD-001", quantity: 5 },
      { id: "OGN-126", quantity: 3 },
      { id: "OGN-042", quantity: 3 },
    ],
    index
  );

  const draw = drawTestHand(sections, index, { seed: 11, handSize: 4, runeChannels: 2 });

  assert.equal(draw.runeChannels.length, 2);
  assert.equal(draw.runeChannels[0].length, 1);
  assert.equal(draw.runeChannels[1].length, 1);
  assert.deepEqual(
    draw.runeChannels.flat().map((entry) => entry.id),
    draw.runes.map((entry) => entry.id)
  );
});

test("splits the rune deck into two visible channel groups", () => {
  const index = createCardIndex(cards);
  const sections = buildDeckSections(
    [
      { id: "OGN-126", quantity: 7 },
      { id: "OGN-042", quantity: 5 },
    ],
    index
  );

  const channels = splitRuneChannels(sections.runes, 2);

  assert.equal(channels.length, 2);
  assert.deepEqual(channels.map((channel) => channel.reduce((total, entry) => total + entry.quantity, 0)), [6, 6]);
  assert.deepEqual(channels[0].map((entry) => [entry.id, entry.quantity]), [
    ["OGN-126", 4],
    ["OGN-042", 2],
  ]);
  assert.deepEqual(channels[1].map((entry) => [entry.id, entry.quantity]), [
    ["OGN-126", 3],
    ["OGN-042", 3],
  ]);
});
