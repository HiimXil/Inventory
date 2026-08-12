/**
 * Small hand-authored icon set — no icon library dependency (keeps the
 * bundle light for an offline-first PWA). Every icon shares a 24x24
 * viewBox, `currentColor`, and a slightly bolder stroke (2.25) than the web
 * default (1.5–2): at small badge sizes, thin strokes wash out in direct
 * sunlight.
 *
 * These icons are what makes status color non-exclusive (WCAG 1.4.1) — a
 * colorblind user must be able to tell "conforme" from "écart" from shape
 * alone, so every semantic color in Badge/StatusBadge is always paired with
 * one of these, never shown as a bare color swatch.
 */
import type { SVGProps } from "react";

type IconProps = Omit<SVGProps<SVGSVGElement>, "viewBox" | "fill">;

function baseProps(props: IconProps) {
  return {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2.25,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    ...props,
  };
}

export function CheckCircleIcon(props: IconProps) {
  return (
    <svg {...baseProps(props)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M8.5 12.5l2.5 2.5 5-5.5" />
    </svg>
  );
}

export function AlertTriangleIcon(props: IconProps) {
  return (
    <svg {...baseProps(props)}>
      <path d="M12 4.5l8.5 14.5H3.5L12 4.5z" />
      <path d="M12 10v4" />
      <circle cx="12" cy="17" r="0.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function TagIcon(props: IconProps) {
  return (
    <svg {...baseProps(props)}>
      <path d="M11.5 4H6a2 2 0 0 0-2 2v5.5a2 2 0 0 0 .59 1.41l8.5 8.5a2 2 0 0 0 2.82 0l5.5-5.5a2 2 0 0 0 0-2.82l-8.5-8.5A2 2 0 0 0 11.5 4z" />
      <circle cx="8" cy="9" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function ClockIcon(props: IconProps) {
  return (
    <svg {...baseProps(props)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" />
    </svg>
  );
}

export function UploadCloudIcon(props: IconProps) {
  return (
    <svg {...baseProps(props)}>
      <path d="M7 17.5a4.5 4.5 0 0 1 .5-8.98A6 6 0 0 1 19 10.5a3.5 3.5 0 0 1-1 6.86" />
      <path d="M12 20v-7" />
      <path d="M9 15.5l3-3 3 3" />
    </svg>
  );
}

export function LockIcon(props: IconProps) {
  return (
    <svg {...baseProps(props)}>
      <rect x="5" y="11" width="14" height="9" rx="1.5" />
      <path d="M8 11V7.5a4 4 0 0 1 8 0V11" />
    </svg>
  );
}

export function BanIcon(props: IconProps) {
  return (
    <svg {...baseProps(props)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M6.5 6.5l11 11" />
    </svg>
  );
}

export function WifiOffIcon(props: IconProps) {
  return (
    <svg {...baseProps(props)}>
      <path d="M3 3l18 18" />
      <path d="M8.5 16.5a5 5 0 0 1 7 0" />
      <path d="M5.5 12.5a10 10 0 0 1 3.4-2.3" />
      <path d="M12.2 8.02a10 10 0 0 1 6.3 3" />
      <path d="M2.5 9a13.5 13.5 0 0 1 3-2.1" />
      <circle cx="12" cy="20" r="0.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function RefreshIcon(props: IconProps) {
  return (
    <svg {...baseProps(props)}>
      <path d="M4 12a8 8 0 0 1 14-5.3L20 8" />
      <path d="M20 4v4h-4" />
      <path d="M20 12a8 8 0 0 1-14 5.3L4 16" />
      <path d="M4 20v-4h4" />
    </svg>
  );
}

export function UserIcon(props: IconProps) {
  return (
    <svg {...baseProps(props)}>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20c0-3.5 3.13-6 7-6s7 2.5 7 6" />
    </svg>
  );
}

export function LogOutIcon(props: IconProps) {
  return (
    <svg {...baseProps(props)}>
      <path d="M9 20H5.5A1.5 1.5 0 0 1 4 18.5v-13A1.5 1.5 0 0 1 5.5 4H9" />
      <path d="M16 16l4-4-4-4" />
      <path d="M20 12H9" />
    </svg>
  );
}

export function BoxIcon(props: IconProps) {
  return (
    <svg {...baseProps(props)}>
      <path d="M3.5 8l8.5-4 8.5 4-8.5 4-8.5-4z" />
      <path d="M3.5 8v8l8.5 4 8.5-4V8" />
      <path d="M12 12v8" />
    </svg>
  );
}

export function ListIcon(props: IconProps) {
  return (
    <svg {...baseProps(props)}>
      <path d="M9 6h11" />
      <path d="M9 12h11" />
      <path d="M9 18h11" />
      <circle cx="4.5" cy="6" r="1" fill="currentColor" stroke="none" />
      <circle cx="4.5" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="4.5" cy="18" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function FileIcon(props: IconProps) {
  return (
    <svg {...baseProps(props)}>
      <path d="M7 3.5h7l4 4V19a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 19V5a1.5 1.5 0 0 1 1-1.5z" />
      <path d="M14 3.5V8h4.5" />
    </svg>
  );
}

export function SpinnerIcon(props: IconProps) {
  return (
    <svg {...baseProps(props)} className={`motion-safe:animate-spin ${props.className ?? ""}`}>
      <path d="M12 3a9 9 0 1 0 9 9" />
    </svg>
  );
}
