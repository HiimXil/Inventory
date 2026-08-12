import type { CountLines, DisplayLine } from "./scan-processing";

export type CountingProgress = { counted: number; total: number };

/**
 * "N / M articles comptés" — how many THEORETICAL articles have been seen
 * at least once, out of the total theoretical count. Off-referential lines
 * (isOffReferential: true) are extras, not part of "théorique", so they
 * never affect either number. A line counted as exactly 0 still counts as
 * "seen" — only `countedQty === null` (never touched) does not.
 */
export function computeCountingProgress(lines: DisplayLine[]): CountingProgress {
  const theoreticalLines = lines.filter((line) => !line.isOffReferential);
  const counted = theoreticalLines.filter((line) => line.countedQty !== null).length;
  return { counted, total: theoreticalLines.length };
}

/**
 * "N comptages en attente de synchro" — the data model only tracks a single
 * session-wide `dirty` flag (see lib/offline/db.ts), not a per-line pending
 * state, so this is the most honest number derivable from it: every
 * distinct article currently on file, but only while the session as a whole
 * hasn't been pushed yet. 0 once `dirty` is false, regardless of how many
 * entries `countLines` still holds.
 */
export function computePendingSyncCount(countLines: CountLines, dirty: boolean): number {
  return dirty ? Object.keys(countLines).length : 0;
}
