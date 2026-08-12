import { readFile } from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { ArtisFileAdapter } from "../../lib/artis/file";
import { ArtisFileFormatError, ArtisFileValidationError } from "../../lib/artis/errors";

const FIXTURE_PATH = path.join(__dirname, "../fixtures/artis-export-example.xlsx");

async function loadFixtureBuffer(): Promise<Buffer> {
  return readFile(FIXTURE_PATH);
}

/**
 * Builds a minimal, valid-by-default ARTIS-shaped workbook in memory so
 * rejection cases can be tested without depending on hand-crafted fixture
 * files for every edge case — only the real fixture is used for the
 * happy-path/real-data assertions.
 */
async function buildWorkbookBuffer(options: {
  sheetName?: string;
  headers?: string[];
  rows?: Array<Array<string | number | null>>;
} = {}): Promise<Buffer> {
  const {
    sheetName = "a_Article",
    headers = ["Code", "", "Référence", "Libellé", "Empl", "Stock physique"],
    rows = [["F000001", null, "000001", "Test article", null, 5]],
  } = options;

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName);
  sheet.addRow(headers);
  for (const row of rows) sheet.addRow(row);

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

describe("ArtisFileAdapter — real fixture (FR-029 primary import path)", () => {
  it("parses all 98 data rows from the real export", async () => {
    const adapter = new ArtisFileAdapter(await loadFixtureBuffer());
    const page = await adapter.getTheoreticalStock("01V9", 1);

    expect(page.pageCount).toBe(1);
    expect(page.items).toHaveLength(98);
  });

  it("maps DEMO-0001 to qty=9 (Stock physique), never 8 (Qté théorique)", async () => {
    const adapter = new ArtisFileAdapter(await loadFixtureBuffer());
    const page = await adapter.getTheoreticalStock("01V9", 1);

    const line = page.items.find((item) => item.articleRef === "DEMO-0001");
    expect(line).toBeDefined();
    expect(line?.designation).toBe("Article de démonstration (filtre)");
    // Explicit anti-regression: "Qté théorique" for this row is 8, "Stock
    // physique" is 9 — if this ever reads 8, the wrong column got wired up.
    expect(line?.qty).toBe(9);
    expect(line?.qty).not.toBe(8);
  });

  it("imports a row with an empty Référence correctly, keyed by Code", async () => {
    const adapter = new ArtisFileAdapter(await loadFixtureBuffer());
    const page = await adapter.getTheoreticalStock("01V9", 1);

    // DEMO-0002 has no "Référence" in the fixture.
    const line = page.items.find((item) => item.articleRef === "DEMO-0002");
    expect(line).toBeDefined();
    expect(line?.designation).toBe("Article de démonstration (sans référence)");
    expect(line?.qty).toBe(1);
  });

  it("ignores the unnamed ghost column between Code and Référence without error", async () => {
    // The real file has it too (confirmed above by parsing successfully),
    // but this makes the intent explicit regardless of the fixture's
    // incidental structure.
    const buffer = await buildWorkbookBuffer({
      headers: ["Code", "", "Référence", "Libellé", "Stock physique"],
      rows: [["F000001", "should-be-ignored", "000001", "Ghost column test", 3]],
    });
    const adapter = new ArtisFileAdapter(buffer);
    const page = await adapter.getTheoreticalStock("0101", 1);

    expect(page.items).toEqual([{ articleRef: "F000001", designation: "Ghost column test", qty: 3 }]);
  });

  it("returns an empty page for any page beyond 1 (no real pagination)", async () => {
    const adapter = new ArtisFileAdapter(await loadFixtureBuffer());
    const page2 = await adapter.getTheoreticalStock("01V9", 2);
    expect(page2).toEqual({ depotCode: "01V9", page: 2, pageCount: 1, items: [] });
  });

  it("listDepots() returns an empty list — not applicable in file mode", async () => {
    const adapter = new ArtisFileAdapter(await loadFixtureBuffer());
    await expect(adapter.listDepots()).resolves.toEqual([]);
  });
});

describe("ArtisFileAdapter — rejections, no session should ever be created from these", () => {
  it("refuses a file missing a required column, naming it", async () => {
    const buffer = await buildWorkbookBuffer({
      headers: ["Code", "Libellé"], // "Stock physique" missing
      rows: [["F000001", "Missing qty column"]],
    });
    const adapter = new ArtisFileAdapter(buffer);

    await expect(adapter.getTheoreticalStock("0101", 1)).rejects.toThrow(ArtisFileValidationError);
    await expect(adapter.getTheoreticalStock("0101", 1)).rejects.toThrow(/Stock physique/);
  });

  it("refuses a file with no exploitable rows", async () => {
    const buffer = await buildWorkbookBuffer({ rows: [] });
    const adapter = new ArtisFileAdapter(buffer);

    await expect(adapter.getTheoreticalStock("0101", 1)).rejects.toThrow(ArtisFileValidationError);
    await expect(adapter.getTheoreticalStock("0101", 1)).rejects.toThrow(/aucune ligne exploitable/);
  });

  it("refuses a duplicated Code", async () => {
    const buffer = await buildWorkbookBuffer({
      rows: [
        ["F000001", null, "000001", "First", null, 1],
        ["F000001", null, "000002", "Duplicate code", null, 2],
      ],
    });
    const adapter = new ArtisFileAdapter(buffer);

    await expect(adapter.getTheoreticalStock("0101", 1)).rejects.toThrow(/dupliqué/);
  });

  it("refuses an empty Code", async () => {
    const buffer = await buildWorkbookBuffer({
      rows: [[null, null, "000001", "No code", null, 1]],
    });
    const adapter = new ArtisFileAdapter(buffer);

    await expect(adapter.getTheoreticalStock("0101", 1)).rejects.toThrow(/vide/);
  });

  it("refuses a negative quantity", async () => {
    const buffer = await buildWorkbookBuffer({
      rows: [["F000001", null, "000001", "Negative stock", null, -3]],
    });
    const adapter = new ArtisFileAdapter(buffer);

    await expect(adapter.getTheoreticalStock("0101", 1)).rejects.toThrow(/négatif/);
  });

  it("refuses a non-integer quantity", async () => {
    const buffer = await buildWorkbookBuffer({
      rows: [["F000001", null, "000001", "Fractional stock", null, 2.5]],
    });
    const adapter = new ArtisFileAdapter(buffer);

    await expect(adapter.getTheoreticalStock("0101", 1)).rejects.toThrow(/entier/);
  });

  it("refuses a non-numeric quantity", async () => {
    const buffer = await buildWorkbookBuffer({
      rows: [["F000001", null, "000001", "Text stock", null, "beaucoup"]],
    });
    const adapter = new ArtisFileAdapter(buffer);

    await expect(adapter.getTheoreticalStock("0101", 1)).rejects.toThrow(/nombre valide/);
  });

  it("refuses a non-.xlsx file", async () => {
    const buffer = Buffer.from("this is not an xlsx file, just plain text");
    const adapter = new ArtisFileAdapter(buffer);

    await expect(adapter.getTheoreticalStock("0101", 1)).rejects.toThrow(ArtisFileFormatError);
  });

  it("refuses an empty file at construction time", () => {
    expect(() => new ArtisFileAdapter(Buffer.alloc(0))).toThrow(ArtisFileFormatError);
  });

  it("refuses a file over the size limit at construction time", () => {
    const oversized = Buffer.alloc(10 * 1024 * 1024 + 1);
    expect(() => new ArtisFileAdapter(oversized)).toThrow(/taille maximale/);
  });

  it("falls back to the first sheet when 'a_Article' is absent, without throwing", async () => {
    const buffer = await buildWorkbookBuffer({
      sheetName: "AutreFeuille",
      rows: [["F000001", null, "000001", "Fallback sheet", null, 4]],
    });
    const adapter = new ArtisFileAdapter(buffer);

    const page = await adapter.getTheoreticalStock("0101", 1);
    expect(page.items).toEqual([{ articleRef: "F000001", designation: "Fallback sheet", qty: 4 }]);
  });
});
