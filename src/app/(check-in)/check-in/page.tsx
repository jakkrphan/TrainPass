import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { CalendarDaysIcon, ImageIcon, QrCodeIcon, SearchIcon } from "lucide-react";

import { AppShell } from "@/app/(organizer)/organizer/app-shell";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { coverThumbUrl } from "@/features/events/cover-url";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDayNumber, formatEventDay, formatMonth } from "@/lib/format";
import { Pagination } from "@/components/pagination";
import { pageWindow, readPage } from "@/lib/pagination";
import { bangkokToday } from "@/lib/bangkok-today";
import { cn } from "@/lib/utils";
import { requireActiveUser } from "@/server/authorization/session";
import { db } from "@/server/db";
import { todayProgress } from "@/server/events/today-progress";
import { withBasePath } from "@/lib/base-path";

export const metadata: Metadata = { title: "เช็คชื่อหน้างาน" };

const typeLabel = { INTERNAL: "ภายใน", EXTERNAL: "ภายนอก", MIXED: "ผสม" } as const;
const chip = "inline-flex items-center rounded-md px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap";
const filters = [
  { value: "all", label: "ทั้งหมด" },
  { value: "today", label: "จัดวันนี้" },
  { value: "upcoming", label: "กำลังจะถึง" },
  { value: "past", label: "จบแล้ว" },
] as const;
type Filter = (typeof filters)[number]["value"];

const CHECKIN_PAGE_SIZE = 20;

export default async function CheckInPage({ searchParams }: PageProps<"/check-in">) {
  const user = await requireActiveUser();
  const params = await searchParams;
  const show: Filter = filters.some((item) => item.value === params.show) ? params.show as Filter : "all";
  const query = typeof params.q === "string" ? params.q.trim().slice(0, 100) : "";

  const events = await db.event.findMany({
    where: user.role === "ADMIN" ? { status: { in: ["PUBLISHED", "CLOSED"] }, deletedAt: null } : {
      status: { in: ["PUBLISHED", "CLOSED"] },
      deletedAt: null,
      OR: [{ ownerId: user.id }, { organizers: { some: { userId: user.id } } }],
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true, title: true, status: true, eventType: true, coverImageUrl: true, location: true, ownerId: true, seatMode: true,
      organizers: { where: { userId: user.id }, select: { role: true } },
      days: { select: { id: true, date: true }, orderBy: { date: "asc" } },
      sessions: { select: { eventDayId: true } },
    },
  });

  const today = bangkokToday();
  const keyOf = (date: Date) => date.toISOString().slice(0, 10);
  // Today's events first, then upcoming by their next day, then finished ones (most recent first).
  const ranked = events.map((event) => {
    const keys = event.days.map((day) => keyOf(day.date));
    const todayDay = event.days.find((day) => keyOf(day.date) === today.key);
    const next = event.days.find((day) => keyOf(day.date) > today.key);
    const phase: Exclude<Filter, "all"> = todayDay ? "today" : next ? "upcoming" : "past";
    return { event, todayDay, next, phase, last: keys.at(-1) ?? "" };
  }).sort((a, b) => Number(!!b.todayDay) - Number(!!a.todayDay)
    || (a.next && b.next ? keyOf(a.next.date).localeCompare(keyOf(b.next.date)) : a.next ? -1 : b.next ? 1 : b.last.localeCompare(a.last)));
  const counts: Record<Filter, number> = { all: ranked.length, today: 0, upcoming: 0, past: 0 };
  for (const item of ranked) counts[item.phase]++;
  const matching = ranked.filter((item) => (show === "all" || item.phase === show) && (!query || item.event.title.toLocaleLowerCase("th-TH").includes(query.toLocaleLowerCase("th-TH"))));
  // The order (today first, then upcoming) is computed from the days, so the list is cut into pages after sorting;
  // only the page on screen pays for the per-event progress counts below.
  const paging = pageWindow(readPage(params.page), CHECKIN_PAGE_SIZE, matching.length);
  const visible = matching.slice(paging.skip, paging.skip + paging.take);

  // Today's progress for events running today: approved for today vs distinct people checked in today.
  const running = visible.flatMap(({ event, todayDay }) => todayDay ? [{ dayId: todayDay.id, eventId: event.id, seatMode: event.seatMode }] : []);
  const byDay = await todayProgress(running, today.start);
  const progress = new Map(running.map((day) => [day.eventId, byDay.get(day.dayId)!]));

  const roleOf = (event: (typeof events)[number]) => event.ownerId === user.id ? "เจ้าของ"
    : event.organizers[0]?.role === "FULL" ? "ผู้ร่วมจัด" : event.organizers[0]?.role === "CHECKIN_ONLY" ? "เช็คชื่ออย่างเดียว" : user.role === "ADMIN" ? "ผู้ดูแลระบบ" : "ผู้ร่วมจัด";
  const pageHref = (target: number) => {
    const next = new URLSearchParams({ ...(show !== "all" ? { show } : {}), ...(query ? { q: query } : {}), ...(target > 1 ? { page: String(target) } : {}) });
    return `/check-in${next.size ? `?${next}` : ""}`;
  };
  const hrefFor = (value: Filter) => `/check-in${value !== "all" || query ? `?${new URLSearchParams({ ...(value !== "all" ? { show: value } : {}), ...(query ? { q: query } : {}) })}` : ""}`;

  return <AppShell user={user}>
    <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-5 py-8 lg:px-10">
      <div className="flex flex-col gap-1.5">
        <h1 className="font-heading text-3xl font-bold tracking-tight">เช็คชื่อหน้างาน</h1>
        <p className="text-sm text-muted-foreground">{`${events.length.toLocaleString("th-TH")} โครงการที่คุณเช็คชื่อได้ · โครงการที่จัดวันนี้แสดงก่อน`}</p>
      </div>


      <div className="flex flex-wrap items-center justify-between gap-4">
        <nav aria-label="กรองโครงการ" className="flex flex-wrap gap-0.5 rounded-lg bg-[#eae6dd] p-1">
          {filters.map((filter) => <Link key={filter.value} href={hrefFor(filter.value)} aria-current={show === filter.value ? "page" : undefined}
            className={cn("flex min-h-11 items-center rounded-md px-3.5 text-sm", show === filter.value ? "bg-card font-semibold text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>{`${filter.label} ${counts[filter.value]}`}</Link>)}
        </nav>
        <form method="get" role="search" className="relative w-full sm:w-72">
          {show !== "all" && <input type="hidden" name="show" value={show} />}
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <label htmlFor="checkin-search" className="sr-only">ค้นหาชื่อโครงการ</label>
          <Input id="checkin-search" name="q" type="search" defaultValue={query} maxLength={100} placeholder="ค้นหาชื่อโครงการ" className="h-11 bg-card pl-9" />
        </form>
      </div>

      {visible.length === 0 ? (
        <Empty className="min-h-80 border bg-card">
          <EmptyHeader>
            <EmptyMedia variant="icon"><CalendarDaysIcon aria-hidden="true" /></EmptyMedia>
            <EmptyTitle>{events.length ? "ไม่พบโครงการที่ตรงเงื่อนไข" : "ยังไม่มีโครงการที่เปิดให้เช็คชื่อ"}</EmptyTitle>
            <EmptyDescription>{events.length ? "ลองเปลี่ยนแท็บหรือคำค้นหา" : "ผู้จัดต้องเผยแพร่โครงการและเพิ่มคุณเป็นผู้ร่วมจัดก่อน"}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <section aria-label="โครงการสำหรับเช็คชื่อ" className="overflow-x-auto rounded-xl border bg-card">
          {/* Below xl each row becomes a card (grid), like the project list, so nothing hides behind a horizontal scroll. */}
          <Table className="max-xl:block">
            <TableHeader className="bg-secondary max-xl:hidden">
              <TableRow>
                <TableHead className="w-28 px-5">ปก</TableHead>
                <TableHead className="min-w-60">โครงการ</TableHead>
                <TableHead className="min-w-40">วันที่จัด</TableHead>
                <TableHead className="max-2xl:hidden">บทบาท</TableHead>
                <TableHead className="min-w-44">เช็คชื่อวันนี้</TableHead>
                <TableHead className="w-40"><span className="sr-only">เปิดหน้าเช็คชื่อ</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="max-xl:block">
              {visible.map(({ event, todayDay, next, phase }) => {
                const stats = progress.get(event.id);
                const sessionsToday = todayDay ? event.sessions.filter((session) => session.eventDayId === todayDay.id || session.eventDayId === null).length : 0;
                const percent = stats && stats.expected ? Math.min(100, Math.round((stats.checked / stats.expected) * 100)) : 0;
                const href = `/check-in/${event.id}`;
                return <TableRow key={event.id} className={cn("max-xl:grid max-xl:grid-cols-[80px_minmax(0,1fr)] max-xl:items-start max-xl:gap-x-3 max-xl:gap-y-3 max-xl:px-4 max-xl:py-4 [&>td]:max-xl:p-0 [&>td]:max-xl:whitespace-normal", phase === "past" && "opacity-75")}>
                  <TableCell className="px-6 py-4 max-xl:col-start-1 max-xl:row-start-1"><div className="relative flex h-14 w-24 max-xl:h-12 max-xl:w-20 items-center justify-center overflow-hidden rounded-lg bg-[#d9d8ce] text-[#4a463f]">{event.coverImageUrl ? <Image src={withBasePath(coverThumbUrl(event.coverImageUrl))} alt="" fill unoptimized sizes="96px" className="object-cover" /> : <div className="flex flex-col items-center gap-1"><ImageIcon className="size-5" aria-hidden="true" /><span className="text-[10px] font-semibold">รูปปก</span></div>}</div></TableCell>
                  <TableCell className="py-4 max-xl:col-start-2 max-xl:row-start-1">
                    <div className="flex flex-col gap-2">
                      <Link href={href} className="py-0.5 font-heading text-base font-semibold leading-snug whitespace-normal hover:underline">{event.title}</Link>
                      <span className="flex flex-wrap gap-1.5">
                        {phase === "today" && <span className={cn(chip, "bg-primary text-primary-foreground")}>จัดวันนี้</span>}
                        {phase === "past" && <span className={cn(chip, "bg-muted text-muted-foreground")}>จบแล้ว</span>}
                        <span className={cn(chip, event.status === "PUBLISHED" ? "bg-accent text-accent-foreground" : "bg-muted text-muted-foreground")}>{event.status === "PUBLISHED" ? "เปิดรับสมัคร" : "ปิดรับสมัครแล้ว"}</span>
                        <span className={cn(chip, "bg-muted text-foreground")}>{typeLabel[event.eventType]}</span>
                      </span>
                      {event.location && <span className="text-xs text-muted-foreground [overflow-wrap:anywhere]">{event.location}</span>}
                    </div>
                  </TableCell>
                  <TableCell className="max-xl:col-span-2 max-xl:row-start-2">{event.days.length ? <div className="flex items-center gap-1.5">
                    {event.days.slice(0, 3).map((day) => <span key={day.id} className={cn("flex h-11 w-10.5 flex-col items-center justify-center rounded-lg border bg-background", day.id === todayDay?.id && "border-primary bg-accent")}><span className="font-heading text-[15px] font-bold leading-tight">{formatDayNumber(day.date)}</span><span className="text-[11px] text-muted-foreground">{formatMonth(day.date)}</span></span>)}
                    {event.days.length > 3 && <span className="text-xs text-muted-foreground">{`+${event.days.length - 3} วัน`}</span>}
                  </div> : <span className="text-sm text-muted-foreground">ยังไม่กำหนดวัน</span>}</TableCell>
                  <TableCell className="text-sm text-muted-foreground max-2xl:hidden">{roleOf(event)}</TableCell>
                  <TableCell className="max-xl:col-span-2 max-xl:row-start-3">
                    {stats ? <div className="flex w-full max-w-60 flex-col gap-1.5">
                      <div className="flex items-baseline justify-between gap-3"><span className="text-sm font-semibold">{`${stats.checked.toLocaleString("th-TH")} / ${stats.expected.toLocaleString("th-TH")} คน`}</span><span className="text-xs text-muted-foreground">{`${sessionsToday} รอบวันนี้`}</span></div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label={`เช็คชื่อแล้ว ${stats.checked} จาก ${stats.expected} คน`} aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}><div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} /></div>
                    </div>
                      : <span className="text-sm text-muted-foreground">{next ? `ครั้งถัดไป ${formatEventDay(next.date)}` : event.days.length ? "จัดครบทุกวันแล้ว" : "—"}</span>}
                  </TableCell>
                  <TableCell className="pr-5 max-xl:col-span-2 max-xl:row-start-4">
                    <Button asChild variant={phase === "today" ? "default" : "outline"} className="w-full xl:w-auto"><Link href={href}><QrCodeIcon data-icon="inline-start" aria-hidden="true" />{phase === "today" ? "เริ่มเช็คชื่อ" : phase === "past" ? "ดูประวัติเช็คชื่อ" : "เปิดหน้าเช็คชื่อ"}</Link></Button>
                  </TableCell>
                </TableRow>;
              })}
            </TableBody>
          </Table>
          <Pagination label="หน้ารายการโครงการเช็คชื่อ" paging={paging} unit="โครงการ" hrefFor={pageHref} />
        </section>
      )}
    </main>
  </AppShell>;
}
