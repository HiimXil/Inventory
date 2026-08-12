import { prisma } from "@/lib/db/client";
import { requirePermission } from "@/lib/auth/guards";
import { isActiveUser, SESSION_EXPIRED_MESSAGE } from "@/lib/auth/verify-active-user";
import type { UserRole } from "@/lib/auth/roles";
import type { InventorySession } from "@prisma/client";

export type CloseSessionActor = { id: string; role: UserRole } | null;

export type CloseSessionOutcome =
  | { ok: true; session: InventorySession }
  | { ok: false; status: 400 | 401 | 403 | 404; error: string };

/**
 * Core closureSession flow (FR-009, FR-031). A session can only be closed
 * once it has been synchronized — closing is the point after which no
 * further mutation (recount, resync) should ever touch it again, so the
 * gate below is deliberately strict (SYNCED only, not "SYNCED or later").
 */
export async function runCloseSession(
  sessionId: string,
  actor: CloseSessionActor,
): Promise<CloseSessionOutcome> {
  const sessionRecord = await prisma.inventorySession.findUnique({ where: { id: sessionId } });
  if (!sessionRecord) {
    return { ok: false, status: 404, error: "Session introuvable." };
  }

  try {
    requirePermission(actor?.role, "CLOSE");
  } catch {
    await prisma.auditLog.create({
      data: {
        actorId: actor?.id ?? null,
        action: "SESSION_CLOSE_DENIED",
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

  // A JWT session cookie decodes fine even after the user it points to was
  // deleted (DB reset) or disabled (admin action) — requirePermission above
  // only checks the JWT-embedded role, so a stale actor still passes it.
  // Caught here, before the transaction that would otherwise hit the
  // actorId FK constraint.
  if (!(await isActiveUser(actor!.id))) {
    await prisma.auditLog.create({
      data: {
        actorId: null,
        action: "SESSION_CLOSE_DENIED",
        details: { sessionId, attemptedRole: actor!.role, reason: "stale-or-disabled-user", attemptedUserId: actor!.id },
        sessionId,
      },
    });
    return { ok: false, status: 401, error: SESSION_EXPIRED_MESSAGE };
  }

  if (sessionRecord.status !== "SYNCED") {
    return {
      ok: false,
      status: 400,
      error: `La session doit être synchronisée avant clôture (statut actuel : ${sessionRecord.status}).`,
    };
  }

  const closedAt = new Date();
  const session = await prisma.$transaction(async (tx) => {
    const updated = await tx.inventorySession.update({
      where: { id: sessionId },
      data: { status: "CLOSED", closedAt },
    });

    await tx.auditLog.create({
      data: {
        actorId: actor!.id,
        action: "SESSION_CLOSED",
        details: {},
        sessionId,
      },
    });

    return updated;
  });

  return { ok: true, session };
}
