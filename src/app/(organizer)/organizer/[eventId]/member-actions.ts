"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { findDirectoryPerson, ldapConfig, searchDirectory } from "@/server/auth/ldap";
import { resolveLdapUser } from "@/server/auth/ldap-account";
import { requireEventAccess } from "@/server/authorization/event";
import { requiresAdminAudit } from "@/server/authorization/policy";
import { db } from "@/server/db";

/** A person the owner can add: `account` has an account in AttendPass; `directory` is in AD only (an account is created on add). */
export type MemberCandidate = { email: string; name: string; detail: string; source: "account" | "directory"; member: boolean };
export type MemberSearch = { people: MemberCandidate[]; directory: "on" | "off" | "unavailable" };

/**
 * Step 5 "เพิ่มผู้ร่วมจัด" search by name (or email/login): active accounts here, plus AD people from the allowed OU
 * when LDAP is configured. Only the event owner (or an admin) may search; the text is never logged.
 */
export async function searchMemberCandidates(eventId: string, query: string): Promise<MemberSearch> {
  const { event } = await requireEventAccess(eventId, "administer");
  const config = ldapConfig();
  const text = typeof query === "string" ? query.trim().slice(0, 64) : "";
  if (text.length < 2) return { people: [], directory: config ? "on" : "off" };

  const [accounts, members, directory] = await Promise.all([
    db.user.findMany({
      where: { isActive: true, id: { not: event.ownerId }, OR: [{ name: { contains: text } }, { email: { contains: text.toLowerCase() } }] },
      orderBy: { name: "asc" }, take: 8, select: { name: true, email: true },
    }),
    db.eventOrganizer.findMany({ where: { eventId }, select: { user: { select: { email: true } } } }),
    config ? searchDirectory(config, text) : Promise.resolve(null),
  ]);
  const owner = await db.user.findUnique({ where: { id: event.ownerId }, select: { email: true } });
  const memberEmails = new Set(members.map((item) => item.user.email));
  const people = new Map<string, MemberCandidate>();
  for (const user of accounts) people.set(user.email, { email: user.email, name: user.name, detail: user.email, source: "account", member: memberEmails.has(user.email) });
  for (const person of directory ?? []) {
    if (person.email === owner?.email) continue;
    const known = people.get(person.email);
    // Prefer the directory's department as the detail line; an existing account stays "account".
    people.set(person.email, known ? { ...known, detail: person.department || known.detail } : { email: person.email, name: person.name, detail: person.department || person.email, source: "directory", member: memberEmails.has(person.email) });
  }
  const accountEmails = await db.user.findMany({ where: { email: { in: [...people.keys()] } }, select: { email: true, isActive: true } });
  for (const user of accountEmails) {
    const person = people.get(user.email)!;
    // An account exists (possibly disabled by an admin): never offer to create it again.
    if (!user.isActive) people.delete(user.email);
    else person.source = "account";
  }
  return { people: [...people.values()].slice(0, 10), directory: !config ? "off" : directory ? "on" : "unavailable" };
}

export async function addEventMember(eventId: string, formData: FormData) {
  const { event, membership, user: actor } = await requireEventAccess(eventId, "administer");
  const parsed = z.object({ email: z.email().max(191), role: z.enum(["FULL", "CHECKIN_ONLY"]) }).safeParse({
    email: formData.get("email")?.toString().trim().toLowerCase(), role: formData.get("role"),
  });
  if (!parsed.success) redirect(`/organizer/${eventId}?error=invalid-member`);
  let user = await db.user.findUnique({ where: { email: parsed.data.email }, select: { id: true, isActive: true } });
  // Not here yet: look the person up in AD again (never trust the picked name/email from the browser) and give them
  // an account the way their first AD sign-in would (LDAP_AUTO_PROVISION).
  const config = !user ? ldapConfig() : null;
  if (config) {
    const person = await findDirectoryPerson(config, parsed.data.email);
    if (person === "unavailable") redirect(`/organizer/${eventId}?error=directory-unavailable`);
    if (person) user = await resolveLdapUser(person, config.autoProvision, actor.id);
  }
  if (!user?.isActive || user.id === event.ownerId) redirect(`/organizer/${eventId}?error=member-not-found`);
  const userId = user.id;
  await db.$transaction(async (tx) => {
    await tx.eventOrganizer.upsert({
      where: { eventId_userId: { eventId, userId } },
      create: { eventId, userId, role: parsed.data.role },
      update: { role: parsed.data.role },
    });
    if (requiresAdminAudit(membership)) await tx.auditLog.create({ data: { eventId, actorId: actor.id, action: "EVENT_MEMBER_UPDATED_BY_ADMIN", target: userId, metadata: { role: parsed.data.role } } });
  });
  revalidatePath(`/organizer/${eventId}`);
  redirect(`/organizer/${eventId}?saved=member`);
}

export async function removeEventMember(eventId: string, userId: string) {
  const { membership, user: actor } = await requireEventAccess(eventId, "administer");
  await db.$transaction(async (tx) => {
    const result = await tx.eventOrganizer.deleteMany({ where: { eventId, userId } });
    if (result.count && requiresAdminAudit(membership)) await tx.auditLog.create({ data: { eventId, actorId: actor.id, action: "EVENT_MEMBER_REMOVED_BY_ADMIN", target: userId } });
  });
  revalidatePath(`/organizer/${eventId}`);
  redirect(`/organizer/${eventId}?saved=member`);
}
