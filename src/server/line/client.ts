// LINE platform calls (spec 2.1): LINE Login for registrants and the Messaging API (the OA) for push messages.
// Two channels under one provider — otherwise the user ID from Login cannot receive pushes from the OA.
// Env names are documented in .env.example; values are never logged.

import { withBasePath } from "@/lib/base-path";

const LOGIN_ENV = ["LINE_LOGIN_CHANNEL_ID", "LINE_LOGIN_CHANNEL_SECRET"] as const;
const MESSAGING_ENV = ["LINE_MESSAGING_ACCESS_TOKEN"] as const;
const env = (name: string) => process.env[name]?.trim() ?? "";

/** Both channels have their keys (the admin switch is checked separately with isFeatureEnabled("lineLogin")). */
export function lineConfigured() {
  return [...LOGIN_ENV, ...MESSAGING_ENV].every((name) => !!env(name));
}

/** Where LINE sends people back after login; must be registered in the LINE Login channel. */
export function lineCallbackUrl(origin: string) {
  return `${(process.env.APP_BASE_URL ?? origin).replace(/\/$/, "")}${withBasePath("/api/line/callback")}`;
}

export function lineAuthorizeUrl(options: { redirectUri: string; state: string; nonce: string }) {
  const url = new URL("https://access.line.me/oauth2/v2.1/authorize");
  url.search = new URLSearchParams({
    response_type: "code", client_id: env("LINE_LOGIN_CHANNEL_ID"), redirect_uri: options.redirectUri, state: options.state, nonce: options.nonce,
    scope: "profile openid",
    // Ask to add the OA as a friend on the consent screen; pushes only reach friends.
    bot_prompt: "aggressive",
  }).toString();
  return url.toString();
}

/** Code → tokens → verified LINE user ID, plus whether the person is a friend of the linked OA. */
export async function completeLineLogin(code: string, redirectUri: string, nonce: string) {
  const tokenResponse = await fetch("https://api.line.me/oauth2/v2.1/token", {
    method: "POST", cache: "no-store",
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri, client_id: env("LINE_LOGIN_CHANNEL_ID"), client_secret: env("LINE_LOGIN_CHANNEL_SECRET") }),
  });
  if (!tokenResponse.ok) {
    const body = await tokenResponse.json().catch(() => ({})) as { error?: string };
    return { ok: false as const, reason: `token-${tokenResponse.status}-${body.error ?? "unknown"}` };
  }
  const tokens = await tokenResponse.json() as { access_token: string; id_token: string };
  const verifyResponse = await fetch("https://api.line.me/oauth2/v2.1/verify", {
    method: "POST", cache: "no-store",
    body: new URLSearchParams({ id_token: tokens.id_token, client_id: env("LINE_LOGIN_CHANNEL_ID"), nonce }),
  });
  if (!verifyResponse.ok) {
    const body = await verifyResponse.json().catch(() => ({})) as { error_description?: string };
    return { ok: false as const, reason: `id-token-${verifyResponse.status}-${(body.error_description ?? "unknown").slice(0, 80)}` };
  }
  const idToken = await verifyResponse.json() as { sub?: string };
  if (!idToken.sub || !/^U[0-9a-f]{32}$/.test(idToken.sub)) return { ok: false as const, reason: "id-token-subject" };
  const friendship = await fetch("https://api.line.me/friendship/v1/status", { headers: { authorization: `Bearer ${tokens.access_token}` }, cache: "no-store" });
  const friend = friendship.ok ? ((await friendship.json()) as { friendFlag?: boolean }).friendFlag === true : false;
  return { ok: true as const, userId: idToken.sub, friend };
}

export type PushResult = { ok: true } | { ok: false; retry: boolean; error: string };

export type LineMessage = { type: "text"; text: string } | { type: "flex"; altText: string; contents: object };

/** One push; `retryKey` makes LINE drop a duplicate if an earlier attempt did get through. */
export async function pushLineMessage(to: string, message: LineMessage, retryKey: string): Promise<PushResult> {
  let response: Response;
  try {
    response = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST", cache: "no-store",
      headers: { authorization: `Bearer ${env("LINE_MESSAGING_ACCESS_TOKEN")}`, "content-type": "application/json", "x-line-retry-key": retryKey },
      body: JSON.stringify({ to, messages: [message.type === "text" ? { ...message, text: message.text.slice(0, 5000) } : message] }),
    });
  } catch (error) {
    return { ok: false, retry: true, error: `network ${(error as Error).name}`.slice(0, 255) };
  }
  // 409: this retry key was already accepted — the message went out on an earlier attempt.
  if (response.ok || response.status === 409) return { ok: true };
  const body = await response.json().catch(() => ({})) as { message?: string };
  // 429 and 5xx are temporary; 4xx (blocked the OA, not a friend, bad user ID, quota used up) will not fix itself.
  return { ok: false, retry: response.status === 429 || response.status >= 500, error: `HTTP ${response.status} ${body.message ?? ""}`.trim().slice(0, 255) };
}

let basicId: Promise<string | null> | null = null;
/** The OA's @ID for "add friend" links (https://line.me/R/ti/p/@id); fetched once per server process. */
export function lineOaBasicId() {
  basicId ??= fetch("https://api.line.me/v2/bot/info", { headers: { authorization: `Bearer ${env("LINE_MESSAGING_ACCESS_TOKEN")}` } })
    .then(async (response) => response.ok ? ((await response.json()) as { basicId?: string }).basicId ?? null : null)
    .catch(() => null)
    .then((value) => { if (!value) basicId = null; return value; });
  return basicId;
}
