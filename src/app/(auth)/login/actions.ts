"use server";

import { AuthError, CredentialsSignin } from "next-auth";

import { signIn } from "@/auth";
import { safeReturnTo } from "@/server/auth/return-to";
import { withBasePath } from "@/lib/base-path";

export type LoginState = { error?: "invalid" | "rate-limited" | "ldap-unavailable" | "ldap-not-allowed"; email?: string };

const signInErrors: Record<string, LoginState["error"]> = {
  rate_limited: "rate-limited",
  ldap_unavailable: "ldap-unavailable",
  ldap_not_allowed: "ldap-not-allowed",
};

export async function login(_previous: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").slice(0, 254);
  try {
    await signIn("credentials", {
      email,
      password: formData.get("password"),
      // Staff without organizer access are forwarded to check-in by the organizer page itself.
      redirectTo: withBasePath(safeReturnTo(formData.get("next")) ?? "/organizer/dashboard"),
    });
    return {};
  } catch (cause) {
    if (cause instanceof CredentialsSignin && signInErrors[cause.code]) return { error: signInErrors[cause.code], email };
    if (cause instanceof AuthError) return { error: "invalid", email };
    throw cause;
  }
}
