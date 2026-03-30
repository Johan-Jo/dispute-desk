/** Homepage WebPage — links to Organization + WebSite emitted in `[locale]/layout`. */
export function marketingHomeWebPageJsonLd(args: {
  url: string;
  name: string;
  description: string;
  inLanguage: string;
  organizationId: string;
  websiteId: string;
}) {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebPage",
        "@id": `${args.url}#webpage`,
        url: args.url,
        name: args.name,
        description: args.description,
        inLanguage: args.inLanguage,
        isPartOf: { "@id": args.websiteId },
        publisher: { "@id": args.organizationId },
      },
    ],
  };
}
