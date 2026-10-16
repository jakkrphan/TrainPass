"use client";

import "./globals.css";

// Replaces the root layout when it fails, so it must render its own document.
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <html lang="th">
    <body className="flex min-h-svh items-center justify-center bg-background px-5 text-foreground">
      <title>เกิดข้อผิดพลาด | TrainPass</title>
      <main className="flex max-w-md flex-col items-center gap-4 text-center">
        <h1 className="font-heading text-2xl font-bold">ระบบขัดข้องชั่วคราว</h1>
        <p className="text-sm text-muted-foreground">กรุณาลองใหม่อีกครั้ง หากยังไม่ได้ให้แจ้งผู้ดูแลระบบ{error.digest ? ` พร้อมรหัสอ้างอิง ${error.digest}` : ""}</p>
        <button type="button" onClick={() => retry()} className="h-10 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground">ลองอีกครั้ง</button>
      </main>
    </body>
  </html>;
}
