"use client";

export type SegmentedControlOption<T extends string> = {
  value: T;
  label: string;
};

export type SegmentedControlProps<T extends string> = {
  value: T;
  onChange: (value: T) => void;
  options: SegmentedControlOption<T>[];
  /** "comfortable" (default, 56px) for general use; "count" (64px) for the quantity panel's Ajouter/Retirer toggle. */
  size?: "comfortable" | "count";
  "aria-label": string;
};

const SIZE_CLASSES: Record<"comfortable" | "count", string> = {
  comfortable: "min-h-touch-comfortable text-base",
  count: "min-h-touch-count text-xl",
};

/**
 * A row of mutually-exclusive options, each a large tap target — used for
 * the quantity panel's Ajouter/Retirer choice and the counting list's
 * Tout/Écarts d'abord/Non comptés filter alike.
 */
export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  size = "comfortable",
  ...rest
}: SegmentedControlProps<T>) {
  return (
    <div role="radiogroup" aria-label={rest["aria-label"]} className="grid grid-flow-col auto-cols-fr gap-2">
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            className={`rounded-control border-2 px-3 font-semibold transition-colors ${SIZE_CLASSES[size]} ${
              selected
                ? "border-accent bg-accent text-on-brand"
                : "border-border bg-paper text-ink hover:bg-surface"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
