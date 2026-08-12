import "dotenv/config";
import { expect, test, type Page } from "@playwright/test";
import { prisma } from "../../lib/db/client";
import { runPrepareSession } from "../../lib/sessions/prepare-session";

const SEED_PASSWORD = "Password123!";
const DEPOT_AUTO = { code: "E2E-OFFLINE-SYNC-AUTO", name: "E2E Offline Sync Depot (auto)" };
const DEPOT_RETRY = { code: "E2E-OFFLINE-SYNC-RETRY", name: "E2E Offline Sync Depot (retry)" };

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
  // Reload once more while still online so the SW (clientsClaim: true) is
  // guaranteed to control this exact navigation and populate its cache —
  // same mechanism proven in counting-offline-shell.spec.ts.
  await page.reload();
  await expect(page.getByRole("heading", { name: /comptage/i })).toBeVisible();
}

test.describe("US4 — sync on network return (production build)", () => {
  let sessionIdAuto: string;
  let sessionIdRetry: string;

  test.beforeAll(async () => {
    const depotAuto = await prisma.depot.upsert({
      where: { code: DEPOT_AUTO.code },
      update: {},
      create: DEPOT_AUTO,
    });
    const depotRetry = await prisma.depot.upsert({
      where: { code: DEPOT_RETRY.code },
      update: {},
      create: DEPOT_RETRY,
    });
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: "admin@example.com" } });

    process.env.ARTIS_MODE = "mock";
    process.env.ARTIS_FIXTURE = "normal";

    const autoOutcome = await runPrepareSession(depotAuto.id, { id: admin.id, role: "ADMIN" });
    if (!autoOutcome.ok) throw new Error(`prepare failed in test setup: ${autoOutcome.error}`);
    sessionIdAuto = autoOutcome.sessionId;

    const retryOutcome = await runPrepareSession(depotRetry.id, { id: admin.id, role: "ADMIN" });
    if (!retryOutcome.ok) throw new Error(`prepare failed in test setup: ${retryOutcome.error}`);
    sessionIdRetry = retryOutcome.sessionId;
  });

  test.afterAll(async () => {
    for (const [sessionId, depotCode] of [
      [sessionIdAuto, DEPOT_AUTO.code],
      [sessionIdRetry, DEPOT_RETRY.code],
    ] as const) {
      const depot = await prisma.depot.findUniqueOrThrow({ where: { code: depotCode } });
      await prisma.auditLog.deleteMany({ where: { sessionId } });
      await prisma.inventoryLine.deleteMany({ where: { sessionId } });
      await prisma.inventorySession.deleteMany({ where: { id: sessionId } });
      await prisma.depot.delete({ where: { id: depot.id } });
    }
    await prisma.$disconnect();
  });

  test("counting offline then network returns triggers an automatic sync: SYNCED, dirty cleared, data in DB", async ({
    page,
    context,
  }) => {
    await loginAs(page, "logistics@example.com", SEED_PASSWORD);
    await goOnlineThenCacheShell(page, sessionIdAuto);

    await context.setOffline(true);
    await page.reload();
    await expect(page.getByRole("heading", { name: /comptage/i })).toBeVisible();

    const manualInput = page.getByLabel(/saisir une référence scannée manuellement/i);
    await manualInput.fill("ART-001");
    await manualInput.press("Enter");
    await page.getByTestId("qty-total-input").fill("1");
    await page.getByRole("button", { name: "Valider" }).click();
    await expect(page.getByTestId("total-counted")).toHaveText("1");

    // Network return (FR-007): the sync trigger listens for the browser's
    // `online` event and fires automatically, with no user action.
    await context.setOffline(false);

    await expect(page.getByTestId("sync-confirmation")).toBeVisible({ timeout: 10_000 });

    const line = await prisma.inventoryLine.findFirst({
      where: { sessionId: sessionIdAuto, articleRef: "ART-001" },
    });
    expect(line?.countedQty).toBe(1);
    expect(line?.isOffReferential).toBe(false);

    const session = await prisma.inventorySession.findUniqueOrThrow({ where: { id: sessionIdAuto } });
    expect(session.status).toBe("SYNCED");
    expect(session.syncedAt).not.toBeNull();

    const syncedLog = await prisma.auditLog.findFirst({
      where: { sessionId: sessionIdAuto, action: "SESSION_SYNCED" },
    });
    expect(syncedLog).not.toBeNull();
  });

  test("a failed sync attempt keeps counted data and a retry succeeds without loss", async ({
    page,
    context,
  }) => {
    await loginAs(page, "logistics@example.com", SEED_PASSWORD);
    await goOnlineThenCacheShell(page, sessionIdRetry);

    await context.setOffline(true);
    await page.reload();
    await expect(page.getByRole("heading", { name: /comptage/i })).toBeVisible();

    const manualInput = page.getByLabel(/saisir une référence scannée manuellement/i);
    await manualInput.fill("ART-002");
    await manualInput.press("Enter");
    await page.getByTestId("qty-total-input").fill("1");
    await page.getByRole("button", { name: "Valider" }).click();
    await expect(page.getByTestId("total-counted")).toHaveText("1");

    // Force one real failed sync attempt: trigger the manual button while
    // still offline (network request genuinely fails — no route mocking,
    // which the Serwist service worker's own fetch handling would fight).
    await page.getByRole("button", { name: /synchroniser maintenant/i }).click();

    const retryButton = page.getByRole("button", { name: /réessayer la synchronisation/i });
    await expect(retryButton).toBeVisible({ timeout: 10_000 });

    // Local data survived the failed attempt (dirty stayed true) —
    // still visible in the counting table, unaffected by the failure.
    await expect(page.getByTestId("total-counted")).toHaveText("1");

    // Network returns: the automatic online-listener retries the exact same
    // payload through the same guarded retry() the button calls.
    await context.setOffline(false);
    await expect(page.getByTestId("sync-confirmation")).toBeVisible({ timeout: 10_000 });

    const line = await prisma.inventoryLine.findFirst({
      where: { sessionId: sessionIdRetry, articleRef: "ART-002" },
    });
    // Exactly 1, not 2: the retry replayed the same absolute value, no
    // double-count from the failed-then-retried attempt.
    expect(line?.countedQty).toBe(1);

    const session = await prisma.inventorySession.findUniqueOrThrow({ where: { id: sessionIdRetry } });
    expect(session.status).toBe("SYNCED");
  });
});
