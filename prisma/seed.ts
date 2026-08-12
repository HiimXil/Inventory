import argon2 from "argon2";
import { PrismaClient, UserRole } from "@prisma/client";

const prisma = new PrismaClient();

// "Password123!" is a deliberately public, documented demo value (RUNBOOK.md,
// quickstart.md, and ~18 test files all assume it) — not a real secret, so
// keeping it as the default here doesn't leak anything. Overridable via
// SEED_DEMO_PASSWORD for anyone seeding a shared/CI database who wants a
// private value instead; the deployment checklist (quickstart.md) already
// warns never to run this script as-is against production.
const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "Password123!";

async function main() {
  await prisma.auditLog.deleteMany();
  await prisma.inventoryLine.deleteMany();
  await prisma.inventorySession.deleteMany();
  await prisma.depot.deleteMany();
  await prisma.user.deleteMany();

  // Depot code shape matches the real ARTIS convention (see RUNBOOK.md) —
  // vehicle labels are anonymized (no technician names), since this seed
  // data ships in a public repo.
  const depots = [
    { code: "0101", name: "Stock Central" },
    { code: "0120", name: "Stock Occasion" },
    { code: "0130", name: "Stock show room" },
    { code: "01TR", name: "Stock Transporteur" },
    { code: "01V1", name: "Véhicule (Technicien 1)" },
    { code: "01V3", name: "Véhicule (Technicien 2)" },
    { code: "01V4", name: "Véhicule (à confirmer)" },
    { code: "01V5", name: "Véhicule (Technicien 3)" },
    { code: "01V6", name: "Véhicule (à confirmer)" },
    { code: "01V7", name: "Véhicule (Technicien 4)" },
    { code: "01V8", name: "Véhicule (Technicien 5)" },
    { code: "01V9", name: "Véhicule (Technicien 6)" },
    { code: "01V10", name: "Véhicule (à confirmer)" },
  ];

  for (const depot of depots) {
    await prisma.depot.create({ data: depot });
  }

  const users = [
    { email: "admin@example.com", name: "Administrateur", role: UserRole.ADMIN },
    { email: "depot@example.com", name: "Responsable dépôt", role: UserRole.DEPOT_MANAGER },
    { email: "logistics@example.com", name: "Collaborateur logistique", role: UserRole.LOGISTICS },
    { email: "direction@example.com", name: "Direction lecture seule", role: UserRole.DIRECTION },
  ];

  const demoPasswordHash = await argon2.hash(DEMO_PASSWORD);
  for (const user of users) {
    await prisma.user.create({
      data: {
        email: user.email,
        name: user.name,
        role: user.role,
        passwordHash: demoPasswordHash,
      },
    });
  }

  console.log(`Seed complete: depots and users created (demo password: ${DEMO_PASSWORD === "Password123!" ? "default public demo value — set SEED_DEMO_PASSWORD to override" : "from SEED_DEMO_PASSWORD"}).`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
