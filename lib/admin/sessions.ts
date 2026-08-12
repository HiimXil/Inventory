import { prisma } from "@/lib/db/client";
import { requirePermission } from "@/lib/auth/guards";
import type { UserRole } from "@/lib/auth/roles";
import type { SessionStatus } from "@prisma/client";

export type AdminSessionsActor = { id: string; role: UserRole } | null;

export type ManageableSession = {
  id: string;
  status: SessionStatus;
  depotCode: string;
  depotName: string;
  createdAt: Date;
};

export type ListSessionsOutcome =
  | { ok: true; sessions: ManageableSession[] }
  | { ok: false; status: 401 | 403; error: string };

/**
 * Read side of the admin session-cancellation screen. Gated on
 * CANCEL_SESSION (ADMIN only) since it exists purely to feed that action —
 * see lib/sessions/cancel-session.ts for the mutation itself.
 */
export async function listSessionsForAdmin(actor: AdminSessionsActor): Promise<ListSessionsOutcome> {
  try {
    requirePermission(actor?.role, "CANCEL_SESSION");
  } catch {
    await prisma.auditLog.create({
      data: {
        actorId: actor?.id ?? null,
        action: "ADMIN_SESSIONS_LIST_DENIED",
        details: { attemptedRole: actor?.role ?? null },
      },
    });
    return {
      ok: false,
      status: actor ? 403 : 401,
      error: actor ? "Accès refusé." : "Authentification requise.",
    };
  }

  const sessions = await prisma.inventorySession.findMany({
    orderBy: { createdAt: "desc" },
    include: { depot: true },
  });

  return {
    ok: true,
    sessions: sessions.map((session) => ({
      id: session.id,
      status: session.status,
      depotCode: session.depot.code,
      depotName: session.depot.name,
      createdAt: session.createdAt,
    })),
  };
}
