import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const css = await readFile(new URL("../public/styles.css", import.meta.url), "utf8");

test("provider rows wrap long OAuth callback setup text", () => {
  const rowBlock = cssBlock(".provider-row > div");
  const spanBlock = css.match(/\.provider-row span,[\s\S]*?\.profile-status \{[\s\S]*?\n\}/)?.[0] || "";

  assert.match(rowBlock, /min-width:\s*0/);
  assert.notEqual(spanBlock, "", "Missing provider status text CSS block");
  assert.match(spanBlock, /overflow-wrap:\s*anywhere/);
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
