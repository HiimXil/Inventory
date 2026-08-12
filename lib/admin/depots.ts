import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { requirePermission } from "@/lib/auth/guards";
import type { UserRole } from "@/lib/auth/roles";

export type AdminActor = { id: string; role: UserRole } | null;

export type AdminDepot = {
  id: string;
  code: string;
  name: string;
  disabledAt: Date | null;
};

const DEPOT_SELECT = { id: true, code: true, name: true, disabledAt: true } as const;

class PermissionDeniedError extends Error {
  constructor(
    public readonly status: 401 | 403,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Every depot-management action shares the same guard (MANAGE_DEPOTS = ADMIN
 * only) and the same "journalize every denial" behavior — mirrors
 * ensureManageUsersPermission in lib/admin/users.ts.
 */
async function ensureManageDepotsPermission(
  actor: AdminActor,
  deniedAction: string,
  details: Record<string, unknown> = {},
): Promise<void> {
  try {
    requirePermission(actor?.role, "MANAGE_DEPOTS");
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

export type ListDepotsOutcome =
  | { ok: true; depots: AdminDepot[] }
  | { ok: false; status: 401 | 403; error: string };

export async function listDepots(actor: AdminActor): Promise<ListDepotsOutcome> {
  try {
    await ensureManageDepotsPermission(actor, "DEPOTS_LIST_DENIED");
  } catch (error) {
    if (error instanceof PermissionDeniedError) return { ok: false, status: error.status, error: error.message };
    throw error;
  }

  const depots = await prisma.depot.findMany({ orderBy: { code: "asc" }, select: DEPOT_SELECT });
  return { ok: true, depots };
}

export const createDepotSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
});

export type CreateDepotOutcome =
  | { ok: true; depotId: string }
  | { ok: false; status: 400 | 401 | 403; error: string };

/**
 * Depot codes come from ARTIS (0101, 01V9, ...) — no format validation
 * beyond non-empty, but uniqueness is strict (checked here rather than
 * relying on the DB constraint error so the message stays actionable).
 */
export async function createDepot(actor: AdminActor, rawInput: unknown): Promise<CreateDepotOutcome> {
  try {
    await ensureManageDepotsPermission(actor, "DEPOT_CREATE_DENIED");
  } catch (error) {
    if (error instanceof PermissionDeniedError) return { ok: false, status: error.status, error: error.message };
    throw error;
  }

  const parsed = createDepotSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, status: 400, error: "Code et libellé du dépôt sont requis." };
  }

  const existing = await prisma.depot.findUnique({ where: { code: parsed.data.code } });
  if (existing) {
    return { ok: false, status: 400, error: "Un dépôt avec ce code existe déjà." };
  }

  const depot = await prisma.depot.create({
    data: { code: parsed.data.code, name: parsed.data.name },
  });

  await prisma.auditLog.create({
    data: {
      actorId: actor!.id,
      action: "DEPOT_CREATED",
      details: { depotId: depot.id, code: depot.code, name: depot.name },
    },
  });

  return { ok: true, depotId: depot.id };
}

export const updateDepotSchema = z.object({
  name: z.string().min(1),
});

export type UpdateDepotOutcome =
  | { ok: true }
  | { ok: false; status: 400 | 401 | 403 | 404; error: string };

/**
 * Only the libellé is editable — the code is the ARTIS identifier and must
 * stay stable once sessions reference the depot by it.
 */
export async function updateDepot(
  actor: AdminActor,
  depotId: string,
  rawInput: unknown,
): Promise<UpdateDepotOutcome> {
  try {
    await ensureManageDepotsPermission(actor, "DEPOT_UPDATE_DENIED", { depotId });
  } catch (error) {
    if (error instanceof PermissionDeniedError) return { ok: false, status: error.status, error: error.message };
    throw error;
  }

  const parsed = updateDepotSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, status: 400, error: "Le libellé du dépôt est requis." };
  }

  const target = await prisma.depot.findUnique({ where: { id: depotId } });
  if (!target) {
    return { ok: false, status: 404, error: "Dépôt introuvable." };
  }

  await prisma.depot.update({ where: { id: depotId }, data: { name: parsed.data.name } });

  await prisma.auditLog.create({
    data: {
      actorId: actor!.id,
      action: "DEPOT_UPDATED",
      details: { depotId, name: parsed.data.name },
    },
  });

  return { ok: true };
}

export type ToggleDepotOutcome =
  | { ok: true }
  | { ok: false; status: 400 | 401 | 403 | 404; error: string };

/**
 * Soft-disable only, same idiom as disableUser (lib/admin/users.ts): a depot
 * with historical sessions can never be deleted without erasing that
 * history, so deactivation just hides it from new session preparation
 * (see prepare/page.tsx and runPrepareSession) without touching the past.
 */
export async function deactivateDepot(actor: AdminActor, depotId: string): Promise<ToggleDepotOutcome> {
  try {
    await ensureManageDepotsPermission(actor, "DEPOT_DEACTIVATE_DENIED", { depotId });
  } catch (error) {
    if (error instanceof PermissionDeniedError) return { ok: false, status: error.status, error: error.message };
    throw error;
  }

  const target = await prisma.depot.findUnique({ where: { id: depotId } });
  if (!target) {
    return { ok: false, status: 404, error: "Dépôt introuvable." };
  }
  if (target.disabledAt) {
    return { ok: false, status: 400, error: "Ce dépôt est déjà désactivé." };
  }

  await prisma.depot.update({ where: { id: depotId }, data: { disabledAt: new Date() } });

  await prisma.auditLog.create({
    data: { actorId: actor!.id, action: "DEPOT_DEACTIVATED", details: { depotId, code: target.code } },
  });

  return { ok: true };
}

export async function activateDepot(actor: AdminActor, depotId: string): Promise<ToggleDepotOutcome> {
  try {
    await ensureManageDepotsPermission(actor, "DEPOT_ACTIVATE_DENIED", { depotId });
  } catch (error) {
    if (error instanceof PermissionDeniedError) return { ok: false, status: error.status, error: error.message };
    throw error;
  }

  const target = await prisma.depot.findUnique({ where: { id: depotId } });
  if (!target) {
    return { ok: false, status: 404, error: "Dépôt introuvable." };
  }
  if (!target.disabledAt) {
    return { ok: false, status: 400, error: "Ce dépôt est déjà actif." };
  }

  await prisma.depot.update({ where: { id: depotId }, data: { disabledAt: null } });

  await prisma.auditLog.create({
    data: { actorId: actor!.id, action: "DEPOT_ACTIVATED", details: { depotId, code: target.code } },
  });

  return { ok: true };
}
