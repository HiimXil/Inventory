import type { DisplayLine } from "./scan-processing";

export type DiscrepancyStatus = "CONFORME" | "ECART";

export type DiscrepancyLine = DisplayLine & {
  ecart: number;
  status: DiscrepancyStatus;
};

/**
 * FR-006: ecart = counted - theoretical. A line never counted (countedQty =
 * null) is treated as 0 for this calculation — but callers must keep using
 * DisplayLine.countedQty (not this function) to render "never counted"
 * distinctly from "counted, found to be 0".
 */
export function computeEcart(theoreticalQty: number, countedQty: number | null): number {
  return (countedQty ?? 0) - theoreticalQty;
}

export function computeStatus(ecart: number): DiscrepancyStatus {
  return ecart === 0 ? "CONFORME" : "ECART";
}

export function toDiscrepancyLine(line: DisplayLine): DiscrepancyLine {
  const ecart = computeEcart(line.theoreticalQty, line.countedQty);
  return { ...line, ecart, status: computeStatus(ecart) };
}

/**
 * Off-referential lines always carry ecart > 0 (they only exist once
 * scanned, so countedQty >= 1 against a theoreticalQty of 0) — no special
 * casing needed, it falls out of the same formula.
 */
export function buildDiscrepancyLines(lines: DisplayLine[]): DiscrepancyLine[] {
  return lines.map(toDiscrepancyLine);
}

export type DiscrepancySummary = {
  totalLines: number;
  conformeCount: number;
  ecartCount: number;
};

export function summarizeDiscrepancies(lines: DiscrepancyLine[]): DiscrepancySummary {
  const ecartCount = lines.filter((line) => line.status === "ECART").length;
  return {
    totalLines: lines.length,
    conformeCount: lines.length - ecartCount,
    ecartCount,
  };
}
