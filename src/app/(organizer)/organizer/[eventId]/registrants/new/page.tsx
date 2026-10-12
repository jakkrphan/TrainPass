import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { CheckCircle2Icon, DownloadIcon, ExternalLinkIcon, ListIcon } from "lucide-react";

import { WalkInForm } from "@/app/(organizer)/organizer/[eventId]/registrants/new/walk-in-form";
import { Button } from "@/components/ui/button";
import { formPageLayout, readRegistrationFields, readRegistrationForm, validateRegistrationFields } from "@/features/events/registration-fields";
import { requireEventAccess } from "@/server/authorization/event";
import { db } from "@/server/db";
import { getSeatAvailability } from "@/server/registrations/day-status";
import { isFeatureEnabled } from "@/server/settings/features";
import { fileStorageReady } from "@/server/registrations/upload-storage";
import { withBasePath } from "@/lib/base-path";

import { OrganizerEventHeader } from "../../event-header";
import { WALK_IN_LINK_COOKIE } from "./walk-in-link";

export const metadata: Metadata = { title: "เพิ่มผู้ลงทะเบียนเอง" };

const errorMessages: Record<string, string> = {
  invalid: "กรุณาตรวจสอบข้อมูล: เลือกวันอย่างน้อย 1 วัน กรอกฟิลด์ที่บังคับ และอีเมลต้องถูกรูปแบบ (ถ้ากรอก)",
  duplicate: "อีเมลนี้ลงทะเบียนโครงการนี้แล้ว",
  consent: "ต้องยืนยันว่าได้รับความยินยอมก่อนบันทึก",
  "not-open": "โครงการฉบับร่างหรือวันที่ปิดรับ เพิ่มผู้ลงทะเบียนไม่ได้",
  retry: "ระบบกำลังทำรายการอื่น กรุณาลองใหม่",
};
const dayLabel = new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export default async function NewRegistrantPage({ params, searchParams }: PageProps<"/organizer/[eventId]/registrants/new">) {
  const { eventId } = await params;
  const { error, added: addedParam } = await searchParams;
  const { event } = await requireEventAccess(eventId, "manage");
  if (!(await isFeatureEnabled("walkIn"))) redirect(`/organizer/${eventId}/registrants?error=walk-in-disabled`);
  const fields = readRegistrationFields(event.fields);
  const eventDays = await db.eventDay.findMany({ where: { eventId }, orderBy: { date: "asc" }, select: { id: true, date: true, isClosed: true } });
  const availability = await getSeatAvailability(db, event, eventDays.map((day) => day.id));
  const days = eventDays.map((day, index) => ({
    id: day.id, number: index + 1, label: dayLabel.format(day.date), isClosed: day.isClosed,
    remaining: availability.mode === "per_day" ? availability.days.get(day.id)?.remaining ?? null : null,
  }));
  const ready = event.status !== "DRAFT" && days.some((day) => event.seatMode === "whole_course" || !day.isClosed) && validateRegistrationFields(fields)
    && fields.every((field) => field.type !== "file" || fileStorageReady());
  const backHref = `/organizer/${eventId}/registrants`;
  // The person just saved: shown above a fresh form so the next walk-in can be entered straight away.
  const added = typeof addedParam === "string" ? await db.registrant.findFirst({ where: { id: addedParam, eventId }, select: { id: true, displayName: true, email: true, status: true } }) : null;
  const flash = (await cookies()).get(WALK_IN_LINK_COOKIE)?.value.split(":");
  const statusHref = added && flash?.[0] === added.id && flash[1] ? withBasePath(`/events/${event.slug}/status/${flash[1]}`) : null;

  return <>
    <OrganizerEventHeader event={event} activeTab="registrants" />
    <main className="flex w-full flex-1 justify-center bg-muted/40 px-4 py-8 sm:px-6">
      <div className="w-full max-w-2xl">
        {added && <AddedCard eventId={eventId} person={added} statusHref={statusHref} backHref={backHref} />}
        {ready ? <WalkInForm key={added?.id ?? "new"} eventId={eventId} fields={fields} pages={formPageLayout(readRegistrationForm(event.fields))} days={days} seatMode={event.seatMode === "whole_course" ? "whole_course" : "per_day"}
          courseRemaining={availability.mode === "whole_course" ? availability.remaining : null} backHref={backHref}
          error={typeof error === "string" ? errorMessages[error] : undefined} />
          : <div className="flex flex-col items-start gap-3 rounded-2xl border bg-card p-6">
            <h2 className="font-heading text-xl font-bold">ยังเพิ่มผู้ลงทะเบียนไม่ได้</h2>
            <p className="text-sm text-muted-foreground">{event.status === "DRAFT" ? "โครงการยังเป็นฉบับร่าง — เผยแพร่ก่อนจึงจะเพิ่มผู้ลงทะเบียนได้" : "ต้องมีวันที่เปิดรับอย่างน้อย 1 วัน และฟอร์มลงทะเบียนที่ตั้งค่าถูกต้อง"}</p>
            <Button asChild variant="outline"><Link href={event.status === "DRAFT" ? `/organizer/${eventId}?step=5` : backHref}>{event.status === "DRAFT" ? "ไปหน้าเผยแพร่" : "กลับไปหน้าผู้ลงทะเบียน"}</Link></Button>
          </div>}
      </div>
    </main>
  </>;
}

const addedStatus: Record<string, string> = {
  APPROVED: "อนุมัติแล้ว · ใช้ QR นี้เช็คชื่อได้เลย",
  PENDING: "รออนุมัติ · จะได้ QR เมื่ออนุมัติ",
  WAITLISTED: "อยู่ในคิวสำรอง เพราะที่นั่งเต็ม",
};

function AddedCard({ eventId, person, statusHref, backHref }: { eventId: string; person: { id: string; displayName: string | null; email: string | null; status: string }; statusHref: string | null; backHref: string }) {
  const name = person.displayName ?? person.email ?? "ผู้ลงทะเบียน";
  const approved = person.status === "APPROVED";
  const qrHref = withBasePath(`/organizer/${eventId}/registrants/${person.id}/qr`);
  return <section role="status" aria-labelledby="walk-in-added" className="mb-6 flex flex-col gap-4 rounded-2xl border border-emerald-300 bg-card p-5 shadow-sm sm:flex-row sm:items-start">
    {/* Plain img: the QR is private and generated per request; the next/image optimizer would fetch it without the session. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    {approved && <img src={`${qrHref}?inline=1`} alt={`QR เช็คชื่อของ ${name}`} width={144} height={144} className="size-36 shrink-0 self-center rounded-lg border bg-white p-1 sm:self-start" />}
    <div className="flex min-w-0 flex-1 flex-col gap-3">
      <div className="flex items-start gap-2">
        <CheckCircle2Icon className="mt-0.5 size-5 shrink-0 text-emerald-700" aria-hidden="true" />
        <div className="flex min-w-0 flex-col">
          <h2 id="walk-in-added" className="font-heading text-lg font-bold wrap-break-word">{`บันทึก ${name} แล้ว`}</h2>
          <p className="text-sm text-muted-foreground">{addedStatus[person.status] ?? "บันทึกแล้ว"}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {approved && <Button asChild variant="outline" size="sm"><a href={qrHref}><DownloadIcon data-icon="inline-start" aria-hidden="true" />ดาวน์โหลด QR</a></Button>}
        {statusHref && <Button asChild variant="outline" size="sm"><a href={statusHref} target="_blank" rel="noopener noreferrer"><ExternalLinkIcon data-icon="inline-start" aria-hidden="true" />เปิดหน้าสถานะ (แท็บใหม่)</a></Button>}
        <Button asChild variant="ghost" size="sm"><Link href={`${backHref}?selected=${person.id}`}><ListIcon data-icon="inline-start" aria-hidden="true" />ดูในรายชื่อ</Link></Button>
      </div>
      <p className="text-xs text-muted-foreground">กรอกคนถัดไปได้เลยในฟอร์มด้านล่าง{statusHref ? " · ลิงก์หน้าสถานะแสดงได้ภายใน 10 นาที หลังจากนั้นออกลิงก์ใหม่ได้ในหน้ารายชื่อ" : ""}</p>
    </div>
  </section>;
}
