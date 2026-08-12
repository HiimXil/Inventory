import { z } from "zod";
import type { InventoryLine, InventorySession } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { requirePermission } from "@/lib/auth/guards";
import { isActiveUser, SESSION_EXPIRED_MESSAGE } from "@/lib/auth/verify-active-user";
import type { UserRole } from "@/lib/auth/roles";
import { APP_VERSION } from "@/lib/version";

export const syncLineSchema = z.object({
  articleRef: z.string().min(1),
  countedQty: z.number().int().min(0),
  isOffReferential: z.boolean(),
});

export const syncSessionSchema = z.object({
  clientUpdatedAt: z.string().datetime(),
  lines: z.array(syncLineSchema),
});

export type SyncSessionPayload = z.infer<typeof syncSessionSchema>;

export type SyncSessionActor = { id: string; role: UserRole } | null;

export type SyncSessionOutcome =
  | { ok: true; applied: boolean; session: InventorySession; lines: InventoryLine[]; appVersion: string }
  | { ok: false; status: 400 | 401 | 403 | 404; error: string };

/**
 * Core POST /sync flow (FR-007, FR-008, FR-028, FR-030). Kept separate from
 * the route handler so RBAC/LWW/idempotency are directly unit-testable, the
 * same split used by lib/sessions/prepare-session.ts.
 */
export async function runSyncSession(
  sessionId: string,
  actor: SyncSessionActor,
  rawPayload: unknown,
): Promise<SyncSessionOutcome> {
  const sessionRecord = await prisma.inventorySession.findUnique({ where: { id: sessionId } });
  if (!sessionRecord) {
    return { ok: false, status: 404, error: "Session introuvable." };
  }

  // RBAC guard, server-side, before touching the payload (FR-028).
  try {
    requirePermission(actor?.role, "SYNC");
  } catch {
    await prisma.auditLog.create({
      data: {
        actorId: actor?.id ?? null,
        action: "SYNC_DENIED",
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
  // actorId FK constraint. Status 401 deliberately matches the
  // unauthenticated case above: the client's existing "needs-reauth" retry
  // UI (lib/offline/sync.ts) already handles 401 without any further
  // client-side change.
  if (!(await isActiveUser(actor!.id))) {
    await prisma.auditLog.create({
      data: {
        actorId: null,
        action: "SYNC_DENIED",
        details: { sessionId, attemptedRole: actor!.role, reason: "stale-or-disabled-user", attemptedUserId: actor!.id },
        sessionId,
      },
    });
    return { ok: false, status: 401, error: SESSION_EXPIRED_MESSAGE };
  }

  // A closed session is read-only (FR-031): no further mutation, sync
  // included, is ever applied to it again.
  if (sessionRecord.status === "CLOSED") {
    return { ok: false, status: 400, error: "Cette session est clôturée et ne peut plus être synchronisée." };
  }

  const parsed = syncSessionSchema.safeParse(rawPayload);
  if (!parsed.success) {
    return { ok: false, status: 400, error: "Payload de synchronisation invalide." };
  }

  const clientUpdatedAt = new Date(parsed.data.clientUpdatedAt);

  // Last-write-wins (FR-008, FR-030): apply only if the client's snapshot is
  // strictly newer than the server's last recorded sync. A stale/replayed
  // payload is a no-op — it never re-runs the upsert below — which combined
  // with the absolute-value upsert (not a relative increment) is what makes
  // an exact replay idempotent regardless of which branch handles it.
  const isStale = sessionRecord.syncedAt !== null && clientUpdatedAt <= sessionRecord.syncedAt;
  if (isStale) {
    const lines = await prisma.inventoryLine.findMany({
      where: { sessionId },
      orderBy: { articleRef: "asc" },
    });
    return { ok: true, applied: false, session: sessionRecord, lines, appVersion: APP_VERSION };
  }

  const syncedAt = new Date();
  const result = await prisma.$transaction(async (tx) => {
    for (const line of parsed.data.lines) {
      await tx.inventoryLine.upsert({
        where: { sessionId_articleRef: { sessionId, articleRef: line.articleRef } },
        update: { countedQty: line.countedQty, isOffReferential: line.isOffReferential },
        create: {
          sessionId,
          articleRef: line.articleRef,
          designation: null,
          theoreticalQty: 0,
          countedQty: line.countedQty,
          isOffReferential: line.isOffReferential,
        },
      });
    }

    const updatedSession = await tx.inventorySession.update({
      where: { id: sessionId },
      data: { status: "SYNCED", syncedAt },
    });

    await tx.auditLog.create({
      data: {
        actorId: actor!.id,
        action: "SESSION_SYNCED",
        details: { lineCount: parsed.data.lines.length, clientUpdatedAt: parsed.data.clientUpdatedAt },
        sessionId,
      },
    });

    const lines = await tx.inventoryLine.findMany({
      where: { sessionId },
      orderBy: { articleRef: "asc" },
    });

    return { session: updatedSession, lines };
  });

  return { ok: true, applied: true, session: result.session, lines: result.lines, appVersion: APP_VERSION };
}
