import Link from "next/link";
import Image from "next/image";
import { LogOutIcon } from "lucide-react";

import { signOut } from "@/auth";
import { Button } from "@/components/ui/button";
import { requireAdminUser } from "@/server/authorization/session";
import { OrganizerNavigation } from "@/app/(organizer)/organizer/navigation";

export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const admin = await requireAdminUser();

  async function logout() {
    "use server";
    await signOut({ redirectTo: "/login" });
  }

  return (
    <div className="flex min-h-svh flex-col lg:flex-row">
      <aside className="flex shrink-0 items-center justify-between gap-2 bg-sidebar px-3 py-2 sm:gap-3 sm:px-4 text-sidebar-foreground lg:min-h-svh lg:w-[236px] lg:flex-col lg:items-stretch lg:justify-start lg:px-3 lg:py-4">
        <Link href="/admin" aria-label="TrainPass · ผู้ดูแลระบบ" className="flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg px-2 text-sidebar-foreground hover:bg-sidebar-accent lg:justify-start">
          <Image src="/images/logo.png" alt="" width={32} height={32} className="size-8 shrink-0 rounded-full bg-background object-contain" />
          <span className="font-heading text-base font-bold max-[359px]:hidden lg:inline">TrainPass</span>
        </Link>
        <OrganizerNavigation isAdmin />
        <div className="hidden flex-1 lg:block" />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex min-h-[60px] flex-wrap items-center justify-between gap-3 border-b bg-card px-4 py-2 sm:px-6 lg:px-8">
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden rounded-md bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-900 sm:inline-flex">Admin</span>
            <div className="hidden min-h-11 items-center gap-2 rounded-full border bg-card px-2 pr-3 sm:flex">
              <span className="flex size-8 items-center justify-center rounded-full bg-accent text-xs font-bold text-accent-foreground">{admin.name.trim().slice(0, 2)}</span>
              <span className="flex flex-col leading-tight"><span className="max-w-48 truncate text-sm font-semibold">{admin.name}</span><span className="text-xs text-muted-foreground">ผู้ดูแลระบบ</span></span>
            </div>
            <form action={logout}><Button type="submit" variant="outline" size="sm" aria-label="ออกจากระบบ"><LogOutIcon data-icon="inline-start" /><span className="hidden sm:inline">ออกจากระบบ</span></Button></form>
          </div>
        </header>
        {children}
      </div>
    </div>
  );
}
