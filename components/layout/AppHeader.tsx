import Link from "next/link";
import type { ReactNode } from "react";
import { OfflineIndicator } from "@/components/ui/OfflineIndicator";

export type AppHeaderNavItem = {
  href: string;
  label: string;
};

export type AppHeaderProps = {
  title?: string;
  /** Left empty for now — no screen has navigation yet; kept ready for a future pass rather than built speculatively (e.g. a hamburger drawer) before it's needed. */
  nav?: AppHeaderNavItem[];
  /** Right-aligned slot — e.g. a future "signed in as ..." + sign-out control. */
  actions?: ReactNode;
  unsynced?: boolean;
  /** Threaded straight to OfflineIndicator — see its own doc for why it's shown in both the offline and unsynced pills. */
  pendingCount?: number;
};

/**
 * The header every screen will eventually share. Mobile-first: title and
 * offline indicator always fit one row; nav (when a future screen supplies
 * it) wraps to its own row below rather than squeezing into the header bar
 * or requiring a drawer that doesn't exist yet.
 */
export function AppHeader({ title = "SQP Inventaire", nav, actions, unsynced, pendingCount }: AppHeaderProps) {
  return (
    <header className="border-b-2 border-border bg-paper">
      <div className="flex min-h-touch-comfortable flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <Link
          href="/"
          // No prefetch: this header (and this link) mounts on /count, the
          // one deliberate offline island (FR-026) — nothing here should
          // trigger network activity just by being on screen. "/" itself
          // resolves via a server-side session check (app/page.tsx), so it
          // can never be a guaranteed-cached target; worst case offline is
          // a visible failed-navigation/browser error, never a silent
          // no-op, which is the explicit fallback this was built against.
          prefetch={false}
          className="-mx-2 -my-1 flex min-h-touch-min items-center rounded-control px-2 py-1 text-lg font-bold tracking-tight text-ink hover:bg-surface"
        >
          {title}
        </Link>
        <div className="flex items-center gap-3">
          <OfflineIndicator unsynced={unsynced} pendingCount={pendingCount} />
          {actions}
        </div>
      </div>
      {nav && nav.length > 0 && (
        <nav aria-label="Navigation principale" className="flex flex-wrap gap-1 border-t border-border px-4 py-2 sm:px-6">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="min-h-touch-min rounded-control px-3 py-2 text-base font-medium text-ink hover:bg-surface"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      )}
    </header>
  );
}
