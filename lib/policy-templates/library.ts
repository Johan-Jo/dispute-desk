/**
 * Policy Library — metadata for the Recommended Store Policies pack.
 * Template bodies are loaded from content/policy-templates/*.md via the content API.
 */

export type PolicyTemplateType = "terms" | "refunds" | "shipping" | "privacy" | "contact";

export interface PolicyTemplateMeta {
  id: string;
  type: PolicyTemplateType;
  title: string;
  shortDescription: string;
  categoryTags: string[];
  bestFor: string;
  qualityBadge: "Essential" | "Recommended" | "Chargeback-Ready" | "Starter Template";
  merchantPlaceholders: string[];
  merchantNotes: string[];
  disputeDefenseValue: string;
}

/** Display order for the Policy Library and policy rows. */
export const POLICY_LIBRARY_ORDER: PolicyTemplateType[] = [
  "terms",
  "refunds",
  "shipping",
  "privacy",
  "contact",
];

export const POLICY_LIBRARY: PolicyTemplateMeta[] = [
  {
    id: "terms-of-service-general-ecommerce",
    type: "terms",
    title: "Terms of Service",
    shortDescription:
      "Core store terms covering orders, payments, product availability, disputes, and acceptable website use.",
    categoryTags: ["Core", "Legal", "Checkout", "Chargeback-Ready", "Physical Goods"],
    bestFor: "Most ecommerce stores selling physical products.",
    qualityBadge: "Essential",
    merchantPlaceholders: [
      "Store Name",
      "Legal Company Name",
      "Registered Address",
      "Support Email",
      "Phone Number",
      "Company Registration Number / Tax ID",
      "Currency",
      "Country / State",
      "Jurisdiction",
    ],
    merchantNotes: [
      "Use your actual legal entity name, not just your brand name.",
      "Make sure your governing law and jurisdiction match where your business is based.",
      "Review the chargeback wording so it matches your support process.",
      "If you sell subscriptions, digital goods, or services, add those terms separately.",
    ],
    disputeDefenseValue:
      "Helps document customer expectations around orders, payments, and payment disputes.",
  },
  {
    id: "refund-policy-general-ecommerce",
    type: "refunds",
    title: "Refund Policy",
    shortDescription:
      "Sets expectations for returns, exchanges, cancellations, damaged items, and refund timing.",
    categoryTags: ["Core", "Refunds", "Returns", "Post-Purchase", "Chargeback-Ready"],
    bestFor: "Stores selling physical goods with returns or limited refund eligibility.",
    qualityBadge: "Essential",
    merchantPlaceholders: [
      "Store Name",
      "Support Email",
      "Phone Number",
      "Change-of-mind return window (days)",
      "Issue reporting window (days)",
      "Refund processing time (business days)",
    ],
    merchantNotes: [
      "This should match your real return handling process.",
      "Clear refund terms help prevent avoidable disputes.",
      "If some products are final sale or custom-made, state that clearly.",
    ],
    disputeDefenseValue:
      "Useful in not-as-described and refund-related disputes.",
  },
  {
    id: "shipping-policy-general-ecommerce",
    type: "shipping",
    title: "Shipping Policy",
    shortDescription:
      "Explains processing times, delivery estimates, tracking, address responsibility, and shipping exceptions.",
    categoryTags: ["Core", "Shipping", "Fulfillment", "Delivery", "Chargeback-Ready"],
    bestFor: "Stores shipping physical products, especially across multiple regions.",
    qualityBadge: "Chargeback-Ready",
    merchantPlaceholders: [
      "Store Name",
      "Support Email",
      "Processing time (business days)",
      "Shipping destinations / regions",
      "Whether P.O. boxes are accepted",
      "Whether customs duties are customer responsibility",
    ],
    merchantNotes: [
      "Keep delivery promises realistic.",
      "Only include destinations you actually ship to.",
      "If you use tracking, say so.",
      "Very useful for item-not-received disputes.",
    ],
    disputeDefenseValue: "Useful in item-not-received disputes.",
  },
  {
    id: "privacy-policy-basic-storefront",
    type: "privacy",
    title: "Privacy Policy",
    shortDescription:
      "Explains what customer data you collect, why you collect it, and how it is used and shared.",
    categoryTags: ["Core", "Privacy", "Data", "Compliance", "Customer Data"],
    bestFor: "Any store collecting customer information through checkout, forms, analytics, or email marketing.",
    qualityBadge: "Essential",
    merchantPlaceholders: [
      "Store Name",
      "Privacy Email / Support Email",
      "Registered Address",
    ],
    merchantNotes: [
      "This template is a starter and may need jurisdiction-specific updates.",
      "If you use ad platforms, tracking pixels, or email marketing tools, review this carefully.",
      "If you target the EU, UK, California, or Brazil, legal review is strongly recommended.",
    ],
    disputeDefenseValue:
      "Documents how you handle customer data; supports trust and compliance.",
  },
  {
    id: "customer-service-policy-basic",
    type: "contact",
    title: "Contact Information & Customer Service Policy",
    shortDescription:
      "Shows customers how to reach you, when you respond, and what information helps resolve issues faster.",
    categoryTags: ["Support", "Contact", "Service", "Trust", "Chargeback-Ready"],
    bestFor: "Stores that want a clear support page and better pre-dispute communication.",
    qualityBadge: "Recommended",
    merchantPlaceholders: [
      "Store Name",
      "Support Email",
      "Phone Number",
      "Business Address",
      "Support Hours",
      "Expected response time (business days)",
    ],
    merchantNotes: [
      "Use support hours you can actually maintain.",
      "A clear contact policy can improve trust and reduce payment disputes.",
      "Keep support instructions simple and easy to scan.",
    ],
    disputeDefenseValue:
      "Useful in cases where the customer did not attempt to contact the merchant first.",
  },
];

export const POLICY_TYPES = POLICY_LIBRARY_ORDER;

export function getPolicyMeta(type: PolicyTemplateType): PolicyTemplateMeta | undefined {
  return POLICY_LIBRARY.find((t) => t.type === type);
}
