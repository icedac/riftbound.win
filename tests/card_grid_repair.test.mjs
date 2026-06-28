import test from "node:test";
import assert from "node:assert/strict";
import { shouldRepairInitialCardGrid } from "../public/card-grid-repair.js";

test("repairs the initial card grid once when cards should be visible", () => {
  assert.equal(
    shouldRepairInitialCardGrid({
      totalCards: 1147,
      filteredCards: 1139,
      visibleCards: 96,
      repairAlreadyRan: false,
    }),
    true
  );
});

test("does not repair when there are no matching cards or repair already ran", () => {
  assert.equal(
    shouldRepairInitialCardGrid({
      totalCards: 1147,
      filteredCards: 0,
      visibleCards: 0,
      repairAlreadyRan: false,
    }),
    false
  );
  assert.equal(
    shouldRepairInitialCardGrid({
      totalCards: 1147,
      filteredCards: 1139,
      visibleCards: 96,
      repairAlreadyRan: true,
    }),
    false
  );
});
