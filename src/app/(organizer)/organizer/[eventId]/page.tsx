import type { Metadata } from "next";
import Link from "next/link";
import { CalendarDaysIcon, ChevronLeftIcon, ClipboardListIcon, LayersIcon, ListChecksIcon, LockKeyholeIcon, QrCodeIcon, UsersIcon } from "lucide-react";

import { updateEvent } from "@/app/(organizer)/organizer/actions";
import { EventInfoFields } from "@/app/(organizer)/organizer/event-info-fields";
import { addEventDays, removeEventDay, updateCourseSeats, updateEventDay } from "@/app/(organizer)/organizer/schedule-actions";
import { DaysPlanner } from "@/app/(organizer)/organizer/[eventId]/days-planner";
import { PublishStep, type PublishCheck } from "@/app/(organizer)/organizer/[eventId]/publish-step";
import { SessionsPlanner, type PlannerSession } from "@/app/(organizer)/organizer/[eventId]/sessions-planner";
import { FieldBuilderStep } from "@/app/(organizer)/organizer/[eventId]/field-builder-step";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { coverErrorMessage, isCoverError } from "@/features/events/cover-errors";
import { readRegistrationFields, readRegistrationForm, validateRegistrationFields } from "@/features/events/registration-fields";
import { cn } from "@/lib/utils";
import { requireEventAccess } from "@/server/authorization/event";
import { isFeatureEnabled, mayCreateEvents } from "@/server/settings/features";
import { db } from "@/server/db";
import { fileStorageReady } from "@/server/registrations/upload-storage";

export const metadata: Metadata = { title: "ข้อมูลโครงการ" };

const statusLabel = {
  DRAFT: "ฉบับร่าง",
  PUBLISHED: "เผยแพร่แล้ว",
  CLOSED: "ปิดรับแล้ว",
} as const;

const errorMessage: Record<string, string> = {
  ...coverErrorMessage,
  invalid: "กรุณาตรวจสอบข้อมูลโครงการอีกครั้ง",
  "invalid-day": "กรุณาเลือกวันที่และจำนวนที่นั่งให้ถูกต้อง",
  "duplicate-day": "วันที่นี้อยู่ในโครงการแล้ว",
  "seats-in-use": "ลดที่นั่งต่ำกว่าจำนวนคนที่จองแล้ว (รออนุมัติ + อนุมัติแล้ว) ไม่ได้",
  "day-in-use": "ลบวันไม่ได้: วันสุดท้ายของหลักสูตร หรือมีประวัติเช็คชื่อแล้ว (โหมดแยกรายวันต้องไม่มีผู้ลงทะเบียนหรือรอบเช็คชื่อ)",
  "invalid-session": "กรุณากรอกชื่อรอบเช็คชื่อให้ถูกต้อง",
  "session-in-use": "ลบรอบไม่ได้: รอบนี้มีประวัติเช็คชื่อ ต้องติ๊กยืนยันว่าจะลบประวัติเช็คชื่อของรอบนี้ด้วย",
  "duplicate-session": "ชื่อรอบซ้ำ: วันเดียวกันใช้ชื่อรอบซ้ำไม่ได้ และรอบที่ใช้ได้ทุกวันต้องไม่ซ้ำกับรอบอื่น",
  "invalid-field": "บันทึกฟิลด์ไม่ได้: ตรวจชื่อฟิลด์ เงื่อนไข (ฟิลด์ลูกต้องอยู่หลังฟิลด์แม่ และใช้ค่าที่มีในตัวเลือกของฟิลด์แม่) และตัวเลือกที่ฟิลด์ลูกอ้างถึง",
  "invalid-condition": "ตั้งเงื่อนไขไม่ครบ: เลือกค่าของฟิลด์แม่อย่างน้อย 1 ค่า หรือปิดสวิตช์ “แสดงแบบมีเงื่อนไข”",
  "invalid-options": "ตัวเลือกต้องมี 2–30 ค่า ห้ามซ้ำกัน และยาวไม่เกิน 191 ตัวอักษร",
  "field-in-use": "ลบฟิลด์นี้ไม่ได้ เพราะมีผู้ลงทะเบียนหรือฟิลด์อื่นอ้างถึงอยู่",
};

const wizardSteps = [
  { label: "ข้อมูลโครงการ", icon: ClipboardListIcon },
  { label: "วันที่จัด & ที่นั่ง", icon: CalendarDaysIcon },
  { label: "ฟอร์มลงทะเบียน", icon: ListChecksIcon },
  { label: "รอบเช็คชื่อ", icon: QrCodeIcon },
  { label: "ผู้ร่วมจัด & เผยแพร่", icon: UsersIcon },
];

const dayTitle = new Intl.DateTimeFormat("th-TH", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const dayShort = new Intl.DateTimeFormat("th-TH", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const deadlineLabel = new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Bangkok" });
const clock = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Bangkok" });
const sessionMessages: Record<string, string> = {
  "invalid-session": "กรุณากรอกชื่อรอบและเลือกวันให้ถูกต้อง",
  "invalid-session-time": "เวลาสิ้นสุดต้องหลังเวลาเริ่ม",
  "duplicate-session": "ชื่อรอบซ้ำ: วันเดียวกันใช้ชื่อซ้ำไม่ได้ และรอบที่ใช้ได้ทุกวันต้องไม่ซ้ำกับรอบอื่น",
  "session-in-use": "รอบนี้มีประวัติเช็คชื่อ ต้องติ๊กยืนยันก่อนลบ",
  "session-day-locked": "รอบที่มีการเช็คชื่อแล้วย้ายวันไม่ได้",
  "preset-exists": "ทุกวันมีรอบชื่อนี้อยู่แล้ว ไม่ได้เพิ่มรอบใหม่",
};

function toPlanner(session: { id: string; label: string; startTime: Date | null; endTime: Date | null; _count: { checkIns: number } }, dayId: string | null): PlannerSession {
  return { id: session.id, label: session.label, start: session.startTime ? clock.format(session.startTime) : "", end: session.endTime ? clock.format(session.endTime) : "", checkIns: session._count.checkIns, dayId };
}

export default async function EventPage({ params, searchParams }: PageProps<"/organizer/[eventId]">) {
  const { eventId } = await params;
  const { event, user } = await requireEventAccess(eventId, "manage");
  const { error, saved, step: requestedStep, field: selectedField, session: selectedSession, added } = await searchParams;
  const registrantCount = await db.registrant.count({ where: { eventId } });
  const step = typeof requestedStep === "string" && /^[1-5]$/.test(requestedStep)
    ? Number(requestedStep)
    : saved === "field" || ["invalid-field", "invalid-condition", "invalid-options", "field-in-use"].includes(String(error)) ? 3
    : saved === "session" || ["invalid-session", "session-in-use", "duplicate-session"].includes(String(error)) ? 4
    : saved === "member" || saved === "status" || ["invalid-member", "member-not-found", "not-ready", "invalid-status"].includes(String(error)) ? 5
    : saved === "day" || ["invalid-day", "duplicate-day", "day-in-use"].includes(String(error)) ? 2
    : 1;
  const save = updateEvent.bind(null, eventId);
  const addDay = addEventDays.bind(null, eventId);
  const registrationFields = readRegistrationFields(event.fields);
  const canAdminister = event.ownerId === user.id || user.role === "ADMIN";
  const [members, owner] = await Promise.all([
    db.eventOrganizer.findMany({ where: { eventId }, orderBy: { addedAt: "asc" }, include: { user: { select: { name: true, email: true } } } }),
    db.user.findUniqueOrThrow({ where: { id: event.ownerId }, select: { name: true, email: true } }),
  ]);
  const days = await db.eventDay.findMany({
    where: { eventId },
    orderBy: { date: "asc" },
    include: {
      _count: { select: { registrantDays: true } },
      sessions: {
        orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
        include: { _count: { select: { checkIns: { where: { voidedAt: null } } } } },
      },
    },
  });
  const approvedByDay = days.length ? await db.registrantEventDay.groupBy({
    by: ["eventDayId"],
    where: { eventDayId: { in: days.map((day) => day.id) }, status: "APPROVED" },
    _count: { _all: true },
  }) : [];
  const approvedCountByDay = new Map(approvedByDay.map((day) => [day.eventDayId, day._count._all]));
  const occupiedByDay = days.length ? await db.registrantEventDay.groupBy({
    by: ["eventDayId"],
    where: { eventDayId: { in: days.map((day) => day.id) }, status: { in: ["PENDING", "APPROVED"] } },
    _count: { _all: true },
  }) : [];
  const occupiedCountByDay = new Map(occupiedByDay.map((day) => [day.eventDayId, day._count._all]));
  const courseSeats = event.seatMode === "whole_course" && step === 2 ? {
    maxSeats: event.maxSeats,
    taken: await db.registrant.count({ where: { eventId, status: { in: ["PENDING", "APPROVED"] } } }),
    waitlisted: await db.registrant.count({ where: { eventId, status: "WAITLISTED" } }),
    update: updateCourseSeats.bind(null, eventId),
  } : null;
  const hasRegistrationFields = registrationFields.length > 0;
  const hasValidRegistrationFields = hasRegistrationFields && validateRegistrationFields(registrationFields);
  const globalSessions = await db.session.findMany({ where: { eventId, eventDayId: null }, orderBy: [{ sortOrder: "asc" }, { label: "asc" }], include: { _count: { select: { checkIns: { where: { voidedAt: null } } } } } });
  const hasSessions = days.length > 0 && (globalSessions.length > 0 || days.every((day) => day.sessions.length > 0));
  const hasFutureDeadline = !!event.registrationDeadline && event.registrationDeadline > new Date();
  const hasFileFields = registrationFields.some((field) => field.type === "file");
  const hasFileStorage = fileStorageReady() || !hasFileFields;
  const sessionCount = days.reduce((sum, day) => sum + day.sessions.length, 0) + globalSessions.length;
  const publishChecks: PublishCheck[] = [
    { label: "ข้อมูลโครงการ + ประเภท", ready: !!event.title.trim(), step: 1 },
    { label: days.length ? `วันที่จัด ${days.length} วัน${event.seatMode === "whole_course" ? ` · ที่นั่ง ${event.maxSeats?.toLocaleString("th-TH") ?? "ไม่จำกัด"}` : " · ที่นั่งครบ"}` : "วันที่จัด", detail: days.length ? undefined : "ยังไม่ได้เลือกวันจัด", ready: days.length > 0, step: 2 },
    { label: `ฟอร์ม ${registrationFields.length} ฟิลด์`, detail: hasValidRegistrationFields ? undefined : "ต้องมีอย่างน้อย 1 ฟิลด์และตั้งค่าถูกต้อง", ready: hasValidRegistrationFields, step: 3 },
    { label: `รอบเช็คชื่อ ${sessionCount} รอบ`, detail: hasSessions ? undefined : "ทุกวันต้องมีรอบ หรือมีรอบที่ใช้ได้ทุกวัน", ready: hasSessions, step: 4 },
    { label: event.registrationDeadline ? `ปิดรับ ${deadlineLabel.format(event.registrationDeadline)}` : "วันปิดรับลงทะเบียน", detail: hasFutureDeadline ? undefined : "ต้องตั้งวันปิดรับที่ยังไม่ผ่านมา", ready: hasFutureDeadline, step: 1 },
    ...(hasFileFields ? [{ label: "ที่เก็บไฟล์แนบ", detail: hasFileStorage ? undefined : "production ต้องตั้ง UPLOAD_DIR (โฟลเดอร์เก็บไฟล์บนเซิร์ฟเวอร์)", ready: hasFileStorage }] : []),
  ];
  const stepReady = [!!event.title.trim() && hasFutureDeadline, days.length > 0, hasValidRegistrationFields, hasSessions, event.status !== "DRAFT"];
  const deadlineDate = event.registrationDeadline
    ? new Date(event.registrationDeadline.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10)
    : "";
  const todayInBangkok = new Date(new Date().getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);

  return (
    <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
      <aside className="flex w-full shrink-0 flex-col gap-5 border-b bg-card px-4 py-5 sm:px-6 lg:min-h-[calc(100svh-60px)] lg:w-[300px] lg:gap-6 lg:border-b-0 lg:border-r lg:px-8 lg:py-9">
        <div className="flex flex-col gap-1">
          <Link href="/organizer" className="-my-2.5 flex w-fit items-center gap-1 py-2.5 text-sm text-muted-foreground hover:text-foreground"><ChevronLeftIcon className="size-4" aria-hidden="true" />โครงการของฉัน</Link>
          <h2 className="font-heading text-xl font-bold leading-snug">{event.title}</h2>
          <span className="flex items-center gap-2 text-xs text-muted-foreground"><Badge variant="secondary" className={event.status === "PUBLISHED" ? "bg-accent text-accent-foreground" : event.status === "DRAFT" ? "bg-amber-100 text-amber-900" : ""}>{statusLabel[event.status]}</Badge>ตั้งค่าโครงการ</span>
        </div>
        <nav aria-label="ขั้นตอนตั้งค่าโครงการ" className="grid grid-cols-5 gap-1 lg:flex lg:flex-col lg:gap-0">
          {wizardSteps.map(({ label }, index) => {
            const current = step === index + 1;
            // A step is ticked only when its data is actually ready, not merely visited.
            const complete = !current && stepReady[index];
            return <Link key={label} href={`/organizer/${eventId}?step=${index + 1}`} aria-current={current ? "step" : undefined}
              className={cn("relative flex min-w-0 flex-col items-center gap-2 rounded-lg px-1 py-2 text-center transition-colors hover:bg-muted lg:min-h-[68px] lg:flex-row lg:items-center lg:gap-3 lg:px-2 lg:py-2 lg:text-left", current && "bg-accent lg:bg-transparent")}>
              <span className={cn("relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full border-2 bg-card text-sm font-semibold", current && "border-primary bg-primary text-primary-foreground", complete && "border-primary bg-primary text-primary-foreground", !current && !complete && "border-input text-muted-foreground")}>
                {complete ? "✓" : index + 1}
              </span>
              <span className="flex min-w-0 flex-col lg:gap-0.5">
                <span className="hidden text-xs text-muted-foreground lg:block">ขั้นที่ {index + 1}</span>
                <span className={cn("line-clamp-2 text-[10px] font-medium leading-tight sm:text-xs lg:text-sm", current ? "text-foreground" : "text-muted-foreground")}>{label}</span>
              </span>
              {index < wizardSteps.length - 1 && <span aria-hidden="true" className="absolute left-[calc(50%+16px)] top-[26px] hidden h-0.5 w-[calc(100%-28px)] bg-border lg:left-[15px] lg:top-[50px] lg:block lg:h-9 lg:w-0.5" />}
            </Link>;
          })}
        </nav>
        <p className="hidden rounded-lg bg-muted p-3 text-xs leading-relaxed text-muted-foreground lg:mt-auto lg:block">บันทึกแต่ละส่วนก่อนเปลี่ยนขั้น · เผยแพร่ได้เมื่อข้อมูลครบ</p>
      </aside>
    <div className="flex min-w-0 flex-1 flex-col">
    <main className="flex w-full max-w-[1320px] flex-1 flex-col gap-6 px-4 py-6 sm:px-6 lg:gap-7 lg:px-12 lg:py-9">
      {step === 1 && <>
        {event.status === "DRAFT" && <div role="status" className="flex items-start gap-3 rounded-lg bg-[var(--status-warning-background)] px-4 py-3 text-sm"><LockKeyholeIcon className="mt-0.5 size-4 shrink-0 text-[var(--status-warning)]" aria-hidden="true" /><p><strong>สถานะ: ฉบับร่าง</strong> — ลิงก์ลงทะเบียนยังเปิดไม่ได้จนกว่าจะกด “เผยแพร่” ในขั้นที่ 5</p></div>}
        <div className="flex flex-col gap-1">
          <h2 className="font-heading text-[22px] font-bold">ข้อมูลโครงการ</h2>
          <p className="text-sm text-muted-foreground">ข้อมูลนี้แสดงบนหน้าลงทะเบียนสาธารณะ</p>
        </div>
        {(error === "invalid" || isCoverError(error)) && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{errorMessage[error]}{error === "invalid" && event.status !== "DRAFT" ? " · เปลี่ยนรูปแบบที่นั่งหรือลดที่นั่งทั้งหลักสูตรต่ำกว่าจำนวนที่จองแล้วไม่ได้" : ""}</p>}
        {saved === "1" && <p role="status" className="rounded-lg border border-primary/30 bg-accent px-4 py-3 text-sm text-accent-foreground">บันทึกข้อมูลโครงการแล้ว</p>}
        {saved === "cloned" && <p role="status" className="rounded-lg border border-primary/30 bg-accent px-4 py-3 text-sm text-accent-foreground">ทำสำเนาโครงการแล้ว — คัดลอกข้อมูล ฟอร์ม รูปปก และรอบเช็คชื่อ (แบบไม่ผูกวัน) มาให้ ต้องกำหนดวันที่จัด ที่นั่ง วันปิดรับ และผู้ร่วมจัดใหม่</p>}
        <form id="event-info" action={save} className="flex flex-col gap-6">
          <EventInfoFields event={event} deadlineDate={deadlineDate} seatModeLocked={event.status !== "DRAFT" || registrantCount > 0} registrantCount={registrantCount} />
          <div className="flex justify-end"><Button type="submit" variant="outline" size="lg">บันทึก</Button></div>
        </form>
      </>}

      {step === 3 && <FieldBuilderStep eventId={eventId} items={readRegistrationForm(event.fields)} fieldsVersion={event.fieldsVersion} editable selectedField={typeof selectedField === "string" ? selectedField : undefined} errorCode={typeof error === "string" ? error : undefined} error={typeof error === "string" ? errorMessage[error] : undefined} />}

      {step === 2 && <section className="flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <h2 className="font-heading text-[22px] font-bold">วันที่จัดอบรม & ที่นั่ง</h2>
          <p className="text-sm text-muted-foreground">{event.seatMode === "whole_course" ? "หลักสูตรต่อเนื่อง — ผู้เข้าอบรมต้องมาครบทุกวัน ที่นั่งนับรวมเป็นก้อนเดียว" : "คลิกวันในปฏิทินเพื่อเพิ่ม/เอาออก · ไม่ต้องต่อเนื่อง · ที่นั่งจำกัดแยกกันแต่ละวัน · ผู้ลงทะเบียนเลือกเองว่าจะมาวันไหน"}</p>
        </div>
        {/* The seat mode is chosen in step 1; here it is shown so organizers know which layout they are looking at. */}
        <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-card px-4 py-3">
          <span className="text-sm text-muted-foreground">โหมดที่เลือกไว้ในขั้นที่ 1</span>
          <span className="flex gap-1 rounded-lg bg-muted p-1 text-sm font-semibold">
            {([["per_day", "แยกที่นั่งรายวัน", CalendarDaysIcon], ["whole_course", "รวมทั้งคอร์ส", LayersIcon]] as const).map(([value, label, Icon]) => <span key={value} aria-current={event.seatMode === value ? "true" : undefined} className={cn("flex items-center gap-1.5 rounded-md px-3 py-1.5", event.seatMode === value ? "bg-card text-foreground shadow-sm" : "text-muted-foreground")}><Icon className="size-4" aria-hidden="true" />{label}</span>)}
          </span>
          <span className="ml-auto text-xs text-muted-foreground">{event.status === "DRAFT" && registrantCount === 0 ? <Link href={`/organizer/${eventId}?step=1`} className="font-semibold text-primary underline-offset-4 hover:underline">เปลี่ยนในขั้นที่ 1</Link> : "ล็อกหลังเผยแพร่ / มีผู้ลงทะเบียนแล้ว"}</span>
        </div>
        {typeof error === "string" && ["invalid-day", "duplicate-day", "day-in-use", "seats-in-use"].includes(error) && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{errorMessage[error]}</p>}
        <DaysPlanner addDays={addDay} today={todayInBangkok} seatMode={event.seatMode === "whole_course" ? "whole_course" : "per_day"} course={courseSeats}
          days={days.map((day, index) => ({
            id: day.id, date: day.date.toISOString().slice(0, 10), number: index + 1, maxSeats: day.maxSeats, isClosed: day.isClosed,
            approved: approvedCountByDay.get(day.id) ?? 0, occupied: occupiedCountByDay.get(day.id) ?? 0, registrants: day._count.registrantDays,
            removable: day._count.registrantDays === 0 && day.sessions.length === 0,
            update: updateEventDay.bind(null, eventId, day.id), remove: removeEventDay.bind(null, eventId, day.id),
          }))} />
      </section>}

      {step === 4 && <section className="flex flex-col gap-6">
        <div className="flex flex-col gap-1">
          <h2 className="font-heading text-[22px] font-bold">รอบเช็คชื่อ</h2>
          <p className="text-sm text-muted-foreground">อย่างน้อย 1 รอบต่อโครงการ · ผูกรอบกับวันจัดได้ เพื่อให้หน้างานเตือนเมื่อคนสแกนไม่ได้ลงวันนั้นไว้</p>
        </div>
        <SessionsPlanner
          eventId={eventId}
          initialSession={typeof selectedSession === "string" ? selectedSession : undefined}
          notice={typeof error === "string" && sessionMessages[error] ? { text: sessionMessages[error], tone: "error" } : saved === "session" ? { text: typeof added === "string" ? `เพิ่มรอบแล้ว ${added} รอบ` : "บันทึกรอบแล้ว", tone: "ok" } : undefined}
          days={days.map((day, index) => ({
            id: day.id, number: index + 1, title: dayTitle.format(day.date), shortTitle: dayShort.format(day.date),
            seats: event.seatMode === "whole_course" ? null : `${(approvedCountByDay.get(day.id) ?? 0).toLocaleString("th-TH")} / ${day.maxSeats?.toLocaleString("th-TH") ?? "ไม่จำกัด"} ที่นั่ง`,
            sessions: day.sessions.map((session) => toPlanner(session, day.id)),
          }))}
          everyDay={globalSessions.map((session) => toPlanner(session, null))}
        />
      </section>}

      {step === 5 && <section className="flex flex-col gap-6">
        <div className="flex flex-col gap-1">
          <h2 className="font-heading text-[22px] font-bold">ผู้ร่วมจัด & เผยแพร่</h2>
          <p className="text-sm text-muted-foreground">เจ้าของเท่านั้นที่เพิ่ม/ลบผู้ร่วมจัด และกดเผยแพร่/ปิดรับได้</p>
        </div>
        <PublishStep event={event} owner={owner} members={members} checks={publishChecks} canAdminister={canAdminister} canClone={await mayCreateEvents(user.role) && await isFeatureEnabled("eventClone")}
          error={typeof error === "string" ? error : undefined} saved={typeof saved === "string" ? saved : undefined} />
      </section>}
    </main>
    <footer className="sticky bottom-0 pb-[max(1rem,env(safe-area-inset-bottom))] mt-auto flex flex-wrap items-center justify-between gap-3 border-t bg-card px-4 py-3 shadow-[0_-4px_16px_rgb(0_0_0/0.04)] sm:px-6 sm:py-4 lg:px-12">
      <Button asChild variant="outline" size="lg"><Link href={step > 1 ? `/organizer/${eventId}?step=${step - 1}` : "/organizer"}><ChevronLeftIcon data-icon="inline-start" aria-hidden="true" />{step > 1 ? "ย้อนกลับ" : "โครงการของฉัน"}</Link></Button>
      <div className="flex items-center gap-3">
        <span className="hidden text-sm text-muted-foreground sm:inline">ขั้นที่ {step} จาก 5</span>
        {step === 1 ? <Button type="submit" form="event-info" name="next" value="2" size="lg">บันทึกและถัดไป: {wizardSteps[1].label}</Button> : step < 5 ? <Button asChild size="lg"><Link href={`/organizer/${eventId}?step=${step + 1}`}>ถัดไป: {wizardSteps[step].label}</Link></Button> : <Button asChild size="lg"><Link href={event.status === "DRAFT" ? "/organizer" : `/organizer/${eventId}/dashboard`}>เสร็จสิ้น</Link></Button>}
      </div>
    </footer>
    </div>
    </div>
  );
}
