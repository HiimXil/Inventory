// @vitest-environment node
//
// happy-dom (the project's default test environment) provides its own realm
// for globals like Uint8Array/TextEncoder. @auth/core's JWT encode/decode
// (via @panva/hkdf) does a strict `instanceof Uint8Array` check that fails
// against happy-dom's realm, silently breaking session decoding (decode()
// throws internally and the caller swallows it, returning null) even though
// the exact same code works under plain Node. This file needs real Node
// globals, hence the environment override.
import { afterAll, describe, expect, it } from "vitest";
import { authenticateWithCredentials } from "../../lib/auth/credentials-login";
import { getServerAuthSession } from "../../lib/auth/session";
import { prisma } from "../../lib/db/client";

const SEED_PASSWORD = "Password123!";

const SEEDED_USERS: Array<{ email: string; role: string }> = [
  { email: "admin@example.com", role: "ADMIN" },
  { email: "depot@example.com", role: "DEPOT_MANAGER" },
  { email: "logistics@example.com", role: "LOGISTICS" },
  { email: "direction@example.com", role: "DIRECTION" },
];

function cookieHeaderFrom(cookies: Array<{ name: string; value: string }>): string {
  return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
}

describe("authenticateWithCredentials", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it.each(SEEDED_USERS)(
    "logs in $role with the seeded password and yields a session carrying that role",
    async ({ email, role }) => {
      const result = await authenticateWithCredentials(email, SEED_PASSWORD);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.role).toBe(role);
      expect(result.cookies.length).toBeGreaterThan(0);

      // Prove the returned cookies actually establish a working session,
      // using the exact same session-resolution path the rest of the app
      // uses (lib/auth/session.ts), not a hand-decoded token.
      const session = await getServerAuthSession(cookieHeaderFrom(result.cookies));
      expect(session).not.toBeNull();
      expect(session?.user.email).toBe(email);
      expect(session?.user.role).toBe(role);
    },
  );

  it("rejects a wrong password with a generic message and creates no session", async () => {
    const result = await authenticateWithCredentials("admin@example.com", "wrong-password");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("Identifiants invalides.");
  });

  it("rejects an unknown email with the SAME generic message (no user-enumeration hint)", async () => {
    const result = await authenticateWithCredentials("nobody@example.com", "whatever123");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("Identifiants invalides.");
  });
});
