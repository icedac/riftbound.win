import test from "node:test";
import assert from "node:assert/strict";

import { clipboardMediaFiles, filterAcceptedMediaFiles, mediaUploadConfig } from "../public/community-media.js";

function file(name, type, size) {
  return { name, type, size };
}

test("mediaUploadConfig uses Worker capability limits when present", () => {
  const config = mediaUploadConfig({
    media: {
      store: "d1-inline",
      max_upload_bytes: 1048576,
      max_files_per_post: 6,
    },
  });

  assert.equal(config.store, "d1-inline");
  assert.equal(config.maxBytes, 1048576);
  assert.equal(config.maxFiles, 6);
  assert.match(config.label, /1 MB/);
  assert.equal(config.detail, "Media: 1 MB per file until R2 subscription and binding are connected");
});

test("filterAcceptedMediaFiles rejects unsupported and oversized pasted files", () => {
  const config = mediaUploadConfig({
    media: {
      store: "d1-inline",
      max_upload_bytes: 1048576,
      max_files_per_post: 2,
    },
  });

  const result = filterAcceptedMediaFiles(
    [
      file("ok.png", "image/png", 100),
      file("clip.webm", "video/webm", 1048577),
      file("notes.txt", "text/plain", 10),
      file("extra.jpg", "image/jpeg", 100),
    ],
    config,
    1
  );

  assert.deepEqual(result.accepted.map((item) => item.name), ["ok.png"]);
  assert.equal(result.rejected.length, 3);
  assert(result.rejected.some((item) => item.reason.includes("too large")));
  assert(result.rejected.some((item) => item.reason.includes("Unsupported")));
  assert(result.rejected.some((item) => item.reason.includes("up to 2")));
});

test("clipboardMediaFiles extracts pasted image and video files from clipboard data", () => {
  const image = file("pull.png", "image/png", 100);
  const video = file("clip.webm", "video/webm", 100);
  const text = file("notes.txt", "text/plain", 10);
  const clipboardData = {
    files: [image, text],
    items: [
      { kind: "file", type: "video/webm", getAsFile: () => video },
      { kind: "string", type: "text/plain", getAsFile: () => text },
      { kind: "file", type: "application/pdf", getAsFile: () => file("doc.pdf", "application/pdf", 100) },
    ],
  };

  assert.deepEqual(clipboardMediaFiles(clipboardData).map((item) => item.name), ["pull.png", "clip.webm"]);
});
