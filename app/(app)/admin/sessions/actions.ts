"use server";

import { revalidatePath } from "next/cache";
import { getServerAuthSessionFromCookies } from "@/lib/auth/session";
import { runCancelSession } from "@/lib/sessions/cancel-session";

export type CancelSessionState = { error: string | null };

export async function cancelSession(
  sessionId: string,
  _prevState: CancelSessionState,
  _formData: FormData,
): Promise<CancelSessionState> {
  const authSession = await getServerAuthSessionFromCookies();

  const outcome = await runCancelSession(
    sessionId,
    authSession ? { id: authSession.user.id, role: authSession.user.role } : null,
  );

  if (!outcome.ok) {
    return { error: outcome.error };
  }

  revalidatePath("/admin/sessions");
  return { error: null };
}
