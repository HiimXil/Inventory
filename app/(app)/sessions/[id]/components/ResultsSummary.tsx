import type { DiscrepancySummary } from "@/lib/offline/discrepancy";

/**
 * Server-rendered recap for the read-only results view (FR-006/US3-AC3),
 * counterpart to the offline island's DiscrepancyView but with no client
 * interactivity needed — the data is fixed once a session is SYNCED/CLOSED.
 */
export function ResultsSummary({ summary }: { summary: DiscrepancySummary }) {
  return (
    <div role="status" className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      <div className="rounded-card border-2 border-border bg-surface px-4 py-3">
        <p className="text-sm font-medium text-muted">Conforme</p>
        <p data-testid="conforme-count" className="text-2xl font-bold text-success-text sm:text-3xl">
          {summary.conformeCount}
        </p>
      </div>
      <div className="rounded-card border-2 border-border bg-surface px-4 py-3">
        <p className="text-sm font-medium text-muted">Écart</p>
        <p
          data-testid="ecart-count"
          className={`text-2xl font-bold sm:text-3xl ${summary.ecartCount > 0 ? "text-danger-text" : "text-ink"}`}
        >
          {summary.ecartCount}
        </p>
      </div>
      <div className="col-span-2 rounded-card border-2 border-border bg-surface px-4 py-3 sm:col-span-1">
        <p className="text-sm font-medium text-muted">Total</p>
        <p className="text-2xl font-bold text-ink sm:text-3xl">{summary.totalLines}</p>
      </div>
    </div>
  );
}
