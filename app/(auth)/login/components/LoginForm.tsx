"use client";

import { useActionState } from "react";
import { login, type LoginState } from "../actions";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { ErrorState } from "@/components/ui/ErrorState";

const initialState: LoginState = { error: null };

export function LoginForm({ callbackUrl }: { callbackUrl?: string }) {
  const loginToDestination = login.bind(null, callbackUrl);
  const [state, formAction, isPending] = useActionState(loginToDestination, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <Field label="Email">
        {(controlProps) => (
          <Input
            {...controlProps}
            name="email"
            type="email"
            autoComplete="username"
            required
            disabled={isPending}
          />
        )}
      </Field>

      <Field label="Mot de passe">
        {(controlProps) => (
          <Input
            {...controlProps}
            name="password"
            type="password"
            autoComplete="current-password"
            required
            disabled={isPending}
          />
        )}
      </Field>

      {state.error && <ErrorState message={state.error} />}

      <Button type="submit" loading={isPending} className="mt-1">
        {isPending ? "Connexion en cours..." : "Se connecter"}
      </Button>
    </form>
  );
}
