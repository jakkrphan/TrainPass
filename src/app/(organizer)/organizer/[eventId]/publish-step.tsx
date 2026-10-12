import Link from "next/link";
import { CheckIcon, CircleAlertIcon, DownloadIcon, EyeOffIcon, PrinterIcon, XIcon } from "lucide-react";

import { cloneEvent } from "@/app/(organizer)/organizer/actions";
import { deleteOwnedEvent } from "@/app/(organizer)/organizer/[eventId]/delete-action";
import { addEventMember, removeEventMember, searchMemberCandidates } from "@/app/(organizer)/organizer/[eventId]/member-actions";
import { MemberPicker } from "@/app/(organizer)/organizer/[eventId]/member-picker";
import { changeEventStatus } from "@/app/(organizer)/organizer/[eventId]/status-actions";
import { AutoSubmitSelect } from "@/components/auto-submit-select";
import { CopyButton } from "@/components/copy-button";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { registrationQrSvg, shortEventUrl } from "@/server/events/public-url";
import { withBasePath } from "@/lib/base-path";

export type PublishCheck = { label: string; detail?: string; ready: boolean; step?: number };
type Member = { id: string; userId: string; role: "FULL" | "CHECKIN_ONLY"; user: { name: string; email: string } };

const roleDescription = { FULL: "แก้ฟอร์ม · อนุมัติ · แดชบอร์ด · export · เช็คชื่อ", CHECKIN_ONLY: "เข้าได้แค่หน้าเช็คชื่อ" } as const;
const statusChip = { DRAFT: ["ฉบับร่าง", "bg-amber-100 text-amber-900"], PUBLISHED: ["เผยแพร่แล้ว", "bg-accent text-accent-foreground"], CLOSED: ["ปิดรับแล้ว", "bg-muted text-muted-foreground"] } as const;
const initials = (name: string) => name.trim().split(/\s+/).map((part) => part[0]).join("").slice(0, 2) || "?";

function Avatar({ name }: { name: string }) {
  return <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-bold">{initials(name)}</span>;
}

/** Step 5: collaborators (owner-managed) and the publish checklist, laid out as in mockup B. */
export async function PublishStep({ event, owner, members, checks, canAdminister, canClone, error, saved }: {
  event: { id: string; slug: string; status: "DRAFT" | "PUBLISHED" | "CLOSED" };
  owner: { name: string; email: string };
  members: Member[];
  checks: PublishCheck[];
  canClone: boolean;
  canAdminister: boolean;
  error?: string;
  saved?: string;
}) {
  const publicUrl = await shortEventUrl(event.slug);
  const qrSvg = await registrationQrSvg(publicUrl);
  const missing = checks.filter((check) => !check.ready);
  const [statusText, statusClass] = statusChip[event.status];

  return <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(340px,0.85fr)]">
    <section aria-label="ผู้ร่วมจัด" className="flex flex-col gap-4 rounded-xl border bg-card p-5">
      {canAdminister ? <MemberPicker action={addEventMember.bind(null, event.id)} search={searchMemberCandidates.bind(null, event.id)} />
        : <p className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">เฉพาะเจ้าของโครงการเพิ่ม/ลบผู้ร่วมจัดได้</p>}
      {(error === "invalid-member" || error === "member-not-found") && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">เพิ่มคนนี้ไม่ได้ — ไม่พบบัญชีที่ใช้งานได้ หรือบัญชี AD ถูกปิด / อยู่นอกหน่วยงานที่อนุญาต (หรือเป็นเจ้าของโครงการอยู่แล้ว)</p>}
      {error === "directory-unavailable" && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">เชื่อมต่อ AD ไม่ได้ขณะนี้ จึงสร้างบัญชีให้คนที่ยังไม่มีบัญชีไม่ได้ — ลองใหม่อีกครั้ง</p>}
      {saved === "member" && <p role="status" className="rounded-lg border border-primary/30 bg-accent px-3 py-2 text-sm text-accent-foreground">บันทึกผู้ร่วมจัดแล้ว</p>}
      <ul className="flex flex-col divide-y border-t">
        <li className="flex items-center gap-3 py-3.5">
          <Avatar name={owner.name} />
          <span className="flex min-w-0 flex-1 flex-col"><span className="truncate font-semibold">{owner.name}</span><span className="truncate text-xs text-muted-foreground">{owner.email} · สร้างโครงการนี้</span></span>
          <span className="rounded-md bg-accent px-2 py-0.5 text-xs font-semibold text-accent-foreground">เจ้าของ</span>
        </li>
        {members.map((member) => <li key={member.id} className="flex flex-wrap items-center gap-3 py-3.5">
          <Avatar name={member.user.name} />
          <span className="flex min-w-0 flex-1 flex-col"><span className="truncate font-semibold">{member.user.name}</span><span className="text-xs text-muted-foreground"><span className="break-all">{member.user.email}</span> · {roleDescription[member.role]}</span></span>
          {canAdminister ? <>
            <form action={addEventMember.bind(null, event.id)}>
              <input type="hidden" name="email" value={member.user.email} />
              <label htmlFor={`member-role-${member.id}`} className="sr-only">สิทธิ์ของ {member.user.name}</label>
              <AutoSubmitSelect key={member.role} id={`member-role-${member.id}`} name="role" defaultValue={member.role} className="h-10 rounded-md border bg-background px-2.5 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring md:text-sm"><option value="FULL">เต็มสิทธิ์</option><option value="CHECKIN_ONLY">เช็คชื่ออย่างเดียว</option></AutoSubmitSelect>
            </form>
            <form action={removeEventMember.bind(null, event.id, member.userId)}><Button type="submit" variant="outline" size="icon-lg" aria-label={`นำ ${member.user.name} ออกจากโครงการ`} className="text-destructive hover:bg-destructive/10 hover:text-destructive"><XIcon aria-hidden="true" /></Button></form>
          </> : <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-semibold">{member.role === "FULL" ? "เต็มสิทธิ์" : "เช็คชื่ออย่างเดียว"}</span>}
        </li>)}
      </ul>
      {members.length === 0 && <p className="text-sm text-muted-foreground">ยังไม่มีผู้ร่วมจัด ค้นหาจากชื่อ-สกุลเพื่อเพิ่ม</p>}
      <p className="flex items-start gap-2 rounded-lg bg-muted px-4 py-3 text-xs leading-relaxed text-muted-foreground"><EyeOffIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />“เช็คชื่ออย่างเดียว” จะไม่เห็นคำตอบฟอร์ม ข้อมูลส่วนตัว แดชบอร์ด หรือ export — ระบบปฏิเสธทุกหน้า นอกเหนือจากหน้าเช็คชื่อ</p>
    </section>

    <div className="flex flex-col gap-4">
      <section aria-label="เผยแพร่โครงการ" className="flex flex-col gap-4 rounded-xl border bg-card p-5">
        <div className="flex items-center justify-between gap-2"><h2 className="font-heading text-lg font-bold">เผยแพร่โครงการ</h2><span className={cn("rounded-md px-2 py-0.5 text-xs font-semibold", statusClass)}>{statusText}</span></div>
        <ul className="flex flex-col gap-2.5" aria-label="รายการตรวจสอบก่อนเผยแพร่">{checks.map((check) => <li key={check.label} className="flex items-start gap-2.5">
          <span aria-hidden="true" className={cn("mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full", check.ready ? "bg-accent text-primary" : "bg-amber-100 text-amber-800")}>{check.ready ? <CheckIcon className="size-3.5" /> : <CircleAlertIcon className="size-3.5" />}</span>
          <span className="flex flex-col"><span className={cn("text-sm", !check.ready && "font-semibold")}>{check.label}<span className="sr-only">{check.ready ? " พร้อม" : " ยังไม่พร้อม"}</span></span>{check.detail && <span className="text-xs text-muted-foreground">{check.detail}</span>}</span>
          {!check.ready && check.step && <Link href={`/organizer/${event.id}?step=${check.step}`} className="ml-auto shrink-0 text-xs font-semibold text-primary underline-offset-4 hover:underline">ไปแก้</Link>}
        </li>)}</ul>
        <div className="flex flex-col gap-2 rounded-lg bg-muted px-3 py-2.5">
          <span className="text-xs text-muted-foreground">ลิงก์ลงทะเบียน{event.status === "PUBLISHED" ? "" : " (ใช้ได้เมื่อเผยแพร่)"}</span>
          <div className="flex items-center gap-2"><code className="min-w-0 flex-1 truncate font-mono text-sm">{publicUrl.replace(/^https?:\/\//, "")}</code><CopyButton value={publicUrl} /></div>
        </div>
        <div className="flex items-center gap-4 rounded-lg border px-3 py-3">
          <div role="img" aria-label="QR code ลิงก์ลงทะเบียน" className="size-24 shrink-0 [&>svg]:size-full" dangerouslySetInnerHTML={{ __html: qrSvg }} />
          <div className="flex min-w-0 flex-col gap-2">
            <span className="text-sm font-semibold">QR ลงทะเบียน</span>
            <span className="text-xs text-muted-foreground">พิมพ์เป็นโปสเตอร์ A4 ติดหน้างาน หรือดาวน์โหลดไปใส่สไลด์/โพสต์</span>
            <div className="flex flex-wrap gap-2">
              <Button asChild size="sm"><Link href={`/organizer/${event.id}/poster`}><PrinterIcon data-icon="inline-start" aria-hidden="true" />พิมพ์ QR</Link></Button>
              <Button asChild variant="outline" size="sm"><a href={withBasePath(`/organizer/${event.id}/qr`)} download><DownloadIcon data-icon="inline-start" aria-hidden="true" />PNG</a></Button>
            </div>
          </div>
        </div>
        {error === "not-ready" && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">ยังเผยแพร่ไม่ได้ กรุณาแก้รายการที่ยังไม่พร้อมก่อน</p>}
        {saved === "status" && <p role="status" className="rounded-lg border border-primary/30 bg-accent px-3 py-2 text-sm text-accent-foreground">เปลี่ยนสถานะโครงการแล้ว</p>}
        {!canAdminister ? <p className="text-sm text-muted-foreground">เฉพาะเจ้าของโครงการกดเผยแพร่/ปิดรับได้</p>
          : event.status === "PUBLISHED" ? <div className="flex flex-col gap-2">
            <Button asChild size="lg" className="h-12"><a href={withBasePath(`/events/${event.slug}`)} target="_blank" rel="noreferrer">เปิดหน้าลงทะเบียน</a></Button>
            <form action={changeEventStatus.bind(null, event.id, "CLOSED")}><Button type="submit" variant="outline" className="w-full">ปิดรับลงทะเบียน</Button></form>
          </div>
          : <form action={changeEventStatus.bind(null, event.id, "PUBLISHED")} className="flex flex-col gap-2">
            <Button type="submit" size="lg" className="h-12 text-base" disabled={missing.length > 0}><CheckIcon data-icon="inline-start" aria-hidden="true" />{event.status === "CLOSED" ? "เปิดรับอีกครั้ง" : "เผยแพร่ตอนนี้"}</Button>
            {missing.length > 0 && <span className="text-center text-xs text-muted-foreground">ยังขาด {missing.length} รายการ</span>}
          </form>}
        <p className="text-xs leading-relaxed text-muted-foreground">ปิดรับเองได้ทุกเมื่อ (closed) แม้ยังไม่ถึงวันปิดรับ เช่น ที่นั่งเต็มก่อนกำหนด</p>
      </section>

      <section aria-label="การจัดการอื่น" className="flex flex-col gap-3 rounded-xl border bg-card p-5">
        <h3 className="font-heading font-bold">การจัดการอื่น</h3>
        <div className="flex flex-wrap gap-2">
          {canClone && <form action={cloneEvent.bind(null, event.id)}><Button type="submit" variant="outline" size="sm">ทำสำเนาโครงการ</Button></form>}
          {event.status !== "DRAFT" && <>
            <Button asChild variant="outline" size="sm"><Link href={`/organizer/${event.id}/registrants`}>ผู้ลงทะเบียน</Link></Button>
            <Button asChild variant="outline" size="sm"><Link href={`/organizer/${event.id}/dashboard`}>แดชบอร์ด</Link></Button>
            <Button asChild variant="outline" size="sm"><Link href={`/check-in/${event.id}`}>เช็คชื่อหน้างาน</Link></Button>
          </>}
        </div>
        {canAdminister && <details className="rounded-lg border border-destructive/30 px-3 py-2">
          <summary className="-my-2 cursor-pointer py-2 text-sm font-semibold text-destructive">ลบโครงการ…</summary>
          <form action={deleteOwnedEvent.bind(null, event.id)} className="mt-3 flex flex-col gap-2">
            <p className="text-xs text-muted-foreground">ถ้ามีผู้ลงทะเบียนแล้ว ระบบจะเก็บข้อมูลเดิมไว้ตรวจสอบย้อนหลัง และปิดหน้าโครงการจากผู้ใช้งาน</p>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="confirm" required className="size-4 accent-destructive" />ยืนยันลบโครงการนี้</label>
            <Button type="submit" variant="destructive" size="sm" className="w-fit">ลบโครงการ</Button>
          </form>
          {error === "confirm-delete" && <p role="alert" className="mt-2 text-sm text-destructive">กรุณายืนยันก่อนลบ</p>}
        </details>}
      </section>
    </div>
  </div>;
}
