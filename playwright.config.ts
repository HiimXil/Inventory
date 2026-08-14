import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  // ARTIS_MODE=mock forced for this whole run — see the file's own comment.
  // Independent of, and redundant with, webServer.env below on purpose:
  // this covers spec files that call runPrepareSession() directly in the
  // test process, that one covers the actual `next dev` server.
  globalSetup: "./playwright.global-setup-mock.ts",
  use: {
    baseURL: "http://127.0.0.1:3000",
    headless: true,
    ignoreHTTPSErrors: true,
  },
  webServer: {
    command: "npm run dev",
    port: 3000,
    reuseExistingServer: !process.env.CI,
    env: {
      ARTIS_MODE: "mock",
    },
  },
});
