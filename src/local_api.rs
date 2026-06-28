use anyhow::{Context, Result};
use axum::extract::{Multipart, Path, Query, State};
use axum::http::{HeaderMap, HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Redirect, Response};
use axum::routing::{get, post, put};
use axum::{Json, Router};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::fs;

const SESSION_COOKIE: &str = "rw_session";
const SESSION_DAYS: i64 = 30;
const MAX_MEDIA_BYTES: usize = 25 * 1024 * 1024;
const MAX_AVATAR_BYTES: usize = 2 * 1024 * 1024;

static NEXT_ID: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone)]
pub struct LocalApiOptions {
    pub db_path: PathBuf,
    pub public_dir: PathBuf,
}

#[derive(Debug)]
struct LocalApiState {
    db_path: PathBuf,
    public_dir: PathBuf,
}

#[derive(Debug, Serialize)]
struct PublicUser {
    id: String,
    display_name: String,
    bio: String,
    avatar_url: String,
}

#[derive(Debug)]
struct SessionUser {
    id: String,
    display_name: String,
    bio: String,
    avatar_url: String,
}

#[derive(Debug, Serialize)]
struct ProviderRow {
    provider: String,
    email: String,
    display_name: String,
    avatar_url: String,
}

#[derive(Debug, Deserialize)]
struct ProfilePayload {
    display_name: Option<String>,
    bio: Option<String>,
}

#[derive(Debug, Deserialize)]
struct PostsQuery {
    board: Option<String>,
}

#[derive(Debug, Deserialize)]
struct VotePayload {
    amount: Option<i64>,
}

#[derive(Debug)]
struct UploadedFile {
    filename: String,
    content_type: String,
    bytes: Vec<u8>,
}

pub fn build_local_api_router(options: LocalApiOptions) -> Result<Router> {
    if let Some(parent) = options.db_path.parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("failed to create {}", parent.display()))?;
    }
    std::fs::create_dir_all(&options.public_dir)
        .with_context(|| format!("failed to create {}", options.public_dir.display()))?;
    let conn = Connection::open(&options.db_path)
        .with_context(|| format!("failed to open {}", options.db_path.display()))?;
    init_local_api_db(&conn)?;

    let state = Arc::new(LocalApiState {
        db_path: options.db_path,
        public_dir: options.public_dir,
    });

    Ok(Router::new()
        .route("/api/me", get(me_response))
        .route("/api/auth/{provider}/start", get(local_auth_start))
        .route("/api/auth/logout", post(logout_response))
        .route("/api/profile", put(update_profile))
        .route("/api/profile/avatar", post(update_avatar))
        .route("/api/posts", get(list_posts).post(create_post))
        .route("/api/posts/{id}/vote", post(vote_post))
        .with_state(state))
}

async fn me_response(State(state): State<Arc<LocalApiState>>, headers: HeaderMap) -> Response {
    let auth = local_auth_status();
    let media = local_media_status();
    json_response(match current_user(&state, &headers) {
        Ok(Some(user)) => {
            let providers = providers_for_user(&state, &user.id).unwrap_or_default();
            json!({
                "user": public_user(user),
                "providers": providers,
                "configured": true,
                "auth": auth,
                "media": media
            })
        }
        Ok(None) => json!({ "user": null, "providers": [], "configured": true, "auth": auth, "media": media }),
        Err(error) => json!({ "error": error.to_string() }),
    })
}

async fn local_auth_start(
    State(state): State<Arc<LocalApiState>>,
    Path(provider): Path<String>,
    headers: HeaderMap,
) -> Response {
    if !matches!(provider.as_str(), "google" | "naver") {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Unknown provider" })),
        )
            .into_response();
    }

    match sign_in_or_link_provider(&state, &headers, &provider) {
        Ok(session_id) => {
            let mut response = Redirect::to("/profile/").into_response();
            response.headers_mut().insert(
                header::SET_COOKIE,
                HeaderValue::from_str(&session_cookie(&session_id, SESSION_DAYS * 86400))
                    .expect("valid cookie"),
            );
            *response.status_mut() = StatusCode::SEE_OTHER;
            response
        }
        Err(error) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": error.to_string() })),
        )
            .into_response(),
    }
}

async fn logout_response() -> Response {
    let mut response = Json(json!({ "ok": true })).into_response();
    response.headers_mut().insert(
        header::SET_COOKIE,
        HeaderValue::from_static("rw_session=; Max-Age=0; Path=/; SameSite=Lax; HttpOnly"),
    );
    response
}

async fn update_profile(
    State(state): State<Arc<LocalApiState>>,
    headers: HeaderMap,
    Json(payload): Json<ProfilePayload>,
) -> Response {
    let Some(user) = current_user_or_response(&state, &headers) else {
        return unauthorized();
    };
    let display_name = clean_text(payload.display_name.as_deref(), 40)
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "Riftbound Player".to_string());
    let bio = clean_text(payload.bio.as_deref(), 240).unwrap_or_default();
    let result = with_conn(&state, |conn| {
        conn.execute(
            "UPDATE local_users SET display_name = ?, bio = ?, updated_at = ? WHERE id = ?",
            params![display_name, bio, now_ms(), user.id],
        )?;
        Ok(())
    });
    match result {
        Ok(()) => me_response(State(state), headers).await,
        Err(error) => server_error(error),
    }
}

async fn update_avatar(
    State(state): State<Arc<LocalApiState>>,
    headers: HeaderMap,
    mut multipart: Multipart,
) -> Response {
    let Some(user) = current_user_or_response(&state, &headers) else {
        return unauthorized();
    };
    let file = match next_file(&mut multipart, "avatar", MAX_AVATAR_BYTES).await {
        Ok(Some(file)) => file,
        Ok(None) => return bad_request("Image file required"),
        Err(error) => return bad_request(&error.to_string()),
    };
    if !file.content_type.starts_with("image/") {
        return bad_request("Image file required");
    }
    let key = format!("user-media/avatars/{}/avatar.webp", safe_segment(&user.id));
    if let Err(error) = write_public_file(&state, &key, &file.bytes).await {
        return server_error(error);
    }
    let avatar_url = format!("/{key}");
    let result = with_conn(&state, |conn| {
        conn.execute(
            "UPDATE local_users SET avatar_url = ?, updated_at = ? WHERE id = ?",
            params![avatar_url, now_ms(), user.id],
        )?;
        Ok(())
    });
    match result {
        Ok(()) => json_response(json!({ "avatar_url": avatar_url })),
        Err(error) => server_error(error),
    }
}

async fn list_posts(
    State(state): State<Arc<LocalApiState>>,
    Query(query): Query<PostsQuery>,
) -> Response {
    let board = clean_text(query.board.as_deref(), 20).unwrap_or_else(|| "free".to_string());
    if !valid_board(&board) {
        return bad_request("Unknown board");
    }
    match posts_for_board(&state, &board) {
        Ok(posts) => json_response(json!({ "posts": posts })),
        Err(error) => server_error(error),
    }
}

async fn create_post(
    State(state): State<Arc<LocalApiState>>,
    headers: HeaderMap,
    mut multipart: Multipart,
) -> Response {
    let mut board = "free".to_string();
    let mut title = String::new();
    let mut body = String::new();
    let mut files = Vec::new();

    while let Ok(Some(field)) = multipart.next_field().await {
        let name = field.name().unwrap_or_default().to_string();
        if name == "media" {
            let content_type = field
                .content_type()
                .unwrap_or("application/octet-stream")
                .to_string();
            if !content_type.starts_with("image/") && !content_type.starts_with("video/") {
                return bad_request("Only image and video uploads are allowed");
            }
            let filename = field.file_name().unwrap_or("media").to_string();
            let bytes = match field.bytes().await {
                Ok(bytes) => bytes,
                Err(error) => return bad_request(&error.to_string()),
            };
            if bytes.len() > MAX_MEDIA_BYTES {
                return bad_request("Media file is too large");
            }
            files.push(UploadedFile {
                filename,
                content_type,
                bytes: bytes.to_vec(),
            });
        } else {
            let value = match field.text().await {
                Ok(value) => value,
                Err(error) => return bad_request(&error.to_string()),
            };
            match name.as_str() {
                "board" => board = clean_text(Some(&value), 20).unwrap_or_default(),
                "title" => title = clean_text(Some(&value), 90).unwrap_or_default(),
                "body" => body = clean_text(Some(&value), 800).unwrap_or_default(),
                _ => {}
            }
        }
    }

    if !valid_board(&board) {
        return bad_request("Unknown board");
    }
    if title.is_empty() {
        return bad_request("Title required");
    }

    let current = current_user(&state, &headers).ok().flatten();
    let post_id = new_id("post");
    let author_name = current
        .as_ref()
        .map(|user| user.display_name.clone())
        .unwrap_or_else(|| "Guest".to_string());
    let user_id = current.as_ref().map(|user| user.id.clone());
    let created_at = now_ms();

    let insert_result = with_conn(&state, |conn| {
        conn.execute(
            "INSERT INTO local_posts (id, board, title, body, user_id, author_name, votes, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)",
            params![post_id, board, title, body, user_id, author_name, created_at],
        )?;
        Ok(())
    });
    if let Err(error) = insert_result {
        return server_error(error);
    }

    for file in files.iter().take(6) {
        let media_id = new_id("media");
        let media_type = if file.content_type.starts_with("video/") {
            "video"
        } else {
            "image"
        };
        let key = format!(
            "user-media/community/{}/{}-{}",
            safe_segment(&post_id),
            safe_segment(&media_id),
            safe_name(&file.filename)
        );
        if let Err(error) = write_public_file(&state, &key, &file.bytes).await {
            return server_error(error);
        }
        let url = format!("/{key}");
        let result = with_conn(&state, |conn| {
            conn.execute(
                "INSERT INTO local_media (id, post_id, url, media_type, mime_type, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                params![media_id, post_id, url, media_type, file.content_type, created_at],
            )?;
            Ok(())
        });
        if let Err(error) = result {
            return server_error(error);
        }
    }

    (StatusCode::CREATED, Json(json!({ "id": post_id }))).into_response()
}

async fn vote_post(
    State(state): State<Arc<LocalApiState>>,
    Path(id): Path<String>,
    Json(payload): Json<VotePayload>,
) -> Response {
    let amount = payload.amount.unwrap_or_default().clamp(-1, 1);
    if amount == 0 {
        return bad_request("Vote amount required");
    }
    match with_conn(&state, |conn| {
        conn.execute(
            "UPDATE local_posts SET votes = votes + ? WHERE id = ?",
            params![amount, id],
        )?;
        Ok(())
    }) {
        Ok(()) => json_response(json!({ "ok": true })),
        Err(error) => server_error(error),
    }
}

fn init_local_api_db(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS local_users (
            id TEXT PRIMARY KEY,
            display_name TEXT NOT NULL,
            bio TEXT NOT NULL DEFAULT '',
            avatar_url TEXT NOT NULL DEFAULT '',
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS local_providers (
            provider TEXT NOT NULL,
            provider_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            email TEXT NOT NULL DEFAULT '',
            display_name TEXT NOT NULL DEFAULT '',
            avatar_url TEXT NOT NULL DEFAULT '',
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (provider, provider_id)
        );

        CREATE TABLE IF NOT EXISTS local_sessions (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            expires_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS local_posts (
            id TEXT PRIMARY KEY,
            board TEXT NOT NULL,
            title TEXT NOT NULL,
            body TEXT NOT NULL DEFAULT '',
            user_id TEXT,
            author_name TEXT NOT NULL DEFAULT 'Guest',
            votes INTEGER NOT NULL DEFAULT 1,
            created_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS local_media (
            id TEXT PRIMARY KEY,
            post_id TEXT NOT NULL,
            url TEXT NOT NULL,
            media_type TEXT NOT NULL,
            mime_type TEXT NOT NULL,
            created_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS local_posts_board_created_idx ON local_posts(board, created_at);
        CREATE INDEX IF NOT EXISTS local_media_post_idx ON local_media(post_id, created_at);
        "#,
    )?;
    Ok(())
}

fn sign_in_or_link_provider(
    state: &LocalApiState,
    headers: &HeaderMap,
    provider: &str,
) -> Result<String> {
    let provider_id = format!("local-{provider}");
    let now = now_ms();
    with_conn(state, |conn| {
        let current = current_user_from_conn(conn, headers)?;
        let existing_user_id = conn
            .query_row(
                "SELECT user_id FROM local_providers WHERE provider = ? AND provider_id = ?",
                params![provider, provider_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?;

        let user_id = current
            .map(|user| user.id)
            .or(existing_user_id)
            .unwrap_or_else(|| {
                let id = new_id("user");
                let display = if provider == "google" {
                    "Google Player"
                } else {
                    "Naver Player"
                };
                conn.execute(
                    "INSERT INTO local_users (id, display_name, bio, avatar_url, created_at, updated_at) VALUES (?, ?, '', '', ?, ?)",
                    params![id, display, now, now],
                )
                .expect("insert local user");
                id
            });

        conn.execute(
            "INSERT INTO local_providers (provider, provider_id, user_id, email, display_name, avatar_url, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, '', ?, ?)
             ON CONFLICT(provider, provider_id) DO UPDATE SET
                user_id = excluded.user_id,
                updated_at = excluded.updated_at",
            params![
                provider,
                provider_id,
                user_id,
                format!("{provider}@local.riftbound.win"),
                if provider == "google" { "Google Player" } else { "Naver Player" },
                now,
                now
            ],
        )?;

        let session_id = new_id("session");
        conn.execute(
            "INSERT INTO local_sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
            params![session_id, user_id, now, now + SESSION_DAYS * 86400 * 1000],
        )?;
        Ok(session_id)
    })
}

fn current_user(state: &LocalApiState, headers: &HeaderMap) -> Result<Option<SessionUser>> {
    with_conn(state, |conn| Ok(current_user_from_conn(conn, headers)?))
}

fn current_user_from_conn(
    conn: &Connection,
    headers: &HeaderMap,
) -> rusqlite::Result<Option<SessionUser>> {
    let Some(session_id) = cookie_value(headers, SESSION_COOKIE) else {
        return Ok(None);
    };
    conn.query_row(
        "SELECT u.id, u.display_name, u.bio, u.avatar_url
           FROM local_sessions s
           JOIN local_users u ON u.id = s.user_id
          WHERE s.id = ? AND s.expires_at > ?",
        params![session_id, now_ms()],
        |row| {
            Ok(SessionUser {
                id: row.get(0)?,
                display_name: row.get(1)?,
                bio: row.get(2)?,
                avatar_url: row.get(3)?,
            })
        },
    )
    .optional()
}

fn current_user_or_response(state: &LocalApiState, headers: &HeaderMap) -> Option<SessionUser> {
    current_user(state, headers).ok().flatten()
}

fn providers_for_user(state: &LocalApiState, user_id: &str) -> Result<Vec<ProviderRow>> {
    with_conn(state, |conn| {
        let mut stmt = conn.prepare(
            "SELECT provider, email, display_name, avatar_url FROM local_providers WHERE user_id = ? ORDER BY provider",
        )?;
        let rows = stmt.query_map(params![user_id], |row| {
            Ok(ProviderRow {
                provider: row.get(0)?,
                email: row.get(1)?,
                display_name: row.get(2)?,
                avatar_url: row.get(3)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    })
}

fn local_auth_status() -> Value {
    json!({
        "providers": {
            "google": {
                "configured": true,
                "start_url": "/api/auth/google/start",
                "callback_url": "/api/auth/google/callback",
                "missing": [],
            },
            "naver": {
                "configured": true,
                "start_url": "/api/auth/naver/start",
                "callback_url": "/api/auth/naver/callback",
                "missing": [],
            },
        }
    })
}

fn local_media_status() -> Value {
    json!({
        "store": "local-files",
        "max_upload_bytes": MAX_MEDIA_BYTES,
        "max_avatar_bytes": MAX_AVATAR_BYTES,
        "max_files_per_post": 6,
    })
}

fn posts_for_board(state: &LocalApiState, board: &str) -> Result<Vec<Value>> {
    with_conn(state, |conn| {
        let mut stmt = conn.prepare(
            "SELECT id, board, title, body, user_id, author_name, votes, created_at
               FROM local_posts
              WHERE board = ?
              ORDER BY votes DESC, created_at DESC
              LIMIT 80",
        )?;
        let rows = stmt.query_map(params![board], |row| {
            let id: String = row.get(0)?;
            Ok(json!({
                "id": id,
                "board": row.get::<_, String>(1)?,
                "title": row.get::<_, String>(2)?,
                "body": row.get::<_, String>(3)?,
                "user_id": row.get::<_, Option<String>>(4)?,
                "author_name": row.get::<_, String>(5)?,
                "votes": row.get::<_, i64>(6)?,
                "created_at": row.get::<_, i64>(7)?,
                "comments": 0,
                "media": media_for_post(conn, &id)?,
            }))
        })?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    })
}

fn media_for_post(conn: &Connection, post_id: &str) -> rusqlite::Result<Vec<Value>> {
    let mut stmt = conn.prepare(
        "SELECT id, url, media_type, mime_type, created_at FROM local_media WHERE post_id = ? ORDER BY created_at",
    )?;
    let rows = stmt.query_map(params![post_id], |row| {
        Ok(json!({
            "id": row.get::<_, String>(0)?,
            "url": row.get::<_, String>(1)?,
            "media_type": row.get::<_, String>(2)?,
            "mime_type": row.get::<_, String>(3)?,
            "created_at": row.get::<_, i64>(4)?,
        }))
    })?;
    rows.collect::<rusqlite::Result<Vec<_>>>()
}

async fn next_file(
    multipart: &mut Multipart,
    field_name: &str,
    max_bytes: usize,
) -> Result<Option<UploadedFile>> {
    while let Some(field) = multipart.next_field().await? {
        if field.name() != Some(field_name) {
            continue;
        }
        let filename = field.file_name().unwrap_or(field_name).to_string();
        let content_type = field
            .content_type()
            .unwrap_or("application/octet-stream")
            .to_string();
        let bytes = field.bytes().await?;
        if bytes.len() > max_bytes {
            anyhow::bail!("File is too large");
        }
        return Ok(Some(UploadedFile {
            filename,
            content_type,
            bytes: bytes.to_vec(),
        }));
    }
    Ok(None)
}

async fn write_public_file(state: &LocalApiState, key: &str, bytes: &[u8]) -> Result<()> {
    let path = state.public_dir.join(key);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .await
            .with_context(|| format!("failed to create {}", parent.display()))?;
    }
    fs::write(&path, bytes)
        .await
        .with_context(|| format!("failed to write {}", path.display()))
}

fn with_conn<T>(state: &LocalApiState, f: impl FnOnce(&Connection) -> Result<T>) -> Result<T> {
    let conn = Connection::open(&state.db_path)
        .with_context(|| format!("failed to open {}", state.db_path.display()))?;
    init_local_api_db(&conn)?;
    f(&conn)
}

fn public_user(user: SessionUser) -> PublicUser {
    PublicUser {
        id: user.id,
        display_name: user.display_name,
        bio: user.bio,
        avatar_url: user.avatar_url,
    }
}

fn cookie_value(headers: &HeaderMap, name: &str) -> Option<String> {
    let cookie = headers.get(header::COOKIE)?.to_str().ok()?;
    for part in cookie.split(';') {
        let (key, value) = part.trim().split_once('=')?;
        if key == name {
            return Some(value.to_string());
        }
    }
    None
}

fn session_cookie(session_id: &str, max_age: i64) -> String {
    format!("{SESSION_COOKIE}={session_id}; Max-Age={max_age}; Path=/; SameSite=Lax; HttpOnly")
}

fn json_response(value: Value) -> Response {
    Json(value).into_response()
}

fn bad_request(message: &str) -> Response {
    (StatusCode::BAD_REQUEST, Json(json!({ "error": message }))).into_response()
}

fn unauthorized() -> Response {
    (
        StatusCode::UNAUTHORIZED,
        Json(json!({ "error": "Sign in required" })),
    )
        .into_response()
}

fn server_error(error: anyhow::Error) -> Response {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(json!({ "error": error.to_string() })),
    )
        .into_response()
}

fn valid_board(board: &str) -> bool {
    matches!(board, "free" | "deck" | "notice")
}

fn clean_text(value: Option<&str>, max_len: usize) -> Option<String> {
    let trimmed = value?.trim();
    Some(trimmed.chars().take(max_len).collect())
}

fn safe_name(value: &str) -> String {
    let name = value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '.' | '-' | '_') {
                ch
            } else {
                '-'
            }
        })
        .collect::<String>();
    if name.trim_matches('-').is_empty() {
        "media.bin".to_string()
    } else {
        name
    }
}

fn safe_segment(value: &str) -> String {
    safe_name(value).replace('.', "-")
}

fn new_id(prefix: &str) -> String {
    format!(
        "{prefix}-{}-{}",
        now_ms(),
        NEXT_ID.fetch_add(1, Ordering::Relaxed)
    )
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}
