import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getServerAuthSessionFromCookies } from "@/lib/auth/session";
import { listAuditLog, type AuditFilters } from "@/lib/admin/audit";
import { buildAppNav } from "@/lib/auth/nav";
import { AppShell } from "@/components/layout/AppShell";
import { AccountMenu } from "@/components/layout/AccountMenu";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function parseFilters(searchParams: SearchParams): { filters: AuditFilters; page: number } {
  const actorId = first(searchParams.actorId) || undefined;
  const action = first(searchParams.action) || undefined;
  const fromRaw = first(searchParams.from) || undefined;
  const toRaw = first(searchParams.to) || undefined;
  const pageRaw = first(searchParams.page);

  const filters: AuditFilters = {
    actorId,
    action,
    from: fromRaw ? new Date(`${fromRaw}T00:00:00.000Z`) : undefined,
    to: toRaw ? new Date(`${toRaw}T23:59:59.999Z`) : undefined,
  };

  const page = pageRaw ? Math.max(1, Number.parseInt(pageRaw, 10) || 1) : 1;

  return { filters, page };
}

function buildQuery(searchParams: SearchParams, overrides: Record<string, string | undefined>): string {
  const params = new URLSearchParams();
  const merged = {
    actorId: first(searchParams.actorId),
    action: first(searchParams.action),
    from: first(searchParams.from),
    to: first(searchParams.to),
    page: first(searchParams.page),
    ...overrides,
  };
  for (const [key, value] of Object.entries(merged)) {
    if (value) params.set(key, value);
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

const LABEL_CLASS = "text-base font-medium text-ink";

const SELECT_CLASS =
  "min-h-touch-min w-full rounded-control border-2 border-border bg-paper px-4 text-lg text-ink disabled:cursor-not-allowed disabled:opacity-60";

const PAGE_LINK_CLASS =
  "inline-flex min-h-touch-min items-center justify-center rounded-control border-2 border-border bg-paper px-4 text-base font-semibold text-ink transition-colors hover:bg-surface";

// Read-only by construction (FR-032): this page renders `listAuditLog`'s
// output only — there is no form action, or button anywhere on it that
// mutates data, so there is no code path here that could ever mutate an
// AuditLog row. The filter form below is a plain GET navigation.
export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const resolvedSearchParams = await searchParams;
  const authSession = await getServerAuthSessionFromCookies();
  const { filters, page } = parseFilters(resolvedSearchParams);

  const outcome = await listAuditLog(
    authSession ? { id: authSession.user.id, role: authSession.user.role } : null,
    filters,
    page,
  );

  if (!outcome.ok) {
    if (outcome.status === 401) {
      redirect(`/login?callbackUrl=${encodeURIComponent("/admin/audit")}`);
    }
    notFound();
  }

  const totalPages = Math.max(1, Math.ceil(outcome.total / outcome.pageSize));
  const fromValue = first(resolvedSearchParams.from) ?? "";
  const toValue = first(resolvedSearchParams.to) ?? "";
  const actorValue = first(resolvedSearchParams.actorId) ?? "";
  const actionValue = first(resolvedSearchParams.action) ?? "";
  const hasActiveFilters = Boolean(actorValue || actionValue || fromValue || toValue);

  return (
    <AppShell nav={buildAppNav(authSession!.user.role)} actions={<AccountMenu email={authSession!.user.email} />}>
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <Breadcrumb items={[{ label: "Administration", href: "/admin" }, { label: "Audit" }]} />
        <div>
          <h1 className="text-3xl font-bold text-ink">Journal d&apos;audit</h1>
          <p className="mt-1 text-base text-muted">Historique complet des actions, lecture seule.</p>
        </div>

        <form
          method="get"
          className="flex flex-col gap-4 rounded-card border-2 border-border bg-surface p-4"
        >
          {/* Hand-rolled label/control pairs rather than the shared Field
              component: Field is a Client Component and this page is a
              Server Component — passing Field's render-prop children across
              that boundary isn't serializable and crashes the page. */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="audit-actor" className={LABEL_CLASS}>
                Acteur
              </label>
              <select id="audit-actor" name="actorId" defaultValue={actorValue} className={SELECT_CLASS}>
                <option value="">Tous les acteurs</option>
                {outcome.actorOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.email}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="audit-action" className={LABEL_CLASS}>
                Type d&apos;action
              </label>
              <select id="audit-action" name="action" defaultValue={actionValue} className={SELECT_CLASS}>
                <option value="">Toutes les actions</option>
                {outcome.actionOptions.map((action) => (
                  <option key={action} value={action}>
                    {action}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="audit-from" className={LABEL_CLASS}>
                Du
              </label>
              <Input id="audit-from" name="from" type="date" defaultValue={fromValue} />
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="audit-to" className={LABEL_CLASS}>
                Au
              </label>
              <Input id="audit-to" name="to" type="date" defaultValue={toValue} />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" size="compact">
              Filtrer
            </Button>
            {hasActiveFilters && (
              <Link href="/admin/audit" className="text-base font-medium text-accent-text hover:underline">
                Réinitialiser
              </Link>
            )}
          </div>
        </form>

        {outcome.entries.length === 0 ? (
          <EmptyState
            title="Aucune entrée"
            description={
              hasActiveFilters
                ? "Aucune entrée ne correspond aux filtres sélectionnés."
                : "Aucune entrée d'audit pour le moment."
            }
          />
        ) : (
          <>
            <div className="overflow-x-auto rounded-card border-2 border-border">
              <table className="w-full min-w-180 border-collapse text-left text-base">
                <thead>
                  <tr className="border-b-2 border-border bg-surface text-sm font-semibold text-muted">
                    <th className="px-4 py-3">Horodatage</th>
                    <th className="px-4 py-3">Acteur</th>
                    <th className="px-4 py-3">Action</th>
                    <th className="px-4 py-3">Session</th>
                    <th className="px-4 py-3">Détail</th>
                  </tr>
                </thead>
                <tbody>
                  {outcome.entries.map((entry) => (
                    <tr
                      key={entry.id}
                      data-audit-action={entry.action}
                      className="border-b border-border last:border-b-0"
                    >
                      <td className="px-4 py-3 whitespace-nowrap text-muted">
                        {entry.createdAt.toISOString()}
                      </td>
                      <td className="px-4 py-3 text-ink">{entry.actorEmail ?? "—"}</td>
                      <td className="px-4 py-3 font-medium text-ink">{entry.action}</td>
                      <td className="px-4 py-3 text-muted">{entry.sessionId ?? "—"}</td>
                      <td className="px-4 py-3 text-sm text-muted">
                        {entry.details ? JSON.stringify(entry.details) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <nav
              aria-label="Pagination du journal d'audit"
              className="flex flex-wrap items-center justify-between gap-3"
            >
              <span className="text-sm text-muted">
                Page {outcome.page} / {totalPages} ({outcome.total} entrées)
              </span>
              <div className="flex gap-2">
                {outcome.page > 1 && (
                  <Link
                    href={buildQuery(resolvedSearchParams, { page: String(outcome.page - 1) })}
                    className={PAGE_LINK_CLASS}
                  >
                    Précédent
                  </Link>
                )}
                {outcome.page < totalPages && (
                  <Link
                    href={buildQuery(resolvedSearchParams, { page: String(outcome.page + 1) })}
                    className={PAGE_LINK_CLASS}
                  >
                    Suivant
                  </Link>
                )}
              </div>
            </nav>
          </>
        )}
      </div>
    </AppShell>
  );
}
