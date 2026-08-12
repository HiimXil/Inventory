import { prisma } from "@/lib/db/client";

const DEFAULT_RETENTION_MONTHS = 24;

/**
 * Configurable via RGPD_RETENTION_MONTHS (FR-025) — never hard-coded past
 * this single default. An invalid/missing value falls back silently to the
 * 24-month contractual default rather than failing the purge run.
 */
export function resolveRetentionMonths(): number {
  const raw = process.env.RGPD_RETENTION_MONTHS;
  if (!raw) return DEFAULT_RETENTION_MONTHS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_RETENTION_MONTHS;
  return parsed;
}

function monthsBefore(date: Date, months: number): Date {
  const result = new Date(date);
  result.setMonth(result.getMonth() - months);
  return result;
}

export type PurgeOptions = {
  /** Override "now" for deterministic tests; defaults to the real clock. */
  now?: Date;
  /** Override the retention window in months; defaults to resolveRetentionMonths(). */
  retentionMonths?: number;
};

export type PurgeResult = {
  retentionMonths: number;
  cutoffDate: Date;
  sessionsPurged: number;
  linesPurged: number;
  auditLogsPurged: number;
};

/**
 * FR-025: RGPD purge. Two independent rules, run in the same transaction:
 *
 * 1. InventorySession rows whose status is CLOSED or CANCELLED (PREPARED/
 *    SYNCED sessions — "active" — are never eligible, regardless of age)
 *    AND whose closedAt (falling back to updatedAt when null, e.g. for a
 *    CANCELLED session that has no closedAt) is older than the retention
 *    window get deleted along with their InventoryLine rows.
 * 2. AuditLog rows older than the same window get deleted, independently of
 *    whether their session was just purged in step 1 — AuditLog.sessionId
 *    is ON DELETE SET NULL (see prisma/schema.prisma), so a log entry that
 *    is itself still within retention survives a purged session with its
 *    sessionId simply nulled out, exactly matching "AuditLog older than 24
 *    months" as a standalone criterion rather than "cascade with its session".
 */
export async function purgeExpiredData(options: PurgeOptions = {}): Promise<PurgeResult> {
  const retentionMonths = options.retentionMonths ?? resolveRetentionMonths();
  const now = options.now ?? new Date();
  const cutoffDate = monthsBefore(now, retentionMonths);

  const result = await prisma.$transaction(async (tx) => {
    const eligibleSessions = await tx.inventorySession.findMany({
      where: {
        status: { in: ["CLOSED", "CANCELLED"] },
        OR: [{ closedAt: { lt: cutoffDate } }, { closedAt: null, updatedAt: { lt: cutoffDate } }],
      },
      select: { id: true },
    });
    const sessionIds = eligibleSessions.map((s) => s.id);

    const linesPurged = sessionIds.length
      ? (await tx.inventoryLine.deleteMany({ where: { sessionId: { in: sessionIds } } })).count
      : 0;

    const sessionsPurged = sessionIds.length
      ? (await tx.inventorySession.deleteMany({ where: { id: { in: sessionIds } } })).count
      : 0;

    const { count: auditLogsPurged } = await tx.auditLog.deleteMany({
      where: { createdAt: { lt: cutoffDate } },
    });

    return { sessionsPurged, linesPurged, auditLogsPurged };
  });

  return { retentionMonths, cutoffDate, ...result };
}
