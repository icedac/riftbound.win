import { appendFoilLayers, bindFoilSurface } from "/foil.js?v=20260628-cardboot3";
import { filterCards, normalizeSearch, resolveInitialCardFilters } from "/card-filter-state.js?v=20260628-cardboot3";
import { PAGE_SIZE, hasMoreCards, nextAutoVisibleCount } from "/paging.js?v=20260628-cardboot3";

const state = {
  cards: [],
  filtered: [],
  visibleCount: 96,
  search: "",
  color: "",
  type: "",
  set: "",
  rarity: "",
  cost: "",
  tag: "",
  backOnly: false,
  hideBanned: true,
  autoLoadFrame: 0,
  autoPager: null,
};

const els = {
  summary: document.querySelector("#summary"),
  grid: document.querySelector("#grid"),
  search: document.querySelector("#search"),
  color: document.querySelector("#color"),
  type: document.querySelector("#type"),
  set: document.querySelector("#set"),
  rarity: document.querySelector("#rarity"),
  cost: document.querySelector("#cost"),
  tag: document.querySelector("#tag"),
  backOnly: document.querySelector("#backOnly"),
  hideBanned: document.querySelector("#hideBanned"),
  reset: document.querySelector("#reset"),
  sentinel: document.querySelector("#scrollSentinel"),
  detail: document.querySelector("#detail"),
  detailBody: document.querySelector("#detailBody"),
  closeDetail: document.querySelector("#closeDetail"),
};

const selects = [
  ["color", "All colors", (card) => card.colors ?? []],
  ["type", "All types", (card) => [card.card_type].filter(Boolean)],
  ["set", "All sets", (card) => [card.set_name].filter(Boolean)],
  ["rarity", "All rarities", (card) => [card.rarity].filter(Boolean)],
  ["cost", "All costs", (card) => [card.cost ?? "No cost"]],
  ["tag", "All tags", (card) => card.tags ?? []],
];

async function boot() {
  const response = await fetch("/cards.json", { cache: "no-store" });
  if (!response.ok) throw new Error(`Failed to load cards.json: ${response.status}`);
  state.cards = await response.json();
  buildFilters();
  bindEvents();
  readInitialSearch();
  applyInitialFilters();
}

function buildFilters() {
  for (const [key, label, getter] of selects) {
    const values = uniqueValues(state.cards.flatMap(getter));
    const select = els[key];
    select.replaceChildren(option("", label), ...values.map((value) => option(value, value)));
  }
}

function bindEvents() {
  els.search.addEventListener("input", () => {
    state.search = normalizeSearch(els.search.value);
    state.visibleCount = PAGE_SIZE;
    applyFilters();
  });

  for (const [key] of selects) {
    els[key].addEventListener("change", () => {
      state[key] = els[key].value;
      state.visibleCount = PAGE_SIZE;
      applyFilters();
    });
  }

  els.backOnly.addEventListener("change", () => {
    state.backOnly = els.backOnly.checked;
    state.visibleCount = PAGE_SIZE;
    applyFilters();
  });

  els.hideBanned.addEventListener("change", () => {
    state.hideBanned = els.hideBanned.checked;
    state.visibleCount = PAGE_SIZE;
    applyFilters();
  });

  els.reset.addEventListener("click", resetFilters);
  setupAutoPager();
  els.closeDetail.addEventListener("click", () => els.detail.close());
  els.detail.addEventListener("click", (event) => {
    if (event.target === els.detail) els.detail.close();
  });
}

function applyFilters() {
  state.filtered = filterCards(state.cards, state);
  render();
}

function applyInitialFilters() {
  const result = resolveInitialCardFilters(state.cards, state);
  Object.assign(state, result.filters);
  syncFilterControls();
  if (result.clearedInitialSearch) clearQueryParam("q");
  state.filtered = result.filtered;
  render();
}

function render() {
  const visibleCards = state.filtered.slice(0, state.visibleCount);
  els.summary.textContent = `${visibleCards.length.toLocaleString()} shown / ${state.filtered.length.toLocaleString()} filtered / ${state.cards.length.toLocaleString()} cards`;
  if (state.filtered.length === 0) {
    els.grid.replaceChildren(emptyState());
    updateSentinel(0, 0);
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const card of visibleCards) {
    fragment.append(cardNode(card));
  }
  els.grid.replaceChildren(fragment);
  updateSentinel(visibleCards.length, state.filtered.length);
  scheduleAutoLoad();
}

function setupAutoPager() {
  if (!els.sentinel) return;
  if ("IntersectionObserver" in window) {
    state.autoPager = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) revealNextPage();
      },
      { rootMargin: "900px 0px 1200px" }
    );
    state.autoPager.observe(els.sentinel);
  }
  window.addEventListener("scroll", scheduleAutoLoad, { passive: true });
  window.addEventListener("resize", scheduleAutoLoad);
}

function updateSentinel(visible, total) {
  if (!els.sentinel) return;
  const hasMore = hasMoreCards(visible, total);
  els.sentinel.hidden = !hasMore;
  els.sentinel.setAttribute("aria-hidden", hasMore ? "false" : "true");
}

function scheduleAutoLoad() {
  if (state.autoLoadFrame) return;
  state.autoLoadFrame = requestAnimationFrame(() => {
    state.autoLoadFrame = 0;
    maybeAutoLoad();
  });
}

function maybeAutoLoad() {
  if (!els.sentinel || els.sentinel.hidden) return;
  if (!hasMoreCards(state.visibleCount, state.filtered.length)) return;
  const rect = els.sentinel.getBoundingClientRect();
  const next = nextAutoVisibleCount({
    current: state.visibleCount,
    total: state.filtered.length,
    pageSize: PAGE_SIZE,
    sentinelTop: rect.top,
    viewportHeight: window.innerHeight,
    estimatedPageHeight: estimatePageHeight(PAGE_SIZE),
  });
  if (next !== state.visibleCount) {
    state.visibleCount = next;
    render();
  }
}

function revealNextPage() {
  scheduleAutoLoad();
}

function estimatePageHeight(pageSize) {
  if (!els.grid) return window.innerHeight;

  const firstCard = els.grid.querySelector(".card");
  if (!firstCard) return window.innerHeight;

  const gridStyles = getComputedStyle(els.grid);
  const columns = gridStyles.gridTemplateColumns
    .split(" ")
    .map((column) => column.trim())
    .filter(Boolean).length;
  const rowGap = Number.parseFloat(gridStyles.rowGap || gridStyles.gap || "0") || 0;
  const cardHeight = firstCard.getBoundingClientRect().height || window.innerHeight;

  return Math.ceil(pageSize / Math.max(1, columns)) * (cardHeight + rowGap);
}

function cardNode(card) {
  const article = document.createElement("article");
  article.className = [
    "card",
    card.image_orientation === "landscape" ? "is-landscape-card" : "",
    card.has_foil ? "is-foil-card" : "",
    isPremiumFoil(card) ? "is-premium-foil" : "",
    isFoilOnly(card) ? "is-foil-only" : "",
  ]
    .filter(Boolean)
    .join(" ");
  article.dataset.orientation = card.image_orientation || "portrait";
  article.dataset.rarity = card.rarity || "";
  const button = document.createElement("button");
  button.type = "button";
  button.addEventListener("click", () => openDetail(card));

  const imageWrap = div(
    [
      "image-wrap",
      card.image_orientation === "landscape" ? "is-landscape" : "",
      card.has_foil ? "is-foil" : "",
      isPremiumFoil(card) ? "is-premium" : "",
    ]
      .filter(Boolean)
      .join(" ")
  );
  const image = document.createElement("img");
  image.loading = "lazy";
  image.decoding = "async";
  image.src = card.local_image || card.image_url || "";
  image.alt = card.name;
  imageWrap.append(image);
  if (card.has_foil) {
    appendFoilLayers(imageWrap, { premium: isPremiumFoil(card) });
    bindFoilSurface(imageWrap, { intensity: isPremiumFoil(card) ? 1 : 0.82, tilt: 5.2 });
  }

  const body = div("card-body");
  const title = div("card-title");
  const name = document.createElement("strong");
  if (isFoilOnly(card)) name.className = "foil-only-name";
  name.textContent = card.name;
  title.append(name);
  if (card.cost) title.append(span("cost", card.cost));

  const meta = div("meta");
  for (const value of [card.card_type, card.rarity].filter(Boolean)) {
    meta.append(span("pill", value));
  }
  if (card.has_foil) {
    meta.append(span("pill foil-pill", card.has_normal ? "Foil" : "Foil only"));
  }

  const chips = div("chips");
  for (const color of card.colors ?? []) {
    chips.append(span(`chip ${cssToken(color)}`, color));
  }

  const footer = div("card-footer");
  footer.append(span("card-id", card.id));
  const price = displayPrice(card);
  if (price) footer.append(span(`card-price ${price.isFoil ? "foil-price" : ""}`, price.label));

  body.append(title, meta, chips, footer);
  button.append(imageWrap, body);
  article.append(button);
  return article;
}

function openDetail(card) {
  const root = div(
    ["detail", card.image_orientation === "landscape" ? "has-landscape" : ""]
      .filter(Boolean)
      .join(" ")
  );
  const images = div("detail-images");
  const imageEntries = [
    {
      src: card.local_image || card.image_url,
      orientation: card.image_orientation,
      label: "front",
    },
    {
      src: card.local_image_back || card.image_back_url,
      orientation: card.image_back_orientation,
      label: "back",
    },
  ].filter((entry) => entry.src);
  for (const entry of imageEntries) {
    const shell = div(
      [
        "detail-image-shell",
        entry.orientation === "landscape" ? "is-landscape" : "",
        card.has_foil ? "is-foil-detail" : "",
      ]
        .filter(Boolean)
        .join(" ")
    );
    const image = document.createElement("img");
    image.src = entry.src;
    image.alt = `${card.name} ${entry.label}`;
    shell.append(image);
    if (card.has_foil) {
      appendFoilLayers(shell, { premium: isPremiumFoil(card) });
      bindFoilSurface(shell, { intensity: 1, tilt: 3.6 });
    }
    images.append(shell);
  }

  const copy = div("detail-copy");
  const title = document.createElement("h2");
  if (isFoilOnly(card)) title.className = "foil-only-name";
  title.textContent = card.name;
  const meta = div("meta");
  for (const value of [card.id, card.card_type, card.set_name, card.rarity].filter(Boolean)) {
    meta.append(span("pill", value));
  }
  if (card.has_foil) {
    meta.append(span("pill foil-pill", card.has_normal ? "Foil available" : "Foil only"));
  }
  const chips = div("chips");
  for (const value of [...(card.colors ?? []), ...(card.tags ?? [])]) {
    chips.append(span(`chip ${cssToken(value)}`, value));
  }
  const effect = document.createElement("p");
  effect.className = "detail-effect";
  appendRichText(effect, card.effect_text || "No rules text.");
  copy.append(title, meta, chips, effect);
  if (card.flavor) copy.append(paragraph(card.flavor));
  if (card.price || card.foil_price) {
    copy.append(
      span(
        "price",
        `Normal ${formatPrice(card.price) || "-"} / Foil ${formatPrice(card.foil_price) || "-"}`
      )
    );
  }
  if (card.banned) copy.append(span("banned", "Banned"));

  root.append(images, copy);
  els.detailBody.replaceChildren(root);
  els.detail.showModal();
}

function resetFilters() {
  state.search = "";
  state.color = "";
  state.type = "";
  state.set = "";
  state.rarity = "";
  state.cost = "";
  state.tag = "";
  state.backOnly = false;
  state.hideBanned = true;
  state.visibleCount = PAGE_SIZE;
  syncFilterControls();
  clearQueryParam("q");
  applyFilters();
}

function syncFilterControls() {
  els.search.value = state.search;
  for (const [key] of selects) els[key].value = state[key] || "";
  els.backOnly.checked = state.backOnly;
  els.hideBanned.checked = state.hideBanned;
}

function clearQueryParam(key) {
  const url = new URL(window.location.href);
  if (!url.searchParams.has(key)) return;
  url.searchParams.delete(key);
  const next = `${url.pathname}${url.search}${url.hash}`;
  window.history.replaceState({}, "", next);
}

function readInitialSearch() {
  const params = new URLSearchParams(window.location.search);
  const query = params.get("q");
  if (!query) return;
  state.search = normalizeSearch(query);
  els.search.value = query.trim();
  state.visibleCount = PAGE_SIZE;
}

function uniqueValues(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => {
    const numeric = Number(a) - Number(b);
    if (Number.isFinite(numeric) && numeric !== 0) return numeric;
    return String(a).localeCompare(String(b));
  });
}

function option(value, label) {
  const node = document.createElement("option");
  node.value = value;
  node.textContent = label;
  return node;
}

function div(className) {
  const node = document.createElement("div");
  node.className = className;
  return node;
}

function span(className, text) {
  const node = document.createElement("span");
  node.className = className;
  node.textContent = text;
  return node;
}

function appendRichText(parent, text) {
  parent.replaceChildren();
  const pattern = /(:rb_[a-z0-9_]+:)/g;
  const parts = String(text).split(pattern);
  for (const part of parts) {
    if (!part) continue;
    const symbol = symbolFor(part);
    if (symbol) {
      const node = span(`rb-symbol ${symbol.className}`, symbol.label);
      node.title = symbol.title;
      node.setAttribute("aria-label", symbol.title);
      parent.append(node);
    } else {
      parent.append(document.createTextNode(part));
    }
  }
}

function symbolFor(token) {
  const symbols = {
    ":rb_might:": { label: "⚔", title: "Might", className: "might" },
    ":rb_exhaust:": { label: "↷", title: "Exhaust", className: "exhaust" },
    ":rb_rune_body:": { label: "B", title: "Body rune", className: "rune body" },
    ":rb_rune_calm:": { label: "C", title: "Calm rune", className: "rune calm" },
    ":rb_rune_chaos:": { label: "X", title: "Chaos rune", className: "rune chaos" },
    ":rb_rune_fury:": { label: "F", title: "Fury rune", className: "rune fury" },
    ":rb_rune_mind:": { label: "M", title: "Mind rune", className: "rune mind" },
    ":rb_rune_order:": { label: "O", title: "Order rune", className: "rune order" },
    ":rb_rune_rainbow:": { label: "✦", title: "Any rune", className: "rune rainbow" },
  };
  if (symbols[token]) return symbols[token];

  const energy = token.match(/^:rb_energy_(\d+):$/);
  if (energy) {
    return {
      label: energy[1],
      title: `${energy[1]} energy`,
      className: "energy",
    };
  }
  return null;
}

function isPremiumFoil(card) {
  return Boolean(
    card.has_foil &&
      (!card.has_normal || card.promo || ["Showcase", "Epic"].includes(card.rarity))
  );
}

function isFoilOnly(card) {
  return Boolean(card.has_foil && !card.has_normal);
}

function displayPrice(card) {
  if (isFoilOnly(card)) {
    const foil = formatPrice(card.foil_price);
    return foil ? { label: `Foil ${foil}`, isFoil: true } : null;
  }
  const normal = formatPrice(card.price);
  return normal ? { label: normal, isFoil: false } : null;
}

function paragraph(text) {
  const node = document.createElement("p");
  node.textContent = text;
  return node;
}

function formatPrice(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return "";
  return `$${parsed.toFixed(parsed >= 10 ? 2 : 2)}`;
}

function emptyState() {
  const node = document.createElement("p");
  node.className = "empty";
  node.textContent = "No cards match the current filters.";
  return node;
}

function cssToken(value) {
  return String(value).replace(/[^a-z0-9_-]/gi, "");
}

boot().catch((error) => {
  console.error(error);
  els.summary.textContent = "Could not load cards.json. Run cargo run -- sync first.";
});
