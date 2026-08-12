import Link from "next/link";
import type { SessionListItem } from "@/lib/sessions/list-sessions";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Badge } from "@/components/ui/Badge";
import { AlertTriangleIcon, CheckCircleIcon } from "@/components/ui/icons";

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}

/**
 * Whole row is the tap target (min-h-touch-comfortable) — a responsable on a
 * tablet in the depot shouldn't have to aim for a small "view" link.
 */
export function SessionListRow({ session }: { session: SessionListItem }) {
  const hasResults = session.ecartCount !== null;

  return (
    <Link
      href={`/sessions/${session.id}`}
      data-session-id={session.id}
      data-session-status={session.status}
      className="flex min-h-touch-comfortable flex-wrap items-center justify-between gap-3 rounded-card border-2 border-border bg-paper px-4 py-3 transition-colors hover:bg-surface focus-visible:bg-surface"
    >
      <div className="flex flex-col gap-1">
        <span className="text-lg font-semibold text-ink">
          {session.depotCode} — {session.depotName}
        </span>
        <span className="text-sm text-muted">Créée le {formatDate(session.createdAt)}</span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {hasResults &&
          (session.ecartCount! > 0 ? (
            <Badge tone="danger" icon={<AlertTriangleIcon />}>
              {session.ecartCount} écart{session.ecartCount! > 1 ? "s" : ""}
            </Badge>
          ) : (
            <Badge tone="success" icon={<CheckCircleIcon />}>
              Aucun écart
            </Badge>
          ))}
        <StatusBadge status={session.status} />
      </div>
    </Link>
  );
}
