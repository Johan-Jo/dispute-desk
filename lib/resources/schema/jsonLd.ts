import type { HubContentLocale } from "../constants";

export function breadcrumbJsonLd(items: { name: string; url: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: it.name,
      item: it.url,
    })),
  };
}

const PUBLISHER = {
  "@type": "Organization",
  name: "DisputeDesk",
  url: "https://disputedesk.app",
} as const;

export function articleJsonLd(args: {
  headline: string;
  description: string;
  url: string;
  dateModified?: string;
  datePublished?: string;
  locale: HubContentLocale;
  authorName?: string;
  image?: string;
  keywords?: string;
}) {
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: args.headline,
    description: args.description,
    url: args.url,
    inLanguage: args.locale,
    datePublished: args.datePublished,
    dateModified: args.dateModified,
    publisher: PUBLISHER,
    author: args.authorName
      ? { "@type": "Person", name: args.authorName }
      : PUBLISHER,
    ...(args.image ? { image: { "@type": "ImageObject", url: args.image } } : {}),
    ...(args.keywords ? { keywords: args.keywords } : {}),
  };
}

export function faqPageJsonLd(items: { q: string; a: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: {
        "@type": "Answer",
        text: f.a,
      },
    })),
  };
}

/** Resources hub listing — CollectionPage + ItemList for rich results context. */
export function resourcesHubCollectionJsonLd(args: {
  pageUrl: string;
  siteHomeUrl: string;
  name: string;
  description: string;
  inLanguage: string;
  items: { name: string; url: string }[];
}) {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "CollectionPage",
        "@id": `${args.pageUrl}#webpage`,
        name: args.name,
        description: args.description,
        url: args.pageUrl,
        inLanguage: args.inLanguage,
        isPartOf: { "@id": `${args.siteHomeUrl}#website` },
        mainEntity: {
          "@type": "ItemList",
          numberOfItems: args.items.length,
          itemListElement: args.items.map((it, i) => ({
            "@type": "ListItem",
            position: i + 1,
            name: it.name,
            url: it.url,
          })),
        },
      },
    ],
  };
}
