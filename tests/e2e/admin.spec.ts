import "dotenv/config";
import { expect, test, type Page } from "@playwright/test";
import { prisma } from "../../lib/db/client";
import { runPrepareSession } from "../../lib/sessions/prepare-session";

const SEED_PASSWORD = "Password123!";
const DEPOT = { code: "E2E-NORMAL-ADMIN", name: "E2E Admin Depot" };

async function loginAs(page: Page, email: string, password: string) {
  const csrfResponse = await page.request.get("/api/auth/csrf");
  const { csrfToken } = (await csrfResponse.json()) as { csrfToken: string };
  return page.request.post("/api/auth/callback/credentials", {
    form: { email, password, csrfToken },
  });
}

test.describe("US6 — administration", () => {
  let sessionIdToCancel: string;
  let createdUserEmail: string;

  test.beforeAll(async () => {
    const depot = await prisma.depot.upsert({ where: { code: DEPOT.code }, update: {}, create: DEPOT });
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: "admin@example.com" } });

    process.env.ARTIS_MODE = "mock";
    process.env.ARTIS_FIXTURE = "normal";
    const outcome = await runPrepareSession(depot.id, { id: admin.id, role: "ADMIN" });
    if (!outcome.ok) throw new Error(`prepare failed in test setup: ${outcome.error}`);
    sessionIdToCancel = outcome.sessionId;
  });

  test.afterAll(async () => {
    const depot = await prisma.depot.findUniqueOrThrow({ where: { code: DEPOT.code } });
    if (createdUserEmail) {
      await prisma.auditLog.deleteMany({ where: { actor: { email: createdUserEmail } } });
      await prisma.user.deleteMany({ where: { email: createdUserEmail } });
    }
    await prisma.auditLog.deleteMany({ where: { sessionId: sessionIdToCancel } });
    await prisma.inventoryLine.deleteMany({ where: { sessionId: sessionIdToCancel } });
    await prisma.inventorySession.deleteMany({ where: { id: sessionIdToCancel } });
    await prisma.depot.delete({ where: { id: depot.id } });
    await prisma.$disconnect();
  });

  test("admin walk-through: dashboard -> create user (who can then log in) -> cancel a non-closed session -> view audit", async ({
    page,
  }) => {
    // This walk-through does several full SSR round-trips in sequence
    // (dashboard, users, sessions, audit) against the one shared `next dev`
    // instance the whole tests/e2e suite runs against — under full-suite
    // parallel load that adds up past the default 30s budget even though
    // each individual step is fast in isolation.
    test.slow();

    const loginResponse = await loginAs(page, "admin@example.com", SEED_PASSWORD);
    expect(loginResponse.ok()).toBe(true);

    await page.goto("/admin");
    await expect(page.getByRole("link", { name: /gestion des utilisateurs/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /annulation de sessions/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /journal d'audit/i })).toBeVisible();

    // --- Create a user, then prove they can actually log in ---
    createdUserEmail = `e2e-admin-created-${Date.now()}@example.com`;
    await page.goto("/admin/users");
    await page.getByLabel("Email", { exact: true }).fill(createdUserEmail);
    await page.getByLabel("Nom", { exact: true }).fill("Créé par E2E");
    await page.getByLabel("Rôle", { exact: true }).selectOption("LOGISTICS");
    await page.getByLabel("Mot de passe", { exact: true }).fill("NouveauMdp123!");
    await page.getByRole("button", { name: /créer l'utilisateur/i }).click();

    await expect(page.locator(`tr[data-user-email="${createdUserEmail}"]`)).toBeVisible();

    const newUserLoginResponse = await loginAs(page, createdUserEmail, "NouveauMdp123!");
    expect(newUserLoginResponse.ok()).toBe(true);

    // --- Cancel a non-closed session ---
    await loginAs(page, "admin@example.com", SEED_PASSWORD);
    await page.goto("/admin/sessions");
    const row = page.locator(`tr[data-session-id="${sessionIdToCancel}"]`);
    await expect(row).toHaveAttribute("data-session-status", "PREPARED");
    // "Annuler" only opens the confirmation dialog now (ConfirmDialog,
    // replacing the previous window.confirm()-shaped one-click submit) — the
    // actual cancellation happens on the dialog's own confirm button.
    await row.getByRole("button", { name: /^annuler$/i }).click();
    await page.getByRole("button", { name: /confirmer l'annulation/i }).click();

    await expect(page.locator(`tr[data-session-id="${sessionIdToCancel}"]`)).toHaveAttribute(
      "data-session-status",
      "CANCELLED",
    );

    const cancelledSession = await prisma.inventorySession.findUniqueOrThrow({
      where: { id: sessionIdToCancel },
    });
    expect(cancelledSession.status).toBe("CANCELLED");

    // --- Audit trail reflects both actions ---
    await page.goto("/admin/audit");
    await expect(page.locator('tr[data-audit-action="USER_CREATED"]').first()).toBeVisible();
    await expect(page.locator('tr[data-audit-action="SESSION_CANCELLED"]').first()).toBeVisible();
  });

  test("a non-ADMIN is blocked on /admin", async ({ page }) => {
    const loginResponse = await loginAs(page, "depot@example.com", SEED_PASSWORD);
    expect(loginResponse.ok()).toBe(true);

    const response = await page.goto("/admin");
    expect(response?.status()).toBe(404);

    await expect(page.getByRole("link", { name: /gestion des utilisateurs/i })).toHaveCount(0);
  });
});
