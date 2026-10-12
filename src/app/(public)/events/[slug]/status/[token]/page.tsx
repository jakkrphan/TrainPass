import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { CalendarDaysIcon, CalendarPlusIcon, CheckCircle2Icon, Clock3Icon, DownloadIcon, MessageCircleIcon, PencilIcon, ShieldAlertIcon } from "lucide-react";

import { cancelRegistration, requestDeletionAction, startLineLinkAction, unlinkLineAction } from "@/app/(public)/events/[slug]/status/[token]/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { db } from "@/server/db";
import { lineConfigured, lineOaBasicId } from "@/server/line/client";
import { canSelfEdit } from "@/server/registrations/self-edit";
import { getFeatureFlags } from "@/server/settings/features";
import { statusTokenWhere } from "@/server/registrations/status-token";
import { withBasePath } from "@/lib/base-path";

export const metadata: Metadata = { title: "สถานะการลงทะเบียน" };

type Status = "PENDING" | "APPROVED" | "REJECTED" | "WAITLISTED" | "CANCELLED";

const statusLabel = {
  PENDING: "รอผู้จัดอนุมัติ",
  APPROVED: "อนุมัติแล้ว",
  REJECTED: "ไม่อนุมัติ",
  WAITLISTED: "อยู่ในคิวสำรอง",
  CANCELLED: "ยกเลิกแล้ว",
} as const;

const dateFormatter = new Intl.DateTimeFormat("th-TH", {
  day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
});
const shortDateFormatter = new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", timeZone: "UTC" });

const lineMessages: Record<string, string> = {
  start: "ส่งใบสมัครแล้ว — ขั้นสุดท้าย: กดปุ่ม “เชื่อม LINE” ด้านล่างเพื่อรับผลและ QR ทาง LINE · บันทึกลิงก์หน้านี้ไว้ ถ้าเชื่อมไม่สำเร็จให้กลับมาที่หน้านี้",
  linked: "เชื่อม LINE แล้ว — ต่อจากนี้ผลและ QR ส่งทาง LINE",
  unlinked: "เปลี่ยนเป็นรับทางอีเมลแล้ว — ส่งสถานะล่าสุดไปที่อีเมลของคุณ",
  "not-friend": "ยังไม่ได้เพิ่ม OA เป็นเพื่อน ระบบจึงส่งข้อความหาคุณไม่ได้ — เพิ่มเพื่อนแล้วกดเชื่อม LINE อีกครั้ง",
  cancelled: "ยกเลิกการเชื่อม LINE — ระหว่างนี้ระบบส่งทางอีเมล กดเชื่อมใหม่ได้ทุกเมื่อ",
  error: "เชื่อม LINE ไม่สำเร็จ กรุณาลองใหม่",
  closed: "การลงทะเบียนนี้ถูกยกเลิกหรือไม่ได้รับอนุมัติแล้ว จึงไม่ต้องรับแจ้งเตือน",
  unavailable: "ขณะนี้ปิดการแจ้งเตือนทาง LINE ชั่วคราว",
  duplicate: "บัญชี LINE นี้ลงทะเบียนโครงการนี้ไว้แล้ว — ระบบยกเลิกใบสมัครที่ซ้ำให้แล้ว นี่คือการลงทะเบียนเดิมของคุณ",
  "email-invalid": "กรุณากรอกอีเมลให้ถูกต้อง",
  "email-taken": "อีเมลนี้ลงทะเบียนโครงการนี้ไว้แล้ว",
};

function StatusChip({ status, queue }: { status: Status; queue?: number }) {
  const [label, tone] = status === "APPROVED" ? ["อนุมัติแล้ว", "bg-accent text-accent-foreground"]
    : status === "WAITLISTED" ? [queue ? `รอคิว #${queue}` : "รอคิว", "bg-[var(--status-warning-background)] text-[var(--status-warning)]"]
    : status === "PENDING" ? ["รออนุมัติ", "bg-muted text-foreground"]
    : [statusLabel[status], "bg-muted text-muted-foreground"];
  return <span className={cn("inline-flex h-6 shrink-0 items-center rounded-md px-2 text-xs font-semibold whitespace-nowrap", tone)}>{label}</span>;
}


export default async function RegistrationStatusPage({ params, searchParams }: PageProps<"/events/[slug]/status/[token]">) {
  const { slug, token } = await params;
  const { error, cancelled, updated, days: daysChanged, deletion, line } = await searchParams;
  const registrant = await db.registrant.findUnique({
    where: await statusTokenWhere(token),
    include: {
      event: { select: { slug: true, title: true, location: true, seatMode: true, deletedAt: true, status: true, registrationDeadline: true, fields: true, days: { orderBy: { date: "asc" }, select: { id: true } } } },
      days: { include: { eventDay: { select: { date: true } } }, orderBy: { eventDay: { date: "asc" } } },
      dataRequests: { orderBy: { requestedAt: "desc" }, take: 1, select: { status: true, requestedAt: true, resolutionNote: true } },
      notifications: { where: { channel: "LINE", status: { in: ["SENT", "FAILED"] } }, orderBy: { createdAt: "desc" }, take: 1, select: { status: true } },
    },
  });
  if (!registrant || registrant.event.slug !== slug || registrant.event.deletedAt) notFound();

  const queuePositions = new Map(await Promise.all(registrant.days.filter((day) => day.status === "WAITLISTED" && day.waitlistedAt).map(async (day) => [day.id, registrant.event.seatMode === "whole_course" ? await db.registrant.count({ where: { eventId: registrant.eventId, status: "WAITLISTED", OR: [{ registeredAt: { lt: registrant.registeredAt } }, { registeredAt: registrant.registeredAt, id: { lte: registrant.id } }] } }) : await db.registrantEventDay.count({ where: { eventDayId: day.eventDayId, status: "WAITLISTED", OR: [{ waitlistedAt: { lt: day.waitlistedAt! } }, { waitlistedAt: day.waitlistedAt!, id: { lte: day.id } }] } })] as const)));

  const qrDataUrl = registrant.status === "APPROVED" && registrant.qrCode
    ? await QRCode.toDataURL(registrant.qrCode, { width: 320, margin: 1 })
    : null;
  const cancel = cancelRegistration.bind(null, slug, token);
  const requestDeletion = requestDeletionAction.bind(null, slug, token);
  const lastRequest = registrant.dataRequests[0];
  const flags = await getFeatureFlags();
  const selfEditable = canSelfEdit(registrant, registrant.event);
  const showEdit = selfEditable && flags.selfEdit;
  const showDayChange = selfEditable && flags.selfDayChange && registrant.event.seatMode === "per_day";
  // Day numbers follow the event's own day order, not the registrant's subset of days.
  const dayNumber = new Map(registrant.event.days.map((day, index) => [day.id, index + 1]));
  const dayLabel = (day: (typeof registrant.days)[number]) => `วันที่ ${dayNumber.get(day.eventDayId) ?? "?"} · ${dateFormatter.format(day.eventDay.date)}`;
  const activeDays = registrant.days.filter((day) => ["PENDING", "APPROVED", "WAITLISTED"].includes(day.status));
  const approvedDays = registrant.days.filter((day) => day.status === "APPROVED");
  const waitlistedDays = registrant.days.filter((day) => queuePositions.has(day.id));
  const queuePosition = waitlistedDays.length > 0 ? Math.min(...waitlistedDays.map((day) => queuePositions.get(day.id)!)) : null;
  const displayName = registrant.displayName ?? registrant.email ?? "ผู้ลงทะเบียน";
  const heroText = registrant.status === "WAITLISTED" ? "ลงทะเบียนสำเร็จ · อยู่ในคิวรอ" : registrant.status === "PENDING" ? "ลงทะเบียนสำเร็จ · รออนุมัติ" : registrant.status === "APPROVED" ? "ลงทะเบียนสำเร็จ · พร้อมเช็คชื่อ" : statusLabel[registrant.status];
  const HeroIcon = registrant.status === "APPROVED" ? CheckCircle2Icon : registrant.status === "WAITLISTED" || registrant.status === "PENDING" ? Clock3Icon : ShieldAlertIcon;
  const notice = "rounded-xl border bg-card p-4 text-sm";
  // LINE (spec 2.1): offered while the admin switch is on and the person is still registered, or already linked.
  const lineOn = flags.lineLogin && lineConfigured() && !registrant.anonymizedAt;
  const showLine = lineOn && (!!registrant.lineUserId || ["PENDING", "APPROVED", "WAITLISTED"].includes(registrant.status));
  const oaId = showLine ? await lineOaBasicId() : null;
  const addFriendHref = oaId ? `https://line.me/R/ti/p/${encodeURIComponent(oaId)}` : null;
  const lineUndelivered = registrant.notifications[0]?.status === "FAILED";
  // Chose LINE at registration (or on this page) but LINE Login did not finish: email still carries the news.
  const lineAwaiting = !registrant.lineUserId && registrant.notifyVia === "LINE";
  // Registered with LINE only: switching to email needs an address.
  const emailInput = registrant.email ? null : <Input name="email" type="email" required autoComplete="email" inputMode="email" maxLength={191} placeholder="อีเมลสำหรับรับ QR" aria-label="อีเมลสำหรับรับ QR" className="h-11 bg-card" />;

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-lg md:my-10 md:min-h-0 md:max-w-xl md:overflow-clip md:rounded-2xl md:border md:shadow-sm lg:max-w-2xl flex-col bg-background">
      <header className="flex flex-col gap-2 bg-sidebar px-5 py-5 text-sidebar-foreground"><Link href={`/events/${slug}`} className="-my-3 w-fit py-3 text-xs text-sidebar-foreground/70 hover:underline">← กลับไปหน้าโครงการ</Link><p className="text-xs text-sidebar-foreground/70">เช็คสถานะการลงทะเบียน</p><h1 className="font-heading text-lg font-bold leading-snug">{registrant.event.title}</h1></header>
      <div className="flex flex-col gap-4 px-5 py-6">
        {updated === "1" && <p role="status" className={notice}>บันทึกการแก้ไขข้อมูลแล้ว</p>}
        {updated === "0" && <p role="status" className={notice}>ไม่มีข้อมูลที่เปลี่ยนแปลง</p>}
        {daysChanged === "1" && <p role="status" className={notice}>บันทึกการเปลี่ยนวันแล้ว · ดูสถานะของแต่ละวันด้านล่าง</p>}
        {error === "disabled" && <p role="alert" className={notice}>ผู้ดูแลระบบปิดฟังก์ชันนี้ไว้ชั่วคราว หากต้องการเปลี่ยนแปลงการลงทะเบียนกรุณาติดต่อผู้จัด</p>}
        {cancelled && <p role="status" className={notice}>ยกเลิกวันที่เลือกแล้ว หากมีคิวสำรองระบบจะเลื่อนคนถัดไปตามลำดับ</p>}

        {qrDataUrl ? (
          <section aria-labelledby="ticket-title" className="flex flex-col gap-4 rounded-2xl bg-primary px-4 pt-5 pb-4 text-primary-foreground">
            <p className="flex items-center justify-center gap-2 font-heading font-bold"><CheckCircle2Icon className="size-6" aria-hidden="true" />{heroText}</p>
            <div className="flex flex-col gap-4 rounded-2xl bg-card px-5 py-5 text-card-foreground">
              <div className="flex flex-col gap-1">
                <p className="text-xs text-muted-foreground">บัตรเข้าร่วมอบรม</p>
                <h2 id="ticket-title" className="font-heading text-lg font-bold leading-snug">{registrant.event.title}</h2>
                {registrant.event.location && <p className="text-sm text-muted-foreground">{registrant.event.location}</p>}
              </div>
              <div aria-hidden="true" className="relative"><span className="absolute top-1/2 -left-[30px] size-5 -translate-y-1/2 rounded-full bg-primary" /><div className="border-t-2 border-dashed" /><span className="absolute top-1/2 -right-[30px] size-5 -translate-y-1/2 rounded-full bg-primary" /></div>
              <div className="flex flex-col items-center gap-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={qrDataUrl} width={208} height={208} alt="QR สำหรับเช็คชื่อ" className="size-52" />
                <p className="break-all text-center font-mono text-sm font-bold tracking-wide">{registrant.qrCode}</p>
                <p className="text-center text-xs text-muted-foreground">รหัสสุ่ม ใช้ QR นี้เช็คชื่อได้ทุกรอบของวันที่คุณเลือก</p>
              </div>
              <div className="flex items-start justify-between gap-4 border-t pt-3 text-sm">
                <div className="flex min-w-0 flex-col"><span className="text-xs text-muted-foreground">ผู้เข้าร่วม</span><strong className="break-words">{displayName}</strong></div>
                <div className="flex min-w-0 flex-col text-right"><span className="text-xs text-muted-foreground">วันที่</span><strong>{approvedDays.map((day) => `${shortDateFormatter.format(day.eventDay.date)} (วันที่ ${dayNumber.get(day.eventDayId) ?? "?"})`).join(", ") || "—"}</strong></div>
              </div>
            </div>
            <p className="text-center text-xs">ใช้ QR เดียวกันเช็คชื่อได้ในวันที่อนุมัติแล้ว</p>
            <Button asChild className="h-12 w-full bg-foreground text-base font-bold text-background hover:bg-foreground/90"><a href={qrDataUrl} download="eventpass-qr.png"><DownloadIcon aria-hidden="true" />บันทึก QR ลงเครื่อง</a></Button>
            {flags.calendarDownload && <Button asChild variant="outline" className="h-11 w-full border-primary-foreground/50 bg-transparent text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground"><a href={withBasePath(`/events/${slug}/status/${token}/calendar`)}><CalendarPlusIcon aria-hidden="true" />ดาวน์โหลดวันที่เข้าอบรม (.ics)</a></Button>}
          </section>
        ) : (
          <div className="flex flex-col items-center gap-3 py-2 text-center">
            <span className={cn("flex size-20 items-center justify-center rounded-full", registrant.status === "WAITLISTED" ? "bg-[var(--status-warning-background)] text-[var(--status-warning)]" : registrant.status === "PENDING" || registrant.status === "APPROVED" ? "bg-accent text-primary" : "bg-muted text-muted-foreground")}><HeroIcon className="size-10" aria-hidden="true" /></span>
            <h2 className="font-heading text-2xl font-bold">{heroText}</h2>
            {registrant.status === "WAITLISTED" && <p className="text-sm leading-relaxed text-muted-foreground">{registrant.event.seatMode === "whole_course" ? "ที่นั่งทั้งหลักสูตรเต็ม ระบบจัดคุณไว้ในคิวสำรองของโครงการ" : "วันที่เลือกมีที่นั่งเต็ม ระบบจัดคุณไว้ในคิวสำรอง หากมีคนยกเลิกจะเลื่อนคิวตามลำดับ"}</p>}
            {registrant.status === "PENDING" && <p className="text-sm leading-relaxed text-muted-foreground">ผู้จัดจะตรวจใบสมัครก่อน เมื่ออนุมัติแล้ว QR จะปรากฏที่หน้านี้</p>}
            {registrant.status === "REJECTED" && registrant.rejectReason && <p className="w-full rounded-xl border bg-card p-4 text-sm text-muted-foreground">เหตุผลจากผู้จัด: {registrant.rejectReason}</p>}
          </div>
        )}

        {registrant.status === "WAITLISTED" && queuePosition !== null && (
          <section aria-label="ลำดับคิว" className="flex flex-col gap-3 rounded-2xl border bg-card p-5">
            <div className="flex items-center justify-between gap-3"><span className="text-sm text-muted-foreground">ลำดับคิวของคุณ</span><strong className="font-heading text-4xl font-bold text-[var(--status-warning)]">#{queuePosition}</strong></div>
            {registrant.event.seatMode !== "whole_course" && <p className="border-t pt-3 text-xs text-muted-foreground">คิวของ {waitlistedDays.map((day) => `วันที่ ${dayNumber.get(day.eventDayId) ?? "?"} (${shortDateFormatter.format(day.eventDay.date)}) #${queuePositions.get(day.id)}`).join(", ")}{waitlistedDays.length > 1 ? " · แสดงลำดับที่ใกล้ที่สุด" : ""}</p>}
          </section>
        )}

        <section aria-labelledby="registrant-title" className="flex flex-col gap-4 rounded-2xl border bg-card p-5">
          <div className="flex items-start justify-between gap-3"><div className="flex min-w-0 flex-col gap-0.5"><h3 id="registrant-title" className="font-heading text-lg font-semibold break-words">{displayName}</h3>{registrant.email && registrant.email !== displayName && <p className="text-sm break-all text-muted-foreground">{registrant.email}</p>}</div><StatusChip status={registrant.status} queue={queuePosition ?? undefined} /></div>
          {registrant.event.location && !qrDataUrl && <p className="text-sm"><span className="text-muted-foreground">สถานที่</span><br />{registrant.event.location}</p>}
          <ul className="flex flex-col gap-2.5">{registrant.days.map((day) => <li key={day.id} className="flex items-center justify-between gap-3 text-sm"><span className={cn(["CANCELLED", "REJECTED"].includes(day.status) && "text-muted-foreground")}>{dayLabel(day)}</span><StatusChip status={day.status} queue={queuePositions.get(day.id)} /></li>)}</ul>
          {(showEdit || showDayChange) && <div className="flex flex-wrap gap-2 border-t pt-4">
            {showEdit && <Button asChild variant="outline" className="h-11 min-w-fit flex-1"><Link href={`/events/${slug}/status/${token}/edit`}><PencilIcon aria-hidden="true" />แก้ไขข้อมูลของฉัน</Link></Button>}
            {showDayChange && <Button asChild variant="outline" className="h-11 min-w-fit flex-1"><Link href={`/events/${slug}/status/${token}/days`}><CalendarDaysIcon aria-hidden="true" />เปลี่ยนวันที่เข้าร่วม</Link></Button>}
          </div>}
        </section>
        <p className="text-center text-xs leading-relaxed text-muted-foreground">เก็บลิงก์หน้านี้ไว้เพื่อตรวจสถานะหรือดู QR อีกครั้ง อย่าแชร์ลิงก์กับผู้อื่น</p>

        {showLine && <section id="line" aria-labelledby="line-title" className="flex scroll-mt-4 flex-col gap-3 rounded-2xl border bg-card p-5">
          <div className="flex items-center gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-[#06C755] text-white"><MessageCircleIcon className="size-5" aria-hidden="true" /></span>
            <div className="flex min-w-0 flex-col"><h3 id="line-title" className="font-heading text-lg font-semibold">ช่องทางรับ QR และผล</h3><p className="text-xs text-muted-foreground">{registrant.lineUserId ? "LINE · เชื่อมแล้ว — ผลอนุมัติ การเลื่อนคิว และลิงก์ QR ส่งไปที่ LINE ของคุณ" : lineAwaiting ? (registrant.email ? "เลือก LINE ไว้ แต่ยังเชื่อมไม่สำเร็จ — ระหว่างนี้ระบบส่งทางอีเมล" : "เลือก LINE ไว้ แต่ยังเชื่อมไม่สำเร็จ — ระบบยังส่งผลหาคุณไม่ได้ เชื่อม LINE หรือเปลี่ยนเป็นอีเมล และบันทึกลิงก์หน้านี้ไว้") : `อีเมล${registrant.email ? ` · ${registrant.email}` : ""}`}</p></div>
          </div>
          {typeof line === "string" && lineMessages[line] && (line !== "start" || lineAwaiting) && <p role={line === "linked" || line === "unlinked" || line === "start" ? "status" : "alert"} className={cn("rounded-lg px-3 py-2 text-sm", line === "linked" || line === "unlinked" || line === "start" ? "bg-accent text-accent-foreground" : "bg-[var(--status-warning-background)] text-[var(--status-warning)]")}>{lineMessages[line]}</p>}
          {registrant.lineUserId && lineUndelivered && <p role="alert" className="rounded-lg bg-[var(--status-warning-background)] px-3 py-2 text-sm text-[var(--status-warning)]">ส่งข้อความล่าสุดไม่ถึง — ตรวจว่ายังเป็นเพื่อนกับ OA และไม่ได้บล็อกไว้ ข้อมูลล่าสุดดูได้ที่หน้านี้เสมอ</p>}
          {(line === "not-friend" || (registrant.lineUserId && lineUndelivered)) && addFriendHref && <Button asChild variant="outline" className="h-11"><a href={addFriendHref} target="_blank" rel="noopener noreferrer">เพิ่ม {oaId} เป็นเพื่อนใน LINE</a></Button>}
          {registrant.lineUserId
            ? <form action={unlinkLineAction.bind(null, slug, token)} className="flex flex-col gap-2">{emailInput}<Button type="submit" variant="outline" className="h-11 w-full">เปลี่ยนเป็นรับทางอีเมล</Button></form>
            : <>
              <form action={startLineLinkAction.bind(null, slug, token)} className="flex flex-col gap-2">
                <p className="text-sm leading-relaxed text-muted-foreground">กดแล้วจะไปหน้า LINE ให้เข้าสู่ระบบและ<strong className="text-foreground">เพิ่ม {oaId ?? "OA ของระบบ"} เป็นเพื่อน</strong> — ระบบส่งข้อความได้เฉพาะเพื่อนของ OA และไม่เห็นแชตหรือรายชื่อเพื่อนของคุณ</p>
                <Button type="submit" className="h-12 bg-[#06C755] text-base font-bold text-white hover:bg-[#05b34c]">{line === "start" && lineAwaiting ? "เชื่อม LINE" : lineAwaiting ? "เชื่อม LINE อีกครั้ง" : "เปลี่ยนเป็นรับทาง LINE"}</Button>
              </form>
              {lineAwaiting && <form action={unlinkLineAction.bind(null, slug, token)} className="flex flex-col gap-2 border-t pt-3">{emailInput}<Button type="submit" variant="outline" className="h-11 w-full">ใช้อีเมลแทน</Button></form>}
            </>}
        </section>}

        {flags.selfCancel && registrant.event.seatMode !== "whole_course" && activeDays.length > 1 && <section className="flex flex-col gap-3 rounded-2xl border bg-card p-5">
          <h3 className="font-heading text-lg font-semibold">ยกเลิกเฉพาะบางวัน</h3>
          {activeDays.map((day) => <form key={day.id} action={cancel} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t pt-3">
            <span className="text-sm">{dayLabel(day)}</span>
            <input type="hidden" name="dayId" value={day.eventDayId} />
            <span className="flex items-center gap-3"><label className="flex min-h-9 items-center gap-1.5 text-xs"><input type="checkbox" name="confirm" className="size-4 accent-primary" required />ยืนยัน</label><Button type="submit" variant="outline" size="sm">ยกเลิกวันนี้</Button></span>
          </form>)}
        </section>}
        {flags.selfCancel && ["PENDING", "APPROVED", "WAITLISTED"].includes(registrant.status) && (
          <form action={cancel} className="flex flex-col gap-3 rounded-2xl border border-destructive/30 bg-card p-5">
            <div className="flex flex-col gap-1"><h3 className="font-heading text-lg font-semibold text-destructive">มาไม่ได้?</h3><p className="text-sm leading-relaxed text-muted-foreground">กดยกเลิกการเข้าร่วมเพื่อคืนที่นั่งให้คนที่รออยู่ในคิว — ยกเลิกแล้ว QR เดิมจะใช้เช็คชื่อไม่ได้อีก</p></div>
            <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" name="confirm" className="size-5 accent-destructive" required />ยืนยันว่าต้องการยกเลิกการเข้าร่วม</label>
            {(error === "confirm" || error === "checked-in" || error === "retry") && <p role="alert" className="text-sm text-destructive">{error === "checked-in" ? "เช็คชื่อแล้ว ไม่สามารถยกเลิกด้วยตนเองได้" : error === "retry" ? "ระบบกำลังทำรายการอื่น กรุณาลองใหม่" : "กรุณายืนยันก่อนยกเลิก"}</p>}
            <Button type="submit" variant="outline" className="h-11 border-destructive/40 text-base font-semibold text-destructive hover:bg-destructive/10 hover:text-destructive">ยกเลิกการเข้าร่วม</Button>
          </form>
        )}

        {flags.dataDeletionRequest && !registrant.anonymizedAt && <section id="delete-request" aria-labelledby="delete-request-title" className="flex scroll-mt-4 flex-col gap-3 rounded-2xl border bg-card p-5">
          <h3 id="delete-request-title" className="font-heading text-lg font-semibold">ขอลบข้อมูลของฉัน</h3>
          {lastRequest?.status === "OPEN" ? <p role="status" className="text-sm leading-relaxed">{deletion === "requested" ? "ส่งคำขอแล้ว" : `ส่งคำขอแล้วเมื่อ ${shortDateFormatter.format(lastRequest.requestedAt)}`} — ผู้จัดจะดำเนินการและบันทึกหลักฐานไว้ เมื่อลบแล้วลิงก์หน้านี้และ QR จะใช้ไม่ได้อีก</p> : <>
            {lastRequest?.status === "REJECTED" && <p className="rounded-lg bg-muted p-3 text-sm leading-relaxed">ผู้จัดยังต้องเก็บข้อมูลไว้: {lastRequest.resolutionNote} · ส่งคำขอใหม่ได้หากยังต้องการ</p>}
            <p className="text-sm leading-relaxed text-muted-foreground">ตามสิทธิ์เจ้าของข้อมูลส่วนบุคคล (PDPA) — เมื่อผู้จัดดำเนินการ ระบบจะยกเลิกการลงทะเบียนที่ยังไม่ถึงวัน ลบคำตอบ อีเมล และไฟล์แนบ เหลือเฉพาะสถิติที่ไม่ระบุตัวตน ลิงก์หน้านี้และ QR จะใช้ไม่ได้อีก</p>
            <form action={requestDeletion} className="flex flex-col gap-3">
              <label htmlFor="delete-reason" className="text-sm font-medium">เหตุผล (ไม่บังคับ)</label>
              <textarea id="delete-reason" name="reason" maxLength={500} rows={2} className="rounded-md border bg-background px-3 py-2 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring md:text-sm" />
              <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" name="confirm" className="size-5 accent-primary" required />เข้าใจแล้วว่าข้อมูลจะถูกลบและใช้เช็คชื่อไม่ได้อีก</label>
              {error === "delete-confirm" && <p role="alert" className="text-sm text-destructive">กรุณายืนยันก่อนส่งคำขอ</p>}
              <Button type="submit" variant="outline" className="h-11">ส่งคำขอลบข้อมูล</Button>
            </form>
          </>}
        </section>}
      </div>
    </main>
  );
}
