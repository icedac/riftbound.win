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
