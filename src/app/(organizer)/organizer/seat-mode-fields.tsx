"use client";

import { useState } from "react";
import { LockIcon } from "lucide-react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const modes = [
  ["per_day", "แยกที่นั่งรายวัน", "หัวข้อเดียว จัดหลายรอบให้เลือก", ["กำหนดที่นั่งแยกทุกวันในขั้นที่ 2", "ผู้ลงทะเบียนติ๊กเลือกวันเองได้หลายวัน", "อนุมัติ / เข้าคิวรอ แยกรายวัน"]],
  ["whole_course", "รวมทั้งคอร์ส", "หลักสูตรต่อเนื่อง ต้องมาครบทุกวัน", ["กำหนดที่นั่งเป็นตัวเลขเดียวของหลักสูตรในขั้นที่ 2", "ผู้ลงทะเบียนไม่ต้องเลือกวัน ระบบผูกให้ครบ", "อนุมัติ / ยกเลิก เป็นก้อนทั้งคน"]],
] as const;

/** Seat-counting mode (mockup B v3). Seat numbers themselves are set in step 2 for both modes. */
export function SeatModeFields({ initialMode = "per_day", attendanceThreshold = null, locked = false, thresholdError }: {
  initialMode?: string;
  attendanceThreshold?: number | null;
  locked?: boolean;
  thresholdError?: string;
}) {
  const [mode, setMode] = useState(initialMode);
  return <fieldset className="flex flex-col gap-3">
    <legend className="mb-2 flex w-full items-center justify-between gap-3 text-sm font-semibold">
      <span>โหมดการนับที่นั่ง <span className="text-destructive">*</span></span>
      <span className="flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground"><LockIcon className="size-3" aria-hidden="true" />ล็อกหลังเผยแพร่</span>
    </legend>
    <div className="grid gap-3 sm:grid-cols-2">
      {modes.map(([value, label, description, points]) => <label key={value} className={cn("flex flex-col gap-2 rounded-lg border bg-card p-4 has-checked:border-2 has-checked:border-primary has-checked:bg-accent", locked ? "cursor-not-allowed opacity-70" : "cursor-pointer")}>
        <span className="flex items-center gap-2.5 font-semibold"><input type="radio" name="seatMode" value={value} checked={mode === value} disabled={locked} onChange={() => setMode(value)} className="size-4 accent-primary" />{label}</span>
        <span className="text-sm text-muted-foreground">{description}</span>
        <ul className="flex flex-col gap-1 text-xs leading-relaxed text-muted-foreground">{points.map((point) => <li key={point} className="flex gap-1.5"><span aria-hidden="true">•</span>{point}</li>)}</ul>
      </label>)}
    </div>
    {locked && <input type="hidden" name="seatMode" value={mode} />}
    <p className="text-xs leading-relaxed text-muted-foreground">{locked ? "โครงการนี้เผยแพร่แล้วหรือมีผู้ลงทะเบียนแล้ว จึงเปลี่ยนโหมดไม่ได้ — ถ้าจำเป็นให้ทำสำเนา (clone) เป็นโครงการใหม่" : "เลือกได้เฉพาะตอนเป็นฉบับร่าง — เผยแพร่แล้วเปลี่ยนไม่ได้ เพราะความหมายของที่นั่งและของวันที่ผูกไว้เปลี่ยนทั้งหมด ถ้าจำเป็นให้ clone เป็นโครงการใหม่"}</p>
    {mode === "whole_course" && <label className="flex max-w-xs flex-col gap-1.5 text-sm font-medium">เกณฑ์เข้าอบรมครบ (%)<Input name="attendanceThreshold" type="number" min={1} max={100} defaultValue={attendanceThreshold ?? ""} placeholder="ไม่กำหนด" className="h-10 bg-card" aria-invalid={thresholdError ? true : undefined} />{thresholdError && <span role="alert" className="font-normal text-destructive">{thresholdError}</span>}</label>}
  </fieldset>;
}
