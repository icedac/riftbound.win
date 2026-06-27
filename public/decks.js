import {
  createCardIndex,
  exportDeckList,
  parseDeckList,
  summarizeDeck,
} from "/deck-utils.js";
import { appendFoilLayers, bindFoilSurface } from "/foil.js";

const STORAGE_KEY = "riftbound.deck.v1";
const state = {
  cards: [],
  index: createCardIndex([]),
  query: "",
  color: "",
  type: "",
  deck: new Map(),
};

const els = {
  summary: document.querySelector("#deckSummary"),
  search: document.querySelector("#deckSearch"),
  color: document.querySelector("#deckColor"),
  type: document.querySelector("#deckType"),
  results: document.querySelector("#deckResults"),
  deckStats: document.querySelector("#deckStats"),
  deckList: document.querySelector("#deckList"),
  importText: document.querySelector("#importText"),
  importDeck: document.querySelector("#importDeck"),
  exportText: document.querySelector("#exportText"),
  exportDeck: document.querySelector("#exportDeck"),
  clearDeck: document.querySelector("#clearDeck"),
  warnings: document.querySelector("#importWarnings"),
};

async function boot() {
  const response = await fetch("/cards.json", { cache: "no-store" });
  if (!response.ok) throw new Error(`Failed to load cards.json: ${response.status}`);
  state.cards = await response.json();
  state.index = createCardIndex(state.cards);
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
    const button = event.target.closest("[data-add-card]");
    if (!button) return;
    addCard(button.dataset.addCard, Number(button.dataset.amount || 1));
  });
  els.deckList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-deck-card]");
    if (!button) return;
    addCard(button.dataset.deckCard, Number(button.dataset.amount || 1));
  });
  els.importDeck.addEventListener("click", importDeck);
  els.exportDeck.addEventListener("click", renderExport);
  els.clearDeck.addEventListener("click", () => {
    state.deck.clear();
    persistDeck();
    renderDeck();
  });
}

function render() {
  els.summary.textContent = `${state.cards.length.toLocaleString()} cards loaded`;
  renderResults();
  renderDeck();
}

function renderResults() {
  const cards = filteredCards().slice(0, 80);
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
    return [
      card.id,
      card.name,
      card.effect_text,
      card.card_type,
      ...(card.colors ?? []),
      ...(card.tags ?? []),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(state.query);
  });
}

function resultNode(card) {
  const article = document.createElement("article");
  article.className = "deck-result";

  const imageWrap = document.createElement("div");
  imageWrap.className = "deck-thumb";
  const image = document.createElement("img");
  image.loading = "lazy";
  image.decoding = "async";
  image.src = card.local_image || card.image_url || "";
  image.alt = card.name;
  imageWrap.append(image);
  if (card.has_foil) {
    appendFoilLayers(imageWrap, { premium: !card.has_normal || card.rarity === "Showcase" });
    bindFoilSurface(imageWrap, { intensity: 0.7, tilt: 6 });
  }

  const copy = document.createElement("div");
  copy.className = "deck-result-copy";
  copy.append(text("strong", card.name), text("span", `${card.id} · ${card.card_type || "Unknown"}`));
  const colors = document.createElement("div");
  colors.className = "chips";
  for (const color of card.colors ?? []) colors.append(pill(`chip ${cssToken(color)}`, color));
  copy.append(colors);

  const controls = document.createElement("div");
  controls.className = "deck-row-controls";
  controls.append(actionButton("+", card.id, 1, "Add one"), actionButton("+3", card.id, 3, "Add three"));

  article.append(imageWrap, copy, controls);
  return article;
}

function renderDeck() {
  const entries = deckEntries();
  const summary = summarizeDeck(entries, state.index);
  els.deckStats.replaceChildren(
    statNode(summary.total, "cards"),
    statNode(Object.keys(summary.colors).length, "colors"),
    statNode(Object.keys(summary.types).length, "types")
  );

  if (entries.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty compact-empty";
    empty.textContent = "No cards in deck.";
    els.deckList.replaceChildren(empty);
    renderExport();
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const entry of entries) {
    const card = state.index.byId.get(entry.id);
    const row = document.createElement("div");
    row.className = "deck-line";
    row.append(
      text("strong", `${entry.quantity}x`),
      text("span", `${entry.id} ${card?.name || ""}`),
      actionButton("-", entry.id, -1, "Remove one", "deck-card"),
      actionButton("+", entry.id, 1, "Add one", "deck-card")
    );
    fragment.append(row);
  }
  els.deckList.replaceChildren(fragment);
  renderExport();
}

function importDeck() {
  const result = parseDeckList(els.importText.value, state.index);
  state.deck.clear();
  for (const entry of result.entries) state.deck.set(entry.id, entry.quantity);
  els.warnings.textContent = result.warnings.join("\n");
  persistDeck();
  renderDeck();
}

function renderExport() {
  els.exportText.value = exportDeckList(deckEntries(), state.index);
}

function addCard(id, amount) {
  const current = state.deck.get(id) || 0;
  const next = Math.max(0, current + amount);
  if (next === 0) state.deck.delete(id);
  else state.deck.set(id, next);
  persistDeck();
  renderDeck();
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

function pill(className, value) {
  const node = document.createElement("span");
  node.className = className;
  node.textContent = value;
  return node;
}

function actionButton(label, id, amount, ariaLabel, attribute = "add-card") {
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

function cssToken(value) {
  return String(value).replace(/[^a-z0-9_-]/gi, "");
}

boot().catch((error) => {
  console.error(error);
  els.summary.textContent = "Could not load cards.json.";
});
