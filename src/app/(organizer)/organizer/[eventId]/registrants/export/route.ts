import ExcelJS from "exceljs";

import { readFileAnswers, readRegistrationFields } from "@/features/events/registration-fields";
import { requireEventAccess } from "@/server/authorization/event";
import { db } from "@/server/db";
import { isFeatureEnabled } from "@/server/settings/features";

// Neutralise spreadsheet formulas in user-supplied text (CSV/formula injection).
const safeText = (raw: string) => /^[\s]*[=+\-@]/.test(raw) ? `'${raw}` : raw;

function cellText(value: unknown) {
  return safeText(Array.isArray(value) ? value.join("; ") : String(value ?? ""));
}

function csvCell(value: unknown) {
  return `"${cellText(value).replaceAll('"', '""')}"`;
}

const statusLabel: Record<string, string> = { PENDING: "รออนุมัติ", APPROVED: "อนุมัติแล้ว", REJECTED: "ไม่อนุมัติ", WAITLISTED: "คิวสำรอง", CANCELLED: "ยกเลิก" };
const thaiDateTime = new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok" });
const thaiDay = new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeZone: "UTC" });

export async function GET(request: Request, context: RouteContext<"/organizer/[eventId]/registrants/export">) {
  const { eventId } = await context.params;
  const { event, user } = await requireEventAccess(eventId, "view");
  if (!(await isFeatureEnabled("exportData"))) return new Response("ผู้ดูแลระบบปิดการส่งออกรายชื่อไว้", { status: 403, headers: { "content-type": "text/plain; charset=utf-8" } });
  const params = new URL(request.url).searchParams;
  const includeSensitive = params.get("includeSensitive") === "on";
  const xlsx = params.get("format") === "xlsx";
  const [registrants, sessions] = await Promise.all([
    db.registrant.findMany({ where: { eventId }, orderBy: { registeredAt: "asc" }, include: { days: { include: { eventDay: true } }, checkIns: { where: { voidedAt: null } } } }),
    db.session.findMany({ where: { eventId }, orderBy: [{ eventDay: { date: "asc" } }, { sortOrder: "asc" }, { label: "asc" }], include: { eventDay: { select: { date: true } } } }),
  ]);
  const fields = readRegistrationFields(event.fields).filter((field) => includeSensitive || !field.sensitive);
  const sessionHeader = (session: (typeof sessions)[number]) => `เช็คชื่อ: ${session.label} · ${session.eventDay ? (xlsx ? thaiDay.format(session.eventDay.date) : session.eventDay.date.toISOString().slice(0, 10)) : "ทุกวัน"}`;
  const header = ["อีเมล", "สถานะ", "วันที่ลงทะเบียน", "วันที่และสถานะ", ...fields.map((field) => field.label), ...sessions.map(sessionHeader)];
  const rows = registrants.map((person) => {
    const answers = person.answers && typeof person.answers === "object" && !Array.isArray(person.answers) ? person.answers as Record<string, unknown> : {};
    const day = (date: Date) => xlsx ? thaiDay.format(date) : date.toISOString().slice(0, 10);
    const time = (date: Date) => xlsx ? thaiDateTime.format(date) : date.toISOString();
    return [
      person.email ?? "", xlsx ? statusLabel[person.status] : person.status, time(person.registeredAt),
      person.days.map((item) => `${day(item.eventDay.date)}: ${xlsx ? statusLabel[item.status] : item.status}`).join("; "),
      ...fields.map((field) => {
        const answer = answers[field.key];
        return field.type === "file" ? readFileAnswers(answer).map((file) => file.originalName).join(", ") : answer;
      }),
      ...sessions.map((session) => {
        const checkIn = person.checkIns.find((item) => item.sessionId === session.id);
        return checkIn ? time(checkIn.checkedInAt) : "";
      }),
    ];
  });

  await db.auditLog.create({ data: { eventId, actorId: user.id, action: xlsx ? "EXPORT_XLSX" : "EXPORT_CSV", target: eventId, metadata: { rowCount: registrants.length, includeSensitive } } });
  const disposition = (extension: string) => `attachment; filename="registrants-${eventId}.${extension}"`;

  if (!xlsx) {
    const csv = `\uFEFF${[header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
    return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": disposition("csv"), "cache-control": "no-store" } });
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "AttendPass";
  const sheet = workbook.addWorksheet("ผู้ลงทะเบียน", { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.addRow(header).font = { bold: true };
  for (const row of rows) sheet.addRow(row.map(cellText));
  sheet.columns.forEach((column, index) => { column.width = Math.min(48, Math.max(12, String(header[index] ?? "").length + 4)); });
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: header.length } };
  const buffer = await workbook.xlsx.writeBuffer();
  return new Response(new Uint8Array(buffer as ArrayBuffer), { headers: {
    "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "content-disposition": disposition("xlsx"), "cache-control": "no-store",
  } });
}
