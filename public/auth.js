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

function renderSignedOut() {
  shell.replaceChildren(buttonLink("/api/auth/google/start", "Google"), buttonLink("/api/auth/naver/start", "Naver"));
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
