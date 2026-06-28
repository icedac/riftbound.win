const SIGNAL_TYPES = new Set(["signal.offer", "signal.answer", "signal.ice"]);
const BROADCAST_TYPES = new Set(["table.snapshot", "table.event", "presence.update"]);

export default {
  async fetch() {
    return json({ ok: true, service: "riftbound-playground-table" });
  },
};

export class PlaygroundTable {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sessions = new Map();
  }

  async fetch(request) {
    const url = new URL(request.url);
    const tableId = request.headers.get("x-riftbound-table-id") || url.searchParams.get("table_id") || "";

    if (url.pathname.endsWith("/broadcast") && request.method === "POST") {
      const message = await request.json().catch(() => ({}));
      if (!BROADCAST_TYPES.has(message.type)) return json({ error: "Unsupported broadcast message" }, 400);
      this.broadcast(message);
      return json({ ok: true });
    }

    if (request.headers.get("Upgrade") !== "websocket") {
      return json({ error: "WebSocket upgrade required" }, 426);
    }

    const userId = request.headers.get("x-riftbound-user-id") || "";
    if (!tableId || !userId) return json({ error: "Table and user are required" }, 400);

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();

    this.sessions.set(server, {
      userId,
      displayName: request.headers.get("x-riftbound-display-name") || "Player",
      tableId,
      connectedAt: Date.now(),
    });

    this.send(server, {
      type: "table.snapshot",
      table: await this.tableSnapshot(tableId),
      user_id: userId,
    });
    this.broadcast(
      {
        type: "presence.update",
        user_id: userId,
        online: true,
        created_at: Date.now(),
      },
      userId
    );

    server.addEventListener("message", (event) => this.handleMessage(server, event));
    server.addEventListener("close", () => this.disconnect(server));
    server.addEventListener("error", () => this.disconnect(server));

    return new Response(null, { status: 101, webSocket: client });
  }

  async tableSnapshot(tableId) {
    if (!this.env.DB) return {};
    const row = await this.env.DB.prepare("SELECT active_snapshot_json FROM playground_tables WHERE id = ?").bind(tableId).first();
    return safeJson(row?.active_snapshot_json, {});
  }

  handleMessage(server, event) {
    const session = this.sessions.get(server);
    if (!session) return;
    const message = safeJson(event.data, {});
    if (message.type === "ping") {
      this.send(server, { type: "pong", created_at: Date.now() });
      return;
    }
    if (!isSignal(message)) {
      this.send(server, { type: "table.error", error: "Unsupported realtime message" });
      return;
    }
    this.broadcast(
      {
        type: message.type,
        actor_id: session.userId,
        target_user_id: cleanText(message.target_user_id, 120),
        payload: message.payload,
        created_at: Date.now(),
      },
      session.userId
    );
  }

  disconnect(server) {
    const session = this.sessions.get(server);
    if (!session) return;
    this.sessions.delete(server);
    this.broadcast(
      {
        type: "presence.update",
        user_id: session.userId,
        online: false,
        created_at: Date.now(),
      },
      session.userId
    );
  }

  broadcast(message, exceptUserId = "") {
    for (const [socket, session] of this.sessions.entries()) {
      if (exceptUserId && session.userId === exceptUserId) continue;
      if (message.target_user_id && message.target_user_id !== session.userId) continue;
      this.send(socket, message);
    }
  }

  send(socket, message) {
    try {
      socket.send(JSON.stringify(message));
    } catch {
      this.sessions.delete(socket);
    }
  }
}

function isSignal(message) {
  return Boolean(message && SIGNAL_TYPES.has(message.type) && message.payload && typeof message.payload === "object");
}

function safeJson(value, fallback) {
  try {
    return typeof value === "string" ? JSON.parse(value) : value ?? fallback;
  } catch {
    return fallback;
  }
}

function cleanText(value, maxLength) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
