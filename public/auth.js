import {
  authProviderActions,
  authProviderDetail,
  authProviderLabel,
} from "/auth-state.js?v=20260628-authlabel1";

const shell = document.querySelector("[data-auth-shell]");

if (shell) bootAuth();

async function bootAuth() {
  renderLoading();
  const me = await fetchJson("/api/me");
  if (me?.user) renderSignedIn(me);
  else renderSignedOut(me);
}

function renderLoading() {
  shell.replaceChildren(buttonLink("/profile/", "Profile"));
}

function renderSignedIn(me) {
  const profile = buttonLink("/profile/", me.user.display_name || "Profile");
  profile.className = "profile-link";
  if (me.user.avatar_url) {
    profile.dataset.avatar = "true";
    profile.style.setProperty("--avatar-url", `url("${me.user.avatar_url}")`);
  }
  const logout = document.createElement("button");
  logout.type = "button";
  logout.textContent = "Logout";
  logout.addEventListener("click", async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    location.reload();
  });
  shell.replaceChildren(profile, logout);
}

function renderSignedOut(me) {
  shell.replaceChildren(...authProviderActions(me).map(providerAction));
}

function providerAction(action) {
  const link = buttonLink(action.href, authProviderLabel(action));
  if (!action.enabled) {
    link.className = "auth-unconfigured";
    link.setAttribute("aria-disabled", "true");
    link.setAttribute("aria-label", authProviderDetail(action));
    link.title = authProviderDetail(action);
  }
  return link;
}

function buttonLink(href, label) {
  const link = document.createElement("a");
  link.href = href;
  link.textContent = label;
  return link;
}

async function fetchJson(path) {
  try {
    const response = await fetch(path, { headers: { Accept: "application/json" } });
    if (!response.ok) return null;
    return response.json();
  } catch {
    return null;
  }
}
