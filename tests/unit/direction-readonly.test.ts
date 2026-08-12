// @vitest-environment node
// Needed for the bootstrap-route call below — see login.test.ts's comment.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../lib/db/client";
import { GET as bootstrapGet } from "../../app/api/sessions/[id]/bootstrap/route";
import { authenticateWithCredentials } from "../../lib/auth/credentials-login";
import { runPrepareSession, type PrepareSessionActor } from "../../lib/sessions/prepare-session";
import { runSyncSession, type SyncSessionActor } from "../../lib/sessions/sync-session";
import { runCloseSession, type CloseSessionActor } from "../../lib/sessions/close-session";
import { runCancelSession, type CancelSessionActor } from "../../lib/sessions/cancel-session";
import { createUser, updateUser, disableUser, type AdminActor } from "../../lib/admin/users";

const SEED_PASSWORD = "Password123!";
const TEST_DEPOTS = [
  { code: "DIRECTION-RO-A", name: "Direction RO Depot A" },
  { code: "DIRECTION-RO-B", name: "Direction RO Depot B" },
  { code: "DIRECTION-RO-C", name: "Direction RO Depot C" },
];

let depots: Record<string, { id: string }>;
let admin: PrepareSessionActor;
let direction: PrepareSessionActor;

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
  depots = Object.fromEntries(created.map((d) => [d.code, { id: d.id }]));

  const adminUser = await prisma.user.findUniqueOrThrow({ where: { email: "admin@example.com" } });
  const directionUser = await prisma.user.findUniqueOrThrow({ where: { email: "direction@example.com" } });
  admin = { id: adminUser.id, role: "ADMIN" };
  direction = { id: directionUser.id, role: "DIRECTION" };
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

/**
 * FR-027/FR-032: DIRECTION is read-only across the whole app. Each check
 * below duplicates a single case already covered in its own permission's
 * test file (prepare-session.test.ts, bootstrap-rbac.test.ts, etc.) — kept
 * here too as one consolidated, easy-to-audit "is DIRECTION really locked
 * out of every mutation" regression point.
 */
describe("DIRECTION — read-only across every mutation", () => {
  it("cannot prepare a session", async () => {
    const outcome = await runPrepareSession(depots["DIRECTION-RO-A"].id, direction);
    expect(outcome.ok).toBe(false);

    const denied = await prisma.auditLog.findFirst({
      where: { actorId: direction.id, action: "SESSION_CREATE_DENIED" },
    });
    expect(denied).not.toBeNull();
  });

  it("cannot bootstrap/count a session", async () => {
    const prepareOutcome = await runPrepareSession(depots["DIRECTION-RO-A"].id, admin);
    expect(prepareOutcome.ok).toBe(true);
    if (!prepareOutcome.ok) return;

    const result = await authenticateWithCredentials("direction@example.com", SEED_PASSWORD);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const cookie = result.cookies.map((c) => `${c.name}=${c.value}`).join("; ");

    const request = new Request(`http://localhost/api/sessions/${prepareOutcome.sessionId}/bootstrap`, {
      headers: { cookie },
    });
    const response = await bootstrapGet(request, { params: Promise.resolve({ id: prepareOutcome.sessionId }) });

    expect(response.status).toBe(403);

    const denied = await prisma.auditLog.findFirst({
      where: { sessionId: prepareOutcome.sessionId, actorId: direction.id, action: "BOOTSTRAP_DENIED" },
    });
    expect(denied).not.toBeNull();
  });

  it("cannot sync a session", async () => {
    const prepareOutcome = await runPrepareSession(depots["DIRECTION-RO-A"].id, admin);
    expect(prepareOutcome.ok).toBe(true);
    if (!prepareOutcome.ok) return;

    const outcome = await runSyncSession(prepareOutcome.sessionId, direction as SyncSessionActor, {
      clientUpdatedAt: new Date().toISOString(),
      lines: [{ articleRef: "ART-001", countedQty: 1, isOffReferential: false }],
    });

    expect(outcome.ok).toBe(false);
    const denied = await prisma.auditLog.findFirst({
      where: { sessionId: prepareOutcome.sessionId, actorId: direction.id, action: "SYNC_DENIED" },
    });
    expect(denied).not.toBeNull();
  });

  it("cannot close a session", async () => {
    const prepareOutcome = await runPrepareSession(depots["DIRECTION-RO-B"].id, admin);
    expect(prepareOutcome.ok).toBe(true);
    if (!prepareOutcome.ok) return;
    const syncOutcome = await runSyncSession(prepareOutcome.sessionId, admin as SyncSessionActor, {
      clientUpdatedAt: new Date().toISOString(),
      lines: [{ articleRef: "ART-001", countedQty: 1, isOffReferential: false }],
    });
    expect(syncOutcome.ok && syncOutcome.applied).toBe(true);

    const outcome = await runCloseSession(prepareOutcome.sessionId, direction as CloseSessionActor);

    expect(outcome.ok).toBe(false);
    const denied = await prisma.auditLog.findFirst({
      where: { sessionId: prepareOutcome.sessionId, actorId: direction.id, action: "SESSION_CLOSE_DENIED" },
    });
    expect(denied).not.toBeNull();
  });

  it("cannot cancel a session", async () => {
    const prepareOutcome = await runPrepareSession(depots["DIRECTION-RO-C"].id, admin);
    expect(prepareOutcome.ok).toBe(true);
    if (!prepareOutcome.ok) return;

    const outcome = await runCancelSession(prepareOutcome.sessionId, direction as CancelSessionActor);

    expect(outcome.ok).toBe(false);
    const denied = await prisma.auditLog.findFirst({
      where: { sessionId: prepareOutcome.sessionId, actorId: direction.id, action: "SESSION_CANCEL_DENIED" },
    });
    expect(denied).not.toBeNull();
  });

  it("cannot manage users (create, update, disable)", async () => {
    const directionAsAdminActor = direction as AdminActor;

    const createOutcome = await createUser(directionAsAdminActor, {
      email: `direction-blocked-${Math.random().toString(36).slice(2)}@example.com`,
      role: "LOGISTICS",
      password: "Sup3rSecret!",
    });
    expect(createOutcome.ok).toBe(false);

    const updateOutcome = await updateUser(directionAsAdminActor, admin!.id, { name: "Hacked" });
    expect(updateOutcome.ok).toBe(false);

    const disableOutcome = await disableUser(directionAsAdminActor, admin!.id);
    expect(disableOutcome.ok).toBe(false);

    const deniedActions = await prisma.auditLog.findMany({
      where: {
        actorId: direction.id,
        action: { in: ["USER_CREATE_DENIED", "USER_UPDATE_DENIED", "USER_DISABLE_DENIED"] },
      },
    });
    expect(deniedActions.length).toBe(3);
  });
});
