import { headers } from "next/headers";
import { forbidden, redirect } from "next/navigation";

import { auth } from "@/auth";
import { safeReturnTo } from "@/server/auth/return-to";
import { db } from "@/server/db";

async function loginRedirect(reason?: string): Promise<never> {
  const next = safeReturnTo((await headers()).get("x-return-to"));
  const params = new URLSearchParams();
  if (next) params.set("next", next);
  if (reason) params.set("error", reason);
  redirect(`/login${params.size ? `?${params}` : ""}`);
}

async function findActiveUser(id: string) {
  const user = await db.user.findUnique({
    where: { id },
    select: { id: true, name: true, email: true, role: true, isActive: true },
  });
  return user?.isActive ? user : null;
}

/** The signed-in user if their account is active, else null. For route handlers that answer 401 instead of redirecting. */
export async function getActiveUser() {
  const session = await auth();
  return session?.user?.id ? findActiveUser(session.user.id) : null;
}

export async function requireActiveUser() {
  const session = await auth();
  if (!session?.user?.id) return loginRedirect();
  const user = await findActiveUser(session.user.id);
  if (!user) return loginRedirect("inactive");
  return user;
}

export async function requireAdminUser() {
  const user = await requireActiveUser();
  if (user.role !== "ADMIN") forbidden();
  return user;
}
