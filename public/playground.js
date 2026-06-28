import { buildReplayFrames, replayTableEvents } from "/playground-state.js?v=20260628-playground12";
import { isHiddenCard } from "/playground-visibility.js?v=20260628-playground1";
import {
  canUseRealtimeTransport,
  createSignalEnvelope,
  isSignalEnvelope,
  realtimeUrlForTable,
  remotePeerId,
  shouldInitiateVoiceOffer,
  shouldUseRealtime,
} from "/playground-realtime.js?v=20260628-playground3";

const TABLES_API = "/api/playground/tables";
const POLL_MS = 2500;
const PLAYGROUND_ZONE_ORDER = [
  "legend_zone",
  "battlefields",
  "base",
  "main_deck",
  "rune_deck",
  "rune_pool",
  "hand",
  "chain",
  "battlefield",
  "discard",
  "removed",
  "revealed",
];

const state = {
  me: null,
  cards: [],
  savedDecks: [],
  tables: [],
  selectedTableId: "",
  selectedCard: null,
  hoveredCard: null,
  micStream: null,
  pollTimer: 0,
  realtimeSocket: null,
  realtimeTableId: "",
  peerConnection: null,
  makingVoiceOffer: false,
  replayFrames: [],
  replayIndex: 0,
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
  remoteAudio: document.querySelector("#remoteAudio"),
  toggleVoice: document.querySelector("#toggleVoice"),
  resultSelect: document.querySelector("#resultSelect"),
  submitResult: document.querySelector("#submitResult"),
  replayLog: document.querySelector("#replayLog"),
  buildReplay: document.querySelector("#buildReplay"),
  replayPrev: document.querySelector("#replayPrev"),
  replayNext: document.querySelector("#replayNext"),
  replayState: document.querySelector("#replayState"),
  startGame: document.querySelector("#startGame"),
  drawOpening: document.querySelector("#drawOpening"),
  drawRune: document.querySelector("#drawRune"),
  revealCard: document.querySelector("#revealCard"),
  moveBattlefield: document.querySelector("#moveBattlefield"),
  scorePoint: document.querySelector("#scorePoint"),
  concedeGame: document.querySelector("#concedeGame"),
  turnPhaseSelect: document.querySelector("#turnPhaseSelect"),
  setTurnPhase: document.querySelector("#setTurnPhase"),
  selectedCardStatus: document.querySelector("#selectedCardStatus"),
  moveToZone: document.querySelector("#moveToZone"),
  moveSelectedCard: document.querySelector("#moveSelectedCard"),
  flipSelectedCard: document.querySelector("#flipSelectedCard"),
  exhaustSelectedCard: document.querySelector("#exhaustSelectedCard"),
  claimBattlefield: document.querySelector("#claimBattlefield"),
  startShowdown: document.querySelector("#startShowdown"),
  showdownWinnerSelect: document.querySelector("#showdownWinnerSelect"),
  endShowdown: document.querySelector("#endShowdown"),
  cardPreview: document.querySelector("#cardHoverPreview"),
  passTurn: document.querySelector("#passTurn"),
};

async function boot() {
  bindEvents();
  const pathTableId = tableIdFromPath();
  if (pathTableId) state.selectedTableId = pathTableId;
  render();
  await loadProfile();
  await Promise.all([loadSavedDecks(), loadTables()]);
  render();
  syncRealtime();
  loadCardsQuietly();
  state.pollTimer = window.setInterval(loadTablesQuietly, POLL_MS);
}

function bindEvents() {
  els.createTable.addEventListener("click", createTable);
  els.joinTable.addEventListener("click", joinSelectedTable);
  els.tableList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-table-id]");
    if (!button) return;
    state.selectedTableId = button.dataset.tableId;
    state.selectedCard = null;
    resetReplay();
    render();
    syncRealtime();
  });
  els.tableZones.addEventListener("click", (event) => {
    const button = event.target.closest("[data-card-instance-id]");
    if (!button) return;
    state.selectedCard = cardRefFromNode(button);
    state.hoveredCard = state.selectedCard;
    render();
  });
  els.tableZones.addEventListener("mouseover", (event) => {
    const button = event.target.closest("[data-card-instance-id]");
    if (!button) return;
    state.hoveredCard = cardRefFromNode(button);
    renderCardPreview();
  });
  els.tableZones.addEventListener("mouseout", (event) => {
    if (!event.target.closest("[data-card-instance-id]")) return;
    state.hoveredCard = null;
    renderCardPreview();
  });
  els.tableZones.addEventListener("focusin", (event) => {
    const button = event.target.closest("[data-card-instance-id]");
    if (!button) return;
    state.hoveredCard = cardRefFromNode(button);
    renderCardPreview();
  });
  els.tableZones.addEventListener("focusout", () => {
    state.hoveredCard = null;
    renderCardPreview();
  });
  els.startGame.addEventListener("click", () => appendAction("game.start", { first_player_id: currentTable()?.seats?.[0]?.user_id || currentUserId() }));
  els.drawOpening.addEventListener("click", () => appendAction("card.move", { seat_index: currentSeatIndex(), from: "main_deck", to: "hand", count: 1 }));
  els.drawRune.addEventListener("click", () => appendAction("card.move", { seat_index: currentSeatIndex(), from: "rune_deck", to: "rune_pool", count: 2 }));
  els.revealCard.addEventListener("click", revealSelectedCard);
  els.moveBattlefield.addEventListener("click", () => (selectedCardRecord() ? moveSelectedCardTo("battlefield") : appendAction("card.move", { seat_index: currentSeatIndex(), from: "hand", to: "battlefield", count: 1 })));
  els.moveSelectedCard.addEventListener("click", () => moveSelectedCardTo(els.moveToZone.value));
  els.flipSelectedCard.addEventListener("click", flipSelectedCard);
  els.exhaustSelectedCard.addEventListener("click", exhaustSelectedCard);
  els.claimBattlefield.addEventListener("click", claimSelectedBattlefield);
  els.startShowdown.addEventListener("click", startSelectedShowdown);
  els.endShowdown.addEventListener("click", endCurrentShowdown);
  els.scorePoint.addEventListener("click", () => appendAction("score.point", scorePayload()));
  els.concedeGame.addEventListener("click", () => appendAction("player.concede", { user_id: currentUserId() }));
  els.passTurn.addEventListener("click", () => appendAction("turn.pass", { to_user_id: nextPlayerId() }));
  els.setTurnPhase.addEventListener("click", () => appendAction("turn.phase", { phase: els.turnPhaseSelect.value }));
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
  els.replayPrev.addEventListener("click", () => stepReplay(-1));
  els.replayNext.addEventListener("click", () => stepReplay(1));
}

async function loadProfile() {
  const me = await fetchJson("/api/me", {});
  state.me = me.user || null;
}

async function loadCardsQuietly() {
  try {
    const cards = await fetchJson("/cards.json", []);
    state.cards = Array.isArray(cards) ? cards : [];
    renderTable();
  } catch (error) {
    console.error(error);
  }
}

async function loadSavedDecks() {
  if (!state.me) {
    state.savedDecks = [];
    return;
  }
  const data = await fetchJson("/api/saved-decks", { decks: [] });
  state.savedDecks = Array.isArray(data.decks) ? data.decks : [];
}

async function loadTablesQuietly() {
  try {
    await loadTables();
    render();
    syncRealtime();
  } catch (error) {
    console.error(error);
  }
}

async function loadTables() {
  const data = await fetchJson(TABLES_API, { tables: [] });
  state.tables = Array.isArray(data.tables) ? data.tables : [];
  if (!state.tables.some((table) => table.id === state.selectedTableId)) {
    state.selectedTableId = state.tables[0]?.id || state.selectedTableId || "";
  }
}

async function createTable() {
  const deck = selectedDeck();
  if (!state.me || !deck) return;
  try {
    const data = await apiJson(TABLES_API, { deck_id: deck.id });
    mergeTable(data.table);
  } catch (error) {
    reportError(error);
  }
}

async function joinSelectedTable() {
  const table = currentTable();
  const deck = selectedDeck();
  if (!state.me || !table || !deck) return;
  try {
    const data = await apiJson(`${TABLES_API}/${encodeURIComponent(table.id)}/join`, { deck_id: deck.id });
    mergeTable(data.table);
  } catch (error) {
    reportError(error);
  }
}

async function appendAction(type, payload) {
  const table = currentTable();
  if (!table || !state.me) return;
  try {
    const data = await apiJson(`${TABLES_API}/${encodeURIComponent(table.id)}/events`, { type, payload });
    mergeTable(data.table);
  } catch (error) {
    reportError(error);
  }
}

async function revealSelectedCard() {
  const selected = selectedCardRecord();
  if (!selected) {
    await appendAction("card.reveal", { seat_index: currentSeatIndex(), from: "hand", revealed_by: currentUserId() });
    return;
  }
  await appendAction("card.reveal", {
    seat_index: selected.seatIndex,
    from: selected.zone,
    instance_id: selected.instanceId,
    revealed_by: currentUserId(),
  });
  state.selectedCard = null;
}

async function moveSelectedCardTo(zone) {
  const selected = selectedCardRecord();
  if (!selected || !zone) return;
  await appendAction("card.move", {
    seat_index: selected.seatIndex,
    from: selected.zone,
    to: zone,
    instance_id: selected.instanceId,
  });
  state.selectedCard = { ...state.selectedCard, zone };
  render();
}

async function flipSelectedCard() {
  const selected = selectedCardRecord();
  if (!selected) return;
  await appendAction("card.flip", {
    seat_index: selected.seatIndex,
    zone: selected.zone,
    instance_id: selected.instanceId,
    face_up: selected.card.face_up === false,
  });
}

async function exhaustSelectedCard() {
  const selected = selectedCardRecord();
  if (!selected) return;
  await appendAction("card.exhaust", {
    seat_index: selected.seatIndex,
    zone: selected.zone,
    instance_id: selected.instanceId,
    exhausted: selected.card.exhausted !== true,
  });
}

async function claimSelectedBattlefield() {
  const selected = selectedCardRecord();
  if (!selected || selected.zone !== "battlefields") return;
  await appendAction("battlefield.claim", {
    seat_index: selected.seatIndex,
    zone: selected.zone,
    instance_id: selected.instanceId,
  });
}

async function startSelectedShowdown() {
  const selected = selectedCardRecord();
  if (!selected || selected.zone !== "battlefields") return;
  await appendAction("showdown.start", {
    seat_index: selected.seatIndex,
    zone: selected.zone,
    instance_id: selected.instanceId,
    attacker_user_id: currentUserId(),
    defender_user_id: nextPlayerId(),
  });
}

async function endCurrentShowdown() {
  const table = currentTable();
  if (!table?.active_showdown) return;
  await appendAction("showdown.end", { winner_user_id: els.showdownWinnerSelect.value || "" });
}

function scorePayload() {
  const selected = selectedCardRecord();
  if (selected?.zone === "battlefields") {
    return {
      amount: 1,
      source: "battlefield",
      battlefield_instance_id: selected.instanceId,
    };
  }
  return { amount: 1, source: "manual" };
}

async function toggleVoice() {
  const table = currentTable();
  if (!table || !state.me) return;
  if (state.micStream) {
    state.micStream.getTracks().forEach((track) => track.stop());
    state.micStream = null;
    await appendAction("voice.presence", { muted: true, talking: false });
    closePeerConnection();
    return;
  }
  try {
    state.micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    await appendAction("voice.presence", { muted: false, talking: true });
    await ensurePeerConnection();
    if (shouldInitiateVoiceOffer(currentTable(), currentUserId())) await makeVoiceOffer();
  } catch (error) {
    console.error(error);
    els.voiceStatus.textContent = "Mic permission unavailable";
  }
}

function syncRealtime() {
  const table = currentTable();
  if (!shouldUseRealtime(table) || !canUseRealtimeTransport(location) || typeof WebSocket === "undefined") {
    closeRealtime();
    return;
  }
  if (state.realtimeSocket && state.realtimeTableId === table.id && state.realtimeSocket.readyState <= WebSocket.OPEN) return;
  closeRealtime();
  const socket = new WebSocket(realtimeUrlForTable(table.id));
  state.realtimeSocket = socket;
  state.realtimeTableId = table.id;
  socket.addEventListener("open", () => sendRealtimeMessage({ type: "ping" }));
  socket.addEventListener("message", handleRealtimeMessage);
  socket.addEventListener("close", () => {
    if (state.realtimeSocket === socket) {
      state.realtimeSocket = null;
      state.realtimeTableId = "";
    }
  });
  socket.addEventListener("error", () => {
    if (state.realtimeSocket === socket) {
      state.realtimeSocket = null;
      state.realtimeTableId = "";
    }
  });
}

function closeRealtime() {
  if (!state.realtimeSocket) return;
  state.realtimeSocket.close();
  state.realtimeSocket = null;
  state.realtimeTableId = "";
}

function handleRealtimeMessage(event) {
  let message = {};
  try {
    message = JSON.parse(event.data);
  } catch {
    return;
  }
  if ((message.type === "table.snapshot" || message.type === "table.event") && message.table) {
    mergeTable(message.table);
    return;
  }
  if (isSignalEnvelope(message) || isSignalEnvelope({ type: message.type, payload: message.payload })) {
    handleVoiceSignal(message);
  }
}

function sendRealtimeMessage(message) {
  if (!state.realtimeSocket || state.realtimeSocket.readyState !== WebSocket.OPEN) return false;
  state.realtimeSocket.send(JSON.stringify(message));
  return true;
}

async function ensurePeerConnection() {
  if (state.peerConnection) return state.peerConnection;
  if (typeof RTCPeerConnection === "undefined") {
    throw new Error("Voice connection is unavailable in this browser");
  }
  const peer = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
  state.peerConnection = peer;
  if (state.micStream) {
    for (const track of state.micStream.getTracks()) peer.addTrack(track, state.micStream);
  }
  peer.addEventListener("icecandidate", (event) => {
    if (!event.candidate) return;
    sendRealtimeMessage(
      createSignalEnvelope("signal.ice", event.candidate.toJSON ? event.candidate.toJSON() : event.candidate, remotePeerId(currentTable(), currentUserId()))
    );
  });
  peer.addEventListener("track", (event) => attachRemoteAudio(event.streams[0]));
  peer.addEventListener("connectionstatechange", () => {
    if (["failed", "closed", "disconnected"].includes(peer.connectionState)) closePeerConnection();
  });
  return peer;
}

async function makeVoiceOffer() {
  const targetUserId = remotePeerId(currentTable(), currentUserId());
  if (!targetUserId || state.makingVoiceOffer) return;
  state.makingVoiceOffer = true;
  try {
    const peer = await ensurePeerConnection();
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    sendRealtimeMessage(createSignalEnvelope("signal.offer", peer.localDescription, targetUserId));
  } finally {
    state.makingVoiceOffer = false;
  }
}

async function handleVoiceSignal(message) {
  if (message.actor_id === currentUserId()) return;
  if (message.target_user_id && message.target_user_id !== currentUserId()) return;
  if (!state.micStream && message.type === "signal.offer") {
    els.voiceStatus.textContent = "Voice invite received";
    return;
  }
  try {
    const peer = await ensurePeerConnection();
    if (message.type === "signal.offer") {
      await peer.setRemoteDescription(message.payload);
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      sendRealtimeMessage(createSignalEnvelope("signal.answer", peer.localDescription, message.actor_id));
    } else if (message.type === "signal.answer") {
      await peer.setRemoteDescription(message.payload);
    } else if (message.type === "signal.ice") {
      await peer.addIceCandidate(message.payload);
    }
  } catch (error) {
    console.error(error);
    els.voiceStatus.textContent = "Voice connection failed";
  }
}

function attachRemoteAudio(stream) {
  if (!stream || !els.remoteAudio) return;
  let audio = els.remoteAudio.querySelector("audio");
  if (!audio) {
    audio = document.createElement("audio");
    audio.autoplay = true;
    audio.controls = true;
    els.remoteAudio.replaceChildren(audio);
  }
  audio.srcObject = stream;
}

function closePeerConnection() {
  if (state.peerConnection) {
    state.peerConnection.close();
    state.peerConnection = null;
  }
  if (els.remoteAudio) els.remoteAudio.replaceChildren();
}

function mergeTable(table) {
  if (!table?.id) return;
  const index = state.tables.findIndex((item) => item.id === table.id);
  if (index >= 0) {
    state.tables[index] = table;
  } else {
    state.tables.unshift(table);
  }
  state.selectedTableId = table.id;
  render();
  syncRealtime();
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
  els.status.textContent = `${state.me.display_name || "Player"} · ${state.savedDecks.length} saved deck(s) · ${state.tables.length} table(s)`;
}

function renderDecks() {
  els.decks.replaceChildren(
    option("", state.savedDecks.length ? "Choose deck" : "No saved decks"),
    ...state.savedDecks.map((deck) => option(deck.id, deck.name || "Untitled Deck"))
  );
  els.decks.disabled = !state.savedDecks.length;
  els.createTable.disabled = !state.me || !state.savedDecks.length;
  const table = currentTable();
  els.joinTable.disabled = !state.me || !state.savedDecks.length || !table || (table.seats || []).length >= 2;
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
  const host = table.seats?.[0];
  button.append(
    text("strong", host?.deck_name || "Untitled Table"),
    text("span", `${table.status} · ${(table.seats || []).length}/2 players`),
    text("small", `${host?.display_name || "Host"} · ${host?.zones?.main_deck?.length || 0} card deck`)
  );
  return button;
}

function renderTable() {
  const table = currentTable();
  const controlsDisabled = !table || !state.me || !currentSeat();
  const phaseControlsDisabled = !isTableActive(table) || controlsDisabled || !isCurrentTurn(table);
  const selected = selectedCardRecord();
  els.startGame.disabled = !canStartTable(table);
  for (const control of [els.drawOpening, els.drawRune, els.revealCard, els.moveBattlefield, els.scorePoint, els.concedeGame, els.passTurn, els.submitResult]) {
    control.disabled = !isTableActive(table) || controlsDisabled;
  }
  els.turnPhaseSelect.disabled = phaseControlsDisabled;
  els.setTurnPhase.disabled = phaseControlsDisabled;
  els.toggleVoice.disabled = controlsDisabled;
  for (const control of [els.moveToZone, els.moveSelectedCard, els.flipSelectedCard, els.exhaustSelectedCard, els.claimBattlefield]) {
    control.disabled = !isTableActive(table) || controlsDisabled || !selected;
  }
  els.claimBattlefield.disabled = els.claimBattlefield.disabled || selected?.zone !== "battlefields";
  els.startShowdown.disabled = !isTableActive(table) || controlsDisabled || !selected || selected.zone !== "battlefields";
  els.showdownWinnerSelect.disabled = !isTableActive(table) || controlsDisabled || !table?.active_showdown;
  els.endShowdown.disabled = !isTableActive(table) || controlsDisabled || !table?.active_showdown;
  if (!table) {
    state.selectedCard = null;
    els.tableTitle.textContent = "No table selected";
    els.tableZones.replaceChildren(empty("Open or select a table."));
    els.eventLog.replaceChildren();
    els.chatLog.replaceChildren();
    renderSelectedCard();
    renderCardPreview();
    els.voiceStatus.textContent = "Mic idle";
    renderShowdownWinnerOptions(null);
    resetReplay();
    return;
  }
  els.turnPhaseSelect.value = labelTurnPhaseValue(table.turn_phase);
  renderShowdownWinnerOptions(table);
  els.tableTitle.textContent = `${table.id} · ${table.status} · turn ${playerName(table, table.turn_player_id)} · ${labelTurnPhase(
    table.turn_phase
  )} ${Number(table.turn_number || 0)}${table.active_showdown ? " · showdown" : ""}`;
  els.tableZones.replaceChildren(...orderedSeats(table).map(seatZones));
  renderSelectedCard();
  renderCardPreview();
  els.eventLog.replaceChildren(...(table.events || []).slice().reverse().map(eventNode));
  els.chatLog.replaceChildren(...(table.chat || []).map((chat) => text("p", `${playerName(table, chat.user_id)}: ${chat.text}`)));
  const voice = table.voice?.[currentUserId()];
  els.voiceStatus.textContent = voice?.talking ? "Mic active" : voice?.muted ? "Mic muted" : "Mic idle";
  els.toggleVoice.textContent = state.micStream ? "Mute Mic" : "Enable Mic";
}

function seatZones(seat) {
  const root = document.createElement("article");
  root.className = ["seat-board", seat.user_id === currentUserId() ? "is-current-player" : "is-opponent-player"].join(" ");
  root.dataset.seatIndex = seat.seat_index;
  root.append(text("h3", `${seat.display_name} · ${seat.deck_name} · ${seat.points || 0} VP`));
  const zones = document.createElement("div");
  zones.className = "zone-grid";
  for (const key of PLAYGROUND_ZONE_ORDER) {
    const zone = document.createElement("div");
    zone.className = "zone-cell";
    zone.append(text("strong", labelZone(key)), text("span", `${seat.zones?.[key]?.length || 0}`));
    const preview = document.createElement("div");
    preview.className = "zone-preview";
    for (const card of (seat.zones?.[key] || []).slice(-6)) preview.append(cardChip(card, seat, key));
    zone.append(preview);
    zones.append(zone);
  }
  root.append(zones);
  return root;
}

function eventNode(event) {
  const node = document.createElement("p");
  node.textContent = `#${event.sequence} ${playerName(currentTable(), event.actor_id)} ${eventSummary(event)}`;
  return node;
}

function renderReplay() {
  const table = currentTable();
  state.replayFrames = buildReplayFrames(table || {});
  state.replayIndex = Math.max(0, state.replayFrames.length - 1);
  renderReplayFrame();
}

function resetReplay() {
  state.replayFrames = [];
  state.replayIndex = 0;
  renderReplayFrame();
}

function stepReplay(delta) {
  if (!state.replayFrames.length) renderReplay();
  if (!state.replayFrames.length) return;
  state.replayIndex = Math.max(0, Math.min(state.replayFrames.length - 1, state.replayIndex + delta));
  renderReplayFrame();
}

function renderReplayFrame() {
  if (!state.replayFrames.length) {
    els.replayState.textContent = "No replay loaded";
    els.replayPrev.disabled = true;
    els.replayNext.disabled = true;
    els.replayLog.replaceChildren(empty("Build replay to inspect saved events."));
    return;
  }
  const frame = state.replayFrames[state.replayIndex];
  const table = frame.table || {};
  const replay = replayTableEvents(table.events || []);
  const status = text(
    "p",
    `${table.status || "waiting"} · turn ${playerName(table, table.turn_player_id)} · ${labelTurnPhase(table.turn_phase)} ${Number(
      table.turn_number || 0
    )} · ${replay.length} event(s)`
  );
  const seats = (table.seats || []).map((seat) =>
    text(
      "p",
      `${seat.display_name}: hand ${zoneCount(seat, "hand")} · deck ${zoneCount(seat, "main_deck")} · runes ${zoneCount(seat, "rune_pool")} · board ${zoneCount(
        seat,
        "battlefield"
      )} · points ${seat.points || 0}`
    )
  );
  const events = replay.map((event) => text("p", `#${event.sequence} ${event.summary}`));
  els.replayState.textContent = `${state.replayIndex + 1}/${state.replayFrames.length} · #${frame.sequence} ${frame.summary}`;
  els.replayPrev.disabled = state.replayIndex <= 0;
  els.replayNext.disabled = state.replayIndex >= state.replayFrames.length - 1;
  els.replayLog.replaceChildren(status, ...seats, ...events);
}

function currentTable() {
  return state.tables.find((table) => table.id === state.selectedTableId) || state.tables[0] || null;
}

function currentSeat() {
  return currentTable()?.seats?.find((seat) => seat.user_id === currentUserId()) || null;
}

function orderedSeats(table) {
  const seats = [...(table?.seats || [])];
  return seats.sort((a, b) => Number(a.user_id === currentUserId()) - Number(b.user_id === currentUserId()));
}

function hostUserId(table) {
  return table?.seats?.[0]?.user_id || "";
}

function canStartTable(table) {
  return Boolean(
    table &&
      state.me &&
      currentSeat() &&
      currentUserId() === hostUserId(table) &&
      (table.seats || []).length >= 2 &&
      table.status === "waiting"
  );
}

function isTableActive(table) {
  return table?.status === "active";
}

function isCurrentTurn(table) {
  return table?.turn_player_id === currentUserId();
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

function zoneCount(seat, zone) {
  return seat?.zones?.[zone]?.length || 0;
}

async function fetchJson(url, fallback) {
  const response = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store", credentials: "same-origin" });
  if (!response.ok) return fallback;
  return response.json();
}

async function apiJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(body),
    credentials: "same-origin",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Playground request failed");
  return data;
}

function reportError(error) {
  console.error(error);
  els.status.textContent = error.message || "Playground request failed";
}

function eventSummary(event) {
  if (event.type === "card.move") return `${event.payload?.count || 1} card(s): ${event.payload?.from} -> ${event.payload?.to}`;
  if (event.type === "card.flip") return `flip ${event.payload?.zone || "battlefield"}`;
  if (event.type === "card.exhaust") return `${event.payload?.exhausted === false ? "ready" : "exhaust"} ${event.payload?.zone || "battlefield"}`;
  if (event.type === "card.reveal") return `reveal from ${event.payload?.from || "hand"}`;
  if (event.type === "chat.message") return `chat: ${event.payload?.text || ""}`;
  if (event.type === "voice.presence") return event.payload?.talking ? "voice active" : "voice idle";
  if (event.type === "battlefield.claim") return "battlefield claimed";
  if (event.type === "showdown.start") return "showdown started";
  if (event.type === "showdown.end") return `showdown ended${event.payload?.winner_user_id ? `: ${playerName(currentTable(), event.payload.winner_user_id)}` : ""}`;
  if (event.type === "turn.phase") return `phase ${labelTurnPhase(event.payload?.phase)}`;
  if (event.type === "score.point") return `${event.payload?.source === "battlefield" ? "score battlefield" : "score"} +${event.payload?.amount || 1}`;
  if (event.type === "player.concede") return "conceded";
  if (event.type === "turn.pass") return `pass to ${playerName(currentTable(), event.payload?.to_user_id)}`;
  if (event.type === "result.propose") return `result ${event.payload?.result || ""}`;
  return event.type || "event";
}

function tableIdFromPath() {
  const match = location.pathname.match(/^\/playground\/tables\/([^/]+)/);
  return match ? decodeURIComponent(match[1]) : "";
}

function labelZone(key) {
  return key.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function labelTurnPhaseValue(value) {
  const phase = String(value || "main").replace(/-/g, "_").toLowerCase();
  return ["ready", "score", "channel", "draw", "main", "end"].includes(phase) ? phase : "main";
}

function labelTurnPhase(value) {
  return labelTurnPhaseValue(value).replace(/\b\w/g, (char) => char.toUpperCase());
}

function renderShowdownWinnerOptions(table) {
  const currentValue = els.showdownWinnerSelect.value;
  const seats = table?.seats || [];
  els.showdownWinnerSelect.replaceChildren(option("", "No winner"), ...seats.map((seat) => option(seat.user_id, seat.display_name || "Player")));
  els.showdownWinnerSelect.value = seats.some((seat) => seat.user_id === currentValue)
    ? currentValue
    : table?.active_showdown?.attacker_user_id || currentUserId();
}

function selectedCardRecord(selected = state.selectedCard) {
  const table = currentTable();
  if (!selected || !table) return null;
  const seat = table.seats?.[selected.seatIndex];
  const cards = seat?.zones?.[selected.zone];
  const card = cards?.find((item) => item.instance_id === selected.instanceId);
  if (!seat || !card) return null;
  return { ...selected, seat, card };
}

function renderSelectedCard() {
  const selected = selectedCardRecord();
  if (!selected) {
    state.selectedCard = null;
    els.selectedCardStatus.textContent = "No card selected";
    return;
  }
  els.selectedCardStatus.textContent = `${playerName(currentTable(), selected.seat.user_id)} · ${labelZone(selected.zone)} · ${cardLabel(selected.card)}`;
}

function renderCardPreview() {
  if (!els.cardPreview) return;
  const selected = selectedCardRecord(state.hoveredCard) || selectedCardRecord();
  if (!selected || isHiddenCard(selected.card)) {
    els.cardPreview.replaceChildren(empty("Hover a card to read it."));
    return;
  }
  const catalog = catalogCard(selected.card);
  const preview = [];
  const imageSrc = cardImageSrc(selected.card);
  if (imageSrc) {
    const image = document.createElement("img");
    image.loading = "eager";
    image.decoding = "async";
    image.src = imageSrc;
    image.alt = cardLabel(selected.card);
    preview.push(image);
  }
  const title = text("strong", cardLabel(selected.card));
  const meta = text(
    "span",
    [catalog?.card_type, catalog?.supertype, catalog?.cost ? `${catalog.cost} cost` : "", catalog?.might ? `${catalog.might} might` : ""]
      .filter(Boolean)
      .join(" · ") || selected.card.id
  );
  const body = text("p", catalog?.effect_text || catalog?.flavor || selected.card.id || "");
  els.cardPreview.replaceChildren(...preview, title, meta, body);
}

function cardChip(card, seat, zone) {
  const node = document.createElement("button");
  node.type = "button";
  const hidden = isHiddenCard(card);
  const selected = state.selectedCard;
  node.className = [
    "card-chip",
    hidden ? "hidden-card" : "",
    card.face_up === false ? "face-down" : "",
    card.exhausted === true ? "exhausted" : "",
    card.controller_user_id ? "controlled" : "",
    card.contested === true ? "contested" : "",
    selected?.instanceId === card.instance_id ? "selected" : "",
  ]
    .filter(Boolean)
    .join(" ");
  node.dataset.seatIndex = seat.seat_index;
  node.dataset.zone = zone;
  node.dataset.cardInstanceId = card.instance_id;
  node.dataset.cardId = card.id;
  if (hidden) {
    node.disabled = true;
    node.append(text("span", cardLabel(card)));
    node.title = cardLabel(card);
    return node;
  }
  const src = cardImageSrc(card);
  if (src) {
    const image = document.createElement("img");
    image.loading = "lazy";
    image.decoding = "async";
    image.src = src;
    image.alt = cardLabel(card);
    node.append(image, text("span", cardLabel(card)));
  } else {
    node.textContent = cardLabel(card);
  }
  node.title = card.controller_user_id ? `${cardLabel(card)} · controlled by ${playerName(currentTable(), card.controller_user_id)}` : cardLabel(card);
  return node;
}

function cardRefFromNode(node) {
  return {
    seatIndex: Number(node.dataset.seatIndex || 0),
    zone: node.dataset.zone || "",
    instanceId: node.dataset.cardInstanceId || "",
    cardId: node.dataset.cardId || "",
  };
}

function cardLabel(card) {
  if (isHiddenCard(card)) return "Hidden card";
  if (card?.face_up === false) return "Face down";
  const catalog = catalogCard(card);
  return catalog?.name || card?.id || "Card";
}

function cardImageSrc(card) {
  if (isHiddenCard(card)) return "";
  if (card?.face_up === false) {
    const catalog = catalogCard(card);
    return catalog?.local_image_back || catalog?.image_back_url || "";
  }
  const catalog = catalogCard(card);
  return catalog?.local_image || catalog?.image_url || "";
}

function catalogCard(card) {
  return state.cards.find((item) => item.id === card?.id || String(item.id).toUpperCase() === String(card?.id || "").toUpperCase());
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

window.addEventListener("beforeunload", () => {
  if (state.pollTimer) window.clearInterval(state.pollTimer);
  closeRealtime();
  closePeerConnection();
  if (state.micStream) state.micStream.getTracks().forEach((track) => track.stop());
});

boot().catch((error) => {
  console.error(error);
  els.status.textContent = "Playground failed to load";
});
