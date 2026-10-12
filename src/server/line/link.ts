import { Prisma } from "@prisma/client";
import { cookies, headers } from "next/headers";

import { db } from "@/server/db";
import { queueEmailAnnouncement, queueEmailNotification } from "@/server/email/notifications";
import { lineAuthorizeUrl, lineCallbackUrl, lineConfigured } from "@/server/line/client";
import { encodeLineLinkState, LINE_LINK_COOKIE, LINE_LINK_MAX_AGE, lineNonceFor, newLineLinkState, verifyLineState, type LineLinkState } from "@/server/line/link-state";
import { cancelDuplicateRegistration } from "@/server/registrations/lifecycle";
import { queueLineNotification } from "@/server/line/notifications";
import { lineStatusToken, statusTokenWhere } from "@/server/registrations/status-token";
import { isFeatureEnabled } from "@/server/settings/features";
import { withBasePath } from "@/lib/base-path";

/** LINE is offered only when the admin switch is on and both channels have their keys. */
export async function lineAvailable() {
  return lineConfigured() && await isFeatureEnabled("lineLogin");
}

/** The registrant behind a status link, if they may (dis)connect LINE: event live, not anonymised, not cancelled/rejected. */
export async function lineLinkTarget(slug: string, token: string) {
  const registrant = await db.registrant.findUnique({
    where: await statusTokenWhere(token),
    select: { id: true, eventId: true, status: true, anonymizedAt: true, lineUserId: true, notifyVia: true, email: true, event: { select: { slug: true, deletedAt: true } } },
  });
  if (!registrant || registrant.event.slug !== slug || registrant.event.deletedAt || registrant.anonymizedAt) return null;
  return registrant;
}

/**
 * Stores the verified LINE user, makes LINE the channel and queues a first message with the current status.
 * Someone without an email is kept from registering twice by their LINE account (`line:<userId>`, as the spec's dedupeKey).
 */
export async function linkLineAccount(registrantId: string, lineUserId: string): Promise<{ result: "linked" } | { result: "duplicate"; original: { id: string; statusTokenHash: string } | null }> {
  try {
    await db.$transaction(async (tx) => {
      const current = await tx.registrant.findUniqueOrThrow({ where: { id: registrantId }, select: { email: true, dedupeKey: true } });
      const person = await tx.registrant.update({
        where: { id: registrantId },
        data: { lineUserId, notifyVia: "LINE", lineNotifiedDays: Prisma.DbNull, ...(!current.email && current.dedupeKey === null ? { dedupeKey: `line:${lineUserId}` } : {}) },
        select: { id: true, eventId: true },
      });
      await queueLineNotification(tx, person, "linked");
    });
    return { result: "linked" };
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error;
  }
  // This LINE account already holds a registration for the event: the new one would only hold seats nobody is told about,
  // so it is cancelled (seats go to the waitlist) and the person is shown the registration they already have.
  await cancelDuplicateRegistration(registrantId);
  const person = await db.registrant.findUniqueOrThrow({ where: { id: registrantId }, select: { eventId: true } });
  const original = await db.registrant.findUnique({ where: { eventId_dedupeKey: { eventId: person.eventId, dedupeKey: `line:${lineUserId}` } }, select: { id: true, statusTokenHash: true } });
  return { result: "duplicate", original };
}

/**
 * Switches the person to email (disconnecting LINE if connected) and emails the current status unless email already has it.
 * Someone who registered with LINE only gives their email here; it becomes their duplicate guard while registered.
 */
export async function unlinkLineAccount(registrant: { id: string; eventId: string }, newEmail?: string): Promise<"switched" | "duplicate"> {
  try {
    await db.$transaction(async (tx) => {
      const current = await tx.registrant.findUniqueOrThrow({ where: { id: registrant.id }, select: { email: true, status: true } });
      // Cancelled/rejected registrations carry no guard (day-status clears it), so only active ones take the email as theirs.
      const active = ["PENDING", "APPROVED", "WAITLISTED"].includes(current.status);
      const person = await tx.registrant.update({
        where: { id: registrant.id },
        data: {
          lineUserId: null, notifyVia: "EMAIL", lineNotifiedDays: Prisma.DbNull,
          ...(!current.email && newEmail ? { email: newEmail, ...(active ? { dedupeKey: newEmail } : {}) } : {}),
        },
        select: { id: true, eventId: true, email: true },
      });
      // Announcements still waiting for LINE move to email; status news is covered by the status email below.
      const announcements = await tx.notificationLog.findMany({ where: { registrantId: registrant.id, channel: "LINE", status: "QUEUED", kind: "announcement", announcementId: { not: null } }, select: { announcementId: true } });
      await tx.notificationLog.updateMany({ where: { registrantId: registrant.id, channel: "LINE", status: "QUEUED" }, data: { status: "SKIPPED", error: "ผู้สมัครเลิกรับทาง LINE" } });
      if (person.email) {
        await queueEmailNotification(tx, person, "fallback");
        for (const { announcementId } of announcements) await queueEmailAnnouncement(tx, person, announcementId!);
      }
    });
    return "switched";
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return "duplicate";
    throw error;
  }
}

/**
 * Starts LINE Login for a registrant: stores the signed state cookie and returns LINE's authorize URL.
 * /api/line/callback verifies it and sends the person back to `returnPath`.
 */
export async function lineLoginUrl(registrantId: string, returnPath: string) {
  const redirectUri = await requestCallbackUrl();
  const state = newLineLinkState(registrantId, returnPath, redirectUri);
  (await cookies()).set(LINE_LINK_COOKIE, encodeLineLinkState(state), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: withBasePath("/api/line"), maxAge: LINE_LINK_MAX_AGE });
  return lineAuthorizeUrl({ redirectUri, state: state.state, nonce: state.nonce });
}

/** The callback URL for the host this request came in on; the authorize request and the code exchange must agree. */
async function requestCallbackUrl() {
  const requestHeaders = await headers();
  return lineCallbackUrl(`${requestHeaders.get("x-forwarded-proto") ?? "http"}://${requestHeaders.get("host")}`);
}

/**
 * The attempt behind a callback that arrived without the state cookie (LINE's in-app browser), rebuilt from the
 * signed `state`. It returns to the registrant's LINE-signed status link, since the bearer code is not in the state.
 * `state` is not secret, so the callback may use that returnPath only after the LINE login itself is verified.
 */
export async function lineLinkFromState(state: string | null): Promise<LineLinkState | null> {
  const verified = verifyLineState(state);
  if (!verified || !state) return null;
  const registrant = await db.registrant.findUnique({ where: { id: verified.registrantId }, select: { id: true, statusTokenHash: true, event: { select: { slug: true } } } });
  if (!registrant) return null;
  return {
    state,
    nonce: lineNonceFor(state),
    registrantId: registrant.id,
    returnPath: `/events/${registrant.event.slug}/status/${lineStatusToken(registrant)}`,
    redirectUri: await requestCallbackUrl(),
    expiresAt: verified.expiresAt,
  };
}
