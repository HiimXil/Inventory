import { SpinnerIcon } from "./icons";

export type LoadingStateProps = {
  label?: string;
};

/**
 * `role="status"` + `aria-live="polite"` so screen readers announce it once
 * without interrupting; the spin itself is inert under prefers-reduced-motion
 * (see the global rule in globals.css), so this never relies on motion to
 * communicate "in progress" — the label text always does that too.
 */
export function LoadingState({ label = "Chargement..." }: LoadingStateProps) {
  return (
    <div role="status" aria-live="polite" className="flex items-center gap-3 py-6 text-base text-muted">
      <SpinnerIcon className="h-5 w-5 text-accent-text" />
      <span>{label}</span>
    </div>
  );
}
