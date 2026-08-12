import { defineConfig } from "@playwright/test";

/**
 * Dedicated config for the real ARTIS_MODE=file import path through the
 * actual browser UI (depot + file upload). The shared dev server the rest
 * of tests/e2e/*.spec.ts runs against stays on ARTIS_MODE=mock (from .env)
 * for its whole lifetime — that env is fixed at process startup, so testing
 * the file-upload UI needs a second server instance with the mode
 * overridden, on a different port, rather than making the shared server's
 * mode conditional per-test.
 */
export default defineConfig({
  testDir: "tests/e2e-file-import",
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:3100",
    headless: true,
    ignoreHTTPSErrors: true,
  },
  webServer: {
    command: "npm run dev -- --port 3100",
    port: 3100,
    env: { ARTIS_MODE: "file" },
    reuseExistingServer: !process.env.CI,
  },
});
