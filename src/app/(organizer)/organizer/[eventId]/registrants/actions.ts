"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requireEventAccess } from "@/server/authorization/event";
import { requiresAdminAudit } from "@/server/authorization/policy";
import { db } from "@/server/db";
import { emailConfigured } from "@/server/email/client";
import { queueEmailResend } from "@/server/email/notifications";
import { lineAvailable } from "@/server/line/link";
import { queueLineResend } from "@/server/line/notifications";
import { getSeatAvailability, seatsTaken, syncRegistrantStatus } from "@/server/registrations/day-status";
import { completeDeletionRequest, rejectDeletionRequest } from "@/server/registrations/data-requests";
import { lockEventDays, promoteNextManually, promoteWaitlist } from "@/server/registrations/lifecycle";
import { hashBearerCode, newBearerCode } from "@/server/registrations/registration";
import { isFeatureEnabled } from "@/server/settings/features";

/** Returns to the list view the organizer acted from (filters + selected person), adding the result flags. */
function backTo(eventId: string, formData: FormData | undefined, flags: Record<string, string | number | undefined>) {
  const base = `/organizer/${eventId}/registrants`;
  const raw = formData?.get("returnTo");
  const url = new URL(typeof raw === "string" && (raw === base || raw.startsWith(`${base}?`)) ? raw : base, "http://local");
  for (const key of ["result", "approved", "requested", "held", "skipped"]) url.searchParams.delete(key);
  for (const [key, value] of Object.entries(flags)) if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
  return `${url.pathname}${url.search}`;
}

export async function decideRegistrant(eventId: string, registrantId: string, decision: "approve" | "reject" | "cancel", formData?: FormData) {
  const { user, membership } = await requireEventAccess(eventId, "manage");
  const rawReason = decision === "reject" ? formData?.get("reason") : null;
  const rejectReason = typeof rawReason === "string" && rawReason.trim() ? rawReason.trim().slice(0, 500) : null;
  let result = "updated";
  let approvedDays = 0;
  let requestedDays = 0;
  try {
    await db.$transaction(async (tx) => {
      await lockEventDays(tx, eventId);
      const event = await tx.event.findUniqueOrThrow({ where: { id: eventId }, select: { id: true, seatMode: true, maxSeats: true } });
      const registrant = await tx.registrant.findFirst({
        where: { id: registrantId, eventId },
        include: { days: { select: { id: true, eventDayId: true, status: true, eventDay: { select: { maxSeats: true } } } } },
      });
      if (!registrant) { result = "missing"; return; }
      if (event.seatMode === "whole_course") {
        if (decision === "approve") {
          if (registrant.status !== "PENDING" && registrant.status !== "WAITLISTED") { result = "invalid"; return; }
          const availability = await getSeatAvailability(tx, event, []);
          if (registrant.status === "WAITLISTED" && availability.mode === "whole_course" && availability.remaining === 0) { result = "full"; return; }
          requestedDays = registrant.days.length;
          approvedDays = requestedDays;
          await tx.registrantEventDay.updateMany({ where: { registrantId }, data: { status: "APPROVED", waitlistedAt: null, pendingSince: null } });
          await tx.registrant.update({ where: { id: registrantId }, data: { approvedById: user.id } });
        } else {
          const status = decision === "reject" ? "REJECTED" : "CANCELLED";
          if (decision === "reject" && registrant.status !== "PENDING" && registrant.status !== "WAITLISTED") { result = "invalid"; return; }
          if (decision === "cancel" && registrant.status !== "APPROVED") { result = "invalid"; return; }
          if (decision === "cancel" && await tx.checkIn.count({ where: { registrantId, voidedAt: null } })) { result = "invalid"; return; }
          await tx.registrantEventDay.updateMany({ where: { registrantId }, data: { status, waitlistedAt: null, pendingSince: null } });
          if (decision === "reject") await tx.registrant.update({ where: { id: registrantId }, data: { rejectReason } });
        }
        await syncRegistrantStatus(tx, registrantId);
        if (decision !== "approve") await promoteWaitlist(tx, eventId);
        if (requiresAdminAudit(membership)) await tx.auditLog.create({ data: { eventId, actorId: user.id, action: "REGISTRANT_UPDATED_BY_ADMIN", target: registrantId, metadata: { decision } } });
        return;
      }
      if (decision === "approve") {
        for (const day of registrant.days) {
          if (day.status !== "PENDING" && day.status !== "WAITLISTED") continue;
          requestedDays++;
          if (day.status === "PENDING" || (day.status === "WAITLISTED" && (day.eventDay.maxSeats === null || (await seatsTaken(tx, day.eventDayId)) < day.eventDay.maxSeats))) {
            await tx.registrantEventDay.update({ where: { id: day.id }, data: { status: "APPROVED", waitlistedAt: null, pendingSince: null } });
            approvedDays++;
          }
        }
        if (!approvedDays) { result = requestedDays ? "full" : "invalid"; return; }
        await tx.registrant.update({ where: { id: registrantId }, data: { approvedById: user.id } });
      } else if (decision === "reject") {
        const updated = await tx.registrantEventDay.updateMany({ where: { registrantId, status: { in: ["PENDING", "WAITLISTED"] } }, data: { status: "REJECTED", waitlistedAt: null, pendingSince: null } });
        if (!updated.count) { result = "invalid"; return; }
        await tx.registrant.update({ where: { id: registrantId }, data: { rejectReason } });
      } else {
        const updated = await tx.registrantEventDay.updateMany({ where: { registrantId, status: "APPROVED" }, data: { status: "CANCELLED", pendingSince: null } });
        if (!updated.count) { result = "invalid"; return; }
      }
      await syncRegistrantStatus(tx, registrantId);
      if (decision === "approve" && approvedDays < requestedDays) result = "partial";
      if (decision !== "approve") await promoteWaitlist(tx, eventId);
      if (requiresAdminAudit(membership)) await tx.auditLog.create({ data: { eventId, actorId: user.id, action: "REGISTRANT_UPDATED_BY_ADMIN", target: registrantId, metadata: { decision } } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") result = "retry";
    else throw error;
  }
  revalidatePath(`/organizer/${eventId}/registrants`);
  redirect(backTo(eventId, formData, { result, approved: requestedDays ? approvedDays : undefined, requested: requestedDays || undefined }));
}

/**
 * Bulk approval of pending registrants. Each person is handled on their own so one changed status does not block
 * the rest; the result lists (by id, never by name) who stayed queued because a day or the course was full and who
 * was skipped because their status had already changed.
 */
export async function approveSelected(eventId: string, formData: FormData) {
  const { user, membership } = await requireEventAccess(eventId, "manage");
  const ids = formData.getAll("registrantId").filter((value): value is string => typeof value === "string" && !!value);
  if (!ids.length || ids.length > 100 || new Set(ids).size !== ids.length) redirect(backTo(eventId, formData, { result: "invalid" }));
  const outcome = await db.$transaction(async (tx) => {
    await lockEventDays(tx, eventId);
    const event = await tx.event.findUniqueOrThrow({ where: { id: eventId }, select: { id: true, seatMode: true, maxSeats: true } });
    // Same people as the "รออนุมัติ" tab: pending overall, or approved for one day and still pending for another.
    const pending = new Set((await tx.registrant.findMany({
      where: { eventId, id: { in: ids }, status: { notIn: ["CANCELLED", "REJECTED"] }, OR: [{ status: "PENDING" }, { days: { some: { status: "PENDING" } } }] },
      select: { id: true },
    })).map((person) => person.id));
    const approved: string[] = [];
    const held: string[] = [];
    const skipped = ids.filter((id) => !pending.has(id));
    for (const id of ids.filter((item) => pending.has(item))) {
      const days = await tx.registrantEventDay.findMany({ where: { registrantId: id, status: { in: ["PENDING", "WAITLISTED"] } }, select: { id: true, eventDayId: true, status: true, eventDay: { select: { maxSeats: true } } } });
      let stillQueued = false;
      if (event.seatMode === "whole_course") {
        const availability = await getSeatAvailability(tx, event, []);
        if (availability.mode === "whole_course" && availability.remaining === 0 && days.some((day) => day.status === "WAITLISTED")) { held.push(id); continue; }
        await tx.registrantEventDay.updateMany({ where: { registrantId: id }, data: { status: "APPROVED", waitlistedAt: null, pendingSince: null } });
      } else {
        for (const day of days) {
          if (day.status === "WAITLISTED" && day.eventDay.maxSeats !== null && (await seatsTaken(tx, day.eventDayId)) >= day.eventDay.maxSeats) { stillQueued = true; continue; }
          await tx.registrantEventDay.update({ where: { id: day.id }, data: { status: "APPROVED", waitlistedAt: null, pendingSince: null } });
        }
      }
      await tx.registrant.update({ where: { id }, data: { approvedById: user.id } });
      await syncRegistrantStatus(tx, id);
      (stillQueued ? held : approved).push(id);
    }
    if (requiresAdminAudit(membership)) await tx.auditLog.create({ data: { eventId, actorId: user.id, action: "REGISTRANTS_APPROVED_BY_ADMIN", target: ids.join(","), metadata: { approved: approved.length, held: held.length, skipped: skipped.length } } });
    return { approved, held, skipped };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  revalidatePath(`/organizer/${eventId}/registrants`);
  redirect(backTo(eventId, formData, {
    result: outcome.held.length || outcome.skipped.length ? "bulk-partial" : "bulk",
    approved: outcome.approved.length, requested: ids.length,
    held: outcome.held.join(",") || undefined, skipped: outcome.skipped.join(",") || undefined,
  }));
}

/** Manual waitlist promotion: moves the next person in one queue (a day, or the whole course when dayId is empty) up. */
export async function promoteFromWaitlist(eventId: string, formData: FormData) {
  const { user } = await requireEventAccess(eventId, "manage");
  const rawDay = formData.get("dayId");
  const eventDayId = typeof rawDay === "string" && rawDay ? rawDay : null;
  let promoted: string | null = null;
  try {
    promoted = await db.$transaction(async (tx) => {
      const id = await promoteNextManually(tx, eventId, eventDayId);
      if (id) await tx.auditLog.create({ data: { eventId, actorId: user.id, action: "WAITLIST_PROMOTED_MANUALLY", target: id, metadata: { eventDayId } } });
      return id;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034")) throw error;
    redirect(backTo(eventId, formData, { result: "retry" }));
  }
  revalidatePath(`/organizer/${eventId}`, "layout");
  const back = formData.get("returnTo");
  const dashboard = `/organizer/${eventId}/dashboard`;
  if (back === dashboard) redirect(`${dashboard}?promoted=${promoted ? "1" : "0"}`);
  redirect(backTo(eventId, formData, { result: promoted ? "promoted" : "promote-none", selected: promoted ?? undefined }));
}

export async function decideRegistrantDay(eventId: string, registrantId: string, eventDayId: string, decision: "approve" | "reject" | "cancel", formData?: FormData) {
  const { user, membership } = await requireEventAccess(eventId, "manage");
  const event = await db.event.findUniqueOrThrow({ where: { id: eventId }, select: { seatMode: true } });
  if (event.seatMode === "whole_course") redirect(backTo(eventId, formData, { result: "invalid" }));
  let result = "updated";
  await db.$transaction(async (tx) => {
    await lockEventDays(tx, eventId);
    const row = await tx.registrantEventDay.findFirst({
      where: { registrantId, eventDayId, registrant: { eventId } },
      select: { id: true, status: true, eventDay: { select: { maxSeats: true } } },
    });
    if (!row) { result = "missing"; return; }
    if (decision === "approve") {
      if (row.status !== "PENDING" && row.status !== "WAITLISTED") { result = "invalid"; return; }
      if (row.status === "WAITLISTED" && row.eventDay.maxSeats !== null && (await seatsTaken(tx, eventDayId)) >= row.eventDay.maxSeats) { result = "full"; return; }
      await tx.registrantEventDay.update({ where: { id: row.id }, data: { status: "APPROVED", waitlistedAt: null, pendingSince: null } });
      await tx.registrant.update({ where: { id: registrantId }, data: { approvedById: user.id } });
    } else if (decision === "reject") {
      if (row.status !== "PENDING" && row.status !== "WAITLISTED") { result = "invalid"; return; }
      await tx.registrantEventDay.update({ where: { id: row.id }, data: { status: "REJECTED", waitlistedAt: null, pendingSince: null } });
    } else {
      if (row.status !== "APPROVED") { result = "invalid"; return; }
      await tx.registrantEventDay.update({ where: { id: row.id }, data: { status: "CANCELLED", pendingSince: null } });
    }
    await syncRegistrantStatus(tx, registrantId);
    if (decision !== "approve") await promoteWaitlist(tx, eventId);
    if (requiresAdminAudit(membership)) await tx.auditLog.create({ data: { eventId, actorId: user.id, action: "REGISTRANT_DAY_UPDATED_BY_ADMIN", target: row.id, metadata: { decision } } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  revalidatePath(`/organizer/${eventId}/registrants`);
  redirect(backTo(eventId, formData, { result }));
}

export async function reissueStatusLink(eventId: string, registrantId: string, formData: FormData) {
  const { event, user } = await requireEventAccess(eventId, "manage");
  if (formData.get("confirm") !== "on") redirect(backTo(eventId, formData, { result: "confirm" }));
  const token = newBearerCode();
  const person = await db.$transaction(async (tx) => {
    const current = await tx.registrant.findFirst({ where: { id: registrantId, eventId }, select: { id: true } });
    if (!current) return null;
    await tx.registrant.update({ where: { id: registrantId }, data: { statusTokenHash: hashBearerCode(token) } });
    await tx.auditLog.create({ data: { eventId, actorId: user.id, action: "STATUS_LINK_REISSUED", target: registrantId } });
    return current;
  });
  if (!person) redirect(backTo(eventId, formData, { result: "missing" }));
  redirect(`/events/${event.slug}/status/${token}`);
}

/** Completes (anonymizes) or declines a registrant's PDPA deletion request. */
export async function resolveDeletionRequest(eventId: string, requestId: string, decision: "complete" | "reject", formData: FormData) {
  const { user } = await requireEventAccess(eventId, "manage");
  let result: string;
  if (decision === "complete") {
    if (formData.get("confirm") !== "on") redirect(backTo(eventId, formData, { result: "delete-confirm" }));
    result = (await completeDeletionRequest(eventId, requestId, user.id)) === "completed" ? "deleted" : "invalid";
  } else {
    const outcome = await rejectDeletionRequest(eventId, requestId, user.id, formData.get("note"));
    result = outcome === "rejected" ? "delete-rejected" : outcome === "note" ? "delete-note" : "invalid";
  }
  revalidatePath(`/organizer/${eventId}`, "layout");
  redirect(backTo(eventId, formData, { result }));
}

/**
 * "ส่งอีเมลอีกครั้ง" (spec: resend, with the chance to fix a mistyped address first): emails the current result and QR,
 * at most three per person per hour. A changed address becomes the person's duplicate guard while they are registered.
 */
export async function resendEmailNotification(eventId: string, registrantId: string, formData: FormData) {
  const { user } = await requireEventAccess(eventId, "manage");
  if (!emailConfigured() || !(await isFeatureEnabled("emailNotifications"))) redirect(backTo(eventId, formData, { result: "email-unavailable" }));
  const parsed = z.email().max(191).safeParse(formData.get("email")?.toString().trim().toLowerCase());
  if (!parsed.success) redirect(backTo(eventId, formData, { result: "email-invalid" }));
  const email = parsed.data;
  let person: { id: string; eventId: string } | null;
  try {
    person = await db.$transaction(async (tx) => {
      const current = await tx.registrant.findFirst({ where: { id: registrantId, eventId, anonymizedAt: null }, select: { id: true, eventId: true, email: true, dedupeKey: true, status: true } });
      if (!current) return null;
      if (current.email !== email) {
        // The guard follows the email unless it is a LINE one (line:<id>); cancelled/rejected people have none.
        // (A LINE-only person has email null; a null guard then must not count as "the guard is the email".)
        const guarded = (current.email !== null && current.dedupeKey === current.email) || (current.dedupeKey === null && ["PENDING", "APPROVED", "WAITLISTED"].includes(current.status));
        await tx.registrant.update({ where: { id: current.id }, data: { email, emailNotifiedHash: null, ...(guarded ? { dedupeKey: email } : {}) } });
        // Ids only: no addresses in the audit trail (PDPA logging rule).
        await tx.auditLog.create({ data: { eventId, actorId: user.id, action: "REGISTRANT_EMAIL_CHANGED", target: current.id } });
      }
      return { id: current.id, eventId: current.eventId };
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") redirect(backTo(eventId, formData, { result: "email-taken" }));
    throw error;
  }
  if (!person) redirect(backTo(eventId, formData, { result: "missing" }));
  if (await queueEmailResend(person) === "rate-limited") redirect(backTo(eventId, formData, { result: "email-limit" }));
  revalidatePath(`/organizer/${eventId}/registrants`);
  redirect(backTo(eventId, formData, { result: "email-resent" }));
}

/** "ส่งทาง LINE อีกครั้ง": queues the full status summary with a fresh link; at most three per person per hour. */
export async function resendLineNotification(eventId: string, registrantId: string, formData: FormData) {
  await requireEventAccess(eventId, "manage");
  if (!(await lineAvailable())) redirect(backTo(eventId, formData, { result: "line-unavailable" }));
  const person = await db.registrant.findFirst({ where: { id: registrantId, eventId, anonymizedAt: null }, select: { id: true, eventId: true, lineUserId: true } });
  if (!person?.lineUserId) redirect(backTo(eventId, formData, { result: "line-not-linked" }));
  const queued = await queueLineResend(person);
  if (queued === "rate-limited") redirect(backTo(eventId, formData, { result: "line-limit" }));
  revalidatePath(`/organizer/${eventId}/registrants`);
  redirect(backTo(eventId, formData, { result: "line-resent" }));
}
