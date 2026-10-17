import { Prisma } from "@prisma/client";

import { db } from "@/server/db";

export type TodayDay = { dayId: string; eventId: string; seatMode: string };
export type TodayProgress = { expected: number; checked: number };

/**
 * Today's attendance for days running today, keyed by day id: approved people for the day (for the whole course when
 * seats are per course) against distinct people checked in since `since` (Bangkok midnight) in that day's sessions or
 * the event's every-day sessions. Shared by the check-in picker and the staff dashboard so both show the same numbers.
 * At most three queries, however many days are passed.
 */
export async function todayProgress(days: TodayDay[], since: Date): Promise<Map<string, TodayProgress>> {
  if (!days.length) return new Map();
  const perDay = days.filter((day) => day.seatMode !== "whole_course").map((day) => day.dayId);
  const wholeCourse = days.filter((day) => day.seatMode === "whole_course").map((day) => day.eventId);
  const [dayApproved, courseApproved, checkedRows] = await Promise.all([
    perDay.length ? db.registrantEventDay.groupBy({ by: ["eventDayId"], where: { eventDayId: { in: perDay }, status: "APPROVED" }, _count: { _all: true } }) : [],
    wholeCourse.length ? db.registrant.groupBy({ by: ["eventId"], where: { eventId: { in: wholeCourse }, status: "APPROVED" }, _count: { _all: true } }) : [],
    db.$queryRaw<{ eventId: string; checked: bigint }[]>(Prisma.sql`
      SELECT s.eventId AS eventId, COUNT(DISTINCT c.registrantId) AS checked
      FROM CheckIn c JOIN Session s ON s.id = c.sessionId
      WHERE c.voidedAt IS NULL AND c.checkedInAt >= ${since}
        AND s.eventId IN (${Prisma.join(days.map((day) => day.eventId))})
        AND (s.eventDayId IS NULL OR s.eventDayId IN (${Prisma.join(days.map((day) => day.dayId))}))
      GROUP BY s.eventId`),
  ]);
  const approvedByDay = new Map(dayApproved.map((row) => [row.eventDayId, row._count._all]));
  const approvedByEvent = new Map(courseApproved.map((row) => [row.eventId, row._count._all]));
  const checkedByEvent = new Map(checkedRows.map((row) => [row.eventId, Number(row.checked)]));
  return new Map(days.map((day) => [day.dayId, {
    expected: (day.seatMode === "whole_course" ? approvedByEvent.get(day.eventId) : approvedByDay.get(day.dayId)) ?? 0,
    checked: checkedByEvent.get(day.eventId) ?? 0,
  }]));
}
