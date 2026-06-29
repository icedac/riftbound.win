const PUBLIC_PROVIDERS = [["naver", "Naver"]];

export function authProviderActions(me = {}) {
  const providers = me?.auth?.providers || {};
  return PUBLIC_PROVIDERS.map(([provider, label]) => {
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
  if (missing.length === 0) return "Sign in with Naver.";
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

  return authItems;
}

function joinLabels(labels) {
  if (labels.length <= 1) return labels[0] || "";
  return `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`;
}
