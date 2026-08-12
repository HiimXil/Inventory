"use client";

import { useActionState } from "react";
import { createDepotAction, type DepotFormState } from "../actions";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { ErrorState } from "@/components/ui/ErrorState";

const initialState: DepotFormState = { error: null };

export function CreateDepotForm() {
  const [state, formAction, isPending] = useActionState(createDepotAction, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-4 rounded-card border-2 border-border bg-surface p-4">
      <h2 className="text-lg font-semibold text-ink">Créer un dépôt</h2>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Code ARTIS" required>
          {(controlProps) => <Input {...controlProps} name="code" type="text" required disabled={isPending} />}
        </Field>

        <Field label="Libellé" required>
          {(controlProps) => <Input {...controlProps} name="name" type="text" required disabled={isPending} />}
        </Field>
      </div>

      <Button type="submit" loading={isPending} className="self-start">
        {isPending ? "Création en cours..." : "Créer le dépôt"}
      </Button>

      {state.error && <ErrorState message={state.error} />}
    </form>
  );
}
