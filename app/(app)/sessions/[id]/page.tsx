import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db/client";
import { getServerAuthSessionFromCookies } from "@/lib/auth/session";
import { isAuthorized } from "@/lib/auth/roles";
import { buildAppNav } from "@/lib/auth/nav";
import { loadSessionForView } from "@/lib/sessions/view-session";
import { buildDiscrepancyLines, summarizeDiscrepancies } from "@/lib/offline/discrepancy";
import { AppShell } from "@/components/layout/AppShell";
import { AccountMenu } from "@/components/layout/AccountMenu";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { LockIcon } from "@/components/ui/icons";
import { ResultsSummary } from "./components/ResultsSummary";
import { ResultsTable } from "./components/ResultsTable";
import { CloseSessionButton } from "./components/CloseSessionButton";

// Reflects live session status on every request.
export const dynamic = "force-dynamic";

// RBAC guard (RUNBOOK correctif): applies to THIS route only — never to
// /sessions/[id]/count, the offline island, which must stay guard-free
// (FR-026, see the comment at the top of count/page.tsx).
export default async function SessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const authSession = await getServerAuthSessionFromCookies();
  const outcome = await loadSessionForView(
    id,
    authSession ? { id: authSession.user.id, role: authSession.user.role } : null,
  );

  if (!outcome.ok) {
    if (outcome.reason === "unauthenticated") {
      redirect(`/login?callbackUrl=${encodeURIComponent(`/sessions/${id}`)}`);
    }
    // "not-found" and "forbidden" both resolve to 404 to avoid disclosing
    // whether a session a caller isn't authorized for actually exists.
    notFound();
  }

  const nav = buildAppNav(authSession!.user.role);
  const breadcrumb = (
    <Breadcrumb
      items={[
        { label: "Sessions", href: "/sessions" },
        { label: `${outcome.session.depot.code} — ${outcome.session.depot.name}` },
      ]}
    />
  );

  const { session } = outcome;

  // PREPARED is the only "active" status before a sync exists yet — there is
  // no separate COUNTING state in the schema (counting happens entirely
  // offline on the client; the server only learns about it at sync time).
  if (session.status === "PREPARED") {
    redirect(`/sessions/${id}/count`);
  }

  if (session.status === "SYNCED" || session.status === "CLOSED") {
    const lines = await prisma.inventoryLine.findMany({
      where: { sessionId: id },
      orderBy: { articleRef: "asc" },
    });
    const discrepancyLines = buildDiscrepancyLines(
      lines.map((line) => ({
        articleRef: line.articleRef,
        designation: line.designation,
        theoreticalQty: line.theoreticalQty,
        countedQty: line.countedQty,
        isOffReferential: line.isOffReferential,
      })),
    );
    const summary = summarizeDiscrepancies(discrepancyLines);

    const role = authSession!.user.role;
    const canClose = session.status === "SYNCED" && isAuthorized(role, "CLOSE");
    const canExport = isAuthorized(role, "EXPORT");

    return (
      <AppShell nav={nav} actions={<AccountMenu email={authSession!.user.email} />}>
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
          {breadcrumb}
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold text-ink sm:text-3xl">
                {session.depot.code} — {session.depot.name}
              </h1>
              <p className="mt-1 text-sm text-muted">Statut : {session.status}</p>
            </div>
            <StatusBadge status={session.status} />
          </div>

          {session.status === "CLOSED" && (
            <div
              role="status"
              className="flex items-start gap-3 rounded-control border-2 border-border bg-surface px-4 py-3"
            >
              <LockIcon className="mt-0.5 h-5 w-5 shrink-0 text-muted" />
              <p className="text-base font-medium text-ink">
                Session clôturée et archivée. Aucune action supplémentaire n&apos;est possible.
              </p>
            </div>
          )}

          <ResultsSummary summary={summary} />
          <ResultsTable lines={discrepancyLines} />

          {(canExport || canClose) && (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
              {canExport && (
                <a
                  href={`/api/sessions/${id}/export`}
                  className="inline-flex min-h-touch-comfortable items-center justify-center gap-2 rounded-control border-2 border-border bg-paper px-5 text-lg font-semibold text-ink transition-colors hover:bg-surface"
                >
                  Exporter Excel
                </a>
              )}
              {canClose && <CloseSessionButton sessionId={id} ecartCount={summary.ecartCount} />}
            </div>
          )}
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell nav={nav} actions={<AccountMenu email={authSession!.user.email} />}>
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
        {breadcrumb}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-ink sm:text-3xl">
              {session.depot.code} — {session.depot.name}
            </h1>
            <p className="mt-1 text-sm text-muted">Statut : {session.status}</p>
          </div>
          <StatusBadge status={session.status} />
        </div>
      </div>
    </AppShell>
  );
}
