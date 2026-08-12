import type { ReactNode } from "react";

export type EmptyStateProps = {
  title: string;
  /** The "invitation à agir" — what the person can do next, not just what's missing. */
  description: string;
  action?: ReactNode;
};

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-card border-2 border-dashed border-border px-6 py-10 text-center">
      <p className="text-lg font-semibold text-ink">{title}</p>
      <p className="max-w-sm text-base text-muted">{description}</p>
      {action}
    </div>
  );
}
