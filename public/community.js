import { clipboardMediaFiles, filterAcceptedMediaFiles, mediaUploadConfig } from "/community-media.js?v=20260628-paste1";

const STORAGE_KEY = "riftbound.community.v2";
const boardMeta = {
  free: "자유 게시판",
  deck: "덱 토론",
  notice: "공지",
};

const seedPosts = [
  {
    id: newId(),
    board: "notice",
    title: "Riftbound.kr BBS",
    body: "이미지와 영상을 붙여넣어 올릴 수 있는 커뮤니티 보드입니다. 서버 API가 없으면 현재 브라우저에만 임시 저장됩니다.",
    votes: 18,
    comments: 2,
    createdAt: Date.now() - 1000 * 60 * 60 * 8,
    media: [],
  },
  {
    id: newId(),
    board: "deck",
    title: "Heimerdinger 중심 Mind 리스트 실험",
    body: "OGN-111을 3장 기준으로 잡고 저비용 Spell 비율을 높이는 방향을 테스트 중.",
    votes: 11,
    comments: 6,
    createdAt: Date.now() - 1000 * 60 * 47,
    media: [],
  },
  {
    id: newId(),
    board: "free",
    title: "foil-only 카드 이미지가 생각보다 잘 보임",
    body: "Showcase 카드만 따로 모아보는 뷰도 있으면 좋겠습니다.",
    votes: 7,
    comments: 3,
    createdAt: Date.now() - 1000 * 60 * 14,
    media: [],
  },
];

const state = {
  board: "free",
  posts: [],
  pendingMedia: [],
  apiReady: false,
  mediaConfig: mediaUploadConfig(),
  composerMessage: "",
};

const els = {
  tabs: [...document.querySelectorAll(".board-tab")],
  title: document.querySelector("#boardTitle"),
  summary: document.querySelector("#boardSummary"),
  form: document.querySelector("#postForm"),
  postTitle: document.querySelector("#postTitle"),
  postBody: document.querySelector("#postBody"),
  postMedia: document.querySelector("#postMedia"),
  mediaDrop: document.querySelector("#mediaDrop"),
  mediaStatus: document.querySelector("#mediaStatus"),
  mediaPreview: document.querySelector("#mediaPreview"),
  postList: document.querySelector("#postList"),
  counts: document.querySelector("#boardCounts"),
};

boot();

async function boot() {
  restorePosts();
  bindEvents();
  await Promise.all([loadMediaConfig(), loadRemotePosts()]);
  render();
}

function bindEvents() {
  els.tabs.forEach((tab) => {
    tab.addEventListener("click", async () => {
      state.board = tab.dataset.board;
      await loadRemotePosts();
      render();
    });
  });

  els.form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const title = els.postTitle.value.trim();
    if (!title) return;
    await createPost(title, els.postBody.value.trim());
  });

  els.postList.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-vote]");
    if (!button) return;
    await votePost(button.dataset.vote, Number(button.dataset.amount || 0));
  });

  els.postMedia.addEventListener("change", () => addFiles([...els.postMedia.files]));
  els.mediaDrop.addEventListener("dragover", (event) => {
    event.preventDefault();
    els.mediaDrop.classList.add("dragging");
  });
  els.mediaDrop.addEventListener("dragleave", () => els.mediaDrop.classList.remove("dragging"));
  els.mediaDrop.addEventListener("drop", (event) => {
    event.preventDefault();
    els.mediaDrop.classList.remove("dragging");
    addFiles([...event.dataTransfer.files]);
  });
  document.addEventListener("paste", (event) => {
    const files = clipboardMediaFiles(event.clipboardData);
    if (files.length > 0) {
      event.preventDefault();
      addFiles(files);
    }
  });
}

async function loadRemotePosts() {
  try {
    const response = await fetch(`/api/posts?board=${encodeURIComponent(state.board)}`, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`Posts API ${response.status}`);
    const data = await response.json();
    state.apiReady = true;
    state.posts = data.posts.map(normalizeRemotePost);
  } catch {
    state.apiReady = false;
  }
}

async function loadMediaConfig() {
  const me = await fetchJson("/api/me");
  state.mediaConfig = mediaUploadConfig(me);
}

async function createPost(title, body) {
  if (state.apiReady) {
    const form = new FormData();
    form.append("board", state.board);
    form.append("title", title);
    form.append("body", body);
    for (const item of state.pendingMedia) form.append("media", item.file, item.file.name || "media");
    try {
      const response = await fetch("/api/posts", { method: "POST", body: form });
      if (response.ok) {
        await loadRemotePosts();
        resetComposer();
        render();
        return;
      }
      const data = await response.json().catch(() => ({}));
      showComposerMessage(data.error || `Post failed (${response.status})`);
      renderMediaStatus();
      return;
    } catch {
      state.apiReady = false;
    }
  }

  state.posts.unshift({
    id: newId(),
    board: state.board,
    title,
    body,
    votes: 1,
    comments: 0,
    createdAt: Date.now(),
    media: state.pendingMedia.map((item) => ({
      id: newId(),
      url: item.url,
      type: item.file.type.startsWith("video/") ? "video" : "image",
      mime_type: item.file.type,
    })),
  });
  persistPosts();
  resetComposer();
  render();
}

async function votePost(id, amount) {
  if (state.apiReady) {
    const response = await fetch(`/api/posts/${encodeURIComponent(id)}/vote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount }),
    });
    if (response.ok) {
      await loadRemotePosts();
      renderPosts();
      renderCounts();
      return;
    }
    state.apiReady = false;
  }

  const post = state.posts.find((item) => item.id === id);
  if (!post) return;
  post.votes += amount;
  persistPosts();
  renderPosts();
  renderCounts();
}

function addFiles(files) {
  const result = filterAcceptedMediaFiles(files, state.mediaConfig, state.pendingMedia.length);
  for (const file of result.accepted) {
    state.pendingMedia.push({
      file,
      url: URL.createObjectURL(file),
    });
  }
  showComposerMessage(result.rejected.map((item) => item.reason).join(" · "));
  renderMediaPreview();
  renderMediaStatus();
}

function render() {
  els.tabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.board === state.board));
  els.title.textContent = state.board;
  els.summary.textContent = state.apiReady ? `${boardMeta[state.board]} · live` : `${boardMeta[state.board]} · local`;
  renderPosts();
  renderCounts();
  renderMediaPreview();
  renderMediaStatus();
}

function renderMediaPreview() {
  const fragment = document.createDocumentFragment();
  for (const item of state.pendingMedia) fragment.append(mediaNode(item.url, item.file.type));
  els.mediaPreview.replaceChildren(fragment);
}

function renderPosts() {
  const posts = state.posts
    .filter((post) => post.board === state.board)
    .sort((a, b) => b.votes - a.votes || b.createdAt - a.createdAt);

  if (posts.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "No posts yet.";
    els.postList.replaceChildren(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  posts.forEach((post) => fragment.append(postNode(post)));
  els.postList.replaceChildren(fragment);
}

function postNode(post) {
  const article = document.createElement("article");
  article.className = "post";

  const votes = document.createElement("div");
  votes.className = "vote-stack";
  votes.append(voteButton("▲", post.id, 1), text("strong", post.votes), voteButton("▼", post.id, -1));

  const body = document.createElement("div");
  body.className = "post-body";
  const meta = text("span", `${post.board} · ${relativeTime(post.createdAt)} · ${post.comments} comments`);
  meta.className = "post-meta";
  body.append(text("h2", post.title), meta);
  if (post.body) body.append(text("p", post.body));
  if (post.media?.length) body.append(postMedia(post.media));

  article.append(votes, body);
  return article;
}

function postMedia(media) {
  const wrap = document.createElement("div");
  wrap.className = "post-media";
  for (const item of media) wrap.append(mediaNode(item.url, item.mime_type || item.type));
  return wrap;
}

function mediaNode(url, mimeType) {
  const shell = document.createElement("div");
  shell.className = "media-preview-item";
  const isVideo = String(mimeType || "").startsWith("video") || /\.(mp4|webm|mov)$/i.test(url);
  const node = document.createElement(isVideo ? "video" : "img");
  node.src = url;
  if (isVideo) {
    node.controls = true;
    node.playsInline = true;
  } else {
    node.alt = "";
    node.loading = "lazy";
  }
  shell.append(node);
  return shell;
}

function renderCounts() {
  const fragment = document.createDocumentFragment();
  for (const board of Object.keys(boardMeta)) {
    const item = document.createElement("span");
    const count = state.posts.filter((post) => post.board === board).length;
    item.innerHTML = `<strong>${count}</strong>${board}`;
    fragment.append(item);
  }
  els.counts.replaceChildren(fragment);
}

function resetComposer() {
  els.postTitle.value = "";
  els.postBody.value = "";
  els.postMedia.value = "";
  state.pendingMedia = [];
  showComposerMessage("");
  renderMediaPreview();
  renderMediaStatus();
}

function renderMediaStatus() {
  if (!els.mediaStatus) return;
  els.mediaStatus.textContent = state.composerMessage || state.mediaConfig.detail;
  els.mediaStatus.dataset.tone = state.composerMessage ? "error" : state.mediaConfig.store;
}

function showComposerMessage(message) {
  state.composerMessage = message || "";
}

function normalizeRemotePost(post) {
  return {
    id: post.id,
    board: post.board,
    title: post.title,
    body: post.body || "",
    votes: Number(post.votes || 0),
    comments: Number(post.comments || 0),
    createdAt: Number(post.created_at || Date.now()),
    media: post.media || [],
  };
}

function voteButton(label, id, amount) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.dataset.vote = id;
  button.dataset.amount = String(amount);
  return button;
}

function text(tag, value) {
  const node = document.createElement(tag);
  node.textContent = value;
  return node;
}

function restorePosts() {
  try {
    state.posts = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null") || seedPosts;
  } catch {
    state.posts = seedPosts;
  }
}

function persistPosts() {
  try {
    const serializable = state.posts.map((post) => ({ ...post, media: (post.media || []).filter((item) => !item.url.startsWith("blob:")) }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serializable));
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
}

function relativeTime(value) {
  const minutes = Math.max(1, Math.round((Date.now() - value) / 60000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function newId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
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
