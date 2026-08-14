"use client";

import { useEffect, useRef, useState } from "react";
import type { ScanPanelState } from "@/lib/offline/scan-entry";
import { NumericInput } from "@/components/ui/NumericInput";
import { Button } from "@/components/ui/Button";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { StatusBadge } from "@/components/ui/StatusBadge";

type OpenPanel = ScanPanelState & { status: "open" };

type QuantityEntryPanelProps = {
  panel: OpenPanel;
  onConfirmTotal: (articleRef: string, total: number) => void;
  onConfirmDelta: (articleRef: string, delta: number) => void;
  onCancel: () => void;
};

const DIGITS_ONLY = /^\d+$/;

/**
 * The most-manipulated surface on this screen — a native <dialog> rather
 * than an inline section: showModal() puts it in the browser's top layer,
 * so it can never end up hidden below the camera feed or the list on a
 * short phone screen, and the rest of the page becomes inert while it's
 * open (matching the existing "a scan of any other ref is ignored while a
 * panel is open" rule — now visually true as well as logically true).
 * Anchored to the bottom of the viewport (not centered): the Valider/
 * Annuler buttons land where a thumb already is on a one-handed phone grip.
 *
 * Mounted only while the panel is open (see count/page.tsx's conditional
 * render), so every open starts from fresh local state — no reset-on-reopen
 * logic needed here.
 */
export function QuantityEntryPanel({ panel, onConfirmTotal, onConfirmDelta, onCancel }: QuantityEntryPanelProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [value, setValue] = useState("");
  const [mode, setMode] = useState<"add" | "remove">("add");

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  const isFirstScan = panel.previousQty === null;
  const isValid = DIGITS_ONLY.test(value.trim());
  const magnitude = isValid ? Number(value) : null;
  const title = panel.designation ?? (panel.isOffReferential ? "Hors référentiel" : panel.articleRef);

  const previewTotal =
    magnitude === null
      ? null
      : isFirstScan
        ? magnitude
        : Math.max(0, (panel.previousQty ?? 0) + (mode === "remove" ? -magnitude : magnitude));

  function confirm() {
    if (magnitude === null) return;
    if (isFirstScan) {
      onConfirmTotal(panel.articleRef, magnitude);
    } else {
      onConfirmDelta(panel.articleRef, mode === "remove" ? -magnitude : magnitude);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      onClose={onCancel}
      onClick={(event) => {
        if (event.target === dialogRef.current) dialogRef.current?.close();
      }}
      aria-labelledby="qty-panel-title"
      data-testid="quantity-entry-panel"
      data-panel-mode={isFirstScan ? "total" : "delta"}
      className="fixed inset-x-0 top-auto bottom-0 m-0 w-full max-w-2xl rounded-t-card border-2 border-b-0 border-border bg-paper p-0 shadow-elevated backdrop:bg-transparent sm:inset-x-0 sm:mx-auto"
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          confirm();
        }}
        className="flex max-h-[85vh] flex-col gap-5 overflow-y-auto p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]"
      >
        <div className="flex flex-col gap-2">
          <p className="text-base font-medium text-muted">{panel.articleRef}</p>
          <h2 id="qty-panel-title" className="text-2xl font-bold text-ink">
            {title}
          </h2>
          {panel.isOffReferential && <StatusBadge status="HORS_REFERENTIEL" />}
        </div>

        {isFirstScan ? (
          <div className="flex flex-col gap-2">
            <label htmlFor="qty-total-input" className="text-lg font-medium text-ink">
              Quantité totale trouvée
            </label>
            <NumericInput
              id="qty-total-input"
              data-testid="qty-total-input"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              autoFocus
              className="min-h-touch-count"
            />
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <p data-testid="qty-previous" className="text-lg text-ink">
              Déjà compté :{" "}
              <strong className="text-display font-bold tabular-nums text-ink">{panel.previousQty}</strong>
            </p>

            <SegmentedControl
              value={mode}
              onChange={setMode}
              size="count"
              aria-label="Ajouter ou retirer"
              options={[
                { value: "add", label: "Ajouter (+)" },
                { value: "remove", label: "Retirer (−)" },
              ]}
            />

            <div className="flex flex-col gap-2">
              <label htmlFor="qty-delta-input" className="text-lg font-medium text-ink">
                Quantité à {mode === "remove" ? "retirer" : "ajouter"}
              </label>
              <NumericInput
                id="qty-delta-input"
                data-testid="qty-delta-input"
                value={value}
                onChange={(event) => setValue(event.target.value)}
                autoFocus
                className="min-h-touch-count"
              />
            </div>

            {previewTotal !== null && (
              <p data-testid="qty-preview" className="text-lg font-semibold text-accent-text">
                Nouveau total : <span className="tabular-nums">{previewTotal}</span>
              </p>
            )}
          </div>
        )}

        {previewTotal !== null && (
          <p data-testid="qty-expected" className="text-lg text-ink">
            Compté : <strong className="tabular-nums">{previewTotal}</strong> — Attendu :{" "}
            <strong
              data-testid="qty-expected-value"
              className={
                previewTotal !== panel.theoreticalQty ? "text-red-700 font-semibold tabular-nums" : "tabular-nums"
              }
            >
              {panel.theoreticalQty}
            </strong>
            {panel.isOffReferential && <span className="text-muted"> — hors référentiel</span>}
          </p>
        )}

        <div className="mt-2 flex flex-col gap-3 sm:flex-row">
          <Button
            type="button"
            variant="secondary"
            size="count"
            className="flex-1"
            onClick={() => dialogRef.current?.close()}
          >
            Annuler
          </Button>
          <Button type="submit" variant="primary" size="count" className="flex-1" disabled={magnitude === null}>
            Valider
          </Button>
        </div>
      </form>
    </dialog>
  );
}
