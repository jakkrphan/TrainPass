import { randomBytes } from "node:crypto";

import { Prisma } from "@prisma/client";

import { readFileAnswers } from "@/features/events/registration-fields";
import { db } from "@/server/db";
import { coverThumbKey } from "@/features/events/cover-url";
import { deleteStoredFiles, isStoredKey } from "@/server/registrations/file-store";
import { fileStorageReady } from "@/server/registrations/upload-storage";
import { hashBearerCode } from "@/server/registrations/registration";

// Registration data is kept permanently: there is no time-based anonymization. Personal data is only removed when
// an organizer approves a registrant's own deletion request (data-requests.ts), which reuses anonymizedRegistrantData.
const DAY_MS = 24 * 60 * 60 * 1000;
const BATCH = 500;

/**
 * Deletes stored files nothing refers to any more: left by a crash between writing a file and saving its row, a failed
 * delete, or a cover replaced twice at once. Only keys in PendingFile are considered (every write, copy and delete
 * records one, see file-store.ts), so files this database did not write — another install's, or anything else in
 * UPLOAD_DIR — are never touched. A key is looked at once its record is a day old, so an upload still being saved is
 * safe: referenced keys just lose their record; covers (and thumbnails) of every event, deleted ones included, and every
 * registrant's attachments count as referenced. Returns how many files were deleted.
 */
export async function sweepOrphanFiles(now = new Date()) {
  if (!fileStorageReady()) return 0;
  const cutoff = new Date(now.getTime() - DAY_MS);
  let referenced: Set<string> | null = null;
  let deleted = 0;
  for (let cursor = ""; ;) {
    const batch = (await db.pendingFile.findMany({ where: { createdAt: { lt: cutoff }, key: { gt: cursor } }, select: { key: true }, orderBy: { key: "asc" }, take: BATCH })).map((row) => row.key);
    if (!batch.length) break;
    referenced ??= await referencedFileKeys();
    const orphans = batch.filter((key) => isStoredKey(key) && !referenced!.has(key));
    // A file that cannot be deleted stays recorded for the next run, without stopping this one (keys sort the same
    // every day, so a stuck one would otherwise block everything after it). Any other error (the database) stops the sweep.
    const failed = await deleteStoredFiles(orphans).then(() => 0, (error: unknown) => {
      if (!(error instanceof AggregateError)) throw error;
      const files = (error.errors as (NodeJS.ErrnoException & { key: string })[]).map((file) => `${file.key} (${file.code ?? file.name})`);
      console.error(`Orphan file sweep could not delete, kept for the next run: ${files.join(", ")}`);
      return files.length;
    });
    // Referenced keys just lose their record; so does a stray record that never named a file of ours.
    await db.pendingFile.deleteMany({ where: { key: { in: batch.filter((key) => referenced!.has(key) || !isStoredKey(key)) } } });
    deleted += orphans.length - failed;
    if (batch.length < BATCH) break;
    cursor = batch[batch.length - 1];
  }
  return deleted;
}

/** Every stored key some row still refers to: event covers with their thumbnails, and registrants' uploads. */
async function referencedFileKeys() {
  const referenced = new Set<string>();
  for (const event of await db.event.findMany({ where: { coverImageKey: { not: null } }, select: { coverImageKey: true } })) {
    referenced.add(event.coverImageKey!);
    const thumb = coverThumbKey(event.coverImageKey!);
    if (thumb) referenced.add(thumb);
  }
  // Only registrants whose answers hold an upload come back (MySQL searches the JSON), so most rows never leave the DB.
  for (let cursor = ""; ;) {
    const batch = await db.$queryRaw<{ id: string; answers: unknown }[]>`
      SELECT id, answers FROM Registrant
      WHERE anonymizedAt IS NULL AND id > ${cursor} AND JSON_SEARCH(answers, 'one', '%', NULL, '$**.storageKey') IS NOT NULL
      ORDER BY id LIMIT ${BATCH}`;
    for (const person of batch) for (const key of fileKeys(typeof person.answers === "string" ? JSON.parse(person.answers) : person.answers)) referenced.add(key);
    if (batch.length < BATCH) break;
    cursor = batch[batch.length - 1].id;
  }
  return referenced;
}

/** Every stored upload in an answers object: single-file objects, multi-file arrays, and keys of fields removed from the form. */
export function fileKeys(answers: unknown) {
  if (!answers || typeof answers !== "object" || Array.isArray(answers)) return [];
  return Object.values(answers as Record<string, unknown>).flatMap((value) => readFileAnswers(value).map((file) => file.storageKey));
}

/** Registrant columns after an approved deletion request: answers, contact details (email, LINE), consent IP, reasons, QR and status link go. */
export function anonymizedRegistrantData(now: Date) {
  return {
    answers: {}, displayName: null, email: null, dedupeKey: null, lineUserId: null, lineNotifiedDays: Prisma.DbNull, notifyVia: "EMAIL" as const, consentIp: null, rejectReason: null, qrCode: null,
    statusTokenHash: hashBearerCode(randomBytes(32).toString("base64url")), emailNotifiedHash: null, anonymizedAt: now,
  };
}
