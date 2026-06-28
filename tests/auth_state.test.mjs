import test from "node:test";
import assert from "node:assert/strict";

import {
  authProviderActions,
  authProviderDetail,
  authProviderLabel,
  authReadinessMessage,
  runtimeSetupItems,
} from "../public/auth-state.js";

test("authProviderActions returns enabled login links only for configured providers", () => {
  const actions = authProviderActions({
    auth: {
      providers: {
        google: {
          configured: false,
          start_url: "/api/auth/google/start",
          callback_url: "https://riftbound.kr/api/auth/google/callback",
          missing: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
        },
        naver: {
          configured: true,
          start_url: "/api/auth/naver/start",
          missing: [],
        },
      },
    },
  });

  assert.deepEqual(actions, [
    {
      provider: "google",
      label: "Google",
      href: "/profile/?auth=google-missing",
      enabled: false,
      status: "Needs setup",
      missing: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
      callbackUrl: "https://riftbound.kr/api/auth/google/callback",
    },
    {
      provider: "naver",
      label: "Naver",
      href: "/api/auth/naver/start",
      enabled: true,
      status: "Ready",
      missing: [],
      callbackUrl: "",
    },
  ]);
});

test("authProviderDetail explains missing setup and callback URLs", () => {
  const [google, naver] = authProviderActions({
    auth: {
      providers: {
        google: {
          configured: false,
          callback_url: "https://riftbound.kr/api/auth/google/callback",
          missing: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
        },
        naver: {
          configured: true,
          callback_url: "https://riftbound.kr/api/auth/naver/callback",
          missing: [],
        },
      },
    },
  });

  assert.equal(
    authProviderDetail(google),
    "Missing GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET · callback https://riftbound.kr/api/auth/google/callback"
  );
  assert.equal(authProviderDetail(naver), "Ready · callback https://riftbound.kr/api/auth/naver/callback");
});

test("authProviderLabel makes unconfigured header buttons explicit", () => {
  assert.equal(authProviderLabel({ label: "Google", enabled: true }), "Google");
  assert.equal(authProviderLabel({ label: "Naver", enabled: false }), "Naver setup");
});

test("authReadinessMessage names missing provider setup", () => {
  assert.equal(
    authReadinessMessage({
      auth: {
        providers: {
          google: { configured: false, missing: ["GOOGLE_CLIENT_ID"] },
          naver: { configured: false, missing: ["NAVER_CLIENT_ID"] },
        },
      },
    }),
    "Google and Naver login setup is incomplete."
  );

  assert.equal(authReadinessMessage({ auth: { providers: {} } }), "Sign in with Google or Naver.");
});

test("runtimeSetupItems summarizes OAuth callbacks and media binding status", () => {
  const items = runtimeSetupItems({
    auth: {
      providers: {
        google: {
          configured: false,
          callback_url: "https://riftbound.win/api/auth/google/callback",
          missing: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
        },
        naver: {
          configured: true,
          callback_url: "https://riftbound.win/api/auth/naver/callback",
          missing: [],
        },
      },
    },
    media: {
      store: "d1-inline",
      max_upload_bytes: 1048576,
      max_avatar_bytes: 1048576,
    },
  });

  assert.deepEqual(items, [
    {
      key: "google",
      label: "Google login",
      status: "Needs setup",
      tone: "warning",
      detail: "Missing GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET",
      callbackUrl: "https://riftbound.win/api/auth/google/callback",
    },
    {
      key: "naver",
      label: "Naver login",
      status: "Ready",
      tone: "ready",
      detail: "OAuth provider configured",
      callbackUrl: "https://riftbound.win/api/auth/naver/callback",
    },
    {
      key: "media",
      label: "Media uploads",
      status: "D1 fallback",
      tone: "warning",
      detail: "R2 MEDIA binding is not connected; uploads are limited to 1 MB media and 1 MB avatars.",
      callbackUrl: "",
    },
  ]);
});
