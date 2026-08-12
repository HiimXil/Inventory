import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { offlineDB, type OfflineSession } from "../../lib/offline/db";
import {
  applyManualQuantity,
  applyQuantityDelta,
  knownArticleRefsOf,
} from "../../lib/offline/scan-processing";

const BASE_SESSION: OfflineSession = {
  sessionId: "session-1",
  meta: {
    sessionId: "session-1",
    depotCode: "PAR01",
    depotName: "Paris - Atelier 1",
    status: "PREPARED",
  },
  theoreticalLines: [{ articleRef: "ART-001", designation: "Imprimante UV", theoreticalQty: 12 }],
  countLines: {},
  dirty: false,
  lastLocalUpdate: "2026-01-01T00:00:00.000Z",
};

// Mirrors exactly what lib/offline/useOfflineSession.ts does on every
// mutation: recompute countLines via the pure functions, then persist with
// dirty=true and a fresh lastLocalUpdate. Scanning alone never reaches this
// path anymore (see lib/offline/scan-entry.ts) — only an explicit confirm
// in the quantity-entry panel (total on first scan, delta on rescan) does.
async function persistCountLines(session: OfflineSession, countLines: OfflineSession["countLines"]) {
  const next: OfflineSession = {
    ...session,
    countLines,
    dirty: true,
    lastLocalUpdate: new Date().toISOString(),
  };
  await offlineDB.sessions.put(next);
  return next;
}

describe("offlineDB persistence", () => {
  beforeEach(async () => {
    await offlineDB.sessions.put(BASE_SESSION);
  });

  afterEach(async () => {
    await offlineDB.sessions.clear();
  });

  it("confirming a first-scan total marks the session dirty and persists it", async () => {
    const before = await offlineDB.sessions.get("session-1");
    expect(before?.dirty).toBe(false);

    const result = applyManualQuantity(before!.countLines, knownArticleRefsOf(before!.theoreticalLines), "ART-001", 8);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    await persistCountLines(before!, result.countLines);

    const after = await offlineDB.sessions.get("session-1");
    expect(after?.dirty).toBe(true);
    expect(after?.countLines["ART-001"]).toEqual({ countedQty: 8, isOffReferential: false });
    expect(after?.lastLocalUpdate).not.toBe(BASE_SESSION.lastLocalUpdate);
  });

  it("confirming a rescan delta persists the adjusted total", async () => {
    const seeded = await persistCountLines(BASE_SESSION, { "ART-001": { countedQty: 8, isOffReferential: false } });

    const result = applyQuantityDelta(seeded.countLines, knownArticleRefsOf(seeded.theoreticalLines), "ART-001", -3);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    await persistCountLines(seeded, result.countLines);

    const after = await offlineDB.sessions.get("session-1");
    expect(after?.dirty).toBe(true);
    expect(after?.countLines["ART-001"]).toEqual({ countedQty: 5, isOffReferential: false });
  });

  it("a manual correction write marks the session dirty and persists the exact quantity", async () => {
    const before = await offlineDB.sessions.get("session-1");
    const result = applyManualQuantity(
      before!.countLines,
      knownArticleRefsOf(before!.theoreticalLines),
      "ART-001",
      5,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const next: OfflineSession = {
      ...before!,
      countLines: result.countLines,
      dirty: true,
      lastLocalUpdate: new Date().toISOString(),
    };
    await offlineDB.sessions.put(next);

    const after = await offlineDB.sessions.get("session-1");
    expect(after?.dirty).toBe(true);
    expect(after?.countLines["ART-001"]).toEqual({ countedQty: 5, isOffReferential: false });
  });
});
