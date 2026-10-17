import type { Prisma } from "@prisma/client";
import { TrendingUpIcon } from "lucide-react";

import { bangkokToday } from "@/lib/bangkok-today";
import { formatDeadlineDay } from "@/lib/format";
import { db } from "@/server/db";

const TREND_DAYS = 30;
const DAY = 24 * 60 * 60 * 1000;

const number = (value: number) => value.toLocaleString("th-TH");
const bangkokKey = (instant: Date) => new Date(instant.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
const dayLabel = (key: string) => formatDeadlineDay(new Date(`${key}T00:00:00+07:00`));

/**
 * New registrations per Bangkok day over the last TREND_DAYS (single series, so no legend: the heading names it), plus
 * the show-up rate of finished projects — approved people with at least one check-in, over all approved people.
 */
export async function DashboardTrend({ events }: { events: Prisma.EventWhereInput }) {
  const today = bangkokToday();
  const since = new Date(today.start.getTime() - (TREND_DAYS - 1) * DAY);
  const finished: Prisma.EventWhereInput = { AND: [events, { days: { some: {}, every: { date: { lt: today.date } } } }] };
  const [registered, approved, attended, finishedCount] = await Promise.all([
    db.registrant.findMany({ where: { event: events, registeredAt: { gte: since } }, select: { registeredAt: true } }),
    db.registrant.count({ where: { status: "APPROVED", event: finished } }),
    db.checkIn.groupBy({ by: ["registrantId"], where: { voidedAt: null, registrant: { status: "APPROVED", event: finished } } }).then((rows) => rows.length),
    db.event.count({ where: finished }),
  ]);

  const keys = Array.from({ length: TREND_DAYS }, (_, index) => bangkokKey(new Date(since.getTime() + index * DAY)));
  const perDay = new Map(keys.map((key) => [key, 0]));
  for (const { registeredAt } of registered) {
    const key = bangkokKey(registeredAt);
    if (perDay.has(key)) perDay.set(key, perDay.get(key)! + 1);
  }
  const series = keys.map((key) => ({ key, label: dayLabel(key), count: perDay.get(key)! }));
  const peak = Math.max(1, ...series.map((point) => point.count));
  const rate = approved ? Math.round((attended / approved) * 100) : null;

  return <section aria-label="แนวโน้ม" className="grid gap-3 lg:grid-cols-[1fr_16rem]">
    <div className="flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="flex items-center gap-2 font-heading text-base font-bold"><TrendingUpIcon className="size-4 text-primary" aria-hidden="true" />ลงทะเบียนใหม่ต่อวัน</h2>
        <span className="text-xs text-muted-foreground">{TREND_DAYS} วันล่าสุด · รวม <span className="font-semibold text-foreground tabular-nums">{number(registered.length)}</span> คน</span>
      </div>
      <div className="flex gap-2">
        <div className="flex h-36 flex-col justify-between py-0.5 text-right text-[11px] tabular-nums text-muted-foreground" aria-hidden="true"><span>{number(peak)}</span><span>0</span></div>
        <ol aria-label="จำนวนผู้ลงทะเบียนใหม่รายวัน" className="relative flex h-36 min-w-0 flex-1 items-end gap-[2px] border-b border-border">
          <li aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 border-t border-dashed border-border" />
          {series.map((point, index) => <li key={point.key} tabIndex={0} aria-label={`${point.label}: ${number(point.count)} คน`} className="group relative flex h-full min-w-0 flex-1 items-end justify-center outline-none">
            {point.count > 0 && <span className="block w-full max-w-6 rounded-t-[4px] bg-primary group-hover:opacity-80 group-focus-visible:opacity-80" style={{ height: `max(${(point.count / peak) * 100}%, 3px)` }} />}
            <span role="tooltip" className={`pointer-events-none absolute top-0 z-10 hidden whitespace-nowrap rounded-md border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-sm group-hover:block group-focus-visible:block ${index < 4 ? "left-0" : index > TREND_DAYS - 5 ? "right-0" : "left-1/2 -translate-x-1/2"}`}>
              <strong className="tabular-nums">{number(point.count)} คน</strong> <span className="text-muted-foreground">{point.label}</span>
            </span>
          </li>)}
        </ol>
      </div>
      <div className="flex justify-between pl-6 text-[11px] text-muted-foreground" aria-hidden="true"><span>{series[0].label}</span><span>วันนี้</span></div>
      <details className="text-sm">
        <summary className="w-fit cursor-pointer text-xs text-muted-foreground underline-offset-4 hover:underline">ดูเป็นตาราง</summary>
        <table className="mt-2 w-full max-w-xs text-xs">
          <thead><tr className="text-left text-muted-foreground"><th className="py-1 font-medium">วันที่</th><th className="py-1 text-right font-medium">ลงทะเบียนใหม่</th></tr></thead>
          <tbody>{series.toReversed().map((point) => <tr key={point.key} className="border-t"><td className="py-1">{point.label}</td><td className="py-1 text-right tabular-nums">{number(point.count)}</td></tr>)}</tbody>
        </table>
      </details>
    </div>
    <div className="flex flex-col gap-1 rounded-xl border bg-card p-4">
      <span className="text-sm text-muted-foreground">อัตราการมาจริง</span>
      <span className="font-heading text-3xl font-bold tabular-nums">{rate === null ? "—" : `${rate}%`}</span>
      <span className="text-xs text-muted-foreground">{rate === null
        ? "ยังไม่มีโครงการที่จบแล้ว"
        : <>ผู้ที่อนุมัติแล้วเช็คชื่ออย่างน้อย 1 ครั้ง {number(attended)} จาก {number(approved)} คน · {number(finishedCount)} โครงการที่จบแล้ว</>}</span>
    </div>
  </section>;
}
