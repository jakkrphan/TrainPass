"use client";

import { useId, useState, useTransition, type KeyboardEvent } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronDownIcon, LoaderCircleIcon, XIcon } from "lucide-react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const MAX_SHOWN = 50;

/**
 * Type-to-filter picker for server-rendered lists (ARIA combobox): choosing an option sets `?<name>=<value>` and goes
 * back to page 1; the clear button removes it. Matches any part of the label, so long lists stay quick to search.
 */
export function ParamCombobox({ id, name, label, placeholder, value, options, disabled, className }: {
  id: string;
  name: string;
  label: string;
  placeholder: string;
  value: string;
  options: { value: string; label: string }[];
  disabled?: boolean;
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const listId = useId();
  const selected = options.find((option) => option.value === value);
  const [text, setText] = useState(selected?.label ?? "");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const needle = text.trim().toLowerCase();
  const matches = needle && needle !== selected?.label.toLowerCase() ? options.filter((option) => option.label.toLowerCase().includes(needle)) : options;
  const shown = matches.slice(0, MAX_SHOWN);

  function apply(option: { value: string; label: string } | null) {
    setText(option?.label ?? "");
    setOpen(false);
    if ((option?.value ?? "") === value) return;
    const params = new URLSearchParams(searchParams);
    if (option) params.set(name, option.value); else params.delete(name);
    params.delete("page");
    startTransition(() => router.replace(`${pathname}${params.size ? `?${params}` : ""}`, { scroll: false }));
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) { setOpen(true); setActive(0); return; }
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((current) => shown.length ? (current + step + shown.length) % shown.length : 0);
    } else if (event.key === "Enter" && open) {
      event.preventDefault();
      if (shown[active]) apply(shown[active]);
    } else if (event.key === "Escape") {
      setOpen(false);
      setText(selected?.label ?? "");
    }
  }

  return <div className={cn("relative w-full sm:w-64", className)}>
    <label htmlFor={id} className="sr-only">{label}</label>
    <Input id={id} type="text" role="combobox" autoComplete="off" value={text} placeholder={placeholder} disabled={disabled}
      aria-expanded={open} aria-controls={listId} aria-autocomplete="list" aria-busy={pending}
      aria-activedescendant={open && shown[active] ? `${listId}-${active}` : undefined}
      className="h-10 truncate bg-card pr-16"
      onChange={(event) => { setText(event.target.value); setOpen(true); setActive(0); }}
      onFocus={(event) => { event.currentTarget.select(); setOpen(true); setActive(0); }}
      onBlur={() => { setOpen(false); setText(selected?.label ?? ""); }}
      onKeyDown={onKeyDown} />
    <span className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
      {pending ? <LoaderCircleIcon className="size-4 animate-spin text-muted-foreground" aria-label="กำลังกรอง" />
        : value && !disabled ? <button type="button" aria-label={`ล้างตัวกรอง${label}`} onMouseDown={(event) => event.preventDefault()} onClick={() => apply(null)} className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"><XIcon className="size-4" aria-hidden="true" /></button>
        : null}
      <ChevronDownIcon className="pointer-events-none size-4 text-muted-foreground" aria-hidden="true" />
    </span>
    {open && <ul id={listId} role="listbox" aria-label={label} className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border bg-popover p-1 text-sm shadow-lg">
      {shown.length ? shown.map((option, index) => <li key={option.value} id={`${listId}-${index}`} role="option" aria-selected={option.value === value}
        onMouseDown={(event) => event.preventDefault()} onClick={() => apply(option)} onMouseEnter={() => setActive(index)}
        className={cn("cursor-pointer truncate rounded-md px-2.5 py-2", index === active && "bg-muted", option.value === value && "font-semibold")}>{option.label}</li>)
        : <li className="px-2.5 py-2 text-muted-foreground">ไม่พบชื่อที่ตรงกับ “{text.trim()}”</li>}
      {matches.length > MAX_SHOWN && <li className="px-2.5 py-1.5 text-xs text-muted-foreground">แสดง {MAX_SHOWN} จาก {matches.length} ชื่อ · พิมพ์เพิ่มเพื่อค้นให้แคบลง</li>}
    </ul>}
  </div>;
}
