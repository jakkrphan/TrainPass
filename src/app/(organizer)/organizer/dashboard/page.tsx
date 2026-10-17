import { Prisma } from "@prisma/client";
import type { Metadata } from "next";
import Link from "next/link";
import { ClockIcon, LayoutDashboardIcon, UserCheckIcon } from "lucide-react";

import { AutoSearch } from "@/components/auto-search";
import { Pagination } from "@/components/pagination";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { chipClass, eventStatusLabel, eventStatusTone } from "@/features/events/status-display";
import { bangkokToday } from "@/lib/bangkok-today";
import { formatDateTime, formatEventDayList } from "@/lib/format";
import { pageWindow, readPage } from "@/lib/pagination";
import { cn } from "@/lib/utils";
import { manageableEventsWhere } from "@/server/authorization/event-visibility";
import { requireActiveUser } from "@/server/authorization/session";
import { db } from "@/server/db";

import { DashboardSchedule } from "./schedule";
import { DashboardTrend } from "./trend";

export const metadata: Metadata = { title: "แดชบอร์ด" };

const EVENTS_PAGE_SIZE = 25;

type Counts = { total: number; APPROVED: number; PENDING: number; WAITLISTED: number; other: number };
const emptyCounts = (): Counts => ({ total: 0, APPROVED: 0, PENDING: 0, WAITLISTED: 0, other: 0 });

function addCount(counts: Counts, status: string, count: number) {
  counts.total += count;
  if (status === "APPROVED" || status === "PENDING" || status === "WAITLISTED") counts[status] += count;
  else counts.other += count;
}

const number = (value: number) => value.toLocaleString("th-TH");

const HOUR = 60 * 60 * 1000;
const CLOSING_SOON_DAYS = 3;
const ATTENTION_LIMIT = 8;

/** "3 วัน", "5 ชม.", "ไม่ถึง 1 ชม." — coarse on purpose: the list is a nudge, the registrant page has exact times. */
function span(ms: number) {
  const hours = Math.floor(ms / HOUR);
  if (hours >= 24) return `${number(Math.floor(hours / 24))} วัน`;
  return hours >= 1 ? `${hours} ชม.` : "ไม่ถึง 1 ชม.";
}

/**
 * The two to-do lists, limited to projects this user may manage (admins: all): people still waiting for approval,
 * and published projects whose registration closes within CLOSING_SOON_DAYS.
 *
 * Pending counts only projects that still need a decision — published, or closed but with a training day today or
 * later — so stale requests on finished projects cannot crowd out live ones. A person counts while their overall status
 * or any of their days is PENDING (per-day projects summarize "approved for one day, pending for another" as APPROVED),
 * and the wait is measured from the oldest pending day (pendingSince), falling back to the registration time.
 */
async function loadAttention(manageable: Prisma.EventWhereInput) {
  const now = new Date();
  const today = bangkokToday();
  const [actionable, closing] = await Promise.all([
    db.event.findMany({
      where: { AND: [manageable, { OR: [{ status: "PUBLISHED" }, { status: "CLOSED", days: { some: { date: { gte: today.date } } } }] }] },
      select: { id: true, title: true },
    }),
    db.event.findMany({
      where: { AND: [manageable, { status: "PUBLISHED", registrationDeadline: { gt: now, lte: new Date(now.getTime() + CLOSING_SOON_DAYS * 24 * HOUR) } }] },
      orderBy: { registrationDeadline: "asc" }, take: ATTENTION_LIMIT, select: { id: true, title: true, registrationDeadline: true },
    }),
  ]);
  const pendingRows = actionable.length ? await db.$queryRaw<{ eventId: string; pending: bigint; since: Date }[]>(Prisma.sql`
    SELECT r.eventId AS eventId, COUNT(DISTINCT r.id) AS pending, MIN(COALESCE(rd.pendingSince, r.registeredAt)) AS since
    FROM Registrant r LEFT JOIN RegistrantEventDay rd ON rd.registrantId = r.id AND rd.status = 'PENDING'
    WHERE r.eventId IN (${Prisma.join(actionable.map((event) => event.id))})
      AND r.status NOT IN ('CANCELLED', 'REJECTED') AND (r.status = 'PENDING' OR rd.id IS NOT NULL)
    GROUP BY r.eventId
    ORDER BY since ASC`) : [];
  const titleOf = new Map(actionable.map((event) => [event.id, event.title]));
  return {
    pending: pendingRows.slice(0, ATTENTION_LIMIT).map((row) => ({
      id: row.eventId, title: titleOf.get(row.eventId) ?? "", count: Number(row.pending), waited: span(now.getTime() - new Date(row.since).getTime()),
    })),
    pendingProjects: pendingRows.length,
    closing: closing.map((event) => ({ id: event.id, title: event.title, deadline: event.registrationDeadline!, left: span(event.registrationDeadline!.getTime() - now.getTime()) })),
  };
}

type SeatEvent = { seatMode: string; maxSeats: number | null; days: { id: string; maxSeats: number | null }[] };

/**
 * Seats held (approved + pending, as registration counts them) against capacity. per_day sums every day's seats, so a
 * three-day project of 50 a day reads x / 150. null = no limit (a course without maxSeats, or any day without one).
 */
function seatUsage(event: SeatEvent, counts: Counts, heldByDay: Map<string, number>) {
  if (event.seatMode === "whole_course") return event.maxSeats === null ? null : { taken: counts.APPROVED + counts.PENDING, max: event.maxSeats, days: 0, fullDays: 0 };
  if (!event.days.length || event.days.some((day) => day.maxSeats === null)) return null;
  return {
    taken: event.days.reduce((sum, day) => sum + (heldByDay.get(day.id) ?? 0), 0),
    max: event.days.reduce((sum, day) => sum + day.maxSeats!, 0),
    days: event.days.length,
    // A sum can look roomy while one day is already full, so full days are counted separately.
    fullDays: event.days.filter((day) => (heldByDay.get(day.id) ?? 0) >= day.maxSeats!).length,
  };
}

/**
 * Registrant counts for every published or closed project, open to all signed-in staff (not only each project's
 * organizers). Counts only, never registrant details. Drafts are left out: they cannot take registrations yet.
 */
export default async function DashboardPage({ searchParams }: PageProps<"/organizer/dashboard">) {
  const user = await requireActiveUser();
  const params = await searchParams;
  const query = typeof params.q === "string" ? params.q.trim().slice(0, 100) : "";
  const allWhere: Prisma.EventWhereInput = { deletedAt: null, status: { in: ["PUBLISHED", "CLOSED"] } };
  const listWhere: Prisma.EventWhereInput = query ? { AND: [allWhere, { title: { contains: query } }] } : allWhere;

  const [eventCount, totalsByStatus, searchTotal, attention] = await Promise.all([
    db.event.count({ where: allWhere }),
    db.registrant.groupBy({ by: ["status"], where: { event: allWhere }, _count: { _all: true } }),
    query ? db.event.count({ where: listWhere }) : Promise.resolve(null),
    loadAttention(manageableEventsWhere(user)),
  ]);
  const listTotal = searchTotal ?? eventCount;
  const totals = emptyCounts();
  for (const row of totalsByStatus) addCount(totals, row.status, row._count._all);

  const paging = pageWindow(readPage(params.page), EVENTS_PAGE_SIZE, listTotal);
  const pageHref = (target: number) => {
    const next = new URLSearchParams({ ...(query ? { q: query } : {}), ...(target > 1 ? { page: String(target) } : {}) });
    return `/organizer/dashboard${next.size ? `?${next}` : ""}`;
  };
  const events = await db.event.findMany({
    where: listWhere,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: paging.skip, take: paging.take,
    select: { id: true, title: true, status: true, location: true, seatMode: true, maxSeats: true, days: { orderBy: { date: "asc" }, select: { id: true, date: true, maxSeats: true } } },
  });
  const eventIds = events.map((event) => event.id);
  const [statusCounts, dayHeld] = eventIds.length ? await Promise.all([
    db.registrant.groupBy({ by: ["eventId", "status"], where: { eventId: { in: eventIds } }, _count: { _all: true } }),
    db.registrantEventDay.groupBy({ by: ["eventDayId"], where: { eventDay: { eventId: { in: eventIds } }, status: { in: ["APPROVED", "PENDING"] } }, _count: { _all: true } }),
  ]) : [[], []];
  const heldByDay = new Map(dayHeld.map((row) => [row.eventDayId, row._count._all]));
  const countsByEvent = new Map<string, Counts>();
  for (const row of statusCounts) {
    const counts = countsByEvent.get(row.eventId) ?? emptyCounts();
    addCount(counts, row.status, row._count._all);
    countsByEvent.set(row.eventId, counts);
  }

  const tiles = [
    { label: "โครงการ", value: eventCount, note: "เปิดรับและปิดรับแล้ว" },
    { label: "ผู้ลงทะเบียนทั้งหมด", value: totals.total, note: "รวมทุกสถานะ" },
    { label: "อนุมัติแล้ว", value: totals.APPROVED },
    { label: "รออนุมัติ", value: totals.PENDING },
    { label: "รอคิว", value: totals.WAITLISTED },
  ];

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-5 py-8 lg:px-10">
      <div className="flex flex-col gap-1.5">
        <h1 className="font-heading text-3xl font-bold tracking-tight">แดชบอร์ด</h1>
        <p className="text-sm text-muted-foreground">จำนวนผู้ลงทะเบียนของทุกโครงการในระบบ · ไม่รวมโครงการที่ยังเป็นฉบับร่าง</p>
      </div>

      <section aria-label="สรุปภาพรวม" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {tiles.map((tile) => <div key={tile.label} className="flex flex-col gap-1 rounded-xl border bg-card p-4">
          <span className="text-sm text-muted-foreground">{tile.label}</span>
          <span className="font-heading text-2xl font-bold tabular-nums">{number(tile.value)}</span>
          {tile.note && <span className="text-xs text-muted-foreground">{tile.note}</span>}
        </div>)}
      </section>

      {(attention.pending.length > 0 || attention.closing.length > 0) && <section aria-label="งานที่ต้องจัดการ" className="grid gap-3 lg:grid-cols-2">
        {attention.pending.length > 0 && <div className="flex flex-col gap-3 rounded-xl border bg-card p-4">
          <h2 className="flex items-center gap-2 font-heading text-base font-bold"><UserCheckIcon className="size-4 text-primary" aria-hidden="true" />รออนุมัติ{attention.pendingProjects > attention.pending.length && <span className="text-xs font-normal text-muted-foreground">แสดง {attention.pending.length} จาก {number(attention.pendingProjects)} โครงการ</span>}</h2>
          <ul className="flex flex-col divide-y">
            {attention.pending.map((item) => <li key={item.id}>
              <Link href={`/organizer/${item.id}/registrants?status=PENDING`} className="flex items-center justify-between gap-3 py-2.5 hover:underline">
                <span className="flex min-w-0 flex-col gap-0.5"><span className="truncate text-sm font-semibold">{item.title}</span>{item.waited && <span className="text-xs text-muted-foreground">คนแรกรอมา {item.waited}</span>}</span>
                <span className="shrink-0 rounded-md bg-amber-100 px-2 py-0.5 text-sm font-bold tabular-nums text-amber-900">{number(item.count)} คน</span>
              </Link>
            </li>)}
          </ul>
        </div>}
        {attention.closing.length > 0 && <div className="flex flex-col gap-3 rounded-xl border bg-card p-4">
          <h2 className="flex items-center gap-2 font-heading text-base font-bold"><ClockIcon className="size-4 text-primary" aria-hidden="true" />ใกล้ปิดรับสมัคร <span className="text-xs font-normal text-muted-foreground">ภายใน {CLOSING_SOON_DAYS} วัน</span></h2>
          <ul className="flex flex-col divide-y">
            {attention.closing.map((item) => <li key={item.id}>
              <Link href={`/organizer/${item.id}?step=1`} className="flex items-center justify-between gap-3 py-2.5 hover:underline">
                <span className="flex min-w-0 flex-col gap-0.5"><span className="truncate text-sm font-semibold">{item.title}</span><span className="text-xs text-muted-foreground">ปิด {formatDateTime(item.deadline)}</span></span>
                <span className="shrink-0 text-sm font-semibold tabular-nums text-muted-foreground">เหลือ {item.left}</span>
              </Link>
            </li>)}
          </ul>
        </div>}
      </section>}

      <DashboardSchedule />

      <DashboardTrend />

      <AutoSearch id="dashboard-search" label="ค้นหาชื่อโครงการ" placeholder="ค้นหาชื่อโครงการ" defaultValue={query} />

      {events.length === 0 ? (
        <Empty className="min-h-64 border bg-card">
          <EmptyHeader>
            <EmptyMedia variant="icon"><LayoutDashboardIcon aria-hidden="true" /></EmptyMedia>
            <EmptyTitle>{eventCount ? "ไม่พบโครงการที่ตรงคำค้นหา" : "ยังไม่มีโครงการที่เผยแพร่"}</EmptyTitle>
            <EmptyDescription>{eventCount ? "ลองเปลี่ยนคำค้นหา" : "โครงการจะแสดงที่นี่หลังจากผู้จัดกดเผยแพร่"}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <section aria-label="จำนวนผู้ลงทะเบียนรายโครงการ" className="overflow-x-auto rounded-xl border bg-card">
          <Table>
            <TableHeader className="bg-secondary">
              <TableRow>
                <TableHead className="min-w-64 px-5">โครงการ</TableHead>
                <TableHead className="min-w-36">วันที่จัด</TableHead>
                <TableHead className="min-w-36">ที่นั่ง</TableHead>
                <TableHead className="text-right">ลงทะเบียน</TableHead>
                <TableHead className="text-right">อนุมัติแล้ว</TableHead>
                <TableHead className="text-right">รออนุมัติ</TableHead>
                <TableHead className="text-right">รอคิว</TableHead>
                <TableHead className="pr-5 text-right">ยกเลิก / ไม่อนุมัติ</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {events.map((event) => {
                const counts = countsByEvent.get(event.id) ?? emptyCounts();
                const seats = seatUsage(event, counts, heldByDay);
                const used = !seats ? 0 : seats.max > 0 ? Math.min(seats.taken / seats.max, 1) : 1;
                const full = seats !== null && seats.taken >= seats.max;
                return <TableRow key={event.id}>
                  <TableCell className="px-5 py-3.5 whitespace-normal">
                    <div className="flex flex-col gap-1.5">
                      <span className="font-heading font-semibold leading-snug">{event.title}</span>
                      <span className="flex flex-wrap items-center gap-1.5"><span className={cn(chipClass, eventStatusTone[event.status])}>{eventStatusLabel[event.status]}</span>{event.location && <span className="text-xs text-muted-foreground">{event.location}</span>}</span>
                    </div>
                  </TableCell>
                  <TableCell className="whitespace-normal text-sm">{event.days.length ? formatEventDayList(event.days.map((day) => day.date)) : <span className="text-muted-foreground">ยังไม่กำหนดวัน</span>}</TableCell>
                  <TableCell className="text-sm">{seats ? <div className="flex flex-col gap-1">
                    <span className="flex items-baseline gap-1.5 tabular-nums"><span className="font-semibold">{number(seats.taken)} / {number(seats.max)}</span>{full ? <span className="text-xs font-semibold text-destructive">เต็ม</span> : seats.days > 1 && <span className="text-xs text-muted-foreground">รวม {seats.days} วัน</span>}</span>
                    {!full && seats.fullDays > 0 && <span className="text-xs font-semibold text-destructive">เต็มแล้ว {seats.fullDays} วัน</span>}
                    <span className="h-1.5 w-28 overflow-hidden rounded-full bg-muted" role="img" aria-label={`ใช้ที่นั่งแล้ว ${Math.round(used * 100)}%`}><span className={cn("block h-full rounded-full", full ? "bg-destructive" : "bg-primary")} style={{ width: `${used * 100}%` }} /></span>
                  </div> : <span className="text-muted-foreground">ไม่จำกัด</span>}</TableCell>
                  <TableCell className="text-right font-heading text-base font-bold tabular-nums">{number(counts.total)}</TableCell>
                  <TableCell className="text-right tabular-nums">{number(counts.APPROVED)}</TableCell>
                  <TableCell className="text-right tabular-nums">{number(counts.PENDING)}</TableCell>
                  <TableCell className="text-right tabular-nums">{number(counts.WAITLISTED)}</TableCell>
                  <TableCell className="pr-5 text-right tabular-nums text-muted-foreground">{number(counts.other)}</TableCell>
                </TableRow>;
              })}
            </TableBody>
          </Table>
          <Pagination label="หน้ารายการโครงการ" paging={paging} unit="โครงการ" hrefFor={pageHref} />
        </section>
      )}
    </main>
  );
}
