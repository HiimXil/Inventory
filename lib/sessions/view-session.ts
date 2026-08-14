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

  // FR-027/US7: LOGISTICS is scoped to the session assigned to them;
  // ADMIN/DEPOT_MANAGER/DIRECTION see every session (already guaranteed by
  // VIEW_RESULTS above). A session with no assignee at all (assignedToId
  // null — created before this field existed) never matches, so it stays
  // invisible to every LOGISTICS user until explicitly assigned; that's the
  // documented backward-compat behavior, not a bug.
  if (actor!.role === "LOGISTICS") {
    try {
      assertOwnsSession(actor!.role, session.assignedToId ?? "", actor!.id);
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
