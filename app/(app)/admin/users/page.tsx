import { notFound, redirect } from "next/navigation";
import { getServerAuthSessionFromCookies } from "@/lib/auth/session";
import { listUsers } from "@/lib/admin/users";
import { buildAppNav } from "@/lib/auth/nav";
import { AppShell } from "@/components/layout/AppShell";
import { AccountMenu } from "@/components/layout/AccountMenu";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { EmptyState } from "@/components/ui/EmptyState";
import { CreateUserForm } from "./components/CreateUserForm";
import { UserRow } from "./components/UserRow";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  const authSession = await getServerAuthSessionFromCookies();
  const outcome = await listUsers(
    authSession ? { id: authSession.user.id, role: authSession.user.role } : null,
  );

  if (!outcome.ok) {
    if (outcome.status === 401) {
      redirect(`/login?callbackUrl=${encodeURIComponent("/admin/users")}`);
    }
    notFound();
  }

  return (
    <AppShell nav={buildAppNav(authSession!.user.role)} actions={<AccountMenu email={authSession!.user.email} />}>
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <Breadcrumb items={[{ label: "Administration", href: "/admin" }, { label: "Utilisateurs" }]} />
        <h1 className="text-3xl font-bold text-ink">Gestion des utilisateurs</h1>

        <CreateUserForm />

        {outcome.users.length === 0 ? (
          <EmptyState
            title="Aucun utilisateur"
            description="Créez-en un pour donner accès à l'application."
          />
        ) : (
          <div className="overflow-x-auto rounded-card border-2 border-border">
            <table className="w-full min-w-160 border-collapse text-left text-base">
              <thead>
                <tr className="border-b-2 border-border bg-surface text-sm font-semibold text-muted">
                  <th className="px-4 py-3">Email</th>
                  <th className="px-4 py-3">Nom / Rôle</th>
                  <th className="px-4 py-3">Statut</th>
                  <th className="px-4 py-3">Action</th>
                </tr>
              </thead>
              <tbody>
                {outcome.users.map((user) => (
                  <UserRow
                    key={user.id}
                    user={{
                      id: user.id,
                      email: user.email,
                      name: user.name,
                      role: user.role,
                      disabledAt: user.disabledAt ? user.disabledAt.toISOString() : null,
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
