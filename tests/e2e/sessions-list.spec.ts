import "dotenv/config";
import { expect, test, type Page } from "@playwright/test";
import { prisma } from "../../lib/db/client";
import { runPrepareSession } from "../../lib/sessions/prepare-session";
import { runSyncSession } from "../../lib/sessions/sync-session";

const SEED_PASSWORD = "Password123!";
// "E2E-NORMAL" prefix guarantees the mock fixture regardless of the shared
// `next dev` process's ARTIS_FIXTURE env var — see the comment in
// tests/e2e/prepare-session.spec.ts and lib/artis/mock.ts.
const DEPOT_OWN = { code: "E2E-NORMAL-LIST-OWN", name: "E2E List Depot (own)" };
const DEPOT_OTHER = { code: "E2E-NORMAL-LIST-OTHER", name: "E2E List Depot (other)" };

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

test.describe("liste des sessions (/sessions)", () => {
  let ownSessionId: string;
  let otherSessionId: string;

  test.beforeAll(async () => {
    const depotOwn = await prisma.depot.upsert({ where: { code: DEPOT_OWN.code }, update: {}, create: DEPOT_OWN });
    const depotOther = await prisma.depot.upsert({
      where: { code: DEPOT_OTHER.code },
      update: {},
      create: DEPOT_OTHER,
    });
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: "admin@example.com" } });
    const logistics = await prisma.user.findUniqueOrThrow({ where: { email: "logistics@example.com" } });
    const adminActor = { id: admin.id, role: "ADMIN" as const };
    const logisticsActor = { id: logistics.id, role: "LOGISTICS" as const };

    process.env.ARTIS_MODE = "mock";
    process.env.ARTIS_FIXTURE = "normal";

    // "Own" is assigned TO the logistics actor (US7) — who physically syncs
    // it no longer decides visibility, only the assignment does.
    const ownOutcome = await runPrepareSession(depotOwn.id, adminActor, logisticsActor.id);
    if (!ownOutcome.ok) throw new Error(`prepare failed in test setup: ${ownOutcome.error}`);
    ownSessionId = ownOutcome.sessionId;
    const ownSync = await runSyncSession(ownSessionId, logisticsActor, {
      clientUpdatedAt: new Date().toISOString(),
      lines: [{ articleRef: "ART-002", countedQty: 999, isOffReferential: false }], // deliberate gap
    });
    if (!ownSync.ok || !ownSync.applied) throw new Error("sync failed in test setup");

    // "Other" is assigned to admin, not the logistics actor — even though
    // nothing stops admin from being the one who syncs it too.
    const otherOutcome = await runPrepareSession(depotOther.id, adminActor, adminActor.id);
    if (!otherOutcome.ok) throw new Error(`prepare failed in test setup: ${otherOutcome.error}`);
    otherSessionId = otherOutcome.sessionId;
    const otherSync = await runSyncSession(otherSessionId, adminActor, {
      clientUpdatedAt: new Date().toISOString(),
      lines: [{ articleRef: "ART-001", countedQty: 12, isOffReferential: false }], // matches theoretical
    });
    if (!otherSync.ok || !otherSync.applied) throw new Error("sync failed in test setup");
  });

  test.afterAll(async () => {
    const depotIds = (
      await prisma.depot.findMany({ where: { code: { in: [DEPOT_OWN.code, DEPOT_OTHER.code] } } })
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

  test("DIRECTION sees every session, écarts in evidence, and can open one read-only", async ({ page }) => {
    await loginAs(page, "direction@example.com", SEED_PASSWORD);

    await page.goto("/sessions");

    const ownRow = page.locator(`[data-session-id="${ownSessionId}"]`);
    const otherRow = page.locator(`[data-session-id="${otherSessionId}"]`);
    await expect(ownRow).toBeVisible();
    await expect(otherRow).toBeVisible();
    await expect(ownRow).toHaveAttribute("data-session-status", "SYNCED");
    await expect(ownRow.getByText(/écart/i)).toBeVisible();

    await ownRow.click();
    await expect(page).toHaveURL(new RegExp(`/sessions/${ownSessionId}$`));
  });

  test("LOGISTICS only sees sessions assigned to them (US7)", async ({ page }) => {
    await loginAs(page, "logistics@example.com", SEED_PASSWORD);

    await page.goto("/sessions");

    await expect(page.locator(`[data-session-id="${ownSessionId}"]`)).toBeVisible();
    await expect(page.locator(`[data-session-id="${otherSessionId}"]`)).toHaveCount(0);
  });
});
