import { describe, expect, it } from "vitest";
import { decideScanAction, type ScanPanelState } from "../../lib/offline/scan-entry";
import type { LineInfo } from "../../lib/offline/scan-processing";

const CLOSED: ScanPanelState = { status: "closed" };

const KNOWN_LINE: LineInfo = { designation: "Imprimante UV", previousQty: null, isOffReferential: false };
const OFF_REF_LINE: LineInfo = { designation: null, previousQty: null, isOffReferential: true };
const ALREADY_COUNTED_LINE: LineInfo = { designation: "Encre cyan", previousQty: 8, isOffReferential: false };

describe("decideScanAction", () => {
  it("opens a panel for a first scan of a known article (never counted)", () => {
    expect(decideScanAction(CLOSED, "ART-001", KNOWN_LINE)).toEqual({
      action: "open",
      panel: { status: "open", articleRef: "ART-001", ...KNOWN_LINE },
    });
  });

  it("opens a panel for a first scan of an off-referential article", () => {
    expect(decideScanAction(CLOSED, "UNKNOWN-XYZ", OFF_REF_LINE)).toEqual({
      action: "open",
      panel: { status: "open", articleRef: "UNKNOWN-XYZ", ...OFF_REF_LINE },
    });
  });

  it("opens a panel for a rescan, carrying the previous total through", () => {
    expect(decideScanAction(CLOSED, "ART-002", ALREADY_COUNTED_LINE)).toEqual({
      action: "open",
      panel: { status: "open", articleRef: "ART-002", ...ALREADY_COUNTED_LINE },
    });
  });

  it("ignores a repeat scan of the SAME reference while its panel is already open", () => {
    const openPanel: ScanPanelState = { status: "open", articleRef: "ART-001", ...KNOWN_LINE };
    expect(decideScanAction(openPanel, "ART-001", KNOWN_LINE)).toEqual({ action: "ignore" });
  });

  it("ignores a scan of a DIFFERENT reference while a panel is open (never loses the in-progress entry)", () => {
    const openPanel: ScanPanelState = { status: "open", articleRef: "ART-001", ...KNOWN_LINE };
    expect(decideScanAction(openPanel, "ART-999", ALREADY_COUNTED_LINE)).toEqual({ action: "ignore" });
  });

  it("never touches quantities — it only ever decides open vs ignore", () => {
    const decision = decideScanAction(CLOSED, "ART-001", KNOWN_LINE);
    expect(decision.action).toBe("open");
    // No countedQty is produced anywhere in this module: confirming a
    // quantity is a separate, explicit step (applyManualQuantity /
    // applyQuantityDelta), never a side effect of scanning.
    expect(decision).not.toHaveProperty("countedQty");
  });
});
