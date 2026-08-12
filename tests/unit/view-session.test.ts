import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../lib/db/client";
import { runPrepareSession, type PrepareSessionActor } from "../../lib/sessions/prepare-session";
import { runSyncSession, type SyncSessionActor } from "../../lib/sessions/sync-session";
import { loadSessionForView, type ViewSessionActor } from "../../lib/sessions/view-session";

const DEPOT = { code: "VIEW-A", name: "View Depot A" };

let depotId: string;
let actors: Record<"ADMIN" | "DEPOT_MANAGER" | "LOGISTICS" | "DIRECTION", PrepareSessionActor>;

async function resetSessionData() {
  await prisma.auditLog.deleteMany({});
  await prisma.inventoryLine.deleteMany({});
  await prisma.inventorySession.deleteMany({});
}

beforeAll(async () => {
  const depot = await prisma.depot.upsert({ where: { code: DEPOT.code }, update: {}, create: DEPOT });
  depotId = depot.id;

  const users = await prisma.user.findMany({
    where: {
      email: {
        in: [
          "admin@example.com",
          "depot@example.com",
          "logistics@example.com",
          "direction@example.com",
        ],
      },
    },
  });
  const byEmail = Object.fromEntries(users.map((u) => [u.email, u]));
  actors = {
    ADMIN: { id: byEmail["admin@example.com"].id, role: "ADMIN" },
    DEPOT_MANAGER: { id: byEmail["depot@example.com"].id, role: "DEPOT_MANAGER" },
    LOGISTICS: { id: byEmail["logistics@example.com"].id, role: "LOGISTICS" },
    DIRECTION: { id: byEmail["direction@example.com"].id, role: "DIRECTION" },
  };
});

afterAll(async () => {
  await resetSessionData();
  await prisma.depot.deleteMany({ where: { code: DEPOT.code } });
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetSessionData();
  process.env.ARTIS_MODE = "mock";
  process.env.ARTIS_FIXTURE = "normal";
});

afterEach(() => {
  delete process.env.ARTIS_FIXTURE;
});

async function prepareTestSession() {
  const outcome = await runPrepareSession(depotId, actors.ADMIN);
  if (!outcome.ok) throw new Error(`prepare failed in test setup: ${outcome.error}`);
  return outcome.sessionId;
}

describe("loadSessionForView — RBAC (RUNBOOK correctif for /sessions/[id])", () => {
  it("blocks an unauthenticated caller and journalizes the attempt", async () => {
    const sessionId = await prepareTestSession();

    const outcome = await loadSessionForView(sessionId, null);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe("unauthenticated");

    const denied = await prisma.auditLog.findFirst({
      where: { sessionId, actorId: null, action: "SESSION_VIEW_DENIED" },
    });
    expect(denied).not.toBeNull();
  });

  it("returns not-found for a missing session id, independent of RBAC", async () => {
    const outcome = await loadSessionForView("does-not-exist", actors.ADMIN as ViewSessionActor);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe("not-found");
  });

  it.each(["ADMIN", "DEPOT_MANAGER", "DIRECTION"] as const)(
    "allows %s to view any session (FR-027: unrestricted for these roles)",
    async (role) => {
      const sessionId = await prepareTestSession();

      const outcome = await loadSessionForView(sessionId, actors[role] as ViewSessionActor);

      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      expect(outcome.session.id).toBe(sessionId);
    },
  );
});

describe("loadSessionForView — LOGISTICS scoped to their own session (FR-027)", () => {
  it("allows LOGISTICS to view a session they synced", async () => {
    const sessionId = await prepareTestSession();
    const syncOutcome = await runSyncSession(sessionId, actors.LOGISTICS as SyncSessionActor, {
      clientUpdatedAt: new Date().toISOString(),
      lines: [{ articleRef: "ART-001", countedQty: 1, isOffReferential: false }],
    });
    expect(syncOutcome.ok && syncOutcome.applied).toBe(true);

    const outcome = await loadSessionForView(sessionId, actors.LOGISTICS as ViewSessionActor);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.session.id).toBe(sessionId);
  });

  it("denies LOGISTICS viewing a session synced by someone else, and journalizes it", async () => {
    const sessionId = await prepareTestSession();
    // A different LOGISTICS-permitted actor (ADMIN here) is the one who
    // actually synced this session — our LOGISTICS actor has no claim to it.
    const syncOutcome = await runSyncSession(sessionId, actors.ADMIN as SyncSessionActor, {
      clientUpdatedAt: new Date().toISOString(),
      lines: [{ articleRef: "ART-001", countedQty: 1, isOffReferential: false }],
    });
    expect(syncOutcome.ok && syncOutcome.applied).toBe(true);

    const outcome = await loadSessionForView(sessionId, actors.LOGISTICS as ViewSessionActor);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe("forbidden");

    const denied = await prisma.auditLog.findFirst({
      where: { sessionId, actorId: actors.LOGISTICS.id, action: "SESSION_VIEW_DENIED" },
    });
    expect(denied).not.toBeNull();
  });

  it("denies LOGISTICS viewing a session that was never synced by anyone", async () => {
    const sessionId = await prepareTestSession();

    const outcome = await loadSessionForView(sessionId, actors.LOGISTICS as ViewSessionActor);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe("forbidden");
  });
});
