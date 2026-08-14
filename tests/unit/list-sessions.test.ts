import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../lib/db/client";
import { runPrepareSession, type PrepareSessionActor } from "../../lib/sessions/prepare-session";
import { runSyncSession, type SyncSessionActor } from "../../lib/sessions/sync-session";
import { runCloseSession, type CloseSessionActor } from "../../lib/sessions/close-session";
import { listSessionsForUser, type ListSessionsActor } from "../../lib/sessions/list-sessions";

const DEPOT = { code: "LIST-A", name: "List Depot A" };
const TEST_DEPOTS = [DEPOT, { code: "LIST-A-2", name: "List Depot A2" }, { code: "LIST-A-3", name: "List Depot A3" }];

let depotId: string;
let depots: Record<string, { id: string; code: string }>;
let actors: Record<"ADMIN" | "DEPOT_MANAGER" | "LOGISTICS" | "DIRECTION", PrepareSessionActor>;

async function resetSessionData() {
  await prisma.auditLog.deleteMany({});
  await prisma.inventoryLine.deleteMany({});
  await prisma.inventorySession.deleteMany({});
}

beforeAll(async () => {
  for (const d of TEST_DEPOTS) {
    await prisma.depot.upsert({ where: { code: d.code }, update: {}, create: d });
  }
  const created = await prisma.depot.findMany({ where: { code: { in: TEST_DEPOTS.map((d) => d.code) } } });
  depots = Object.fromEntries(created.map((d) => [d.code, { id: d.id, code: d.code }]));
  depotId = depots[DEPOT.code].id;

  const users = await prisma.user.findMany({
    where: {
      email: { in: ["admin@example.com", "depot@example.com", "logistics@example.com", "direction@example.com"] },
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

async function prepareTestSession(assignedToId: string = actors.LOGISTICS.id) {
  const outcome = await runPrepareSession(depotId, actors.ADMIN, assignedToId);
  if (!outcome.ok) throw new Error(`prepare failed in test setup: ${outcome.error}`);
  return outcome.sessionId;
}

async function syncTestSession(sessionId: string, actor: PrepareSessionActor, countedQty = 1) {
  const outcome = await runSyncSession(sessionId, actor as SyncSessionActor, {
    clientUpdatedAt: new Date().toISOString(),
    lines: [{ articleRef: "ART-001", countedQty, isOffReferential: false }],
  });
  if (!outcome.ok || !outcome.applied) throw new Error("sync failed in test setup");
}

describe("listSessionsForUser — RBAC (mirrors loadSessionForView, FR-027)", () => {
  it("blocks an unauthenticated caller and journalizes the attempt", async () => {
    await prepareTestSession();

    const outcome = await listSessionsForUser(null);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe("unauthenticated");

    const denied = await prisma.auditLog.findFirst({
      where: { actorId: null, action: "SESSIONS_LIST_DENIED" },
      orderBy: { createdAt: "desc" },
    });
    expect(denied).not.toBeNull();
  });

  it.each(["ADMIN", "DEPOT_MANAGER", "DIRECTION"] as const)(
    "allows %s to see every session (VIEW_RESULTS, unrestricted for these roles)",
    async (role) => {
      const sessionId = await prepareTestSession();

      const outcome = await listSessionsForUser(actors[role] as ListSessionsActor);

      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      expect(outcome.sessions.map((s) => s.id)).toContain(sessionId);
    },
  );
});

describe("listSessionsForUser — LOGISTICS scoped to sessions assigned to them (US7, replaces the old sync-based rule)", () => {
  it("includes a session assigned to this LOGISTICS actor, even before it's ever been synced", async () => {
    const sessionId = await prepareTestSession(actors.LOGISTICS.id);

    const outcome = await listSessionsForUser(actors.LOGISTICS as ListSessionsActor);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.sessions.map((s) => s.id)).toContain(sessionId);
  });

  it("excludes a session assigned to a different user — even one this LOGISTICS actor synced themselves", async () => {
    // Prepared for and assigned to DEPOT_MANAGER (a valid assignee, not this
    // LOGISTICS actor), but our LOGISTICS actor is the one who physically
    // syncs it — the old audit-log-derived rule would have called this
    // "theirs"; the point of US7 is that assignment alone decides now.
    const prepOutcome = await runPrepareSession(depots["LIST-A-2"].id, actors.ADMIN, actors.DEPOT_MANAGER.id);
    if (!prepOutcome.ok) throw new Error("prepare failed in test setup");
    await syncTestSession(prepOutcome.sessionId, actors.LOGISTICS);

    const outcome = await listSessionsForUser(actors.LOGISTICS as ListSessionsActor);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.sessions.map((s) => s.id)).not.toContain(prepOutcome.sessionId);
  });

  it("excludes a session assigned to someone else and never touched by this actor at all", async () => {
    const sessionId = await prepareTestSession(actors.ADMIN.id);

    const outcome = await listSessionsForUser(actors.LOGISTICS as ListSessionsActor);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.sessions.map((s) => s.id)).not.toContain(sessionId);
  });

  it("backward compat: a session with no assignee at all (assignedToId null) is invisible to LOGISTICS", async () => {
    const sessionId = await prepareTestSession(actors.LOGISTICS.id);
    await prisma.inventorySession.update({ where: { id: sessionId }, data: { assignedToId: null } });

    const outcome = await listSessionsForUser(actors.LOGISTICS as ListSessionsActor);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.sessions.map((s) => s.id)).not.toContain(sessionId);

    // ...but ADMIN/DEPOT_MANAGER/DIRECTION still see it unconditionally —
    // exactly the documented backward-compat behavior (visible only to
    // roles that already see everything, until explicitly assigned).
    const adminOutcome = await listSessionsForUser(actors.ADMIN as ListSessionsActor);
    expect(adminOutcome.ok).toBe(true);
    if (!adminOutcome.ok) return;
    expect(adminOutcome.sessions.map((s) => s.id)).toContain(sessionId);
  });
});

describe("listSessionsForUser — écart counts and ordering", () => {
  it("leaves ecartCount/totalLines null for a PREPARED session (nothing to compare yet)", async () => {
    const sessionId = await prepareTestSession();

    const outcome = await listSessionsForUser(actors.ADMIN as ListSessionsActor);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const item = outcome.sessions.find((s) => s.id === sessionId);
    expect(item?.ecartCount).toBeNull();
    expect(item?.totalLines).toBeNull();
  });

  it("computes ecartCount/totalLines for a SYNCED session with a gap", async () => {
    const sessionId = await prepareTestSession();
    // ART-001's theoretical qty (mock "normal" fixture) is 12 — counting 40
    // deliberately diverges to produce a non-zero écart.
    await syncTestSession(sessionId, actors.ADMIN, 40);

    const outcome = await listSessionsForUser(actors.ADMIN as ListSessionsActor);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const item = outcome.sessions.find((s) => s.id === sessionId);
    expect(item?.totalLines).toBeGreaterThan(0);
    expect(item?.ecartCount).toBeGreaterThan(0);
  });

  it("orders a SYNCED session ahead of a PREPARED one, both ahead of a CLOSED one", async () => {
    const closedSessionId = await prepareTestSession();
    await syncTestSession(closedSessionId, actors.ADMIN);
    const closeOutcome = await runCloseSession(closedSessionId, actors.ADMIN as CloseSessionActor);
    expect(closeOutcome.ok).toBe(true);

    const preparedOutcome = await runPrepareSession(depots["LIST-A-2"].id, actors.ADMIN, actors.LOGISTICS.id);
    if (!preparedOutcome.ok) throw new Error("prepare failed in test setup");
    const preparedSessionId = preparedOutcome.sessionId;

    const syncedOutcome = await runPrepareSession(depots["LIST-A-3"].id, actors.ADMIN, actors.LOGISTICS.id);
    if (!syncedOutcome.ok) throw new Error("prepare failed in test setup");
    const syncedSessionId = syncedOutcome.sessionId;
    await syncTestSession(syncedSessionId, actors.ADMIN);

    const outcome = await listSessionsForUser(actors.ADMIN as ListSessionsActor);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const ids = outcome.sessions.map((s) => s.id);
    const syncedIndex = ids.indexOf(syncedSessionId);
    const preparedIndex = ids.indexOf(preparedSessionId);
    const closedIndex = ids.indexOf(closedSessionId);

    expect(syncedIndex).toBeGreaterThanOrEqual(0);
    expect(preparedIndex).toBeGreaterThanOrEqual(0);
    expect(closedIndex).toBeGreaterThanOrEqual(0);
    expect(syncedIndex).toBeLessThan(preparedIndex);
    expect(preparedIndex).toBeLessThan(closedIndex);
  });
});
