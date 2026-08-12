import { Auth } from "@auth/core";
import { authOptions } from "./options";
import type { UserRole } from "./roles";

export type ServerSession = {
  user: {
    id: string;
    email: string;
    name: string | null;
    role: UserRole;
  };
  expires: string;
};

/**
 * Resolves the current Auth.js session server-side by replaying the request's
 * cookies through the same `Auth()` dispatcher used by `/api/auth/*`, so the
 * result reflects the real `jwt` -> `session` callback chain (not a hand-decoded
 * token). This is the only supported way to read the session from a server
 * action or a route handler in this project — there is no client-side helper.
 */
export async function getServerAuthSession(
  cookieHeader: string | null,
): Promise<ServerSession | null> {
  const baseUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  const request = new Request(new URL("/api/auth/session", baseUrl), {
    headers: cookieHeader ? { cookie: cookieHeader } : undefined,
  });

  const response = await Auth(request, authOptions);
  const data = (await response.json()) as ServerSession | null;

  if (!data || !data.user) return null;
  return data;
}

export async function getServerAuthSessionFromRequest(
  request: Request,
): Promise<ServerSession | null> {
  return getServerAuthSession(request.headers.get("cookie"));
}

export async function getServerAuthSessionFromCookies(): Promise<ServerSession | null> {
  const { headers } = await import("next/headers");
  const headerList = await headers();
  return getServerAuthSession(headerList.get("cookie"));
}
