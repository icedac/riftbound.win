const SESSION_COOKIE = "rw_session";
const OAUTH_COOKIE = "rw_oauth";
const SESSION_DAYS = 30;
const OAUTH_BRIDGE_MAX_AGE_SECONDS = 600;
const NAVER_CANONICAL_ORIGIN = "https://riftbound.win";
const BOARDS = new Set(["free", "deck", "notice"]);
const PROVIDERS = new Set(["google", "naver"]);
const MAX_MEDIA_BYTES = 25 * 1024 * 1024;
const MAX_INLINE_MEDIA_BYTES = 1024 * 1024;
const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const PLAYGROUND_VICTORY_SCORE = 8;
const HIDDEN_CARD_ID = "__hidden__";
const PLAYGROUND_SIGNAL_TYPES = new Set(["signal.offer", "signal.answer", "signal.ice"]);
const playgroundSockets = new Map();

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    try {
      if (url.pathname.startsWith("/api/")) return handleApi(request, env, url);
      if (url.pathname.startsWith("/media/")) return mediaResponse(env, url.pathname.slice("/media/".length));
      if (url.pathname.startsWith("/avatars/")) return mediaResponse(env, url.pathname.slice(1));
      if (url.pathname.startsWith("/playground/tables/")) return env.ASSETS.fetch(new Request(new URL("/playground/", request.url), request));
      return env.ASSETS.fetch(request);
    } catch (error) {
      console.error(error);
      return json({ error: "Internal server error" }, 500);
    }
  },
};

async function handleApi(request, env, url) {
  if (url.pathname === "/api/me") return meResponse(request, env);
  if (url.pathname === "/api/profile" && request.method === "PUT") return updateProfile(request, env);
  if (url.pathname === "/api/profile/avatar" && request.method === "POST") return updateAvatar(request, env);
  if (url.pathname === "/api/posts" && request.method === "GET") return listPosts(env, url);
  if (url.pathname === "/api/posts" && request.method === "POST") return createPost(request, env);
  if (url.pathname === "/api/saved-decks" && request.method === "GET") return listSavedDecks(request, env);
  if (url.pathname === "/api/saved-decks" && request.method === "POST") return createSavedDeck(request, env);
  if (url.pathname === "/api/playground/tables" && request.method === "GET") return listPlaygroundTables(request, env);
  if (url.pathname === "/api/playground/tables" && request.method === "POST") return createPlaygroundTable(request, env);
  const websocketRoute = url.pathname.match(/^\/api\/playground\/tables\/([^/]+)\/ws$/);
  if (websocketRoute) return handlePlaygroundWebSocket(request, env, decodeURIComponent(websocketRoute[1]));
  const tableRoute = url.pathname.match(/^\/api\/playground\/tables\/([^/]+)$/);
  if (tableRoute && request.method === "GET") return getPlaygroundTable(request, env, decodeURIComponent(tableRoute[1]));
  const joinRoute = url.pathname.match(/^\/api\/playground\/tables\/([^/]+)\/join$/);
  if (joinRoute && request.method === "POST") return joinPlaygroundTable(request, env, decodeURIComponent(joinRoute[1]));
  const eventsRoute = url.pathname.match(/^\/api\/playground\/tables\/([^/]+)\/events$/);
  if (eventsRoute && request.method === "GET") return listPlaygroundEvents(env, decodeURIComponent(eventsRoute[1]), url);
  if (eventsRoute && request.method === "POST") return appendPlaygroundEvent(request, env, decodeURIComponent(eventsRoute[1]));
  if (url.pathname.startsWith("/api/posts/") && url.pathname.endsWith("/vote") && request.method === "POST") {
    const id = url.pathname.slice("/api/posts/".length, -"/vote".length);
    return votePost(request, env, decodeURIComponent(id));
  }
  if (url.pathname === "/api/auth/logout" && request.method === "POST") return logoutResponse();

  const authStart = url.pathname.match(/^\/api\/auth\/(google|naver)\/start$/);
  if (authStart) return startAuth(request, env, authStart[1]);
  const authBridge = url.pathname.match(/^\/api\/auth\/(google|naver)\/bridge$/);
  if (authBridge) return finishAuthBridge(request, env, authBridge[1], url);
  const authCallback = url.pathname.match(/^\/api\/auth\/(google|naver)\/callback$/);
  if (authCallback) return finishAuth(request, env, authCallback[1], url);

  return json({ error: "Not found" }, 404);
}

async function meResponse(request, env) {
  const auth = authStatus(request, env);
  const media = mediaStatus(env);
  if (!(await ensureSchema(env))) return json({ user: null, providers: [], configured: false, auth, media });
  const session = await currentSession(request, env);
  if (!session) return json({ user: null, providers: [], configured: true, auth, media });
  const providers = await providerRows(env, session.user.id);
  return json({ user: publicUser(session.user), providers, configured: true, auth, media });
}

async function updateProfile(request, env) {
  if (!(await ensureSchema(env))) return json({ error: "Database binding DB is not configured" }, 503);
  const session = await currentSession(request, env);
  if (!session) return json({ error: "Sign in required" }, 401);
  const body = await request.json().catch(() => ({}));
  const displayName = cleanText(body.display_name, 40) || "Riftbound Player";
  const bio = cleanText(body.bio, 240);
  await env.DB.prepare("UPDATE users SET display_name = ?, bio = ?, updated_at = ? WHERE id = ?")
    .bind(displayName, bio, Date.now(), session.user.id)
    .run();
  return meResponse(request, env);
}

async function updateAvatar(request, env) {
  if (!(await ensureSchema(env))) return json({ error: "Database binding DB is not configured" }, 503);
  const session = await currentSession(request, env);
  if (!session) return json({ error: "Sign in required" }, 401);
  const form = await request.formData();
  const file = form.get("avatar");
  if (!isFile(file) || !file.type.startsWith("image/")) return json({ error: "Image file required" }, 400);
  const sizeLimit = env.MEDIA ? MAX_AVATAR_BYTES : MAX_INLINE_MEDIA_BYTES;
  if (file.size > sizeLimit) return json({ error: "Avatar is too large" }, 400);
  const key = `avatars/${session.user.id}/avatar.webp`;
  let inlineData = "";
  if (env.MEDIA) {
    await env.MEDIA.put(key, await file.arrayBuffer(), {
      httpMetadata: { contentType: file.type || "image/webp" },
    });
  } else {
    inlineData = await fileToBase64(file);
  }
  await env.DB.prepare("UPDATE users SET avatar_key = ?, avatar_type = ?, avatar_data = ?, updated_at = ? WHERE id = ?")
    .bind(key, file.type || "image/webp", inlineData, Date.now(), session.user.id)
    .run();
  return json({ avatar_url: resourceUrl(key) });
}

async function listPosts(env, url) {
  if (!(await ensureSchema(env))) return json({ error: "Database binding DB is not configured" }, 503);
  const board = String(url.searchParams.get("board") || "free");
  if (!BOARDS.has(board)) return json({ error: "Unknown board" }, 400);
  const posts = await env.DB.prepare(
    `SELECT p.id, p.board, p.title, p.body, p.user_id, p.author_name, p.votes, p.created_at,
            u.avatar_key
       FROM posts p
       LEFT JOIN users u ON u.id = p.user_id
      WHERE p.board = ?
      ORDER BY p.votes DESC, p.created_at DESC
      LIMIT 80`
  )
    .bind(board)
    .all();

  const results = [];
  for (const post of posts.results || []) {
    const media = await mediaRows(env, post.id);
    results.push({
      ...post,
      author_avatar_url: post.avatar_key ? resourceUrl(post.avatar_key) : null,
      comments: 0,
      media,
    });
  }
  return json({ posts: results });
}

async function createPost(request, env) {
  if (!(await ensureSchema(env))) return json({ error: "Database binding DB is not configured" }, 503);
  const session = await currentSession(request, env);
  const form = await request.formData();
  const board = cleanText(form.get("board"), 20) || "free";
  if (!BOARDS.has(board)) return json({ error: "Unknown board" }, 400);
  const title = cleanText(form.get("title"), 90);
  const body = cleanText(form.get("body"), 800);
  if (!title) return json({ error: "Title required" }, 400);

  const files = form.getAll("media").filter((file) => isFile(file) && file.size > 0).slice(0, 6);
  for (const file of files) {
    if (!/^image\/|^video\//.test(file.type)) return json({ error: "Only image and video uploads are allowed" }, 400);
    const sizeLimit = env.MEDIA ? MAX_MEDIA_BYTES : MAX_INLINE_MEDIA_BYTES;
    if (file.size > sizeLimit) {
      return json(
        {
          error: env.MEDIA
            ? "Media file is too large"
            : "Media file is too large for the temporary D1 media store",
        },
        400
      );
    }
  }

  const id = crypto.randomUUID();
  const now = Date.now();
  await env.DB.prepare(
    "INSERT INTO posts (id, board, title, body, user_id, author_name, votes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  )
    .bind(id, board, title, body, session?.user.id || null, session?.user.display_name || "Guest", 1, now)
    .run();

  for (const file of files) {
    const mediaId = crypto.randomUUID();
    const key = `community/${id}/${mediaId}-${safeName(file.name || "media")}`;
    let inlineData = "";
    if (env.MEDIA) {
      await env.MEDIA.put(key, await file.arrayBuffer(), {
        httpMetadata: { contentType: file.type || "application/octet-stream" },
      });
    } else {
      inlineData = await fileToBase64(file);
    }
    await env.DB.prepare(
      "INSERT INTO media (id, post_id, key, media_type, mime_type, inline_data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    )
      .bind(mediaId, id, key, file.type.startsWith("video/") ? "video" : "image", file.type, inlineData, now)
      .run();
  }

  return json({ id }, 201);
}

async function votePost(request, env, id) {
  if (!(await ensureSchema(env))) return json({ error: "Database binding DB is not configured" }, 503);
  const body = await request.json().catch(() => ({}));
  const amount = Math.max(-1, Math.min(1, Number(body.amount || 0)));
  if (amount === 0) return json({ error: "Vote amount required" }, 400);
  await env.DB.prepare("UPDATE posts SET votes = votes + ? WHERE id = ?").bind(amount, id).run();
  return json({ ok: true });
}

async function listSavedDecks(request, env) {
  if (!(await ensureSchema(env))) return json({ error: "Database binding DB is not configured" }, 503);
  const session = await currentSession(request, env);
  if (!session) return json({ error: "Sign in required" }, 401);
  const rows = await env.DB.prepare(
    "SELECT id, name, format, deck_json, created_at, updated_at FROM saved_decks WHERE user_id = ? ORDER BY updated_at DESC"
  )
    .bind(session.user.id)
    .all();
  return json({ decks: (rows.results || []).map(savedDeckRow) });
}

async function createSavedDeck(request, env) {
  if (!(await ensureSchema(env))) return json({ error: "Database binding DB is not configured" }, 503);
  const session = await currentSession(request, env);
  if (!session) return json({ error: "Sign in required" }, 401);
  const body = await request.json().catch(() => ({}));
  if (!body.deck_json || typeof body.deck_json !== "object" || Array.isArray(body.deck_json)) {
    return json({ error: "Deck JSON must be an object" }, 400);
  }
  const now = Date.now();
  const deck = {
    id: crypto.randomUUID(),
    name: cleanText(body.name, 80) || "Untitled Deck",
    format: cleanText(body.format, 40) || "constructed",
    deck_json: body.deck_json,
    created_at: now,
    updated_at: now,
  };
  await env.DB.prepare(
    "INSERT INTO saved_decks (id, user_id, name, format, deck_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  )
    .bind(deck.id, session.user.id, deck.name, deck.format, JSON.stringify(deck.deck_json), now, now)
    .run();
  return json({ deck }, 201);
}

async function listPlaygroundTables(request, env) {
  if (!(await ensureSchema(env))) return json({ error: "Database binding DB is not configured" }, 503);
  const session = await currentSession(request, env);
  const rows = await env.DB.prepare(
    "SELECT active_snapshot_json FROM playground_tables ORDER BY updated_at DESC LIMIT 80"
  ).all();
  return json({ tables: (rows.results || []).map((row) => publicTableForUser(safeJson(row.active_snapshot_json, {}), session?.user?.id || "")) });
}

async function createPlaygroundTable(request, env) {
  if (!(await ensureSchema(env))) return json({ error: "Database binding DB is not configured" }, 503);
  const session = await currentSession(request, env);
  if (!session) return json({ error: "Sign in required" }, 401);
  const body = await request.json().catch(() => ({}));
  const deckId = cleanText(body.deck_id, 120);
  if (!deckId) return json({ error: "Deck id required" }, 400);
  const deck = await savedDeckForUser(env, deckId, session.user.id);
  if (!deck) return json({ error: "Deck not found" }, 400);
  const now = Date.now();
  const tableId = crypto.randomUUID();
  const table = createTableSnapshot(tableId, session.user, deck, now);
  await env.DB.prepare(
    "INSERT INTO playground_tables (id, host_user_id, status, created_at, updated_at, active_snapshot_json) VALUES (?, ?, ?, ?, ?, ?)"
  )
    .bind(tableId, session.user.id, "waiting", now, now, JSON.stringify(table))
    .run();
  await insertPlaygroundSeat(env, tableId, 0, session.user, deck, now);
  return json({ table: publicTableForUser(table, session.user.id) }, 201);
}

async function getPlaygroundTable(request, env, tableId) {
  if (!(await ensureSchema(env))) return json({ error: "Database binding DB is not configured" }, 503);
  const session = await currentSession(request, env);
  const row = await playgroundTableRow(env, tableId);
  if (!row) return json({ error: "Table not found" }, 404);
  return json({ table: publicTableForUser(safeJson(row.active_snapshot_json, {}), session?.user?.id || "") });
}

async function joinPlaygroundTable(request, env, tableId) {
  if (!(await ensureSchema(env))) return json({ error: "Database binding DB is not configured" }, 503);
  const session = await currentSession(request, env);
  if (!session) return json({ error: "Sign in required" }, 401);
  const body = await request.json().catch(() => ({}));
  const deckId = cleanText(body.deck_id, 120);
  if (!deckId) return json({ error: "Deck id required" }, 400);
  const deck = await savedDeckForUser(env, deckId, session.user.id);
  if (!deck) return json({ error: "Deck not found" }, 400);
  const row = await playgroundTableRow(env, tableId);
  if (!row) return json({ error: "Table not found" }, 404);
  const existingSeat = await playgroundSeatIndex(env, tableId, session.user.id);
  if (existingSeat) return json({ table: publicTableForUser(safeJson(row.active_snapshot_json, {}), session.user.id) });
  const seatCount = await playgroundSeatCount(env, tableId);
  if (seatCount >= 2) return json({ error: "Table is full" }, 409);
  const now = Date.now();
  const table = safeJson(row.active_snapshot_json, {});
  if (!Array.isArray(table.seats)) table.seats = [];
  table.seats.push(createSeatSnapshot(seatCount, session.user, deck, now));
  const status = row.status || table.status || "waiting";
  table.status = status;
  table.updated_at = now;
  await insertPlaygroundSeat(env, tableId, seatCount, session.user, deck, now);
  await env.DB.prepare(
    "UPDATE playground_tables SET status = ?, updated_at = ?, active_snapshot_json = ? WHERE id = ?"
  )
    .bind(status, now, JSON.stringify(table), tableId)
    .run();
  await broadcastPlaygroundActorMessage(env, tableId, { type: "table.snapshot", table });
  broadcastTableMessage(tableId, { type: "table.snapshot", table });
  return json({ table: publicTableForUser(table, session.user.id) });
}

async function appendPlaygroundEvent(request, env, tableId) {
  if (!(await ensureSchema(env))) return json({ error: "Database binding DB is not configured" }, 503);
  const session = await currentSession(request, env);
  if (!session) return json({ error: "Sign in required" }, 401);
  const body = await request.json().catch(() => ({}));
  const eventType = cleanText(body.type, 40);
  if (!validPlaygroundEventType(eventType)) return json({ error: "Unknown event type" }, 400);
  const payload = body.payload && typeof body.payload === "object" && !Array.isArray(body.payload) ? body.payload : {};
  if (containsForbiddenSnapshotKeys(payload)) return json({ error: "Client-authored snapshots are not accepted" }, 400);
  const row = await playgroundTableRow(env, tableId);
  if (!row) return json({ error: "Table not found" }, 404);
  const seat = await playgroundSeatIndex(env, tableId, session.user.id);
  if (!seat) return json({ error: "Sign in required" }, 401);
  const table = safeJson(row.active_snapshot_json, {});
  const eventError = validatePlaygroundEvent(table, session.user, eventType, payload);
  if (eventError) return json({ error: eventError.message }, eventError.status);
  const sequence = (await nextPlaygroundSequence(env, tableId)) + 1;
  const now = Date.now();
  const event = {
    id: crypto.randomUUID(),
    table_id: tableId,
    sequence,
    actor_id: session.user.id,
    type: eventType,
    payload,
    created_at: now,
  };
  applyPlaygroundEvent(table, event);
  table.updated_at = now;
  const status = table.status || "active";
  await env.DB.prepare(
    "INSERT INTO playground_events (id, table_id, sequence, user_id, event_type, event_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  )
    .bind(event.id, tableId, sequence, session.user.id, eventType, JSON.stringify(payload), now)
    .run();
  await env.DB.prepare(
    "UPDATE playground_tables SET updated_at = ?, active_snapshot_json = ?, status = ? WHERE id = ?"
  )
    .bind(now, JSON.stringify(table), status, tableId)
    .run();
  await broadcastPlaygroundActorMessage(env, tableId, { type: "table.event", table, event });
  broadcastTableMessage(tableId, { type: "table.event", table, event });
  return json({ table: publicTableForUser(table, session.user.id), event }, 201);
}

async function listPlaygroundEvents(env, tableId, url) {
  if (!(await ensureSchema(env))) return json({ error: "Database binding DB is not configured" }, 503);
  const after = Number(url.searchParams.get("after") || 0);
  const rows = await env.DB.prepare(
    "SELECT id, table_id, sequence, user_id, event_type, event_json, created_at FROM playground_events WHERE table_id = ? AND sequence > ? ORDER BY sequence ASC"
  )
    .bind(tableId, after)
    .all();
  return json({
    events: (rows.results || []).map((row) => ({
      id: row.id,
      table_id: row.table_id,
      sequence: row.sequence,
      actor_id: row.user_id,
      type: row.event_type,
      payload: safeJson(row.event_json, {}),
      created_at: row.created_at,
    })),
  });
}

async function handlePlaygroundWebSocket(request, env, tableId) {
  if (request.headers.get("Upgrade") !== "websocket") {
    return json({ error: "WebSocket upgrade required" }, 426);
  }
  if (typeof WebSocketPair === "undefined") {
    return json({ error: "WebSocket runtime is unavailable" }, 501);
  }
  if (!(await ensureSchema(env))) return json({ error: "Database binding DB is not configured" }, 503);
  const session = await currentSession(request, env);
  if (!session) return json({ error: "Sign in required" }, 401);
  const seat = await playgroundSeatIndex(env, tableId, session.user.id);
  if (!seat) return json({ error: "Table seat required" }, 403);
  const row = await playgroundTableRow(env, tableId);
  if (!row) return json({ error: "Table not found" }, 404);
  const actorResponse = await forwardPlaygroundWebSocketToActor(env, request, tableId, session.user);
  if (actorResponse) return actorResponse;

  const pair = new WebSocketPair();
  const [client, server] = Object.values(pair);
  server.accept();
  registerPlaygroundSocket(tableId, session.user.id, server);
  sendSocket(server, {
    type: "table.snapshot",
    table: publicTableForUser(safeJson(row.active_snapshot_json, {}), session.user.id),
    user_id: session.user.id,
  });
  broadcastTableMessage(
    tableId,
    {
      type: "presence.update",
      user_id: session.user.id,
      online: true,
      created_at: Date.now(),
    },
    session.user.id
  );

  server.addEventListener("message", (event) => {
    const message = safeJson(event.data, {});
    if (message.type === "ping") {
      sendSocket(server, { type: "pong", created_at: Date.now() });
      return;
    }
    if (!isRealtimeSignal(message)) {
      sendSocket(server, { type: "table.error", error: "Unsupported realtime message" });
      return;
    }
    broadcastTableMessage(
      tableId,
      {
        type: message.type,
        actor_id: session.user.id,
        target_user_id: cleanText(message.target_user_id, 120),
        payload: message.payload,
        created_at: Date.now(),
      },
      session.user.id
    );
  });
  server.addEventListener("close", () => unregisterPlaygroundSocket(tableId, session.user.id, server));
  server.addEventListener("error", () => unregisterPlaygroundSocket(tableId, session.user.id, server));

  return new Response(null, { status: 101, webSocket: client });
}

function playgroundTableActor(env, tableId) {
  if (!env.PLAYGROUND_TABLE?.idFromName || !env.PLAYGROUND_TABLE?.get) return null;
  return env.PLAYGROUND_TABLE.get(env.PLAYGROUND_TABLE.idFromName(String(tableId)));
}

async function forwardPlaygroundWebSocketToActor(env, request, tableId, user) {
  const actor = playgroundTableActor(env, tableId);
  if (!actor) return null;
  try {
    const headers = new Headers(request.headers);
    headers.set("x-riftbound-table-id", String(tableId));
    headers.set("x-riftbound-user-id", user.id);
    headers.set("x-riftbound-display-name", user.display_name || "Player");
    return await actor.fetch(new Request(request, { headers }));
  } catch (error) {
    console.error(error);
    return null;
  }
}

async function broadcastPlaygroundActorMessage(env, tableId, message) {
  const actor = playgroundTableActor(env, tableId);
  if (!actor) return false;
  try {
    const response = await actor.fetch("https://playground-table.internal/broadcast", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-riftbound-table-id": String(tableId),
      },
      body: JSON.stringify(message),
    });
    return response.ok;
  } catch (error) {
    console.error(error);
    return false;
  }
}

async function startAuth(request, env, provider) {
  if (!PROVIDERS.has(provider)) return json({ error: "Unknown provider" }, 400);
  if (!(await ensureSchema(env))) return redirectWithError(request, "db-missing");
  const config = providerConfig(env, provider);
  if (!config.clientId || !config.clientSecret) return redirectWithError(request, `${provider}-missing`);
  const url = new URL(request.url);
  const origin = url.origin;
  const requestedReturnOrigin = allowedOAuthReturnOrigin(url.searchParams.get("return_origin") || "");
  const authOrigin = authOriginForProvider(env, provider, origin);
  if (provider === "naver" && authOrigin !== origin && !requestedReturnOrigin) {
    const canonicalStart = new URL(`/api/auth/${provider}/start`, authOrigin);
    canonicalStart.searchParams.set("return_origin", origin);
    return new Response(null, { status: 302, headers: { Location: canonicalStart.toString() } });
  }
  const returnOrigin = requestedReturnOrigin && requestedReturnOrigin !== authOrigin ? requestedReturnOrigin : "";
  const state = makeOAuthState(provider, returnOrigin);
  const callback = `${authOrigin}/api/auth/${provider}/callback`;
  const target = new URL(config.authorizeUrl);
  for (const [key, value] of Object.entries(config.authParams(callback, state))) {
    target.searchParams.set(key, value);
  }
  const headers = new Headers({ Location: target.toString() });
  headers.append("Set-Cookie", makeCookie(OAUTH_COOKIE, state, { maxAge: 600 }));
  return new Response(null, { status: 302, headers });
}

async function finishAuth(request, env, provider, url) {
  if (!(await ensureSchema(env))) return redirectWithError(request, "db-missing");
  const cookies = parseCookies(request);
  const state = url.searchParams.get("state") || "";
  const code = url.searchParams.get("code") || "";
  if (!code || !state || cookies[OAUTH_COOKIE] !== state || !state.startsWith(`${provider}:`)) {
    return redirectWithError(request, "state");
  }

  const config = providerConfig(env, provider);
  if (!config.clientId || !config.clientSecret) return redirectWithError(request, `${provider}-missing`);
  const origin = new URL(request.url).origin;
  const callback = `${origin}/api/auth/${provider}/callback`;
  const returnOrigin = oauthReturnOrigin(state);
  const oauthProfile = await fetchProviderProfile(provider, config, code, callback, state);
  if (!oauthProfile.id) return redirectWithError(request, "profile");

  const existing = await userByProvider(env, provider, oauthProfile.id);
  const current = await currentSession(request, env);
  if (current && existing && existing.id !== current.user.id) return redirectWithError(request, "already-linked");

  const user = current?.user || existing || (await createUser(env, oauthProfile));
  await upsertProvider(env, user.id, provider, oauthProfile);
  const sessionId = await createSession(env, user.id);

  const headers = new Headers({ Location: "/profile/" });
  if (returnOrigin && returnOrigin !== origin) {
    const bridgeToken = await createOAuthBridge(env, sessionId, returnOrigin);
    headers.set("Location", `${returnOrigin}/api/auth/${provider}/bridge?token=${encodeURIComponent(bridgeToken)}`);
  }
  headers.append("Set-Cookie", makeCookie(SESSION_COOKIE, sessionId, { maxAge: SESSION_DAYS * 86400 }));
  headers.append("Set-Cookie", makeCookie(OAUTH_COOKIE, "", { maxAge: 0 }));
  return new Response(null, { status: 302, headers });
}

async function finishAuthBridge(request, env, provider, url) {
  if (!PROVIDERS.has(provider)) return json({ error: "Unknown provider" }, 400);
  if (!(await ensureSchema(env))) return redirectWithError(request, "db-missing");
  const token = url.searchParams.get("token") || "";
  const row = token
    ? await env.DB.prepare("SELECT session_id, return_origin, expires_at FROM oauth_bridges WHERE token = ?").bind(token).first()
    : null;
  if (!row || row.return_origin !== url.origin || row.expires_at <= Date.now()) {
    return redirectWithError(request, "bridge");
  }
  await env.DB.prepare("DELETE FROM oauth_bridges WHERE token = ?").bind(token).run();
  const headers = new Headers({ Location: "/profile/" });
  headers.append("Set-Cookie", makeCookie(SESSION_COOKIE, row.session_id, { maxAge: SESSION_DAYS * 86400 }));
  headers.append("Set-Cookie", makeCookie(OAUTH_COOKIE, "", { maxAge: 0 }));
  return new Response(null, { status: 302, headers });
}

async function fetchProviderProfile(provider, config, code, redirectUri, state) {
  const tokenBody = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    redirect_uri: redirectUri,
  });
  if (provider === "naver") tokenBody.set("state", state);
  const tokenResponse = await fetch(config.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: tokenBody,
  });
  const token = await tokenResponse.json();
  if (!token.access_token) throw new Error(`${provider} token exchange failed`);

  const profileResponse = await fetch(config.profileUrl, {
    headers: { Authorization: `Bearer ${token.access_token}`, Accept: "application/json" },
  });
  const raw = await profileResponse.json();
  if (provider === "google") {
    return {
      id: raw.sub,
      email: raw.email || "",
      display_name: raw.name || raw.email || "Riftbound Player",
      avatar_url: raw.picture || "",
    };
  }
  const naver = raw.response || {};
  return {
    id: naver.id,
    email: naver.email || "",
    display_name: naver.nickname || naver.name || naver.email || "Riftbound Player",
    avatar_url: naver.profile_image || "",
  };
}

function providerConfig(env, provider) {
  if (provider === "google") {
    return {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      profileUrl: "https://openidconnect.googleapis.com/v1/userinfo",
      authParams: (redirectUri, state) => ({
        client_id: env.GOOGLE_CLIENT_ID,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: "openid email profile",
        state,
        access_type: "online",
        prompt: "select_account",
      }),
    };
  }
  return {
    clientId: env.NAVER_CLIENT_ID,
    clientSecret: env.NAVER_CLIENT_SECRET,
    authorizeUrl: "https://nid.naver.com/oauth2.0/authorize",
    tokenUrl: "https://nid.naver.com/oauth2.0/token",
    profileUrl: "https://openapi.naver.com/v1/nid/me",
    authParams: (redirectUri, state) => ({
      client_id: env.NAVER_CLIENT_ID,
      redirect_uri: redirectUri,
      response_type: "code",
      state,
    }),
  };
}

function authStatus(request, env) {
  const origin = new URL(request.url).origin;
  return {
    providers: {
      google: providerStatus(origin, "google", {
        GOOGLE_CLIENT_ID: env.GOOGLE_CLIENT_ID,
        GOOGLE_CLIENT_SECRET: env.GOOGLE_CLIENT_SECRET,
      }),
      naver: providerStatus(origin, "naver", {
        NAVER_CLIENT_ID: env.NAVER_CLIENT_ID,
        NAVER_CLIENT_SECRET: env.NAVER_CLIENT_SECRET,
      }),
    },
  };
}

function providerStatus(origin, provider, secrets) {
  const missing = Object.entries(secrets)
    .filter(([, value]) => !value)
    .map(([key]) => key);
  return {
    configured: missing.length === 0,
    start_url: `/api/auth/${provider}/start`,
    callback_url: `${origin}/api/auth/${provider}/callback`,
    missing,
  };
}

function authOriginForProvider(env, provider, origin) {
  if (provider !== "naver" || hostForOrigin(origin) !== "riftbound.kr") return origin;
  return allowedOAuthReturnOrigin(env.NAVER_CANONICAL_ORIGIN || NAVER_CANONICAL_ORIGIN) || origin;
}

function makeOAuthState(provider, returnOrigin = "") {
  const parts = [provider, crypto.randomUUID()];
  if (returnOrigin) parts.push(base64UrlEncode(returnOrigin));
  return parts.join(":");
}

function oauthReturnOrigin(state) {
  const [, , encodedOrigin] = String(state || "").split(":");
  if (!encodedOrigin) return "";
  return allowedOAuthReturnOrigin(base64UrlDecode(encodedOrigin));
}

function allowedOAuthReturnOrigin(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return "";
    if (!["riftbound.win", "riftbound.kr"].includes(url.hostname)) return "";
    return url.origin;
  } catch {
    return "";
  }
}

function hostForOrigin(origin) {
  try {
    return new URL(origin).hostname;
  } catch {
    return "";
  }
}

function base64UrlEncode(value) {
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(value) {
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    return atob(padded);
  } catch {
    return "";
  }
}

function mediaStatus(env) {
  const hasR2 = Boolean(env.MEDIA);
  return {
    store: hasR2 ? "r2" : "d1-inline",
    max_upload_bytes: hasR2 ? MAX_MEDIA_BYTES : MAX_INLINE_MEDIA_BYTES,
    max_avatar_bytes: hasR2 ? MAX_AVATAR_BYTES : MAX_INLINE_MEDIA_BYTES,
    max_files_per_post: 6,
  };
}

async function currentSession(request, env) {
  if (!env.DB) return null;
  const id = parseCookies(request)[SESSION_COOKIE];
  if (!id) return null;
  const row = await env.DB.prepare(
    `SELECT u.*
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.id = ? AND s.expires_at > ?`
  )
    .bind(id, Date.now())
    .first();
  return row ? { id, user: row } : null;
}

async function createUser(env, profile) {
  const id = crypto.randomUUID();
  const now = Date.now();
  await env.DB.prepare(
    "INSERT INTO users (id, display_name, bio, avatar_key, avatar_type, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  )
    .bind(id, cleanText(profile.display_name, 40) || "Riftbound Player", "", "", "", now, now)
    .run();
  return env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(id).first();
}

async function upsertProvider(env, userId, provider, profile) {
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO providers (provider, provider_user_id, user_id, email, display_name, avatar_url, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(provider, provider_user_id)
     DO UPDATE SET user_id = excluded.user_id, email = excluded.email, display_name = excluded.display_name, avatar_url = excluded.avatar_url, updated_at = excluded.updated_at`
  )
    .bind(provider, profile.id, userId, profile.email || "", profile.display_name || "", profile.avatar_url || "", now, now)
    .run();
}

async function userByProvider(env, provider, providerUserId) {
  return env.DB.prepare(
    `SELECT u.*
       FROM providers p
       JOIN users u ON u.id = p.user_id
      WHERE p.provider = ? AND p.provider_user_id = ?`
  )
    .bind(provider, providerUserId)
    .first();
}

async function providerRows(env, userId) {
  const rows = await env.DB.prepare(
    "SELECT provider, email, display_name, avatar_url, updated_at FROM providers WHERE user_id = ? ORDER BY provider"
  )
    .bind(userId)
    .all();
  return rows.results || [];
}

function savedDeckRow(row) {
  return {
    id: row.id,
    name: row.name,
    format: row.format,
    deck_json: safeJson(row.deck_json, {}),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function savedDeckForUser(env, deckId, userId) {
  const row = await env.DB.prepare("SELECT id, name, format, deck_json, created_at, updated_at FROM saved_decks WHERE id = ? AND user_id = ?")
    .bind(deckId, userId)
    .first();
  return row ? savedDeckRow(row) : null;
}

async function playgroundTableRow(env, tableId) {
  return env.DB.prepare("SELECT id, status, active_snapshot_json FROM playground_tables WHERE id = ?")
    .bind(tableId)
    .first();
}

async function playgroundSeatCount(env, tableId) {
  const row = await env.DB.prepare("SELECT COUNT(*) AS count FROM playground_seats WHERE table_id = ?")
    .bind(tableId)
    .first();
  return Number(row?.count || 0);
}

async function playgroundSeatIndex(env, tableId, userId) {
  return env.DB.prepare("SELECT seat_index FROM playground_seats WHERE table_id = ? AND user_id = ?")
    .bind(tableId, userId)
    .first();
}

async function nextPlaygroundSequence(env, tableId) {
  const row = await env.DB.prepare("SELECT COALESCE(MAX(sequence), 0) AS sequence FROM playground_events WHERE table_id = ?")
    .bind(tableId)
    .first();
  return Number(row?.sequence || 0);
}

async function insertPlaygroundSeat(env, tableId, seatIndex, user, deck, joinedAt) {
  await env.DB.prepare(
    "INSERT INTO playground_seats (table_id, seat_index, user_id, display_name, deck_id, deck_name, deck_snapshot_json, joined_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  )
    .bind(tableId, seatIndex, user.id, user.display_name, deck.id, deck.name, JSON.stringify(deck.deck_json), joinedAt)
    .run();
}

function createTableSnapshot(tableId, user, deck, now) {
  return {
    id: tableId,
    status: "waiting",
    created_at: now,
    updated_at: now,
    started_at: null,
    completed_at: null,
    victory_score: PLAYGROUND_VICTORY_SCORE,
    turn_player_id: user.id,
    seats: [createSeatSnapshot(0, user, deck, now)],
    events: [],
    chat: [],
    voice: {},
    result: { proposals: {}, final: "" },
  };
}

function createSeatSnapshot(seatIndex, user, deck, joinedAt) {
  return {
    seat_index: seatIndex,
    user_id: user.id,
    display_name: user.display_name,
    deck_id: deck.id,
    deck_name: deck.name,
    deck_snapshot: deck.deck_json,
    joined_at: joinedAt,
    points: 0,
    zones: buildPlaygroundZones(deck.deck_json),
  };
}

function publicTableForUser(table = {}, viewerUserId = "") {
  const next = cloneJson(table && typeof table === "object" ? table : {});
  for (const seat of next.seats || []) {
    for (const [zone, cards] of Object.entries(seat.zones || {})) {
      if (!Array.isArray(cards)) continue;
      seat.zones[zone] = cards.map((card, index) => publicCardForUser(card, seat, zone, viewerUserId, index));
    }
  }
  return next;
}

function publicCardForUser(card = {}, seat = {}, zone = "", viewerUserId = "", index = 0) {
  if (!shouldHideCard(card, seat, zone, viewerUserId)) return cloneJson(card);
  return {
    id: HIDDEN_CARD_ID,
    instance_id: `hidden-${zoneName(zone) || "zone"}-${index + 1}`,
    hidden: true,
    hidden_zone: zoneName(zone),
    ...(card.face_up === false ? { face_up: false } : {}),
  };
}

function shouldHideCard(card = {}, seat = {}, zone = "", viewerUserId = "") {
  const normalizedZone = zoneName(zone);
  if (isHiddenCard(card)) return true;
  if (secretDeckZones().has(normalizedZone)) return true;
  if (normalizedZone === "hand" && seat.user_id !== viewerUserId) return true;
  if (card.face_up === false && seat.user_id !== viewerUserId) return true;
  return false;
}

function isHiddenCard(card) {
  return Boolean(card?.hidden || card?.id === HIDDEN_CARD_ID);
}

function isPrivateCardZone(zone) {
  const normalizedZone = zoneName(zone);
  return secretDeckZones().has(normalizedZone) || normalizedZone === "hand";
}

function secretDeckZones() {
  return new Set(["main_deck", "rune_deck"]);
}

function buildPlaygroundZones(deckJson = {}) {
  const zones = {
    main_deck: [],
    rune_deck: [],
    rune_pool: [],
    hand: [],
    battlefield: [],
    discard: [],
    removed: [],
    revealed: [],
  };
  for (const entry of deckEntries(deckJson)) {
    const zone = entry.section === "runes" ? "rune_deck" : "main_deck";
    for (let index = 0; index < entry.quantity; index += 1) {
      zones[zone].push({ id: entry.id, instance_id: `${entry.id}-${entry.section}-${index + 1}` });
    }
  }
  return zones;
}

function deckEntries(deckJson = {}) {
  const rawEntries = Array.isArray(deckJson.entries)
    ? deckJson.entries
    : ["legends", "main", "runes", "battlefields"].flatMap((section) =>
        (deckJson[section] || []).map((entry) => ({ ...entry, section }))
      );
  return rawEntries
    .map((entry) => ({
      id: String(entry.id || "").trim(),
      quantity: Math.max(0, Math.floor(Number(entry.quantity || 0))),
      section: entry.section || "main",
    }))
    .filter((entry) => entry.id && entry.quantity > 0);
}

function validatePlaygroundEvent(table, user, eventType, payload = {}) {
  if (eventType === "game.start") {
    if (hostUserId(table) !== user.id) return { status: 403, message: "Only the table host can start" };
    if ((table.seats || []).length < 2) return { status: 409, message: "Table needs two players" };
    if (table.status === "completed") return { status: 409, message: "Table is completed" };
    return null;
  }
  const privateActionError = privateZoneActionError(table, user, eventType, payload);
  if (privateActionError) return privateActionError;
  if (activePlaygroundEventTypes().has(eventType) && table.status !== "active") {
    return { status: 409, message: "Game has not started" };
  }
  return null;
}

function privateZoneActionError(table, user, eventType, payload = {}) {
  if (!new Set(["card.move", "card.reveal", "card.flip"]).has(eventType)) return null;
  const seat = table.seats?.[Number(payload.seat_index || 0)];
  if (!seat || seat.user_id === user.id) return null;
  const zone = zoneName(eventType === "card.flip" ? payload.zone || "battlefield" : payload.from || "hand");
  if (!isPrivateCardZone(zone)) return null;
  return { status: 403, message: "Private zone requires owner" };
}

function hostUserId(table) {
  return table?.seats?.[0]?.user_id || "";
}

function activePlaygroundEventTypes() {
  return new Set(["card.move", "card.reveal", "card.flip", "turn.pass", "score.point", "result.propose", "player.concede"]);
}

function applyPlaygroundEvent(table, event) {
  if (!Array.isArray(table.events)) table.events = [];
  if (event.type === "game.start") {
    if (!table.started_at) drawOpeningHands(table);
    table.status = "active";
    table.started_at ||= event.created_at;
    table.turn_player_id = event.payload.first_player_id || table.turn_player_id || table.seats?.[0]?.user_id || "";
  }
  if (event.type === "card.move") applyCardMove(table, event.payload);
  if (event.type === "card.reveal") applyCardReveal(table, event.payload);
  if (event.type === "card.flip") applyCardFlip(table, event.payload);
  if (event.type === "turn.pass") {
    table.turn_player_id = event.payload.to_user_id || nextSeatUserId(table, event.actor_id);
    beginTurn(table, table.turn_player_id);
  }
  if (event.type === "chat.message") {
    if (!Array.isArray(table.chat)) table.chat = [];
    table.chat.push({
      sequence: event.sequence,
      user_id: event.actor_id,
      text: String(event.payload.text || "").slice(0, 240),
      created_at: event.created_at,
    });
  }
  if (event.type === "voice.presence") {
    table.voice ||= {};
    table.voice[event.actor_id] = {
      muted: Boolean(event.payload.muted),
      talking: Boolean(event.payload.talking),
      updated_at: event.created_at,
    };
  }
  if (event.type === "score.point") applyScorePoint(table, event);
  if (event.type === "result.propose") applyResultProposal(table, event);
  table.events.push(event);
}

function drawOpeningHands(table) {
  for (const seat of table.seats || []) moveCards(seat, "main_deck", "hand", 4);
}

function beginTurn(table, userId) {
  const seat = (table.seats || []).find((item) => item.user_id === userId);
  if (!seat) return;
  moveCards(seat, "rune_deck", "rune_pool", 2);
  moveCards(seat, "main_deck", "hand", 1);
}

function moveCards(seat, from, to, count) {
  if (!seat?.zones?.[from] || !seat.zones[to]) return;
  seat.zones[to].push(...seat.zones[from].splice(0, Math.max(0, Math.min(count, seat.zones[from].length))));
}

function applyCardMove(table, payload = {}) {
  const seat = table.seats?.[Number(payload.seat_index || 0)];
  const from = zoneName(payload.from);
  const to = zoneName(payload.to);
  if (!seat?.zones?.[from] || !seat.zones[to]) return;
  const selectedIndex = selectedCardIndex(seat.zones[from], payload);
  const moved =
    selectedIndex >= 0
      ? seat.zones[from].splice(selectedIndex, 1)
      : seat.zones[from].splice(0, Math.max(1, Math.min(Number(payload.count || 1), seat.zones[from].length)));
  seat.zones[to].push(...moved);
}

function applyCardReveal(table, payload = {}) {
  const seat = table.seats?.[Number(payload.seat_index || 0)];
  const from = zoneName(payload.from || "hand");
  if (!seat?.zones?.[from]) return;
  const selectedIndex = selectedCardIndex(seat.zones[from], payload);
  const index = payload.instance_id || payload.card_id ? selectedIndex : 0;
  if (index < 0) return;
  const [card] = seat.zones[from].splice(index, 1);
  seat.zones.revealed.push({ ...card, revealed_by: payload.revealed_by || seat.user_id });
}

function applyCardFlip(table, payload = {}) {
  const seat = table.seats?.[Number(payload.seat_index || 0)];
  const zone = zoneName(payload.zone || "battlefield");
  const cards = seat?.zones?.[zone];
  if (!cards) return;
  const index = selectedCardIndex(cards, payload);
  if (index < 0) return;
  const currentFaceUp = cards[index].face_up !== false;
  cards[index].face_up = typeof payload.face_up === "boolean" ? payload.face_up : !currentFaceUp;
}

function selectedCardIndex(cards = [], payload = {}) {
  if (payload.instance_id) return cards.findIndex((card) => card.instance_id === payload.instance_id);
  if (payload.card_id) return cards.findIndex((card) => card.id === payload.card_id);
  return -1;
}

function applyResultProposal(table, event) {
  table.result ||= { proposals: {}, final: "" };
  table.result.proposals ||= {};
  table.result.proposals[event.actor_id] = event.payload.result || "";
  const proposals = Object.values(table.result.proposals).filter(Boolean);
  if ((table.seats || []).length >= 2 && proposals.length >= 2 && new Set(proposals).size === 1) {
    table.status = "completed";
    table.completed_at = event.created_at;
    table.result.final = proposals[0];
  }
}

function applyScorePoint(table, event) {
  const seats = table.seats || [];
  const payload = event.payload || {};
  const targetUserId = payload.user_id || event.actor_id || "";
  const seat =
    seats.find((item) => item.user_id === targetUserId) ||
    (Number.isInteger(Number(payload.seat_index)) ? seats[Number(payload.seat_index)] : null);
  if (!seat) return;
  seat.points = Math.max(0, Number(seat.points || 0) + scoreAmount(payload.amount));
  applyVictoryCheck(table, seat, event);
}

function applyVictoryCheck(table, scoringSeat, event) {
  const seats = table.seats || [];
  const points = Number(scoringSeat.points || 0);
  const victoryScore = Number(table.victory_score || PLAYGROUND_VICTORY_SCORE);
  const hasLead = seats.every((seat) => seat.user_id === scoringSeat.user_id || points > Number(seat.points || 0));
  if (points < victoryScore || !hasLead) return;
  table.result ||= { proposals: {}, final: "" };
  table.status = "completed";
  table.completed_at = event.created_at;
  table.result.final = resultForSeat(table, scoringSeat);
  table.result.winner_user_id = scoringSeat.user_id;
}

function scoreAmount(value) {
  const parsed = Math.floor(Number(value ?? 1));
  if (!Number.isFinite(parsed)) return 1;
  return Math.max(1, Math.min(99, parsed));
}

function resultForSeat(table, seat) {
  const index = (table.seats || []).findIndex((item) => item.user_id === seat.user_id);
  if (index === 0) return "host-win";
  if (index === 1) return "guest-win";
  return `${seat.user_id}-win`;
}

function nextSeatUserId(table, actorId) {
  const seats = table.seats || [];
  const current = seats.findIndex((seat) => seat.user_id === actorId);
  return seats[(current + 1) % seats.length]?.user_id || table.turn_player_id || "";
}

function validPlaygroundEventType(type) {
  return new Set(["game.start", "card.move", "card.reveal", "card.flip", "turn.pass", "chat.message", "voice.presence", "score.point", "result.propose", "player.concede"]).has(type);
}

function registerPlaygroundSocket(tableId, userId, socket) {
  const key = String(tableId);
  if (!playgroundSockets.has(key)) playgroundSockets.set(key, new Set());
  playgroundSockets.get(key).add({ userId, socket });
}

function unregisterPlaygroundSocket(tableId, userId, socket) {
  const key = String(tableId);
  const sockets = playgroundSockets.get(key);
  if (!sockets) return;
  for (const entry of sockets) {
    if (entry.userId === userId && entry.socket === socket) sockets.delete(entry);
  }
  if (!sockets.size) playgroundSockets.delete(key);
}

function broadcastTableMessage(tableId, message, exceptUserId = "") {
  const sockets = playgroundSockets.get(String(tableId));
  if (!sockets) return;
  for (const entry of [...sockets]) {
    if (exceptUserId && entry.userId === exceptUserId) continue;
    if (message.target_user_id && message.target_user_id !== entry.userId) continue;
    sendSocket(entry.socket, publicPlaygroundMessageForUser(message, entry.userId));
  }
}

function publicPlaygroundMessageForUser(message, userId) {
  if (!message?.table) return message;
  return { ...message, table: publicTableForUser(message.table, userId) };
}

function sendSocket(socket, message) {
  try {
    socket.send(JSON.stringify(message));
  } catch {
    // Stale sockets are removed by close/error listeners when the runtime reports them.
  }
}

function isRealtimeSignal(message) {
  return (
    PLAYGROUND_SIGNAL_TYPES.has(message.type) &&
    Boolean(message.payload) &&
    typeof message.payload === "object" &&
    !Array.isArray(message.payload)
  );
}

function containsForbiddenSnapshotKeys(payload) {
  return ["active_snapshot_json", "snapshot", "seats", "events", "zones"].some((key) =>
    Object.prototype.hasOwnProperty.call(payload, key)
  );
}

function zoneName(value) {
  return String(value || "")
    .replace(/-/g, "_")
    .toLowerCase();
}

async function createSession(env, userId) {
  const id = crypto.randomUUID();
  const now = Date.now();
  await env.DB.prepare("INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
    .bind(id, userId, now, now + SESSION_DAYS * 86400 * 1000)
    .run();
  return id;
}

async function createOAuthBridge(env, sessionId, returnOrigin) {
  const token = crypto.randomUUID();
  const now = Date.now();
  await env.DB.prepare("INSERT INTO oauth_bridges (token, session_id, return_origin, created_at, expires_at) VALUES (?, ?, ?, ?, ?)")
    .bind(token, sessionId, returnOrigin, now, now + OAUTH_BRIDGE_MAX_AGE_SECONDS * 1000)
    .run();
  return token;
}

async function mediaRows(env, postId) {
  const rows = await env.DB.prepare("SELECT id, key, media_type, mime_type, created_at FROM media WHERE post_id = ? ORDER BY created_at")
    .bind(postId)
    .all();
  return (rows.results || []).map((row) => ({
    id: row.id,
    type: row.media_type,
    mime_type: row.mime_type,
    url: resourceUrl(row.key),
  }));
}

async function mediaResponse(env, encodedKey) {
  const key = decodeURIComponent(encodedKey);
  if (env.MEDIA) {
    const object = await env.MEDIA.get(key);
    if (object) {
      const headers = new Headers();
      object.writeHttpMetadata(headers);
      headers.set("Cache-Control", "public, max-age=31536000, immutable");
      headers.set("ETag", object.httpEtag);
      return new Response(object.body, { headers });
    }
  }
  return inlineMediaResponse(env, key);
}

async function inlineMediaResponse(env, key) {
  if (!env.DB || !(await ensureSchema(env))) return new Response("Not found", { status: 404 });
  const row = key.startsWith("avatars/")
    ? await env.DB.prepare("SELECT avatar_data AS inline_data, avatar_type AS mime_type FROM users WHERE avatar_key = ?")
        .bind(key)
        .first()
    : await env.DB.prepare("SELECT inline_data, mime_type FROM media WHERE key = ?")
        .bind(key)
        .first();
  if (!row?.inline_data) return new Response("Not found", { status: 404 });
  const headers = new Headers({
    "Content-Type": row.mime_type || "application/octet-stream",
    "Cache-Control": "public, max-age=31536000, immutable",
  });
  return new Response(base64ToArrayBuffer(row.inline_data), { headers });
}

async function ensureSchema(env) {
  if (!env.DB) return false;
  const statements = [
    "CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, display_name TEXT NOT NULL, bio TEXT NOT NULL DEFAULT '', avatar_key TEXT NOT NULL DEFAULT '', avatar_type TEXT NOT NULL DEFAULT '', avatar_data TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)",
    "CREATE TABLE IF NOT EXISTS providers (provider TEXT NOT NULL, provider_user_id TEXT NOT NULL, user_id TEXT NOT NULL, email TEXT NOT NULL DEFAULT '', display_name TEXT NOT NULL DEFAULT '', avatar_url TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (provider, provider_user_id))",
    "CREATE INDEX IF NOT EXISTS providers_user_id_idx ON providers(user_id)",
    "CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL)",
    "CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id)",
    "CREATE TABLE IF NOT EXISTS oauth_bridges (token TEXT PRIMARY KEY, session_id TEXT NOT NULL, return_origin TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL)",
    "CREATE INDEX IF NOT EXISTS oauth_bridges_expires_idx ON oauth_bridges(expires_at)",
    "CREATE TABLE IF NOT EXISTS posts (id TEXT PRIMARY KEY, board TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', user_id TEXT, author_name TEXT NOT NULL DEFAULT 'Guest', votes INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL)",
    "CREATE INDEX IF NOT EXISTS posts_board_created_idx ON posts(board, created_at)",
    "CREATE TABLE IF NOT EXISTS media (id TEXT PRIMARY KEY, post_id TEXT NOT NULL, key TEXT NOT NULL, media_type TEXT NOT NULL, mime_type TEXT NOT NULL, inline_data TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL)",
    "CREATE INDEX IF NOT EXISTS media_post_id_idx ON media(post_id)",
    "CREATE TABLE IF NOT EXISTS saved_decks (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, format TEXT NOT NULL, deck_json TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)",
    "CREATE INDEX IF NOT EXISTS saved_decks_user_updated_idx ON saved_decks(user_id, updated_at)",
    "CREATE TABLE IF NOT EXISTS playground_tables (id TEXT PRIMARY KEY, host_user_id TEXT NOT NULL, status TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, active_snapshot_json TEXT NOT NULL)",
    "CREATE INDEX IF NOT EXISTS playground_tables_updated_idx ON playground_tables(updated_at)",
    "CREATE TABLE IF NOT EXISTS playground_seats (table_id TEXT NOT NULL, seat_index INTEGER NOT NULL, user_id TEXT NOT NULL, display_name TEXT NOT NULL, deck_id TEXT NOT NULL, deck_name TEXT NOT NULL, deck_snapshot_json TEXT NOT NULL, joined_at INTEGER NOT NULL, PRIMARY KEY (table_id, seat_index))",
    "CREATE INDEX IF NOT EXISTS playground_seats_user_idx ON playground_seats(user_id)",
    "CREATE TABLE IF NOT EXISTS playground_events (id TEXT PRIMARY KEY, table_id TEXT NOT NULL, sequence INTEGER NOT NULL, user_id TEXT NOT NULL, event_type TEXT NOT NULL, event_json TEXT NOT NULL, created_at INTEGER NOT NULL)",
    "CREATE UNIQUE INDEX IF NOT EXISTS playground_events_table_sequence_idx ON playground_events(table_id, sequence)",
  ];
  for (const statement of statements) {
    await env.DB.prepare(statement).run();
  }
  await runSchemaMigration(env, "ALTER TABLE users ADD COLUMN avatar_data TEXT NOT NULL DEFAULT ''", /duplicate column/i);
  await runSchemaMigration(env, "ALTER TABLE media ADD COLUMN inline_data TEXT NOT NULL DEFAULT ''", /duplicate column/i);
  return true;
}

async function runSchemaMigration(env, statement, ignorableError) {
  try {
    await env.DB.prepare(statement).run();
  } catch (error) {
    if (!ignorableError.test(String(error?.message || error))) throw error;
  }
}

function publicUser(user) {
  return {
    id: user.id,
    display_name: user.display_name,
    bio: user.bio || "",
    avatar_url: user.avatar_key ? resourceUrl(user.avatar_key) : "",
  };
}

function resourceUrl(key) {
  const path = key.split("/").map(encodeURIComponent).join("/");
  return key.startsWith("avatars/") ? `/${path}` : `/media/${path}`;
}

function redirectWithError(request, code) {
  const headers = new Headers({ Location: `/profile/?auth=${encodeURIComponent(code)}` });
  headers.append("Set-Cookie", makeCookie(OAUTH_COOKIE, "", { maxAge: 0 }));
  return new Response(null, { status: 302, headers });
}

function logoutResponse() {
  const headers = new Headers();
  headers.append("Set-Cookie", makeCookie(SESSION_COOKIE, "", { maxAge: 0 }));
  return json({ ok: true }, 200, headers);
}

function parseCookies(request) {
  return Object.fromEntries(
    (request.headers.get("Cookie") || "")
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
      })
  );
}

function makeCookie(name, value, options = {}) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
  ];
  if (Number.isFinite(options.maxAge)) parts.push(`Max-Age=${options.maxAge}`);
  return parts.join("; ");
}

function json(data, status = 200, headers = new Headers()) {
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(data), { status, headers });
}

function cleanText(value, maxLength) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function safeJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

function safeName(value) {
  return String(value || "media")
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "media";
}

function isFile(value) {
  return value && typeof value === "object" && "name" in value && "size" in value && "type" in value && "arrayBuffer" in value;
}

async function fileToBase64(file) {
  return bytesToBase64(new Uint8Array(await file.arrayBuffer()));
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function base64ToArrayBuffer(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}
