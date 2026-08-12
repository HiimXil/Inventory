import packageJson from "../package.json";

/**
 * FR-026 (version-check volet): a single source of truth for "what version
 * is this running", read at build time from package.json rather than
 * hard-coded twice. The server embeds this in the /sync response; the
 * client bundle embeds its own copy purely by importing this same module —
 * whatever value was current when THIS bundle was built stays frozen in
 * the precached offline shell until the user actually reloads.
 */
export const APP_VERSION: string = packageJson.version;
