import Link from "next/link";
import { Prisma, type RegistrantStatus } from "@prisma/client";
import { ChevronLeftIcon, ChevronRightIcon, DownloadIcon, FileIcon, FileUpIcon, LinkIcon, LockIcon, QrCodeIcon, SearchIcon, ShieldIcon, TriangleAlertIcon, UserPlusIcon, XIcon } from "lucide-react";

import { approveSelected, decideRegistrant, decideRegistrantDay, reissueStatusLink, resendEmailNotification, resendLineNotification, resolveDeletionRequest } from "@/app/(organizer)/organizer/[eventId]/registrants/actions";
import { AutoRefresh } from "@/components/auto-refresh";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { readFileAnswers, readRegistrationFields } from "@/features/events/registration-fields";
import { formatDateTime, formatEventDay, formatEventDayWithWeekday } from "@/lib/format";
import { cn } from "@/lib/utils";
import { requireEventAccess } from "@/server/authorization/event";
import { canManageEvent } from "@/server/authorization/policy";
import { db } from "@/server/db";
import { emailConfigured } from "@/server/email/client";
import { lineConfigured } from "@/server/line/client";
import { getSeatAvailability } from "@/server/registrations/day-status";
import { getWaitlistOpenings } from "@/server/registrations/waitlist-openings";
import { getFeatureFlags } from "@/server/settings/features";
import { withBasePath } from "@/lib/base-path";

import { OrganizerEventHeader } from "../event-header";
import { WaitlistOpenings } from "../waitlist-openings";
import { BulkSelectForm } from "./bulk-select";

const labels: Record<RegistrantStatus, string> = { PENDING: "รออนุมัติ", WAITLISTED: "รอคิว", APPROVED: "อนุมัติ", REJECTED: "ปฏิเสธ", CANCELLED: "ยกเลิก" };
const statusOrder: RegistrantStatus[] = ["PENDING", "WAITLISTED", "APPROVED", "REJECTED", "CANCELLED"];
const chipTone: Record<RegistrantStatus, string> = {
  PENDING: "border-amber-300 bg-amber-50 text-amber-900",
  WAITLISTED: "border-orange-300 bg-orange-50 text-orange-900",
  APPROVED: "border-primary/40 bg-accent text-accent-foreground",
  REJECTED: "border-border bg-muted text-muted-foreground line-through",
  CANCELLED: "border-border bg-muted text-muted-foreground line-through",
};
const lineKinds: Record<string, string> = { linked: "ข้อความต้อนรับ", status: "แจ้งสถานะ", resend: "ส่งซ้ำ" };
const lineStatuses: Record<string, string> = { QUEUED: "รอส่ง", SENDING: "กำลังส่ง", SENT: "ส่งแล้ว", FAILED: "ส่งไม่ถึง", SKIPPED: "ไม่ได้ส่ง (ไม่มีอะไรใหม่ / ปิดอยู่)" };

const resultMessages: Record<string, [string, "ok" | "warn" | "error"]> = {
  updated: ["บันทึกการตัดสินใจแล้ว", "ok"],
  partial: ["อนุมัติบางวันแล้ว วันที่เต็มยังอยู่ในคิวสำรอง", "warn"],
  full: ["ที่นั่งยังเต็ม ผู้สมัครยังอยู่ในคิวสำรอง", "warn"],
  invalid: ["ทำรายการนี้ไม่ได้ สถานะอาจเปลี่ยนไปแล้ว กรุณาตรวจอีกครั้ง", "error"],
  missing: ["ไม่พบผู้ลงทะเบียนนี้", "error"],
  retry: ["ระบบกำลังทำรายการอื่นพร้อมกัน กรุณาลองใหม่", "error"],
  confirm: ["กรุณาติ๊กยืนยันก่อนออกลิงก์สถานะใหม่", "error"],
  bulk: ["อนุมัติทุกคนที่เลือกแล้ว", "ok"],
  "bulk-partial": ["อนุมัติได้บางส่วน — ดูรายชื่อที่ยังไม่ผ่านด้านล่าง", "warn"],
  promoted: ["เลื่อนคิวถัดไปแล้ว", "ok"],
  deleted: ["ลบข้อมูลตามคำขอแล้ว — ข้อมูลส่วนบุคคลถูกปกปิด การลงทะเบียนที่ยังไม่ถึงวันถูกยกเลิก", "ok"],
  "delete-rejected": ["ปฏิเสธคำขอลบข้อมูลแล้ว ผู้สมัครจะเห็นเหตุผลในหน้าสถานะ", "ok"],
  "delete-confirm": ["กรุณาติ๊กยืนยันก่อนลบข้อมูล", "error"],
  "delete-note": ["กรุณาระบุเหตุผลที่ต้องเก็บข้อมูลไว้ (อย่างน้อย 3 ตัวอักษร)", "error"],
  "email-resent": ["ส่งอีเมลผลและ QR อีกครั้งแล้ว (ส่งจริงภายในไม่กี่วินาที ดูผลในแถวอีเมล) · ถ้าผู้สมัครหาไม่เจอ ให้ดูในโฟลเดอร์ Spam", "ok"],
  "email-limit": ["ส่งอีเมลซ้ำได้ไม่เกิน 3 ครั้งต่อชั่วโมงต่อคน", "warn"],
  "email-invalid": ["กรุณากรอกอีเมลให้ถูกต้อง", "error"],
  "email-taken": ["อีเมลนี้มีผู้ลงทะเบียนโครงการนี้แล้ว", "error"],
  "email-unavailable": ["การส่งอีเมลปิดอยู่ (ตั้งค่าระบบ) หรือยังไม่ได้ตั้งค่า SMTP", "error"],
  "line-resent": ["ส่งสถานะล่าสุดทาง LINE แล้ว (ส่งจริงภายในไม่กี่วินาที ดูผลในแถว LINE)", "ok"],
  "line-limit": ["ส่งทาง LINE ซ้ำได้ไม่เกิน 3 ครั้งต่อชั่วโมงต่อคน", "warn"],
  "line-not-linked": ["ผู้สมัครคนนี้ยังไม่ได้เชื่อม LINE", "error"],
  "line-unavailable": ["ระบบแจ้งเตือนทาง LINE ปิดอยู่ (ตั้งค่าระบบ) หรือยังไม่ได้ตั้งคีย์", "error"],
  "promote-none": ["ไม่ได้เลื่อนคิว: ที่นั่งเต็มแล้วหรือไม่มีคนรอคิว (อาจมีผู้จัดคนอื่นเลื่อนไปก่อน)", "warn"],
};

/** The stored display name (see features/registrations/display-name.ts), else the email. */
function displayName(person: { displayName: string | null; email: string | null }) {
  return person.displayName ?? person.email ?? "ไม่มีชื่อ (ข้อมูลถูกปกปิด)";
}

function asAnswers(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export default async function RegistrantsPage({ params, searchParams }: PageProps<"/organizer/[eventId]/registrants">) {
  const { eventId } = await params;
  const search = await searchParams;
  const { event, membership } = await requireEventAccess(eventId, "view");
  const query = typeof search.q === "string" ? search.q.trim().slice(0, 100) : "";
  const selectedStatus = typeof search.status === "string" && search.status in labels ? search.status as RegistrantStatus : undefined;
  const fields = readRegistrationFields(event.fields);
  const eventDays = await db.eventDay.findMany({ where: { eventId }, orderBy: { date: "asc" }, select: { id: true, date: true } });
  const dayIndex = new Map(eventDays.map((day, index) => [day.id, index + 1]));
  const selectedDay = typeof search.day === "string" && eventDays.some((item) => item.id === search.day) ? search.day : undefined;
  const selectedField = typeof search.field === "string" ? fields.find((item) => item.key === search.field && item.type !== "file" && !item.sensitive) : undefined;
  const answerValue = typeof search.answer === "string" ? search.answer.trim().slice(0, 3000) : "";
  const currentPage = typeof search.page === "string" && /^\d+$/.test(search.page) ? Math.max(1, Math.min(100000, Number(search.page))) : 1;
  const pageSize = 50;

  const where: Prisma.RegistrantWhereInput = { eventId };
  if (selectedStatus && !selectedDay) where.status = selectedStatus;
  if (selectedDay) where.days = { some: { eventDayId: selectedDay, ...(selectedStatus ? { status: selectedStatus } : {}) } };
  if (query) {
    where.OR = [
      { displayName: { contains: query } },
      { email: { contains: query } },
      ...fields.filter((item) => ["text", "textarea", "email", "tel"].includes(item.type) && !item.sensitive).map((item) => ({ answers: { path: `$.${item.key}`, string_contains: query, mode: "insensitive" as const } })),
    ];
  }
  if (selectedField && answerValue) {
    const answerFilter = selectedField.type === "checkbox"
      ? { path: `$.${selectedField.key}`, array_contains: [answerValue] }
      : ["select", "radio", "date"].includes(selectedField.type)
        ? { path: `$.${selectedField.key}`, equals: answerValue }
        : { path: `$.${selectedField.key}`, string_contains: answerValue, mode: "insensitive" as const };
    where.AND = [{ answers: answerFilter }];
  }

  const [registrants, total, counts] = await Promise.all([
    db.registrant.findMany({
      where, orderBy: [{ registeredAt: "desc" }, { id: "desc" }], skip: (currentPage - 1) * pageSize, take: pageSize,
      select: { id: true, email: true, displayName: true, answers: true, status: true, registeredAt: true, days: { select: { eventDayId: true, status: true } } },
    }),
    db.registrant.count({ where }),
    db.registrant.groupBy({ by: ["status"], where: { eventId }, _count: true }),
  ]);
  const countOf = (status: RegistrantStatus) => counts.find((item) => item.status === status)?._count ?? 0;
  const allCount = counts.reduce((sum, item) => sum + item._count, 0);

  const filterParams = { q: query || undefined, status: selectedStatus, day: selectedDay, field: selectedField?.key, answer: answerValue || undefined, page: currentPage > 1 ? String(currentPage) : undefined };
  const makeHref = (changes: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries({ ...filterParams, ...changes })) if (value) params.set(key, value);
    const text = params.toString();
    return `/organizer/${eventId}/registrants${text ? `?${text}` : ""}`;
  };

  const requestedSelection = typeof search.selected === "string" ? search.selected : undefined;
  const selectedId = requestedSelection ?? registrants[0]?.id;
  const person = selectedId ? await db.registrant.findFirst({
    where: { id: selectedId, eventId },
    include: {
      days: { orderBy: { eventDay: { date: "asc" } }, include: { eventDay: { select: { date: true, maxSeats: true } } } },
      checkIns: { where: { voidedAt: null }, orderBy: { checkedInAt: "asc" }, select: { id: true, checkedInAt: true, isOverride: true, session: { select: { label: true, eventDay: { select: { date: true } } } } } },
    },
  }) : null;
  const queuePositions = person ? new Map(await Promise.all(person.days.filter((day) => day.status === "WAITLISTED" && day.waitlistedAt).map(async (day) => [day.id,
    event.seatMode === "whole_course"
      ? await db.registrant.count({ where: { eventId, status: "WAITLISTED", OR: [{ registeredAt: { lt: person.registeredAt } }, { registeredAt: person.registeredAt, id: { lte: person.id } }] } })
      : await db.registrantEventDay.count({ where: { eventDayId: day.eventDayId, status: "WAITLISTED", OR: [{ waitlistedAt: { lt: day.waitlistedAt! } }, { waitlistedAt: day.waitlistedAt!, id: { lte: day.id } }] } }),
  ] as const))) : new Map<string, number>();
  // Seats of the days this person waits for: a waitlisted day can only be approved while it has a free seat.
  const seats = person?.status === "WAITLISTED" || person?.days.some((day) => day.status === "WAITLISTED")
    ? await getSeatAvailability(db, event, person.days.filter((day) => day.status === "WAITLISTED").map((day) => day.eventDayId))
    : null;
  const courseFull = seats?.mode === "whole_course" && seats.remaining === 0;
  const dayFull = (eventDayId: string) => seats?.mode === "per_day" && seats.days.get(eventDayId)?.remaining === 0;
  const positionInList = person ? registrants.findIndex((item) => item.id === person.id) : -1;
  const previous = positionInList > 0 ? registrants[positionInList - 1] : undefined;
  const next = positionInList >= 0 && positionInList < registrants.length - 1 ? registrants[positionInList + 1] : undefined;
  const returnTo = makeHref({ selected: person?.id });
  const result = typeof search.result === "string" ? resultMessages[search.result] : undefined;
  const openings = await getWaitlistOpenings(event);
  const deletionRequests = await db.dataRequest.findMany({ where: { eventId, status: "OPEN" }, orderBy: { requestedAt: "asc" }, select: { id: true, reason: true, requestedAt: true, registrant: { select: { id: true, displayName: true, email: true } } } });
  const orphanKeys = person ? Object.keys(asAnswers(person.answers)).filter((key) => !fields.some((field) => field.key === key)) : [];
  const orphanFiles = person ? orphanKeys.flatMap((key) => readFileAnswers(asAnswers(person.answers)[key]).map((file, index) => ({ key, index, name: file.originalName }))) : [];
  const personRequest = person ? deletionRequests.find((request) => request.registrant.id === person.id) : undefined;
  const mayManage = canManageEvent(membership) && !event.anonymizedAt;
  // Bulk-approve outcome arrives as registrant ids (never names) in the URL; names and reasons are looked up here.
  const idList = (value: unknown) => typeof value === "string" ? value.split(",").filter((id) => /^[a-z0-9]{20,40}$/.test(id)).slice(0, 100) : [];
  const [heldIds, skippedIds] = [idList(search.held), idList(search.skipped)];
  const bulkPeople = heldIds.length || skippedIds.length ? await db.registrant.findMany({
    where: { eventId, id: { in: [...heldIds, ...skippedIds] } },
    select: { id: true, displayName: true, email: true, status: true, days: { where: { status: "WAITLISTED" }, select: { eventDayId: true } } },
  }) : [];
  const bulkIssues = [
    ...heldIds.flatMap((id) => bulkPeople.filter((item) => item.id === id).map((item) => ({ person: item, reason: event.seatMode === "whole_course" ? "ที่นั่งทั้งหลักสูตรเต็ม · ยังอยู่ในคิวสำรอง" : `${item.days.map((day) => `วันที่ ${dayIndex.get(day.eventDayId)}`).join(", ")} เต็ม · วันนั้นยังอยู่ในคิวสำรอง (วันอื่นอนุมัติแล้ว)` }))),
    ...skippedIds.flatMap((id) => bulkPeople.filter((item) => item.id === id).map((item) => ({ person: item, reason: `สถานะเปลี่ยนไปก่อนกดอนุมัติ (ตอนนี้: ${labels[item.status]})` }))),
  ];
  const personAnswers = asAnswers(person?.answers);
  const canEdit = !event.anonymizedAt;
  const flags = await getFeatureFlags();
  const lineOn = flags.lineLogin && lineConfigured();
  const emailOn = emailConfigured() && flags.emailNotifications;
  const emailHistory = person ? await db.notificationLog.findMany({ where: { registrantId: person.id, channel: "EMAIL" }, orderBy: { createdAt: "desc" }, take: 3, select: { id: true, kind: true, status: true, createdAt: true, sentAt: true } }) : [];
  // LINE delivery: the latest sent/failed message per person on this page (list badge) and a short history for the detail.
  const lineResults = await db.notificationLog.findMany({ where: { registrantId: { in: registrants.map((item) => item.id) }, channel: "LINE", status: { in: ["SENT", "FAILED"] } }, orderBy: { createdAt: "desc" }, select: { registrantId: true, status: true } });
  const lineFailed = new Set(registrants.filter((item) => lineResults.find((row) => row.registrantId === item.id)?.status === "FAILED").map((item) => item.id));
  const lineHistory = person?.lineUserId ? await db.notificationLog.findMany({ where: { registrantId: person.id, channel: "LINE" }, orderBy: { createdAt: "desc" }, take: 3, select: { id: true, kind: true, status: true, error: true, createdAt: true, sentAt: true } }) : [];
  const hasFilters = !!(query || selectedDay || (selectedField && answerValue));

  return <>
    <OrganizerEventHeader event={event} activeTab="registrants" actions={flags.exportData ? <>
      <form method="get" action={withBasePath(`/organizer/${eventId}/registrants/export`)} className="flex flex-wrap items-center gap-2">
        <label className="flex min-h-8 items-center gap-1.5 text-xs text-muted-foreground"><input type="checkbox" name="includeSensitive" className="size-4 accent-primary" />รวมข้อมูลอ่อนไหว</label>
        <Button type="submit" variant="outline"><DownloadIcon data-icon="inline-start" aria-hidden="true" />Export CSV</Button>
        <Button type="submit" name="format" value="xlsx" variant="outline">Excel</Button>
      </form>
    </> : undefined} />
    <AutoRefresh intervalMs={5000} />
    {openings.length > 0 && <div className="mx-auto mt-4 w-full max-w-7xl px-5 lg:px-10"><WaitlistOpenings eventId={eventId} openings={openings} canManage={mayManage} returnTo={makeHref({})} /></div>}
    {deletionRequests.length > 0 && <section aria-labelledby="deletion-requests-title" className="mx-auto mt-4 flex w-full max-w-7xl flex-col gap-2 px-5 lg:px-10">
      <div className="flex flex-col gap-2 rounded-xl border border-sky-300 bg-sky-50 p-4 text-sky-950">
        <h2 id="deletion-requests-title" className="flex items-center gap-2 font-semibold"><ShieldIcon className="size-4 shrink-0" aria-hidden="true" />{`คำขอลบข้อมูล (PDPA) รอดำเนินการ ${deletionRequests.length.toLocaleString("th-TH")} รายการ`}</h2>
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">{deletionRequests.map((request) => <li key={request.id}><Link href={makeHref({ selected: request.registrant.id })} className="font-medium underline underline-offset-4 [overflow-wrap:anywhere]">{request.registrant.displayName ?? request.registrant.email ?? "ผู้ลงทะเบียน"}</Link> <span className="text-sky-900/80">· {formatDateTime(request.requestedAt)}</span></li>)}</ul>
      </div>
    </section>}
    {search.error === "walk-in-disabled" && <p role="alert" className="mx-auto mt-4 w-full max-w-7xl rounded-xl border border-destructive/30 bg-destructive/10 px-5 py-3 text-sm text-destructive lg:px-10">ผู้ดูแลระบบปิดการเพิ่มผู้ลงทะเบียนเองไว้</p>}
    {event.anonymizedAt && <p role="status" className="mx-auto mt-4 w-full max-w-7xl rounded-xl border bg-card px-5 py-3 text-sm text-muted-foreground lg:px-10">ข้อมูลส่วนบุคคลของโครงการนี้ถูกปกปิดไปแล้วเมื่อ {formatEventDay(event.anonymizedAt)} ตามกติการะยะเก็บข้อมูลเดิม (ตอนนี้เก็บถาวร) เหลือเฉพาะสถานะและสถิติ</p>}

    <div className="grid flex-1 grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(340px,440px)_minmax(0,1fr)]">
      {/* Master list */}
      <section aria-label="รายชื่อผู้ลงทะเบียน" className={cn("flex min-w-0 flex-col border-r bg-card lg:sticky lg:top-0 lg:h-[calc(100svh-15rem)] lg:min-h-[28rem] lg:overflow-hidden", person && requestedSelection && "hidden lg:flex")}>
        <div className="flex flex-col gap-3 border-b p-4">
          <nav aria-label="กรองตามสถานะ" className="flex flex-wrap gap-1 rounded-lg bg-muted p-1">
            {[{ key: undefined, label: "ทั้งหมด", count: allCount }, ...statusOrder.map((key) => ({ key, label: labels[key], count: countOf(key) }))].map((tab) => (
              <Link key={tab.label} href={makeHref({ status: tab.key, page: undefined, selected: undefined })} aria-current={selectedStatus === tab.key ? "page" : undefined}
                className={cn("shrink-0 rounded-md px-2.5 py-1.5 text-sm", selectedStatus === tab.key ? "bg-card font-semibold shadow-sm" : "text-muted-foreground hover:text-foreground")}>{tab.label} <span className="tabular-nums">{tab.count}</span></Link>
            ))}
          </nav>
          <form method="get" role="search" className="flex flex-col gap-2">
            {selectedStatus && <input type="hidden" name="status" value={selectedStatus} />}
            <div className="flex gap-2">
              <div className="relative flex-1">
                <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <label htmlFor="registrant-search" className="sr-only">ค้นหาชื่อหรืออีเมล</label>
                <Input id="registrant-search" name="q" type="search" defaultValue={query} maxLength={100} placeholder="ชื่อ / อีเมล" className="pl-9" />
              </div>
              <label htmlFor="registrant-day" className="sr-only">วันที่เข้าร่วม</label>
              <NativeSelect id="registrant-day" name="day" defaultValue={selectedDay ?? ""} className="w-28"><option value="">ทุกวัน</option>{eventDays.map((item, index) => <option key={item.id} value={item.id}>วันที่ {index + 1}</option>)}</NativeSelect>
            </div>
            <div className="flex gap-2">
              <label htmlFor="registrant-answer-field" className="sr-only">กรองตามคำตอบของฟิลด์</label>
              <NativeSelect id="registrant-answer-field" name="field" defaultValue={selectedField?.key ?? ""} className="min-w-0 flex-1"><option value="">กรองตามคำตอบ…</option>{fields.filter((item) => item.type !== "file" && !item.sensitive).map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</NativeSelect>
              <label htmlFor="registrant-answer" className="sr-only">ค่าคำตอบ</label>
              {selectedField?.options?.length
                ? <NativeSelect id="registrant-answer" name="answer" defaultValue={answerValue} className="min-w-0 flex-1"><option value="">ทุกค่า</option>{selectedField.options.map((option) => <option key={option} value={option}>{option}</option>)}</NativeSelect>
                : <Input id="registrant-answer" name="answer" type={selectedField?.type === "date" ? "date" : "search"} defaultValue={answerValue} maxLength={3000} disabled={!selectedField} placeholder={selectedField ? "ค่าที่ต้องการ" : "เลือกฟิลด์ก่อน"} className="min-w-0 flex-1" />}
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">พบ {total.toLocaleString("th-TH")} คน</span>
              <div className="flex gap-2">{hasFilters && <Button asChild variant="ghost" size="sm"><Link href={makeHref({ q: undefined, day: undefined, field: undefined, answer: undefined, page: undefined, selected: undefined })}><XIcon data-icon="inline-start" aria-hidden="true" />ล้างตัวกรอง</Link></Button>}<Button type="submit" size="sm" variant="outline">ค้นหา</Button></div>
            </div>
          </form>
        </div>

        <BulkSelectForm action={approveSelected.bind(null, eventId)} selectable={canEdit ? registrants.filter((item) => item.status === "PENDING").length : 0}>
          <input type="hidden" name="returnTo" value={makeHref({})} />
          {registrants.length === 0 ? <div className="flex flex-col items-center gap-2 px-6 py-12 text-center text-sm text-muted-foreground">
            <p className="font-medium text-foreground">{allCount ? "ไม่พบผู้ลงทะเบียนตามเงื่อนไขนี้" : "ยังไม่มีผู้ลงทะเบียน"}</p>
            <p>{allCount ? "ลองล้างตัวกรองหรือเปลี่ยนแท็บสถานะ" : "แชร์ลิงก์ลงทะเบียน หรือเพิ่มผู้ลงทะเบียนเองได้จากปุ่มด้านขวา"}</p>
          </div> : <ul className="divide-y">{registrants.map((item) => {
            const active = item.id === person?.id;
            const name = displayName(item);
            return <li key={item.id} className={cn("relative flex items-start gap-3 px-4 py-3 hover:bg-muted/50", active && "bg-accent/60 before:absolute before:inset-y-0 before:left-0 before:w-1 before:bg-primary")}>
              {canEdit && item.status === "PENDING" ? <input type="checkbox" name="registrantId" value={item.id} aria-label={`เลือก ${name}`} className="relative z-10 mt-0.5 size-6 shrink-0 accent-primary" /> : <span className="w-6 shrink-0" aria-hidden="true" />}
              <Link href={makeHref({ selected: item.id })} aria-current={active ? "true" : undefined} className="flex min-w-0 flex-1 flex-col gap-1 outline-none after:absolute after:inset-0 focus-visible:underline">
                <span className="flex items-baseline justify-between gap-2"><span className="truncate font-semibold">{name}</span><span className="shrink-0 text-xs text-muted-foreground">{formatEventDay(item.registeredAt)}</span></span>
                <span className="truncate text-xs text-muted-foreground">{item.email ?? "—"}</span>
                <span className="flex flex-wrap gap-1">{item.days.sort((a, b) => (dayIndex.get(a.eventDayId) ?? 0) - (dayIndex.get(b.eventDayId) ?? 0)).map((day) => <span key={day.eventDayId} title={`วันที่ ${dayIndex.get(day.eventDayId)}: ${labels[day.status]}`} className={cn("rounded border px-1.5 text-[11px] font-semibold", chipTone[day.status])}>ว.{dayIndex.get(day.eventDayId)}</span>)}
                  {event.seatMode === "whole_course" && <span className={cn("rounded border px-1.5 text-[11px] font-semibold", chipTone[item.status])}>{labels[item.status]}</span>}
                  {lineFailed.has(item.id) && <span title="ส่งข้อความ LINE ล่าสุดไม่ถึง" className="rounded border border-amber-300 bg-amber-50 px-1.5 text-[11px] font-semibold text-amber-900">LINE ส่งไม่ถึง</span>}</span>
              </Link>
            </li>;
          })}</ul>}
          {(currentPage > 1 || currentPage * pageSize < total) && <nav aria-label="หน้ารายชื่อ" className="flex items-center justify-between gap-2 border-t px-4 py-3 text-sm">
            {currentPage > 1 ? <Link className="underline-offset-4 hover:underline" href={makeHref({ page: String(currentPage - 1), selected: undefined })}>← ก่อนหน้า</Link> : <span />}
            <span className="text-muted-foreground">หน้า {currentPage} / {Math.max(1, Math.ceil(total / pageSize))}</span>
            {currentPage * pageSize < total ? <Link className="underline-offset-4 hover:underline" href={makeHref({ page: String(currentPage + 1), selected: undefined })}>ถัดไป →</Link> : <span />}
          </nav>}
        </BulkSelectForm>
      </section>

      {/* Detail */}
      <section aria-label="รายละเอียดผู้ลงทะเบียน" className={cn("flex min-w-0 flex-col bg-background", !(person && requestedSelection) && "hidden lg:flex")}>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-card px-5 py-3">
          <div className="flex items-center gap-2">
            {requestedSelection && <Button asChild variant="ghost" size="sm" className="lg:hidden"><Link href={makeHref({ selected: undefined })}><ChevronLeftIcon data-icon="inline-start" aria-hidden="true" />รายชื่อ</Link></Button>}
            {canEdit && flags.walkIn && <Button asChild variant="outline" size="sm"><Link href={`/organizer/${eventId}/registrants/new`}><UserPlusIcon data-icon="inline-start" aria-hidden="true" />เพิ่มผู้ลงทะเบียนเอง</Link></Button>}
            {canEdit && membership.systemRole === "admin" && <Button asChild variant="outline" size="sm"><Link href={`/organizer/${eventId}/registrants/import`}><FileUpIcon data-icon="inline-start" aria-hidden="true" />นำเข้ารายชื่อ</Link></Button>}
          </div>
          <span className="flex items-center gap-2 text-xs text-muted-foreground"><span className="size-2 rounded-full bg-emerald-500" aria-hidden="true" />อัปเดตอัตโนมัติทุก 5 วินาที</span>
        </div>

        {result && <p role={result[1] === "error" ? "alert" : "status"} className={cn("mx-5 mt-4 rounded-lg border px-4 py-3 text-sm", result[1] === "error" ? "border-destructive/30 bg-destructive/10 text-destructive" : result[1] === "warn" ? "border-amber-300 bg-amber-50 text-amber-900" : "border-primary/30 bg-accent text-accent-foreground")}>{result[0]}{search.result === "partial" && typeof search.approved === "string" && typeof search.requested === "string" ? ` (อนุมัติ ${search.approved} จาก ${search.requested} วัน)` : ""}{search.result === "bulk-partial" && typeof search.approved === "string" && typeof search.requested === "string" ? ` · อนุมัติครบ ${search.approved} จาก ${search.requested} คน` : ""}</p>}
        {bulkIssues.length > 0 && <section aria-label="ผู้ที่ยังไม่ได้รับอนุมัติ" className="mx-5 mt-2 rounded-lg border border-amber-300 bg-card">
          <p className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-900">{`ยังไม่ได้อนุมัติ ${bulkIssues.length.toLocaleString("th-TH")} คน`}</p>
          <ul className="divide-y text-sm">{bulkIssues.map(({ person: item, reason }) => <li key={item.id} className="flex flex-col gap-0.5 px-4 py-2.5">
            <Link href={makeHref({ selected: item.id, result: typeof search.result === "string" ? search.result : undefined, held: heldIds.join(",") || undefined, skipped: skippedIds.join(",") || undefined, approved: typeof search.approved === "string" ? search.approved : undefined, requested: typeof search.requested === "string" ? search.requested : undefined })} className="font-medium underline-offset-4 hover:underline [overflow-wrap:anywhere]">{item.displayName ?? item.email ?? "ผู้ลงทะเบียน"}</Link>
            <span className="text-muted-foreground">{reason}</span>
          </li>)}</ul>
        </section>}

        {!person ? <div className="flex flex-1 items-center justify-center p-10 text-center text-sm text-muted-foreground">เลือกผู้ลงทะเบียนจากรายชื่อเพื่อดูรายละเอียดและอนุมัติ</div> : <>
          <article className="flex flex-1 flex-col gap-5 px-5 py-6 lg:px-8">
            <header className="flex flex-col gap-2">
              <h2 className="font-heading text-2xl font-bold [overflow-wrap:anywhere]">{displayName(person)}</h2>
              <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                <span className={cn("rounded-md border px-2 py-0.5 text-xs font-semibold", chipTone[person.status])}>{labels[person.status]}{person.status === "WAITLISTED" && queuePositions.size ? ` · ลำดับ ${Math.min(...queuePositions.values())}` : ""}</span>
                ลงทะเบียน {formatDateTime(person.registeredAt)}{person.anonymizedAt ? " · ข้อมูลถูกปกปิดแล้ว" : ""}
              </p>
            </header>
            {personRequest && <section aria-label="คำขอลบข้อมูล" className="flex flex-col gap-3 rounded-lg border border-sky-300 bg-sky-50 px-4 py-3 text-sm text-sky-950">
              <p className="font-semibold">ผู้สมัครขอลบข้อมูล (PDPA) เมื่อ {formatDateTime(personRequest.requestedAt)}</p>
              {personRequest.reason && <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">เหตุผล: {personRequest.reason}</p>}
              <p className="text-sky-900/80">ลบ = ยกเลิกวันที่ยังไม่ถึง (คืนที่นั่งให้คิว) แล้วปกปิดคำตอบ อีเมล และไฟล์แนบ ประวัติเช็คชื่อคงไว้แบบไม่ระบุตัวตน ย้อนกลับไม่ได้</p>
              {mayManage && <div className="grid gap-3 sm:grid-cols-2">
                <form action={resolveDeletionRequest.bind(null, eventId, personRequest.id, "complete")} className="flex flex-col gap-2">
                  <input type="hidden" name="returnTo" value={returnTo} />
                  <label className="flex min-h-9 items-center gap-2"><input type="checkbox" name="confirm" required className="size-4 accent-destructive" />ยืนยันลบข้อมูลของคนนี้</label>
                  <Button type="submit" size="sm" variant="destructive">ลบข้อมูลตามคำขอ</Button>
                </form>
                <form action={resolveDeletionRequest.bind(null, eventId, personRequest.id, "reject")} className="flex flex-col gap-2">
                  <input type="hidden" name="returnTo" value={returnTo} />
                  <label htmlFor="deletion-note" className="sr-only">เหตุผลที่ต้องเก็บข้อมูลไว้</label>
                  <Input id="deletion-note" name="note" required minLength={3} maxLength={500} placeholder="เหตุผลที่ต้องเก็บไว้ (ผู้สมัครเห็น)" />
                  <Button type="submit" size="sm" variant="outline">ปฏิเสธคำขอ</Button>
                </form>
              </div>}
            </section>}
            {person.status === "WAITLISTED" && seats && <WaitlistNotice seats={seats} maxSeats={event.maxSeats} days={person.days.filter((day) => day.status === "WAITLISTED").map((day) => ({ id: day.eventDayId, number: dayIndex.get(day.eventDayId) ?? 0, maxSeats: day.eventDay.maxSeats }))} autoPromote={event.waitlistPromotion === "AUTO"} settingsHref={mayManage ? `/organizer/${eventId}?step=2` : undefined} />}
            {person.status === "REJECTED" && person.rejectReason && <p className="rounded-lg border bg-card px-4 py-3 text-sm">เหตุผลที่ปฏิเสธ: {person.rejectReason}</p>}

            <dl className="grid grid-cols-1 border-t sm:grid-cols-[180px_minmax(0,1fr)]">
              <dt className="border-b py-3 text-sm text-muted-foreground">วันที่เลือก</dt>
              <dd className="flex flex-col gap-2 border-b py-3">{person.days.map((day) => <div key={day.id} className="flex flex-wrap items-center gap-2">
                <span className={cn("rounded-md border px-2 py-0.5 text-xs font-semibold", chipTone[day.status])}>วันที่ {dayIndex.get(day.eventDayId)} · {formatEventDayWithWeekday(day.eventDay.date)}</span>
                <span className="text-xs text-muted-foreground">{labels[day.status]}{queuePositions.has(day.id) ? ` · คิวที่ ${queuePositions.get(day.id)}` : ""}</span>
                {canEdit && event.seatMode !== "whole_course" && <span className="flex flex-wrap gap-1">
                  {(day.status === "PENDING" || (day.status === "WAITLISTED" && !dayFull(day.eventDayId))) && <form action={decideRegistrantDay.bind(null, eventId, person.id, day.eventDayId, "approve")}><input type="hidden" name="returnTo" value={returnTo} /><Button size="xs" variant="outline">อนุมัติวันนี้</Button></form>}
                  {day.status === "WAITLISTED" && dayFull(day.eventDayId) && <span className="inline-flex h-6 items-center px-1 text-xs text-muted-foreground">วันนี้เต็ม · อนุมัติได้เมื่อมีที่ว่าง</span>}
                  {(day.status === "PENDING" || day.status === "WAITLISTED") && <form action={decideRegistrantDay.bind(null, eventId, person.id, day.eventDayId, "reject")}><input type="hidden" name="returnTo" value={returnTo} /><Button size="xs" variant="ghost">ปฏิเสธวันนี้</Button></form>}
                  {day.status === "APPROVED" && person.days.filter((item) => item.status === "APPROVED").length > 1 && <form action={decideRegistrantDay.bind(null, eventId, person.id, day.eventDayId, "cancel")}><input type="hidden" name="returnTo" value={returnTo} /><Button size="xs" variant="ghost">ยกเลิกวันนี้</Button></form>}
                </span>}
              </div>)}</dd>
              <dt className="border-b py-3 text-sm text-muted-foreground">อีเมล</dt>
              <dd className="flex min-w-0 flex-col gap-2 border-b py-3">
                <span className="break-all">{person.email ?? "—"}</span>
                {person.email && !emailOn && <span className="text-xs text-destructive">การส่งอีเมลปิดอยู่หรือยังไม่ได้ตั้งค่า</span>}
                {emailHistory.length > 0 && <ul className="flex flex-col gap-1 text-xs text-muted-foreground">{emailHistory.map((item) => <li key={item.id}>{item.kind === "resend" ? "ส่งซ้ำ · " : ""}{formatDateTime(item.sentAt ?? item.createdAt)} · <span className={cn(item.status === "FAILED" && "font-semibold text-destructive")}>{item.status === "SENT" ? "เซิร์ฟเวอร์รับอีเมลแล้ว" : item.status === "FAILED" ? "ส่งอีเมลไม่สำเร็จ" : item.status === "SKIPPED" ? "ไม่ได้ส่ง (สถานะเดิม / ปิดอยู่ / ไม่มีผู้รับ)" : item.status === "SENDING" ? "กำลังส่งอีเมล" : "รอส่งอีเมล"}</span></li>)}</ul>}
                {emailOn && canEdit && <form action={resendEmailNotification.bind(null, eventId, person.id)} className="flex flex-wrap items-center gap-2">
                  <input type="hidden" name="returnTo" value={returnTo} />
                  <Input name="email" type="email" required maxLength={191} defaultValue={person.email ?? ""} placeholder="อีเมลผู้สมัคร" aria-label="อีเมลที่จะส่งซ้ำ (แก้ได้ถ้ากรอกผิด)" className="h-8 min-w-0 flex-1 basis-48 text-sm" />
                  <Button size="xs" variant="outline">{person.email ? "ส่งอีเมลอีกครั้ง" : "เพิ่มอีเมลและส่ง"}</Button>
                </form>}
              </dd>
              {(lineOn || person.lineUserId) && <>
                <dt className="border-b py-3 text-sm text-muted-foreground">LINE</dt>
                <dd className="flex flex-col gap-2 border-b py-3 text-sm">
                  {person.lineUserId ? <>
                    <span>เชื่อมแล้ว · แจ้งผลทาง LINE</span>
                    {lineHistory.length > 0 && <ul className="flex flex-col gap-0.5 text-xs text-muted-foreground">{lineHistory.map((item) => <li key={item.id}>{lineKinds[item.kind] ?? item.kind} · {formatDateTime(item.sentAt ?? item.createdAt)} · <span className={cn(item.status === "FAILED" && "font-semibold text-destructive", item.status === "SENT" && "text-foreground")}>{lineStatuses[item.status]}</span>{item.status === "FAILED" && item.error ? ` (${item.error})` : ""}</li>)}</ul>}
                    {lineHistory[0]?.status === "FAILED" && <span className="text-xs text-muted-foreground">มักเกิดจากผู้สมัครบล็อก OA หรือโควตาข้อความของเดือนหมด · ผู้สมัครยังดูผลได้จากลิงก์หน้าสถานะ</span>}
                    {lineOn && canEdit && <form action={resendLineNotification.bind(null, eventId, person.id)}><input type="hidden" name="returnTo" value={returnTo} /><Button size="xs" variant="outline">ส่งสถานะทาง LINE อีกครั้ง</Button></form>}
                  </> : <span className="text-muted-foreground">ยังไม่เชื่อม — ผู้สมัครเลือกรับทาง LINE ได้ตอนสมัครหรือในหน้าสถานะของตัวเอง</span>}
                </dd>
              </>}
              {fields.map((field) => {
                const answer = personAnswers[field.key];
                const files = field.type === "file" ? readFileAnswers(answer) : [];
                return <div key={field.key} className="contents">
                  <dt className="border-b py-3 text-sm text-muted-foreground">{field.label}</dt>
                  <dd className="border-b py-3">{answer == null || answer === "" ? <span className="text-muted-foreground">{field.conditional ? "— (ไม่เข้าเงื่อนไข)" : "—"}</span>
                    : field.sensitive ? <Link className="inline-flex items-center gap-1.5 font-medium underline underline-offset-4" href={`/organizer/${eventId}/registrants/${person.id}/sensitive/${field.key}`}><LockIcon className="size-4" aria-hidden="true" />เปิดดูข้อมูลอ่อนไหว (บันทึก audit)</Link>
                    : files.length ? <span className="flex flex-wrap gap-2">{files.map((file, fileIndex) => <Link key={file.storageKey} className="inline-flex max-w-full items-center gap-2 rounded-md bg-muted px-3 py-1.5 text-sm font-medium break-all hover:bg-muted/70" href={`/organizer/${eventId}/registrants/${person.id}/files/${field.key}${fileIndex ? `?i=${fileIndex}` : ""}`}><FileIcon className="size-4 shrink-0" aria-hidden="true" />{file.originalName}{typeof file.size === "number" ? <span className="text-xs text-muted-foreground">{(file.size / 1024 / 1024).toFixed(1)} MB</span> : null}</Link>)}</span>
                    : <span className="whitespace-pre-wrap">{Array.isArray(answer) ? (answer as string[]).join(", ") : String(answer)}</span>}
                    {field.conditional && answer != null && answer !== "" && <span className="ml-1 text-xs text-muted-foreground">(ฟิลด์เงื่อนไข)</span>}
                  </dd>
                </div>;
              })}
              {/* Answers to fields removed from the form stay stored (never silently deleted) but are not shown. */}
              {orphanKeys.length > 0 && <><dt className="border-b py-3 text-sm text-muted-foreground">คำตอบจากฟิลด์ที่ลบแล้ว</dt><dd className="flex flex-col gap-1.5 border-b py-3 text-sm text-muted-foreground">
                <span>{`${orphanKeys.length} รายการ · ข้อความไม่แสดง เพราะฟิลด์ถูกลบออกจากฟอร์มแล้ว`}{orphanFiles.length > 0 ? " · ไฟล์แนบยังเก็บไว้และดาวน์โหลดได้" : ""}</span>
                {orphanFiles.map(({ key, index, name }) => <a key={`${key}-${index}`} href={withBasePath(`/organizer/${eventId}/registrants/${person.id}/files/${encodeURIComponent(key)}?i=${index}`)} className="inline-flex min-h-8 items-center gap-1.5 text-foreground underline-offset-4 hover:underline [overflow-wrap:anywhere]"><FileIcon className="size-4 shrink-0" aria-hidden="true" />{name}</a>)}
              </dd></>}
              <dt className="py-3 text-sm text-muted-foreground">เช็คชื่อแล้ว</dt>
              <dd className="py-3">{person.checkIns.length ? <ul className="flex flex-col gap-1 text-sm">{person.checkIns.map((checkIn) => <li key={checkIn.id}>{checkIn.session.label}{checkIn.session.eventDay ? ` · ${formatEventDay(checkIn.session.eventDay.date)}` : ""} <span className="text-muted-foreground">({formatDateTime(checkIn.checkedInAt)}){checkIn.isOverride ? " · กรณีพิเศษ" : ""}</span></li>)}</ul> : <span className="text-muted-foreground">ยังไม่มี</span>}</dd>
            </dl>
          </article>

          <footer className="sticky bottom-0 pb-[max(1rem,env(safe-area-inset-bottom))] flex flex-wrap items-center justify-between gap-3 border-t bg-card px-5 py-3">
            <div className="flex items-center gap-1 text-sm text-muted-foreground">
              {previous ? <Button asChild variant="ghost" size="icon" aria-label="คนก่อนหน้า"><Link href={makeHref({ selected: previous.id })}><ChevronLeftIcon aria-hidden="true" /></Link></Button> : <span className="size-9" />}
              <span className="tabular-nums">{positionInList >= 0 ? `${(currentPage - 1) * pageSize + positionInList + 1} จาก ${total}` : ""}</span>
              {next ? <Button asChild variant="ghost" size="icon" aria-label="คนถัดไป"><Link href={makeHref({ selected: next.id })}><ChevronRightIcon aria-hidden="true" /></Link></Button> : <span className="size-9" />}
            </div>
            {canEdit && <div className="flex flex-wrap items-center justify-end gap-2">
              <details className="relative">
                <summary className="flex h-9 cursor-pointer list-none items-center gap-1.5 rounded-md border px-3 text-sm font-medium hover:bg-muted [&::-webkit-details-marker]:hidden"><LinkIcon className="size-4" aria-hidden="true" />ลิงก์สถานะ</summary>
                <form action={reissueStatusLink.bind(null, eventId, person.id)} className="absolute bottom-11 right-0 z-20 flex w-72 flex-col gap-2 rounded-xl border bg-card p-4 shadow-lg">
                  <input type="hidden" name="returnTo" value={returnTo} />
                  <p className="text-sm">ออกลิงก์สถานะใหม่เพื่อส่งให้ผู้สมัครเอง (ระหว่างยังไม่มีระบบส่งอีเมล)</p>
                  <label className="flex items-start gap-2 py-1 text-xs"><input type="checkbox" name="confirm" required className="mt-0.5 size-4" />ยืนยันว่าลิงก์เดิมจะใช้ไม่ได้อีก</label>
                  <Button type="submit" size="sm" variant="outline">ออกลิงก์สถานะใหม่</Button>
                </form>
              </details>
              {person.status === "APPROVED" && <Button asChild variant="outline"><a href={withBasePath(`/organizer/${eventId}/registrants/${person.id}/qr`)}><QrCodeIcon data-icon="inline-start" aria-hidden="true" />ดาวน์โหลด QR</a></Button>}
              {person.status === "APPROVED" && <form action={decideRegistrant.bind(null, eventId, person.id, "cancel")}><input type="hidden" name="returnTo" value={returnTo} /><Button variant="outline" className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive">ยกเลิกการเข้าร่วม</Button></form>}
              {(person.status === "PENDING" || person.status === "WAITLISTED") && <details className="relative">
                <summary className="flex h-9 cursor-pointer list-none items-center rounded-md border border-destructive/40 px-3 text-sm font-medium text-destructive hover:bg-destructive/10 [&::-webkit-details-marker]:hidden">ปฏิเสธ…</summary>
                <form action={decideRegistrant.bind(null, eventId, person.id, "reject")} className="absolute bottom-11 right-0 z-20 flex w-72 flex-col gap-2 rounded-xl border bg-card p-4 shadow-lg">
                  <input type="hidden" name="returnTo" value={returnTo} />
                  <label className="flex flex-col gap-1 text-sm">เหตุผล (ไม่บังคับ · ผู้สมัครเห็นในหน้าสถานะ)<Input name="reason" maxLength={500} /></label>
                  <Button size="sm" variant="destructive">ยืนยันปฏิเสธ</Button>
                </form>
              </details>}
              {(person.status === "PENDING" || (event.seatMode === "whole_course" && person.status === "WAITLISTED" && !courseFull)) && <form action={decideRegistrant.bind(null, eventId, person.id, "approve")}><input type="hidden" name="returnTo" value={returnTo} /><Button>อนุมัติ{person.status === "WAITLISTED" ? "ข้ามคิว" : ""}</Button></form>}
            </div>}
          </footer>
        </>}
      </section>
    </div>
  </>;
}

type SeatStatus = Awaited<ReturnType<typeof getSeatAvailability>>;

/**
 * Why a person is waitlisted and what the organizer can do now: a full day or course can only be approved once a seat
 * frees up (or seats are added); a day with a free seat can be approved straight away, ahead of the queue.
 */
function WaitlistNotice({ seats, maxSeats, days, autoPromote, settingsHref }: { seats: SeatStatus; maxSeats: number | null; days: { id: string; number: number; maxSeats: number | null }[]; autoPromote: boolean; settingsHref?: string }) {
  const state = seats.mode === "whole_course"
    ? [{ label: "ที่นั่งของหลักสูตร", full: seats.remaining === 0, taken: seats.taken, max: maxSeats, remaining: seats.remaining }]
    : days.map((day) => {
      const seat = seats.days.get(day.id);
      return { label: `วันที่ ${day.number}`, full: seat?.remaining === 0, taken: seat?.taken ?? 0, max: day.maxSeats, remaining: seat?.remaining ?? null };
    });
  const anyFull = state.some((item) => item.full);
  const anyFree = state.some((item) => !item.full);
  const approveLabel = seats.mode === "whole_course" ? "อนุมัติข้ามคิว" : "อนุมัติวันนี้";
  return <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
    <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
    <div className="flex flex-col gap-1">
      <p className="font-semibold">{state.map((item) => item.full ? `${item.label} เต็ม (${item.taken}/${item.max})` : item.remaining === null ? `${item.label} ไม่จำกัดที่นั่ง` : `${item.label} ว่าง ${item.remaining} ที่`).join(" · ")}</p>
      {anyFull && <p>{seats.mode === "whole_course" ? "อนุมัติได้เมื่อมีที่ว่าง" : "วันที่เต็มอนุมัติได้เมื่อมีที่ว่าง"} — เมื่อมีคนยกเลิก ระบบ{autoPromote ? "เลื่อนคิวให้อัตโนมัติตามลำดับ" : "แจ้งให้ผู้จัดเลื่อนคิวเอง"} หรือเพิ่มที่นั่ง{settingsHref ? <> <Link href={settingsHref} className="font-semibold underline underline-offset-2">ในขั้นที่ 2 วันที่จัด</Link></> : "ในขั้นที่ 2"}</p>}
      {anyFree && <p>{seats.mode === "whole_course" ? "มีที่ว่างแล้ว" : "วันที่ว่าง"}กด &ldquo;{approveLabel}&rdquo; ได้เลย โดยไม่ต้องรอคิวก่อนหน้า</p>}
    </div>
  </div>;
}
