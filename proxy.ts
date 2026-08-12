import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!sessions/[^/]+/count|_next|_static|favicon\.ico|manifest\.webmanifest|sw\.js|service-worker\.js|icons/).*)",
  ],
};
