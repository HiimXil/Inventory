import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { offlineDB, type OfflineSession } from "../../lib/offline/db";
import { syncSession } from "../../lib/offline/sync";
import { APP_VERSION } from "../../lib/version";

const DIRTY_SESSION: OfflineSession = {
  sessionId: "session-1",
  meta: {
    sessionId: "session-1",
    depotCode: "PAR01",
    depotName: "Paris - Atelier 1",
    status: "PREPARED",
  },
  theoreticalLines: [{ articleRef: "ART-001", designation: "Imprimante UV", theoreticalQty: 12 }],
  countLines: { "ART-001": { countedQty: 3, isOffReferential: false } },
  dirty: true,
  lastLocalUpdate: "2026-01-01T00:00:00.000Z",
};

beforeEach(async () => {
  await offlineDB.sessions.put(DIRTY_SESSION);
});

afterEach(async () => {
  await offlineDB.sessions.clear();
  vi.unstubAllGlobals();
});

describe("syncSession — success", () => {
  it("clears dirty and mirrors the server status on a 200 with applied=true", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        applied: true,
        session: { status: "SYNCED" },
        lines: [{ articleRef: "ART-001", countedQty: 3, isOffReferential: false }],
        appVersion: APP_VERSION,
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const outcome = await syncSession("session-1");

    expect(outcome).toEqual({ status: "synced", versionMismatch: false });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/sessions/session-1/sync",
      expect.objectContaining({ method: "POST" }),
    );

    const stored = await offlineDB.sessions.get("session-1");
    expect(stored?.dirty).toBe(false);
    expect(stored?.meta.status).toBe("SYNCED");
    // The counted data itself is never touched by a sync response.
    expect(stored?.countLines).toEqual(DIRTY_SESSION.countLines);
  });

  it("sends the local lastLocalUpdate as clientUpdatedAt and the count map as lines", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        applied: true,
        session: { status: "SYNCED" },
        lines: [{ articleRef: "ART-001", countedQty: 3, isOffReferential: false }],
        appVersion: APP_VERSION,
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    await syncSession("session-1");

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      clientUpdatedAt: "2026-01-01T00:00:00.000Z",
      lines: [{ articleRef: "ART-001", countedQty: 3, isOffReferential: false }],
    });
  });
});

describe("syncSession — stale (applied=false) reconciliation", () => {
  it("treats a stale response as success when the canonical lines already match what was sent", async () => {
    // Simulates a near-simultaneous duplicate attempt from this same device:
    // the server rejected THIS request as not-newer, but the data it
    // returns is exactly what we intended to send (a parallel/earlier
    // attempt with the identical payload already got there).
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          applied: false,
          session: { status: "SYNCED" },
          lines: [{ articleRef: "ART-001", countedQty: 3, isOffReferential: false }],
          appVersion: APP_VERSION,
        }),
      })),
    );

    const outcome = await syncSession("session-1");

    expect(outcome).toEqual({ status: "synced", versionMismatch: false });
    const stored = await offlineDB.sessions.get("session-1");
    expect(stored?.dirty).toBe(false);
    expect(stored?.meta.status).toBe("SYNCED");
  });

  it("reports a genuine conflict when the canonical lines differ from what was sent", async () => {
    // A real conflict: the server's authoritative value for ART-001 (5) is
    // not what this device tried to push (3) — a genuine competing update,
    // not a harmless duplicate. Must NOT be silently treated as success.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          applied: false,
          session: { status: "SYNCED" },
          lines: [{ articleRef: "ART-001", countedQty: 5, isOffReferential: false }],
          appVersion: APP_VERSION,
        }),
      })),
    );

    const outcome = await syncSession("session-1");

    expect(outcome).toEqual({ status: "stale", versionMismatch: false });
    const stored = await offlineDB.sessions.get("session-1");
    expect(stored?.dirty).toBe(true);
    expect(stored?.countLines).toEqual(DIRTY_SESSION.countLines);
  });
});

describe("syncSession — 401 (session expired on network return)", () => {
  it("keeps dirty=true and leaves the local count data untouched — zero data loss", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 401, json: async () => ({ error: "Authentification requise." }) })),
    );

    const outcome = await syncSession("session-1");

    expect(outcome).toEqual({ status: "unauthorized" });

    const stored = await offlineDB.sessions.get("session-1");
    expect(stored?.dirty).toBe(true);
    expect(stored?.countLines).toEqual(DIRTY_SESSION.countLines);
    expect(stored?.meta.status).toBe("PREPARED");
  });

  it("a retry after reauthentication replays the same payload and succeeds without loss", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({ error: "Authentification requise." }) })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ applied: true, session: { status: "SYNCED" }, lines: [], appVersion: APP_VERSION }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const first = await syncSession("session-1");
    expect(first).toEqual({ status: "unauthorized" });

    const retried = await syncSession("session-1");
    expect(retried).toEqual({ status: "synced", versionMismatch: false });

    const stored = await offlineDB.sessions.get("session-1");
    expect(stored?.dirty).toBe(false);
    expect(stored?.countLines).toEqual(DIRTY_SESSION.countLines);

    const secondCallBody = JSON.parse((fetchMock.mock.calls[1] as [string, RequestInit])[1].body as string);
    const firstCallBody = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(secondCallBody).toEqual(firstCallBody);
  });
});

describe("syncSession — 404 (server has no record of this session, e.g. after a reset)", () => {
  it("deletes the local record and reports not-found instead of leaving dirty=true forever", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 404, json: async () => ({ error: "Session introuvable." }) })),
    );

    const outcome = await syncSession("session-1");

    expect(outcome).toEqual({ status: "not-found" });
    const stored = await offlineDB.sessions.get("session-1");
    expect(stored).toBeUndefined();
  });
});

describe("syncSession — network / server failure", () => {
  it("a thrown fetch (offline) keeps dirty=true for a later automatic retry", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );

    const outcome = await syncSession("session-1");

    expect(outcome).toEqual({ status: "network-error" });
    const stored = await offlineDB.sessions.get("session-1");
    expect(stored?.dirty).toBe(true);
  });

  it("a 5xx keeps dirty=true for a manual retry via SyncButton", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 500, json: async () => ({ error: "boom" }) })),
    );

    const outcome = await syncSession("session-1");

    expect(outcome.status).toBe("server-error");
    const stored = await offlineDB.sessions.get("session-1");
    expect(stored?.dirty).toBe(true);
  });
});

describe("syncSession — version-check (FR-026)", () => {
  it("flags versionMismatch when the server reports a different appVersion", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          applied: true,
          session: { status: "SYNCED" },
          lines: [{ articleRef: "ART-001", countedQty: 3, isOffReferential: false }],
          appVersion: `${APP_VERSION}-newer`,
        }),
      })),
    );

    const outcome = await syncSession("session-1");

    expect(outcome).toEqual({ status: "synced", versionMismatch: true });
    // Still applied normally: a stale shell warning is not a sync failure —
    // dirty still clears and the counted data is untouched.
    const stored = await offlineDB.sessions.get("session-1");
    expect(stored?.dirty).toBe(false);
    expect(stored?.countLines).toEqual(DIRTY_SESSION.countLines);
  });

  it("reports no mismatch when the server's appVersion matches this bundle's", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          applied: true,
          session: { status: "SYNCED" },
          lines: [{ articleRef: "ART-001", countedQty: 3, isOffReferential: false }],
          appVersion: APP_VERSION,
        }),
      })),
    );

    const outcome = await syncSession("session-1");

    expect(outcome).toEqual({ status: "synced", versionMismatch: false });
  });
});

describe("syncSession — nothing to do", () => {
  it("is a no-op when the session isn't dirty", async () => {
    await offlineDB.sessions.put({ ...DIRTY_SESSION, dirty: false });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const outcome = await syncSession("session-1");

    expect(outcome).toEqual({ status: "nothing-to-sync" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
