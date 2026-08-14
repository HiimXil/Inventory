import { ArtisMockAdapter } from "./mock";
import { ArtisFileAdapter } from "./file";
import type { ArtisAdapter } from "./interface";

export type ArtisAdapterContext = {
  /** Required when ARTIS_MODE=file — the uploaded export, read server-side. */
  fileBuffer?: Buffer | ArrayBuffer;
};

export type ArtisMode = "mock" | "file" | "http";

/**
 * File import is the real primary path (ArtisHttpAdapter is still
 * unimplemented — see below), so it's the default everywhere a human
 * actually uses the app — dev and production alike. The one exception is
 * automated tests: without it, every test that prepares a session would
 * need a real .xlsx in hand, or would need to remember to set
 * ARTIS_MODE=mock itself — and forgetting that (or a stray local .env
 * flipped to "file") is exactly what broke the suite repeatedly. Detecting
 * "this is a test run" here means no test file, and no developer's local
 * .env, has to get that right on its own.
 *
 * `ARTIS_MODE` explicit in the environment always wins over both defaults
 * (e.g. playwright.file-import.config.ts forcing "file" even though its
 * webServer process is still a test run).
 *
 * Exported so callers that need to know the mode BEFORE they have a file in
 * hand (the /prepare page/action, to decide whether a file upload is
 * required at all) don't duplicate this resolution logic.
 */
export function resolveArtisMode(): ArtisMode {
  const raw = process.env.ARTIS_MODE ?? (isTestRun() ? "mock" : "file");
  if (raw === "mock" || raw === "file" || raw === "http") return raw;
  return "mock";
}

/**
 * VITEST is set automatically by Vitest itself for every test process — no
 * config needed for that half. Playwright doesn't set an equivalent flag on
 * the server processes it spawns, which is why the standard/offline
 * Playwright configs also set ARTIS_MODE=mock explicitly (belt and
 * suspenders, not either/or) rather than relying on this alone.
 */
function isTestRun(): boolean {
  return process.env.NODE_ENV === "test" || process.env.VITEST === "true";
}

export function getArtisAdapter(context: ArtisAdapterContext = {}): ArtisAdapter {
  const mode = resolveArtisMode();
  const fixture = process.env.ARTIS_FIXTURE ?? "normal";

  if (mode === "mock") {
    return new ArtisMockAdapter(fixture);
  }

  if (mode === "file") {
    if (!context.fileBuffer) {
      throw new Error("ARTIS_MODE=file requiert un fichier ARTIS (fileBuffer manquant).");
    }
    return new ArtisFileAdapter(context.fileBuffer);
  }

  throw new Error("ArtisHttpAdapter is not implemented in the foundation phase.");
}
