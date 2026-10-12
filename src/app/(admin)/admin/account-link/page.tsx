import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";

import { Badge } from "@/components/ui/badge";
import { accountLinkPath, hashAccountToken } from "@/server/auth/account-tokens";
import { requireAdminUser } from "@/server/authorization/session";
import { db } from "@/server/db";
import { withBasePath } from "@/lib/base-path";

export const metadata: Metadata = { title: "ลิงก์ตั้งรหัสผ่าน", referrer: "no-referrer" };

const dateFormatter = new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok" });

export default async function AccountLinkPage({ searchParams }: PageProps<"/admin/account-link">) {
  await requireAdminUser();
  const { token } = await searchParams;
  const record = typeof token === "string" && token ? await db.userToken.findUnique({
    where: { tokenHash: hashAccountToken(token) },
    select: { kind: true, usedAt: true, expiresAt: true, user: { select: { name: true, email: true } } },
  }) : null;
  const usable = !!record && !record.usedAt && record.expiresAt > new Date();
  const requestHeaders = await headers();
  const origin = process.env.APP_BASE_URL ?? `${requestHeaders.get("x-forwarded-proto") ?? "http"}://${requestHeaders.get("host")}`;

  return <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-5 py-10">
    <Link href="/admin?view=users" className="-my-2.5 inline-block w-fit py-2.5 text-sm text-muted-foreground underline-offset-4 hover:underline">← กลับไปหน้าผู้ใช้</Link>
    <h1 className="font-heading text-2xl font-bold tracking-tight">{record?.kind === "RESET" ? "ลิงก์รีเซ็ตรหัสผ่าน" : "ลิงก์เชิญตั้งรหัสผ่าน"}</h1>
    {usable && typeof token === "string" ? <section className="flex flex-col gap-4 rounded-xl border bg-card p-5">
      <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{record.user.name}</span><span className="text-sm text-muted-foreground">{record.user.email}</span><Badge variant="outline">หมดอายุ {dateFormatter.format(record.expiresAt)}</Badge></div>
      <label htmlFor="account-link" className="text-sm font-medium">คัดลอกลิงก์นี้ส่งให้ผู้ใช้ผ่านช่องทางที่ปลอดภัย</label>
      <input id="account-link" readOnly value={`${origin}${withBasePath(accountLinkPath(token))}`} className="h-10 w-full rounded-md border bg-background px-3 font-mono text-xs" />
      <p className="text-sm text-muted-foreground">ลิงก์ใช้ได้ครั้งเดียว ระบบยังไม่ส่งอีเมลให้อัตโนมัติและไม่เก็บลิงก์ไว้ในรายการผู้ใช้ หากทำหายให้ออกลิงก์ใหม่ (ลิงก์เดิมจะใช้ไม่ได้ทันที)</p>
    </section> : <p role="alert" className="rounded-xl border bg-card p-5 text-sm">ลิงก์นี้ใช้ไม่ได้แล้ว กรุณาออกลิงก์ใหม่จากหน้าผู้ใช้</p>}
  </main>;
}
