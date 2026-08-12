import type { DiscrepancyLine } from "./discrepancy";

export type CountingViewMode = "all" | "ecart-first" | "not-counted";

/**
 * Pure search + filter/sort for the counting screen's list — everything
 * derived from data already in memory, no network, and no change to what's
 * actually stored (lib/offline/scan-processing.ts is untouched). "ecart-first"
 * reorders only (a stable sort — lines sharing a status keep their original
 * relative order); "not-counted" hides everything else instead of reordering.
 */
export function filterAndSortLines(
  lines: DiscrepancyLine[],
  query: string,
  mode: CountingViewMode,
): DiscrepancyLine[] {
  const normalizedQuery = query.trim().toLowerCase();

  let result = lines;
  if (normalizedQuery) {
    result = result.filter(
      (line) =>
        line.articleRef.toLowerCase().includes(normalizedQuery) ||
        (line.designation ?? "").toLowerCase().includes(normalizedQuery),
    );
  }

  if (mode === "not-counted") {
    return result.filter((line) => line.countedQty === null);
  }

  if (mode === "ecart-first") {
    return [...result].sort((a, b) => {
      if (a.status === b.status) return 0;
      return a.status === "ECART" ? -1 : 1;
    });
  }

  return result;
}
