const state = {
  cards: [],
  filtered: [],
  search: "",
  color: "",
  type: "",
  set: "",
  rarity: "",
  cost: "",
  tag: "",
  backOnly: false,
  hideBanned: true,
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
  applyFilters();
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
    state.search = els.search.value.trim().toLowerCase();
    applyFilters();
  });

  for (const [key] of selects) {
    els[key].addEventListener("change", () => {
      state[key] = els[key].value;
      applyFilters();
    });
  }

  els.backOnly.addEventListener("change", () => {
    state.backOnly = els.backOnly.checked;
    applyFilters();
  });

  els.hideBanned.addEventListener("change", () => {
    state.hideBanned = els.hideBanned.checked;
    applyFilters();
  });

  els.reset.addEventListener("click", resetFilters);
  els.closeDetail.addEventListener("click", () => els.detail.close());
  els.detail.addEventListener("click", (event) => {
    if (event.target === els.detail) els.detail.close();
  });
}

function applyFilters() {
  state.filtered = state.cards.filter((card) => {
    if (state.hideBanned && card.banned) return false;
    if (state.backOnly && !card.local_image_back) return false;
    if (state.color && !(card.colors ?? []).includes(state.color)) return false;
    if (state.type && card.card_type !== state.type) return false;
    if (state.set && card.set_name !== state.set) return false;
    if (state.rarity && card.rarity !== state.rarity) return false;
    if (state.cost && (card.cost ?? "No cost") !== state.cost) return false;
    if (state.tag && !(card.tags ?? []).includes(state.tag)) return false;
    if (state.search && !searchText(card).includes(state.search)) return false;
    return true;
  });
  render();
}

function render() {
  els.summary.textContent = `${state.filtered.length.toLocaleString()} / ${state.cards.length.toLocaleString()} cards`;
  if (state.filtered.length === 0) {
    els.grid.replaceChildren(emptyState());
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const card of state.filtered) {
    fragment.append(cardNode(card));
  }
  els.grid.replaceChildren(fragment);
}

function cardNode(card) {
  const article = document.createElement("article");
  article.className = [
    "card",
    card.image_orientation === "landscape" ? "is-landscape-card" : "",
    card.has_foil ? "is-foil-card" : "",
    isPremiumFoil(card) ? "is-premium-foil" : "",
  ]
    .filter(Boolean)
    .join(" ");
  article.dataset.orientation = card.image_orientation || "portrait";
  article.dataset.rarity = card.rarity || "";
  const button = document.createElement("button");
  button.type = "button";
  button.addEventListener("pointermove", (event) => updateFoilPointer(article, event));
  button.addEventListener("pointerleave", () => resetFoilPointer(article));
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
  if (card.has_foil) appendFoilLayers(imageWrap);

  const body = div("card-body");
  const title = div("card-title");
  const name = document.createElement("strong");
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
  const price = formatPrice(card.price);
  if (price) footer.append(span("card-price", price));

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
      appendFoilLayers(shell);
      shell.addEventListener("pointermove", (event) => updateFoilPointer(shell, event));
      shell.addEventListener("pointerleave", () => resetFoilPointer(shell));
    }
    images.append(shell);
  }

  const copy = div("detail-copy");
  const title = document.createElement("h2");
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
  els.search.value = "";
  for (const [key] of selects) els[key].value = "";
  els.backOnly.checked = false;
  els.hideBanned.checked = true;
  applyFilters();
}

function uniqueValues(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => {
    const numeric = Number(a) - Number(b);
    if (Number.isFinite(numeric) && numeric !== 0) return numeric;
    return String(a).localeCompare(String(b));
  });
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
    ...(card.colors ?? []),
    ...(card.tags ?? []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
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

function appendFoilLayers(parent) {
  for (const className of ["foil-prism", "foil-lines", "foil-glare"]) {
    parent.append(div(`foil-layer ${className}`));
  }
}

function updateFoilPointer(targetNode, event) {
  const isFoilTarget =
    targetNode.classList.contains("is-foil-card") ||
    targetNode.classList.contains("is-foil-detail");
  if (!isFoilTarget) return;
  const rect = targetNode.getBoundingClientRect();
  const x = clamp(((event.clientX - rect.left) / rect.width) * 100, 0, 100);
  const y = clamp(((event.clientY - rect.top) / rect.height) * 100, 0, 100);
  const isDetail = targetNode.classList.contains("is-foil-detail");
  targetNode.style.setProperty("--pointer-x", `${x.toFixed(2)}%`);
  targetNode.style.setProperty("--pointer-y", `${y.toFixed(2)}%`);
  targetNode.style.setProperty("--foil-opacity", isDetail ? "0.24" : "0.30");
  targetNode.style.setProperty("--foil-glare", isDetail ? "0.28" : "0.32");
}

function resetFoilPointer(targetNode) {
  targetNode.style.removeProperty("--pointer-x");
  targetNode.style.removeProperty("--pointer-y");
  targetNode.style.removeProperty("--foil-opacity");
  targetNode.style.removeProperty("--foil-glare");
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
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
