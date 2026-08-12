"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { syncSession } from "@/lib/offline/sync";

export type SyncStatus =
  | { state: "idle" }
  | { state: "syncing" }
  | { state: "synced" }
  | { state: "needs-reauth" }
  | { state: "error"; message: string }
  | { state: "orphaned"; message: string };

/**
 * Client-side sync trigger (FR-030): fires whenever the session is dirty and
 * the browser is online — either because a local edit just made it dirty
 * while already online, or because connectivity just returned while a dirty
 * record was waiting. A 401 never touches IndexedDB (see lib/offline/sync.ts),
 * so `retry()` — wired to SyncButton — can simply be called again once the
 * user has reauthenticated, replaying the exact same payload with zero data
 * loss.
 */
export function useSyncTrigger(sessionId: string, dirty: boolean, onSynced?: () => void) {
  const [status, setStatus] = useState<SyncStatus>({ state: "idle" });
  const [versionMismatch, setVersionMismatch] = useState(false);
  const syncingRef = useRef(false);
  // Sticky terminal flag (reprise fix): once the server has confirmed this
  // session no longer exists, retrying automatically can never succeed —
  // stops the online/interval effect from hammering /sync forever with the
  // same 404. A manual retry() (SyncButton) is intentionally NOT gated by
  // this, in case the user believes it's a mistake and wants one more try.
  const orphanedRef = useRef(false);

  const runSync = useCallback(async () => {
    if (syncingRef.current) return;
    syncingRef.current = true;
    setStatus({ state: "syncing" });

    const outcome = await syncSession(sessionId);
    syncingRef.current = false;

    // Sticky once detected (FR-026): a newer deploy having shipped stays
    // true even if a later attempt somehow reported otherwise, since the
    // reload prompt is about THIS bundle being stale, not a per-request fact.
    if ((outcome.status === "synced" || outcome.status === "stale") && outcome.versionMismatch) {
      setVersionMismatch(true);
    }

    switch (outcome.status) {
      case "nothing-to-sync":
        setStatus({ state: "idle" });
        break;
      case "synced":
        setStatus({ state: "synced" });
        onSynced?.();
        break;
      case "unauthorized":
        setStatus({ state: "needs-reauth" });
        break;
      case "network-error":
        setStatus({
          state: "error",
          message: "Hors ligne : la synchronisation reprendra automatiquement au retour du réseau.",
        });
        break;
      case "stale":
        setStatus({
          state: "error",
          message: "Le serveur possède une version plus récente de cette session ; synchronisation ignorée.",
        });
        break;
      case "server-error":
        setStatus({ state: "error", message: outcome.message });
        break;
      case "not-found":
        orphanedRef.current = true;
        setStatus({
          state: "orphaned",
          message: "Cette session n'existe plus sur le serveur. Le comptage local a été supprimé.",
        });
        break;
    }
  }, [sessionId, onSynced]);

  // The button's onClick would otherwise pass the DOM event through as an
  // argument — retry() must stay a plain no-arg callback.
  const retry = useCallback(() => {
    void runSync();
  }, [runSync]);

  useEffect(() => {
    if (!dirty) return;
    let cancelled = false;

    const attempt = () => {
      if (cancelled || orphanedRef.current) return;
      if (typeof navigator !== "undefined" && !navigator.onLine) return;
      void runSync();
    };

    // Immediate attempt, deferred through a microtask (mirrors the
    // .then(setState) shape used by ensureSessionBootstrapped's effect) so
    // the state update from runSync never happens synchronously inside the
    // effect body itself. Covers "already online, a scan/correction just
    // made the session dirty".
    Promise.resolve().then(attempt);

    // Event-driven fast path for "was offline the whole time, network just
    // came back" (FR-007).
    window.addEventListener("online", attempt);

    // Small polling fallback: some browser/environment combinations don't
    // reliably fire `online` right after a programmatic connectivity
    // change. This guarantees the sync still fires shortly after
    // connectivity is actually restored, without depending solely on that
    // event. syncSession itself no-ops once the record is clean, and the
    // server's LWW/idempotent upsert make an extra concurrent attempt safe
    // even if this races another trigger.
    const interval = setInterval(attempt, 2000);

    return () => {
      cancelled = true;
      window.removeEventListener("online", attempt);
      clearInterval(interval);
    };
  }, [dirty, runSync]);

  return { status, retry, versionMismatch };
}
