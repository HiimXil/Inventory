import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import argon2 from "argon2";
import { prisma } from "../../lib/db/client";
import {
  listUsers,
  createUser,
  updateUser,
  disableUser,
  type AdminActor,
} from "../../lib/admin/users";

let actors: Record<"ADMIN" | "DEPOT_MANAGER" | "LOGISTICS" | "DIRECTION", AdminActor>;

const TEST_USER_EMAILS = new Set<string>();

async function resetTestUsers() {
  if (TEST_USER_EMAILS.size === 0) return;
  const users = await prisma.user.findMany({ where: { email: { in: [...TEST_USER_EMAILS] } } });
  const ids = users.map((u) => u.id);
  await prisma.auditLog.deleteMany({ where: { actorId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  TEST_USER_EMAILS.clear();
}

function uniqueEmail(prefix: string): string {
  const email = `${prefix}-${Math.random().toString(36).slice(2)}@example.com`;
  TEST_USER_EMAILS.add(email);
  return email;
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
  await resetTestUsers();
  await prisma.$disconnect();
});

afterEach(async () => {
  await resetTestUsers();
});

describe("listUsers — RBAC (MANAGE_USERS, FR-027)", () => {
  it("allows ADMIN and never returns passwordHash", async () => {
    const outcome = await listUsers(actors.ADMIN);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.users.length).toBeGreaterThan(0);
    for (const user of outcome.users) {
      expect(user).not.toHaveProperty("passwordHash");
    }
  });

  it.each(["DEPOT_MANAGER", "LOGISTICS", "DIRECTION"] as const)(
    "denies %s and journalizes the attempt",
    async (role) => {
      const outcome = await listUsers(actors[role]);
      expect(outcome.ok).toBe(false);
      if (outcome.ok) return;
      expect(outcome.status).toBe(403);

      const denied = await prisma.auditLog.findFirst({
        where: { actorId: actors[role]!.id, action: "USERS_LIST_DENIED" },
        orderBy: { createdAt: "desc" },
      });
      expect(denied).not.toBeNull();
    },
  );

  it("denies an unauthenticated caller (401) and journalizes the attempt", async () => {
    const outcome = await listUsers(null);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.status).toBe(401);

    const denied = await prisma.auditLog.findFirst({
      where: { actorId: null, action: "USERS_LIST_DENIED" },
      orderBy: { createdAt: "desc" },
    });
    expect(denied).not.toBeNull();
  });
});

describe("createUser — RBAC + behavior (FR-010)", () => {
  it("allows ADMIN, hashes the password with argon2, never logs it, and journalizes USER_CREATED", async () => {
    const email = uniqueEmail("created");
    const outcome = await createUser(actors.ADMIN, {
      email,
      name: "Test User",
      role: "LOGISTICS",
      password: "Sup3rSecret!",
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const created = await prisma.user.findUniqueOrThrow({ where: { id: outcome.userId } });
    expect(created.passwordHash).not.toBe("Sup3rSecret!");
    expect(await argon2.verify(created.passwordHash, "Sup3rSecret!")).toBe(true);

    const log = await prisma.auditLog.findFirst({ where: { action: "USER_CREATED", details: { path: ["userId"], equals: outcome.userId } } });
    expect(log).not.toBeNull();
    expect(JSON.stringify(log?.details)).not.toContain("Sup3rSecret!");
  });

  it("refuses a duplicate email", async () => {
    const email = uniqueEmail("dup");
    const first = await createUser(actors.ADMIN, { email, role: "LOGISTICS", password: "Sup3rSecret!" });
    expect(first.ok).toBe(true);

    const second = await createUser(actors.ADMIN, { email, role: "DIRECTION", password: "AnotherPass1!" });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.status).toBe(400);
  });

  it("refuses an invalid payload (short password)", async () => {
    const outcome = await createUser(actors.ADMIN, {
      email: uniqueEmail("invalid"),
      role: "LOGISTICS",
      password: "short",
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.status).toBe(400);
  });

  it.each(["DEPOT_MANAGER", "LOGISTICS", "DIRECTION"] as const)(
    "denies %s and journalizes the attempt, creating no user",
    async (role) => {
      const email = uniqueEmail(`denied-${role}`);
      const outcome = await createUser(actors[role], { email, role: "LOGISTICS", password: "Sup3rSecret!" });

      expect(outcome.ok).toBe(false);
      if (outcome.ok) return;
      expect(outcome.status).toBe(403);

      const denied = await prisma.auditLog.findFirst({
        where: { actorId: actors[role]!.id, action: "USER_CREATE_DENIED" },
        orderBy: { createdAt: "desc" },
      });
      expect(denied).not.toBeNull();

      const createdUser = await prisma.user.findUnique({ where: { email } });
      expect(createdUser).toBeNull();
    },
  );

  it("denies an unauthenticated caller (401) and journalizes the attempt", async () => {
    const email = uniqueEmail("unauth");
    const outcome = await createUser(null, { email, role: "LOGISTICS", password: "Sup3rSecret!" });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.status).toBe(401);

    const denied = await prisma.auditLog.findFirst({
      where: { actorId: null, action: "USER_CREATE_DENIED" },
      orderBy: { createdAt: "desc" },
    });
    expect(denied).not.toBeNull();
  });
});

describe("updateUser — RBAC + anti-lockout (FR-010)", () => {
  it("allows ADMIN to update name/role and journalizes USER_UPDATED", async () => {
    const email = uniqueEmail("update-target");
    const createOutcome = await createUser(actors.ADMIN, { email, role: "LOGISTICS", password: "Sup3rSecret!" });
    expect(createOutcome.ok).toBe(true);
    if (!createOutcome.ok) return;

    const outcome = await updateUser(actors.ADMIN, createOutcome.userId, { name: "Renamed", role: "DEPOT_MANAGER" });
    expect(outcome.ok).toBe(true);

    const updated = await prisma.user.findUniqueOrThrow({ where: { id: createOutcome.userId } });
    expect(updated.name).toBe("Renamed");
    expect(updated.role).toBe("DEPOT_MANAGER");

    const log = await prisma.auditLog.findFirst({ where: { action: "USER_UPDATED" }, orderBy: { createdAt: "desc" } });
    expect(log).not.toBeNull();
  });

  it("refuses to demote the last active ADMIN, even attempted by another admin", async () => {
    // Isolate: temporarily demote every other active admin to DEPOT_MANAGER
    // except our seeded actors.ADMIN, so it's provably "the last one" for
    // this assertion, then restore state in the finally block.
    const otherAdmins = await prisma.user.findMany({
      where: { role: "ADMIN", disabledAt: null, id: { not: actors.ADMIN!.id } },
    });
    await prisma.user.updateMany({ where: { id: { in: otherAdmins.map((u) => u.id) } }, data: { role: "DIRECTION" } });

    try {
      const outcome = await updateUser(actors.ADMIN, actors.ADMIN!.id, { role: "DEPOT_MANAGER" });

      expect(outcome.ok).toBe(false);
      if (outcome.ok) return;
      expect(outcome.status).toBe(400);

      const stillAdmin = await prisma.user.findUniqueOrThrow({ where: { id: actors.ADMIN!.id } });
      expect(stillAdmin.role).toBe("ADMIN");
    } finally {
      await prisma.user.updateMany({ where: { id: { in: otherAdmins.map((u) => u.id) } }, data: { role: "ADMIN" } });
    }
  });

  it("allows demoting an ADMIN when another active admin remains", async () => {
    const email = uniqueEmail("extra-admin");
    const createOutcome = await createUser(actors.ADMIN, { email, role: "ADMIN", password: "Sup3rSecret!" });
    expect(createOutcome.ok).toBe(true);
    if (!createOutcome.ok) return;

    const outcome = await updateUser(actors.ADMIN, createOutcome.userId, { role: "DIRECTION" });
    expect(outcome.ok).toBe(true);

    const updated = await prisma.user.findUniqueOrThrow({ where: { id: createOutcome.userId } });
    expect(updated.role).toBe("DIRECTION");
  });

  it.each(["DEPOT_MANAGER", "LOGISTICS", "DIRECTION"] as const)(
    "denies %s and journalizes the attempt",
    async (role) => {
      const outcome = await updateUser(actors[role], actors.ADMIN!.id, { name: "Hacked" });

      expect(outcome.ok).toBe(false);
      if (outcome.ok) return;
      expect(outcome.status).toBe(403);

      const denied = await prisma.auditLog.findFirst({
        where: { actorId: actors[role]!.id, action: "USER_UPDATE_DENIED" },
        orderBy: { createdAt: "desc" },
      });
      expect(denied).not.toBeNull();
    },
  );
});

describe("disableUser — RBAC + anti-lockout (FR-010)", () => {
  it("allows ADMIN to disable a non-admin user and journalizes USER_DISABLED", async () => {
    const email = uniqueEmail("disable-target");
    const createOutcome = await createUser(actors.ADMIN, { email, role: "LOGISTICS", password: "Sup3rSecret!" });
    expect(createOutcome.ok).toBe(true);
    if (!createOutcome.ok) return;

    const outcome = await disableUser(actors.ADMIN, createOutcome.userId);
    expect(outcome.ok).toBe(true);

    const disabled = await prisma.user.findUniqueOrThrow({ where: { id: createOutcome.userId } });
    expect(disabled.disabledAt).not.toBeNull();

    const log = await prisma.auditLog.findFirst({ where: { action: "USER_DISABLED" }, orderBy: { createdAt: "desc" } });
    expect(log).not.toBeNull();
  });

  it("refuses to disable the last active admin", async () => {
    const otherAdmins = await prisma.user.findMany({
      where: { role: "ADMIN", disabledAt: null, id: { not: actors.ADMIN!.id } },
    });
    await prisma.user.updateMany({ where: { id: { in: otherAdmins.map((u) => u.id) } }, data: { role: "DIRECTION" } });

    try {
      const outcome = await disableUser(actors.ADMIN, actors.ADMIN!.id);
      expect(outcome.ok).toBe(false);
      if (outcome.ok) return;
      expect(outcome.status).toBe(400);

      const stillActive = await prisma.user.findUniqueOrThrow({ where: { id: actors.ADMIN!.id } });
      expect(stillActive.disabledAt).toBeNull();
    } finally {
      await prisma.user.updateMany({ where: { id: { in: otherAdmins.map((u) => u.id) } }, data: { role: "ADMIN" } });
    }
  });

  it.each(["DEPOT_MANAGER", "LOGISTICS", "DIRECTION"] as const)(
    "denies %s and journalizes the attempt",
    async (role) => {
      const email = uniqueEmail(`disable-denied-${role}`);
      const createOutcome = await createUser(actors.ADMIN, { email, role: "LOGISTICS", password: "Sup3rSecret!" });
      expect(createOutcome.ok).toBe(true);
      if (!createOutcome.ok) return;

      const outcome = await disableUser(actors[role], createOutcome.userId);

      expect(outcome.ok).toBe(false);
      if (outcome.ok) return;
      expect(outcome.status).toBe(403);

      const denied = await prisma.auditLog.findFirst({
        where: { actorId: actors[role]!.id, action: "USER_DISABLE_DENIED" },
        orderBy: { createdAt: "desc" },
      });
      expect(denied).not.toBeNull();

      const target = await prisma.user.findUniqueOrThrow({ where: { id: createOutcome.userId } });
      expect(target.disabledAt).toBeNull();
    },
  );

  it("denies an unauthenticated caller (401) and journalizes the attempt", async () => {
    const email = uniqueEmail("disable-unauth");
    const createOutcome = await createUser(actors.ADMIN, { email, role: "LOGISTICS", password: "Sup3rSecret!" });
    expect(createOutcome.ok).toBe(true);
    if (!createOutcome.ok) return;

    const outcome = await disableUser(null, createOutcome.userId);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.status).toBe(401);

    const denied = await prisma.auditLog.findFirst({
      where: { actorId: null, action: "USER_DISABLE_DENIED" },
      orderBy: { createdAt: "desc" },
    });
    expect(denied).not.toBeNull();
  });
});
