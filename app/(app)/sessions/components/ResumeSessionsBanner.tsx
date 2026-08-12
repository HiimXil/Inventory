"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { offlineDB } from "@/lib/offline/db";
import {
  filterResumableSessions,
  type ResumableSession,
  type ServerSessionSummary,
} from "@/lib/offline/resumable-sessions";
import { AlertTriangleIcon, ClockIcon } from "@/components/ui/icons";

/**
 * The anti-data-loss safety net (FR-026 navigation pass §2, reprise fix): a
 * technician who closed the app mid-count, or whose session already synced
 * once but isn't finished, has no obvious way back in. `serverSessions` is
 * the RBAC-scoped, authoritative "still open" list computed server-side by
 * the page (lib/sessions/list-sessions.ts) — passed in as a plain prop
 * rather than fetched here, since a Server Component can hand a Client
 * Component plain data but never a function (see Field's render-prop
 * lesson). IndexedDB is read directly for the local/dirty half of the
 * picture, which no server list can ever see. Renders nothing once there's
 * nothing left to resume, rather than an empty section.
 */
export function ResumeSessionsBanner({ serverSessions }: { serverSessions: ServerSessionSummary[] }) {
  const [sessions, setSessions] = useState<ResumableSession[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    offlineDB.sessions.toArray().then((records) => {
      if (cancelled) return;
      setSessions(filterResumableSessions(serverSessions, records));
    });
    return () => {
      cancelled = true;
    };
  }, [serverSessions]);

  if (!sessions || sessions.length === 0) return null;

  return (
    <section data-testid="resume-sessions" className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold text-ink">Reprendre un comptage</h2>
      <div className="flex flex-col gap-2">
        {sessions.map((session) => (
          <Link
            key={session.sessionId}
            href={`/sessions/${session.sessionId}/count`}
            className={`flex min-h-touch-comfortable flex-wrap items-center justify-between gap-3 rounded-card border-2 px-4 py-3 transition-colors ${
              session.unsynced
                ? "border-danger bg-danger/10 hover:bg-danger/15"
                : "border-accent bg-accent/10 hover:bg-accent/15"
            }`}
          >
            <span className="flex items-center gap-2 text-lg font-semibold text-ink">
              {session.unsynced ? (
                <AlertTriangleIcon className="h-5 w-5 shrink-0 text-danger-text" />
              ) : (
                <ClockIcon className="h-5 w-5 shrink-0 text-accent-text" />
              )}
              {session.depotCode} — {session.depotName}
            </span>
            <span className={`text-sm font-semibold ${session.unsynced ? "text-danger-text" : "text-accent-text"}`}>
              {session.unsynced ? "Comptage non synchronisé — reprendre" : "Comptage en cours — reprendre"}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
