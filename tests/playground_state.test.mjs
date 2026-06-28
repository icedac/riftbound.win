import test from "node:test";
import assert from "node:assert/strict";

import {
  appendTableEvent,
  createPlaygroundTable,
  joinPlaygroundTable,
  replayTableEvents,
  updateVoicePresence,
} from "../public/playground-state.js";

const host = { id: "user-host", display_name: "Host" };
const guest = { id: "user-guest", display_name: "Guest" };

function savedDeck(id = "deck-1") {
  return {
    id,
    name: "Ahri Tempo",
    deck_json: {
      entries: [
        { id: "OGN-001", quantity: 5, section: "main" },
        { id: "OGN-042", quantity: 2, section: "runes" },
      ],
    },
  };
}

test("createPlaygroundTable locks a saved deck snapshot for the host", () => {
  const deck = savedDeck();
  const table = createPlaygroundTable({ id: "table-1", savedDeck: deck, user: host, now: 1000 });
  deck.deck_json.entries[0].quantity = 99;

  assert.equal(table.id, "table-1");
  assert.equal(table.status, "waiting");
  assert.equal(table.victory_score, 8);
  assert.equal(table.seats[0].user_id, "user-host");
  assert.equal(table.seats[0].deck_name, "Ahri Tempo");
  assert.equal(table.seats[0].deck_snapshot.entries[0].quantity, 5);
  assert.deepEqual(table.seats[0].zones.hand, []);
  assert.equal(table.seats[0].zones.main_deck.length, 5);
  assert.equal(table.seats[0].zones.rune_deck.length, 2);
  assert.deepEqual(table.seats[0].zones.rune_pool, []);
  assert.equal(table.seats[0].points, 0);
});

test("score point completes a table when a player reaches the victory score with the lead", () => {
  let table = createPlaygroundTable({ id: "table-1", savedDeck: savedDeck(), user: host, now: 1000 });
  table = joinPlaygroundTable({ table, savedDeck: savedDeck("deck-2"), user: guest, now: 1100 });
  table = appendTableEvent(table, { actorId: host.id, type: "game.start", payload: { first_player_id: host.id }, now: 1200 });
  table = appendTableEvent(table, { actorId: host.id, type: "score.point", payload: { amount: 8, source: "hold" }, now: 1300 });

  assert.equal(table.seats[0].points, 8);
  assert.equal(table.seats[1].points, 0);
  assert.equal(table.status, "completed");
  assert.equal(table.completed_at, 1300);
  assert.equal(table.result.final, "host-win");
  assert.equal(table.result.winner_user_id, host.id);

  const replay = replayTableEvents(table.events);
  assert.equal(replay[1].summary, "Score point: +8");
});

test("score point normalizes invalid amounts to one point", () => {
  let table = createPlaygroundTable({ id: "table-1", savedDeck: savedDeck(), user: host, now: 1000 });
  table = appendTableEvent(table, { actorId: host.id, type: "score.point", payload: { amount: "bad" }, now: 1100 });

  assert.equal(table.seats[0].points, 1);
  assert.equal(replayTableEvents(table.events)[0].summary, "Score point: +1");
});

test("player concession completes a table for the opponent", () => {
  let table = createPlaygroundTable({ id: "table-1", savedDeck: savedDeck(), user: host, now: 1000 });
  table = joinPlaygroundTable({ table, savedDeck: savedDeck("deck-2"), user: guest, now: 1100 });
  table = appendTableEvent(table, { actorId: host.id, type: "game.start", payload: { first_player_id: host.id }, now: 1200 });
  table = appendTableEvent(table, { actorId: guest.id, type: "player.concede", payload: {}, now: 1300 });

  assert.equal(table.status, "completed");
  assert.equal(table.completed_at, 1300);
  assert.equal(table.result.final, "host-win");
  assert.equal(table.result.winner_user_id, host.id);
  assert.equal(replayTableEvents(table.events)[1].summary, "Player conceded");
});

test("joined tables append ordered events, preserve chat and voice state, and replay the log", () => {
  let table = createPlaygroundTable({ id: "table-1", savedDeck: savedDeck(), user: host, now: 1000 });
  table = joinPlaygroundTable({ table, savedDeck: savedDeck("deck-2"), user: guest, now: 1100 });

  assert.equal(table.status, "waiting");
  assert.equal(table.seats.length, 2);

  table = appendTableEvent(table, { actorId: host.id, type: "game.start", payload: { first_player_id: host.id }, now: 1200 });
  assert.equal(table.seats[0].zones.hand.length, 4);
  assert.equal(table.seats[1].zones.hand.length, 4);
  assert.equal(table.seats[0].zones.main_deck.length, 1);
  assert.equal(table.seats[1].zones.main_deck.length, 1);

  table = appendTableEvent(table, { actorId: host.id, type: "card.move", payload: { seat_index: 0, from: "main_deck", to: "hand", count: 2 }, now: 1300 });
  table = appendTableEvent(table, { actorId: guest.id, type: "chat.message", payload: { text: "ready" }, now: 1400 });
  table = updateVoicePresence(table, { userId: guest.id, muted: false, talking: true, now: 1500 });
  table = appendTableEvent(table, { actorId: host.id, type: "turn.pass", payload: { to_user_id: guest.id }, now: 1600 });
  table = appendTableEvent(table, { actorId: guest.id, type: "result.propose", payload: { result: "host-win" }, now: 1700 });

  assert.equal(table.status, "active");
  assert.deepEqual(table.events.map((event) => event.sequence), [1, 2, 3, 4, 5, 6]);
  assert.equal(table.seats[0].zones.hand.length, 5);
  assert.equal(table.seats[0].zones.main_deck.length, 0);
  assert.equal(table.seats[1].zones.hand.length, 5);
  assert.equal(table.seats[1].zones.rune_pool.length, 2);
  assert.equal(table.chat[0].text, "ready");
  assert.equal(table.voice[guest.id].talking, true);
  assert.equal(table.turn_player_id, guest.id);
  assert.equal(table.result.proposals[guest.id], "host-win");

  const replay = replayTableEvents(table.events);
  assert.deepEqual(
    replay.map((event) => [event.sequence, event.type]),
    [
      [1, "game.start"],
      [2, "card.move"],
      [3, "chat.message"],
      [4, "voice.presence"],
      [5, "turn.pass"],
      [6, "result.propose"],
    ]
  );
});

test("card events can move a selected instance and flip it in place", () => {
  let table = createPlaygroundTable({ id: "table-1", savedDeck: savedDeck(), user: host, now: 1000 });
  table = appendTableEvent(table, { actorId: host.id, type: "card.move", payload: { seat_index: 0, from: "main_deck", to: "hand", count: 2 }, now: 1100 });

  const selected = table.seats[0].zones.hand[1].instance_id;
  table = appendTableEvent(table, {
    actorId: host.id,
    type: "card.move",
    payload: { seat_index: 0, from: "hand", to: "battlefield", instance_id: selected },
    now: 1200,
  });
  table = appendTableEvent(table, {
    actorId: host.id,
    type: "card.flip",
    payload: { seat_index: 0, zone: "battlefield", instance_id: selected, face_up: false },
    now: 1300,
  });

  assert.equal(table.seats[0].zones.battlefield.length, 1);
  assert.equal(table.seats[0].zones.battlefield[0].instance_id, selected);
  assert.equal(table.seats[0].zones.battlefield[0].face_up, false);
  assert.equal(table.seats[0].zones.hand.length, 1);
  assert.notEqual(table.seats[0].zones.hand[0].instance_id, selected);

  const replay = replayTableEvents(table.events);
  assert.equal(replay[2].summary, "Flip selected card in battlefield face down");
});
