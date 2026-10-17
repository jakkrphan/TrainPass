// Unit tests for importing registrants from a CSV (e.g. a Google Sheet): parsing, column guesses, phones, Thai dates,
// and the rows that must stop an import.
import assert from "node:assert/strict";
import test from "node:test";

import { buildImport, guessTargets, importDateCandidates, normalizePhone, parseCsv, parseImportDate } from "./import.ts";

test("CSV: quotes, commas and newlines inside quotes, CRLF, BOM, blank trailing rows", () => {
  const text = '﻿Ticket ID,Attending Dates,Note\r\nREG-1,"17 พ.ย. 69, 18 พ.ย. 69","say ""hi""\nthere"\r\n,,\r\n';
  assert.deepEqual(parseCsv(text), [["Ticket ID", "Attending Dates", "Note"], ["REG-1", "17 พ.ย. 69, 18 พ.ย. 69", 'say "hi"\nthere']]);
});

test("phones: the leading 0 a spreadsheet dropped comes back; other text is left as written", () => {
  assert.equal(normalizePhone("838622235"), "0838622235");
  assert.equal(normalizePhone("944509566"), "0944509566");
  assert.equal(normalizePhone("081-234-5678"), "0812345678");
  assert.equal(normalizePhone("02 123 4567"), "02 123 4567");
});

test("dates: Thai short and long months, Buddhist or Christian years, slashes and ISO", () => {
  for (const text of ["17 พ.ย. 69", "17 พฤศจิกายน 2569", "17/11/2569", "17/11/2026", "2026-11-17"]) assert.equal(parseImportDate(text), "2026-11-17", text);
  assert.equal(parseImportDate("17 Nov 2026"), null);
  assert.equal(parseImportDate("32/11/2569"), null);
  // A 2-digit year can be either calendar; the event's days pick the reading (see the 17/11/26 row test below).
  assert.deepEqual(importDateCandidates("17/11/26"), ["1983-11-17", "2026-11-17"]);
  assert.deepEqual(importDateCandidates("17/11/2026"), ["2026-11-17"]);
});

const fields = [
  { key: "prefix", label: "คำนำหน้า", type: "select", required: true, options: ["นาย", "นางสาว", "นาง"] },
  { key: "name", label: "ชื่อ-นามสกุล", type: "text", required: true },
  { key: "phone", label: "เบอร์โทร", type: "tel", required: true },
  { key: "food", label: "Food", type: "radio", required: false, options: ["อาหารทั่วไป", "มังสวิรัติ"] },
  { key: "slip", label: "หลักฐาน", type: "file", required: false },
];
const days = [17, 18, 19].map((day) => ({ id: `d${day}`, date: new Date(`2026-11-${day}T00:00:00Z`) }));
const header = ["Ticket ID", "Prefix", "Full Name", "Phone", "Email", "Attending Dates", "Food", "Position"];
const sheet = [
  header,
  ["REG-43DBA34C", "นาย", "ศิวัฒน์ ดุนภรณ์", "838622235", "siwatbest@gmail.com", "17 พ.ย. 69, 18 พ.ย. 69, 19 พ.ย. 69", "อาหารทั่วไป", "นายแพทย์"],
  ["reg-910ef125", "นางสาว", "กษมา", "944509566", "", "17 พ.ย. 69", "อาหารทั่วไป", "-"],
];

test("column guesses from the sheet's headers; a column with no matching field is left out", () => {
  assert.deepEqual(guessTargets(header, fields), ["ticket", "field:prefix", "field:name", "field:phone", "email", "dates", "field:food", "ignore"]);
});

test("rows become approved registrants on the listed days, keeping the ticket ID exactly as written (the QR's text)", () => {
  const targets = ["ticket", "field:prefix", "field:name", "field:phone", "email", "dates", "field:food", "ignore"];
  const { items, problems } = buildImport({ rows: sheet, targets, fields, days, seatMode: "per_day" });
  assert.deepEqual(problems, []);
  assert.deepEqual(items[0], { row: 2, ticket: "REG-43DBA34C", email: "siwatbest@gmail.com", dayIds: ["d17", "d18", "d19"], answers: { prefix: "นาย", name: "ศิวัฒน์ ดุนภรณ์", phone: "0838622235", food: "อาหารทั่วไป" } });
  assert.deepEqual(items[1], { row: 3, ticket: "reg-910ef125", email: null, dayIds: ["d17"], answers: { prefix: "นางสาว", name: "กษมา", phone: "0944509566", food: "อาหารทั่วไป" } });
});

test("anything wrong stops the whole import, with the row number", () => {
  const targets = ["ticket", "ignore", "field:name", "ignore", "email", "dates", "ignore", "ignore"];
  const rows = [header,
    ["REG-1A", "", "a", "", "bad-email", "17 พ.ย. 69", "", ""],
    ["REG-2B", "", "b", "", "", "20 พ.ย. 69", "", ""],
    ["REG-3C", "", "c", "", "", "", "", ""],
    ["REG-2B", "", "d", "", "", "17 พ.ย. 69", "", ""],
    ["", "", "e", "", "", "17 พ.ย. 69", "", ""],
    ["REG 4D", "", "f", "", "", "17 พ.ย. 69", "", ""],
  ];
  const { problems } = buildImport({ rows, targets, fields, days, seatMode: "per_day" });
  // 2 bad email · 3 not an event day · 4 no dates · 5 repeats REG-2B · 6 no ticket · 7 space in the ticket
  assert.deepEqual(problems.map((problem) => problem.row), [2, 3, 4, 5, 6, 7]);
  assert.match(problems[1].message, /ไม่ใช่วันอบรม/);
  const again = buildImport({ rows: [header, rows[2].with(5, "17 พ.ย. 69"), rows[4], rows[5]], targets, fields, days, seatMode: "per_day" });
  assert.deepEqual(again.problems.map((problem) => problem.message.slice(0, 20)), ["Ticket ID REG-2B ซ้ำ", "ไม่มี Ticket ID"]);
});

test("the ticket column is required, and the dates column too when a per-day event has several days", () => {
  const { problems } = buildImport({ rows: sheet, targets: header.map(() => "ignore"), fields, days, seatMode: "per_day" });
  assert.deepEqual(problems.map((problem) => problem.row), [0, 0]);
  // A whole course gives everyone every day; the dates column is not needed.
  const course = buildImport({ rows: sheet, targets: ["ticket", "ignore", "field:name", "ignore", "ignore", "ignore", "ignore", "ignore"], fields, days, seatMode: "whole_course" });
  assert.deepEqual(course.problems, []);
  assert.deepEqual(course.items[1].dayIds, ["d17", "d18", "d19"]);
});

test("headers that only look like a ticket or a date are not guessed", () => {
  assert.deepEqual(guessTargets(["รหัสไปรษณีย์", "Birth date", "Updated date", "รหัส", "วันที่เข้าร่วม"], []), ["ignore", "ignore", "ignore", "ticket", "dates"]);
});

test("tickets repeat ignoring case; a 2-digit Christian year finds the event day", () => {
  const targets = ["ticket", "ignore", "field:name", "ignore", "ignore", "dates", "ignore", "ignore"];
  const rows = [header, ["REG-1A", "", "a", "", "", "17/11/26", "", ""], ["reg-1a", "", "b", "", "", "18 พ.ย. 69", "", ""]];
  const { items, problems } = buildImport({ rows, targets, fields, days, seatMode: "per_day" });
  assert.deepEqual(items.map((item) => item.dayIds), [["d17"]]);
  assert.deepEqual(problems.map((problem) => problem.row), [3]);
  assert.match(problems[0].message, /ซ้ำกับแถว 2/);
});

test("answers are checked like the form: options keep the form's spelling, unknown options and bad emails stop the import", () => {
  const form = [
    { key: "food", label: "Food", type: "radio", required: false, options: ["อาหารทั่วไป", "Vegan"] },
    { key: "tags", label: "Tags", type: "checkbox", required: false, options: ["A", "B"] },
    { key: "mail", label: "Work mail", type: "email", required: false },
    { key: "born", label: "Born", type: "date", required: false },
  ];
  const targets = ["ticket", "field:food", "field:tags", "field:mail", "field:born"];
  const ok = buildImport({ rows: [["t", "f", "g", "m", "b"], ["REG-OK1", " vegan ", "a, b, A", "X@Example.com", "17 พ.ย. 69"]], targets, fields: form, days, seatMode: "whole_course" });
  assert.deepEqual(ok.problems, []);
  assert.deepEqual(ok.items[0].answers, { food: "Vegan", tags: ["A", "B"], mail: "x@example.com", born: "2026-11-17" });
  const bad = buildImport({ rows: [["t", "f", "g", "m", "b"], ["REG-B1", "Halal", "", "", ""], ["REG-B2", "", "C", "", ""], ["REG-B3", "", "", "nope", ""], ["REG-B4", "", "", "", "soon"]], targets, fields: form, days, seatMode: "whole_course" });
  assert.deepEqual(bad.problems.map((problem) => problem.row), [2, 3, 4, 5]);
  assert.match(bad.problems[0].message, /ไม่มีตัวเลือก “Halal”/);
});
