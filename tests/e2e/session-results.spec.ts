import "dotenv/config";
import { expect, test, type Page } from "@playwright/test";
import { prisma } from "../../lib/db/client";
import { runPrepareSession } from "../../lib/sessions/prepare-session";
import { runSyncSession } from "../../lib/sessions/sync-session";

const SEED_PASSWORD = "Password123!";
// "E2E-NORMAL" prefix guarantees the 3-article mock fixture regardless of
// the shared `next dev` process's ARTIS_FIXTURE env var — see the comment
// in tests/e2e/prepare-session.spec.ts and lib/artis/mock.ts.
const DEPOT_MAIN = { code: "E2E-NORMAL-RESULTS", name: "E2E Results Depot" };
const DEPOT_PREPARED = { code: "E2E-NORMAL-RESULTS-2", name: "E2E Results Depot (prepared only)" };

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

test.describe("US5 — closure & export", () => {
  let syncedSessionId: string;
  let preparedSessionId: string;

  test.beforeAll(async () => {
    const depotMain = await prisma.depot.upsert({ where: { code: DEPOT_MAIN.code }, update: {}, create: DEPOT_MAIN });
    const depotPrepared = await prisma.depot.upsert({
      where: { code: DEPOT_PREPARED.code },
      update: {},
      create: DEPOT_PREPARED,
    });
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: "admin@example.com" } });
    const actor = { id: admin.id, role: "ADMIN" as const };

    const mainOutcome = await runPrepareSession(depotMain.id, actor, actor.id);
    if (!mainOutcome.ok) throw new Error(`prepare failed in test setup: ${mainOutcome.error}`);
    syncedSessionId = mainOutcome.sessionId;

    const syncOutcome = await runSyncSession(syncedSessionId, actor, {
      clientUpdatedAt: new Date().toISOString(),
      lines: [
        { articleRef: "ART-001", countedQty: 12, isOffReferential: false }, // matches theoretical -> conforme
        { articleRef: "ART-002", countedQty: 40, isOffReferential: false }, // diverges -> écart
      ],
    });
    if (!syncOutcome.ok || !syncOutcome.applied) throw new Error("sync failed in test setup");

    const preparedOutcome = await runPrepareSession(depotPrepared.id, actor, actor.id);
    if (!preparedOutcome.ok) throw new Error(`prepare failed in test setup: ${preparedOutcome.error}`);
    preparedSessionId = preparedOutcome.sessionId;
  });

  test.afterAll(async () => {
    const depotIds = (
      await prisma.depot.findMany({ where: { code: { in: [DEPOT_MAIN.code, DEPOT_PREPARED.code] } } })
    ).map((d) => d.id);
    const sessionIds = (await prisma.inventorySession.findMany({ where: { depotId: { in: depotIds } } })).map(
      (s) => s.id,
    );
    await prisma.auditLog.deleteMany({ where: { sessionId: { in: sessionIds } } });
    await prisma.inventoryLine.deleteMany({ where: { sessionId: { in: sessionIds } } });
    await prisma.inventorySession.deleteMany({ where: { id: { in: sessionIds } } });
    await prisma.depot.deleteMany({ where: { id: { in: depotIds } } });
    await prisma.$disconnect();
  });

  test("SYNCED -> results view with gaps in red -> export -> close -> CLOSED -> export still works", async ({
    page,
  }) => {
    await loginAs(page, "admin@example.com", SEED_PASSWORD);

    await page.goto(`/sessions/${syncedSessionId}`);
    await expect(page.getByText("Statut : SYNCED")).toBeVisible();

    const gapRow = page.locator('tr[data-article-ref="ART-002"]');
    await expect(gapRow).toHaveAttribute("data-status", "ECART");
    const conformeRow = page.locator('tr[data-article-ref="ART-001"]');
    await expect(conformeRow).toHaveAttribute("data-status", "CONFORME");

    const exportLink = page.getByRole("link", { name: /exporter excel/i });
    await expect(exportLink).toBeVisible();
    const [downloadWhileSynced] = await Promise.all([page.waitForEvent("download"), exportLink.click()]);
    expect(downloadWhileSynced.suggestedFilename()).toMatch(
      /^inventaire_E2E-NORMAL-RESULTS_\d{8}-\d{4}\.xlsx$/,
    );

    // "Clôturer" only opens the confirmation dialog now (ConfirmDialog,
    // replacing the previous one-click window.confirm()-shaped submit) —
    // the actual closure happens on the dialog's own confirm button.
    await page.getByRole("button", { name: /^clôturer$/i }).click();
    await page.getByRole("button", { name: /clôturer définitivement/i }).click();
    await expect(page.getByText("Statut : CLOSED")).toBeVisible();
    await expect(page.getByText(/clôturée et archivée/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /^clôturer$/i })).toHaveCount(0);

    const session = await prisma.inventorySession.findUniqueOrThrow({ where: { id: syncedSessionId } });
    expect(session.status).toBe("CLOSED");
    expect(session.closedAt).not.toBeNull();

    const [downloadWhileClosed] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("link", { name: /exporter excel/i }).click(),
    ]);
    expect(downloadWhileClosed.suggestedFilename()).toMatch(/\.xlsx$/);
  });

  test("a PREPARED (non-SYNCED) session offers no closure path — it routes to /count instead", async ({ page }) => {
    await loginAs(page, "admin@example.com", SEED_PASSWORD);

    await page.goto(`/sessions/${preparedSessionId}`);

    await expect(page).toHaveURL(new RegExp(`/sessions/${preparedSessionId}/count$`));
    await expect(page.getByRole("button", { name: /^clôturer$/i })).toHaveCount(0);

    const session = await prisma.inventorySession.findUniqueOrThrow({ where: { id: preparedSessionId } });
    expect(session.status).toBe("PREPARED");
  });
});
