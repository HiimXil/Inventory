import type { UserRole } from "./roles";

export type NavItem = { href: string; label: string };

/**
 * Every screen a given role can actually act on, reusing the existing
 * PERMISSION_MATRIX roles rather than inventing a new visibility rule:
 * DIRECTION never gets "Préparer" (no PREPARE permission), only ADMIN gets
 * "Administration". A link only ever appears here for a destination whose
 * own server-side guard already lets that role in — this list is a
 * shortcut, not a new access rule.
 */
export function buildAppNav(role: UserRole): NavItem[] {
  const items: NavItem[] = [
    { href: "/", label: "Accueil" },
    { href: "/sessions", label: "Sessions" },
  ];

  if (role === "ADMIN" || role === "DEPOT_MANAGER") {
    items.push({ href: "/prepare", label: "Préparer" });
  }

  if (role === "ADMIN") {
    items.push({ href: "/admin", label: "Administration" });
  }

  return items;
}

/**
 * Where "/" and post-login land a given role — the screen that role is most
 * likely to actually need first. LOGISTICS/DIRECTION have no PREPARE
 * permission, so /prepare would just bounce them; /sessions is the one
 * screen every role can use.
 */
export function defaultRouteForRole(role: UserRole): string {
  switch (role) {
    case "ADMIN":
    case "DEPOT_MANAGER":
      return "/prepare";
    case "LOGISTICS":
    case "DIRECTION":
      return "/sessions";
  }
}
