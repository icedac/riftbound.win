export function normalizeCardId(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, "")
    .toUpperCase();
}

export function createCardIndex(cards = []) {
  const byId = new Map();
  const byName = new Map();

  for (const card of cards) {
    if (!card?.id) continue;
    const id = normalizeCardId(card.id);
    byId.set(id, card);
    byName.set(normalizeName(card.name), card);
  }

  return {
    cards,
    byId,
    byName,
    idsByLength: [...byId.keys()].sort((a, b) => b.length - a.length || a.localeCompare(b)),
  };
}

export function parseDeckList(text, cardsOrIndex = []) {
  const index = ensureIndex(cardsOrIndex);
  const quantities = new Map();
  const order = [];
  const warnings = [];

  String(text ?? "")
    .split(/\r?\n/)
    .forEach((rawLine, idx) => {
      const lineNumber = idx + 1;
      const line = stripComment(rawLine).trim();
      if (!line) return;

      const parsed = parseQuantity(line);
      if (!parsed) {
        warnings.push(`Line ${lineNumber}: could not parse "${rawLine.trim()}".`);
        return;
      }

      const id = findCardId(parsed.cardText, index);
      if (!id) {
        warnings.push(`Line ${lineNumber}: unknown card "${parsed.cardText.trim()}".`);
        return;
      }

      if (!quantities.has(id)) {
        quantities.set(id, 0);
        order.push(id);
      }
      quantities.set(id, quantities.get(id) + parsed.quantity);
    });

  return {
    entries: order.map((id) => ({
      id,
      quantity: quantities.get(id),
      card: index.byId.get(id),
    })),
    warnings,
  };
}

export function exportDeckList(entries = [], cardsOrIndex = []) {
  const index = ensureIndex(cardsOrIndex);
  return entries
    .filter((entry) => Number(entry?.quantity) > 0 && entry?.id)
    .map((entry) => {
      const id = normalizeCardId(entry.id);
      const card = index.byId.get(id) ?? entry.card;
      const name = card?.name ? ` ${card.name}` : "";
      return `${Number(entry.quantity)}x ${id}${name}`;
    })
    .join("\n");
}

export function summarizeDeck(entries = [], cardsOrIndex = []) {
  const index = ensureIndex(cardsOrIndex);
  const summary = {
    total: 0,
    colors: {},
    types: {},
    costs: {},
  };

  for (const entry of entries) {
    const quantity = Number(entry?.quantity) || 0;
    if (quantity <= 0) continue;
    const id = normalizeCardId(entry.id);
    const card = index.byId.get(id) ?? entry.card;
    summary.total += quantity;
    addCount(summary.types, card?.card_type || "Unknown", quantity);
    addCount(summary.costs, card?.cost ?? "No cost", quantity);
    const colors = card?.colors?.length ? card.colors : ["Colorless"];
    for (const color of colors) addCount(summary.colors, color, quantity);
  }

  return summary;
}

function ensureIndex(cardsOrIndex) {
  if (cardsOrIndex?.byId && cardsOrIndex?.idsByLength) return cardsOrIndex;
  return createCardIndex(cardsOrIndex);
}

function stripComment(line) {
  return String(line ?? "").replace(/\s*(#|\/\/).*$/, "");
}

function parseQuantity(line) {
  const prefix = line.match(/^(\d{1,3})\s*x?\s+(.+)$/i);
  if (prefix) return quantityResult(prefix[1], prefix[2]);

  const suffix = line.match(/^(.+?)\s*(?:x|\*)\s*(\d{1,3})$/i);
  if (suffix) return quantityResult(suffix[2], suffix[1]);

  return { quantity: 1, cardText: line };
}

function quantityResult(rawQuantity, cardText) {
  const quantity = Number.parseInt(rawQuantity, 10);
  if (!Number.isFinite(quantity) || quantity <= 0) return null;
  return { quantity, cardText };
}

function findCardId(cardText, index) {
  const normalizedDirect = normalizeCardId(cardText);
  if (index.byId.has(normalizedDirect)) return normalizedDirect;

  const upper = String(cardText ?? "").toUpperCase();
  for (const id of index.idsByLength) {
    const pattern = new RegExp(`(^|[^A-Z0-9.-])${escapeRegExp(id)}($|[^A-Z0-9.-])`);
    if (pattern.test(upper)) return id;
  }

  const byName = index.byName.get(normalizeName(cardText));
  return byName ? normalizeCardId(byName.id) : null;
}

function addCount(target, key, quantity) {
  target[key] = (target[key] || 0) + quantity;
}

function normalizeName(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
