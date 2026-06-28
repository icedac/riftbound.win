import test from "node:test";
import assert from "node:assert/strict";
import * as repair from "../public/card-grid-repair.js";

test("repairs the initial card grid once when cards should be visible", () => {
  assert.equal(
    repair.shouldRepairInitialCardGrid({
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
    repair.shouldRepairInitialCardGrid({
      totalCards: 1147,
      filteredCards: 0,
      visibleCards: 0,
      repairAlreadyRan: false,
    }),
    false
  );
  assert.equal(
    repair.shouldRepairInitialCardGrid({
      totalCards: 1147,
      filteredCards: 1139,
      visibleCards: 96,
      repairAlreadyRan: true,
    }),
    false
  );
});

test("recovers when restored browser DOM is missing visible cards", () => {
  assert.equal(
    repair.shouldRecoverRenderedCardGrid?.({
      totalCards: 1147,
      filteredCards: 1139,
      visibleCards: 96,
      renderedCards: 0,
    }),
    true
  );
  assert.equal(
    repair.shouldRecoverRenderedCardGrid?.({
      totalCards: 1147,
      filteredCards: 1139,
      visibleCards: 96,
      renderedCards: 48,
    }),
    true
  );
  assert.equal(
    repair.shouldRecoverRenderedCardGrid?.({
      totalCards: 1147,
      filteredCards: 1139,
      visibleCards: 96,
      renderedCards: 96,
    }),
    false
  );
});

test("keeps a short recovery watchdog alive after the first successful render", () => {
  assert.equal(
    repair.shouldKeepCardGridRecoveryWatchdog?.({
      totalCards: 1147,
      elapsedMs: 3000,
      maxMs: 15000,
    }),
    true
  );
  assert.equal(
    repair.shouldKeepCardGridRecoveryWatchdog?.({
      totalCards: 1147,
      elapsedMs: 15100,
      maxMs: 15000,
    }),
    false
  );
  assert.equal(
    repair.shouldKeepCardGridRecoveryWatchdog?.({
      totalCards: 0,
      elapsedMs: 3000,
      maxMs: 15000,
    }),
    false
  );
});
