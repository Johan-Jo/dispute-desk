/** Maps hub content_type to content_localizations.route_kind for routing and slug scope. */
export function routeKindForContentType(contentType: string): string {
  const map: Record<string, string> = {
    template: "templates",
    case_study: "case-studies",
    glossary_entry: "glossary",
    faq_entry: "glossary",
  };
  return map[contentType] ?? "resources";
}
