"use client";

import { useActionState } from "react";
import { createUserAction, type UserFormState } from "../actions";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { ErrorState } from "@/components/ui/ErrorState";

const initialState: UserFormState = { error: null };

const ROLES = ["ADMIN", "DEPOT_MANAGER", "LOGISTICS", "DIRECTION"] as const;

export function CreateUserForm() {
  const [state, formAction, isPending] = useActionState(createUserAction, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-4 rounded-card border-2 border-border bg-surface p-4">
      <h2 className="text-lg font-semibold text-ink">Créer un utilisateur</h2>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Email" required>
          {(controlProps) => <Input {...controlProps} name="email" type="email" required disabled={isPending} />}
        </Field>

        <Field label="Nom">
          {(controlProps) => <Input {...controlProps} name="name" type="text" disabled={isPending} />}
        </Field>

        <Field label="Rôle" required>
          {(controlProps) => (
            <select
              {...controlProps}
              name="role"
              required
              disabled={isPending}
              defaultValue=""
              className="min-h-touch-min w-full rounded-control border-2 border-border bg-paper px-4 text-lg text-ink disabled:cursor-not-allowed disabled:opacity-60"
            >
              <option value="" disabled>
                Sélectionner un rôle
              </option>
              {ROLES.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
          )}
        </Field>

        <Field label="Mot de passe" hint="8 caractères minimum." required>
          {(controlProps) => (
            <Input {...controlProps} name="password" type="password" required minLength={8} disabled={isPending} />
          )}
        </Field>
      </div>

      <Button type="submit" loading={isPending} className="self-start">
        {isPending ? "Création en cours..." : "Créer l'utilisateur"}
      </Button>

      {state.error && <ErrorState message={state.error} />}
    </form>
  );
}
