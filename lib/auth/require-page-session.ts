import { redirect } from "next/navigation";
import { getServerAuthSessionFromCookies, type ServerSession } from "./session";
import { buildAppNav, type NavItem } from "./nav";
import { isActiveUser } from "./verify-active-user";
import { redirectToLoginForInvalidSession } from "./logout";

/**
 * The one auth guard every protected page under app/(app) calls at the top
 * (FR-026 navigation pass §1) — except /sessions/[id]/count, which must
 * NEVER gain a server-side auth redirect: offline, that request never
 * reaches the server, so a guard here would strand the counting screen
 * with no network. See the comment at the top of count/page.tsx.
 *
 * `callbackPath` is this page's own URL (e.g. `/sessions/${id}`) — on
 * redirect to /login, it's threaded through so a successful sign-in can
 * send the user back to what they actually asked for.
 *
 * Also the reusable "ghost user" check (a JWT that still decodes fine after
 * the underlying user was deleted or disabled): every protected page goes
 * through here, so this is where that gets caught for the whole app in one
 * place, not just at the write actions that would otherwise fail on an
 * FK-constraint violation.
 */
export async function requirePageSession(
  callbackPath?: string,
): Promise<{ session: ServerSession; nav: NavItem[] }> {
  const session = await getServerAuthSessionFromCookies();
  if (!session) {
    redirect(callbackPath ? `/login?callbackUrl=${encodeURIComponent(callbackPath)}` : "/login");
  }
  if (!(await isActiveUser(session.user.id))) {
    await redirectToLoginForInvalidSession(callbackPath);
  }
  return { session, nav: buildAppNav(session.user.role) };
}
