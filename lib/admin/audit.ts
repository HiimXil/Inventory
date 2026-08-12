import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { requirePermission } from "@/lib/auth/guards";
import type { UserRole } from "@/lib/auth/roles";

export type AuditActor = { id: string; role: UserRole } | null;

export type AuditEntry = {
  id: string;
  createdAt: Date;
  action: string;
  sessionId: string | null;
  details: unknown;
  actorId: string | null;
  actorEmail: string | null;
};

export type AuditFilters = {
  actorId?: string;
  action?: string;
  from?: Date;
  to?: Date;
};

export type AuditActorOption = { id: string; email: string };

export type ListAuditLogOutcome =
  | {
      ok: true;
      entries: AuditEntry[];
      total: number;
      page: number;
      pageSize: number;
      actorOptions: AuditActorOption[];
      actionOptions: string[];
    }
  | { ok: false; status: 401 | 403; error: string };

const PAGE_SIZE = 50;

/**
 * Read-only audit viewer (FR-011, VIEW_AUDIT = ADMIN only, FR-027). This
 * module intentionally exposes NO update/delete function of any kind — see
 * the FR-032 append-only note below and the comment on the AuditLog model
 * in prisma/schema.prisma.
 */
export async function listAuditLog(
  actor: AuditActor,
  filters: AuditFilters = {},
  page = 1,
): Promise<ListAuditLogOutcome> {
  try {
    requirePermission(actor?.role, "VIEW_AUDIT");
  } catch {
    await prisma.auditLog.create({
      data: {
        actorId: actor?.id ?? null,
        action: "AUDIT_VIEW_DENIED",
        details: { attemptedRole: actor?.role ?? null },
      },
    });
    return {
      ok: false,
      status: actor ? 403 : 401,
      error: actor ? "Accès refusé." : "Authentification requise.",
    };
  }

  const where: Prisma.AuditLogWhereInput = {};
  if (filters.actorId) where.actorId = filters.actorId;
  if (filters.action) where.action = filters.action;
  if (filters.from || filters.to) {
    where.createdAt = {
      ...(filters.from ? { gte: filters.from } : {}),
      ...(filters.to ? { lte: filters.to } : {}),
    };
  }

  const safePage = Math.max(1, page);

  const [rows, total, actorRows, actionRows] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (safePage - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { actor: { select: { email: true } } },
    }),
    prisma.auditLog.count({ where }),
    prisma.user.findMany({ orderBy: { email: "asc" }, select: { id: true, email: true } }),
    prisma.auditLog.findMany({
      distinct: ["action"],
      select: { action: true },
      orderBy: { action: "asc" },
    }),
  ]);

  return {
    ok: true,
    entries: rows.map((row) => ({
      id: row.id,
      createdAt: row.createdAt,
      action: row.action,
      sessionId: row.sessionId,
      details: row.details,
      actorId: row.actorId,
      actorEmail: row.actor?.email ?? null,
    })),
    total,
    page: safePage,
    pageSize: PAGE_SIZE,
    actorOptions: actorRows,
    actionOptions: actionRows.map((row) => row.action),
  };
}
