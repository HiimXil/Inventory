// @vitest-environment node
//
// Same reason as tests/unit/login.test.ts: @auth/core's JWT decode needs
// real Node globals, which happy-dom's realm breaks silently.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GET as bootstrapGet } from "../../app/api/sessions/[id]/bootstrap/route";
import { authenticateWithCredentials } from "../../lib/auth/credentials-login";
import { prisma } from "../../lib/db/client";
import { runPrepareSession } from "../../lib/sessions/prepare-session";

const SEED_PASSWORD = "Password123!";
const DEPOT = { code: "BOOTSTRAP-RBAC-A", name: "Bootstrap RBAC Depot" };

function cookieHeaderFrom(cookies: Array<{ name: string; value: string }>): string {
  return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
}

async function cookiesFor(email: string): Promise<string> {
  const result = await authenticateWithCredentials(email, SEED_PASSWORD);
  if (!result.ok) throw new Error(`login failed for ${email} in test setup`);
  return cookieHeaderFrom(result.cookies);
}

async function callBootstrap(sessionId: string, cookieHeader: string | null) {
  const request = new Request(`http://localhost/api/sessions/${sessionId}/bootstrap`, {
    headers: cookieHeader ? { cookie: cookieHeader } : undefined,
  });
  return bootstrapGet(request, { params: Promise.resolve({ id: sessionId }) });
}

let depotId: string;

async function prepareTestSession() {
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: "admin@example.com" } });
  const outcome = await runPrepareSession(depotId, { id: admin.id, role: "ADMIN" });
  if (!outcome.ok) throw new Error(`prepare failed in test setup: ${outcome.error}`);
  return outcome.sessionId;
}

beforeAll(async () => {
  const depot = await prisma.depot.upsert({ where: { code: DEPOT.code }, update: {}, create: DEPOT });
  depotId = depot.id;
  process.env.ARTIS_MODE = "mock";
  process.env.ARTIS_FIXTURE = "normal";
});

beforeEach(async () => {
  await prisma.auditLog.deleteMany({ where: { sessionId: { not: null } } });
  await prisma.inventoryLine.deleteMany({});
  await prisma.inventorySession.deleteMany({});
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { sessionId: { not: null } } });
  await prisma.inventoryLine.deleteMany({});
  await prisma.inventorySession.deleteMany({});
  await prisma.depot.deleteMany({ where: { code: DEPOT.code } });
  await prisma.$disconnect();
});

describe("GET /api/sessions/[id]/bootstrap — RBAC (COUNT, FR-027/FR-028)", () => {
  it.each(["admin@example.com", "depot@example.com", "logistics@example.com"])(
    "allows %s (COUNT permission)",
    async (email) => {
      const sessionId = await prepareTestSession();
      const cookie = await cookiesFor(email);

      const response = await callBootstrap(sessionId, cookie);

      expect(response.status).toBe(200);
      const body = (await response.json()) as { session: { id: string } };
      expect(body.session.id).toBe(sessionId);
    },
  );

  it("denies DIRECTION (403) and journalizes BOOTSTRAP_DENIED", async () => {
    const sessionId = await prepareTestSession();
    const cookie = await cookiesFor("direction@example.com");

    const response = await callBootstrap(sessionId, cookie);

    expect(response.status).toBe(403);

    const direction = await prisma.user.findUniqueOrThrow({ where: { email: "direction@example.com" } });
    const denied = await prisma.auditLog.findFirst({
      where: { sessionId, actorId: direction.id, action: "BOOTSTRAP_DENIED" },
    });
    expect(denied).not.toBeNull();
  });

  it("denies an unauthenticated caller (401) and journalizes BOOTSTRAP_DENIED", async () => {
    const sessionId = await prepareTestSession();

    const response = await callBootstrap(sessionId, null);

    expect(response.status).toBe(401);

    const denied = await prisma.auditLog.findFirst({
      where: { sessionId, actorId: null, action: "BOOTSTRAP_DENIED" },
    });
    expect(denied).not.toBeNull();
  });
});
