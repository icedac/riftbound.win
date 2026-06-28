export function resolveInitialCardFilters(cards, filters = {}) {
  const normalized = normalizeFilters(filters);
  const filtered = filterCards(cards, normalized);
  if (filtered.length > 0 || !hasRecoverableInitialFilter(normalized)) {
    return { filters: normalized, filtered, clearedInitialSearch: false };
  }

  const cleared = normalizeFilters({});
  return {
    filters: cleared,
    filtered: filterCards(cards, cleared),
    clearedInitialSearch: Boolean(normalized.search),
  };
}

export function filterCards(cards, filters = {}) {
  const normalized = normalizeFilters(filters);
  return cards.filter((card) => {
    if (normalized.hideBanned && card.banned) return false;
    if (normalized.backOnly && !card.local_image_back) return false;
    if (normalized.color && !(card.colors ?? []).includes(normalized.color)) return false;
    if (normalized.type && card.card_type !== normalized.type) return false;
    if (normalized.set && card.set_name !== normalized.set) return false;
    if (normalized.rarity && card.rarity !== normalized.rarity) return false;
    if (normalized.cost && (card.cost ?? "No cost") !== normalized.cost) return false;
    if (normalized.tag && !(card.tags ?? []).includes(normalized.tag)) return false;
    if (normalized.search && !cardSearchText(card).includes(normalized.search)) return false;
    return true;
  });
}

export function normalizeFilters(filters = {}) {
  return {
    search: normalizeSearch(filters.search),
    color: filters.color || "",
    type: filters.type || "",
    set: filters.set || "",
    rarity: filters.rarity || "",
    cost: filters.cost || "",
    tag: filters.tag || "",
    backOnly: Boolean(filters.backOnly),
    hideBanned: filters.hideBanned !== false,
  };
}

export function normalizeSearch(value) {
  return String(value || "").trim().toLowerCase();
}

export function cardSearchText(card) {
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

function hasRecoverableInitialFilter(filters) {
  return Boolean(
    filters.search ||
      filters.color ||
      filters.type ||
      filters.set ||
      filters.rarity ||
      filters.cost ||
      filters.tag ||
      filters.backOnly
  );
}
