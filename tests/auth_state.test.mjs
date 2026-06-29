import test from "node:test";
import assert from "node:assert/strict";

import {
  authProviderActions,
  authProviderDetail,
  authProviderLabel,
  authReadinessMessage,
  runtimeSetupItems,
} from "../public/auth-state.js";

test("authProviderActions exposes only the public Naver login action", () => {
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

test("authProviderDetail explains Naver callback readiness", () => {
  const [naver] = authProviderActions({
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

  assert.equal(authProviderDetail(naver), "Ready · callback https://riftbound.kr/api/auth/naver/callback");
});

test("authProviderLabel makes unconfigured header buttons explicit", () => {
  assert.equal(authProviderLabel({ label: "Naver", enabled: true }), "Naver");
  assert.equal(authProviderLabel({ label: "Naver", enabled: false }), "Naver setup");
});

test("authReadinessMessage names only public Naver setup", () => {
  assert.equal(
    authReadinessMessage({
      auth: {
        providers: {
          google: { configured: false, missing: ["GOOGLE_CLIENT_ID"] },
          naver: { configured: false, missing: ["NAVER_CLIENT_ID"] },
        },
      },
    }),
    "Naver login setup is incomplete."
  );

  assert.equal(authReadinessMessage({ auth: { providers: {} } }), "Sign in with Naver.");
});

test("runtimeSetupItems summarizes only public Naver OAuth readiness", () => {
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
      key: "naver",
      label: "Naver login",
      status: "Ready",
      tone: "ready",
      detail: "OAuth provider configured",
      callbackUrl: "https://riftbound.win/api/auth/naver/callback",
    },
  ]);
});
