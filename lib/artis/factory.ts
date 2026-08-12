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
 * unimplemented — see below), so it's the implicit production default;
 * dev/test keep defaulting to the mock unless ARTIS_MODE says otherwise.
 * Exported so callers that need to know the mode BEFORE they have a file in
 * hand (the /prepare page/action, to decide whether a file upload is
 * required at all) don't duplicate this resolution logic.
 */
export function resolveArtisMode(): ArtisMode {
  const raw = process.env.ARTIS_MODE ?? (process.env.NODE_ENV === "production" ? "file" : "mock");
  if (raw === "mock" || raw === "file" || raw === "http") return raw;
  return "mock";
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
