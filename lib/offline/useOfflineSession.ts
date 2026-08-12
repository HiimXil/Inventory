"use client";

import { useCallback, useEffect, useState } from "react";
import { offlineDB, type OfflineSession } from "./db";
import {
  applyManualQuantity,
  applyQuantityDelta,
  buildDisplayLines,
  knownArticleRefsOf,
  totalCountedQty,
  type DisplayLine,
} from "./scan-processing";
import {
  buildDiscrepancyLines,
  summarizeDiscrepancies,
  type DiscrepancyLine,
  type DiscrepancySummary,
} from "./discrepancy";

export type QuantityUpdateOutcome =
  | {
      ok: true;
      articleRef: string;
      designation: string | null;
      countedQty: number;
      isOffReferential: boolean;
      /** True only for adjustQuantity: a delta that would go negative was bounded to 0. */
      clamped: boolean;
    }
  | { ok: false; error: string };

export type UseOfflineSessionResult = {
  loading: boolean;
  session: OfflineSession | null;
  displayLines: DisplayLine[];
  discrepancyLines: DiscrepancyLine[];
  discrepancySummary: DiscrepancySummary;
  totalCounted: number;
  /** Sets the absolute total — the quantity-entry panel's first-scan case, and the CountingTable inline correction. */
  setManualQuantity: (articleRef: string, quantity: number) => QuantityUpdateOutcome;
  /** Adjusts an already-counted total by a signed delta — the quantity-entry panel's rescan case. */
  adjustQuantity: (articleRef: string, delta: number) => QuantityUpdateOutcome;
  /** Re-reads the Dexie record — needed after a write that bypassed `setSession` (see lib/offline/sync.ts). */
  refresh: () => void;
};

const EMPTY_SUMMARY: DiscrepancySummary = { totalLines: 0, conformeCount: 0, ecartCount: 0 };

/**
 * Reads/writes the Dexie record for one session. Every mutation goes through
 * the functional `setSession` form so back-to-back confirms always operate
 * on the latest countLines rather than a stale render's closure. Scanning
 * itself never calls into this hook's mutators — only an explicit confirm
 * in the quantity-entry panel does (see lib/offline/scan-entry.ts).
 */
type LoadedFor = { sessionId: string; session: OfflineSession | null };

export function useOfflineSession(sessionId: string): UseOfflineSessionResult {
  const [loaded, setLoaded] = useState<LoadedFor | null>(null);
  // Not yet loaded for THIS sessionId — derived rather than a separate flag
  // toggled synchronously inside the effect.
  const loading = loaded === null || loaded.sessionId !== sessionId;
  const session = loading ? null : loaded.session;

  useEffect(() => {
    let cancelled = false;

    offlineDB.sessions.get(sessionId).then((record) => {
      if (cancelled) return;
      setLoaded({ sessionId, session: record ?? null });
    });

    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const refresh = useCallback(() => {
    offlineDB.sessions.get(sessionId).then((record) => {
      setLoaded({ sessionId, session: record ?? null });
    });
  }, [sessionId]);

  const setSession = useCallback(
    (updater: (prev: OfflineSession | null) => OfflineSession | null) => {
      setLoaded((prevLoaded) => {
        if (!prevLoaded || prevLoaded.sessionId !== sessionId) return prevLoaded;
        const nextSession = updater(prevLoaded.session);
        return nextSession === prevLoaded.session
          ? prevLoaded
          : { sessionId, session: nextSession };
      });
    },
    [sessionId],
  );

  const setManualQuantity = useCallback(
    (articleRef: string, quantity: number): QuantityUpdateOutcome => {
      let outcome: QuantityUpdateOutcome = { ok: false, error: "Session non chargée." };

      setSession((prev) => {
        if (!prev) return prev;

        const result = applyManualQuantity(
          prev.countLines,
          knownArticleRefsOf(prev.theoreticalLines),
          articleRef,
          quantity,
        );
        if (!result.ok) {
          outcome = result;
          return prev;
        }

        const theoreticalLine = prev.theoreticalLines.find((line) => line.articleRef === articleRef);
        outcome = {
          ok: true,
          articleRef,
          designation: theoreticalLine?.designation ?? null,
          countedQty: result.countLines[articleRef].countedQty,
          isOffReferential: result.countLines[articleRef].isOffReferential,
          clamped: false,
        };

        const next: OfflineSession = {
          ...prev,
          countLines: result.countLines,
          dirty: true,
          lastLocalUpdate: new Date().toISOString(),
        };
        void offlineDB.sessions.put(next);
        return next;
      });

      return outcome;
    },
    [setSession],
  );

  const adjustQuantity = useCallback(
    (articleRef: string, delta: number): QuantityUpdateOutcome => {
      let outcome: QuantityUpdateOutcome = { ok: false, error: "Session non chargée." };

      setSession((prev) => {
        if (!prev) return prev;

        const result = applyQuantityDelta(
          prev.countLines,
          knownArticleRefsOf(prev.theoreticalLines),
          articleRef,
          delta,
        );
        if (!result.ok) {
          outcome = result;
          return prev;
        }

        const theoreticalLine = prev.theoreticalLines.find((line) => line.articleRef === articleRef);
        outcome = {
          ok: true,
          articleRef,
          designation: theoreticalLine?.designation ?? null,
          countedQty: result.countedQty,
          isOffReferential: result.countLines[articleRef].isOffReferential,
          clamped: result.clamped,
        };

        const next: OfflineSession = {
          ...prev,
          countLines: result.countLines,
          dirty: true,
          lastLocalUpdate: new Date().toISOString(),
        };
        void offlineDB.sessions.put(next);
        return next;
      });

      return outcome;
    },
    [setSession],
  );

  const displayLines = session ? buildDisplayLines(session.theoreticalLines, session.countLines) : [];
  const discrepancyLines = buildDiscrepancyLines(displayLines);

  return {
    loading,
    session,
    displayLines,
    discrepancyLines,
    discrepancySummary: session ? summarizeDiscrepancies(discrepancyLines) : EMPTY_SUMMARY,
    totalCounted: session ? totalCountedQty(session.countLines) : 0,
    setManualQuantity,
    adjustQuantity,
    refresh,
  };
}
