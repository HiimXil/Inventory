import type { LineInfo } from "./scan-processing";

export type ScanPanelState =
  | { status: "closed" }
  | ({ status: "open"; articleRef: string } & LineInfo);

export type ScanDecision =
  | { action: "open"; panel: ScanPanelState & { status: "open" } }
  | { action: "ignore" };

/**
 * Pure "what happens when articleRef is scanned" decision, replacing the
 * old time-based debounce (lib/offline/scan-debounce.ts, removed): a scan
 * never mutates a quantity anymore, it only opens the entry panel, so the
 * thing to guard against is re-opening/resetting an in-progress entry —
 * not a rapid-fire re-count, which can no longer happen since scanning
 * alone changes nothing.
 *
 * While a panel is already open:
 * - same ref scanned again: ignored (idempotent — camera can fire this
 *   dozens of times a second while the code sits in frame; must not reset
 *   whatever the user has already typed).
 * - a DIFFERENT ref scanned: also ignored, deliberately. The safer failure
 *   mode is "an unrelated scan does nothing" rather than "an unrelated scan
 *   silently discards the quantity you were about to confirm" — so an
 *   in-progress entry always wins over a new scan until it's confirmed or
 *   cancelled.
 */
export function decideScanAction(
  currentPanel: ScanPanelState,
  articleRef: string,
  lineInfo: LineInfo,
): ScanDecision {
  if (currentPanel.status === "open") {
    return { action: "ignore" };
  }

  return {
    action: "open",
    panel: { status: "open", articleRef, ...lineInfo },
  };
}
