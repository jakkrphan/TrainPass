// Unit tests for where uploads are stored: UPLOAD_DIR on the server, `.local-uploads` only in development.
import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import test from "node:test";

import { uploadRoot } from "./upload-storage.ts";

test("UPLOAD_DIR is used in production and development", () => {
  const folder = resolve("/srv/attendpass-uploads");
  assert.equal(uploadRoot({ NODE_ENV: "production", UPLOAD_DIR: folder }), folder);
  assert.equal(uploadRoot({ NODE_ENV: "development", UPLOAD_DIR: folder }), folder);
});

test("a relative UPLOAD_DIR resolves from the working directory", () => {
  assert.equal(uploadRoot({ NODE_ENV: "production", UPLOAD_DIR: "uploads" }), resolve("uploads"));
});

test("production without UPLOAD_DIR has no storage", () => {
  assert.equal(uploadRoot({ NODE_ENV: "production" }), null);
  assert.equal(uploadRoot({ NODE_ENV: "production", UPLOAD_DIR: "  " }), null);
});

test("development falls back to .local-uploads", () => {
  assert.equal(uploadRoot({ NODE_ENV: "development" }), join(process.cwd(), ".local-uploads"));
});
