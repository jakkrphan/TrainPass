import { headers } from "next/headers";
import QRCode from "qrcode";
import { withBasePath } from "@/lib/base-path";

async function publicOrigin() {
  const requestHeaders = await headers();
  return process.env.APP_BASE_URL ?? `${requestHeaders.get("x-forwarded-proto") ?? "http"}://${requestHeaders.get("host")}`;
}

/** Short public registration URL for sharing (posters, QR, copy buttons), preferring APP_BASE_URL over the request
 * host. /r/<slug> redirects to /events/<slug>. */
export const shortEventUrl = async (slug: string) => `${await publicOrigin()}${withBasePath(`/r/${slug}`)}`;

/** Scalable QR for the registration link; high error correction so printed copies survive smudges and folds. */
export const registrationQrSvg = (url: string) => QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "H", color: { dark: "#000000", light: "#ffffff" } });
