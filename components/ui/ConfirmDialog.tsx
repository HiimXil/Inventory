"use client";

import { Dialog } from "./Dialog";
import { Button } from "./Button";

export type ConfirmDialogProps = {
  open: boolean;
  title: string;
  description: string;
  /** Destructive actions (annulation de session, désactivation) get the danger button treatment. */
  danger?: boolean;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
};

/**
 * The replacement for window.confirm() (clôture de session, annulation de
 * session, désactivation d'utilisateur/dépôt) — same "are you sure" shape,
 * but legible, on-brand, and keyboard/focus-correct via Dialog.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  danger = false,
  confirmLabel = "Confirmer",
  cancelLabel = "Annuler",
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={title}
      footer={
        <>
          <Button variant="secondary" size="compact" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button variant={danger ? "danger" : "primary"} size="compact" onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p>{description}</p>
    </Dialog>
  );
}
