"use server";

import { randomUUID } from "node:crypto";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";

import { readRegistrationFields } from "@/features/events/registration-fields";
import { registrantDisplayName } from "@/features/registrations/display-name";
import { buildImport, IMPORT_MAX_BYTES, IMPORTED_CONSENT_VERSION, type ImportProblem, type ImportTarget, parseCsv } from "@/features/registrations/import";
import { requireEventAccess } from "@/server/authorization/event";
import { db } from "@/server/db";
import { hashBearerCode, newBearerCode } from "@/server/registrations/registration";

const IMPORT_BATCH = 500;

export type ImportState = { ok: true; count: number } | { ok: false; problems: ImportProblem[] } | null;

/**
 * "นำเข้ารายชื่อ": everyone in the CSV becomes an approved registrant on the days given, keeping their ticket ID as
 * the QR code they already hold. All or nothing. No message is sent — organizers send email per person when ready.
 */
export async function importRegistrants(eventId: string, _previous: ImportState, formData: FormData): Promise<ImportState> {
  const { user, event, membership } = await requireEventAccess(eventId, "manage");
  // Admins only (the page and its button are hidden from everyone else too).
  if (membership.systemRole !== "admin") notFound();
  if (event.anonymizedAt) return { ok: false, problems: [{ row: 0, message: "โครงการนี้ลบข้อมูลส่วนบุคคลตามระยะเก็บแล้ว" }] };
  const csv = formData.get("csv");
  let targets: ImportTarget[];
  try { targets = JSON.parse(String(formData.get("targets") ?? "[]")) as ImportTarget[]; } catch { targets = []; }
  // Bytes, as the browser measures the file (Thai text is 3 bytes a character in UTF-8, 1 UTF-16 unit).
  if (typeof csv !== "string" || Buffer.byteLength(csv, "utf8") > IMPORT_MAX_BYTES || !Array.isArray(targets) || targets.some((target) => typeof target !== "string")) {
    return { ok: false, problems: [{ row: 0, message: "ไฟล์ใหญ่เกิน 2 MB หรือข้อมูลไม่ครบ" }] };
  }
  const fields = readRegistrationFields(event.fields);
  const days = await db.eventDay.findMany({ where: { eventId }, orderBy: { date: "asc" }, select: { id: true, date: true } });
  const built = buildImport({ rows: parseCsv(csv), targets, fields, days, seatMode: event.seatMode });
  if (built.problems.length) return { ok: false, problems: built.problems.slice(0, 50) };

  // Ticket IDs are QR codes, unique across every event; emails are each registrant's duplicate guard in this event.
  // MySQL compares qrCode ignoring case (utf8mb4_unicode_ci), so the lookup finds REG-1A for reg-1a; compare the same way here.
  const tickets = built.items.map((item) => item.ticket);
  const emails = built.items.flatMap((item) => item.email ? [item.email] : []);
  const [takenCodes, takenEmails] = await Promise.all([
    db.registrant.findMany({ where: { qrCode: { in: tickets } }, select: { qrCode: true, eventId: true } }),
    emails.length ? db.registrant.findMany({ where: { eventId, dedupeKey: { in: emails } }, select: { dedupeKey: true } }) : [],
  ]);
  const problems: ImportProblem[] = [];
  for (const item of built.items) {
    const code = takenCodes.find((taken) => taken.qrCode?.toLowerCase() === item.ticket.toLowerCase());
    if (code) problems.push({ row: item.row, message: `Ticket ID ${item.ticket} มีในระบบแล้ว${code.eventId === eventId ? " (นำเข้าไปแล้วหรือซ้ำกับผู้ลงทะเบียนเดิม)" : " (ในโครงการอื่น)"}` });
    if (item.email && takenEmails.some((taken) => taken.dedupeKey === item.email)) problems.push({ row: item.row, message: "อีเมลนี้ลงทะเบียนโครงการนี้ไว้แล้ว" });
  }
  if (problems.length) return { ok: false, problems: problems.slice(0, 50) };

  try {
    const imported = await db.$transaction(async (tx) => {
      // Same lock as form, schedule and project edits take, so none of them can change the event mid-import; the
      // rows were checked against the form read above, so a form edited since then sends the organizer back to check.
      await tx.$queryRaw(Prisma.sql`SELECT id FROM Event WHERE id = ${eventId} FOR UPDATE`);
      const current = await tx.event.findUniqueOrThrow({ where: { id: eventId }, select: { fieldsVersion: true } });
      if (current.fieldsVersion !== event.fieldsVersion) return false;
      const now = new Date();
      // Ids are made here so registrants and their days go in as two bulk inserts per batch, not one round trip per
      // person: a 3,000-row sheet finishes in seconds instead of approaching the transaction timeout.
      const rows = built.items.map((item) => ({ id: randomUUID(), item }));
      for (let start = 0; start < rows.length; start += IMPORT_BATCH) {
        const batch = rows.slice(start, start + IMPORT_BATCH);
        await tx.registrant.createMany({ data: batch.map(({ id, item }) => ({
          id, eventId, email: item.email, dedupeKey: item.email, answers: item.answers, displayName: registrantDisplayName(fields, item.answers),
          fieldsVersion: event.fieldsVersion, status: "APPROVED" as const, notifyVia: "EMAIL" as const,
          // Consent was given in the other system; this marks the person as imported (consentedAt stays empty).
          consentVersion: IMPORTED_CONSENT_VERSION, approvedAt: now, approvedById: user.id,
          qrCode: item.ticket, statusTokenHash: hashBearerCode(newBearerCode()),
        })) });
        await tx.registrantEventDay.createMany({ data: batch.flatMap(({ id, item }) => item.dayIds.map((eventDayId) => ({ registrantId: id, eventDayId, status: "APPROVED" as const }))) });
      }
      // Counts only: no names, emails or ticket IDs in the audit trail.
      await tx.auditLog.create({ data: { eventId, actorId: user.id, action: "REGISTRANTS_IMPORTED", metadata: { count: built.items.length, source: "csv" } } });
      return true;
    }, { timeout: 120_000, maxWait: 10_000 });
    if (!imported) return { ok: false, problems: [{ row: 0, message: "ฟอร์มของโครงการถูกแก้ระหว่างนี้ — โหลดหน้าใหม่แล้วตรวจการจับคู่คอลัมน์อีกครั้ง" }] };
  } catch (error) {
    // Someone added the same ticket or email between the check and the insert: nothing was stored.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return { ok: false, problems: [{ row: 0, message: "มี Ticket ID หรืออีเมลซ้ำกับข้อมูลที่เพิ่งเพิ่มเข้าระบบ — ลองนำเข้าอีกครั้ง" }] };
    throw error;
  }
  revalidatePath(`/organizer/${eventId}`, "layout");
  return { ok: true, count: built.items.length };
}
