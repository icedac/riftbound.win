const DEFAULTS = {
  intensity: 0.95,
  tilt: 4.4,
  activeClass: "is-foil-active",
};

export function appendFoilLayers(parent, options = {}) {
  if (!parent || parent.querySelector(":scope > .foil-spectrum")) return;
  const variant = options.variant || "rift";
  parent.classList.add("foil-surface", `foil-${variant}`);
  if (options.premium) parent.classList.add("foil-premium");
  for (const className of ["foil-spectrum", "foil-sparkle", "foil-glare"]) {
    const layer = document.createElement("div");
    layer.className = `foil-layer ${className}`;
    parent.append(layer);
  }
}

export function bindFoilSurface(surface, options = {}) {
  if (!surface || surface.dataset.foilBound === "true") return;
  const config = { ...DEFAULTS, ...options };
  let frame = 0;
  let latest = null;
  surface.dataset.foilBound = "true";
  surface.style.setProperty("--seed", Math.random().toFixed(4));

  const apply = () => {
    frame = 0;
    if (!latest) return;
    const rect = surface.getBoundingClientRect();
    const x = clamp(((latest.clientX - rect.left) / rect.width) * 100, 0, 100);
    const y = clamp(((latest.clientY - rect.top) / rect.height) * 100, 0, 100);
    const centerX = x - 50;
    const centerY = y - 50;
    const distance = clamp(Math.hypot(centerX, centerY) / 70, 0, 1);
    const fromLeft = x / 100;
    const fromTop = y / 100;
    const backgroundX = adjust(x, 0, 100, 37, 63);
    const backgroundY = adjust(y, 0, 100, 33, 67);

    surface.classList.add(config.activeClass);
    surface.style.setProperty("--pointer-x", `${x.toFixed(2)}%`);
    surface.style.setProperty("--pointer-y", `${y.toFixed(2)}%`);
    surface.style.setProperty("--pointer-from-center", distance.toFixed(3));
    surface.style.setProperty("--pointer-from-left", fromLeft.toFixed(3));
    surface.style.setProperty("--pointer-from-top", fromTop.toFixed(3));
    surface.style.setProperty("--background-x", `${backgroundX.toFixed(2)}%`);
    surface.style.setProperty("--background-y", `${backgroundY.toFixed(2)}%`);
    surface.style.setProperty("--card-opacity", String(config.intensity));
    surface.style.setProperty("--foil-rotate-x", `${((50 - y) / config.tilt).toFixed(2)}deg`);
    surface.style.setProperty("--foil-rotate-y", `${((x - 50) / config.tilt).toFixed(2)}deg`);
  };

  surface.addEventListener("pointermove", (event) => {
    latest = event;
    if (!frame) frame = requestAnimationFrame(apply);
  });

  surface.addEventListener("pointerleave", () => {
    latest = null;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    surface.classList.remove(config.activeClass);
    for (const key of [
      "--pointer-x",
      "--pointer-y",
      "--pointer-from-center",
      "--pointer-from-left",
      "--pointer-from-top",
      "--background-x",
      "--background-y",
      "--card-opacity",
      "--foil-rotate-x",
      "--foil-rotate-y",
    ]) {
      surface.style.removeProperty(key);
    }
  });
}

export function setupFoils(root = document) {
  root.querySelectorAll(".js-foil").forEach((surface) => {
    appendFoilLayers(surface, {
      premium: surface.classList.contains("foil-premium"),
      variant: surface.dataset.foilVariant || "rift",
    });
    bindFoilSurface(surface, {
      intensity: surface.classList.contains("foil-premium") ? 1 : 0.82,
      tilt: surface.classList.contains("foil-hero") ? 3.2 : 4.6,
    });
  });
}

function adjust(value, fromMin, fromMax, toMin, toMax) {
  const ratio = (value - fromMin) / (fromMax - fromMin);
  return toMin + ratio * (toMax - toMin);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
