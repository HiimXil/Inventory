"use client";

import type { SyncStatus } from "../hooks/useSyncTrigger";
import { Button } from "@/components/ui/Button";
import { ErrorState } from "@/components/ui/ErrorState";
import { LoadingState } from "@/components/ui/LoadingState";

type SyncButtonProps = {
  dirty: boolean;
  status: SyncStatus;
  onRetry: () => void;
};

/**
 * Manual retry entry point (FR-030) for whenever the automatic trigger in
 * useSyncTrigger couldn't complete on its own: offline, a server error, or a
 * 401 that needs the user to reauthenticate first.
 */
export function SyncButton({ dirty, status, onRetry }: SyncButtonProps) {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-2">
      {status.state === "syncing" && <LoadingState label="Synchronisation en cours..." />}

      {status.state === "synced" && !dirty && (
        <p data-testid="sync-confirmation" className="text-base font-medium text-success-text">
          Session synchronisée.
        </p>
      )}

      {status.state === "needs-reauth" && (
        <div role="alert" className="flex flex-col gap-3">
          <ErrorState message="Votre session a expiré. Vos données comptées sont conservées localement — reconnectez-vous puis réessayez la synchronisation." />
          <Button variant="secondary" onClick={onRetry}>
            Réessayer la synchronisation
          </Button>
        </div>
      )}

      {status.state === "error" && (
        <div role="alert" className="flex flex-col gap-3">
          <ErrorState message={status.message} />
          <Button variant="secondary" onClick={onRetry}>
            Réessayer la synchronisation
          </Button>
        </div>
      )}

      {status.state === "orphaned" && (
        <div role="alert">
          <ErrorState message={status.message} />
        </div>
      )}

      {dirty &&
        status.state !== "syncing" &&
        status.state !== "needs-reauth" &&
        status.state !== "error" &&
        status.state !== "orphaned" && (
          <Button variant="primary" onClick={onRetry}>
            Synchroniser maintenant
          </Button>
        )}
    </div>
  );
}
