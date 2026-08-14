"use client";

import { useActionState, useRef, useState } from "react";
import { cancelSession, type CancelSessionState } from "../actions";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { ErrorState } from "@/components/ui/ErrorState";

const initialState: CancelSessionState = { error: null };

/**
 * Presented to the admin as "Supprimer" (US9) — the client-facing concept
 * of "deleting" a session — but still wired to the same cancelSession
 * action/runCancelSession mechanism underneath (status -> CANCELLED,
 * cancelledAt set), deliberately not a new status/field: a soft delete
 * reusing what already exists, per lib/sessions/cancel-session.ts and
 * lib/sessions/list-sessions.ts's exclusion of CANCELLED from every normal
 * list. Component/action names stay "cancel*" (accurate to the data-model
 * effect); only the user-facing copy below speaks "supprimer".
 */
export function CancelSessionButton({ sessionId, depotCode }: { sessionId: string; depotCode: string }) {
  const cancelForThisSession = cancelSession.bind(null, sessionId);
  const [state, formAction, isPending] = useActionState(cancelForThisSession, initialState);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <>
      <form ref={formRef} action={formAction}>
        <Button type="button" variant="danger" size="compact" loading={isPending} onClick={() => setConfirmOpen(true)}>
          {isPending ? "Suppression..." : "Supprimer"}
        </Button>
        {state.error && (
          <div className="mt-2">
            <ErrorState message={state.error} />
          </div>
        )}
      </form>

      <ConfirmDialog
        open={confirmOpen}
        title="Supprimer l'inventaire ?"
        description={`Supprimer l'inventaire du dépôt ${depotCode} ? Il disparaîtra des listes ; l'historique est conservé pour la traçabilité.`}
        danger
        confirmLabel="Confirmer la suppression"
        cancelLabel="Annuler"
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => {
          setConfirmOpen(false);
          formRef.current?.requestSubmit();
        }}
      />
    </>
  );
}
