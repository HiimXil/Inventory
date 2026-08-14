import { z } from "zod";

export const artisDepotSchema = z.object({
  code: z.string(),
  name: z.string(),
});

export const artisStockLineSchema = z.object({
  articleRef: z.string(),
  designation: z.string(),
  supplierRef: z.string().nullable(),
  qty: z.number().int().nonnegative(),
});

export const artisStockPageSchema = z.object({
  depotCode: z.string(),
  page: z.number().int().min(1),
  pageCount: z.number().int().min(1),
  items: z.array(artisStockLineSchema),
});

export const artisDepotListSchema = z.array(artisDepotSchema);

/**
 * Validates the fully-aggregated (all-pages-merged) theoretical stock for a
 * depot. `.min(1)` enforces FR-023/FR-029's non-empty rule at the same point
 * validation happens, rather than as a separate ad hoc length check.
 */
export const artisAggregatedStockSchema = z.object({
  depotCode: z.string(),
  items: z.array(artisStockLineSchema).min(1),
});

/**
 * One row extracted from an ARTIS Excel export (ArtisFileAdapter), before
 * it becomes an ArtisStockLine. `rowNumber` is carried through purely so
 * validation failures can be reported as "Ligne N" — it's not part of the
 * adapter's output shape and is stripped after validation.
 */
export const artisFileRowSchema = z.object({
  articleRef: z.string().trim().min(1, { message: "« Code art. » est vide." }),
  designation: z.string(),
  supplierRef: z.string().trim().nullable(),
  qty: z
    .number({ invalid_type_error: "« Qté en Stock » n'est pas un nombre valide." })
    .int({ message: "« Qté en Stock » n'est pas un entier." })
    .nonnegative({ message: "« Qté en Stock » est négative." }),
  depotCode: z.string().trim().min(1, { message: "« Code dépôt » est vide." }),
  rowNumber: z.number().int().min(2),
});

export type ArtisFileRow = z.infer<typeof artisFileRowSchema>;

/**
 * Cross-row rules (FR-021/FR-029 adapted to file import), parameterized by
 * the depot actually selected at preparation time:
 *
 * 1. "Code art." is the join key for the whole app (it's what the printed
 *    QR codes encode), so it must be unique across the file — a duplicate
 *    can't be resolved silently one way or the other, it has to fail the
 *    import.
 * 2. Every row's "Code dépôt" must agree with itself (one file = one depot,
 *    never a mix) AND with the depot the responsable actually selected in
 *    the UI — a file exported for the wrong depot is a silent-corruption
 *    risk (theoretical quantities compared against the wrong physical
 *    location) that has to be caught here, before any session exists.
 *
 * A function rather than a static schema because rule 2 needs the selected
 * depot code as external context — Zod schemas take that via closure.
 */
export function buildArtisFileRowsSchema(selectedDepotCode: string) {
  return z
    .array(artisFileRowSchema)
    .min(1, { message: "Le fichier ne contient aucune ligne exploitable." })
    .superRefine((rows, ctx) => {
      const firstSeenAt = new Map<string, number>();
      rows.forEach((row, index) => {
        const previousIndex = firstSeenAt.get(row.articleRef);
        if (previousIndex !== undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `« Code art. » ${row.articleRef} est dupliqué (lignes ${rows[previousIndex].rowNumber} et ${row.rowNumber}).`,
            path: [index, "articleRef"],
          });
        } else {
          firstSeenAt.set(row.articleRef, index);
        }
      });

      const distinctDepotCodes = [...new Set(rows.map((row) => row.depotCode))];
      if (distinctDepotCodes.length > 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Le fichier mélange plusieurs dépôts (${distinctDepotCodes.join(", ")}) : un seul dépôt par fichier est autorisé.`,
          path: [],
        });
      } else if (distinctDepotCodes.length === 1 && distinctDepotCodes[0] !== selectedDepotCode) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Le fichier concerne le dépôt ${distinctDepotCodes[0]}, mais vous avez sélectionné ${selectedDepotCode}.`,
          path: [],
        });
      }
    });
}

