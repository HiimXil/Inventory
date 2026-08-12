import "dotenv/config";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { prisma } from "../../lib/db/client";

const SEED_PASSWORD = "Password123!";
const DEPOT = { code: "E2E-FILE-IMPORT", name: "E2E File Import Depot" };
const DEPOT_INVALID = { code: "E2E-FILE-IMPORT-BAD", name: "E2E File Import Depot (invalid file case)" };
const FIXTURE_PATH = path.join(__dirname, "../fixtures/artis-export-example.xlsx");

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

test.describe("US1 (file mode) — prepare session from a real ARTIS export", () => {
  test.beforeAll(async () => {
    await prisma.depot.upsert({ where: { code: DEPOT.code }, update: {}, create: DEPOT });
    await prisma.depot.upsert({ where: { code: DEPOT_INVALID.code }, update: {}, create: DEPOT_INVALID });
  });

  test.afterAll(async () => {
    for (const code of [DEPOT.code, DEPOT_INVALID.code]) {
      const depot = await prisma.depot.findUniqueOrThrow({ where: { code } });
      const sessions = await prisma.inventorySession.findMany({ where: { depotId: depot.id } });
      const sessionIds = sessions.map((s) => s.id);
      await prisma.auditLog.deleteMany({ where: { sessionId: { in: sessionIds } } });
      await prisma.inventoryLine.deleteMany({ where: { sessionId: { in: sessionIds } } });
      await prisma.inventorySession.deleteMany({ where: { id: { in: sessionIds } } });
      await prisma.depot.delete({ where: { id: depot.id } });
    }
    await prisma.$disconnect();
  });

  test("depot + real .xlsx upload -> session created with the correct mapping -> routed to counting", async ({
    page,
  }) => {
    await loginAs(page, "admin@example.com", SEED_PASSWORD);

    await page.goto("/prepare");

    // The file input only renders/is required under ARTIS_MODE=file — this
    // server instance is started with that override (see
    // playwright.file-import.config.ts), unlike the shared ARTIS_MODE=mock
    // dev server the rest of tests/e2e/ runs against.
    const fileInput = page.locator('input[name="artisFile"]');
    await expect(fileInput).toBeVisible();
    await expect(fileInput).toHaveAttribute("required", "");

    await page.selectOption("#depotId", { label: `${DEPOT.code} — ${DEPOT.name}` });
    await fileInput.setInputFiles(FIXTURE_PATH);
    await page.getByRole("button", { name: /préparer la session/i }).click();

    await expect(page).toHaveURL(/\/sessions\/[^/]+\/count$/, { timeout: 15_000 });

    const sessionId = page.url().match(/\/sessions\/([^/]+)\/count$/)?.[1];
    expect(sessionId).toBeTruthy();

    const session = await prisma.inventorySession.findUniqueOrThrow({
      where: { id: sessionId! },
      include: { lines: true },
    });
    expect(session.status).toBe("PREPARED");
    expect(session.lines).toHaveLength(98);

    const witness = session.lines.find((l) => l.articleRef === "DEMO-0001");
    expect(witness?.designation).toBe("Article de démonstration (filtre)");
    // Stock physique (9), never Qté théorique (8).
    expect(witness?.theoreticalQty).toBe(9);
  });

  test("an invalid file is rejected with an explicit error, retry available, no session created", async ({
    page,
  }) => {
    await loginAs(page, "admin@example.com", SEED_PASSWORD);

    const before = await prisma.inventorySession.count({
      where: { depot: { code: DEPOT_INVALID.code } },
    });

    await page.goto("/prepare");

    const fileInput = page.locator('input[name="artisFile"]');
    await page.selectOption("#depotId", { label: `${DEPOT_INVALID.code} — ${DEPOT_INVALID.name}` });
    await fileInput.setInputFiles({
      name: "invalid.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: Buffer.from("this is not a real xlsx file"),
    });
    await page.getByRole("button", { name: /préparer la session/i }).click();

    // Next.js's App Router always renders its own empty role="alert" route
    // announcer alongside ErrorState's — filter to the one that actually
    // carries text so the locator stays unambiguous.
    const alert = page.getByRole("alert").filter({ hasText: /\S/ });
    await expect(alert).toBeVisible({ timeout: 15_000 });
    await expect(alert).toContainText(/valide/i);
    await expect(page.getByRole("button", { name: /réessayer/i })).toBeVisible();
    expect(page.url()).toContain("/prepare");

    const after = await prisma.inventorySession.count({
      where: { depot: { code: DEPOT_INVALID.code } },
    });
    expect(after).toBe(before);
  });
});
