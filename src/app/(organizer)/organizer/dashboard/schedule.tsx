import type { Prisma } from "@prisma/client";
import { CalendarDaysIcon } from "lucide-react";

import { bangkokToday } from "@/lib/bangkok-today";
import { formatEventDayWithWeekday } from "@/lib/format";
import { db } from "@/server/db";

const UPCOMING_DAYS = 7;
const SCHEDULE_LIMIT = 10;
const DAY = 24 * 60 * 60 * 1000;

const number = (value: number) => value.toLocaleString("th-TH");

/**
 * Training days from today to UPCOMING_DAYS ahead. Today's rows show distinct people checked in today against the
 * day's approved count, counted the same way as the check-in picker; later rows show the approved count only.
 */
export async function DashboardSchedule({ events }: { events: Prisma.EventWhereInput }) {
  const today = bangkokToday();
  const days = await db.eventDay.findMany({
    where: { event: events, date: { gte: today.date, lte: new Date(today.date.getTime() + UPCOMING_DAYS * DAY) } },
    orderBy: [{ date: "asc" }, { event: { title: "asc" } }], take: SCHEDULE_LIMIT,
    select: { id: true, date: true, event: { select: { id: true, title: true, seatMode: true } } },
  });
  if (!days.length) return null;

  const rows = await Promise.all(days.map(async (day) => {
    const isToday = day.date.getTime() === today.date.getTime();
    const [approved, checked] = await Promise.all([
      day.event.seatMode === "whole_course"
        ? db.registrant.count({ where: { eventId: day.event.id, status: "APPROVED" } })
        : db.registrantEventDay.count({ where: { eventDayId: day.id, status: "APPROVED" } }),
      isToday
        ? db.checkIn.groupBy({ by: ["registrantId"], where: { voidedAt: null, checkedInAt: { gte: today.start }, session: { eventId: day.event.id, OR: [{ eventDayId: day.id }, { eventDayId: null }] } } }).then((found) => found.length)
        : Promise.resolve(null),
    ]);
    return { ...day, isToday, approved, checked };
  }));

  return <section aria-label="อบรมวันนี้และเร็วๆ นี้" className="flex flex-col gap-3 rounded-xl border bg-card p-4">
    <h2 className="flex items-center gap-2 font-heading text-base font-bold"><CalendarDaysIcon className="size-4 text-primary" aria-hidden="true" />อบรมวันนี้และเร็วๆ นี้ <span className="text-xs font-normal text-muted-foreground">{UPCOMING_DAYS} วันข้างหน้า</span></h2>
    <ul className="flex flex-col divide-y">
      {rows.map((row) => <li key={row.id} className="flex items-center justify-between gap-3 py-2.5">
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-sm font-semibold">{row.event.title}</span>
          <span className="text-xs text-muted-foreground">{row.isToday ? <span className="font-semibold text-primary">วันนี้</span> : formatEventDayWithWeekday(row.date)}</span>
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
