import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarDaysIcon, ChevronLeftIcon, DownloadIcon, HistoryIcon, KeyRoundIcon, MapPinIcon, ShieldIcon } from "lucide-react";

import { EventOverviewPanels } from "@/components/event-overview-panels";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { auditToneClass, describeAudit } from "@/features/audit/labels";
import { seatModeLabel } from "@/app/(organizer)/organizer/[eventId]/event-header";
import { formatDateTime, formatEventDayList } from "@/lib/format";
import { cn } from "@/lib/utils";
import { requireAdminUser } from "@/server/authorization/session";
import { db } from "@/server/db";
import { getEventOverview } from "@/server/events/overview";
import { isFeatureEnabled } from "@/server/settings/features";
import { withBasePath } from "@/lib/base-path";

import { DeleteEventButton } from "./delete-event-button";

const statusLabel = { DRAFT: "ฉบับร่าง", PUBLISHED: "เผยแพร่แล้ว", CLOSED: "ปิดรับแล้ว" } as const;
const typeLabel = { INTERNAL: "ภายใน", EXTERNAL: "ภายนอก", MIXED: "ผสม" } as const;

export const metadata: Metadata = { title: "ดูแลโครงการ · ผู้ดูแลระบบ" };

export default async function AdminEventPage({ params }: PageProps<"/admin/events/[eventId]">) {
  const admin = await requireAdminUser();
  const { eventId } = await params;
  const event = await db.event.findUnique({
    where: { id: eventId },
    include: {
      owner: { select: { id: true, name: true, email: true } },
      days: { orderBy: { date: "asc" }, select: { date: true } },
      organizers: { orderBy: { addedAt: "asc" }, include: { user: { select: { id: true, name: true, email: true } } } },
      _count: { select: { registrants: true } },
    },
  });
  if (!event) notFound();

  const isMember = event.ownerId === admin.id || event.organizers.some((organizer) => organizer.user.id === admin.id);
  // Viewing someone else's project with admin rights is always recorded.
  if (!isMember) await db.auditLog.create({ data: { eventId: event.id, actorId: admin.id, action: "ADMIN_EVENT_VIEWED", target: event.id, metadata: { ownerId: event.ownerId } } });

  const [overview, auditLogs] = await Promise.all([
    getEventOverview(event),
    db.auditLog.findMany({ where: { eventId: event.id }, orderBy: { createdAt: "desc" }, take: 10, include: { actor: { select: { name: true } } } }),
  ]);
  const auditHref = `/admin?view=audit&scope=event&event=${event.id}`;

  return <>
    {!isMember && <div className="border-b border-amber-200 bg-amber-50 text-amber-950">
      <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-3 px-5 py-4 lg:px-10">
        <div className="flex items-start gap-3"><ShieldIcon className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <div className="flex flex-col"><strong>คุณเปิดโครงการนี้ด้วยสิทธิ์ admin — ไม่ได้เป็นเจ้าของหรือผู้ร่วมจัด</strong><span className="text-sm">เจ้าของ: {event.owner.name} ({event.owner.email}) · ทุกการเปิดดูและแก้ไขถูกบันทึกลง audit log</span></div>
        </div>
        <Button asChild variant="outline" className="bg-card"><Link href={auditHref}><HistoryIcon data-icon="inline-start" aria-hidden="true" />ดู audit log ของโครงการนี้</Link></Button>
      </div>
    </div>}
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-5 py-8 lg:px-10">
      <header className="flex flex-col gap-3">
        <Link href="/admin?view=events" className="-my-2.5 flex w-fit items-center gap-1 py-2.5 text-sm text-muted-foreground hover:text-foreground"><ChevronLeftIcon className="size-4" aria-hidden="true" />โครงการทั้งหมด</Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-2.5">
            <h1 className="font-heading text-2xl font-bold leading-snug">{event.title}</h1>
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span className={cn("rounded-md px-2 py-0.5 text-xs font-semibold", event.deletedAt ? "bg-rose-100 text-rose-900" : event.status === "PUBLISHED" ? "bg-accent text-accent-foreground" : event.status === "DRAFT" ? "bg-amber-100 text-amber-900" : "bg-muted")}>{event.deletedAt ? "ลบแล้ว (เก็บย้อนหลัง)" : statusLabel[event.status]}</span>
              <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-semibold text-foreground">{typeLabel[event.eventType]}</span>
              <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-semibold text-foreground">{event.autoApprove ? "อนุมัติอัตโนมัติ" : "อนุมัติเอง"}</span>
              <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-semibold text-foreground">{seatModeLabel(event.seatMode)}</span>
              {event.days.length > 0 && <span className="flex items-center gap-1"><CalendarDaysIcon className="size-4" aria-hidden="true" />{formatEventDayList(event.days.map(({ date }) => date))}</span>}
              {event.location && <span className="flex items-center gap-1"><MapPinIcon className="size-4" aria-hidden="true" />{event.location}</span>}
            </div>
            {isMember && <p className="text-sm text-muted-foreground">เจ้าของ: {event.owner.name} ({event.owner.email})</p>}
          </div>
          {!event.deletedAt && <div className="flex flex-wrap items-center gap-2">
            {await isFeatureEnabled("exportData") && <Button asChild variant="outline"><a href={withBasePath(`/organizer/${event.id}/registrants/export`)}><DownloadIcon data-icon="inline-start" aria-hidden="true" />Export CSV</a></Button>}
            <Button asChild><Link href={`/organizer/${event.id}/dashboard`}>เปิดในหน้าผู้จัด</Link></Button>
            <DeleteEventButton eventId={event.id} title={event.title} hasRegistrants={event._count.registrants > 0} />
          </div>}
        </div>
      </header>

      <EventOverviewPanels overview={overview} seatMode={event.seatMode} />

      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-2">
        <section className="flex flex-col gap-3" aria-labelledby="organizers-heading">
          <h2 id="organizers-heading" className="font-heading text-lg font-bold">ผู้ร่วมจัด</h2>
          <div className="overflow-x-auto rounded-xl border bg-card"><Table><TableHeader className="bg-secondary"><TableRow><TableHead className="px-5">ชื่อ</TableHead><TableHead>สิทธิ์ในโครงการ</TableHead></TableRow></TableHeader><TableBody>
            {event.organizers.map((organizer) => <TableRow key={organizer.id}><TableCell className="px-5">{organizer.user.name}<div className="text-xs text-muted-foreground">{organizer.user.email}</div></TableCell><TableCell>{organizer.role === "FULL" ? "เต็มสิทธิ์" : "เช็คชื่ออย่างเดียว"}</TableCell></TableRow>)}
            {event.organizers.length === 0 && <TableRow><TableCell colSpan={2} className="py-6 text-center text-muted-foreground">ไม่มีผู้ร่วมจัด</TableCell></TableRow>}
          </TableBody></Table></div>
        </section>
        <section className="flex flex-col gap-3" aria-labelledby="event-audit-heading">
          <div className="flex items-center justify-between"><h2 id="event-audit-heading" className="font-heading text-lg font-bold">Audit log ล่าสุดของโครงการ</h2><Link href={auditHref} className="-my-2.5 py-2.5 text-sm font-semibold text-primary underline-offset-4 hover:underline">ดูทั้งหมด</Link></div>
          <ol className="flex flex-col rounded-xl border bg-card px-5">{auditLogs.map((log) => {
            const { label, tone } = describeAudit(log.action);
            return <li key={log.id} className="flex flex-wrap items-center justify-between gap-2 border-t py-3 first:border-t-0">
              <span className="flex items-center gap-2"><span className={cn("rounded-md px-2 py-0.5 text-xs font-semibold", auditToneClass[tone])}>{label}</span><span className="text-sm">{log.actor?.name ?? "ผู้ลงทะเบียน/ระบบ"}</span></span>
              <time className="text-xs text-muted-foreground" dateTime={log.createdAt.toISOString()}>{formatDateTime(log.createdAt)}</time>
            </li>;
          })}{auditLogs.length === 0 && <li className="py-6 text-center text-sm text-muted-foreground">ยังไม่มี audit log</li>}</ol>
        </section>
      </div>

      <p className="flex items-start gap-3 rounded-xl border bg-card px-5 py-4 text-sm text-muted-foreground"><KeyRoundIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />สิทธิ์ admin ใช้สำหรับดูแลระบบ/แก้ปัญหาให้ผู้จัด เช่น ผู้จัดลาออกแล้วไม่มีใครเข้าโครงการได้ — ไม่ใช่สิทธิ์ที่มอบให้ผู้จัดทั่วไป และทุกการกระทำถูกบันทึก</p>
    </main>
  </>;
}
