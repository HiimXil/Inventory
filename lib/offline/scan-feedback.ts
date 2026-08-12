export type ScanFeedbackEvent = {
  articleRef: string;
  designation: string | null;
  countedQty: number;
  isOffReferential: boolean;
  /** True when a rescan delta would have gone negative and was bounded to 0. */
  clamped: boolean;
};

export type ScanFeedbackState = ScanFeedbackEvent & { at: number };

/**
 * Pure "last confirmed entry" state, stamped with `now` (injected, not read
 * from a clock) so it's testable. Fires once per explicit confirm in the
 * quantity-entry panel — never on a raw scan, which only opens the panel
 * (see lib/offline/scan-entry.ts) and never touches a quantity by itself.
 */
export function nextScanFeedbackState(event: ScanFeedbackEvent, now: number): ScanFeedbackState {
  return { ...event, at: now };
}
