import { randomUUID } from "node:crypto";

import type { Prisma } from "@prisma/client";
import { headers } from "next/headers";
import { after } from "next/server";

import { db } from "@/server/db";
import { lineConfigured, pushLineMessage } from "@/server/line/client";
import { buildLineAnnouncement, buildLineFlexMessage, type LineNotificationKind, recipientSelect, snapshotOf } from "@/server/line/message";
import { lineStatusToken } from "@/server/registrations/status-token";
import { isFeatureEnabled } from "@/server/settings/features";
import { withBasePath } from "@/lib/base-path";

// LINE notifications for registrants (spec 1.7 / 2.1), sent through the NotificationLog outbox:
//   linked  — right after the person connects LINE: a summary of every day and the status link
//   status  — something changed (approval, rejection, queue promotion, cancellation); only the changed days are told,
//             compared with Registrant.lineNotifiedDays, so any number of changes before delivery become one message
//   resend  — the organizer asks to send the summary again (rate-limited)
// Rows are queued inside the transaction that changes the status and delivered after the response; the
// /api/jobs/notifications job retries whatever is still due.

const MAX_ATTEMPTS = 4;
const BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000];
const RESEND_LIMIT_PER_HOUR = 3;

/** Queues a LINE message for a linked registrant (no-op otherwise) and schedules delivery after this request. */
export async function queueLineNotification(tx: Prisma.TransactionClient, registrant: { id: string; eventId: string }, kind: LineNotificationKind) {
  // One pending "what changed" message per person is enough: it is built from the latest state when sent.
  const pending = kind === "status" && await tx.notificationLog.findFirst({ where: { registrantId: registrant.id, channel: "LINE", status: "QUEUED", kind: { in: ["status", "linked"] } }, select: { id: true } });
  if (!pending) await tx.notificationLog.create({ data: { eventId: registrant.eventId, registrantId: registrant.id, channel: "LINE", kind, retryKey: randomUUID() } });
  scheduleLineDelivery();
}

/** Runs the outbox after the current response; outside a request (scripts) the notifications job picks it up. */
export function scheduleLineDelivery() {
  try { after(() => processLineNotifications()); } catch { /* not in a request scope */ }
}

/** The organizer's "send again": at most three per person per hour, so an OA's monthly quota cannot be burnt. */
export async function queueLineResend(registrant: { id: string; eventId: string }) {
  // Row lock: count-then-insert is atomic, so simultaneous clicks cannot exceed the limit.
  const queued = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM Registrant WHERE id = ${registrant.id} FOR UPDATE`;
    const recent = await tx.notificationLog.count({ where: { registrantId: registrant.id, channel: "LINE", kind: "resend", createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) } } });
    if (recent >= RESEND_LIMIT_PER_HOUR) return false;
    await queueLineNotification(tx, registrant, "resend");
    return true;
  });
  return queued ? "queued" as const : "rate-limited" as const;
}

async function publicOrigin() {
  if (process.env.APP_BASE_URL) return process.env.APP_BASE_URL.replace(/\/$/, "");
  try {
    const requestHeaders = await headers();
    const host = requestHeaders.get("host");
    if (host) return `${requestHeaders.get("x-forwarded-proto") ?? "http"}://${host}`;
  } catch { /* outside a request */ }
  return "http://localhost:3100";
}

type Outcome = "sent" | "failed" | "retry" | "skipped";

/**
 * Ends a LINE row and lets email take over in the same transaction, so the news still reaches the person.
 * An announcement hands over the same announcement; anything else becomes a status email ("fallback").
 */
async function handOverToEmail(notificationId: string, status: "SKIPPED" | "FAILED", error: string) {
  const { queueEmailAnnouncement, queueEmailNotification } = await import("@/server/email/notifications");
  await db.$transaction(async (tx) => {
    const row = await tx.notificationLog.update({ where: { id: notificationId }, data: { status, error }, select: { kind: true, announcementId: true, registrant: { select: { id: true, eventId: true, email: true, anonymizedAt: true } } } });
    const recipient = row.registrant;
    if (!recipient.email || recipient.anonymizedAt) return;
    if (row.kind === "announcement") { if (row.announcementId) await queueEmailAnnouncement(tx, recipient, row.announcementId); }
    else await queueEmailNotification(tx, recipient, "fallback");
  });
}

async function deliver(notificationId: string, enabled: boolean, origin: string): Promise<Outcome> {
  const notification = await db.notificationLog.findUniqueOrThrow({ where: { id: notificationId }, select: { kind: true, attempts: true, retryKey: true, announcement: { select: { subject: true, body: true } }, registrant: { select: recipientSelect } } });
  const person = notification.registrant;
  // Announcements are not part of the "what changed" snapshot, so they never touch lineNotifiedDays.
  const isAnnouncement = notification.kind === "announcement";
  const finish = (status: "SENT" | "FAILED" | "SKIPPED", error: string | null, snapshot?: boolean) => db.$transaction([
    db.notificationLog.update({ where: { id: notificationId }, data: { status, error, ...(status === "SENT" ? { sentAt: new Date() } : {}) } }),
    ...(snapshot && !isAnnouncement ? [db.registrant.update({ where: { id: person.id }, data: { lineNotifiedDays: snapshotOf(person) } })] : []),
  ]);
  // LINE was the chosen channel: with LINE off the news would reach nobody, so email takes over.
  if (!enabled) { await handOverToEmail(notificationId, "SKIPPED", "LINE ปิดอยู่หรือยังไม่ตั้งคีย์"); return "skipped"; }
  if (!person.lineUserId || person.anonymizedAt || person.event.deletedAt) { await finish("SKIPPED", "ไม่ได้เชื่อม LINE แล้ว"); return "skipped"; }
  const statusUrl = `${origin}${withBasePath(`/events/${person.event.slug}/status/${lineStatusToken(person)}`)}`;
  if (isAnnouncement && !notification.announcement) { await finish("SKIPPED", "ไม่พบประกาศ"); return "skipped"; }
  const message = notification.announcement && isAnnouncement
    ? buildLineAnnouncement(person, notification.announcement, statusUrl)
    : buildLineFlexMessage(notification.kind as LineNotificationKind, person, statusUrl);
  if (!message) { await finish("SKIPPED", "ไม่มีอะไรเปลี่ยน", true); return "skipped"; }
  const result = await pushLineMessage(person.lineUserId, message, notification.retryKey);
  if (result.ok) { await finish("SENT", null, true); return "sent"; }
  if (result.retry && notification.attempts < MAX_ATTEMPTS) {
    await db.notificationLog.update({ where: { id: notificationId }, data: { status: "QUEUED", error: result.error, nextAttemptAt: new Date(Date.now() + BACKOFF_MS[Math.min(notification.attempts - 1, BACKOFF_MS.length - 1)]) } });
    return "retry";
  }
  // The email worker skips a status already delivered via EMAIL/BOTH.
  await handOverToEmail(notificationId, "FAILED", result.error);
  return "failed";
}

/** After an unexpected error: try again later, or give up for good (and email) once the attempts are used up. */
async function retryOrGiveUp(id: string, attempts: number, error: string): Promise<Outcome> {
  if (attempts >= MAX_ATTEMPTS) {
    await handOverToEmail(id, "FAILED", error).catch(() => db.notificationLog.update({ where: { id }, data: { status: "FAILED", error } }));
    return "failed";
  }
  await db.notificationLog.update({ where: { id }, data: { status: "QUEUED", error, nextAttemptAt: new Date(Date.now() + BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)]) } });
  return "retry";
}

/** Delivers due LINE notifications; safe to run concurrently (each row is claimed before sending). */
export async function processLineNotifications(limit = 25) {
  const totals: Record<Outcome, number> = { sent: 0, failed: 0, retry: 0, skipped: 0 };
  // Rows left "sending" by a crashed process: back to the queue, or failed (and emailed) once out of attempts.
  const stale = await db.notificationLog.findMany({ where: { channel: "LINE", status: "SENDING", updatedAt: { lt: new Date(Date.now() - 5 * 60_000) } }, select: { id: true, attempts: true } });
  for (const row of stale) {
    const reclaimed = await db.notificationLog.updateMany({ where: { id: row.id, status: "SENDING" }, data: { status: "QUEUED" } });
    if (reclaimed.count) totals[await retryOrGiveUp(row.id, row.attempts, "interrupted").catch(() => "retry" as const)]++;
  }
  const due = await db.notificationLog.findMany({ where: { channel: "LINE", status: "QUEUED", nextAttemptAt: { lte: new Date() } }, orderBy: { createdAt: "asc" }, take: limit, select: { id: true, attempts: true } });
  if (!due.length) return totals;
  const enabled = lineConfigured() && await isFeatureEnabled("lineLogin");
  const origin = await publicOrigin();
  for (const { id, attempts } of due) {
    const claimed = await db.notificationLog.updateMany({ where: { id, status: "QUEUED" }, data: { status: "SENDING", attempts: { increment: 1 } } });
    if (!claimed.count) continue;
    try {
      totals[await deliver(id, enabled, origin)]++;
    } catch {
      totals[await retryOrGiveUp(id, attempts + 1, "internal error").catch(() => "retry" as const)]++;
    }
  }
  return totals;
}
