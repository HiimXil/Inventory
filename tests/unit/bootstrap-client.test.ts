import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { offlineDB, type OfflineSession } from "../../lib/offline/db";
import { ensureSessionBootstrapped } from "../../lib/offline/bootstrap";

const BOOTSTRAP_RESPONSE = {
  session: { id: "session-1", status: "PREPARED", depot: { code: "PAR01", name: "Paris - Atelier 1" } },
  lines: [{ articleRef: "ART-001", designation: "Imprimante UV", theoreticalQty: 12 }],
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
