import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "../../lib/db/client";
import { listAuditLog, type AuditActor } from "../../lib/admin/audit";
import * as adminAuditModule from "../../lib/admin/audit";

let actors: Record<"ADMIN" | "DEPOT_MANAGER" | "LOGISTICS" | "DIRECTION", AuditActor>;

async function loadActors() {
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
}

afterAll(async () => {
  await prisma.$disconnect();
});

describe("listAuditLog — RBAC (VIEW_AUDIT, FR-027)", () => {
  it("allows ADMIN and returns entries newest-first", async () => {
    await loadActors();

    const outcome = await listAuditLog(actors.ADMIN);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.entries.length).toBeGreaterThan(0);
    for (let i = 1; i < outcome.entries.length; i++) {
      expect(outcome.entries[i - 1].createdAt.getTime()).toBeGreaterThanOrEqual(
        outcome.entries[i].createdAt.getTime(),
      );
    }
  });

  it.each(["DEPOT_MANAGER", "LOGISTICS", "DIRECTION"] as const)(
    "denies %s and journalizes the attempt",
    async (role) => {
      await loadActors();

      const outcome = await listAuditLog(actors[role]);

      expect(outcome.ok).toBe(false);
      if (outcome.ok) return;
      expect(outcome.status).toBe(403);

      const denied = await prisma.auditLog.findFirst({
        where: { actorId: actors[role]!.id, action: "AUDIT_VIEW_DENIED" },
        orderBy: { createdAt: "desc" },
      });
      expect(denied).not.toBeNull();
    },
  );

  it("denies an unauthenticated caller (401) and journalizes the attempt", async () => {
    const outcome = await listAuditLog(null);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.status).toBe(401);

    const denied = await prisma.auditLog.findFirst({
      where: { actorId: null, action: "AUDIT_VIEW_DENIED" },
      orderBy: { createdAt: "desc" },
    });
    expect(denied).not.toBeNull();
  });
});

describe("listAuditLog — filters", () => {
  const marker = `TEST-AUDIT-FILTER-${Date.now()}`;

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { action: { startsWith: marker } } });
  });

  it("filters by actor", async () => {
    await loadActors();
    await prisma.auditLog.create({ data: { actorId: actors.ADMIN!.id, action: `${marker}-BY-ADMIN` } });
    await prisma.auditLog.create({ data: { actorId: actors.DEPOT_MANAGER!.id, action: `${marker}-BY-DEPOT` } });

    const outcome = await listAuditLog(actors.ADMIN, { actorId: actors.DEPOT_MANAGER!.id });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.entries.some((e) => e.action === `${marker}-BY-DEPOT`)).toBe(true);
    expect(outcome.entries.some((e) => e.action === `${marker}-BY-ADMIN`)).toBe(false);
    expect(outcome.entries.every((e) => e.actorId === actors.DEPOT_MANAGER!.id)).toBe(true);
  });

  it("filters by action type", async () => {
    await loadActors();
    await prisma.auditLog.create({ data: { actorId: actors.ADMIN!.id, action: `${marker}-ACTION-X` } });
    await prisma.auditLog.create({ data: { actorId: actors.ADMIN!.id, action: `${marker}-ACTION-Y` } });

    const outcome = await listAuditLog(actors.ADMIN, { action: `${marker}-ACTION-X` });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.entries.length).toBeGreaterThan(0);
    expect(outcome.entries.every((e) => e.action === `${marker}-ACTION-X`)).toBe(true);
  });

  it("filters by date range, excluding entries outside the window", async () => {
    await loadActors();
    const farFuture = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const outcome = await listAuditLog(actors.ADMIN, { from: farFuture });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.entries.length).toBe(0);
  });

  it("paginates results and reports the total count", async () => {
    await loadActors();
    const outcome = await listAuditLog(actors.ADMIN, {}, 1);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.entries.length).toBeLessThanOrEqual(outcome.pageSize);
    expect(outcome.total).toBeGreaterThanOrEqual(outcome.entries.length);
  });
});

describe("lib/admin/audit.ts — append-only surface (FR-032)", () => {
  it("exposes no update/delete/upsert function for audit entries", () => {
    // Meta-test guarding the module's public API: if anyone ever adds a
    // mutate-audit-log export here, this fails immediately, on top of the
    // `grep -rn "auditLog\.\(update\|delete\|upsert\)" app lib` check
    // documented on the AuditLog model in prisma/schema.prisma.
    const exportedNames = Object.keys(adminAuditModule);
    const mutationLike = exportedNames.filter((name) => /update|delete|remove|edit|mutate/i.test(name));
    expect(mutationLike).toEqual([]);
  });
});
