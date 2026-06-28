import test from "node:test";
import assert from "node:assert/strict";

import {
  currentTableFromList,
  selectedTableIdAfterListLoad,
  shouldFetchSelectedTable,
  tableDetailUrl,
} from "../public/playground-table-selection.js";

test("currentTableFromList does not fall back to the wrong table when a deep link id is missing", () => {
  assert.equal(currentTableFromList([{ id: "other-table" }], "deep-link-table"), null);
  assert.deepEqual(currentTableFromList([{ id: "deep-link-table" }], "deep-link-table"), { id: "deep-link-table" });
  assert.deepEqual(currentTableFromList([{ id: "first-table" }], ""), { id: "first-table" });
});

test("selectedTableIdAfterListLoad preserves deep link ids long enough for detail fetch", () => {
  assert.equal(selectedTableIdAfterListLoad([{ id: "other-table" }], "deep-link-table"), "deep-link-table");
  assert.equal(selectedTableIdAfterListLoad([{ id: "first-table" }], ""), "first-table");
  assert.equal(selectedTableIdAfterListLoad([], "deep-link-table"), "deep-link-table");
});

test("shouldFetchSelectedTable detects selected deep link tables missing from the lobby list", () => {
  assert.equal(shouldFetchSelectedTable([{ id: "other-table" }], "deep-link-table"), true);
  assert.equal(shouldFetchSelectedTable([{ id: "deep-link-table" }], "deep-link-table"), false);
  assert.equal(shouldFetchSelectedTable([{ id: "other-table" }], ""), false);
});

test("tableDetailUrl builds an encoded table detail endpoint", () => {
  assert.equal(tableDetailUrl("table/with space", "/api/playground/tables"), "/api/playground/tables/table%2Fwith%20space");
});
