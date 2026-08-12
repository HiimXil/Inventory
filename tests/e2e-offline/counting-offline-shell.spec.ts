import "dotenv/config";
import { expect, test, type Page } from "@playwright/test";
import { prisma } from "../../lib/db/client";
import { runPrepareSession } from "../../lib/sessions/prepare-session";

const SEED_PASSWORD = "Password123!";
const DEPOT = { code: "E2E-OFFLINE-SHELL", name: "E2E Offline Shell Depot" };

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

test.describe("US2 — offline counting shell (production build, FR-026)", () => {
  let sessionId: string;

  test.beforeAll(async () => {
    const depot = await prisma.depot.upsert({ where: { code: DEPOT.code }, update: {}, create: DEPOT });
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: "admin@example.com" } });

    process.env.ARTIS_MODE = "mock";
    const outcome = await runPrepareSession(depot.id, { id: admin.id, role: "ADMIN" });
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

  test("a previously-bootstrapped session's /count route loads offline, without redirecting to /login", async ({
    page,
    context,
  }) => {
    await loginAs(page, "depot@example.com", SEED_PASSWORD);

    // First visit: online. Seeds IndexedDB via /bootstrap and lets the
    // service worker's runtime cache pick up this exact page.
    await page.goto(`/sessions/${sessionId}/count`);
    await expect(page.getByRole("heading", { name: /comptage/i })).toBeVisible();

    await page.evaluate(() => navigator.serviceWorker.ready);
    // Reload once more while still online so the SW (clientsClaim: true) is
    // guaranteed to control this exact navigation and populate its cache.
    await page.reload();
    await expect(page.getByRole("heading", { name: /comptage/i })).toBeVisible();

    await context.setOffline(true);

    // Sanity check that `setOffline` really cuts the network (and isn't a
    // false pass because the shell would render anyway): a request that the
    // service worker cannot possibly have cached must fail. Uses an in-page
    // fetch — `page.request` runs on a separate Node-side network stack that
    // `context.setOffline` does NOT affect, unlike the page's own fetch.
    const outcome = await page.evaluate(async () => {
      try {
        await fetch("/api/sessions/does-not-exist/bootstrap");
        return "resolved";
      } catch {
        return "rejected";
      }
    });
    expect(outcome).toBe("rejected");

    await page.reload();

    await expect(page.getByRole("heading", { name: /comptage/i })).toBeVisible();
    expect(page.url()).toContain(`/sessions/${sessionId}/count`);
    expect(page.url()).not.toContain("/login");
  });
});
