export function playDestinationForCard(card = {}) {
  const type = String(card?.card_type || "").toLowerCase();
  if (type === "spell") return "chain";
  if (type === "unit" || type === "gear") return "base";
  if (type === "battlefield") return "battlefields";
  if (type === "legend") return "legend_zone";
  if (type === "rune") return "rune_pool";
  return "base";
}

export function playCardMovePayload({ selected = null, catalogCard = null, fallbackSeatIndex = 0 } = {}) {
  if (!selected) {
    return { seat_index: fallbackSeatIndex, from: "hand", to: "base", count: 1 };
  }
  if (selected.zone !== "hand") return null;
  return {
    seat_index: selected.seatIndex,
    from: selected.zone,
    to: playDestinationForCard(catalogCard || selected.card),
    instance_id: selected.instanceId,
  };
}
