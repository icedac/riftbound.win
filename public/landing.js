import { appendFoilLayers, bindFoilSurface } from "/foil.js";

const featuredIds = ["ARC-001", "UNL-236-STAR", "OGN-111", "UNL-131", "OGN-001"];

const els = {
  heroCards: document.querySelector("#heroCards"),
  cardCount: document.querySelector("#cardCount"),
  foilCount: document.querySelector("#foilCount"),
  setCount: document.querySelector("#setCount"),
};

async function boot() {
  const cards = await loadCards();
  const featured = featuredIds
    .map((id) => cards.find((card) => card.id === id))
    .filter(Boolean);
  const fallback = cards.filter((card) => card.has_foil && card.local_image).slice(0, 5);
  renderStats(cards);
  renderHero(featured.length ? featured : fallback);
}

async function loadCards() {
  const response = await fetch("/cards.json", { cache: "no-store" });
  if (!response.ok) throw new Error(`Failed to load cards.json: ${response.status}`);
  return response.json();
}

function renderStats(cards) {
  els.cardCount.textContent = cards.length.toLocaleString();
  els.foilCount.textContent = cards.filter((card) => card.has_foil).length.toLocaleString();
  els.setCount.textContent = new Set(cards.map((card) => card.set_name).filter(Boolean)).size;
}

function renderHero(cards) {
  const fragment = document.createDocumentFragment();
  cards.forEach((card, index) => {
    const shell = document.createElement("a");
    shell.href = `/cards/?q=${encodeURIComponent(card.id)}`;
    shell.className = `hero-card hero-card-${index + 1} js-foil foil-hero foil-premium`;
    shell.style.setProperty("--hero-delay", `${index * -1.35}s`);
    shell.setAttribute("aria-label", card.name);

    const image = document.createElement("img");
    image.src = card.local_image || card.image_url;
    image.alt = card.name;
    image.loading = index === 0 ? "eager" : "lazy";
    image.decoding = "async";
    shell.append(image);
    appendFoilLayers(shell, { premium: true });
    bindFoilSurface(shell, { intensity: 1, tilt: 3.1 });

    const caption = document.createElement("span");
    caption.textContent = card.id;
    shell.append(caption);
    fragment.append(shell);
  });
  els.heroCards.replaceChildren(fragment);
}

boot().catch((error) => {
  console.error(error);
  els.heroCards.textContent = "Could not load cards.";
});
