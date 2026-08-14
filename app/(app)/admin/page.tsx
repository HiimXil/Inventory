import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getServerAuthSessionFromCookies } from "@/lib/auth/session";
import { assertAdminDashboardAccess } from "@/lib/admin/dashboard";
import { buildAppNav } from "@/lib/auth/nav";
import { AppShell } from "@/components/layout/AppShell";
import { AccountMenu } from "@/components/layout/AccountMenu";
import { UserIcon, BoxIcon, BanIcon, ListIcon } from "@/components/ui/icons";
import type { ReactNode } from "react";

export const dynamic = "force-dynamic";

const LINKS: { href: string; title: string; description: string; icon: ReactNode }[] = [
  {
    href: "/admin/users",
    title: "Gestion des utilisateurs",
    description: "Créer des comptes, modifier rôle/nom, désactiver un accès.",
    icon: <UserIcon className="h-6 w-6" />,
  },
  {
    href: "/admin/depots",
    title: "Gestion des dépôts",
    description: "Créer un dépôt, corriger son libellé, l'activer/désactiver.",
    icon: <BoxIcon className="h-6 w-6" />,
  },
  {
    href: "/admin/sessions",
    title: "Supprimer une session",
    description: "Retirer une session en cours des listes (non clôturée) — historique conservé.",
    icon: <BanIcon className="h-6 w-6" />,
  },
  {
    href: "/admin/audit",
    title: "Journal d'audit",
    description: "Historique complet des actions, lecture seule.",
    icon: <ListIcon className="h-6 w-6" />,
  },
];

export default async function AdminDashboardPage() {
  const authSession = await getServerAuthSessionFromCookies();
  const outcome = await assertAdminDashboardAccess(
    authSession ? { id: authSession.user.id, role: authSession.user.role } : null,
  );

  if (!outcome.ok) {
    if (outcome.reason === "unauthenticated") {
      redirect(`/login?callbackUrl=${encodeURIComponent("/admin")}`);
    }
    notFound();
  }

  return (
    <AppShell nav={buildAppNav(authSession!.user.role)} actions={<AccountMenu email={authSession!.user.email} />}>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <div>
          <h1 className="text-3xl font-bold text-ink">Administration</h1>
          <p className="mt-1 text-base text-muted">Accès réservé aux administrateurs.</p>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="flex min-h-touch-comfortable flex-col gap-2 rounded-card border-2 border-border bg-paper p-4 transition-colors hover:bg-surface focus-visible:bg-surface"
            >
              <span className="flex items-center gap-2 text-lg font-semibold text-ink">
                <span className="text-accent-text">{link.icon}</span>
                {link.title}
              </span>
              <span className="text-sm text-muted">{link.description}</span>
            </Link>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
