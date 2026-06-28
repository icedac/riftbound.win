import test from "node:test";
import assert from "node:assert/strict";

import { isPrivateCardZone, publicTableForUser } from "../public/playground-visibility.js";

function card(id, instance = `${id}-1`) {
  return { id, instance_id: instance };
}

function tableFixture() {
  return {
    id: "table-1",
    seats: [
      {
        user_id: "host-user",
        zones: {
          main_deck: [card("OGN-001", "host-main-1")],
          rune_deck: [card("OGN-R01", "host-rune-1")],
          hand: [card("OGN-002", "host-hand-1")],
          battlefield: [card("OGN-003", "host-board-1")],
          discard: [card("OGN-004", "host-discard-1")],
          revealed: [card("OGN-005", "host-revealed-1")],
        },
      },
      {
        user_id: "guest-user",
        zones: {
          main_deck: [card("OGN-101", "guest-main-1")],
          rune_deck: [card("OGN-R02", "guest-rune-1")],
          hand: [card("OGN-102", "guest-hand-1")],
          battlefield: [card("OGN-103", "guest-board-1"), { ...card("OGN-104", "guest-board-2"), face_up: false }],
          discard: [card("OGN-105", "guest-discard-1")],
          revealed: [card("OGN-106", "guest-revealed-1")],
        },
      },
    ],
  };
}

test("private card zones include deck piles and hand", () => {
  assert.equal(isPrivateCardZone("main_deck"), true);
  assert.equal(isPrivateCardZone("rune_deck"), true);
  assert.equal(isPrivateCardZone("hand"), true);
  assert.equal(isPrivateCardZone("battlefield"), false);
  assert.equal(isPrivateCardZone("discard"), false);
});

test("publicTableForUser hides deck piles and opponent hand while preserving public zones", () => {
  const original = tableFixture();
  const view = publicTableForUser(original, "host-user");

  assert.equal(view.seats[0].zones.hand[0].id, "OGN-002");
  assert.equal(view.seats[0].zones.main_deck[0].hidden, true);
  assert.equal(view.seats[0].zones.main_deck[0].id, "__hidden__");
  assert.equal(view.seats[1].zones.hand[0].hidden, true);
  assert.equal(view.seats[1].zones.hand[0].id, "__hidden__");
  assert.equal(view.seats[1].zones.battlefield[0].id, "OGN-103");
  assert.equal(view.seats[1].zones.battlefield[1].hidden, true);
  assert.equal(view.seats[1].zones.discard[0].id, "OGN-105");
  assert.equal(view.seats[1].zones.revealed[0].id, "OGN-106");

  assert.equal(original.seats[1].zones.hand[0].id, "OGN-102");
});
