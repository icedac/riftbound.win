import test from "node:test";
import assert from "node:assert/strict";

import { playCardMovePayload, playDestinationForCard } from "../public/playground-actions.js";

test("playDestinationForCard chooses Riftbound default destinations by card type", () => {
  assert.equal(playDestinationForCard({ card_type: "Unit" }), "base");
  assert.equal(playDestinationForCard({ card_type: "Gear" }), "base");
  assert.equal(playDestinationForCard({ card_type: "Spell" }), "chain");
  assert.equal(playDestinationForCard({ card_type: "Battlefield" }), "battlefields");
  assert.equal(playDestinationForCard({ card_type: "Legend" }), "legend_zone");
  assert.equal(playDestinationForCard({ card_type: "Rune" }), "rune_pool");
});

test("playCardMovePayload moves the selected hand card to its type-aware default zone", () => {
  const payload = playCardMovePayload({
    selected: {
      seatIndex: 1,
      zone: "hand",
      instanceId: "SFD-001-hand-1",
      card: { id: "SFD-001" },
    },
    catalogCard: { id: "SFD-001", card_type: "Spell" },
    fallbackSeatIndex: 0,
  });

  assert.deepEqual(payload, {
    seat_index: 1,
    from: "hand",
    to: "chain",
    instance_id: "SFD-001-hand-1",
  });
});

test("playCardMovePayload falls back to playing one hand card to base", () => {
  assert.deepEqual(playCardMovePayload({ fallbackSeatIndex: 0 }), {
    seat_index: 0,
    from: "hand",
    to: "base",
    count: 1,
  });
});

test("playCardMovePayload refuses selected cards outside hand", () => {
  assert.equal(
    playCardMovePayload({
      selected: {
        seatIndex: 0,
        zone: "battlefield",
        instanceId: "OGN-001-battlefield-1",
        card: { id: "OGN-001" },
      },
      catalogCard: { id: "OGN-001", card_type: "Unit" },
    }),
    null
  );
});
