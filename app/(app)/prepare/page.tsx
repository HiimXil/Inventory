import { prisma } from "@/lib/db/client";
import { resolveArtisMode } from "@/lib/artis/factory";
import { requirePageSession } from "@/lib/auth/require-page-session";
import { AppShell } from "@/components/layout/AppShell";
import { AccountMenu } from "@/components/layout/AccountMenu";
import { EmptyState } from "@/components/ui/EmptyState";
import { DepotSelector } from "./components/DepotSelector";

// Must reflect the live depot list and (later) the caller's session on every
// request — never pre-rendered once at build time.
export const dynamic = "force-dynamic";

export default async function PrepareSessionPage() {
  const { session, nav } = await requirePageSession("/prepare");

  const depots = await prisma.depot.findMany({
    where: { disabledAt: null },
    orderBy: { code: "asc" },
    select: { id: true, code: true, name: true },
  });
  const requiresFile = resolveArtisMode() === "file";

  return (
    <AppShell nav={nav} actions={<AccountMenu email={session.user.email} />}>
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
        <div>
          <h1 className="text-3xl font-bold text-ink">Préparer une session d&apos;inventaire</h1>
          <p className="mt-1 text-base text-muted">
            Choisissez le dépôt à inventorier, puis importez son stock théorique.
          </p>
        </div>

        {depots.length === 0 ? (
          <EmptyState
            title="Aucun dépôt disponible"
            description="Aucun dépôt actif n'est configuré pour le moment. Contactez un administrateur pour en activer un avant de préparer une session."
          />
        ) : (
          <DepotSelector depots={depots} requiresFile={requiresFile} />
        )}
      </div>
    </AppShell>
  );
}
