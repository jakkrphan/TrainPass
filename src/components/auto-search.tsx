"use client";

import { useEffect, useRef, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { LoaderCircleIcon, SearchIcon } from "lucide-react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const DELAY_MS = 300;

/**
 * Search box for server-rendered lists that updates `?q=` while typing (debounced) and goes back to page 1.
 * Other query params are kept. It is still a GET form, so Enter and no-JS submits work as before.
 */
export function AutoSearch({ id, label, placeholder, defaultValue, className }: {
  id: string;
  label: string;
  placeholder: string;
  defaultValue: string;
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  function search(value: string) {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const next = new URLSearchParams(searchParams);
      const query = value.trim();
      if (query) next.set("q", query); else next.delete("q");
      next.delete("page");
      startTransition(() => router.replace(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false }));
    }, DELAY_MS);
  }

  return <form method="get" role="search" className={cn("relative w-full sm:w-72", className)} onSubmit={(event) => { event.preventDefault(); search(new FormData(event.currentTarget).get("q")?.toString() ?? ""); }}>
    {[...searchParams].filter(([key]) => key !== "q" && key !== "page").map(([key, value]) => <input key={key} type="hidden" name={key} value={value} />)}
    <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
    <label htmlFor={id} className="sr-only">{label}</label>
    <Input id={id} name="q" type="search" defaultValue={defaultValue} maxLength={100} placeholder={placeholder} autoComplete="off" className="h-10 bg-card pl-9 pr-9" onChange={(event) => search(event.target.value)} />
    {pending && <LoaderCircleIcon className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" aria-label="กำลังค้นหา" />}
  </form>;
}
