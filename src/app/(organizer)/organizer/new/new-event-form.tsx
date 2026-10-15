"use client";

import { useActionState } from "react";
import Link from "next/link";
import { ChevronLeftIcon, LockKeyholeIcon } from "lucide-react";

import { createEvent, type CreateEventState, type CreateEventValues } from "@/app/(organizer)/organizer/actions";
import { EventInfoFields, type EventInfoDefaults } from "@/app/(organizer)/organizer/event-info-fields";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const steps = ["ข้อมูลโครงการ", "วันที่จัด & ที่นั่ง", "ฟอร์มลงทะเบียน", "รอบเช็คชื่อ", "ผู้ร่วมจัด & เผยแพร่"];

const optionalNumber = (value: string) => value === "" || Number.isNaN(Number(value)) ? null : Number(value);

/** The refused submit's values in the shape the shared step-1 fields take as defaults. */
function defaultsFrom(values: CreateEventValues): EventInfoDefaults {
  return {
    title: values.title, description: values.description, location: values.location,
    eventType: values.eventType as EventInfoDefaults["eventType"], seatMode: values.seatMode, maxSeats: null,
    attendanceThreshold: optionalNumber(values.attendanceThreshold), autoApprove: values.autoApprove, waitlistEnabled: values.waitlistEnabled,
    pendingHoldHours: optionalNumber(values.pendingHoldHours), waitlistPromotion: values.waitlistPromotion as EventInfoDefaults["waitlistPromotion"],
    retentionDays: 365, coverImageUrl: null, anonymizedAt: null,
  };
}

type FormState = CreateEventState & { attempt: number } | null;

export function NewEventForm() {
  // `attempt` remounts the fields after each refused submit, so they pick up the returned values
  // and the cover picker drops a preview whose file the browser has already cleared.
  const [state, action, pending] = useActionState(async (previous: FormState, formData: FormData): Promise<FormState> => {
    const result = await createEvent(previous, formData);
    return result && { ...result, attempt: (previous?.attempt ?? 0) + 1 };
  }, null);

  return (
    <form action={action} className="flex min-h-[calc(100svh-60px)] flex-1 flex-col lg:flex-row">
      <aside className="flex w-full shrink-0 flex-col gap-6 border-b bg-card px-5 py-6 lg:min-h-[calc(100svh-60px)] lg:w-[300px] lg:gap-6 lg:border-b-0 lg:border-r lg:px-8 lg:py-9">
        <div className="flex flex-col gap-1">
          <Link href="/organizer" className="-my-2.5 flex w-fit items-center gap-1 py-2.5 text-sm text-muted-foreground hover:text-foreground"><ChevronLeftIcon className="size-4" aria-hidden="true" />โครงการของฉัน</Link>
          <h2 className="font-heading text-xl font-bold">สร้างโครงการ</h2>
        </div>
        <ol className="grid grid-cols-5 gap-1 lg:flex lg:flex-col lg:gap-0" aria-label="ขั้นตอนสร้างโครงการ">
          {steps.map((title, index) => (
            <li key={title} aria-current={index === 0 ? "step" : undefined} className="relative flex min-w-0 flex-col items-center gap-2 px-1 py-2 text-center lg:min-h-[68px] lg:flex-row lg:gap-3 lg:px-2 lg:text-left">
              <span className={cn("relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full border-2 bg-card text-sm font-semibold", index === 0 ? "border-primary bg-primary text-primary-foreground" : "border-input text-muted-foreground")}>{index + 1}</span>
              <span className="flex min-w-0 flex-col lg:gap-0.5"><span className="hidden text-xs text-muted-foreground lg:block">ขั้นที่ {index + 1}</span><span className={cn("line-clamp-2 text-[10px] font-medium leading-tight sm:text-xs lg:text-sm", index === 0 ? "text-foreground" : "text-muted-foreground")}>{title}</span></span>
              {index < steps.length - 1 && <span aria-hidden="true" className="absolute left-[calc(50%+16px)] top-[26px] hidden h-0.5 w-[calc(100%-28px)] bg-border lg:left-[15px] lg:top-[50px] lg:block lg:h-9 lg:w-0.5" />}
            </li>
          ))}
        </ol>
        <p className="hidden rounded-lg bg-muted p-3 text-xs lg:mt-auto lg:block leading-relaxed text-muted-foreground">บันทึกข้อมูลขั้นแรกเป็นฉบับร่าง แล้วตั้งค่าส่วนที่เหลือก่อนเผยแพร่</p>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">

        <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-7 px-5 py-8 lg:px-10">
          <div role="status" className="flex items-start gap-3 rounded-lg border bg-[var(--status-warning-background)] px-4 py-3 text-sm">
            <LockKeyholeIcon className="mt-0.5 size-5 shrink-0 text-[var(--status-warning)]" aria-hidden="true" />
            <p><strong>สถานะ: ฉบับร่าง</strong> — ลิงก์ลงทะเบียนยังเปิดไม่ได้จนกว่าจะตั้งค่าครบและกดเผยแพร่</p>
          </div>
          <div className="flex flex-col gap-1">
            <h2 className="font-heading text-2xl font-bold">ข้อมูลโครงการ</h2>
            <p className="text-sm text-muted-foreground">ข้อมูลนี้จะแสดงบนหน้าลงทะเบียนสาธารณะ</p>
          </div>

          {state && <div role="alert" className="flex flex-col gap-1 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            <p>{state.error}</p>
            {/* Listed here too: some fields have no inline slot or are hidden (e.g. the threshold in per-day mode). */}
            {Object.keys(state.fieldErrors).length > 0 && <ul className="ml-4 list-disc">{[...new Set(Object.values(state.fieldErrors))].map((message) => <li key={message}>{message}</li>)}</ul>}
            {state.coverDropped && <p>ข้อมูลที่กรอกไว้ยังอยู่ แต่ต้องเลือกรูปปกใหม่อีกครั้ง</p>}
          </div>}
          <EventInfoFields key={state?.attempt ?? 0} event={state ? defaultsFrom(state.values) : undefined} deadlineDate={state?.values.deadlineDate} showRetention={false} errors={state?.fieldErrors} />
        </main>

        <footer className="sticky bottom-0 pb-[max(1rem,env(safe-area-inset-bottom))] flex items-center justify-between gap-4 border-t bg-card px-5 py-4 shadow-[0_-4px_16px_rgb(0_0_0/0.04)] lg:px-10">
          <Button variant="outline" size="lg" asChild><Link href="/organizer">ยกเลิก</Link></Button>
          <div className="flex items-center gap-4"><span className="hidden text-sm text-muted-foreground sm:inline">ขั้นที่ 1 จาก 5</span><Button type="submit" size="lg" disabled={pending}>{pending ? "กำลังบันทึก…" : "ถัดไป: วันที่จัด"}</Button></div>
        </footer>
      </div>
    </form>
  );
}
