import type { ReactNode } from "react";

export type BadgeTone = "success" | "danger" | "accent" | "neutral";

export type BadgeProps = {
  tone: BadgeTone;
  /** Always required — color alone must never be the only signal (WCAG 1.4.1); pass one of the icons from ./icons. */
  icon: ReactNode;
  children: ReactNode;
};

const TONE_CLASSES: Record<BadgeTone, string> = {
  success: "border-success bg-success/10 text-success-text",
  danger: "border-danger bg-danger/10 text-danger-text",
  accent: "border-accent bg-accent/10 text-accent-text",
  neutral: "border-border bg-surface text-ink",
};

/**
 * Generic status pill — icon + label, never color alone. Prefer StatusBadge
 * for the app's known status vocabulary (conforme/écart/hors référentiel,
 * PREPARED/SYNCED/CLOSED/CANCELLED); use Badge directly only for a status
 * that vocabulary doesn't cover.
 */
export function Badge({ tone, icon, children }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border-2 px-3 py-1 text-sm font-semibold ${TONE_CLASSES[tone]}`}
    >
      <span className="h-4 w-4 shrink-0">{icon}</span>
      {children}
    </span>
  );
}
