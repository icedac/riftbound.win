import test from "node:test";
import assert from "node:assert/strict";

import {
  canUseRealtimeTransport,
  createSignalEnvelope,
  isSignalEnvelope,
  realtimeUrlForTable,
  shouldUseRealtime,
} from "../public/playground-realtime.js";

test("realtimeUrlForTable builds same-origin websocket URLs for table sessions", () => {
  assert.equal(
    realtimeUrlForTable("table/alpha", { protocol: "https:", host: "riftbound.win" }),
    "wss://riftbound.win/api/playground/tables/table%2Falpha/ws"
  );
  assert.equal(
    realtimeUrlForTable("table-1", { protocol: "http:", host: "127.0.0.1:5173" }),
    "ws://127.0.0.1:5173/api/playground/tables/table-1/ws"
  );
});

test("voice signaling envelopes are validated before relay", () => {
  const envelope = createSignalEnvelope("signal.offer", { sdp: "offer" }, "guest-user");

  assert.deepEqual(envelope, {
    type: "signal.offer",
    target_user_id: "guest-user",
    payload: { sdp: "offer" },
  });
  assert.equal(isSignalEnvelope(envelope), true);
  assert.equal(isSignalEnvelope({ type: "signal.offer", payload: "bad" }), false);
  assert.equal(isSignalEnvelope({ type: "chat.message", payload: {} }), false);
});

test("realtime activates only when a selected table has at least one joined seat", () => {
  assert.equal(shouldUseRealtime(null), false);
  assert.equal(shouldUseRealtime({ id: "table-1", seats: [] }), false);
  assert.equal(shouldUseRealtime({ id: "table-1", seats: [{ user_id: "host" }] }), true);
});

test("realtime transport is disabled on the Rust localhost server so polling remains the fallback", () => {
  assert.equal(canUseRealtimeTransport({ hostname: "127.0.0.1" }), false);
  assert.equal(canUseRealtimeTransport({ hostname: "localhost" }), false);
  assert.equal(canUseRealtimeTransport({ hostname: "riftbound.win" }), true);
});
