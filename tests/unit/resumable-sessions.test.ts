import { describe, expect, it } from "vitest";
import { filterResumableSessions, type ServerSessionSummary } from "../../lib/offline/resumable-sessions";
import type { OfflineSession } from "../../lib/offline/db";

function localSession(overrides: Partial<OfflineSession> & { sessionId: string }): OfflineSession {
  return {
    meta: { sessionId: overrides.sessionId, depotCode: "LOC", depotName: "Local Depot", status: "PREPARED" },
    theoreticalLines: [],
    countLines: {},
    dirty: false,
    lastLocalUpdate: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("filterResumableSessions — server SYNCED-but-not-closed stays resumable (main regression)", () => {
  it("surfaces a server session with no local cache at all, unsynced=false", () => {
    const server: ServerSessionSummary[] = [{ id: "s1", depotCode: "PAR01", depotName: "Paris" }];

    const result = filterResumableSessions(server, []);

    expect(result).toEqual([{ sessionId: "s1", depotCode: "PAR01", depotName: "Paris", unsynced: false }]);
  });

  it("surfaces a server session whose local copy is clean/SYNCED (already synced once, not yet closed)", () => {
    const server: ServerSessionSummary[] = [{ id: "s1", depotCode: "PAR01", depotName: "Paris" }];
    const local = [localSession({ sessionId: "s1", dirty: false, meta: { sessionId: "s1", depotCode: "PAR01", depotName: "Paris", status: "SYNCED" } })];

    const result = filterResumableSessions(server, local);

    expect(result).toEqual([{ sessionId: "s1", depotCode: "PAR01", depotName: "Paris", unsynced: false }]);
  });
});

describe("filterResumableSessions — dirty local data always wins (anti-loss)", () => {
  it("flags unsynced=true when the local copy of a server-known session is dirty", () => {
    const server: ServerSessionSummary[] = [{ id: "s1", depotCode: "PAR01", depotName: "Paris" }];
    const local = [
      localSession({ sessionId: "s1", dirty: true, meta: { sessionId: "s1", depotCode: "PAR01", depotName: "Paris", status: "PREPARED" } }),
    ];

    const result = filterResumableSessions(server, local);

    expect(result).toEqual([{ sessionId: "s1", depotCode: "PAR01", depotName: "Paris", unsynced: true }]);
  });

  it("surfaces a dirty local session even when the server doesn't currently list it (orphan candidate)", () => {
    const local = [localSession({ sessionId: "orphan-1", dirty: true, meta: { sessionId: "orphan-1", depotCode: "OLD", depotName: "Old Depot", status: "PREPARED" } })];

    const result = filterResumableSessions([], local);

    expect(result).toEqual([{ sessionId: "orphan-1", depotCode: "OLD", depotName: "Old Depot", unsynced: true }]);
  });
});

describe("filterResumableSessions — nothing at risk, nothing shown", () => {
  it("does not surface a clean local session the server doesn't list (closed elsewhere, or genuinely gone)", () => {
    const local = [localSession({ sessionId: "s1", dirty: false })];

    const result = filterResumableSessions([], local);

    expect(result).toEqual([]);
  });

  it("returns an empty list when both sources are empty", () => {
    expect(filterResumableSessions([], [])).toEqual([]);
  });
});

describe("filterResumableSessions — ordering", () => {
  it("puts unsynced (anti-loss) entries first, then sorts by depot code", () => {
    const server: ServerSessionSummary[] = [
      { id: "s1", depotCode: "B-DEPOT", depotName: "B" },
      { id: "s2", depotCode: "A-DEPOT", depotName: "A" },
    ];
    const local = [localSession({ sessionId: "s3", dirty: true, meta: { sessionId: "s3", depotCode: "Z-DEPOT", depotName: "Z", status: "PREPARED" } })];

    const result = filterResumableSessions(server, local);

    expect(result.map((r) => r.sessionId)).toEqual(["s3", "s2", "s1"]);
  });
});

describe("filterResumableSessions — deduplication by sessionId", () => {
  it("never lists the same session twice when it appears in both sources", () => {
    const server: ServerSessionSummary[] = [{ id: "s1", depotCode: "PAR01", depotName: "Paris" }];
    const local = [localSession({ sessionId: "s1", dirty: true })];

    const result = filterResumableSessions(server, local);

    expect(result).toHaveLength(1);
  });
});
