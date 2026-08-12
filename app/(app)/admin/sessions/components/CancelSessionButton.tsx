"use client";

import { useActionState, useRef, useState } from "react";
import { cancelSession, type CancelSessionState } from "../actions";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { ErrorState } from "@/components/ui/ErrorState";

const initialState: CancelSessionState = { error: null };

export function CancelSessionButton({ sessionId, depotCode }: { sessionId: string; depotCode: string }) {
  const cancelForThisSession = cancelSession.bind(null, sessionId);
  const [state, formAction, isPending] = useActionState(cancelForThisSession, initialState);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <>
      <form ref={formRef} action={formAction}>
        <Button type="button" variant="danger" size="compact" loading={isPending} onClick={() => setConfirmOpen(true)}>
          {isPending ? "Annulation..." : "Annuler"}
        </Button>
        {state.error && (
          <div className="mt-2">
            <ErrorState message={state.error} />
          </div>
        )}
      </form>

      <ConfirmDialog
        open={confirmOpen}
        title="Annuler l'inventaire ?"
        description={`Annuler l'inventaire du dépôt ${depotCode} ? Action journalisée et irréversible.`}
        danger
        confirmLabel="Confirmer l'annulation"
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
