"use client";

import type { ScanFeedbackState } from "@/lib/offline/scan-feedback";
import { CheckCircleIcon, TagIcon } from "@/components/ui/icons";

type ScanFeedbackBannerProps = {
  feedback: ScanFeedbackState | null;
};

const BASE_CLASSES =
  "min-h-touch-comfortable rounded-card border-2 px-4 py-3 text-lg font-semibold transition-colors motion-safe:animate-[scan-flash_500ms_ease-out]";

/**
 * The "it's taken, you can move the phone away" cue — fires once per
 * explicit confirm in the quantity-entry panel (never on a raw scan, which
 * only opens the panel). Stays visible until the next confirm replaces it —
 * remounting via `key={feedback.at}` restarts the flash animation on every
 * event, even repeat confirms for the same article.
 */
export function ScanFeedbackBanner({ feedback }: ScanFeedbackBannerProps) {
  if (!feedback) {
    return (
      <div className="min-h-touch-comfortable rounded-card border-2 border-border px-4 py-3 text-lg text-muted">
        En attente d&apos;un scan...
      </div>
    );
  }

  const isOff = feedback.isOffReferential;

  return (
    <div
      key={feedback.at}
      role="status"
      aria-live="polite"
      data-testid="scan-feedback"
      data-scan-status={isOff ? "off-referential" : "accepted"}
      className={`${BASE_CLASSES} flex flex-col gap-1 ${
        isOff ? "border-accent bg-accent/10 text-accent-text" : "border-success bg-success/10 text-success-text"
      }`}
    >
      <span className="flex items-center gap-2">
        {isOff ? <TagIcon className="h-5 w-5 shrink-0" /> : <CheckCircleIcon className="h-5 w-5 shrink-0" />}
        {feedback.designation ?? (isOff ? "Hors référentiel" : feedback.articleRef)} — compté :{" "}
        <span className="tabular-nums">{feedback.countedQty}</span>
      </span>
      {feedback.clamped && (
        <span data-testid="scan-feedback-clamped" className="text-base font-normal text-ink">
          Le total ne peut pas être négatif — ramené à 0.
        </span>
      )}
    </div>
  );
}
