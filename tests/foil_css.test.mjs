import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const css = await readFile(new URL("../public/styles.css", import.meta.url), "utf8");

test("compact foil wash uses soft radial light instead of stripe gradients", () => {
  const block = cssBlock(".foil-wash");

  assert.match(block, /radial-gradient/);
  assert.doesNotMatch(block, /(?:repeating-)?linear-gradient/);
  assert.doesNotMatch(block, /conic-gradient/);
});

test("foil visual layers avoid banded gradient families", () => {
  for (const selector of [".foil-wash", ".foil-spectrum", ".foil-glare"]) {
    const block = cssBlock(selector);

    assert.doesNotMatch(block, /(?:repeating-)?linear-gradient/, selector);
    assert.doesNotMatch(block, /conic-gradient/, selector);
  }
});

test("foil-only card names can show the rainbow effect without single-line truncation", () => {
  const block = cssBlock(".card-title strong.foil-only-name");

  assert.match(block, /white-space:\s*normal/);
  assert.match(block, /-webkit-line-clamp:\s*2/);
});

test("foil layers are paint-contained to limit grid rendering cost", () => {
  const block = cssBlock(".foil-layer");

  assert.match(block, /contain:\s*paint/);
});

test("card grid cells do not skip initial painting", () => {
  const block = cssBlock(".card");

  assert.doesNotMatch(block, /content-visibility:\s*auto/);
  assert.doesNotMatch(block, /contain-intrinsic-size/);
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
