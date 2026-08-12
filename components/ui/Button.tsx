"use client";

import { forwardRef } from "react";
import type { ButtonHTMLAttributes } from "react";
import { SpinnerIcon } from "./icons";

export type ButtonVariant = "primary" | "secondary" | "danger";
export type ButtonSize = "compact" | "comfortable" | "count";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  /**
   * "comfortable" (56px) is the default floor for any button — the brief's
   * "large tactile target by default". "compact" only drops to the 48px
   * absolute minimum, never below. "count" (64px) is for the counting
   * screen's validate/confirm actions, used with gloves under time pressure.
   */
  size?: ButtonSize;
  /** Disables the button and shows a spinner ahead of children, without changing the children text itself. */
  loading?: boolean;
};

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: "bg-accent text-on-brand hover:brightness-110 active:brightness-95",
  secondary: "border-2 border-border bg-paper text-ink hover:bg-surface active:bg-surface",
  danger: "bg-danger text-on-brand hover:brightness-110 active:brightness-95",
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  compact: "min-h-touch-min px-4 text-base",
  comfortable: "min-h-touch-comfortable px-5 text-lg",
  count: "min-h-touch-count px-6 text-xl",
};

/**
 * Base action control. Every variant/size combination already meets the
 * touch-target floor from globals.css — callers never need to add their own
 * min-h-* override. Focus ring comes from the global :focus-visible rule,
 * not duplicated here.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "comfortable", loading = false, disabled, className = "", children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={props.type ?? "button"}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`inline-flex items-center justify-center gap-2 rounded-control font-semibold transition-[filter,background-color] disabled:cursor-not-allowed disabled:opacity-60 ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]} ${className}`}
      {...props}
    >
      {loading && <SpinnerIcon className="h-5 w-5" />}
      {children}
    </button>
  );
});
