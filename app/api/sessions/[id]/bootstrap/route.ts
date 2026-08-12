import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { requirePermission } from "@/lib/auth/guards";
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

  const lines = await prisma.inventoryLine.findMany({
    where: { sessionId: id },
    orderBy: { articleRef: "asc" },
  });

  return NextResponse.json({ session: sessionRecord, lines });
}
