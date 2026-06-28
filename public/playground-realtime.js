const SIGNAL_TYPES = new Set(["signal.offer", "signal.answer", "signal.ice"]);

export function realtimeUrlForTable(tableId, locationLike = globalThis.location) {
  if (!tableId || !locationLike?.host) return "";
  const protocol = locationLike.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${locationLike.host}/api/playground/tables/${encodeURIComponent(tableId)}/ws`;
}

export function createSignalEnvelope(type, payload = {}, targetUserId = "") {
  return {
    type,
    target_user_id: targetUserId || "",
    payload: payload && typeof payload === "object" ? payload : {},
  };
}

export function isSignalEnvelope(message = {}) {
  return (
    SIGNAL_TYPES.has(message.type) &&
    Boolean(message.payload) &&
    typeof message.payload === "object" &&
    !Array.isArray(message.payload)
  );
}

export function shouldUseRealtime(table) {
  return Boolean(table?.id && Array.isArray(table.seats) && table.seats.length > 0);
}

export function canUseRealtimeTransport(locationLike = globalThis.location) {
  if (!locationLike?.hostname) return false;
  return !["127.0.0.1", "localhost", "::1"].includes(locationLike.hostname);
}

export function remotePeerId(table, currentUserId) {
  return (table?.seats || []).find((seat) => seat.user_id !== currentUserId)?.user_id || "";
}

export function shouldInitiateVoiceOffer(table, currentUserId) {
  const seats = table?.seats || [];
  if (seats.length < 2) return false;
  return seats[0]?.user_id === currentUserId;
}
