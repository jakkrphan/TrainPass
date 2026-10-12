import { notFound } from "next/navigation";

import { db } from "@/server/db";
import { isFeatureEnabled } from "@/server/settings/features";
import { statusTokenWhere } from "@/server/registrations/status-token";

function escapeIcs(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

function foldIcsLine(line: string) {
  const chunks: string[] = [];
  let chunk = "";
  for (const character of line) {
    if (Buffer.byteLength(chunk + character, "utf8") > 73) {
      chunks.push(chunk);
      chunk = ` ${character}`;
    } else chunk += character;
  }
  chunks.push(chunk);
  return chunks.join("\r\n");
}

function calendarDate(date: Date) {
  return date.toISOString().slice(0, 10).replaceAll("-", "");
}

function nextDay(date: Date) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

export async function GET(_request: Request, { params }: RouteContext<"/events/[slug]/status/[token]/calendar">) {
  if (!(await isFeatureEnabled("calendarDownload"))) notFound();
  const { slug, token } = await params;
  const registrant = await db.registrant.findUnique({
    where: await statusTokenWhere(token),
    select: {
      status: true,
      event: { select: { slug: true, title: true, location: true, deletedAt: true } },
      days: { where: { status: "APPROVED" }, orderBy: { eventDay: { date: "asc" } }, select: { eventDay: { select: { id: true, date: true } } } },
    },
  });
  if (!registrant || registrant.event.slug !== slug || registrant.event.deletedAt) notFound();
  if (registrant.status !== "APPROVED") {
    return new Response("Calendar is available after approval.", { status: 403 });
  }

  const stamp = new Date().toISOString().replaceAll("-", "").replaceAll(":", "").replace(/\.\d{3}/, "");
  const events = registrant.days.map(({ eventDay }) => [
    "BEGIN:VEVENT",
    `UID:${eventDay.id}@checkinhub`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${calendarDate(eventDay.date)}`,
    `DTEND;VALUE=DATE:${calendarDate(nextDay(eventDay.date))}`,
    `SUMMARY:${escapeIcs(registrant.event.title)}`,
    ...(registrant.event.location ? [`LOCATION:${escapeIcs(registrant.event.location)}`] : []),
    "END:VEVENT",
  ].join("\r\n"));

  const body = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//TrainPass//Training Calendar//TH",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    ...events,
    "END:VCALENDAR",
    "",
  ].map(foldIcsLine).join("\r\n");

  return new Response(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'attachment; filename="checkinhub-training.ics"',
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
