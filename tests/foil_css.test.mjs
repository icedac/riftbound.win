import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const css = await readFile(new URL("../public/styles.css", import.meta.url), "utf8");

test("foil spectrum uses broad color wash instead of repeating stripe gradients", () => {
  const block = cssBlock(".foil-spectrum");

  assert.match(block, /conic-gradient/);
  assert.doesNotMatch(block, /repeating-linear-gradient/);
});

test("foil CSS avoids repeating stripe gradients across all foil layers", () => {
  for (const block of css.matchAll(/(?:^|\n)\.foil[\s\S]*?\n}/g)) {
    assert.doesNotMatch(block[0], /repeating-linear-gradient/);
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
