"use client";

import { useActionState, useRef, useState } from "react";
import { closeSession, type CloseSessionState } from "../close/actions";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { ErrorState } from "@/components/ui/ErrorState";

const initialState: CloseSessionState = { error: null };

/**
 * Closing a session is irreversible (FR-031: no re-sync/recount past this
 * point) — the trigger button below only opens ConfirmDialog; the form
 * itself is only ever submitted from the dialog's confirm action, replacing
 * the previous window.confirm()-shaped one-click submit.
 */
export function CloseSessionButton({ sessionId, ecartCount }: { sessionId: string; ecartCount: number }) {
  const closeSessionForThisSession = closeSession.bind(null, sessionId);
  const [state, formAction, isPending] = useActionState(closeSessionForThisSession, initialState);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <>
      <form ref={formRef} action={formAction} className="flex flex-col gap-3">
        <Button type="button" variant="danger" loading={isPending} onClick={() => setConfirmOpen(true)}>
          {isPending ? "Clôture en cours..." : "Clôturer"}
        </Button>
        {state.error && <ErrorState message={state.error} />}
      </form>

      <ConfirmDialog
        open={confirmOpen}
        title="Clôturer la session ?"
        description={`${ecartCount} article${ecartCount > 1 ? "s" : ""} en écart. Clôturer définitivement ?`}
        danger
        confirmLabel="Clôturer définitivement"
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
