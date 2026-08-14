import ExcelJS from "exceljs";
import type { ArtisAdapter, ArtisDepot, ArtisStockLine, ArtisStockPage } from "./interface";
import { buildArtisFileRowsSchema } from "./validation";
import { ArtisFileFormatError, ArtisFileValidationError } from "./errors";

const SHEET_NAME = "a_ResultatsRecherche";
const REQUIRED_HEADERS = ["Code art.", "Libellé art.", "Qté en Stock", "Code dépôt"] as const;
const SUPPLIER_REF_HEADER = "Référence fournisseur";
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 Mo

type RawRow = {
  articleRef: string;
  designation: string;
  supplierRef: string | null;
  qty: number;
  depotCode: string;
  rowNumber: number;
};

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
 * Current export format (the old "a_Article" sheet is retired — no
 * compatibility kept with it, confirmed against a real 138-row export):
 * sheet "a_ResultatsRecherche", columns matched BY HEADER NAME, never by
 * position. "Code art." is the join key (what the printed QR codes encode,
 * always present and unique). "Qté en Stock" is now the only quantity
 * column at all — the old "Stock physique" vs "Qté théorique" distinction
 * is gone from this export. "Code dépôt" is new: every row carries the
 * depot the export was run against, checked below against the depot the
 * responsable actually selected. Every other column (Libellé dépôt, Empl.,
 * Activité, Famille, Sous famille, Marque, Nom fournisseur) is ignored
 * without failing on it.
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

    const items = await this.parse(depotCode);
    return { depotCode, page: 1, pageCount: 1, items };
  }

  private async parse(selectedDepotCode: string): Promise<ArtisStockLine[]> {
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

    const sheet = workbook.worksheets.find((candidate) => candidate.name === SHEET_NAME);
    if (!sheet) {
      throw new ArtisFileFormatError(`Feuille "${SHEET_NAME}" introuvable dans le classeur.`);
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

    const codeCol = columnByHeader.get("Code art.")!;
    const designationCol = columnByHeader.get("Libellé art.")!;
    const qtyCol = columnByHeader.get("Qté en Stock")!;
    const depotCodeCol = columnByHeader.get("Code dépôt")!;
    // Optional: absent entirely -> every row's supplierRef is simply null.
    const supplierRefCol = columnByHeader.get(SUPPLIER_REF_HEADER);

    const rawRows: RawRow[] = [];
    for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber++) {
      const row = sheet.getRow(rowNumber);
      const codeCell = row.getCell(codeCol).value;
      const designationCell = row.getCell(designationCol).value;
      const qtyCell = row.getCell(qtyCol).value;
      const depotCodeCell = row.getCell(depotCodeCol).value;
      const supplierRefCell = supplierRefCol !== undefined ? row.getCell(supplierRefCol).value : null;

      // A fully blank row (no code, no designation, no quantity, no depot at
      // all) is trailing spreadsheet padding, not a record with a missing
      // Code — skip it rather than reject the whole import over it.
      if (codeCell == null && designationCell == null && qtyCell == null && depotCodeCell == null) continue;

      const supplierRefText = cellToString(supplierRefCell);
      rawRows.push({
        articleRef: cellToString(codeCell),
        designation: cellToString(designationCell),
        supplierRef: supplierRefText.length > 0 ? supplierRefText : null,
        qty: cellToNumber(qtyCell),
        depotCode: cellToString(depotCodeCell),
        rowNumber,
      });
    }

    const parsed = buildArtisFileRowsSchema(selectedDepotCode).safeParse(rawRows);
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
      supplierRef: row.supplierRef,
      qty: row.qty,
    }));
  }
}
