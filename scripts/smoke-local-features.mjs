import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import nextEnv from "@next/env";
import { hash } from "bcryptjs";
import ExcelJS from "exceljs";
import { PrismaClient } from "@prisma/client";

import { uploadRoot } from "../src/server/registrations/upload-storage.ts";

nextEnv.loadEnvConfig(process.cwd());
// The same folder the app stores uploads in (UPLOAD_DIR, or .local-uploads in development).
const uploadDir = uploadRoot();
if (!uploadDir) throw new Error("Set UPLOAD_DIR: production mode has no upload folder without it");
const db = new PrismaClient();
const base = "http://localhost:3100";
const eventIds = [];
let staffId;

function ensure(value, message) { if (!value) throw new Error(message); }
function formsFrom(html) { return html.split("<form").slice(1).map((part) => `<form${part.split("</form>")[0]}</form>`); }
function formDataFrom(html, values) {
  const data = new FormData();
  for (const match of html.matchAll(/<input type="hidden" name="([^"]+)"(?: value="([^"]*)")?\/>/g)) data.set(match[1], (match[2] ?? "").replaceAll("&quot;", '"').replaceAll("&amp;", "&"));
  for (const [key, value] of Object.entries(values)) {
    if (Array.isArray(value)) { data.delete(key); for (const item of value) data.append(key, item); } else data.set(key, value);
  }
  return data;
}
const post = (url, form, values, headers = {}) => fetch(url, { method: "POST", redirect: "manual", headers: { origin: base, ...headers }, body: formDataFrom(form, values) });
const location = (response) => response.headers.get("location") ?? "";
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function login(email, password) {
  let response = await fetch(`${base}/api/auth/csrf`);
  const csrfToken = (await response.json()).csrfToken;
  const cookie = response.headers.getSetCookie().map((item) => item.split(";")[0]).join("; ");
  response = await fetch(`${base}/api/auth/callback/credentials`, { method: "POST", headers: { cookie, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ csrfToken, email, password, callbackUrl: `${base}/organizer` }), redirect: "manual" });
  ensure(response.status === 302 && !location(response).includes("error="), `Login failed for ${email}`);
  return `${cookie}; ${response.headers.getSetCookie().map((item) => item.split(";")[0]).join("; ")}`;
}

async function callCheckInAction(pagePath, name, args, cookie) {
  const manifest = JSON.parse(readFileSync(".next/dev/server/app/(check-in)/check-in/[eventId]/page/server-reference-manifest.json", "utf8"));
  const id = Object.entries(manifest.node).find(([, value]) => value.exportedName === name)?.[0];
  ensure(id, `Action ${name} not found in manifest`);
  return (await fetch(`${base}${pagePath}`, { method: "POST", headers: { cookie, origin: base, "next-action": id, "content-type": "text/plain;charset=UTF-8", accept: "text/x-component" }, body: JSON.stringify(args) })).text();
}

// Admin feature switches (/admin?view=settings) change what these pages offer; test against the defaults and put
// whatever an admin had chosen back afterwards.
const savedSettings = await db.systemSetting.findMany();
await db.systemSetting.deleteMany();

try {
  const suffix = randomUUID();
  const owner = await db.user.findUniqueOrThrow({ where: { email: "admin@checkinhub.local" }, select: { id: true } });
  const cookie = await login("admin@checkinhub.local", "CheckInHub123!");
  const fields = [
    { key: "name", label: "ชื่อ-นามสกุล", type: "text", required: true, showOnCheckin: true },
    { key: "kind", label: "ประเภท", type: "select", required: true, options: ["ข้าราชการ", "ทั่วไป"] },
    { key: "org", label: "หน่วยงาน", type: "text", required: true, conditional: { field: "kind", operator: "equals", value: "ข้าราชการ" } },
    { key: "secret", label: "เลขบัตร", type: "text", required: false, sensitive: true },
  ];
  const event = await db.event.create({ data: {
    slug: `local-features-${suffix}`, title: "Local features smoke", ownerId: owner.id, status: "PUBLISHED", autoApprove: true, waitlistEnabled: true,
    registrationDeadline: new Date("2031-12-31T16:59:59.999Z"), fields,
    days: { create: [{ date: new Date("2031-10-01T00:00:00.000Z") }] },
  } });
  eventIds.push(event.id);
  const day = await db.eventDay.findFirstOrThrow({ where: { eventId: event.id } });
  const [first, second] = [await db.session.create({ data: { eventId: event.id, eventDayId: day.id, label: "เช้า", sortOrder: 1 } }), await db.session.create({ data: { eventId: event.id, eventDayId: day.id, label: "บ่าย", sortOrder: 2 } })];

  // Registrant self-service edit before the deadline, audited without a staff actor.
  const publicUrl = `${base}/events/${event.slug}`;
  let html = await (await fetch(publicUrl)).text();
  const form = formsFrom(html).find((part) => part.includes('name="consent"'));
  await wait(3100);
  let response = await post(publicUrl, form, { email: `self-${suffix}@example.invalid`, dayId: day.id, "answer:name": "Somchai Typo", "answer:kind": "ข้าราชการ", "answer:org": "กรมเดิม", consent: "on" }, { "x-forwarded-for": `lf-${suffix}` });
  ensure(location(response).includes("/status/"), `Registration failed: ${location(response)}`);
  const statusUrl = new URL(location(response), base).toString();
  const person = await db.registrant.findFirstOrThrow({ where: { eventId: event.id } });
  ensure((await (await fetch(statusUrl)).text()).includes("แก้ไขข้อมูลของฉัน"), "Status page lacks the edit link");
  const editUrl = `${statusUrl}/edit`;
  html = await (await fetch(editUrl)).text();
  const editForm = formsFrom(html).find((part) => part.includes("บันทึกการแก้ไข"));
  ensure(editForm, "Self-edit form missing");
  response = await post(editUrl, editForm, { "answer:name": "Somchai Fixed", "answer:kind": "ทั่วไป", "answer:org": "ควรถูกทิ้ง" });
  ensure(location(response).includes("updated=1"), `Self-edit failed: ${location(response)}`);
  let answers = (await db.registrant.findUniqueOrThrow({ where: { id: person.id } })).answers;
  ensure(answers.name === "Somchai Fixed" && answers.kind === "ทั่วไป" && !("org" in answers), "Self-edit did not apply the condition rules");
  const selfAudit = await db.auditLog.findFirst({ where: { eventId: event.id, action: "REGISTRANT_SELF_EDITED", target: person.id } });
  ensure(selfAudit && selfAudit.actorId === null && selfAudit.metadata.changedFields.includes("name") && !JSON.stringify(selfAudit.metadata).includes("Somchai"), "Self-edit audit missing or leaked values");
  response = await post(editUrl, editForm, { "answer:name": "", "answer:kind": "ทั่วไป" });
  ensure(location(response).includes("error=invalid"), "Self-edit accepted a missing required answer");

  // Self-service day change (per-day): adding a full day queues, a checked-in day stays, dropping frees the seat.
  const dcEvent = await db.event.create({ data: {
    slug: `local-days-${suffix}`, title: "Day change smoke", ownerId: owner.id, status: "PUBLISHED", autoApprove: true, waitlistEnabled: true, waitlistPromotion: "AUTO",
    registrationDeadline: new Date("2031-12-31T16:59:59.999Z"), fields: [{ key: "name", label: "ชื่อ", type: "text", required: true }],
    days: { create: [{ date: new Date("2031-10-01T00:00:00.000Z") }, { date: new Date("2031-10-02T00:00:00.000Z"), maxSeats: 1 }] },
  } });
  eventIds.push(dcEvent.id);
  const [dayA, dayB] = await db.eventDay.findMany({ where: { eventId: dcEvent.id }, orderBy: { date: "asc" } });
  const sessionA = await db.session.create({ data: { eventId: dcEvent.id, eventDayId: dayA.id, label: "เช้า", sortOrder: 1 } });
  const dcToken = `day-change-${suffix}`;
  const makePerson = (email, dayId, token) => db.registrant.create({ data: {
    eventId: dcEvent.id, email, dedupeKey: email, answers: { name: email }, status: "APPROVED", autoApproveAtRegistration: true, qrCode: randomUUID(), approvedAt: new Date(),
    statusTokenHash: createHash("sha256").update(token).digest("hex"), days: { create: [{ eventDayId: dayId, status: "APPROVED" }] },
  } });
  const mover = await makePerson(`mover-${suffix}@example.invalid`, dayA.id, dcToken);
  const holder = await makePerson(`holder-${suffix}@example.invalid`, dayB.id, `holder-${suffix}`);
  const daysUrl = `${base}/events/${dcEvent.slug}/status/${dcToken}/days`;
  ensure((await (await fetch(`${base}/events/${dcEvent.slug}/status/${dcToken}`)).text()).includes("เปลี่ยนวันที่เข้าร่วม"), "Status page lacks the change-days link");
  html = await (await fetch(daysUrl)).text();
  const daysForm = formsFrom(html).find((part) => part.includes("บันทึกการเปลี่ยนวัน"));
  ensure(daysForm && html.includes("เต็มแล้ว"), "Change-days form missing or does not show the full day");
  // Waitlist switch off: the full day is locked on the page and adding it is refused without touching the existing days.
  await db.event.update({ where: { id: dcEvent.id }, data: { waitlistEnabled: false } });
  ensure((await (await fetch(daysUrl)).text()).includes("เต็มแล้ว · ไม่รับรอคิว"), "Change-days page does not lock a full day when the waitlist is off");
  response = await post(daysUrl, daysForm, { dayId: [dayA.id, dayB.id] });
  ensure(location(response).includes("error=full") && await db.registrantEventDay.count({ where: { registrantId: mover.id } }) === 1, `Adding a full day with the waitlist off was not refused: ${location(response)}`);
  await db.event.update({ where: { id: dcEvent.id }, data: { waitlistEnabled: true } });
  response = await post(daysUrl, daysForm, { dayId: [dayA.id, dayB.id] });
  ensure(location(response).includes("days=1"), `Adding a day failed: ${location(response)}`);
  let moverDays = await db.registrantEventDay.findMany({ where: { registrantId: mover.id } });
  ensure(moverDays.find((row) => row.eventDayId === dayB.id)?.status === "WAITLISTED" && moverDays.find((row) => row.eventDayId === dayA.id)?.status === "APPROVED", "Added full day was not waitlisted");
  const checkIn = await db.checkIn.create({ data: { sessionId: sessionA.id, registrantId: mover.id, checkedInAt: new Date(), clientEventId: randomUUID() } });
  response = await post(daysUrl, daysForm, { dayId: [dayB.id] });
  ensure(location(response).includes("error=checked-in"), "A checked-in day could be dropped");
  await db.checkIn.delete({ where: { id: checkIn.id } });
  // The holder drops day B, so the mover's queued day B is promoted automatically.
  const holderUrl = `${base}/events/${dcEvent.slug}/status/holder-${suffix}/days`;
  const holderForm = formsFrom(await (await fetch(holderUrl)).text()).find((part) => part.includes("บันทึกการเปลี่ยนวัน"));
  response = await post(holderUrl, holderForm, { dayId: [dayA.id] });
  ensure(location(response).includes("days=1"), `Swapping days failed: ${location(response)}`);
  moverDays = await db.registrantEventDay.findMany({ where: { registrantId: mover.id } });
  const holderDays = await db.registrantEventDay.findMany({ where: { registrantId: holder.id } });
  ensure(moverDays.find((row) => row.eventDayId === dayB.id)?.status === "APPROVED" && holderDays.find((row) => row.eventDayId === dayB.id)?.status === "CANCELLED" && holderDays.find((row) => row.eventDayId === dayA.id)?.status === "APPROVED", `Swap did not free the seat for the queue: ${JSON.stringify({ mover: moverDays.map((row) => [row.eventDayId === dayA.id ? "A" : "B", row.status]), holder: holderDays.map((row) => [row.eventDayId === dayA.id ? "A" : "B", row.status]) })}`);
  response = await post(daysUrl, daysForm, { dayId: [] });
  ensure(location(response).includes("error=invalid"), "Dropping every day through day change was accepted");
  const dayAudit = await db.auditLog.count({ where: { eventId: dcEvent.id, action: "REGISTRANT_DAYS_CHANGED", actorId: null } });
  ensure(dayAudit === 2, `Expected 2 day-change audit entries, got ${dayAudit}`);

  // Check-in staff may correct only fields shown on the check-in screen.
  const staffEmail = `lf-staff-${suffix}@example.invalid`;
  staffId = (await db.user.create({ data: { name: "LF staff", email: staffEmail, passwordHash: await hash("Local-Features-Pass-1", 12), role: "ORGANIZER" } })).id;
  await db.eventOrganizer.create({ data: { eventId: event.id, userId: staffId, role: "CHECKIN_ONLY" } });
  const staffCookie = await login(staffEmail, "Local-Features-Pass-1");
  const checkInUrl = `${base}/check-in/${event.id}?session=${first.id}&q=Somchai`;
  html = await (await fetch(checkInUrl, { headers: { cookie: staffCookie } })).text();
  const correctForm = formsFrom(html).find((part) => part.includes("บันทึกการแก้ไข"));
  ensure(correctForm && !correctForm.includes('name="answer:secret"'), "Correction form missing or exposes a non-check-in field");
  response = await post(checkInUrl, correctForm, { "answer:name": "สมชาย ถูกต้อง", "answer:secret": "LEAK", "answer:kind": "ข้าราชการ" }, { cookie: staffCookie });
  ensure(location(response).includes("corrected=1"), `Check-in correction failed: ${location(response)}`);
  answers = (await db.registrant.findUniqueOrThrow({ where: { id: person.id } })).answers;
  ensure(answers.name === "สมชาย ถูกต้อง" && answers.kind === "ทั่วไป" && answers.secret !== "LEAK", "Correction changed a field outside the check-in set");
  ensure(await db.auditLog.count({ where: { eventId: event.id, action: "CHECKIN_ANSWERS_CORRECTED", target: person.id, actorId: staffId } }) === 1, "Correction not audited");

  // ETag polling: unchanged state answers 304; a new check-in changes the tag and appears in the delta.
  const stateUrl = `${base}/check-in/${event.id}/state?session=${first.id}`;
  response = await fetch(stateUrl, { headers: { cookie: staffCookie } });
  const etag = response.headers.get("etag");
  const { serverTime } = await response.json();
  ensure(response.status === 200 && etag, "State endpoint did not return an ETag");
  ensure((await fetch(stateUrl, { headers: { cookie: staffCookie, "if-none-match": etag } })).status === 304, "Unchanged state did not return 304");
  const qr = (await db.registrant.findUniqueOrThrow({ where: { id: person.id } })).qrCode;
  await callCheckInAction(`/check-in/${event.id}?session=${first.id}`, "checkInCode", [event.id, first.id, qr, randomUUID(), undefined, "kiosk"], staffCookie);
  response = await fetch(`${stateUrl}&since=${serverTime - 1}`, { headers: { cookie: staffCookie, "if-none-match": etag } });
  const delta = await response.json();
  ensure(response.status === 200 && response.headers.get("etag") !== etag && delta.activeCount === 1 && delta.changes.length === 1 && !JSON.stringify(delta).includes("@"), "State change was not reported as a PII-free delta");
  ensure((await db.checkIn.findFirstOrThrow({ where: { sessionId: first.id } })).method === "kiosk", "Check-in method was not recorded");
  await callCheckInAction(`/check-in/${event.id}?session=${second.id}`, "checkInCode", [event.id, second.id, qr, randomUUID(), undefined, "bogus"], staffCookie);
  ensure((await db.checkIn.findFirstOrThrow({ where: { sessionId: second.id } })).method === null, "Unknown check-in method was stored");
  // The device's station (cookie) is recorded with the check-in; the check-in page shows it in the recent list.
  await db.checkIn.deleteMany({ where: { sessionId: second.id } });
  await callCheckInAction(`/check-in/${event.id}?session=${second.id}`, "checkInCode", [event.id, second.id, qr, randomUUID(), undefined, "scanner"], `${staffCookie}; checkin-station=Desk%202`);
  ensure((await db.checkIn.findFirstOrThrow({ where: { sessionId: second.id } })).station === "Desk 2", "Check-in station was not recorded");
  ensure((await (await fetch(`${base}/check-in/${event.id}?session=${second.id}`, { headers: { cookie: `${staffCookie}; checkin-station=Desk%202` } })).text()).includes("Desk 2"), "Check-in page does not show the station");
  response = await fetch(`${base}/check-in/${event.id}/state?session=${first.id}`, { redirect: "manual" });
  ensure(response.status !== 200 && location(response).includes("/login"), `State endpoint answered without a session cookie: ${response.status}`);

  // Kiosk is behind FEATURE_KIOSK: when on it renders without staff tools, when off the page does not exist.
  response = await fetch(`${base}/check-in/${event.id}/kiosk?session=${first.id}`, { headers: { cookie: staffCookie } });
  html = await response.text();
  if (process.env.FEATURE_KIOSK === "true") ensure(html.includes("เช้า") && !html.includes("ค้นหาผู้เข้าร่วม"), "Kiosk page missing or showing staff search");
  else ensure(response.status === 404 && !(await (await fetch(`${base}/check-in/${event.id}?session=${first.id}`, { headers: { cookie: staffCookie } })).text()).includes("/kiosk"), "Disabled kiosk is still reachable or linked");

  // Session order: moving the afternoon session up reorders the check-in chips.
  const stepUrl = `${base}/organizer/${event.id}?step=4`;
  html = await (await fetch(`${stepUrl}&session=${second.id}`, { headers: { cookie } })).text();
  const moveUp = formsFrom(html).find((part) => part.includes('aria-label="เลื่อนรอบ บ่าย ขึ้น"'));
  ensure(moveUp, "Session reorder control missing");
  await post(stepUrl, moveUp, {}, { cookie });
  const ordered = await db.session.findMany({ where: { eventId: event.id }, orderBy: { sortOrder: "asc" }, select: { label: true } });
  ensure(ordered.map((item) => item.label).join(",") === "บ่าย,เช้า", `Session order not saved: ${ordered.map((item) => item.label)}`);

  // Registration QR: printable poster and PNG for managers; check-in-only staff are refused.
  html = await (await fetch(`${base}/organizer/${event.id}/poster`, { headers: { cookie } })).text();
  ensure(html.includes("<svg") && html.includes(`/r/${event.slug}`) && html.includes("สแกนเพื่อลงทะเบียน"), "Registration QR poster missing QR or short link");
  response = await fetch(`${base}/r/${event.slug}`, { redirect: "manual" });
  ensure(response.status === 307 && response.headers.get("location")?.endsWith(`/events/${event.slug}`), "Short link does not redirect to the registration page");
  response = await fetch(`${base}/organizer/${event.id}/qr`, { headers: { cookie } });
  const png = new Uint8Array(await response.arrayBuffer());
  ensure(response.status === 200 && response.headers.get("content-type") === "image/png" && png[1] === 0x50 && png[2] === 0x4e && png[3] === 0x47, "Registration QR PNG not served");
  ensure((await fetch(`${base}/organizer/${event.id}/qr`, { headers: { cookie: staffCookie } })).status !== 200, "Check-in-only staff downloaded the registration QR");
  ensure((await fetch(`${base}/organizer/${event.id}/poster`, { headers: { cookie: staffCookie } })).status !== 200, "Check-in-only staff opened the registration QR poster");

  // Project list menu: clone follows the spec (no days/deadline, sessions unbound) and delete asks for confirmation.
  const listHtml = await (await fetch(`${base}/organizer`, { headers: { cookie } })).text();
  const menuOf = (id) => listHtml.slice(listHtml.indexOf(`id="event-menu-${id}"`), listHtml.indexOf("</form></details>", listHtml.indexOf(`id="event-menu-${id}"`)) + 20);
  const cloneForm = formsFrom(menuOf(event.id)).find((part) => part.includes("ทำสำเนาโครงการ (clone)"));
  ensure(cloneForm, "Clone form missing from the project menu");
  response = await post(`${base}/organizer`, cloneForm, {}, { cookie });
  const cloneId = location(response).match(/organizer\/([^?/]+)\?step=1&saved=cloned/)?.[1];
  ensure(cloneId, `Clone did not open the new draft: ${location(response)}`);
  eventIds.push(cloneId);
  const clone = await db.event.findUniqueOrThrow({ where: { id: cloneId }, include: { days: true, sessions: true } });
  ensure(clone.status === "DRAFT" && clone.clonedFromId === event.id && clone.days.length === 0 && clone.registrationDeadline === null && clone.sessions.length === 2 && clone.sessions.every((item) => !item.eventDayId) && clone.title.endsWith("(สำเนา)"), "Clone copied days/deadline or kept sessions bound");
  // React separates adjacent text nodes with <!-- --> in server HTML.
  const listAfter = (await (await fetch(`${base}/organizer?status=DRAFT`, { headers: { cookie } })).text()).replaceAll("<!-- -->", "");
  ensure(listAfter.includes(`ทำสำเนาจาก ${event.title}`) && listAfter.includes("ตั้งวันจัด"), "Clone row lacks its source chip or next setup step");
  const deleteHtml = listAfter.slice(listAfter.indexOf(`id="event-menu-${cloneId}"`));
  const deleteForm = formsFrom(deleteHtml).find((part) => part.includes('name="confirm"'));
  response = await post(`${base}/organizer`, deleteForm, {}, { cookie });
  ensure(await db.event.count({ where: { id: cloneId } }) === 1, "Delete ran without confirmation");
  response = await post(`${base}/organizer`, deleteForm, { confirm: "on" }, { cookie });
  ensure(location(response).includes("/organizer?deleted=1") && await db.event.count({ where: { id: cloneId } }) === 0, "Confirmed delete of an empty draft did not remove it");

  // xlsx export with Thai headers, audited separately from CSV.
  response = await fetch(`${base}/organizer/${event.id}/registrants/export?format=xlsx`, { headers: { cookie } });
  const bytes = Buffer.from(await response.arrayBuffer());
  ensure(response.headers.get("content-type")?.includes("spreadsheetml") && bytes.subarray(0, 2).toString() === "PK", "xlsx export is not a workbook");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes);
  const sheet = workbook.worksheets[0];
  ensure(sheet.getRow(1).values.includes("ชื่อ-นามสกุล") && !sheet.getRow(1).values.includes("เลขบัตร") && sheet.getRow(2).values.includes("สมชาย ถูกต้อง"), "xlsx content incorrect");
  ensure(await db.auditLog.count({ where: { eventId: event.id, action: "EXPORT_XLSX" } }) === 1, "xlsx export not audited");

  // Registration data is kept permanently: the daily job only sweeps orphan files, even for a long-past event.
  const old = await db.event.create({ data: {
    slug: `retention-${suffix}`, title: "Retention smoke", ownerId: owner.id, status: "CLOSED", retentionDays: 30, fields,
    days: { create: [{ date: new Date("2020-01-01T00:00:00.000Z") }] },
  } });
  eventIds.push(old.id);
  if (!existsSync(uploadDir)) mkdirSync(uploadDir, { recursive: true });
  const storageKey = `${randomUUID()}.pdf`;
  writeFileSync(join(uploadDir, storageKey), "%PDF-1.7\nretention\n");
  const retained = await db.registrant.create({ data: {
    eventId: old.id, email: `old-${suffix}@example.invalid`, dedupeKey: `old-${suffix}@example.invalid`, status: "APPROVED", qrCode: randomUUID(), statusTokenHash: randomUUID(),
    consentIp: "203.0.113.9", answers: { name: "Old Person", proof: { storageKey, originalName: "id.pdf", contentType: "application/pdf", size: 20 } },
  } });
  response = await fetch(`${base}/api/jobs/retention`);
  ensure(response.status === 401, "Retention endpoint allowed an unauthenticated request");
  response = await fetch(`${base}/api/jobs/retention`, { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } });
  const job = response.ok ? await response.json() : null;
  ensure(job && "orphanFilesDeleted" in job && !("anonymizedRegistrants" in job), "Retention job did not run");
  const kept = await db.registrant.findUniqueOrThrow({ where: { id: retained.id } });
  ensure(!kept.anonymizedAt && kept.email === `old-${suffix}@example.invalid` && kept.consentIp === "203.0.113.9" && kept.answers.name === "Old Person", "Retention job removed registration data that must be kept");
  ensure(existsSync(join(uploadDir, storageKey)), "Retention job deleted a referenced upload");
  rmSync(join(uploadDir, storageKey), { force: true }); // nothing else removes this test upload now
  ensure(!(await db.event.findUniqueOrThrow({ where: { id: old.id } })).anonymizedAt && await db.auditLog.count({ where: { eventId: old.id, action: "RETENTION_ANONYMIZED" } }) === 0, "Retention job anonymized an event");

  // After the deadline the registrant can no longer edit.
  await db.event.update({ where: { id: event.id }, data: { registrationDeadline: new Date(Date.now() - 60_000) } });
  response = await post(editUrl, editForm, { "answer:name": "Too late", "answer:kind": "ทั่วไป" });
  ensure(!location(response).includes("updated=1") && (await db.registrant.findUniqueOrThrow({ where: { id: person.id } })).answers.name !== "Too late", "Self-edit accepted after the deadline");

  process.stdout.write("Local features: self-edit, self-service day change, check-in corrections, ETag delta polling, check-in method and station, kiosk switch, session order, xlsx export and permanent data retention passed.\n");
} finally {
  await db.systemSetting.deleteMany();
  for (const row of savedSettings) await db.systemSetting.create({ data: row });
  for (const id of eventIds) await db.event.deleteMany({ where: { id } });
  if (staffId) { await db.auditLog.deleteMany({ where: { actorId: staffId } }); await db.user.deleteMany({ where: { id: staffId } }); }
  await db.$disconnect();
}
