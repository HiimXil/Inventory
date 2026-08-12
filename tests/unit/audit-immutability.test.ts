import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "../../lib/db/client";

/**
 * FR-032, DB level: prisma/migrations/20260723095800_hardening_auditlog_immutable_role
 * creates a restricted "sqp_app" role (the one production's DATABASE_URL is
 * meant to authenticate as) that can SELECT/INSERT on AuditLog but not
 * UPDATE/DELETE. This test assumes the sqp_app role from that role, using
 * SET ROLE from the superuser connection tests already run as, without
 * needing a second DATABASE_URL.
 */
describe("AuditLog append-only — DB-level enforcement (FR-032)", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("sqp_app can INSERT into AuditLog", async () => {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET ROLE sqp_app");
      await tx.$executeRawUnsafe(
        `INSERT INTO "AuditLog" (id, "createdAt", action) VALUES (gen_random_uuid()::text, now(), 'ROLE_TEST_INSERT')`,
      );
      await tx.$executeRawUnsafe("RESET ROLE");
    });

    const inserted = await prisma.auditLog.findFirst({ where: { action: "ROLE_TEST_INSERT" } });
    expect(inserted).not.toBeNull();

    await prisma.auditLog.deleteMany({ where: { action: "ROLE_TEST_INSERT" } });
  });

  it("sqp_app cannot UPDATE an AuditLog row", async () => {
    const log = await prisma.auditLog.create({ data: { action: "ROLE_TEST_UPDATE_TARGET" } });

    await expect(
      prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SET ROLE sqp_app");
        await tx.$executeRawUnsafe(`UPDATE "AuditLog" SET action = 'TAMPERED' WHERE id = $1`, log.id);
      }),
    ).rejects.toThrow(/permission denied/i);

    const stillOriginal = await prisma.auditLog.findUniqueOrThrow({ where: { id: log.id } });
    expect(stillOriginal.action).toBe("ROLE_TEST_UPDATE_TARGET");

    await prisma.auditLog.deleteMany({ where: { action: "ROLE_TEST_UPDATE_TARGET" } });
  });

  it("sqp_app cannot DELETE an AuditLog row", async () => {
    const log = await prisma.auditLog.create({ data: { action: "ROLE_TEST_DELETE_TARGET" } });

    await expect(
      prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SET ROLE sqp_app");
        await tx.$executeRawUnsafe(`DELETE FROM "AuditLog" WHERE id = $1`, log.id);
      }),
    ).rejects.toThrow(/permission denied/i);

    const stillThere = await prisma.auditLog.findUnique({ where: { id: log.id } });
    expect(stillThere).not.toBeNull();

    await prisma.auditLog.deleteMany({ where: { action: "ROLE_TEST_DELETE_TARGET" } });
  });
});
