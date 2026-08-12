"use client";

import { useCallback, useRef, useState } from "react";
import { decideScanAction, type ScanPanelState } from "@/lib/offline/scan-entry";
import type { LineInfo } from "@/lib/offline/scan-processing";

export type UseScanEntryPanelResult = {
  panel: ScanPanelState;
  /** Returns true if this call actually opened the panel — callers use that to gate haptic feedback. */
  handleScan: (articleRef: string, lineInfo: LineInfo) => boolean;
  closePanel: () => void;
};

const CLOSED: ScanPanelState = { status: "closed" };

/**
 * Owns the quantity-entry panel's open/closed state. `panelRef` mirrors
 * `panel` synchronously: the camera can call `handleScan` dozens of times a
 * second while a code sits in frame, faster than a React state update is
 * guaranteed to have committed, so the "already open" check in
 * decideScanAction reads/writes the ref — not the state — to never let two
 * rapid detections both open a panel.
 */
export function useScanEntryPanel(): UseScanEntryPanelResult {
  const [panel, setPanel] = useState<ScanPanelState>(CLOSED);
  const panelRef = useRef<ScanPanelState>(CLOSED);

  const handleScan = useCallback((articleRef: string, lineInfo: LineInfo): boolean => {
    const decision = decideScanAction(panelRef.current, articleRef, lineInfo);
    if (decision.action === "ignore") return false;
    panelRef.current = decision.panel;
    setPanel(decision.panel);
    return true;
  }, []);

  const closePanel = useCallback(() => {
    panelRef.current = CLOSED;
    setPanel(CLOSED);
  }, []);

  return { panel, handleScan, closePanel };
}
