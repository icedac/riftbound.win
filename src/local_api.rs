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

#[derive(Debug, Deserialize)]
struct SavedDeckPayload {
    name: Option<String>,
    format: Option<String>,
    deck_json: Option<Value>,
}

#[derive(Debug, Deserialize)]
struct PlaygroundDeckPayload {
    deck_id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct PlaygroundEventPayload {
    #[serde(rename = "type")]
    event_type: Option<String>,
    payload: Option<Value>,
}

#[derive(Debug, Deserialize)]
struct PlaygroundEventsQuery {
    after: Option<i64>,
}

#[derive(Debug, Clone)]
struct SavedDeckRecord {
    id: String,
    name: String,
    deck_json: Value,
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
        .route("/playground/tables/{id}", get(playground_table_entrypoint))
        .route("/api/auth/logout", post(logout_response))
        .route("/api/profile", put(update_profile))
        .route("/api/profile/avatar", post(update_avatar))
        .route("/api/posts", get(list_posts).post(create_post))
        .route("/api/posts/{id}/vote", post(vote_post))
        .route(
            "/api/saved-decks",
            get(list_saved_decks).post(create_saved_deck),
        )
        .route(
            "/api/playground/tables",
            get(list_playground_tables).post(create_playground_table),
        )
        .route("/api/playground/tables/{id}", get(get_playground_table))
        .route(
            "/api/playground/tables/{id}/join",
            post(join_playground_table),
        )
        .route(
            "/api/playground/tables/{id}/events",
            get(list_playground_events).post(append_playground_event),
        )
        .with_state(state))
}

async fn playground_table_entrypoint(
    State(state): State<Arc<LocalApiState>>,
    Path(_id): Path<String>,
) -> Response {
    match fs::read_to_string(state.public_dir.join("playground").join("index.html")).await {
        Ok(html) => ([(header::CONTENT_TYPE, "text/html; charset=utf-8")], html).into_response(),
        Err(_) => not_found("Playground entrypoint not found"),
    }
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
        Ok(None) => {
            json!({ "user": null, "providers": [], "configured": true, "auth": auth, "media": media })
        }
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

async fn list_saved_decks(State(state): State<Arc<LocalApiState>>, headers: HeaderMap) -> Response {
    let Some(user) = current_user_or_response(&state, &headers) else {
        return unauthorized();
    };
    match saved_decks_for_user(&state, &user.id) {
        Ok(decks) => json_response(json!({ "decks": decks })),
        Err(error) => server_error(error),
    }
}

async fn create_saved_deck(
    State(state): State<Arc<LocalApiState>>,
    headers: HeaderMap,
    Json(payload): Json<SavedDeckPayload>,
) -> Response {
    let Some(user) = current_user_or_response(&state, &headers) else {
        return unauthorized();
    };
    let name = clean_text(payload.name.as_deref(), 80)
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "Untitled Deck".to_string());
    let format = clean_text(payload.format.as_deref(), 40)
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "constructed".to_string());
    let Some(deck_json) = payload.deck_json else {
        return bad_request("Deck JSON required");
    };
    if !deck_json.is_object() {
        return bad_request("Deck JSON must be an object");
    }

    let deck_id = new_id("deck");
    let now = now_ms();
    let deck_text = match serde_json::to_string(&deck_json) {
        Ok(value) => value,
        Err(error) => return server_error(error.into()),
    };
    let result = with_conn(&state, |conn| {
        conn.execute(
            "INSERT INTO local_saved_decks (id, user_id, name, format, deck_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            params![deck_id, user.id, name, format, deck_text, now, now],
        )?;
        saved_deck_by_id(conn, &deck_id)
    });
    match result {
        Ok(deck) => (StatusCode::CREATED, Json(json!({ "deck": deck }))).into_response(),
        Err(error) => server_error(error),
    }
}

async fn list_playground_tables(
    State(state): State<Arc<LocalApiState>>,
    _headers: HeaderMap,
) -> Response {
    match playground_tables(&state) {
        Ok(tables) => json_response(json!({ "tables": tables })),
        Err(error) => server_error(error),
    }
}

async fn create_playground_table(
    State(state): State<Arc<LocalApiState>>,
    headers: HeaderMap,
    Json(payload): Json<PlaygroundDeckPayload>,
) -> Response {
    let Some(user) = current_user_or_response(&state, &headers) else {
        return unauthorized();
    };
    let Some(deck_id) = payload.deck_id.filter(|value| !value.trim().is_empty()) else {
        return bad_request("Deck id required");
    };
    let result = with_conn(&state, |conn| {
        let deck = saved_deck_record_for_user(conn, &deck_id, &user.id)?
            .ok_or_else(|| anyhow::anyhow!("Deck not found"))?;
        let table_id = new_id("table");
        let now = now_ms();
        let table = create_table_snapshot(&table_id, &user, &deck, now);
        conn.execute(
            "INSERT INTO local_playground_tables (id, host_user_id, status, created_at, updated_at, active_snapshot_json) VALUES (?, ?, ?, ?, ?, ?)",
            params![table_id, user.id, "waiting", now, now, table.to_string()],
        )?;
        insert_playground_seat(conn, &table_id, 0, &user, &deck, now)?;
        Ok(table)
    });
    match result {
        Ok(table) => (StatusCode::CREATED, Json(json!({ "table": table }))).into_response(),
        Err(error) if error.to_string().contains("Deck not found") => bad_request("Deck not found"),
        Err(error) => server_error(error),
    }
}

async fn get_playground_table(
    State(state): State<Arc<LocalApiState>>,
    Path(id): Path<String>,
) -> Response {
    match playground_table(&state, &id) {
        Ok(Some(table)) => json_response(json!({ "table": table })),
        Ok(None) => not_found("Table not found"),
        Err(error) => server_error(error),
    }
}

async fn join_playground_table(
    State(state): State<Arc<LocalApiState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<PlaygroundDeckPayload>,
) -> Response {
    let Some(user) = current_user_or_response(&state, &headers) else {
        return unauthorized();
    };
    let Some(deck_id) = payload.deck_id.filter(|value| !value.trim().is_empty()) else {
        return bad_request("Deck id required");
    };
    let result = with_conn(&state, |conn| {
        let deck = saved_deck_record_for_user(conn, &deck_id, &user.id)?
            .ok_or_else(|| anyhow::anyhow!("Deck not found"))?;
        let row =
            playground_table_row(conn, &id)?.ok_or_else(|| anyhow::anyhow!("Table not found"))?;
        let seat_count = playground_seat_count(conn, &id)?;
        if playground_seat_index(conn, &id, &user.id)?.is_some() {
            return Ok(safe_json(&row.2, json!({})));
        }
        if seat_count >= 2 {
            anyhow::bail!("Table is full");
        }
        let now = now_ms();
        let mut table = safe_json(&row.2, json!({}));
        let seat = create_seat_snapshot(seat_count as usize, &user, &deck, now);
        table
            .get_mut("seats")
            .and_then(Value::as_array_mut)
            .ok_or_else(|| anyhow::anyhow!("Invalid table snapshot"))?
            .push(seat);
        let status = row.1;
        table["status"] = json!(status.clone());
        table["updated_at"] = json!(now);
        insert_playground_seat(conn, &id, seat_count, &user, &deck, now)?;
        conn.execute(
            "UPDATE local_playground_tables SET status = ?, updated_at = ?, active_snapshot_json = ? WHERE id = ?",
            params![status, now, table.to_string(), id],
        )?;
        Ok(table)
    });
    match result {
        Ok(table) => json_response(json!({ "table": table })),
        Err(error) if error.to_string().contains("Deck not found") => bad_request("Deck not found"),
        Err(error) if error.to_string().contains("Table not found") => not_found("Table not found"),
        Err(error) if error.to_string().contains("Table is full") => (
            StatusCode::CONFLICT,
            Json(json!({ "error": "Table is full" })),
        )
            .into_response(),
        Err(error) => server_error(error),
    }
}

async fn append_playground_event(
    State(state): State<Arc<LocalApiState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<PlaygroundEventPayload>,
) -> Response {
    let Some(user) = current_user_or_response(&state, &headers) else {
        return unauthorized();
    };
    let event_type = clean_text(payload.event_type.as_deref(), 40).unwrap_or_default();
    if !valid_playground_event_type(&event_type) {
        return bad_request("Unknown event type");
    }
    let event_payload = payload.payload.unwrap_or_else(|| json!({}));
    if !event_payload.is_object() {
        return bad_request("Event payload must be an object");
    }
    if contains_forbidden_snapshot_keys(&event_payload) {
        return bad_request("Client-authored snapshots are not accepted");
    }
    let result = with_conn(&state, |conn| {
        let row =
            playground_table_row(conn, &id)?.ok_or_else(|| anyhow::anyhow!("Table not found"))?;
        if playground_seat_index(conn, &id, &user.id)?.is_none() {
            anyhow::bail!("Table seat required");
        }
        let mut table = safe_json(&row.2, json!({}));
        validate_playground_event(&table, &user, &event_type)?;
        let sequence = next_playground_sequence(conn, &id)?;
        let now = now_ms();
        let event_id = new_id("event");
        let event = json!({
            "id": event_id,
            "table_id": id,
            "sequence": sequence,
            "actor_id": user.id,
            "type": event_type,
            "payload": event_payload,
            "created_at": now,
        });
        apply_playground_event(&mut table, &event);
        table["updated_at"] = json!(now);
        let status = table["status"].as_str().unwrap_or("active").to_string();
        conn.execute(
            "INSERT INTO local_playground_events (id, table_id, sequence, user_id, event_type, event_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            params![
                event_id,
                id,
                sequence,
                user.id,
                event_type,
                event["payload"].to_string(),
                now
            ],
        )?;
        conn.execute(
            "UPDATE local_playground_tables SET updated_at = ?, active_snapshot_json = ?, status = ? WHERE id = ?",
            params![now, table.to_string(), status, id],
        )?;
        Ok(json!({ "table": table, "event": event }))
    });
    match result {
        Ok(value) => (StatusCode::CREATED, Json(value)).into_response(),
        Err(error) if error.to_string().contains("Table not found") => not_found("Table not found"),
        Err(error) if error.to_string().contains("Table seat required") => unauthorized(),
        Err(error) if error.to_string().contains("Table host required") => (
            StatusCode::FORBIDDEN,
            Json(json!({ "error": "Only the table host can start" })),
        )
            .into_response(),
        Err(error) if error.to_string().contains("Table needs two players") => (
            StatusCode::CONFLICT,
            Json(json!({ "error": "Table needs two players" })),
        )
            .into_response(),
        Err(error) if error.to_string().contains("Table is completed") => (
            StatusCode::CONFLICT,
            Json(json!({ "error": "Table is completed" })),
        )
            .into_response(),
        Err(error) if error.to_string().contains("Game has not started") => (
            StatusCode::CONFLICT,
            Json(json!({ "error": "Game has not started" })),
        )
            .into_response(),
        Err(error) => server_error(error),
    }
}

async fn list_playground_events(
    State(state): State<Arc<LocalApiState>>,
    Path(id): Path<String>,
    Query(query): Query<PlaygroundEventsQuery>,
) -> Response {
    match playground_events(&state, &id, query.after.unwrap_or(0)) {
        Ok(events) => json_response(json!({ "events": events })),
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

        CREATE TABLE IF NOT EXISTS local_saved_decks (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            name TEXT NOT NULL,
            format TEXT NOT NULL,
            deck_json TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS local_playground_tables (
            id TEXT PRIMARY KEY,
            host_user_id TEXT NOT NULL,
            status TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            active_snapshot_json TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS local_playground_seats (
            table_id TEXT NOT NULL,
            seat_index INTEGER NOT NULL,
            user_id TEXT NOT NULL,
            display_name TEXT NOT NULL,
            deck_id TEXT NOT NULL,
            deck_name TEXT NOT NULL,
            deck_snapshot_json TEXT NOT NULL,
            joined_at INTEGER NOT NULL,
            PRIMARY KEY (table_id, seat_index)
        );

        CREATE TABLE IF NOT EXISTS local_playground_events (
            id TEXT PRIMARY KEY,
            table_id TEXT NOT NULL,
            sequence INTEGER NOT NULL,
            user_id TEXT NOT NULL,
            event_type TEXT NOT NULL,
            event_json TEXT NOT NULL,
            created_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS local_posts_board_created_idx ON local_posts(board, created_at);
        CREATE INDEX IF NOT EXISTS local_media_post_idx ON local_media(post_id, created_at);
        CREATE INDEX IF NOT EXISTS local_saved_decks_user_updated_idx ON local_saved_decks(user_id, updated_at);
        CREATE INDEX IF NOT EXISTS local_playground_tables_updated_idx ON local_playground_tables(updated_at);
        CREATE INDEX IF NOT EXISTS local_playground_seats_user_idx ON local_playground_seats(user_id);
        CREATE UNIQUE INDEX IF NOT EXISTS local_playground_events_table_sequence_idx ON local_playground_events(table_id, sequence);
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

fn saved_decks_for_user(state: &LocalApiState, user_id: &str) -> Result<Vec<Value>> {
    with_conn(state, |conn| {
        let mut stmt = conn.prepare(
            "SELECT id, name, format, deck_json, created_at, updated_at
               FROM local_saved_decks
              WHERE user_id = ?
              ORDER BY updated_at DESC",
        )?;
        let rows = stmt.query_map(params![user_id], saved_deck_from_row)?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    })
}

fn saved_deck_by_id(conn: &Connection, id: &str) -> Result<Value> {
    Ok(conn.query_row(
        "SELECT id, name, format, deck_json, created_at, updated_at FROM local_saved_decks WHERE id = ?",
        params![id],
        saved_deck_from_row,
    )?)
}

fn saved_deck_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Value> {
    let deck_text: String = row.get(3)?;
    let deck_json = serde_json::from_str(&deck_text).unwrap_or_else(|_| json!({}));
    Ok(json!({
        "id": row.get::<_, String>(0)?,
        "name": row.get::<_, String>(1)?,
        "format": row.get::<_, String>(2)?,
        "deck_json": deck_json,
        "created_at": row.get::<_, i64>(4)?,
        "updated_at": row.get::<_, i64>(5)?,
    }))
}

fn saved_deck_record_for_user(
    conn: &Connection,
    id: &str,
    user_id: &str,
) -> Result<Option<SavedDeckRecord>> {
    Ok(conn
        .query_row(
            "SELECT id, name, deck_json FROM local_saved_decks WHERE id = ? AND user_id = ?",
            params![id, user_id],
            |row| {
                let deck_text: String = row.get(2)?;
                Ok(SavedDeckRecord {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    deck_json: serde_json::from_str(&deck_text).unwrap_or_else(|_| json!({})),
                })
            },
        )
        .optional()?)
}

fn playground_tables(state: &LocalApiState) -> Result<Vec<Value>> {
    with_conn(state, |conn| {
        let mut stmt = conn.prepare(
            "SELECT active_snapshot_json FROM local_playground_tables ORDER BY updated_at DESC LIMIT 80",
        )?;
        let rows = stmt.query_map([], |row| {
            let text: String = row.get(0)?;
            Ok(safe_json(&text, json!({})))
        })?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    })
}

fn playground_table(state: &LocalApiState, id: &str) -> Result<Option<Value>> {
    with_conn(state, |conn| {
        Ok(playground_table_row(conn, id)?.map(|row| safe_json(&row.2, json!({}))))
    })
}

fn playground_table_row(conn: &Connection, id: &str) -> Result<Option<(String, String, String)>> {
    Ok(conn
        .query_row(
            "SELECT id, status, active_snapshot_json FROM local_playground_tables WHERE id = ?",
            params![id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()?)
}

fn playground_seat_count(conn: &Connection, table_id: &str) -> Result<i64> {
    Ok(conn.query_row(
        "SELECT COUNT(*) FROM local_playground_seats WHERE table_id = ?",
        params![table_id],
        |row| row.get(0),
    )?)
}

fn playground_seat_index(conn: &Connection, table_id: &str, user_id: &str) -> Result<Option<i64>> {
    Ok(conn
        .query_row(
            "SELECT seat_index FROM local_playground_seats WHERE table_id = ? AND user_id = ?",
            params![table_id, user_id],
            |row| row.get(0),
        )
        .optional()?)
}

fn next_playground_sequence(conn: &Connection, table_id: &str) -> Result<i64> {
    let current: i64 = conn.query_row(
        "SELECT COALESCE(MAX(sequence), 0) FROM local_playground_events WHERE table_id = ?",
        params![table_id],
        |row| row.get(0),
    )?;
    Ok(current + 1)
}

fn playground_events(state: &LocalApiState, table_id: &str, after: i64) -> Result<Vec<Value>> {
    with_conn(state, |conn| {
        let mut stmt = conn.prepare(
            "SELECT id, table_id, sequence, user_id, event_type, event_json, created_at
               FROM local_playground_events
              WHERE table_id = ? AND sequence > ?
              ORDER BY sequence ASC",
        )?;
        let rows = stmt.query_map(params![table_id, after], playground_event_from_row)?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    })
}

fn playground_event_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Value> {
    let event_text: String = row.get(5)?;
    Ok(json!({
        "id": row.get::<_, String>(0)?,
        "table_id": row.get::<_, String>(1)?,
        "sequence": row.get::<_, i64>(2)?,
        "actor_id": row.get::<_, String>(3)?,
        "type": row.get::<_, String>(4)?,
        "payload": serde_json::from_str(&event_text).unwrap_or_else(|_| json!({})),
        "created_at": row.get::<_, i64>(6)?,
    }))
}

fn insert_playground_seat(
    conn: &Connection,
    table_id: &str,
    seat_index: i64,
    user: &SessionUser,
    deck: &SavedDeckRecord,
    joined_at: i64,
) -> Result<()> {
    conn.execute(
        "INSERT INTO local_playground_seats (table_id, seat_index, user_id, display_name, deck_id, deck_name, deck_snapshot_json, joined_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        params![
            table_id,
            seat_index,
            user.id,
            user.display_name,
            deck.id,
            deck.name,
            deck.deck_json.to_string(),
            joined_at,
        ],
    )?;
    Ok(())
}

fn create_table_snapshot(
    table_id: &str,
    user: &SessionUser,
    deck: &SavedDeckRecord,
    now: i64,
) -> Value {
    json!({
        "id": table_id,
        "status": "waiting",
        "created_at": now,
        "updated_at": now,
        "started_at": null,
        "completed_at": null,
        "turn_player_id": user.id,
        "seats": [create_seat_snapshot(0, user, deck, now)],
        "events": [],
        "chat": [],
        "voice": {},
        "result": { "proposals": {}, "final": "" },
    })
}

fn create_seat_snapshot(
    seat_index: usize,
    user: &SessionUser,
    deck: &SavedDeckRecord,
    joined_at: i64,
) -> Value {
    json!({
        "seat_index": seat_index,
        "user_id": user.id,
        "display_name": user.display_name,
        "deck_id": deck.id,
        "deck_name": deck.name,
        "deck_snapshot": deck.deck_json,
        "joined_at": joined_at,
        "zones": build_playground_zones(&deck.deck_json),
    })
}

fn build_playground_zones(deck_json: &Value) -> Value {
    let mut main_deck = Vec::new();
    let mut rune_deck = Vec::new();
    for entry in deck_entries(deck_json) {
        let target = if entry.section == "runes" {
            &mut rune_deck
        } else {
            &mut main_deck
        };
        for index in 0..entry.quantity {
            target.push(json!({
                "id": entry.id,
                "instance_id": format!("{}-{}-{}", entry.id, entry.section, index + 1),
            }));
        }
    }
    json!({
        "main_deck": main_deck,
        "rune_deck": rune_deck,
        "hand": [],
        "battlefield": [],
        "discard": [],
        "removed": [],
        "revealed": [],
    })
}

struct DeckEntry {
    id: String,
    quantity: usize,
    section: String,
}

fn deck_entries(deck_json: &Value) -> Vec<DeckEntry> {
    if let Some(entries) = deck_json.get("entries").and_then(Value::as_array) {
        return entries.iter().filter_map(deck_entry_from_value).collect();
    }
    ["legends", "main", "runes", "battlefields"]
        .iter()
        .flat_map(|section| {
            deck_json
                .get(section)
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(move |entry| deck_entry_from_section(entry, section))
        })
        .collect()
}

fn deck_entry_from_value(value: &Value) -> Option<DeckEntry> {
    let id = value.get("id")?.as_str()?.trim();
    if id.is_empty() {
        return None;
    }
    let quantity = value.get("quantity").and_then(Value::as_u64).unwrap_or(0) as usize;
    if quantity == 0 {
        return None;
    }
    Some(DeckEntry {
        id: id.to_string(),
        quantity,
        section: value
            .get("section")
            .and_then(Value::as_str)
            .unwrap_or("main")
            .to_string(),
    })
}

fn deck_entry_from_section(value: &Value, section: &str) -> Option<DeckEntry> {
    let mut entry = deck_entry_from_value(value)?;
    entry.section = section.to_string();
    Some(entry)
}

fn validate_playground_event(table: &Value, user: &SessionUser, event_type: &str) -> Result<()> {
    if event_type == "game.start" {
        if playground_host_user_id(table) != Some(user.id.as_str()) {
            anyhow::bail!("Table host required");
        }
        if playground_seat_len(table) < 2 {
            anyhow::bail!("Table needs two players");
        }
        if table.get("status").and_then(Value::as_str) == Some("completed") {
            anyhow::bail!("Table is completed");
        }
        return Ok(());
    }
    if active_playground_event_type(event_type)
        && table.get("status").and_then(Value::as_str) != Some("active")
    {
        anyhow::bail!("Game has not started");
    }
    Ok(())
}

fn playground_host_user_id(table: &Value) -> Option<&str> {
    table
        .get("seats")?
        .as_array()?
        .first()?
        .get("user_id")?
        .as_str()
}

fn playground_seat_len(table: &Value) -> usize {
    table
        .get("seats")
        .and_then(Value::as_array)
        .map(Vec::len)
        .unwrap_or(0)
}

fn active_playground_event_type(value: &str) -> bool {
    matches!(
        value,
        "card.move"
            | "card.reveal"
            | "card.flip"
            | "turn.pass"
            | "result.propose"
            | "player.concede"
    )
}

fn apply_playground_event(table: &mut Value, event: &Value) {
    let event_type = event["type"].as_str().unwrap_or_default();
    if event_type == "game.start" {
        table["status"] = json!("active");
        if table.get("started_at").is_none_or(Value::is_null) {
            table["started_at"] = event["created_at"].clone();
        }
        if let Some(first_player) = event["payload"]
            .get("first_player_id")
            .and_then(Value::as_str)
        {
            table["turn_player_id"] = json!(first_player);
        }
    }
    if event_type == "card.move" {
        apply_card_move(table, &event["payload"]);
    }
    if event_type == "card.reveal" {
        apply_card_reveal(table, &event["payload"]);
    }
    if event_type == "card.flip" {
        apply_card_flip(table, &event["payload"]);
    }
    if event_type == "turn.pass" {
        if let Some(to_user_id) = event["payload"].get("to_user_id").and_then(Value::as_str) {
            table["turn_player_id"] = json!(to_user_id);
        }
    }
    if event_type == "chat.message" {
        let text = event["payload"]
            .get("text")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .chars()
            .take(240)
            .collect::<String>();
        push_array_value(
            table,
            "chat",
            json!({
                "sequence": event["sequence"],
                "user_id": event["actor_id"],
                "text": text,
                "created_at": event["created_at"],
            }),
        );
    }
    if event_type == "voice.presence" {
        let actor = event["actor_id"].as_str().unwrap_or_default().to_string();
        if !table.get("voice").is_some_and(Value::is_object) {
            table["voice"] = json!({});
        }
        if let Some(voice) = table.get_mut("voice").and_then(Value::as_object_mut) {
            voice.insert(
                actor,
                json!({
                    "muted": event["payload"].get("muted").and_then(Value::as_bool).unwrap_or(false),
                    "talking": event["payload"].get("talking").and_then(Value::as_bool).unwrap_or(false),
                    "updated_at": event["created_at"],
                }),
            );
        }
    }
    if event_type == "result.propose" {
        apply_result_proposal(table, event);
    }
    push_array_value(table, "events", event.clone());
}

fn apply_card_move(table: &mut Value, payload: &Value) {
    let seat_index = payload
        .get("seat_index")
        .and_then(Value::as_u64)
        .unwrap_or(0) as usize;
    let from = zone_name(
        payload
            .get("from")
            .and_then(Value::as_str)
            .unwrap_or_default(),
    );
    let to = zone_name(
        payload
            .get("to")
            .and_then(Value::as_str)
            .unwrap_or_default(),
    );
    if from.is_empty() || to.is_empty() {
        return;
    }
    let count = payload
        .get("count")
        .and_then(Value::as_u64)
        .unwrap_or(1)
        .max(1) as usize;
    let Some(seat) = table
        .get_mut("seats")
        .and_then(Value::as_array_mut)
        .and_then(|seats| seats.get_mut(seat_index))
    else {
        return;
    };
    let Some(zones) = seat.get_mut("zones").and_then(Value::as_object_mut) else {
        return;
    };
    let moved = {
        let Some(from_zone) = zones.get_mut(&from).and_then(Value::as_array_mut) else {
            return;
        };
        if let Some(index) = selected_card_index(from_zone, payload) {
            vec![from_zone.remove(index)]
        } else {
            let drain_count = count.min(from_zone.len());
            from_zone.drain(0..drain_count).collect::<Vec<_>>()
        }
    };
    if let Some(to_zone) = zones.get_mut(&to).and_then(Value::as_array_mut) {
        to_zone.extend(moved);
    }
}

fn apply_card_reveal(table: &mut Value, payload: &Value) {
    let seat_index = payload
        .get("seat_index")
        .and_then(Value::as_u64)
        .unwrap_or(0) as usize;
    let from = zone_name(
        payload
            .get("from")
            .and_then(Value::as_str)
            .unwrap_or("hand"),
    );
    let Some(seat) = table
        .get_mut("seats")
        .and_then(Value::as_array_mut)
        .and_then(|seats| seats.get_mut(seat_index))
    else {
        return;
    };
    let Some(zones) = seat.get_mut("zones").and_then(Value::as_object_mut) else {
        return;
    };
    let Some(from_zone) = zones.get_mut(&from).and_then(Value::as_array_mut) else {
        return;
    };
    if from_zone.is_empty() {
        return;
    }
    let index = if has_selected_card(payload) {
        selected_card_index(from_zone, payload)
    } else {
        Some(0)
    };
    let Some(index) = index else {
        return;
    };
    let mut card = from_zone.remove(index);
    if let Some(card_object) = card.as_object_mut() {
        card_object.insert("revealed_by".to_string(), payload["revealed_by"].clone());
    }
    if let Some(revealed) = zones.get_mut("revealed").and_then(Value::as_array_mut) {
        revealed.push(card);
    }
}

fn apply_card_flip(table: &mut Value, payload: &Value) {
    let seat_index = payload
        .get("seat_index")
        .and_then(Value::as_u64)
        .unwrap_or(0) as usize;
    let zone = zone_name(
        payload
            .get("zone")
            .and_then(Value::as_str)
            .unwrap_or("battlefield"),
    );
    let Some(zone_cards) = table
        .get_mut("seats")
        .and_then(Value::as_array_mut)
        .and_then(|seats| seats.get_mut(seat_index))
        .and_then(|seat| seat.get_mut("zones"))
        .and_then(Value::as_object_mut)
        .and_then(|zones| zones.get_mut(&zone))
        .and_then(Value::as_array_mut)
    else {
        return;
    };
    let Some(index) = selected_card_index(zone_cards, payload) else {
        return;
    };
    let current_face_up = zone_cards[index]
        .get("face_up")
        .and_then(Value::as_bool)
        .unwrap_or(true);
    let next_face_up = payload
        .get("face_up")
        .and_then(Value::as_bool)
        .unwrap_or(!current_face_up);
    if let Some(card) = zone_cards[index].as_object_mut() {
        card.insert("face_up".to_string(), json!(next_face_up));
    }
}

fn selected_card_index(cards: &[Value], payload: &Value) -> Option<usize> {
    if let Some(instance_id) = payload.get("instance_id").and_then(Value::as_str) {
        return cards
            .iter()
            .position(|card| card["instance_id"] == instance_id);
    }
    if let Some(card_id) = payload.get("card_id").and_then(Value::as_str) {
        return cards.iter().position(|card| card["id"] == card_id);
    }
    None
}

fn has_selected_card(payload: &Value) -> bool {
    payload.get("instance_id").is_some() || payload.get("card_id").is_some()
}

fn apply_result_proposal(table: &mut Value, event: &Value) {
    let result = event["payload"]
        .get("result")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    if result.is_empty() {
        return;
    }
    if !table.get("result").is_some_and(Value::is_object) {
        table["result"] = json!({ "proposals": {}, "final": "" });
    }
    let actor = event["actor_id"].as_str().unwrap_or_default().to_string();
    let seat_count = table
        .get("seats")
        .and_then(Value::as_array)
        .map(Vec::len)
        .unwrap_or(0);
    if let Some(proposals) = table
        .get_mut("result")
        .and_then(|value| value.get_mut("proposals"))
        .and_then(Value::as_object_mut)
    {
        proposals.insert(actor, json!(result));
        let proposed = proposals
            .values()
            .filter_map(Value::as_str)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .collect::<Vec<_>>();
        let final_result = (seat_count >= 2
            && proposed.len() >= 2
            && proposed.iter().all(|value| value == &proposed[0]))
        .then(|| proposed[0].clone());
        if let Some(final_result) = final_result {
            table["status"] = json!("completed");
            table["completed_at"] = event["created_at"].clone();
            table["result"]["final"] = json!(final_result);
        }
    }
}

fn push_array_value(root: &mut Value, key: &str, value: Value) {
    if !root.get(key).is_some_and(Value::is_array) {
        root[key] = json!([]);
    }
    root[key].as_array_mut().expect("array").push(value);
}

fn valid_playground_event_type(value: &str) -> bool {
    matches!(
        value,
        "game.start"
            | "card.move"
            | "card.reveal"
            | "card.flip"
            | "turn.pass"
            | "chat.message"
            | "voice.presence"
            | "result.propose"
            | "player.concede"
    )
}

fn contains_forbidden_snapshot_keys(value: &Value) -> bool {
    value.as_object().is_some_and(|object| {
        object.keys().any(|key| {
            matches!(
                key.as_str(),
                "active_snapshot_json" | "snapshot" | "seats" | "events" | "zones"
            )
        })
    })
}

fn zone_name(value: &str) -> String {
    value.replace('-', "_").to_lowercase()
}

fn safe_json(value: &str, fallback: Value) -> Value {
    serde_json::from_str(value).unwrap_or(fallback)
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

fn not_found(message: &str) -> Response {
    (StatusCode::NOT_FOUND, Json(json!({ "error": message }))).into_response()
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
