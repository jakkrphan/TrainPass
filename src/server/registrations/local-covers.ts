import { randomUUID } from "node:crypto";

import sharp from "sharp";

import type { CoverError } from "@/features/events/cover-errors";
import { coverThumbKey } from "@/features/events/cover-url";
import { copyStoredFile, COVER_KEY, deleteStoredFiles, putFile } from "@/server/registrations/file-store";
import { fileStorageReady } from "@/server/registrations/upload-storage";

// Cover images. The organizer's browser already crops to 16:9 at 1600×900, but the server re-encodes every upload
// anyway: WebP is smaller, metadata (GPS, camera) is dropped, and a file sent without the cropper is still sized
// sensibly. Each cover is stored twice: `<uuid>.webp` (event page) and `<uuid>.thumb.webp` (lists).
// Covers stored before this (`<uuid>.jpg|png|webp`, no thumbnail) are still served as they are.

const maxCoverBytes = 3 * 1024 * 1024;
const LARGE = { width: 1600, height: 900 };
const THUMB = { width: 320, height: 180 };


/** The image type from the file's first bytes (its signature), whatever its name says. */
function sniffImage(bytes: Buffer): "jpg" | "png" | "webp" | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") return "webp";
  return null;
}

const refuse = (error: CoverError) => ({ ok: false as const, error });

export async function storeLocalCover(value: FormDataEntryValue | null) {
  if (!(value instanceof File) || value.size === 0) return { ok: true as const, key: null };
  if (!fileStorageReady()) {
    console.error("Cover upload refused: UPLOAD_DIR is not set, so this server has no file storage.");
    return refuse("cover-storage");
  }
  if (value.size > maxCoverBytes) return refuse("cover-too-large");

  const bytes = Buffer.from(await value.arrayBuffer());
  // Only a real JPEG/PNG/WebP whose name agrees reaches the image decoder.
  const type = sniffImage(bytes);
  const declared = value.name.split(".").pop()?.toLowerCase() ?? "";
  if (!type || !(type === "jpg" ? ["jpg", "jpeg"] : [type]).includes(declared)) return refuse("cover-invalid");

  let large: Buffer;
  let thumb: Buffer;
  try {
    // limitInputPixels guards against "decompression bombs"; rotate() applies the photo's orientation before metadata is dropped.
    const image = sharp(bytes, { limitInputPixels: 40_000_000, failOn: "error" }).rotate();
    [large, thumb] = await Promise.all([
      image.clone().resize({ ...LARGE, fit: "inside", withoutEnlargement: true }).webp({ quality: 80 }).toBuffer(),
      image.clone().resize({ ...THUMB, fit: "cover" }).webp({ quality: 70 }).toBuffer(),
    ]);
  } catch (error) {
    // Usually not an image sharp can read; logged because a broken sharp install on the server fails the same way.
    console.error("Cover image could not be processed:", error);
    return refuse("cover-invalid");
  }

  const key = `${randomUUID()}.webp`;
  await putFile(key, large);
  try { await putFile(coverThumbKey(key)!, thumb); } catch (error) { await deleteStoredFiles([key]); throw error; }
  return { ok: true as const, key };
}

export async function deleteLocalCover(key: string | null | undefined) {
  if (!key || !COVER_KEY.test(key)) return;
  await deleteStoredFiles([key, coverThumbKey(key)]);
}

/** Copies a cover (and its thumbnail) to a new key so a cloned event never shares (and loses) the original's image. */
export async function copyLocalCover(key: string | null | undefined) {
  if (!key || !COVER_KEY.test(key)) return null;
  const copy = `${randomUUID()}.${key.split(".").pop()}`;
  if (!await copyStoredFile(key, copy)) return null;
  const thumb = coverThumbKey(key);
  // A missing source thumbnail is fine (the route falls back to the full image); a failed copy must not leave the large copy behind.
  // Both copies go on failure: the thumbnail may be half written.
  if (thumb) try { await copyStoredFile(thumb, coverThumbKey(copy)!); } catch (error) { await deleteStoredFiles([copy, coverThumbKey(copy)]); throw error; }
  return copy;
}
