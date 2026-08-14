/**
 * Forces ARTIS_MODE=mock for the standard/offline Playwright suites, before
 * anything else runs — belt and suspenders with resolveArtisMode()'s own
 * test-run detection and each config's `webServer.env`. Runs in the same
 * process Playwright spawns test workers from, so this env mutation is
 * inherited by every worker — which is what covers spec files that call
 * lib/sessions/prepare-session.ts's runPrepareSession() directly, in the
 * test process itself, rather than through the browser/webServer.
 *
 * Unconditional on purpose: these two suites are ALWAYS mock, full stop —
 * that's the whole point of no longer depending on a local .env (or any
 * other ambient env var) to get this right. Only playwright.file-import.config.ts
 * is meant to run against a different mode, and it does so with its own
 * separate, explicit webServer.env override — it doesn't use this file.
 */
export default function globalSetup(): void {
  process.env.ARTIS_MODE = "mock";
}
