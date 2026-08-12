import { describe, expect, it } from "vitest";
import {
  applyManualQuantity,
  applyQuantityDelta,
  buildDisplayLines,
  knownArticleRefsOf,
  lineInfoFor,
  totalCountedQty,
  type CountLines,
} from "../../lib/offline/scan-processing";
import type { OfflineTheoreticalLine } from "../../lib/offline/db";

const THEORETICAL_LINES: OfflineTheoreticalLine[] = [
  { articleRef: "ART-001", designation: "Imprimante UV", theoreticalQty: 12 },
  { articleRef: "ART-002", designation: "Encre cyan", theoreticalQty: 48 },
];
const KNOWN_REFS = knownArticleRefsOf(THEORETICAL_LINES);

describe("lineInfoFor", () => {
  it("reports a never-counted known article as previousQty null", () => {
    expect(lineInfoFor(THEORETICAL_LINES, {}, "ART-001")).toEqual({
      designation: "Imprimante UV",
      previousQty: null,
      isOffReferential: false,
    });
  });

  it("reports an already-counted article's exact previous total, including 0", () => {
    const countLines: CountLines = { "ART-001": { countedQty: 0, isOffReferential: false } };
    expect(lineInfoFor(THEORETICAL_LINES, countLines, "ART-001")).toEqual({
      designation: "Imprimante UV",
      previousQty: 0,
      isOffReferential: false,
    });
  });

  it("flags an unknown reference as off-referential with no designation", () => {
    expect(lineInfoFor(THEORETICAL_LINES, {}, "UNKNOWN-XYZ")).toEqual({
      designation: null,
      previousQty: null,
      isOffReferential: true,
    });
  });

  it("never mutates countLines (read-only lookup)", () => {
    const countLines: CountLines = {};
    lineInfoFor(THEORETICAL_LINES, countLines, "ART-001");
    expect(countLines).toEqual({});
  });
});

describe("applyManualQuantity", () => {
  it("sets the exact counted quantity for a known reference", () => {
    const result = applyManualQuantity({}, KNOWN_REFS, "ART-001", 7);
    expect(result).toEqual({ ok: true, countLines: { "ART-001": { countedQty: 7, isOffReferential: false } } });
  });

  it("rejects negative quantities", () => {
    const result = applyManualQuantity({}, KNOWN_REFS, "ART-001", -1);
    expect(result.ok).toBe(false);
  });

  it("rejects non-integer quantities", () => {
    const result = applyManualQuantity({}, KNOWN_REFS, "ART-001", 2.5);
    expect(result.ok).toBe(false);
  });

  it("accepts zero as a valid quantity", () => {
    const result = applyManualQuantity({}, KNOWN_REFS, "ART-001", 0);
    expect(result.ok).toBe(true);
  });

  it("preserves the off-referential flag when correcting an existing off-referential line", () => {
    const withEntry = applyManualQuantity({}, KNOWN_REFS, "UNKNOWN-XYZ", 1);
    expect(withEntry.ok).toBe(true);
    if (!withEntry.ok) return;
    const result = applyManualQuantity(withEntry.countLines, KNOWN_REFS, "UNKNOWN-XYZ", 3);
    expect(result).toEqual({ ok: true, countLines: { "UNKNOWN-XYZ": { countedQty: 3, isOffReferential: true } } });
  });
});

describe("applyQuantityDelta", () => {
  it("adds a positive delta to an already-counted known reference", () => {
    const countLines: CountLines = { "ART-001": { countedQty: 5, isOffReferential: false } };
    const result = applyQuantityDelta(countLines, KNOWN_REFS, "ART-001", 3);
    expect(result).toEqual({
      ok: true,
      countLines: { "ART-001": { countedQty: 8, isOffReferential: false } },
      countedQty: 8,
      clamped: false,
    });
  });

  it("subtracts a negative delta", () => {
    const countLines: CountLines = { "ART-001": { countedQty: 8, isOffReferential: false } };
    const result = applyQuantityDelta(countLines, KNOWN_REFS, "ART-001", -3);
    expect(result).toEqual({
      ok: true,
      countLines: { "ART-001": { countedQty: 5, isOffReferential: false } },
      countedQty: 5,
      clamped: false,
    });
  });

  it("bounds a total that would go negative to 0 and flags it as clamped", () => {
    const countLines: CountLines = { "ART-001": { countedQty: 2, isOffReferential: false } };
    const result = applyQuantityDelta(countLines, KNOWN_REFS, "ART-001", -5);
    expect(result).toEqual({
      ok: true,
      countLines: { "ART-001": { countedQty: 0, isOffReferential: false } },
      countedQty: 0,
      clamped: true,
    });
  });

  it("treats a never-counted reference as a previous total of 0", () => {
    const result = applyQuantityDelta({}, KNOWN_REFS, "ART-001", 4);
    expect(result).toEqual({
      ok: true,
      countLines: { "ART-001": { countedQty: 4, isOffReferential: false } },
      countedQty: 4,
      clamped: false,
    });
  });

  it("rejects a non-integer delta", () => {
    const result = applyQuantityDelta({}, KNOWN_REFS, "ART-001", 1.5);
    expect(result.ok).toBe(false);
  });

  it("preserves the off-referential flag while adjusting the total", () => {
    const countLines: CountLines = { "UNKNOWN-XYZ": { countedQty: 2, isOffReferential: true } };
    const result = applyQuantityDelta(countLines, KNOWN_REFS, "UNKNOWN-XYZ", 1);
    expect(result).toEqual({
      ok: true,
      countLines: { "UNKNOWN-XYZ": { countedQty: 3, isOffReferential: true } },
      countedQty: 3,
      clamped: false,
    });
  });

  it("does not mutate the input map (pure function)", () => {
    const input: CountLines = { "ART-001": { countedQty: 5, isOffReferential: false } };
    applyQuantityDelta(input, KNOWN_REFS, "ART-001", 3);
    expect(input).toEqual({ "ART-001": { countedQty: 5, isOffReferential: false } });
  });
});

describe("buildDisplayLines", () => {
  it("lists every theoretical line as never-counted (null), not counted-as-zero", () => {
    const lines = buildDisplayLines(THEORETICAL_LINES, {});
    expect(lines).toHaveLength(2);
    expect(lines.every((l) => l.countedQty === null && !l.isOffReferential)).toBe(true);
  });

  it("appends off-referential lines distinctly, with theoreticalQty 0", () => {
    const withEntry = applyManualQuantity({}, KNOWN_REFS, "UNKNOWN-XYZ", 1);
    expect(withEntry.ok).toBe(true);
    if (!withEntry.ok) return;
    const lines = buildDisplayLines(THEORETICAL_LINES, withEntry.countLines);
    expect(lines).toHaveLength(3);
    const offRef = lines.find((l) => l.articleRef === "UNKNOWN-XYZ");
    expect(offRef).toEqual({
      articleRef: "UNKNOWN-XYZ",
      designation: null,
      theoreticalQty: 0,
      countedQty: 1,
      isOffReferential: true,
    });
  });
});

describe("totalCountedQty", () => {
  it("sums counted quantities across known and off-referential lines", () => {
    const countLines: CountLines = {
      "ART-001": { countedQty: 2, isOffReferential: false },
      "UNKNOWN-XYZ": { countedQty: 1, isOffReferential: true },
    };
    expect(totalCountedQty(countLines)).toBe(3);
  });
});
