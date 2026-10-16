import type { Metadata } from "next";
import Image from "next/image";
import { redirect } from "next/navigation";
import { LockIcon } from "lucide-react";

import { auth } from "@/auth";
import { ldapEnabled } from "@/server/auth/ldap";
import { safeReturnTo } from "@/server/auth/return-to";
import { db } from "@/server/db";
import { withBasePath } from "@/lib/base-path";

import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "เข้าสู่ระบบ" };

// AD passwords are changed in the hospital intranet, not here.
const FORGOT_PASSWORD_URL = "https://intranet.rpphosp.go.th/forgot-password";

/** Single centred card, same layout as the hospital portal (itrpp/portalrpp) so staff recognise it. */
export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { error, notice, next: nextParam } = await searchParams;
  const next = safeReturnTo(nextParam);
  const session = await auth();
  if (session?.user?.id && error !== "inactive") {
    const user = await db.user.findUnique({ where: { id: session.user.id }, select: { isActive: true } });
    if (user?.isActive) redirect(next ?? "/organizer/dashboard");
  }
  const ldap = ldapEnabled();

  return (
    <main className="flex min-h-svh w-full items-center justify-center bg-linear-to-br from-background via-secondary to-accent px-4 py-10">
      <div className="flex w-full max-w-md flex-col rounded-3xl bg-card/95 p-6 shadow-2xl sm:p-8">
        <div className="flex flex-col items-center text-center">
          <Image src={withBasePath("/images/logo.png")} alt="โรงพยาบาลราชพิพัฒน์" width={90} height={90} priority className="rounded-full bg-background" />
          <h1 className="mt-6 font-heading text-2xl font-extrabold tracking-tight">เข้าสู่ระบบ</h1>
          <p className="mt-1 text-sm text-muted-foreground">AttendPass <span className="max-sm:hidden">· </span><span className="max-sm:block">ลงทะเบียน อนุมัติ และเช็คชื่อผู้เข้าอบรม</span></p>
        </div>

        <div className="mt-6 text-center">
          <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground"><LockIcon className="size-4 text-primary" aria-hidden="true" />{ldap ? "เข้าสู่ระบบด้วยบัญชี Active Directory" : "เข้าสู่ระบบด้วยบัญชีที่ผู้ดูแลระบบสร้างให้"}</p>
          {ldap && <p className="mt-1 text-balance text-xs text-destructive">ใช้ชื่อผู้ใช้และรหัสผ่านเดียว Intranet</p>}
        </div>

        <div className="mt-6 flex flex-col gap-3 empty:hidden">
          {next && !error && <p role="status" className="rounded-lg border bg-card px-3 py-2 text-sm text-muted-foreground">กรุณาเข้าสู่ระบบเพื่อไปยังหน้าที่เปิดไว้ต่อ</p>}
          {error === "inactive" && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">บัญชีนี้ถูกปิดใช้งานหรือหมดสิทธิ์แล้ว กรุณาติดต่อผู้ดูแลระบบ</p>}
          {notice === "password-set" && <p role="status" className="rounded-lg border border-primary/30 bg-accent px-3 py-2 text-sm text-accent-foreground">ตั้งรหัสผ่านเรียบร้อยแล้ว เข้าสู่ระบบด้วยรหัสผ่านใหม่ได้เลย</p>}
        </div>

        <div className="mt-6"><LoginForm next={next} ldap={ldap} /></div>

        <div className="mt-4 flex flex-wrap items-center justify-end gap-x-4 gap-y-1 text-sm text-muted-foreground">
          {ldap
            ? <a href={FORGOT_PASSWORD_URL} target="_blank" rel="noopener noreferrer" className="-mx-2 inline-flex min-h-11 items-center rounded-md px-2 font-medium text-primary underline-offset-4 hover:underline">ลืมรหัสผ่าน?</a>
            : <span className="text-xs">ลืมรหัสผ่าน? ขอลิงก์ตั้งรหัสผ่านจากผู้ดูแลระบบ</span>}
        </div>

        <hr className="my-6 border-border" />

        <p className="text-center text-xs leading-relaxed text-muted-foreground">© {new Date().getFullYear()} โรงพยาบาลราชพิพัฒน์<br />สำหรับเจ้าหน้าที่และผู้จัดโครงการ<span className="max-sm:hidden"> · </span><span className="max-sm:block">ผู้เข้าอบรมไม่ต้องเข้าสู่ระบบ</span></p>
      </div>
    </main>
  );
}
