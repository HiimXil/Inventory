"use client";

import type { DiscrepancySummary } from "@/lib/offline/discrepancy";

type DiscrepancyViewProps = {
  summary: DiscrepancySummary;
};

/**
 * Live session recap (FR-006 / US3-AC3): conforme vs écart counts, computed
 * purely from the local cache — no network call involved.
 */
export function DiscrepancyView({ summary }: DiscrepancyViewProps) {
  return (
    <div role="status" aria-live="polite">
      <p>
        <span data-testid="conforme-count">{summary.conformeCount}</span> conforme(s) —{" "}
        <span
          data-testid="ecart-count"
          className={summary.ecartCount > 0 ? "text-red-700 font-semibold" : undefined}
        >
          {summary.ecartCount}
        </span>{" "}
        en écart sur {summary.totalLines} ligne(s)
      </p>
    </div>
  );
}
