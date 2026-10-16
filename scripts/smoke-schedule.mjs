import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import { join } from "node:path";

import nextEnv from "@next/env";
import { PrismaClient } from "@prisma/client";
import sharp from "sharp";

import { uploadRoot } from "../src/server/registrations/upload-storage.ts";

nextEnv.loadEnvConfig(process.cwd());
// The same folder the app stores uploads in (UPLOAD_DIR, or .local-uploads in development).
const uploadDir = uploadRoot();
// A real image: covers are decoded by sharp, which refuses broken files.
const coverPng = await sharp({ create: { width: 32, height: 18, channels: 3, background: "#3a7" } }).png().toBuffer();
if (!uploadDir) throw new Error("Set UPLOAD_DIR: production mode has no upload folder without it");

const db = new PrismaClient();
const base = "http://localhost:3100";
let ownerId;
let eventId;
let coverKey;
let createdEventId;
let createdCoverKey;

function ensure(condition, message) {
  if (!condition) throw new Error(message);
}

function formsFrom(html) {
  return html.split("<form").slice(1).map((part) => `<form${part.split("</form>")[0]}</form>`);
}

function formDataFrom(html, values = {}) {
  const form = new FormData();
  const hidden = /<input type="hidden" name="([^"]+)"(?: value="([^"]*)")?\/>/g;
  for (const match of html.matchAll(hidden)) {
    form.set(match[1], (match[2] ?? "").replaceAll("&quot;", '"').replaceAll("&amp;", "&"));
  }
  for (const [name, value] of Object.entries(values)) {
    if (Array.isArray(value)) {
      form.delete(name);
      for (const item of value) form.append(name, item);
    } else {
      form.set(name, value);
    }
  }
  return form;
}

try {
  const token = randomUUID();
  const admin = await db.user.findUniqueOrThrow({ where: { email: "admin@checkinhub.local" } });
  const owner = await db.user.create({
    data: { name: "Schedule smoke owner", email: `smoke-${token}@example.invalid`, passwordHash: "not-used", role: "ORGANIZER" },
  });
  ownerId = owner.id;
  const event = await db.event.create({
    data: { slug: `smoke-${token}`, title: "Schedule smoke", ownerId, status: "DRAFT", fields: [] },
  });
  eventId = event.id;

  let response = await fetch(`${base}/api/auth/csrf`);
  const csrfToken = (await response.json()).csrfToken;
  let cookie = response.headers.getSetCookie().map((item) => item.split(";")[0]).join("; ");
  response = await fetch(`${base}/api/auth/callback/credentials`, {
    method: "POST",
    headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ csrfToken, email: admin.email, password: "CheckInHub123!", callbackUrl: `${base}/organizer` }),
    redirect: "manual",
  });
  ensure(response.status === 302, "Admin login failed");
  cookie += `; ${response.headers.getSetCookie().map((item) => item.split(";")[0]).join("; ")}`;

  const createPage = await (await fetch(`${base}/organizer/new`, { headers: { cookie } })).text();
  const createForm = formsFrom(createPage).find((form) => form.includes('name="coverImage"') && form.includes('name="title"'));
  ensure(createForm, "New event wizard cover input missing");
  response = await fetch(`${base}/organizer/new`, { method: "POST", headers: { cookie, origin: base }, body: formDataFrom(createForm, {
    title: `Cover create ${token}`, description: "", location: "", eventType: "INTERNAL", deadlineDate: "2031-12-31",
    coverImage: new File([coverPng], "created-cover.png", { type: "image/png" }),
  }), redirect: "manual" });
  ensure(response.status === 303 && /\/organizer\/[^/]+\?step=2/.test(response.headers.get("location") ?? ""), "Create event wizard did not continue to step 2");
  createdEventId = new URL(response.headers.get("location"), base).pathname.split("/").at(-1);
  const createdEvent = await db.event.findUniqueOrThrow({ where: { id: createdEventId } });
  createdCoverKey = createdEvent.coverImageKey;
  ensure(createdCoverKey?.endsWith(".webp") && createdEvent.coverImageUrl === `/events/${createdEvent.slug}/cover?v=${createdCoverKey.slice(0, 8)}`, "Create event did not persist its cover image");

  const url = `${base}/organizer/${eventId}`;
  const loadPage = async (step = 1) => (await fetch(`${url}?step=${step}`, { headers: { cookie } })).text();
  const submit = async (html, values = {}) => fetch(url, {
    method: "POST",
    headers: { cookie, origin: base },
    body: formDataFrom(html, values),
    redirect: "manual",
  });

  let html = await loadPage();
  const settingsForm = formsFrom(html).find((form) => form.includes('name="deadlineDate"'));
  ensure(settingsForm, "Event settings form missing");
  response = await submit(settingsForm, {
    title: event.title,
    description: "Temporary event",
    location: "Test room",
    eventType: "MIXED",
    deadlineDate: "2031-12-31",
    autoApprove: "on",
    coverImage: new File([coverPng], "cover.png", { type: "image/png" }),
  });
  ensure(response.status === 303, "Save event settings did not redirect");
  const settings = await db.event.findUniqueOrThrow({ where: { id: eventId } });
  ensure(settings.eventType === "MIXED" && settings.autoApprove && settings.registrationDeadline?.toISOString() === "2031-12-31T16:59:59.999Z", "Event settings were not saved");
  ensure(settings.coverImageKey?.endsWith(".webp") && settings.coverImageUrl === `/events/${event.slug}/cover?v=${settings.coverImageKey.slice(0, 8)}`, "Local cover metadata was not saved");
  coverKey = settings.coverImageKey;
  const draftCover = await fetch(`${base}${settings.coverImageUrl}`, { headers: { cookie } });
  ensure(draftCover.status === 200 && draftCover.headers.get("cache-control") === "private, no-store" && (await draftCover.arrayBuffer()).byteLength > 8, "Draft cover was not served privately to an organizer");
  html = await loadPage(1);
  const updatedSettingsForm = formsFrom(html).find((form) => form.includes('name="coverImage"'));
  ensure(updatedSettingsForm, "Cover input missing from settings");
  response = await submit(updatedSettingsForm, { title: event.title, description: "Temporary event", location: "Test room", eventType: "MIXED", deadlineDate: "2031-12-31", autoApprove: "on", coverImage: new File(["not an image"], "invalid.png", { type: "image/png" }) });
  ensure(response.status === 303 && response.headers.get("location")?.includes("error=cover-invalid"), "Invalid cover was not rejected");
  ensure((await db.event.findUniqueOrThrow({ where: { id: eventId } })).coverImageKey === coverKey, "Invalid cover replaced the previous image");

  // Form builder: the side panel adds a field when nothing is selected and edits the selected field otherwise.
  const loadField = async (key) => (await fetch(`${url}?step=3&field=${encodeURIComponent(key)}`, { headers: { cookie } })).text();
  const fieldPanel = (page) => formsFrom(page).find((form) => form.includes('name="label"') && (form.includes("เพิ่มฟิลด์</button>") || form.includes("บันทึกฟิลด์</button>")));
  // Buttons with their own formAction submit the form plus the clicked button's name, as a browser does.
  const clickButton = (formHtml, ariaLabelPart) => {
    const button = [...formHtml.matchAll(/<button[^>]*>/g)].map((match) => match[0]).find((tag) => tag.includes(`aria-label="${ariaLabelPart}`));
    const name = button?.match(/name="([^"]+)"/)?.[1];
    ensure(name, `Button ${ariaLabelPart} missing`);
    return submit(formHtml, { [name]: "" });
  };
  html = await loadPage(3);
  const addFieldForm = fieldPanel(html);
  ensure(addFieldForm?.includes('name="type"'), "Add field form missing");
  response = await submit(addFieldForm, { label: "หน่วยงาน", type: "select", optionsText: "แพทย์\nพยาบาล", required: "on" });
  ensure(response.status === 303, "Add field did not redirect");
  let fields = (await db.event.findUniqueOrThrow({ where: { id: eventId } })).fields;
  ensure(Array.isArray(fields) && fields.length === 1 && fields[0].required && fields[0].options.length === 2, "Registration field was not saved");
  ensure(response.headers.get("location")?.includes(`field=${fields[0].key}`), "New field was not selected after saving");

  response = await submit(addFieldForm, { label: "ตัวเลือกผิด", type: "select", optionsText: "ค่าเดียว" });
  ensure(response.headers.get("location")?.includes("invalid-options"), "Invalid select options were not rejected");
  ensure(addFieldForm.includes('value="radio"'), "Field builder does not offer the radio type");
  response = await submit(addFieldForm, { label: "ปุ่มกลมผิด", type: "radio", optionsText: "ค่าเดียว" });
  ensure(response.headers.get("location")?.includes("invalid-options"), "Radio field with one option was not rejected");

  // A browser only sends optionsText for select/checkbox; other types must still save.
  response = await submit(addFieldForm, { label: "เบอร์โทร", type: "tel" });
  ensure(response.status === 303 && !response.headers.get("location")?.includes("error="), `Second field was not added: ${response.headers.get("location")}`);
  response = await submit(addFieldForm, { label: "หนังสือคำสั่ง", type: "file", acceptedFileTypes: ["pdf", "png"], maxFileSizeMb: "3" });
  ensure(!response.headers.get("location")?.includes("error="), `File field was not added: ${response.headers.get("location")}`);
  fields = (await db.event.findUniqueOrThrow({ where: { id: eventId } })).fields;
  const fileField = fields.find((field) => field.type === "file");
  ensure(fileField?.acceptedFileTypes?.join(",") === "pdf,png" && fileField.maxFileSizeMb === 3, "File field settings were not saved");
  response = await submit(addFieldForm, { label: "ไม่มีค่าเงื่อนไข", type: "text", conditionField: fields[0].key });
  ensure(response.headers.get("location")?.includes("field=__new__&error=invalid-condition"), "Condition without values did not return a specific error");
  await db.event.update({ where: { id: eventId }, data: { fields: fields.filter((field) => field.type !== "file") } });
  fields = (await db.event.findUniqueOrThrow({ where: { id: eventId } })).fields;
  const [unitKey, phoneKey] = fields.map((field) => field.key);
  html = await loadField(unitKey);
  const editFieldForm = fieldPanel(html);
  ensure(editFieldForm?.includes("บันทึกฟิลด์</button>"), "Edit field form missing");
  response = await submit(editFieldForm, { label: "หน่วยงานใหม่", optionsText: "แพทย์\nพยาบาล\nอื่น ๆ", required: "on" });
  ensure(response.status === 303, "Field edit failed");
  fields = (await db.event.findUniqueOrThrow({ where: { id: eventId } })).fields;
  ensure(fields[0].label === "หน่วยงานใหม่" && fields[0].options.length === 3, "Edited field values were not saved");

  // Conditional edit: phone shows only for two of the parent's options; removing a referenced option is refused.
  html = await loadField(phoneKey);
  response = await submit(fieldPanel(html), { label: "เบอร์โทร", conditionField: unitKey, conditionValues: ["แพทย์", "พยาบาล"] });
  fields = (await db.event.findUniqueOrThrow({ where: { id: eventId } })).fields;
  ensure(fields[1].conditional?.field === unitKey && fields[1].conditional.operator === "in" && fields[1].conditional.value.length === 2, "Condition edit was not saved");
  html = await loadField(unitKey);
  response = await submit(fieldPanel(html), { label: "หน่วยงานใหม่", optionsText: "แพทย์\nอื่น ๆ" });
  ensure(response.headers.get("location")?.includes("error=invalid-field"), "Removing an option used by a child condition was accepted");
  html = await loadField(phoneKey);
  response = await submit(fieldPanel(html), { label: "เบอร์โทร" });
  fields = (await db.event.findUniqueOrThrow({ where: { id: eventId } })).fields;
  ensure(!fields[1].conditional, "Turning the condition off did not clear it");

  html = await loadField(phoneKey);
  response = await clickButton(fieldPanel(html), "เลื่อน เบอร์โทร ขึ้น");
  ensure(response.status === 303, "Field reorder failed");
  fields = (await db.event.findUniqueOrThrow({ where: { id: eventId } })).fields;
  ensure(fields[0].label === "เบอร์โทร", "Field reorder was not saved");

  // Page break: appended, titled, moved between the two fields, then removed. The fields themselves never change.
  const addPageForm = formsFrom(await loadPage(3)).find((form) => form.includes("เพิ่มตัวแบ่งหน้า</button>"));
  ensure(addPageForm, "Add page break button missing");
  response = await submit(addPageForm);
  fields = (await db.event.findUniqueOrThrow({ where: { id: eventId } })).fields;
  const pageBreak = fields.at(-1);
  ensure(fields.length === 3 && pageBreak.type === "page" && response.headers.get("location")?.includes(`field=${pageBreak.key}`), `Page break was not added: ${response.headers.get("location")}`);
  const pagePanel = async () => formsFrom(await loadField(pageBreak.key)).find((form) => form.includes("บันทึกชื่อหน้า</button>"));
  ensure(await pagePanel(), "Page break panel missing");
  response = await submit(await pagePanel(), { label: "ข้อมูลหน่วยงาน" });
  ensure(response.status === 303 && !response.headers.get("location")?.includes("error="), "Page title was not saved");
  response = await clickButton(await pagePanel(), "เลื่อนตัวแบ่งหน้าขึ้น");
  fields = (await db.event.findUniqueOrThrow({ where: { id: eventId } })).fields;
  ensure(fields.map((field) => field.type).join(",") === "tel,page,select" && fields[1].label === "ข้อมูลหน่วยงาน", `Page break was not titled and moved: ${JSON.stringify(fields.map((field) => [field.type, field.label]))}`);
  html = await loadPage(3);
  ensure(html.includes("ขึ้นหน้า 2") && html.includes("ข้อมูลหน่วยงาน"), "Builder does not show where page 2 starts");
  response = await clickButton(await pagePanel(), "ลบตัวแบ่งหน้า");
  fields = (await db.event.findUniqueOrThrow({ where: { id: eventId } })).fields;
  ensure(response.status === 303 && fields.length === 2 && fields.every((field) => field.type !== "page"), "Removing the page break changed the fields");

  for (const key of [phoneKey, unitKey]) {
    html = await loadField(key);
    response = await clickButton(fieldPanel(html), "ลบฟิลด์");
    ensure(response.status === 303, "Remove field did not redirect");
  }
  fields = (await db.event.findUniqueOrThrow({ where: { id: eventId } })).fields;
  ensure(Array.isArray(fields) && fields.length === 0, "Registration field was not removed");

  html = await loadPage(2);
  let addDayForm = formsFrom(html).find((form) => form.includes('name="maxSeats"'));
  ensure(addDayForm, "Add day form missing");

  response = await submit(addDayForm, { dates: ["2032-01-15", "2032-01-16"], maxSeats: "25" });
  ensure(response.status === 303, "Add multiple days did not redirect");
  const day = await db.eventDay.findUniqueOrThrow({
    where: { eventId_date: { eventId, date: new Date("2032-01-15T00:00:00.000Z") } },
  });
  const secondDay = await db.eventDay.findUniqueOrThrow({
    where: { eventId_date: { eventId, date: new Date("2032-01-16T00:00:00.000Z") } },
  });
  ensure(day.maxSeats === 25 && secondDay.maxSeats === 25, "Multiple day seats were not saved");

  response = await submit(addDayForm, { dates: ["2032-01-15", "2032-01-17"], maxSeats: "25" });
  ensure(response.headers.get("location")?.includes("duplicate-day"), "Duplicate date was not rejected");
  ensure(await db.eventDay.count({ where: { eventId, date: new Date("2032-01-17T00:00:00.000Z") } }) === 0, "Duplicate batch did not roll back");
  response = await submit(addDayForm, { dates: ["2032-01-18", "2032-02-30"], maxSeats: "25" });
  ensure(response.headers.get("location")?.includes("invalid-day"), "Impossible date was not rejected");
  ensure(await db.eventDay.count({ where: { eventId, date: new Date("2032-01-18T00:00:00.000Z") } }) === 0, "Invalid batch was partially saved");

  html = await loadPage(4);
  const addSessionForm = formsFrom(html).find((form) => form.includes("เพิ่มรอบ"));
  ensure(addSessionForm, "Add session form missing");
  response = await submit(addSessionForm, { label: "รอบเช้า", scope: day.id });
  ensure(response.status === 303, "Add day-bound session did not redirect");
  const session = await db.session.findFirstOrThrow({ where: { eventId, eventDayId: day.id, label: "รอบเช้า" } });

  html = await loadPage(4);
  const removeSessionForm = formsFrom(html).find((form) => form.includes("ลบรอบ"));
  ensure(removeSessionForm, "Remove session form missing");
  response = await submit(removeSessionForm);
  ensure(response.status === 303, "Remove session did not redirect");
  ensure(await db.session.count({ where: { id: session.id } }) === 0, "Session was not removed");

  html = await loadPage(4);
  const globalSessionForm = formsFrom(html).find((form) => form.includes('name="scope"'));
  ensure(globalSessionForm, "Global session form missing");
  response = await submit(globalSessionForm, { label: "รอบทุกวัน", scope: "EVENT" });
  ensure(response.status === 303, "Add global session did not redirect");
  const globalSession = await db.session.findFirstOrThrow({ where: { eventId, eventDayId: null, label: "รอบทุกวัน" } });
  const checkInHtml = await (await fetch(`${base}/check-in/${eventId}`, { headers: { cookie } })).text();
  ensure(checkInHtml.includes(globalSession.label) && checkInHtml.includes("ทุกวัน"), "Global session did not appear as an all-days option in check-in");
  html = await loadPage(4);
  const removeGlobalSessionForm = formsFrom(html).find((form) => form.includes("ลบรอบ"));
  ensure(removeGlobalSessionForm, "Remove global session form missing");
  response = await submit(removeGlobalSessionForm);
  ensure(response.status === 303 && await db.session.count({ where: { id: globalSession.id } }) === 0, "Remove global session failed");

  html = await loadPage(2);
  const removeDayForm = formsFrom(html).find((form) => form.includes("ลบวัน"));
  ensure(removeDayForm, "Remove day form missing");
  response = await submit(removeDayForm);
  ensure(response.status === 303, "Remove day did not redirect");
  ensure(await db.eventDay.count({ where: { id: day.id } }) === 0, "Day was not removed");

  const auditCount = await db.auditLog.count({ where: { eventId, actorId: admin.id } });
  ensure(auditCount === 21, `Expected 21 admin audit entries, got ${auditCount}`);

  const publicPage = await (await fetch(`${base}/events/${event.slug}`)).text();
  ensure(publicPage.includes("ยังไม่เปิดรับลงทะเบียน") && publicPage.includes(event.title) && !publicPage.includes("Temporary event") && !publicPage.includes("Test room"), "Draft public gate exposed more than the event title");

  await db.event.update({ where: { id: eventId }, data: { status: "PUBLISHED" } });
  const publicCover = await fetch(`${base}${settings.coverImageUrl}`);
  ensure(publicCover.status === 200 && publicCover.headers.get("content-type") === "image/webp" && publicCover.headers.get("cache-control") === "public, max-age=86400", "Published cover was not publicly served (WebP, cached for a day)");
  const publicThumb = await fetch(`${base}${settings.coverImageUrl}&size=thumb`);
  ensure(publicThumb.status === 200 && publicThumb.headers.get("content-type") === "image/webp" && (await publicThumb.arrayBuffer()).byteLength > 8, "Cover thumbnail was not served");
  const publishedPage = await (await fetch(`${base}/events/${event.slug}`)).text();
  ensure(publishedPage.includes(event.title) && publishedPage.includes("ยังไม่พร้อมรับลงทะเบียนออนไลน์"), "Published event details were not shown correctly");

  await db.event.update({ where: { id: eventId }, data: { status: "CLOSED" } });
  const closedPage = await (await fetch(`${base}/events/${event.slug}`)).text();
  ensure(closedPage.includes("ปิดรับลงทะเบียนแล้ว"), "Closed event did not show the closed state");

  process.stdout.write("Event settings, fields, schedule, admin audit, and public status gates passed.\n");
} finally {
  if (eventId) {
    await db.auditLog.deleteMany({ where: { eventId } });
    await db.event.delete({ where: { id: eventId } });
  }
  if (createdEventId) await db.event.delete({ where: { id: createdEventId } });
  for (const key of [coverKey, coverKey?.replace(".webp", ".thumb.webp")]) if (key) { try { await unlink(join(uploadDir, key)); } catch (error) { if (error.code !== "ENOENT") throw error; } }
  for (const key of [createdCoverKey, createdCoverKey?.replace(".webp", ".thumb.webp")]) if (key) { try { await unlink(join(uploadDir, key)); } catch (error) { if (error.code !== "ENOENT") throw error; } }
  if (ownerId) await db.user.delete({ where: { id: ownerId } });
  await db.$disconnect();
}
