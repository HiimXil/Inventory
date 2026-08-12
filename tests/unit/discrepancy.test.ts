import { describe, expect, it } from "vitest";
import {
  buildDiscrepancyLines,
  computeEcart,
  computeStatus,
  summarizeDiscrepancies,
} from "../../lib/offline/discrepancy";
import { applyManualQuantity, buildDisplayLines, knownArticleRefsOf } from "../../lib/offline/scan-processing";
import type { OfflineTheoreticalLine } from "../../lib/offline/db";

const THEORETICAL_LINES: OfflineTheoreticalLine[] = [
  { articleRef: "ART-001", designation: "Imprimante UV", theoreticalQty: 12 },
  { articleRef: "ART-002", designation: "Encre cyan", theoreticalQty: 5 },
];
const KNOWN_REFS = knownArticleRefsOf(THEORETICAL_LINES);

describe("computeEcart / computeStatus", () => {
  it("ecart = counted - theoretical", () => {
    expect(computeEcart(12, 12)).toBe(0);
    expect(computeEcart(12, 10)).toBe(-2);
    expect(computeEcart(5, 8)).toBe(3);
  });

  it("is CONFORME when ecart is 0, ECART otherwise", () => {
    expect(computeStatus(0)).toBe("CONFORME");
    expect(computeStatus(-2)).toBe("ECART");
    expect(computeStatus(3)).toBe("ECART");
  });

  it("treats a never-counted line (null) as 0 for the calculation", () => {
    expect(computeEcart(12, null)).toBe(-12);
    expect(computeStatus(computeEcart(12, null))).toBe("ECART");
  });

  it("a never-counted line with theoreticalQty 0 is still CONFORME (0 - 0 = 0)", () => {
    expect(computeEcart(0, null)).toBe(0);
    expect(computeStatus(computeEcart(0, null))).toBe("CONFORME");
  });
});

describe("buildDiscrepancyLines", () => {
  it("marks a line CONFORME when counted equals theoretical", () => {
    const lines = buildDisplayLines(THEORETICAL_LINES, { "ART-001": { countedQty: 12, isOffReferential: false } });
    const discrepancies = buildDiscrepancyLines(lines);
    const art001 = discrepancies.find((l) => l.articleRef === "ART-001");
    expect(art001?.ecart).toBe(0);
    expect(art001?.status).toBe("CONFORME");
  });

  it("marks a line ECART when counted differs from theoretical", () => {
    const lines = buildDisplayLines(THEORETICAL_LINES, { "ART-002": { countedQty: 2, isOffReferential: false } });
    const discrepancies = buildDiscrepancyLines(lines);
    const art002 = discrepancies.find((l) => l.articleRef === "ART-002");
    expect(art002?.ecart).toBe(-3);
    expect(art002?.status).toBe("ECART");
  });

  it("keeps countedQty as null (never counted) while still computing an ecart for the summary", () => {
    const lines = buildDisplayLines(THEORETICAL_LINES, {});
    const discrepancies = buildDiscrepancyLines(lines);
    const art001 = discrepancies.find((l) => l.articleRef === "ART-001");
    expect(art001?.countedQty).toBeNull();
    expect(art001?.ecart).toBe(-12);
    expect(art001?.status).toBe("ECART");
  });

  it("flags an off-referential scan as a positive ecart", () => {
    const withEntry = applyManualQuantity({}, KNOWN_REFS, "UNKNOWN-XYZ", 1);
    expect(withEntry.ok).toBe(true);
    if (!withEntry.ok) return;
    const lines = buildDisplayLines(THEORETICAL_LINES, withEntry.countLines);
    const discrepancies = buildDiscrepancyLines(lines);
    const offRef = discrepancies.find((l) => l.articleRef === "UNKNOWN-XYZ");
    expect(offRef?.isOffReferential).toBe(true);
    expect(offRef?.theoreticalQty).toBe(0);
    expect(offRef?.ecart).toBe(1);
    expect(offRef?.status).toBe("ECART");
  });
});

describe("summarizeDiscrepancies", () => {
  it("counts conforme vs ecart lines", () => {
    const countLines = {
      "ART-001": { countedQty: 12, isOffReferential: false }, // conforme
      "ART-002": { countedQty: 2, isOffReferential: false }, // ecart
    };
    const lines = buildDisplayLines(THEORETICAL_LINES, countLines);
    const discrepancies = buildDiscrepancyLines(lines);
    const summary = summarizeDiscrepancies(discrepancies);
    expect(summary).toEqual({ totalLines: 2, conformeCount: 1, ecartCount: 1 });
  });
});
