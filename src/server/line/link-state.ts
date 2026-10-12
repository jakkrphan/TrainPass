import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// Carries a "connect LINE" attempt from the status page through LINE Login and back, in an httpOnly cookie bound to
// the browser that started it: LINE's `state` must match the cookie (CSRF), `nonce` is checked in the ID token, and
// the registrant is the one whose status link started the flow. Signed so it cannot be edited; expires in 10 minutes.
// When the callback arrives without the cookie, the signed `state` alone identifies the attempt (see below).

export const LINE_LINK_COOKIE = "line-link";
export const LINE_LINK_MAX_AGE = 10 * 60;

/** `redirectUri` is the exact callback URL sent to LINE; the code exchange must repeat it byte for byte. */
export type LineLinkState = { state: string; nonce: string; registrantId: string; returnPath: string; redirectUri: string; expiresAt: number };

function sign(payload: string) {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is required for LINE linking");
  return createHmac("sha256", secret).update(`line-link:${payload}`).digest("base64url");
}

// On phones LINE often finishes the login in its own app and opens the callback in LINE's in-app browser, which does
// not have the cookie. So `state` is itself signed (`<registrantId>.<expiry>.<random>.<sig>`) and the nonce derives
// from it: the callback can then verify the attempt without the cookie. It carries no status token, because LINE
// sees it and it lands in access logs.
const REGISTRANT_ID = /^[a-z0-9]{20,40}$/;

export function lineNonceFor(state: string) {
  return sign(`nonce:${state}`).slice(0, 32);
}

function signedState(registrantId: string, expiresAt: number) {
  const body = `${registrantId}.${expiresAt.toString(36)}.${randomBytes(9).toString("base64url")}`;
  return `${body}.${sign(`state:${body}`)}`;
}

/** The registrant and expiry of a signed `state`, or null when it was edited, forged or has expired. */
export function verifyLineState(state: string | null | undefined): { registrantId: string; expiresAt: number } | null {
  const parts = state?.split(".") ?? [];
  if (parts.length !== 4) return null;
  const [registrantId, expiry, random, signature] = parts as [string, string, string, string];
  const expected = Buffer.from(sign(`state:${registrantId}.${expiry}.${random}`));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  const expiresAt = Number.parseInt(expiry, 36);
  if (!REGISTRANT_ID.test(registrantId) || !Number.isFinite(expiresAt) || expiresAt < Date.now()) return null;
  return { registrantId, expiresAt };
}

export function newLineLinkState(registrantId: string, returnPath: string, redirectUri: string): LineLinkState {
  const expiresAt = Date.now() + LINE_LINK_MAX_AGE * 1000;
  const state = signedState(registrantId, expiresAt);
  return { state, nonce: lineNonceFor(state), registrantId, returnPath, redirectUri, expiresAt };
}

export function encodeLineLinkState(value: LineLinkState) {
  const payload = Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function decodeLineLinkState(cookie: string | undefined): LineLinkState | null {
  const [payload, signature] = cookie?.split(".") ?? [];
  if (!payload || !signature) return null;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const value = JSON.parse(Buffer.from(payload, "base64url").toString()) as LineLinkState;
    // Only ever send people back to a status page on this site.
    if (value.expiresAt < Date.now() || !/^\/events\/[^/?#]+\/status\/[^/?#]+$/.test(value.returnPath) || !/^https?:\/\/[^/]+(?:\/[^?#]*)?\/api\/line\/callback$/.test(value.redirectUri)) return null;
    return value;
  } catch {
    return null;
  }
}
