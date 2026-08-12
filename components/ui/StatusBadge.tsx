import { Badge, type BadgeTone } from "./Badge";
import { AlertTriangleIcon, BanIcon, CheckCircleIcon, ClockIcon, LockIcon, TagIcon, UploadCloudIcon } from "./icons";

export type Status =
  // Écart de comptage (US3)
  | "CONFORME"
  | "ECART"
  | "HORS_REFERENTIEL"
  // Cycle de vie d'une session d'inventaire
  | "PREPARED"
  | "SYNCED"
  | "CLOSED"
  | "CANCELLED"
  // Statut actif/inactif d'un dépôt ou d'un utilisateur (admin)
  | "ACTIF"
  | "INACTIF";

const STATUS_CONFIG: Record<Status, { label: string; tone: BadgeTone; icon: React.ReactNode }> = {
  CONFORME: { label: "Conforme", tone: "success", icon: <CheckCircleIcon /> },
  ECART: { label: "Écart", tone: "danger", icon: <AlertTriangleIcon /> },
  HORS_REFERENTIEL: { label: "Hors référentiel", tone: "accent", icon: <TagIcon /> },
  PREPARED: { label: "Préparée", tone: "neutral", icon: <ClockIcon /> },
  SYNCED: { label: "Synchronisée", tone: "accent", icon: <UploadCloudIcon /> },
  CLOSED: { label: "Clôturée", tone: "neutral", icon: <LockIcon /> },
  CANCELLED: { label: "Annulée", tone: "danger", icon: <BanIcon /> },
  ACTIF: { label: "Actif", tone: "success", icon: <CheckCircleIcon /> },
  INACTIF: { label: "Inactif", tone: "neutral", icon: <BanIcon /> },
};

/**
 * The app's known status vocabulary, mapped once to a consistent
 * label/color/icon — so a future pass wiring this into CountingTable or the
 * admin sessions list never has to re-decide "what color is ECART".
 */
export function StatusBadge({ status }: { status: Status }) {
  const config = STATUS_CONFIG[status];
  return (
    <Badge tone={config.tone} icon={config.icon}>
      {config.label}
    </Badge>
  );
}
