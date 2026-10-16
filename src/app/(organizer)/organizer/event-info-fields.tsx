import { CoverPicker } from "@/app/(organizer)/organizer/cover-picker";
import { SeatModeFields } from "@/app/(organizer)/organizer/seat-mode-fields";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";

const eventTypes = [
  ["INTERNAL", "ภายใน", "บุคลากร / นักศึกษาในหน่วยงาน"],
  ["EXTERNAL", "ภายนอก", "เปิดรับบุคคลทั่วไป"],
  ["MIXED", "ผสม", "รับทั้งภายในและภายนอก"],
] as const;

export type EventInfoDefaults = {
  title: string; description: string | null; location: string | null; eventType: "INTERNAL" | "EXTERNAL" | "MIXED";
  seatMode: string; maxSeats: number | null; attendanceThreshold: number | null; autoApprove: boolean; waitlistEnabled: boolean;
  pendingHoldHours: number | null; waitlistPromotion: "MANUAL" | "AUTO"; retentionDays: number;
  coverImageUrl: string | null; anonymizedAt: Date | null;
};

/** Step 1 fields shared by "create project" and project settings, laid out as mockup B (organizer-create-1-info). */
export function EventInfoFields({ event, deadlineDate = "", seatModeLocked = false, registrantCount = 0, showRetention = !!event, errors = {} }: {
  event?: EventInfoDefaults;
  deadlineDate?: string;
  seatModeLocked?: boolean;
  registrantCount?: number;
  /** Off for the new-project form, which refills `event` from a refused submit but has no retention setting yet. */
  showRetention?: boolean;
  /** Messages shown under the matching inputs, keyed by input name. */
  errors?: Partial<Record<string, string>>;
}) {
  const invalid = (name: string) => errors[name] ? { "aria-invalid": true, "aria-describedby": `${name}-error` } : {};
  const error = (name: string) => errors[name] && <FieldError id={`${name}-error`}>{errors[name]}</FieldError>;
  return <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-7 xl:grid-cols-[minmax(0,1.45fr)_minmax(300px,1fr)]">
    <div className="flex flex-col gap-6">
      <Field><FieldLabel htmlFor="title">ชื่อโครงการ <span className="text-destructive">*</span></FieldLabel><Input id="title" name="title" defaultValue={event?.title} maxLength={191} required placeholder="เช่น อบรมการใช้งานระบบสำหรับบุคลากรใหม่" className="h-11 bg-card" {...invalid("title")} />{error("title")}</Field>
      <Field><FieldLabel htmlFor="description">รายละเอียด</FieldLabel><Textarea id="description" name="description" defaultValue={event?.description ?? ""} maxLength={10000} rows={4} placeholder="อธิบายเนื้อหาและวัตถุประสงค์ของโครงการ" className="bg-card" {...invalid("description")} />{error("description")}</Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field><FieldLabel htmlFor="location">สถานที่</FieldLabel><Input id="location" name="location" defaultValue={event?.location ?? ""} maxLength={191} placeholder="เช่น ห้องประชุมชั้น 5" className="h-11 bg-card" {...invalid("location")} />{error("location")}</Field>
        <Field><FieldLabel htmlFor="deadlineDate">วันปิดรับลงทะเบียน <span className="text-destructive">*</span></FieldLabel><Input id="deadlineDate" name="deadlineDate" type="date" defaultValue={deadlineDate} className="h-11 bg-card" {...invalid("deadlineDate")} />{error("deadlineDate") || <FieldDescription>ปิดรับ 23:59 น. ของวันที่เลือก · หลังเวลานี้ฟอร์มปิดรับอัตโนมัติ</FieldDescription>}</Field>
      </div>
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 text-sm font-semibold">ประเภทโครงการ <span className="text-destructive">*</span></legend>
        <div className="grid gap-3 sm:grid-cols-3">
          {eventTypes.map(([value, label, description]) => <label key={value} className="flex cursor-pointer flex-col gap-1.5 rounded-lg border bg-card p-4 has-checked:border-2 has-checked:border-primary has-checked:bg-accent">
            <span className="flex items-center gap-2.5 font-semibold"><input type="radio" name="eventType" value={value} defaultChecked={(event?.eventType ?? "INTERNAL") === value} className="size-4 accent-primary" />{label}</span>
            <span className="text-xs leading-relaxed text-muted-foreground">{description}</span>
          </label>)}
        </div>
        {registrantCount > 0 && <p className="text-xs text-muted-foreground">มีผู้ลงทะเบียนแล้ว {registrantCount.toLocaleString("th-TH")} คน การเปลี่ยนประเภทโครงการไม่กระทบผู้ที่ลงทะเบียนไปแล้ว</p>}
      </fieldset>
      <SeatModeFields initialMode={event?.seatMode} attendanceThreshold={event?.attendanceThreshold} locked={seatModeLocked} thresholdError={errors.attendanceThreshold} />
    </div>

    <div className="flex flex-col gap-4">
      <section aria-labelledby="cover-heading" className="flex flex-col gap-4 rounded-xl border bg-card p-5">
        <div className="flex items-center justify-between gap-3"><h3 id="cover-heading" className="font-heading text-lg font-bold">รูปปกโครงการ</h3><span className="text-xs text-muted-foreground">ไม่บังคับ</span></div>
        <CoverPicker currentUrl={event?.coverImageUrl} />
        <p className="text-xs leading-relaxed text-muted-foreground">jpg / png / webp · ไม่เกิน 3 MB · แสดงบนหน้าลงทะเบียนเมื่อเผยแพร่แล้ว</p>
      </section>

      <section aria-labelledby="approval-heading" className="flex flex-col gap-4 rounded-xl border bg-card p-5">
        <h3 id="approval-heading" className="font-heading text-lg font-bold">การอนุมัติผู้ลงทะเบียน</h3>
        <label className="flex cursor-pointer items-start justify-between gap-4">
          <span className="flex flex-col gap-1"><span className="font-semibold">อนุมัติอัตโนมัติ</span><span className="text-sm text-muted-foreground">เปิด = ได้ QR ทันทีที่สมัคร · ปิด = ผู้จัดตรวจและกดอนุมัติเองทีละคน</span></span>
          <input type="checkbox" role="switch" name="autoApprove" defaultChecked={event?.autoApprove ?? false} className="relative mt-1 h-7 w-12 shrink-0 cursor-pointer appearance-none rounded-full bg-input transition-colors before:absolute before:left-1 before:top-1 before:size-5 before:rounded-full before:bg-card before:shadow before:transition-transform checked:bg-primary checked:before:translate-x-5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" />
        </label>
        <label className="flex cursor-pointer items-start justify-between gap-4 border-t pt-3">
          <span className="flex flex-col gap-1"><span className="font-semibold">เปิดรับรอคิว (waitlist)</span><span className="text-sm text-muted-foreground">เปิด = ที่นั่งเต็มแล้วยังสมัครได้ ใบสมัครเข้าสถานะรอคิว · ปิด = ที่นั่งเต็มแล้วไม่รับสมัครเพิ่ม</span></span>
          <input type="checkbox" role="switch" name="waitlistEnabled" defaultChecked={event?.waitlistEnabled ?? false} className="relative mt-1 h-7 w-12 shrink-0 cursor-pointer appearance-none rounded-full bg-input transition-colors before:absolute before:left-1 before:top-1 before:size-5 before:rounded-full before:bg-card before:shadow before:transition-transform checked:bg-primary checked:before:translate-x-5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" />
        </label>
        <p className="border-t pt-3 text-xs leading-relaxed text-muted-foreground">ที่นั่งเต็มนับ ณ ตอนสมัคร (รายวันที่เลือก หรือที่นั่งรวมของหลักสูตร แล้วแต่โหมดการนับที่นั่ง) · ปิดรอคิวภายหลังได้: คนที่อยู่ในคิวแล้วยังอยู่ต่อและเลื่อนขึ้นได้ตามปกติ · เปลี่ยนโหมดอนุมัติภายหลังไม่มีผลย้อนหลัง</p>
        <Field><FieldLabel htmlFor="pendingHoldHours">เวลาจองที่นั่งระหว่างรออนุมัติ (ชั่วโมง)</FieldLabel><Input id="pendingHoldHours" name="pendingHoldHours" type="number" min={1} max={720} defaultValue={event?.pendingHoldHours ?? ""} placeholder="ไม่หมดอายุ" className="h-10" {...invalid("pendingHoldHours")} />{error("pendingHoldHours") || <FieldDescription>เว้นว่างถ้าไม่ต้องการให้หมดอายุ</FieldDescription>}</Field>
        <Field><FieldLabel htmlFor="waitlistPromotion">เมื่อมีที่นั่งว่าง</FieldLabel><NativeSelect id="waitlistPromotion" name="waitlistPromotion" defaultValue={event?.waitlistPromotion ?? "MANUAL"} className="h-10"><option value="MANUAL">ให้ผู้จัดเลือกคนจากคิวเอง</option><option value="AUTO">เลื่อนคิวอัตโนมัติตามลำดับ</option></NativeSelect></Field>
      </section>

      {event && showRetention && <section aria-labelledby="retention-heading" className="flex flex-col gap-3 rounded-xl border bg-card p-5">
        <h3 id="retention-heading" className="font-heading text-lg font-bold">การเก็บข้อมูลส่วนบุคคล</h3>
        <p className="text-sm leading-relaxed text-muted-foreground">{event.anonymizedAt
          ? "ข้อมูลส่วนบุคคลของโครงการนี้ถูกปกปิดไปแล้วตามกติกาเดิม เหลือเฉพาะสถานะและสถิติ"
          : "ข้อมูลที่ผู้ลงทะเบียนกรอกและไฟล์แนบเก็บไว้ถาวร ระบบไม่ลบอัตโนมัติ · ลบได้เฉพาะเมื่อผู้ลงทะเบียนยื่นคำขอลบข้อมูล และผู้จัดอนุมัติ"}</p>
      </section>}
    </div>
  </div>;
}
