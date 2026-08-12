"use client";

import { useActionState, useRef, useState } from "react";
import type { DragEvent } from "react";
import { prepareSession, type PrepareSessionState } from "../actions";
import { Button } from "@/components/ui/Button";
import { ErrorState } from "@/components/ui/ErrorState";
import { UploadCloudIcon, FileIcon } from "@/components/ui/icons";

type Depot = {
  id: string;
  code: string;
  name: string;
};

const initialState: PrepareSessionState = { error: null };

export function DepotSelector({ depots, requiresFile }: { depots: Depot[]; requiresFile: boolean }) {
  const [state, formAction, isPending] = useActionState(prepareSession, initialState);
  const [fileName, setFileName] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleFiles(files: FileList | null) {
    setFileName(files && files.length > 0 ? files[0].name : null);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragActive(false);
    if (isPending) return;
    const files = event.dataTransfer.files;
    if (files.length > 0 && fileInputRef.current) {
      fileInputRef.current.files = files;
      handleFiles(files);
    }
  }

  return (
    <form action={formAction} className="flex flex-col gap-6">
      {/* Not using the shared Field component here: /prepare's e2e tests
          drive the depot select via a stable #depotId id, which Field's
          internal useId() can't provide. */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="depotId" className="text-base font-medium text-ink">
          Dépôt<span aria-hidden="true" className="text-danger-text"> *</span>
        </label>
        <select
          id="depotId"
          name="depotId"
          required
          disabled={isPending}
          defaultValue=""
          className="min-h-touch-min w-full rounded-control border-2 border-border bg-paper px-4 text-lg text-ink disabled:cursor-not-allowed disabled:opacity-60"
        >
          <option value="" disabled>
            Sélectionner un dépôt
          </option>
          {depots.map((depot) => (
            <option key={depot.id} value={depot.id}>
              {depot.code} — {depot.name}
            </option>
          ))}
        </select>
        <p className="text-sm text-muted">
          Entrepôts et véhicules de techniciens (ex. « Véhicule (Franck) ») apparaissent tous ici, identifiés par
          leur code.
        </p>
      </div>

      {requiresFile && (
        <div className="flex flex-col gap-1.5">
          <span className="text-base font-medium text-ink">
            Fichier d&apos;export ARTIS<span aria-hidden="true" className="text-danger-text"> *</span>
          </span>
          <div
            onDragOver={(event) => {
              event.preventDefault();
              if (!isPending) setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={handleDrop}
            className={`relative flex flex-col items-center gap-2 rounded-card border-2 border-dashed px-6 py-8 text-center transition-colors ${
              dragActive ? "border-accent bg-accent/5" : "border-border bg-surface"
            } ${isPending ? "opacity-60" : ""}`}
          >
            <UploadCloudIcon className="h-8 w-8 shrink-0 text-accent-text" />
            {fileName ? (
              <>
                <p className="flex items-center gap-2 text-base font-medium text-ink">
                  <FileIcon className="h-5 w-5 shrink-0 text-accent-text" />
                  {fileName}
                </p>
                <p className="text-sm text-muted">Cliquez ou déposez un autre fichier pour le remplacer.</p>
              </>
            ) : (
              <>
                <p className="text-base font-medium text-ink">Glissez le fichier ici ou cliquez pour parcourir</p>
                <p className="text-sm text-muted">Format attendu : .xlsx — export ARTIS du stock théorique</p>
              </>
            )}
            <input
              ref={fileInputRef}
              id="artisFile"
              name="artisFile"
              type="file"
              accept=".xlsx"
              required
              disabled={isPending}
              onChange={(event) => handleFiles(event.target.files)}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
            />
          </div>
          <p className="text-sm text-muted">
            Le dépôt est déterminé par la sélection ci-dessus — le fichier importé ne porte pas cette information.
          </p>
        </div>
      )}

      <Button type="submit" loading={isPending} className="w-full">
        {isPending ? "Import du stock théorique en cours..." : "Préparer la session"}
      </Button>

      {state.error && (
        <div className="flex flex-col gap-3">
          <ErrorState message={state.error} />
          <Button type="submit" variant="secondary" disabled={isPending}>
            Réessayer
          </Button>
        </div>
      )}
    </form>
  );
}
