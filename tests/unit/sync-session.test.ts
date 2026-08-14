import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../lib/db/client";
import { runPrepareSession, type PrepareSessionActor } from "../../lib/sessions/prepare-session";
import { runSyncSession, type SyncSessionActor } from "../../lib/sessions/sync-session";
import { SESSION_EXPIRED_MESSAGE } from "../../lib/auth/verify-active-user";

const TEST_DEPOTS = [
  { code: "SYNC-A", name: "Sync Depot A" },
  { code: "SYNC-B", name: "Sync Depot B" },
  { code: "SYNC-C", name: "Sync Depot C" },
  { code: "SYNC-D", name: "Sync Depot D" },
  { code: "SYNC-E", name: "Sync Depot E" },
  { code: "SYNC-F", name: "Sync Depot F" },
];

let depots: Record<string, { id: string; code: string }>;
let actors: Record<"ADMIN" | "DEPOT_MANAGER" | "LOGISTICS" | "DIRECTION", PrepareSessionActor>;

async function resetSessionData() {
  await prisma.auditLog.deleteMany({});
  await prisma.inventoryLine.deleteMany({});
  await prisma.inventorySession.deleteMany({});
}

async function prepareTestSession(depotCode: string, actor: PrepareSessionActor) {
  // Sync itself isn't scoped by assignment (non-regression) — any
  // COUNT-permitted actor can sync any session, unrestricted — so the
  // assignee below is just a valid placeholder, not something these tests
  // depend on.
  const outcome = await runPrepareSession(depots[depotCode].id, actor, actors.LOGISTICS.id);
  if (!outcome.ok) throw new Error(`prepare failed in test setup: ${outcome.error}`);
  return outcome.sessionId;
}

beforeAll(async () => {
  for (const d of TEST_DEPOTS) {
    await prisma.depot.upsert({ where: { code: d.code }, update: {}, create: d });
  }
  const created = await prisma.depot.findMany({
    where: { code: { in: TEST_DEPOTS.map((d) => d.code) } },
  });
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

describe("runSyncSession — last-write-wins", () => {
  it("applies a payload when the session was never synced before", async () => {
    const sessionId = await prepareTestSession("SYNC-A", actors.ADMIN);

    const outcome = await runSyncSession(sessionId, actors.LOGISTICS as SyncSessionActor, {
      clientUpdatedAt: new Date().toISOString(),
      lines: [{ articleRef: "ART-001", countedQty: 5, isOffReferential: false }],
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.applied).toBe(true);
    expect(outcome.session.status).toBe("SYNCED");
    expect(outcome.session.syncedAt).not.toBeNull();

    const line = outcome.lines.find((l) => l.articleRef === "ART-001");
    expect(line?.countedQty).toBe(5);

    const auditLog = await prisma.auditLog.findFirst({
      where: { sessionId, action: "SESSION_SYNCED" },
    });
    expect(auditLog).not.toBeNull();
  });

  it("applies a newer payload after a first sync (clientUpdatedAt > syncedAt)", async () => {
    const sessionId = await prepareTestSession("SYNC-B", actors.ADMIN);

    const first = await runSyncSession(sessionId, actors.LOGISTICS as SyncSessionActor, {
      clientUpdatedAt: new Date().toISOString(),
      lines: [{ articleRef: "ART-001", countedQty: 3, isOffReferential: false }],
    });
    expect(first.ok && first.applied).toBe(true);

    // Ensure the second clientUpdatedAt is strictly after the server's
    // recorded syncedAt (a real device would only get here after counting
    // more, minutes or hours later).
    await new Promise((resolve) => setTimeout(resolve, 5));

    const second = await runSyncSession(sessionId, actors.LOGISTICS as SyncSessionActor, {
      clientUpdatedAt: new Date().toISOString(),
      lines: [{ articleRef: "ART-001", countedQty: 9, isOffReferential: false }],
    });

    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.applied).toBe(true);
    const line = second.lines.find((l) => l.articleRef === "ART-001");
    expect(line?.countedQty).toBe(9);
  });

  it("rejects an older payload without overwriting, and returns the canonical state", async () => {
    const sessionId = await prepareTestSession("SYNC-C", actors.ADMIN);
    const staleClientUpdatedAt = new Date(Date.now() - 60_000).toISOString();

    const first = await runSyncSession(sessionId, actors.LOGISTICS as SyncSessionActor, {
      clientUpdatedAt: new Date().toISOString(),
      lines: [{ articleRef: "ART-001", countedQty: 7, isOffReferential: false }],
    });
    expect(first.ok && first.applied).toBe(true);

    const stale = await runSyncSession(sessionId, actors.LOGISTICS as SyncSessionActor, {
      clientUpdatedAt: staleClientUpdatedAt,
      lines: [{ articleRef: "ART-001", countedQty: 999, isOffReferential: false }],
    });

    expect(stale.ok).toBe(true);
    if (!stale.ok) return;
    expect(stale.applied).toBe(false);
    // Canonical state: the earlier, correctly-applied value, not the rejected one.
    const line = stale.lines.find((l) => l.articleRef === "ART-001");
    expect(line?.countedQty).toBe(7);
    expect(stale.session.status).toBe("SYNCED");
  });
});

describe("runSyncSession — idempotency", () => {
  it("replaying the exact same payload twice produces identical state, no double-count", async () => {
    const sessionId = await prepareTestSession("SYNC-D", actors.ADMIN);
    const payload = {
      clientUpdatedAt: new Date().toISOString(),
      lines: [
        { articleRef: "ART-001", countedQty: 4, isOffReferential: false },
        { articleRef: "OFF-REF-1", countedQty: 2, isOffReferential: true },
      ],
    };

    const first = await runSyncSession(sessionId, actors.LOGISTICS as SyncSessionActor, payload);
    const second = await runSyncSession(sessionId, actors.LOGISTICS as SyncSessionActor, payload);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    const knownLine1 = first.lines.find((l) => l.articleRef === "ART-001");
    const knownLine2 = second.lines.find((l) => l.articleRef === "ART-001");
    expect(knownLine1?.countedQty).toBe(4);
    expect(knownLine2?.countedQty).toBe(4);

    const offLine1 = first.lines.find((l) => l.articleRef === "OFF-REF-1");
    const offLine2 = second.lines.find((l) => l.articleRef === "OFF-REF-1");
    expect(offLine1?.countedQty).toBe(2);
    expect(offLine2?.countedQty).toBe(2);
    expect(offLine2?.isOffReferential).toBe(true);
    expect(offLine2?.theoreticalQty).toBe(0);

    const lineCount = await prisma.inventoryLine.count({ where: { sessionId, articleRef: "OFF-REF-1" } });
    expect(lineCount).toBe(1);
  });
});

describe("runSyncSession — RBAC (FR-028)", () => {
  it("denies DIRECTION and journalizes the attempt", async () => {
    const sessionId = await prepareTestSession("SYNC-E", actors.ADMIN);

    const outcome = await runSyncSession(sessionId, actors.DIRECTION as SyncSessionActor, {
      clientUpdatedAt: new Date().toISOString(),
      lines: [{ articleRef: "ART-001", countedQty: 1, isOffReferential: false }],
    });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.status).toBe(403);

    const denied = await prisma.auditLog.findFirst({
      where: { sessionId, actorId: actors.DIRECTION.id, action: "SYNC_DENIED" },
    });
    expect(denied).not.toBeNull();

    const line = await prisma.inventoryLine.findFirst({ where: { sessionId, articleRef: "ART-001" } });
    expect(line?.countedQty).toBeNull();
  });

  it("denies an unauthenticated caller (401) and journalizes the attempt", async () => {
    const sessionId = await prepareTestSession("SYNC-F", actors.ADMIN);

    const outcome = await runSyncSession(sessionId, null, {
      clientUpdatedAt: new Date().toISOString(),
      lines: [{ articleRef: "ART-001", countedQty: 1, isOffReferential: false }],
    });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.status).toBe(401);

    const denied = await prisma.auditLog.findFirst({
      where: { sessionId, actorId: null, action: "SYNC_DENIED" },
    });
    expect(denied).not.toBeNull();
  });

  it("a ghost actor (JWT points to a userId with no matching User row) -> 401 'reconnectez-vous', no line/audit mutation", async () => {
    const sessionId = await prepareTestSession("SYNC-D", actors.ADMIN);
    const ghostActor: SyncSessionActor = { id: "nonexistent-user-id", role: "LOGISTICS" };

    const outcome = await runSyncSession(sessionId, ghostActor, {
      clientUpdatedAt: new Date().toISOString(),
      lines: [{ articleRef: "ART-001", countedQty: 1, isOffReferential: false }],
    });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.status).toBe(401);
    expect(outcome.error).toBe(SESSION_EXPIRED_MESSAGE);

    const line = await prisma.inventoryLine.findFirst({ where: { sessionId, articleRef: "ART-001" } });
    expect(line?.countedQty).toBeNull();
    const synced = await prisma.auditLog.findFirst({ where: { sessionId, action: "SESSION_SYNCED" } });
    expect(synced).toBeNull();
  });

  it.each(["ADMIN", "DEPOT_MANAGER", "LOGISTICS"] as const)("allows %s", async (role) => {
    const sessionId = await prepareTestSession(`SYNC-${role === "ADMIN" ? "A" : role === "DEPOT_MANAGER" ? "B" : "C"}`, actors.ADMIN);

    const outcome = await runSyncSession(sessionId, actors[role] as SyncSessionActor, {
      clientUpdatedAt: new Date().toISOString(),
      lines: [{ articleRef: "ART-001", countedQty: 2, isOffReferential: false }],
    });

    expect(outcome.ok).toBe(true);
  });
});
