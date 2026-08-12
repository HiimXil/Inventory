import { describe, expect, it } from "vitest";
import { filterAndSortLines } from "../../lib/offline/counting-filter";
import type { DiscrepancyLine } from "../../lib/offline/discrepancy";

function line(overrides: Partial<DiscrepancyLine>): DiscrepancyLine {
  return {
    articleRef: "ART-000",
    designation: null,
    theoreticalQty: 0,
    countedQty: null,
    isOffReferential: false,
    ecart: 0,
    status: "CONFORME",
    ...overrides,
  };
}

const LINES: DiscrepancyLine[] = [
  line({ articleRef: "ART-001", designation: "Imprimante UV", theoreticalQty: 12, countedQty: 12, ecart: 0, status: "CONFORME" }),
  line({ articleRef: "ART-002", designation: "Encre cyan", theoreticalQty: 48, countedQty: 40, ecart: -8, status: "ECART" }),
  line({ articleRef: "ART-003", designation: "Plaque aluminium", theoreticalQty: 8, countedQty: null, ecart: -8, status: "ECART" }),
  line({ articleRef: "ART-004", designation: "Encre magenta", theoreticalQty: 5, countedQty: 5, ecart: 0, status: "CONFORME" }),
];

describe("filterAndSortLines — query", () => {
  it("returns everything unfiltered for an empty query", () => {
    expect(filterAndSortLines(LINES, "", "all")).toEqual(LINES);
  });

  it("matches by article reference, case-insensitively", () => {
    const result = filterAndSortLines(LINES, "art-002", "all");
    expect(result.map((l) => l.articleRef)).toEqual(["ART-002"]);
  });

  it("matches by designation substring, case-insensitively", () => {
    const result = filterAndSortLines(LINES, "encre", "all");
    expect(result.map((l) => l.articleRef)).toEqual(["ART-002", "ART-004"]);
  });

  it("returns an empty list when nothing matches", () => {
    expect(filterAndSortLines(LINES, "does-not-exist", "all")).toEqual([]);
  });

  it("ignores surrounding whitespace in the query", () => {
    const result = filterAndSortLines(LINES, "  art-001  ", "all");
    expect(result.map((l) => l.articleRef)).toEqual(["ART-001"]);
  });
});

describe("filterAndSortLines — mode", () => {
  it("'all' preserves original order with no reordering or hiding", () => {
    expect(filterAndSortLines(LINES, "", "all").map((l) => l.articleRef)).toEqual([
      "ART-001",
      "ART-002",
      "ART-003",
      "ART-004",
    ]);
  });

  it("'ecart-first' moves ECART lines before CONFORME, stably within each group", () => {
    const result = filterAndSortLines(LINES, "", "ecart-first");
    expect(result.map((l) => l.articleRef)).toEqual(["ART-002", "ART-003", "ART-001", "ART-004"]);
  });

  it("'not-counted' keeps only never-touched lines (countedQty null)", () => {
    const result = filterAndSortLines(LINES, "", "not-counted");
    expect(result.map((l) => l.articleRef)).toEqual(["ART-003"]);
  });

  it("a line counted as exactly 0 is NOT included in 'not-counted' (seen, distinct from never-touched)", () => {
    const withZero = [...LINES, line({ articleRef: "ART-005", countedQty: 0, ecart: 0, status: "CONFORME" })];
    const result = filterAndSortLines(withZero, "", "not-counted");
    expect(result.map((l) => l.articleRef)).toEqual(["ART-003"]);
  });
});

describe("filterAndSortLines — query + mode combined", () => {
  it("applies the query before the mode's filter/sort", () => {
    const result = filterAndSortLines(LINES, "art-00", "ecart-first");
    expect(result.map((l) => l.articleRef)).toEqual(["ART-002", "ART-003", "ART-001", "ART-004"]);
  });

  it("does not mutate the input array", () => {
    const copy = [...LINES];
    filterAndSortLines(LINES, "", "ecart-first");
    expect(LINES).toEqual(copy);
  });
});
