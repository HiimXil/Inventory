import { readFile } from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../lib/db/client";
import { runPrepareSession, type PrepareSessionActor } from "../../lib/sessions/prepare-session";

const FIXTURE_PATH = path.join(__dirname, "../fixtures/artis-export-example.xlsx");

const TEST_DEPOTS = [
  { code: "FILE-IMPORT-A", name: "File Import Depot A" },
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
  const sheet = workbook.addWorksheet("a_Article");
  sheet.addRow(["Code", "", "Référence", "Libellé", "Empl", "Stock physique"]);
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

describe("runPrepareSession — ARTIS_MODE=file, real export (primary import path)", () => {
  it("creates a PREPARED session with 98 lines, theoreticalQty from Stock physique (not Qté théorique)", async () => {
    const outcome = await runPrepareSession(depots["FILE-IMPORT-A"].id, admin, {
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
    expect(line?.theoreticalQty).not.toBe(8);

    const noRefLine = session?.lines.find((l) => l.articleRef === "DEMO-0002");
    expect(noRefLine).toBeDefined();
  });
});

describe("runPrepareSession — ARTIS_MODE=file, rejections create no session", () => {
  it("refuses a duplicated Code", async () => {
    const buffer = await invalidWorkbookBuffer([
      ["F000001", null, "000001", "First", null, 1],
      ["F000001", null, "000002", "Duplicate", null, 2],
    ]);

    const outcome = await runPrepareSession(depots["FILE-IMPORT-B"].id, admin, { fileBuffer: buffer });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error).toMatch(/dupliqué/);

    const count = await prisma.inventorySession.count({ where: { depotId: depots["FILE-IMPORT-B"].id } });
    expect(count).toBe(0);
  });

  it("refuses a negative quantity", async () => {
    const buffer = await invalidWorkbookBuffer([["F000001", null, "000001", "Negative", null, -1]]);

    const outcome = await runPrepareSession(depots["FILE-IMPORT-B"].id, admin, { fileBuffer: buffer });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error).toMatch(/négatif/);

    const count = await prisma.inventorySession.count({ where: { depotId: depots["FILE-IMPORT-B"].id } });
    expect(count).toBe(0);
  });

  it("refuses a non-.xlsx file", async () => {
    const outcome = await runPrepareSession(depots["FILE-IMPORT-B"].id, admin, {
      fileBuffer: Buffer.from("not an xlsx"),
    });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error).toMatch(/valide/);

    const count = await prisma.inventorySession.count({ where: { depotId: depots["FILE-IMPORT-B"].id } });
    expect(count).toBe(0);
  });

  it("refuses an empty file", async () => {
    const outcome = await runPrepareSession(depots["FILE-IMPORT-B"].id, admin, {
      fileBuffer: Buffer.alloc(0),
    });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;

    const count = await prisma.inventorySession.count({ where: { depotId: depots["FILE-IMPORT-B"].id } });
    expect(count).toBe(0);
  });

  it("refuses missing required columns, naming them", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("a_Article");
    sheet.addRow(["Code", "Libellé"]);
    sheet.addRow(["F000001", "Missing Stock physique column"]);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    const outcome = await runPrepareSession(depots["FILE-IMPORT-C"].id, admin, { fileBuffer: buffer });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error).toMatch(/Stock physique/);

    const count = await prisma.inventorySession.count({ where: { depotId: depots["FILE-IMPORT-C"].id } });
    expect(count).toBe(0);
  });

  it("refuses when no file is provided at all in file mode", async () => {
    const outcome = await runPrepareSession(depots["FILE-IMPORT-C"].id, admin, {});

    expect(outcome.ok).toBe(false);
    const count = await prisma.inventorySession.count({ where: { depotId: depots["FILE-IMPORT-C"].id } });
    expect(count).toBe(0);
  });
});
