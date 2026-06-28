import test from "node:test";
import assert from "node:assert/strict";

import { filterAcceptedMediaFiles, mediaUploadConfig } from "../public/community-media.js";

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
