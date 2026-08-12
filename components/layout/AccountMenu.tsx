"use client";

import { logout } from "@/lib/auth/logout";
import { LogOutIcon } from "@/components/ui/icons";

/**
 * The header's "signed in as ... + sign-out" slot AppHeader's `actions` prop
 * was always meant for. Email hides below `sm` to keep the header row from
 * wrapping on a phone; the logout button itself always stays a full touch
 * target, icon-only there.
 */
export function AccountMenu({ email }: { email: string }) {
  return (
    <form action={logout} className="flex items-center gap-2">
      <span className="hidden max-w-40 truncate text-sm text-muted sm:inline" title={email}>
        {email}
      </span>
      <button
        type="submit"
        aria-label="Se déconnecter"
        title="Se déconnecter"
        className="inline-flex min-h-touch-min min-w-touch-min items-center justify-center gap-1.5 rounded-control border-2 border-border bg-paper px-3 text-sm font-semibold text-ink transition-colors hover:bg-surface"
      >
        <LogOutIcon className="h-4 w-4 shrink-0" />
        <span className="hidden sm:inline">Se déconnecter</span>
      </button>
    </form>
  );
}
