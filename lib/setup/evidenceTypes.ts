import type { LucideIcon } from "lucide-react";
import {
  ShoppingBag,
  User,
  Package,
  FileText,
  Shield,
  DollarSign,
} from "lucide-react";

export interface EvidenceType {
  id: string;
  icon: LucideIcon;
  autoCollected: boolean;
  recommended: boolean;
}

/** Keys under setup.templateWizard.sourceLabels */
export type EvidenceSourceLabelKey =
  | "shopifyOrderApi"
  | "manualUpload"
  | "shopifyCustomerApi"
  | "shopifyFulfillmentApi"
  | "carrierIntegration"
  | "shopifyProductApi"
  | "policyUrls"
  | "uploadedDocuments"
  | "emailArchive"
  | "supportTicketExport"
  | "shopifyPaymentApi";

export interface EvidenceSource {
  sourceKey: EvidenceSourceLabelKey;
  type: "auto" | "manual";
  status: "connected" | "not-configured" | "requires-setup" | "available";
}

export const EVIDENCE_TYPES: EvidenceType[] = [
  {
    id: "order-details",
    icon: ShoppingBag,
    autoCollected: true,
    recommended: true,
  },
  {
    id: "customer-info",
    icon: User,
    autoCollected: true,
    recommended: true,
  },
  {
    id: "shipping-info",
    icon: Package,
    autoCollected: true,
    recommended: true,
  },
  {
    id: "product-info",
    icon: FileText,
    autoCollected: true,
    recommended: true,
  },
  {
    id: "policies",
    icon: Shield,
    autoCollected: false,
    recommended: true,
  },
  {
    id: "communication",
    icon: FileText,
    autoCollected: false,
    recommended: false,
  },
  {
    id: "payment-proof",
    icon: DollarSign,
    autoCollected: true,
    recommended: true,
  },
  {
    id: "custom-fields",
    icon: FileText,
    autoCollected: false,
    recommended: false,
  },
];

export const EVIDENCE_SOURCES: Record<string, EvidenceSource[]> = {
  "order-details": [
    { sourceKey: "shopifyOrderApi", type: "auto", status: "connected" },
    { sourceKey: "manualUpload", type: "manual", status: "available" },
  ],
  "customer-info": [
    { sourceKey: "shopifyCustomerApi", type: "auto", status: "connected" },
    { sourceKey: "manualUpload", type: "manual", status: "available" },
  ],
  "shipping-info": [
    { sourceKey: "shopifyFulfillmentApi", type: "auto", status: "connected" },
    { sourceKey: "carrierIntegration", type: "auto", status: "not-configured" },
    { sourceKey: "manualUpload", type: "manual", status: "available" },
  ],
  "product-info": [
    { sourceKey: "shopifyProductApi", type: "auto", status: "connected" },
    { sourceKey: "manualUpload", type: "manual", status: "available" },
  ],
  policies: [
    { sourceKey: "policyUrls", type: "manual", status: "requires-setup" },
    { sourceKey: "uploadedDocuments", type: "manual", status: "available" },
  ],
  communication: [
    { sourceKey: "emailArchive", type: "manual", status: "available" },
    { sourceKey: "supportTicketExport", type: "manual", status: "available" },
  ],
  "payment-proof": [
    { sourceKey: "shopifyPaymentApi", type: "auto", status: "connected" },
    { sourceKey: "manualUpload", type: "manual", status: "available" },
  ],
  "custom-fields": [
    { sourceKey: "manualUpload", type: "manual", status: "available" },
  ],
};
