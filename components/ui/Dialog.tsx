"use client";

import { useEffect, useRef } from "react";
import type { ReactNode } from "react";

export type DialogProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
};

/**
 * Built on the native <dialog> element rather than a hand-rolled modal or a
 * third-party library: showModal() gives focus trapping, ESC-to-close, and
 * background inertness for free, in every target browser (Chrome/Edge),
 * with zero added dependencies — exactly what "reste léger" calls for.
 * Closing on a backdrop click is added manually below, since <dialog>
 * doesn't do that natively.
 */
export function Dialog({ open, onClose, title, children, footer }: DialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === dialogRef.current) onClose();
      }}
      onCancel={onClose}
      aria-labelledby="dialog-title"
      className="w-[min(28rem,calc(100vw-2rem))] rounded-card border-2 border-border bg-paper p-6 text-ink shadow-elevated backdrop:bg-transparent"
    >
      <h2 id="dialog-title" className="text-xl font-semibold">
        {title}
      </h2>
      <div className="mt-3 text-base text-ink">{children}</div>
      {footer && <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">{footer}</div>}
    </dialog>
  );
}
