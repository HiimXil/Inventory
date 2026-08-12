import type { OfflineSession } from "./db";

export type ServerSessionSummary = {
  id: string;
  depotCode: string;
  depotName: string;
};

export type ResumableSession = {
  sessionId: string;
  depotCode: string;
  depotName: string;
  /** True when local counts exist that the server hasn't seen yet — the anti-data-loss case, called out distinctly from "still counting". */
  unsynced: boolean;
};

/**
 * Reprenable = "not CLOSED or CANCELLED" (FR-026 resume fix). Two sources,
 * merged by sessionId rather than trusted independently:
 *
 * - `serverSessions` is the authoritative signal for "is this session still
 *   open" — already RBAC-scoped by the caller (lib/sessions/list-sessions.ts),
 *   already excludes CLOSED/CANCELLED. A session that's SYNCED-but-not-closed
 *   belongs here even with zero local edits (this is the main regression
 *   this fix closes: a session that already synced once used to vanish from
 *   the old PREPARED-or-dirty filter even when counting wasn't finished).
 * - `localSessions` (IndexedDB) is the only place a `dirty` (unsynced) edit
 *   can ever be observed — the server has no visibility into it at all. A
 *   dirty local record is ALWAYS surfaced, even for a sessionId the server
 *   doesn't currently list (offline, an RBAC-scoping edge case, or a
 *   genuinely orphaned id after a reset) — hiding it would bury the one
 *   signal the anti-loss guarantee depends on. Clicking through is what
 *   actually resolves an orphan (ensureSessionBootstrapped/syncSession both
 *   detect and clean up a confirmed-gone session on their own).
 *
 * A clean (non-dirty) local record for a sessionId the server does NOT list
 * contributes nothing — there is no data at risk, and the server's view is
 * authoritative for "is it still open" in that case.
 */
export function filterResumableSessions(
  serverSessions: ServerSessionSummary[],
  localSessions: OfflineSession[],
): ResumableSession[] {
  const byId = new Map<string, ResumableSession>();

  for (const server of serverSessions) {
    byId.set(server.id, {
      sessionId: server.id,
      depotCode: server.depotCode,
      depotName: server.depotName,
      unsynced: false,
    });
  }

  for (const local of localSessions) {
    if (!local.dirty) continue; // a clean local copy adds nothing the server list doesn't already say
    byId.set(local.sessionId, {
      sessionId: local.sessionId,
      depotCode: local.meta.depotCode,
      depotName: local.meta.depotName,
      unsynced: true,
    });
  }

  return sortResumable([...byId.values()]);
}

/** Unsynced (anti-loss) first — that's the one the technician can't afford to miss. */
function sortResumable(items: ResumableSession[]): ResumableSession[] {
  return [...items].sort((a, b) => {
    if (a.unsynced !== b.unsynced) return a.unsynced ? -1 : 1;
    return a.depotCode.localeCompare(b.depotCode);
  });
}
