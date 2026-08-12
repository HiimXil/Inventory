"use client";

import { Input } from "@/components/ui/Input";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import type { CountingViewMode } from "@/lib/offline/counting-filter";

type CountingFilterBarProps = {
  query: string;
  onQueryChange: (query: string) => void;
  mode: CountingViewMode;
  onModeChange: (mode: CountingViewMode) => void;
};

const MODE_OPTIONS: { value: CountingViewMode; label: string }[] = [
  { value: "all", label: "Tout" },
  { value: "ecart-first", label: "Écarts d'abord" },
  { value: "not-counted", label: "Non comptés" },
];

/**
 * Search + filter/sort for the list below — helps find one article among
 * dozens/hundreds without scrolling. Fully local/derived (see
 * lib/offline/counting-filter.ts); never touches what's actually stored.
 */
export function CountingFilterBar({ query, onQueryChange, mode, onModeChange }: CountingFilterBarProps) {
  return (
    <div className="flex flex-col gap-3">
      <Input
        type="search"
        inputMode="search"
        placeholder="Rechercher par référence ou désignation"
        aria-label="Rechercher un article"
        data-testid="counting-search-input"
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
      />
      <SegmentedControl value={mode} onChange={onModeChange} options={MODE_OPTIONS} aria-label="Trier ou filtrer la liste" />
    </div>
  );
}
