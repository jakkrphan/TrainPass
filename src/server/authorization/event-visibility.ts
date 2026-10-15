import type { Prisma } from "@prisma/client";

type Viewer = { id: string; role: "ADMIN" | "ORGANIZER" };

/** Projects the user may open and edit: their own, FULL co-organizer, or any as admin (requireEventAccess "manage"). */
export function manageableEventsWhere(user: Viewer): Prisma.EventWhereInput {
  if (user.role === "ADMIN") return { deletedAt: null };
  return { deletedAt: null, OR: [{ ownerId: user.id }, { organizers: { some: { userId: user.id, role: "FULL" } } }] };
}

/**
 * Projects listed (read-only) to every staff member: anything published or closed, plus drafts the user can manage.
 * Other people's drafts stay private, as on the staff dashboard.
 */
export function visibleEventsWhere(user: Viewer): Prisma.EventWhereInput {
  if (user.role === "ADMIN") return { deletedAt: null };
  return { deletedAt: null, OR: [{ status: { not: "DRAFT" } }, { ownerId: user.id }, { organizers: { some: { userId: user.id, role: "FULL" } } }] };
}
