import Link from "next/link";

export type BreadcrumbItem = {
  label: string;
  /** Omitted on the last (current) item — it's not a link, just where you are. */
  href?: string;
};

/**
 * Sobre position marker for sub-screens (session detail/count, admin
 * sub-pages) — never the only way to navigate (nav/back always still work),
 * just a "where am I" reminder. The current item is plain text, not a link,
 * and carries aria-current so it reads correctly for assistive tech too.
 */
export function Breadcrumb({ items }: { items: BreadcrumbItem[] }) {
  return (
    <nav aria-label="Fil d'Ariane" className="flex flex-wrap items-center gap-1.5 text-sm text-muted">
      {items.map((item, index) => {
        const isLast = index === items.length - 1;
        return (
          <span key={`${item.label}-${index}`} className="flex items-center gap-1.5">
            {index > 0 && <span aria-hidden="true">›</span>}
            {item.href && !isLast ? (
              <Link href={item.href} className="hover:text-ink hover:underline">
                {item.label}
              </Link>
            ) : (
              <span aria-current={isLast ? "page" : undefined} className={isLast ? "font-medium text-ink" : undefined}>
                {item.label}
              </span>
            )}
          </span>
        );
      })}
    </nav>
  );
}
