import "dotenv/config";
import { expect, test, type Page } from "@playwright/test";
import { prisma } from "../../lib/db/client";
import { runPrepareSession } from "../../lib/sessions/prepare-session";
import { runSyncSession } from "../../lib/sessions/sync-session";
import { createUser } from "../../lib/admin/users";

const SEED_PASSWORD = "Password123!";

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

async function uiLogin(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mot de passe").fill(password);
  await page.getByRole("button", { name: /se connecter/i }).click();
}

async function seedOfflineSession(
  page: Page,
  record: { sessionId: string; depotCode: string; depotName: string; status: string; dirty: boolean },
) {
  await page.evaluate((rec) => {
    return new Promise<void>((resolve, reject) => {
      const req = indexedDB.open("SqpInventaireOfflineDB", 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("sessions")) {
          const store = db.createObjectStore("sessions", { keyPath: "sessionId" });
          store.createIndex("dirty", "dirty", { unique: false });
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction("sessions", "readwrite");
        tx.objectStore("sessions").put({
          sessionId: rec.sessionId,
          meta: { sessionId: rec.sessionId, depotCode: rec.depotCode, depotName: rec.depotName, status: rec.status },
          theoreticalLines: [],
          countLines: {},
          dirty: rec.dirty,
          lastLocalUpdate: new Date().toISOString(),
        });
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error("indexedDB.open blocked by another open connection"));
    });
  }, record);
}

test.describe("navigation — unauthenticated redirects (FR-026 §1)", () => {
  test.beforeAll(() => {
    process.env.ARTIS_MODE = "mock";
    process.env.ARTIS_FIXTURE = "normal";
  });

  for (const path of ["/prepare", "/sessions", "/admin"]) {
    test(`${path} redirects an unauthenticated visitor to /login`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login/);
    });
  }

  test("/sessions/[id]/count never redirects, even fully unauthenticated (FR-026 non-regression)", async ({
    page,
  }) => {
    const depot = await prisma.depot.upsert({
      where: { code: "E2E-NAV-COUNT" },
      update: {},
      create: { code: "E2E-NAV-COUNT", name: "E2E Nav Count Depot" },
    });
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: "admin@example.com" } });
    const prep = await runPrepareSession(depot.id, { id: admin.id, role: "ADMIN" });
    if (!prep.ok) throw new Error(prep.error);

    // Deliberately no login at all.
    await page.goto(`/sessions/${prep.sessionId}/count`);
    await expect(page).toHaveURL(new RegExp(`/sessions/${prep.sessionId}/count$`));
    expect(page.url()).not.toContain("/login");

    await prisma.auditLog.deleteMany({ where: { sessionId: prep.sessionId } });
    await prisma.inventoryLine.deleteMany({ where: { sessionId: prep.sessionId } });
    await prisma.inventorySession.deleteMany({ where: { id: prep.sessionId } });
    await prisma.depot.deleteMany({ where: { code: "E2E-NAV-COUNT" } });
  });

  test("callbackUrl round-trip: bounced from /prepare, login lands back on /prepare", async ({ page }) => {
    await page.goto("/prepare");
    await expect(page).toHaveURL(/\/login\?callbackUrl=%2Fprepare/);

    await page.getByLabel("Email").fill("admin@example.com");
    await page.getByLabel("Mot de passe").fill(SEED_PASSWORD);
    await page.getByRole("button", { name: /se connecter/i }).click();

    await expect(page).toHaveURL(/\/prepare$/);
  });
});

test.describe("navigation — post-login redirect by role (FR-026 §4)", () => {
  test("ADMIN lands on /prepare", async ({ page }) => {
    await uiLogin(page, "admin@example.com", SEED_PASSWORD);
    await expect(page).toHaveURL(/\/prepare$/);
  });

  test("DEPOT_MANAGER lands on /prepare", async ({ page }) => {
    await uiLogin(page, "depot@example.com", SEED_PASSWORD);
    await expect(page).toHaveURL(/\/prepare$/);
  });
});

test.describe("navigation — LOGISTICS post-login redirect (FR-026 §4)", () => {
  let logisticsEmail: string;
  let logisticsPassword: string;
  let depotId: string;

  test.beforeAll(async () => {
    process.env.ARTIS_MODE = "mock";
    process.env.ARTIS_FIXTURE = "normal";

    const admin = await prisma.user.findUniqueOrThrow({ where: { email: "admin@example.com" } });
    logisticsEmail = `e2e-nav-logistics-${Date.now()}@example.com`;
    logisticsPassword = "NavTestPwd123!";
    const created = await createUser(
      { id: admin.id, role: "ADMIN" },
      { email: logisticsEmail, role: "LOGISTICS", password: logisticsPassword },
    );
    if (!created.ok) throw new Error(created.error);

    const depot = await prisma.depot.upsert({
      where: { code: "E2E-NAV-LOGISTICS" },
      update: {},
      create: { code: "E2E-NAV-LOGISTICS", name: "E2E Nav Logistics Depot" },
    });
    depotId = depot.id;
  });

  test.afterAll(async () => {
    const depot = await prisma.depot.findUnique({ where: { code: "E2E-NAV-LOGISTICS" } });
    if (depot) {
      const sessions = await prisma.inventorySession.findMany({ where: { depotId: depot.id } });
      const sessionIds = sessions.map((s) => s.id);
      await prisma.auditLog.deleteMany({ where: { sessionId: { in: sessionIds } } });
      await prisma.inventoryLine.deleteMany({ where: { sessionId: { in: sessionIds } } });
      await prisma.inventorySession.deleteMany({ where: { id: { in: sessionIds } } });
      await prisma.depot.delete({ where: { id: depot.id } });
    }
    const user = await prisma.user.findUnique({ where: { email: logisticsEmail } });
    if (user) {
      await prisma.auditLog.deleteMany({ where: { actorId: user.id } });
      await prisma.user.delete({ where: { id: user.id } });
    }
    await prisma.$disconnect();
  });

  test("with no synced session yet, lands on /sessions", async ({ page }) => {
    await uiLogin(page, logisticsEmail, logisticsPassword);
    await expect(page).toHaveURL(/\/sessions$/);
  });

  test("with a synced-but-not-closed session, lands directly on it", async ({ page }) => {
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: "admin@example.com" } });
    const logisticsUser = await prisma.user.findUniqueOrThrow({ where: { email: logisticsEmail } });

    const prep = await runPrepareSession(depotId, { id: admin.id, role: "ADMIN" });
    if (!prep.ok) throw new Error(prep.error);
    const sync = await runSyncSession(
      prep.sessionId,
      { id: logisticsUser.id, role: "LOGISTICS" },
      { clientUpdatedAt: new Date().toISOString(), lines: [{ articleRef: "ART-001", countedQty: 1, isOffReferential: false }] },
    );
    if (!sync.ok || !sync.applied) throw new Error("sync failed in test setup");

    await uiLogin(page, logisticsEmail, logisticsPassword);
    await expect(page).toHaveURL(new RegExp(`/sessions/${prep.sessionId}$`));
  });
});

test.describe("navigation — main nav (FR-026 §3/§4)", () => {
  test("ADMIN sees an Administration link in the nav", async ({ page }) => {
    await loginAs(page, "admin@example.com", SEED_PASSWORD);
    await page.goto("/sessions");
    await expect(page.getByRole("link", { name: "Administration" })).toBeVisible();
  });

  for (const email of ["depot@example.com", "logistics@example.com", "direction@example.com"]) {
    test(`${email} does not see an Administration link`, async ({ page }) => {
      await loginAs(page, email, SEED_PASSWORD);
      await page.goto("/sessions");
      await expect(page.getByRole("link", { name: "Administration" })).toHaveCount(0);
    });
  }
});

test.describe("navigation — resume banner (FR-026 reprise fix)", () => {
  let syncedSessionId: string;

  test.beforeAll(async () => {
    process.env.ARTIS_MODE = "mock";
    process.env.ARTIS_FIXTURE = "normal";

    const depot = await prisma.depot.upsert({
      where: { code: "E2E-RESUME-SYNCED" },
      update: {},
      create: { code: "E2E-RESUME-SYNCED", name: "E2E Resume Synced Depot" },
    });
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: "admin@example.com" } });
    const prep = await runPrepareSession(depot.id, { id: admin.id, role: "ADMIN" });
    if (!prep.ok) throw new Error(prep.error);
    syncedSessionId = prep.sessionId;
    const sync = await runSyncSession(syncedSessionId, { id: admin.id, role: "ADMIN" }, {
      clientUpdatedAt: new Date().toISOString(),
      lines: [{ articleRef: "ART-001", countedQty: 1, isOffReferential: false }],
    });
    if (!sync.ok || !sync.applied) throw new Error("sync failed in test setup");
  });

  test.afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { sessionId: syncedSessionId } });
    await prisma.inventoryLine.deleteMany({ where: { sessionId: syncedSessionId } });
    await prisma.inventorySession.deleteMany({ where: { id: syncedSessionId } });
    await prisma.depot.deleteMany({ where: { code: "E2E-RESUME-SYNCED" } });
    await prisma.$disconnect();
  });

  test("a SYNCED-but-not-closed session stays resumable with zero local cache (main regression)", async ({
    page,
  }) => {
    await loginAs(page, "admin@example.com", SEED_PASSWORD);
    await page.goto("/sessions");

    // Scoped to the resume banner itself (data-testid) and to this test's
    // own session — the SAME session also legitimately appears in the
    // plain "En cours" list below, and the shared dev DB can carry other
    // SYNCED-but-open sessions from unrelated fixtures/seed data.
    const row = page.getByTestId("resume-sessions").getByRole("link", { name: /E2E-RESUME-SYNCED/i });
    await expect(row).toContainText(/comptage en cours — reprendre/i);
  });

  test("a dirty local session is surfaced as unsynced, even one the server doesn't currently list", async ({
    page,
  }) => {
    await loginAs(page, "admin@example.com", SEED_PASSWORD);
    // Seed IndexedDB from a page that never mounts ResumeSessionsBanner
    // (which would itself open a Dexie connection to the same database) —
    // avoids racing a second `indexedDB.open` against that connection.
    await page.goto("/login");

    await seedOfflineSession(page, {
      sessionId: "fake-dirty-session",
      depotCode: "E2E-FAKE-2",
      depotName: "Fake Dirty Depot",
      status: "SYNCED",
      dirty: true,
    });

    await page.goto("/sessions");

    await expect(page.getByText(/E2E-FAKE-2 — Fake Dirty Depot/)).toBeVisible();
    await expect(page.getByText(/comptage non synchronisé — reprendre/i)).toBeVisible();
  });

  test("a clean local session the server doesn't list is not shown (nothing at risk)", async ({ page }) => {
    await loginAs(page, "admin@example.com", SEED_PASSWORD);
    await page.goto("/login");

    await seedOfflineSession(page, {
      sessionId: "fake-clean-orphan",
      depotCode: "E2E-FAKE-3",
      depotName: "Fake Clean Orphan Depot",
      status: "SYNCED",
      dirty: false,
    });

    await page.goto("/sessions");

    await expect(page.getByText(/E2E-FAKE-3/)).toHaveCount(0);
  });
});

test.describe("navigation — orphaned local session, resume anti-loss rules (FR-026 reprise fix)", () => {
  test("resuming a dirty local session never overwrites it — bootstrap makes no network call", async ({
    page,
  }) => {
    await loginAs(page, "admin@example.com", SEED_PASSWORD);
    await page.goto("/login");
    await seedOfflineSession(page, {
      sessionId: "fake-dirty-no-overwrite",
      depotCode: "E2E-FAKE-4",
      depotName: "Fake Dirty No Overwrite",
      status: "PREPARED",
      dirty: true,
    });

    let bootstrapCalled = false;
    await page.route("**/api/sessions/fake-dirty-no-overwrite/bootstrap", async (route) => {
      bootstrapCalled = true;
      await route.continue();
    });

    await page.goto("/sessions/fake-dirty-no-overwrite/count");
    await expect(page.getByRole("heading", { name: /comptage/i })).toBeVisible();

    expect(bootstrapCalled).toBe(false);
  });

  test("a dirty local session whose server-side session no longer exists is detected and cleaned up, no 404 loop", async ({
    page,
  }) => {
    await loginAs(page, "admin@example.com", SEED_PASSWORD);
    await page.goto("/login");
    await seedOfflineSession(page, {
      sessionId: "fake-dirty-gone-server-side",
      depotCode: "E2E-FAKE-5",
      depotName: "Fake Dirty Gone Depot",
      status: "PREPARED",
      dirty: true,
    });

    await page.goto("/sessions/fake-dirty-gone-server-side/count");
    await expect(page.getByRole("heading", { name: /comptage/i })).toBeVisible();

    // The auto-sync trigger fires (dirty + online) and hits a genuine 404
    // from the real /sync route (no fixture session exists under this id).
    await expect(page.getByText(/cette session n'existe plus sur le serveur/i)).toBeVisible({ timeout: 10_000 });
    // No literal HTTP status code leaking into the message.
    await expect(page.getByText(/HTTP 404/i)).toHaveCount(0);

    // Cleanup is verified at the product level rather than by poking
    // IndexedDB directly with a second connection: /count holds its own
    // open Dexie connection (useOfflineSession) for as long as it's
    // mounted, and a raw `indexedDB.open` racing that live connection from
    // the test can hang even at the same version. If the orphaned record
    // is truly gone, it no longer shows up in the resume banner.
    await page.goto("/sessions");
    await expect(page.getByText(/E2E-FAKE-5/)).toHaveCount(0);
  });

  test("a clean local session whose server-side session no longer exists is detected on direct navigation", async ({
    page,
  }) => {
    await loginAs(page, "admin@example.com", SEED_PASSWORD);
    await page.goto("/login");
    await seedOfflineSession(page, {
      sessionId: "fake-clean-gone-server-side",
      depotCode: "E2E-FAKE-6",
      depotName: "Fake Clean Gone Depot",
      status: "SYNCED",
      dirty: false,
    });

    await page.goto("/sessions/fake-clean-gone-server-side/count");

    await expect(page.getByText(/cette session n'existe plus sur le serveur/i)).toBeVisible();
  });
});

test.describe("navigation — resume without local cache re-bootstraps from the server (FR-026 reprise fix)", () => {
  let sessionId: string;

  test.beforeAll(async () => {
    process.env.ARTIS_MODE = "mock";
    process.env.ARTIS_FIXTURE = "normal";

    const depot = await prisma.depot.upsert({
      where: { code: "E2E-RESUME-NOCACHE" },
      update: {},
      create: { code: "E2E-RESUME-NOCACHE", name: "E2E Resume No Cache Depot" },
    });
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: "admin@example.com" } });
    const prep = await runPrepareSession(depot.id, { id: admin.id, role: "ADMIN" });
    if (!prep.ok) throw new Error(prep.error);
    sessionId = prep.sessionId;
  });

  test.afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { sessionId } });
    await prisma.inventoryLine.deleteMany({ where: { sessionId } });
    await prisma.inventorySession.deleteMany({ where: { id: sessionId } });
    await prisma.depot.deleteMany({ where: { code: "E2E-RESUME-NOCACHE" } });
    await prisma.$disconnect();
  });

  test("visiting /count with no prior local cache fetches and displays the theoretical lines", async ({ page }) => {
    await loginAs(page, "admin@example.com", SEED_PASSWORD);

    await page.goto(`/sessions/${sessionId}/count`);

    await expect(page.getByRole("heading", { name: /comptage/i })).toBeVisible();
    await expect(page.locator('tr[data-article-ref="ART-001"]')).toBeVisible();
  });
});

test.describe("navigation — ghost user (Bug B fix: JWT valid, underlying User row gone/disabled)", () => {
  test("a deleted user's still-valid JWT is cleanly logged out and redirected to /login with a clear message", async ({
    page,
  }) => {
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: "admin@example.com" } });
    const email = `e2e-nav-ghost-deleted-${Date.now()}@example.com`;
    const password = "GhostTestPwd123!";
    const created = await createUser({ id: admin.id, role: "ADMIN" }, { email, role: "DEPOT_MANAGER", password });
    if (!created.ok) throw new Error(created.error);

    await loginAs(page, email, password);
    // Simulates a DB reset / the user record being removed after the
    // session cookie was already issued — the JWT itself stays "valid".
    await prisma.user.delete({ where: { email } });

    await page.goto("/sessions");

    await expect(page).toHaveURL(/\/login\?error=session-expired/);
    await expect(page.getByText(/votre session a expiré, reconnectez-vous/i)).toBeVisible();

    // The stale cookie was actually cleared (clean logout), not just a
    // one-off redirect that would repeat the same failure forever.
    await page.goto("/sessions");
    await expect(page).toHaveURL(/\/login/);
    await expect(page).not.toHaveURL(/error=session-expired/);
  });

  test("a disabled user's still-valid JWT is treated the same way", async ({ page }) => {
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: "admin@example.com" } });
    const email = `e2e-nav-ghost-disabled-${Date.now()}@example.com`;
    const password = "GhostTestPwd123!";
    const created = await createUser({ id: admin.id, role: "ADMIN" }, { email, role: "DEPOT_MANAGER", password });
    if (!created.ok) throw new Error(created.error);

    try {
      await loginAs(page, email, password);
      await prisma.user.update({ where: { email }, data: { disabledAt: new Date() } });

      await page.goto("/prepare");

      await expect(page).toHaveURL(/\/login\?error=session-expired/);
      await expect(page.getByText(/votre session a expiré, reconnectez-vous/i)).toBeVisible();
    } finally {
      await prisma.user.deleteMany({ where: { email } });
    }
  });
});

test.describe("navigation — logout", () => {
  test("Se déconnecter clears the session and blocks return to /sessions", async ({ page }) => {
    await loginAs(page, "admin@example.com", SEED_PASSWORD);
    await page.goto("/sessions");

    await page.getByRole("button", { name: /se déconnecter/i }).click();
    await expect(page).toHaveURL(/\/login/);

    await page.goto("/sessions");
    await expect(page).toHaveURL(/\/login/);
  });
});
