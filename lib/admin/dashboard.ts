import { prisma } from "@/lib/db/client";
import { requirePermission } from "@/lib/auth/guards";
import type { UserRole } from "@/lib/auth/roles";

export type DashboardActor = { id: string; role: UserRole } | null;

export type DashboardAccessOutcome =
  | { ok: true }
  | { ok: false; reason: "unauthenticated" | "forbidden" };

/**
 * Entry-point guard for /admin. MANAGE_USERS/CANCEL_SESSION/VIEW_AUDIT all
 * resolve to the exact same role set (ADMIN only) — this just picks one as
 * the representative check for the dashboard hub itself; each sub-page
 * (users/sessions/audit) still re-checks its own specific permission.
 */
export async function assertAdminDashboardAccess(actor: DashboardActor): Promise<DashboardAccessOutcome> {
  try {
    requirePermission(actor?.role, "MANAGE_USERS");
  } catch {
    await prisma.auditLog.create({
      data: {
        actorId: actor?.id ?? null,
        action: "ADMIN_DASHBOARD_DENIED",
        details: { attemptedRole: actor?.role ?? null },
      },
    });
    return { ok: false, reason: actor ? "forbidden" : "unauthenticated" };
  }

  return { ok: true };
}
