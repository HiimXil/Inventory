"use server";

import { revalidatePath } from "next/cache";
import { getServerAuthSessionFromCookies } from "@/lib/auth/session";
import { createUser, updateUser, disableUser } from "@/lib/admin/users";

export type UserFormState = { error: string | null };

async function currentActor() {
  const authSession = await getServerAuthSessionFromCookies();
  return authSession ? { id: authSession.user.id, role: authSession.user.role } : null;
}

export async function createUserAction(
  _prevState: UserFormState,
  formData: FormData,
): Promise<UserFormState> {
  const outcome = await createUser(await currentActor(), {
    email: formData.get("email"),
    name: formData.get("name") || undefined,
    role: formData.get("role"),
    password: formData.get("password"),
  });

  if (!outcome.ok) {
    return { error: outcome.error };
  }

  revalidatePath("/admin/users");
  return { error: null };
}

export async function updateUserAction(
  userId: string,
  _prevState: UserFormState,
  formData: FormData,
): Promise<UserFormState> {
  const name = formData.get("name");
  const role = formData.get("role");

  const outcome = await updateUser(await currentActor(), userId, {
    name: typeof name === "string" && name.length > 0 ? name : undefined,
    role: typeof role === "string" && role.length > 0 ? role : undefined,
  });

  if (!outcome.ok) {
    return { error: outcome.error };
  }

  revalidatePath("/admin/users");
  return { error: null };
}

export async function disableUserAction(
  userId: string,
  _prevState: UserFormState,
  _formData: FormData,
): Promise<UserFormState> {
  const outcome = await disableUser(await currentActor(), userId);

  if (!outcome.ok) {
    return { error: outcome.error };
  }

  revalidatePath("/admin/users");
  return { error: null };
}
