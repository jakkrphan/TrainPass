import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeftIcon, DownloadIcon } from "lucide-react";

import { PrintButton } from "@/components/print-button";
import { Button } from "@/components/ui/button";
import { formatDeadlineDay, formatEventDayList } from "@/lib/format";
import { requireEventAccess } from "@/server/authorization/event";
import { db } from "@/server/db";
import { registrationQrSvg, shortEventUrl } from "@/server/events/public-url";
import { withBasePath } from "@/lib/base-path";

export const metadata: Metadata = { title: "พิมพ์ QR ลงทะเบียน" };

/** A4 poster of the registration QR; the organizer chrome is hidden when printing. */
export default async function RegistrationPosterPage({ params }: PageProps<"/organizer/[eventId]/poster">) {
  const { eventId } = await params;
  const { event } = await requireEventAccess(eventId, "manage");
  const days = await db.eventDay.findMany({ where: { eventId }, select: { date: true }, orderBy: { date: "asc" } });
  const url = await shortEventUrl(event.slug);
  const svg = await registrationQrSvg(url);

  return <main className="flex flex-1 flex-col items-center gap-5 bg-muted/40 px-4 py-6 print:bg-white print:p-0">
    <style>{"@page { size: A4 portrait; margin: 12mm; }"}</style>
    <div className="flex w-full max-w-[210mm] flex-wrap items-center justify-between gap-3 print:hidden">
      <Button asChild variant="outline"><Link href={`/organizer/${eventId}?step=5`}><ArrowLeftIcon data-icon="inline-start" aria-hidden="true" />กลับไปหน้าเผยแพร่</Link></Button>
      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline" size="lg"><a href={withBasePath(`/organizer/${eventId}/qr`)} download><DownloadIcon data-icon="inline-start" aria-hidden="true" />ดาวน์โหลด PNG</a></Button>
        <PrintButton label="พิมพ์โปสเตอร์" />
      </div>
    </div>
    {event.status !== "PUBLISHED" && <p role="status" className="w-full max-w-[210mm] rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-900 print:hidden">โครงการยังไม่เผยแพร่ — สแกนแล้วจะยังลงทะเบียนไม่ได้จนกว่าจะกดเผยแพร่</p>}

    <article className="flex aspect-[210/297] w-full max-w-[210mm] flex-col items-center justify-between gap-6 rounded-xl border bg-white px-[8%] py-[7%] text-center text-black shadow-sm print:aspect-auto print:h-[270mm] print:max-w-none print:rounded-none print:border-0 print:shadow-none">
      <header className="flex flex-col items-center gap-3">
        <p className="rounded-full border-2 border-black px-4 py-1 text-sm font-semibold tracking-wide">ลงทะเบียนเข้าร่วมอบรม</p>
        <h1 className="font-heading text-[clamp(1.5rem,4.5vw,2.6rem)] font-bold leading-tight text-balance print:text-[26pt]">{event.title}</h1>
        <div className="flex flex-col gap-1 text-base print:text-[13pt]">
          {days.length > 0 && <p><span className="font-semibold">วันที่</span> {formatEventDayList(days.map((day) => day.date))}</p>}
          {event.location && <p><span className="font-semibold">สถานที่</span> {event.location}</p>}
        </div>
      </header>
      <div className="flex w-full flex-col items-center gap-3">
        <div role="img" aria-label={`QR code ลิงก์ลงทะเบียน ${url}`} className="aspect-square w-[62%] max-w-[120mm] [&>svg]:size-full" dangerouslySetInnerHTML={{ __html: svg }} />
        <p className="font-heading text-xl font-bold print:text-[18pt]">สแกนเพื่อลงทะเบียน</p>
        <p className="break-all font-mono text-sm print:text-[11pt]">{url.replace(/^https?:\/\//, "")}</p>
      </div>
      {event.registrationDeadline && <p className="text-sm print:text-[12pt]">ปิดรับลงทะเบียน {formatDeadlineDay(event.registrationDeadline)}</p>}
    </article>
  </main>;
}
