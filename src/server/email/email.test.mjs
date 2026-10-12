import assert from "node:assert/strict";
import test from "node:test";
import nodemailer from "nodemailer";

import { emailOrigin, sendEmail, smtpConfig, smtpFailure } from "./client.ts";
import { buildEmailMessage, emailSnapshot, QR_CONTENT_ID } from "./message.ts";

const env = { SMTP_HOST: "mail.example.test", SMTP_USER: "sender", SMTP_PASS: "test-secret", SMTP_FROM: "sender@example.test" };
const person = (overrides = {}) => ({
  id: "r1", email: "recipient@example.test", displayName: "สมชาย ใจดี", status: "APPROVED", statusTokenHash: "hash", qrCode: "private-qr", rejectReason: null,
  emailNotifiedHash: null, notifyVia: "EMAIL", anonymizedAt: null,
  days: [{ eventDayId: "d1", status: "APPROVED" }, { eventDayId: "d2", status: "WAITLISTED" }],
  event: { title: "อบรมทดสอบ", location: "อาคารภูมิพัฒน์ ชั้น 9", slug: "demo", seatMode: "per_day", deletedAt: null, anonymizedAt: null, days: [{ id: "d1", date: new Date("2031-12-01") }, { id: "d2", date: new Date("2031-12-02") }] },
  ...overrides,
});
const url = "https://example.test/events/demo/status/private-link";

test("SMTP uses implicit TLS on 465 and requires STARTTLS on 587", () => {
  assert.equal(smtpConfig(env).options.secure, true);
  assert.equal(smtpConfig({ ...env, SMTP_PORT: "587", SMTP_SECURE: "false" }).options.requireTLS, true);
  for (const patch of [{ SMTP_PASS: "" }, { SMTP_PORT: "70000" }, { SMTP_SECURE: "yes" }, { SMTP_FROM: "bad\r\nBcc: victim@example.test" }]) assert.equal(smtpConfig({ ...env, ...patch }), null);
});

test("production status links require a trusted HTTPS origin", () => {
  assert.equal(emailOrigin({ NODE_ENV: "development" }), "http://localhost:3100");
  for (const value of [undefined, "http://example.test", "https://user:pass@example.test", "https://example.test/evil", "https://example.test/?foo=bar"]) assert.equal(emailOrigin({ NODE_ENV: "production", APP_BASE_URL: value }), null);
  assert.equal(emailOrigin({ NODE_ENV: "production", APP_BASE_URL: "https://example.test/" }), "https://example.test");
});

test("transient SMTP failures retry and error logs exclude server response and credentials", () => {
  assert.deepEqual(smtpFailure({ responseCode: 451, response: "secret@example.test", message: "password" }), { ok: false, retry: true, error: "SMTP 451" });
  assert.equal(smtpFailure({ responseCode: 550 }).retry, false);
  assert.equal(smtpFailure({ code: "EAUTH" }).retry, false);
  assert.equal(smtpFailure({ code: "ETIMEDOUT" }).retry, true);
  assert.equal(smtpFailure({ code: "password" }).error, "SMTP_ERROR");
});

test("mixed approval and waitlist show both dates and only approved days may use the QR", () => {
  const mail = buildEmailMessage(person(), url);
  assert.match(mail.text, /วันที่ 1 .*อนุมัติแล้ว/);
  assert.match(mail.text, /วันที่ 2 .*คิวสำรอง/);
  assert.match(mail.text, /เฉพาะวันที่ได้รับอนุมัติ/);
  assert.ok(mail.text.includes(url));
  assert.equal(mail.attachQr, true);
});

test("approved HTML is a ticket with the inline QR, name, place and approved dates", () => {
  const html = buildEmailMessage(person(), url).html;
  assert.ok(html.includes(`src="cid:${QR_CONTENT_ID}"`));
  for (const part of ["บัตรเข้าร่วมอบรม", "สมชาย ใจดี", "อาคารภูมิพัฒน์ ชั้น 9", "private-qr", "(วันที่ 1)", "คิวสำรอง", url]) assert.ok(html.includes(part), part);
  assert.ok(!html.includes("(วันที่ 2)"), "waitlisted day is not printed on the ticket");
});

test("pending, waitlist, rejected and cancelled results never attach QR even if a stale code exists", () => {
  for (const status of ["PENDING", "WAITLISTED", "REJECTED", "CANCELLED"]) {
    const mail = buildEmailMessage(person({ status, days: [{ eventDayId: "d1", status }] }), url);
    assert.equal(mail.attachQr, false);
    assert.ok(!mail.html.includes("cid:") && !mail.html.includes("private-qr"));
  }
});

test("rejection reasons and event titles are escaped in HTML and do not inject subject headers", () => {
  const p = person({ status: "REJECTED", rejectReason: '<script>alert("x")</script>', days: [{ eventDayId: "d1", status: "REJECTED" }] });
  p.event.title = "Title\r\nBcc: other@example.test <img src=x>";
  const mail = buildEmailMessage(p, url);
  assert.match(mail.text, /เหตุผล: <script>/);
  assert.ok(!mail.html.includes("<script>") && !mail.html.includes("<img"));
  assert.ok(!/[\r\n]/.test(mail.subject));
});

test("whole-course results include the course and all selected dates", () => {
  const p = person(); p.event.seatMode = "whole_course";
  assert.match(buildEmailMessage(p, url).text, /หลักสูตร 2 วัน/);
});

test("notification fingerprint ignores day order but detects promotion, changed QR, reason and link rotation", () => {
  const original = person();
  const fingerprint = emailSnapshot(original);
  assert.equal(emailSnapshot(person({ days: [...original.days].reverse() })), fingerprint);
  for (const patch of [{ qrCode: "replacement-qr" }, { statusTokenHash: "replacement-link" }, { rejectReason: "reason" }, { days: [{ eventDayId: "d1", status: "APPROVED" }, { eventDayId: "d2", status: "PENDING" }] }]) assert.notEqual(emailSnapshot(person(patch)), fingerprint);
  assert.match(fingerprint, /^[a-f0-9]{64}$/);
});

test("SMTP sends one recipient with a PNG attachment, stable message ID, and always closes transport", async (t) => {
  const previous = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  Object.assign(process.env, env);
  t.after(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  let sent, closed = 0;
  t.mock.method(nodemailer, "createTransport", (options) => {
    assert.equal(options.disableFileAccess, true); assert.equal(options.disableUrlAccess, true);
    return { sendMail: async (mail) => { sent = mail; return { accepted: [mail.to.address] }; }, close: () => closed++ };
  });
  const png = Buffer.from("fake-png");
  const result = await sendEmail({ to: "recipient@example.test", subject: "ผล", text: "text", html: "html", retryKey: "fixed-id", qr: png });
  assert.equal(result.ok, true);
  assert.deepEqual(sent.from, { name: "ระบบ TrainPass", address: "sender@example.test" });
  assert.deepEqual(sent.to, { address: "recipient@example.test", name: "" });
  assert.equal(sent.messageId, "<fixed-id@example.test>");
  assert.equal(sent.attachments[0].content, png);
  assert.equal(sent.attachments[0].cid, QR_CONTENT_ID);
  assert.equal(closed, 1);
  assert.equal((await sendEmail({ to: "a@example.test,b@example.test", subject: "", text: "", html: "", retryKey: "id" })).ok, false);
});
