import { z } from "zod";

export const artisDepotSchema = z.object({
  code: z.string(),
  name: z.string(),
});

export const artisStockLineSchema = z.object({
  articleRef: z.string(),
  designation: z.string(),
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
  articleRef: z.string().trim().min(1, { message: "« Code » est vide." }),
  designation: z.string(),
  qty: z
    .number({ invalid_type_error: "« Stock physique » n'est pas un nombre valide." })
    .int({ message: "« Stock physique » n'est pas un entier." })
    .nonnegative({ message: "« Stock physique » est négatif." }),
  rowNumber: z.number().int().min(2),
});

export type ArtisFileRow = z.infer<typeof artisFileRowSchema>;

/**
 * Cross-row rule (FR-021/FR-029 adapted to file import): "Code" is the join
 * key for the whole app (it's what the printed QR codes encode), so it must
 * be unique across the file — a duplicate can't be resolved silently one
 * way or the other, it has to fail the import.
 */
export const artisFileRowsSchema = z
  .array(artisFileRowSchema)
  .min(1, { message: "Le fichier ne contient aucune ligne exploitable." })
  .superRefine((rows, ctx) => {
    const firstSeenAt = new Map<string, number>();
    rows.forEach((row, index) => {
      const previousIndex = firstSeenAt.get(row.articleRef);
      if (previousIndex !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `« Code » ${row.articleRef} est dupliqué (lignes ${rows[previousIndex].rowNumber} et ${row.rowNumber}).`,
          path: [index, "articleRef"],
        });
      } else {
        firstSeenAt.set(row.articleRef, index);
      }
    });
  });

