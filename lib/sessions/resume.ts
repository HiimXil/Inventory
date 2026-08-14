import { prisma } from "@/lib/db/client";

/**
 * Best-effort "does this LOGISTICS user have a session still open" check for
 * the post-login redirect (FR-026 navigation pass §4). US7: now resolved
 * from attribution (InventorySession.assignedToId) rather than the actor on
 * a SESSION_SYNCED audit entry — the old signal required having synced at
 * least once; assignment is known to the server from the moment the session
 * is prepared, before the assignee has ever opened it. Deliberately still
 * scoped to status SYNCED only, matching the old function's exact
 * behavior — a PREPARED-and-never-opened session isn't "resume", that's
 * just "start"; this redirect is specifically for jumping back into
 * something already underway. Picks the most recently updated match if
 * more than one SYNCED session happens to be assigned to the same user.
 */
export async function findActiveSyncedSessionForLogistics(userId: string): Promise<string | null> {
  const session = await prisma.inventorySession.findFirst({
    where: { assignedToId: userId, status: "SYNCED" },
    orderBy: { updatedAt: "desc" },
    select: { id: true },
  });
  return session?.id ?? null;
}
