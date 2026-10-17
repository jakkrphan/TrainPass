import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeftIcon } from "lucide-react";

import { readRegistrationFields } from "@/features/events/registration-fields";
import { importableFields } from "@/features/registrations/import";
import { requireEventAccess } from "@/server/authorization/event";
import { db } from "@/server/db";

import { OrganizerEventHeader } from "../../event-header";
import { importRegistrants } from "./actions";
import { ImportForm } from "./import-form";

export const metadata: Metadata = { title: "นำเข้ารายชื่อ" };

export default async function ImportPage({ params }: PageProps<"/organizer/[eventId]/registrants/import">) {
  const { eventId } = await params;
  const { event, membership } = await requireEventAccess(eventId, "manage");
  // Admins only: one import creates many approved registrants at once and skips the seat checks.
  if (membership.systemRole !== "admin") notFound();
  const days = await db.eventDay.findMany({ where: { eventId }, orderBy: { date: "asc" }, select: { id: true, date: true } });
  const fields = importableFields(readRegistrationFields(event.fields)).map((field) => ({ key: field.key, label: field.label, type: field.type, options: field.options }));

  return <>
    <OrganizerEventHeader event={event} activeTab="registrants" />
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-5 py-8 lg:px-10">
      <Link href={`/organizer/${eventId}/registrants`} className="-my-2.5 flex w-fit items-center gap-1 py-2.5 text-sm text-muted-foreground hover:text-foreground"><ChevronLeftIcon className="size-4" aria-hidden="true" />ผู้ลงทะเบียน</Link>
      <div className="flex flex-col gap-1">
        <h2 className="font-heading text-xl font-bold">นำเข้ารายชื่อจากไฟล์ CSV</h2>
        <p className="text-sm text-muted-foreground">สำหรับผู้ที่ลงทะเบียนจากระบบอื่นและได้ QR ไปแล้ว: ทุกคนในไฟล์จะเป็น “อนุมัติแล้ว” ตามวันที่ในไฟล์ และใช้ Ticket ID เดิมเป็นรหัส QR จึงสแกนเช็คชื่อด้วย QR เดิมได้ทันที ระบบไม่ส่งอีเมลหรือ LINE ให้อัตโนมัติ</p>
      </div>
      {event.anonymizedAt
        ? <p role="status" className="rounded-xl border bg-card px-5 py-3 text-sm text-muted-foreground">โครงการนี้ลบข้อมูลส่วนบุคคลตามระยะเก็บแล้ว นำเข้าไม่ได้</p>
        : !days.length
          ? <p role="status" className="rounded-xl border bg-card px-5 py-3 text-sm text-muted-foreground">โครงการนี้ยังไม่มีวันอบรม — เพิ่มวันในหน้าตั้งค่าก่อนนำเข้า</p>
          : <ImportForm action={importRegistrants.bind(null, eventId)} eventId={eventId} fields={fields} days={days.map((day) => ({ id: day.id, date: day.date.toISOString() }))} seatMode={event.seatMode} />}
    </main>
  </>;
}
