import { defineConfig } from "@playwright/test";

/**
 * Dedicated config for the offline-PWA E2E spec(s). @serwist/next's webpack
 * plugin has no Turbopack support, and Next 16 defaults both `next dev` and
 * `next build` to Turbopack — so the service worker only exists in a
 * `next build --webpack` artifact served by `next start`. Regular E2E specs
 * (tests/e2e/*.spec.ts) keep running against the Turbopack `next dev` server
 * via the default playwright.config.ts; only tests that need a real,
 * cache-populated service worker use this config and testDir.
 */
export default defineConfig({
  testDir: "tests/e2e-offline",
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:3000",
    headless: true,
    ignoreHTTPSErrors: true,
    permissions: ["camera"],
    launchOptions: {
      args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
    },
  },
  webServer: {
    command: "npm run build:pwa && npm run start",
    port: 3000,
    timeout: 300_000,
    reuseExistingServer: !process.env.CI,
  },
});
