import ExcelJS from "exceljs";
import type { ArtisAdapter, ArtisDepot, ArtisStockLine, ArtisStockPage } from "./interface";
import { artisFileRowsSchema } from "./validation";
import { ArtisFileFormatError, ArtisFileValidationError } from "./errors";

const SHEET_NAME = "a_Article";
const REQUIRED_HEADERS = ["Code", "Libellé", "Stock physique"] as const;
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 Mo

type RawRow = { articleRef: string; designation: string; qty: number; rowNumber: number };

function cellToString(value: ExcelJS.CellValue): string {
  if (value == null) return "";
  if (typeof value === "object") {
    if ("richText" in value) return value.richText.map((part) => part.text).join("").trim();
    if ("text" in value) return String(value.text ?? "").trim();
    return "";
  }
  return String(value).trim();
}

function cellToNumber(value: ExcelJS.CellValue): number {
  if (typeof value === "number") return value;
  if (value == null) return NaN;
  return Number(cellToString(value));
}

/**
 * Reads an ARTIS depot's theoretical stock from a client-provided .xlsx
 * export rather than a live API call (FR-029, real-import primary path —
 * ArtisHttpAdapter remains unimplemented, see lib/artis/factory.ts).
 *
 * Columns are matched BY HEADER NAME, never by position: a real export
 * carries an unnamed, always-blank column between "Code" and "Référence"
 * that would silently corrupt any index-based mapping.
 *
 * "Référence" (manufacturer reference, e.g. "300309") is deliberately never
 * read — it's blank on some real rows, so it can't be the join key. "Code"
 * (e.g. "F300309") is what the app's QR codes encode and is always present
 * and unique, confirmed against the live ARTIS API.
 *
 * theoreticalQty is mapped from "Stock physique", NOT "Qté théorique".
 * "Qté théorique" = Stock physique − Résa stock — a net-of-reservations
 * availability figure. A technician physically counting their van's stock
 * counts reserved parts too (they're physically there), so using "Qté
 * théorique" would manufacture a false discrepancy for every reserved
 * article. Confirmed against the live ARTIS API on three witness articles.
 */
export class ArtisFileAdapter implements ArtisAdapter {
  private readonly fileBuffer: Buffer;

  constructor(fileBuffer: Buffer | ArrayBuffer) {
    this.fileBuffer = Buffer.isBuffer(fileBuffer) ? fileBuffer : Buffer.from(fileBuffer);

    if (this.fileBuffer.byteLength === 0) {
      throw new ArtisFileFormatError("Le fichier est vide.");
    }
    if (this.fileBuffer.byteLength > MAX_FILE_SIZE_BYTES) {
      throw new ArtisFileFormatError(
        `Le fichier dépasse la taille maximale autorisée (${MAX_FILE_SIZE_BYTES / (1024 * 1024)} Mo).`,
      );
    }
  }

  /**
   * Not applicable in file mode: the depot is chosen by the user in the app
   * (app/(app)/prepare), not discovered from ARTIS — there is no "list
   * depots" endpoint in the real API either (confirmed by exploration).
   */
  async listDepots(): Promise<ArtisDepot[]> {
    return [];
  }

  /**
   * A file has no real pagination: it's parsed whole. Always reports
   * pageCount=1 so lib/artis/aggregate.ts's page-fetching loop (built for
   * the network adapter) terminates after this single call with no changes
   * needed there — see prepare-session.ts for the FR-029 completeness note.
   */
  async getTheoreticalStock(depotCode: string, page: number): Promise<ArtisStockPage> {
    if (page !== 1) {
      return { depotCode, page, pageCount: 1, items: [] };
    }

    const items = await this.parse();
    return { depotCode, page: 1, pageCount: 1, items };
  }

  private async parse(): Promise<ArtisStockLine[]> {
    const workbook = new ExcelJS.Workbook();
    try {
      // exceljs's own .d.ts shadows the global `Buffer` type with a bare
      // `extends ArrayBuffer` shape that Node's real (generic) Buffer type
      // no longer structurally satisfies in newer TS lib versions — same
      // friction point as lib/sessions/export-session.ts. The value is a
      // real Node Buffer at runtime regardless; only the type needs coaxing.
      await workbook.xlsx.load(this.fileBuffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    } catch {
      throw new ArtisFileFormatError("Le fichier n'est pas un classeur Excel (.xlsx) valide.");
    }

    let sheet = workbook.worksheets.find((candidate) => candidate.name === SHEET_NAME);
    if (!sheet) {
      sheet = workbook.worksheets[0];
      if (sheet) {
        console.warn(
          `[ArtisFileAdapter] Feuille "${SHEET_NAME}" introuvable ; utilisation de la première feuille ("${sheet.name}") à la place.`,
        );
      }
    }
    if (!sheet) {
      throw new ArtisFileFormatError("Le classeur ne contient aucune feuille.");
    }

    const columnByHeader = new Map<string, number>();
    sheet.getRow(1).eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const header = cellToString(cell.value);
      if (header) columnByHeader.set(header, colNumber);
    });

    const missingHeaders = REQUIRED_HEADERS.filter((header) => !columnByHeader.has(header));
    if (missingHeaders.length > 0) {
      throw new ArtisFileValidationError(`Colonnes obligatoires manquantes : ${missingHeaders.join(", ")}.`);
    }

    const codeCol = columnByHeader.get("Code")!;
    const designationCol = columnByHeader.get("Libellé")!;
    const qtyCol = columnByHeader.get("Stock physique")!;

    const rawRows: RawRow[] = [];
    for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber++) {
      const row = sheet.getRow(rowNumber);
      const codeCell = row.getCell(codeCol).value;
      const designationCell = row.getCell(designationCol).value;
      const qtyCell = row.getCell(qtyCol).value;

      // A fully blank row (no code, no designation, no quantity at all) is
      // trailing spreadsheet padding, not a record with a missing Code —
      // skip it rather than reject the whole import over it.
      if (codeCell == null && designationCell == null && qtyCell == null) continue;

      rawRows.push({
        articleRef: cellToString(codeCell),
        designation: cellToString(designationCell),
        qty: cellToNumber(qtyCell),
        rowNumber,
      });
    }

    const parsed = artisFileRowsSchema.safeParse(rawRows);
    if (!parsed.success) {
      const messages = parsed.error.issues.map((issue) => {
        const index = typeof issue.path[0] === "number" ? issue.path[0] : undefined;
        if (index === undefined) return issue.message;
        const row = rawRows[index];
        const label = row?.articleRef ? ` (${row.articleRef})` : "";
        return `Ligne ${row?.rowNumber ?? "?"}${label} : ${issue.message}`;
      });
      throw new ArtisFileValidationError(messages.join(" "));
    }

    return parsed.data.map((row) => ({
      articleRef: row.articleRef,
      designation: row.designation,
      qty: row.qty,
    }));
  }
}
