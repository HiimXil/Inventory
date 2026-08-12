import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../lib/db/client";
import { runPrepareSession, type PrepareSessionActor } from "../../lib/sessions/prepare-session";
import { runSyncSession, type SyncSessionActor } from "../../lib/sessions/sync-session";
import { runCloseSession, type CloseSessionActor } from "../../lib/sessions/close-session";
import { runCancelSession, type CancelSessionActor } from "../../lib/sessions/cancel-session";

const TEST_DEPOTS = [
  { code: "CANCEL-A", name: "Cancel Depot A" },
  { code: "CANCEL-B", name: "Cancel Depot B" },
  { code: "CANCEL-C", name: "Cancel Depot C" },
  { code: "CANCEL-D", name: "Cancel Depot D" },
  { code: "CANCEL-E", name: "Cancel Depot E" },
  { code: "CANCEL-F", name: "Cancel Depot F" },
  { code: "CANCEL-G", name: "Cancel Depot G" },
];

let depots: Record<string, { id: string; code: string }>;
let actors: Record<"ADMIN" | "DEPOT_MANAGER" | "LOGISTICS" | "DIRECTION", PrepareSessionActor>;

async function resetSessionData() {
  await prisma.auditLog.deleteMany({});
  await prisma.inventoryLine.deleteMany({});
  await prisma.inventorySession.deleteMany({});
}

async function prepareOnlySession(depotCode: string) {
  const outcome = await runPrepareSession(depots[depotCode].id, actors.ADMIN);
  if (!outcome.ok) throw new Error(`prepare failed in test setup: ${outcome.error}`);
  return outcome.sessionId;
}

async function prepareAndSyncSession(depotCode: string) {
  const sessionId = await prepareOnlySession(depotCode);
  const syncOutcome = await runSyncSession(sessionId, actors.LOGISTICS as SyncSessionActor, {
    clientUpdatedAt: new Date().toISOString(),
    lines: [{ articleRef: "ART-001", countedQty: 1, isOffReferential: false }],
  });
  if (!syncOutcome.ok || !syncOutcome.applied) throw new Error("sync failed in test setup");
  return sessionId;
}

beforeAll(async () => {
  for (const d of TEST_DEPOTS) {
    await prisma.depot.upsert({ where: { code: d.code }, update: {}, create: d });
  }
  const created = await prisma.depot.findMany({ where: { code: { in: TEST_DEPOTS.map((d) => d.code) } } });
  depots = Object.fromEntries(created.map((d) => [d.code, { id: d.id, code: d.code }]));

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
  await prisma.depot.deleteMany({ where: { code: { in: TEST_DEPOTS.map((d) => d.code) } } });
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

describe("runCancelSession — gating (FR-017)", () => {
  it("cancels a PREPARED session: status CANCELLED, SESSION_CANCELLED audit", async () => {
    const sessionId = await prepareOnlySession("CANCEL-A");

    const outcome = await runCancelSession(sessionId, actors.ADMIN as CancelSessionActor);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.session.status).toBe("CANCELLED");
    expect(outcome.session.cancelledAt).not.toBeNull();

    const log = await prisma.auditLog.findFirst({ where: { sessionId, action: "SESSION_CANCELLED" } });
    expect(log).not.toBeNull();
  });

  it("cancels a SYNCED (not yet closed) session", async () => {
    const sessionId = await prepareAndSyncSession("CANCEL-B");

    const outcome = await runCancelSession(sessionId, actors.ADMIN as CancelSessionActor);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.session.status).toBe("CANCELLED");
  });

  it("refuses a CLOSED session, no state change", async () => {
    const sessionId = await prepareAndSyncSession("CANCEL-C");
    const closeOutcome = await runCloseSession(sessionId, actors.ADMIN as CloseSessionActor);
    expect(closeOutcome.ok).toBe(true);

    const outcome = await runCancelSession(sessionId, actors.ADMIN as CancelSessionActor);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.status).toBe(400);

    const session = await prisma.inventorySession.findUniqueOrThrow({ where: { id: sessionId } });
    expect(session.status).toBe("CLOSED");
  });

  it("refuses an already-CANCELLED session (no double cancellation)", async () => {
    const sessionId = await prepareOnlySession("CANCEL-D");
    const first = await runCancelSession(sessionId, actors.ADMIN as CancelSessionActor);
    expect(first.ok).toBe(true);

    const second = await runCancelSession(sessionId, actors.ADMIN as CancelSessionActor);

    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.status).toBe(400);
  });
});

describe("runCancelSession — RBAC (FR-027): only ADMIN", () => {
  it("allows ADMIN", async () => {
    const sessionId = await prepareOnlySession("CANCEL-E");
    const outcome = await runCancelSession(sessionId, actors.ADMIN as CancelSessionActor);
    expect(outcome.ok).toBe(true);
  });

  it.each(["DEPOT_MANAGER", "LOGISTICS", "DIRECTION"] as const)(
    "denies %s and journalizes the attempt",
    async (role) => {
      const sessionId = await prepareOnlySession("CANCEL-F");

      const outcome = await runCancelSession(sessionId, actors[role] as CancelSessionActor);

      expect(outcome.ok).toBe(false);
      if (outcome.ok) return;
      expect(outcome.status).toBe(403);

      const denied = await prisma.auditLog.findFirst({
        where: { sessionId, actorId: actors[role].id, action: "SESSION_CANCEL_DENIED" },
      });
      expect(denied).not.toBeNull();

      const session = await prisma.inventorySession.findUniqueOrThrow({ where: { id: sessionId } });
      expect(session.status).toBe("PREPARED");
    },
  );

  it("denies an unauthenticated caller (401) and journalizes the attempt", async () => {
    const sessionId = await prepareOnlySession("CANCEL-G");

    const outcome = await runCancelSession(sessionId, null);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.status).toBe(401);

    const denied = await prisma.auditLog.findFirst({
      where: { sessionId, actorId: null, action: "SESSION_CANCEL_DENIED" },
    });
    expect(denied).not.toBeNull();
  });
});
