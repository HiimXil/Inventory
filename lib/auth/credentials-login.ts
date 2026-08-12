import { Auth, raw, skipCSRFCheck } from "@auth/core";
import { AuthError } from "@auth/core/errors";
import type { ResponseInternal } from "@auth/core/types";
import { prisma } from "@/lib/db/client";
import { authOptions } from "./options";
import type { UserRole } from "./roles";

const GENERIC_ERROR = "Identifiants invalides.";

export type CredentialsLoginResult =
  | { ok: true; cookies: NonNullable<ResponseInternal["cookies"]>; role: UserRole; userId: string }
  | { ok: false; error: string };

/**
 * Drives the existing Auth.js credentials provider (lib/auth/options.ts,
 * untouched) directly, without a browser form POST. `skipCSRFCheck` is safe
 * here: the caller (a Server Action) already has Next's own same-origin
 * protection, and the CSRF double-submit cookie exists specifically to
 * protect a browser-submitted HTML form, which this isn't. `raw` returns the
 * structured `{ cookies }` result instead of a `Response` we'd have to
 * re-parse Set-Cookie headers out of.
 *
 * Kept separate from the "use server" action so it's callable directly from
 * Vitest (no FormData/cookies()/redirect() involved).
 */
export async function authenticateWithCredentials(
  email: string,
  password: string,
): Promise<CredentialsLoginResult> {
  const baseUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  const request = new Request(new URL("/api/auth/callback/credentials", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  let internalResponse: ResponseInternal;
  try {
    internalResponse = await Auth(request, { ...authOptions, raw, skipCSRFCheck });
  } catch (error) {
    // Deliberately generic: never reveal whether the email or the password
    // was the problem (CredentialsSignin covers both cases identically).
    if (error instanceof AuthError) {
      return { ok: false, error: GENERIC_ERROR };
    }
    throw error;
  }

  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, role: true } });
  if (!user) {
    return { ok: false, error: GENERIC_ERROR };
  }

  return { ok: true, cookies: internalResponse.cookies ?? [], role: user.role, userId: user.id };
}
