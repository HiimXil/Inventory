import { describe, expect, it } from "vitest";
import { computeCountingProgress, computePendingSyncCount } from "../../lib/offline/counting-progress";
import type { DisplayLine } from "../../lib/offline/scan-processing";
import type { CountLines } from "../../lib/offline/scan-processing";

describe("computeCountingProgress", () => {
  it("is 0/0 for an empty session", () => {
    expect(computeCountingProgress([])).toEqual({ counted: 0, total: 0 });
  });

  it("counts a never-touched line (countedQty null) as not yet seen", () => {
    const lines: DisplayLine[] = [
      { articleRef: "ART-001", designation: "A", theoreticalQty: 12, countedQty: null, isOffReferential: false },
      { articleRef: "ART-002", designation: "B", theoreticalQty: 5, countedQty: null, isOffReferential: false },
    ];
    expect(computeCountingProgress(lines)).toEqual({ counted: 0, total: 2 });
  });

  it("counts a line counted as exactly 0 as seen (distinct from never-touched)", () => {
    const lines: DisplayLine[] = [
      { articleRef: "ART-001", designation: "A", theoreticalQty: 12, countedQty: 0, isOffReferential: false },
    ];
    expect(computeCountingProgress(lines)).toEqual({ counted: 1, total: 1 });
  });

  it("counts a mix of seen and unseen theoretical lines correctly", () => {
    const lines: DisplayLine[] = [
      { articleRef: "ART-001", designation: "A", theoreticalQty: 12, countedQty: 12, isOffReferential: false },
      { articleRef: "ART-002", designation: "B", theoreticalQty: 5, countedQty: null, isOffReferential: false },
      { articleRef: "ART-003", designation: "C", theoreticalQty: 8, countedQty: 3, isOffReferential: false },
    ];
    expect(computeCountingProgress(lines)).toEqual({ counted: 2, total: 3 });
  });

  it("excludes off-referential lines from both counted and total", () => {
    const lines: DisplayLine[] = [
      { articleRef: "ART-001", designation: "A", theoreticalQty: 12, countedQty: 12, isOffReferential: false },
      { articleRef: "UNKNOWN-XYZ", designation: null, theoreticalQty: 0, countedQty: 1, isOffReferential: true },
    ];
    expect(computeCountingProgress(lines)).toEqual({ counted: 1, total: 1 });
  });
});

describe("computePendingSyncCount", () => {
  it("is 0 when the session isn't dirty, regardless of how many entries exist", () => {
    const countLines: CountLines = {
      "ART-001": { countedQty: 5, isOffReferential: false },
      "ART-002": { countedQty: 2, isOffReferential: false },
    };
    expect(computePendingSyncCount(countLines, false)).toBe(0);
  });

  it("counts distinct articles with an entry when dirty", () => {
    const countLines: CountLines = {
      "ART-001": { countedQty: 5, isOffReferential: false },
      "ART-002": { countedQty: 2, isOffReferential: false },
      "UNKNOWN-XYZ": { countedQty: 1, isOffReferential: true },
    };
    expect(computePendingSyncCount(countLines, true)).toBe(3);
  });

  it("is 0 for an empty countLines even when dirty", () => {
    expect(computePendingSyncCount({}, true)).toBe(0);
  });
});
