export type ScanBeeper = {
  play: () => void;
  close: () => void;
};

/**
 * Short Web Audio beep for an accepted scan — synthesized, no audio file,
 * so it stays available fully offline. Returns null when AudioContext isn't
 * available (SSR, or a browser without Web Audio support) rather than
 * throwing, since sound is an optional feedback channel.
 *
 * iOS Safari only unlocks audio playback from inside a user gesture, so
 * callers must create/resume this from a tap handler (the sound toggle) —
 * never from the camera-detection loop itself, which is not a gesture.
 */
export function createScanBeeper(): ScanBeeper | null {
  if (typeof window === "undefined") return null;

  const AudioContextClass =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) return null;

  const context = new AudioContextClass();

  function play() {
    if (context.state === "suspended") {
      void context.resume();
    }
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.2, context.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.12);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.13);
  }

  function close() {
    void context.close();
  }

  return { play, close };
}
