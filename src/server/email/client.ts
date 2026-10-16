import nodemailer from "nodemailer";
import { z } from "zod";

import { QR_CONTENT_ID } from "@/server/email/message";

/** SMTP secrets stay on the server and are never included in delivery errors. */
export function smtpConfig(env: NodeJS.ProcessEnv = process.env) {
  const port = Number(env.SMTP_PORT || 465);
  const secure = env.SMTP_SECURE ? env.SMTP_SECURE === "true" : port === 465;
  const from = env.SMTP_FROM?.trim();
  if (!env.SMTP_HOST?.trim() || !env.SMTP_USER || !env.SMTP_PASS || !from ||
    !z.email().safeParse(from).success || !Number.isInteger(port) || port < 1 || port > 65535 ||
    (env.SMTP_SECURE && !["true", "false"].includes(env.SMTP_SECURE))) return null;
  return {
    from,
    options: {
      host: env.SMTP_HOST.trim(), port, secure, requireTLS: !secure,
      auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
      connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000,
      disableFileAccess: true, disableUrlAccess: true,
    },
  };
}

export const emailConfigured = () => smtpConfig() !== null;

export function emailOrigin(env: NodeJS.ProcessEnv = process.env) {
  if (!env.APP_BASE_URL && env.NODE_ENV !== "production") return "http://localhost:3100";
  try {
    const url = new URL(env.APP_BASE_URL || "");
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash ||
      !["http:", "https:"].includes(url.protocol) || (env.NODE_ENV === "production" && url.protocol !== "https:")) return null;
    return url.origin;
  } catch { return null; }
}

export type EmailResult = { ok: true } | { ok: false; retry: boolean; error: string };

export function smtpFailure(error: unknown): EmailResult {
  const failure = error as { code?: string; responseCode?: number } | null;
  const response = Number(failure?.responseCode);
  const knownCodes = ["EAUTH", "ECONNECTION", "ETIMEDOUT", "EDNS", "ESOCKET", "EENVELOPE", "EMESSAGE", "EPROTOCOL", "ETLS"];
  const code = knownCodes.includes(failure?.code || "") ? failure!.code! : "SMTP_ERROR";
  // Never persist the server's response/message: it can contain credentials or recipient addresses.
  return { ok: false, retry: response >= 400 && response < 500 || !response && !["EAUTH", "EENVELOPE", "EMESSAGE", "ETLS"].includes(code), error: Number.isInteger(response) && response >= 400 && response <= 599 ? `SMTP ${response}` : code };
}

export async function sendEmail(message: { to: string; subject: string; text: string; html: string; qr?: Buffer; retryKey: string }): Promise<EmailResult> {
  const config = smtpConfig();
  if (!config) return { ok: false, retry: false, error: "SMTP_NOT_CONFIGURED" };
  if (!z.email().safeParse(message.to).success) return { ok: false, retry: false, error: "INVALID_RECIPIENT" };
  const transport = nodemailer.createTransport(config.options);
  try {
    const result = await transport.sendMail({
      from: { name: "ระบบ TrainPass", address: config.from },
      to: { address: message.to, name: "" },
      subject: message.subject, text: message.text, html: message.html,
      // Stable across retries; SMTP itself does not guarantee exactly-once delivery.
      messageId: `<${message.retryKey}@${config.from.split("@")[1]}>`,
      // Inline (cid) so the ticket HTML shows it; clients that hide inline parts still offer it as a download.
      attachments: message.qr ? [{ filename: "checkin-qr.png", content: message.qr, contentType: "image/png", cid: QR_CONTENT_ID }] : [],
    });
    return result.accepted.length ? { ok: true } : { ok: false, retry: false, error: "SMTP_RECIPIENT_REJECTED" };
  } catch (error) { return smtpFailure(error); }
  finally { transport.close(); }
}
