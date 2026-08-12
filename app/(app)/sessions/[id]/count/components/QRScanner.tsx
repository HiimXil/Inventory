"use client";

import { useRef, useState } from "react";
import { useBarcodeScanner } from "../hooks/useBarcodeScanner";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { LoadingState } from "@/components/ui/LoadingState";
import { ErrorState } from "@/components/ui/ErrorState";

type QRScannerProps = {
  /** Called for every detected code and for a manually-typed reference alike — opening/updating the quantity-entry panel is entirely the caller's decision. */
  onScan: (articleRef: string) => void;
};

export function QRScanner({ onScan }: QRScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const { status, error } = useBarcodeScanner(videoRef, onScan);
  const [manualRef, setManualRef] = useState("");

  return (
    <div className="flex flex-col gap-3">
      <div className="relative aspect-square w-full max-h-72 overflow-hidden rounded-card border-2 border-border bg-surface">
        <video ref={videoRef} muted playsInline aria-label="Flux caméra pour le scan de codes QR" className="h-full w-full object-cover" />
        {status === "starting" && (
          <div className="absolute inset-0 flex items-center justify-center bg-surface">
            <LoadingState label="Démarrage de la caméra..." />
          </div>
        )}
        {status === "error" && (
          <div className="absolute inset-0 flex items-center justify-center bg-surface p-4">
            <ErrorState message={error ?? "Impossible d'accéder à la caméra."} />
          </div>
        )}
      </div>

      <form
        className="flex flex-col gap-2 sm:flex-row sm:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          const articleRef = manualRef.trim();
          if (articleRef.length > 0) {
            onScan(articleRef);
            setManualRef("");
          }
        }}
      >
        <div className="flex-1">
          <Field label="Saisir une référence scannée manuellement (si le scan caméra n'est pas possible)">
            {(controlProps) => (
              <Input
                {...controlProps}
                name="manual-scan-ref"
                value={manualRef}
                onChange={(event) => setManualRef(event.target.value)}
                placeholder="Référence article"
              />
            )}
          </Field>
        </div>
        <Button type="submit" variant="secondary">
          Ajouter
        </Button>
      </form>
    </div>
  );
}
