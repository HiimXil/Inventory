"use server";

import { revalidatePath } from "next/cache";
import { getServerAuthSessionFromCookies } from "@/lib/auth/session";
import { createDepot, updateDepot, deactivateDepot, activateDepot } from "@/lib/admin/depots";

export type DepotFormState = { error: string | null };

async function currentActor() {
  const authSession = await getServerAuthSessionFromCookies();
  return authSession ? { id: authSession.user.id, role: authSession.user.role } : null;
}

export async function createDepotAction(
  _prevState: DepotFormState,
  formData: FormData,
): Promise<DepotFormState> {
  const outcome = await createDepot(await currentActor(), {
    code: formData.get("code"),
    name: formData.get("name"),
  });

  if (!outcome.ok) {
    return { error: outcome.error };
  }

  revalidatePath("/admin/depots");
  revalidatePath("/prepare");
  return { error: null };
}

export async function updateDepotAction(
  depotId: string,
  _prevState: DepotFormState,
  formData: FormData,
): Promise<DepotFormState> {
  const outcome = await updateDepot(await currentActor(), depotId, {
    name: formData.get("name"),
  });

  if (!outcome.ok) {
    return { error: outcome.error };
  }

  revalidatePath("/admin/depots");
  revalidatePath("/prepare");
  return { error: null };
}

export async function deactivateDepotAction(
  depotId: string,
  _prevState: DepotFormState,
  _formData: FormData,
): Promise<DepotFormState> {
  const outcome = await deactivateDepot(await currentActor(), depotId);

  if (!outcome.ok) {
    return { error: outcome.error };
  }

  revalidatePath("/admin/depots");
  revalidatePath("/prepare");
  return { error: null };
}

export async function activateDepotAction(
  depotId: string,
  _prevState: DepotFormState,
  _formData: FormData,
): Promise<DepotFormState> {
  const outcome = await activateDepot(await currentActor(), depotId);

  if (!outcome.ok) {
    return { error: outcome.error };
  }

  revalidatePath("/admin/depots");
  revalidatePath("/prepare");
  return { error: null };
}
