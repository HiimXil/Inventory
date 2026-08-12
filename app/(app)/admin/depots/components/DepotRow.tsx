"use client";

import { useActionState, useRef, useState } from "react";
import {
  updateDepotAction,
  deactivateDepotAction,
  activateDepotAction,
  type DepotFormState,
} from "../actions";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { ErrorState } from "@/components/ui/ErrorState";
import { StatusBadge } from "@/components/ui/StatusBadge";

const initialState: DepotFormState = { error: null };

export type DepotRowData = {
  id: string;
  code: string;
  name: string;
  disabledAt: string | null;
};

export function DepotRow({ depot }: { depot: DepotRowData }) {
  const updateForThisDepot = updateDepotAction.bind(null, depot.id);
  const deactivateForThisDepot = deactivateDepotAction.bind(null, depot.id);
  const activateForThisDepot = activateDepotAction.bind(null, depot.id);
  const [updateState, updateFormAction, updatePending] = useActionState(updateForThisDepot, initialState);
  const [deactivateState, deactivateFormAction, deactivatePending] = useActionState(
    deactivateForThisDepot,
    initialState,
  );
  const [activateState, activateFormAction, activatePending] = useActionState(
    activateForThisDepot,
    initialState,
  );
  const [confirmOpen, setConfirmOpen] = useState(false);
  const deactivateFormRef = useRef<HTMLFormElement>(null);

  const isActive = !depot.disabledAt;

  return (
    <tr data-depot-code={depot.code} data-depot-active={isActive} className="border-b border-border last:border-b-0">
      <td className="px-4 py-3 font-medium text-ink">{depot.code}</td>
      <td className="px-4 py-3">
        <form action={updateFormAction} className="flex flex-wrap items-center gap-2">
          <Input
            name="name"
            type="text"
            defaultValue={depot.name}
            aria-label={`Libellé pour ${depot.code}`}
            disabled={updatePending}
            className="min-w-40"
          />
          <Button type="submit" variant="secondary" size="compact" loading={updatePending}>
            {updatePending ? "Mise à jour..." : "Enregistrer"}
          </Button>
        </form>
        {updateState.error && (
          <div className="mt-2">
            <ErrorState message={updateState.error} />
          </div>
        )}
      </td>
      <td className="px-4 py-3">
        <StatusBadge status={isActive ? "ACTIF" : "INACTIF"} />
      </td>
      <td className="px-4 py-3">
        {isActive ? (
          <>
            <form ref={deactivateFormRef} action={deactivateFormAction}>
              <Button
                type="button"
                variant="danger"
                size="compact"
                loading={deactivatePending}
                onClick={() => setConfirmOpen(true)}
              >
                {deactivatePending ? "Désactivation..." : "Désactiver"}
              </Button>
            </form>
            <ConfirmDialog
              open={confirmOpen}
              title="Désactiver ce dépôt ?"
              description={`${depot.code} — ${depot.name} n'apparaîtra plus dans la préparation de nouvelles sessions. Cette action est journalisée et réversible.`}
              danger
              confirmLabel="Confirmer la désactivation"
              cancelLabel="Annuler"
              onCancel={() => setConfirmOpen(false)}
              onConfirm={() => {
                setConfirmOpen(false);
                deactivateFormRef.current?.requestSubmit();
              }}
            />
          </>
        ) : (
          <form action={activateFormAction}>
            <Button type="submit" variant="secondary" size="compact" loading={activatePending}>
              {activatePending ? "Activation..." : "Activer"}
            </Button>
          </form>
        )}
        {deactivateState.error && (
          <div className="mt-2">
            <ErrorState message={deactivateState.error} />
          </div>
        )}
        {activateState.error && (
          <div className="mt-2">
            <ErrorState message={activateState.error} />
          </div>
        )}
      </td>
    </tr>
  );
}
