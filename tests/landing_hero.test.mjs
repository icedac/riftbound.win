import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
const js = await readFile(new URL("../public/landing.js", import.meta.url), "utf8");
const css = await readFile(new URL("../public/styles.css", import.meta.url), "utf8");

test("home page reserves a dedicated featured Ahri promo card slot", () => {
  assert.match(html, /id="heroFeaturedCard"/);
  assert.match(html, /aria-label="Featured Ahri promo"/);
  assert.match(js, /const featuredAhriId = "OGN-066-P"/);
  assert.match(js, /renderFeaturedAhri/);
});

test("featured Ahri promo is styled larger than the supporting hero cards", () => {
  const featuredBlock = cssBlock(".hero-featured-card");
  const supportBlock = cssBlock(".hero-card");

  assert.match(featuredBlock, /grid-row:\s*span 2/);
  assert.match(featuredBlock, /max-width:\s*min\(38vw,\s*420px\)/);
  assert.match(supportBlock, /max-width:\s*190px/);
});

test("home headline is restrained so the featured Ahri card stays dominant", () => {
  const copyBlock = cssBlock(".hero-copy");
  const headlineBlock = cssBlock(".hero-copy h1");

  assert.match(copyBlock, /max-width:\s*500px/);
  assert.match(headlineBlock, /clamp\(44px,\s*6vw,\s*82px\)/);
});

function cssBlock(selector) {
  const match = new RegExp(`(^|\\n)${escapeRegExp(selector)} \\{`).exec(css);
  const start = match?.index === undefined ? -1 : match.index + match[1].length;
  assert.notEqual(start, -1, `Missing CSS block for ${selector}`);

  const end = css.indexOf("\n}", start);
  assert.notEqual(end, -1, `Unclosed CSS block for ${selector}`);

  return css.slice(start, end + 2);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
