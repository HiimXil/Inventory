import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../lib/db/client";
import { purgeExpiredData, resolveRetentionMonths } from "../../lib/rgpd/purge";

const TEST_DEPOTS = [
  { code: "RGPD-A", name: "RGPD Depot A" },
  { code: "RGPD-B", name: "RGPD Depot B" },
  { code: "RGPD-C", name: "RGPD Depot C" },
  { code: "RGPD-D", name: "RGPD Depot D" },
  { code: "RGPD-E", name: "RGPD Depot E" },
];

let depots: Record<string, { id: string }>;
const NOW = new Date("2026-07-23T12:00:00.000Z");

function monthsAgo(months: number): Date {
  const d = new Date(NOW);
  d.setMonth(d.getMonth() - months);
  return d;
}

async function resetData() {
  await prisma.auditLog.deleteMany({});
  await prisma.inventoryLine.deleteMany({});
  await prisma.inventorySession.deleteMany({});
}

async function createSession(depotCode: string, status: "PREPARED" | "SYNCED" | "CLOSED" | "CANCELLED") {
  return prisma.inventorySession.create({
    data: {
      depotId: depots[depotCode].id,
      status,
      theoreticalSnapshot: {},
    },
  });
}

beforeAll(async () => {
  for (const d of TEST_DEPOTS) {
    await prisma.depot.upsert({ where: { code: d.code }, update: {}, create: d });
  }
  const created = await prisma.depot.findMany({ where: { code: { in: TEST_DEPOTS.map((d) => d.code) } } });
  depots = Object.fromEntries(created.map((d) => [d.code, { id: d.id }]));
});

afterAll(async () => {
  await resetData();
  await prisma.depot.deleteMany({ where: { code: { in: TEST_DEPOTS.map((d) => d.code) } } });
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetData();
  delete process.env.RGPD_RETENTION_MONTHS;
});

afterEach(async () => {
  delete process.env.RGPD_RETENTION_MONTHS;
});

describe("resolveRetentionMonths", () => {
  it("defaults to 24 months when unset", () => {
    delete process.env.RGPD_RETENTION_MONTHS;
    expect(resolveRetentionMonths()).toBe(24);
  });

  it("reads a valid RGPD_RETENTION_MONTHS override", () => {
    process.env.RGPD_RETENTION_MONTHS = "6";
    expect(resolveRetentionMonths()).toBe(6);
  });

  it("falls back to 24 for an invalid value (non-numeric or <= 0)", () => {
    process.env.RGPD_RETENTION_MONTHS = "not-a-number";
    expect(resolveRetentionMonths()).toBe(24);
    process.env.RGPD_RETENTION_MONTHS = "0";
    expect(resolveRetentionMonths()).toBe(24);
    process.env.RGPD_RETENTION_MONTHS = "-5";
    expect(resolveRetentionMonths()).toBe(24);
  });
});

describe("purgeExpiredData — session purge (FR-025)", () => {
  it("purges a CLOSED session past retention (closedAt) and its lines", async () => {
    const session = await createSession("RGPD-A", "CLOSED");
    await prisma.inventoryLine.create({
      data: { sessionId: session.id, articleRef: "ART-001", theoreticalQty: 1, countedQty: 1 },
    });
    await prisma.inventorySession.update({
      where: { id: session.id },
      data: { closedAt: monthsAgo(25) },
    });

    const result = await purgeExpiredData({ now: NOW, retentionMonths: 24 });

    expect(result.sessionsPurged).toBe(1);
    expect(result.linesPurged).toBe(1);
    expect(await prisma.inventorySession.findUnique({ where: { id: session.id } })).toBeNull();
  });

  it("purges a CANCELLED session past retention via the updatedAt fallback (no closedAt)", async () => {
    const session = await createSession("RGPD-B", "CANCELLED");
    // updatedAt is @updatedAt-managed: Prisma's normal update() API always
    // recomputes it to "now", so forcing an old value needs raw SQL.
    await prisma.$executeRaw`UPDATE "InventorySession" SET "updatedAt" = ${monthsAgo(30)} WHERE id = ${session.id}`;

    const result = await purgeExpiredData({ now: NOW, retentionMonths: 24 });

    expect(result.sessionsPurged).toBe(1);
    expect(await prisma.inventorySession.findUnique({ where: { id: session.id } })).toBeNull();
  });

  it("keeps a CLOSED session still within retention", async () => {
    const session = await createSession("RGPD-C", "CLOSED");
    await prisma.inventorySession.update({
      where: { id: session.id },
      data: { closedAt: monthsAgo(1) },
    });

    const result = await purgeExpiredData({ now: NOW, retentionMonths: 24 });

    expect(result.sessionsPurged).toBe(0);
    expect(await prisma.inventorySession.findUnique({ where: { id: session.id } })).not.toBeNull();
  });

  it("never touches active sessions (PREPARED/SYNCED), no matter how old", async () => {
    const prepared = await createSession("RGPD-D", "PREPARED");
    const synced = await createSession("RGPD-D", "SYNCED");
    await prisma.$executeRaw`UPDATE "InventorySession" SET "updatedAt" = ${monthsAgo(60)}, "createdAt" = ${monthsAgo(60)} WHERE id IN (${prepared.id}, ${synced.id})`;

    const result = await purgeExpiredData({ now: NOW, retentionMonths: 24 });

    expect(result.sessionsPurged).toBe(0);
    expect(await prisma.inventorySession.findUnique({ where: { id: prepared.id } })).not.toBeNull();
    expect(await prisma.inventorySession.findUnique({ where: { id: synced.id } })).not.toBeNull();
  });

  it("respects a configurable retention threshold shorter than the default", async () => {
    const session = await createSession("RGPD-E", "CLOSED");
    await prisma.inventorySession.update({
      where: { id: session.id },
      data: { closedAt: monthsAgo(2) },
    });

    const keptAtDefault = await purgeExpiredData({ now: NOW, retentionMonths: 24 });
    expect(keptAtDefault.sessionsPurged).toBe(0);

    const purgedAtOneMonth = await purgeExpiredData({ now: NOW, retentionMonths: 1 });
    expect(purgedAtOneMonth.sessionsPurged).toBe(1);
    expect(await prisma.inventorySession.findUnique({ where: { id: session.id } })).toBeNull();
  });
});

describe("purgeExpiredData — audit log purge (FR-025)", () => {
  it("purges AuditLog entries older than retention, independent of session status", async () => {
    await prisma.auditLog.create({ data: { action: "OLD_ENTRY", createdAt: monthsAgo(25) } });

    const result = await purgeExpiredData({ now: NOW, retentionMonths: 24 });

    expect(result.auditLogsPurged).toBe(1);
    const remaining = await prisma.auditLog.findMany({ where: { action: "OLD_ENTRY" } });
    expect(remaining).toHaveLength(0);
  });

  it("keeps AuditLog entries within retention", async () => {
    await prisma.auditLog.create({ data: { action: "RECENT_ENTRY", createdAt: monthsAgo(1) } });

    const result = await purgeExpiredData({ now: NOW, retentionMonths: 24 });

    expect(result.auditLogsPurged).toBe(0);
    const remaining = await prisma.auditLog.findMany({ where: { action: "RECENT_ENTRY" } });
    expect(remaining).toHaveLength(1);
  });

  it("survives a purged session's own audit log if that entry is itself still within retention (sessionId nulled, not deleted)", async () => {
    const session = await createSession("RGPD-A", "CLOSED");
    await prisma.inventorySession.update({ where: { id: session.id }, data: { closedAt: monthsAgo(25) } });
    await prisma.auditLog.create({
      data: { action: "SESSION_CLOSED", sessionId: session.id, createdAt: monthsAgo(1) },
    });

    const result = await purgeExpiredData({ now: NOW, retentionMonths: 24 });

    expect(result.sessionsPurged).toBe(1);
    expect(result.auditLogsPurged).toBe(0);
    const log = await prisma.auditLog.findFirst({ where: { action: "SESSION_CLOSED" } });
    expect(log).not.toBeNull();
    expect(log?.sessionId).toBeNull();
  });
});

describe("purgeExpiredData — result reporting", () => {
  it("reports the resolved retention window and cutoff date", async () => {
    const result = await purgeExpiredData({ now: NOW, retentionMonths: 24 });
    expect(result.retentionMonths).toBe(24);
    expect(result.cutoffDate.toISOString()).toBe("2024-07-23T12:00:00.000Z");
  });
});
