import { z } from "zod";
import argon2 from "argon2";
import { prisma } from "@/lib/db/client";
import { requirePermission } from "@/lib/auth/guards";
import type { UserRole } from "@/lib/auth/roles";

export type AdminActor = { id: string; role: UserRole } | null;

export type AdminUser = {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
  disabledAt: Date | null;
  createdAt: Date;
};

const USER_SELECT = { id: true, email: true, name: true, role: true, disabledAt: true, createdAt: true } as const;

class PermissionDeniedError extends Error {
  constructor(
    public readonly status: 401 | 403,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Every user-management action shares the same guard (MANAGE_USERS = ADMIN
 * only, FR-010/FR-027) and the same "journalize every denial" behavior —
 * factored once here rather than repeated per action within this module.
 */
async function ensureManageUsersPermission(
  actor: AdminActor,
  deniedAction: string,
  details: Record<string, unknown> = {},
): Promise<void> {
  try {
    requirePermission(actor?.role, "MANAGE_USERS");
  } catch {
    await prisma.auditLog.create({
      data: {
        actorId: actor?.id ?? null,
        action: deniedAction,
        details: { attemptedRole: actor?.role ?? null, ...details },
      },
    });
    throw new PermissionDeniedError(
      actor ? 403 : 401,
      actor ? "Accès refusé." : "Authentification requise.",
    );
  }
}

export type ListUsersOutcome =
  | { ok: true; users: AdminUser[] }
  | { ok: false; status: 401 | 403; error: string };

export async function listUsers(actor: AdminActor): Promise<ListUsersOutcome> {
  try {
    await ensureManageUsersPermission(actor, "USERS_LIST_DENIED");
  } catch (error) {
    if (error instanceof PermissionDeniedError) return { ok: false, status: error.status, error: error.message };
    throw error;
  }

  const users = await prisma.user.findMany({ orderBy: { createdAt: "asc" }, select: USER_SELECT });
  return { ok: true, users };
}

export const createUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).optional(),
  role: z.enum(["ADMIN", "DEPOT_MANAGER", "LOGISTICS", "DIRECTION"]),
  password: z.string().min(8),
});

export type CreateUserOutcome =
  | { ok: true; userId: string }
  | { ok: false; status: 400 | 401 | 403; error: string };

/**
 * Hashes with argon2 exactly like prisma/seed.ts and verifies exactly like
 * lib/auth/options.ts's authorize() — same library, same defaults, no
 * separate hashing config to keep in sync.
 */
export async function createUser(actor: AdminActor, rawInput: unknown): Promise<CreateUserOutcome> {
  try {
    await ensureManageUsersPermission(actor, "USER_CREATE_DENIED");
  } catch (error) {
    if (error instanceof PermissionDeniedError) return { ok: false, status: error.status, error: error.message };
    throw error;
  }

  const parsed = createUserSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, status: 400, error: "Données utilisateur invalides." };
  }

  const existing = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  if (existing) {
    return { ok: false, status: 400, error: "Un utilisateur avec cet email existe déjà." };
  }

  const passwordHash = await argon2.hash(parsed.data.password);
  const user = await prisma.user.create({
    data: {
      email: parsed.data.email,
      name: parsed.data.name ?? null,
      role: parsed.data.role,
      passwordHash,
    },
  });

  // Never log the password or its hash — only identity/role metadata.
  await prisma.auditLog.create({
    data: {
      actorId: actor!.id,
      action: "USER_CREATED",
      details: { userId: user.id, email: user.email, role: user.role },
    },
  });

  return { ok: true, userId: user.id };
}

export const updateUserSchema = z.object({
  name: z.string().min(1).optional(),
  role: z.enum(["ADMIN", "DEPOT_MANAGER", "LOGISTICS", "DIRECTION"]).optional(),
});

export type UpdateUserOutcome =
  | { ok: true }
  | { ok: false; status: 400 | 401 | 403 | 404; error: string };

/**
 * Anti-lockout (FR-010): the last active ADMIN can never be demoted, by
 * themselves or anyone else — allowing "another admin does it" would defeat
 * the point, since the app would still end up with zero administrators.
 */
export async function updateUser(
  actor: AdminActor,
  userId: string,
  rawInput: unknown,
): Promise<UpdateUserOutcome> {
  try {
    await ensureManageUsersPermission(actor, "USER_UPDATE_DENIED", { userId });
  } catch (error) {
    if (error instanceof PermissionDeniedError) return { ok: false, status: error.status, error: error.message };
    throw error;
  }

  const parsed = updateUserSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, status: 400, error: "Données invalides." };
  }

  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target) {
    return { ok: false, status: 404, error: "Utilisateur introuvable." };
  }

  if (target.role === "ADMIN" && parsed.data.role && parsed.data.role !== "ADMIN") {
    const activeAdminCount = await prisma.user.count({ where: { role: "ADMIN", disabledAt: null } });
    if (activeAdminCount <= 1) {
      return {
        ok: false,
        status: 400,
        error: "Impossible de retirer le rôle ADMIN : c'est le dernier administrateur actif.",
      };
    }
  }

  await prisma.user.update({
    where: { id: userId },
    data: { name: parsed.data.name, role: parsed.data.role },
  });

  await prisma.auditLog.create({
    data: {
      actorId: actor!.id,
      action: "USER_UPDATED",
      details: { userId, changes: parsed.data },
    },
  });

  return { ok: true };
}

export type DisableUserOutcome =
  | { ok: true }
  | { ok: false; status: 400 | 401 | 403 | 404; error: string };

/**
 * Soft-disable only (FR-010's "désactiver/supprimer"): a hard delete would
 * either violate the FK from InventorySession.preparedById / AuditLog.actorId
 * or force cascading them away, both of which erase exactly the audit trail
 * FR-032 requires. disabledAt blocks login (lib/auth/options.ts) without
 * touching history.
 */
export async function disableUser(actor: AdminActor, userId: string): Promise<DisableUserOutcome> {
  try {
    await ensureManageUsersPermission(actor, "USER_DISABLE_DENIED", { userId });
  } catch (error) {
    if (error instanceof PermissionDeniedError) return { ok: false, status: error.status, error: error.message };
    throw error;
  }

  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target) {
    return { ok: false, status: 404, error: "Utilisateur introuvable." };
  }
  if (target.disabledAt) {
    return { ok: false, status: 400, error: "Cet utilisateur est déjà désactivé." };
  }

  if (target.role === "ADMIN") {
    const activeAdminCount = await prisma.user.count({ where: { role: "ADMIN", disabledAt: null } });
    if (activeAdminCount <= 1) {
      return { ok: false, status: 400, error: "Impossible de désactiver le dernier administrateur actif." };
    }
  }

  await prisma.user.update({ where: { id: userId }, data: { disabledAt: new Date() } });

  await prisma.auditLog.create({
    data: { actorId: actor!.id, action: "USER_DISABLED", details: { userId } },
  });

  return { ok: true };
}
