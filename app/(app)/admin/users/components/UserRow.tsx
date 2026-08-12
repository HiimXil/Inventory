"use client";

import { useActionState, useRef, useState } from "react";
import { updateUserAction, disableUserAction, type UserFormState } from "../actions";
import type { UserRole } from "@/lib/auth/roles";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { ErrorState } from "@/components/ui/ErrorState";
import { StatusBadge } from "@/components/ui/StatusBadge";

const initialState: UserFormState = { error: null };

const ROLES: UserRole[] = ["ADMIN", "DEPOT_MANAGER", "LOGISTICS", "DIRECTION"];

export type UserRowData = {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
  disabledAt: string | null;
};

export function UserRow({ user }: { user: UserRowData }) {
  const updateForThisUser = updateUserAction.bind(null, user.id);
  const disableForThisUser = disableUserAction.bind(null, user.id);
  const [updateState, updateFormAction, updatePending] = useActionState(updateForThisUser, initialState);
  const [disableState, disableFormAction, disablePending] = useActionState(disableForThisUser, initialState);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const disableFormRef = useRef<HTMLFormElement>(null);

  const isDisabled = Boolean(user.disabledAt);

  return (
    <tr data-user-email={user.email} data-user-role={user.role} className="border-b border-border last:border-b-0">
      <td className="px-4 py-3 font-medium text-ink">{user.email}</td>
      <td className="px-4 py-3">
        <form action={updateFormAction} className="flex flex-wrap items-center gap-2">
          <Input
            name="name"
            type="text"
            defaultValue={user.name ?? ""}
            aria-label={`Nom pour ${user.email}`}
            disabled={updatePending || isDisabled}
            className="min-w-40"
          />
          <select
            name="role"
            defaultValue={user.role}
            aria-label={`Rôle pour ${user.email}`}
            disabled={updatePending || isDisabled}
            className="min-h-touch-min rounded-control border-2 border-border bg-paper px-3 text-base text-ink disabled:cursor-not-allowed disabled:opacity-60"
          >
            {ROLES.map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </select>
          <Button type="submit" variant="secondary" size="compact" loading={updatePending} disabled={isDisabled}>
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
        <StatusBadge status={isDisabled ? "INACTIF" : "ACTIF"} />
      </td>
      <td className="px-4 py-3">
        {!isDisabled && (
          <>
            <form ref={disableFormRef} action={disableFormAction}>
              <Button
                type="button"
                variant="danger"
                size="compact"
                loading={disablePending}
                onClick={() => setConfirmOpen(true)}
              >
                {disablePending ? "Désactivation..." : "Désactiver"}
              </Button>
            </form>
            <ConfirmDialog
              open={confirmOpen}
              title="Désactiver cet utilisateur ?"
              description={`${user.email} ne pourra plus se connecter. Cette action est journalisée.`}
              danger
              confirmLabel="Confirmer la désactivation"
              cancelLabel="Annuler"
              onCancel={() => setConfirmOpen(false)}
              onConfirm={() => {
                setConfirmOpen(false);
                disableFormRef.current?.requestSubmit();
              }}
            />
          </>
        )}
        {disableState.error && (
          <div className="mt-2">
            <ErrorState message={disableState.error} />
          </div>
        )}
      </td>
    </tr>
  );
}
