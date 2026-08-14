import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../lib/db/client";
import { runPrepareSession, type PrepareSessionActor } from "../../lib/sessions/prepare-session";
import { runSyncSession, type SyncSessionActor } from "../../lib/sessions/sync-session";
import { runCloseSession, type CloseSessionActor } from "../../lib/sessions/close-session";
import { SESSION_EXPIRED_MESSAGE } from "../../lib/auth/verify-active-user";

const TEST_DEPOTS = [
  { code: "CLOSE-A", name: "Close Depot A" },
  { code: "CLOSE-B", name: "Close Depot B" },
  { code: "CLOSE-C", name: "Close Depot C" },
  { code: "CLOSE-D", name: "Close Depot D" },
  { code: "CLOSE-E", name: "Close Depot E" },
  { code: "CLOSE-F", name: "Close Depot F" },
];

let depots: Record<string, { id: string; code: string }>;
let actors: Record<"ADMIN" | "DEPOT_MANAGER" | "LOGISTICS" | "DIRECTION", PrepareSessionActor>;

async function resetSessionData() {
  await prisma.auditLog.deleteMany({});
  await prisma.inventoryLine.deleteMany({});
  await prisma.inventorySession.deleteMany({});
}

async function prepareAndSyncSession(depotCode: string) {
  const prepareOutcome = await runPrepareSession(depots[depotCode].id, actors.ADMIN, actors.LOGISTICS.id);
  if (!prepareOutcome.ok) throw new Error(`prepare failed in test setup: ${prepareOutcome.error}`);
  const sessionId = prepareOutcome.sessionId;

  const syncOutcome = await runSyncSession(sessionId, actors.LOGISTICS as SyncSessionActor, {
    clientUpdatedAt: new Date().toISOString(),
    lines: [{ articleRef: "ART-001", countedQty: 3, isOffReferential: false }],
  });
  if (!syncOutcome.ok || !syncOutcome.applied) throw new Error("sync failed in test setup");

  return sessionId;
}

async function prepareOnlySession(depotCode: string) {
  const outcome = await runPrepareSession(depots[depotCode].id, actors.ADMIN, actors.LOGISTICS.id);
  if (!outcome.ok) throw new Error(`prepare failed in test setup: ${outcome.error}`);
  return outcome.sessionId;
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

describe("runCloseSession — gating (FR-031)", () => {
  it("closes a SYNCED session: status CLOSED, closedAt set, SESSION_CLOSED audit", async () => {
    const sessionId = await prepareAndSyncSession("CLOSE-A");

    const outcome = await runCloseSession(sessionId, actors.ADMIN as CloseSessionActor);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.session.status).toBe("CLOSED");
    expect(outcome.session.closedAt).not.toBeNull();

    const log = await prisma.auditLog.findFirst({ where: { sessionId, action: "SESSION_CLOSED" } });
    expect(log).not.toBeNull();
  });

  it("refuses a PREPARED session with an explicit error, no state change", async () => {
    const sessionId = await prepareOnlySession("CLOSE-B");

    const outcome = await runCloseSession(sessionId, actors.ADMIN as CloseSessionActor);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.status).toBe(400);
    expect(outcome.error.length).toBeGreaterThan(0);

    const session = await prisma.inventorySession.findUniqueOrThrow({ where: { id: sessionId } });
    expect(session.status).toBe("PREPARED");
    expect(session.closedAt).toBeNull();
  });

  it("refuses an already-CLOSED session (no double closure)", async () => {
    const sessionId = await prepareAndSyncSession("CLOSE-C");
    const first = await runCloseSession(sessionId, actors.ADMIN as CloseSessionActor);
    expect(first.ok).toBe(true);
    const firstClosedAt = first.ok ? first.session.closedAt : null;

    const second = await runCloseSession(sessionId, actors.ADMIN as CloseSessionActor);

    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.status).toBe(400);

    const session = await prisma.inventorySession.findUniqueOrThrow({ where: { id: sessionId } });
    expect(session.closedAt?.getTime()).toBe(firstClosedAt?.getTime());
  });

  it("refuses a CANCELLED session", async () => {
    const sessionId = await prepareOnlySession("CLOSE-D");
    await prisma.inventorySession.update({ where: { id: sessionId }, data: { status: "CANCELLED" } });

    const outcome = await runCloseSession(sessionId, actors.ADMIN as CloseSessionActor);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.status).toBe(400);
  });
});

describe("runCloseSession — RBAC (FR-027)", () => {
  it("denies LOGISTICS and journalizes the attempt", async () => {
    const sessionId = await prepareAndSyncSession("CLOSE-E");

    const outcome = await runCloseSession(sessionId, actors.LOGISTICS as CloseSessionActor);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.status).toBe(403);

    const denied = await prisma.auditLog.findFirst({
      where: { sessionId, actorId: actors.LOGISTICS.id, action: "SESSION_CLOSE_DENIED" },
    });
    expect(denied).not.toBeNull();

    const session = await prisma.inventorySession.findUniqueOrThrow({ where: { id: sessionId } });
    expect(session.status).toBe("SYNCED");
  });

  it("denies DIRECTION and journalizes the attempt", async () => {
    const sessionId = await prepareAndSyncSession("CLOSE-F");

    const outcome = await runCloseSession(sessionId, actors.DIRECTION as CloseSessionActor);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.status).toBe(403);

    const denied = await prisma.auditLog.findFirst({
      where: { sessionId, actorId: actors.DIRECTION.id, action: "SESSION_CLOSE_DENIED" },
    });
    expect(denied).not.toBeNull();
  });

  it("denies an unauthenticated caller (401) and journalizes the attempt", async () => {
    const sessionId = await prepareAndSyncSession("CLOSE-A");

    const outcome = await runCloseSession(sessionId, null);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.status).toBe(401);

    const denied = await prisma.auditLog.findFirst({
      where: { sessionId, actorId: null, action: "SESSION_CLOSE_DENIED" },
    });
    expect(denied).not.toBeNull();
  });

  it("allows DEPOT_MANAGER", async () => {
    const sessionId = await prepareAndSyncSession("CLOSE-B");
    const outcome = await runCloseSession(sessionId, actors.DEPOT_MANAGER as CloseSessionActor);
    expect(outcome.ok).toBe(true);
  });

  it("a ghost actor (JWT points to a userId with no matching User row) -> 401 'reconnectez-vous', no state change", async () => {
    const sessionId = await prepareAndSyncSession("CLOSE-C");
    const ghostActor: CloseSessionActor = { id: "nonexistent-user-id", role: "ADMIN" };

    const outcome = await runCloseSession(sessionId, ghostActor);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.status).toBe(401);
    expect(outcome.error).toBe(SESSION_EXPIRED_MESSAGE);

    const session = await prisma.inventorySession.findUniqueOrThrow({ where: { id: sessionId } });
    expect(session.status).toBe("SYNCED");
    expect(session.closedAt).toBeNull();
  });
});
