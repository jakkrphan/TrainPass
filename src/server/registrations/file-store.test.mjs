// Unit tests for stored files: cover re-encoding (WebP + thumbnail, metadata dropped), the key guard, streaming, and the
// PendingFile journal kept by every write, copy and delete.
// Runs against a throwaway UPLOAD_DIR, never the real upload folder.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import sharp from "sharp";

const folder = await mkdtemp(join(tmpdir(), "checkinhub-files-"));
process.env.UPLOAD_DIR = folder;
// The PendingFile journal, in memory (db.ts reuses globalThis.prisma), so these tests need no database.
const pending = new Set();
globalThis.prisma = { pendingFile: {
  createMany: async ({ data }) => { for (const { key } of data) pending.add(key); },
  deleteMany: async ({ where }) => { for (const key of where.key.in) pending.delete(key); },
} };
const { copyLocalCover, deleteLocalCover, storeLocalCover } = await import("./local-covers.ts");
const { ATTACHMENT_KEY, deleteStoredFiles, openStoredFile, THUMB_KEY } = await import("./file-store.ts");
const { coverThumbKey } = await import("../../features/events/cover-url.ts");
// Reads a stored file through the streaming API (the store has no read-into-memory call on purpose).
const readStoredFile = async (key) => { const file = await openStoredFile(key); return file ? Buffer.from(await new Response(file.body).arrayBuffer()) : null; };
test.after(() => rm(folder, { recursive: true, force: true }));

const photo = (width, height, format = "jpeg") => sharp({ create: { width, height, channels: 3, background: "#3a7" } })
  .withMetadata({ exif: { IFD0: { Make: "TestCam" } } })[format]().toBuffer();

test("a cover is stored as a ≤1600×900 WebP plus a 320×180 thumbnail, without the photo's metadata", async () => {
  const stored = await storeLocalCover(new File([await photo(4000, 2250)], "trip.jpg", { type: "image/jpeg" }));
  assert.equal(stored.ok, true);
  assert.match(stored.key, /^[0-9a-f-]{36}\.webp$/);
  const large = await sharp(await readStoredFile(stored.key)).metadata();
  const thumb = await sharp(await readStoredFile(coverThumbKey(stored.key))).metadata();
  assert.deepEqual([large.format, large.width, large.height, large.exif], ["webp", 1600, 900, undefined]);
  assert.deepEqual([thumb.format, thumb.width, thumb.height], ["webp", 320, 180]);
});

test("a small cover is not enlarged; copies and deletes take the thumbnail along", async () => {
  const stored = await storeLocalCover(new File([await photo(800, 450, "png")], "small.png", { type: "image/png" }));
  assert.equal((await sharp(await readStoredFile(stored.key)).metadata()).width, 800);
  const copy = await copyLocalCover(stored.key);
  assert.ok(await readStoredFile(coverThumbKey(copy)));
  await deleteLocalCover(stored.key);
  assert.equal(await readStoredFile(stored.key), null);
  assert.equal(await readStoredFile(coverThumbKey(stored.key)), null);
  assert.ok(await readStoredFile(copy), "deleting the original must not touch the copy");
});

test("non-images and wrong extensions are refused, and nothing is written", async () => {
  const before = (await readdir(folder)).length;
  assert.deepEqual(await storeLocalCover(new File([Buffer.from("%PDF-1.4 not an image")], "cover.jpg")), { ok: false, error: "cover-invalid" });
  assert.deepEqual(await storeLocalCover(new File([await photo(100, 100)], "cover.gif")), { ok: false, error: "cover-invalid" });
  // The signature decides: a PNG named .jpg never reaches the decoder.
  assert.deepEqual(await storeLocalCover(new File([await photo(100, 100, "png")], "cover.jpg")), { ok: false, error: "cover-invalid" });
  assert.equal((await readdir(folder)).length, before);
});

test("every write and copy is journaled; a delete releases the journal only once the file is gone", async () => {
  const stored = await storeLocalCover(new File([await photo(400, 225)], "j.jpg"));
  const copy = await copyLocalCover(stored.key);
  for (const key of [stored.key, coverThumbKey(stored.key), copy, coverThumbKey(copy)]) assert.ok(pending.has(key), key);
  await deleteLocalCover(copy);
  assert.equal(pending.has(copy) || pending.has(coverThumbKey(copy)), false);
  // A delete that fails (here: a folder where the file should be) leaves the key journaled for the orphan sweep.
  const stuck = "0b8e3f6e-1f5c-4d8a-9c1e-2f3a4b5c6d7e.pdf";
  await mkdir(join(folder, stuck));
  const other = await storeLocalCover(new File([await photo(400, 225)], "k.jpg"));
  await assert.rejects(deleteStoredFiles([stuck, other.key]), AggregateError);
  assert.ok(pending.has(stuck));
  assert.equal(await readStoredFile(other.key), null, "the other file is still deleted");
  assert.equal(pending.has(other.key), false);
  // Production without UPLOAD_DIR deletes nothing and keeps the records, so the files are found once it is set again.
  const kept = await storeLocalCover(new File([await photo(400, 225)], "u.jpg"));
  const nodeEnv = process.env.NODE_ENV;
  Object.assign(process.env, { NODE_ENV: "production", UPLOAD_DIR: "" });
  try { await deleteLocalCover(kept.key); } finally {
    process.env.UPLOAD_DIR = folder;
    if (nodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = nodeEnv;
  }
  assert.ok(pending.has(kept.key) && pending.has(coverThumbKey(kept.key)));
  assert.ok(await readStoredFile(kept.key));
  await rm(join(folder, stuck), { recursive: true });
});

test("only keys we generate are accepted: no paths, no other names", async () => {
  for (const key of ["../.env.local", "..\\x.pdf", "a.pdf", "0b8e3f6e-1f5c-4d8a-9c1e-2f3a4b5c6d7e.exe", "/etc/passwd"]) {
    assert.equal(ATTACHMENT_KEY.test(key) || THUMB_KEY.test(key), false, key);
    assert.equal(await openStoredFile(key), null, key);
  }
  assert.equal(THUMB_KEY.test("0b8e3f6e-1f5c-4d8a-9c1e-2f3a4b5c6d7e.thumb.webp"), true);
  assert.equal(THUMB_KEY.test("0b8e3f6e-1f5c-4d8a-9c1e-2f3a4b5c6d7e.thumb.pdf") || ATTACHMENT_KEY.test("0b8e3f6e-1f5c-4d8a-9c1e-2f3a4b5c6d7e.thumb.pdf"), false);
});

test("a stored file streams with its size", async () => {
  const stored = await storeLocalCover(new File([await photo(400, 225)], "s.jpg"));
  const file = await openStoredFile(stored.key);
  const bytes = Buffer.from(await new Response(file.body).arrayBuffer());
  assert.equal(bytes.length, file.size);
});

test("a file deleted after it was opened still sends completely (no 200 that breaks off)", async () => {
  const stored = await storeLocalCover(new File([await photo(400, 225)], "gone.jpg"));
  const file = await openStoredFile(stored.key);
  await deleteLocalCover(stored.key);
  assert.equal((await new Response(file.body).arrayBuffer()).byteLength, file.size);
  assert.equal(await openStoredFile(stored.key), null);
});
