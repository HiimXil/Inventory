import "dotenv/config";
import { expect, test, type Page } from "@playwright/test";
import { prisma } from "../../lib/db/client";
import { runPrepareSession } from "../../lib/sessions/prepare-session";

const SEED_PASSWORD = "Password123!";
const DEPOT = { code: "E2E-OFFLINE-UX", name: "E2E Offline UX Depot" };

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

async function goOnlineThenCacheShell(page: Page, sessionId: string) {
  await page.goto(`/sessions/${sessionId}/count`);
  await expect(page.getByRole("heading", { name: /comptage/i })).toBeVisible();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect(page.getByRole("heading", { name: /comptage/i })).toBeVisible();
}

async function scanAndSetTotal(page: Page, articleRef: string, total: number) {
  const manualInput = page.getByLabel(/saisir une référence scannée manuellement/i);
  await manualInput.fill(articleRef);
  await manualInput.press("Enter");
  await page.getByTestId("qty-total-input").fill(String(total));
  await page.getByRole("button", { name: "Valider" }).click();
}

test.describe("US2/US3 — counting screen UX: progress, filter, pending sync", () => {
  let sessionId: string;

  test.beforeAll(async () => {
    const depot = await prisma.depot.upsert({ where: { code: DEPOT.code }, update: {}, create: DEPOT });
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: "admin@example.com" } });
    const logistics = await prisma.user.findUniqueOrThrow({ where: { email: "logistics@example.com" } });

    process.env.ARTIS_MODE = "mock";
    // ART-001 Imprimante UV (théo. 12), ART-002 Encre cyan (48), ART-003 Plaque aluminium (24).
    process.env.ARTIS_FIXTURE = "normal";
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

  test("offline: the progress bar reflects articles seen vs total, updating on each confirm", async ({
    page,
    context,
  }) => {
    await loginAs(page, "logistics@example.com", SEED_PASSWORD);
    await goOnlineThenCacheShell(page, sessionId);

    await context.setOffline(true);
    await page.reload();
    await expect(page.getByRole("heading", { name: /comptage/i })).toBeVisible();

    const progressBar = page.getByRole("progressbar");
    await expect(progressBar).toHaveAttribute("aria-valuenow", "0");
    await expect(progressBar).toHaveAttribute("aria-valuemax", "3");
    await expect(page.getByText("0 / 3 articles comptés")).toBeVisible();

    await scanAndSetTotal(page, "ART-001", 12);
    await expect(progressBar).toHaveAttribute("aria-valuenow", "1");
    await expect(page.getByText("1 / 3 articles comptés")).toBeVisible();

    await scanAndSetTotal(page, "ART-002", 40);
    await expect(progressBar).toHaveAttribute("aria-valuenow", "2");
    await expect(page.getByText("2 / 3 articles comptés")).toBeVisible();

    // A rescan (delta) on an ALREADY-seen article must not double-count it.
    const knownRow = page.locator('tr[data-article-ref="ART-001"]');
    await knownRow.getByRole("button", { name: /modifier la quantité comptée/i }).click();
    await page.getByTestId("qty-delta-input").fill("1");
    await page.getByRole("button", { name: "Valider" }).click();
    await expect(progressBar).toHaveAttribute("aria-valuenow", "2");
    await expect(page.getByText("2 / 3 articles comptés")).toBeVisible();
  });

  test("offline: search and view-mode filter/sort the list without touching stored data", async ({
    page,
    context,
  }) => {
    await loginAs(page, "logistics@example.com", SEED_PASSWORD);
    await goOnlineThenCacheShell(page, sessionId);

    await context.setOffline(true);
    await page.reload();
    await expect(page.getByRole("heading", { name: /comptage/i })).toBeVisible();

    // Set up: ART-001 conforme (12/12), ART-002 écart (40/48), ART-003 never counted.
    await scanAndSetTotal(page, "ART-001", 12);
    await scanAndSetTotal(page, "ART-002", 40);

    const searchInput = page.getByTestId("counting-search-input");
    const rows = page.locator("tbody tr");

    await searchInput.fill("encre");
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toHaveAttribute("data-article-ref", "ART-002");

    await searchInput.fill("ART-003");
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toHaveAttribute("data-article-ref", "ART-003");

    await searchInput.fill("");
    await expect(rows).toHaveCount(3);

    await page.getByRole("radio", { name: "Non comptés" }).click();
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toHaveAttribute("data-article-ref", "ART-003");

    await page.getByRole("radio", { name: "Tout" }).click();
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toHaveAttribute("data-article-ref", "ART-001");
    await expect(rows.nth(1)).toHaveAttribute("data-article-ref", "ART-002");
    await expect(rows.nth(2)).toHaveAttribute("data-article-ref", "ART-003");

    // "Écarts d'abord": ART-002 (écart) and ART-003 (never counted, also
    // classified ECART) move before ART-001 (conforme) — a stable reorder,
    // nothing hidden and nothing recomputed (lib/offline/discrepancy.ts is
    // untouched; only display order changes).
    await page.getByRole("radio", { name: "Écarts d'abord" }).click();
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toHaveAttribute("data-article-ref", "ART-002");
    await expect(rows.nth(1)).toHaveAttribute("data-article-ref", "ART-003");
    await expect(rows.nth(2)).toHaveAttribute("data-article-ref", "ART-001");
  });

  test("the pending-sync count reflects local counts while offline, and clears once synced", async ({
    page,
    context,
  }) => {
    await loginAs(page, "logistics@example.com", SEED_PASSWORD);
    await goOnlineThenCacheShell(page, sessionId);

    const offlineIndicator = page.getByTestId("offline-indicator");
    await expect(offlineIndicator).toHaveCount(0);

    await context.setOffline(true);
    await page.reload();
    await expect(page.getByRole("heading", { name: /comptage/i })).toBeVisible();

    await scanAndSetTotal(page, "ART-001", 5);
    await expect(offlineIndicator).toContainText("1 comptage en attente");

    await scanAndSetTotal(page, "ART-002", 3);
    await expect(offlineIndicator).toContainText("2 comptages en attente");

    // Network returns: the automatic online-listener syncs, clearing `dirty`
    // — the indicator should then have nothing left to report.
    await context.setOffline(false);
    await expect(page.getByTestId("sync-confirmation")).toBeVisible({ timeout: 10_000 });
    await expect(offlineIndicator).toHaveCount(0);
  });
});
