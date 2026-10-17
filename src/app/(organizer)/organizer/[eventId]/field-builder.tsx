"use client";

import { useOptimistic, useRef, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { ArrowDownIcon, ArrowUpIcon, ChevronRightIcon, EyeIcon, FileIcon, GripVerticalIcon, PlusIcon, SeparatorHorizontalIcon, ShieldIcon, Trash2Icon, TriangleAlertIcon, XIcon } from "lucide-react";

import { addFormPageBreak, addRegistrationField, moveRegistrationField, moveRegistrationFieldTo, removeRegistrationField, updateFormPageBreak, updateRegistrationField } from "@/app/(organizer)/organizer/field-actions";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { DEFAULT_FORM_PAGE_TITLE, fieldsOf, isPageBreak, MAX_FORM_PAGE_BREAKS, type RegistrationFieldConfig, type RegistrationFormItem } from "@/features/events/registration-fields";
import { cn } from "@/lib/utils";

type FieldType = RegistrationFieldConfig["type"];

type FieldBuilderProps = {
  eventId: string;
  /** The stored form in order: fields and the page breaks between them. */
  items: RegistrationFormItem[];
  editable: boolean;
  /** Registrants with a stored answer per field key (orphan-key warnings). */
  answerCounts?: Record<string, number>;
  initialSelected?: string;
  /** Message from the page for generic codes; field-rule codes are explained here. */
  error?: string;
  errorCode?: string;
};

const typeLabels: Record<FieldType, string> = {
  text: "ข้อความสั้น", textarea: "ข้อความยาว", email: "อีเมล", tel: "เบอร์โทรศัพท์", date: "วันที่", select: "ตัวเลือก (เมนู)", radio: "ตัวเลือก (ปุ่มกลม)", checkbox: "เลือกได้หลายข้อ", file: "ไฟล์แนบ",
};
/** Types that reject answers in another format; shown under the type picker. */
const typeHints: Partial<Record<FieldType, string>> = {
  tel: "รับเฉพาะเบอร์โทรศัพท์ (ตัวเลข 10 หลัก เช่น 081-234-5678 — เว้นวรรคหรือขีดคั่นได้) — ถ้าเป็นข้อความทั่วไปให้ใช้ “ข้อความสั้น” หรือ “ข้อความยาว”",
  email: "รับเฉพาะรูปแบบอีเมล — อีเมลสำหรับติดต่อมีอยู่แล้วท้ายฟอร์ม ไม่ต้องเพิ่มซ้ำ",
  date: "ผู้สมัครเลือกวันที่จากปฏิทิน",
};
const fileTypes = ["pdf", "jpg", "png", "webp", "docx"];
const NEW = "__new__";
const PANEL_FORM = "field-panel";

const fieldErrors: Record<string, string> = {
  "confirm-required": "ฟิลด์นี้มีคนตอบแล้ว — การลบตัวเลือก/เปลี่ยนชื่อตัวเลือก หรือลบฟิลด์ ต้องติ๊ก “ยืนยัน” ในกล่องคำเตือนก่อน (คำตอบเดิมยังเก็บไว้ ไม่ถูกลบ)",
  "field-has-children": "ลบฟิลด์แม่ไม่ได้ขณะที่ยังมีฟิลด์ลูกผูกเงื่อนไขอยู่ — ปิดเงื่อนไขหรือลบฟิลด์ลูกก่อน แล้วจึงลบฟิลด์นี้",
  "type-locked": "เปลี่ยนชนิดของฟิลด์ที่สร้างแล้วไม่ได้ เพื่อให้คำตอบเดิมยังอ่านได้ — ให้เพิ่มฟิลด์ใหม่แทน",
  "field-in-use": "ลบฟิลด์นี้ไม่ได้ เพราะมีฟิลด์อื่นอ้างถึงอยู่",
  "too-many-pages": `เพิ่มตัวแบ่งหน้าได้ไม่เกิน ${MAX_FORM_PAGE_BREAKS} ตัว`,
};

/**
 * Wizard page number each break starts, or null when no field follows it before the next break (the wizard skips
 * empty pages). The fields above the first break are page 1.
 */
function pageNumbers(items: RegistrationFormItem[]) {
  const numbers = new Map<string, number | null>();
  let pages = 0;
  let open: string | null = null;
  let hasFields = false;
  const close = () => { if (hasFields) pages += 1; if (open) numbers.set(open, hasFields ? pages : null); };
  for (const item of items) {
    if (isPageBreak(item)) { close(); open = item.key; hasFields = false; }
    else hasFields = true;
  }
  close();
  return numbers;
}

function isValidOrder(fields: RegistrationFieldConfig[]) {
  const indexByKey = new Map(fields.map((field, index) => [field.key, index]));
  return fields.every((field) => !field.conditional || (indexByKey.get(field.conditional.field) ?? Infinity) < (indexByKey.get(field.key) ?? -Infinity));
}

const conditionValues = (field: RegistrationFieldConfig) => field.conditional ? (Array.isArray(field.conditional.value) ? field.conditional.value : [field.conditional.value]) : [];

function Chip({ tone = "neutral", children }: { tone?: "neutral" | "muted" | "danger"; children: ReactNode }) {
  return <span className={cn(
    "inline-flex items-center whitespace-nowrap rounded-md px-2.5 py-0.5 text-xs font-semibold",
    tone === "danger" ? "bg-destructive/10 text-destructive" : tone === "muted" ? "bg-muted text-muted-foreground" : "bg-muted text-foreground",
  )}>{children}</span>;
}

/** Visual switch backed by a real checkbox so it submits with the form and stays keyboard accessible. */
function Switch({ id, name, label, description, defaultChecked, checked, onChange, disabled, tone = "plain" }: {
  id: string; name?: string; label: string; description?: string; defaultChecked?: boolean; checked?: boolean; onChange?: (checked: boolean) => void; disabled?: boolean; tone?: "plain" | "accent";
}) {
  return <label htmlFor={id} className={cn("flex items-center justify-between gap-4", tone === "plain" && "rounded-lg border px-3.5 py-3", disabled && "opacity-60")}>
    <span className="flex flex-col gap-0.5">
      <span className={cn("text-sm font-semibold", tone === "accent" && "font-bold text-accent-foreground")}>{label}</span>
      {description && <span className="text-xs text-muted-foreground">{description}</span>}
    </span>
    <input id={id} name={name} type="checkbox" className="peer sr-only" defaultChecked={defaultChecked} checked={checked} onChange={onChange ? (event) => onChange(event.target.checked) : undefined} disabled={disabled} />
    <span aria-hidden="true" className="relative h-[26px] w-[46px] shrink-0 rounded-full bg-[#cfc9bc] transition-colors after:absolute after:left-[3px] after:top-[3px] after:size-5 after:rounded-full after:bg-card after:transition-transform peer-checked:bg-primary peer-checked:after:translate-x-5 peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2" />
  </label>;
}

function OptionsEditor({ initial }: { initial: string[] }) {
  const [options, setOptions] = useState(initial.length ? initial : ["", ""]);
  return <div className="flex flex-col gap-2">
    <span className="text-sm font-semibold">ตัวเลือก</span>
    <input type="hidden" name="optionsText" value={options.map((option) => option.trim()).filter(Boolean).join("\n")} />
    {options.map((option, index) => <div key={index} className="flex gap-2">
      <Input aria-label={`ตัวเลือก ${index + 1}`} value={option} maxLength={191} onChange={(event) => setOptions((current) => current.map((item, itemIndex) => itemIndex === index ? event.target.value.replaceAll(",", " ") : item))} />
      <Button type="button" variant="outline" size="icon" aria-label={`ลบตัวเลือก ${index + 1}`} disabled={options.length <= 2} onClick={() => setOptions((current) => current.filter((_, itemIndex) => itemIndex !== index))}><XIcon aria-hidden="true" /></Button>
    </div>)}
    <button type="button" className="self-start py-1 text-sm font-bold text-primary disabled:opacity-50" disabled={options.length >= 30} onClick={() => setOptions((current) => [...current, ""])}>+ เพิ่มตัวเลือก</button>
    <p className="text-xs text-muted-foreground">อย่างน้อย 2 ตัวเลือก ไม่ซ้ำกัน</p>
  </div>;
}

function ConditionEditor({ field, fields, childFields, answered }: { field: RegistrationFieldConfig | null; fields: RegistrationFieldConfig[]; childFields: RegistrationFieldConfig[]; answered: number }) {
  const position = field ? fields.findIndex((item) => item.key === field.key) : fields.length;
  // One level deep: only earlier select/checkbox fields that are not conditional themselves can be parents.
  const parents = fields.slice(0, position).filter((item) => (item.type === "select" || item.type === "radio" || item.type === "checkbox") && !item.conditional);
  const [enabled, setEnabled] = useState(!!field?.conditional);
  const [parentKey, setParentKey] = useState(field?.conditional?.field ?? parents[0]?.key ?? "");
  const [values, setValues] = useState<string[]>(field ? conditionValues(field) : []);
  const parent = parents.find((item) => item.key === parentKey);
  const isParent = childFields.length > 0;
  const id = field?.key ?? NEW;

  return <div className="flex flex-col gap-3 rounded-lg bg-accent p-3.5">
    <Switch id={`condition-${id}`} label="แสดงแบบมีเงื่อนไข" tone="accent" checked={enabled} onChange={setEnabled} disabled={isParent || parents.length === 0} />
    {answered > 0 && <div className="flex flex-col gap-2.5 rounded-lg bg-[#fbefdd] px-3.5 py-3 text-xs leading-relaxed text-foreground">
      <p className="flex gap-2.5"><TriangleAlertIcon className="size-4 shrink-0 text-[#9a4a06]" aria-hidden="true" /><span>มี <strong>{answered} คน</strong>ตอบฟิลด์นี้ไปแล้ว — แก้ตัวเลือกหรือลบฟิลด์ จะทำให้คำตอบเดิมกลายเป็น key กำพร้าที่ค้างใน answers ระบบจะถามยืนยันก่อนเสมอ ไม่ลบเงียบ ๆ</span></p>
      <label className="flex min-h-6 cursor-pointer items-start gap-2 py-1 pl-6.5 font-semibold"><input type="checkbox" name="confirmAnswers" data-confirm-answers className="mt-0.5 size-4 shrink-0 accent-primary" />ยืนยัน: เข้าใจแล้วว่าคำตอบเดิมจะค้างอยู่ในระบบ (ใช้เมื่อแก้/ลบตัวเลือก หรือลบฟิลด์นี้)</label>
    </div>}
    {isParent && <p className="text-xs leading-relaxed text-accent-foreground">ฟิลด์นี้เป็นฟิลด์แม่ของ {childFields.length} ฟิลด์ ({childFields.map((child) => child.label).join(", ")}) — แก้ตัวเลือกหรือลบฟิลด์นี้จะกระทบฟิลด์ลูก (ตัวเลือกที่ฟิลด์ลูกใช้อยู่ลบไม่ได้ และต้องแก้ฟิลด์ลูกก่อนลบฟิลด์นี้)</p>}
    {!isParent && parents.length === 0 && <p className="text-xs leading-relaxed text-accent-foreground">ต้องมีฟิลด์ชนิดตัวเลือกอยู่ก่อนหน้าฟิลด์นี้ จึงจะตั้งเงื่อนไขได้</p>}
    {enabled && !isParent && parent && <>
      <Field>
        <FieldLabel htmlFor={`condition-parent-${id}`}>แสดงเมื่อฟิลด์</FieldLabel>
        <NativeSelect id={`condition-parent-${id}`} name="conditionField" value={parentKey} onChange={(event) => { setParentKey(event.target.value); setValues([]); }}>
          {parents.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
        </NativeSelect>
      </Field>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-semibold">มีค่าเป็น (เลือกได้หลายค่า)</legend>
        <div className="flex flex-wrap gap-2">{parent.options?.map((option) => {
          const checked = values.includes(option);
          return <label key={option} className={cn("inline-flex h-9 cursor-pointer items-center rounded-full border px-3 text-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring", checked ? "border-2 border-primary bg-card font-bold text-accent-foreground" : "bg-card")}>
            <input type="checkbox" name="conditionValues" value={option} checked={checked} required={values.length === 0 && option === parent.options?.[0]} onChange={(event) => setValues((current) => event.target.checked ? [...current, option] : current.filter((item) => item !== option))} className="sr-only" />{option}
          </label>;
        })}</div>
        {values.length === 0 && <p className="text-xs text-accent-foreground">เลือกอย่างน้อย 1 ค่า หรือปิดสวิตช์ถ้าไม่ต้องการเงื่อนไข</p>}
      </fieldset>
    </>}
    <p className="text-xs leading-relaxed text-muted-foreground">เงื่อนไขซ้อนได้ชั้นเดียว — ฟิลด์ลูกตั้งเป็นฟิลด์แม่ของอีกฟิลด์ไม่ได้ และเลือกได้เฉพาะฟิลด์ select / checkbox ที่อยู่เหนือฟิลด์นี้</p>
  </div>;
}

/** File settings live under the field list (mockup B v3) but submit with the panel form via the `form` attribute. */
function FileSettings({ field, disabled }: { field: RegistrationFieldConfig | null; disabled: boolean }) {
  const selected = (field?.acceptedFileTypes ?? ["pdf", "jpg", "png"]).map((type) => type === "jpeg" ? "jpg" : type);
  const id = field?.key ?? NEW;
  return <section aria-label="ตั้งค่าฟิลด์ไฟล์" className="flex flex-col gap-3.5 rounded-xl border bg-card p-4.5">
    <div className="flex items-center gap-2.5">
      <span className="flex size-8.5 shrink-0 items-center justify-center rounded-lg bg-muted"><FileIcon className="size-4" aria-hidden="true" /></span>
      <div className="flex min-w-0 flex-col"><span className="font-heading text-base font-bold">ตั้งค่าฟิลด์ไฟล์</span><span className="truncate text-xs text-muted-foreground">{field?.label ?? "ฟิลด์ใหม่"}</span></div>
    </div>
    <fieldset disabled={disabled} className="flex flex-col gap-3.5">
      <div className="flex flex-col gap-2">
        <span className="text-sm font-semibold" id={`file-types-${id}`}>ชนิดไฟล์ที่รับ</span>
        <div role="group" aria-labelledby={`file-types-${id}`} className="flex flex-wrap gap-2">{fileTypes.map((type) => <label key={type} className="inline-flex h-9 cursor-pointer items-center rounded-full border px-3 text-sm has-[:checked]:border-2 has-[:checked]:border-primary has-[:checked]:bg-accent has-[:checked]:font-bold has-[:checked]:text-accent-foreground has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring">
          <input type="checkbox" form={PANEL_FORM} name="acceptedFileTypes" value={type} defaultChecked={selected.includes(type)} className="sr-only" />{type}
        </label>)}</div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field>
          <FieldLabel htmlFor={`file-size-${id}`}>ขนาดสูงสุด (MB)</FieldLabel>
          <Input id={`file-size-${id}`} form={PANEL_FORM} name="maxFileSizeMb" type="number" min={1} max={5} defaultValue={field?.maxFileSizeMb ?? 5} />
        </Field>
        <Field>
          <FieldLabel htmlFor={`file-count-${id}`}>จำนวนไฟล์</FieldLabel>
          <NativeSelect id={`file-count-${id}`} form={PANEL_FORM} name="maxFiles" defaultValue={String(field?.maxFiles ?? 1)}><option value="1">1 ไฟล์</option><option value="3">หลายไฟล์ (สูงสุด 3)</option></NativeSelect>
        </Field>
      </div>
    </fieldset>
    <div className="flex gap-2.5 rounded-lg bg-muted p-3 text-xs leading-relaxed text-muted-foreground"><ShieldIcon className="size-4 shrink-0" aria-hidden="true" /><span>ไฟล์แนบเป็นไฟล์ <strong>ส่วนตัว</strong> — ไม่มีลิงก์สาธารณะ · ใน answers เก็บแค่ storage key ไม่ใช่ URL · ผู้จัดเปิดไฟล์ได้หลังล็อกอินเท่านั้น และทุกครั้งลง audit log · สิทธิ์ “เช็คชื่ออย่างเดียว” เปิดไม่ได้เลย · backend ตรวจ magic bytes จริง ไม่เชื่อนามสกุล/Content-Type จาก client · ตอนนี้เก็บในเครื่องเซิร์ฟเวอร์ (development) ส่วน object storage + signed URL อายุสั้นยังเป็นแผน production จึงยังไม่เปิดรับไฟล์</span></div>
  </section>;
}

export function FieldBuilder({ eventId, items: initialItems, editable, answerCounts = {}, initialSelected, error, errorCode }: FieldBuilderProps) {
  const [items, setItems] = useOptimistic(initialItems);
  const fields = fieldsOf(items);
  const [selected, setSelected] = useState(() => initialSelected === NEW || initialItems.some((item) => item.key === initialSelected) ? initialSelected! : fieldsOf(initialItems)[0]?.key ?? NEW);
  const [newType, setNewType] = useState<FieldType>("text");
  const [draggedKey, setDraggedKey] = useState<string | null>(null);
  const [dropKey, setDropKey] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();
  const panel = useRef<HTMLFormElement>(null);

  // Below the two-column breakpoint the panel sits under the list, so bring it into view.
  function select(key: string) {
    setSelected(key);
    if (!window.matchMedia("(min-width: 1280px)").matches) requestAnimationFrame(() => panel.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  const currentItem = selected === NEW ? null : items.find((item) => item.key === selected) ?? null;
  const currentPage = currentItem && isPageBreak(currentItem) ? currentItem : null;
  const current = currentItem && !isPageBreak(currentItem) ? currentItem : null;
  const creating = editable && (selected === NEW || !currentItem);
  const type = current?.type ?? newType;
  const index = currentItem ? items.findIndex((item) => item.key === currentItem.key) : -1;
  const pageNumberOf = pageNumbers(items);
  const pageBreakCount = items.length - fields.length;
  const children = current ? fields.filter((field) => field.conditional?.field === current.key) : [];
  const labelOf = (key: string) => fields.find((field) => field.key === key)?.label ?? "ฟิลด์ก่อนหน้า";
  const answered = current ? answerCounts[current.key] ?? 0 : 0;
  const errorText = (errorCode && fieldErrors[errorCode]) || error;

  // Ask before a change that would orphan stored answers; the server refuses it without the same confirmation.
  function confirmOrphans(event: FormEvent<HTMLFormElement>) {
    if (!current || answered === 0) return;
    const form = event.currentTarget;
    const box = form.querySelector<HTMLInputElement>("[data-confirm-answers]");
    if (!box || box.checked) return;
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const deleting = submitter?.getAttribute("aria-label")?.startsWith("ลบฟิลด์") ?? false;
    const nextOptions = String(new FormData(form).get("optionsText") ?? "").split("\n").filter(Boolean);
    const dropsOptions = !!current.options && current.options.some((option) => !nextOptions.includes(option));
    if (!deleting && !dropsOptions) return;
    if (window.confirm(`มี ${answered} คนตอบฟิลด์นี้แล้ว — ${deleting ? "ลบฟิลด์นี้" : "ลบ/เปลี่ยนชื่อตัวเลือก"}จะทำให้คำตอบเดิมค้างเป็น key กำพร้าใน answers (ไม่ถูกลบ) ยืนยันหรือไม่?`)) box.checked = true;
    else event.preventDefault();
  }

  function dropOn(targetKey: string) {
    if (!draggedKey || draggedKey === targetKey) { setDraggedKey(null); setDropKey(null); return; }
    const targetIndex = items.findIndex((item) => item.key === targetKey);
    const sourceIndex = items.findIndex((item) => item.key === draggedKey);
    if (targetIndex < 0 || sourceIndex < 0) return;
    const next = [...items];
    const [moving] = next.splice(sourceIndex, 1);
    next.splice(targetIndex, 0, moving);
    setDraggedKey(null);
    setDropKey(null);
    if (!isValidOrder(fieldsOf(next))) { setMessage("ฟิลด์แบบมีเงื่อนไขต้องอยู่หลังฟิลด์แม่"); return; }
    setMessage("กำลังบันทึกลำดับฟิลด์");
    startTransition(async () => {
      setItems(next);
      await moveRegistrationFieldTo(eventId, moving.key, targetIndex);
    });
  }

  const action = creating ? addRegistrationField.bind(null, eventId) : current ? updateRegistrationField.bind(null, eventId, current.key) : undefined;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-7 xl:grid-cols-[minmax(0,1.25fr)_420px]">
      {/* Below xl the wrapper dissolves: list, file card, then the edit panel with its save button. */}
      <div className="contents xl:flex xl:min-w-0 xl:flex-col xl:gap-5">
      <section className="flex flex-col gap-2.5" aria-label="ฟิลด์ลงทะเบียน">
        {message && <p role="status" aria-live="polite" className="text-sm text-muted-foreground">{message}</p>}
        {fields.length === 0 && <p className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">ยังไม่มีฟิลด์ลงทะเบียน เริ่มจากปุ่ม “เพิ่มฟิลด์”</p>}
        <ol aria-label="ลำดับฟิลด์ลงทะเบียน" className="flex flex-col gap-2.5">
          {items.map((field) => {
            const active = field.key === selected;
            const grip = editable ? <span
              draggable={!isPending}
              aria-hidden="true"
              title="ลากเพื่อเรียงลำดับ"
              onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", field.key); setDraggedKey(field.key); setMessage(""); }}
              onDragEnd={() => { setDraggedKey(null); setDropKey(null); }}
              className="flex cursor-grab text-[#b9b3a6] active:cursor-grabbing"
            ><GripVerticalIcon className="size-4" /></span> : <span className="w-4" aria-hidden="true" />;
            if (isPageBreak(field)) {
              const pageNumber = pageNumberOf.get(field.key) ?? null;
              return <li
                key={field.key}
                onDragOver={(event) => { if (editable && draggedKey) event.preventDefault(); }}
                onDragEnter={() => { if (editable && draggedKey && draggedKey !== field.key) setDropKey(field.key); }}
                onDrop={(event) => { event.preventDefault(); if (editable) dropOn(field.key); }}
                className={cn(
                  "flex items-center gap-3 rounded-[10px] border border-dashed border-[#c9c3b6] bg-secondary px-3.5 py-2.5 transition-colors",
                  active ? "border-2 border-solid border-primary px-[13px] py-[9px]" : "hover:border-input",
                  dropKey === field.key && "border-primary",
                )}
              >
                {grip}
                <button type="button" onClick={() => select(field.key)} aria-pressed={active} className="flex min-w-0 flex-1 items-center gap-2.5 text-left outline-none focus-visible:underline">
                  <SeparatorHorizontalIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-sm font-semibold">{pageNumber ? `ขึ้นหน้า ${pageNumber}` : "ตัวแบ่งหน้า"} · {field.label || DEFAULT_FORM_PAGE_TITLE}</span>
                    <span className="text-xs text-muted-foreground">{pageNumber ? "ฟิลด์ใต้บรรทัดนี้อยู่หน้าถัดไปของฟอร์มสมัคร" : "ยังไม่มีฟิลด์ต่อจากตัวแบ่งนี้ — หน้าว่างจะถูกข้าม"}</span>
                  </span>
                </button>
                <span className="hidden sm:flex"><Chip tone="muted">แบ่งหน้า</Chip></span>
              </li>;
            }
            return <li
              key={field.key}
              onDragOver={(event) => { if (editable && draggedKey) event.preventDefault(); }}
              onDragEnter={() => { if (editable && draggedKey && draggedKey !== field.key) setDropKey(field.key); }}
              onDrop={(event) => { event.preventDefault(); if (editable) dropOn(field.key); }}
              className={cn(
                "flex items-center gap-3 rounded-[10px] border bg-card px-3.5 py-3 transition-colors",
                field.conditional && "ml-7",
                active ? "border-2 border-primary px-[13px] py-[11px]" : "hover:border-input",
                dropKey === field.key && "border-dashed border-primary",
              )}
            >
              {grip}
              <button type="button" onClick={() => select(field.key)} aria-pressed={active} className="flex min-w-0 flex-1 flex-col gap-0.5 text-left outline-none focus-visible:underline">
                <span className="text-sm font-semibold">{field.label}</span>
                {field.showOnCheckin && <span className="inline-flex w-fit items-center gap-1 whitespace-nowrap rounded-md bg-accent px-2 py-0.5 text-[11px] font-semibold text-accent-foreground"><EyeIcon className="size-3" aria-hidden="true" />หน้างาน</span>}
                {field.conditional && <span className="flex items-center gap-1.5 text-xs text-accent-foreground"><ChevronRightIcon className="size-3.5" aria-hidden="true" />แสดงเมื่อ {labelOf(field.conditional.field)} = {conditionValues(field).join(", ")}</span>}
              </button>
              <span className="hidden flex-wrap justify-end gap-1.5 sm:flex">
                {field.sensitive && <Chip tone="muted">อ่อนไหว</Chip>}
                <Chip>{field.type}</Chip>
                {field.required ? <Chip tone="danger">บังคับ</Chip> : <Chip tone="muted">ไม่บังคับ</Chip>}
              </span>
            </li>;
          })}
        </ol>
        {editable && <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <button type="button" onClick={() => select(NEW)} aria-pressed={creating} className={cn("flex h-[46px] items-center justify-center gap-2 rounded-[10px] border border-dashed border-[#c9c3b6] text-sm font-semibold text-muted-foreground hover:border-primary hover:text-primary", creating && "border-primary bg-card text-primary")}><PlusIcon className="size-4" aria-hidden="true" />เพิ่มฟิลด์</button>
          <form action={addFormPageBreak.bind(null, eventId)} className="flex">
            <button type="submit" disabled={isPending || fields.length === 0 || pageBreakCount >= MAX_FORM_PAGE_BREAKS} title={fields.length === 0 ? "เพิ่มฟิลด์ก่อน จึงจะแบ่งหน้าได้" : pageBreakCount >= MAX_FORM_PAGE_BREAKS ? `แบ่งหน้าได้ไม่เกิน ${MAX_FORM_PAGE_BREAKS} ตัว` : undefined} className="flex h-[46px] flex-1 items-center justify-center gap-2 rounded-[10px] border border-dashed border-[#c9c3b6] text-sm font-semibold text-muted-foreground hover:border-primary hover:text-primary disabled:pointer-events-none disabled:opacity-50"><SeparatorHorizontalIcon className="size-4" aria-hidden="true" />เพิ่มตัวแบ่งหน้า</button>
          </form>
        </div>}
        {editable && pageBreakCount > 0 && <p className="text-xs leading-relaxed text-muted-foreground">ตัวแบ่งหน้าเพิ่มที่ท้ายรายการ — ลากไปวางตรงที่ต้องการให้ขึ้นหน้าใหม่ · มีผลกับหน้าสมัครของผู้เข้าร่วมเท่านั้น คำตอบและการส่งออกไม่เปลี่ยน</p>}
        <p className="text-xs leading-relaxed text-muted-foreground">อีเมลและคำยินยอม PDPA เป็นส่วนมาตรฐานท้ายฟอร์ม ไม่ต้องเพิ่มเอง · แก้ฟอร์มได้แม้เผยแพร่แล้วหรือมีผู้ลงทะเบียนแล้ว ทุกการแก้ขึ้นเวอร์ชันฟอร์มใหม่ และคำตอบเดิมไม่ถูกลบ</p>
      </section>
      {(current || creating) && type === "file" && <FileSettings key={`file:${selected}`} field={current} disabled={!editable} />}
      </div>

      {currentPage && <form ref={panel} key={`page:${currentPage.key}`} action={updateFormPageBreak.bind(null, eventId, currentPage.key)} className="flex scroll-mt-4 flex-col gap-4">
        <section className="flex flex-col gap-4 rounded-xl border bg-card p-5">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-heading text-[17px] font-bold">ตัวแบ่งหน้า</h3>
            {editable && <div className="flex items-center gap-1.5">
              <Button type="submit" formAction={moveRegistrationField.bind(null, eventId, currentPage.key, "up")} variant="outline" size="icon" disabled={index <= 0 || isPending} aria-label="เลื่อนตัวแบ่งหน้าขึ้น"><ArrowUpIcon aria-hidden="true" /></Button>
              <Button type="submit" formAction={moveRegistrationField.bind(null, eventId, currentPage.key, "down")} variant="outline" size="icon" disabled={index >= items.length - 1 || isPending} aria-label="เลื่อนตัวแบ่งหน้าลง"><ArrowDownIcon aria-hidden="true" /></Button>
              <Button type="submit" formAction={removeRegistrationField.bind(null, eventId, currentPage.key)} formNoValidate variant="outline" size="icon" disabled={isPending} aria-label="ลบตัวแบ่งหน้า" className="border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"><Trash2Icon aria-hidden="true" /></Button>
            </div>}
          </div>
          {errorText && <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{errorText}</p>}
          <fieldset disabled={!editable} className="flex flex-col gap-4">
            <Field>
              <FieldLabel htmlFor={`page-label-${currentPage.key}`}>ชื่อหน้า (ไม่บังคับ)</FieldLabel>
              <Input id={`page-label-${currentPage.key}`} name="label" defaultValue={currentPage.label} maxLength={191} placeholder={`เช่น ข้อมูลหน่วยงาน · เว้นว่าง = “${DEFAULT_FORM_PAGE_TITLE}”`} />
              <FieldDescription className="text-xs">แสดงเป็นหัวข้อของหน้านั้นในฟอร์มสมัคร</FieldDescription>
            </Field>
          </fieldset>
          <p className="rounded-lg bg-muted p-3 text-xs leading-relaxed text-muted-foreground">ฟิลด์ที่อยู่ใต้ตัวแบ่งนี้จะขึ้นหน้าใหม่ ผู้สมัครกด “ถัดไป” เมื่อกรอกหน้าก่อนหน้าครบ · ลบตัวแบ่งแล้วฟิลด์ยังอยู่ครบ แค่รวมกลับเป็นหน้าเดียวกัน · ฟิลด์ลูกแบบมีเงื่อนไขอยู่คนละหน้ากับฟิลด์แม่ได้</p>
          {editable && <div className="flex justify-end"><Button type="submit" disabled={isPending}>บันทึกชื่อหน้า</Button></div>}
        </section>
      </form>}

      {(current || creating) && <form id={PANEL_FORM} ref={panel} key={`${selected}:${type}`} action={action} onSubmit={confirmOrphans} className="flex scroll-mt-4 flex-col gap-4">
        <section className="flex flex-col gap-4 rounded-xl border bg-card p-5">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-heading text-[17px] font-bold">{creating ? "เพิ่มฟิลด์ใหม่" : editable ? "แก้ไขฟิลด์" : "รายละเอียดฟิลด์"}</h3>
            {editable && current && <div className="flex items-center gap-1.5">
              <Button type="submit" formAction={moveRegistrationField.bind(null, eventId, current.key, "up")} variant="outline" size="icon" disabled={index <= 0 || isPending} aria-label={`เลื่อน ${current.label} ขึ้น`}><ArrowUpIcon aria-hidden="true" /></Button>
              <Button type="submit" formAction={moveRegistrationField.bind(null, eventId, current.key, "down")} variant="outline" size="icon" disabled={index >= items.length - 1 || isPending} aria-label={`เลื่อน ${current.label} ลง`}><ArrowDownIcon aria-hidden="true" /></Button>
              <Button type="submit" formAction={removeRegistrationField.bind(null, eventId, current.key)} formNoValidate variant="outline" size="icon" disabled={isPending || children.length > 0} title={children.length ? "ปิดเงื่อนไขหรือลบฟิลด์ลูกก่อน" : undefined} aria-label={`ลบฟิลด์ ${current.label}`} className="border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"><Trash2Icon aria-hidden="true" /></Button>
            </div>}
          </div>
          {errorText && <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{errorText}</p>}
          <fieldset disabled={!editable} className="flex flex-col gap-4">
            <Field>
              <FieldLabel htmlFor={`field-label-${selected}`}>ชื่อฟิลด์ (label)</FieldLabel>
              <Input id={`field-label-${selected}`} name="label" defaultValue={current?.label ?? ""} maxLength={191} placeholder="เช่น ชื่อ-นามสกุล" required aria-describedby={current ? `field-label-hint-${selected}` : undefined} />
              {current && <FieldDescription id={`field-label-hint-${selected}`} className="text-xs">แก้ชื่อฟิลด์ได้ คำตอบที่ผู้สมัครกรอกไว้แล้วไม่หาย</FieldDescription>}
            </Field>
            <Field>
              <FieldLabel htmlFor={`field-type-${selected}`}>ชนิดฟิลด์</FieldLabel>
              {creating
                ? <NativeSelect id={`field-type-${selected}`} name="type" value={newType} onChange={(event) => setNewType(event.target.value as FieldType)}>{(Object.keys(typeLabels) as FieldType[]).map((value) => <option key={value} value={value}>{value} · {typeLabels[value]}</option>)}</NativeSelect>
                : <Input id={`field-type-${selected}`} value={`${type} · ${typeLabels[type]}`} readOnly disabled />}
            </Field>
            {typeHints[type] && <FieldDescription className="-mt-2 text-xs text-accent-foreground">{typeHints[type]}</FieldDescription>}
            {!creating && <FieldDescription className="-mt-2 text-xs">ชนิดฟิลด์เปลี่ยนไม่ได้หลังสร้าง ถ้าต้องการชนิดอื่นให้เพิ่มฟิลด์ใหม่</FieldDescription>}
            <Switch id={`field-required-${selected}`} name="required" label="บังคับกรอก" defaultChecked={current?.required ?? false} />
            <Switch id={`field-checkin-${selected}`} name="showOnCheckin" label="แสดงบนหน้าจอเช็คชื่อ" description="เจ้าหน้าที่สิทธิ์ “เช็คชื่ออย่างเดียว” เห็นได้เฉพาะฟิลด์ที่เปิดไว้ตรงนี้ (ใช้กับไฟล์หรือข้อมูลอ่อนไหวไม่ได้)" defaultChecked={current?.showOnCheckin ?? false} disabled={type === "file"} />
            <Switch id={`field-sensitive-${selected}`} name="sensitive" label="ข้อมูลอ่อนไหว" description="ปิดบังในตาราง ต้องยืนยันก่อนเปิดดูหรือส่งออก และบันทึก audit" defaultChecked={current?.sensitive ?? false} />
            {(type === "select" || type === "radio" || type === "checkbox") && <OptionsEditor initial={current?.options ?? []} />}
            <ConditionEditor field={current} fields={fields} childFields={children} answered={answered} />
          </fieldset>
          {editable && <div className="flex justify-end gap-2">
            {creating && fields.length > 0 && <Button type="button" variant="ghost" onClick={() => setSelected(fields[0].key)}>ยกเลิก</Button>}
            <Button type="submit" disabled={isPending}>{creating ? "เพิ่มฟิลด์" : "บันทึกฟิลด์"}</Button>
          </div>}
        </section>
      </form>}
    </div>
  );
}
