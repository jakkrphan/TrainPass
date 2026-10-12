import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import { ImageIcon, LockKeyholeIcon, MapPinIcon } from "lucide-react";

import { PublicRegistrationWizard } from "@/app/(public)/events/[slug]/public-registration-wizard";
import { Badge } from "@/components/ui/badge";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { answerProblemMessage, formPageLayout, readRegistrationFields, readRegistrationForm, validateRegistrationFields } from "@/features/events/registration-fields";
import { db } from "@/server/db";
import { getSeatAvailability } from "@/server/registrations/day-status";
import { issueFormTicket } from "@/server/registrations/form-ticket";
import { isFeatureEnabled } from "@/server/settings/features";
import { lineConfigured } from "@/server/line/client";
import { fileStorageReady } from "@/server/registrations/upload-storage";
import { withBasePath } from "@/lib/base-path";

export const metadata: Metadata = {
  title: "ลงทะเบียนอบรม",
};

// Formatted on the server by hand (not Intl) so the string is identical wherever it renders.
const bangkokTime = (value: Date) => { const shifted = new Date(value.getTime() + 7 * 60 * 60 * 1000); return `${String(shifted.getUTCHours()).padStart(2, "0")}:${String(shifted.getUTCMinutes()).padStart(2, "0")}`; };

/** "08:30–16:30 · เช้า + บ่าย" for one day; sessions without a day apply to every day. */
function daySchedule(dayId: string, sessions: { eventDayId: string | null; label: string; startTime: Date | null; endTime: Date | null }[]) {
  const ofDay = sessions.filter((session) => session.eventDayId === null || session.eventDayId === dayId);
  if (ofDay.length === 0) return null;
  const starts = ofDay.flatMap((session) => session.startTime ? [session.startTime.getTime()] : []);
  const ends = ofDay.flatMap((session) => session.endTime ? [session.endTime.getTime()] : []);
  const range = starts.length > 0 && ends.length > 0 ? `${bangkokTime(new Date(Math.min(...starts)))}–${bangkokTime(new Date(Math.max(...ends)))}` : null;
  return [range, ofDay.map((session) => session.label).join(" + ")].filter(Boolean).join(" · ");
}

export default async function PublicEventPage({
  params,
  searchParams,
}: PageProps<"/events/[slug]">) {
  const { slug } = await params;
  const { error, field: problemKey, problem: problemReason } = await searchParams;
  const event = await db.event.findUnique({
    where: { slug, deletedAt: null },
    select: {
      id: true,
      title: true,
      coverImageUrl: true,
      description: true,
      location: true,
      eventType: true,
      autoApprove: true,
      waitlistEnabled: true,
      seatMode: true,
      maxSeats: true,
      status: true,
      registrationDeadline: true,
      fields: true,
      fieldsVersion: true,
      days: { orderBy: { date: "asc" }, select: { id: true, date: true, maxSeats: true, isClosed: true } },
      sessions: { orderBy: [{ sortOrder: "asc" }, { startTime: "asc" }], select: { eventDayId: true, label: true, startTime: true, endTime: true } },
    },
  });

  if (!event) notFound();

  if (event.status === "DRAFT") {
    return (
      <main className="mx-auto flex min-h-svh w-full max-w-lg md:my-10 md:min-h-0 md:max-w-xl md:overflow-clip md:rounded-2xl md:border md:shadow-sm lg:max-w-2xl bg-background">
        <Empty className="rounded-none border-0 px-6 py-8">
          <EmptyHeader>
            <EmptyMedia variant="hero"><LockKeyholeIcon aria-hidden="true" /></EmptyMedia>
            <EmptyTitle size="hero">ยังไม่เปิดรับลงทะเบียน</EmptyTitle>
            <EmptyDescription>โครงการนี้ยังเป็นฉบับร่าง ผู้จัดยังไม่กดเผยแพร่<br />กรุณากลับมาใหม่ภายหลัง หรือสอบถามผู้จัดโครงการ</EmptyDescription>
          </EmptyHeader>
          <EmptyContent><p className="text-xs text-muted-foreground">{event.title}</p></EmptyContent>
        </Empty>
      </main>
    );
  }

  const closed = event.status === "CLOSED" || (event.registrationDeadline !== null && event.registrationDeadline <= new Date());
  const dateFormatter = new Intl.DateTimeFormat("th-TH", {
    day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
  });
  const fields = readRegistrationFields(event.fields);
  const paused = !(await isFeatureEnabled("publicRegistration"));
  const available = !paused && !closed && !!event.registrationDeadline && event.days.some((day) => event.seatMode === "whole_course" || !day.isClosed) && validateRegistrationFields(fields)
    && fields.every((field) => field.type !== "file" || fileStorageReady());
  const availability = await getSeatAvailability(db, event, event.days.map((day) => day.id));
  const days = event.days.map((day) => {
    return {
      id: day.id,
      date: day.date.toISOString().slice(0, 10),
      label: dateFormatter.format(day.date),
      schedule: daySchedule(day.id, event.sessions),
      maxSeats: day.maxSeats,
      isClosed: day.isClosed,
      remaining: availability.mode === "per_day" ? availability.days.get(day.id)?.remaining ?? null : null,
    };
  });
  const lineEnabled = lineConfigured() && await isFeatureEnabled("lineLogin");
  const deadline = event.registrationDeadline ? new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" }).format(event.registrationDeadline) : "ยังไม่กำหนด";
  const errorMessage: Record<string, string> = {
    paused: "ขณะนี้ปิดรับลงทะเบียนออนไลน์ชั่วคราว กรุณาลองใหม่ภายหลัง",
    "not-open": "โครงการนี้ยังไม่เปิดรับลงทะเบียน",
    full: "ที่นั่งเต็มแล้ว โครงการนี้ไม่เปิดรับรอคิว — ถ้าเลือกหลายวัน ลองเลือกเฉพาะวันที่ยังว่าง",
    invalid: "กรุณาตรวจสอบข้อมูล วันที่เลือก และการยินยอมก่อนส่ง",
    "form-changed": "ผู้จัดเพิ่งแก้แบบฟอร์มระหว่างที่คุณกรอก — หน้านี้เป็นแบบฟอร์มล่าสุดแล้ว กรุณากรอกและส่งอีกครั้ง",
    duplicate: "อีเมลนี้ลงทะเบียนโครงการนี้แล้ว กรุณาใช้ลิงก์สถานะที่ได้รับตอนลงทะเบียน",
    "rate-limited": "ส่งใบสมัครบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่",
    unavailable: "ระบบลงทะเบียนยังไม่พร้อม กรุณาลองใหม่ภายหลัง",
    "too-fast": "ระบบตรวจพบการส่งเร็วผิดปกติ กรุณาตรวจสอบข้อมูลแล้วส่งอีกครั้ง",
    expired: "หน้าฟอร์มเปิดค้างไว้นานเกินไป กรุณากรอกและส่งใหม่อีกครั้ง",
  };

  const typeLabel = event.eventType === "INTERNAL" ? "ภายใน" : event.eventType === "EXTERNAL" ? "ภายนอก" : "ผสม";
  const cover = event.coverImageUrl ? <div className="relative aspect-[16/6] min-h-44 bg-muted"><Image src={withBasePath(event.coverImageUrl)} alt={`รูปปก ${event.title}`} fill priority unoptimized className="object-cover" sizes="(max-width: 480px) 100vw, 480px" /></div> : <div role="img" aria-label="พื้นที่รูปปกโครงการ" className="flex aspect-[16/6] min-h-44 flex-col items-center justify-center gap-2 bg-muted text-muted-foreground"><ImageIcon className="size-8" aria-hidden="true" /><span className="text-sm">รูปปกโครงการ</span></div>;
  const details = (event.description || event.location) ? <div className="flex flex-col gap-2">{event.description && <p className="whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{event.description}</p>}{event.location && <p className="flex items-center gap-2 text-xs text-muted-foreground"><MapPinIcon className="size-4 shrink-0" aria-hidden="true" />{event.location}</p>}</div> : null;
  // A rejected answer names its field; the wizard restarts at step 1, so the message has to say where to look.
  const problemField = error === "invalid" && typeof problemKey === "string" ? fields.find((field) => field.key === problemKey) : undefined;
  const notice = problemField ? `ส่งใบสมัครไม่ได้: ${answerProblemMessage(problemField, problemReason === "required" ? "required" : "invalid")} — กรุณากรอกใหม่อีกครั้ง`
    : typeof error === "string" && errorMessage[error] ? errorMessage[error] : null;

  if (available) {
    return (
      <main className="mx-auto flex min-h-svh w-full max-w-lg md:my-10 md:min-h-0 md:max-w-xl md:overflow-clip md:rounded-2xl md:border md:shadow-sm lg:max-w-2xl flex-col bg-background shadow-sm">
        <PublicRegistrationWizard slug={slug} formTicket={issueFormTicket()} fieldsVersion={event.fieldsVersion} fields={fields} pages={formPageLayout(readRegistrationForm(event.fields))} days={days} lineEnabled={lineEnabled} deadline={deadline} autoApprove={event.autoApprove} waitlistEnabled={event.waitlistEnabled} seatMode={event.seatMode} courseRemaining={availability.mode === "whole_course" ? availability.remaining : null} courseMaxSeats={event.maxSeats} title={event.title} typeLabel={typeLabel} cover={cover} details={details} notice={notice} />
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-lg md:my-10 md:min-h-0 md:max-w-xl md:overflow-clip md:rounded-2xl md:border md:shadow-sm lg:max-w-2xl flex-col bg-background shadow-sm">
      {cover}
      <div className="flex flex-col gap-3 border-b bg-card px-5 py-5">
        <div className="flex items-center justify-between"><p className="text-xs text-muted-foreground">โครงการอบรม</p><Badge variant="secondary" className="rounded-md bg-muted font-semibold">{typeLabel}</Badge></div>
        <h1 className="font-heading text-xl font-bold leading-snug">{event.title}</h1>
        {details}
      </div>
      {closed ? (
        <p role="status" className="m-5 rounded-xl border bg-card p-5 font-medium">ปิดรับลงทะเบียนแล้ว</p>
      ) : paused ? (
        <p role="status" className="m-5 rounded-xl border bg-card p-5 text-sm"><strong className="block font-medium">ปิดรับลงทะเบียนออนไลน์ชั่วคราว</strong>ระบบหยุดรับใบสมัครชั่วคราว กรุณากลับมาใหม่ภายหลัง หากลงทะเบียนไว้แล้วยังใช้ลิงก์สถานะและ QR ได้ตามปกติ</p>
      ) : <p role="status" className="m-5 rounded-xl border bg-card p-5 text-sm">{event.days.length > 0 && event.days.every((day) => day.isClosed) ? "ปิดรับลงทะเบียนทุกวันแล้ว" : "ยังไม่พร้อมรับลงทะเบียนออนไลน์"}</p>}
    </main>
  );
}
