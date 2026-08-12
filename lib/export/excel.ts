import ExcelJS from "exceljs";
import { computeEcart } from "@/lib/offline/discrepancy";

export type ExportLine = {
  articleRef: string;
  designation: string | null;
  theoreticalQty: number;
  countedQty: number | null;
  isOffReferential: boolean;
};

const HEADERS = ["Référence", "Désignation", "Dépôt", "Stock théorique", "Stock compté", "Écart"];

const GAP_FILL: ExcelJS.FillPattern = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFFFC7CE" },
};
const GAP_FONT_COLOR = { argb: "FF9C0006" };

function designationOf(line: ExportLine): string {
  return line.isOffReferential ? "Hors référentiel" : (line.designation ?? "");
}

function addInventorySheet(workbook: ExcelJS.Workbook, name: string, lines: ExportLine[], depotCode: string) {
  const sheet = workbook.addWorksheet(name);
  sheet.addRow(HEADERS).font = { bold: true };

  for (const line of lines) {
    const ecart = computeEcart(line.theoreticalQty, line.countedQty);
    const row = sheet.addRow([
      line.articleRef,
      designationOf(line),
      depotCode,
      line.theoreticalQty,
      line.countedQty ?? 0,
      ecart,
    ]);
    if (ecart !== 0) {
      row.eachCell((cell) => {
        cell.fill = GAP_FILL;
        cell.font = { ...cell.font, color: GAP_FONT_COLOR };
      });
    }
  }

  sheet.columns.forEach((column) => {
    column.width = 22;
  });

  return sheet;
}

/**
 * FR-009/FR-006: two sheets — the full inventory and a gaps-only view —
 * both highlighting discrepancy rows in red. Ecart uses the same
 * counted-minus-theoretical rule as the offline view (lib/offline/discrepancy.ts),
 * just applied server-side to the persisted lines instead of the local cache.
 */
export function buildInventoryWorkbook(depotCode: string, lines: ExportLine[]): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  addInventorySheet(workbook, "Inventaire complet", lines, depotCode);

  const gaps = lines.filter((line) => computeEcart(line.theoreticalQty, line.countedQty) !== 0);
  addInventorySheet(workbook, "Écarts", gaps, depotCode);

  return workbook;
}

export function buildExportFilename(depotCode: string, now: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  return `inventaire_${depotCode}_${stamp}.xlsx`;
}
