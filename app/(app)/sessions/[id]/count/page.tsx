"use client";

// OFFLINE ISLAND (FR-026). Do NOT add a server-side auth render/redirect
// guard on this route: when the device is offline, this request never
// reaches the server, so a guard here would break the primary offline
// counting flow. Authentication is enforced only at the two server
// boundaries this page talks to — GET /bootstrap and (later) POST /sync —
// never by blocking this page's render. See plan.md Decision #6.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { ensureSessionBootstrapped } from "@/lib/offline/bootstrap";
import { useOfflineSession, type QuantityUpdateOutcome } from "@/lib/offline/useOfflineSession";
import { nextScanFeedbackState, type ScanFeedbackState } from "@/lib/offline/scan-feedback";
import { lineInfoFor, resolveArticleRef } from "@/lib/offline/scan-processing";
import { computeCountingProgress, computePendingSyncCount } from "@/lib/offline/counting-progress";
import { filterAndSortLines, type CountingViewMode } from "@/lib/offline/counting-filter";
import { AppShell } from "@/components/layout/AppShell";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { LoadingState } from "@/components/ui/LoadingState";
import { ErrorState } from "@/components/ui/ErrorState";
import { useSyncTrigger } from "./hooks/useSyncTrigger";
import { useScanSound } from "./hooks/useScanSound";
import { useScanEntryPanel } from "./hooks/useScanEntryPanel";
import { QRScanner } from "./components/QRScanner";
import { QuantityEntryPanel } from "./components/QuantityEntryPanel";
import { CountingFilterBar } from "./components/CountingFilterBar";
import { CountingTable } from "./components/CountingTable";
import { DiscrepancyView } from "./components/DiscrepancyView";
import { ScanFeedbackBanner } from "./components/ScanFeedbackBanner";
import { SoundToggle } from "./components/SoundToggle";
import { SyncButton } from "./components/SyncButton";
import { ShellVersionWarning } from "./components/ShellVersionWarning";

type BootstrapState =
  | { status: "loading" }
  | { status: "ready" }
  | { status: "error"; message: string };

export default function CountingPage() {
  const params = useParams<{ id: string }>();
  const sessionId = params.id;
  const [bootstrapState, setBootstrapState] = useState<BootstrapState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    ensureSessionBootstrapped(sessionId).then((outcome) => {
      if (cancelled) return;
      setBootstrapState(
        outcome.status === "error" || outcome.status === "not-found"
          ? { status: "error", message: outcome.message }
          : { status: "ready" },
      );
    });

    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  if (bootstrapState.status === "loading") {
    return (
      <AppShell>
        <LoadingState label="Chargement de la session..." />
      </AppShell>
    );
  }

  if (bootstrapState.status === "error") {
    return (
      <AppShell>
        <ErrorState message={bootstrapState.message} />
      </AppShell>
    );
  }

  // Only mounted once the session is confirmed present in IndexedDB, so its
  // own Dexie read below never races the bootstrap write above.
  return <SessionCounter sessionId={sessionId} />;
}

function SessionCounter({ sessionId }: { sessionId: string }) {
  const {
    session,
    loading,
    displayLines,
    discrepancyLines,
    discrepancySummary,
    totalCounted,
    setManualQuantity,
    adjustQuantity,
    refresh,
  } = useOfflineSession(sessionId);

  const {
    status: syncStatus,
    retry: retrySync,
    versionMismatch,
  } = useSyncTrigger(sessionId, session?.dirty ?? false, refresh);

  const { enabled: soundEnabled, toggle: toggleSound, playBeep } = useScanSound();
  const [lastConfirmed, setLastConfirmed] = useState<ScanFeedbackState | null>(null);
  const { panel, handleScan, closePanel } = useScanEntryPanel();

  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<CountingViewMode>("all");

  // Fires for a camera detection, a manually-typed reference, and a tap on
  // a row in the table below (CountingTable's onSelectLine) alike — all
  // three funnel through this one handler, which is also the single
  // articleRef/supplierRef resolution point (resolveArticleRef): a scanned
  // or typed value that only matches a Référence fournisseur is translated
  // to its real Code art. before anything else happens, so the count lands
  // on the right line either way. Either way, this only ever opens/updates
  // the quantity-entry panel. A vibration confirms "the scan registered,
  // the panel is open, go type"; the actual quantity never changes here
  // (see handleConfirmTotal/handleConfirmDelta below), only on explicit
  // confirm.
  const handleDetected = useCallback(
    (rawRef: string) => {
      if (!session) return;
      const resolution = resolveArticleRef(session.theoreticalLines, rawRef);
      const articleRef = resolution.status === "resolved" ? resolution.articleRef : rawRef.trim();
      const lineInfo = lineInfoFor(session.theoreticalLines, session.countLines, articleRef);
      const opened = handleScan(articleRef, lineInfo);
      if (opened && typeof navigator !== "undefined" && "vibrate" in navigator) {
        navigator.vibrate(80);
      }
    },
    [session, handleScan],
  );

  const applyConfirmOutcome = useCallback(
    (outcome: QuantityUpdateOutcome) => {
      closePanel();
      if (!outcome.ok) return;
      setLastConfirmed(
        nextScanFeedbackState(
          {
            articleRef: outcome.articleRef,
            designation: outcome.designation,
            countedQty: outcome.countedQty,
            isOffReferential: outcome.isOffReferential,
            clamped: outcome.clamped,
          },
          Date.now(),
        ),
      );
      playBeep();
    },
    [closePanel, playBeep],
  );

  const handleConfirmTotal = useCallback(
    (articleRef: string, total: number) => applyConfirmOutcome(setManualQuantity(articleRef, total)),
    [setManualQuantity, applyConfirmOutcome],
  );

  const handleConfirmDelta = useCallback(
    (articleRef: string, delta: number) => applyConfirmOutcome(adjustQuantity(articleRef, delta)),
    [adjustQuantity, applyConfirmOutcome],
  );

  const progress = useMemo(() => computeCountingProgress(displayLines), [displayLines]);
  const pendingCount = session ? computePendingSyncCount(session.countLines, session.dirty) : 0;
  const visibleLines = useMemo(
    () => filterAndSortLines(discrepancyLines, searchQuery, viewMode),
    [discrepancyLines, searchQuery, viewMode],
  );

  if (loading || !session) {
    return (
      <AppShell>
        <LoadingState label="Chargement des données locales..." />
      </AppShell>
    );
  }

  return (
    <AppShell unsynced={session.dirty} pendingCount={pendingCount} actions={<SoundToggle enabled={soundEnabled} onToggle={toggleSound} />}>
      <div className="flex flex-1 flex-col gap-5 pb-8">
        <Breadcrumb
          items={[
            { label: "Sessions", href: "/sessions" },
            { label: `${session.meta.depotCode} — ${session.meta.depotName}` },
            { label: "Comptage" },
          ]}
        />
        <h1 className="text-2xl font-bold text-ink">Comptage — {session.meta.depotCode}</h1>

        <div className="sticky top-0 z-10 -mx-4 bg-paper px-4 py-3 sm:-mx-6 sm:px-6">
          <ProgressBar
            value={progress.counted}
            max={progress.total}
            label={`${progress.counted} / ${progress.total} articles comptés`}
          />
        </div>

        <QRScanner onScan={handleDetected} />

        <ScanFeedbackBanner feedback={lastConfirmed} />

        <DiscrepancyView summary={discrepancySummary} />

        <CountingFilterBar query={searchQuery} onQueryChange={setSearchQuery} mode={viewMode} onModeChange={setViewMode} />

        <CountingTable
          lines={visibleLines}
          total={totalCounted}
          onSelectLine={handleDetected}
          lastConfirmedRef={lastConfirmed?.articleRef ?? null}
          lastConfirmedAt={lastConfirmed?.at ?? null}
        />

        <SyncButton dirty={session.dirty} status={syncStatus} onRetry={retrySync} />
        <ShellVersionWarning visible={versionMismatch} />
      </div>

      {panel.status === "open" && (
        <QuantityEntryPanel
          panel={panel}
          onConfirmTotal={handleConfirmTotal}
          onConfirmDelta={handleConfirmDelta}
          onCancel={closePanel}
        />
      )}
    </AppShell>
  );
}
