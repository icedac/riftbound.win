export function tableLobbySummary(table = {}, cards = [], now = Date.now()) {
  const seats = Array.isArray(table.seats) ? table.seats : [];
  const host = seats[0] || {};
  const legend = setupCardName(host, "legends", "legend_zone", cards);
  const champion = setupCardName(host, "champions", "champion_zone", cards);
  const main = countDeckSection(host, ["main", "champions"], ["main_deck", "champion_zone"]);
  const runes = countDeckSection(host, ["runes"], ["rune_deck", "rune_pool"]);
  const fields = countDeckSection(host, ["battlefields"], ["battlefields"]);

  return {
    title: host.deck_name || "Untitled Table",
    host: host.display_name || "Host",
    status: table.status || "waiting",
    playerCount: `${seats.length}/2 players`,
    created: relativeCreatedAt(table.created_at, now),
    setup: [`Legend ${legend}`, `Champion ${champion}`].join(" · "),
    counts: `Main ${main} · Runes ${runes} · Fields ${fields}`,
  };
}

function setupCardName(seat, sections, zone, cards) {
  const entry = firstDeckEntry(seat?.deck_snapshot, [sections]);
  const id = entry?.id || seat?.zones?.[zone]?.[0]?.id || "";
  return cardName(id, cards);
}

function countDeckSection(seat, sections, fallbackZones) {
  const entries = deckEntries(seat?.deck_snapshot);
  const sectionSet = new Set(sections);
  const count = entries
    .filter((entry) => sectionSet.has(entry.section))
    .reduce((total, entry) => total + entry.quantity, 0);
  if (count > 0) return count;
  return fallbackZones.reduce((total, zone) => total + (Array.isArray(seat?.zones?.[zone]) ? seat.zones[zone].length : 0), 0);
}

function firstDeckEntry(deckJson = {}, sections = []) {
  const sectionSet = new Set(sections);
  return deckEntries(deckJson).find((entry) => sectionSet.has(entry.section));
}

function deckEntries(deckJson = {}) {
  if (Array.isArray(deckJson.entries)) {
    return deckJson.entries.map(normalizedEntry).filter((entry) => entry.id && entry.quantity > 0);
  }
  return ["legends", "champions", "main", "runes", "battlefields"]
    .flatMap((section) => (deckJson[section] || []).map((entry) => ({ ...entry, section })))
    .map(normalizedEntry)
    .filter((entry) => entry.id && entry.quantity > 0);
}

function normalizedEntry(entry = {}) {
  return {
    id: String(entry.id || "").trim(),
    quantity: Math.max(0, Math.floor(Number(entry.quantity || 0))),
    section: String(entry.section || "main"),
  };
}

function cardName(id, cards = []) {
  const card = cards.find((item) => String(item.id).toUpperCase() === String(id).toUpperCase());
  return card?.name || id || "Unknown";
}

function relativeCreatedAt(value, now) {
  const created = Number(value || 0);
  const current = Number(now || Date.now());
  if (!created || !Number.isFinite(created)) return "created time unknown";
  const elapsed = Math.max(0, current - created);
  if (elapsed < 60_000) return "just now";
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m ago`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h ago`;
  return `${Math.floor(elapsed / 86_400_000)}d ago`;
}
