"use client";

import { useId } from "react";
import type { ReactNode } from "react";

export type FieldControlProps = {
  id: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
};

export type FieldProps = {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  /** Render-prop so Field stays control-agnostic (Input, NumericInput, a <select>, ...) while still owning the id/aria wiring. */
  children: (controlProps: FieldControlProps) => ReactNode;
};

/**
 * Label + control + hint/error, with the id/aria-describedby wiring done
 * once here instead of by hand in every screen (see the old LoginForm,
 * which repeated this manually per field).
 */
export function Field({ label, hint, error, required, children }: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className="flex flex-col gap-1.5">
      {/* aria-label pins the accessible name to the plain label text —
          aria-hidden on the "*" span alone doesn't reliably exclude it from
          a <label>'s computed name in Chromium, which would otherwise leak
          " *" into every getByLabel(..., { exact: true }) lookup.
          Required-ness itself is still conveyed to AT via the control's own
          `required` attribute, not this visual marker. */}
      <label htmlFor={id} aria-label={required ? label : undefined} className="text-base font-medium text-ink">
        {label}
        {required && (
          <span aria-hidden="true" className="text-danger-text">
            {" "}
            *
          </span>
        )}
      </label>

      {children({ id, "aria-describedby": describedBy, "aria-invalid": Boolean(error) })}

      {hint && !error && (
        <p id={hintId} className="text-sm text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-sm font-medium text-danger-text">
          {error}
        </p>
      )}
    </div>
  );
}
