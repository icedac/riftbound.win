import {
  buildDeckSections,
  createCardIndex,
  drawTestHand,
  exportDeckList,
  flattenDeckSections,
  parseDeckList,
  sectionForCard,
  summarizeDeck,
  validateRiftboundDeck,
} from "/deck-utils.js?v=20260628-deckutils1";
import { appendFoilLayers, bindFoilSurface } from "/foil.js?v=20260628-foilfix1";

const STORAGE_KEY = "riftbound.deck.v2";
const RESULT_LIMIT = 80;
const sectionLabels = {
  main: "Main Deck",
  runes: "Rune Deck",
  legends: "Legend",
  battlefields: "Battlefields",
};
const sectionTargets = {
  main: 40,
  runes: 12,
  legends: 1,
  battlefields: 3,
};

const state = {
  cards: [],
  index: createCardIndex([]),
  query: "",
  color: "",
  type: "",
  deck: new Map(),
  selectedId: "",
  draw: null,
};

const els = {
  summary: document.querySelector("#deckSummary"),
  search: document.querySelector("#deckSearch"),
  color: document.querySelector("#deckColor"),
  type: document.querySelector("#deckType"),
  results: document.querySelector("#deckResults"),
  deckStats: document.querySelector("#deckStats"),
  deckListTop: document.querySelector("#deckListTop"),
  cardDeckCount: document.querySelector("#cardDeckCount"),
  runeDeckCount: document.querySelector("#runeDeckCount"),
  cardDeckList: document.querySelector("#cardDeckList"),
  runeDeckList: document.querySelector("#runeDeckList"),
  deckSections: document.querySelector("#deckSections"),
  validation: document.querySelector("#validationMessages"),
  importText: document.querySelector("#importText"),
  importDeck: document.querySelector("#importDeck"),
  exportText: document.querySelector("#exportText"),
  exportDeck: document.querySelector("#exportDeck"),
  clearDeck: document.querySelector("#clearDeck"),
  drawTest: document.querySelector("#drawTest"),
  drawOutput: document.querySelector("#drawOutput"),
  preview: document.querySelector("#cardPreview"),
  warnings: document.querySelector("#importWarnings"),
};

async function boot() {
  const response = await fetch("/cards.json", { cache: "no-store" });
  if (!response.ok) throw new Error(`Failed to load cards.json: ${response.status}`);
  state.cards = await response.json();
  state.index = createCardIndex(state.cards);
  state.selectedId = findPreferredCard(["OGN-066-P", "OGN-255-P", "OGN-111"])?.id || "";
  restoreDeck();
  buildFilters();
  bindEvents();
  render();
}

function buildFilters() {
  fillSelect(els.color, "All colors", unique(state.cards.flatMap((card) => card.colors ?? [])));
  fillSelect(els.type, "All types", unique(state.cards.map((card) => card.card_type).filter(Boolean)));
}

function bindEvents() {
  els.search.addEventListener("input", () => {
    state.query = els.search.value.trim().toLowerCase();
    renderResults();
  });
  els.color.addEventListener("change", () => {
    state.color = els.color.value;
    renderResults();
  });
  els.type.addEventListener("change", () => {
    state.type = els.type.value;
    renderResults();
  });
  els.results.addEventListener("click", (event) => {
    const inspect = event.target.closest("[data-inspect-card]");
    const add = event.target.closest("[data-add-card]");
    if (inspect) selectCard(inspect.dataset.inspectCard);
    if (add) addCard(add.dataset.addCard, Number(add.dataset.amount || 1));
  });
  els.deckSections.addEventListener("click", (event) => {
    const inspect = event.target.closest("[data-inspect-card]");
    const edit = event.target.closest("[data-deck-card]");
    if (inspect) selectCard(inspect.dataset.inspectCard);
    if (edit) addCard(edit.dataset.deckCard, Number(edit.dataset.amount || 1));
  });
  els.deckListTop.addEventListener("click", (event) => {
    const inspect = event.target.closest("[data-inspect-card]");
    const edit = event.target.closest("[data-deck-card]");
    if (inspect) selectCard(inspect.dataset.inspectCard);
    if (edit) addCard(edit.dataset.deckCard, Number(edit.dataset.amount || 1));
  });
  els.importDeck.addEventListener("click", importDeck);
  els.exportDeck.addEventListener("click", renderExport);
  els.clearDeck.addEventListener("click", () => {
    state.deck.clear();
    state.draw = null;
    persistDeck();
    renderDeckBoard();
  });
  els.drawTest.addEventListener("click", () => {
    state.draw = drawTestHand(currentSections(), state.index, { seed: Date.now(), handSize: 4, runeChannels: 2 });
    renderDraw();
  });
}

function render() {
  els.summary.textContent = `${state.cards.length.toLocaleString()} cards loaded`;
  renderResults();
  renderDeckBoard();
  renderPreview();
}

function renderResults() {
  const cards = filteredCards().slice(0, RESULT_LIMIT);
  const fragment = document.createDocumentFragment();
  for (const card of cards) fragment.append(resultNode(card));
  els.results.replaceChildren(fragment);
}

function filteredCards() {
  return state.cards.filter((card) => {
    if (card.banned) return false;
    if (state.color && !(card.colors ?? []).includes(state.color)) return false;
    if (state.type && card.card_type !== state.type) return false;
    if (!state.query) return true;
    return searchText(card).includes(state.query);
  });
}

function resultNode(card) {
  const article = document.createElement("article");
  article.className = ["deck-result", state.selectedId === card.id ? "selected" : ""].filter(Boolean).join(" ");
  article.dataset.inspectCard = card.id;

  const imageWrap = cardImage(card, "deck-thumb");
  const copy = div("deck-result-copy");
  copy.append(text("strong", card.name), text("span", `${card.id} · ${card.card_type || "Unknown"}`));
  const excerpt = text("p", compactText(card.effect_text || card.flavor || "No rules text.", 130));
  copy.append(excerpt, colorChips(card));

  const controls = div("deck-row-controls");
  controls.append(actionButton("+", "add-card", card.id, 1, "Add one"), actionButton("+3", "add-card", card.id, 3, "Add three"));

  article.append(imageWrap, copy, controls);
  return article;
}

function renderDeckBoard() {
  const sections = currentSections();
  const flatEntries = flattenDeckSections(sections).filter((entry) => entry.section !== "unknown");
  const summary = summarizeDeck(flatEntries, state.index);
  const validation = validateRiftboundDeck(sections);
  els.deckStats.replaceChildren(
    statNode(validation.counts.main, "main / 40"),
    statNode(validation.counts.runes, "runes / 12"),
    statNode(validation.counts.legends, "legend / 1"),
    statNode(validation.counts.battlefields, "fields / 3")
  );

  const validationNodes = [];
  for (const message of [...validation.errors, ...validation.warnings]) {
    const node = document.createElement("span");
    node.className = validation.errors.includes(message) ? "error" : "warning";
    node.textContent = message;
    validationNodes.push(node);
  }
  if (validationNodes.length === 0) validationNodes.push(pill("ok", "Constructed counts look legal"));
  els.validation.replaceChildren(...validationNodes);
  renderTopDeckList(sections, validation);

  const fragment = document.createDocumentFragment();
  for (const section of ["legends", "main", "runes", "battlefields"]) {
    fragment.append(sectionNode(section, sections[section] ?? [], sectionTargets[section]));
  }
  els.deckSections.replaceChildren(fragment);
  renderExport();
  renderDraw();
}

function renderTopDeckList(sections, validation) {
  const cardCount = validation.counts.legends + validation.counts.main + validation.counts.battlefields;
  els.cardDeckCount.textContent = `${cardCount} / 44`;
  els.runeDeckCount.textContent = `${validation.counts.runes} / 12`;

  els.cardDeckList.replaceChildren(
    compactSection("Chosen Legend", sections.legends ?? [], 1),
    compactSection("Main Deck", sections.main ?? [], 40),
    compactSection("Battlefields", sections.battlefields ?? [], 3)
  );
  els.runeDeckList.replaceChildren(compactSection("Rune Deck", sections.runes ?? [], 12));
}

function compactSection(label, entries, target) {
  const root = div("deck-list-subsection");
  const count = entries.reduce((total, entry) => total + entry.quantity, 0);
  const head = div("deck-list-subhead");
  head.append(text("h3", label), text("span", `${count} / ${target}`));
  root.append(head);

  if (entries.length === 0) {
    const empty = text("p", "Empty");
    empty.className = "deck-section-empty";
    root.append(empty);
    return root;
  }

  const list = div("deck-list-rows");
  for (const entry of entries) list.append(compactDeckRow(entry));
  root.append(list);
  return root;
}

function compactDeckRow(entry) {
  const card = state.index.byId.get(entry.id) ?? entry.card;
  const row = div("deck-list-row");
  row.dataset.inspectCard = entry.id;
  row.append(
    text("strong", `${entry.quantity}x`),
    text("span", card?.name || entry.id),
    text("small", entry.id),
    actionButton("-", "deck-card", entry.id, -1, "Remove one"),
    actionButton("+", "deck-card", entry.id, 1, "Add one")
  );
  return row;
}

function sectionNode(section, entries, target) {
  const root = document.createElement("section");
  root.className = "deck-section";
  const count = entries.reduce((total, entry) => total + entry.quantity, 0);
  const title = div("deck-section-title");
  title.append(text("h2", sectionLabels[section]), text("span", `${count} / ${target}`));
  root.append(title);

  if (entries.length === 0) {
    const empty = text("p", "No cards yet.");
    empty.className = "deck-section-empty";
    root.append(empty);
    return root;
  }

  const list = div("deck-lines");
  for (const entry of entries) {
    const card = state.index.byId.get(entry.id) ?? entry.card;
    const row = div("deck-line");
    row.dataset.inspectCard = entry.id;
    row.append(
      text("strong", `${entry.quantity}x`),
      text("span", `${entry.id} ${card?.name || ""}`),
      actionButton("-", "deck-card", entry.id, -1, "Remove one"),
      actionButton("+", "deck-card", entry.id, 1, "Add one")
    );
    list.append(row);
  }
  root.append(list);
  return root;
}

function importDeck() {
  const result = parseDeckList(els.importText.value, state.index);
  state.deck.clear();
  for (const entry of result.entries) state.deck.set(entry.id, entry.quantity);
  els.warnings.textContent = result.warnings.join("\n");
  state.draw = null;
  persistDeck();
  renderDeckBoard();
}

function renderExport() {
  els.exportText.value = exportDeckList(flattenDeckSections(currentSections()), state.index);
}

function addCard(id, amount) {
  const current = state.deck.get(id) || 0;
  const next = Math.max(0, current + amount);
  if (next === 0) state.deck.delete(id);
  else state.deck.set(id, next);
  state.selectedId = id;
  state.draw = null;
  persistDeck();
  renderDeckBoard();
  renderPreview();
}

function selectCard(id) {
  state.selectedId = id;
  renderPreview();
  renderResults();
}

function renderPreview() {
  const card = state.index.byId.get(state.selectedId) || filteredCards()[0];
  if (!card) {
    els.preview.replaceChildren(text("p", "Select a card."));
    return;
  }
  const root = div("card-preview-inner");
  root.append(cardImage(card, "card-preview-image"));
  const copy = div("card-preview-copy");
  copy.append(text("h2", card.name));
  const meta = div("meta");
  for (const value of [card.id, card.card_type, card.set_name, card.rarity].filter(Boolean)) meta.append(pill("pill", value));
  copy.append(meta, colorChips(card));
  copy.append(previewDeckStatus(card));
  const effect = text("p", card.effect_text || "No rules text.");
  effect.className = "detail-effect";
  const rules = div("preview-rules");
  rules.append(text("h3", "Rules text"), effect);
  copy.append(rules);
  if (card.flavor) {
    const flavor = text("p", card.flavor);
    flavor.className = "preview-flavor";
    copy.append(flavor);
  }
  const controls = div("preview-actions");
  controls.append(
    actionButton("-1", "add-card", card.id, -1, "Remove one"),
    actionButton("+1", "add-card", card.id, 1, "Add one"),
    actionButton("+3", "add-card", card.id, 3, "Add three")
  );
  controls.addEventListener("click", (event) => {
    const add = event.target.closest("[data-add-card]");
    if (add) addCard(add.dataset.addCard, Number(add.dataset.amount || 1));
  });
  copy.append(controls);
  root.append(copy);
  els.preview.replaceChildren(root);
}

function previewDeckStatus(card) {
  const node = div("preview-deck-status");
  const quantity = state.deck.get(card.id) || 0;
  node.append(
    statNode(quantity, "in deck"),
    statNode(sectionLabels[sectionForCard(card)] || "Main Deck", "section"),
    statNode(card.cost ?? "-", "cost")
  );
  return node;
}

function renderDraw() {
  if (!state.draw) {
    const empty = text("p", "Draw a 4-card opening hand and channel 2 runes.");
    empty.className = "deck-section-empty";
    els.drawOutput.replaceChildren(empty);
    return;
  }

  const root = document.createDocumentFragment();
  root.append(drawGroup("Opening hand", state.draw.hand), drawGroup("Channel 2 runes", state.draw.runes));
  els.drawOutput.replaceChildren(root);
}

function drawGroup(label, entries) {
  const group = div("draw-group");
  group.append(text("h3", label));
  const cards = div("draw-cards");
  for (const entry of entries) {
    const node = div("draw-card");
    node.dataset.inspectCard = entry.id;
    node.append(cardImage(entry.card, "draw-thumb"), text("span", entry.card?.name || entry.id));
    node.addEventListener("click", () => selectCard(entry.id));
    cards.append(node);
  }
  group.append(cards);
  return group;
}

function currentSections() {
  return buildDeckSections(deckEntries(), state.index);
}

function deckEntries() {
  return [...state.deck.entries()].map(([id, quantity]) => ({ id, quantity }));
}

function persistDeck() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(deckEntries()));
}

function restoreDeck() {
  try {
    const entries = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    for (const entry of entries) {
      if (state.index.byId.has(entry.id) && Number(entry.quantity) > 0) {
        state.deck.set(entry.id, Number(entry.quantity));
      }
    }
  } catch {
    state.deck.clear();
  }
}

function fillSelect(select, label, values) {
  select.replaceChildren(option("", label), ...values.map((value) => option(value, value)));
}

function cardImage(card, className) {
  const wrap = div(className);
  const image = document.createElement("img");
  image.loading = "lazy";
  image.decoding = "async";
  image.src = card?.local_image || card?.image_url || "";
  image.alt = card?.name || "";
  wrap.append(image);
  if (card?.has_foil) {
    const compact = className !== "card-preview-image";
    appendFoilLayers(wrap, { premium: !card.has_normal || card.rarity === "Showcase", compact });
    bindFoilSurface(wrap, { intensity: compact ? 0.34 : 0.82, tilt: compact ? 7.4 : 6, compact });
  }
  return wrap;
}

function option(value, label) {
  const node = document.createElement("option");
  node.value = value;
  node.textContent = label;
  return node;
}

function unique(values) {
  return [...new Set(values)].sort((a, b) => String(a).localeCompare(String(b)));
}

function text(tag, value) {
  const node = document.createElement(tag);
  node.textContent = value;
  return node;
}

function div(className) {
  const node = document.createElement("div");
  node.className = className;
  return node;
}

function pill(className, value) {
  const node = document.createElement("span");
  node.className = className;
  node.textContent = value;
  return node;
}

function actionButton(label, attribute, id, amount, ariaLabel) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.setAttribute(`data-${attribute}`, id);
  button.dataset.amount = String(amount);
  button.setAttribute("aria-label", ariaLabel);
  return button;
}

function statNode(value, label) {
  const node = document.createElement("span");
  node.innerHTML = `<strong>${value}</strong>${label}`;
  return node;
}

function colorChips(card) {
  const chips = div("chips");
  for (const color of card.colors ?? []) chips.append(pill(`chip ${cssToken(color)}`, color));
  return chips;
}

function searchText(card) {
  return [
    card.id,
    card.name,
    card.effect_text,
    card.flavor,
    card.card_type,
    card.set_name,
    card.rarity,
    sectionForCard(card),
    ...(card.colors ?? []),
    ...(card.tags ?? []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function compactText(value, maxLength) {
  const textValue = String(value ?? "").replace(/\s+/g, " ").trim();
  if (textValue.length <= maxLength) return textValue;
  return `${textValue.slice(0, maxLength - 1)}...`;
}

function findPreferredCard(ids) {
  for (const id of ids) {
    const card = state.index.byId.get(id);
    if (card) return card;
  }
  return null;
}

function cssToken(value) {
  return String(value).replace(/[^a-z0-9_-]/gi, "");
}

boot().catch((error) => {
  console.error(error);
  els.summary.textContent = "Could not load cards.json.";
});
