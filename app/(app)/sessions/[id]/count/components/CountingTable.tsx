"use client";

import type { KeyboardEvent } from "react";
import type { DiscrepancyLine } from "@/lib/offline/discrepancy";
import { StatusBadge, type Status } from "@/components/ui/StatusBadge";
import { ChevronRightIcon } from "@/components/ui/icons";

type CountingTableProps = {
  lines: DiscrepancyLine[];
  total: number;
  /** Tapping anywhere on a row routes through the exact same open/ignore decision as a camera scan or a manually-typed reference (see count/page.tsx's handleDetected) — this is a third trigger for the same flow, not a new one. */
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

function rowAriaLabel(line: DiscrepancyLine): string {
  const designation = line.designation ? ` — ${line.designation}` : "";
  const state = line.countedQty === null ? "non compté" : `compté ${line.countedQty}`;
  return `Saisir la quantité pour ${line.articleRef}${designation}, ${state}`;
}

export function CountingTable({ lines, total, onSelectLine, lastConfirmedRef, lastConfirmedAt }: CountingTableProps) {
  function handleRowKeyDown(event: KeyboardEvent<HTMLTableRowElement>, articleRef: string) {
    // Enter and Space are the two standard activation keys for a
    // role="button" element — Space additionally needs preventDefault so it
    // doesn't also scroll the page, exactly like a native <button> handles it.
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelectLine(articleRef);
    }
  }

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
              <th className="px-2 py-3" aria-hidden="true"></th>
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
                  role="button"
                  tabIndex={0}
                  aria-label={rowAriaLabel(line)}
                  onClick={() => onSelectLine(line.articleRef)}
                  onKeyDown={(event) => handleRowKeyDown(event, line.articleRef)}
                  className={[
                    // The whole row is the tap target (not just the counted-qty
                    // cell) — a plain onClick here never fires on a touch-scroll
                    // drag, same native behavior a <button> gets for free.
                    "cursor-pointer select-none border-b border-border last:border-b-0 hover:bg-surface active:bg-surface",
                    isJustConfirmed ? "motion-safe:animate-[row-flash_800ms_ease-out_forwards]" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  <td className="px-3 py-4 text-base font-medium text-ink">{line.articleRef}</td>
                  <td className="px-3 py-4 text-base text-ink">{line.designation ?? "—"}</td>
                  <td className="px-3 py-4 text-right text-base tabular-nums text-ink">{line.theoreticalQty}</td>
                  <td className="px-3 py-4 text-right text-xl font-bold tabular-nums text-ink">
                    {line.countedQty === null ? (
                      <span data-testid={`counted-${line.articleRef}`} className="text-base font-normal text-muted">
                        Non compté
                      </span>
                    ) : (
                      <span data-testid={`counted-${line.articleRef}`}>{line.countedQty}</span>
                    )}
                  </td>
                  <td className="px-3 py-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge status={statusFor(line)} />
                      <span data-testid={`ecart-${line.articleRef}`} className="text-sm text-muted tabular-nums">
                        {line.ecart}
                      </span>
                    </div>
                  </td>
                  <td className="px-2 py-4 text-muted">
                    <ChevronRightIcon className="h-5 w-5 shrink-0" />
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
