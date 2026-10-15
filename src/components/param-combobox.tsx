"use client";

import { useEffect, useId, useRef, useState, useTransition, type KeyboardEvent } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronDownIcon, LoaderCircleIcon, XIcon } from "lucide-react";

import { Input } from "@/components/ui/input";
import { withBasePath } from "@/lib/base-path";
import { cn } from "@/lib/utils";

type Option = { value: string; label: string };
const DELAY_MS = 200;

/**
 * Type-to-search picker for server-rendered lists (ARIA combobox). Options come from `endpoint?q=` (JSON
 * `{ options, more }`), so long lists are searched on the server. Choosing one sets `?<name>=<value>` and goes back to
 * page 1; the clear button removes it.
 */
export function ParamCombobox({ id, name, label, placeholder, endpoint, value, selectedLabel, disabled, className }: {
  id: string;
  name: string;
  label: string;
  placeholder: string;
  /** App path (no base path) answering `?q=` with `{ options: Option[], more: boolean }`. */
  endpoint: string;
  value: string;
  /** Label of `value`, resolved by the server. */
  selectedLabel: string;
  disabled?: boolean;
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [navigating, startTransition] = useTransition();
  const listId = useId();
  // The last choice, kept until the URL catches up so blur/Escape never flash the previous name.
  const [committed, setCommitted] = useState<Option>({ value, label: selectedLabel });
  const [synced, setSynced] = useState(value);
  const [text, setText] = useState(selectedLabel);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [results, setResults] = useState<{ options: Option[]; more: boolean } | null>(null);
  const [loading, setLoading] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => { window.clearTimeout(timer.current); request.current?.abort(); }, []);

  // The filter changed from outside (Back/Forward, another link): show what the URL now says.
  if (value !== synced) {
    setSynced(value);
    setCommitted({ value, label: selectedLabel });
    setText(selectedLabel);
  }

  function load(query: string) {
    window.clearTimeout(timer.current);
    setLoading(true);
    timer.current = window.setTimeout(async () => {
      request.current?.abort();
      const controller = new AbortController();
      request.current = controller;
      try {
        const response = await fetch(withBasePath(`${endpoint}?${new URLSearchParams({ q: query })}`), { signal: controller.signal });
        setResults(response.ok ? await response.json() : { options: [], more: false });
        setActive(0);
      } catch (error) {
        if ((error as Error).name !== "AbortError") setResults({ options: [], more: false });
        else return;
      }
      setLoading(false);
    }, DELAY_MS);
  }

  function apply(option: Option | null) {
    const next = option ?? { value: "", label: "" };
    setCommitted(next);
    setText(next.label);
    setOpen(false);
    if (next.value === committed.value) return;
    const params = new URLSearchParams(searchParams);
    if (next.value) params.set(name, next.value); else params.delete(name);
    params.delete("page");
    startTransition(() => router.replace(`${pathname}${params.size ? `?${params}` : ""}`, { scroll: false }));
  }

  function openList(query: string) {
    setOpen(true);
    load(query === committed.label ? "" : query.trim());
  }

  const shown = results?.options ?? [];
  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) { openList(text); return; }
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((current) => shown.length ? (current + step + shown.length) % shown.length : 0);
    } else if (event.key === "Enter" && open) {
      event.preventDefault();
      if (shown[active] && !loading) apply(shown[active]);
    } else if (event.key === "Escape") {
      setOpen(false);
      setText(committed.label);
    }
  }

  return <div className={cn("relative w-full sm:w-64", className)}>
    <label htmlFor={id} className="sr-only">{label}</label>
    <Input id={id} type="text" role="combobox" autoComplete="off" value={text} placeholder={placeholder} disabled={disabled}
      aria-expanded={open} aria-controls={listId} aria-autocomplete="list" aria-busy={loading || navigating}
      aria-activedescendant={open && shown[active] ? `${listId}-${active}` : undefined}
      className="h-10 truncate bg-card pr-16"
      onChange={(event) => { setText(event.target.value); openList(event.target.value); }}
      onFocus={(event) => { event.currentTarget.select(); openList(""); }}
      onBlur={() => { setOpen(false); setText(committed.label); }}
      onKeyDown={onKeyDown} />
    <span className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
      {navigating ? <LoaderCircleIcon className="size-4 animate-spin text-muted-foreground" aria-label="กำลังกรอง" />
        : committed.value && !disabled ? <button type="button" aria-label={`ล้างตัวกรอง${label}`} onMouseDown={(event) => event.preventDefault()} onClick={() => apply(null)} className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"><XIcon className="size-4" aria-hidden="true" /></button>
        : null}
      <ChevronDownIcon className="pointer-events-none size-4 text-muted-foreground" aria-hidden="true" />
    </span>
    {open && <ul id={listId} role="listbox" aria-label={label} className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border bg-popover p-1 text-sm shadow-lg">
      {!results ? <li className="px-2.5 py-2 text-muted-foreground">กำลังค้นหา…</li>
        : shown.length ? shown.map((option, index) => <li key={option.value} id={`${listId}-${index}`} role="option" aria-selected={option.value === committed.value}
          onMouseDown={(event) => event.preventDefault()} onClick={() => apply(option)} onMouseEnter={() => setActive(index)}
          className={cn("cursor-pointer truncate rounded-md px-2.5 py-2", index === active && "bg-muted", option.value === committed.value && "font-semibold", loading && "opacity-60")}>{option.label}</li>)
        : <li className="px-2.5 py-2 text-muted-foreground">{loading ? "กำลังค้นหา…" : `ไม่พบชื่อที่ตรงกับ “${text.trim()}”`}</li>}
      {results?.more && <li className="px-2.5 py-1.5 text-xs text-muted-foreground">แสดง {shown.length} ชื่อแรก · พิมพ์เพิ่มเพื่อค้นให้แคบลง</li>}
    </ul>}
  </div>;
}
