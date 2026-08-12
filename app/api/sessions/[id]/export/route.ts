import { NextResponse } from "next/server";
import { getServerAuthSessionFromRequest } from "@/lib/auth/session";
import { runExportSession } from "@/lib/sessions/export-session";

/**
 * GET /api/sessions/[id]/export (FR-009, FR-006). Streams the two-sheet
 * Excel workbook built by lib/export/excel.ts — see
 * lib/sessions/export-session.ts for RBAC and the SYNCED/CLOSED gate.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const authSession = await getServerAuthSessionFromRequest(request);

  const outcome = await runExportSession(
    id,
    authSession ? { id: authSession.user.id, role: authSession.user.role } : null,
  );

  if (!outcome.ok) {
    return NextResponse.json({ error: outcome.error }, { status: outcome.status });
  }

  return new NextResponse(new Uint8Array(outcome.buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${outcome.filename}"`,
    },
  });
}
