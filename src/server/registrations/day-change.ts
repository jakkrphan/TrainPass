import { Prisma, type RegistrantStatus } from "@prisma/client";

import { bangkokDayKey } from "@/lib/bangkok-today";
import { db } from "@/server/db";
import { getSeatAvailability, syncRegistrantStatus } from "@/server/registrations/day-status";
import { lockEventDays, promoteWaitlist } from "@/server/registrations/lifecycle";
import { canSelfEdit } from "@/server/registrations/self-edit";
import { statusTokenWhere } from "@/server/registrations/status-token";

export type DayChangeResult = "saved" | "unchanged" | "invalid" | "closed" | "day-closed" | "full" | "checked-in" | "not-found" | "unavailable";

const active: RegistrantStatus[] = ["PENDING", "APPROVED", "WAITLISTED"];
export const todayInBangkok = () => bangkokDayKey();

/**
 * Per-day events: a registrant may add or drop days from their status link until the deadline.
 * Added days follow the same seat rules as registering (full → waitlist, otherwise the event's approval mode);
 * dropped days free their seat for the queue. Days with a check-in cannot be dropped, and days the organizer
 * rejected cannot be re-added. The audit records day ids only.
 */
export async function changeOwnDays(slug: string, token: string, requested: FormDataEntryValue[]): Promise<DayChangeResult> {
  if (requested.length > 60 || requested.some((id) => typeof id !== "string" || !id)) return "invalid";
  const desired = new Set(requested as string[]);
  if (!desired.size || desired.size !== requested.length) return "invalid";

  const tokenWhere = await statusTokenWhere(token);
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await db.$transaction(async (tx) => {
        const registrant = await tx.registrant.findUnique({
          where: tokenWhere,
          select: { id: true, eventId: true, status: true, anonymizedAt: true, event: { select: { id: true, slug: true, status: true, deletedAt: true, registrationDeadline: true, seatMode: true, maxSeats: true, autoApprove: true, waitlistEnabled: true } } },
        });
        if (!registrant || registrant.event.slug !== slug || registrant.event.deletedAt) return "not-found" as const;
        if (registrant.event.seatMode !== "per_day") return "invalid" as const;
        if (!canSelfEdit(registrant, registrant.event)) return "closed" as const;

        await lockEventDays(tx, registrant.eventId);
        await tx.$queryRaw`SELECT id FROM Registrant WHERE id = ${registrant.id} FOR UPDATE`;
        const current = await tx.registrant.findUniqueOrThrow({ where: { id: registrant.id }, select: { status: true, days: { select: { id: true, eventDayId: true, status: true } } } });
        if (!active.includes(current.status)) return "closed" as const;

        const eventDays = await tx.eventDay.findMany({ where: { eventId: registrant.eventId }, select: { id: true, date: true, isClosed: true } });
        const dayById = new Map(eventDays.map((day) => [day.id, day]));
        if ([...desired].some((id) => !dayById.has(id))) return "invalid" as const;

        const rows = new Map(current.days.map((row) => [row.eventDayId, row]));
        const kept = current.days.filter((row) => active.includes(row.status)).map((row) => row.eventDayId);
        const toRemove = kept.filter((id) => !desired.has(id));
        const toAdd = [...desired].filter((id) => !kept.includes(id));
        if (!toAdd.length && !toRemove.length) return "unchanged" as const;

        const today = todayInBangkok();
        for (const id of toAdd) {
          const day = dayById.get(id)!;
          if (rows.get(id)?.status === "REJECTED") return "invalid" as const;
          if (day.isClosed || day.date.toISOString().slice(0, 10) < today) return "day-closed" as const;
        }
        if (toRemove.length && await tx.checkIn.count({ where: { registrantId: registrant.id, voidedAt: null, session: { eventDayId: { in: toRemove } } } })) return "checked-in" as const;

        // Checked before any write: returning from the callback commits whatever ran before it.
        const availability = await getSeatAvailability(tx, registrant.event, toAdd);
        const isFull = (id: string) => availability.mode === "per_day" && availability.days.get(id)?.remaining === 0;
        if (!registrant.event.waitlistEnabled && toAdd.some(isFull)) return "full" as const;

        if (toRemove.length) {
          await tx.registrantEventDay.updateMany({ where: { registrantId: registrant.id, eventDayId: { in: toRemove }, status: { in: active } }, data: { status: "CANCELLED", waitlistedAt: null, pendingSince: null } });
        }
        const added: { eventDayId: string; status: RegistrantStatus }[] = [];
        for (const id of toAdd) {
          const status: RegistrantStatus = isFull(id) ? "WAITLISTED" : registrant.event.autoApprove ? "APPROVED" : "PENDING";
          const data = { status, waitlistedAt: status === "WAITLISTED" ? new Date() : null, pendingSince: status === "PENDING" ? new Date() : null };
          const existing = rows.get(id);
          if (existing) await tx.registrantEventDay.update({ where: { id: existing.id }, data });
          else await tx.registrantEventDay.create({ data: { registrantId: registrant.id, eventDayId: id, ...data } });
          added.push({ eventDayId: id, status });
        }

        await syncRegistrantStatus(tx, registrant.id);
        if (toRemove.length) await promoteWaitlist(tx, registrant.eventId);
        await tx.auditLog.create({ data: { eventId: registrant.eventId, actorId: null, action: "REGISTRANT_DAYS_CHANGED", target: registrant.id, metadata: { addedDays: added, removedDays: toRemove } } });
        return "saved" as const;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === "P2034" || (error.code === "P2010" && error.meta?.code === "1213"))) {
        if (attempt === 4) return "unavailable";
        await new Promise((resolve) => setTimeout(resolve, 20 * (attempt + 1)));
        continue;
      }
      throw error;
    }
  }
  return "unavailable";
}
