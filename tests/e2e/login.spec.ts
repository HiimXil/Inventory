import { expect, test } from "@playwright/test";

const SEED_PASSWORD = "Password123!";

test.describe("Login (E2E, dev server)", () => {
  test("valid credentials redirect to /prepare, which is then usable", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill("depot@example.com");
    await page.getByLabel("Mot de passe").fill(SEED_PASSWORD);
    await page.getByRole("button", { name: /se connecter/i }).click();

    await page.waitForURL("**/prepare");
    await expect(
      page.getByRole("heading", { name: /préparer une session d.inventaire/i }),
    ).toBeVisible();
    await expect(page.locator("#depotId")).toBeVisible();
  });

  test("DIRECTION redirects to /sessions (read-only consultation)", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill("direction@example.com");
    await page.getByLabel("Mot de passe").fill(SEED_PASSWORD);
    await page.getByRole("button", { name: /se connecter/i }).click();

    await page.waitForURL((url) => url.pathname === "/sessions");
  });

  test("wrong password shows a generic error and does not redirect or reveal which field was wrong", async ({
    page,
  }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill("admin@example.com");
    await page.getByLabel("Mot de passe").fill("wrong-password");
    await page.getByRole("button", { name: /se connecter/i }).click();

    // Next.js's App Router always renders its own empty role="alert" route
    // announcer alongside ErrorState's — filter to the one that actually
    // carries text so the locator stays unambiguous.
    const alert = page.getByRole("alert").filter({ hasText: /\S/ });
    await expect(alert).toBeVisible();
    await expect(alert).toHaveText("Identifiants invalides.");
    expect(page.url()).toContain("/login");
  });

  test("unknown email shows the exact same generic error", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill("nobody@example.com");
    await page.getByLabel("Mot de passe").fill("whatever123");
    await page.getByRole("button", { name: /se connecter/i }).click();

    // Next.js's App Router always renders its own empty role="alert" route
    // announcer alongside ErrorState's — filter to the one that actually
    // carries text so the locator stays unambiguous.
    const alert = page.getByRole("alert").filter({ hasText: /\S/ });
    await expect(alert).toBeVisible();
    await expect(alert).toHaveText("Identifiants invalides.");
    expect(page.url()).toContain("/login");
  });
});
