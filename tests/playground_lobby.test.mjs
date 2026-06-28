import test from "node:test";
import assert from "node:assert/strict";

import { tableLobbySummary } from "../public/playground-lobby.js";

const cards = [
  { id: "UNL-236-STAR", name: "Kha'Zix - Voidreaver" },
  { id: "OGN-066", name: "Ahri - Alluring" },
];

test("tableLobbySummary exposes host, time, status, seats, and champion legend summary", () => {
  const summary = tableLobbySummary(
    {
      status: "waiting",
      created_at: 1_000,
      seats: [
        {
          display_name: "Host Player",
          deck_name: "Ahri Tempo",
          deck_snapshot: {
            entries: [
              { id: "UNL-236-STAR", quantity: 1, section: "legends" },
              { id: "OGN-066", quantity: 1, section: "champions" },
              { id: "OGN-001", quantity: 39, section: "main" },
              { id: "OGN-R01", quantity: 12, section: "runes" },
              { id: "UNL-205", quantity: 3, section: "battlefields" },
            ],
          },
          zones: {
            legend_zone: [{ id: "UNL-236-STAR" }],
            champion_zone: [{ id: "OGN-066" }],
          },
        },
      ],
    },
    cards,
    121_000
  );

  assert.deepEqual(summary, {
    title: "Ahri Tempo",
    host: "Host Player",
    status: "waiting",
    playerCount: "1/2 players",
    created: "2m ago",
    setup: "Legend Kha'Zix - Voidreaver · Champion Ahri - Alluring",
    counts: "Main 40 · Runes 12 · Fields 3",
  });
});

test("tableLobbySummary falls back to public zones when deck snapshot sections are missing", () => {
  const summary = tableLobbySummary(
    {
      status: "active",
      created_at: 1_000,
      seats: [
        {
          display_name: "Guest Host",
          deck_name: "",
          zones: {
            legend_zone: [{ id: "UNL-236-STAR" }],
            champion_zone: [{ id: "OGN-066" }],
            main_deck: [{ id: "A" }, { id: "B" }],
            rune_deck: [{ id: "R" }],
            battlefields: [{ id: "BF" }],
          },
        },
        { display_name: "Guest" },
      ],
    },
    [],
    3_601_000
  );

  assert.equal(summary.title, "Untitled Table");
  assert.equal(summary.host, "Guest Host");
  assert.equal(summary.status, "active");
  assert.equal(summary.playerCount, "2/2 players");
  assert.equal(summary.created, "1h ago");
  assert.equal(summary.setup, "Legend UNL-236-STAR · Champion OGN-066");
  assert.equal(summary.counts, "Main 3 · Runes 1 · Fields 1");
});
