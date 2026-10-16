"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { isMenuPage, OrganizerNavigation } from "./navigation";
import { withBasePath } from "@/lib/base-path";

export function OrganizerSidebar({ isAdmin, name }: { isAdmin: boolean; name: string }) {
  const pathname = usePathname();
  const compact = pathname === "/organizer/new" || (/^\/organizer\/[^/]+$/.test(pathname) && !isMenuPage(pathname));

  return (
    <aside className={`flex shrink-0 print:hidden items-center justify-between gap-2 bg-sidebar px-3 py-2 sm:gap-3 sm:px-4 text-sidebar-foreground lg:min-h-svh lg:flex-col lg:justify-start lg:py-4 ${compact ? "lg:w-[72px] lg:items-center lg:px-2" : "lg:w-[236px] lg:items-stretch lg:px-3"}`}>
      <Link href="/organizer/dashboard" aria-label="AttendPass · แดชบอร์ด" className={`flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg px-2 text-sidebar-foreground hover:bg-sidebar-accent ${compact ? "" : "min-[1280px]:justify-start"}`}>
        <Image src={withBasePath("/images/logo.png")} alt="" width={32} height={32} className="size-8 shrink-0 rounded-full bg-background object-contain" />
        <span className={`font-heading text-base font-bold max-[359px]:hidden lg:hidden ${compact ? "" : "lg:inline"}`}>AttendPass</span>
      </Link>
      <OrganizerNavigation isAdmin={isAdmin} compact={compact} />
      <div className="hidden flex-1 lg:block" />
      <Link href="/account/password" aria-label={`บัญชีของฉัน · ${name}`} title={`บัญชีของฉัน · ${name}`} className="hidden size-9 items-center justify-center rounded-full bg-sidebar-accent text-xs font-semibold hover:ring-2 hover:ring-sidebar-ring lg:flex">{name.trim().slice(0, 2)}</Link>
    </aside>
  );
}
