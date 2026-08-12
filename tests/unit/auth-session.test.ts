import { afterAll, describe, expect, it } from "vitest";
import { authOptions } from "../../lib/auth/options";
import { prisma } from "../../lib/db/client";

type CredentialsAuthorize = (
  credentials: Record<string, unknown>,
  request: Request,
) => Promise<{ id: string; name: string | null; email: string; role: string } | null>;

const seededUsers: Array<{ role: string; email: string }> = [
  { role: "ADMIN", email: "admin@example.com" },
  { role: "DEPOT_MANAGER", email: "depot@example.com" },
  { role: "LOGISTICS", email: "logistics@example.com" },
  { role: "DIRECTION", email: "direction@example.com" },
];

const SEED_PASSWORD = "Password123!";

function getAuthorize(): CredentialsAuthorize {
  // @auth/core's Credentials() factory stores the user-supplied config
  // (including the real `authorize`) under `.options`; the top-level
  // `authorize` property is a stub that always returns null until
  // Auth.js merges `.options` over the defaults at request time.
  const provider = authOptions.providers[0] as unknown as {
    options: { authorize: CredentialsAuthorize };
  };
  return provider.options.authorize;
}

describe("Auth.js credentials -> jwt -> session role propagation", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it.each(seededUsers)(
    "propagates role $role from authorize() through jwt() and session() callbacks",
    async ({ role, email }) => {
      const authorize = getAuthorize();
      const request = new Request("http://localhost/api/auth/callback/credentials");

      const user = await authorize({ email, password: SEED_PASSWORD }, request);
      expect(user).not.toBeNull();
      expect(user?.role).toBe(role);

      const token = await authOptions.callbacks!.jwt!({
        token: {},
        user: user as never,
      } as never);
      expect((token as { role?: string }).role).toBe(role);

      const session = (await authOptions.callbacks!.session!({
        session: { user: {}, expires: "2099-01-01" } as never,
        token,
      } as never)) as unknown as { user: { role?: string } };

      expect(session.user).toBeDefined();
      expect(session.user.role).toBeDefined();
      expect(session.user.role).toBe(role);
    },
  );

  it("rejects invalid credentials and never reaches the session", async () => {
    const authorize = getAuthorize();
    const request = new Request("http://localhost/api/auth/callback/credentials");

    const user = await authorize(
      { email: "admin@example.com", password: "wrong-password" },
      request,
    );
    expect(user).toBeNull();
  });
});
