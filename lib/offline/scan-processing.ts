import type { OfflineCountEntry, OfflineTheoreticalLine } from "./db";

export type CountLines = Record<string, OfflineCountEntry>;

export function knownArticleRefsOf(theoreticalLines: OfflineTheoreticalLine[]): Set<string> {
  return new Set(theoreticalLines.map((line) => line.articleRef));
}

export type LineInfo = {
  designation: string | null;
  /** null = never counted yet (first scan); a number, possibly 0, means already on file. */
  previousQty: number | null;
  isOffReferential: boolean;
  /** The theoretical quantity to show as "Attendu" in the entry panel — 0 for an off-referential/unknown article. */
  theoreticalQty: number;
};

/**
 * Read-only lookup for what the quantity-entry panel should show when
 * `articleRef` is scanned — never mutates countLines. Scanning only opens
 * the panel now (see lib/offline/scan-entry.ts); the actual quantity change
 * happens on explicit confirm, via applyManualQuantity/applyQuantityDelta.
 */
export function lineInfoFor(
  theoreticalLines: OfflineTheoreticalLine[],
  countLines: CountLines,
  articleRef: string,
): LineInfo {
  const theoreticalLine = theoreticalLines.find((line) => line.articleRef === articleRef);
  const existing = countLines[articleRef];
  return {
    designation: theoreticalLine?.designation ?? null,
    previousQty: existing?.countedQty ?? null,
    isOffReferential: existing?.isOffReferential ?? !knownArticleRefsOf(theoreticalLines).has(articleRef),
    theoreticalQty: theoreticalLine?.theoreticalQty ?? 0,
  };
}

export type ArticleResolution =
  | { status: "resolved"; articleRef: string }
  | { status: "ambiguous" }
  | { status: "not-found" };

/**
 * Single reference→line resolution point shared by camera scan and manual
 * keyboard entry — both funnel into the same onScan/handleDetected callback
 * (see QRScanner.tsx and count/page.tsx), which calls this before anything
 * else. Tries an exact Code art. (articleRef) match first; if none, falls
 * back to Référence fournisseur (supplierRef) — a manufacturer/supplier
 * code some barcodes carry or a user types instead of the internal one. A
 * supplierRef shared by more than one theoretical line can't be resolved
 * safely, so it comes back "ambiguous" rather than guessing — the caller
 * treats that exactly like "not-found" (falls through to an off-referential
 * entry keyed on the raw input), never silently attributing the count to
 * one of the ambiguous candidates.
 */
export function resolveArticleRef(
  theoreticalLines: OfflineTheoreticalLine[],
  rawRef: string,
): ArticleResolution {
  const trimmed = rawRef.trim();

  if (theoreticalLines.some((line) => line.articleRef === trimmed)) {
    return { status: "resolved", articleRef: trimmed };
  }

  const supplierMatches = theoreticalLines.filter((line) => line.supplierRef != null && line.supplierRef === trimmed);
  if (supplierMatches.length === 1) {
    return { status: "resolved", articleRef: supplierMatches[0].articleRef };
  }
  if (supplierMatches.length > 1) {
    return { status: "ambiguous" };
  }

  return { status: "not-found" };
}

export type ManualQuantityResult =
  | { ok: true; countLines: CountLines }
  | { ok: false; error: string };

/**
 * Pure "set the absolute total" step (FR-004, FR-019) — also the first-scan
 * case of the quantity-entry panel (never-counted line, user types the full
 * total they found). Enforces the integer >= 0 rule; the caller is
 * responsible for persisting/tracing the result (see useOfflineSession,
 * which stamps lastLocalUpdate + dirty).
 */
export function applyManualQuantity(
  countLines: CountLines,
  knownArticleRefs: ReadonlySet<string>,
  articleRef: string,
  quantity: number,
): ManualQuantityResult {
  if (!Number.isInteger(quantity) || quantity < 0) {
    return { ok: false, error: "La quantité doit être un nombre entier supérieur ou égal à 0." };
  }

  const existing = countLines[articleRef];
  const isOffReferential = existing?.isOffReferential ?? !knownArticleRefs.has(articleRef);

  return {
    ok: true,
    countLines: {
      ...countLines,
      [articleRef]: {
        countedQty: quantity,
        isOffReferential,
      },
    },
  };
}

export type ApplyDeltaResult =
  | { ok: true; countLines: CountLines; countedQty: number; clamped: boolean }
  | { ok: false; error: string };

/**
 * Pure "adjust an already-counted total by a signed delta" step — the
 * rescan case of the quantity-entry panel ("déjà compté : N, ajouter ou
 * retirer combien ?"). newTotal = previousQty + delta, bounded to 0: a
 * delta that would take the total negative is applied as far as it can go
 * (down to 0) rather than rejected outright, with `clamped: true` so the
 * caller can surface a clear "ramené à 0" message instead of silently
 * losing the difference.
 */
export function applyQuantityDelta(
  countLines: CountLines,
  knownArticleRefs: ReadonlySet<string>,
  articleRef: string,
  delta: number,
): ApplyDeltaResult {
  if (!Number.isInteger(delta)) {
    return { ok: false, error: "La quantité à ajouter ou retirer doit être un nombre entier." };
  }

  const existing = countLines[articleRef];
  const previousQty = existing?.countedQty ?? 0;
  const rawTotal = previousQty + delta;
  const countedQty = Math.max(0, rawTotal);
  const isOffReferential = existing?.isOffReferential ?? !knownArticleRefs.has(articleRef);

  return {
    ok: true,
    countLines: {
      ...countLines,
      [articleRef]: { countedQty, isOffReferential },
    },
    countedQty,
    clamped: rawTotal < 0,
  };
}

export type DisplayLine = {
  articleRef: string;
  designation: string | null;
  theoreticalQty: number;
  /**
   * `null` means never counted at all — distinct from having been counted
   * and found to be exactly 0 (FR-006: the two must not look the same).
   */
  countedQty: number | null;
  isOffReferential: boolean;
};

/**
 * Merges the fixed theoretical snapshot with the local count map into the
 * flat list CountingTable renders — known articles first (theoretical order),
 * then any off-referential lines the session has accumulated.
 */
export function buildDisplayLines(
  theoreticalLines: OfflineTheoreticalLine[],
  countLines: CountLines,
): DisplayLine[] {
  const theoreticalRefs = knownArticleRefsOf(theoreticalLines);

  const known: DisplayLine[] = theoreticalLines.map((line) => ({
    articleRef: line.articleRef,
    designation: line.designation,
    theoreticalQty: line.theoreticalQty,
    countedQty: countLines[line.articleRef]?.countedQty ?? null,
    isOffReferential: false,
  }));

  const offReferential: DisplayLine[] = Object.entries(countLines)
    .filter(([articleRef]) => !theoreticalRefs.has(articleRef))
    .map(([articleRef, entry]) => ({
      articleRef,
      designation: null,
      theoreticalQty: 0,
      countedQty: entry.countedQty,
      isOffReferential: true,
    }));

  return [...known, ...offReferential];
}

export function totalCountedQty(countLines: CountLines): number {
  return Object.values(countLines).reduce((sum, entry) => sum + entry.countedQty, 0);
}
