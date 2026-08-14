import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { requirePermission, assertOwnsSession } from "@/lib/auth/guards";
import { getServerAuthSessionFromRequest } from "@/lib/auth/session";

/**
 * The single download point for a session's theoretical snapshot (FR-002,
 * FR-020). Fetched exactly once at prepare time to seed the offline cache —
 * see plan.md Decision #4: the client never re-fetches this after sync.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const sessionRecord = await prisma.inventorySession.findUnique({
    where: { id },
    include: { depot: true },
  });
  if (!sessionRecord) {
    return NextResponse.json({ error: "Session introuvable." }, { status: 404 });
  }

  const authSession = await getServerAuthSessionFromRequest(request);

  try {
    requirePermission(authSession?.user.role, "COUNT");
  } catch {
    await prisma.auditLog.create({
      data: {
        actorId: authSession?.user.id ?? null,
        action: "BOOTSTRAP_DENIED",
        details: { sessionId: id, attemptedRole: authSession?.user.role ?? null },
        sessionId: id,
      },
    });
    return NextResponse.json(
      { error: authSession ? "Accès refusé." : "Authentification requise." },
      { status: authSession ? 403 : 401 },
    );
  }

  // US7: bootstrap had no per-session ownership check at all before
  // attribution existed (COUNT alone let any LOGISTICS/DEPOT_MANAGER/ADMIN
  // download any session's snapshot) — now scoped exactly like
  // /sessions/[id] and the list: LOGISTICS only reaches a session assigned
  // to them, everyone else with COUNT is unrestricted.
  if (authSession!.user.role === "LOGISTICS") {
    try {
      assertOwnsSession(authSession!.user.role, sessionRecord.assignedToId ?? "", authSession!.user.id);
    } catch {
      await prisma.auditLog.create({
        data: {
          actorId: authSession!.user.id,
          action: "BOOTSTRAP_DENIED",
          details: { sessionId: id, attemptedRole: authSession!.user.role, reason: "not-assigned" },
          sessionId: id,
        },
      });
      return NextResponse.json({ error: "Accès refusé." }, { status: 403 });
    }
  }

  const lines = await prisma.inventoryLine.findMany({
    where: { sessionId: id },
    orderBy: { articleRef: "asc" },
  });

  return NextResponse.json({ session: sessionRecord, lines });
}
