import { appendFoilLayers, bindFoilSurface } from "/foil.js";

const featuredAhriId = "OGN-066-P";
const supportingIds = ["OGN-255-P", "OGN-066a", "OGN-303-STAR", "SFD-227-STAR"];

const els = {
  heroFeaturedCard: document.querySelector("#heroFeaturedCard"),
  heroCards: document.querySelector("#heroCards"),
  cardCount: document.querySelector("#cardCount"),
  foilCount: document.querySelector("#foilCount"),
  setCount: document.querySelector("#setCount"),
};

async function boot() {
  const cards = await loadCards();
  const featuredAhri = cards.find((card) => card.id === featuredAhriId) || cards.find((card) => card.name?.startsWith("Ahri") && card.promo);
  const supporting = supportingIds
    .map((id) => cards.find((card) => card.id === id))
    .filter(Boolean);
  const fallback = cards.filter((card) => card.has_foil && card.local_image && card.id !== featuredAhri?.id).slice(0, 4);
  renderStats(cards);
  renderFeaturedAhri(featuredAhri || fallback[0]);
  renderHero(supporting.length ? supporting : fallback);
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

function renderFeaturedAhri(card) {
  if (!card) {
    els.heroFeaturedCard.textContent = "Ahri promo unavailable";
    return;
  }
  els.heroFeaturedCard.href = `/cards/?q=${encodeURIComponent(card.id)}`;
  els.heroFeaturedCard.setAttribute("aria-label", `Featured Ahri promo: ${card.name}`);
  els.heroFeaturedCard.style.setProperty("--hero-delay", "-0.8s");

  const image = document.createElement("img");
  image.src = card.local_image || card.image_url;
  image.alt = card.name;
  image.loading = "eager";
  image.decoding = "async";

  const caption = document.createElement("span");
  caption.className = "hero-featured-caption";
  const captionTitle = document.createElement("strong");
  captionTitle.textContent = "Ahri Promo";
  const captionMeta = document.createElement("small");
  captionMeta.textContent = `${card.id} · Foil only`;
  caption.append(captionTitle, captionMeta);

  els.heroFeaturedCard.replaceChildren(image, caption);
  appendFoilLayers(els.heroFeaturedCard, { premium: true });
  bindFoilSurface(els.heroFeaturedCard, { intensity: 1, tilt: 3.1 });
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
