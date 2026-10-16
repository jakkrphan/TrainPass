// Admin feature switches: toggling from /admin?view=settings is audited and every switch is enforced on the
// server, not only hidden in the UI. Restores the switches it found when it finishes.
import { createHash, randomUUID } from "node:crypto";

import nextEnv from "@next/env";
import { PrismaClient } from "@prisma/client";

nextEnv.loadEnvConfig(process.cwd());
const db = new PrismaClient();
const base = "http://localhost:3100";
const eventIds = [];

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

const savedSettings = await db.systemSetting.findMany();
const startedAt = new Date();
try {
  const suffix = randomUUID();
  const adminCookie = await login("admin@checkinhub.local", "CheckInHub123!");
  const organizerCookie = await login("organizer@checkinhub.local", "CheckInHub123!");
  const admin = await db.user.findUniqueOrThrow({ where: { email: "admin@checkinhub.local" }, select: { id: true } });
  const settingsUrl = `${base}/admin?view=settings`;

  async function toggle(key, enabled) {
    const html = await (await fetch(settingsUrl, { headers: { cookie: adminCookie } })).text();
    const form = formsFrom(html).find((part) => part.includes(`name="key" value="${key}"`));
    ensure(form, `Switch form for ${key} missing`);
    const response = await post(settingsUrl, form, { enabled: String(enabled) }, { cookie: adminCookie });
    ensure(location(response).includes(`saved=${key}`), `Saving ${key} failed: ${response.status} ${location(response)}`);
    ensure((await db.systemSetting.findUniqueOrThrow({ where: { key } })).enabled === enabled, `${key} not stored`);
  }

  // Non-admins cannot open the settings tab.
  const organizerView = await fetch(settingsUrl, { headers: { cookie: organizerCookie }, redirect: "manual" });
  ensure(organizerView.status === 403, `Organizer reached admin settings (${organizerView.status})`);

  // Start from defaults so earlier runs cannot leak into this one.
  await db.systemSetting.deleteMany();
  const page = await (await fetch(settingsUrl, { headers: { cookie: adminCookie } })).text();
  ensure(page.includes("ตั้งค่าระบบ") && page.includes("ส่งอีเมลแจ้งผู้สมัคร"), "Settings tab did not render");

  // Email delivery is implemented. Disable it so this fixture never mails a real SMTP service.
  const emailForm = formsFrom(page).find((part) => part.includes('name="key" value="emailNotifications"'));
  let response = await post(settingsUrl, emailForm, { enabled: "false" }, { cookie: adminCookie });
  ensure(location(response).includes("saved=emailNotifications") && !(await db.systemSetting.findUniqueOrThrow({ where: { key: "emailNotifications" } })).enabled, "Email feature could not be disabled");

  const event = await db.event.create({ data: {
    slug: `feature-switch-${suffix}`, title: "Feature switch smoke", ownerId: admin.id, status: "PUBLISHED", autoApprove: true, waitlistEnabled: true,
    registrationDeadline: new Date("2031-12-31T16:59:59.999Z"), fields: [{ key: "name", label: "ชื่อ", type: "text", required: true }],
    days: { create: [{ date: new Date("2031-10-01T00:00:00.000Z") }, { date: new Date("2031-10-02T00:00:00.000Z") }] },
  } });
  eventIds.push(event.id);
  const days = await db.eventDay.findMany({ where: { eventId: event.id }, orderBy: { date: "asc" } });
  const token = `feature-switch-${suffix}`;
  await db.registrant.create({ data: {
    eventId: event.id, email: `switch-${suffix}@example.invalid`, dedupeKey: `switch-${suffix}@example.invalid`, answers: { name: "Switch" }, status: "APPROVED", autoApproveAtRegistration: true,
    qrCode: randomUUID(), approvedAt: new Date(), statusTokenHash: createHash("sha256").update(token).digest("hex"),
    days: { create: days.map((day) => ({ eventDayId: day.id, status: "APPROVED" })) },
  } });
  const statusUrl = `${base}/events/${event.slug}/status/${token}`;

  // Public registration: the page stops offering the form and a form opened earlier is refused.
  const publicUrl = `${base}/events/${event.slug}`;
  const registrationForm = formsFrom(await (await fetch(publicUrl)).text()).find((part) => part.includes('name="consent"'));
  ensure(registrationForm, "Registration form missing while registration is on");
  await toggle("publicRegistration", false);
  const audit = await db.auditLog.findFirst({ where: { action: "ADMIN_FEATURE_TOGGLED", target: "publicRegistration" }, orderBy: { createdAt: "desc" } });
  ensure(audit?.actorId === admin.id && audit.metadata.from === true && audit.metadata.to === false, "Toggle was not audited");
  ensure((await (await fetch(publicUrl)).text()).includes("ปิดรับลงทะเบียนออนไลน์ชั่วคราว"), "Public page does not say registration is paused");
  await wait(3100);
  response = await post(publicUrl, registrationForm, { email: `late-${suffix}@example.invalid`, dayId: days[0].id, "answer:name": "Late", consent: "on" }, { "x-forwarded-for": `fs-${suffix}` });
  ensure(location(response).includes("error=paused"), `Paused registration accepted: ${location(response)}`);
  await toggle("publicRegistration", true);

  // Registrant self-service switches.
  let html = await (await fetch(statusUrl)).text();
  ensure(html.includes("แก้ไขข้อมูลของฉัน") && html.includes("เปลี่ยนวันที่เข้าร่วม") && html.includes("ยกเลิกการเข้าร่วม"), "Self-service controls missing while on");
  const cancelForm = formsFrom(html).find((part) => part.includes("ยกเลิกการเข้าร่วม"));
  for (const key of ["selfEdit", "selfDayChange", "selfCancel"]) await toggle(key, false);
  html = await (await fetch(statusUrl)).text();
  ensure(!html.includes("แก้ไขข้อมูลของฉัน") && !html.includes("เปลี่ยนวันที่เข้าร่วม") && !html.includes("ยกเลิกการเข้าร่วม"), "Self-service controls still shown while off");
  ensure((await (await fetch(`${statusUrl}/edit`)).text()).includes("ขณะนี้ปิดการแก้ข้อมูลด้วยตนเอง"), "Edit page still editable");
  ensure((await (await fetch(`${statusUrl}/days`)).text()).includes("ขณะนี้ปิดการเปลี่ยนวันด้วยตนเอง"), "Days page still editable");
  response = await post(statusUrl, cancelForm, { confirm: "on" });
  ensure(location(response).includes("error=disabled"), `Cancel accepted while off: ${location(response)}`);
  ensure((await db.registrant.findFirstOrThrow({ where: { eventId: event.id } })).status === "APPROVED", "Registrant was cancelled while self-cancel was off");
  for (const key of ["selfEdit", "selfDayChange", "selfCancel"]) await toggle(key, true);

  // Organizer switches: export, walk-in, creating events (admins keep creating).
  ensure((await fetch(`${base}/organizer/${event.id}/registrants/export`, { headers: { cookie: adminCookie } })).status === 200, "Export failed while on");
  await toggle("exportData", false);
  ensure((await fetch(`${base}/organizer/${event.id}/registrants/export`, { headers: { cookie: adminCookie } })).status === 403, "Export allowed while off");
  ensure(!(await (await fetch(`${base}/organizer/${event.id}/registrants`, { headers: { cookie: adminCookie } })).text()).includes("/registrants/export"), "Export buttons still shown");
  await toggle("walkIn", false);
  response = await fetch(`${base}/organizer/${event.id}/registrants/new`, { headers: { cookie: adminCookie }, redirect: "manual" });
  ensure(location(response).includes("walk-in-disabled"), `Walk-in page open while off (${response.status})`);
  await toggle("organizerCreateEvents", false);
  response = await fetch(`${base}/organizer/new`, { headers: { cookie: organizerCookie }, redirect: "manual" });
  ensure(location(response).includes("create-disabled"), `Organizer could open create page while off (${response.status})`);
  ensure(!(await (await fetch(`${base}/organizer`, { headers: { cookie: organizerCookie } })).text()).includes('href="/organizer/new"'), "Create button still shown to organizer");
  response = await fetch(`${base}/organizer/new`, { headers: { cookie: adminCookie }, redirect: "manual" });
  ensure(response.status === 200, `Admin lost event creation (${response.status})`);

  // Kiosk follows its switch.
  const session = await db.session.create({ data: { eventId: event.id, eventDayId: days[0].id, label: "เช้า", sortOrder: 1 } });
  const kioskUrl = `${base}/check-in/${event.id}/kiosk?session=${session.id}`;
  ensure((await fetch(kioskUrl, { headers: { cookie: adminCookie } })).status === 404, "Kiosk open while off");
  await toggle("kiosk", true);
  ensure((await fetch(kioskUrl, { headers: { cookie: adminCookie } })).status === 200, "Kiosk closed while on");

  console.log("Feature settings smoke passed");
} finally {
  await db.systemSetting.deleteMany();
  for (const row of savedSettings) await db.systemSetting.create({ data: row });
  for (const id of eventIds) await db.event.deleteMany({ where: { id } });
  await db.auditLog.deleteMany({ where: { action: "ADMIN_FEATURE_TOGGLED", createdAt: { gte: startedAt } } });
  await db.$disconnect();
}
