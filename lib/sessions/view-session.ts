import type { Depot, InventorySession } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { requirePermission, assertOwnsSession } from "@/lib/auth/guards";
import type { UserRole } from "@/lib/auth/roles";

export type ViewSessionActor = { id: string; role: UserRole } | null;

export type SessionWithDepot = InventorySession & { depot: Depot };

export type ViewSessionOutcome =
  | { ok: true; session: SessionWithDepot }
  | { ok: false; reason: "not-found" | "unauthenticated" | "forbidden" };

/**
 * LOGISTICS never prepares a session (PREPARE excludes that role), so
 * InventorySession.preparedById can never name a LOGISTICS user — it can't
 * be used as "their" session. The one per-user link the schema does record
 * for a role that can only count+sync is the actor on that session's
 * SESSION_SYNCED audit entry, so that's what "sa session" resolves to here.
 */
export async function resolveLogisticsOwnerId(sessionId: string): Promise<string | null> {
  const syncLog = await prisma.auditLog.findFirst({
    where: { sessionId, action: "SESSION_SYNCED" },
    orderBy: { createdAt: "desc" },
    select: { actorId: true },
  });
  return syncLog?.actorId ?? null;
}

/**
 * Server-side guard for /sessions/[id] (RUNBOOK correctif — this route had
 * no guard at all, unlike GET /bootstrap). Mirrors bootstrap's check order
 * (session existence, then auth, then RBAC) and its "journalize every
 * denial" behavior, kept in a plain function so the page's redirect/notFound
 * calls stay in the Server Component while this stays unit-testable.
 */
export async function loadSessionForView(
  sessionId: string,
  actor: ViewSessionActor,
): Promise<ViewSessionOutcome> {
  const session = await prisma.inventorySession.findUnique({
    where: { id: sessionId },
    include: { depot: true },
  });
  if (!session) {
    return { ok: false, reason: "not-found" };
  }

  try {
    requirePermission(actor?.role, "VIEW_RESULTS");
  } catch {
    await prisma.auditLog.create({
      data: {
        actorId: actor?.id ?? null,
        action: "SESSION_VIEW_DENIED",
        details: { sessionId, attemptedRole: actor?.role ?? null },
        sessionId,
      },
    });
    return { ok: false, reason: actor ? "forbidden" : "unauthenticated" };
  }

  // FR-027: LOGISTICS is scoped to their own session; ADMIN/DEPOT_MANAGER/
  // DIRECTION see every session (already guaranteed by VIEW_RESULTS above).
  if (actor!.role === "LOGISTICS") {
    const ownerId = await resolveLogisticsOwnerId(sessionId);
    try {
      assertOwnsSession(actor!.role, ownerId ?? "", actor!.id);
    } catch {
      await prisma.auditLog.create({
        data: {
          actorId: actor!.id,
          action: "SESSION_VIEW_DENIED",
          details: { sessionId, attemptedRole: actor!.role, reason: "not-own-session" },
          sessionId,
        },
      });
      return { ok: false, reason: "forbidden" };
    }
  }

  return { ok: true, session };
}
