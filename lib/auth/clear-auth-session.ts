import { Auth, raw, skipCSRFCheck } from "@auth/core";
import type { ResponseInternal } from "@auth/core/types";
import { authOptions } from "./options";

/**
 * Drives Auth.js's built-in "signout" action directly, mirroring how
 * lib/auth/credentials-login.ts drives "signin" — same reasoning applies:
 * `skipCSRFCheck` is safe because this only ever runs from a same-origin
 * Server Action or Route Handler, never a browser-submitted form; `raw`
 * hands back `{ cookies }` instead of a Response to re-parse Set-Cookie
 * headers out of.
 *
 * Unlike signin, signout needs to know WHICH session to invalidate — Auth.js
 * reads that off the incoming request's own cookie header, so the current
 * request's `cookie` header has to be forwarded here or there is nothing to
 * clear: it comes back with an empty session cookie in the response instead
 * of the `Max-Age=0` that actually clears it.
 *
 * Deliberately not itself a Server Action or a `next/headers` cookie-setter:
 * both lib/auth/logout.ts (a Server Action) and
 * app/api/auth/force-logout/route.ts (a Route Handler, used when a session
 * needs invalidating from inside a Server Component's render — cookies()
 * can only be written from an Action or Route Handler, never from render)
 * need this same core call but apply the resulting cookies differently.
 */
export async function clearAuthSession(cookieHeader: string | null): Promise<NonNullable<ResponseInternal["cookies"]>> {
  const baseUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  const request = new Request(new URL("/api/auth/signout", baseUrl), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookieHeader ? { cookie: cookieHeader } : {}),
    },
    body: JSON.stringify({}),
  });

  const internalResponse = (await Auth(request, {
    ...authOptions,
    raw,
    skipCSRFCheck,
  })) as ResponseInternal;

  return internalResponse.cookies ?? [];
}
