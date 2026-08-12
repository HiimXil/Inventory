"use server";

import { redirect } from "next/navigation";
import { getServerAuthSessionFromCookies } from "@/lib/auth/session";
import { runCloseSession } from "@/lib/sessions/close-session";

export type CloseSessionState = {
  error: string | null;
};

export async function closeSession(
  sessionId: string,
  _prevState: CloseSessionState,
  _formData: FormData,
): Promise<CloseSessionState> {
  const authSession = await getServerAuthSessionFromCookies();

  const outcome = await runCloseSession(
    sessionId,
    authSession ? { id: authSession.user.id, role: authSession.user.role } : null,
  );

  if (!outcome.ok) {
    return { error: outcome.error };
  }

  redirect(`/sessions/${sessionId}`);
}
