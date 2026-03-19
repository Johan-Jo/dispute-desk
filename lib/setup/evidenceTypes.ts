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
  title: string;
  description: string;
  autoCollected: boolean;
  recommended: boolean;
}

export interface EvidenceSource {
  name: string;
  type: "auto" | "manual";
  status: "connected" | "not-configured" | "requires-setup" | "available";
}

export const EVIDENCE_TYPES: EvidenceType[] = [
  {
    id: "order-details",
    icon: ShoppingBag,
    title: "Order Details",
    description: "Order number, date, amount, status",
    autoCollected: true,
    recommended: true,
  },
  {
    id: "customer-info",
    icon: User,
    title: "Customer Information",
    description: "Name, email, billing address, history",
    autoCollected: true,
    recommended: true,
  },
  {
    id: "shipping-info",
    icon: Package,
    title: "Shipping Information",
    description: "Tracking, carrier, delivery confirmation",
    autoCollected: true,
    recommended: true,
  },
  {
    id: "product-info",
    icon: FileText,
    title: "Product Information",
    description: "Product name, SKU, description, images",
    autoCollected: true,
    recommended: true,
  },
  {
    id: "policies",
    icon: Shield,
    title: "Store Policies",
    description: "Shipping, return, refund, terms of service",
    autoCollected: false,
    recommended: true,
  },
  {
    id: "communication",
    icon: FileText,
    title: "Customer Communication",
    description: "Email exchanges and support tickets",
    autoCollected: false,
    recommended: false,
  },
  {
    id: "payment-proof",
    icon: DollarSign,
    title: "Payment Proof",
    description: "Transaction ID, payment method, authorization",
    autoCollected: true,
    recommended: true,
  },
  {
    id: "custom-fields",
    icon: FileText,
    title: "Custom Fields",
    description: "Additional evidence for your business",
    autoCollected: false,
    recommended: false,
  },
];

export const EVIDENCE_SOURCES: Record<string, EvidenceSource[]> = {
  "order-details": [
    { name: "Shopify Order API", type: "auto", status: "connected" },
    { name: "Manual Upload", type: "manual", status: "available" },
  ],
  "customer-info": [
    { name: "Shopify Customer API", type: "auto", status: "connected" },
    { name: "Manual Upload", type: "manual", status: "available" },
  ],
  "shipping-info": [
    { name: "Shopify Fulfillment API", type: "auto", status: "connected" },
    { name: "Carrier Integration", type: "auto", status: "not-configured" },
    { name: "Manual Upload", type: "manual", status: "available" },
  ],
  "product-info": [
    { name: "Shopify Product API", type: "auto", status: "connected" },
    { name: "Manual Upload", type: "manual", status: "available" },
  ],
  policies: [
    { name: "Policy URLs", type: "manual", status: "requires-setup" },
    { name: "Uploaded Documents", type: "manual", status: "available" },
  ],
  communication: [
    { name: "Email Archive", type: "manual", status: "available" },
    { name: "Support Ticket Export", type: "manual", status: "available" },
  ],
  "payment-proof": [
    { name: "Shopify Payment API", type: "auto", status: "connected" },
    { name: "Manual Upload", type: "manual", status: "available" },
  ],
  "custom-fields": [
    { name: "Manual Upload", type: "manual", status: "available" },
  ],
};
