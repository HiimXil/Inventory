import type { DiscrepancyLine } from "@/lib/offline/discrepancy";
import { StatusBadge } from "@/components/ui/StatusBadge";

type ResultsTableProps = {
  lines: DiscrepancyLine[];
};

/**
 * Read-only counterpart to the offline island's CountingTable: same
 * écart-in-evidence convention (color + icon via StatusBadge, never color
 * alone), no input elements since a SYNCED/CLOSED session's counts are fixed.
 */
export function ResultsTable({ lines }: ResultsTableProps) {
  return (
    <div className="overflow-x-auto rounded-card border-2 border-border">
      <table className="w-full min-w-180 border-collapse text-left text-base">
        <thead>
          <tr className="border-b-2 border-border bg-surface text-sm font-semibold text-muted">
            <th className="px-4 py-3">Référence</th>
            <th className="px-4 py-3">Désignation</th>
            <th className="px-4 py-3 text-right">Théorique</th>
            <th className="px-4 py-3 text-right">Compté</th>
            <th className="px-4 py-3 text-right">Écart</th>
            <th className="px-4 py-3">Statut</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr
              key={line.articleRef}
              data-article-ref={line.articleRef}
              data-status={line.status}
              className={`border-b border-border last:border-b-0 ${line.status === "ECART" ? "bg-danger/10" : ""}`}
            >
              <td className="px-4 py-3 font-medium text-ink">{line.articleRef}</td>
              <td className="px-4 py-3 text-ink">
                {line.isOffReferential ? (
                  <span role="status" className="text-accent-text">
                    Hors référentiel
                  </span>
                ) : (
                  (line.designation ?? "—")
                )}
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-ink">{line.theoreticalQty}</td>
              <td data-testid={`counted-${line.articleRef}`} className="px-4 py-3 text-right tabular-nums text-ink">
                {line.countedQty === null ? "Non compté" : line.countedQty}
              </td>
              <td
                data-testid={`ecart-${line.articleRef}`}
                className={`px-4 py-3 text-right tabular-nums font-semibold ${
                  line.ecart !== 0 ? "text-danger-text" : "text-ink"
                }`}
              >
                {line.ecart}
              </td>
              <td className="px-4 py-3">
                <StatusBadge status={line.isOffReferential ? "HORS_REFERENTIEL" : line.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
