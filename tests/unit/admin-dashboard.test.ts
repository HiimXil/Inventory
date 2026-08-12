import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "../../lib/db/client";
import { assertAdminDashboardAccess } from "../../lib/admin/dashboard";
import { listSessionsForAdmin } from "../../lib/admin/sessions";

type Actor = { id: string; role: "ADMIN" | "DEPOT_MANAGER" | "LOGISTICS" | "DIRECTION" } | null;

let actors: Record<"ADMIN" | "DEPOT_MANAGER" | "LOGISTICS" | "DIRECTION", Actor>;

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

describe("assertAdminDashboardAccess — /admin entry point", () => {
  it("allows ADMIN", async () => {
    await loadActors();
    const outcome = await assertAdminDashboardAccess(actors.ADMIN);
    expect(outcome.ok).toBe(true);
  });

  it.each(["DEPOT_MANAGER", "LOGISTICS", "DIRECTION"] as const)(
    "denies %s and journalizes the attempt",
    async (role) => {
      await loadActors();
      const outcome = await assertAdminDashboardAccess(actors[role]);

      expect(outcome.ok).toBe(false);
      if (outcome.ok) return;
      expect(outcome.reason).toBe("forbidden");

      const denied = await prisma.auditLog.findFirst({
        where: { actorId: actors[role]!.id, action: "ADMIN_DASHBOARD_DENIED" },
        orderBy: { createdAt: "desc" },
      });
      expect(denied).not.toBeNull();
    },
  );

  it("denies an unauthenticated caller and journalizes the attempt", async () => {
    const outcome = await assertAdminDashboardAccess(null);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe("unauthenticated");

    const denied = await prisma.auditLog.findFirst({
      where: { actorId: null, action: "ADMIN_DASHBOARD_DENIED" },
      orderBy: { createdAt: "desc" },
    });
    expect(denied).not.toBeNull();
  });
});

describe("listSessionsForAdmin — RBAC (CANCEL_SESSION, FR-027)", () => {
  it("allows ADMIN", async () => {
    await loadActors();
    const outcome = await listSessionsForAdmin(actors.ADMIN);
    expect(outcome.ok).toBe(true);
  });

  it.each(["DEPOT_MANAGER", "LOGISTICS", "DIRECTION"] as const)(
    "denies %s and journalizes the attempt",
    async (role) => {
      await loadActors();
      const outcome = await listSessionsForAdmin(actors[role]);

      expect(outcome.ok).toBe(false);
      if (outcome.ok) return;
      expect(outcome.status).toBe(403);

      const denied = await prisma.auditLog.findFirst({
        where: { actorId: actors[role]!.id, action: "ADMIN_SESSIONS_LIST_DENIED" },
        orderBy: { createdAt: "desc" },
      });
      expect(denied).not.toBeNull();
    },
  );
});
