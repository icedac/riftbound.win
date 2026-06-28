import assert from "node:assert/strict";
import test from "node:test";

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
