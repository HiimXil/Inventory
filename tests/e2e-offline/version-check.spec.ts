import "dotenv/config";
import { expect, test, type Page } from "@playwright/test";
import { prisma } from "../../lib/db/client";
import { runPrepareSession } from "../../lib/sessions/prepare-session";

const SEED_PASSWORD = "Password123!";
const DEPOT_MISMATCH = { code: "E2E-NORMAL-VERSION-MISMATCH", name: "E2E Version Mismatch Depot" };
const DEPOT_MATCH = { code: "E2E-NORMAL-VERSION-MATCH", name: "E2E Version Match Depot" };

async function loginAs(page: Page, email: string, password: string) {
  const csrfResponse = await page.request.get("/api/auth/csrf");
  const { csrfToken } = (await csrfResponse.json()) as { csrfToken: string };
  const response = await page.request.post("/api/auth/callback/credentials", {
    form: { email, password, csrfToken },
  });
  if (!response.ok()) {
    throw new Error(`Login failed for ${email}: HTTP ${response.status()}`);
  }
}

test.describe("FR-026 — shell version check surfaced by /sync", () => {
  let mismatchSessionId: string;
  let matchSessionId: string;

  test.beforeAll(async () => {
    const depotMismatch = await prisma.depot.upsert({
      where: { code: DEPOT_MISMATCH.code },
      update: {},
      create: DEPOT_MISMATCH,
    });
    const depotMatch = await prisma.depot.upsert({
      where: { code: DEPOT_MATCH.code },
      update: {},
      create: DEPOT_MATCH,
    });
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: "admin@example.com" } });

    process.env.ARTIS_MODE = "mock";
    process.env.ARTIS_FIXTURE = "normal";

    const mismatchOutcome = await runPrepareSession(depotMismatch.id, { id: admin.id, role: "ADMIN" });
    if (!mismatchOutcome.ok) throw new Error(`prepare failed in test setup: ${mismatchOutcome.error}`);
    mismatchSessionId = mismatchOutcome.sessionId;

    const matchOutcome = await runPrepareSession(depotMatch.id, { id: admin.id, role: "ADMIN" });
    if (!matchOutcome.ok) throw new Error(`prepare failed in test setup: ${matchOutcome.error}`);
    matchSessionId = matchOutcome.sessionId;
  });

  test.afterAll(async () => {
    for (const [sessionId, depotCode] of [
      [mismatchSessionId, DEPOT_MISMATCH.code],
      [matchSessionId, DEPOT_MATCH.code],
    ] as const) {
      const depot = await prisma.depot.findUniqueOrThrow({ where: { code: depotCode } });
      await prisma.auditLog.deleteMany({ where: { sessionId } });
      await prisma.inventoryLine.deleteMany({ where: { sessionId } });
      await prisma.inventorySession.deleteMany({ where: { id: sessionId } });
      await prisma.depot.delete({ where: { id: depot.id } });
    }
    await prisma.$disconnect();
  });

  test("a mismatched appVersion in the /sync response shows the reload warning, without losing counted data", async ({
    page,
  }) => {
    await loginAs(page, "logistics@example.com", SEED_PASSWORD);

    await page.route(`**/api/sessions/${mismatchSessionId}/sync`, async (route) => {
      const request = route.request();
      const payload = request.postDataJSON() as { lines: Array<{ articleRef: string; countedQty: number }> };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          applied: true,
          session: { id: mismatchSessionId, status: "SYNCED" },
          lines: payload.lines,
          appVersion: "0.0.0-e2e-newer-build",
        }),
      });
    });

    await page.goto(`/sessions/${mismatchSessionId}/count`);
    await expect(page.getByRole("heading", { name: /comptage/i })).toBeVisible();

    const manualInput = page.getByLabel(/saisir une référence scannée manuellement/i);
    await manualInput.fill("ART-001");
    await manualInput.press("Enter");
    await page.getByTestId("qty-total-input").fill("1");
    await page.getByRole("button", { name: "Valider" }).click();

    const warning = page.getByTestId("shell-version-warning");
    await expect(warning).toBeVisible({ timeout: 10_000 });
    await expect(warning).toContainText(/nouvelle version/i);
    await expect(warning.getByRole("button", { name: /recharger la page/i })).toBeVisible();

    // The counted data is unaffected by the warning — no forced reload, no
    // data loss (FR-026: "ne force JAMAIS un rechargement").
    await expect(page.getByTestId("total-counted")).toHaveText("1");
  });

  test("a matching appVersion never shows the warning", async ({ page }) => {
    await loginAs(page, "logistics@example.com", SEED_PASSWORD);

    await page.goto(`/sessions/${matchSessionId}/count`);
    await expect(page.getByRole("heading", { name: /comptage/i })).toBeVisible();

    const manualInput = page.getByLabel(/saisir une référence scannée manuellement/i);
    await manualInput.fill("ART-001");
    await manualInput.press("Enter");
    await page.getByTestId("qty-total-input").fill("1");
    await page.getByRole("button", { name: "Valider" }).click();

    await expect(page.getByTestId("sync-confirmation")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("shell-version-warning")).toHaveCount(0);
  });
});
