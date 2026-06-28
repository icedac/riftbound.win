import test from "node:test";
import assert from "node:assert/strict";

const foil = await import("../public/foil.js");

test("compact card-grid foil uses a single soft wash layer", () => {
  assert.equal(typeof foil.foilLayerClasses, "function");
  assert.deepEqual(foil.foilLayerClasses({ compact: true }), ["foil-wash"]);
});

test("full foil surfaces avoid the old sparkle-heavy default layer stack", () => {
  assert.equal(typeof foil.foilLayerClasses, "function");
  assert.deepEqual(foil.foilLayerClasses(), ["foil-spectrum", "foil-glare"]);
});
