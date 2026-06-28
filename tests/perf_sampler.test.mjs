import test from "node:test";
import assert from "node:assert/strict";

import { summarizeFrameDeltas } from "../public/perf.js";

test("summarizeFrameDeltas reports stable fps while counting long stalls separately", () => {
  const deltas = Array.from({ length: 119 }, () => 16.7);
  deltas.push(950);

  const sample = summarizeFrameDeltas(deltas);

  assert.equal(sample.fps, 60);
  assert.equal(sample.avgFrameMs, 17);
  assert.equal(sample.p95FrameMs, 17);
  assert.equal(sample.frames, 120);
  assert.equal(sample.stallFrames, 1);
  assert.equal(sample.maxFrameMs, 950);
});
