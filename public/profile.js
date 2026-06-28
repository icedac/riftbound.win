import { authProviderActions, authProviderDetail, authReadinessMessage } from "/auth-state.js?v=20260628-authsetup1";

const els = {
  status: document.querySelector("#profileStatus"),
  form: document.querySelector("#profileForm"),
  displayName: document.querySelector("#displayName"),
  bio: document.querySelector("#bio"),
  avatarInput: document.querySelector("#avatarInput"),
  avatarPreview: document.querySelector("#avatarPreview"),
  providers: document.querySelector("#providerList"),
};

let currentUser = null;

boot().catch((error) => {
  console.error(error);
  els.status.textContent = "Profile API is not configured yet.";
});

async function boot() {
  bindEvents();
  await loadProfile();
}

function bindEvents() {
  els.form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!currentUser) return;
    els.status.textContent = "Saving...";
    const payload = {
      display_name: els.displayName.value.trim(),
      bio: els.bio.value.trim(),
    };
    const response = await fetch("/api/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(`Profile save failed: ${response.status}`);
    if (els.avatarInput.files[0]) await uploadAvatar(els.avatarInput.files[0]);
    await loadProfile();
    els.status.textContent = "Saved.";
  });

  els.avatarInput.addEventListener("change", async () => {
    const file = els.avatarInput.files[0];
    if (!file) return;
    const blob = await squareAvatarBlob(file);
    els.avatarPreview.src = URL.createObjectURL(blob);
  });
}

async function loadProfile() {
  const response = await fetch("/api/me", { headers: { Accept: "application/json" } });
  if (!response.ok) {
    renderSignedOut();
    return;
  }
  const data = await response.json();
  if (!data.user) {
    renderSignedOut(data);
    return;
  }
  currentUser = data.user;
  els.status.textContent = "Signed in.";
  els.displayName.value = data.user.display_name || "";
  els.bio.value = data.user.bio || "";
  els.avatarPreview.src = data.user.avatar_url || "";
  renderProviders(data.providers || [], data);
}

function renderSignedOut(data = null) {
  currentUser = null;
  els.status.textContent = authReadinessMessage(data);
  els.form.hidden = true;
  els.providers.replaceChildren(...authProviderActions(data).map((action) => providerRow(action.label, false, action)));
}

function renderProviders(providers, data = null) {
  els.form.hidden = false;
  const linked = new Map(providers.map((item) => [item.provider, item]));
  els.providers.replaceChildren(
    ...authProviderActions(data).map((action) =>
      providerRow(action.label, linked.has(action.provider), action, linked.get(action.provider))
    )
  );
}

function providerRow(name, linked, action, provider = null) {
  const row = document.createElement("div");
  row.className = "provider-row";
  const copy = document.createElement("div");
  copy.append(
    text("strong", name),
    text("span", linked ? linkedProviderDetail(provider, action) : authProviderDetail(action))
  );
  row.append(copy, linked ? text("span", "Ready") : providerLink(action.enabled ? "Link" : "Setup", action));
  return row;
}

function linkedProviderDetail(provider, action) {
  const email = provider?.email ? ` · ${provider.email}` : "";
  return `Linked${email} · ${authProviderDetail(action)}`;
}

function providerLink(label, action) {
  const link = document.createElement("a");
  link.href = action.href;
  link.textContent = label;
  if (!action.enabled) {
    link.className = "auth-unconfigured";
    link.setAttribute("aria-disabled", "true");
    link.title = authProviderDetail(action);
  }
  return link;
}

async function uploadAvatar(file) {
  const form = new FormData();
  form.append("avatar", await squareAvatarBlob(file), "avatar.webp");
  const response = await fetch("/api/profile/avatar", { method: "POST", body: form });
  if (!response.ok) throw new Error(`Avatar upload failed: ${response.status}`);
}

async function squareAvatarBlob(file) {
  const bitmap = await createImageBitmap(file);
  const size = Math.min(bitmap.width, bitmap.height);
  const sourceX = Math.floor((bitmap.width - size) / 2);
  const sourceY = Math.floor((bitmap.height - size) / 2);
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext("2d", { alpha: false });
  context.drawImage(bitmap, sourceX, sourceY, size, size, 0, 0, 256, 256);
  return new Promise((resolve) => canvas.toBlob(resolve, "image/webp", 0.88));
}

function text(tag, value) {
  const node = document.createElement(tag);
  node.textContent = value;
  return node;
}
