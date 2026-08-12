import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { prisma } from "../../lib/db/client";
import { runPrepareSession, type PrepareSessionActor } from "../../lib/sessions/prepare-session";
import { runSyncSession, type SyncSessionActor } from "../../lib/sessions/sync-session";
import { runExportSession, type ExportSessionActor } from "../../lib/sessions/export-session";

const TEST_DEPOTS = [
  { code: "EXPORT-A", name: "Export Depot A" },
  { code: "EXPORT-B", name: "Export Depot B" },
  { code: "EXPORT-C", name: "Export Depot C" },
  { code: "EXPORT-D", name: "Export Depot D" },
  { code: "EXPORT-E", name: "Export Depot E" },
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
    lines: [
      { articleRef: "ART-001", countedQty: 5, isOffReferential: false },
      { articleRef: "OFF-REF-1", countedQty: 2, isOffReferential: true },
    ],
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

describe("runExportSession — status gating (FR-009)", () => {
  it("refuses a PREPARED session", async () => {
    const sessionId = await prepareOnlySession("EXPORT-A");

    const outcome = await runExportSession(sessionId, actors.ADMIN as ExportSessionActor);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.status).toBe(400);
  });

  it("succeeds for a SYNCED session", async () => {
    const sessionId = await prepareAndSyncSession("EXPORT-B");

    const outcome = await runExportSession(sessionId, actors.ADMIN as ExportSessionActor);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.buffer.byteLength).toBeGreaterThan(0);
    expect(outcome.filename).toMatch(/^inventaire_EXPORT-B_\d{8}-\d{4}\.xlsx$/);
  });

  it("succeeds for a CLOSED session", async () => {
    const sessionId = await prepareAndSyncSession("EXPORT-C");
    await prisma.inventorySession.update({ where: { id: sessionId }, data: { status: "CLOSED", closedAt: new Date() } });

    const outcome = await runExportSession(sessionId, actors.ADMIN as ExportSessionActor);

    expect(outcome.ok).toBe(true);
  });
});

describe("runExportSession — RBAC (FR-027)", () => {
  it("denies LOGISTICS and journalizes the attempt", async () => {
    const sessionId = await prepareAndSyncSession("EXPORT-D");

    const outcome = await runExportSession(sessionId, actors.LOGISTICS as ExportSessionActor);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.status).toBe(403);

    const denied = await prisma.auditLog.findFirst({
      where: { sessionId, actorId: actors.LOGISTICS.id, action: "SESSION_EXPORT_DENIED" },
    });
    expect(denied).not.toBeNull();
  });

  it("allows DIRECTION (read-only export)", async () => {
    const sessionId = await prepareAndSyncSession("EXPORT-E");

    const outcome = await runExportSession(sessionId, actors.DIRECTION as ExportSessionActor);

    expect(outcome.ok).toBe(true);
  });

  it("allows DEPOT_MANAGER", async () => {
    const sessionId = await prepareAndSyncSession("EXPORT-A");

    const outcome = await runExportSession(sessionId, actors.DEPOT_MANAGER as ExportSessionActor);

    expect(outcome.ok).toBe(true);
  });

  it("denies an unauthenticated caller (401) and journalizes the attempt", async () => {
    const sessionId = await prepareAndSyncSession("EXPORT-A");

    const outcome = await runExportSession(sessionId, null);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.status).toBe(401);

    const denied = await prisma.auditLog.findFirst({
      where: { sessionId, actorId: null, action: "SESSION_EXPORT_DENIED" },
    });
    expect(denied).not.toBeNull();
  });
});

describe("runExportSession — workbook content", () => {
  it("produces a workbook whose canonical structure matches the session's lines", async () => {
    const sessionId = await prepareAndSyncSession("EXPORT-B");

    const outcome = await runExportSession(sessionId, actors.ADMIN as ExportSessionActor);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(outcome.buffer);

    const fullSheet = workbook.getWorksheet("Inventaire complet");
    expect(fullSheet).toBeDefined();
    // Header row + 3 lines (ART-001, ART-002, ART-003 from the "normal" fixture)
    // plus the off-referential OFF-REF-1 line created at sync time.
    expect(fullSheet!.rowCount).toBe(1 + 4);

    const offReferentialRow = fullSheet!.getRows(2, 4)!.find((row) => row.getCell(1).value === "OFF-REF-1");
    expect(offReferentialRow?.getCell(2).value).toBe("Hors référentiel");
    expect(offReferentialRow?.getCell(4).value).toBe(0);
  });
});
