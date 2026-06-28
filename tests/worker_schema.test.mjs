import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import worker from "../public/_worker.js";

class FakeD1Statement {
  bind() {
    return this;
  }

  async run() {
    return { success: true };
  }

  async all() {
    return { results: [] };
  }

  async first() {
    return null;
  }
}

class FakeD1Database {
  constructor() {
    this.statements = [];
  }

  async exec() {
    throw new Error("D1 exec should not be used for schema setup");
  }

  prepare(sql) {
    this.statements.push(sql);
    return new FakeD1Statement();
  }
}

test("worker initializes D1 schema with single prepared statements", async () => {
  const db = new FakeD1Database();
  const request = new Request("https://riftbound.kr/api/me");

  const response = await worker.fetch(request, {
    DB: db,
    ASSETS: { fetch: () => new Response("asset") },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    user: null,
    providers: [],
    configured: true,
    auth: {
      providers: {
        google: {
          configured: false,
          start_url: "/api/auth/google/start",
          callback_url: "https://riftbound.kr/api/auth/google/callback",
          missing: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
        },
        naver: {
          configured: false,
          start_url: "/api/auth/naver/start",
          callback_url: "https://riftbound.kr/api/auth/naver/callback",
          missing: ["NAVER_CLIENT_ID", "NAVER_CLIENT_SECRET"],
        },
      },
    },
    media: {
      store: "d1-inline",
      max_upload_bytes: 1048576,
      max_avatar_bytes: 1048576,
      max_files_per_post: 6,
    },
  });
  assert.ok(db.statements.some((sql) => sql.startsWith("CREATE TABLE IF NOT EXISTS users")));
  assert.ok(db.statements.some((sql) => sql.startsWith("CREATE TABLE IF NOT EXISTS playground_tables")));
  assert.ok(db.statements.some((sql) => sql.startsWith("CREATE TABLE IF NOT EXISTS playground_seats")));
  assert.ok(db.statements.some((sql) => sql.startsWith("CREATE TABLE IF NOT EXISTS playground_events")));
  assert.ok(db.statements.every((sql) => !sql.includes(";\n")));
});

test("worker reports configured OAuth providers when secrets are present", async () => {
  const db = new FakeD1Database();
  const request = new Request("https://riftbound.kr/api/me");

  const response = await worker.fetch(request, {
    DB: db,
    GOOGLE_CLIENT_ID: "google-id",
    GOOGLE_CLIENT_SECRET: "google-secret",
    NAVER_CLIENT_ID: "naver-id",
    NAVER_CLIENT_SECRET: "naver-secret",
    ASSETS: { fetch: () => new Response("asset") },
  });

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.auth.providers.google.configured, true);
  assert.equal(body.auth.providers.naver.configured, true);
  assert.deepEqual(body.auth.providers.google.missing, []);
  assert.deepEqual(body.auth.providers.naver.missing, []);
  assert.equal(body.auth.providers.google.callback_url, "https://riftbound.kr/api/auth/google/callback");
  assert.equal(body.auth.providers.naver.callback_url, "https://riftbound.kr/api/auth/naver/callback");
});

test("worker reports R2 media capability when MEDIA binding is configured", async () => {
  const db = new FakeD1Database();
  const request = new Request("https://riftbound.kr/api/me");

  const response = await worker.fetch(request, {
    DB: db,
    MEDIA: {
      get: async () => null,
      put: async () => undefined,
    },
    ASSETS: { fetch: () => new Response("asset") },
  });

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.media, {
    store: "r2",
    max_upload_bytes: 26214400,
    max_avatar_bytes: 2097152,
    max_files_per_post: 6,
  });
});

test("worker serves playground table deep links from the static playground entrypoint", async () => {
  let assetUrl = "";
  const response = await worker.fetch(new Request("https://riftbound.kr/playground/tables/table-123"), {
    ASSETS: {
      fetch: (request) => {
        assetUrl = request.url;
        return new Response("<title>Riftbound.kr Playground</title>");
      },
    },
  });

  assert.equal(response.status, 200);
  assert.equal(new URL(assetUrl).pathname, "/playground/");
  assert.match(await response.text(), /Riftbound\.kr Playground/);
});

test("worker exposes a playground websocket relay endpoint for table events and voice signaling", async () => {
  const source = await readFile(new URL("../public/_worker.js", import.meta.url), "utf8");

  assert.match(source, /websocketRoute = url\.pathname\.match/);
  assert.match(source, /handlePlaygroundWebSocket/);
  assert.match(source, /WebSocketPair/);
  assert.match(source, /signal\.offer/);
  assert.match(source, /signal\.answer/);
  assert.match(source, /signal\.ice/);
  assert.match(source, /broadcastTableMessage/);
});

class BoundStatement {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql;
    this.args = [];
  }

  bind(...args) {
    this.args = args;
    return this;
  }

  async run() {
    const sql = this.sql;
    if (sql.startsWith("INSERT INTO posts")) {
      const [id, board, title, body, userId, authorName, votes, createdAt] = this.args;
      this.db.posts.push({ id, board, title, body, user_id: userId, author_name: authorName, votes, created_at: createdAt });
    } else if (sql.startsWith("INSERT INTO media")) {
      const [id, postId, key, mediaType, mimeType, inlineData, createdAt] = this.args;
      this.db.media.push({ id, post_id: postId, key, media_type: mediaType, mime_type: mimeType, inline_data: inlineData || "", created_at: createdAt });
    } else if (sql.startsWith("UPDATE users SET avatar_key")) {
      const [avatarKey, avatarType, avatarData, updatedAt, userId] = this.args;
      const user = this.db.users.find((item) => item.id === userId);
      Object.assign(user, { avatar_key: avatarKey, avatar_type: avatarType, avatar_data: avatarData || "", updated_at: updatedAt });
    } else if (sql.startsWith("INSERT INTO saved_decks")) {
      const [id, userId, name, format, deckJson, createdAt, updatedAt] = this.args;
      this.db.savedDecks.push({ id, user_id: userId, name, format, deck_json: deckJson, created_at: createdAt, updated_at: updatedAt });
    } else if (sql.startsWith("INSERT INTO playground_tables")) {
      const [id, hostUserId, status, createdAt, updatedAt, snapshot] = this.args;
      this.db.playgroundTables.push({ id, host_user_id: hostUserId, status, created_at: createdAt, updated_at: updatedAt, active_snapshot_json: snapshot });
    } else if (sql.startsWith("INSERT INTO playground_seats")) {
      const [tableId, seatIndex, userId, displayName, deckId, deckName, deckSnapshot, joinedAt] = this.args;
      this.db.playgroundSeats.push({
        table_id: tableId,
        seat_index: seatIndex,
        user_id: userId,
        display_name: displayName,
        deck_id: deckId,
        deck_name: deckName,
        deck_snapshot_json: deckSnapshot,
        joined_at: joinedAt,
      });
    } else if (sql.startsWith("UPDATE playground_tables SET status")) {
      const [status, updatedAt, snapshot, id] = this.args;
      const table = this.db.playgroundTables.find((item) => item.id === id);
      Object.assign(table, { status, updated_at: updatedAt, active_snapshot_json: snapshot });
    } else if (sql.startsWith("UPDATE playground_tables SET updated_at")) {
      const [updatedAt, snapshot, status, id] = this.args;
      const table = this.db.playgroundTables.find((item) => item.id === id);
      Object.assign(table, { updated_at: updatedAt, active_snapshot_json: snapshot, status });
    } else if (sql.startsWith("INSERT INTO playground_events")) {
      const [id, tableId, sequence, userId, eventType, eventJson, createdAt] = this.args;
      this.db.playgroundEvents.push({ id, table_id: tableId, sequence, user_id: userId, event_type: eventType, event_json: eventJson, created_at: createdAt });
    }
    return { success: true };
  }

  async all() {
    if (this.sql.includes("FROM posts p")) {
      const [board] = this.args;
      return { results: this.db.posts.filter((post) => post.board === board) };
    }
    if (this.sql.includes("FROM media WHERE post_id")) {
      const [postId] = this.args;
      return { results: this.db.media.filter((media) => media.post_id === postId) };
    }
    if (this.sql.includes("FROM saved_decks WHERE user_id")) {
      const [userId] = this.args;
      return {
        results: this.db.savedDecks
          .filter((deck) => deck.user_id === userId)
          .sort((a, b) => b.updated_at - a.updated_at),
      };
    }
    if (this.sql.includes("FROM playground_tables")) {
      return { results: [...this.db.playgroundTables].sort((a, b) => b.updated_at - a.updated_at) };
    }
    if (this.sql.includes("FROM playground_events WHERE table_id = ? AND sequence > ?")) {
      const [tableId, after] = this.args;
      return {
        results: this.db.playgroundEvents
          .filter((event) => event.table_id === tableId && event.sequence > after)
          .sort((a, b) => a.sequence - b.sequence),
      };
    }
    return { results: [] };
  }

  async first() {
    if (this.sql.includes("FROM media WHERE key")) {
      const [key] = this.args;
      return this.db.media.find((media) => media.key === key) || null;
    }
    if (this.sql.includes("FROM sessions s")) {
      const [sessionId, now] = this.args;
      const session = this.db.sessions.find((item) => item.id === sessionId && item.expires_at > now);
      return session ? this.db.users.find((user) => user.id === session.user_id) || null : null;
    }
    if (this.sql.includes("FROM saved_decks WHERE id = ? AND user_id = ?")) {
      const [id, userId] = this.args;
      return this.db.savedDecks.find((deck) => deck.id === id && deck.user_id === userId) || null;
    }
    if (this.sql.includes("FROM playground_tables WHERE id = ?")) {
      const [id] = this.args;
      return this.db.playgroundTables.find((table) => table.id === id) || null;
    }
    if (this.sql.includes("SELECT COUNT(*) AS count FROM playground_seats")) {
      const [tableId] = this.args;
      return { count: this.db.playgroundSeats.filter((seat) => seat.table_id === tableId).length };
    }
    if (this.sql.includes("SELECT seat_index FROM playground_seats")) {
      const [tableId, userId] = this.args;
      return this.db.playgroundSeats.find((seat) => seat.table_id === tableId && seat.user_id === userId) || null;
    }
    if (this.sql.includes("SELECT COALESCE(MAX(sequence), 0) AS sequence FROM playground_events")) {
      const [tableId] = this.args;
      const sequence = Math.max(0, ...this.db.playgroundEvents.filter((event) => event.table_id === tableId).map((event) => event.sequence));
      return { sequence };
    }
    if (this.sql.includes("FROM users WHERE avatar_key")) {
      const [avatarKey] = this.args;
      const user = this.db.users.find((item) => item.avatar_key === avatarKey);
      return user ? { inline_data: user.avatar_data, mime_type: user.avatar_type } : null;
    }
    return null;
  }
}

class InMemoryD1Database {
  constructor() {
    this.posts = [];
    this.media = [];
    this.users = [];
    this.sessions = [];
    this.savedDecks = [];
    this.playgroundTables = [];
    this.playgroundSeats = [];
    this.playgroundEvents = [];
  }

  prepare(sql) {
    return new BoundStatement(this, sql);
  }
}

test("worker stores small pasted media in D1 when R2 is not configured", async () => {
  const db = new InMemoryD1Database();
  const env = { DB: db, ASSETS: { fetch: () => new Response("asset") } };
  const bytes = new Uint8Array([82, 87, 7, 1]);
  const form = new FormData();
  form.append("board", "free");
  form.append("title", "Pasted video");
  form.append("media", new File([bytes], "clip.webm", { type: "video/webm" }));

  const create = await worker.fetch(new Request("https://riftbound.kr/api/posts", { method: "POST", body: form }), env);
  assert.equal(create.status, 201);

  const list = await worker.fetch(new Request("https://riftbound.kr/api/posts?board=free"), env);
  assert.equal(list.status, 200);
  const { posts } = await list.json();
  assert.equal(posts[0].media[0].mime_type, "video/webm");
  assert.match(posts[0].media[0].url, /^\/media\/community\//);

  const media = await worker.fetch(new Request(new URL(posts[0].media[0].url, "https://riftbound.kr")), env);
  assert.equal(media.status, 200);
  assert.equal(media.headers.get("Content-Type"), "video/webm");
  assert.deepEqual(new Uint8Array(await media.arrayBuffer()), bytes);
});

test("worker stores small profile avatars in D1 when R2 is not configured", async () => {
  const db = new InMemoryD1Database();
  db.users.push({
    id: "user-1",
    display_name: "Tester",
    bio: "",
    avatar_key: "",
    avatar_type: "",
    avatar_data: "",
    created_at: Date.now(),
    updated_at: Date.now(),
  });
  db.sessions.push({ id: "session-1", user_id: "user-1", expires_at: Date.now() + 60_000 });
  const env = { DB: db, ASSETS: { fetch: () => new Response("asset") } };
  const bytes = new Uint8Array([137, 80, 78, 71]);
  const form = new FormData();
  form.append("avatar", new File([bytes], "avatar.png", { type: "image/png" }));

  const update = await worker.fetch(
    new Request("https://riftbound.kr/api/profile/avatar", {
      method: "POST",
      headers: { Cookie: "rw_session=session-1" },
      body: form,
    }),
    env
  );
  assert.equal(update.status, 200);
  assert.deepEqual(await update.json(), { avatar_url: "/avatars/user-1/avatar.webp" });
  assert.equal(db.users[0].avatar_key, "avatars/user-1/avatar.webp");
  assert.notEqual(db.users[0].avatar_data, "");

  const avatar = await worker.fetch(new Request("https://riftbound.kr/avatars/user-1/avatar.webp"), env);
  assert.equal(avatar.status, 200);
  assert.equal(avatar.headers.get("Content-Type"), "image/png");
  assert.deepEqual(new Uint8Array(await avatar.arrayBuffer()), bytes);
});

test("worker stores saved decks for the current user", async () => {
  const db = new InMemoryD1Database();
  db.users.push({
    id: "user-1",
    display_name: "Tester",
    bio: "",
    avatar_key: "",
    avatar_type: "",
    avatar_data: "",
    created_at: Date.now(),
    updated_at: Date.now(),
  });
  db.sessions.push({ id: "session-1", user_id: "user-1", expires_at: Date.now() + 60_000 });
  const env = { DB: db, ASSETS: { fetch: () => new Response("asset") } };
  const payload = {
    name: "Ahri Tempo",
    format: "constructed",
    deck_json: {
      main: [{ id: "OGN-066", quantity: 3 }],
      runes: [{ id: "OGN-R01", quantity: 12 }],
    },
  };

  const unauthorized = await worker.fetch(
    new Request("https://riftbound.kr/api/saved-decks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
    env
  );
  assert.equal(unauthorized.status, 401);

  const create = await worker.fetch(
    new Request("https://riftbound.kr/api/saved-decks", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: "rw_session=session-1" },
      body: JSON.stringify(payload),
    }),
    env
  );
  assert.equal(create.status, 201);
  const created = await create.json();
  assert.equal(created.deck.name, "Ahri Tempo");
  assert.equal(created.deck.format, "constructed");
  assert.equal(created.deck.deck_json.main[0].id, "OGN-066");

  const list = await worker.fetch(
    new Request("https://riftbound.kr/api/saved-decks", {
      headers: { Cookie: "rw_session=session-1" },
    }),
    env
  );
  assert.equal(list.status, 200);
  assert.deepEqual(await list.json(), { decks: [created.deck] });
});

test("worker persists playground tables, seats, snapshots, and append-only events", async () => {
  const db = new InMemoryD1Database();
  const now = Date.now();
  db.users.push(
    {
      id: "host-user",
      display_name: "Host",
      bio: "",
      avatar_key: "",
      avatar_type: "",
      avatar_data: "",
      created_at: now,
      updated_at: now,
    },
    {
      id: "guest-user",
      display_name: "Guest",
      bio: "",
      avatar_key: "",
      avatar_type: "",
      avatar_data: "",
      created_at: now,
      updated_at: now,
    }
  );
  db.sessions.push(
    { id: "host-session", user_id: "host-user", expires_at: now + 60_000 },
    { id: "guest-session", user_id: "guest-user", expires_at: now + 60_000 }
  );
  db.savedDecks.push(
    {
      id: "host-deck",
      user_id: "host-user",
      name: "Host Deck",
      format: "constructed",
      deck_json: JSON.stringify({ main: [{ id: "OGN-001", quantity: 5 }], runes: [{ id: "OGN-R01", quantity: 2 }] }),
      created_at: now,
      updated_at: now,
    },
    {
      id: "guest-deck",
      user_id: "guest-user",
      name: "Guest Deck",
      format: "constructed",
      deck_json: JSON.stringify({ main: [{ id: "OGN-002", quantity: 5 }], runes: [{ id: "OGN-R02", quantity: 2 }] }),
      created_at: now,
      updated_at: now,
    }
  );
  const env = { DB: db, ASSETS: { fetch: () => new Response("asset") } };

  const unauthorized = await worker.fetch(
    new Request("https://riftbound.kr/api/playground/tables", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deck_id: "host-deck" }),
    }),
    env
  );
  assert.equal(unauthorized.status, 401);

  const create = await worker.fetch(
    new Request("https://riftbound.kr/api/playground/tables", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: "rw_session=host-session" },
      body: JSON.stringify({ deck_id: "host-deck" }),
    }),
    env
  );
  assert.equal(create.status, 201);
  const created = await create.json();
  const tableId = created.table.id;
  assert.equal(created.table.status, "waiting");
  assert.equal(created.table.seats[0].zones.main_deck.length, 5);

  const join = await worker.fetch(
    new Request(`https://riftbound.kr/api/playground/tables/${tableId}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: "rw_session=guest-session" },
      body: JSON.stringify({ deck_id: "guest-deck" }),
    }),
    env
  );
  assert.equal(join.status, 200);
  const joined = await join.json();
  assert.equal(joined.table.status, "active");
  assert.equal(joined.table.seats.length, 2);

  const move = await worker.fetch(
    new Request(`https://riftbound.kr/api/playground/tables/${tableId}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: "rw_session=host-session" },
      body: JSON.stringify({ type: "card.move", payload: { seat_index: 0, from: "main_deck", to: "hand", count: 2 } }),
    }),
    env
  );
  assert.equal(move.status, 201);
  const moved = await move.json();
  assert.equal(moved.event.sequence, 1);
  assert.equal(moved.table.seats[0].zones.hand.length, 2);
  assert.equal(moved.table.seats[0].zones.main_deck.length, 3);

  const forged = await worker.fetch(
    new Request(`https://riftbound.kr/api/playground/tables/${tableId}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: "rw_session=host-session" },
      body: JSON.stringify({ type: "card.move", payload: { active_snapshot_json: {} } }),
    }),
    env
  );
  assert.equal(forged.status, 400);

  const events = await worker.fetch(
    new Request(`https://riftbound.kr/api/playground/tables/${tableId}/events?after=0`, {
      headers: { Cookie: "rw_session=guest-session" },
    }),
    env
  );
  assert.equal(events.status, 200);
  assert.equal((await events.json()).events.length, 1);
});
