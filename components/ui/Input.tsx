"use client";

import { forwardRef } from "react";
import type { InputHTMLAttributes } from "react";

export type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  /** Switches the border to the danger token — pair with Field's error text, never color alone for the error itself (the text carries the meaning). */
  hasError?: boolean;
};

/**
 * Bare input control. Prefer Field (which pairs this with a label and
 * hint/error text) rather than using Input directly in a screen.
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { hasError = false, className = "", ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      className={`min-h-touch-min w-full rounded-control border-2 bg-paper px-4 text-lg text-ink placeholder:text-muted disabled:cursor-not-allowed disabled:opacity-60 ${
        hasError ? "border-danger" : "border-border"
      } ${className}`}
      aria-invalid={hasError || undefined}
      {...props}
    />
  );
});
