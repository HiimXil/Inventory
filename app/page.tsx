import { redirect } from "next/navigation";
import { getServerAuthSessionFromCookies } from "@/lib/auth/session";
import { defaultRouteForRole } from "@/lib/auth/nav";

/**
 * "/" is never a screen of its own — it only ever forwards to /login (no
 * session) or the caller's role default (lib/auth/nav.ts), same as a
 * successful login with no callbackUrl would. Replaces the old unmodified
 * create-next-app template, which is where DIRECTION used to land post-login.
 */
export default async function RootPage() {
  const session = await getServerAuthSessionFromCookies();
  if (!session) {
    redirect("/login");
  }
  redirect(defaultRouteForRole(session.user.role));
}
