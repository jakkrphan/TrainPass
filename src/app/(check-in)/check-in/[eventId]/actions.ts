"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { requireEventAccess } from "@/server/authorization/event";
import { canManageEvent, requiresAdminAudit } from "@/server/authorization/policy";
import { readRegistrationFields } from "@/features/events/registration-fields";
import { registrantDisplayName } from "@/features/registrations/display-name";
import { db } from "@/server/db";
import { normalizeQrCode } from "@/server/registrations/qr-code";
import { mergeAnswers } from "@/server/registrations/self-edit";
import { cleanStation, currentStation, STATION_COOKIE } from "@/server/checkin/station";
import { isFeatureEnabled } from "@/server/settings/features";
import { withBasePath } from "@/lib/base-path";

export type ScanPerson = {
  id: string;
  /** First non-sensitive check-in field (usually the name), or a masked email. */
  name: string;
  /** Second check-in field, e.g. department. */
  detail: string | null;
  /** The person's approved days, e.g. "วันที่ 1, 3". */
  days: string;
};

export type ScanResult = {
  kind: "success" | "duplicate" | "invalid" | "wrong-day" | "session-missing" | "error";
  message: string;
  /** Set on wrong-day results when the operator may admit the person as a special case. */
  canOverride?: boolean;
  person?: ScanPerson;
  /** Active check-ins in this session / people expected (approved for the session's day). */
  count?: { checked: number; expected: number };
  time?: string;
  /** Whole-course events: which session of the course this is and how many the person has attended. */
  progress?: { session: number; total: number; attended: number };
  /** This exact scan (same clientEventId) was saved earlier, e.g. before its answer was lost on the network. */
  alreadySaved?: boolean;
};

const timeFormatter = new Intl.DateTimeFormat("th-TH", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" });
const maskEmail = (email: string | null) => email ? `${email.slice(0, 2)}***${email.slice(email.indexOf("@"))}` : "ผู้เข้าร่วม";
const answerText = (value: unknown) => Array.isArray(value) ? value.join(", ") : typeof value === "string" ? value : "";

/** What the check-in screen may show about a person: only fields marked for check-in and never sensitive ones. */
async function describePerson(tx: Prisma.TransactionClient, event: { id: string; fields: Prisma.JsonValue }, person: { id: string; email: string | null; answers: Prisma.JsonValue; days: { eventDayId: string; status: string }[] }): Promise<ScanPerson> {
  const visible = readRegistrationFields(event.fields).filter((field) => field.showOnCheckin && !field.sensitive && field.type !== "file");
  const answers = person.answers && typeof person.answers === "object" && !Array.isArray(person.answers) ? person.answers as Record<string, unknown> : {};
  const values = visible.map((field) => answerText(answers[field.key]).trim()).filter(Boolean);
  const order = (await tx.eventDay.findMany({ where: { eventId: event.id }, orderBy: { date: "asc" }, select: { id: true } })).map((day) => day.id);
  const approved = person.days.filter((day) => day.status === "APPROVED").map((day) => order.indexOf(day.eventDayId) + 1).filter((number) => number > 0).sort((a, b) => a - b);
  return { id: person.id, name: values[0] ?? maskEmail(person.email), detail: values[1] ?? null, days: approved.length ? `วันที่ ${approved.join(", ")}` : "—" };
}

async function sessionCount(tx: Prisma.TransactionClient, eventId: string, session: { id: string; eventDayId: string | null }) {
  const [checked, expected] = await Promise.all([
    tx.checkIn.count({ where: { sessionId: session.id, voidedAt: null } }),
    tx.registrant.count({ where: { eventId, status: "APPROVED", ...(session.eventDayId ? { days: { some: { eventDayId: session.eventDayId, status: "APPROVED" } } } : {}) } }),
  ]);
  return { checked, expected };
}

function validClientEventId(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) || /^[0-9a-f]{64}$/i.test(value);
}

const checkInMethods = ["camera", "scanner", "manual", "kiosk"] as const;

/** Names this device's check-in point (e.g. "จุดที่ 2 · โต๊ะหน้าห้อง"); an empty name clears it. */
export async function setCheckInStation(eventId: string, sessionId: string, formData: FormData) {
  await requireEventAccess(eventId, "checkIn");
  const name = cleanStation(formData.get("station"));
  const store = await cookies();
  if (name) store.set(STATION_COOKIE, name, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: withBasePath("/check-in"), maxAge: 60 * 60 * 24 * 365 });
  else store.delete({ name: STATION_COOKIE, path: withBasePath("/check-in") });
  redirect(`/check-in/${eventId}?session=${sessionId}`);
}
export type CheckInMethod = (typeof checkInMethods)[number];

async function recordCheckIn(eventId: string, sessionId: string, code: string, options: { clientEventId?: string; scannedAt?: string; override?: { note: string }; method?: string }): Promise<ScanResult> {
  const { user, event, membership } = await requireEventAccess(eventId, "checkIn");
  const overrideEnabled = await isFeatureEnabled("checkinOverride");
  const mayOverride = canManageEvent(membership) && overrideEnabled;
  const station = await currentStation();
  if (options.override && !overrideEnabled) return { kind: "invalid", message: "ผู้ดูแลระบบปิดการอนุญาตกรณีพิเศษไว้" };
  if (options.override && !mayOverride) return { kind: "invalid", message: "บัญชีนี้ไม่มีสิทธิ์อนุญาตเป็นกรณีพิเศษ" };
  if (!code || code.length > 200) return { kind: "invalid", message: "รหัสไม่ถูกต้อง" };
  const { clientEventId } = options;
  if (clientEventId && !validClientEventId(clientEventId)) return { kind: "invalid", message: "รหัสรายการออฟไลน์ไม่ถูกต้อง" };
  const scannedDate = options.scannedAt ? new Date(options.scannedAt) : new Date();
  if (Number.isNaN(scannedDate.valueOf()) || scannedDate.getTime() > Date.now() + 5 * 60 * 1000) return { kind: "invalid", message: "เวลาเช็คชื่อไม่ถูกต้อง" };
  const fromQueue = !!options.scannedAt;
  try {
    const result = await db.$transaction(async (tx): Promise<ScanResult> => {
      if (clientEventId && await tx.checkIn.findUnique({ where: { clientEventId }, select: { id: true } })) return { kind: "duplicate", message: "รายการสแกนนี้บันทึกแล้ว", alreadySaved: true };
      const session = await tx.session.findFirst({ where: { id: sessionId, eventId }, select: { id: true, eventDayId: true } });
      if (!session) return { kind: "session-missing", message: "รอบเช็คชื่อนี้ถูกลบแล้ว ไม่ได้บันทึก กรุณาแจ้งผู้จัด" };
      const person = await tx.registrant.findFirst({ where: { eventId, qrCode: normalizeQrCode(code) }, select: { id: true } });
      if (!person) return { kind: "invalid", message: "ไม่พบรหัสที่อนุมัติแล้ว (อาจยังไม่อนุมัติหรือถูกยกเลิกแล้ว)" };
      await tx.$queryRaw`SELECT id FROM Registrant WHERE id = ${person.id} FOR UPDATE`;
      const current = await tx.registrant.findUnique({ where: { id: person.id }, select: { id: true, email: true, answers: true, status: true, qrCode: true, days: { select: { eventDayId: true, status: true } } } });
      if (current?.status !== "APPROVED" || current.qrCode !== normalizeQrCode(code)) return { kind: "invalid", message: "ไม่พบรหัสที่อนุมัติแล้ว (อาจยังไม่อนุมัติหรือถูกยกเลิกแล้ว)" };
      const who = await describePerson(tx, event, current);
      const existing = await tx.checkIn.findUnique({ where: { activeKey: `${person.id}:${sessionId}` }, select: { checkedInAt: true } });
      if (existing) return { kind: "duplicate", message: `${fromQueue ? "มีการเช็คชื่อจากเครื่องอื่นแล้ว" : "เช็คชื่อรอบนี้ไปแล้ว"} เมื่อ ${timeFormatter.format(existing.checkedInAt)}`, person: who, time: timeFormatter.format(existing.checkedInAt), count: await sessionCount(tx, eventId, session) };
      const dayRow = session.eventDayId ? current.days.find((day) => day.eventDayId === session.eventDayId) : undefined;
      const outsideDay = !!session.eventDayId && dayRow?.status !== "APPROVED";
      if (outsideDay && !options.override) {
        const message = !dayRow
          ? event.seatMode === "whole_course" ? "ไม่พบวันนี้ในรายการของผู้เข้าอบรม (ข้อมูลหลักสูตรไม่ครบ กรุณาแจ้งผู้จัดตรวจสอบ)" : "ไม่ได้ลงทะเบียนวันนี้ไว้"
          : dayRow.status === "WAITLISTED" ? "วันนี้ยังอยู่ในคิวรอ" : "ยังไม่ได้รับอนุมัติสำหรับวันที่ของรอบนี้";
        return { kind: "wrong-day", message, canOverride: mayOverride, person: who };
      }
      const checkIn = await tx.checkIn.create({ data: {
        registrantId: person.id, sessionId, checkedInById: user.id, checkedInAt: scannedDate, clientEventId, activeKey: `${person.id}:${sessionId}`, station,
        method: options.override ? "override" : checkInMethods.includes(options.method as CheckInMethod) ? options.method : null,
        ...(outsideDay && options.override ? { isOverride: true, overrideNote: options.override.note } : {}),
      }, select: { id: true } });
      if (outsideDay && options.override) {
        await tx.auditLog.create({ data: { eventId, actorId: user.id, action: "CHECKIN_OVERRIDE", target: checkIn.id, metadata: { sessionId, registrantId: person.id, dayStatus: dayRow?.status ?? "NOT_REGISTERED", note: options.override.note } } });
      }
      const prefix = outsideDay ? "อนุญาตเป็นกรณีพิเศษและเช็คชื่อแล้ว" : "เช็คชื่อสำเร็จ";
      const details = { person: who, time: timeFormatter.format(scannedDate), count: await sessionCount(tx, eventId, session) };
      if (event.seatMode === "whole_course") {
        const allSessions = await tx.session.findMany({ where: { eventId }, orderBy: [{ eventDay: { date: "asc" } }, { sortOrder: "asc" }, { label: "asc" }], select: { id: true } });
        const checked = await tx.checkIn.count({ where: { registrantId: person.id, session: { eventId }, voidedAt: null } });
        const progress = { session: allSessions.findIndex((item) => item.id === sessionId) + 1, total: allSessions.length, attended: checked };
        return { kind: "success", message: `${prefix} · รอบนี้เป็นรอบที่ ${progress.session} จาก ${progress.total} · เข้าแล้ว ${progress.attended} รอบ`, progress, ...details };
      }
      return { kind: "success", message: prefix, ...details };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    if (result.kind === "success") {
      revalidatePath(`/check-in/${eventId}`);
      revalidatePath(`/organizer/${eventId}/registrants`);
    }
    return result;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return { kind: "duplicate", message: fromQueue ? "มีการเช็คชื่อจากเครื่องอื่นแล้ว" : "เช็คชื่อรอบนี้ไปแล้ว" };
    throw error;
  }
}

export async function checkInCode(eventId: string, sessionId: string, code: string, clientEventId?: string, scannedAt?: string, method?: CheckInMethod): Promise<ScanResult> {
  return recordCheckIn(eventId, sessionId, code, { clientEventId, scannedAt, method });
}

/** Admits someone whose day is not approved; limited to owner, full collaborators and admins, with a mandatory reason. */
export async function overrideCheckIn(eventId: string, sessionId: string, code: string, note: string): Promise<ScanResult> {
  const reason = note.trim().slice(0, 500);
  if (reason.length < 3) return { kind: "wrong-day", message: "กรุณาระบุเหตุผลอย่างน้อย 3 ตัวอักษร", canOverride: true };
  return recordCheckIn(eventId, sessionId, code, { override: { note: reason } });
}

export async function checkInPerson(eventId: string, sessionId: string, registrantId: string): Promise<ScanResult> {
  await requireEventAccess(eventId, "checkIn");
  const person = await db.registrant.findFirst({ where: { id: registrantId, eventId, status: "APPROVED" }, select: { qrCode: true } });
  return person?.qrCode ? checkInCode(eventId, sessionId, person.qrCode, undefined, undefined, "manual") : { kind: "invalid", message: "ผู้สมัครยังไม่ได้รับอนุมัติ" };
}

export async function checkInPersonForm(eventId: string, sessionId: string, registrantId: string) {
  const result = await checkInPerson(eventId, sessionId, registrantId);
  redirect(`/check-in/${eventId}?session=${sessionId}&result=${result.kind}`);
}

export async function checkInCodeForm(eventId: string, sessionId: string, formData: FormData) {
  const raw = formData.get("code");
  const result = await checkInCode(eventId, sessionId, typeof raw === "string" ? raw : "", undefined, undefined, "scanner");
  redirect(`/check-in/${eventId}?session=${sessionId}&result=${result.kind}`);
}

export async function undoCheckIn(eventId: string, sessionId: string, registrantId: string) {
  const { membership, user } = await requireEventAccess(eventId, "checkIn");
  const session = await db.session.findFirst({ where: { id: sessionId, eventId }, select: { id: true } });
  if (!session) return;
  await db.$transaction(async (tx) => {
    const record = await tx.checkIn.findFirst({ where: { sessionId, registrantId, registrant: { eventId }, voidedAt: null }, select: { id: true, checkedInAt: true } });
    if (!record) return;
    const limited = membership.systemRole !== "admin" && membership.userId !== membership.ownerId && membership.collaboratorRole === "checkin_only";
    if (limited && Date.now() - record.checkedInAt.getTime() > 10 * 60 * 1000) return;
    await tx.checkIn.update({ where: { id: record.id }, data: { voidedAt: new Date(), voidedById: user.id, activeKey: null } });
    await tx.auditLog.create({ data: { eventId, actorId: user.id, action: requiresAdminAudit(membership) ? "CHECKIN_REVOKED_BY_ADMIN" : "CHECKIN_VOIDED", target: record.id, metadata: { sessionId, registrantId } } });
  });
  revalidatePath(`/check-in/${eventId}`);
}

/**
 * On-site correction of small mistakes (e.g. a misspelt name) before checking someone in.
 * Only fields shown on the check-in screen may change, for every role, and each change is audited.
 */
export async function correctCheckInAnswers(eventId: string, sessionId: string, registrantId: string, formData: FormData) {
  const { user, event } = await requireEventAccess(eventId, "checkIn");
  const fields = readRegistrationFields(event.fields);
  const editable = new Set(fields.filter((field) => field.showOnCheckin && !field.sensitive && field.type !== "file").map((field) => field.key));
  const query = formData.get("q");
  const back = `/check-in/${eventId}?session=${sessionId}${typeof query === "string" && query ? `&q=${encodeURIComponent(query)}` : ""}`;
  const person = await db.registrant.findFirst({ where: { id: registrantId, eventId, status: "APPROVED", anonymizedAt: null }, select: { answers: true } });
  if (!person || !editable.size) redirect(`${back}&corrected=invalid`);
  const merged = mergeAnswers(fields, person.answers, formData, editable);
  if ("problem" in merged) redirect(`${back}&corrected=invalid`);
  if (merged.changed.length) {
    await db.$transaction([
      db.registrant.update({ where: { id: registrantId }, data: { answers: merged.answers as Prisma.InputJsonValue, displayName: registrantDisplayName(fields, merged.answers) } }),
      db.auditLog.create({ data: { eventId, actorId: user.id, action: "CHECKIN_ANSWERS_CORRECTED", target: registrantId, metadata: { changedFields: merged.changed, sessionId } } }),
    ]);
    revalidatePath(`/check-in/${eventId}`);
  }
  redirect(`${back}&corrected=${merged.changed.length ? "1" : "0"}`);
}
