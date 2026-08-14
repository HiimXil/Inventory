import { z } from "zod";
import type { SessionStatus } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { requirePermission } from "@/lib/auth/guards";
import { isActiveUser, SESSION_EXPIRED_MESSAGE } from "@/lib/auth/verify-active-user";
import { isAuthorized } from "@/lib/auth/roles";
import type { UserRole } from "@/lib/auth/roles";
import { getArtisAdapter } from "@/lib/artis/factory";
import { aggregateTheoreticalStock } from "@/lib/artis/aggregate";
import { artisAggregatedStockSchema } from "@/lib/artis/validation";
import {
  ArtisHttpError,
  ArtisNetworkError,
  ArtisTimeoutError,
  EmptyTheoreticalStockError,
  ArtisFileFormatError,
  ArtisFileValidationError,
} from "@/lib/artis/errors";

const ACTIVE_SESSION_STATUSES: SessionStatus[] = ["PREPARED", "SYNCED"];

export type PrepareSessionActor = {
  id: string;
  role: UserRole;
};

export type PrepareSessionOutcome =
  | { ok: true; sessionId: string; lineCount: number }
  | { ok: false; error: string };

class DuplicateActiveSessionError extends Error {}

/**
 * Core prepareSession flow (FR-001, 016, 021-024, 029). Kept separate from
 * the "use server" action so it can be unit-tested directly, without going
 * through FormData parsing or Next's server-action/redirect machinery.
 *
 * FR-029 note: that FR was written for a paginated network import ("the
 * import is only complete once pagination is fully exhausted"). In file
 * mode there's no pagination to exhaust — a single .xlsx upload either
 * parses to a complete, valid line set or it's rejected outright (see
 * lib/artis/file.ts) — completeness is intrinsic to reading one whole file
 * rather than a property to verify across a page-fetching loop. This still
 * flows through aggregateTheoreticalStock() unchanged: ArtisFileAdapter
 * always reports pageCount=1, so that loop naturally runs once.
 *
 * US7 (attribution model): `assignedToId` is who the count is FOR, required
 * on every new session — distinct from `actor`, who only created it (a
 * DEPOT_MANAGER routinely prepares on behalf of a LOGISTICS technician).
 * Validated up front, before the ARTIS import, same reasoning as the
 * ghost-actor check just below: no point wasting a file parse on a request
 * that can't succeed.
 */
export async function runPrepareSession(
  depotId: string,
  actor: PrepareSessionActor,
  assignedToId: string,
  options: { timeoutMs?: number; fileBuffer?: Buffer | ArrayBuffer } = {},
): Promise<PrepareSessionOutcome> {
  // RBAC guard, server-side, first line of business logic (FR-027).
  try {
    requirePermission(actor.role, "PREPARE");
  } catch {
    await prisma.auditLog.create({
      data: {
        actorId: actor.id,
        action: "SESSION_CREATE_DENIED",
        details: { depotId, attemptedRole: actor.role },
      },
    });
    return {
      ok: false,
      error: "Vous n'avez pas les droits pour préparer une session d'inventaire.",
    };
  }

  // A JWT session cookie decodes fine even after the user it points to was
  // deleted (DB reset) or disabled (admin action) — checked here, before
  // any ARTIS import work or DB write, so this never wastes a file parse on
  // a request that can't succeed, and the eventual preparedById
  // FK-constraint violation never has a chance to surface as a generic
  // error instead of "reconnectez-vous" (which would wrongly point the
  // user at their file instead of their session).
  if (!(await isActiveUser(actor.id))) {
    await prisma.auditLog.create({
      data: {
        actorId: null,
        action: "SESSION_CREATE_DENIED",
        details: { depotId, attemptedRole: actor.role, reason: "stale-or-disabled-user", attemptedUserId: actor.id },
      },
    });
    return { ok: false, error: SESSION_EXPIRED_MESSAGE };
  }

  // US7: the assignee must be an active user actually able to count — same
  // permission the bootstrap/count flow itself requires, checked here so a
  // session can never be created pointing at someone who could never open
  // it. Deliberately a distinct, actionable message: this is a valid
  // request rejected on the *assignee*, not the ghost-actor case above.
  const assignee = await prisma.user.findUnique({
    where: { id: assignedToId },
    select: { id: true, disabledAt: true, role: true },
  });
  if (!assignee || assignee.disabledAt || !isAuthorized(assignee.role, "COUNT")) {
    return { ok: false, error: "L'utilisateur attribué est introuvable, désactivé ou ne peut pas compter." };
  }

  const depot = await prisma.depot.findUnique({ where: { id: depotId } });
  if (!depot) {
    return { ok: false, error: "Dépôt introuvable." };
  }
  if (depot.disabledAt) {
    return { ok: false, error: "Ce dépôt est inactif et ne peut plus faire l'objet d'une nouvelle session." };
  }

  // Fail fast before importing (FR-016); re-checked again inside the
  // transaction right before insert to close the race window.
  const existingActive = await prisma.inventorySession.findFirst({
    where: { depotId, status: { in: ACTIVE_SESSION_STATUSES } },
    select: { id: true },
  });
  if (existingActive) {
    return { ok: false, error: duplicateSessionMessage(depot.code) };
  }

  let aggregated;
  try {
    const adapter = getArtisAdapter({ fileBuffer: options.fileBuffer });
    aggregated = await aggregateTheoreticalStock(adapter, depot.code, options);
  } catch (error) {
    return { ok: false, error: mapArtisError(error) };
  }

  if (aggregated.items.length === 0) {
    return { ok: false, error: mapArtisError(new EmptyTheoreticalStockError()) };
  }

  const parsed = artisAggregatedStockSchema.safeParse(aggregated);
  if (!parsed.success) {
    return { ok: false, error: mapArtisError(parsed.error) };
  }

  const capturedAt = new Date();

  try {
    const session = await prisma.$transaction(async (tx) => {
      const stillActive = await tx.inventorySession.findFirst({
        where: { depotId, status: { in: ACTIVE_SESSION_STATUSES } },
        select: { id: true },
      });
      if (stillActive) throw new DuplicateActiveSessionError();

      const newSession = await tx.inventorySession.create({
        data: {
          depotId,
          status: "PREPARED",
          preparedById: actor.id,
          assignedToId,
          createdAt: capturedAt,
          theoreticalSnapshot: {
            capturedAt: capturedAt.toISOString(),
            depotCode: depot.code,
            lineCount: parsed.data.items.length,
          },
        },
      });

      await tx.inventoryLine.createMany({
        data: parsed.data.items.map((item) => ({
          sessionId: newSession.id,
          articleRef: item.articleRef,
          designation: item.designation,
          supplierRef: item.supplierRef,
          theoreticalQty: item.qty,
          countedQty: null,
          isOffReferential: false,
        })),
      });

      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: "SESSION_CREATED",
          details: {
            depotId,
            depotCode: depot.code,
            lineCount: parsed.data.items.length,
            assignedToId,
          },
          sessionId: newSession.id,
        },
      });

      return newSession;
    });

    return { ok: true, sessionId: session.id, lineCount: parsed.data.items.length };
  } catch (error) {
    if (error instanceof DuplicateActiveSessionError) {
      return { ok: false, error: duplicateSessionMessage(depot.code) };
    }
    return {
      ok: false,
      error: "La création de la session a échoué de manière inattendue. Réessayez.",
    };
  }
}

function duplicateSessionMessage(depotCode: string): string {
  return `Une session active existe déjà pour le dépôt ${depotCode}. Clôturez-la avant d'en préparer une nouvelle.`;
}

function mapArtisError(error: unknown): string {
  // These two already carry a precise, actionable French message from the
  // adapter itself (which column, which row/code) — pass it straight
  // through instead of substituting a generic translation.
  if (error instanceof ArtisFileFormatError || error instanceof ArtisFileValidationError) {
    return error.message;
  }
  if (error instanceof ArtisTimeoutError) {
    return "Le délai d'import du stock théorique ARTIS a été dépassé. Réessayez.";
  }
  if (error instanceof ArtisHttpError) {
    return `Le service ARTIS a retourné une erreur serveur (HTTP ${error.status}). Réessayez plus tard.`;
  }
  if (error instanceof ArtisNetworkError) {
    return "Erreur réseau lors de l'import du stock théorique ARTIS. Vérifiez la connexion et réessayez.";
  }
  if (error instanceof EmptyTheoreticalStockError) {
    return "Le stock théorique importé est vide ou incomplet. Vérifiez le dépôt sélectionné puis réessayez.";
  }
  if (error instanceof z.ZodError) {
    return "La réponse ARTIS est invalide ou incomplète (champs manquants ou pagination interrompue). Réessayez.";
  }
  return "L'import du stock théorique ARTIS a échoué. Réessayez.";
}
