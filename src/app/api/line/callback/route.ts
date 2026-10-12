import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { completeLineLogin } from "@/server/line/client";
import { lineAvailable, lineLinkFromState, linkLineAccount } from "@/server/line/link";
import { decodeLineLinkState, LINE_LINK_COOKIE } from "@/server/line/link-state";
import { db } from "@/server/db";
import { lineStatusToken } from "@/server/registrations/status-token";
import { withBasePath } from "@/lib/base-path";

export const dynamic = "force-dynamic";

/**
 * LINE Login comes back here after a registrant chooses LINE (registration form or status page). The LINE account is stored only when the
 * login is verified (signed state + nonce + ID token) and the person is a friend of the OA — pushes reach friends only.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const store = await cookies();
  // No cookie when LINE opened the callback in its in-app browser: fall back to the signed `state`.
  const cookieLink = decodeLineLinkState(store.get(LINE_LINK_COOKIE)?.value);
  const link = cookieLink ?? await lineLinkFromState(url.searchParams.get("state"));
  store.delete({ name: LINE_LINK_COOKIE, path: withBasePath("/api/line") });
  if (!link) return notice(400, "ลิงก์เชื่อม LINE หมดอายุ", "กรุณากลับไปที่หน้าสถานะการลงทะเบียน แล้วกดเชื่อม LINE อีกครั้ง");
  // Back to the host the flow started on (APP_BASE_URL or the request's Host). Not `url.origin`: Next builds request.url from its own
  // hostname (localhost:3000) with the forwarded proto, so behind an https tunnel it would send the person to https://localhost:3000.
  const origin = new URL(link.redirectUri).origin;
  // Without the cookie, link.returnPath is a full status link rebuilt from `state` alone — and `state` is not secret (LINE sees
  // it, access logs keep it). So that link is handed out only after a verified LINE login (`proven`); before that, a plain page.
  const back = (result: string, proven = false) => cookieLink || proven
    ? NextResponse.redirect(`${origin}${withBasePath(link.returnPath)}?line=${result}#line`, 303)
    : notice(200, "เชื่อม LINE ไม่สำเร็จ", `${failureText[result] ?? failureText.error} กรุณาเปิดหน้าสถานะการลงทะเบียนจากลิงก์เดิมของคุณ แล้วกดเชื่อม LINE อีกครั้ง`);
  if (url.searchParams.get("state") !== link.state) return back("error");
  // The person pressed cancel / did not allow on LINE's consent screen.
  if (url.searchParams.get("error")) return back("cancelled");
  const code = url.searchParams.get("code");
  if (!code || !(await lineAvailable())) return back(code ? "unavailable" : "error");

  // Same redirect_uri as the authorize request (stored in the state cookie) — LINE rejects the exchange otherwise.
  const login = await completeLineLogin(code, link.redirectUri, link.nonce);
  if (!login.ok) {
    // Reason codes only (e.g. token-400), never tokens or LINE IDs — PDPA logging rule.
    console.warn(`LINE link failed: ${login.reason}`);
    return back("error");
  }
  // From here the login is verified against this attempt's nonce: it is the person who started it.
  if (!login.friend) return back("not-friend", true);
  const registrant = await db.registrant.findUnique({ where: { id: link.registrantId }, select: { status: true, anonymizedAt: true, event: { select: { deletedAt: true } } } });
  if (!registrant || registrant.anonymizedAt || registrant.event.deletedAt || registrant.status === "CANCELLED" || registrant.status === "REJECTED") return back("closed", true);
  const linked = await linkLineAccount(link.registrantId, login.userId);
  if (linked.result === "linked") return back("linked", true);
  // Proven owner of that LINE account: open the registration it already has (LINE-signed status link), not the cancelled copy.
  const slug = link.returnPath.split("/")[2];
  if (linked.original) return NextResponse.redirect(`${origin}${withBasePath(`/events/${slug}/status/${lineStatusToken(linked.original)}`)}?line=duplicate#line`, 303);
  return back("duplicate", true);
}

const failureText: Record<string, string> = {
  cancelled: "คุณยกเลิกการเชื่อม LINE",
  unavailable: "ระบบปิดการเชื่อม LINE อยู่ชั่วคราว",
  error: "การเชื่อม LINE ไม่สำเร็จ",
};

/** A plain page with no links into the registration (used when the attempt cannot be tied to its owner). */
function notice(status: number, title: string, text: string) {
  const escape = (value: string) => value.replace(/[&<>"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character]!);
  return new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>${escape(title)}</title><body style="font-family:sans-serif;max-width:32rem;margin:3rem auto;padding:0 1rem;line-height:1.7"><h1>${escape(title)}</h1><p>${escape(text)}</p>`, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}
