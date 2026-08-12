export type ProgressBarProps = {
  value: number;
  max: number;
  label: string;
};

/**
 * Generic labeled progress bar. `max <= 0` renders an empty/inert bar
 * rather than dividing by zero — happens briefly while a session's
 * theoretical snapshot is still loading.
 */
export function ProgressBar({ value, max, label }: ProgressBarProps) {
  const percent = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-3 text-base font-medium text-ink">
        <span>{label}</span>
        <span className="text-muted">{percent}%</span>
      </div>
      <div
        role="progressbar"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-label={label}
        className="h-3 w-full overflow-hidden rounded-full bg-surface"
      >
        <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}
