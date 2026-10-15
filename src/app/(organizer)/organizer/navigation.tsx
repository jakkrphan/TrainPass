"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarDaysIcon, ClipboardListIcon, LayoutDashboardIcon, ShieldCheckIcon } from "lucide-react";

import { cn } from "@/lib/utils";

const DASHBOARD = "/organizer/dashboard";
const workLinks = [
  { href: DASHBOARD, label: "แดชบอร์ด", icon: LayoutDashboardIcon },
  { href: "/organizer", label: "โครงการ", icon: ClipboardListIcon },
  { href: "/check-in", label: "เช็คชื่อหน้างาน", icon: CalendarDaysIcon },
];
const systemLinks = [{ href: "/admin", label: "ผู้ดูแลระบบ", icon: ShieldCheckIcon }];

function NavLink({ href, label, icon: Icon, active, compact }: { href: string; label: string; icon: typeof ClipboardListIcon; active: boolean; compact: boolean }) {
  return (
    <Link
      href={href}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      title={label}
      className={cn(
        "flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg px-2.5 transition-colors sm:px-3 lg:size-11 lg:px-0",
        !compact && "lg:h-11 lg:w-full lg:justify-start lg:gap-3 lg:px-3",
        active ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground",
      )}
    >
      <Icon aria-hidden="true" />
      <span className={cn("hidden text-sm font-medium", !compact && "lg:inline")}>{label}</span>
    </Link>
  );
}

export function OrganizerNavigation({ isAdmin, compact = false }: { isAdmin: boolean; compact?: boolean }) {
  const pathname = usePathname();
  const wide = !compact;

  return (
    <nav aria-label="เมนูหลัก" className={cn("flex gap-1 sm:gap-2 lg:flex-col", wide && "lg:w-full lg:gap-4")}>
      <div className={cn("flex gap-1 sm:gap-2 lg:flex-col", wide && "lg:gap-1")}>
        <span className={cn("hidden px-3 pb-1 text-[11px] font-bold tracking-wide text-sidebar-foreground/50", wide && "lg:block")}>งานของฉัน</span>
        {workLinks.map(({ href, ...item }) => <NavLink key={href} href={href} {...item} active={pathname.startsWith(href) && (href === DASHBOARD || !pathname.startsWith(DASHBOARD))} compact={compact} />)}
      </div>
      {isAdmin && <div className={cn("flex gap-1 sm:gap-2 lg:flex-col", wide && "lg:gap-1")}>
        <span className={cn("hidden px-3 pb-1 text-[11px] font-bold tracking-wide text-sidebar-foreground/50", wide && "lg:block")}>ระบบ</span>
        {systemLinks.map(({ href, ...item }) => <NavLink key={href} href={href} {...item} active={pathname.startsWith(href)} compact={compact} />)}
      </div>}
    </nav>
  );
}
