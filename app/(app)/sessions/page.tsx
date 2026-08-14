import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requirePageSession } from "@/lib/auth/require-page-session";
import { listSessionsForUser } from "@/lib/sessions/list-sessions";
import { AppShell } from "@/components/layout/AppShell";
import { AccountMenu } from "@/components/layout/AccountMenu";
import { EmptyState } from "@/components/ui/EmptyState";
import { SessionListRow } from "./components/SessionListRow";
import { ResumeSessionsBanner } from "./components/ResumeSessionsBanner";

// Reflects live session status/écarts on every request.
export const dynamic = "force-dynamic";

export default async function SessionsListPage() {
  const { session: authSession, nav } = await requirePageSession("/sessions");

  const outcome = await listSessionsForUser({ id: authSession.user.id, role: authSession.user.role });
  if (!outcome.ok) {
    if (outcome.reason === "unauthenticated") redirect("/login");
    notFound();
  }

  const active = outcome.sessions.filter((s) => s.status === "PREPARED" || s.status === "SYNCED");
  // CANCELLED never reaches here at all (listSessionsForUser excludes it,
  // US9 "supprimer une session") — CLOSED is the only archived status left.
  const archived = outcome.sessions.filter((s) => s.status === "CLOSED");

  return (
    <AppShell nav={nav} actions={<AccountMenu email={authSession.user.email} />}>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
        <div>
          <h1 className="text-3xl font-bold text-ink">Sessions d&apos;inventaire</h1>
          <p className="mt-1 text-base text-muted">
            Ce qui est en cours et demande attention, puis l&apos;historique.
          </p>
        </div>

        <ResumeSessionsBanner
          serverSessions={active.map((s) => ({ id: s.id, depotCode: s.depotCode, depotName: s.depotName }))}
        />

        {outcome.sessions.length === 0 ? (
          <EmptyState
            title="Aucun inventaire"
            description="Commencez par en préparer un."
            action={
              <Link
                href="/prepare"
                className="inline-flex min-h-touch-comfortable items-center justify-center rounded-control bg-accent px-5 text-lg font-semibold text-on-brand transition-[filter] hover:brightness-110"
              >
                Préparer une session
              </Link>
            }
          />
        ) : (
          <>
            {active.length > 0 && (
              <section className="flex flex-col gap-3">
                <h2 className="text-lg font-semibold text-ink">En cours</h2>
                <div className="flex flex-col gap-2">
                  {active.map((session) => (
                    <SessionListRow key={session.id} session={session} />
                  ))}
                </div>
              </section>
            )}

            {archived.length > 0 && (
              <section className="flex flex-col gap-3">
                <h2 className="text-lg font-semibold text-ink">Historique</h2>
                <div className="flex flex-col gap-2">
                  {archived.map((session) => (
                    <SessionListRow key={session.id} session={session} />
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
