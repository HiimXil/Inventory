import { offlineDB, type OfflineSession, type OfflineSessionStatus } from "./db";
import type { CountLines } from "./scan-processing";

type BootstrapLine = {
  articleRef: string;
  designation: string | null;
  supplierRef: string | null;
  theoreticalQty: number;
  countedQty: number | null;
  isOffReferential: boolean;
};

type BootstrapResponse = {
  session: {
    id: string;
    status: OfflineSessionStatus;
    depot: { code: string; name: string };
  };
  lines: BootstrapLine[];
};

export type BootstrapOutcome =
  | { status: "cached"; session: OfflineSession }
  | { status: "fetched"; session: OfflineSession }
  | { status: "not-found"; message: string }
  | { status: "error"; message: string };

/**
 * Rebuilds countLines from the server's snapshot (reprise fix): a line with
 * a non-null countedQty was already counted (possibly synced from another
 * device or a prior session on this one) and must reappear as such, not as
 * "jamais compté" — see toOfflineSession. A null countedQty means the
 * server itself has never recorded a count for that article, so it stays
 * absent from countLines, preserving the null/counted distinction.
 */
function countLinesFromServer(lines: BootstrapLine[]): CountLines {
  const countLines: CountLines = {};
  for (const line of lines) {
    if (line.countedQty !== null) {
      countLines[line.articleRef] = { countedQty: line.countedQty, isOffReferential: line.isOffReferential };
    }
  }
  return countLines;
}

function toOfflineSession(data: BootstrapResponse): OfflineSession {
  return {
    sessionId: data.session.id,
    meta: {
      sessionId: data.session.id,
      depotCode: data.session.depot.code,
      depotName: data.session.depot.name,
      status: data.session.status,
    },
    theoreticalLines: data.lines.map((line) => ({
      articleRef: line.articleRef,
      designation: line.designation,
      supplierRef: line.supplierRef,
      theoreticalQty: line.theoreticalQty,
    })),
    countLines: countLinesFromServer(data.lines),
    dirty: false,
    lastLocalUpdate: new Date().toISOString(),
  };
}

/**
 * The client-side entry point into a session's offline snapshot (resume
 * flow, FR-026 §2/reprise fix). Two very different guarantees depending on
 * local state:
 *
 * - `dirty` local data (unsynced counts) is NEVER touched by a network call
 *   here — anti-loss is absolute, so a session with local edits always wins
 *   over whatever the server has, no exceptions.
 * - Anything else (no local cache, or a clean/non-dirty cache that could be
 *   stale — closed elsewhere, re-opened, or from a past reset) always
 *   revalidates against the server, since there is nothing local to lose.
 *   This intentionally loosens the original "bootstrap fetched exactly
 *   once" rule (plan.md Decision #4) — that rule assumed the local copy
 *   could never go stale, which the resume flow breaks by construction
 *   (the whole point is re-entering a session possibly hours/days later,
 *   possibly on re-synced or server-reset data).
 *
 * A confirmed 404 means the server has no record of this session at all
 * (e.g. a dev/test database reset) — the local entry, if any, is deleted
 * so it stops haunting the resume banner, and a distinct `not-found`
 * outcome lets the caller show a clear message instead of a raw HTTP code.
 */
export async function ensureSessionBootstrapped(
  sessionId: string,
): Promise<BootstrapOutcome> {
  const existing = await offlineDB.sessions.get(sessionId);

  if (existing?.dirty) {
    return { status: "cached", session: existing };
  }

  let response: Response;
  try {
    response = await fetch(`/api/sessions/${sessionId}/bootstrap`);
  } catch {
    if (existing) {
      // Offline (or otherwise unreachable) with a clean local copy already
      // in hand — degrade to it rather than blocking the resume.
      return { status: "cached", session: existing };
    }
    return {
      status: "error",
      message:
        "Impossible de récupérer la session : vous êtes hors ligne et aucune donnée locale n'existe pour cette session.",
    };
  }

  if (response.status === 404) {
    if (existing) {
      await offlineDB.sessions.delete(sessionId);
    }
    return { status: "not-found", message: "Cette session n'existe plus sur le serveur." };
  }

  if (!response.ok) {
    if (existing) {
      return { status: "cached", session: existing };
    }
    return {
      status: "error",
      message: `La récupération de la session a échoué (HTTP ${response.status}).`,
    };
  }

  const data = (await response.json()) as BootstrapResponse;
  const session = toOfflineSession(data);
  await offlineDB.sessions.put(session);

  return { status: "fetched", session };
}
