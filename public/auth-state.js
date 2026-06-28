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
    };
  });
}

export function authReadinessMessage(me = {}) {
  const missing = authProviderActions(me).filter((action) => !action.enabled);
  if (missing.length === 0) return "Sign in with Google or Naver.";
  if (missing.length === 1) return `${missing[0].label} login setup is incomplete.`;
  return `${joinLabels(missing.map((action) => action.label))} login setup is incomplete.`;
}

function joinLabels(labels) {
  if (labels.length <= 1) return labels[0] || "";
  return `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`;
}
