"use client";

import { useActionState, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { FileUpIcon, UploadIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import type { RegistrationFieldConfig } from "@/features/events/registration-fields";
import { buildImport, guessTargets, IMPORT_MAX_BYTES, type ImportTarget, parseCsv } from "@/features/registrations/import";

import type { ImportState } from "./actions";

/** Options are needed in the browser too: the preview checks select/radio/checkbox answers as the server will. */
type FieldSummary = Pick<RegistrationFieldConfig, "key" | "label" | "type" | "options">;
const shortDay = new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", year: "2-digit", timeZone: "UTC" });
const number = (value: number) => value.toLocaleString("th-TH");

function SubmitButton({ count, disabled }: { count: number; disabled: boolean }) {
  const { pending } = useFormStatus();
  return <Button type="submit" disabled={disabled || pending} className="self-start"><UploadIcon data-icon="inline-start" aria-hidden="true" />{pending ? "กำลังนำเข้า…" : `นำเข้า ${number(count)} คน`}</Button>;
}

/** Choose the CSV, match its columns to the ticket ID, email, dates and form fields, check the preview, import. */
export function ImportForm({ action, eventId, fields, days, seatMode }: {
  action: (state: ImportState, formData: FormData) => Promise<ImportState>;
  eventId: string;
  fields: FieldSummary[];
  days: { id: string; date: string }[];
  seatMode: string;
}) {
  const [state, formAction] = useActionState(action, null);
  const [file, setFile] = useState<{ name: string; text: string; rows: string[][] } | null>(null);
  // What was sent with the last import: the server's answer belongs to that file and mapping only.
  const [submitted, setSubmitted] = useState("");
  const [fileError, setFileError] = useState("");
  const [targets, setTargets] = useState<ImportTarget[]>([]);
  const configs = useMemo(() => fields.map((field) => ({ required: false, showOnCheckin: false, sensitive: false, ...field })) as RegistrationFieldConfig[], [fields]);
  const eventDays = useMemo(() => days.map((day) => ({ id: day.id, date: new Date(day.date) })), [days]);
  const rows = useMemo(() => file?.rows ?? [], [file]);
  const headers = rows[0] ?? [];
  const built = useMemo(() => rows.length ? buildImport({ rows, targets, fields: configs, days: eventDays, seatMode }) : null, [rows, targets, configs, eventDays, seatMode]);
  const dayLabel = new Map(eventDays.map((day, index) => [day.id, `วันที่ ${index + 1}`]));
  const nameField = configs.find((field) => field.type === "text" && /ชื่อ|name/i.test(field.label));

  if (state?.ok) return <div role="status" className="flex flex-col gap-3 rounded-xl border border-primary/30 bg-accent p-5 text-accent-foreground">
    <p className="font-semibold">นำเข้าแล้ว {number(state.count)} คน — สแกน QR เดิมเช็คชื่อได้ทันที</p>
    <p className="text-sm">ระบบยังไม่ได้ส่งอีเมลให้ใคร ถ้าต้องการส่งบัตร QR ให้ใคร เปิดชื่อคนนั้นในหน้าผู้ลงทะเบียนแล้วกด “ส่งอีเมลอีกครั้ง”</p>
    <Button asChild className="self-start"><Link href={`/organizer/${eventId}/registrants?status=APPROVED`}>ไปหน้าผู้ลงทะเบียน</Link></Button>
  </div>;

  const options: { value: ImportTarget; label: string }[] = [
    { value: "ignore", label: "— ไม่นำเข้า —" },
    { value: "ticket", label: "Ticket ID (รหัสใน QR)" },
    { value: "email", label: "อีเมล" },
    ...(seatMode === "whole_course" ? [] : [{ value: "dates" as const, label: "วันที่เข้าร่วม" }]),
    ...fields.map((field) => ({ value: `field:${field.key}` as const, label: `ฟิลด์: ${field.label}` })),
  ];
  // The file's own problems first; the server's (e.g. a ticket ID already in the system) once the file itself is clean.
  // A server answer for an earlier file or mapping is dropped as soon as either changes, instead of lingering on screen.
  const current = file ? `${file.name}\n${file.text.length}\n${JSON.stringify(targets)}` : "";
  const problems = built?.problems.length ? built.problems : state && !state.ok && submitted === current ? state.problems : [];

  return <form action={formAction} onSubmit={() => setSubmitted(current)} className="flex flex-col gap-6">
    <section className="flex flex-col gap-3 rounded-xl border bg-card p-5">
      <h3 className="font-semibold">1. เลือกไฟล์</h3>
      <p className="text-sm text-muted-foreground">ใน Google Sheets: ไฟล์ → ดาวน์โหลด → ค่าที่คั่นด้วยจุลภาค (.csv) · แถวแรกต้องเป็นหัวคอลัมน์</p>
      <label className="flex w-fit cursor-pointer items-center gap-2 rounded-lg border border-dashed px-4 py-3 text-sm hover:bg-muted has-focus-visible:ring-3 has-focus-visible:ring-ring/50">
        <FileUpIcon className="size-4" aria-hidden="true" />{file ? file.name : "เลือกไฟล์ .csv"}
        <input type="file" accept=".csv,text/csv" className="sr-only" onChange={async (event) => {
          const chosen = event.target.files?.[0];
          setFileError("");
          if (!chosen) return;
          if (chosen.size > IMPORT_MAX_BYTES) { setFile(null); setFileError("ไฟล์ใหญ่เกิน 2 MB"); return; }
          const text = await chosen.text();
          // Parsed once here; the preview and the column table reuse these rows.
          const parsed = parseCsv(text);
          setFile({ name: chosen.name, text, rows: parsed });
          setTargets(guessTargets(parsed[0] ?? [], configs));
        }} />
      </label>
      {fileError && <p role="alert" className="text-sm text-destructive">{fileError}</p>}
    </section>

    {file && headers.length > 0 && <>
      <section className="flex flex-col gap-3 rounded-xl border bg-card p-5">
        <h3 className="font-semibold">2. จับคู่คอลัมน์</h3>
        <p className="text-sm text-muted-foreground">ต้องมี Ticket ID{seatMode === "whole_course" ? " · หลักสูตรต่อเนื่อง: ทุกคนได้ทุกวันของหลักสูตร" : days.length > 1 ? " และวันที่เข้าร่วม (เช่น 17 พ.ย. 69, 18 พ.ย. 69)" : ""} · คอลัมน์ที่ไม่มีฟิลด์รองรับ ให้เพิ่มฟิลด์ในฟอร์มของโครงการก่อน หรือเลือก “ไม่นำเข้า” · เบอร์โทรที่ 0 หน้าหายจะเติมให้</p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-xl text-sm">
            <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="py-2 pr-3 font-medium">คอลัมน์ในไฟล์</th><th className="py-2 pr-3 font-medium">ตัวอย่าง (แถว 2)</th><th className="py-2 font-medium">นำเข้าเป็น</th></tr></thead>
            <tbody>{headers.map((header, index) => <tr key={index} className="border-b last:border-0">
              <td className="py-2 pr-3 font-medium">{header || `คอลัมน์ ${index + 1}`}</td>
              <td className="max-w-56 truncate py-2 pr-3 text-muted-foreground">{rows[1]?.[index] ?? ""}</td>
              <td className="py-2"><NativeSelect aria-label={`นำเข้าคอลัมน์ ${header} เป็น`} value={targets[index] ?? "ignore"} onChange={(event) => {
                const value = event.target.value as ImportTarget;
                // One column per target: choosing it here clears it elsewhere.
                setTargets((current) => headers.map((_, at) => at === index ? value : value !== "ignore" && current[at] === value ? "ignore" : current[at] ?? "ignore"));
              }}>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</NativeSelect></td>
            </tr>)}</tbody>
          </table>
        </div>
      </section>

      <section className="flex flex-col gap-3 rounded-xl border bg-card p-5">
        <h3 className="font-semibold">3. ตรวจและนำเข้า</h3>
        {problems.length > 0
          ? <div role="alert" className="flex flex-col gap-1 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              <p className="font-semibold">แก้ {problems.length >= 50 ? "อย่างน้อย 50" : number(problems.length)} จุดนี้ก่อน (ยังไม่มีใครถูกนำเข้า)</p>
              <ul className="list-disc pl-5">{problems.slice(0, 20).map((problem, index) => <li key={index}>{problem.row ? `แถว ${problem.row}: ` : ""}{problem.message}</li>)}</ul>
              {problems.length > 20 && <p>…และอีก {number(problems.length - 20)} จุด</p>}
            </div>
          : built && <p className="text-sm">พร้อมนำเข้า <strong>{number(built.items.length)}</strong> คน เป็น “อนุมัติแล้ว”</p>}
        {built && built.items.length > 0 && <div className="overflow-x-auto">
          <table className="w-full min-w-xl text-sm">
            <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="py-2 pr-3 font-medium">แถว</th><th className="py-2 pr-3 font-medium">Ticket ID</th><th className="py-2 pr-3 font-medium">ชื่อ</th><th className="py-2 pr-3 font-medium">อีเมล</th><th className="py-2 font-medium">วัน</th></tr></thead>
            <tbody>{built.items.slice(0, 5).map((item) => <tr key={item.row} className="border-b last:border-0">
              <td className="py-2 pr-3 tabular-nums text-muted-foreground">{item.row}</td>
              <td className="py-2 pr-3 font-mono text-xs">{item.ticket}</td>
              <td className="py-2 pr-3">{nameField && typeof item.answers[nameField.key] === "string" ? item.answers[nameField.key] : "—"}</td>
              <td className="py-2 pr-3">{item.email ?? "—"}</td>
              <td className="py-2">{item.dayIds.length === eventDays.length && eventDays.length > 1 ? "ทุกวัน" : item.dayIds.map((id) => dayLabel.get(id)).join(", ")}</td>
            </tr>)}</tbody>
          </table>
          {built.items.length > 5 && <p className="pt-2 text-xs text-muted-foreground">แสดง 5 จาก {number(built.items.length)} คน · วันอบรม: {eventDays.map((day, index) => `วันที่ ${index + 1} = ${shortDay.format(day.date)}`).join(" · ")}</p>}
        </div>}
        <input type="hidden" name="csv" value={file.text} />
        <input type="hidden" name="targets" value={JSON.stringify(targets)} />
        <SubmitButton count={built?.items.length ?? 0} disabled={!built || built.problems.length > 0 || built.items.length === 0} />
      </section>
    </>}
  </form>;
}
