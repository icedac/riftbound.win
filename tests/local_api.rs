use axum::body::Body;
use axum::http::{Method, Request, StatusCode, header};
use riftbound_sim::local_api::{LocalApiOptions, build_local_api_router};
use serde_json::Value;
use tempfile::TempDir;
use tower::ServiceExt;

fn test_router() -> (axum::Router, TempDir) {
    let temp = TempDir::new().expect("tempdir");
    let db_path = temp.path().join("riftbound.sqlite");
    let public_dir = temp.path().join("public");
    std::fs::create_dir_all(&public_dir).expect("public dir");
    let router = build_local_api_router(LocalApiOptions {
        db_path,
        public_dir,
    })
    .expect("router");
    (router, temp)
}

async fn request(
    app: &axum::Router,
    method: Method,
    uri: &str,
    cookie: Option<&str>,
    content_type: Option<&str>,
    body: impl Into<Body>,
) -> axum::response::Response {
    let mut builder = Request::builder().method(method).uri(uri);
    if let Some(cookie) = cookie {
        builder = builder.header(header::COOKIE, cookie);
    }
    if let Some(content_type) = content_type {
        builder = builder.header(header::CONTENT_TYPE, content_type);
    }
    app.clone()
        .oneshot(builder.body(body.into()).expect("request"))
        .await
        .expect("response")
}

async fn json(response: axum::response::Response) -> Value {
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("body bytes");
    serde_json::from_slice(&bytes).expect("json")
}

async fn text(response: axum::response::Response) -> String {
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("body bytes");
    String::from_utf8(bytes.to_vec()).expect("utf8 body")
}

fn session_cookie(response: &axum::response::Response) -> String {
    response
        .headers()
        .get(header::SET_COOKIE)
        .expect("set-cookie")
        .to_str()
        .expect("cookie text")
        .split(';')
        .next()
        .expect("cookie pair")
        .to_string()
}

#[tokio::test]
async fn local_api_reports_configured_signed_out_state() {
    let (app, _temp) = test_router();

    let response = request(&app, Method::GET, "/api/me", None, None, Body::empty()).await;

    assert_eq!(response.status(), StatusCode::OK);
    let body = json(response).await;
    assert_eq!(body["configured"], true);
    assert_eq!(body["user"], Value::Null);
    assert_eq!(body["providers"].as_array().unwrap().len(), 0);
    assert_eq!(body["media"]["store"], "local-files");
    assert_eq!(body["media"]["max_upload_bytes"], 25 * 1024 * 1024);
    assert_eq!(body["media"]["max_avatar_bytes"], 2 * 1024 * 1024);
    assert_eq!(body["media"]["max_files_per_post"], 6);
}

#[tokio::test]
async fn local_api_recreates_schema_if_database_file_is_replaced() {
    let (app, temp) = test_router();
    std::fs::remove_file(temp.path().join("riftbound.sqlite")).expect("remove db");

    let response = request(
        &app,
        Method::GET,
        "/api/auth/google/start",
        None,
        None,
        Body::empty(),
    )
    .await;

    assert_eq!(response.status(), StatusCode::SEE_OTHER);
}

#[tokio::test]
async fn local_playground_table_deep_link_serves_playground_entrypoint() {
    let (app, temp) = test_router();
    let page_dir = temp.path().join("public").join("playground");
    std::fs::create_dir_all(&page_dir).expect("playground dir");
    std::fs::write(
        page_dir.join("index.html"),
        "<title>Riftbound.kr Playground</title>",
    )
    .expect("playground html");

    let response = request(
        &app,
        Method::GET,
        "/playground/tables/table-123",
        None,
        None,
        Body::empty(),
    )
    .await;

    assert_eq!(response.status(), StatusCode::OK);
    assert!(text(response).await.contains("Riftbound.kr Playground"));
}

#[tokio::test]
async fn local_dev_auth_links_google_and_naver_to_same_profile() {
    let (app, _temp) = test_router();

    let google = request(
        &app,
        Method::GET,
        "/api/auth/google/start",
        None,
        None,
        Body::empty(),
    )
    .await;
    assert_eq!(google.status(), StatusCode::SEE_OTHER);
    let cookie = session_cookie(&google);

    let naver = request(
        &app,
        Method::GET,
        "/api/auth/naver/start",
        Some(&cookie),
        None,
        Body::empty(),
    )
    .await;
    assert_eq!(naver.status(), StatusCode::SEE_OTHER);

    let body = json(
        request(
            &app,
            Method::GET,
            "/api/me",
            Some(&cookie),
            None,
            Body::empty(),
        )
        .await,
    )
    .await;
    assert_eq!(body["configured"], true);
    let providers = body["providers"]
        .as_array()
        .expect("providers")
        .iter()
        .map(|item| item["provider"].as_str().unwrap())
        .collect::<Vec<_>>();
    assert_eq!(providers, vec!["google", "naver"]);
}

#[tokio::test]
async fn local_profile_update_persists_for_current_session() {
    let (app, _temp) = test_router();
    let login = request(
        &app,
        Method::GET,
        "/api/auth/google/start",
        None,
        None,
        Body::empty(),
    )
    .await;
    let cookie = session_cookie(&login);

    let response = request(
        &app,
        Method::PUT,
        "/api/profile",
        Some(&cookie),
        Some("application/json"),
        Body::from(r#"{"display_name":"Arc Pilot","bio":"Testing decks."}"#),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);

    let body = json(
        request(
            &app,
            Method::GET,
            "/api/me",
            Some(&cookie),
            None,
            Body::empty(),
        )
        .await,
    )
    .await;
    assert_eq!(body["user"]["display_name"], "Arc Pilot");
    assert_eq!(body["user"]["bio"], "Testing decks.");
}

#[tokio::test]
async fn local_avatar_upload_stores_file_and_updates_profile_url() {
    let (app, temp) = test_router();
    let login = request(
        &app,
        Method::GET,
        "/api/auth/google/start",
        None,
        None,
        Body::empty(),
    )
    .await;
    let cookie = session_cookie(&login);
    let boundary = "riftbound-avatar-boundary";
    let body = format!(
        "--{boundary}\r\nContent-Disposition: form-data; name=\"avatar\"; filename=\"avatar.webp\"\r\nContent-Type: image/webp\r\n\r\navatar-bytes\r\n\
         --{boundary}--\r\n"
    );

    let response = request(
        &app,
        Method::POST,
        "/api/profile/avatar",
        Some(&cookie),
        Some(&format!("multipart/form-data; boundary={boundary}")),
        Body::from(body),
    )
    .await;

    assert_eq!(response.status(), StatusCode::OK);
    let uploaded = json(response).await;
    let avatar_url = uploaded["avatar_url"].as_str().expect("avatar url");
    assert!(avatar_url.starts_with("/user-media/avatars/"));
    assert!(
        temp.path()
            .join("public")
            .join(avatar_url.trim_start_matches('/'))
            .exists()
    );

    let body = json(
        request(
            &app,
            Method::GET,
            "/api/me",
            Some(&cookie),
            None,
            Body::empty(),
        )
        .await,
    )
    .await;
    assert_eq!(body["user"]["avatar_url"], avatar_url);
}

#[tokio::test]
async fn local_community_post_upload_stores_media_and_returns_display_url() {
    let (app, temp) = test_router();
    let boundary = "riftbound-test-boundary";
    let body = format!(
        "--{boundary}\r\nContent-Disposition: form-data; name=\"board\"\r\n\r\nfree\r\n\
         --{boundary}\r\nContent-Disposition: form-data; name=\"title\"\r\n\r\nFoil pull\r\n\
         --{boundary}\r\nContent-Disposition: form-data; name=\"body\"\r\n\r\nLook at this.\r\n\
         --{boundary}\r\nContent-Disposition: form-data; name=\"media\"; filename=\"pull.png\"\r\nContent-Type: image/png\r\n\r\npng-bytes\r\n\
         --{boundary}--\r\n"
    );

    let response = request(
        &app,
        Method::POST,
        "/api/posts",
        None,
        Some(&format!("multipart/form-data; boundary={boundary}")),
        Body::from(body),
    )
    .await;
    assert_eq!(response.status(), StatusCode::CREATED);

    let posts = json(
        request(
            &app,
            Method::GET,
            "/api/posts?board=free",
            None,
            None,
            Body::empty(),
        )
        .await,
    )
    .await;
    let first = &posts["posts"].as_array().unwrap()[0];
    assert_eq!(first["title"], "Foil pull");
    assert_eq!(first["media"][0]["media_type"], "image");
    let url = first["media"][0]["url"].as_str().expect("media url");
    assert!(url.starts_with("/user-media/community/"));
    let saved = temp.path().join("public").join(url.trim_start_matches('/'));
    assert!(
        saved.exists(),
        "uploaded media should be written under public"
    );
}

#[tokio::test]
async fn local_saved_deck_roundtrip_requires_current_user() {
    let (app, _temp) = test_router();
    let login = request(
        &app,
        Method::GET,
        "/api/auth/google/start",
        None,
        None,
        Body::empty(),
    )
    .await;
    let cookie = session_cookie(&login);
    let payload = r#"{
      "name": "Ahri Tempo",
      "format": "constructed",
      "deck_json": {
        "main": [{"id": "OGN-066", "quantity": 3}],
        "runes": [{"id": "OGN-R01", "quantity": 12}]
      }
    }"#;

    let unauthorized = request(
        &app,
        Method::POST,
        "/api/saved-decks",
        None,
        Some("application/json"),
        Body::from(payload),
    )
    .await;
    assert_eq!(unauthorized.status(), StatusCode::UNAUTHORIZED);

    let create = request(
        &app,
        Method::POST,
        "/api/saved-decks",
        Some(&cookie),
        Some("application/json"),
        Body::from(payload),
    )
    .await;
    assert_eq!(create.status(), StatusCode::CREATED);
    let created = json(create).await;
    assert_eq!(created["deck"]["name"], "Ahri Tempo");
    assert_eq!(created["deck"]["format"], "constructed");
    assert_eq!(created["deck"]["deck_json"]["main"][0]["id"], "OGN-066");

    let list = json(
        request(
            &app,
            Method::GET,
            "/api/saved-decks",
            Some(&cookie),
            None,
            Body::empty(),
        )
        .await,
    )
    .await;
    assert_eq!(list["decks"].as_array().unwrap().len(), 1);
    assert_eq!(list["decks"][0], created["deck"]);
}

async fn login(app: &axum::Router, provider: &str) -> String {
    let response = request(
        app,
        Method::GET,
        &format!("/api/auth/{provider}/start"),
        None,
        None,
        Body::empty(),
    )
    .await;
    assert_eq!(response.status(), StatusCode::SEE_OTHER);
    session_cookie(&response)
}

async fn create_test_deck(app: &axum::Router, cookie: &str, name: &str) -> Value {
    create_test_deck_with_runes(app, cookie, name, 2).await
}

async fn create_test_deck_with_runes(
    app: &axum::Router,
    cookie: &str,
    name: &str,
    rune_quantity: usize,
) -> Value {
    let payload = format!(
        r#"{{
          "name": "{name}",
          "format": "constructed",
          "deck_json": {{
            "legends": [{{"id": "UNL-236-STAR", "quantity": 1}}],
            "main": [{{"id": "OGN-001", "quantity": 5}}],
            "runes": [{{"id": "OGN-R01", "quantity": {rune_quantity}}}],
            "battlefields": [{{"id": "UNL-205", "quantity": 1}}, {{"id": "UNL-206", "quantity": 1}}, {{"id": "OGN-275", "quantity": 1}}]
          }}
        }}"#
    );
    let response = request(
        app,
        Method::POST,
        "/api/saved-decks",
        Some(cookie),
        Some("application/json"),
        Body::from(payload),
    )
    .await;
    assert_eq!(response.status(), StatusCode::CREATED);
    json(response).await["deck"].clone()
}

async fn create_battlefield_test_deck(app: &axum::Router, cookie: &str, name: &str) -> Value {
    let payload = format!(
        r#"{{
          "name": "{name}",
          "format": "constructed",
          "deck_json": {{
            "legends": [{{"id": "UNL-236-STAR", "quantity": 1}}],
            "main": [{{"id": "OGN-001", "quantity": 5}}],
            "runes": [{{"id": "OGN-R01", "quantity": 4}}],
            "battlefields": [{{"id": "BF-001", "quantity": 1}}]
          }}
        }}"#
    );
    let response = request(
        app,
        Method::POST,
        "/api/saved-decks",
        Some(cookie),
        Some("application/json"),
        Body::from(payload),
    )
    .await;
    assert_eq!(response.status(), StatusCode::CREATED);
    json(response).await["deck"].clone()
}

#[tokio::test]
async fn local_playground_table_lifecycle_persists_snapshots_and_events() {
    let (app, _temp) = test_router();
    let host_cookie = login(&app, "google").await;
    let guest_cookie = login(&app, "naver").await;
    let host_deck = create_test_deck(&app, &host_cookie, "Host Deck").await;
    let guest_deck = create_test_deck(&app, &guest_cookie, "Guest Deck").await;

    let unauthorized = request(
        &app,
        Method::POST,
        "/api/playground/tables",
        None,
        Some("application/json"),
        Body::from(format!(
            r#"{{"deck_id":"{}"}}"#,
            host_deck["id"].as_str().unwrap()
        )),
    )
    .await;
    assert_eq!(unauthorized.status(), StatusCode::UNAUTHORIZED);

    let create = request(
        &app,
        Method::POST,
        "/api/playground/tables",
        Some(&host_cookie),
        Some("application/json"),
        Body::from(format!(
            r#"{{"deck_id":"{}"}}"#,
            host_deck["id"].as_str().unwrap()
        )),
    )
    .await;
    assert_eq!(create.status(), StatusCode::CREATED);
    let created = json(create).await;
    let table_id = created["table"]["id"].as_str().expect("table id");
    assert_eq!(created["table"]["status"], "waiting");
    assert_eq!(created["table"]["victory_score"], 8);
    assert_eq!(created["table"]["seats"].as_array().unwrap().len(), 1);
    assert_eq!(
        created["table"]["seats"][0]["deck_snapshot"]["main"][0]["id"],
        "OGN-001"
    );
    assert_eq!(
        created["table"]["seats"][0]["zones"]["main_deck"]
            .as_array()
            .unwrap()
            .len(),
        5
    );
    assert_eq!(
        created["table"]["seats"][0]["zones"]["legend_zone"][0]["id"],
        "UNL-236-STAR"
    );
    assert_eq!(
        created["table"]["seats"][0]["zones"]["battlefields"]
            .as_array()
            .unwrap()
            .len(),
        3
    );
    assert_eq!(
        created["table"]["seats"][0]["zones"]["base"]
            .as_array()
            .unwrap()
            .len(),
        0
    );
    assert_eq!(
        created["table"]["seats"][0]["zones"]["rune_pool"]
            .as_array()
            .unwrap()
            .len(),
        0
    );
    assert_eq!(created["table"]["seats"][0]["points"], 0);

    let lobby = json(
        request(
            &app,
            Method::GET,
            "/api/playground/tables",
            Some(&host_cookie),
            None,
            Body::empty(),
        )
        .await,
    )
    .await;
    assert_eq!(lobby["tables"].as_array().unwrap().len(), 1);
    assert_eq!(lobby["tables"][0]["id"], table_id);
    assert_eq!(lobby["tables"][0]["status"], "waiting");

    let join = request(
        &app,
        Method::POST,
        &format!("/api/playground/tables/{table_id}/join"),
        Some(&guest_cookie),
        Some("application/json"),
        Body::from(format!(
            r#"{{"deck_id":"{}"}}"#,
            guest_deck["id"].as_str().unwrap()
        )),
    )
    .await;
    assert_eq!(join.status(), StatusCode::OK);
    let joined = json(join).await;
    assert_eq!(joined["table"]["status"], "waiting");
    assert_eq!(joined["table"]["seats"].as_array().unwrap().len(), 2);

    let guest_start = request(
        &app,
        Method::POST,
        &format!("/api/playground/tables/{table_id}/events"),
        Some(&guest_cookie),
        Some("application/json"),
        Body::from(r#"{"type":"game.start","payload":{}}"#),
    )
    .await;
    assert_eq!(guest_start.status(), StatusCode::FORBIDDEN);

    let start = request(
        &app,
        Method::POST,
        &format!("/api/playground/tables/{table_id}/events"),
        Some(&host_cookie),
        Some("application/json"),
        Body::from(r#"{"type":"game.start","payload":{}}"#),
    )
    .await;
    assert_eq!(start.status(), StatusCode::CREATED);
    let started = json(start).await;
    assert_eq!(started["event"]["sequence"], 1);
    assert_eq!(started["table"]["status"], "active");
    assert_eq!(
        started["table"]["seats"][0]["zones"]["hand"]
            .as_array()
            .unwrap()
            .len(),
        4
    );
    assert_eq!(
        started["table"]["seats"][1]["zones"]["hand"]
            .as_array()
            .unwrap()
            .len(),
        4
    );
    assert_eq!(
        started["table"]["seats"][0]["zones"]["hand"][0]["id"],
        "OGN-001"
    );
    assert_eq!(
        started["table"]["seats"][1]["zones"]["hand"][0]["id"],
        "__hidden__"
    );
    assert_eq!(
        started["table"]["seats"][1]["zones"]["hand"][0]["hidden"],
        true
    );
    assert_eq!(
        started["table"]["seats"][0]["zones"]["main_deck"][0]["id"],
        "__hidden__"
    );
    assert_eq!(
        started["table"]["seats"][0]["zones"]["main_deck"]
            .as_array()
            .unwrap()
            .len(),
        1
    );

    let guest_view = json(
        request(
            &app,
            Method::GET,
            &format!("/api/playground/tables/{table_id}"),
            Some(&guest_cookie),
            None,
            Body::empty(),
        )
        .await,
    )
    .await;
    assert_eq!(
        guest_view["table"]["seats"][0]["zones"]["hand"][0]["id"],
        "__hidden__"
    );
    assert_eq!(
        guest_view["table"]["seats"][1]["zones"]["hand"][0]["id"],
        "OGN-001"
    );

    let guest_out_of_turn_move = request(
        &app,
        Method::POST,
        &format!("/api/playground/tables/{table_id}/events"),
        Some(&guest_cookie),
        Some("application/json"),
        Body::from(r#"{"type":"card.move","payload":{"seat_index":1,"from":"hand","to":"battlefield","count":1}}"#),
    )
    .await;
    assert_eq!(guest_out_of_turn_move.status(), StatusCode::FORBIDDEN);

    let opponent_hand_move = request(
        &app,
        Method::POST,
        &format!("/api/playground/tables/{table_id}/events"),
        Some(&host_cookie),
        Some("application/json"),
        Body::from(r#"{"type":"card.move","payload":{"seat_index":1,"from":"hand","to":"battlefield","count":1}}"#),
    )
    .await;
    assert_eq!(opponent_hand_move.status(), StatusCode::FORBIDDEN);

    let move_card = request(
        &app,
        Method::POST,
        &format!("/api/playground/tables/{table_id}/events"),
        Some(&host_cookie),
        Some("application/json"),
        Body::from(r#"{"type":"card.move","payload":{"seat_index":0,"from":"main_deck","to":"hand","count":2}}"#),
    )
    .await;
    assert_eq!(move_card.status(), StatusCode::CREATED);
    let moved = json(move_card).await;
    assert_eq!(moved["event"]["sequence"], 2);
    assert_eq!(
        moved["table"]["seats"][0]["zones"]["hand"]
            .as_array()
            .unwrap()
            .len(),
        5
    );
    assert_eq!(
        moved["table"]["seats"][0]["zones"]["main_deck"]
            .as_array()
            .unwrap()
            .len(),
        0
    );
    let selected_instance = moved["table"]["seats"][0]["zones"]["hand"][4]["instance_id"]
        .as_str()
        .expect("selected card instance")
        .to_string();

    let move_selected = request(
        &app,
        Method::POST,
        &format!("/api/playground/tables/{table_id}/events"),
        Some(&host_cookie),
        Some("application/json"),
        Body::from(format!(
            r#"{{"type":"card.move","payload":{{"seat_index":0,"from":"hand","to":"battlefield","instance_id":"{selected_instance}"}}}}"#
        )),
    )
    .await;
    assert_eq!(move_selected.status(), StatusCode::CREATED);
    let selected_moved = json(move_selected).await;
    assert_eq!(selected_moved["event"]["sequence"], 3);
    assert_eq!(
        selected_moved["table"]["seats"][0]["zones"]["battlefield"][0]["instance_id"],
        selected_instance
    );
    assert_eq!(
        selected_moved["table"]["seats"][0]["zones"]["hand"]
            .as_array()
            .unwrap()
            .len(),
        4
    );

    let flip_selected = request(
        &app,
        Method::POST,
        &format!("/api/playground/tables/{table_id}/events"),
        Some(&host_cookie),
        Some("application/json"),
        Body::from(format!(
            r#"{{"type":"card.flip","payload":{{"seat_index":0,"zone":"battlefield","instance_id":"{selected_instance}","face_up":false}}}}"#
        )),
    )
    .await;
    assert_eq!(flip_selected.status(), StatusCode::CREATED);
    let flipped = json(flip_selected).await;
    assert_eq!(flipped["event"]["sequence"], 4);
    assert_eq!(
        flipped["table"]["seats"][0]["zones"]["battlefield"][0]["face_up"],
        false
    );

    let pass_turn = request(
        &app,
        Method::POST,
        &format!("/api/playground/tables/{table_id}/events"),
        Some(&host_cookie),
        Some("application/json"),
        Body::from(r#"{"type":"turn.pass","payload":{}}"#),
    )
    .await;
    assert_eq!(pass_turn.status(), StatusCode::CREATED);
    let passed = json(pass_turn).await;
    assert_eq!(passed["event"]["sequence"], 5);
    let guest_user_id = passed["table"]["seats"][1]["user_id"]
        .as_str()
        .expect("guest user id");
    assert_eq!(passed["table"]["turn_player_id"], guest_user_id);
    assert_eq!(
        passed["table"]["seats"][1]["zones"]["hand"]
            .as_array()
            .unwrap()
            .len(),
        5
    );
    assert_eq!(
        passed["table"]["seats"][1]["zones"]["rune_pool"]
            .as_array()
            .unwrap()
            .len(),
        2
    );

    let forged_snapshot = request(
        &app,
        Method::POST,
        &format!("/api/playground/tables/{table_id}/events"),
        Some(&host_cookie),
        Some("application/json"),
        Body::from(r#"{"type":"card.move","payload":{"active_snapshot_json":{}}}"#),
    )
    .await;
    assert_eq!(forged_snapshot.status(), StatusCode::BAD_REQUEST);

    let score_point = request(
        &app,
        Method::POST,
        &format!("/api/playground/tables/{table_id}/events"),
        Some(&guest_cookie),
        Some("application/json"),
        Body::from(r#"{"type":"score.point","payload":{"amount":8,"source":"hold"}}"#),
    )
    .await;
    assert_eq!(score_point.status(), StatusCode::CREATED);
    let scored = json(score_point).await;
    assert_eq!(scored["event"]["sequence"], 6);
    assert_eq!(scored["table"]["seats"][1]["points"], 8);
    assert_eq!(scored["table"]["status"], "completed");
    assert_eq!(scored["table"]["result"]["final"], "guest-win");
    assert_eq!(scored["table"]["result"]["winner_user_id"], guest_user_id);

    let events = json(
        request(
            &app,
            Method::GET,
            &format!("/api/playground/tables/{table_id}/events?after=0"),
            Some(&guest_cookie),
            None,
            Body::empty(),
        )
        .await,
    )
    .await;
    assert_eq!(events["events"].as_array().unwrap().len(), 6);
    assert_eq!(events["events"][1]["type"], "card.move");
    assert_eq!(events["events"][3]["type"], "card.flip");
    assert_eq!(events["events"][4]["type"], "turn.pass");
    assert_eq!(events["events"][5]["type"], "score.point");

    let table = json(
        request(
            &app,
            Method::GET,
            &format!("/api/playground/tables/{table_id}"),
            Some(&guest_cookie),
            None,
            Body::empty(),
        )
        .await,
    )
    .await;
    assert_eq!(table["table"]["events"].as_array().unwrap().len(), 6);
    assert_eq!(
        table["table"]["seats"][0]["zones"]["hand"]
            .as_array()
            .unwrap()
            .len(),
        4
    );
    assert_eq!(
        table["table"]["seats"][0]["zones"]["battlefield"][0]["id"],
        "__hidden__"
    );
    assert_eq!(
        table["table"]["seats"][0]["zones"]["battlefield"][0]["hidden"],
        true
    );
    assert_eq!(
        table["table"]["seats"][0]["zones"]["battlefield"][0]["face_up"],
        false
    );
}

#[tokio::test]
async fn local_playground_turn_start_readies_channeled_runes() {
    let (app, _temp) = test_router();
    let host_cookie = login(&app, "google").await;
    let guest_cookie = login(&app, "naver").await;
    let host_deck = create_test_deck_with_runes(&app, &host_cookie, "Host Rune Deck", 4).await;
    let guest_deck = create_test_deck_with_runes(&app, &guest_cookie, "Guest Rune Deck", 4).await;

    let create = request(
        &app,
        Method::POST,
        "/api/playground/tables",
        Some(&host_cookie),
        Some("application/json"),
        Body::from(format!(
            r#"{{"deck_id":"{}"}}"#,
            host_deck["id"].as_str().unwrap()
        )),
    )
    .await;
    assert_eq!(create.status(), StatusCode::CREATED);
    let created = json(create).await;
    let table_id = created["table"]["id"].as_str().unwrap();
    let host_user_id = created["table"]["seats"][0]["user_id"]
        .as_str()
        .unwrap()
        .to_string();

    let join = request(
        &app,
        Method::POST,
        &format!("/api/playground/tables/{table_id}/join"),
        Some(&guest_cookie),
        Some("application/json"),
        Body::from(format!(
            r#"{{"deck_id":"{}"}}"#,
            guest_deck["id"].as_str().unwrap()
        )),
    )
    .await;
    assert_eq!(join.status(), StatusCode::OK);

    let start = request(
        &app,
        Method::POST,
        &format!("/api/playground/tables/{table_id}/events"),
        Some(&host_cookie),
        Some("application/json"),
        Body::from(r#"{"type":"game.start","payload":{}}"#),
    )
    .await;
    assert_eq!(start.status(), StatusCode::CREATED);

    let channel_host = request(
        &app,
        Method::POST,
        &format!("/api/playground/tables/{table_id}/events"),
        Some(&host_cookie),
        Some("application/json"),
        Body::from(
            r#"{"type":"card.move","payload":{"seat_index":0,"from":"rune_deck","to":"rune_pool","count":2}}"#,
        ),
    )
    .await;
    assert_eq!(channel_host.status(), StatusCode::CREATED);
    let channeled = json(channel_host).await;
    assert_eq!(
        channeled["table"]["seats"][0]["zones"]["rune_pool"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
    assert_eq!(
        channeled["table"]["seats"][0]["zones"]["rune_deck"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
    let selected_rune = channeled["table"]["seats"][0]["zones"]["rune_pool"][0]["instance_id"]
        .as_str()
        .unwrap()
        .to_string();

    let exhaust_rune = request(
        &app,
        Method::POST,
        &format!("/api/playground/tables/{table_id}/events"),
        Some(&host_cookie),
        Some("application/json"),
        Body::from(format!(
            r#"{{"type":"card.exhaust","payload":{{"seat_index":0,"zone":"rune_pool","instance_id":"{selected_rune}","exhausted":true}}}}"#
        )),
    )
    .await;
    assert_eq!(exhaust_rune.status(), StatusCode::CREATED);
    let exhausted = json(exhaust_rune).await;
    assert_eq!(
        exhausted["table"]["seats"][0]["zones"]["rune_pool"][0]["exhausted"],
        true
    );

    let pass_to_guest = request(
        &app,
        Method::POST,
        &format!("/api/playground/tables/{table_id}/events"),
        Some(&host_cookie),
        Some("application/json"),
        Body::from(r#"{"type":"turn.pass","payload":{}}"#),
    )
    .await;
    assert_eq!(pass_to_guest.status(), StatusCode::CREATED);

    let pass_back = request(
        &app,
        Method::POST,
        &format!("/api/playground/tables/{table_id}/events"),
        Some(&guest_cookie),
        Some("application/json"),
        Body::from(r#"{"type":"turn.pass","payload":{}}"#),
    )
    .await;
    assert_eq!(pass_back.status(), StatusCode::CREATED);
    let returned = json(pass_back).await;
    assert_eq!(returned["table"]["turn_player_id"], host_user_id);
    assert_eq!(
        returned["table"]["seats"][0]["zones"]["rune_pool"]
            .as_array()
            .unwrap()
            .len(),
        4
    );
    assert_eq!(
        returned["table"]["seats"][0]["zones"]["rune_deck"]
            .as_array()
            .unwrap()
            .len(),
        0
    );
    let returned_runes = returned["table"]["seats"][0]["zones"]["rune_pool"]
        .as_array()
        .unwrap();
    let readied_rune = returned_runes
        .iter()
        .find(|card| card["instance_id"] == selected_rune)
        .unwrap();
    assert_eq!(readied_rune["exhausted"], false);
}

#[tokio::test]
async fn local_playground_card_move_supports_chain_zone() {
    let (app, _temp) = test_router();
    let host_cookie = login(&app, "google").await;
    let guest_cookie = login(&app, "naver").await;
    let host_deck = create_test_deck(&app, &host_cookie, "Host Chain Deck").await;
    let guest_deck = create_test_deck(&app, &guest_cookie, "Guest Chain Deck").await;

    let create = request(
        &app,
        Method::POST,
        "/api/playground/tables",
        Some(&host_cookie),
        Some("application/json"),
        Body::from(format!(
            r#"{{"deck_id":"{}"}}"#,
            host_deck["id"].as_str().unwrap()
        )),
    )
    .await;
    assert_eq!(create.status(), StatusCode::CREATED);
    let created = json(create).await;
    let table_id = created["table"]["id"].as_str().unwrap();
    assert!(
        created["table"]["seats"][0]["zones"]["chain"]
            .as_array()
            .unwrap()
            .is_empty()
    );

    let join = request(
        &app,
        Method::POST,
        &format!("/api/playground/tables/{table_id}/join"),
        Some(&guest_cookie),
        Some("application/json"),
        Body::from(format!(
            r#"{{"deck_id":"{}"}}"#,
            guest_deck["id"].as_str().unwrap()
        )),
    )
    .await;
    assert_eq!(join.status(), StatusCode::OK);

    let start = request(
        &app,
        Method::POST,
        &format!("/api/playground/tables/{table_id}/events"),
        Some(&host_cookie),
        Some("application/json"),
        Body::from(r#"{"type":"game.start","payload":{}}"#),
    )
    .await;
    assert_eq!(start.status(), StatusCode::CREATED);
    let started = json(start).await;
    let selected = started["table"]["seats"][0]["zones"]["hand"][0]["instance_id"]
        .as_str()
        .unwrap()
        .to_string();

    let move_to_chain = request(
        &app,
        Method::POST,
        &format!("/api/playground/tables/{table_id}/events"),
        Some(&host_cookie),
        Some("application/json"),
        Body::from(format!(
            r#"{{"type":"card.move","payload":{{"seat_index":0,"from":"hand","to":"chain","instance_id":"{selected}"}}}}"#
        )),
    )
    .await;
    assert_eq!(move_to_chain.status(), StatusCode::CREATED);
    let moved = json(move_to_chain).await;
    assert_eq!(
        moved["table"]["seats"][0]["zones"]["chain"][0]["instance_id"],
        selected
    );
    assert_eq!(
        moved["table"]["seats"][0]["zones"]["hand"]
            .as_array()
            .unwrap()
            .len(),
        3
    );
}

#[tokio::test]
async fn local_playground_shuffle_is_allowed_before_start() {
    let (app, _temp) = test_router();
    let host_cookie = login(&app, "google").await;
    let guest_cookie = login(&app, "naver").await;
    let host_deck = create_test_deck(&app, &host_cookie, "Host Shuffle Deck").await;
    let guest_deck = create_test_deck(&app, &guest_cookie, "Guest Shuffle Deck").await;

    let create = request(
        &app,
        Method::POST,
        "/api/playground/tables",
        Some(&host_cookie),
        Some("application/json"),
        Body::from(format!(
            r#"{{"deck_id":"{}"}}"#,
            host_deck["id"].as_str().unwrap()
        )),
    )
    .await;
    assert_eq!(create.status(), StatusCode::CREATED);
    let created = json(create).await;
    let table_id = created["table"]["id"].as_str().unwrap();

    let join = request(
        &app,
        Method::POST,
        &format!("/api/playground/tables/{table_id}/join"),
        Some(&guest_cookie),
        Some("application/json"),
        Body::from(format!(
            r#"{{"deck_id":"{}"}}"#,
            guest_deck["id"].as_str().unwrap()
        )),
    )
    .await;
    assert_eq!(join.status(), StatusCode::OK);

    let guest_shuffle = request(
        &app,
        Method::POST,
        &format!("/api/playground/tables/{table_id}/events"),
        Some(&guest_cookie),
        Some("application/json"),
        Body::from(
            r#"{"type":"deck.shuffle","payload":{"seat_index":0,"zone":"main_deck","seed":"fixed-main-seed"}}"#,
        ),
    )
    .await;
    assert_eq!(guest_shuffle.status(), StatusCode::FORBIDDEN);

    let shuffle = request(
        &app,
        Method::POST,
        &format!("/api/playground/tables/{table_id}/events"),
        Some(&host_cookie),
        Some("application/json"),
        Body::from(
            r#"{"type":"deck.shuffle","payload":{"seat_index":0,"zone":"main_deck","seed":"fixed-main-seed"}}"#,
        ),
    )
    .await;
    assert_eq!(shuffle.status(), StatusCode::CREATED);
    let shuffled = json(shuffle).await;
    assert_eq!(shuffled["event"]["sequence"], 1);
    assert_eq!(shuffled["event"]["type"], "deck.shuffle");

    let events = json(
        request(
            &app,
            Method::GET,
            &format!("/api/playground/tables/{table_id}/events?after=0"),
            Some(&host_cookie),
            None,
            Body::empty(),
        )
        .await,
    )
    .await;
    assert_eq!(events["events"].as_array().unwrap().len(), 1);
    assert_eq!(events["events"][0]["type"], "deck.shuffle");
}

#[tokio::test]
async fn local_playground_turn_phase_events_persist_in_snapshots() {
    let (app, _temp) = test_router();
    let host_cookie = login(&app, "google").await;
    let guest_cookie = login(&app, "naver").await;
    let host_deck = create_test_deck(&app, &host_cookie, "Host Phase Deck").await;
    let guest_deck = create_test_deck(&app, &guest_cookie, "Guest Phase Deck").await;

    let create = request(
        &app,
        Method::POST,
        "/api/playground/tables",
        Some(&host_cookie),
        Some("application/json"),
        Body::from(format!(
            r#"{{"deck_id":"{}"}}"#,
            host_deck["id"].as_str().unwrap()
        )),
    )
    .await;
    assert_eq!(create.status(), StatusCode::CREATED);
    let created = json(create).await;
    let table_id = created["table"]["id"].as_str().unwrap();
    assert_eq!(created["table"]["turn_phase"], "setup");
    assert_eq!(created["table"]["turn_number"], 0);

    let join = request(
        &app,
        Method::POST,
        &format!("/api/playground/tables/{table_id}/join"),
        Some(&guest_cookie),
        Some("application/json"),
        Body::from(format!(
            r#"{{"deck_id":"{}"}}"#,
            guest_deck["id"].as_str().unwrap()
        )),
    )
    .await;
    assert_eq!(join.status(), StatusCode::OK);

    let start = request(
        &app,
        Method::POST,
        &format!("/api/playground/tables/{table_id}/events"),
        Some(&host_cookie),
        Some("application/json"),
        Body::from(r#"{"type":"game.start","payload":{}}"#),
    )
    .await;
    assert_eq!(start.status(), StatusCode::CREATED);
    let started = json(start).await;
    assert_eq!(started["table"]["turn_phase"], "main");
    assert_eq!(started["table"]["turn_number"], 1);

    let phase = request(
        &app,
        Method::POST,
        &format!("/api/playground/tables/{table_id}/events"),
        Some(&host_cookie),
        Some("application/json"),
        Body::from(r#"{"type":"turn.phase","payload":{"phase":"score"}}"#),
    )
    .await;
    assert_eq!(phase.status(), StatusCode::CREATED);
    let phased = json(phase).await;
    assert_eq!(phased["table"]["turn_phase"], "score");
    assert_eq!(
        phased["table"]["phase_updated_at"],
        phased["event"]["created_at"]
    );

    let pass = request(
        &app,
        Method::POST,
        &format!("/api/playground/tables/{table_id}/events"),
        Some(&host_cookie),
        Some("application/json"),
        Body::from(r#"{"type":"turn.pass","payload":{}}"#),
    )
    .await;
    assert_eq!(pass.status(), StatusCode::CREATED);
    let passed = json(pass).await;
    assert_eq!(passed["table"]["turn_phase"], "main");
    assert_eq!(passed["table"]["turn_number"], 2);
}

#[tokio::test]
async fn local_playground_showdown_events_track_resolved_control() {
    let (app, _temp) = test_router();
    let host_cookie = login(&app, "google").await;
    let guest_cookie = login(&app, "naver").await;
    let host_deck = create_battlefield_test_deck(&app, &host_cookie, "Host Showdown Deck").await;
    let guest_deck = create_battlefield_test_deck(&app, &guest_cookie, "Guest Showdown Deck").await;

    let create = request(
        &app,
        Method::POST,
        "/api/playground/tables",
        Some(&host_cookie),
        Some("application/json"),
        Body::from(format!(
            r#"{{"deck_id":"{}"}}"#,
            host_deck["id"].as_str().unwrap()
        )),
    )
    .await;
    assert_eq!(create.status(), StatusCode::CREATED);
    let created = json(create).await;
    let table_id = created["table"]["id"].as_str().unwrap();
    assert_eq!(created["table"]["active_showdown"], Value::Null);
    assert!(
        created["table"]["showdown_history"]
            .as_array()
            .unwrap()
            .is_empty()
    );

    let join = request(
        &app,
        Method::POST,
        &format!("/api/playground/tables/{table_id}/join"),
        Some(&guest_cookie),
        Some("application/json"),
        Body::from(format!(
            r#"{{"deck_id":"{}"}}"#,
            guest_deck["id"].as_str().unwrap()
        )),
    )
    .await;
    assert_eq!(join.status(), StatusCode::OK);

    let start = request(
        &app,
        Method::POST,
        &format!("/api/playground/tables/{table_id}/events"),
        Some(&host_cookie),
        Some("application/json"),
        Body::from(r#"{"type":"game.start","payload":{}}"#),
    )
    .await;
    assert_eq!(start.status(), StatusCode::CREATED);
    let started = json(start).await;
    let battlefield_instance =
        started["table"]["seats"][0]["zones"]["battlefields"][0]["instance_id"]
            .as_str()
            .unwrap()
            .to_string();
    let guest_user_id = started["table"]["seats"][1]["user_id"]
        .as_str()
        .unwrap()
        .to_string();

    let showdown = request(
        &app,
        Method::POST,
        &format!("/api/playground/tables/{table_id}/events"),
        Some(&host_cookie),
        Some("application/json"),
        Body::from(format!(
            r#"{{"type":"showdown.start","payload":{{"seat_index":0,"zone":"battlefields","instance_id":"{battlefield_instance}"}}}}"#
        )),
    )
    .await;
    assert_eq!(showdown.status(), StatusCode::CREATED);
    let active = json(showdown).await;
    assert_eq!(
        active["table"]["active_showdown"]["battlefield_instance_id"],
        battlefield_instance
    );

    let end = request(
        &app,
        Method::POST,
        &format!("/api/playground/tables/{table_id}/events"),
        Some(&host_cookie),
        Some("application/json"),
        Body::from(format!(
            r#"{{"type":"showdown.end","payload":{{"winner_user_id":"{guest_user_id}"}}}}"#
        )),
    )
    .await;
    assert_eq!(end.status(), StatusCode::CREATED);
    let resolved = json(end).await;
    assert_eq!(resolved["table"]["active_showdown"], Value::Null);
    assert_eq!(
        resolved["table"]["showdown_history"][0]["winner_user_id"],
        guest_user_id
    );
    assert_eq!(
        resolved["table"]["seats"][0]["zones"]["battlefields"][0]["controller_user_id"],
        guest_user_id
    );
    assert_eq!(
        resolved["table"]["seats"][0]["zones"]["battlefields"][0]["last_showdown_winner"],
        guest_user_id
    );
}

#[tokio::test]
async fn local_playground_battlefield_claim_scores_source_points() {
    let (app, _temp) = test_router();
    let host_cookie = login(&app, "google").await;
    let guest_cookie = login(&app, "naver").await;
    let host_deck = create_battlefield_test_deck(&app, &host_cookie, "Host Battlefields").await;
    let guest_deck = create_battlefield_test_deck(&app, &guest_cookie, "Guest Battlefields").await;

    let create = request(
        &app,
        Method::POST,
        "/api/playground/tables",
        Some(&host_cookie),
        Some("application/json"),
        Body::from(format!(
            r#"{{"deck_id":"{}"}}"#,
            host_deck["id"].as_str().unwrap()
        )),
    )
    .await;
    assert_eq!(create.status(), StatusCode::CREATED);
    let created = json(create).await;
    let table_id = created["table"]["id"].as_str().unwrap();

    let join = request(
        &app,
        Method::POST,
        &format!("/api/playground/tables/{table_id}/join"),
        Some(&guest_cookie),
        Some("application/json"),
        Body::from(format!(
            r#"{{"deck_id":"{}"}}"#,
            guest_deck["id"].as_str().unwrap()
        )),
    )
    .await;
    assert_eq!(join.status(), StatusCode::OK);

    let start = request(
        &app,
        Method::POST,
        &format!("/api/playground/tables/{table_id}/events"),
        Some(&host_cookie),
        Some("application/json"),
        Body::from(r#"{"type":"game.start","payload":{}}"#),
    )
    .await;
    assert_eq!(start.status(), StatusCode::CREATED);
    let started = json(start).await;
    let battlefield_instance =
        started["table"]["seats"][0]["zones"]["battlefields"][0]["instance_id"]
            .as_str()
            .unwrap()
            .to_string();

    let claim = request(
        &app,
        Method::POST,
        &format!("/api/playground/tables/{table_id}/events"),
        Some(&host_cookie),
        Some("application/json"),
        Body::from(format!(
            r#"{{"type":"battlefield.claim","payload":{{"seat_index":0,"zone":"battlefields","instance_id":"{battlefield_instance}"}}}}"#
        )),
    )
    .await;
    assert_eq!(claim.status(), StatusCode::CREATED);
    let claimed = json(claim).await;
    assert_eq!(
        claimed["table"]["seats"][0]["zones"]["battlefields"][0]["controller_user_id"],
        claimed["table"]["seats"][0]["user_id"]
    );

    let score = request(
        &app,
        Method::POST,
        &format!("/api/playground/tables/{table_id}/events"),
        Some(&host_cookie),
        Some("application/json"),
        Body::from(format!(
            r#"{{"type":"score.point","payload":{{"amount":1,"source":"battlefield","battlefield_instance_id":"{battlefield_instance}"}}}}"#
        )),
    )
    .await;
    assert_eq!(score.status(), StatusCode::CREATED);
    let scored = json(score).await;
    assert_eq!(scored["table"]["seats"][0]["points"], 1);
    assert_eq!(
        scored["table"]["seats"][0]["zones"]["battlefields"][0]["last_scored_by"],
        scored["table"]["seats"][0]["user_id"]
    );
}

#[tokio::test]
async fn local_playground_concede_completes_table_for_the_opponent() {
    let (app, _temp) = test_router();
    let host_cookie = login(&app, "google").await;
    let guest_cookie = login(&app, "naver").await;
    let host_deck = create_test_deck(&app, &host_cookie, "Host Concede Deck").await;
    let guest_deck = create_test_deck(&app, &guest_cookie, "Guest Concede Deck").await;

    let created = json(
        request(
            &app,
            Method::POST,
            "/api/playground/tables",
            Some(&host_cookie),
            Some("application/json"),
            Body::from(format!(
                r#"{{"deck_id":"{}"}}"#,
                host_deck["id"].as_str().unwrap()
            )),
        )
        .await,
    )
    .await;
    let table_id = created["table"]["id"].as_str().expect("table id");
    let host_user_id = created["table"]["seats"][0]["user_id"]
        .as_str()
        .expect("host user id")
        .to_string();

    let join = request(
        &app,
        Method::POST,
        &format!("/api/playground/tables/{table_id}/join"),
        Some(&guest_cookie),
        Some("application/json"),
        Body::from(format!(
            r#"{{"deck_id":"{}"}}"#,
            guest_deck["id"].as_str().unwrap()
        )),
    )
    .await;
    assert_eq!(join.status(), StatusCode::OK);

    let start = request(
        &app,
        Method::POST,
        &format!("/api/playground/tables/{table_id}/events"),
        Some(&host_cookie),
        Some("application/json"),
        Body::from(r#"{"type":"game.start","payload":{}}"#),
    )
    .await;
    assert_eq!(start.status(), StatusCode::CREATED);

    let concede = request(
        &app,
        Method::POST,
        &format!("/api/playground/tables/{table_id}/events"),
        Some(&guest_cookie),
        Some("application/json"),
        Body::from(r#"{"type":"player.concede","payload":{}}"#),
    )
    .await;
    assert_eq!(concede.status(), StatusCode::CREATED);
    let conceded = json(concede).await;
    assert_eq!(conceded["event"]["sequence"], 2);
    assert_eq!(conceded["table"]["status"], "completed");
    assert_eq!(conceded["table"]["result"]["final"], "host-win");
    assert_eq!(conceded["table"]["result"]["winner_user_id"], host_user_id);
}
