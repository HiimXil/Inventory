"use client";

import { useSyncExternalStore } from "react";

function subscribe(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

function getSnapshot() {
  return navigator.onLine;
}

// Connectivity is inherently a client-only concept — always "online" on the
// server. useSyncExternalStore's third argument is exactly this contract:
// the value to use for SSR/hydration, so the client's first render matches
// the server's exactly, then corrects itself right after (see the note in
// OfflineIndicator's git history: reading navigator.onLine directly in a
// useState initializer caused a hydration mismatch on Node 21+, which ships
// a partial `navigator` global with no `.onLine`).
function getServerSnapshot() {
  return true;
}

export function useOnlineStatus(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
