/** Visual variants aligned with Figma Make `resources-hub.tsx` (type badges). */

export function contentTypeBadgeClass(contentType: string): string {
  const map: Record<string, string> = {
    cluster_article: "bg-[#EFF6FF] text-[#1D4ED8] border-[#BFDBFE]",
    pillar_page: "bg-[#EFF6FF] text-[#1D4ED8] border-[#BFDBFE]",
    template: "bg-[#F0FDF4] text-[#15803D] border-[#BBF7D0]",
    case_study: "bg-[#F5F3FF] text-[#6D28D9] border-[#DDD6FE]",
    legal_update: "bg-[#FEE2E2] text-[#991B1B] border-[#FECACA]",
    glossary_entry: "bg-[#F6F8FB] text-[#0B1220] border-[#E1E3E5]",
    faq_entry: "bg-[#F6F8FB] text-[#0B1220] border-[#E1E3E5]",
  };
  return map[contentType] ?? map.cluster_article;
}
