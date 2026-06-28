const DEFAULT_NOW = () => Date.now();
const VICTORY_SCORE = 8;

export function createPlaygroundTable({ id, savedDeck, user, now = DEFAULT_NOW(), cards = [] } = {}) {
  const tableId = id || randomId("table");
  const seat = createSeat({ seatIndex: 0, savedDeck, user, now, cards });
  const table = {
    id: tableId,
    status: "waiting",
    created_at: now,
    updated_at: now,
    started_at: null,
    completed_at: null,
    victory_score: VICTORY_SCORE,
    turn_player_id: user?.id || "",
    seats: [seat],
    events: [],
    chat: [],
    voice: {},
    result: { proposals: {}, final: "" },
  };
  return table;
}

export function joinPlaygroundTable({ table, savedDeck, user, now = DEFAULT_NOW(), cards = [] } = {}) {
  const next = clone(table);
  if ((next.seats || []).length >= 2) return next;
  next.seats.push(createSeat({ seatIndex: next.seats.length, savedDeck, user, now, cards }));
  next.status ||= "waiting";
  next.updated_at = now;
  if (!next.turn_player_id) next.turn_player_id = next.seats[0]?.user_id || "";
  return next;
}

export function appendTableEvent(table, { actorId, type, payload = {}, now = DEFAULT_NOW() } = {}) {
  const next = clone(table);
  const event = {
    id: randomId("event"),
    sequence: (next.events?.length || 0) + 1,
    actor_id: actorId || "",
    type,
    payload: clone(payload),
    created_at: now,
  };
  applyEvent(next, event);
  next.events.push(event);
  next.updated_at = now;
  return next;
}

export function updateVoicePresence(table, { userId, muted = false, talking = false, now = DEFAULT_NOW() } = {}) {
  return appendTableEvent(table, {
    actorId: userId,
    type: "voice.presence",
    payload: { muted: Boolean(muted), talking: Boolean(talking) },
    now,
  });
}

export function replayTableEvents(events = []) {
  return [...events]
    .sort((a, b) => Number(a.sequence || 0) - Number(b.sequence || 0))
    .map((event) => ({
      sequence: Number(event.sequence || 0),
      type: event.type || "unknown",
      actor_id: event.actor_id || "",
      summary: eventSummary(event),
      payload: clone(event.payload || {}),
      created_at: Number(event.created_at || 0),
    }));
}

export function buildReplayFrames(table = {}) {
  if (!table?.id) return [];
  const replayTable = initialReplayTable(table);
  const frames = [
    {
      sequence: 0,
      type: "initial",
      actor_id: "",
      summary: "Initial table",
      created_at: Number(table.created_at || 0),
      table: clone(replayTable),
    },
  ];

  const events = [...(table.events || [])]
    .sort((a, b) => Number(a.sequence || 0) - Number(b.sequence || 0))
    .map((event, index) => normalizeReplayEvent(event, index, table));

  for (const event of events) {
    applyEvent(replayTable, event);
    replayTable.events.push(clone(event));
    replayTable.updated_at = event.created_at || replayTable.updated_at;
    frames.push({
      sequence: event.sequence,
      type: event.type,
      actor_id: event.actor_id,
      summary: eventSummary(event),
      created_at: event.created_at,
      table: clone(replayTable),
    });
  }

  return frames;
}

export function deckSummary(savedDeck = {}, cards = []) {
  const entries = deckEntries(savedDeck.deck_json || savedDeck, cards);
  const counts = entries.reduce(
    (acc, entry) => {
      acc.total += entry.quantity;
      acc[zoneForEntry(entry, cards) === "rune_deck" ? "runes" : "main"] += entry.quantity;
      return acc;
    },
    { total: 0, main: 0, runes: 0 }
  );
  return `${savedDeck.name || "Untitled Deck"} · ${counts.main} cards · ${counts.runes} runes`;
}

function createSeat({ seatIndex, savedDeck = {}, user = {}, now, cards }) {
  const deckSnapshot = clone(savedDeck.deck_json || {});
  return {
    seat_index: seatIndex,
    user_id: user.id || `seat-${seatIndex + 1}`,
    display_name: user.display_name || "Player",
    deck_id: savedDeck.id || "",
    deck_name: savedDeck.name || "Untitled Deck",
    deck_snapshot: deckSnapshot,
    joined_at: now,
    points: 0,
    zones: buildZones(deckSnapshot, cards),
  };
}

function initialReplayTable(table = {}) {
  const createdAt = Number(table.created_at || 0);
  const seats = (table.seats || []).map((seat, index) => replaySeat(seat, index, createdAt));
  return {
    id: table.id,
    status: "waiting",
    created_at: createdAt,
    updated_at: createdAt || Number(table.updated_at || 0),
    started_at: null,
    completed_at: null,
    victory_score: Number(table.victory_score || VICTORY_SCORE),
    turn_player_id: seats[0]?.user_id || table.turn_player_id || "",
    seats,
    events: [],
    chat: [],
    voice: {},
    result: { proposals: {}, final: "" },
  };
}

function replaySeat(seat = {}, index = 0, createdAt = 0) {
  const deckSnapshot = clone(seat.deck_snapshot || {});
  return {
    seat_index: Number.isFinite(Number(seat.seat_index)) ? Number(seat.seat_index) : index,
    user_id: seat.user_id || `seat-${index + 1}`,
    display_name: seat.display_name || "Player",
    deck_id: seat.deck_id || "",
    deck_name: seat.deck_name || "Untitled Deck",
    deck_snapshot: deckSnapshot,
    joined_at: Number(seat.joined_at || createdAt || 0),
    points: 0,
    zones: buildZones(deckSnapshot, []),
  };
}

function normalizeReplayEvent(event = {}, index = 0, table = {}) {
  return {
    id: event.id || `replay-event-${index + 1}`,
    sequence: Number(event.sequence || index + 1),
    actor_id: event.actor_id || "",
    type: event.type || "unknown",
    payload: clone(event.payload || {}),
    created_at: Number(event.created_at || table.updated_at || table.created_at || 0),
  };
}

function buildZones(deckJson = {}, cards = []) {
  const zones = {
    legend_zone: [],
    battlefields: [],
    base: [],
    main_deck: [],
    rune_deck: [],
    rune_pool: [],
    hand: [],
    battlefield: [],
    discard: [],
    removed: [],
    revealed: [],
  };
  for (const entry of deckEntries(deckJson, cards)) {
    const zone = zoneForEntry(entry, cards);
    for (let i = 0; i < entry.quantity; i += 1) {
      zones[zone].push({ id: entry.id, instance_id: `${entry.id}-${zone}-${i + 1}` });
    }
  }
  return zones;
}

function deckEntries(deckJson = {}, cards = []) {
  const rawEntries = Array.isArray(deckJson.entries)
    ? deckJson.entries
    : ["legends", "main", "runes", "battlefields"].flatMap((section) =>
        (deckJson[section] || []).map((entry) => ({ ...entry, section }))
      );
  return rawEntries
    .map((entry) => ({
      id: String(entry.id || "").trim(),
      quantity: Math.max(0, Math.floor(Number(entry.quantity || 0))),
      section: entry.section || sectionFromCatalog(entry.id, cards),
    }))
    .filter((entry) => entry.id && entry.quantity > 0);
}

function sectionFromCatalog(id, cards = []) {
  const card = cards.find((item) => String(item.id).toUpperCase() === String(id).toUpperCase());
  const type = String(card?.card_type || "").toLowerCase();
  if (type === "rune") return "runes";
  if (type === "legend") return "legends";
  if (type === "battlefield") return "battlefields";
  return "main";
}

function zoneForEntry(entry, cards) {
  const section = entry.section || sectionFromCatalog(entry.id, cards);
  return zoneForDeckSection(section);
}

function zoneForDeckSection(section = "") {
  const normalized = zoneName(section);
  if (["runes", "rune", "rune_deck"].includes(normalized)) return "rune_deck";
  if (["legends", "legend", "legend_zone"].includes(normalized)) return "legend_zone";
  if (["battlefields", "battlefield_cards"].includes(normalized)) return "battlefields";
  return "main_deck";
}

function applyEvent(table, event) {
  if (event.type === "game.start") {
    if (!table.started_at) drawOpeningHands(table);
    table.status = "active";
    table.started_at = table.started_at || event.created_at;
    table.turn_player_id = event.payload.first_player_id || table.turn_player_id || table.seats[0]?.user_id || "";
  }
  if (event.type === "card.move") applyMove(table, event.payload);
  if (event.type === "card.reveal") applyReveal(table, event.payload);
  if (event.type === "card.flip") applyFlip(table, event.payload);
  if (event.type === "card.exhaust") applyExhaust(table, event.payload);
  if (event.type === "battlefield.claim") applyBattlefieldClaim(table, event);
  if (event.type === "turn.pass") {
    table.turn_player_id = event.payload.to_user_id || nextSeatUserId(table, event.actor_id);
    beginTurn(table, table.turn_player_id);
  }
  if (event.type === "chat.message") {
    table.chat.push({
      sequence: event.sequence,
      user_id: event.actor_id,
      text: String(event.payload.text || "").slice(0, 240),
      created_at: event.created_at,
    });
  }
  if (event.type === "voice.presence") {
    table.voice[event.actor_id] = {
      muted: Boolean(event.payload.muted),
      talking: Boolean(event.payload.talking),
      updated_at: event.created_at,
    };
  }
  if (event.type === "score.point") applyScorePoint(table, event);
  if (event.type === "player.concede") applyPlayerConcede(table, event);
  if (event.type === "result.propose") {
    table.result ||= { proposals: {}, final: "" };
    table.result.proposals ||= {};
    table.result.proposals[event.actor_id] = event.payload.result || "";
    const proposals = Object.values(table.result.proposals).filter(Boolean);
    if (table.seats.length >= 2 && proposals.length >= 2 && new Set(proposals).size === 1) {
      table.status = "completed";
      table.completed_at = event.created_at;
      table.result.final = proposals[0];
    }
  }
}

function applyPlayerConcede(table, event) {
  const winner = (table.seats || []).find((seat) => seat.user_id !== event.actor_id);
  if (!winner) return;
  table.result ||= { proposals: {}, final: "" };
  table.status = "completed";
  table.completed_at = event.created_at;
  table.result.final = resultForSeat(table, winner);
  table.result.winner_user_id = winner.user_id;
  table.result.conceded_user_id = event.actor_id;
}

function applyScorePoint(table, event) {
  const seats = table.seats || [];
  const payload = event.payload || {};
  const targetUserId = payload.user_id || event.actor_id || "";
  const seat =
    seats.find((item) => item.user_id === targetUserId) ||
    (Number.isInteger(Number(payload.seat_index)) ? seats[Number(payload.seat_index)] : null);
  if (!seat) return;
  seat.points = Math.max(0, Number(seat.points || 0) + scoreAmount(payload.amount));
  markScoredBattlefield(table, payload, seat, event);
  applyVictoryCheck(table, seat, event);
}

function applyBattlefieldClaim(table, event) {
  const battlefield = selectedZoneCard(table, event.payload || {}, "battlefields");
  if (!battlefield) return;
  battlefield.controller_user_id = event.actor_id || "";
  battlefield.claimed_at = event.created_at;
}

function markScoredBattlefield(table, payload = {}, scoringSeat, event) {
  if (payload.source !== "battlefield" || !payload.battlefield_instance_id) return;
  const battlefield = findZoneCard(table, "battlefields", payload.battlefield_instance_id);
  if (!battlefield) return;
  battlefield.controller_user_id ||= scoringSeat.user_id;
  battlefield.last_scored_by = scoringSeat.user_id;
  battlefield.last_scored_at = event.created_at;
}

function applyVictoryCheck(table, scoringSeat, event) {
  const seats = table.seats || [];
  const points = Number(scoringSeat.points || 0);
  const victoryScore = Number(table.victory_score || VICTORY_SCORE);
  const hasLead = seats.every((seat) => seat.user_id === scoringSeat.user_id || points > Number(seat.points || 0));
  if (points < victoryScore || !hasLead) return;
  table.result ||= { proposals: {}, final: "" };
  table.status = "completed";
  table.completed_at = event.created_at;
  table.result.final = resultForSeat(table, scoringSeat);
  table.result.winner_user_id = scoringSeat.user_id;
}

function scoreAmount(value) {
  const parsed = Math.floor(Number(value ?? 1));
  if (!Number.isFinite(parsed)) return 1;
  return Math.max(1, Math.min(99, parsed));
}

function resultForSeat(table, seat) {
  const index = (table.seats || []).findIndex((item) => item.user_id === seat.user_id);
  if (index === 0) return "host-win";
  if (index === 1) return "guest-win";
  return `${seat.user_id}-win`;
}

function drawOpeningHands(table) {
  for (const seat of table.seats || []) {
    moveCards(seat, "main_deck", "hand", 4);
  }
}

function beginTurn(table, userId) {
  const seat = (table.seats || []).find((item) => item.user_id === userId);
  if (!seat) return;
  readySeatCards(seat);
  moveCards(seat, "rune_deck", "rune_pool", 2);
  moveCards(seat, "main_deck", "hand", 1);
}

function readySeatCards(seat) {
  for (const zone of ["legend_zone", "battlefields", "base", "rune_pool", "battlefield"]) {
    for (const card of seat.zones?.[zone] || []) card.exhausted = false;
  }
}

function moveCards(seat, from, to, count) {
  if (!seat?.zones?.[from] || !seat.zones[to]) return;
  seat.zones[to].push(...seat.zones[from].splice(0, Math.max(0, Math.min(count, seat.zones[from].length))));
}

function applyMove(table, payload = {}) {
  const seat = table.seats[Number(payload.seat_index || 0)];
  const from = zoneName(payload.from);
  const to = zoneName(payload.to);
  if (!seat?.zones?.[from] || !seat.zones[to]) return;
  const selectedIndex = selectedCardIndex(seat.zones[from], payload);
  const moved =
    selectedIndex >= 0
      ? seat.zones[from].splice(selectedIndex, 1)
      : seat.zones[from].splice(0, Math.max(1, Math.min(Number(payload.count || 1), seat.zones[from].length)));
  seat.zones[to].push(...moved);
}

function applyReveal(table, payload = {}) {
  const seat = table.seats[Number(payload.seat_index || 0)];
  const from = zoneName(payload.from || "hand");
  if (!seat?.zones?.[from]) return;
  const selectedIndex = selectedCardIndex(seat.zones[from], payload);
  const index = payload.instance_id || payload.card_id ? selectedIndex : 0;
  if (index < 0) return;
  const [card] = seat.zones[from].splice(index, 1);
  seat.zones.revealed.push({ ...card, revealed_by: payload.revealed_by || seat.user_id });
}

function applyFlip(table, payload = {}) {
  const seat = table.seats[Number(payload.seat_index || 0)];
  const zone = zoneName(payload.zone || "battlefield");
  const cards = seat?.zones?.[zone];
  if (!cards) return;
  const index = selectedCardIndex(cards, payload);
  if (index < 0) return;
  const current = cards[index].face_up !== false;
  cards[index].face_up = typeof payload.face_up === "boolean" ? payload.face_up : !current;
}

function applyExhaust(table, payload = {}) {
  const seat = table.seats[Number(payload.seat_index || 0)];
  const zone = zoneName(payload.zone || "battlefield");
  const cards = seat?.zones?.[zone];
  if (!cards) return;
  const index = selectedCardIndex(cards, payload);
  if (index < 0) return;
  const current = cards[index].exhausted === true;
  cards[index].exhausted = typeof payload.exhausted === "boolean" ? payload.exhausted : !current;
}

function selectedZoneCard(table, payload = {}, fallbackZone = "battlefield") {
  const seat = table.seats[Number(payload.seat_index || 0)];
  const zone = zoneName(payload.zone || fallbackZone);
  const cards = seat?.zones?.[zone];
  if (!cards) return null;
  const index = selectedCardIndex(cards, payload);
  return index >= 0 ? cards[index] : null;
}

function findZoneCard(table, zone, instanceId) {
  for (const seat of table.seats || []) {
    const card = (seat.zones?.[zone] || []).find((item) => item.instance_id === instanceId);
    if (card) return card;
  }
  return null;
}

function selectedCardIndex(cards = [], payload = {}) {
  if (payload.instance_id) {
    return cards.findIndex((card) => card.instance_id === payload.instance_id);
  }
  if (payload.card_id) {
    return cards.findIndex((card) => card.id === payload.card_id);
  }
  return -1;
}

function zoneName(value) {
  return String(value || "")
    .replace(/-/g, "_")
    .toLowerCase();
}

function nextSeatUserId(table, actorId) {
  const seats = table.seats || [];
  const current = seats.findIndex((seat) => seat.user_id === actorId);
  return seats[(current + 1) % seats.length]?.user_id || table.turn_player_id || "";
}

function eventSummary(event) {
  if (event.type === "card.move") return `${event.payload.count || 1} card(s): ${event.payload.from} -> ${event.payload.to}`;
  if (event.type === "card.flip") return `Flip selected card in ${event.payload.zone || "battlefield"} ${event.payload.face_up === false ? "face down" : "face up"}`;
  if (event.type === "card.exhaust") return `${event.payload.exhausted === false ? "Ready" : "Exhaust"} selected card in ${event.payload.zone || "battlefield"}`;
  if (event.type === "chat.message") return `Chat: ${event.payload.text || ""}`;
  if (event.type === "voice.presence") return event.payload.talking ? "Voice active" : "Voice idle";
  if (event.type === "battlefield.claim") return "Battlefield claimed";
  if (event.type === "score.point") return `${event.payload?.source === "battlefield" ? "Score battlefield" : "Score point"}: +${scoreAmount(event.payload?.amount)}`;
  if (event.type === "player.concede") return "Player conceded";
  if (event.type === "turn.pass") return `Turn passed to ${event.payload.to_user_id || "next player"}`;
  if (event.type === "result.propose") return `Result proposed: ${event.payload.result || "unknown"}`;
  return event.type || "unknown";
}

function randomId(prefix) {
  const id = globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2, 12);
  return `${prefix}-${id}`;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}
