import type { PrismaClient } from "@prisma/client";
import QRCode from "qrcode";

import { sendEmail } from "@/server/email/client";
import { buildAnnouncementEmail, buildEmailMessage, emailRecipientSelect, emailSnapshot } from "@/server/email/message";
import { withBasePath } from "@/lib/base-path";

const MAX_ATTEMPTS = 4;
const BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000];
type Outcome = "sent" | "failed" | "retry" | "skipped";

type DeliveryOptions = {
  enabled: boolean;
  origin: string | null;
  statusToken: (person: { id: string; statusTokenHash: string }) => string;
  send?: typeof sendEmail;
};

async function deliver(db: PrismaClient, id: string, options: DeliveryOptions): Promise<Outcome> {
  const notification = await db.notificationLog.findUniqueOrThrow({ where: { id }, select: { kind: true, attempts: true, retryKey: true, announcement: { select: { subject: true, body: true } }, registrant: { select: emailRecipientSelect } } });
  const person = notification.registrant;
  const finish = async (status: "SENT" | "FAILED" | "SKIPPED", error: string | null, snapshot?: string) => {
    await db.$transaction(async (tx) => {
      await tx.notificationLog.update({ where: { id }, data: { status, error, ...(status === "SENT" ? { sentAt: new Date() } : {}) } });
      if (snapshot) await tx.registrant.updateMany({ where: { id: person.id, anonymizedAt: null }, data: { emailNotifiedHash: snapshot } });
    });
  };
  if (!options.enabled) { await finish("SKIPPED", "EMAIL_DISABLED"); return "skipped"; }
  if (!person.email || person.anonymizedAt || person.event.deletedAt || person.event.anonymizedAt) {
    await finish("SKIPPED", "RECIPIENT_UNAVAILABLE"); return "skipped";
  }
  // An announcement row already went to the right channel when it was queued, and is not part of the status snapshot.
  const announcement = notification.kind === "announcement" ? notification.announcement : null;
  if (notification.kind === "announcement" && !announcement) { await finish("SKIPPED", "ANNOUNCEMENT_MISSING"); return "skipped"; }
  // Chose LINE and connected it: LINE carries the news; email only steps in when a LINE push fails (kind "fallback").
  // A LINE chooser who never connected still gets email.
  // An organizer's resend is explicit: it goes out even when LINE is the channel or nothing changed since the last email.
  const explicit = notification.kind === "resend" || !!announcement;
  if (!explicit && notification.kind !== "fallback" && person.notifyVia === "LINE" && person.lineUserId) { await finish("SKIPPED", "SENT_VIA_LINE"); return "skipped"; }
  const snapshot = announcement ? undefined : emailSnapshot(person);
  if (!explicit && snapshot === person.emailNotifiedHash) { await finish("SKIPPED", "NO_CHANGE"); return "skipped"; }
  const origin = options.origin;
  if (!origin) { await finish("FAILED", "APP_BASE_URL_INVALID"); return "failed"; }
  const url = `${origin}${withBasePath(`/events/${person.event.slug}/status/${options.statusToken(person)}`)}`;
  const message = announcement ? buildAnnouncementEmail(person, announcement, url) : buildEmailMessage(person, url);
  const qr = message.attachQr ? await QRCode.toBuffer(person.qrCode!, { type: "png", width: 512, margin: 2 }) : undefined;
  const result = await (options.send ?? sendEmail)({ to: person.email, ...message, qr, retryKey: notification.retryKey });
  if (result.ok) { await finish("SENT", null, snapshot); return "sent"; }
  if (result.retry && notification.attempts < MAX_ATTEMPTS) {
    await db.notificationLog.update({ where: { id }, data: { status: "QUEUED", error: result.error, nextAttemptAt: new Date(Date.now() + BACKOFF_MS[Math.min(notification.attempts - 1, BACKOFF_MS.length - 1)]) } });
    return "retry";
  }
  await finish("FAILED", result.error); return "failed";
}

/** Atomic claims prevent two workers from sending the same row. Stale claims recover after 5 minutes. */
export async function processEmailQueue(db: PrismaClient, options: DeliveryOptions, limit = 25, registrantId?: string) {
  const scope = { channel: "EMAIL" as const, ...(registrantId ? { registrantId } : {}) };
  await db.notificationLog.updateMany({ where: { ...scope, status: "SENDING", updatedAt: { lt: new Date(Date.now() - 5 * 60_000) } }, data: { status: "QUEUED" } });
  const due = await db.notificationLog.findMany({ where: { ...scope, status: "QUEUED", nextAttemptAt: { lte: new Date() } }, orderBy: { createdAt: "asc" }, take: limit, select: { id: true, attempts: true } });
  const totals: Record<Outcome, number> = { sent: 0, failed: 0, retry: 0, skipped: 0 };
  for (const { id, attempts } of due) {
    if (attempts >= MAX_ATTEMPTS) {
      const exhausted = await db.notificationLog.updateMany({ where: { id, status: "QUEUED", attempts: { gte: MAX_ATTEMPTS } }, data: { status: "FAILED", error: "RETRY_EXHAUSTED" } });
      totals.failed += exhausted.count;
      continue;
    }
    const claimed = await db.notificationLog.updateMany({ where: { id, status: "QUEUED", attempts: { lt: MAX_ATTEMPTS } }, data: { status: "SENDING", attempts: { increment: 1 } } });
    if (!claimed.count) continue;
    try { totals[await deliver(db, id, options)]++; }
    catch {
      const failed = attempts + 1 >= MAX_ATTEMPTS;
      await db.notificationLog.updateMany({ where: { id, status: "SENDING" }, data: { status: failed ? "FAILED" : "QUEUED", error: "INTERNAL_ERROR", nextAttemptAt: new Date(Date.now() + BACKOFF_MS[Math.min(attempts, BACKOFF_MS.length - 1)]) } });
      totals[failed ? "failed" : "retry"]++;
    }
  }
  return totals;
}
