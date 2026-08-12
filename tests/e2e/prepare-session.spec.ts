import "dotenv/config";
import { expect, test, type Page } from "@playwright/test";
import { prisma } from "../../lib/db/client";

const SEED_PASSWORD = "Password123!";

// "E2E-" prefixed codes route ArtisMockAdapter to a fixed fixture regardless
// of the server process's ARTIS_FIXTURE env var (see lib/artis/mock.ts),
// since all specs below share the single `next dev` instance Playwright
// starts (Next 16 refuses a second concurrent dev server on this project).
const NORMAL_DEPOT = { code: "E2E-NORMAL-1", name: "E2E Normal Depot" };
const EMPTY_DEPOT = { code: "E2E-EMPTY-1", name: "E2E Empty Depot" };
const DUP_DEPOT = { code: "E2E-NORMAL-2", name: "E2E Duplicate Depot" };

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

test.describe("US1 — prepare session (E2E)", () => {
  test.beforeAll(async () => {
    for (const depot of [NORMAL_DEPOT, EMPTY_DEPOT, DUP_DEPOT]) {
      await prisma.depot.upsert({ where: { code: depot.code }, update: {}, create: depot });
    }
  });

  test.afterAll(async () => {
    const depots = await prisma.depot.findMany({
      where: { code: { in: [NORMAL_DEPOT.code, EMPTY_DEPOT.code, DUP_DEPOT.code] } },
    });
    const depotIds = depots.map((d) => d.id);
    const sessions = await prisma.inventorySession.findMany({ where: { depotId: { in: depotIds } } });
    const sessionIds = sessions.map((s) => s.id);

    await prisma.auditLog.deleteMany({ where: { sessionId: { in: sessionIds } } });
    await prisma.inventoryLine.deleteMany({ where: { sessionId: { in: sessionIds } } });
    await prisma.inventorySession.deleteMany({ where: { id: { in: sessionIds } } });
    await prisma.depot.deleteMany({ where: { id: { in: depotIds } } });
    await prisma.$disconnect();
  });

  test("DEPOT_MANAGER: sélection dépôt -> import réussi -> session créée -> /bootstrap renvoie le snapshot", async ({
    page,
  }) => {
    await loginAs(page, "depot@example.com", SEED_PASSWORD);

    const depot = await prisma.depot.findUniqueOrThrow({ where: { code: NORMAL_DEPOT.code } });

    await page.goto("/prepare");
    await page.selectOption("#depotId", depot.id);
    await page.getByRole("button", { name: /préparer la session/i }).click();

    await page.waitForURL(/\/sessions\/.+/);
    // The session detail page redirects PREPARED sessions straight to
    // /count, so the URL may be /sessions/{id} or /sessions/{id}/count by
    // the time this resolves — capture only the id segment either way.
    const sessionId = /\/sessions\/([^/]+)/.exec(page.url())?.[1];
    expect(sessionId).toBeTruthy();

    const bootstrapResponse = await page.request.get(`/api/sessions/${sessionId}/bootstrap`);
    expect(bootstrapResponse.ok()).toBe(true);

    const body = (await bootstrapResponse.json()) as {
      session: { id: string; status: string };
      lines: Array<{ articleRef: string }>;
    };
    expect(body.session.id).toBe(sessionId);
    expect(body.session.status).toBe("PREPARED");
    expect(Array.isArray(body.lines)).toBe(true);
    expect(body.lines.length).toBeGreaterThan(0);
  });

  test("import sur la fixture vide -> message d'erreur explicite + retry, aucune session créée", async ({
    page,
  }) => {
    await loginAs(page, "depot@example.com", SEED_PASSWORD);

    const depot = await prisma.depot.findUniqueOrThrow({ where: { code: EMPTY_DEPOT.code } });

    await page.goto("/prepare");
    await page.selectOption("#depotId", depot.id);
    await page.getByRole("button", { name: /préparer la session/i }).click();

    // Next.js's App Router always renders its own empty role="alert" route
    // announcer alongside ErrorState's — filter to the one that actually
    // carries text so the locator stays unambiguous.
    const alert = page.getByRole("alert").filter({ hasText: /\S/ });
    await expect(alert).toBeVisible();
    await expect(alert).toContainText(/vide|incomplet/i);
    await expect(page.getByRole("button", { name: /réessayer/i })).toBeVisible();

    expect(page.url()).toContain("/prepare");

    const sessionCount = await prisma.inventorySession.count({ where: { depotId: depot.id } });
    expect(sessionCount).toBe(0);
  });

  test("tentative de 2e session active sur le même dépôt est refusée", async ({ page }) => {
    await loginAs(page, "admin@example.com", SEED_PASSWORD);

    const depot = await prisma.depot.findUniqueOrThrow({ where: { code: DUP_DEPOT.code } });

    await page.goto("/prepare");
    await page.selectOption("#depotId", depot.id);
    await page.getByRole("button", { name: /préparer la session/i }).click();
    await page.waitForURL(/\/sessions\/.+/);

    await page.goto("/prepare");
    await page.selectOption("#depotId", depot.id);
    await page.getByRole("button", { name: /préparer la session/i }).click();

    // Next.js's App Router always renders its own empty role="alert" route
    // announcer alongside ErrorState's — filter to the one that actually
    // carries text so the locator stays unambiguous.
    const alert = page.getByRole("alert").filter({ hasText: /\S/ });
    await expect(alert).toBeVisible();
    await expect(alert).toContainText(/active/i);

    const sessionCount = await prisma.inventorySession.count({ where: { depotId: depot.id } });
    expect(sessionCount).toBe(1);
  });
});
