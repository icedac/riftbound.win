import test from "node:test";
import assert from "node:assert/strict";

import { authProviderActions, authProviderDetail, authReadinessMessage } from "../public/auth-state.js";

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
