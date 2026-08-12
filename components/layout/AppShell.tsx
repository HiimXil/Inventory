import type { ReactNode } from "react";
import { AppHeader, type AppHeaderProps } from "./AppHeader";

export type AppShellProps = AppHeaderProps & {
  children: ReactNode;
};

/**
 * The shared frame every screen will eventually mount into: header up top,
 * content below, full-height, mobile-first. Applied to /login in this pass
 * as the reference; other screens keep their current markup until a later
 * pass migrates them one at a time.
 */
export function AppShell({ children, ...headerProps }: AppShellProps) {
  return (
    <div className="flex min-h-dvh flex-col">
      <AppHeader {...headerProps} />
      <main className="flex flex-1 flex-col px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}
