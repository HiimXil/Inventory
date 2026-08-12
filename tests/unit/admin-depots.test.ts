import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../lib/db/client";
import {
  listDepots,
  createDepot,
  updateDepot,
  deactivateDepot,
  activateDepot,
  type AdminActor,
} from "../../lib/admin/depots";

let actors: Record<"ADMIN" | "DEPOT_MANAGER" | "LOGISTICS" | "DIRECTION", AdminActor>;

const TEST_DEPOT_CODES = new Set<string>();

// AuditLog has no FK to Depot (only a JSON details.depotId), so deleting a
// test depot never needs an audit cleanup step first — unlike test users,
// where AuditLog.actorId is a real FK (see admin-users.test.ts).
async function resetTestDepots() {
  if (TEST_DEPOT_CODES.size === 0) return;
  await prisma.depot.deleteMany({ where: { code: { in: [...TEST_DEPOT_CODES] } } });
  TEST_DEPOT_CODES.clear();
}

function uniqueCode(prefix: string): string {
  const code = `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
  TEST_DEPOT_CODES.add(code);
  return code;
}

beforeAll(async () => {
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
  await resetTestDepots();
  await prisma.$disconnect();
});

afterEach(async () => {
  await resetTestDepots();
});

describe("listDepots — RBAC (MANAGE_DEPOTS)", () => {
  it("allows ADMIN", async () => {
    const outcome = await listDepots(actors.ADMIN);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.depots.length).toBeGreaterThan(0);
  });

  it.each(["DEPOT_MANAGER", "LOGISTICS", "DIRECTION"] as const)(
    "denies %s and journalizes the attempt",
    async (role) => {
      const outcome = await listDepots(actors[role]);
      expect(outcome.ok).toBe(false);
      if (outcome.ok) return;
      expect(outcome.status).toBe(403);

      const denied = await prisma.auditLog.findFirst({
        where: { actorId: actors[role]!.id, action: "DEPOTS_LIST_DENIED" },
        orderBy: { createdAt: "desc" },
      });
      expect(denied).not.toBeNull();
    },
  );

  it("denies an unauthenticated caller (401) and journalizes the attempt", async () => {
    const outcome = await listDepots(null);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.status).toBe(401);

    const denied = await prisma.auditLog.findFirst({
      where: { actorId: null, action: "DEPOTS_LIST_DENIED" },
      orderBy: { createdAt: "desc" },
    });
    expect(denied).not.toBeNull();
  });
});

describe("createDepot — RBAC + uniqueness", () => {
  it("allows ADMIN and journalizes DEPOT_CREATED", async () => {
    const code = uniqueCode("created");
    const outcome = await createDepot(actors.ADMIN, { code, name: "Dépôt test" });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const created = await prisma.depot.findUniqueOrThrow({ where: { id: outcome.depotId } });
    expect(created.code).toBe(code);
    expect(created.disabledAt).toBeNull();

    const log = await prisma.auditLog.findFirst({
      where: { action: "DEPOT_CREATED", details: { path: ["depotId"], equals: outcome.depotId } },
    });
    expect(log).not.toBeNull();
  });

  it("refuses a duplicate code", async () => {
    const code = uniqueCode("dup");
    const first = await createDepot(actors.ADMIN, { code, name: "Premier" });
    expect(first.ok).toBe(true);

    const second = await createDepot(actors.ADMIN, { code, name: "Second" });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.status).toBe(400);
  });

  it("refuses an invalid payload (empty libellé)", async () => {
    const outcome = await createDepot(actors.ADMIN, { code: uniqueCode("invalid"), name: "" });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.status).toBe(400);
  });

  it.each(["DEPOT_MANAGER", "LOGISTICS", "DIRECTION"] as const)(
    "denies %s and journalizes the attempt, creating no depot",
    async (role) => {
      const code = uniqueCode(`denied-${role}`);
      const outcome = await createDepot(actors[role], { code, name: "Interdit" });

      expect(outcome.ok).toBe(false);
      if (outcome.ok) return;
      expect(outcome.status).toBe(403);

      const denied = await prisma.auditLog.findFirst({
        where: { actorId: actors[role]!.id, action: "DEPOT_CREATE_DENIED" },
        orderBy: { createdAt: "desc" },
      });
      expect(denied).not.toBeNull();

      const createdDepot = await prisma.depot.findUnique({ where: { code } });
      expect(createdDepot).toBeNull();
    },
  );

  it("denies an unauthenticated caller (401) and journalizes the attempt", async () => {
    const code = uniqueCode("unauth");
    const outcome = await createDepot(null, { code, name: "Interdit" });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.status).toBe(401);
  });
});

describe("updateDepot — libellé only", () => {
  it("allows ADMIN to update the libellé and journalizes DEPOT_UPDATED", async () => {
    const code = uniqueCode("update-target");
    const created = await createDepot(actors.ADMIN, { code, name: "Ancien libellé" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const outcome = await updateDepot(actors.ADMIN, created.depotId, { name: "Nouveau libellé" });
    expect(outcome.ok).toBe(true);

    const updated = await prisma.depot.findUniqueOrThrow({ where: { id: created.depotId } });
    expect(updated.name).toBe("Nouveau libellé");
    expect(updated.code).toBe(code);

    const log = await prisma.auditLog.findFirst({ where: { action: "DEPOT_UPDATED" }, orderBy: { createdAt: "desc" } });
    expect(log).not.toBeNull();
  });

  it.each(["DEPOT_MANAGER", "LOGISTICS", "DIRECTION"] as const)(
    "denies %s and journalizes the attempt",
    async (role) => {
      const code = uniqueCode(`update-denied-${role}`);
      const created = await createDepot(actors.ADMIN, { code, name: "Libellé" });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const outcome = await updateDepot(actors[role], created.depotId, { name: "Piraté" });
      expect(outcome.ok).toBe(false);
      if (outcome.ok) return;
      expect(outcome.status).toBe(403);

      const denied = await prisma.auditLog.findFirst({
        where: { actorId: actors[role]!.id, action: "DEPOT_UPDATE_DENIED" },
        orderBy: { createdAt: "desc" },
      });
      expect(denied).not.toBeNull();
    },
  );
});

describe("deactivateDepot / activateDepot — soft toggle preserves history", () => {
  it("deactivates a depot without deleting it, journalizes DEPOT_DEACTIVATED, and keeps its historical sessions queryable", async () => {
    const code = uniqueCode("deactivate-target");
    const created = await createDepot(actors.ADMIN, { code, name: "À désactiver" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const session = await prisma.inventorySession.create({
      data: {
        depotId: created.depotId,
        status: "CLOSED",
        theoreticalSnapshot: {},
      },
    });

    const outcome = await deactivateDepot(actors.ADMIN, created.depotId);
    expect(outcome.ok).toBe(true);

    const disabled = await prisma.depot.findUniqueOrThrow({ where: { id: created.depotId } });
    expect(disabled.disabledAt).not.toBeNull();

    const log = await prisma.auditLog.findFirst({ where: { action: "DEPOT_DEACTIVATED" }, orderBy: { createdAt: "desc" } });
    expect(log).not.toBeNull();

    const historicalSession = await prisma.inventorySession.findUniqueOrThrow({ where: { id: session.id } });
    expect(historicalSession.depotId).toBe(created.depotId);

    await prisma.inventorySession.delete({ where: { id: session.id } });
  });

  it("refuses to deactivate an already-deactivated depot", async () => {
    const code = uniqueCode("double-deactivate");
    const created = await createDepot(actors.ADMIN, { code, name: "Doublon" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const first = await deactivateDepot(actors.ADMIN, created.depotId);
    expect(first.ok).toBe(true);

    const second = await deactivateDepot(actors.ADMIN, created.depotId);
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.status).toBe(400);
  });

  it("reactivates a depot and journalizes DEPOT_ACTIVATED", async () => {
    const code = uniqueCode("reactivate-target");
    const created = await createDepot(actors.ADMIN, { code, name: "À réactiver" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    await deactivateDepot(actors.ADMIN, created.depotId);
    const outcome = await activateDepot(actors.ADMIN, created.depotId);
    expect(outcome.ok).toBe(true);

    const reactivated = await prisma.depot.findUniqueOrThrow({ where: { id: created.depotId } });
    expect(reactivated.disabledAt).toBeNull();

    const log = await prisma.auditLog.findFirst({ where: { action: "DEPOT_ACTIVATED" }, orderBy: { createdAt: "desc" } });
    expect(log).not.toBeNull();
  });

  it.each(["DEPOT_MANAGER", "LOGISTICS", "DIRECTION"] as const)(
    "denies %s on deactivate and journalizes the attempt",
    async (role) => {
      const code = uniqueCode(`deactivate-denied-${role}`);
      const created = await createDepot(actors.ADMIN, { code, name: "Protégé" });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const outcome = await deactivateDepot(actors[role], created.depotId);
      expect(outcome.ok).toBe(false);
      if (outcome.ok) return;
      expect(outcome.status).toBe(403);

      const denied = await prisma.auditLog.findFirst({
        where: { actorId: actors[role]!.id, action: "DEPOT_DEACTIVATE_DENIED" },
        orderBy: { createdAt: "desc" },
      });
      expect(denied).not.toBeNull();

      const target = await prisma.depot.findUniqueOrThrow({ where: { id: created.depotId } });
      expect(target.disabledAt).toBeNull();
    },
  );

  it("denies an unauthenticated caller (401) on deactivate and journalizes the attempt", async () => {
    const code = uniqueCode("deactivate-unauth");
    const created = await createDepot(actors.ADMIN, { code, name: "Protégé" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const outcome = await deactivateDepot(null, created.depotId);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.status).toBe(401);

    const denied = await prisma.auditLog.findFirst({
      where: { actorId: null, action: "DEPOT_DEACTIVATE_DENIED" },
      orderBy: { createdAt: "desc" },
    });
    expect(denied).not.toBeNull();
  });
});
