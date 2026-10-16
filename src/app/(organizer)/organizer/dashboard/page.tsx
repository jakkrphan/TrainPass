import type { Prisma } from "@prisma/client";
import type { Metadata } from "next";
import { LayoutDashboardIcon } from "lucide-react";

import { AutoSearch } from "@/components/auto-search";
import { Pagination } from "@/components/pagination";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { chipClass, eventStatusLabel, eventStatusTone } from "@/features/events/status-display";
import { formatEventDayList } from "@/lib/format";
import { pageWindow, readPage } from "@/lib/pagination";
import { cn } from "@/lib/utils";
import { requireActiveUser } from "@/server/authorization/session";
import { db } from "@/server/db";

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

/**
 * Registrant counts for every published or closed project, open to all signed-in staff (not only each project's
 * organizers). Counts only, never registrant details. Drafts are left out: they cannot take registrations yet.
 */
export default async function DashboardPage({ searchParams }: PageProps<"/organizer/dashboard">) {
  await requireActiveUser();
  const params = await searchParams;
  const query = typeof params.q === "string" ? params.q.trim().slice(0, 100) : "";
  const allWhere: Prisma.EventWhereInput = { deletedAt: null, status: { in: ["PUBLISHED", "CLOSED"] } };
  const listWhere: Prisma.EventWhereInput = query ? { AND: [allWhere, { title: { contains: query } }] } : allWhere;

  const [eventCount, totalsByStatus, searchTotal] = await Promise.all([
    db.event.count({ where: allWhere }),
    db.registrant.groupBy({ by: ["status"], where: { event: allWhere }, _count: { _all: true } }),
    query ? db.event.count({ where: listWhere }) : Promise.resolve(null),
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
    select: { id: true, title: true, status: true, location: true, days: { orderBy: { date: "asc" }, select: { date: true } } },
  });
  const eventIds = events.map((event) => event.id);
  const statusCounts = eventIds.length ? await db.registrant.groupBy({ by: ["eventId", "status"], where: { eventId: { in: eventIds } }, _count: { _all: true } }) : [];
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
                return <TableRow key={event.id}>
                  <TableCell className="px-5 py-3.5 whitespace-normal">
                    <div className="flex flex-col gap-1.5">
                      <span className="font-heading font-semibold leading-snug">{event.title}</span>
                      <span className="flex flex-wrap items-center gap-1.5"><span className={cn(chipClass, eventStatusTone[event.status])}>{eventStatusLabel[event.status]}</span>{event.location && <span className="text-xs text-muted-foreground">{event.location}</span>}</span>
                    </div>
                  </TableCell>
                  <TableCell className="whitespace-normal text-sm">{event.days.length ? formatEventDayList(event.days.map((day) => day.date)) : <span className="text-muted-foreground">ยังไม่กำหนดวัน</span>}</TableCell>
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
