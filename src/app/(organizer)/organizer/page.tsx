import type { Prisma } from "@prisma/client";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { headers } from "next/headers";
import { ClipboardListIcon, CopyIcon, ExternalLinkIcon, ImageIcon, LayoutDashboardIcon, LinkIcon, LockKeyholeIcon, MoreVerticalIcon, PencilIcon, PlusIcon, SearchIcon, Trash2Icon, UsersIcon, XIcon } from "lucide-react";

import { cloneEvent } from "@/app/(organizer)/organizer/actions";
import { deleteOwnedEvent } from "@/app/(organizer)/organizer/[eventId]/delete-action";
import { CopyButton } from "@/components/copy-button";
import { Pagination } from "@/components/pagination";
import { ParamCombobox } from "@/components/param-combobox";
import { coverThumbUrl } from "@/features/events/cover-url";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { readRegistrationFields, validateRegistrationFields } from "@/features/events/registration-fields";
import { formatDayNumber, formatMonth } from "@/lib/format";
import { pageWindow, readPage } from "@/lib/pagination";
import { cn } from "@/lib/utils";
import { requireActiveUser } from "@/server/authorization/session";
import { db } from "@/server/db";
import { isFeatureEnabled, mayCreateEvents } from "@/server/settings/features";
import { withBasePath } from "@/lib/base-path";

export const metadata: Metadata = {
  title: "โครงการ",
};

const EVENTS_PAGE_SIZE = 20;
const CLONE_PICKER_LIMIT = 50;

const statusLabel = { DRAFT: "ฉบับร่าง", PUBLISHED: "เผยแพร่แล้ว", CLOSED: "ปิดรับแล้ว" } as const;
const statusTone = { DRAFT: "bg-amber-100 text-amber-900", PUBLISHED: "bg-accent text-accent-foreground", CLOSED: "bg-muted text-muted-foreground" } as const;
const typeLabel = { INTERNAL: "ภายใน", EXTERNAL: "ภายนอก", MIXED: "ผสม" } as const;
const chip = "inline-flex items-center rounded-md px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap";

type Setup = { label: string; step: number; ready?: boolean };

/** The first thing a draft still needs before it can be published, in wizard order. */
function nextSetupStep(event: { title: string; registrationDeadline: Date | null; fields: unknown; days: { id: string }[]; sessions: { eventDayId: string | null }[] }): Setup {
  if (!event.days.length) return { label: "ตั้งวันจัด", step: 2 };
  const fields = readRegistrationFields(event.fields);
  if (!fields.length || !validateRegistrationFields(fields)) return { label: "เพิ่มฟอร์ม", step: 3 };
  const everyDay = event.sessions.some((session) => !session.eventDayId);
  if (!everyDay && !event.days.every((day) => event.sessions.some((session) => session.eventDayId === day.id))) return { label: "เพิ่มรอบเช็คชื่อ", step: 4 };
  if (!event.registrationDeadline || event.registrationDeadline <= new Date()) return { label: "ตั้งวันปิดรับ", step: 1 };
  return { label: "พร้อมเผยแพร่", step: 5, ready: true };
}

function RegistrationSummary({ status, total, days, occupiedSeatsByDay }: {
  status: "DRAFT" | "PUBLISHED" | "CLOSED";
  total: number;
  days: { id: string; maxSeats: number | null }[];
  occupiedSeatsByDay: ReadonlyMap<string, number>;
}) {
  const capacity = days.reduce((sum, day) => sum + (day.maxSeats ?? 0), 0);
  const unlimited = days.some((day) => day.maxSeats === null);
  const occupied = days.reduce((sum, day) => sum + (occupiedSeatsByDay.get(day.id) ?? 0), 0);
  const fill = capacity > 0 && !unlimited ? Math.min(100, Math.round(occupied / capacity * 100)) : 0;
  const note = status === "DRAFT" ? "ยังไม่เผยแพร่" : !unlimited && capacity > 0 && occupied >= capacity ? `เต็ม ${occupied}/${capacity}` : days.length ? `${days.length} วัน` : "ยังไม่มีวันจัด";
  return <div className="flex min-w-40 flex-col gap-1.5 tabular-nums">
    <div className="flex items-center justify-between gap-3 text-sm"><span className="font-semibold">{total.toLocaleString("th-TH")} คน</span><span className="text-xs text-muted-foreground">{note}</span></div>
    <div role="progressbar" aria-label={capacity && !unlimited ? `จองที่นั่งแล้ว ${occupied} จาก ${capacity}` : "ไม่จำกัดที่นั่ง"} aria-valuemin={0} aria-valuemax={100} aria-valuenow={fill} className="h-2 overflow-hidden rounded-full bg-[#ece8df]">
      <div className="h-full rounded-full bg-primary" style={{ width: `${fill}%` }} />
    </div>
  </div>;
}

const organizerRoleLabel = { FULL: "ผู้ร่วมจัด", CHECKIN_ONLY: "เช็คชื่ออย่างเดียว" } as const;
const TEAM_PREVIEW = 2;

/** Owner and co-organizers under a project's title: the first two inline, the rest behind a "+N" popover. */
function EventTeam({ id, title, owner, organizers, highlight }: {
  id: string;
  title: string;
  owner: string;
  organizers: { userId: string; role: keyof typeof organizerRoleLabel; user: { name: string } }[];
  highlight: string;
}) {
  const person = (item: (typeof organizers)[number]) => <span key={item.userId} title={`${item.user.name} · ${organizerRoleLabel[item.role]}`} className={cn("inline-flex min-w-0 max-w-full items-center gap-1 rounded-md border bg-background px-1.5 py-0.5", item.userId === highlight && "border-primary bg-accent")}>
    <span className="max-w-40 truncate font-medium text-foreground">{item.user.name}</span>
    <span className={cn("shrink-0", item.role === "FULL" ? "text-primary" : "text-muted-foreground")}>· {organizerRoleLabel[item.role]}</span>
  </span>;
  const rest = organizers.length - TEAM_PREVIEW;
  return <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
    <span className="flex min-w-0 max-w-full gap-1" title={owner}>เจ้าของ <span className="max-w-48 truncate font-medium text-foreground">{owner}</span></span>
    {organizers.length > 0 && <span aria-hidden="true">·</span>}
    {organizers.slice(0, TEAM_PREVIEW).map(person)}
    {rest > 0 && <>
      <button type="button" popoverTarget={id} aria-label={`ดูผู้ร่วมจัดทั้งหมด ${organizers.length} คน`} className="rounded-md px-1.5 py-0.5 font-semibold text-primary hover:bg-accent">+{rest}</button>
      <div id={id} popover="auto" className="m-auto w-[min(92vw,360px)] whitespace-normal rounded-xl border bg-card p-4 shadow-xl backdrop:bg-black/20">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col"><p className="font-heading font-bold">ทีมผู้จัด</p><p className="line-clamp-2 text-xs text-muted-foreground">{title}</p></div>
          <Button type="button" variant="ghost" size="icon-sm" popoverTarget={id} popoverTargetAction="hide" aria-label="ปิด"><XIcon aria-hidden="true" /></Button>
        </div>
        <ul className="mt-3 flex max-h-[60vh] flex-col divide-y overflow-y-auto text-sm">
          <li className="flex items-center justify-between gap-3 py-2"><span className="font-medium">{owner}</span><span className="text-xs text-muted-foreground">เจ้าของ</span></li>
          {organizers.map((item) => <li key={item.userId} className={cn("flex items-center justify-between gap-3 py-2", item.userId === highlight && "font-semibold")}>
            <span>{item.user.name}</span>
            <span className={cn("text-xs", item.role === "FULL" ? "text-primary" : "text-muted-foreground")}>{organizerRoleLabel[item.role]}</span>
          </li>)}
        </ul>
      </div>
    </>}
  </div>;
}

function MenuLink({ href, icon: Icon, children, external }: { href: string; icon: typeof PencilIcon; children: React.ReactNode; external?: boolean }) {
  return <Link href={href} target={external ? "_blank" : undefined} rel={external ? "noreferrer" : undefined} className="flex items-center gap-2.5 rounded-md px-3 py-2.5 text-sm outline-none hover:bg-muted focus-visible:bg-muted"><Icon className="size-4 text-muted-foreground" aria-hidden="true" />{children}</Link>;
}

export default async function OrganizerPage({ searchParams }: PageProps<"/organizer">) {
  const user = await requireActiveUser();
  const params = await searchParams;
  const status = typeof params.status === "string" && ["DRAFT", "PUBLISHED", "CLOSED"].includes(params.status) ? params.status : "ALL";
  const query = typeof params.q === "string" ? params.q.trim().slice(0, 100) : "";
  const mine = params.scope === "mine";
  const organizerId = typeof params.organizer === "string" ? params.organizer.slice(0, 64) : "";
  // Every organizer sees every project in the list; editing stays limited to the owner, FULL co-organizers and admins
  // (enforced again by requireEventAccess on each project page).
  const accessWhere: Prisma.EventWhereInput = user.role === "ADMIN" ? { deletedAt: null } : { deletedAt: null, OR: [{ ownerId: user.id }, { organizers: { some: { userId: user.id, role: "FULL" } } }] };
  const visibleWhere: Prisma.EventWhereInput = mine ? accessWhere : { deletedAt: null };
  const listWhere: Prisma.EventWhereInput = { AND: [visibleWhere,...(status !== "ALL" ? [{ status: status as "DRAFT" | "PUBLISHED" | "CLOSED" }] : []), ...(query ? [{ title: { contains: query } }] : []), ...(organizerId ? [{ organizers: { some: { userId: organizerId } } }] : [])] };
  const canCreate = await mayCreateEvents(user.role);
  const canClone = canCreate && await isFeatureEnabled("eventClone");
  // Tab counts cover every project in the chosen scope; the table loads one page of the filtered list.
  const [byStatus, listTotal, cloneSources, coOrganizers] = await Promise.all([
    db.event.groupBy({ by: ["status"], where: visibleWhere, _count: { _all: true } }),
    db.event.count({ where: listWhere }),
    canClone ? db.event.findMany({ where: accessWhere, orderBy: { createdAt: "desc" }, take: CLONE_PICKER_LIMIT, select: { id: true, title: true, status: true, fields: true, _count: { select: { days: true } } } }) : Promise.resolve([]),
    // Everyone who co-organizes at least one project, for the "co-organizer" filter.
    db.user.findMany({ where: { organizerOf: { some: { event: { deletedAt: null } } } }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const statusTotal = (value: string) => byStatus.find((row) => row.status === value)?._count._all ?? 0;
  const totalEvents = byStatus.reduce((sum, row) => sum + row._count._all, 0);
  const paging = pageWindow(readPage(params.page), EVENTS_PAGE_SIZE, listTotal);
  const pageHref = (target: number) => {
    const next = new URLSearchParams({ ...(mine ? { scope: "mine" } : {}), ...(status !== "ALL" ? { status } : {}), ...(query ? { q: query } : {}), ...(organizerId ? { organizer: organizerId } : {}), ...(target > 1 ? { page: String(target) } : {}) });
    return `/organizer${next.size ? `?${next}` : ""}`;
  };
  const events = await db.event.findMany({
    where: listWhere,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: paging.skip, take: paging.take,
    include: {
      days: { orderBy: { date: "asc" }, select: { id: true, date: true, maxSeats: true } },
      sessions: { select: { eventDayId: true } },
      clonedFrom: { select: { title: true, deletedAt: true } },
      owner: { select: { name: true } },
      organizers: { orderBy: { addedAt: "asc" }, select: { userId: true, role: true, user: { select: { name: true } } } },
      _count: { select: { registrants: true } },
    },
  });
  const eventIds = events.map((event) => event.id);
  const eventDayIds = events.flatMap((event) => event.days.map((day) => day.id));
  const [statusCounts, occupiedSeatCounts] = await Promise.all([
    eventIds.length ? db.registrant.groupBy({ by: ["eventId", "status"], where: { eventId: { in: eventIds } }, _count: { _all: true } }) : Promise.resolve([]),
    eventDayIds.length ? db.registrantEventDay.groupBy({ by: ["eventDayId"], where: { eventDayId: { in: eventDayIds }, status: { in: ["PENDING", "APPROVED"] } }, _count: { _all: true } }) : Promise.resolve([]),
  ]);
  const countOf = (eventId: string, key: string) => statusCounts.find((row) => row.eventId === eventId && row.status === key)?._count._all ?? 0;
  const occupiedSeatsByDay = new Map(occupiedSeatCounts.map((item) => [item.eventDayId, item._count._all]));
  const statusFilters = [
    { value: "ALL", label: "ทั้งหมด", count: totalEvents },
    { value: "DRAFT", label: "ฉบับร่าง", count: statusTotal("DRAFT") },
    { value: "PUBLISHED", label: "เผยแพร่", count: statusTotal("PUBLISHED") },
    { value: "CLOSED", label: "ปิดรับ", count: statusTotal("CLOSED") },
  ];
  const scopeFilters = [{ mine: false, label: "ทั้งหมด" }, { mine: true, label: "ที่ฉันจัดการได้" }];
  const listHref = (filter: { mine: boolean; status: string }) => {
    const next = new URLSearchParams({ ...(filter.mine ? { scope: "mine" } : {}), status: filter.status, ...(query ? { q: query } : {}), ...(organizerId ? { organizer: organizerId } : {}) });
    return `/organizer?${next}`;
  };
  const filteredPerson = organizerId ? coOrganizers.find((person) => person.id === organizerId) : undefined;
  const requestHeaders = await headers();
  const origin = process.env.APP_BASE_URL ?? `${requestHeaders.get("x-forwarded-proto") ?? "http"}://${requestHeaders.get("host")}`;

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-5 py-8 lg:px-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <h1 className="font-heading text-3xl font-bold tracking-tight">โครงการ</h1>
          <p className="text-sm text-muted-foreground">{totalEvents.toLocaleString("th-TH")} โครงการ{mine ? `ที่คุณ${user.role === "ADMIN" ? "ดูแลได้ในฐานะผู้ดูแลระบบ" : "เป็นเจ้าของหรือผู้ร่วมจัด"}` : "ในระบบ · แก้ไขได้เฉพาะโครงการที่คุณเป็นเจ้าของหรือผู้ร่วมจัด"}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canClone && cloneSources.length > 0 && <>
            <Button type="button" variant="outline" size="lg" popoverTarget="clone-picker"><CopyIcon data-icon="inline-start" aria-hidden="true" />ทำสำเนาจากโครงการเดิม</Button>
            <div id="clone-picker" popover="auto" className="m-auto w-[min(92vw,480px)] rounded-xl border bg-card p-5 shadow-xl backdrop:bg-black/30">
              <div className="flex items-start justify-between gap-3">
                <div><p className="font-heading text-lg font-bold">ทำสำเนาจากโครงการเดิม</p><p className="text-xs text-muted-foreground">คัดลอกข้อมูล ฟอร์ม รูปปก และรอบเช็คชื่อ · ไม่คัดลอกวันจัด ที่นั่ง ผู้ลงทะเบียน และผู้ร่วมจัด</p></div>
                <Button type="button" variant="ghost" size="icon-sm" popoverTarget="clone-picker" popoverTargetAction="hide" aria-label="ปิด"><XIcon aria-hidden="true" /></Button>
              </div>
              <ul className="mt-4 flex max-h-[60vh] flex-col divide-y overflow-y-auto">{cloneSources.map((event) => <li key={event.id} className="flex items-center justify-between gap-3 py-2.5">
                <span className="flex min-w-0 flex-col"><span className="truncate font-semibold">{event.title}</span><span className="text-xs text-muted-foreground">{statusLabel[event.status]} · {event._count.days} วัน · {readRegistrationFields(event.fields).length} ฟิลด์</span></span>
                <form action={cloneEvent.bind(null, event.id)}><Button type="submit" variant="outline" size="sm">ทำสำเนา</Button></form>
              </li>)}</ul>
              {totalEvents > cloneSources.length && <p className="mt-3 text-xs text-muted-foreground">แสดง {cloneSources.length} โครงการล่าสุด · โครงการที่เก่ากว่านี้ทำสำเนาได้จากเมนู ⋮ ในรายการ</p>}
            </div>
          </>}
          {canCreate && <Button asChild size="lg"><Link href="/organizer/new"><PlusIcon data-icon="inline-start" aria-hidden="true" />สร้างโครงการ</Link></Button>}
        </div>
      </div>

      {params.error === "create-disabled" && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">ผู้ดูแลระบบปิดการสร้าง/ทำสำเนาโครงการสำหรับผู้จัดไว้ กรุณาติดต่อผู้ดูแลระบบ</p>}
      {params.deleted === "1" && <p role="status" className="rounded-lg border border-primary/30 bg-accent px-4 py-3 text-sm text-accent-foreground">ลบโครงการแล้ว — ถ้ามีผู้ลงทะเบียน ระบบเก็บข้อมูลเดิมไว้ตรวจสอบย้อนหลัง</p>}

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap gap-2">
          <nav aria-label="ขอบเขตโครงการ" className="flex flex-wrap gap-0.5 rounded-lg bg-[#eae6dd] p-1">
            {scopeFilters.map((scope) => <Link key={scope.label} href={listHref({ mine: scope.mine, status })} aria-current={mine === scope.mine ? "page" : undefined}
              className={cn("rounded-md px-3.5 py-1.5 text-sm", mine === scope.mine ? "bg-card font-semibold text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>{scope.label}</Link>)}
          </nav>
          <nav aria-label="กรองสถานะโครงการ" className="flex flex-wrap gap-0.5 rounded-lg bg-[#eae6dd] p-1">
            {statusFilters.map((filter) => <Link key={filter.value} href={listHref({ mine, status: filter.value })} aria-current={status === filter.value ? "page" : undefined}
              className={cn("rounded-md px-3.5 py-1.5 text-sm", status === filter.value ? "bg-card font-semibold text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>{filter.label} {filter.count}</Link>)}
          </nav>
        </div>
        <div className="flex w-full flex-wrap gap-2 sm:w-auto">
          <ParamCombobox id="organizer-filter" name="organizer" label="กรองตามผู้ร่วมจัด" value={organizerId} disabled={!coOrganizers.length}
            placeholder={coOrganizers.length ? "ผู้ร่วมจัด: พิมพ์ชื่อเพื่อกรอง" : "ยังไม่มีผู้ร่วมจัดในระบบ"}
            options={coOrganizers.map((person) => ({ value: person.id, label: person.name }))} />
          <form method="get" role="search" className="relative w-full sm:w-72">
            {mine && <input type="hidden" name="scope" value="mine" />}
            {status !== "ALL" && <input type="hidden" name="status" value={status} />}
            {organizerId && <input type="hidden" name="organizer" value={organizerId} />}
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <label htmlFor="project-search" className="sr-only">ค้นหาชื่อโครงการ</label>
            <Input id="project-search" name="q" type="search" defaultValue={query} maxLength={100} placeholder="ค้นหาชื่อโครงการ" className="h-10 bg-card pl-9" />
          </form>
        </div>
      </div>
      {filteredPerson && <p role="status" className="-mt-2 text-sm text-muted-foreground">โครงการที่ <span className="font-semibold text-foreground">{filteredPerson.name}</span> เป็นผู้ร่วมจัด · {listTotal.toLocaleString("th-TH")} โครงการ</p>}

      {events.length === 0 ? (
        <Empty className="min-h-80 border bg-card">
          <EmptyHeader>
            <EmptyMedia variant="icon"><ClipboardListIcon aria-hidden="true" /></EmptyMedia>
            <EmptyTitle>{totalEvents ? "ไม่พบโครงการที่ตรงเงื่อนไข" : "ยังไม่มีโครงการ"}</EmptyTitle>
            <EmptyDescription>{totalEvents ? "ลองเปลี่ยนแท็บสถานะหรือคำค้นหา" : "เริ่มจากสร้างโครงการใหม่ แล้วตั้งวัน ฟอร์ม และรอบเช็คชื่อ ก่อนกดเผยแพร่"}</EmptyDescription>
          </EmptyHeader>
          {!totalEvents && canCreate && <EmptyContent><Button asChild><Link href="/organizer/new"><PlusIcon data-icon="inline-start" aria-hidden="true" />สร้างโครงการแรก</Link></Button></EmptyContent>}
        </Empty>
      ) : (
        <section aria-label="รายการโครงการ" className="overflow-x-auto rounded-xl border bg-card">
          {/* Below xl each row is laid out as a card (grid): the full table needs ~1000px, so phones and tablets would hide columns behind a horizontal scroll. */}
          <Table className="max-xl:block">
            <TableHeader className="bg-secondary max-xl:hidden">
              <TableRow>
                <TableHead className="w-28 px-5">ปก</TableHead>
                <TableHead className="min-w-60">โครงการ</TableHead>
                <TableHead className="min-w-40">วันที่จัด</TableHead>
                <TableHead className="max-2xl:hidden">บทบาท</TableHead>
                <TableHead className="min-w-40">ลงทะเบียน</TableHead>
                <TableHead className="min-w-32">ต้องจัดการ</TableHead>
                <TableHead className="w-12"><span className="sr-only">เมนู</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="max-xl:block">
              {events.map((event) => {
                const owner = event.ownerId === user.id;
                const canAdminister = owner || user.role === "ADMIN";
                const membership = event.organizers.find((item) => item.userId === user.id);
                const canManage = canAdminister || membership?.role === "FULL";
                const setup = event.status === "DRAFT" ? nextSetupStep(event) : null;
                const pending = countOf(event.id, "PENDING");
                const waitlisted = countOf(event.id, "WAITLISTED");
                const openHref = event.status === "DRAFT" ? `/organizer/${event.id}?step=${setup?.step ?? 1}` : `/organizer/${event.id}/dashboard`;
                const publicUrl = `${origin}${withBasePath(`/r/${event.slug}`)}`;
                const menuId = `event-menu-${event.id}`;
                return <TableRow key={event.id} className={cn("max-xl:grid max-xl:grid-cols-[80px_minmax(0,1fr)_auto] max-xl:items-start max-xl:gap-x-3 max-xl:gap-y-3 max-xl:px-4 max-xl:py-4 [&>td]:max-xl:p-0 [&>td]:max-xl:whitespace-normal", event.status === "CLOSED" && "opacity-75")}>
                  <TableCell className="px-6 py-4 max-xl:col-start-1 max-xl:row-start-1"><div className="relative flex h-14 w-24 max-xl:h-12 max-xl:w-20 items-center justify-center overflow-hidden rounded-lg bg-[#d9d8ce] text-[#4a463f]">{event.coverImageUrl ? <Image src={withBasePath(coverThumbUrl(event.coverImageUrl))} alt="" fill unoptimized sizes="96px" className="object-cover" /> : <div className="flex flex-col items-center gap-1"><ImageIcon className="size-5" aria-hidden="true" /><span className="text-[10px] font-semibold">รูปปก</span></div>}</div></TableCell>
                  <TableCell className="py-4 max-xl:col-start-2 max-xl:row-start-1">
                    <div className="flex flex-col gap-2">
                      {canManage ? <Link href={openHref} className="py-0.5 font-heading text-base font-semibold leading-snug whitespace-normal hover:underline">{event.title}</Link>
                        : <span className="py-0.5 font-heading text-base font-semibold leading-snug whitespace-normal">{event.title}</span>}
                      <EventTeam id={`team-${event.id}`} title={event.title} owner={event.owner.name} organizers={event.organizers} highlight={organizerId} />
                      <span className="flex flex-wrap gap-1.5">
                        <span className={cn(chip, statusTone[event.status])}>{statusLabel[event.status]}</span>
                        <span className={cn(chip, "bg-muted text-foreground")}>{typeLabel[event.eventType]}</span>
                        {event.status !== "CLOSED" && <span className={cn(chip, event.autoApprove ? "bg-accent text-accent-foreground" : "bg-muted text-foreground")}>{event.autoApprove ? "อนุมัติอัตโนมัติ" : "อนุมัติเอง"}</span>}
                        {event.clonedFrom && <span className={cn(chip, "max-w-60 truncate bg-muted font-medium text-muted-foreground")} title={event.clonedFrom.title}>ทำสำเนาจาก {event.clonedFrom.title}</span>}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="max-xl:col-span-3 max-xl:row-start-2">{event.days.length ? <div className="flex items-center gap-1.5">
                    {event.days.slice(0, 3).map((day) => <span key={day.id} className="flex h-11 w-10.5 flex-col items-center justify-center rounded-lg border bg-background"><span className="font-heading text-[15px] font-bold leading-tight">{formatDayNumber(day.date)}</span><span className="text-[11px] text-muted-foreground">{formatMonth(day.date)}</span></span>)}
                    {event.days.length > 3 && <span className="text-xs text-muted-foreground">+{event.days.length - 3} วัน</span>}
                  </div> : <span className="text-sm text-muted-foreground">ยังไม่กำหนดวัน</span>}</TableCell>
                  <TableCell className="text-sm text-muted-foreground max-2xl:hidden">{owner ? "เจ้าของ" : user.role === "ADMIN" ? "ผู้ดูแลระบบ" : canManage ? "ผู้ร่วมจัด" : membership ? "เช็คชื่ออย่างเดียว" : "ดูอย่างเดียว"}</TableCell>
                  <TableCell className="max-xl:col-span-3 max-xl:row-start-3"><RegistrationSummary status={event.status} total={event._count.registrants} days={event.days} occupiedSeatsByDay={occupiedSeatsByDay} /></TableCell>
                  <TableCell className="max-xl:col-span-3 max-xl:row-start-4 max-xl:empty:hidden">
                    {!canManage ? <span className="text-sm text-muted-foreground">—</span>
                      : setup ? <Link href={`/organizer/${event.id}?step=${setup.step}`} className={cn(chip, "min-h-7 hover:opacity-80", setup.ready ? "bg-accent text-accent-foreground" : "bg-amber-100 text-amber-900")}>{setup.label}</Link>
                      : pending || waitlisted ? <div className="flex max-w-40 flex-wrap gap-1">
                        {pending > 0 && <Link href={`/organizer/${event.id}/registrants?status=PENDING`} className={cn(chip, "min-h-7 bg-amber-100 text-amber-900 hover:opacity-80")}>รออนุมัติ {pending.toLocaleString("th-TH")}</Link>}
                        {waitlisted > 0 && <Link href={`/organizer/${event.id}/registrants?status=WAITLISTED`} className={cn(chip, "min-h-7 bg-muted text-foreground hover:opacity-80")}>รอคิว {waitlisted.toLocaleString("th-TH")}</Link>}
                      </div> : <span className="text-sm text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="pr-4 max-xl:col-start-3 max-xl:row-start-1 max-xl:-mr-2 max-xl:-mt-1">
                    <Button type="button" variant="ghost" size="icon-lg" popoverTarget={menuId} aria-label={`เมนูของ ${event.title}`}><MoreVerticalIcon aria-hidden="true" /></Button>
                    {/* Native popover: rendered in the top layer, so the table's horizontal scroll never clips it. */}
                    <div id={menuId} popover="auto" className="m-auto w-[min(92vw,340px)] whitespace-normal rounded-xl border bg-card p-2 shadow-xl backdrop:bg-black/20">
                      <div className="flex items-start justify-between gap-2 px-3 pb-2 pt-1.5"><p className="line-clamp-2 font-heading font-bold">{event.title}</p><Badge variant="secondary" className={statusTone[event.status]}>{statusLabel[event.status]}</Badge></div>
                      {canManage ? <>
                      <div className="flex flex-col border-t pt-1">
                        {event.status !== "DRAFT" && <MenuLink href={`/organizer/${event.id}/dashboard`} icon={LayoutDashboardIcon}>ภาพรวมโครงการ</MenuLink>}
                        {event.status !== "DRAFT" && <MenuLink href={`/organizer/${event.id}/registrants`} icon={UsersIcon}>ผู้ลงทะเบียน</MenuLink>}
                        <MenuLink href={`/organizer/${event.id}?step=1`} icon={PencilIcon}>แก้ไขโครงการ</MenuLink>
                        {canClone && <form action={cloneEvent.bind(null, event.id)}><button type="submit" className="flex w-full items-center gap-2.5 rounded-md px-3 py-2.5 text-left text-sm outline-none hover:bg-muted focus-visible:bg-muted"><CopyIcon className="size-4 text-muted-foreground" aria-hidden="true" />ทำสำเนาโครงการ (clone)</button></form>}
                      </div>
                      <div className="flex flex-col gap-2 border-t px-3 py-2.5">
                        <span className="flex items-center gap-2 text-sm"><LinkIcon className="size-4 text-muted-foreground" aria-hidden="true" />ลิงก์ลงทะเบียน</span>
                        {event.status === "PUBLISHED" ? <div className="flex flex-wrap items-center gap-2"><CopyButton value={publicUrl} label="คัดลอกลิงก์" /><Button asChild variant="ghost" size="sm"><a href={withBasePath(`/events/${event.slug}`)} target="_blank" rel="noreferrer"><ExternalLinkIcon data-icon="inline-start" aria-hidden="true" />เปิดหน้า</a></Button></div>
                          : <Link href={`/organizer/${event.id}?step=5`} className="text-sm font-semibold text-primary underline-offset-4 hover:underline">{event.status === "DRAFT" ? "ตรวจความพร้อมและเผยแพร่ →" : "เปิดรับลงทะเบียนอีกครั้ง →"}</Link>}
                      </div>
                      <div className="border-t px-1 pt-1">
                        {canAdminister ? <details>
                          <summary className="flex cursor-pointer list-none items-center gap-2.5 rounded-md px-2 py-2.5 text-sm text-destructive hover:bg-destructive/10 [&::-webkit-details-marker]:hidden"><Trash2Icon className="size-4" aria-hidden="true" />ลบโครงการ…</summary>
                          <form action={deleteOwnedEvent.bind(null, event.id)} className="flex flex-col gap-2 px-2 pb-2">
                            <p className="text-xs text-muted-foreground">{event._count.registrants ? `มีผู้ลงทะเบียน ${event._count.registrants.toLocaleString("th-TH")} คน ระบบจะปิดโครงการและเก็บข้อมูลไว้ตรวจสอบย้อนหลัง` : "ยังไม่มีผู้ลงทะเบียน โครงการจะถูกลบถาวร"}</p>
                            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="confirm" required className="size-4 accent-destructive" />ยืนยันลบ “{event.title}”</label>
                            <Button type="submit" variant="destructive" size="sm" className="w-fit">ลบโครงการ</Button>
                          </form>
                        </details> : <p className="flex items-center gap-2.5 px-2 py-2.5 text-sm text-muted-foreground"><Trash2Icon className="size-4" aria-hidden="true" />ลบโครงการได้เฉพาะเจ้าของ</p>}
                      </div>
                      </> : <>
                      <div className="flex items-start gap-2.5 border-t px-3 py-3">
                        <LockKeyholeIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                        <div className="flex flex-col gap-0.5">
                          <p className="text-sm font-semibold">ดูได้อย่างเดียว</p>
                          <p className="text-xs leading-relaxed text-muted-foreground">ถ้าต้องการแก้ไข ให้ <span className="font-medium text-foreground">{event.owner.name}</span> (เจ้าของโครงการ) เพิ่มคุณเป็นผู้ร่วมจัดก่อน</p>
                        </div>
                      </div>
                      {event.status === "PUBLISHED" && <div className="flex flex-col gap-2 border-t px-3 py-2.5">
                        <span className="flex items-center gap-2 text-sm"><LinkIcon className="size-4 text-muted-foreground" aria-hidden="true" />ลิงก์ลงทะเบียน</span>
                        <div className="flex flex-wrap items-center gap-2"><CopyButton value={publicUrl} label="คัดลอกลิงก์" /><Button asChild variant="ghost" size="sm"><a href={withBasePath(`/events/${event.slug}`)} target="_blank" rel="noreferrer"><ExternalLinkIcon data-icon="inline-start" aria-hidden="true" />เปิดหน้า</a></Button></div>
                      </div>}
                      </>}
                    </div>
                  </TableCell>
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
