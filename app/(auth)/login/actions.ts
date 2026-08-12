"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { authenticateWithCredentials } from "@/lib/auth/credentials-login";
import { defaultRouteForRole } from "@/lib/auth/nav";
import { findActiveSyncedSessionForLogistics } from "@/lib/sessions/resume";
import { isSafeRelativeUrl } from "@/lib/http/safe-redirect";

export type LoginState = {
  error: string | null;
};

const GENERIC_ERROR = "Identifiants invalides.";

/**
 * Bound with `callbackUrl` from the page's own searchParams (see
 * LoginForm) before being handed to useActionState — same pattern as
 * CloseSessionButton binding a sessionId, just one arg earlier.
 */
export async function login(
  callbackUrl: string | undefined,
  _prevState: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const email = formData.get("email");
  const password = formData.get("password");

  if (
    typeof email !== "string" ||
    typeof password !== "string" ||
    email.length === 0 ||
    password.length === 0
  ) {
    return { error: GENERIC_ERROR };
  }

  const result = await authenticateWithCredentials(email, password);
  if (!result.ok) {
    return { error: result.error };
  }

  const cookieStore = await cookies();
  for (const cookie of result.cookies) {
    cookieStore.set(cookie.name, cookie.value, cookie.options);
  }

  // A page the user actually asked for (e.g. bounced here from /prepare by
  // requirePageSession) wins over any role default. Only ever a
  // same-origin relative path — never trust callbackUrl for an off-site
  // redirect.
  if (callbackUrl && isSafeRelativeUrl(callbackUrl)) {
    redirect(callbackUrl);
  }

  // LOGISTICS has no screen of their own to land on by default, but if the
  // server can see they already have a session synced and still open,
  // that's more useful than the bare list — see lib/sessions/resume.ts for
  // why this can only ever find a *synced* session, never one still
  // PREPARED-only on their device.
  if (result.role === "LOGISTICS") {
    const activeSessionId = await findActiveSyncedSessionForLogistics(result.userId);
    if (activeSessionId) {
      redirect(`/sessions/${activeSessionId}`);
    }
  }

  redirect(defaultRouteForRole(result.role));
}
