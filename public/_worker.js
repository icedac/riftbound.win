const SESSION_COOKIE = "rw_session";
const OAUTH_COOKIE = "rw_oauth";
const SESSION_DAYS = 30;
const BOARDS = new Set(["free", "deck", "notice"]);
const PROVIDERS = new Set(["google", "naver"]);
const MAX_MEDIA_BYTES = 25 * 1024 * 1024;
const MAX_INLINE_MEDIA_BYTES = 1024 * 1024;
const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    try {
      if (url.pathname.startsWith("/api/")) return handleApi(request, env, url);
      if (url.pathname.startsWith("/media/")) return mediaResponse(env, url.pathname.slice("/media/".length));
      if (url.pathname.startsWith("/avatars/")) return mediaResponse(env, url.pathname.slice(1));
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
  if (url.pathname.startsWith("/api/posts/") && url.pathname.endsWith("/vote") && request.method === "POST") {
    const id = url.pathname.slice("/api/posts/".length, -"/vote".length);
    return votePost(request, env, decodeURIComponent(id));
  }
  if (url.pathname === "/api/auth/logout" && request.method === "POST") return logoutResponse();

  const authStart = url.pathname.match(/^\/api\/auth\/(google|naver)\/start$/);
  if (authStart) return startAuth(request, env, authStart[1]);
  const authCallback = url.pathname.match(/^\/api\/auth\/(google|naver)\/callback$/);
  if (authCallback) return finishAuth(request, env, authCallback[1], url);

  return json({ error: "Not found" }, 404);
}

async function meResponse(request, env) {
  const auth = authStatus(request, env);
  if (!(await ensureSchema(env))) return json({ user: null, providers: [], configured: false, auth });
  const session = await currentSession(request, env);
  if (!session) return json({ user: null, providers: [], configured: true, auth });
  const providers = await providerRows(env, session.user.id);
  return json({ user: publicUser(session.user), providers, configured: true, auth });
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

async function startAuth(request, env, provider) {
  if (!PROVIDERS.has(provider)) return json({ error: "Unknown provider" }, 400);
  if (!(await ensureSchema(env))) return redirectWithError(request, "db-missing");
  const config = providerConfig(env, provider);
  if (!config.clientId || !config.clientSecret) return redirectWithError(request, `${provider}-missing`);
  const state = `${provider}:${crypto.randomUUID()}`;
  const origin = new URL(request.url).origin;
  const callback = `${origin}/api/auth/${provider}/callback`;
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
  const oauthProfile = await fetchProviderProfile(provider, config, code, callback, state);
  if (!oauthProfile.id) return redirectWithError(request, "profile");

  const existing = await userByProvider(env, provider, oauthProfile.id);
  const current = await currentSession(request, env);
  if (current && existing && existing.id !== current.user.id) return redirectWithError(request, "already-linked");

  const user = current?.user || existing || (await createUser(env, oauthProfile));
  await upsertProvider(env, user.id, provider, oauthProfile);
  const sessionId = await createSession(env, user.id);

  const headers = new Headers({ Location: "/profile/" });
  headers.append("Set-Cookie", makeCookie(SESSION_COOKIE, sessionId, { maxAge: SESSION_DAYS * 86400 }));
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

async function createSession(env, userId) {
  const id = crypto.randomUUID();
  const now = Date.now();
  await env.DB.prepare("INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
    .bind(id, userId, now, now + SESSION_DAYS * 86400 * 1000)
    .run();
  return id;
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
    "CREATE TABLE IF NOT EXISTS posts (id TEXT PRIMARY KEY, board TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', user_id TEXT, author_name TEXT NOT NULL DEFAULT 'Guest', votes INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL)",
    "CREATE INDEX IF NOT EXISTS posts_board_created_idx ON posts(board, created_at)",
    "CREATE TABLE IF NOT EXISTS media (id TEXT PRIMARY KEY, post_id TEXT NOT NULL, key TEXT NOT NULL, media_type TEXT NOT NULL, mime_type TEXT NOT NULL, inline_data TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL)",
    "CREATE INDEX IF NOT EXISTS media_post_id_idx ON media(post_id)",
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
