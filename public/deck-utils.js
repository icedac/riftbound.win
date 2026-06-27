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

export function sectionForCard(card) {
  const type = String(card?.card_type ?? "").toLowerCase();
  if (type === "rune") return "runes";
  if (type === "legend") return "legends";
  if (type === "battlefield") return "battlefields";
  return "main";
}

export function buildDeckSections(entries = [], cardsOrIndex = []) {
  const index = ensureIndex(cardsOrIndex);
  const sections = {
    main: [],
    runes: [],
    legends: [],
    battlefields: [],
    unknown: [],
  };

  for (const entry of entries) {
    const id = normalizeCardId(entry?.id);
    const quantity = Number(entry?.quantity) || 0;
    if (!id || quantity <= 0) continue;
    const card = index.byId.get(id) ?? entry.card;
    const section = card ? sectionForCard(card) : "unknown";
    sections[section].push({ id, quantity, card });
  }

  return sections;
}

export function flattenDeckSections(sections = {}) {
  return ["main", "runes", "legends", "battlefields", "unknown"].flatMap((section) =>
    (sections[section] ?? []).map((entry) => ({ ...entry, section }))
  );
}

export function validateRiftboundDeck(sections = {}) {
  const counts = {
    main: countSection(sections.main),
    runes: countSection(sections.runes),
    legends: countSection(sections.legends),
    battlefields: countSection(sections.battlefields),
  };
  const errors = [];
  const warnings = [];

  if (counts.main !== 40) errors.push(`Main deck must be exactly 40 cards. Current: ${counts.main}.`);
  if (counts.runes !== 12) errors.push(`Rune deck must be exactly 12 runes. Current: ${counts.runes}.`);
  if (counts.legends !== 1) errors.push(`Choose exactly 1 legend. Current: ${counts.legends}.`);
  if (counts.battlefields !== 3) errors.push(`Choose exactly 3 battlefields. Current: ${counts.battlefields}.`);

  const uniqueBattlefields = new Set((sections.battlefields ?? []).map((entry) => entry.id)).size;
  if (counts.battlefields === 3 && uniqueBattlefields < 3) {
    warnings.push("Tournament rules use 3 unique battlefields.");
  }

  return { counts, errors, warnings, ok: errors.length === 0 };
}

export function drawTestHand(sections = {}, cardsOrIndex = [], options = {}) {
  const index = ensureIndex(cardsOrIndex);
  const seed = Number(options.seed ?? Date.now());
  const handSize = Number(options.handSize ?? 4);
  const runeChannels = Number(options.runeChannels ?? 2);
  const mainPool = expandEntries(sections.main ?? [], index);
  const runePool = expandEntries(sections.runes ?? [], index);

  return {
    seed,
    hand: seededShuffle(mainPool, seed).slice(0, handSize),
    runes: seededShuffle(runePool, seed + 97).slice(0, runeChannels),
  };
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

function countSection(entries = []) {
  return entries.reduce((total, entry) => total + (Number(entry.quantity) || 0), 0);
}

function expandEntries(entries, index) {
  const expanded = [];
  for (const entry of entries) {
    const quantity = Number(entry.quantity) || 0;
    const id = normalizeCardId(entry.id);
    const card = index.byId.get(id) ?? entry.card;
    for (let i = 0; i < quantity; i += 1) expanded.push({ id, card });
  }
  return expanded;
}

function seededShuffle(items, seed) {
  const copy = [...items];
  let state = Math.max(1, Math.floor(seed) % 2147483647);
  for (let i = copy.length - 1; i > 0; i -= 1) {
    state = (state * 48271) % 2147483647;
    const j = state % (i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
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
