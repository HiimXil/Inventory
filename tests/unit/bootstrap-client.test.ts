import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { offlineDB, type OfflineSession } from "../../lib/offline/db";
import { ensureSessionBootstrapped } from "../../lib/offline/bootstrap";

const BOOTSTRAP_RESPONSE = {
  session: { id: "session-1", status: "PREPARED", depot: { code: "PAR01", name: "Paris - Atelier 1" } },
  lines: [
    { articleRef: "ART-001", designation: "Imprimante UV", supplierRef: null, theoreticalQty: 12, countedQty: null, isOffReferential: false },
  ],
};

// Models a session already counted and synced once — a later reprise must
// restore countLines from these server values instead of resetting to {}
// (the reprise-fix bug). ART-001 was counted, ART-002 never was (stays
// absent from countLines), OFF-001 is an off-referential line also counted.
const BOOTSTRAP_RESPONSE_WITH_COUNTS = {
  session: { id: "session-1", status: "SYNCED", depot: { code: "PAR01", name: "Paris - Atelier 1" } },
  lines: [
    { articleRef: "ART-001", designation: "Imprimante UV", supplierRef: null, theoreticalQty: 12, countedQty: 5, isOffReferential: false },
    { articleRef: "ART-002", designation: "Cartouche encre", supplierRef: null, theoreticalQty: 8, countedQty: null, isOffReferential: false },
    { articleRef: "OFF-001", designation: null, supplierRef: null, theoreticalQty: 0, countedQty: 2, isOffReferential: true },
  ],
};

const DIRTY_SESSION: OfflineSession = {
  sessionId: "session-1",
  meta: { sessionId: "session-1", depotCode: "PAR01", depotName: "Paris - Atelier 1", status: "PREPARED" },
  theoreticalLines: [{ articleRef: "ART-001", designation: "Imprimante UV", theoreticalQty: 12 }],
  countLines: { "ART-001": { countedQty: 3, isOffReferential: false } },
  dirty: true,
  lastLocalUpdate: "2026-01-01T00:00:00.000Z",
};

const CLEAN_SESSION: OfflineSession = { ...DIRTY_SESSION, dirty: false, meta: { ...DIRTY_SESSION.meta, status: "SYNCED" } };

afterEach(async () => {
  await offlineDB.sessions.clear();
  vi.unstubAllGlobals();
});

describe("ensureSessionBootstrapped — dirty local data is never touched (anti-loss, reprise fix)", () => {
  it("returns the cached dirty record without ever calling fetch", async () => {
    await offlineDB.sessions.put(DIRTY_SESSION);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const outcome = await ensureSessionBootstrapped("session-1");

    expect(outcome).toEqual({ status: "cached", session: DIRTY_SESSION });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("ensureSessionBootstrapped — no local cache", () => {
  it("fetches and caches fresh data from the server", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => BOOTSTRAP_RESPONSE })),
    );

    const outcome = await ensureSessionBootstrapped("session-1");

    expect(outcome.status).toBe("fetched");
    const stored = await offlineDB.sessions.get("session-1");
    expect(stored?.meta.depotCode).toBe("PAR01");
    expect(stored?.theoreticalLines).toHaveLength(1);
  });

  it("reports a clear error and does not throw when offline with nothing local", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );

    const outcome = await ensureSessionBootstrapped("session-1");

    expect(outcome.status).toBe("error");
  });
});

describe("ensureSessionBootstrapped — clean (non-dirty) local cache always revalidates", () => {
  it("overwrites the clean cache with fresh server data (picks up a status change made elsewhere)", async () => {
    await offlineDB.sessions.put(CLEAN_SESSION);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ ...BOOTSTRAP_RESPONSE, session: { ...BOOTSTRAP_RESPONSE.session, status: "CLOSED" } }),
      })),
    );

    const outcome = await ensureSessionBootstrapped("session-1");

    expect(outcome.status).toBe("fetched");
    const stored = await offlineDB.sessions.get("session-1");
    expect(stored?.meta.status).toBe("CLOSED");
  });

  it("falls back to the clean cache when the server is unreachable, instead of failing", async () => {
    await offlineDB.sessions.put(CLEAN_SESSION);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );

    const outcome = await ensureSessionBootstrapped("session-1");

    expect(outcome).toEqual({ status: "cached", session: CLEAN_SESSION });
  });

  it("restores countLines from the server's counts instead of resetting to {} (reprise fix — this is the test that missed the bug)", async () => {
    await offlineDB.sessions.put(CLEAN_SESSION);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => BOOTSTRAP_RESPONSE_WITH_COUNTS })),
    );

    const outcome = await ensureSessionBootstrapped("session-1");

    expect(outcome.status).toBe("fetched");
    const stored = await offlineDB.sessions.get("session-1");
    expect(stored?.countLines).toEqual({
      "ART-001": { countedQty: 5, isOffReferential: false },
      "OFF-001": { countedQty: 2, isOffReferential: true },
    });
    // ART-002 has countedQty: null server-side (never counted) — must stay
    // absent from countLines, preserving the "jamais compté" distinction.
    expect(stored?.countLines["ART-002"]).toBeUndefined();
  });

  it("a never-counted article (server countedQty null) stays absent from countLines after reprise", async () => {
    await offlineDB.sessions.put(CLEAN_SESSION);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => BOOTSTRAP_RESPONSE_WITH_COUNTS })),
    );

    await ensureSessionBootstrapped("session-1");

    const stored = await offlineDB.sessions.get("session-1");
    expect(stored?.theoreticalLines.some((line) => line.articleRef === "ART-002")).toBe(true);
    expect("ART-002" in (stored?.countLines ?? {})).toBe(false);
  });
});

describe("ensureSessionBootstrapped — server no longer knows this session (404, e.g. database reset)", () => {
  it("deletes an existing clean local record and reports not-found with a clear message", async () => {
    await offlineDB.sessions.put(CLEAN_SESSION);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 404, json: async () => ({ error: "Session introuvable." }) })),
    );

    const outcome = await ensureSessionBootstrapped("session-1");

    expect(outcome).toEqual({ status: "not-found", message: "Cette session n'existe plus sur le serveur." });
    const stored = await offlineDB.sessions.get("session-1");
    expect(stored).toBeUndefined();
  });

  it("reports not-found even with no prior local cache (nothing to clean up, still a clear message)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 404, json: async () => ({ error: "Session introuvable." }) })),
    );

    const outcome = await ensureSessionBootstrapped("session-1");

    expect(outcome.status).toBe("not-found");
  });
});
