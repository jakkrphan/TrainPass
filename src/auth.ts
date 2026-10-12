import { compare } from "bcryptjs";
import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";

import { resolveLdapUser } from "@/server/auth/ldap-account";
import { authenticateLdap, ldapConfig } from "@/server/auth/ldap";
import { clearAccountFailures, isLoginThrottled, loginKeys, pruneLoginAttempts, recordLoginFailure } from "@/server/auth/login-throttle";
import { db } from "@/server/db";
import { withBasePath } from "@/lib/base-path";

class LoginRateLimited extends CredentialsSignin {
  code = "rate_limited";
}

class DirectoryUnavailable extends CredentialsSignin {
  code = "ldap_unavailable";
}

/** Correct AD password, but the directory entry is disabled/outside the allowed OU or has no active account here. */
class DirectoryNotAllowed extends CredentialsSignin {
  code = "ldap_not_allowed";
}

// The form field stays "email": with LDAP on it also takes an AD username (sAMAccountName or UPN).
const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().min(1).max(254),
  password: z.string().min(1).max(200),
});
const emailSchema = z.email();

// Directory sign-ins are re-checked against AD at the next login, so sessions stay short (docs/ARCHITECTURE.md).
const SESSION_MAX_AGE_SECONDS = 12 * 60 * 60;

export const { auth, handlers, signIn, signOut } = NextAuth({
  // Next's basePath is not applied to Auth.js routes or its error redirects; see src/lib/base-path.ts.
  basePath: withBasePath("/api/auth"),
  pages: { signIn: withBasePath("/login") },
  session: { strategy: "jwt", maxAge: SESSION_MAX_AGE_SECONDS },
  providers: [
    Credentials({
      credentials: {
        email: { label: "อีเมล", type: "email" },
        password: { label: "รหัสผ่าน", type: "password" },
      },
      async authorize(credentials, request) {
        const parsed = credentialsSchema.safeParse(credentials);
        if (!parsed.success) return null;
        const ldap = ldapConfig();
        const isEmail = emailSchema.safeParse(parsed.data.email).success;
        if (!ldap && !isEmail) return null;

        const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
        const keys = loginKeys(parsed.data.email, ip);
        if (await isLoginThrottled(keys)) throw new LoginRateLimited();

        const fail = async () => {
          await recordLoginFailure(keys);
          if (Math.random() < 0.05) await pruneLoginAttempts();
          return null;
        };

        // Local password first: accounts without LDAP, and the break-glass admin used when AD is down.
        if (isEmail) {
          const user = await db.user.findUnique({
            where: { email: parsed.data.email },
            select: { id: true, name: true, email: true, passwordHash: true, isActive: true },
          });
          // Invited accounts have no password until the invitation is accepted.
          if (user?.isActive && user.passwordHash && await compare(parsed.data.password, user.passwordHash)) {
            await clearAccountFailures(keys);
            return { id: user.id, name: user.name, email: user.email };
          }
        }

        if (!ldap) return fail();
        const result = await authenticateLdap(ldap, parsed.data.email, parsed.data.password);
        if (!result.ok) {
          if (result.code === "UNAVAILABLE") throw new DirectoryUnavailable();
          if (result.code === "INVALID_CREDENTIALS") return fail();
          await clearAccountFailures(keys);
          throw new DirectoryNotAllowed();
        }

        await clearAccountFailures(keys);
        const user = await resolveLdapUser(result.identity, ldap.autoProvision);
        if (!user?.isActive) throw new DirectoryNotAllowed();
        return { id: user.id, name: user.name, email: user.email };
      },
    }),
  ],
  callbacks: {
    session({ session, token }) {
      if (token.sub && session.user) session.user.id = token.sub;
      return session;
    },
  },
});
