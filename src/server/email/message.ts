import { createHash } from "node:crypto";

import type { Prisma, RegistrantStatus } from "@prisma/client";

import { formatEventDayWithWeekday } from "@/lib/format";

export const emailRecipientSelect = {
  id: true, email: true, displayName: true, status: true, statusTokenHash: true, qrCode: true, rejectReason: true,
  emailNotifiedHash: true, notifyVia: true, lineUserId: true, anonymizedAt: true,
  days: { select: { eventDayId: true, status: true } },
  event: { select: { title: true, location: true, slug: true, seatMode: true, deletedAt: true, anonymizedAt: true, days: { orderBy: { date: "asc" }, select: { id: true, date: true } } } },
} satisfies Prisma.RegistrantSelect;
export type EmailRecipient = Prisma.RegistrantGetPayload<{ select: typeof emailRecipientSelect }>;

/** Content-ID of the inline QR attachment, referenced by the ticket HTML. RFC 2392 form (with "@"): clients such as Outlook and webmail ignore a bare id. */
export const QR_CONTENT_ID = "checkin-qr@checkinhub";

const statusWords: Record<RegistrantStatus, string> = {
  APPROVED: "อนุมัติแล้ว", PENDING: "รอผู้จัดอนุมัติ", WAITLISTED: "อยู่ในคิวสำรอง", REJECTED: "ไม่ได้รับอนุมัติ", CANCELLED: "ยกเลิกแล้ว",
};
const heroWords: Record<RegistrantStatus, string> = {
  APPROVED: "ลงทะเบียนสำเร็จ · พร้อมเช็คชื่อ", PENDING: "ลงทะเบียนสำเร็จ · รออนุมัติ", WAITLISTED: "ลงทะเบียนสำเร็จ · อยู่ในคิวรอ", REJECTED: "ไม่ได้รับอนุมัติ", CANCELLED: "ยกเลิกแล้ว",
};

/** Persist a fingerprint, never a second copy of the email, reason or QR bearer code. */
export function emailSnapshot(person: EmailRecipient) {
  return createHash("sha256").update(JSON.stringify({
    email: person.email, status: person.status, reason: person.rejectReason,
    qr: person.qrCode, token: person.statusTokenHash,
    days: [...person.days].sort((a, b) => a.eventDayId.localeCompare(b.eventDayId)),
  })).digest("hex");
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);

const shortDay = new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", timeZone: "UTC" });
// Mirrors globals.css; mail clients ignore CSS variables and <style> support varies, so every style is inline.
const color = { primary: "#0e6b58", page: "#f6f4ef", card: "#ffffff", text: "#1b1a17", muted: "#625e56", border: "#e4e0d6" };
const dayColor: Record<RegistrantStatus, string> = { APPROVED: "#15803d", PENDING: color.muted, WAITLISTED: "#b45309", REJECTED: "#b91c1c", CANCELLED: color.muted };
const font = "font-family:Sarabun,'Leelawadee UI',Tahoma,sans-serif";
const table = `role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"`;

type TicketDay = { number: number; date: Date; status: RegistrantStatus };

/** Same ticket as the status page, in table markup: the only layout Gmail, Outlook and phone mail apps render consistently. */
function ticketHtml(person: EmailRecipient, days: TicketDay[], statusUrl: string, approved: boolean) {
  const e = escapeHtml;
  const name = person.displayName ?? person.email ?? "ผู้ลงทะเบียน";
  const active = ["APPROVED", "PENDING", "WAITLISTED"].includes(person.status);
  const approvedDays = days.filter((day) => day.status === "APPROVED").map((day) => `${shortDay.format(day.date)} (วันที่ ${day.number})`).join(", ") || "—";
  const label = `margin:0;font-size:12px;color:${color.muted}`;
  const ticketBody = approved ? `<tr><td style="padding:16px 0 0"><div style="border-top:2px dashed ${color.border};font-size:0;line-height:0">&nbsp;</div></td></tr>
<tr><td align="center" style="padding:20px 0 8px"><img src="cid:${QR_CONTENT_ID}" width="208" height="208" alt="QR สำหรับเช็คชื่อ" style="display:block;width:208px;height:208px;border:0"></td></tr>
<tr><td align="center" style="padding:0 0 4px;font-family:monospace;font-size:14px;font-weight:bold;word-break:break-all;color:${color.text}">${e(person.qrCode!)}</td></tr>
<tr><td align="center" style="padding:0 0 16px;${font};font-size:12px;color:${color.muted}">รหัสสุ่ม ใช้ QR นี้เช็คชื่อได้ทุกรอบของวันที่ได้รับอนุมัติ</td></tr>
<tr><td style="border-top:1px solid ${color.border};padding:12px 0 0"><table ${table}><tr>
<td valign="top" style="${font};font-size:14px;color:${color.text}"><p style="${label}">ผู้เข้าร่วม</p><strong>${e(name)}</strong></td>
<td valign="top" align="right" style="${font};font-size:14px;color:${color.text}"><p style="${label}">วันที่</p><strong>${e(approvedDays)}</strong></td>
</tr></table></td></tr>` : `<tr><td style="padding:12px 0 0;${font};font-size:14px;color:${color.text}"><p style="${label}">ผู้ลงทะเบียน</p><strong>${e(name)}</strong></td></tr>`;
  // Every selected day keeps its own status, so mixed approval/waitlist results stay visible.
  const cell = `padding:8px 0;${font};font-size:14px;border-top:1px solid ${color.border}`;
  const dayRows = days.map((day) => `<tr><td style="${cell};color:${color.text}">วันที่ ${day.number} · ${e(formatEventDayWithWeekday(day.date))}</td><td align="right" style="${cell};font-weight:bold;color:${dayColor[day.status]}">${statusWords[day.status]}</td></tr>`).join("");
  const course = person.event.seatMode === "whole_course" ? `<p style="margin:0 0 8px;font-size:14px;color:${color.text}">หลักสูตร ${person.event.days.length} วัน: <strong>${statusWords[person.status]}</strong></p>` : "";
  const reason = person.days.some((day) => day.status === "REJECTED") && person.rejectReason ? `<p style="margin:12px 0 0;padding:12px;border-radius:8px;background:${color.page};font-size:14px;color:${color.text}">เหตุผลจากผู้จัด: ${e(person.rejectReason)}</p>` : "";
  return `<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><title>${e(person.event.title)}</title></head>
<body style="margin:0;padding:0;background:${color.page};${font}">
<table ${table} style="background:${color.page}"><tr><td align="center" style="padding:24px 12px">
<table ${table} style="max-width:560px;background:${active ? color.primary : color.muted};border-radius:16px">
<tr><td align="center" style="padding:20px 16px 16px;${font};font-size:18px;font-weight:bold;color:#ffffff">${active ? "&#10003; " : ""}${heroWords[person.status]}</td></tr>
<tr><td style="padding:0 16px"><table ${table} style="background:${color.card};border-radius:16px"><tr><td style="padding:20px"><table ${table}>
<tr><td style="${font}"><p style="${label}">${approved ? "บัตรเข้าร่วมอบรม" : "ผลการลงทะเบียน"}</p>
<h1 style="margin:4px 0 0;font-size:20px;line-height:1.4;font-weight:bold;color:${color.text}">${e(person.event.title)}</h1>${person.event.location ? `
<p style="margin:4px 0 0;font-size:14px;color:${color.muted}">${e(person.event.location)}</p>` : ""}</td></tr>
${ticketBody}
</table></td></tr></table></td></tr>
<tr><td align="center" style="padding:14px 16px 20px;${font};font-size:12px;color:#ffffff">${approved ? "ใช้ QR เดียวกันเช็คชื่อได้ในวันที่อนุมัติแล้ว · แสดง QR ที่จุดลงทะเบียน" : "ดูสถานะล่าสุดได้จากปุ่มด้านล่าง"}</td></tr>
</table>
<table ${table} style="max-width:560px;margin-top:16px;background:${color.card};border:1px solid ${color.border};border-radius:16px"><tr><td style="padding:20px;${font}">
<p style="margin:0 0 8px;font-size:16px;font-weight:bold;color:${color.text}">สถานะแต่ละวัน</p>
${course}<table ${table}>${dayRows}</table>${reason}
<table ${table} style="margin-top:20px"><tr><td align="center" style="border-radius:10px;background:${color.text}"><a href="${e(statusUrl)}" style="display:block;padding:14px 16px;${font};font-size:16px;font-weight:bold;color:#ffffff;text-decoration:none">ดูสถานะและรายละเอียด</a></td></tr></table>
</td></tr></table>
<p style="max-width:560px;margin:16px auto 0;${font};font-size:12px;line-height:1.6;color:${color.muted};text-align:center">ลิงก์และ QR นี้เป็นของคุณ กรุณาอย่าส่งต่อให้ผู้อื่น<br>โรงพยาบาลราชพิพัฒน์ · ระบบ AttendPass</p>
</td></tr></table></body></html>`;
}

export function buildEmailMessage(person: EmailRecipient, statusUrl: string) {
  const approved = person.status === "APPROVED" && person.days.some((day) => day.status === "APPROVED") && !!person.qrCode;
  const days = person.event.days.flatMap((day, index): TicketDay[] => {
    const selected = person.days.find((item) => item.eventDayId === day.id);
    return selected ? [{ number: index + 1, date: day.date, status: selected.status }] : [];
  });
  const lines = [person.event.title, ...(person.event.location ? [person.event.location] : []), "", "ผลการลงทะเบียนของคุณ"];
  if (person.event.seatMode === "whole_course") lines.push(`หลักสูตร ${person.event.days.length} วัน: ${statusWords[person.status]}`);
  // Include the complete current state, including mixed approval/waitlist days.
  for (const day of days) lines.push(`วันที่ ${day.number} (${formatEventDayWithWeekday(day.date)}): ${statusWords[day.status]}`);
  if (person.days.some((day) => day.status === "REJECTED") && person.rejectReason) lines.push("", `เหตุผล: ${person.rejectReason}`);
  if (approved) lines.push("", "แนบ QR สำหรับเช็คชื่อแล้ว ใช้ได้เฉพาะวันที่ได้รับอนุมัติ กรุณาแสดง QR ที่จุดลงทะเบียน");
  lines.push("", `ดูสถานะล่าสุดและรายละเอียด: ${statusUrl}`, "", "ลิงก์และ QR นี้เป็นของคุณ กรุณาอย่าส่งต่อให้ผู้อื่น");
  return {
    subject: `โรงพยาบาลราชพิพัฒน์ — ผลการลงทะเบียน: ${statusWords[person.status]} · ${person.event.title}`.replace(/[\r\n]+/g, " "),
    text: lines.join("\n"),
    html: ticketHtml(person, days, statusUrl, approved),
    attachQr: approved,
  };
}

/** An organizer's announcement (spec: broadcast): their words, the event, and a button to the person's status page. No QR. */
export function buildAnnouncementEmail(person: EmailRecipient, announcement: { subject: string; body: string }, statusUrl: string) {
  const e = escapeHtml;
  const paragraphs = announcement.body.split(/\r?\n/).map((line) => line.trim() ? `<p style="margin:0 0 8px;font-size:15px;line-height:1.7;color:${color.text}">${e(line)}</p>` : "").join("");
  const html = `<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><title>${e(announcement.subject)}</title></head>
<body style="margin:0;padding:0;background:${color.page};${font}">
<table ${table} style="background:${color.page}"><tr><td align="center" style="padding:24px 12px">
<table ${table} style="max-width:560px;background:${color.card};border:1px solid ${color.border};border-radius:16px"><tr><td style="padding:24px;${font}">
<p style="margin:0;font-size:12px;font-weight:bold;color:#b45309">ประกาศจากผู้จัด</p>
<p style="margin:4px 0 0;font-size:14px;color:${color.muted}">${e(person.event.title)}</p>
<h1 style="margin:8px 0 16px;font-size:20px;line-height:1.4;font-weight:bold;color:${color.text}">${e(announcement.subject)}</h1>
${paragraphs}
<table ${table} style="margin-top:20px"><tr><td align="center" style="border-radius:10px;background:${color.text}"><a href="${e(statusUrl)}" style="display:block;padding:14px 16px;${font};font-size:16px;font-weight:bold;color:#ffffff;text-decoration:none">ดูสถานะการลงทะเบียน</a></td></tr></table>
</td></tr></table>
<p style="max-width:560px;margin:16px auto 0;${font};font-size:12px;line-height:1.6;color:${color.muted};text-align:center">คุณได้รับอีเมลนี้เพราะลงทะเบียนโครงการนี้ไว้<br>โรงพยาบาลราชพิพัฒน์ · ระบบ AttendPass</p>
</td></tr></table></body></html>`;
  return {
    subject: `โรงพยาบาลราชพิพัฒน์ — ประกาศ: ${announcement.subject} · ${person.event.title}`.replace(/[\r\n]+/g, " "),
    text: ["ประกาศจากผู้จัด", person.event.title, "", announcement.subject, "", announcement.body, "", `ดูสถานะการลงทะเบียน: ${statusUrl}`].join("\n"),
    html,
    attachQr: false,
  };
}
