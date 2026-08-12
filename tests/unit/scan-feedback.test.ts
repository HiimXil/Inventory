import { describe, expect, it } from "vitest";
import { nextScanFeedbackState, type ScanFeedbackEvent } from "../../lib/offline/scan-feedback";

describe("nextScanFeedbackState", () => {
  it("reflects a confirmed total for a known article", () => {
    const event: ScanFeedbackEvent = {
      articleRef: "ART-001",
      designation: "Imprimante UV",
      countedQty: 3,
      isOffReferential: false,
      clamped: false,
    };
    expect(nextScanFeedbackState(event, 1_000)).toEqual({ ...event, at: 1_000 });
  });

  it("reflects a confirmed total for an off-referential article", () => {
    const event: ScanFeedbackEvent = {
      articleRef: "UNKNOWN-XYZ",
      designation: null,
      countedQty: 1,
      isOffReferential: true,
      clamped: false,
    };
    expect(nextScanFeedbackState(event, 2_000)).toEqual({ ...event, at: 2_000 });
  });

  it("carries the clamped flag through when a rescan delta was bounded to 0", () => {
    const event: ScanFeedbackEvent = {
      articleRef: "ART-001",
      designation: "Imprimante UV",
      countedQty: 0,
      isOffReferential: false,
      clamped: true,
    };
    expect(nextScanFeedbackState(event, 3_000)).toEqual({ ...event, at: 3_000 });
  });

  it("stamps the injected `now`, not a wall clock read", () => {
    const event: ScanFeedbackEvent = {
      articleRef: "ART-002",
      designation: null,
      countedQty: 4,
      isOffReferential: false,
      clamped: false,
    };
    expect(nextScanFeedbackState(event, 42).at).toBe(42);
    expect(nextScanFeedbackState(event, 43).at).toBe(43);
  });
});
