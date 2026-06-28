import {
  appendTableEvent,
  createPlaygroundTable,
  deckSummary,
  joinPlaygroundTable,
  replayTableEvents,
  updateVoicePresence,
} from "/playground-state.js?v=20260628-playground1";

const STORAGE_KEY = "riftbound.playground.tables.v1";

const state = {
  me: null,
  cards: [],
  savedDecks: [],
  tables: [],
  selectedTableId: "",
  micStream: null,
};

const els = {
  status: document.querySelector("#playgroundStatus"),
  decks: document.querySelector("#playgroundDecks"),
  createTable: document.querySelector("#createTable"),
  joinTable: document.querySelector("#joinTable"),
  tableList: document.querySelector("#tableList"),
  tableTitle: document.querySelector("#tableTitle"),
  tableZones: document.querySelector("#tableZones"),
  eventLog: document.querySelector("#eventLog"),
  chatLog: document.querySelector("#chatLog"),
  chatForm: document.querySelector("#chatForm"),
  chatInput: document.querySelector("#chatInput"),
  voiceStatus: document.querySelector("#voiceStatus"),
  toggleVoice: document.querySelector("#toggleVoice"),
  resultSelect: document.querySelector("#resultSelect"),
  submitResult: document.querySelector("#submitResult"),
  replayLog: document.querySelector("#replayLog"),
  buildReplay: document.querySelector("#buildReplay"),
  startGame: document.querySelector("#startGame"),
  drawOpening: document.querySelector("#drawOpening"),
  drawRune: document.querySelector("#drawRune"),
  moveBattlefield: document.querySelector("#moveBattlefield"),
  passTurn: document.querySelector("#passTurn"),
};

async function boot() {
  bindEvents();
  restoreTables();
  const [cards, me] = await Promise.all([fetchJson("/cards.json", []), fetchJson("/api/me", {})]);
  state.cards = Array.isArray(cards) ? cards : [];
  state.me = me.user || null;
  await loadSavedDecks();
  render();
}

function bindEvents() {
  els.createTable.addEventListener("click", createTable);
  els.joinTable.addEventListener("click", joinSelectedTable);
  els.tableList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-table-id]");
    if (!button) return;
    state.selectedTableId = button.dataset.tableId;
    render();
  });
  els.startGame.addEventListener("click", () => appendAction("game.start", { first_player_id: currentTable()?.seats?.[0]?.user_id || currentUserId() }));
  els.drawOpening.addEventListener("click", () => appendAction("card.move", { seat_index: currentSeatIndex(), from: "main_deck", to: "hand", count: 4 }));
  els.drawRune.addEventListener("click", () => appendAction("card.move", { seat_index: currentSeatIndex(), from: "rune_deck", to: "revealed", count: 1 }));
  els.moveBattlefield.addEventListener("click", () => appendAction("card.move", { seat_index: currentSeatIndex(), from: "hand", to: "battlefield", count: 1 }));
  els.passTurn.addEventListener("click", () => appendAction("turn.pass", { to_user_id: nextPlayerId() }));
  els.chatForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = els.chatInput.value.trim();
    if (!text) return;
    appendAction("chat.message", { text });
    els.chatInput.value = "";
  });
  els.toggleVoice.addEventListener("click", toggleVoice);
  els.submitResult.addEventListener("click", () => {
    if (!els.resultSelect.value) return;
    appendAction("result.propose", { result: els.resultSelect.value });
  });
  els.buildReplay.addEventListener("click", renderReplay);
}

async function loadSavedDecks() {
  if (!state.me) {
    state.savedDecks = [];
    return;
  }
  try {
    const data = await fetchJson("/api/saved-decks", { decks: [] });
    state.savedDecks = Array.isArray(data.decks) ? data.decks : [];
  } catch (error) {
    console.error(error);
    state.savedDecks = [];
  }
}

function createTable() {
  const deck = selectedDeck();
  if (!state.me || !deck) return;
  const table = createPlaygroundTable({ savedDeck: deck, user: state.me, cards: state.cards });
  state.tables.unshift(table);
  state.selectedTableId = table.id;
  persistTables();
  render();
}

function joinSelectedTable() {
  const table = currentTable();
  const deck = selectedDeck();
  if (!state.me || !table || !deck) return;
  updateCurrentTable(joinPlaygroundTable({ table, savedDeck: deck, user: state.me, cards: state.cards }));
}

function appendAction(type, payload) {
  const table = currentTable();
  if (!table || !state.me) return;
  updateCurrentTable(appendTableEvent(table, { actorId: currentUserId(), type, payload }));
}

async function toggleVoice() {
  const table = currentTable();
  if (!table || !state.me) return;
  if (state.micStream) {
    state.micStream.getTracks().forEach((track) => track.stop());
    state.micStream = null;
    updateCurrentTable(updateVoicePresence(table, { userId: currentUserId(), muted: true, talking: false }));
    return;
  }
  try {
    state.micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    updateCurrentTable(updateVoicePresence(table, { userId: currentUserId(), muted: false, talking: true }));
  } catch (error) {
    console.error(error);
    els.voiceStatus.textContent = "Mic permission unavailable";
  }
}

function render() {
  renderStatus();
  renderDecks();
  renderTables();
  renderTable();
}

function renderStatus() {
  if (!state.me) {
    els.status.textContent = "Sign in with Naver to create or join tables";
    return;
  }
  els.status.textContent = `${state.me.display_name || "Player"} · ${state.savedDecks.length} saved deck(s)`;
}

function renderDecks() {
  els.decks.replaceChildren(
    option("", state.savedDecks.length ? "Choose deck" : "No saved decks"),
    ...state.savedDecks.map((deck) => option(deck.id, deck.name || "Untitled Deck"))
  );
  els.decks.disabled = !state.savedDecks.length;
  els.createTable.disabled = !state.me || !state.savedDecks.length;
  els.joinTable.disabled = !state.me || !state.savedDecks.length || !currentTable();
}

function renderTables() {
  if (!state.tables.length) {
    els.tableList.replaceChildren(empty("No playground tables yet."));
    return;
  }
  els.tableList.replaceChildren(...state.tables.map(tableButton));
}

function tableButton(table) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = ["table-card", state.selectedTableId === table.id ? "active" : ""].filter(Boolean).join(" ");
  button.dataset.tableId = table.id;
  const host = table.seats[0];
  button.append(
    text("strong", host?.deck_name || "Untitled Table"),
    text("span", `${table.status} · ${table.seats.length}/2 players`),
    text("small", `${host?.display_name || "Host"} · ${host?.zones?.main_deck?.length || 0} card deck`)
  );
  return button;
}

function renderTable() {
  const table = currentTable();
  if (!table) {
    els.tableTitle.textContent = "No table selected";
    els.tableZones.replaceChildren(empty("Open or select a table."));
    els.eventLog.replaceChildren();
    els.chatLog.replaceChildren();
    els.voiceStatus.textContent = "Mic idle";
    return;
  }
  els.tableTitle.textContent = `${table.id} · ${table.status}`;
  els.tableZones.replaceChildren(...table.seats.map(seatZones));
  els.eventLog.replaceChildren(...table.events.slice().reverse().map(eventNode));
  els.chatLog.replaceChildren(...table.chat.map((chat) => text("p", `${playerName(table, chat.user_id)}: ${chat.text}`)));
  const voice = table.voice[currentUserId()];
  els.voiceStatus.textContent = voice?.talking ? "Mic active" : voice?.muted ? "Mic muted" : "Mic idle";
  els.toggleVoice.textContent = state.micStream ? "Mute Mic" : "Enable Mic";
}

function seatZones(seat) {
  const root = document.createElement("article");
  root.className = "seat-board";
  root.append(text("h3", `${seat.display_name} · ${seat.deck_name}`));
  const zones = document.createElement("div");
  zones.className = "zone-grid";
  for (const key of ["main_deck", "rune_deck", "hand", "battlefield", "discard", "removed", "revealed"]) {
    const zone = document.createElement("div");
    zone.className = "zone-cell";
    zone.append(text("strong", labelZone(key)), text("span", `${seat.zones[key]?.length || 0}`));
    const preview = document.createElement("div");
    preview.className = "zone-preview";
    for (const card of (seat.zones[key] || []).slice(-4)) preview.append(cardChip(card.id));
    zone.append(preview);
    zones.append(zone);
  }
  root.append(zones);
  return root;
}

function eventNode(event) {
  const node = document.createElement("p");
  node.textContent = `#${event.sequence} ${playerName(currentTable(), event.actor_id)} ${event.type}`;
  return node;
}

function renderReplay() {
  const table = currentTable();
  const replay = replayTableEvents(table?.events || []);
  els.replayLog.replaceChildren(...replay.map((event) => text("p", `#${event.sequence} ${event.summary}`)));
}

function updateCurrentTable(nextTable) {
  state.tables = state.tables.map((table) => (table.id === nextTable.id ? nextTable : table));
  persistTables();
  render();
}

function currentTable() {
  return state.tables.find((table) => table.id === state.selectedTableId) || state.tables[0] || null;
}

function selectedDeck() {
  return state.savedDecks.find((deck) => deck.id === els.decks.value) || state.savedDecks[0] || null;
}

function currentUserId() {
  return state.me?.id || "local-player";
}

function currentSeatIndex() {
  const table = currentTable();
  const index = table?.seats?.findIndex((seat) => seat.user_id === currentUserId()) ?? -1;
  return index >= 0 ? index : 0;
}

function nextPlayerId() {
  const table = currentTable();
  const seats = table?.seats || [];
  if (!seats.length) return currentUserId();
  const index = currentSeatIndex();
  return seats[(index + 1) % seats.length]?.user_id || currentUserId();
}

function playerName(table, userId) {
  return table?.seats?.find((seat) => seat.user_id === userId)?.display_name || "Player";
}

function restoreTables() {
  try {
    state.tables = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    state.selectedTableId = state.tables[0]?.id || "";
  } catch {
    state.tables = [];
  }
}

function persistTables() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.tables));
}

async function fetchJson(url, fallback) {
  const response = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store" });
  if (!response.ok) return fallback;
  return response.json();
}

function labelZone(key) {
  return key.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function cardChip(id) {
  const card = state.cards.find((item) => item.id === id);
  const node = document.createElement("span");
  node.className = "card-chip";
  node.textContent = card?.name || id;
  return node;
}

function option(value, label) {
  const node = document.createElement("option");
  node.value = value;
  node.textContent = label;
  return node;
}

function text(tag, value) {
  const node = document.createElement(tag);
  node.textContent = value;
  return node;
}

function empty(value) {
  const node = text("p", value);
  node.className = "empty-state";
  return node;
}

boot().catch((error) => {
  console.error(error);
  els.status.textContent = "Playground failed to load";
});
