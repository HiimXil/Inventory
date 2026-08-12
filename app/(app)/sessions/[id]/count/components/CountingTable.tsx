"use client";

import type { DiscrepancyLine } from "@/lib/offline/discrepancy";
import { StatusBadge, type Status } from "@/components/ui/StatusBadge";

type CountingTableProps = {
  lines: DiscrepancyLine[];
  total: number;
  /** Tapping a row's quantity cell routes through the exact same open/ignore decision as a camera scan or a manually-typed reference (see count/page.tsx's handleDetected) — this is a third trigger for the same flow, not a new one. */
  onSelectLine: (articleRef: string) => void;
  /** Article ref of the most recently confirmed quantity-entry panel, so its row can flash briefly — null before anything is confirmed. */
  lastConfirmedRef: string | null;
  /** Timestamp of that confirm; re-triggers the highlight even for a repeat confirm on the same ref. */
  lastConfirmedAt: number | null;
};

function statusFor(line: DiscrepancyLine): Status {
  // Off-referential is the more salient fact for a row ("this shouldn't even
  // be here") — shown instead of, not alongside, the plain CONFORME/ECART
  // badge, to avoid stacking two badges on an already-narrow mobile row.
  if (line.isOffReferential) return "HORS_REFERENTIEL";
  return line.status;
}

export function CountingTable({ lines, total, onSelectLine, lastConfirmedRef, lastConfirmedAt }: CountingTableProps) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-lg font-medium text-ink">
        Total compté : <strong data-testid="total-counted" className="text-display font-bold tabular-nums">{total}</strong>
      </p>

      <div className="overflow-x-auto rounded-card border-2 border-border">
        <table className="w-full min-w-xl border-collapse text-left">
          <thead>
            <tr className="border-b-2 border-border bg-surface text-base font-semibold text-ink">
              <th className="px-3 py-3">Référence</th>
              <th className="px-3 py-3">Désignation</th>
              <th className="px-3 py-3 text-right">Théo.</th>
              <th className="px-3 py-3 text-right">Compté</th>
              <th className="px-3 py-3">Statut</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => {
              // Just confirmed but derived from props only (no local state/timer): keying the row on
              // `lastConfirmedAt` while it's the highlighted one forces a remount, which restarts the
              // CSS decay animation below — including on a repeat confirm of the exact same article.
              // Once a different article is confirmed, the key reverts to the stable `articleRef` and
              // this row settles for good (fill-mode forwards holds the decayed end state either way).
              const isJustConfirmed = line.articleRef === lastConfirmedRef;
              return (
                <tr
                  key={isJustConfirmed ? `${line.articleRef}:${lastConfirmedAt}` : line.articleRef}
                  data-article-ref={line.articleRef}
                  data-status={line.status}
                  data-just-confirmed={isJustConfirmed ? "true" : undefined}
                  className={[
                    "border-b border-border last:border-b-0",
                    isJustConfirmed ? "motion-safe:animate-[row-flash_800ms_ease-out_forwards]" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  <td className="px-3 py-2 text-base font-medium text-ink">{line.articleRef}</td>
                  <td className="px-3 py-2 text-base text-ink">{line.designation ?? "—"}</td>
                  <td className="px-3 py-2 text-right text-base tabular-nums text-ink">{line.theoreticalQty}</td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => onSelectLine(line.articleRef)}
                      aria-label={`Modifier la quantité comptée pour ${line.articleRef}`}
                      className="min-h-touch-comfortable w-full rounded-control px-3 text-right text-xl font-bold tabular-nums text-ink hover:bg-surface"
                    >
                      {line.countedQty === null ? (
                        <span className="text-base font-normal text-muted">Non compté</span>
                      ) : (
                        line.countedQty
                      )}
                    </button>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge status={statusFor(line)} />
                      <span data-testid={`ecart-${line.articleRef}`} className="text-sm text-muted tabular-nums">
                        {line.ecart}
                      </span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
