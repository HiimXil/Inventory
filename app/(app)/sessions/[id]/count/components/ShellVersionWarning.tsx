"use client";

import { useOnlineStatus } from "@/components/ui/useOnlineStatus";
import { Button } from "@/components/ui/Button";

/**
 * FR-026. Purely informational: never reloads on its own, in either state.
 * Counted data lives in IndexedDB regardless of when (or whether) the user
 * reloads, so there's nothing unsafe about waiting — the reload button here
 * exists only so the user can pick up the newer shell once it's convenient,
 * and only while actually online (reloading offline would just re-serve the
 * same precached — and equally stale — shell for no benefit).
 */
export function ShellVersionWarning({ visible }: { visible: boolean }) {
  const isOnline = useOnlineStatus();

  if (!visible) return null;

  return (
    <div
      role="alert"
      data-testid="shell-version-warning"
      className="flex flex-col gap-3 rounded-control border-2 border-accent bg-accent/10 px-4 py-3 text-base text-ink sm:flex-row sm:items-center sm:justify-between"
    >
      <p>
        Une nouvelle version de l&apos;application est disponible. Vos données comptées sont conservées
        {isOnline
          ? " — rechargez la page pour la mettre à jour."
          : " ; rechargez la page une fois de retour en ligne pour la mettre à jour."}
      </p>
      {isOnline && (
        <Button variant="secondary" size="compact" onClick={() => window.location.reload()}>
          Recharger la page
        </Button>
      )}
    </div>
  );
}
