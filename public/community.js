const STORAGE_KEY = "riftbound.community.v1";
const boardMeta = {
  free: "자유 게시판",
  deck: "덱 토론",
  notice: "공지",
};

const seedPosts = [
  {
    id: newId(),
    board: "notice",
    title: "Riftbound Vault 임시 BBS",
    body: "현재 글은 브라우저 localStorage에 저장됩니다. 배포 후에도 서버형 게시판으로 교체하기 쉬운 프레임입니다.",
    votes: 18,
    comments: 2,
    createdAt: Date.now() - 1000 * 60 * 60 * 8,
  },
  {
    id: newId(),
    board: "deck",
    title: "Heimerdinger 중심 Mind 리스트 실험",
    body: "OGN-111을 3장 기준으로 잡고 저비용 Spell 비율을 높이는 방향을 테스트 중.",
    votes: 11,
    comments: 6,
    createdAt: Date.now() - 1000 * 60 * 47,
  },
  {
    id: newId(),
    board: "free",
    title: "foil-only 카드 이미지가 생각보다 잘 보임",
    body: "Showcase 카드만 따로 모아보는 뷰도 있으면 좋겠습니다.",
    votes: 7,
    comments: 3,
    createdAt: Date.now() - 1000 * 60 * 14,
  },
];

const state = {
  board: "free",
  posts: [],
};

const els = {
  tabs: [...document.querySelectorAll(".board-tab")],
  title: document.querySelector("#boardTitle"),
  summary: document.querySelector("#boardSummary"),
  form: document.querySelector("#postForm"),
  postTitle: document.querySelector("#postTitle"),
  postBody: document.querySelector("#postBody"),
  postList: document.querySelector("#postList"),
  counts: document.querySelector("#boardCounts"),
};

function boot() {
  restorePosts();
  bindEvents();
  render();
}

function bindEvents() {
  els.tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      state.board = tab.dataset.board;
      render();
    });
  });

  els.form.addEventListener("submit", (event) => {
    event.preventDefault();
    const title = els.postTitle.value.trim();
    if (!title) return;
    state.posts.unshift({
      id: newId(),
      board: state.board,
      title,
      body: els.postBody.value.trim(),
      votes: 1,
      comments: 0,
      createdAt: Date.now(),
    });
    els.postTitle.value = "";
    els.postBody.value = "";
    persistPosts();
    render();
  });

  els.postList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-vote]");
    if (!button) return;
    const post = state.posts.find((item) => item.id === button.dataset.vote);
    if (!post) return;
    post.votes += Number(button.dataset.amount || 0);
    persistPosts();
    renderPosts();
    renderCounts();
  });
}

function render() {
  els.tabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.board === state.board));
  els.title.textContent = state.board;
  els.summary.textContent = boardMeta[state.board];
  renderPosts();
  renderCounts();
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

  article.append(votes, body);
  return article;
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
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.posts));
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

boot();
