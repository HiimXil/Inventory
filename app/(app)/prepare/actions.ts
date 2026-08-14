"use server";

import { redirect } from "next/navigation";
import { getServerAuthSessionFromCookies } from "@/lib/auth/session";
import { runPrepareSession } from "@/lib/sessions/prepare-session";
import { resolveArtisMode } from "@/lib/artis/factory";

export type PrepareSessionState = {
  error: string | null;
};

export async function prepareSession(
  _prevState: PrepareSessionState,
  formData: FormData,
): Promise<PrepareSessionState> {
  const depotId = formData.get("depotId");
  if (typeof depotId !== "string" || depotId.length === 0) {
    return { error: "Veuillez sélectionner un dépôt." };
  }

  const assignedToId = formData.get("assignedToId");
  if (typeof assignedToId !== "string" || assignedToId.length === 0) {
    return { error: "Veuillez attribuer cette session à un utilisateur." };
  }

  // A file upload is only required in ARTIS_MODE=file (production default).
  // Dev/test keep running against ArtisMockAdapter with no file at all —
  // enforced here server-side, not just by whether the UI shows the input.
  const mode = resolveArtisMode();
  const fileEntry = formData.get("artisFile");
  const file = fileEntry instanceof File && fileEntry.size > 0 ? fileEntry : null;

  if (mode === "file" && !file) {
    return { error: "Veuillez sélectionner un fichier d'export ARTIS (.xlsx)." };
  }

  const authSession = await getServerAuthSessionFromCookies();
  if (!authSession) {
    return { error: "Vous devez être connecté pour préparer une session." };
  }

  // Read into memory only for the duration of this request — never written
  // to disk or persisted anywhere; nothing to clean up afterward.
  const fileBuffer = file ? await file.arrayBuffer() : undefined;

  const outcome = await runPrepareSession(
    depotId,
    {
      id: authSession.user.id,
      role: authSession.user.role,
    },
    assignedToId,
    { fileBuffer },
  );

  if (!outcome.ok) {
    return { error: outcome.error };
  }

  redirect(`/sessions/${outcome.sessionId}`);
}
