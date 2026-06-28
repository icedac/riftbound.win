const BRAND_BY_DOMAIN = [
  { suffix: "riftbound.kr", label: "Riftbound.kr" },
  { suffix: "riftbound.win", label: "Riftbound.win" },
];

export function brandForHostname(hostname = "") {
  const normalized = String(hostname).toLowerCase();
  const match = BRAND_BY_DOMAIN.find(({ suffix }) => normalized === suffix || normalized.endsWith(`.${suffix}`));
  return match?.label || "Riftbound.win";
}

export function brandedTitle(currentTitle = "", brand = "Riftbound.win") {
  const suffix = String(currentTitle).replace(/^Riftbound\.(?:kr|win)\s*/i, "").trim();
  return suffix ? `${brand} ${suffix}` : brand;
}

export function applyRuntimeBrand(root = document, location = window.location) {
  const brand = brandForHostname(location.hostname);
  root.title = brandedTitle(root.title, brand);
  root.querySelectorAll("[data-brand]").forEach((node) => {
    node.textContent = brand;
  });
  root.querySelectorAll("[data-brand-title]").forEach((node) => {
    node.setAttribute("title", brand);
  });
  return brand;
}

if (typeof document !== "undefined" && typeof window !== "undefined") {
  applyRuntimeBrand();
}
