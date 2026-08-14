import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../../lib/db/client";
import { runPrepareSession, type PrepareSessionActor } from "../../lib/sessions/prepare-session";
import { ArtisHttpError, ArtisNetworkError } from "../../lib/artis/errors";
import type { ArtisAdapter, ArtisStockPage } from "../../lib/artis/interface";
import { SESSION_EXPIRED_MESSAGE } from "../../lib/auth/verify-active-user";

vi.mock("../../lib/artis/factory", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/artis/factory")>();
  return { ...actual, getArtisAdapter: vi.fn(actual.getArtisAdapter) };
});

import { getArtisAdapter } from "../../lib/artis/factory";

const TEST_DEPOTS = [
  { code: "TST-A", name: "Test Depot A" },
  { code: "TST-B", name: "Test Depot B" },
  { code: "TST-C", name: "Test Depot C" },
  { code: "TST-D", name: "Test Depot D" },
  { code: "TST-E", name: "Test Depot E" },
  { code: "TST-F", name: "Test Depot F" },
  { code: "TST-G", name: "Test Depot G" },
  { code: "TST-H", name: "Test Depot H" },
  { code: "TST-I", name: "Test Depot I" },
  { code: "TST-J", name: "Test Depot J" },
  { code: "TST-K", name: "Test Depot K" },
];

let depots: Record<string, { id: string; code: string }>;
let actors: Record<"ADMIN" | "DEPOT_MANAGER" | "LOGISTICS" | "DIRECTION", PrepareSessionActor>;

async function resetSessionData() {
  await prisma.auditLog.deleteMany({});
  await prisma.inventoryLine.deleteMany({});
  await prisma.inventorySession.deleteMany({});
}

beforeAll(async () => {
  for (const d of TEST_DEPOTS) {
    await prisma.depot.upsert({
      where: { code: d.code },
      update: {},
      create: d,
    });
  }
  const created = await prisma.depot.findMany({
    where: { code: { in: TEST_DEPOTS.map((d) => d.code) } },
  });
  depots = Object.fromEntries(created.map((d) => [d.code, { id: d.id, code: d.code }]));

  const users = await prisma.user.findMany({
    where: {
      email: {
        in: [
          "admin@example.com",
          "depot@example.com",
          "logistics@example.com",
          "direction@example.com",
        ],
      },
    },
  });
  const byEmail = Object.fromEntries(users.map((u) => [u.email, u]));
  actors = {
    ADMIN: { id: byEmail["admin@example.com"].id, role: "ADMIN" },
    DEPOT_MANAGER: { id: byEmail["depot@example.com"].id, role: "DEPOT_MANAGER" },
    LOGISTICS: { id: byEmail["logistics@example.com"].id, role: "LOGISTICS" },
    DIRECTION: { id: byEmail["direction@example.com"].id, role: "DIRECTION" },
  };
});

afterAll(async () => {
  await resetSessionData();
  await prisma.depot.deleteMany({ where: { code: { in: TEST_DEPOTS.map((d) => d.code) } } });
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetSessionData();
  process.env.ARTIS_MODE = "mock";
});

afterEach(() => {
  // Only clears call history; the pass-through-to-real-implementation set up
  // in vi.mock() above is preserved, and any `mockReturnValueOnce` queued by
  // a fault-injection test is always consumed within that same test.
  vi.mocked(getArtisAdapter).mockClear();
  delete process.env.ARTIS_FIXTURE;
});

describe("runPrepareSession — success paths", () => {
  it("creates a PREPARED session + lines + SESSION_CREATED audit log, with the assignee recorded (US7)", async () => {
    process.env.ARTIS_FIXTURE = "normal";
    const depot = depots["TST-A"];

    const result = await runPrepareSession(depot.id, actors.ADMIN, actors.LOGISTICS.id);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");

    const session = await prisma.inventorySession.findUnique({
      where: { id: result.sessionId },
      include: { lines: true, auditLogs: true },
    });
    expect(session).not.toBeNull();
    expect(session?.status).toBe("PREPARED");
    expect(session?.preparedById).toBe(actors.ADMIN.id);
    expect(session?.assignedToId).toBe(actors.LOGISTICS.id);
    expect(session?.lines.length).toBe(result.lineCount);
    expect(session?.lines.length).toBeGreaterThan(0);

    const snapshot = session?.theoreticalSnapshot as { capturedAt: string };
    expect(snapshot.capturedAt).toBeTruthy();
    expect(new Date(snapshot.capturedAt).getTime()).toBe(session?.createdAt.getTime());

    const createdLog = session?.auditLogs.find((l) => l.action === "SESSION_CREATED");
    expect(createdLog).toBeDefined();
    expect(createdLog?.actorId).toBe(actors.ADMIN.id);
    expect((createdLog?.details as { assignedToId?: string } | null)?.assignedToId).toBe(actors.LOGISTICS.id);
  });

  it("aggregates all 24 pages of the large-depot fixture into 1200 lines", async () => {
    process.env.ARTIS_FIXTURE = "paginated";
    const depot = depots["TST-B"];

    const result = await runPrepareSession(depot.id, actors.DEPOT_MANAGER, actors.LOGISTICS.id);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.lineCount).toBe(1200);

    const lineCount = await prisma.inventoryLine.count({ where: { sessionId: result.sessionId } });
    expect(lineCount).toBe(1200);
  });

  it("a DEPOT_MANAGER can prepare and assign to a different LOGISTICS user (creator != assignee)", async () => {
    process.env.ARTIS_FIXTURE = "normal";
    const depot = depots["TST-I"];

    const result = await runPrepareSession(depot.id, actors.DEPOT_MANAGER, actors.LOGISTICS.id);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    const session = await prisma.inventorySession.findUniqueOrThrow({ where: { id: result.sessionId } });
    expect(session.preparedById).toBe(actors.DEPOT_MANAGER.id);
    expect(session.assignedToId).toBe(actors.LOGISTICS.id);
  });

  it("assigning to an ADMIN or DEPOT_MANAGER (not just LOGISTICS) is allowed — anyone who can count", async () => {
    process.env.ARTIS_FIXTURE = "normal";
    const result = await runPrepareSession(depots["TST-J"].id, actors.ADMIN, actors.DEPOT_MANAGER.id);
    expect(result.ok).toBe(true);
  });
});

describe("runPrepareSession — US7 invalid assignee, no session/insert attempted", () => {
  it("a nonexistent assignedToId is refused with a distinct, actionable error", async () => {
    process.env.ARTIS_FIXTURE = "normal";
    const depot = depots["TST-K"];

    const result = await runPrepareSession(depot.id, actors.ADMIN, "nonexistent-user-id");

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.error).toMatch(/introuvable|désactivé|compter/i);
    // Distinct from the ghost-ACTOR message — this is a rejected assignee,
    // not an expired/invalid session for the caller themselves.
    expect(result.error).not.toBe(SESSION_EXPIRED_MESSAGE);

    const sessionCount = await prisma.inventorySession.count({ where: { depotId: depot.id } });
    expect(sessionCount).toBe(0);
  });

  it("a disabled user as assignee is refused, no session created", async () => {
    process.env.ARTIS_FIXTURE = "normal";
    const depot = depots["TST-A"];
    const disabledAssignee = await prisma.user.create({
      data: {
        email: `disabled-assignee-${Date.now()}@example.com`,
        passwordHash: "unused",
        role: "LOGISTICS",
        disabledAt: new Date(),
      },
    });

    try {
      const result = await runPrepareSession(depot.id, actors.ADMIN, disabledAssignee.id);

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("expected failure");
      expect(result.error).toMatch(/introuvable|désactivé|compter/i);

      const sessionCount = await prisma.inventorySession.count({ where: { depotId: depot.id } });
      expect(sessionCount).toBe(0);
    } finally {
      await prisma.user.delete({ where: { id: disabledAssignee.id } });
    }
  });

  it("a DIRECTION user as assignee is refused — DIRECTION has no COUNT permission", async () => {
    process.env.ARTIS_FIXTURE = "normal";
    const depot = depots["TST-B"];

    const result = await runPrepareSession(depot.id, actors.ADMIN, actors.DIRECTION.id);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.error).toMatch(/introuvable|désactivé|compter/i);

    const sessionCount = await prisma.inventorySession.count({ where: { depotId: depot.id } });
    expect(sessionCount).toBe(0);
  });
});

describe("runPrepareSession — import failure modes create nothing", () => {
  const failureCases: Array<{
    name: string;
    setup: () => void;
  }> = [
    { name: "empty theoretical stock (FR-023)", setup: () => (process.env.ARTIS_FIXTURE = "empty") },
    { name: "malformed ARTIS response (FR-022)", setup: () => (process.env.ARTIS_FIXTURE = "malformed") },
  ];

  it.each(failureCases)("$name -> no session persisted, explicit error", async ({ setup }) => {
    setup();
    const depot = depots["TST-C"];

    const result = await runPrepareSession(depot.id, actors.ADMIN, actors.LOGISTICS.id);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.error.length).toBeGreaterThan(0);

    const sessionCount = await prisma.inventorySession.count({ where: { depotId: depot.id } });
    const lineCount = await prisma.inventoryLine.count({});
    expect(sessionCount).toBe(0);
    expect(lineCount).toBe(0);
  });

  it("timeout -> no session persisted, explicit error", async () => {
    const depot = depots["TST-D"];
    vi.mocked(getArtisAdapter).mockReturnValueOnce({
      listDepots: async () => [],
      getTheoreticalStock: () => new Promise<ArtisStockPage>(() => {}),
    } satisfies ArtisAdapter);

    const result = await runPrepareSession(depot.id, actors.ADMIN, actors.LOGISTICS.id, { timeoutMs: 30 });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.error).toMatch(/délai/i);

    const sessionCount = await prisma.inventorySession.count({ where: { depotId: depot.id } });
    expect(sessionCount).toBe(0);
  });

  it("network error -> no session persisted, explicit error", async () => {
    const depot = depots["TST-E"];
    vi.mocked(getArtisAdapter).mockReturnValueOnce({
      listDepots: async () => [],
      getTheoreticalStock: async () => {
        throw new ArtisNetworkError("connection refused");
      },
    } satisfies ArtisAdapter);

    const result = await runPrepareSession(depot.id, actors.ADMIN, actors.LOGISTICS.id);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.error).toMatch(/réseau/i);

    const sessionCount = await prisma.inventorySession.count({ where: { depotId: depot.id } });
    expect(sessionCount).toBe(0);
  });

  it("ARTIS HTTP 5xx -> no session persisted, explicit error", async () => {
    const depot = depots["TST-F"];
    vi.mocked(getArtisAdapter).mockReturnValueOnce({
      listDepots: async () => [],
      getTheoreticalStock: async () => {
        throw new ArtisHttpError(503);
      },
    } satisfies ArtisAdapter);

    const result = await runPrepareSession(depot.id, actors.ADMIN, actors.LOGISTICS.id);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.error).toMatch(/503|serveur/i);

    const sessionCount = await prisma.inventorySession.count({ where: { depotId: depot.id } });
    expect(sessionCount).toBe(0);
  });

  it("incomplete pagination (mid-sequence failure) -> no session persisted, explicit error", async () => {
    const depot = depots["TST-G"];
    vi.mocked(getArtisAdapter).mockReturnValueOnce({
      listDepots: async () => [],
      getTheoreticalStock: async (depotCode: string, page: number) => {
        if (page === 1) {
          return {
            depotCode,
            page: 1,
            pageCount: 3,
            items: [{ articleRef: "ART-0001", designation: "Article", supplierRef: null, qty: 5 }],
          };
        }
        throw new ArtisNetworkError("connection dropped mid-pagination");
      },
    } satisfies ArtisAdapter);

    const result = await runPrepareSession(depot.id, actors.ADMIN, actors.LOGISTICS.id);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");

    const sessionCount = await prisma.inventorySession.count({ where: { depotId: depot.id } });
    const lineCount = await prisma.inventoryLine.count({});
    expect(sessionCount).toBe(0);
    expect(lineCount).toBe(0);
  });
});

describe("runPrepareSession — FR-016 single active session per depot", () => {
  it("refuses a second preparation while an active session exists for the depot", async () => {
    process.env.ARTIS_FIXTURE = "normal";
    const depot = depots["TST-H"];

    const first = await runPrepareSession(depot.id, actors.ADMIN, actors.LOGISTICS.id);
    expect(first.ok).toBe(true);

    const second = await runPrepareSession(depot.id, actors.DEPOT_MANAGER, actors.LOGISTICS.id);
    expect(second.ok).toBe(false);
    if (second.ok) throw new Error("expected failure");
    expect(second.error).toMatch(/active/i);

    const sessionCount = await prisma.inventorySession.count({ where: { depotId: depot.id } });
    expect(sessionCount).toBe(1);
  });
});

describe("runPrepareSession — RBAC (FR-027)", () => {
  it("denies LOGISTICS and journalizes the attempt", async () => {
    process.env.ARTIS_FIXTURE = "normal";
    const depot = depots["TST-A"];

    const result = await runPrepareSession(depot.id, actors.LOGISTICS, actors.LOGISTICS.id);

    expect(result.ok).toBe(false);
    const denied = await prisma.auditLog.findFirst({
      where: { actorId: actors.LOGISTICS.id, action: "SESSION_CREATE_DENIED" },
    });
    expect(denied).not.toBeNull();

    const sessionCount = await prisma.inventorySession.count({ where: { depotId: depot.id } });
    expect(sessionCount).toBe(0);
  });

  it("denies DIRECTION and journalizes the attempt", async () => {
    process.env.ARTIS_FIXTURE = "normal";
    const depot = depots["TST-B"];

    const result = await runPrepareSession(depot.id, actors.DIRECTION, actors.LOGISTICS.id);

    expect(result.ok).toBe(false);
    const denied = await prisma.auditLog.findFirst({
      where: { actorId: actors.DIRECTION.id, action: "SESSION_CREATE_DENIED" },
    });
    expect(denied).not.toBeNull();
  });

  it("allows ADMIN", async () => {
    process.env.ARTIS_FIXTURE = "normal";
    const result = await runPrepareSession(depots["TST-C"].id, actors.ADMIN, actors.LOGISTICS.id);
    expect(result.ok).toBe(true);
  });

  it("allows DEPOT_MANAGER", async () => {
    process.env.ARTIS_FIXTURE = "normal";
    const result = await runPrepareSession(depots["TST-D"].id, actors.DEPOT_MANAGER, actors.LOGISTICS.id);
    expect(result.ok).toBe(true);
  });
});

describe("runPrepareSession — ghost/disabled actor (Bug B: stale JWT after DB reset or account disabling)", () => {
  it("a userId with no matching User row -> distinct 'reconnectez-vous' error, no session/insert attempted", async () => {
    process.env.ARTIS_FIXTURE = "normal";
    const depot = depots["TST-A"];
    const ghostActor: PrepareSessionActor = { id: "nonexistent-user-id", role: "ADMIN" };

    const result = await runPrepareSession(depot.id, ghostActor, actors.LOGISTICS.id);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.error).toBe(SESSION_EXPIRED_MESSAGE);
    // distinct from every other error family: not the generic catch-all,
    // and not phrased around a file/import problem.
    expect(result.error).not.toMatch(/fichier|artis|inattendue/i);

    const sessionCount = await prisma.inventorySession.count({ where: { depotId: depot.id } });
    expect(sessionCount).toBe(0);
  });

  it("a disabled user (disabledAt set) -> same 'reconnectez-vous' treatment, no session/insert attempted", async () => {
    process.env.ARTIS_FIXTURE = "normal";
    const depot = depots["TST-B"];
    const disabledUser = await prisma.user.create({
      data: {
        email: `disabled-${Date.now()}@example.com`,
        passwordHash: "unused",
        role: "ADMIN",
        disabledAt: new Date(),
      },
    });

    try {
      const result = await runPrepareSession(depot.id, { id: disabledUser.id, role: "ADMIN" }, actors.LOGISTICS.id);

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("expected failure");
      expect(result.error).toBe(SESSION_EXPIRED_MESSAGE);

      const sessionCount = await prisma.inventorySession.count({ where: { depotId: depot.id } });
      expect(sessionCount).toBe(0);
    } finally {
      await prisma.user.delete({ where: { id: disabledUser.id } });
    }
  });

  it("a valid, active actor is unaffected (no regression)", async () => {
    process.env.ARTIS_FIXTURE = "normal";
    const result = await runPrepareSession(depots["TST-C"].id, actors.ADMIN, actors.LOGISTICS.id);
    expect(result.ok).toBe(true);
  });
});

describe("runPrepareSession — inactive depot exclusion", () => {
  it("refuses to prepare a session for a deactivated depot, even via a direct call bypassing the <select>", async () => {
    process.env.ARTIS_FIXTURE = "normal";
    const inactiveDepot = await prisma.depot.upsert({
      where: { code: "TST-INACTIVE" },
      update: { disabledAt: new Date() },
      create: { code: "TST-INACTIVE", name: "Test Depot Inactive", disabledAt: new Date() },
    });

    try {
      const result = await runPrepareSession(inactiveDepot.id, actors.ADMIN, actors.LOGISTICS.id);

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("expected failure");
      expect(result.error).toMatch(/inactif/i);

      const sessionCount = await prisma.inventorySession.count({ where: { depotId: inactiveDepot.id } });
      expect(sessionCount).toBe(0);
    } finally {
      await prisma.depot.delete({ where: { id: inactiveDepot.id } });
    }
  });
});
