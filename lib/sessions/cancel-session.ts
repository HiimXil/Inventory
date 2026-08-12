import { prisma } from "@/lib/db/client";
import { requirePermission } from "@/lib/auth/guards";
import type { UserRole } from "@/lib/auth/roles";
import type { InventorySession } from "@prisma/client";

export type CancelSessionActor = { id: string; role: UserRole } | null;

export type CancelSessionOutcome =
  | { ok: true; session: InventorySession }
  | { ok: false; status: 400 | 401 | 403 | 404; error: string };

/**
 * Core cancelSession flow (FR-017). CLOSED is the one terminal state this
 * can never touch — a closed session is read-only (see the matching guard
 * added to lib/sessions/sync-session.ts for the same invariant on sync).
 */
export async function runCancelSession(
  sessionId: string,
  actor: CancelSessionActor,
): Promise<CancelSessionOutcome> {
  const sessionRecord = await prisma.inventorySession.findUnique({ where: { id: sessionId } });
  if (!sessionRecord) {
    return { ok: false, status: 404, error: "Session introuvable." };
  }

  try {
    requirePermission(actor?.role, "CANCEL_SESSION");
  } catch {
    await prisma.auditLog.create({
      data: {
        actorId: actor?.id ?? null,
        action: "SESSION_CANCEL_DENIED",
        details: { sessionId, attemptedRole: actor?.role ?? null },
        sessionId,
      },
    });
    return {
      ok: false,
      status: actor ? 403 : 401,
      error: actor ? "Accès refusé." : "Authentification requise.",
    };
  }

  if (sessionRecord.status === "CLOSED") {
    return { ok: false, status: 400, error: "Une session clôturée ne peut pas être annulée." };
  }
  if (sessionRecord.status === "CANCELLED") {
    return { ok: false, status: 400, error: "Cette session est déjà annulée." };
  }

  const session = await prisma.$transaction(async (tx) => {
    const updated = await tx.inventorySession.update({
      where: { id: sessionId },
      data: { status: "CANCELLED", cancelledAt: new Date() },
    });

    await tx.auditLog.create({
      data: {
        actorId: actor!.id,
        action: "SESSION_CANCELLED",
        details: { previousStatus: sessionRecord.status },
        sessionId,
      },
    });

    return updated;
  });

  return { ok: true, session };
}
