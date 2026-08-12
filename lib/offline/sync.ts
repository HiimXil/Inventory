import { offlineDB, type OfflineSession, type OfflineSessionStatus } from "./db";
import { APP_VERSION } from "@/lib/version";

type SyncResponseBody = {
  applied: boolean;
  session: { status: OfflineSessionStatus };
  lines: Array<{ articleRef: string; countedQty: number | null; isOffReferential: boolean }>;
  appVersion: string;
};

export type SyncOutcome =
  | { status: "nothing-to-sync" }
  | { status: "synced"; versionMismatch: boolean }
  | { status: "stale"; versionMismatch: boolean }
  | { status: "unauthorized" }
  | { status: "network-error" }
  | { status: "not-found" }
  | { status: "server-error"; message: string };

/**
 * The single client-side entry point for POST /sync (FR-030). Reads the
 * current local record straight from Dexie (never a stale closure), and on
 * success/failure writes back exactly the `dirty` state the caller
 * instructions require:
 *  - applied         -> dirty=false, local status mirrors the server's.
 *  - stale/401/error -> record untouched, `dirty` stays true so no counted
 *    data is ever lost and a later retry (manual or on next `online` event)
 *    can still replay it.
 *  - not-found       -> the server has no record of this session at all
 *    (e.g. a database reset) — replaying is never going to work, so unlike
 *    every other failure this one DOES clear the local record rather than
 *    leave it dirty forever, so it stops being offered for "reprise" and
 *    stops retrying in a loop the caller can't win.
 */
export async function syncSession(sessionId: string): Promise<SyncOutcome> {
  const local = await offlineDB.sessions.get(sessionId);
  if (!local) {
    return { status: "server-error", message: "Session locale introuvable." };
  }
  if (!local.dirty) {
    return { status: "nothing-to-sync" };
  }

  const payload = {
    clientUpdatedAt: local.lastLocalUpdate,
    lines: Object.entries(local.countLines).map(([articleRef, entry]) => ({
      articleRef,
      countedQty: entry.countedQty,
      isOffReferential: entry.isOffReferential,
    })),
  };

  let response: Response;
  try {
    response = await fetch(`/api/sessions/${sessionId}/sync`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    return { status: "network-error" };
  }

  if (response.status === 401) {
    return { status: "unauthorized" };
  }

  if (response.status === 404) {
    await offlineDB.sessions.delete(sessionId);
    return { status: "not-found" };
  }

  if (!response.ok) {
    return { status: "server-error", message: `La synchronisation a échoué (HTTP ${response.status}).` };
  }

  const data = (await response.json()) as SyncResponseBody;
  // FR-026 (version-check): compares the server's current build against
  // the version baked into THIS bundle at build time (lib/version.ts) — a
  // mismatch means a newer deploy shipped while this offline shell was
  // precached. Never acted on automatically; see useSyncTrigger/
  // ShellVersionWarning for the passive, user-initiated reload prompt.
  const versionMismatch = data.appVersion !== APP_VERSION;

  if (!data.applied) {
    // The server rejected this payload as not-newer-than what it already has
    // (FR-008 LWW). That's only a genuine conflict if the canonical state it
    // just returned actually differs from what we sent — e.g. two
    // near-simultaneous attempts from this same device racing each other
    // (both carrying the identical, unmodified local snapshot) land on the
    // server as one applied + one rejected-as-stale, even though the data
    // itself is already exactly what we wanted. Reconciling against the
    // returned canonical lines tells the two cases apart without treating a
    // harmless race as a data-loss conflict.
    const matchesCanonical = Object.entries(local.countLines).every(([articleRef, entry]) => {
      const canonicalLine = data.lines.find((line) => line.articleRef === articleRef);
      return (
        canonicalLine !== undefined &&
        canonicalLine.countedQty === entry.countedQty &&
        canonicalLine.isOffReferential === entry.isOffReferential
      );
    });
    if (!matchesCanonical) {
      return { status: "stale", versionMismatch };
    }
  }

  const next: OfflineSession = {
    ...local,
    meta: { ...local.meta, status: data.session.status },
    dirty: false,
  };
  await offlineDB.sessions.put(next);

  return { status: "synced", versionMismatch };
}
