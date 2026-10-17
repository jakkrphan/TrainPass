import { z } from "zod";

import { answerMaxLength, type RegistrationFieldConfig } from "@/features/events/registration-fields";

// Importing registrants from a CSV (e.g. a Google Sheet downloaded as CSV) of people who registered elsewhere and
// already hold a QR with their ticket ID. The browser uses this for the column mapping and preview; the server runs
// the same code again on the same text before anything is stored. No Next.js/database imports, so it is unit-tested.

export const IMPORT_MAX_BYTES = 2_000_000;
export const IMPORT_MAX_ROWS = 3000;
/** Marks imported people in Registrant.consentVersion: they consented in the other system, not through this one. */
export const IMPORTED_CONSENT_VERSION = "imported";

/** RFC 4180 CSV: quoted fields, "" escapes, commas/newlines inside quotes, CRLF or LF, an optional UTF-8 BOM. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const source = text.replace(/^﻿/, "");
  for (let index = 0; index < source.length; index++) {
    const character = source[index];
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') { cell += '"'; index++; }
      else if (character === '"') quoted = false;
      else cell += character;
    } else if (character === '"' && cell === "") quoted = true;
    else if (character === ",") { row.push(cell); cell = ""; }
    else if (character === "\n" || character === "\r") {
      if (character === "\r" && source[index + 1] === "\n") index++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += character;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  // Sheets pads trailing empty rows with commas only.
  return rows.filter((cells) => cells.some((value) => value.trim() !== ""));
}

/** Where a CSV column goes: the ticket ID (the QR code), the email, the attended dates, a form field, or nowhere. */
export type ImportTarget = "ignore" | "ticket" | "email" | "dates" | `field:${string}`;

const normalize = (value: string) => value.toLowerCase().replace(/[\s_\-.:()]/g, "");
/**
 * Headers that mean the ticket / the attended dates. Kept narrow on purpose: "รหัสไปรษณีย์", "Birth date" or
 * "Updated date" must not be taken for them (the organizer can still pick any column by hand).
 */
const TICKET_HEADER = /ticket|qr|^รหัส(บัตร|ตั๋ว|ลงทะเบียน|ผู้เข้าร่วม)?$/;
const DATES_HEADER = /^(attending)?dates?$|attending|วันที่เข้า|วันอบรม|^วันที่$/;

/** Importable form fields: everything but file uploads (there is no file to import). */
export const importableFields = (fields: RegistrationFieldConfig[]) => fields.filter((field) => field.type !== "file");

/** A first guess for each column from its header; the organizer can change every one. */
export function guessTargets(headers: string[], fields: RegistrationFieldConfig[]): ImportTarget[] {
  const candidates = importableFields(fields);
  const used = new Set<ImportTarget>();
  const phoneField = candidates.find((field) => field.type === "tel");
  const nameField = candidates.find((field) => field.type === "text" && (/ชื่อ|name/i.test(field.label) || /name/i.test(field.key)));
  return headers.map((header) => {
    const text = normalize(header);
    const byLabel = candidates.find((field) => normalize(field.label) === text || normalize(field.key) === text);
    const guess: ImportTarget = TICKET_HEADER.test(text) ? "ticket"
      : /^e?mail|อีเมล/.test(text) ? "email"
      : DATES_HEADER.test(text) ? "dates"
      : byLabel ? `field:${byLabel.key}`
      : /phone|tel|โทร|mobile/.test(text) && phoneField ? `field:${phoneField.key}`
      : /name|ชื่อ/.test(text) && nameField ? `field:${nameField.key}`
      : "ignore";
    if (guess !== "ignore" && used.has(guess)) return "ignore";
    used.add(guess);
    return guess;
  });
}

/**
 * Ticket IDs as printed in the QR (e.g. REG-43DBA34C): letters, digits, - and _ only. Stored exactly as written,
 * because check-in compares the scanned text with the stored code; duplicates are found ignoring case, as MySQL's
 * collation does for the unique qrCode.
 */
const TICKET = /^[A-Z0-9][A-Z0-9_-]{2,63}$/i;

/**
 * Phone numbers: digits only, and a Thai number whose leading 0 a spreadsheet dropped (838622235) gets it back.
 * Anything that is not 9–10 digits is kept as written for the organizer to fix later.
 */
export function normalizePhone(value: string) {
  const digits = value.replace(/[\s\-().]/g, "");
  if (/^[689][0-9]{8}$/.test(digits)) return `0${digits}`;
  if (/^0[0-9]{9}$/.test(digits)) return digits;
  return value.trim();
}

const thaiMonths = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const thaiMonthsLong = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];

/**
 * The years a written year can mean, most likely first. 4 digits are unambiguous (> 2400 = พ.ศ.). 2 digits are not:
 * "69" is พ.ศ. 2569 but "26" in 17/11/26 is ค.ศ. 2026, so both readings are returned and the event's own days decide.
 */
function fullYears(text: string) {
  const year = Number(text);
  if (text.length <= 2) return [2500 + year - 543, 2000 + year];
  return [year > 2400 ? year - 543 : year];
}

/** Every Y-M-D a date can mean: "17 พ.ย. 69", "17 พฤศจิกายน 2569", "17/11/2569", "17/11/26", "17/11/2026" or "2026-11-17". */
export function importDateCandidates(text: string): string[] {
  const value = text.trim().replace(/\s+/g, " ");
  const pad = (number: number) => String(number).padStart(2, "0");
  const ymd = (years: number[], month: number, day: number) => month >= 1 && month <= 12 && day >= 1 && day <= 31 ? years.map((year) => `${year}-${pad(month)}-${pad(day)}`) : [];
  let match = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (match) return ymd(fullYears(match[1]), Number(match[2]), Number(match[3]));
  match = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (match) return ymd(fullYears(match[3]), Number(match[2]), Number(match[1]));
  match = value.match(/^(\d{1,2}) (\S+) (\d{2}|\d{4})$/);
  if (match) {
    const month = thaiMonths.indexOf(match[2]) + 1 || thaiMonthsLong.indexOf(match[2]) + 1;
    if (month) return ymd(fullYears(match[3]), month, Number(match[1]));
  }
  return [];
}

/** The most likely reading of a date (พ.ศ. for a 2-digit year), or null when it cannot be read. */
export const parseImportDate = (text: string): string | null => importDateCandidates(text)[0] ?? null;

const sameText = (a: string, b: string) => a.normalize("NFC").replace(/\s+/g, " ").trim().toLocaleLowerCase("th-TH") === b.normalize("NFC").replace(/\s+/g, " ").trim().toLocaleLowerCase("th-TH");

/**
 * One imported answer checked like the registration form would check it, so the person can later edit their answers
 * (an option the form does not have would fail every later save). Options match ignoring case and spacing and are
 * stored with the form's spelling. Phones stay lenient: an unchanged stored phone passes later edits anyway.
 */
function importAnswer(field: RegistrationFieldConfig, value: string): { value: string | string[] } | { problem: string } {
  const option = (text: string) => field.options?.find((choice) => sameText(choice, text));
  const choices = () => `ตัวเลือกในฟอร์ม: ${(field.options ?? []).join(", ").slice(0, 120)}`;
  if (field.type === "checkbox") {
    const picked = value.split(/\s*,\s*/).filter(Boolean);
    const unknown = picked.find((item) => !option(item));
    if (unknown) return { problem: `“${field.label}” ไม่มีตัวเลือก “${unknown.slice(0, 40)}” — ${choices()}` };
    return { value: [...new Set(picked.map((item) => option(item)!))] };
  }
  if (field.type === "select" || field.type === "radio") {
    const match = option(value);
    return match ? { value: match } : { problem: `“${field.label}” ไม่มีตัวเลือก “${value.slice(0, 40)}” — ${choices()}` };
  }
  if (field.type === "email") return z.email().max(answerMaxLength("email")).safeParse(value.toLowerCase()).success ? { value: value.toLowerCase() } : { problem: `“${field.label}” ต้องเป็นอีเมล — ได้ “${value.slice(0, 40)}”` };
  if (field.type === "date") {
    const date = parseImportDate(value);
    return date ? { value: date } : { problem: `“${field.label}” อ่านวันที่ “${value.slice(0, 40)}” ไม่ออก` };
  }
  if (field.type === "tel") return { value: normalizePhone(value).slice(0, answerMaxLength("tel")) };
  if (value.length > answerMaxLength(field.type)) return { problem: `“${field.label}” ยาวเกิน ${answerMaxLength(field.type).toLocaleString("en-US")} ตัวอักษร` };
  return { value };
}

export type ImportDay = { id: string; date: Date };
export type ImportItem = { row: number; ticket: string; email: string | null; dayIds: string[]; answers: Record<string, string | string[]> };
export type ImportProblem = { row: number; message: string };

/**
 * Turns the CSV rows (first row = headers) into registrants, or says which rows are wrong. Nothing is imported while
 * any problem remains, so a half-imported sheet can never happen.
 */
export function buildImport(input: { rows: string[][]; targets: ImportTarget[]; fields: RegistrationFieldConfig[]; days: ImportDay[]; seatMode: string }) {
  const problems: ImportProblem[] = [];
  const items: ImportItem[] = [];
  const [, ...body] = input.rows;
  const column = (target: ImportTarget) => input.targets.indexOf(target);
  const ticketColumn = column("ticket");
  const fieldsByKey = new Map(importableFields(input.fields).map((field) => [field.key, field]));
  const dayByDate = new Map(input.days.map((day) => [day.date.toISOString().slice(0, 10), day.id]));
  const wholeCourse = input.seatMode === "whole_course";
  const datesColumn = column("dates");

  if (ticketColumn < 0) problems.push({ row: 0, message: "ยังไม่ได้เลือกคอลัมน์ Ticket ID (รหัสใน QR)" });
  if (!wholeCourse && datesColumn < 0 && input.days.length !== 1) problems.push({ row: 0, message: "ยังไม่ได้เลือกคอลัมน์วันที่เข้าร่วม (โครงการนับที่นั่งรายวันและมีหลายวัน)" });
  for (const target of input.targets) if (target.startsWith("field:") && !fieldsByKey.has(target.slice(6))) problems.push({ row: 0, message: "มีคอลัมน์ที่จับคู่กับฟิลด์ที่ไม่มีในฟอร์มแล้ว — โหลดหน้าใหม่" });
  if (!body.length) problems.push({ row: 0, message: "ไฟล์ไม่มีข้อมูลผู้ลงทะเบียน" });
  if (body.length > IMPORT_MAX_ROWS) problems.push({ row: 0, message: `นำเข้าได้ครั้งละไม่เกิน ${IMPORT_MAX_ROWS.toLocaleString("en-US")} คน` });
  if (problems.length) return { items, problems };

  const seenTickets = new Map<string, number>();
  const seenEmails = new Map<string, number>();
  body.forEach((cells, index) => {
    const row = index + 2; // spreadsheet row number: 1 is the header
    const cell = (at: number) => (at >= 0 ? cells[at] ?? "" : "").trim();
    const ticket = cell(ticketColumn);
    if (!ticket) return problems.push({ row, message: "ไม่มี Ticket ID" });
    if (!TICKET.test(ticket)) return problems.push({ row, message: `Ticket ID “${ticket.slice(0, 40)}” ใช้ได้เฉพาะตัวอักษรอังกฤษ ตัวเลข - และ _ (3–64 ตัว)` });
    const ticketKey = ticket.toLowerCase();
    if (seenTickets.has(ticketKey)) return problems.push({ row, message: `Ticket ID ${ticket} ซ้ำกับแถว ${seenTickets.get(ticketKey)}` });
    seenTickets.set(ticketKey, row);

    const rawEmail = cell(column("email")).toLowerCase();
    if (rawEmail && !z.email().max(191).safeParse(rawEmail).success) return problems.push({ row, message: `อีเมล “${rawEmail.slice(0, 60)}” ไม่ถูกต้อง` });
    if (rawEmail && seenEmails.has(rawEmail)) return problems.push({ row, message: `อีเมลซ้ำกับแถว ${seenEmails.get(rawEmail)}` });
    if (rawEmail) seenEmails.set(rawEmail, row);

    let dayIds: string[];
    if (wholeCourse) dayIds = input.days.map((day) => day.id);
    else if (datesColumn < 0) dayIds = input.days.map((day) => day.id);
    else {
      const parts = cell(datesColumn).split(/[,;\n]/).map((part) => part.trim()).filter(Boolean);
      if (!parts.length) return problems.push({ row, message: "ไม่มีวันที่เข้าร่วม" });
      const ids = new Set<string>();
      for (const part of parts) {
        const candidates = importDateCandidates(part);
        const id = candidates.map((date) => dayByDate.get(date)).find(Boolean);
        if (!id) return problems.push({ row, message: candidates.length ? `วันที่ “${part}” ไม่ใช่วันอบรมของโครงการนี้` : `อ่านวันที่ “${part}” ไม่ออก` });
        ids.add(id);
      }
      dayIds = [...ids];
    }

    const answers: Record<string, string | string[]> = {};
    for (const [at, target] of input.targets.entries()) {
      if (!target.startsWith("field:")) continue;
      const field = fieldsByKey.get(target.slice(6))!;
      const value = cell(at);
      if (!value) continue;
      const checked = importAnswer(field, value);
      if ("problem" in checked) return problems.push({ row, message: checked.problem });
      answers[field.key] = checked.value;
    }
    items.push({ row, ticket, email: rawEmail || null, dayIds, answers });
  });
  return { items, problems };
}
