import { prisma } from "@/lib/db/client";

/**
 * Best-effort "does this LOGISTICS user have a session still open" check for
 * the post-login redirect (FR-026 navigation pass §4). Reuses the same
 * signal as resolveLogisticsOwnerId (lib/sessions/view-session.ts) — the
 * actor on a session's latest SESSION_SYNCED audit entry — since that's the
 * only server-visible link between a LOGISTICS user and a session at all
 * (they can't prepare one, and bootstrap doesn't log on success). This can
 * only ever find a session they've synced at least once; a session that's
 * still PREPARED and never synced exists solely in that device's
 * IndexedDB, which the server has no way to see — that case is handled
 * client-side by ResumeSessionsBanner instead.
 */
export async function findActiveSyncedSessionForLogistics(userId: string): Promise<string | null> {
  const syncLog = await prisma.auditLog.findFirst({
    where: { action: "SESSION_SYNCED", actorId: userId },
    orderBy: { createdAt: "desc" },
    select: { sessionId: true },
  });
  if (!syncLog?.sessionId) return null;

  const session = await prisma.inventorySession.findUnique({
    where: { id: syncLog.sessionId },
    select: { id: true, status: true },
  });
  if (!session || session.status !== "SYNCED") return null;

  return session.id;
}
