import test from "node:test";
import assert from "node:assert/strict";

import { nextVisibleCount, hasMoreCards, shouldAutoLoad } from "../public/paging.js";

test("nextVisibleCount advances by one page without exceeding total cards", () => {
  assert.equal(nextVisibleCount(96, 1147), 192);
  assert.equal(nextVisibleCount(1100, 1147), 1147);
  assert.equal(nextVisibleCount(0, 0), 0);
});

test("hasMoreCards tracks whether the automatic pager should keep observing", () => {
  assert.equal(hasMoreCards(96, 1147), true);
  assert.equal(hasMoreCards(1147, 1147), false);
});

test("shouldAutoLoad triggers before the sentinel enters the viewport", () => {
  assert.equal(shouldAutoLoad({ sentinelTop: 1500, viewportHeight: 720 }), true);
  assert.equal(shouldAutoLoad({ sentinelTop: 1800, viewportHeight: 720 }), false);
});
