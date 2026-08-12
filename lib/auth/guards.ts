import type { UserRole, Permission } from "./roles";
import { isAuthorized } from "./roles";

export function requirePermission(role: UserRole | undefined, permission: Permission) {
  if (!isAuthorized(role, permission)) {
    const error = new Error("Unauthorized");
    error.name = "UnauthorizedError";
    throw error;
  }
}

export function assertOwnsSession(
  role: UserRole | undefined,
  sessionOwnerId: string,
  actorId: string,
) {
  if (role === "LOGISTICS" && sessionOwnerId !== actorId) {
    const error = new Error("Unauthorized to access this session");
    error.name = "UnauthorizedError";
    throw error;
  }
}
