import Link from "next/link";

export type HubSection = "resources" | "templates" | "case-studies" | "glossary";

type Props = {
  basePath: string;
  active: HubSection;
  labels: {
    resources: string;
    templates: string;
    caseStudies: string;
    glossary: string;
  };
  /**
   * Hub sections that have published content for the current locale. Sections
   * not listed here are omitted so the nav never links to an empty hub (which
   * 404s and gets flagged as a broken internal link). When undefined, all
   * sections render (legacy behaviour). The `active` section always renders.
   */
  present?: Set<HubSection>;
};

const sections: { id: HubSection; href: string; labelKey: keyof Props["labels"] }[] = [
  { id: "resources", href: "/resources", labelKey: "resources" },
  { id: "templates", href: "/templates", labelKey: "templates" },
  { id: "case-studies", href: "/case-studies", labelKey: "caseStudies" },
  { id: "glossary", href: "/glossary", labelKey: "glossary" },
];

/**
 * Decide which section tabs to render. A tab is shown when it is the active
 * section (so the current page always labels itself) or when its hub has
 * published content. When `present` is undefined, every tab renders (legacy
 * all-on behaviour). Keeping this pure makes the "never link to an empty hub"
 * rule unit-testable without rendering.
 */
export function visibleHubSections(
  active: HubSection,
  present: Set<HubSection> | undefined,
): HubSection[] {
  return sections
    .filter(({ id }) => id === active || !present || present.has(id))
    .map(({ id }) => id);
}

export function HubSectionNav({ basePath, active, labels, present }: Props) {
  const visibleIds = new Set(visibleHubSections(active, present));
  const visible = sections.filter(({ id }) => visibleIds.has(id));
  return (
    <nav
      className="flex flex-wrap gap-1 sm:gap-2 mb-8 border-b border-[#E5E7EB] pb-4"
      aria-label="Resources hub sections"
    >
      {visible.map(({ id, href, labelKey }) => {
        const isActive = active === id;
        const to = `${basePath}${href}`;
        return (
          <Link
            key={id}
            href={to}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              isActive
                ? "bg-[#EFF6FF] text-[#1D4ED8]"
                : "text-[#64748B] hover:bg-[#F8FAFC] hover:text-[#0B1220]"
            }`}
            aria-current={isActive ? "page" : undefined}
          >
            {labels[labelKey]}
          </Link>
        );
      })}
    </nav>
  );
}
