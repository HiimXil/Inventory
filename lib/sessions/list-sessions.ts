import type { Depot, InventorySession, SessionStatus } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { requirePermission } from "@/lib/auth/guards";
import type { UserRole } from "@/lib/auth/roles";
import { buildDiscrepancyLines, summarizeDiscrepancies } from "@/lib/offline/discrepancy";

export type ListSessionsActor = { id: string; role: UserRole } | null;

export type SessionListItem = {
  id: string;
  status: SessionStatus;
  depotCode: string;
  depotName: string;
  createdAt: Date;
  syncedAt: Date | null;
  closedAt: Date | null;
  /** Only computed for SYNCED/CLOSED sessions — null otherwise (nothing to compare yet). */
  ecartCount: number | null;
  totalLines: number | null;
};

export type ListSessionsOutcome =
  | { ok: true; sessions: SessionListItem[] }
  | { ok: false; reason: "unauthenticated" | "forbidden" };

const RESULTS_STATUSES: SessionStatus[] = ["SYNCED", "CLOSED"];
const ACTIVE_STATUS_WEIGHT: Partial<Record<SessionStatus, number>> = { SYNCED: 0, PREPARED: 1 };

/**
 * Read side of /sessions (liste). Mirrors loadSessionForView's RBAC gate and
 * LOGISTICS-ownership scoping (FR-027/US7) — same VIEW_RESULTS permission,
 * same "own" rule (assignedToId === actor.id), no new permission concept
 * introduced. Scoped directly in the query rather than fetched-then-filtered
 * (assignedToId lives on InventorySession itself, no separate lookup needed
 * now that attribution replaces the old audit-log-derived ownership).
 */
export async function listSessionsForUser(actor: ListSessionsActor): Promise<ListSessionsOutcome> {
  try {
    requirePermission(actor?.role, "VIEW_RESULTS");
  } catch {
    await prisma.auditLog.create({
      data: {
        actorId: actor?.id ?? null,
        action: "SESSIONS_LIST_DENIED",
        details: { attemptedRole: actor?.role ?? null },
      },
    });
    return { ok: false, reason: actor ? "forbidden" : "unauthenticated" };
  }

  const sessions = await prisma.inventorySession.findMany({
    where: actor!.role === "LOGISTICS" ? { assignedToId: actor!.id } : undefined,
    orderBy: { createdAt: "desc" },
    include: { depot: true },
  });

  const items = await Promise.all(sessions.map(toListItem));

  return { ok: true, sessions: sortForList(items) };
}

async function toListItem(session: InventorySession & { depot: Depot }): Promise<SessionListItem> {
  let ecartCount: number | null = null;
  let totalLines: number | null = null;

  if (RESULTS_STATUSES.includes(session.status)) {
    const lines = await prisma.inventoryLine.findMany({ where: { sessionId: session.id } });
    const summary = summarizeDiscrepancies(
      buildDiscrepancyLines(
        lines.map((line) => ({
          articleRef: line.articleRef,
          designation: line.designation,
          theoreticalQty: line.theoreticalQty,
          countedQty: line.countedQty,
          isOffReferential: line.isOffReferential,
        })),
      ),
    );
    ecartCount = summary.ecartCount;
    totalLines = summary.totalLines;
  }

  return {
    id: session.id,
    status: session.status,
    depotCode: session.depot.code,
    depotName: session.depot.name,
    createdAt: session.createdAt,
    syncedAt: session.syncedAt,
    closedAt: session.closedAt,
    ecartCount,
    totalLines,
  };
}

/**
 * "En cours" first (SYNCED ahead of PREPARED — a synced session is what a
 * responsable actually needs to review/close), then recency within each
 * group — so what needs attention today surfaces before the archive.
 */
function sortForList(items: SessionListItem[]): SessionListItem[] {
  return [...items].sort((a, b) => {
    const aActive = a.status in ACTIVE_STATUS_WEIGHT;
    const bActive = b.status in ACTIVE_STATUS_WEIGHT;
    if (aActive !== bActive) return aActive ? -1 : 1;
    if (aActive && bActive) {
      const weightDiff = ACTIVE_STATUS_WEIGHT[a.status]! - ACTIVE_STATUS_WEIGHT[b.status]!;
      if (weightDiff !== 0) return weightDiff;
    }
    return b.createdAt.getTime() - a.createdAt.getTime();
  });
}
