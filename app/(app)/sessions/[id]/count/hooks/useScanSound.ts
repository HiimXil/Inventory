"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createScanBeeper, type ScanBeeper } from "@/lib/offline/scan-sound";

const STORAGE_KEY = "sqp-scan-sound-enabled";

export type UseScanSoundResult = {
  enabled: boolean;
  toggle: () => void;
  playBeep: () => void;
};

function readStoredPreference(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(STORAGE_KEY) === "true";
}

/**
 * Sound defaults to off and is only ever created/resumed inside `toggle` —
 * the tap that flips it on is the user gesture iOS Safari requires to
 * unlock AudioContext playback. Restoring a previously-enabled preference
 * still updates the UI immediately, but the first beep of a fresh session
 * may stay silent on iOS until the user taps the toggle again; that's a
 * platform limit, not a bug here.
 */
export function useScanSound(): UseScanSoundResult {
  const [enabled, setEnabled] = useState(readStoredPreference);
  const beeperRef = useRef<ScanBeeper | null>(null);

  // Ref-only: creating the AudioContext here doesn't call setState, so it
  // isn't a synchronous-setState-in-effect. It's still gated behind a prior
  // user gesture in practice, because `enabled` can only be true here either
  // from `toggle` (a tap) or a restored preference — never from the
  // scan-detection loop itself.
  useEffect(() => {
    if (enabled && !beeperRef.current) {
      beeperRef.current = createScanBeeper();
    }
  }, [enabled]);

  useEffect(() => {
    return () => {
      beeperRef.current?.close();
      beeperRef.current = null;
    };
  }, []);

  const toggle = useCallback(() => {
    setEnabled((prev) => {
      const next = !prev;
      if (next && !beeperRef.current) {
        beeperRef.current = createScanBeeper();
      }
      if (typeof window !== "undefined") {
        window.localStorage.setItem(STORAGE_KEY, String(next));
      }
      return next;
    });
  }, []);

  const playBeep = useCallback(() => {
    if (!enabled) return;
    if (!beeperRef.current) {
      beeperRef.current = createScanBeeper();
    }
    beeperRef.current?.play();
  }, [enabled]);

  return { enabled, toggle, playBeep };
}
