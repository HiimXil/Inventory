"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { clearAuthSession } from "./clear-auth-session";

/** Server Action for the nav's "Se déconnecter" form — no pending/error state needed, just clear the session and leave. */
export async function logout(): Promise<void> {
  const headerList = await headers();
  const resultCookies = await clearAuthSession(headerList.get("cookie"));
  const cookieStore = await cookies();
  for (const cookie of resultCookies) {
    cookieStore.set(cookie.name, cookie.value, cookie.options);
  }
  redirect("/login");
}

/**
 * A JWT session cookie can decode successfully for a user that no longer
 * exists or was disabled since the cookie was issued (detected by
 * lib/auth/verify-active-user.ts) — that's a "session" in name only.
 *
 * Called from requirePageSession(), which runs during a Server Component's
 * render — cookies() can't be written from there (Next.js only allows it
 * from a Server Action or Route Handler), so this can't clear the cookie
 * itself. Instead it redirects to a Route Handler that does: GET
 * /api/auth/force-logout actually invalidates the session and forwards on
 * to /login with the explanatory message, so the dead cookie doesn't just
 * repeat the same failure on every next request.
 */
export async function redirectToLoginForInvalidSession(callbackPath?: string): Promise<never> {
  const params = new URLSearchParams();
  if (callbackPath) params.set("callbackUrl", callbackPath);
  redirect(`/api/auth/force-logout?${params.toString()}`);
}
