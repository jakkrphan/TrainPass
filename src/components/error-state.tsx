"use client";

import { useEffect } from "react";
import Link from "next/link";
import { TriangleAlertIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { StatusPage } from "@/components/status-page";

/** Body shared by the route-group error boundaries; shows the error reference so staff can match server logs. */
export function ErrorState({ error, retry, homeHref, homeLabel, fullPage = false }: {
  error: Error & { digest?: string };
  retry: () => void;
  homeHref: string;
  homeLabel: string;
  fullPage?: boolean;
}) {
  // Log only the reference: the message of a client-side error can contain personal data (PDPA).
  useEffect(() => { console.error(`AttendPass error ${error.digest ?? error.name}`); }, [error]);
  return <StatusPage fullPage={fullPage} icon={TriangleAlertIcon} tone="danger" code={error.digest ? `รหัสอ้างอิง ${error.digest}` : undefined}
    title="เกิดข้อผิดพลาดชั่วคราว"
    description="ระบบทำรายการนี้ไม่สำเร็จ ข้อมูลที่บันทึกไปแล้วยังอยู่ครบ ลองอีกครั้ง หากยังไม่ได้ให้แจ้งผู้ดูแลระบบพร้อมรหัสอ้างอิง"
    actions={<><Button type="button" onClick={() => retry()}>ลองอีกครั้ง</Button><Button asChild variant="outline"><Link href={homeHref}>{homeLabel}</Link></Button></>} />;
}
