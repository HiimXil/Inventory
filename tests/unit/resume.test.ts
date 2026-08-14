import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../lib/db/client";
import { runPrepareSession, type PrepareSessionActor } from "../../lib/sessions/prepare-session";
import { runSyncSession, type SyncSessionActor } from "../../lib/sessions/sync-session";
import { findActiveSyncedSessionForLogistics } from "../../lib/sessions/resume";

const TEST_DEPOTS = [
  { code: "RESUME-A", name: "Resume Depot A" },
  { code: "RESUME-B", name: "Resume Depot B" },
  { code: "RESUME-C", name: "Resume Depot C" },
];

let depots: Record<string, { id: string; code: string }>;
let actors: Record<"ADMIN" | "DEPOT_MANAGER" | "LOGISTICS" | "DIRECTION", PrepareSessionActor>;

async function resetSessionData() {
  await prisma.auditLog.deleteMany({});
  await prisma.inventoryLine.deleteMany({});
  await prisma.inventorySession.deleteMany({});
}

async function prepareTestSession(depotCode: string, assignedToId: string) {
  const outcome = await runPrepareSession(depots[depotCode].id, actors.ADMIN, assignedToId);
  if (!outcome.ok) throw new Error(`prepare failed in test setup: ${outcome.error}`);
  return outcome.sessionId;
}

async function syncTestSession(sessionId: string, actor: PrepareSessionActor) {
  const outcome = await runSyncSession(sessionId, actor as SyncSessionActor, {
    clientUpdatedAt: new Date().toISOString(),
    lines: [{ articleRef: "ART-001", countedQty: 1, isOffReferential: false }],
  });
  if (!outcome.ok || !outcome.applied) throw new Error("sync failed in test setup");
}

beforeAll(async () => {
  for (const d of TEST_DEPOTS) {
    await prisma.depot.upsert({ where: { code: d.code }, update: {}, create: d });
  }
  const created = await prisma.depot.findMany({ where: { code: { in: TEST_DEPOTS.map((d) => d.code) } } });
  depots = Object.fromEntries(created.map((d) => [d.code, { id: d.id, code: d.code }]));

  const users = await prisma.user.findMany({
    where: { email: { in: ["admin@example.com", "depot@example.com", "logistics@example.com", "direction@example.com"] } },
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

describe("findActiveSyncedSessionForLogistics — US7, resolved from assignment (not the old sync-actor signal)", () => {
  it("finds a SYNCED session assigned to this user, regardless of who physically synced it", async () => {
    const sessionId = await prepareTestSession("RESUME-A", actors.LOGISTICS.id);
    // ADMIN is the one who syncs — the old rule would have missed this
    // entirely for the LOGISTICS assignee.
    await syncTestSession(sessionId, actors.ADMIN);

    const result = await findActiveSyncedSessionForLogistics(actors.LOGISTICS.id);

    expect(result).toBe(sessionId);
  });

  it("returns null for a session assigned to someone else, even if this user synced it themselves", async () => {
    const sessionId = await prepareTestSession("RESUME-B", actors.DEPOT_MANAGER.id);
    await syncTestSession(sessionId, actors.LOGISTICS);

    const result = await findActiveSyncedSessionForLogistics(actors.LOGISTICS.id);

    expect(result).not.toBe(sessionId);
  });

  it("returns null for a PREPARED-only session assigned to this user (not yet synced)", async () => {
    await prepareTestSession("RESUME-C", actors.LOGISTICS.id);

    const result = await findActiveSyncedSessionForLogistics(actors.LOGISTICS.id);

    expect(result).toBeNull();
  });

  it("returns null when nothing is assigned to this user at all", async () => {
    const result = await findActiveSyncedSessionForLogistics(actors.LOGISTICS.id);
    expect(result).toBeNull();
  });
});
