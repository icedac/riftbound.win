export const HIDDEN_CARD_ID = "__hidden__";

const SECRET_DECK_ZONES = new Set(["main_deck", "rune_deck"]);

export function isPrivateCardZone(zone) {
  return SECRET_DECK_ZONES.has(zoneName(zone)) || zoneName(zone) === "hand";
}

export function isHiddenCard(card) {
  return Boolean(card?.hidden || card?.id === HIDDEN_CARD_ID);
}

export function publicTableForUser(table = {}, viewerUserId = "") {
  const next = clone(table && typeof table === "object" ? table : {});
  for (const seat of next.seats || []) {
    for (const [zone, cards] of Object.entries(seat.zones || {})) {
      if (!Array.isArray(cards)) continue;
      seat.zones[zone] = cards.map((card, index) => publicCardForUser(card, seat, zone, viewerUserId, index));
    }
  }
  return next;
}

export function publicCardForUser(card = {}, seat = {}, zone = "", viewerUserId = "", index = 0) {
  if (!shouldHideCard(card, seat, zone, viewerUserId)) return clone(card);
  return {
    id: HIDDEN_CARD_ID,
    instance_id: `hidden-${zoneName(zone) || "zone"}-${index + 1}`,
    hidden: true,
    hidden_zone: zoneName(zone),
    ...(card.face_up === false ? { face_up: false } : {}),
  };
}

export function shouldHideCard(card = {}, seat = {}, zone = "", viewerUserId = "") {
  const normalizedZone = zoneName(zone);
  if (isHiddenCard(card)) return true;
  if (SECRET_DECK_ZONES.has(normalizedZone)) return true;
  if (normalizedZone === "hand" && seat.user_id !== viewerUserId) return true;
  if (card.face_up === false && seat.user_id !== viewerUserId) return true;
  return false;
}

function zoneName(value) {
  return String(value || "")
    .replace(/-/g, "_")
    .toLowerCase();
}

function clone(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}
