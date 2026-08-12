import "dotenv/config";
import { prisma } from "../lib/db/client";
import { purgeExpiredData } from "../lib/rgpd/purge";

/**
 * Entry point for `npm run purge:rgpd` (FR-025). Meant to be invoked once a
 * day by the hosting provider's cron/scheduler — see the deployment
 * checklist in specs/001-module-inventaire-sqp-impression-uv/quickstart.md.
 */
async function main() {
  const startedAt = new Date();
  try {
    const result = await purgeExpiredData();
    const durationMs = Date.now() - startedAt.getTime();
    console.log(
      `[purge:rgpd] OK retentionMonths=${result.retentionMonths} cutoff=${result.cutoffDate.toISOString()} ` +
        `sessionsPurged=${result.sessionsPurged} linesPurged=${result.linesPurged} ` +
        `auditLogsPurged=${result.auditLogsPurged} durationMs=${durationMs}`,
    );
  } catch (error) {
    console.error("[purge:rgpd] FAILED:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main();
