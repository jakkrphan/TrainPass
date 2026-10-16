import { visibleEventsWhere } from "@/server/authorization/event-visibility";
import { getActiveUser } from "@/server/authorization/session";
import { db } from "@/server/db";

export const dynamic = "force-dynamic";

const LIMIT = 20;

/** Name search for the project list's co-organizer filter: people who co-organize a project the caller can see. */
export async function GET(request: Request) {
  const user = await getActiveUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });

  const query = new URL(request.url).searchParams.get("q")?.trim().slice(0, 100) ?? "";
  const people = await db.user.findMany({
    where: { organizerOf: { some: { event: visibleEventsWhere(user) } }, ...(query ? { name: { contains: query } } : {}) },
    orderBy: { name: "asc" }, take: LIMIT + 1, select: { id: true, name: true },
  });
  return Response.json({
    options: people.slice(0, LIMIT).map((person) => ({ value: person.id, label: person.name })),
    more: people.length > LIMIT,
  }, { headers: { "Cache-Control": "no-store" } });
}
