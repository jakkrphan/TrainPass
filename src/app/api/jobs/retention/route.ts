import { timingSafeEqual } from "node:crypto";

import { sweepOrphanFiles } from "@/server/registrations/retention";

export const dynamic = "force-dynamic";

/**
 * Daily file maintenance. Registration data is kept permanently, so this no longer anonymizes anything: it only deletes
 * stored files no row refers to (see sweepOrphanFiles). The path keeps its old name so existing cron entries keep working.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return Response.json({ status: "unavailable" }, { status: 503 });
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const expectedBytes = Buffer.from(secret);
  const suppliedBytes = Buffer.from(supplied);
  if (expectedBytes.length !== suppliedBytes.length || !timingSafeEqual(expectedBytes, suppliedBytes)) {
    return Response.json({ status: "unauthorized" }, { status: 401 });
  }
  // A failed sweep is reported (orphanFilesDeleted: null) rather than failing the request; the next run tries again.
  const orphanFilesDeleted = await sweepOrphanFiles().catch((error: unknown) => {
    console.error(`Orphan file sweep failed: ${(error as Error).name}`);
    return null;
  });
  return Response.json({ status: "ok", orphanFilesDeleted }, { headers: { "Cache-Control": "no-store" } });
}
