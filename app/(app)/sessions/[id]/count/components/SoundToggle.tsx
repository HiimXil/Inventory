"use client";

import { Button } from "@/components/ui/Button";

type SoundToggleProps = {
  enabled: boolean;
  onToggle: () => void;
};

/** Deliberately a tap target: enabling sound here is the user gesture that unlocks it on iOS Safari. */
export function SoundToggle({ enabled, onToggle }: SoundToggleProps) {
  return (
    <Button
      variant="secondary"
      size="compact"
      onClick={onToggle}
      aria-pressed={enabled}
      data-testid="scan-sound-toggle"
    >
      {enabled ? "🔊 Bip activé" : "🔇 Bip désactivé"}
    </Button>
  );
}
