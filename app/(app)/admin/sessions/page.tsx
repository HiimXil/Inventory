import { notFound, redirect } from "next/navigation";
import { getServerAuthSessionFromCookies } from "@/lib/auth/session";
import { listSessionsForAdmin } from "@/lib/admin/sessions";
import { buildAppNav } from "@/lib/auth/nav";
import { AppShell } from "@/components/layout/AppShell";
import { AccountMenu } from "@/components/layout/AccountMenu";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { CancelSessionButton } from "./components/CancelSessionButton";

export const dynamic = "force-dynamic";

const CANCELLABLE_STATUSES = new Set(["PREPARED", "SYNCED"]);

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export default async function AdminSessionsPage() {
  const authSession = await getServerAuthSessionFromCookies();
  const outcome = await listSessionsForAdmin(
    authSession ? { id: authSession.user.id, role: authSession.user.role } : null,
  );

  if (!outcome.ok) {
    if (outcome.status === 401) {
      redirect(`/login?callbackUrl=${encodeURIComponent("/admin/sessions")}`);
    }
    notFound();
  }

  return (
    <AppShell nav={buildAppNav(authSession!.user.role)} actions={<AccountMenu email={authSession!.user.email} />}>
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <Breadcrumb items={[{ label: "Administration", href: "/admin" }, { label: "Sessions" }]} />
        <div>
          <h1 className="text-3xl font-bold text-ink">Supprimer une session</h1>
          <p className="mt-1 text-base text-muted">
            Retirer une session en cours (préparée ou synchronisée, non clôturée) des listes — l&apos;historique et
            l&apos;audit restent intacts.
          </p>
        </div>

        {outcome.sessions.length === 0 ? (
          <EmptyState
            title="Aucune session"
            description="Aucune session d'inventaire pour le moment."
          />
        ) : (
          <div className="overflow-x-auto rounded-card border-2 border-border">
            <table className="w-full min-w-140 border-collapse text-left text-base">
              <thead>
                <tr className="border-b-2 border-border bg-surface text-sm font-semibold text-muted">
                  <th className="px-4 py-3">Dépôt</th>
                  <th className="px-4 py-3">Statut</th>
                  <th className="px-4 py-3">Créée le</th>
                  <th className="px-4 py-3">Action</th>
                </tr>
              </thead>
              <tbody>
                {outcome.sessions.map((session) => (
                  <tr
                    key={session.id}
                    data-session-id={session.id}
                    data-session-status={session.status}
                    className="border-b border-border last:border-b-0"
                  >
                    <td className="px-4 py-3 font-medium text-ink">
                      {session.depotCode} — {session.depotName}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={session.status} />
                    </td>
                    <td className="px-4 py-3 text-muted">{formatDate(session.createdAt)}</td>
                    <td className="px-4 py-3">
                      {CANCELLABLE_STATUSES.has(session.status) ? (
                        <CancelSessionButton sessionId={session.id} depotCode={session.depotCode} />
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppShell>
  );
}
