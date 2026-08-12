"use client";

import { forwardRef } from "react";
import { Input, type InputProps } from "./Input";

/**
 * Preset for the counting screen's quantity fields — always opens the
 * phone's numeric keypad (inputMode="numeric") and grows the digits large
 * enough to read at arm's length. Still a plain <input type="number">
 * underneath, so callers can override any prop (e.g. `min`/`step`) as
 * needed.
 */
export const NumericInput = forwardRef<HTMLInputElement, InputProps>(function NumericInput(
  { className = "", ...props },
  ref,
) {
  return (
    <Input
      ref={ref}
      type="number"
      inputMode="numeric"
      pattern="[0-9]*"
      step={1}
      className={`text-center text-display font-semibold tabular-nums ${className}`}
      {...props}
    />
  );
});
