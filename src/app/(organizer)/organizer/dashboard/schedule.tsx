import type { Prisma } from "@prisma/client";
import { CalendarDaysIcon } from "lucide-react";
import { unstable_cache } from "next/cache";

import { bangkokToday } from "@/lib/bangkok-today";
import { formatEventDayWithWeekday } from "@/lib/format";
import { db } from "@/server/db";
import { todayProgress } from "@/server/events/today-progress";

const UPCOMING_DAYS = 7;
const SCHEDULE_LIMIT = 10;
const DAY = 24 * 60 * 60 * 1000;
/** Same projects as the rest of the dashboard: every published or closed one, whoever is looking. */
const listed: Prisma.EventWhereInput = { deletedAt: null, status: { in: ["PUBLISHED", "CLOSED"] } };

const number = (value: number) => value.toLocaleString("th-TH");

/**
 * Training days from today to UPCOMING_DAYS ahead, with today's check-in progress (todayProgress, as on the check-in
 * picker) or, for later days, the approved count. Not per user, so it is cached for a minute: searching or paging the
 * table below re-renders the page without repeating these queries. Cached values are JSON, hence the ISO date.
 */
const loadSchedule = unstable_cache(async (todayKey: string) => {
  const today = { date: new Date(`${todayKey}T00:00:00Z`), start: new Date(`${todayKey}T00:00:00+07:00`) };
  const days = await db.eventDay.findMany({
    where: { event: listed, date: { gte: today.date, lte: new Date(today.date.getTime() + UPCOMING_DAYS * DAY) } },
    orderBy: [{ date: "asc" }, { event: { title: "asc" } }], take: SCHEDULE_LIMIT,
    select: { id: true, date: true, event: { select: { id: true, title: true, seatMode: true } } },
  });
  const todays = days.filter((day) => day.date.getTime() === today.date.getTime());
  const later = days.filter((day) => day.date.getTime() !== today.date.getTime());
  const laterWholeCourse = [...new Set(later.filter((day) => day.event.seatMode === "whole_course").map((day) => day.event.id))];
  const laterPerDay = later.filter((day) => day.event.seatMode !== "whole_course").map((day) => day.id);
  const [progress, dayApproved, courseApproved] = await Promise.all([
    todayProgress(todays.map((day) => ({ dayId: day.id, eventId: day.event.id, seatMode: day.event.seatMode })), today.start),
    laterPerDay.length ? db.registrantEventDay.groupBy({ by: ["eventDayId"], where: { eventDayId: { in: laterPerDay }, status: "APPROVED" }, _count: { _all: true } }) : [],
    laterWholeCourse.length ? db.registrant.groupBy({ by: ["eventId"], where: { eventId: { in: laterWholeCourse }, status: "APPROVED" }, _count: { _all: true } }) : [],
  ]);
  const approvedByDay = new Map(dayApproved.map((row) => [row.eventDayId, row._count._all]));
  const approvedByEvent = new Map(courseApproved.map((row) => [row.eventId, row._count._all]));
  return days.map((day) => {
    const running = progress.get(day.id);
    return {
      id: day.id, date: day.date.toISOString(), title: day.event.title, isToday: !!running,
      approved: running?.expected ?? (day.event.seatMode === "whole_course" ? approvedByEvent.get(day.event.id) : approvedByDay.get(day.id)) ?? 0,
      checked: running?.checked ?? null,
    };
  });
}, ["dashboard-schedule"], { revalidate: 60 });

export async function DashboardSchedule() {
  const rows = await loadSchedule(bangkokToday().key);
  if (!rows.length) return null;

  return <section aria-label="อบรมวันนี้และเร็วๆ นี้" className="flex flex-col gap-3 rounded-xl border bg-card p-4">
    <h2 className="flex items-center gap-2 font-heading text-base font-bold"><CalendarDaysIcon className="size-4 text-primary" aria-hidden="true" />อบรมวันนี้และเร็วๆ นี้ <span className="text-xs font-normal text-muted-foreground">{UPCOMING_DAYS} วันข้างหน้า</span></h2>
    <ul className="flex flex-col divide-y">
      {rows.map((row) => <li key={row.id} className="flex items-center justify-between gap-3 py-2.5">
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-sm font-semibold">{row.title}</span>
          <span className="text-xs text-muted-foreground">{row.isToday ? <span className="font-semibold text-primary">วันนี้</span> : formatEventDayWithWeekday(new Date(row.date))}</span>
        </span>
        {row.checked !== null
          ? <span className="flex shrink-0 flex-col items-end gap-1">
            <span className="text-sm tabular-nums"><span className="font-bold">{number(row.checked)}</span> / {number(row.approved)} <span className="text-xs text-muted-foreground">เช็คชื่อแล้ว</span></span>
            <span className="h-1.5 w-24 overflow-hidden rounded-full bg-muted" role="img" aria-label={`เช็คชื่อแล้ว ${row.approved ? Math.round(Math.min(row.checked / row.approved, 1) * 100) : 0}%`}><span className="block h-full rounded-full bg-primary" style={{ width: `${row.approved ? Math.min(row.checked / row.approved, 1) * 100 : 0}%` }} /></span>
          </span>
          : <span className="shrink-0 text-sm tabular-nums text-muted-foreground">อนุมัติ {number(row.approved)} คน</span>}
      </li>)}
    </ul>
  </section>;
}
