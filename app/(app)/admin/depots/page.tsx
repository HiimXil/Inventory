import { notFound, redirect } from "next/navigation";
import { getServerAuthSessionFromCookies } from "@/lib/auth/session";
import { listDepots } from "@/lib/admin/depots";
import { buildAppNav } from "@/lib/auth/nav";
import { AppShell } from "@/components/layout/AppShell";
import { AccountMenu } from "@/components/layout/AccountMenu";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { EmptyState } from "@/components/ui/EmptyState";
import { CreateDepotForm } from "./components/CreateDepotForm";
import { DepotRow } from "./components/DepotRow";

export const dynamic = "force-dynamic";

export default async function AdminDepotsPage() {
  const authSession = await getServerAuthSessionFromCookies();
  const outcome = await listDepots(
    authSession ? { id: authSession.user.id, role: authSession.user.role } : null,
  );

  if (!outcome.ok) {
    if (outcome.status === 401) {
      redirect(`/login?callbackUrl=${encodeURIComponent("/admin/depots")}`);
    }
    notFound();
  }

  return (
    <AppShell nav={buildAppNav(authSession!.user.role)} actions={<AccountMenu email={authSession!.user.email} />}>
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <Breadcrumb items={[{ label: "Administration", href: "/admin" }, { label: "Dépôts" }]} />
        <h1 className="text-3xl font-bold text-ink">Gestion des dépôts</h1>

        <CreateDepotForm />

        {outcome.depots.length === 0 ? (
          <EmptyState
            title="Aucun dépôt"
            description="Créez-en un pour permettre les inventaires."
          />
        ) : (
          <div className="overflow-x-auto rounded-card border-2 border-border">
            <table className="w-full min-w-140 border-collapse text-left text-base">
              <thead>
                <tr className="border-b-2 border-border bg-surface text-sm font-semibold text-muted">
                  <th className="px-4 py-3">Code ARTIS</th>
                  <th className="px-4 py-3">Libellé</th>
                  <th className="px-4 py-3">Statut</th>
                  <th className="px-4 py-3">Action</th>
                </tr>
              </thead>
              <tbody>
                {outcome.depots.map((depot) => (
                  <DepotRow
                    key={depot.id}
                    depot={{
                      id: depot.id,
                      code: depot.code,
                      name: depot.name,
                      disabledAt: depot.disabledAt ? depot.disabledAt.toISOString() : null,
                    }}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppShell>
  );
}
