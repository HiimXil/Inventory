import { prisma } from "@/lib/db/client";
import { requirePermission } from "@/lib/auth/guards";
import type { UserRole } from "@/lib/auth/roles";
import { buildInventoryWorkbook, buildExportFilename } from "@/lib/export/excel";

export type ExportSessionActor = { id: string; role: UserRole } | null;

const EXPORTABLE_STATUSES = ["SYNCED", "CLOSED"];

export type ExportSessionOutcome =
  | { ok: true; filename: string; buffer: ArrayBuffer }
  | { ok: false; status: 400 | 401 | 403 | 404; error: string };

/**
 * Core export flow (FR-009, FR-006). Kept separate from the route handler
 * so RBAC/status-gating/workbook content are directly unit-testable, the
 * same split used by sync-session.ts and close-session.ts.
 */
export async function runExportSession(
  sessionId: string,
  actor: ExportSessionActor,
): Promise<ExportSessionOutcome> {
  const sessionRecord = await prisma.inventorySession.findUnique({
    where: { id: sessionId },
    include: { depot: true },
  });
  if (!sessionRecord) {
    return { ok: false, status: 404, error: "Session introuvable." };
  }

  try {
    requirePermission(actor?.role, "EXPORT");
  } catch {
    await prisma.auditLog.create({
      data: {
        actorId: actor?.id ?? null,
        action: "SESSION_EXPORT_DENIED",
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

  if (!EXPORTABLE_STATUSES.includes(sessionRecord.status)) {
    return {
      ok: false,
      status: 400,
      error: `L'export nécessite une session synchronisée ou clôturée (statut actuel : ${sessionRecord.status}).`,
    };
  }

  const lines = await prisma.inventoryLine.findMany({
    where: { sessionId },
    orderBy: { articleRef: "asc" },
  });

  const workbook = buildInventoryWorkbook(sessionRecord.depot.code, lines);
  const buffer = await workbook.xlsx.writeBuffer();
  const filename = buildExportFilename(sessionRecord.depot.code);

  return { ok: true, filename, buffer };
}
