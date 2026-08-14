import "dotenv/config";
import { expect, test, type Page } from "@playwright/test";
import { prisma } from "../../lib/db/client";
import { runPrepareSession } from "../../lib/sessions/prepare-session";

const SEED_PASSWORD = "Password123!";
const DEPOT = { code: "E2E-OFFLINE-DISCREPANCY", name: "E2E Offline Discrepancy Depot" };

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

/** Manual entry funnels through the exact same onScan handler as a camera detection — the only scan source Playwright can drive without a real QR in frame. Opens the quantity-entry panel; the caller still has to fill/confirm it. */
async function scanAndSetTotal(page: Page, articleRef: string, total: number) {
  const manualInput = page.getByLabel(/saisir une référence scannée manuellement/i);
  await manualInput.fill(articleRef);
  await manualInput.press("Enter");
  await page.getByTestId("qty-total-input").fill(String(total));
  await page.getByRole("button", { name: "Valider" }).click();
}

test.describe("US3 — offline discrepancy view (production build, FR-006)", () => {
  let sessionId: string;

  test.beforeAll(async () => {
    const depot = await prisma.depot.upsert({ where: { code: DEPOT.code }, update: {}, create: DEPOT });
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: "admin@example.com" } });
    const logistics = await prisma.user.findUniqueOrThrow({ where: { email: "logistics@example.com" } });

    process.env.ARTIS_MODE = "mock";
    process.env.ARTIS_FIXTURE = "normal"; // ART-001 (12), ART-002 (48), ART-003 (24)
    // Assigned to logistics@example.com (US7) — that's who logs in below to
    // count; bootstrap now scopes LOGISTICS to the session's assignee.
    const outcome = await runPrepareSession(depot.id, { id: admin.id, role: "ADMIN" }, logistics.id);
    if (!outcome.ok) throw new Error(`prepare failed in test setup: ${outcome.error}`);
    sessionId = outcome.sessionId;
  });

  test.afterAll(async () => {
    const depot = await prisma.depot.findUniqueOrThrow({ where: { code: DEPOT.code } });
    await prisma.auditLog.deleteMany({ where: { sessionId } });
    await prisma.inventoryLine.deleteMany({ where: { sessionId } });
    await prisma.inventorySession.deleteMany({ where: { id: sessionId } });
    await prisma.depot.delete({ where: { id: depot.id } });
    await prisma.$disconnect();
  });

  test("offline: a divergent count is highlighted in red, a matching one is not, computed with no network", async ({
    page,
    context,
  }) => {
    await loginAs(page, "logistics@example.com", SEED_PASSWORD);

    // Online first: seeds IndexedDB via /bootstrap and lets the service
    // worker cache this exact page (same mechanism as the other offline specs).
    await page.goto(`/sessions/${sessionId}/count`);
    await expect(page.getByRole("heading", { name: /comptage/i })).toBeVisible();
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await expect(page.getByRole("heading", { name: /comptage/i })).toBeVisible();

    await context.setOffline(true);
    await page.reload();
    await expect(page.getByRole("heading", { name: /comptage/i })).toBeVisible();

    // ART-001 theoretical is 12 — count exactly 12 => conforme.
    await scanAndSetTotal(page, "ART-001", 12);
    // ART-002 theoretical is 48 — count 40 => a -8 gap.
    await scanAndSetTotal(page, "ART-002", 40);
    // ART-003 is left untouched (never counted).

    const conformeRow = page.locator('tr[data-article-ref="ART-001"]');
    const ecartRow = page.locator('tr[data-article-ref="ART-002"]');
    const neverCountedRow = page.locator('tr[data-article-ref="ART-003"]');

    await expect(conformeRow).toHaveAttribute("data-status", "CONFORME");
    await expect(conformeRow.getByTestId("ecart-ART-001")).toHaveText("0");
    await expect(conformeRow.getByText("Conforme")).toBeVisible();

    await expect(ecartRow).toHaveAttribute("data-status", "ECART");
    await expect(ecartRow.getByTestId("ecart-ART-002")).toHaveText("-8");
    await expect(ecartRow.getByText("Écart")).toBeVisible();

    // Never counted: distinct from "counted 0" — shows "Non compté" and is
    // still classified as ECART (it hasn't been reconciled yet).
    await expect(neverCountedRow).toHaveAttribute("data-status", "ECART");
    await expect(neverCountedRow.getByText("Non compté")).toBeVisible();

    // Live session recap, computed purely from local cache.
    await expect(page.getByTestId("conforme-count")).toHaveText("1");
    await expect(page.getByTestId("ecart-count")).toHaveText("2");

    expect(page.url()).toContain(`/sessions/${sessionId}/count`);
  });
});
