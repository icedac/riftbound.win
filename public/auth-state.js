const PROVIDERS = [
  ["google", "Google"],
  ["naver", "Naver"],
];

export function authProviderActions(me = {}) {
  const providers = me?.auth?.providers || {};
  return PROVIDERS.map(([provider, label]) => {
    const status = providers[provider] || {};
    const missing = Array.isArray(status.missing) ? status.missing : [];
    const enabled = status.configured !== false;
    return {
      provider,
      label,
      href: enabled ? status.start_url || `/api/auth/${provider}/start` : `/profile/?auth=${provider}-missing`,
      enabled,
      status: enabled ? "Ready" : "Needs setup",
      missing,
      callbackUrl: status.callback_url || "",
    };
  });
}

export function authProviderDetail(action = {}) {
  const callback = action.callbackUrl ? ` · callback ${action.callbackUrl}` : "";
  if (!action.enabled) {
    const missing = action.missing?.length ? `Missing ${action.missing.join(", ")}` : "Provider setup is incomplete";
    return `${missing}${callback}`;
  }
  return `${action.status || "Ready"}${callback}`;
}

export function authProviderLabel(action = {}) {
  return action.enabled === false ? `${action.label || "Login"} setup` : action.label || "Login";
}

export function authReadinessMessage(me = {}) {
  const missing = authProviderActions(me).filter((action) => !action.enabled);
  if (missing.length === 0) return "Sign in with Google or Naver.";
  if (missing.length === 1) return `${missing[0].label} login setup is incomplete.`;
  return `${joinLabels(missing.map((action) => action.label))} login setup is incomplete.`;
}

export function runtimeSetupItems(me = {}) {
  const authItems = authProviderActions(me).map((action) => ({
    key: action.provider,
    label: `${action.label} login`,
    status: action.enabled ? "Ready" : "Needs setup",
    tone: action.enabled ? "ready" : "warning",
    detail: action.enabled
      ? "OAuth provider configured"
      : action.missing?.length
        ? `Missing ${action.missing.join(", ")}`
        : "OAuth provider setup is incomplete",
    callbackUrl: action.callbackUrl,
  }));

  return [...authItems, mediaSetupItem(me?.media || {})];
}

function mediaSetupItem(media = {}) {
  if (media.store === "r2") {
    return {
      key: "media",
      label: "Media uploads",
      status: "Ready",
      tone: "ready",
      detail: `R2 MEDIA binding connected; uploads support ${formatBytes(media.max_upload_bytes)} media and ${formatBytes(media.max_avatar_bytes)} avatars.`,
      callbackUrl: "",
    };
  }

  return {
    key: "media",
    label: "Media uploads",
    status: "D1 fallback",
    tone: "warning",
    detail: `R2 MEDIA binding is not connected; uploads are limited to ${formatBytes(media.max_upload_bytes)} media and ${formatBytes(media.max_avatar_bytes)} avatars.`,
    callbackUrl: "",
  };
}

function formatBytes(value) {
  const bytes = Number(value) || 0;
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function joinLabels(labels) {
  if (labels.length <= 1) return labels[0] || "";
  return `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`;
}
