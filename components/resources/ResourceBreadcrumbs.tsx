import Link from "next/link";

type Crumb = { label: string; href?: string };

export function ResourceBreadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="text-sm text-[#64748B] mb-6">
      <ol className="flex flex-wrap gap-1.5 items-center">
        {items.map((c, i) => (
          <li key={`${c.label}-${i}`} className="flex items-center gap-1.5">
            {i > 0 && <span aria-hidden>/</span>}
            {c.href ? (
              <Link href={c.href} className="hover:text-[#0B1220]">
                {c.label}
              </Link>
            ) : (
              <span className="text-[#0B1220] font-medium">{c.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
