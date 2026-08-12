/**
 * Guards against open-redirect via a user-controlled `callbackUrl` (FR-026
 * navigation pass): only a same-origin, path-relative URL is ever honored.
 * Rejects absolute URLs (`https://evil.example`) and protocol-relative ones
 * (`//evil.example`, which browsers resolve against the current scheme).
 */
export function isSafeRelativeUrl(url: string): boolean {
  return url.startsWith("/") && !url.startsWith("//") && !url.includes("://");
}
