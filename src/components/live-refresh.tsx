"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { withBasePath } from "@/lib/base-path";

/**
 * Polls a cheap state endpoint with If-None-Match and re-renders the page only when the server reports a change.
 * Pauses while the tab is hidden; falls back to a plain refresh if the endpoint fails.
 */
export function LiveRefresh({ url, intervalMs = 4000 }: { url: string; intervalMs?: number }) {
  const router = useRouter();
  const etag = useRef<string | null>(null);
  const since = useRef<number>(0);

  useEffect(() => {
    let timer: number | undefined;
    let cancelled = false;
    etag.current = null;

    async function poll() {
      try {
        const target = `${url}${url.includes("?") ? "&" : "?"}since=${since.current}`;
        const response = await fetch(withBasePath(target), { cache: "no-store", headers: etag.current ? { "If-None-Match": etag.current } : {} });
        if (cancelled || response.status === 304) return;
        if (!response.ok) { router.refresh(); return; }
        const body = await response.json() as { serverTime?: number };
        const next = response.headers.get("ETag");
        const changed = etag.current !== null && next !== etag.current;
        etag.current = next;
        if (typeof body.serverTime === "number") since.current = body.serverTime;
        if (changed) router.refresh();
      } catch {
        // Offline: the scanner's own queue handles pending scans; try again on the next tick.
      }
    }

    const stop = () => { if (timer !== undefined) window.clearInterval(timer); timer = undefined; };
    const start = () => { stop(); if (document.visibilityState === "visible") { void poll(); timer = window.setInterval(() => void poll(), intervalMs); } };
    start();
    document.addEventListener("visibilitychange", start);
    return () => { cancelled = true; stop(); document.removeEventListener("visibilitychange", start); };
  }, [url, intervalMs, router]);

  return null;
}
