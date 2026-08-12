import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";

/**
 * `prisma/seed.ts` is destructive (deleteMany on everything, then
 * recreate) — fine for local dev where you run it deliberately, but the
 * container entrypoint calls this on every restart, and re-seeding a
 * populated production database would wipe real inventory data. This is
 * the guard: only seed if the User table is genuinely empty (first boot
 * against a fresh database).
 */
async function main() {
  const prisma = new PrismaClient();
  try {
    const userCount = await prisma.user.count();
    if (userCount > 0) {
      console.log(`[seed-if-empty] ${userCount} user(s) already present — skipping seed.`);
      return;
    }
    console.log("[seed-if-empty] No users found — running initial seed...");
    execSync("node_modules/.bin/tsx prisma/seed.ts", { stdio: "inherit" });
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("[seed-if-empty] failed:", error);
  process.exit(1);
});
