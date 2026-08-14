import { readFile } from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../lib/db/client";
import { runPrepareSession, type PrepareSessionActor } from "../../lib/sessions/prepare-session";

const FIXTURE_PATH = path.join(__dirname, "../fixtures/artis-export-example.xlsx");
// Must match the "Code dépôt" baked into the fixture (US8 new format) — the
// happy-path test below selects this exact depot so the new depot-check
// doesn't reject it.
const FIXTURE_DEPOT_CODE = "FIXTURE-DEPOT";

const TEST_DEPOTS = [
  { code: FIXTURE_DEPOT_CODE, name: "File Import Fixture Depot" },
  { code: "FILE-IMPORT-B", name: "File Import Depot B" },
  { code: "FILE-IMPORT-C", name: "File Import Depot C" },
];

let depots: Record<string, { id: string; code: string }>;
let admin: PrepareSessionActor;

async function resetSessionData() {
  await prisma.auditLog.deleteMany({});
  await prisma.inventoryLine.deleteMany({});
  await prisma.inventorySession.deleteMany({});
}

async function realFixtureBuffer(): Promise<Buffer> {
  return readFile(FIXTURE_PATH);
}

async function invalidWorkbookBuffer(rows: Array<Array<string | number | null>>): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("a_ResultatsRecherche");
  sheet.addRow(["Code art.", "Libellé art.", "Référence fournisseur", "Qté en Stock", "Code dépôt"]);
  for (const row of rows) sheet.addRow(row);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

beforeAll(async () => {
  for (const d of TEST_DEPOTS) {
    await prisma.depot.upsert({ where: { code: d.code }, update: {}, create: d });
  }
  const created = await prisma.depot.findMany({ where: { code: { in: TEST_DEPOTS.map((d) => d.code) } } });
  depots = Object.fromEntries(created.map((d) => [d.code, { id: d.id, code: d.code }]));

  const adminUser = await prisma.user.findUniqueOrThrow({ where: { email: "admin@example.com" } });
  admin = { id: adminUser.id, role: "ADMIN" };
});

afterAll(async () => {
  await resetSessionData();
  await prisma.depot.deleteMany({ where: { code: { in: TEST_DEPOTS.map((d) => d.code) } } });
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetSessionData();
  process.env.ARTIS_MODE = "file";
});

afterEach(() => {
  delete process.env.ARTIS_MODE;
  delete process.env.ARTIS_FIXTURE;
});

describe("runPrepareSession — ARTIS_MODE=file, real export (primary import path, US8 new format)", () => {
  it("creates a PREPARED session with 98 lines, theoreticalQty from Qté en Stock, supplierRef carried through", async () => {
    const outcome = await runPrepareSession(depots[FIXTURE_DEPOT_CODE].id, admin, admin.id, {
      fileBuffer: await realFixtureBuffer(),
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.lineCount).toBe(98);

    const session = await prisma.inventorySession.findUnique({
      where: { id: outcome.sessionId },
      include: { lines: true },
    });
    expect(session?.status).toBe("PREPARED");
    expect(session?.lines).toHaveLength(98);

    const line = session?.lines.find((l) => l.articleRef === "DEMO-0001");
    expect(line?.designation).toBe("Article de démonstration (filtre)");
    expect(line?.theoreticalQty).toBe(9);
    expect(line?.supplierRef).toBe("R-0001");

    const noRefLine = session?.lines.find((l) => l.articleRef === "DEMO-0002");
    expect(noRefLine).toBeDefined();
    expect(noRefLine?.supplierRef).toBeNull();
  });
});

describe("runPrepareSession — ARTIS_MODE=file, rejections create no session", () => {
  it("refuses a duplicated Code art.", async () => {
    const buffer = await invalidWorkbookBuffer([
      ["F000001", "First", "000001", 1, "FILE-IMPORT-B"],
      ["F000001", "Duplicate", "000002", 2, "FILE-IMPORT-B"],
    ]);

    const outcome = await runPrepareSession(depots["FILE-IMPORT-B"].id, admin, admin.id, { fileBuffer: buffer });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error).toMatch(/dupliqué/);

    const count = await prisma.inventorySession.count({ where: { depotId: depots["FILE-IMPORT-B"].id } });
    expect(count).toBe(0);
  });

  it("refuses a negative quantity", async () => {
    const buffer = await invalidWorkbookBuffer([["F000001", "Negative", "000001", -1, "FILE-IMPORT-B"]]);

    const outcome = await runPrepareSession(depots["FILE-IMPORT-B"].id, admin, admin.id, { fileBuffer: buffer });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error).toMatch(/négative/);

    const count = await prisma.inventorySession.count({ where: { depotId: depots["FILE-IMPORT-B"].id } });
    expect(count).toBe(0);
  });

  it("refuses a non-.xlsx file", async () => {
    const outcome = await runPrepareSession(depots["FILE-IMPORT-B"].id, admin, admin.id, {
      fileBuffer: Buffer.from("not an xlsx"),
    });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error).toMatch(/valide/);

    const count = await prisma.inventorySession.count({ where: { depotId: depots["FILE-IMPORT-B"].id } });
    expect(count).toBe(0);
  });

  it("refuses an empty file", async () => {
    const outcome = await runPrepareSession(depots["FILE-IMPORT-B"].id, admin, admin.id, {
      fileBuffer: Buffer.alloc(0),
    });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;

    const count = await prisma.inventorySession.count({ where: { depotId: depots["FILE-IMPORT-B"].id } });
    expect(count).toBe(0);
  });

  it("refuses missing required columns, naming them", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("a_ResultatsRecherche");
    sheet.addRow(["Code art.", "Libellé art."]);
    sheet.addRow(["F000001", "Missing Qté en Stock and Code dépôt columns"]);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    const outcome = await runPrepareSession(depots["FILE-IMPORT-C"].id, admin, admin.id, { fileBuffer: buffer });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error).toMatch(/Qté en Stock/);
    expect(outcome.error).toMatch(/Code dépôt/);

    const count = await prisma.inventorySession.count({ where: { depotId: depots["FILE-IMPORT-C"].id } });
    expect(count).toBe(0);
  });

  it("refuses when no file is provided at all in file mode", async () => {
    const outcome = await runPrepareSession(depots["FILE-IMPORT-C"].id, admin, admin.id, {});

    expect(outcome.ok).toBe(false);
    const count = await prisma.inventorySession.count({ where: { depotId: depots["FILE-IMPORT-C"].id } });
    expect(count).toBe(0);
  });

  it("refuses a file whose depot code doesn't match the depot selected in the UI", async () => {
    const buffer = await invalidWorkbookBuffer([["F000001", "Wrong depot", "000001", 5, "SOME-OTHER-DEPOT"]]);

    const outcome = await runPrepareSession(depots["FILE-IMPORT-C"].id, admin, admin.id, { fileBuffer: buffer });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error).toMatch(/concerne le dépôt SOME-OTHER-DEPOT/);
    expect(outcome.error).toMatch(new RegExp(`sélectionné ${depots["FILE-IMPORT-C"].code}`));

    const count = await prisma.inventorySession.count({ where: { depotId: depots["FILE-IMPORT-C"].id } });
    expect(count).toBe(0);
  });

  it("refuses a file mixing several depot codes", async () => {
    const buffer = await invalidWorkbookBuffer([
      ["F000001", "Row A", "000001", 1, "FILE-IMPORT-B"],
      ["F000002", "Row B", "000002", 2, "FILE-IMPORT-C"],
    ]);

    const outcome = await runPrepareSession(depots["FILE-IMPORT-B"].id, admin, admin.id, { fileBuffer: buffer });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error).toMatch(/mélange plusieurs dépôts/);

    const count = await prisma.inventorySession.count({ where: { depotId: depots["FILE-IMPORT-B"].id } });
    expect(count).toBe(0);
  });
});
