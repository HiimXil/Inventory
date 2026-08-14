import { prisma } from "@/lib/db/client";
import { isAuthorized } from "@/lib/auth/roles";
import type { UserRole } from "@/lib/auth/roles";

export type AssignableUser = {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
};

// Tied to the COUNT permission (lib/auth/roles.ts) rather than a hardcoded
// role list, so this can never drift from "who can actually be assigned a
// count" if PERMISSION_MATRIX ever changes.
const ASSIGNABLE_ROLES: UserRole[] = (["ADMIN", "DEPOT_MANAGER", "LOGISTICS", "DIRECTION"] as UserRole[]).filter(
  (role) => isAuthorized(role, "COUNT"),
);

/**
 * Active users the "Attribuer à" field on /prepare can offer (US7). Not
 * gated by a permission check here — mirrors this same page's existing
 * depot list, which is likewise fetched unconditionally; the real
 * enforcement is runPrepareSession's own PREPARE guard on submit, same
 * split as everywhere else on this page.
 */
export async function listAssignableUsers(): Promise<AssignableUser[]> {
  const users = await prisma.user.findMany({
    where: { disabledAt: null, role: { in: ASSIGNABLE_ROLES } },
    orderBy: [{ role: "asc" }, { email: "asc" }],
    select: { id: true, email: true, name: true, role: true },
  });
  return users;
}
