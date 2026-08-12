import { NextResponse } from "next/server";
import { getServerAuthSessionFromRequest } from "@/lib/auth/session";
import { runSyncSession } from "@/lib/sessions/sync-session";

/**
 * Single push-on-network-return endpoint (FR-007, FR-008, FR-030). See
 * lib/sessions/sync-session.ts for the RBAC/last-write-wins/idempotency
 * logic — this handler only resolves the caller's identity and the body.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const authSession = await getServerAuthSessionFromRequest(request);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Corps de requête JSON invalide." }, { status: 400 });
  }

  const outcome = await runSyncSession(
    id,
    authSession ? { id: authSession.user.id, role: authSession.user.role } : null,
    body,
  );

  if (!outcome.ok) {
    return NextResponse.json({ error: outcome.error }, { status: outcome.status });
  }

  return NextResponse.json(
    { applied: outcome.applied, session: outcome.session, lines: outcome.lines, appVersion: outcome.appVersion },
    { status: 200 },
  );
}
