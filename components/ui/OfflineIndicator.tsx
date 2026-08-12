"use client";

import { useOnlineStatus } from "./useOnlineStatus";
import { RefreshIcon, WifiOffIcon } from "./icons";

export type OfflineIndicatorProps = {
  /** Session has local changes not yet pushed to the server — shown only while online (offline already implies unsynced). */
  unsynced?: boolean;
  /** How many local counts are riding on that — shown in both the offline and the unsynced-while-online pills, since "how much is at stake" matters most exactly when connectivity is in doubt. */
  pendingCount?: number;
};

/**
 * Deliberately silent when online and synced: a status pill that's always
 * on screen stops meaning anything. It only appears when there's something
 * to tell the technician — this is the vocabulary a future pass can reuse
 * anywhere connectivity matters (count screen, session view, admin lists).
 */
export function OfflineIndicator({ unsynced = false, pendingCount = 0 }: OfflineIndicatorProps) {
  const isOnline = useOnlineStatus();

  if (isOnline && !unsynced) return null;

  if (!isOnline) {
    return (
      <span
        data-testid="offline-indicator"
        className="inline-flex items-center gap-1.5 rounded-full border-2 border-border bg-surface px-3 py-1 text-sm font-semibold text-muted"
      >
        <WifiOffIcon className="h-4 w-4 shrink-0" />
        Hors ligne{pendingCount > 0 && ` — ${pendingCount} comptage${pendingCount > 1 ? "s" : ""} en attente`}
      </span>
    );
  }

  return (
    <span
      data-testid="offline-indicator"
      className="inline-flex items-center gap-1.5 rounded-full border-2 border-accent bg-accent/10 px-3 py-1 text-sm font-semibold text-accent-text"
    >
      <RefreshIcon className="h-4 w-4 shrink-0" />
      Non synchronisé{pendingCount > 0 && ` (${pendingCount})`}
    </span>
  );
}
