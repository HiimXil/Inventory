import "dotenv/config";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { prisma } from "../../lib/db/client";
import { runPrepareSession } from "../../lib/sessions/prepare-session";

const SEED_PASSWORD = "Password123!";
const DEPOT = { code: "E2E-OFFLINE-SCAN", name: "E2E Offline Scan Depot" };

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

/** Manual entry funnels through the exact same onScan handler as a camera detection (see QRScanner/count/page.tsx) — this is the only scan source Playwright can drive without a real QR in frame. */
async function scan(page: Page, articleRef: string) {
  const manualInput = page.getByLabel(/saisir une référence scannée manuellement/i);
  await manualInput.fill(articleRef);
  await manualInput.press("Enter");
}

/** Reads the displayed counted quantity for a row — the whole row (not just this cell) is the tap target that opens/reopens the panel, see CountingTable. */
function countedCell(row: Locator): Locator {
  return row.getByTestId(/^counted-/);
}

test.describe("US2 — offline counting (production build)", () => {
  let sessionId: string;

  test.beforeAll(async () => {
    const depot = await prisma.depot.upsert({ where: { code: DEPOT.code }, update: {}, create: DEPOT });
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: "admin@example.com" } });
    const logistics = await prisma.user.findUniqueOrThrow({ where: { email: "logistics@example.com" } });

    process.env.ARTIS_MODE = "mock";
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

  test("offline: a first scan opens a total-entry panel; confirming sets the count, a rescan lets you add/remove", async ({
    page,
    context,
  }) => {
    await loginAs(page, "logistics@example.com", SEED_PASSWORD);

    // Online first: seeds IndexedDB via /bootstrap and lets the service
    // worker's runtime cache pick up this exact page (same mechanism proven
    // in counting-offline-shell.spec.ts).
    await page.goto(`/sessions/${sessionId}/count`);
    await expect(page.getByRole("heading", { name: /comptage/i })).toBeVisible();
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await expect(page.getByRole("heading", { name: /comptage/i })).toBeVisible();

    await context.setOffline(true);
    await page.reload();
    await expect(page.getByRole("heading", { name: /comptage/i })).toBeVisible();

    const total = page.getByTestId("total-counted");
    const feedback = page.getByTestId("scan-feedback");
    const panel = page.getByTestId("quantity-entry-panel");
    const manualInput = page.getByLabel(/saisir une référence scannée manuellement/i);
    const knownRow = page.locator('tr[data-article-ref="ART-001"]');
    await expect(total).toHaveText("0");

    // First scan: opens the panel in TOTAL mode. The scan itself changes
    // nothing yet — the row must still show no count until confirmed.
    await scan(page, "ART-001");
    await expect(panel).toBeVisible();
    await expect(panel).toHaveAttribute("data-panel-mode", "total");
    await expect(countedCell(knownRow)).toHaveText("Non compté");

    await page.getByTestId("qty-total-input").fill("5");

    // The panel is a native modal <dialog>: the rest of the page — camera
    // and manual entry alike — is genuinely inert while it's open, a
    // stronger guarantee than the old logical-only "same/different ref
    // ignored while a panel is open" guard (still covered at the pure-logic
    // level by tests/unit/scan-entry.test.ts). A real tap on the manual
    // field simply cannot reach it now, so the in-progress entry can't be
    // reset or discarded by a stray scan.
    await expect(async () => {
      await manualInput.click({ timeout: 500 });
    }).rejects.toThrow();
    await expect(page.getByTestId("qty-total-input")).toHaveValue("5");

    await page.getByRole("button", { name: "Valider" }).click();
    await expect(panel).toHaveCount(0);
    await expect(countedCell(knownRow)).toHaveText("5");
    await expect(total).toHaveText("5");
    // The confirmed-entry banner is the "it's taken" cue — it fires on
    // confirm, never on the raw scan that only opened the panel.
    await expect(feedback).toHaveAttribute("data-scan-status", "accepted");
    await expect(feedback).toContainText(/compté : 5/i);
    await expect(knownRow).toHaveAttribute("data-just-confirmed", "true");

    // Rescan: the panel now shows the previous total and asks for a delta.
    await scan(page, "ART-001");
    await expect(panel).toHaveAttribute("data-panel-mode", "delta");
    await expect(page.getByTestId("qty-previous")).toHaveText(/Déjà compté : 5/);

    // Cancelling must leave the total untouched.
    await page.getByTestId("qty-delta-input").fill("2");
    await page.getByRole("button", { name: "Annuler" }).click();
    await expect(panel).toHaveCount(0);
    await expect(countedCell(knownRow)).toHaveText("5");
    await expect(total).toHaveText("5");

    // Add 3 — the panel previews the resulting total before it's confirmed.
    await scan(page, "ART-001");
    await page.getByTestId("qty-delta-input").fill("3");
    await expect(page.getByTestId("qty-preview")).toHaveText(/Nouveau total : 8/);
    await page.getByRole("button", { name: "Valider" }).click();
    await expect(countedCell(knownRow)).toHaveText("8");
    await expect(total).toHaveText("8");
    await expect(feedback).toContainText(/compté : 8/i);

    // Remove more than what's on file: bounded to 0, not rejected, with a clear message.
    await scan(page, "ART-001");
    await page.getByRole("radio", { name: /retirer/i }).click();
    await page.getByTestId("qty-delta-input").fill("20");
    await page.getByRole("button", { name: "Valider" }).click();
    await expect(countedCell(knownRow)).toHaveText("0");
    await expect(total).toHaveText("0");
    await expect(feedback).toContainText(/compté : 0/i);
    await expect(page.getByTestId("scan-feedback-clamped")).toBeVisible();

    expect(page.url()).toContain(`/sessions/${sessionId}/count`);
  });

  test("offline: 0 is a valid, distinct total for a searched-but-empty reference", async ({ page, context }) => {
    await loginAs(page, "logistics@example.com", SEED_PASSWORD);

    await page.goto(`/sessions/${sessionId}/count`);
    await expect(page.getByRole("heading", { name: /comptage/i })).toBeVisible();
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await expect(page.getByRole("heading", { name: /comptage/i })).toBeVisible();

    await context.setOffline(true);
    await page.reload();
    await expect(page.getByRole("heading", { name: /comptage/i })).toBeVisible();

    const knownRow = page.locator('tr[data-article-ref="ART-003"]');
    await expect(countedCell(knownRow)).toHaveText("Non compté");

    await scan(page, "ART-003");
    await page.getByTestId("qty-total-input").fill("0");
    await page.getByRole("button", { name: "Valider" }).click();

    // "0" (searched, none found) must render distinctly from "never counted".
    await expect(countedCell(knownRow)).toHaveText("0");
    await expect(page.getByTestId("total-counted")).toHaveText("0");
  });

  test("offline: scanning an unknown reference opens the same panel and creates a distinctly-flagged off-referential line", async ({
    page,
    context,
  }) => {
    await loginAs(page, "logistics@example.com", SEED_PASSWORD);

    await page.goto(`/sessions/${sessionId}/count`);
    await expect(page.getByRole("heading", { name: /comptage/i })).toBeVisible();
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await expect(page.getByRole("heading", { name: /comptage/i })).toBeVisible();

    await context.setOffline(true);
    await page.reload();
    await expect(page.getByRole("heading", { name: /comptage/i })).toBeVisible();

    await scan(page, "UNKNOWN-REF-1");
    const panel = page.getByTestId("quantity-entry-panel");
    await expect(panel).toHaveAttribute("data-panel-mode", "total");
    await expect(panel).toContainText(/hors référentiel/i);

    await page.getByTestId("qty-total-input").fill("1");
    await page.getByRole("button", { name: "Valider" }).click();

    const offReferentialRow = page.locator('tr[data-article-ref="UNKNOWN-REF-1"]');
    await expect(offReferentialRow).toBeVisible();
    await expect(offReferentialRow.getByText(/hors référentiel/i)).toBeVisible();
    await expect(offReferentialRow.locator("td").nth(2)).toHaveText("0");
    await expect(countedCell(offReferentialRow)).toHaveText("1");

    const feedback = page.getByTestId("scan-feedback");
    await expect(feedback).toHaveAttribute("data-scan-status", "off-referential");
    await expect(feedback).toContainText(/hors référentiel/i);
    await expect(feedback).toContainText(/compté : 1/i);
  });
});

test.describe("US2 — tap a row to count without scanning (CountingTable, offline)", () => {
  let sessionId: string;

  test.beforeAll(async () => {
    const depot = await prisma.depot.upsert({
      where: { code: `${DEPOT.code}-TAP` },
      update: {},
      create: { code: `${DEPOT.code}-TAP`, name: "E2E Offline Tap Depot" },
    });
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: "admin@example.com" } });
    const logistics = await prisma.user.findUniqueOrThrow({ where: { email: "logistics@example.com" } });

    process.env.ARTIS_MODE = "mock";
    process.env.ARTIS_FIXTURE = "normal";
    const outcome = await runPrepareSession(depot.id, { id: admin.id, role: "ADMIN" }, logistics.id);
    if (!outcome.ok) throw new Error(`prepare failed in test setup: ${outcome.error}`);
    sessionId = outcome.sessionId;
  });

  test.afterAll(async () => {
    const depot = await prisma.depot.findUniqueOrThrow({ where: { code: `${DEPOT.code}-TAP` } });
    await prisma.auditLog.deleteMany({ where: { sessionId } });
    await prisma.inventoryLine.deleteMany({ where: { sessionId } });
    await prisma.inventorySession.deleteMany({ where: { id: sessionId } });
    await prisma.depot.delete({ where: { id: depot.id } });
    await prisma.$disconnect();
  });

  async function goOfflineOnCountScreen(page: Page, context: import("@playwright/test").BrowserContext) {
    await loginAs(page, "logistics@example.com", SEED_PASSWORD);
    await page.goto(`/sessions/${sessionId}/count`);
    await expect(page.getByRole("heading", { name: /comptage/i })).toBeVisible();
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await expect(page.getByRole("heading", { name: /comptage/i })).toBeVisible();
    await context.setOffline(true);
    await page.reload();
    await expect(page.getByRole("heading", { name: /comptage/i })).toBeVisible();
  }

  test("tapping a never-counted row opens the panel in total mode (no QR needed)", async ({ page, context }) => {
    await goOfflineOnCountScreen(page, context);

    const row = page.locator('tr[data-article-ref="ART-001"]');
    const panel = page.getByTestId("quantity-entry-panel");

    await row.click();

    await expect(panel).toBeVisible();
    await expect(panel).toHaveAttribute("data-panel-mode", "total");
    await expect(panel).toContainText("ART-001");
  });

  test("tapping the row produces the exact same result as scanning it — same underlying handler", async ({
    page,
    context,
  }) => {
    await goOfflineOnCountScreen(page, context);

    const row = page.locator('tr[data-article-ref="ART-002"]');
    const total = page.getByTestId("total-counted");

    // First tap: total mode, confirm 7.
    await row.click();
    await expect(page.getByTestId("quantity-entry-panel")).toHaveAttribute("data-panel-mode", "total");
    await page.getByTestId("qty-total-input").fill("7");
    await page.getByRole("button", { name: "Valider" }).click();
    await expect(countedCell(row)).toHaveText("7");
    await expect(total).toHaveText("7");

    // Re-tapping an already-counted row opens the SAME panel in delta mode —
    // exactly what a rescan does (see the scan-based test above asserting
    // the identical "Déjà compté" / delta behavior for ART-001).
    await row.click();
    await expect(page.getByTestId("quantity-entry-panel")).toHaveAttribute("data-panel-mode", "delta");
    await expect(page.getByTestId("qty-previous")).toHaveText(/Déjà compté : 7/);
    await page.getByTestId("qty-delta-input").fill("3");
    await page.getByRole("button", { name: "Valider" }).click();
    await expect(countedCell(row)).toHaveText("10");
    await expect(total).toHaveText("10");
  });

  test("a row still opens the panel by tap after filtering the list down to it", async ({ page, context }) => {
    await goOfflineOnCountScreen(page, context);

    await page.getByTestId("counting-search-input").fill("ART-003");
    const row = page.locator('tr[data-article-ref="ART-003"]');
    await expect(row).toBeVisible();
    await expect(page.locator('tr[data-article-ref="ART-001"]')).toHaveCount(0);

    await row.click();
    await expect(page.getByTestId("quantity-entry-panel")).toBeVisible();
  });

  test("a row is keyboard-reachable, announced as an interactive button, and Enter opens the panel", async ({
    page,
    context,
  }) => {
    await goOfflineOnCountScreen(page, context);

    const row = page.getByRole("button", { name: /saisir la quantité pour art-001/i });
    await expect(row).toBeVisible();

    await row.focus();
    await expect(row).toBeFocused();
    await page.keyboard.press("Enter");

    await expect(page.getByTestId("quantity-entry-panel")).toBeVisible();
  });
});
