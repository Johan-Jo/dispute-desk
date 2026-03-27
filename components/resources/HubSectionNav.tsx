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
};

const sections: { id: HubSection; href: string; labelKey: keyof Props["labels"] }[] = [
  { id: "resources", href: "/resources", labelKey: "resources" },
  { id: "templates", href: "/templates", labelKey: "templates" },
  { id: "case-studies", href: "/case-studies", labelKey: "caseStudies" },
  { id: "glossary", href: "/glossary", labelKey: "glossary" },
];

export function HubSectionNav({ basePath, active, labels }: Props) {
  return (
    <nav
      className="flex flex-wrap gap-1 sm:gap-2 mb-8 border-b border-[#E5E7EB] pb-4"
      aria-label="Resources hub sections"
    >
      {sections.map(({ id, href, labelKey }) => {
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
