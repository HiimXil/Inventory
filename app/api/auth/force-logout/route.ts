import { NextResponse, type NextRequest } from "next/server";
import { clearAuthSession } from "@/lib/auth/clear-auth-session";
import { isSafeRelativeUrl } from "@/lib/http/safe-redirect";

/**
 * Invoked only via redirect from requirePageSession() when the JWT session
 * decodes fine but the underlying User row is gone or disabled (ghost user,
 * see lib/auth/verify-active-user.ts) — a Route Handler, unlike a Server
 * Component render, is allowed to write cookies, so this is where the stale
 * session cookie actually gets cleared before handing the browser on to
 * /login with the explanatory message.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const resultCookies = await clearAuthSession(request.headers.get("cookie"));

  const params = new URLSearchParams({ error: "session-expired" });
  const callbackUrl = request.nextUrl.searchParams.get("callbackUrl");
  if (callbackUrl && isSafeRelativeUrl(callbackUrl)) {
    params.set("callbackUrl", callbackUrl);
  }

  const response = NextResponse.redirect(new URL(`/login?${params.toString()}`, request.url));
  for (const cookie of resultCookies) {
    response.cookies.set(cookie.name, cookie.value, cookie.options);
  }
  return response;
}
