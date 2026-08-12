import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { buildInventoryWorkbook, buildExportFilename, type ExportLine } from "../../lib/export/excel";

const LINES: ExportLine[] = [
  { articleRef: "ART-001", designation: "Imprimante UV", theoreticalQty: 12, countedQty: 12, isOffReferential: false },
  { articleRef: "ART-002", designation: "Encre cyan", theoreticalQty: 48, countedQty: 40, isOffReferential: false },
  { articleRef: "ART-003", designation: "Plaque aluminium", theoreticalQty: 24, countedQty: null, isOffReferential: false },
  { articleRef: "OFF-REF-1", designation: null, theoreticalQty: 0, countedQty: 3, isOffReferential: true },
];

async function loadWorkbook(lines: ExportLine[]) {
  const workbook = buildInventoryWorkbook("PAR01", lines);
  const buffer = await workbook.xlsx.writeBuffer();
  const reloaded = new ExcelJS.Workbook();
  await reloaded.xlsx.load(buffer);
  return reloaded;
}

describe("buildInventoryWorkbook", () => {
  it("has exactly two sheets: 'Inventaire complet' and 'Écarts'", async () => {
    const workbook = await loadWorkbook(LINES);
    expect(workbook.worksheets.map((s) => s.name)).toEqual(["Inventaire complet", "Écarts"]);
  });

  it("'Inventaire complet' contains every line, header included", async () => {
    const workbook = await loadWorkbook(LINES);
    const sheet = workbook.getWorksheet("Inventaire complet")!;
    expect(sheet.rowCount).toBe(1 + LINES.length);
    expect(sheet.getRow(1).values).toEqual([
      undefined,
      "Référence",
      "Désignation",
      "Dépôt",
      "Stock théorique",
      "Stock compté",
      "Écart",
    ]);
  });

  it("'Écarts' contains ONLY lines where ecart != 0", async () => {
    const workbook = await loadWorkbook(LINES);
    const sheet = workbook.getWorksheet("Écarts")!;
    // ART-001 (12-12=0) excluded; ART-002 (40-48=-8), ART-003 (0-24=-24),
    // OFF-REF-1 (3-0=3) included.
    expect(sheet.rowCount).toBe(1 + 3);
    const refs = sheet.getRows(2, 3)!.map((row) => row.getCell(1).value);
    expect(refs).toEqual(["ART-002", "ART-003", "OFF-REF-1"]);
  });

  it("labels off-referential lines with designation 'Hors référentiel' and theoretical 0", async () => {
    const workbook = await loadWorkbook(LINES);
    const sheet = workbook.getWorksheet("Inventaire complet")!;
    const row = sheet.getRows(2, LINES.length)!.find((r) => r.getCell(1).value === "OFF-REF-1")!;
    expect(row.getCell(2).value).toBe("Hors référentiel");
    expect(row.getCell(4).value).toBe(0);
    expect(row.getCell(6).value).toBe(3);
  });

  it("treats a never-counted line (countedQty null) as 0 for both the cell value and the ecart", async () => {
    const workbook = await loadWorkbook(LINES);
    const sheet = workbook.getWorksheet("Inventaire complet")!;
    const row = sheet.getRows(2, LINES.length)!.find((r) => r.getCell(1).value === "ART-003")!;
    expect(row.getCell(5).value).toBe(0);
    expect(row.getCell(6).value).toBe(-24);
  });

  it("highlights gap rows in red (fill) in both sheets, and leaves conforming rows unstyled", async () => {
    const workbook = await loadWorkbook(LINES);
    const fullSheet = workbook.getWorksheet("Inventaire complet")!;

    const conformRow = fullSheet.getRows(2, LINES.length)!.find((r) => r.getCell(1).value === "ART-001")!;
    expect(conformRow.getCell(1).fill).toBeUndefined();

    const gapRow = fullSheet.getRows(2, LINES.length)!.find((r) => r.getCell(1).value === "ART-002")!;
    const fill = gapRow.getCell(1).fill as ExcelJS.FillPattern;
    expect(fill.type).toBe("pattern");
    expect(fill.fgColor?.argb).toBe("FFFFC7CE");

    const gapsSheet = workbook.getWorksheet("Écarts")!;
    const gapsRow = gapsSheet.getRows(2, 3)!.find((r) => r.getCell(1).value === "ART-002")!;
    const gapsFill = gapsRow.getCell(1).fill as ExcelJS.FillPattern;
    expect(gapsFill.fgColor?.argb).toBe("FFFFC7CE");
  });
});

describe("buildExportFilename", () => {
  it("matches inventaire_{depot}_{AAAAMMJJ-HHmm}.xlsx", () => {
    const filename = buildExportFilename("PAR01", new Date("2026-03-05T14:32:00"));
    expect(filename).toBe("inventaire_PAR01_20260305-1432.xlsx");
  });

  it("zero-pads month/day/hour/minute", () => {
    const filename = buildExportFilename("LYO01", new Date("2026-01-02T03:04:00"));
    expect(filename).toBe("inventaire_LYO01_20260102-0304.xlsx");
  });
});
