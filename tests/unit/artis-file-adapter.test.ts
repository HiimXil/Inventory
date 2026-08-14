import { readFile } from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { ArtisFileAdapter } from "../../lib/artis/file";
import { ArtisFileFormatError, ArtisFileValidationError } from "../../lib/artis/errors";

const FIXTURE_PATH = path.join(__dirname, "../fixtures/artis-export-example.xlsx");
// Matches the "Code dépôt" baked into the committed fixture — see the
// generator this fixture was built with (US8, new ARTIS format).
const FIXTURE_DEPOT_CODE = "FIXTURE-DEPOT";

async function loadFixtureBuffer(): Promise<Buffer> {
  return readFile(FIXTURE_PATH);
}

/**
 * Builds a minimal, valid-by-default ARTIS-shaped workbook in memory so
 * rejection cases can be tested without depending on hand-crafted fixture
 * files for every edge case — only the real fixture is used for the
 * happy-path/real-data assertions. Default row's "Code dépôt" (0101)
 * intentionally matches the depot code most tests below select, so a test
 * only about, say, a missing column doesn't also incidentally trip the
 * depot-mismatch check.
 */
async function buildWorkbookBuffer(options: {
  sheetName?: string;
  headers?: string[];
  rows?: Array<Array<string | number | null>>;
} = {}): Promise<Buffer> {
  const {
    sheetName = "a_ResultatsRecherche",
    headers = ["Code art.", "Libellé art.", "Référence fournisseur", "Qté en Stock", "Code dépôt"],
    rows = [["F000001", "Test article", "000001", 5, "0101"]],
  } = options;

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName);
  sheet.addRow(headers);
  for (const row of rows) sheet.addRow(row);

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

describe("ArtisFileAdapter — real fixture (FR-029 primary import path, US8 new export format)", () => {
  it("parses all 98 data rows from the real export", async () => {
    const adapter = new ArtisFileAdapter(await loadFixtureBuffer());
    const page = await adapter.getTheoreticalStock(FIXTURE_DEPOT_CODE, 1);

    expect(page.pageCount).toBe(1);
    expect(page.items).toHaveLength(98);
  });

  it("maps 'Code art.' to articleRef and 'Qté en Stock' to qty — the only quantity column now", async () => {
    const adapter = new ArtisFileAdapter(await loadFixtureBuffer());
    const page = await adapter.getTheoreticalStock(FIXTURE_DEPOT_CODE, 1);

    const line = page.items.find((item) => item.articleRef === "DEMO-0001");
    expect(line).toBeDefined();
    expect(line?.designation).toBe("Article de démonstration (filtre)");
    expect(line?.qty).toBe(9);
    expect(line?.supplierRef).toBe("R-0001");
  });

  it("imports a row with an empty 'Référence fournisseur' as supplierRef: null, still keyed by Code art.", async () => {
    const adapter = new ArtisFileAdapter(await loadFixtureBuffer());
    const page = await adapter.getTheoreticalStock(FIXTURE_DEPOT_CODE, 1);

    const line = page.items.find((item) => item.articleRef === "DEMO-0002");
    expect(line).toBeDefined();
    expect(line?.designation).toBe("Article de démonstration (sans référence)");
    expect(line?.qty).toBe(1);
    expect(line?.supplierRef).toBeNull();
  });

  it("ignores columns it doesn't need (Libellé dépôt, Empl., Activité, Famille, Marque, ...) without error", async () => {
    // The real fixture already has all of these (confirmed above by parsing
    // successfully) — this makes the intent explicit regardless of the
    // fixture's incidental structure.
    const buffer = await buildWorkbookBuffer({
      headers: [
        "Code art.",
        "Libellé art.",
        "Référence fournisseur",
        "Qté en Stock",
        "Empl.",
        "Code dépôt",
        "Libellé dépôt",
        "Activité",
        "Famille",
        "Sous famille",
        "Marque",
        "Nom fournisseur",
      ],
      rows: [
        [
          "F000001",
          "Ignored columns test",
          "000001",
          3,
          "A1",
          "0101",
          "Some depot label",
          "Some activity",
          "Some family",
          "Some subfamily",
          "Some brand",
          "Some supplier",
        ],
      ],
    });
    const adapter = new ArtisFileAdapter(buffer);
    const page = await adapter.getTheoreticalStock("0101", 1);

    expect(page.items).toEqual([
      { articleRef: "F000001", designation: "Ignored columns test", supplierRef: "000001", qty: 3 },
    ]);
  });

  it("returns an empty page for any page beyond 1 (no real pagination)", async () => {
    const adapter = new ArtisFileAdapter(await loadFixtureBuffer());
    const page2 = await adapter.getTheoreticalStock(FIXTURE_DEPOT_CODE, 2);
    expect(page2).toEqual({ depotCode: FIXTURE_DEPOT_CODE, page: 2, pageCount: 1, items: [] });
  });

  it("listDepots() returns an empty list — not applicable in file mode", async () => {
    const adapter = new ArtisFileAdapter(await loadFixtureBuffer());
    await expect(adapter.listDepots()).resolves.toEqual([]);
  });
});

describe("ArtisFileAdapter — depot verification (US8, new)", () => {
  it("refuses a file whose single depot code differs from the one selected", async () => {
    const buffer = await buildWorkbookBuffer({
      rows: [["F000001", "Wrong depot test", "000001", 5, "01V9"]],
    });
    const adapter = new ArtisFileAdapter(buffer);

    await expect(adapter.getTheoreticalStock("0101", 1)).rejects.toThrow(
      /concerne le dépôt 01V9.*sélectionné 0101/,
    );
  });

  it("refuses a file mixing several depot codes, even if one of them matches the selection", async () => {
    const buffer = await buildWorkbookBuffer({
      rows: [
        ["F000001", "Row for depot A", "000001", 5, "0101"],
        ["F000002", "Row for depot B", "000002", 3, "01V9"],
      ],
    });
    const adapter = new ArtisFileAdapter(buffer);

    await expect(adapter.getTheoreticalStock("0101", 1)).rejects.toThrow(/mélange plusieurs dépôts/);
  });

  it("accepts a file whose homogeneous depot code matches the selection", async () => {
    const buffer = await buildWorkbookBuffer({
      rows: [["F000001", "Matching depot", "000001", 5, "0101"]],
    });
    const adapter = new ArtisFileAdapter(buffer);

    const page = await adapter.getTheoreticalStock("0101", 1);
    expect(page.items).toHaveLength(1);
  });
});

describe("ArtisFileAdapter — rejections, no session should ever be created from these", () => {
  it("refuses a file missing required columns, naming them", async () => {
    const buffer = await buildWorkbookBuffer({
      headers: ["Code art.", "Libellé art."], // "Qté en Stock" and "Code dépôt" missing
      rows: [["F000001", "Missing columns"]],
    });
    const adapter = new ArtisFileAdapter(buffer);

    await expect(adapter.getTheoreticalStock("0101", 1)).rejects.toThrow(ArtisFileValidationError);
    await expect(adapter.getTheoreticalStock("0101", 1)).rejects.toThrow(/Qté en Stock/);
    await expect(adapter.getTheoreticalStock("0101", 1)).rejects.toThrow(/Code dépôt/);
  });

  it("refuses a file with no exploitable rows", async () => {
    const buffer = await buildWorkbookBuffer({ rows: [] });
    const adapter = new ArtisFileAdapter(buffer);

    await expect(adapter.getTheoreticalStock("0101", 1)).rejects.toThrow(ArtisFileValidationError);
    await expect(adapter.getTheoreticalStock("0101", 1)).rejects.toThrow(/aucune ligne exploitable/);
  });

  it("refuses a duplicated Code art.", async () => {
    const buffer = await buildWorkbookBuffer({
      rows: [
        ["F000001", "First", "000001", 1, "0101"],
        ["F000001", "Duplicate code", "000002", 2, "0101"],
      ],
    });
    const adapter = new ArtisFileAdapter(buffer);

    await expect(adapter.getTheoreticalStock("0101", 1)).rejects.toThrow(/dupliqué/);
  });

  it("refuses an empty Code art.", async () => {
    const buffer = await buildWorkbookBuffer({
      rows: [[null, "No code", "000001", 1, "0101"]],
    });
    const adapter = new ArtisFileAdapter(buffer);

    await expect(adapter.getTheoreticalStock("0101", 1)).rejects.toThrow(/vide/);
  });

  it("refuses a negative quantity", async () => {
    const buffer = await buildWorkbookBuffer({
      rows: [["F000001", "Negative stock", "000001", -3, "0101"]],
    });
    const adapter = new ArtisFileAdapter(buffer);

    await expect(adapter.getTheoreticalStock("0101", 1)).rejects.toThrow(/négative/);
  });

  it("refuses a non-integer quantity", async () => {
    const buffer = await buildWorkbookBuffer({
      rows: [["F000001", "Fractional stock", "000001", 2.5, "0101"]],
    });
    const adapter = new ArtisFileAdapter(buffer);

    await expect(adapter.getTheoreticalStock("0101", 1)).rejects.toThrow(/entier/);
  });

  it("refuses a non-numeric quantity", async () => {
    const buffer = await buildWorkbookBuffer({
      rows: [["F000001", "Text stock", "000001", "beaucoup", "0101"]],
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

  it("refuses a file whose 'a_ResultatsRecherche' sheet is absent — the old 'a_Article' format is retired, no fallback", async () => {
    const buffer = await buildWorkbookBuffer({
      sheetName: "a_Article",
      rows: [["F000001", "Old sheet name", "000001", 4, "0101"]],
    });
    const adapter = new ArtisFileAdapter(buffer);

    await expect(adapter.getTheoreticalStock("0101", 1)).rejects.toThrow(ArtisFileFormatError);
    await expect(adapter.getTheoreticalStock("0101", 1)).rejects.toThrow(/a_ResultatsRecherche/);
  });
});
