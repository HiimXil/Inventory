import { prisma } from "@/lib/db/client";

/**
 * A JWT session cookie decodes fine even for a user deleted (database
 * reset) or disabled (admin action) after the cookie was issued — the JWT
 * is stateless and nothing re-checks it against the DB by default. This is
 * the one place that does: a single indexed lookup by primary key, cheap
 * enough to call both on protected-page navigation and before any write
 * that will reference the actor by FK (preparedById/actorId), which is
 * where a stale actor would otherwise surface as an opaque FK-constraint
 * failure deep inside a transaction.
 */
export async function isActiveUser(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { disabledAt: true } });
  return user !== null && user.disabledAt === null;
}

/** Shared across every write path that validates the actor before an FK-referencing insert. */
export const SESSION_EXPIRED_MESSAGE = "Votre session a expiré. Reconnectez-vous puis réessayez.";
